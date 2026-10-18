# VanOS Agent API + MCP

Agents (OpenClaw, Grok Bot, Hermes, n8n, Cursor) talk to Mission Control through:

1. **REST** — `/api/v1/*` (HTTP, any client)
2. **MCP (local)** — `npm run mcp` (stdio tools for Cursor / Hermes / Claude on this machine)
3. **MCP (Grok Bot)** — `POST /api/mcp` (Streamable HTTP connector; see below)

Dashboard OAuth for Gmail/Drive stays in Cursor MCP; this surface is the **VanOS cockpit API**.

## Auth

```http
Authorization: Bearer <AGENT_API_TOKEN>
```

Requires `AGENT_API_TOKEN` in production (distinct from `BOTS_INGEST_SECRET`).
Ingest secret only authorizes `/api/*/ingest` routes. Dev may fall back to
ingest secret; set `VANOS_ALLOW_INGEST_AS_AGENT=true` only as emergency legacy.

## REST

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/v1` | no | Discovery |
| GET | `/api/v1/health` | no | Liveness |
| GET | `/api/v1/snapshot` | yes | Full state |
| POST | `/api/v1/ingest` | yes | Unified write |
| POST | `/api/v1/dispatch` | yes | Grok Bot task |
| POST | `/api/mcp` | yes | Grok Bot MCP connector (Streamable HTTP) |
| POST | `/api/v1/sync` | yes | Daily digest sync |
| GET | `/api/v1/sync` | yes | Recent digests |
| GET/POST | `/api/v1/homeassistant` | yes | HA states / call service |
| GET/POST | `/api/v1/displayfusion` | yes | DF scripts / run on PC |
| GET | `/api/v1/github` | yes | Open PRs, latest commits, failing workflows |
| GET | `/api/v1/notion` | yes | Open Notion rows (read-only) |
| GET | `/api/v1/obsidian` | yes | Recent notes, or `?q=` search |
| GET | `/api/setup` | no* | Wire checklist (*optional basic auth) |

See **AGENT-SYNC.md** for durable store, digest cron, and Setup panel.

### Ingest

```bash
curl -X POST "$HOST/api/v1/ingest" \
  -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "bots",
    "botId": "muddy",
    "status": "ok",
    "summary": "Standup done"
  }'
