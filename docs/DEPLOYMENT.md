# Deployment

One VPS runs Mission Control. Vercel only hosts the public demo with sample data. The mode is `VANOS_ACCESS_MODE`. Placeholders only — generate real values on the machine that will hold them (`openssl rand -base64 32`) and store them in the host's env, not in git.

```
phone / laptop ── Tailscale ──► VPS :443  (tailscale serve, tailnet only)
                                  dashboard + every API route
                                        │
                                  one Next.js process on 127.0.0.1:3000
                                  VANOS_ACCESS_MODE=private
                                        │
Grok Bot / n8n ── HTTPS + Bearer ─► VPS :8443 (tailscale funnel, public)
                                  only /api/bots/ingest, /api/mcp, /api/v1/health

Vercel ── VANOS_DEMO_MODE=true ── sample data, no secrets, writes refused
```

| Where | Reachable from | What answers |
|-------|----------------|--------------|
| VPS `:443` via Tailscale Serve | your tailnet | Dashboard and every route, behind basic auth (and TOTP when set) |
| VPS `:8443` via Tailscale Funnel | the internet | `POST /api/bots/ingest` (`BOTS_INGEST_SECRET`), `POST /api/mcp` (`AGENT_API_TOKEN`), `GET /api/v1/health` |
| Vercel | the internet | The demo only. See [Vercel public demo](#vercel-public-demo) |

Funnel is switched on per port, and only ports 443, 8443 and 10000 can be public. Keeping the dashboard on 443 with Serve and the bot paths on 8443 with Funnel means the dashboard never becomes public. Each Funnel path is mounted on its own, so nothing else on the app is reachable from the internet.

Tokens must be different from each other and at least 32 characters. The server refuses to boot otherwise. See [ai-support/SECURITY.md](../ai-support/SECURITY.md).

## VPS (Tailscale Serve for the dashboard, Funnel for bots)

Run this on your VPS (the box already on the tailnet). The app binds to localhost.

```bash
cd /path/to/VanOS/ai-support
npm ci
npm run build

export VANOS_ACCESS_MODE=private
export DASHBOARD_BASIC_USER=<dashboard-user>
export DASHBOARD_BASIC_PASSWORD=<long-random>
export VANOS_SESSION_SECRET=<long-random-session>
export AGENT_API_TOKEN=<long-random-agent>
export BOTS_INGEST_SECRET=<long-random-ingest>

# At least one of these. CGNAT trust is optional and VPS-only.
export VANOS_ALLOWED_TAILSCALE_USERS=<tailscale-login>
export VANOS_EDGE_SECRET=<long-random-edge>
export VANOS_TRUST_TAILSCALE_CGNAT=true
# Tailscale Serve/Funnel and Caddy pass the client address in X-Forwarded-For.
# Without this every caller is "unknown" and shares one rate-limit bucket.
export VANOS_TRUST_PROXY=true
export VANOS_PRIVATE_APP_URL=https://<vps-hostname>.<tailnet>.ts.net
export VANOS_ALLOWED_HOSTS=<vps-hostname>.<tailnet>.ts.net

# Bots reach the VPS through Funnel, without a tailnet identity, so the
# bearer routes must accept public callers. Funnel limits which paths exist.
export VANOS_PUBLIC_INGEST=true
# Where bots call back after a dispatch: the Funnel address, not the tailnet one.
export VANOS_PUBLIC_INGEST_URL=https://<vps-hostname>.<tailnet>.ts.net:8443

# Data is stored as JSON in .data/bots unless Upstash is set. Keep that
# directory on a disk that survives redeploys, or point VANOS_DATA_DIR at one.
# Upstash is optional on a single VPS.
# export VANOS_DATA_DIR=/var/lib/vanos

HOSTNAME=127.0.0.1 npm run start -- -p 3000

# Dashboard: tailnet only.
tailscale serve --bg --https=443 http://127.0.0.1:3000

# Bots: public, three paths only.
tailscale funnel --bg --https=8443 --set-path=/api/bots/ingest http://127.0.0.1:3000/api/bots/ingest
tailscale funnel --bg --https=8443 --set-path=/api/mcp http://127.0.0.1:3000/api/mcp
tailscale funnel --bg --https=8443 --set-path=/api/v1/health http://127.0.0.1:3000/api/v1/health
tailscale funnel status
```

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/bots/ingest` | `Authorization: Bearer <BOTS_INGEST_SECRET>` |
| POST | `/api/mcp` | `Authorization: Bearer <AGENT_API_TOKEN>` |
| GET | `/api/v1/health` | none for the sparse body; agent token for the inventory body |

Check from a machine that is **not** on the tailnet (placeholders):

```bash
PUBLIC=https://<vps-hostname>.<tailnet>.ts.net:8443

curl -sS -o /dev/null -w "%{http_code}\n" "$PUBLIC/dashboard"
# 404 — Funnel has no such path

curl -sS "$PUBLIC/api/v1/health"
# {"ok":true,"service":"vanos-mission-control",...}

curl -sS -o /dev/null -w "%{http_code}\n" \
  -X POST "$PUBLIC/api/bots/ingest" \
  -H "Authorization: Bearer <BOTS_INGEST_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"botId":"<bot-id>","type":"status","title":"ping","body":"funnel check"}'
# 200 when the secret matches

curl -sS -o /dev/null -w "%{http_code}\n" https://<vps-hostname>.<tailnet>.ts.net/dashboard
# times out off the tailnet; 401 from a tailnet device
```

Point Grok's ingest callback at `$PUBLIC/api/bots/ingest` and the MCP connector at `$PUBLIC/api/mcp`. Open the dashboard on the Tailscale URL without a port.

Open `https://<vps-hostname>.<tailnet>.ts.net/dashboard`. The browser prompts for basic auth. Tailscale ACLs should allow only your user and devices.

### Moving a checkout to the new repo history

`jojo-swe/VanOS` was restarted with a fresh history in October 2026 (the old one is archived as `jojo-swe/VanOS-old-history`). A checkout cloned before that cannot `git pull`.

- **The app checkout on the VPS** holds no local work: `.data/bots` and `.env*` are gitignored and stay put. Run `git fetch origin && git reset --hard origin/main` in the repo root (or clone it fresh and move `.data/bots` and the env file over), then `npm ci`, `npm run build` and restart.
- **The live OpenClaw workspace** has the main agent's local-only files and unbacked agent changes. Do not `reset --hard` there. Run `bash scripts/move-workspace-to-new-history.sh` once (after `git fetch`, from a copy of the script in the new history if the old checkout lacks it) before the next `.backup-to-github.sh` run.

`DASHBOARD_BASIC_PASSWORD` must be at least 32 characters when it is set. A shorter value does not stop the process: startup logs `config_ok: false` with `reason: "short_password"` and a warning that does not include the password. Token problems (`short_key`, `shared_key`) still refuse to boot.

## Optional TOTP (dashboard only)

Leave TOTP off until you want a second factor. With or without it, set a stable `VANOS_SESSION_SECRET` on the VPS so the browser can keep a session. The process does not generate that secret. If it is missing, or it changes on every restart, the dashboard asks for Basic auth on every new window. Bots should not use the dashboard for status or reports. Status is `GET /api/v1/health` or `GET /api/v1/snapshot` with `Authorization: Bearer <AGENT_API_TOKEN>`. Reports are `POST /api/bots/ingest` with `Authorization: Bearer <BOTS_INGEST_SECRET>`. Those routes do not accept the session cookie and do not ask for a TOTP code. Snapshot is a private-host route; the edge process serves health, not snapshot.

Turn it on only on the VPS, after basic auth is already set. Do not put the secret on the Vercel demo project.

On your own machine, from `ai-support/`:

```bash
npm run totp:setup
# optional label in the authenticator app:
# npm run totp:setup -- --account jojo --issuer VanOS
```

The command prints a new base32 secret, an `otpauth://totp/...` URI, a QR code in the terminal, eight recovery codes, and the SHA-256 hashes of those codes. It does not read an existing secret and it does not write a file. Scan the QR with an authenticator app (SHA1, 6 digits, 30-second step). Copy the secret into the VPS env. Store the recovery codes in a password manager. Store only the hashes on the server.

```bash
export VANOS_TOTP_SECRET=<base32-from-the-command>
export VANOS_SESSION_SECRET=<openssl rand -base64 32>
# optional, default 30. Clamped to 1…365. VANOS_SESSION_TTL_SECONDS is ignored.
export VANOS_SESSION_TTL_DAYS=30
export VANOS_TOTP_MAX_ATTEMPTS=5
export VANOS_TOTP_ATTEMPT_WINDOW_SEC=300
export VANOS_TOTP_RECOVERY_CODES=<sha256-hex>,<sha256-hex>
# or one hash per line, outside the git checkout:
# export VANOS_TOTP_RECOVERY_FILE=/etc/vanos/totp-recovery-hashes
# export VANOS_TOTP_RECOVERY_USED_FILE=/etc/vanos/totp-recovery-hashes.used
```

`VANOS_SESSION_SECRET` signs the session cookie. It must be at least 32 characters whenever TOTP is on. If it is missing or shorter, startup refuses to boot (`reason: "short_key"`). If the TOTP secret is not valid base32, or it decodes to fewer than 16 bytes, startup refuses to boot (`reason: "mfa_config"`, or `short_key` when the message is the length check). The log line does not include the secret. Unset TOTP does not refuse to boot when the session secret is missing, but then no persistent cookie is issued and Basic auth is required on every request. Keep the same secret across restarts. Rotating it, the dashboard password, or the TOTP secret signs out every browser.

Set `VANOS_SESSION_SECRET` even when TOTP is off. After Basic auth succeeds, the response sets `vanos_session`. When TOTP is on, the cookie is set only after the code succeeds.

After the browser's basic-auth prompt succeeds and TOTP is on, the next response is an HTML form (`401`, no `WWW-Authenticate` header, `X-VanOS-MFA: required`). Submit the 6-digit code, or a recovery code in the same field. The form posts to `POST /api/auth/mfa`. A non-browser client can send the same code in `X-VanOS-TOTP` on the dashboard request instead of using the form.

On success the app sets `vanos_session`. The cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and it lives for `VANOS_SESSION_TTL_DAYS` (default 30). Open the Tailscale Serve HTTPS URL (the `:8443` Serve port, not the raw HTTP bind). A `Secure` cookie is stored on that HTTPS origin and is sent again after the browser restarts, so the Basic prompt and the TOTP form are skipped until it expires, the password or TOTP secret changes, or the user signs out. An HTTP `next dev` URL will not keep a `Secure` cookie. The Mission Control header posts to `POST /api/auth/logout` (`GET` works too). It clears the cookie in that browser and, when the request carries a current session cookie or the Basic credential, signs out **every** session: it stores a new session generation in the durable store, and any cookie signed under the old one, including a copy taken from the browser, is rejected from then on. A cross-origin call is rejected and changes nothing. An unauthenticated call only clears the cookie. If storage cannot be written, logout answers `503` (this browser's cookie is still cleared) and logs `logout` with `revoked: false`; sign out again once storage is back.

The session generation is cached in the process for 10 seconds; on the single VPS the logout updates that cache at once. If storage stops answering (Upstash down, `.data/bots` unreadable), the last generation read stays in use for up to 15 minutes. After that, or after a restart while storage is still down, no session cookie is accepted or issued: the dashboard asks for Basic auth on every request, and with TOTP on the code step answers `503` until storage answers again. If Upstash stays down, unset `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` and restart to fall back to `.data/bots` (every browser then logs in once). Deleting `auth-session-generation` from the store signs everyone out; the next login writes a new one. The first deploy with this change rejects existing cookies once.

The success response is `303` with a relative `Location`. The default is `/dashboard`. A `next` value is used only when it is a same-origin path: it starts with a single `/`, it does not start with `//`, and it does not contain a scheme. Anything else, including `https://…` and protocol-relative `//…`, becomes `/dashboard`. The header is not built from the request URL, so a reverse proxy that connects to `0.0.0.0:3000` does not send the browser to `https://0.0.0.0:3000/dashboard`. The MFA challenge itself is HTML, not a redirect, and the form posts to the relative path `/api/auth/mfa`.

The code is checked against the current 30-second step and one step on either side (RFC 6238, HMAC-SHA1). A code that already matched is rejected until that step falls out of the window (`mfa_fail` reason `replay`). Used codes are recorded in the durable store (`totp-replay`: Upstash, or `.data/bots/totp-replay.json`) as an HMAC under the TOTP secret, and expire with the window, so a restart does not make a code usable again. The process also remembers the codes it accepted; if storage cannot be written, that record alone applies and the app logs `durable_write_failed` with label `totp-replay`. Recovery codes are one-time: the server stores SHA-256 hashes from `VANOS_TOTP_RECOVERY_CODES` and/or `VANOS_TOTP_RECOVERY_FILE` (blank lines and `#` comments ignored). A used hash is appended to `VANOS_TOTP_RECOVERY_USED_FILE`, or to `<recovery-file>.used`, or to `.data/totp-recovery-used.txt` when the hashes came from the env var. That file has to survive a restart or the code works again. Do not commit it.

TOTP attempts are counted per client address: `VANOS_TOTP_MAX_ATTEMPTS` (default 5) per `VANOS_TOTP_ATTEMPT_WINDOW_SEC` (default 300). The address is the same one the access log uses, so the VPS needs `VANOS_TRUST_PROXY=true` or every attempt shares the `unknown` bucket. A lockout is `429` with `Retry-After`. The counter is durable (Upstash when set, else `.data/bots/auth-attempts.json`), so restarting the app does not reset it. If storage fails, the per-process counter still applies.

A valid `vanos_session` cookie skips Basic auth and TOTP on dashboard routes, including the read APIs the page fetches. The cookie is HMAC-SHA256 signed and bound to the current dashboard user, password, TOTP secret, and session generation. Those values are compared in constant time and the credentials are not stored in the cookie. The Basic user name and password are always both checked, so a wrong user name answers as fast as a wrong password. It does not authorize `/api/v1/*`, ingest, or MCP. To skip TOTP without a browser session, send Basic in `Authorization` and the agent token in `X-VanOS-Agent-Token`. `Authorization` on these routes is the Basic credential, so `Authorization: Bearer <AGENT_API_TOKEN>` fails the Basic check and never reaches the TOTP skip. `BOTS_INGEST_SECRET` does not skip TOTP. Bots that need status should call `GET /api/v1/health` or `GET /api/v1/snapshot` with `Authorization: Bearer <AGENT_API_TOKEN>`. Bots that file reports should call `POST /api/bots/ingest` with `Authorization: Bearer <BOTS_INGEST_SECRET>`. `/api/mcp` and the other bearer routes are unchanged.

A browser `POST` must be `application/x-www-form-urlencoded` or `application/json`. If `Origin` is present it has to be this app, except the literal `null` that browsers send for this form under `Referrer-Policy: no-referrer`. `Origin: null` is accepted only when `Sec-Fetch-Site` is `same-origin`. A null origin with no `Sec-Fetch-Site`, or with any other site value, is rejected. If `Sec-Fetch-Site` is present on any other request it has to be `same-origin` or `none`. Anything else is `403` and `mfa_fail` reason `cross_origin`. The code is not consumed.

Failed dashboard basic-auth attempts are rate limited per client address (`VANOS_RATE_LIMIT_PER_MIN`, default 60/minute). A correct password is still accepted. `POST /api/homeassistant`, `POST /api/displayfusion`, and `POST /api/bots/dispatch` from a browser must send `Content-Type: application/json`. If `Origin` is present it has to be this app (the request URL, the `Host` header, or `VANOS_PRIVATE_APP_URL`). If `Sec-Fetch-Site` is present it has to be `same-origin` or `none`. Agent bearer calls are not browser credentials and skip that check. `X-VanOS-Edge` does not skip it: the proxy adds that header to every request, including ones a hostile page makes your browser send. DisplayFusion runs only catalog script ids and commands (`DISPLAYFUSION_SCRIPTS_JSON` or the built-in list), and `args` may hold only plain words, numbers and simple punctuation. `X-VanOS-Edge` does not authorize DisplayFusion. `/api/displayfusion` skips the dashboard gate only for a request carrying `DISPLAYFUSION_BRIDGE_SECRET`, and that secret can only post run results. Home Assistant calls are limited to `HA_ALLOWED_SERVICES` (default: lights, switches, fans, media players, input booleans and `scene.turn_on`; locks, alarms, covers, scripts and `homeassistant.*` are refused).

`VANOS_TRUST_TAILSCALE_CGNAT=true` treats a source address in `100.64.0.0/10` as a private client. The socket address always counts. `X-Real-IP` and `X-Forwarded-For` count only when `VANOS_TRUST_PROXY=true`. Do not copy either flag to Vercel.

`Tailscale-User-Login` is ignored unless `VANOS_TRUST_PROXY=true`. The proxy in front must strip any client-supplied copy and set the header itself. Bind the app to localhost so a direct connection cannot present it.

If this Tailscale version does not inject `Tailscale-User-Login`, stamp the edge secret in the proxy instead of trusting the header:

```caddy
# Reachable on the tailnet interface only.
request_header -Tailscale-User-Login
request_header -X-VanOS-Edge
header_up X-VanOS-Edge {env.VANOS_EDGE_SECRET}
reverse_proxy 127.0.0.1:3000
```

Check:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  http://127.0.0.1:3000/dashboard
# 403 without Tailscale identity and basic auth

curl -sS -D- http://127.0.0.1:3000/api/v1/health | head
```

GitHub, Notion, and Obsidian are optional and stay off until their env vars are set. Configure them on the VPS. `OBSIDIAN_VAULT_PATH` and the Obsidian Local REST API only work where the vault is. See `ai-support/INTEGRATIONS.md`.

## Vercel public demo

The public demo is the only thing Vercel runs. It does not receive bot traffic.

Set `VANOS_DEMO_MODE` to the exact value `true` on the Vercel project (Production). Redeploy after saving it. `VANOS_ACCESS_MODE` can stay `edge`. With the flag, `/` and `/dashboard` are public: no basic auth, no TOTP, seeded sample data, and a Demo banner. The banner stays unlinked unless `VANOS_DEMO_REPO_URL` is an http(s) URL. `POST /api/bots/ingest` and the other write routes return 403. Live GitHub, Notion, Obsidian, Home Assistant, DisplayFusion, Grok webhooks, and Upstash are not called.

Do not put `AGENT_API_TOKEN`, `BOTS_INGEST_SECRET`, `DASHBOARD_BASIC_USER`, `DASHBOARD_BASIC_PASSWORD`, `VANOS_SESSION_SECRET`, `VANOS_TOTP_SECRET`, Upstash, or integration tokens on that project. Demo mode ignores them for reads and refuses writes, but they do not belong on a public sample host. Leave the flag unset on your VPS. Any value other than `true` keeps the normal gate.

Vercel Authentication (Deployment Protection / SSO) still sits in front of the deployment. The project owner has to turn that off in Vercel, under Project → Settings → Deployment Protection, or visitors get a Vercel login instead of Mission Control. This repo does not change that setting.

## Alternative: a separate ingest edge on Vercel

Not used in this setup. If you would rather not use Funnel, a second Vercel project with `VANOS_ACCESS_MODE=edge` can take bot traffic instead. It answers only `/api/bots/ingest`, `/api/mcp` and `/api/v1/health` (everything else is 404), needs `AGENT_API_TOKEN`, `BOTS_INGEST_SECRET` and the same Upstash project as the VPS so both see the same data, and must not be the demo project. Point Grok at that project and set `VANOS_PUBLIC_INGEST_URL` on the VPS to its URL.

## Access log

The Next.js app writes one JSON object per line to stdout. This is the app log (`ai-support`), not a VPS reverse-proxy log. Lines never include headers, cookies, request bodies, query strings, or secret values.

`ts` is ISO 8601 UTC. `level` is `info`, `warn`, or `error`.

### Request

Written for `/api/bots/ingest` (`ingest`), `/api/mcp` (`mcp`), `/api/v1/*` (`v1`), `/dashboard` (`dashboard`), and for any other path the edge proxy answers (usually a 404) (`edge`). `2xx`/`3xx` are `info`, `4xx` are `warn`, `5xx` are `error`.

```json
{"ts":"2026-10-16T14:02:00.123Z","level":"warn","method":"POST","path":"/api/bots/ingest","status":401,"ip":"203.0.113.9","dur_ms":4,"route_group":"ingest"}
```

`path` is the pathname only. `dur_ms` is how long the app spent on that response. `ip` is the runtime socket address when the server exposes it. A client-supplied `X-Forwarded-For` is ignored, so the field is `unknown` when that socket address is not available. Set `VANOS_TRUST_PROXY=true` only behind a reverse proxy that appends the peer address (or overwrites the header with that one address). The logged IP is then the rightmost hop that is not the proxy's own socket address. The same value is the rate-limit key. Do not set the flag on Vercel. Rate limits and `auth_ok` / `auth_fail` use this one function.

### Auth

`auth_ok` has no `reason`. `auth_fail` uses `bad_token`, `missing_token`, `basic_auth_fail`, or `rate_limited`. The token itself is not logged. `auth_ok` means basic auth (or a bearer check) succeeded. It is written before the TOTP step, so a line by itself is not proof of MFA.

```json
{"ts":"2026-10-16T14:02:00.123Z","level":"warn","event":"auth_fail","reason":"bad_token","path":"/api/mcp","ip":"203.0.113.9"}
```

### MFA

Written only when `VANOS_TOTP_SECRET` is set, and only for the dashboard basic-auth step. The code, the cookie, and the secret are not logged. `mfa_ok` is `info`. `mfa_fail` is `warn`. The fields are the same shape as `auth_fail`, including `reason`.

`mfa_ok` reason: `totp` or `recovery`.

`mfa_fail` reason: `missing_code`, `bad_code`, `replay` (the same TOTP code was already accepted and is still inside the ±1 step window), `rate_limited`, `recovery_used`, `cross_origin`, or `unavailable` (TOTP is set but the session secret or the recovery-code store cannot be used, or the code was right but storage cannot name the current session generation, so no cookie could be issued).

```json
{"ts":"2026-10-16T14:02:01.456Z","level":"info","event":"mfa_ok","reason":"totp","path":"/dashboard","ip":"100.80.1.5"}
```

```json
{"ts":"2026-10-16T14:02:01.456Z","level":"warn","event":"mfa_fail","reason":"bad_code","path":"/dashboard","ip":"100.80.1.5"}
```

### Logout

Written when an authenticated `/api/auth/logout` tries to sign out every session. `revoked: true` (`info`) means every existing cookie is now invalid. `revoked: false` (`warn`, reason `unavailable`) means storage could not be written and only that browser's cookie was cleared. An unauthenticated logout writes no line. The cookie is not logged.

```json
{"ts":"2026-10-16T14:05:00.000Z","level":"info","event":"logout","revoked":true,"path":"/api/auth/logout","ip":"100.80.1.5"}
```

### Startup

Written once when the process boots, before exit if the token check fails. `mode` is the access mode (`edge` or `private` on the two hosts). `reason` is present only when `config_ok` is false: `short_key` (a set token is under 32 characters, or `VANOS_SESSION_SECRET` is missing or under 32 characters while TOTP is on, or the TOTP secret decodes to fewer than 16 bytes), `shared_key` (agent and ingest secrets match), `short_password` (`DASHBOARD_BASIC_PASSWORD` is set and under 32 characters), or `mfa_config` (`VANOS_TOTP_SECRET` is set and is not valid base32). `short_key`, `shared_key`, and `mfa_config` refuse to boot. `short_password` is a warning and the process stays up. Unset TOTP does not add a reason.

```json
{"ts":"2026-10-16T14:02:00.123Z","level":"info","event":"startup","version":"0.1.0","mode":"edge","config_ok":true}
```

```json
{"ts":"2026-10-16T14:02:00.123Z","level":"error","event":"startup","version":"0.1.0","mode":"private","config_ok":false,"reason":"shared_key"}
```

### Error

Uncaught request errors, and handler failures that are caught and turned into a 500. `error` is the error class. `stack` is at most 20 lines. Message and stack are redacted.

```json
{"ts":"2026-10-16T14:02:00.123Z","level":"error","event":"error","route":"/api/v1/ingest","error":"TypeError","message":"Cannot read properties of undefined","stack":"TypeError: Cannot read properties of undefined\n    at POST (route.ts:40:5)"}
```

### Dashboard exposure

If `/dashboard` is about to be served with status 200 while `VANOS_ACCESS_MODE=edge` and `VANOS_EDGE_DASHBOARD` is not exactly `true`, the app also writes:

```json
{"ts":"2026-10-16T14:02:00.123Z","level":"error","event":"dashboard_exposed","path":"/dashboard","mode":"edge"}
```
