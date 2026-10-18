<#
.SYNOPSIS
  Minimal HTTP bridge: VanOS Mission Control → DisplayFusion on this Windows PC.

.DESCRIPTION
  Listens on VANOS_DF_PORT (default 17890), requires Bearer VANOS_DF_SECRET,
  and runs DisplayFusionCommand.exe -functionrun <name> [args].

  Prefer binding to your Tailscale IP (VANOS_DF_LISTEN) so only the tailnet can reach it.

.EXAMPLE
  $env:VANOS_DF_SECRET = "same-as-DISPLAYFUSION_BRIDGE_SECRET"
  $env:VANOS_DF_PORT = "17890"
  .\VanOS-DisplayFusion-Bridge.ps1
#>

$ErrorActionPreference = "Stop"

$port = if ($env:VANOS_DF_PORT) { [int]$env:VANOS_DF_PORT } else { 17890 }
$secret = $env:VANOS_DF_SECRET
if (-not $secret) {
  Write-Error "Set VANOS_DF_SECRET to match DISPLAYFUSION_BRIDGE_SECRET on Mission Control."
}

$listen = if ($env:VANOS_DF_LISTEN) { $env:VANOS_DF_LISTEN } else { "127.0.0.1" }

$dfCmd = $env:DF_CMD
if (-not $dfCmd) {
  $candidates = @(
    "${env:ProgramFiles}\DisplayFusion\DisplayFusionCommand.exe",
    "${env:ProgramFiles(x86)}\DisplayFusion\DisplayFusionCommand.exe",
    "$env:LOCALAPPDATA\DisplayFusion\DisplayFusionCommand.exe"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { $dfCmd = $c; break }
  }
}

function Write-JsonResponse($ctx, $status, $obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 6
  $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
  $ctx.Response.StatusCode = $status
  $ctx.Response.ContentType = "application/json; charset=utf-8"
  $ctx.Response.ContentLength64 = $buffer.Length
  $ctx.Response.OutputStream.Write($buffer, 0, $buffer.Length)
  $ctx.Response.OutputStream.Close()
}

# Case-sensitive, constant-time compare. PowerShell's -eq ignores case
# and stops at the first differing character.
function Test-SecretEqual([string]$presented, [string]$expected) {
  if (-not $presented -or -not $expected) { return $false }
  $a = [System.Text.Encoding]::UTF8.GetBytes($presented)
  $b = [System.Text.Encoding]::UTF8.GetBytes($expected)
  $diff = $a.Length -bxor $b.Length
  $len = [Math]::Max($a.Length, $b.Length)
  for ($i = 0; $i -lt $len; $i++) {
    $x = if ($i -lt $a.Length) { $a[$i] } else { 0 }
    $y = if ($i -lt $b.Length) { $b[$i] } else { 0 }
    $diff = $diff -bor ($x -bxor $y)
  }
  return ($diff -eq 0)
}

function Test-Auth($req) {
  $auth = $req.Headers["Authorization"]
  if ($auth -and $auth.StartsWith("Bearer ")) {
    if (Test-SecretEqual $auth.Substring(7).Trim() $secret) { return $true }
  }
  $hdr = $req.Headers["X-VanOS-DF-Secret"]
  if ($hdr -and (Test-SecretEqual $hdr.Trim() $secret)) { return $true }
  return $false
}

# Same rule as Mission Control's parseDfArgs: plain words, numbers and simple
# punctuation. No double quotes, no $, no leading dash, so nothing becomes a flag.
$safeValue = '^[A-Za-z0-9_][A-Za-z0-9 _.,:@#/+=()''-]{0,127}$'

function Invoke-DfFunction([string]$fn, [string[]]$fnArgs) {
  if (-not $dfCmd -or -not (Test-Path $dfCmd)) {
    return @{
      ok = $false
      error = "DisplayFusionCommand.exe not found. Set DF_CMD or install DisplayFusion."
    }
  }

  # DisplayFusion: DisplayFusionCommand.exe -functionrun "Function Name"
  # Quote every value ourselves: Windows PowerShell joins an -ArgumentList
  # array with spaces and no quoting, so "Other Function" would split.
  $quoted = @($fn) + @($fnArgs) | ForEach-Object { '"' + $_ + '"' }
  $argLine = "-functionrun " + ($quoted -join " ")
  $p = Start-Process -FilePath $dfCmd -ArgumentList $argLine -Wait -PassThru -NoNewWindow -RedirectStandardOutput "$env:TEMP\vanos-df-out.txt" -RedirectStandardError "$env:TEMP\vanos-df-err.txt"
  $out = ""
  $err = ""
  if (Test-Path "$env:TEMP\vanos-df-out.txt") { $out = Get-Content "$env:TEMP\vanos-df-out.txt" -Raw }
  if (Test-Path "$env:TEMP\vanos-df-err.txt") { $err = Get-Content "$env:TEMP\vanos-df-err.txt" -Raw }

  if ($p.ExitCode -ne 0) {
    return @{
      ok = $false
      error = "Exit $($p.ExitCode): $err $out".Trim()
      output = $out
    }
  }
  return @{
    ok = $true
    summary = "Ran function '$fn'"
    output = $out
  }
}

$prefix = "http://${listen}:${port}/"
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($prefix)
$listener.Start()

Write-Host "VanOS DisplayFusion bridge listening on $prefix"
if ($dfCmd) { Write-Host "DisplayFusionCommand: $dfCmd" } else { Write-Host "WARNING: DisplayFusionCommand.exe not found yet" }

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $path = $req.Url.AbsolutePath.TrimEnd("/")

    if ($req.HttpMethod -eq "GET" -and ($path -eq "" -or $path -eq "/health")) {
      Write-JsonResponse $ctx 200 @{
        ok = $true
        service = "vanos-displayfusion-bridge"
        dfCommand = [bool]$dfCmd
      }
      continue
    }

    if ($req.HttpMethod -ne "POST" -or ($path -ne "/run" -and $path -ne "")) {
      Write-JsonResponse $ctx 404 @{ ok = $false; error = "Not found. POST /run" }
      continue
    }

    if (-not (Test-Auth $req)) {
      Write-JsonResponse $ctx 401 @{ ok = $false; error = "Unauthorized" }
      continue
    }

    $reader = [System.IO.StreamReader]::new($req.InputStream, $req.ContentEncoding)
    $raw = $reader.ReadToEnd()
    $reader.Close()

    try {
      $body = $raw | ConvertFrom-Json
    } catch {
      Write-JsonResponse $ctx 400 @{ ok = $false; error = "Invalid JSON" }
      continue
    }

    $fn = $body.functionName
    if (-not $fn) { $fn = $body.command }
    if (-not $fn) {
      Write-JsonResponse $ctx 400 @{ ok = $false; error = "functionName or command required" }
      continue
    }

    $fnArgs = @()
    if ($body.args) { $fnArgs = @($body.args | ForEach-Object { [string]$_ }) }

    $unsafe = @(@([string]$fn) + $fnArgs | Where-Object { $_ -cnotmatch $safeValue })
    if ($unsafe.Count -gt 0 -or $fnArgs.Count -gt 8) {
      Write-JsonResponse $ctx 400 @{ ok = $false; error = "Function name or args contain characters the bridge does not accept" }
      continue
    }

    Write-Host "$(Get-Date -Format o) run $fn ($($body.scriptId))"
    $result = Invoke-DfFunction -fn ([string]$fn) -fnArgs $fnArgs
    $status = if ($result.ok) { 200 } else { 502 }
    Write-JsonResponse $ctx $status $result
  }
}
finally {
  $listener.Stop()
  $listener.Close()
}