```

`domain`: `bots` | `costs` | `money` | `connections` | `board`  
(plus the same fields as the domain-specific ingest routes)

### Overview sections (`domain: "board"`)

Outside the public demo, Mission Control shows no sample data. The Overview sections that have no integration of their own stay empty ("No content reported yet") until an agent sends them:

```json
{
  "domain": "board",
  "reportedBy": "muddy",
  "agents": [{ "id": "gary", "status": "ok", "focus": "Blog post draft" }],
  "crons": [{ "id": "security-scan", "name": "Security scan", "agent": "Shield", "schedule": "06:00 daily", "status": "ok", "lastRun": "2026-10-17T06:00:00Z" }],
  "content": [{ "id": "post-12", "title": "Launch post", "channel": "blog", "owner": "Quill", "stage": "draft", "due": "Fri" }],
  "social": [{ "id": "x-3", "platform": "x", "status": "needs-approval", "preview": "…", "when": "Tomorrow 09:00" }],
  "income": [{ "id": "saas", "name": "VanOS AI Support", "type": "saas", "mrr": 49, "currency": "USD", "status": "ok", "nextAction": "First paying seat" }],
  "life": [{ "id": "l1", "area": "health", "title": "Run 3x this week", "priority": "now" }],
  "kpis": [{ "id": "mau", "label": "MAU", "value": "12", "target": "100", "trend": "up" }],
  "schedule": [{ "time": "09:30", "title": "Exec standup", "owner": "Muddy" }],
  "system": { "uptime": "12 d", "memory": "61%", "disk": "Healthy", "cpu": "Low", "gateway": "ok" },
  "vanlifeProgress": 14
}
```

- Send any subset; at least one section is required. Unknown fields are `400`.
- Each list replaces that section (send the full current list). `agents` updates the roster by `id`; `lastActive` (ISO) defaults to now. An `id` that is not on the roster is added.
- Invalid rows in a list are skipped. Lists hold at most 100 rows (KPIs 20, schedule 50). `schedule` times are UTC (`"06:00"` or `"Mon 08:00"`) and shown in the viewer's local time.
- The MRR tile is the sum of `income` (converted to USD). The vanlife bar is hidden until `vanlifeProgress` (0–100) is sent.
- A daily digest can carry it too: `POST /api/v1/sync` with `"domains": { "board": { … } }`.
- A paste-ready instruction for Muddy (daily report plus status updates) is in `BOARD-PROMPT.md`.
- Money, connections and costs also start empty outside the demo (cost lines keep their built-in estimates, marked `estimate`).

### Money rows changed from the dashboard

The Money panel has one-tap buttons: **Mark paid** on unpaid bills, **Mark cancelled** on subscriptions (a button on trial and cancel-soon rows, a quiet "Cancel…" link on the rest), **Mark sold** and then **Mark paid** on items for sale. They post to `POST /api/money/action` (dashboard route: Basic auth or session, same-origin JSON, or `AGENT_API_TOKEN`; private only, closed on the edge, refused in demo mode):

```json
{ "kind": "everyday", "id": "ev-rent", "action": "mark-paid" }
```

| `kind` | `action` | Effect on the row |
|--------|----------|-------------------|
| `subscription` | `cancel` | `status: "cancelled"`, `cancelledAt` |
| `everyday` (bills only) | `mark-paid` | `paid: true`, `paidAt` |
| `sell` | `sold` | `stage: "sold"`, `soldAt` (date) if missing |
| `sell` | `mark-paid` | `stage: "paid"`, `paidAt`, `soldAt` if missing |
| any | `undo` | Puts back the fields the last dashboard change replaced and removes `dashboardChange` (one step; `400` if the row has none) |

Each changed row also gets `dashboardChange: { action, at, before }`; `before` holds the previous values so the panel's **Undo** can restore them. Keep `before` if you send the row back. Body max 2KB, unknown fields rejected. `400` for an action that does not fit the kind or row (marking an income row paid), `404` for an unknown id, `503` if storage is down. Repeating an action answers `200` with `changed: false`. Cancelled subscriptions no longer count toward the monthly total, and paid bills no longer count as due.

**Your next money ingest** (`/api/money/ingest`, `domain: "money"`, or sync) replaces rows by id as before, but a dashboard change survives a row that would undo it:

- a cancelled subscription stays `cancelled`;
- a paid bill stays paid while its `due` is unchanged; a row with a new `due` is a new billing cycle and is taken as sent;
- a sale never moves back to an earlier stage (or to `dead`); a later stage such as `shipped` after `sold` is taken.

Other fields (amount, note, dates) update normally. To override a dashboard change on purpose, send the row with `"dashboardChange": null`; the row is then stored exactly as sent. `replace: true` follows the same rules for the rows it sends; rows it leaves out are gone, as before.

### Currencies and exchange rates

Money rows carry their own `currency` (`SEK`, `USD` or `EUR`). Totals are computed in SEK, cost lines are in USD, and each viewer picks the display currency (SEK by default) in the header or the phone menu; every amount is converted for display.

Conversion uses kronor per unit: `usdToSek` and `eurToSek`. Send them with a money ingest to keep them current, alone or with rows:

```json
{ "reportedBy": "warren", "usdToSek": 10.42, "eurToSek": 11.31 }
```

Mission Control also fetches Riksbanken's daily mid rates itself (SWEA series `SEKUSDPMI` and `SEKEURPMI`, stored and refreshed about twice a day, off in the demo and with `MONEY_FX_AUTO=off`; see `INTEGRATIONS.md`). Each currency picks its rate on its own:

1. `MONEY_USD_SEK_RATE` / `MONEY_EUR_SEK_RATE` in env always win.
2. Otherwise the newer of your rate and Riksbanken's. Your rate counts from the time you sent it; Riksbanken's from the end of its day (UTC). So a rate you send the day after Riksbanken's latest day wins until Riksbanken publishes again, and one sent the same day or earlier loses. Rates sent before this rule existed carry no time and lose to Riksbanken.
3. Otherwise the built-in defaults (10.5 and 11.5).

`GET /api/money` and the dashboard data return the rates in use: `usdToSek`, `eurToSek`, `fxSource` (`env`, `agent`, `riksbank` or `default`), `riksbankDate` (the day of Riksbanken's rates, when one is used), and `fxSources: { usd, eur }` when the two come from different places (`fxSource` is then the first of env, agent, riksbank, default). The Money panel shows the same, e.g. "from Riksbanken, 2026-10-16".

### Dispatch

```bash
curl -X POST "$HOST/api/v1/dispatch" \
  -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"botId":"muddy","task":"Triage alerts and heartbeat back"}'
