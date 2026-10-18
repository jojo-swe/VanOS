# Home Assistant + DisplayFusion

Control home + desktop from VanOS Mission Control (**Home / PC** panel), Agent API, and MCP.

Prefer **Tailscale** for both HA and the Windows bridge — never expose long-lived HA tokens to the public internet.

## Home Assistant

### Env (Mission Control host)

```bash
HOME_ASSISTANT_URL=http://homeassistant:8123
# or https://ha.<tailnet>.ts.net
HOME_ASSISTANT_TOKEN=…          # Long-Lived Access Token (HA Profile → Security)
HOME_ASSISTANT_WATCH=light.kitchen,switch.sample,person.resident,sensor.outdoor_temperature
```

Aliases: `HA_URL`, `HA_TOKEN`, `HA_LONG_LIVED_TOKEN`, `HA_WATCH_ENTITIES`.

### API

| Method | Path | Auth |
|--------|------|------|
| GET/POST | `/api/homeassistant` | Dashboard / Bearer |
| GET/POST | `/api/v1/homeassistant` | `AGENT_API_TOKEN` |

```bash
# Toggle a light
curl -X POST "$HOST/api/v1/homeassistant" \
  -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"domain":"light","service":"toggle","entityId":"light.desk"}'
```

### Allowed services

Service calls are limited to `HA_ALLOWED_SERVICES`, a comma-separated list of `domain.service` entries (`domain.*` allows a whole domain). When unset the default is:

```
light.*,switch.*,fan.*,media_player.*,input_boolean.*,scene.turn_on
```

Locks, alarms, covers, scripts, automations and `homeassistant.*` are not in the default, because the agent token can call this route. Add only what you need, for example `HA_ALLOWED_SERVICES=light.*,switch.*,climate.set_temperature`. Anything else returns `403`.

### MCP

- `vanos_ha_states`
- `vanos_ha_call`

## DisplayFusion (Windows scripts)

DisplayFusion has no cloud API. VanOS POSTs to a **small bridge** on your PC (Tailscale), which runs DisplayFusion Command / functions.

### Env (Mission Control)

```bash
DISPLAYFUSION_BRIDGE_URL=http://desktop:17890/run
DISPLAYFUSION_BRIDGE_SECRET=long-random
# Optional catalog override:
# DISPLAYFUSION_SCRIPTS_JSON=[{"id":"coding","name":"Coding","command":"LoadWindowLayout","description":"…"}]
```

### Bridge on Windows

1. Install DisplayFusion (with Command Line support).
2. Copy `bridges/displayfusion/VanOS-DisplayFusion-Bridge.ps1` to the PC.
3. Set env `VANOS_DF_SECRET` (same as `DISPLAYFUSION_BRIDGE_SECRET`) and optional `DF_CMD` path.
4. Run elevated or as your user:

```powershell
$env:VANOS_DF_SECRET = "long-random"
$env:VANOS_DF_PORT = "17890"
# Bind Tailscale IP only if you want:
# $env:VANOS_DF_LISTEN = "100.x.y.z"
.\VanOS-DisplayFusion-Bridge.ps1
```

5. Keep the process alive (Task Scheduler / NSSM / startup script).
6. Point Mission Control `DISPLAYFUSION_BRIDGE_URL` at `http://<tailscale-name>:17890/run`.

The bridge accepts:

```json
{
  "command": "MaximizeWindow",
  "functionName": "MaximizeWindow",
  "args": [],
  "scriptId": "maximize"
}
```

It runs DisplayFusion via `DisplayFusionCommand.exe` `-functionrun` when available, else documents the command for custom scripting.

### API

| Method | Path | Auth |
|--------|------|------|
| GET/POST | `/api/displayfusion` | Dashboard login (basic auth, then TOTP when set). The bridge secret may only post results back (`{"type":"result",…}`). Agents use `/api/v1/displayfusion`. |
| GET/POST | `/api/v1/displayfusion` | `AGENT_API_TOKEN` |

```bash
curl -X POST "$HOST/api/v1/displayfusion" \
  -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scriptId":"focus-coding"}'
```

### MCP

- `vanos_df_list`
- `vanos_df_run`

## Security notes

- HA token and DF bridge secret stay on the server / PC — never in the browser bundle.
- Reach HA and the bridge over Tailscale only.
- Agent calls use `AGENT_API_TOKEN`; UI uses dashboard auth.
- See `SECURITY.md` for access modes.
