# Grok Bot ↔ Mission Control bridge

Cursor **Grok Bot** has no public chat API. Mission Control talks to it through
**routine webhooks** (dashboard → Bot) and **ingest callbacks** (Bot → dashboard).

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/bots/dispatch` | Send a task (dashboard basic auth / agent token; not public) |
| `POST` | `/api/v1/dispatch` | Same for agents on the public edge (`AGENT_API_TOKEN`) |
| `POST` | `/api/bots/ingest` | Bot reports status (Bearer `BOTS_INGEST_SECRET`) |
| `GET`  | `/api/bots/status` | Targets, recent dispatches/ingests, setup prompt |
| `GET`  | `/api/dashboard` | Snapshot with live Bot overlays merged in |

A full disk does not turn that snapshot into a 500. When a local write fails, the route still returns the latest readable data with `degraded: true` and `reason` set to the error code (`ENOSPC`, `EDQUOT`, `EROFS`, `EACCES`, or another write errno). If nothing can be served, it answers `503` `{ "status": "degraded", "reason" }`.

## Setup (5 minutes)

1. Open Grok Bot → create a Bot (e.g. **Muddy**).
2. Paste the full brief from [`GROK-PROMPT.md`](./GROK-PROMPT.md) into the Bot (fill `<<…>>` placeholders), **or** use Mission Control → **Grok Bots** → **Copy routine prompt** for the short routine version.
3. Open the routine → copy **POST to** URL and **key**.
4. Copy `.env.example` → `.env.local` and fill:
   - `BOTS_INGEST_SECRET`
   - `GROK_BOT_MUDDY_WEBHOOK_URL` / `GROK_BOT_MUDDY_WEBHOOK_KEY`  
     (or `GROK_BOT_DEFAULT_WEBHOOK_*`)
5. Restart `npm run dev`. Tell the Bot your public ingest URL  
   (`https://<host>/api/bots/ingest`) and the ingest secret.
6. Dispatch a task from the **Grok Bots** panel. When the Bot finishes, it should
   POST ingest JSON; Overview / Agents update within ~20s.

## Ingest body

Event report (preferred):

```json
{
  "botId": "muddy",
  "botName": "Muddy",
  "type": "result",
  "title": "one-line result",
  "body": "what you did",
  "timestamp": "2026-10-16T10:00:00Z",
  "dispatchId": "dsp_…",
  "links": [{ "label": "Dashboard", "url": "https://example.com/dashboard" }],
  "metadata": { "source": "routine" }
}
```

- `type`: `status` | `result` | `error`
- `botId` or `botName` is required (a name alone is slugged into an id)
- Optional `Idempotency-Key` header (or `idempotencyKey`) replays the same event
- Unknown fields are rejected. Body max 32KB. 30 requests/minute per bot.
- Legacy heartbeats (`status`, `summary`, `focus`, `alerts`) are still accepted if you do not send event fields.

Auth: `Authorization: Bearer $BOTS_INGEST_SECRET`.

```bash
curl -sS -X POST "$PUBLIC_INGEST_BASE/api/bots/ingest" \
  -H "Authorization: Bearer $BOTS_INGEST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"botId":"muddy","botName":"Muddy","type":"status","title":"Morning triage","body":"No blockers."}'
```

Full paste-ready prompt: [`GROK-PROMPT.md`](./GROK-PROMPT.md).

## Costs (API / MCP)

Mission Control also tracks spend under **Costs**:

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/costs` | Snapshot: lines, series, budgets, by-category |
| `POST` | `/api/costs/ingest` | Upsert live spend (same Bearer secret) |

Ask a Grok Bot routine to pull OpenRouter / Cursor usage and POST lines with
`category: "llm" | "mcp" | "infra" | "saas" | "other"`.

Assistants that should call Mission Control themselves (list agents, read costs, dispatch, post an event) attach the MCP connector at `https://<public-host>/api/mcp` with `Authorization: Bearer $AGENT_API_TOKEN`. That token is not the ingest secret. Setup: [README.md](./README.md#grok-bot-connector).

## Notes

- Webhook HTTP **200** = run *started*, not finished ([Routines docs](https://cursor.com/help/grok-bot/routines)).
- Bridge state persists under `.data/bots/` locally; on Vercel use a durable store later (KV/DB) if you need multi-instance consistency.
- Never commit real webhook keys or ingest secrets.