```

## MCP for Grok Bot (`POST /api/mcp`)

Hosted in this app so a cloud Bot can reach it. Stateless Streamable HTTP. Auth is the agent token, compared in constant time (`authorizeAgent`):

```http
POST /api/mcp
Authorization: Bearer $AGENT_API_TOKEN
Accept: application/json, text/event-stream
Content-Type: application/json
```

Tell the Bot: add a custom MCP server named `vanos` at `https://<your-public-host>/api/mcp` with that header. Do not commit a real token.

The dashboard stays behind Tailscale (or basic auth in hybrid mode). `/api/mcp` is on the public bearer edge with ingest: no Tailscale required, no token means 401. Body max 64KB. Per-IP rate limit is `VANOS_RATE_LIMIT_PER_MIN` (default 60).

### Limits and errors on write routes

- Bodies over 64KB (256KB for `/api/v1/sync`, 32KB for a bot event) get `413` before parsing.
- Fields are validated. Invalid rows inside a list (a cost line, a money row, a repo) are skipped; a wrong-typed field elsewhere, such as `budget.dailyUsd: "lots"`, is `400`.
- `domain: "bots"` on `/api/v1/ingest`, and the `bots` domain of `/api/v1/sync`, use the same rules as `POST /api/bots/ingest`: unknown fields are rejected and each bot is limited to 30 events a minute.
- `503` with `Retry-After` means storage was unreachable and nothing was saved. Retry.
- A dispatch (`/api/v1/dispatch`, `/api/bots/dispatch`, MCP `vanos_create_dispatch`) tells the bot to call back to `/api/bots/ingest` with `BOTS_INGEST_SECRET`, on `VANOS_PUBLIC_INGEST_URL` when set.

| Tool | Access |
|------|--------|
| `vanos_list_agents` | Read |
| `vanos_agent_status` | Read |
| `vanos_get_costs` | Read |
| `vanos_recent_bot_events` | Read |
| `vanos_get_connections` | Read |
| `vanos_create_dispatch` | Create — `POST /api/v1/dispatch` |
| `vanos_post_bot_event` | Create — same event schema as `/api/bots/ingest` |

These tools do not delete, and they do not call Home Assistant or DisplayFusion. `vanos_post_bot_event` writes through the bot-event store (the caller uses `AGENT_API_TOKEN`, not `BOTS_INGEST_SECRET`).

## MCP stdio (Cursor / Hermes)

From `ai-support/`:

```bash
export VANOS_API_BASE=http://127.0.0.1:3000
export AGENT_API_TOKEN=your-secret
npm run mcp
```

### Cursor `mcp.json`

```json
{
  "mcpServers": {
    "vanos": {
      "command": "npx",
      "args": ["tsx", "mcp/server.ts"],
      "cwd": "/absolute/path/to/VanOS/ai-support",
      "env": {
        "VANOS_API_BASE": "http://127.0.0.1:3000",
        "AGENT_API_TOKEN": "your-secret"
      }
    }
  }
}
```

Copy `mcp/mcp.json.example` and fill paths/secrets.

### stdio tools

Local stdio exposes a wider set than the Grok connector (including Home Assistant and DisplayFusion). Prefer `/api/mcp` for cloud Bots.

| Tool | What it does |
|------|----------------|
| `vanos_health` | API health |
| `vanos_snapshot` | Full cockpit snapshot |
| `vanos_get_costs` | Costs only |
| `vanos_get_money` | Money only |
| `vanos_get_connections` | Connections only |
| `vanos_ingest` | Unified write (`domain` + `payload`) |
| `vanos_bot_heartbeat` | Quick bots status update |
| `vanos_dispatch` | Send task to Grok Bot webhook |
| `vanos_sync_digest` | Daily digest sync |
| `vanos_setup_status` | Wire checklist (no secrets) |
| `vanos_ha_states` / `vanos_ha_call` | Home Assistant |
| `vanos_df_list` / `vanos_df_run` | DisplayFusion on Windows PC |

## OpenClaw / Hermes

- **OpenClaw:** cron or agent skill that `curl`s `/api/v1/ingest` after work
- **Hermes:** add VanOS MCP via `mcp_servers` / `hermes` config pointing at `npm run mcp`, or HTTP tools against REST
- **n8n:** HTTP Request nodes → `/api/v1/*`

## Security

- Never commit tokens
- Prefer a dedicated `AGENT_API_TOKEN` (not your Grok webhook keys)
- Keep the dashboard on Tailscale. MCP (`/api/mcp`) and ingest are the public edge, and only with bearer tokens
- Access modes, Tailscale, Vercel/VPS topology: **SECURITY.md**
- Health/discovery are sparse for anonymous callers; full detail needs Bearer or Tailscale/edge
