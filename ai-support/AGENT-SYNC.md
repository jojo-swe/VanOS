# VanOS Agent Sync + Durable Store

Mission Control keeps state across requests via a **durable store**, and agents keep that state fresh with a **daily digest** (`POST /api/v1/sync`).

## Durable store

All overlays (bots bridge, costs, money, connections, sync digests) go through `src/lib/durable/store.ts`.

| Backend | When | Notes |
|---------|------|--------|
| **Upstash Redis REST** | `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` set | Required on Vercel: without it, writes answer `503` because the filesystem is read-only |
| **memory + file** | Default | File under `BOTS_DATA_DIR` / `.data/bots`; memory cache for the instance |

Optional: `VANOS_STORE_PREFIX` (default `vanos`) namespaces Redis keys.

Keys: `bridge-state`, `cost-overlay`, `money-overlay`, `connections-overlay`, `sync-state`.

## AGENT_API_TOKEN

```bash
AGENT_API_TOKEN=long-random-secret
```

Used by `/api/v1/*` and the MCP server. Falls back to `BOTS_INGEST_SECRET` if unset.

Prefer a dedicated token (not Grok webhook keys).

## Daily digest

### Endpoint

```http
POST /api/v1/sync
Authorization: Bearer <AGENT_API_TOKEN>
Content-Type: application/json
```

```json
{
  "source": "n8n",
  "period": "daily",
  "summary": "Morning rollup — costs + mail ok",
  "domains": {
    "bots": { "botId": "muddy", "status": "ok", "summary": "Standup done" },
    "costs": {
      "lines": [
        { "name": "Anthropic", "provider": "anthropic", "category": "llm", "amountUsd": 0.4, "period": "day" }
      ]
    }
  }
}
```

`source`: `n8n` | `grok` | `openclaw` | `hermes` | `manual` | `cron`

If `source` is `grok` or `n8n` and `domains.bots` is omitted, a Mission/Muddy heartbeat is written automatically.

`GET /api/v1/sync` returns recent digests (auth required).

### Cron (n8n / crontab / OpenClaw)

```bash
0 7 * * * curl -sS -X POST "$HOST/api/v1/sync" \
  -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"n8n","period":"daily","summary":"Morning digest"}'
```

### MCP

- `vanos_sync_digest` — post digest
- `vanos_setup_status` — wire checklist

## Setup panel

Dashboard → **Setup** (or `GET /api/setup`) shows:

- AGENT_API_TOKEN / ingest secret
- Durable backend + ping
- Grok Bot webhook count
- Last digest age
- Optional dashboard basic auth

No secrets are returned.

## Dashboard basic auth

```bash
DASHBOARD_BASIC_USER=jojo
DASHBOARD_BASIC_PASSWORD=…
```

Required in `hybrid` / `private` access modes. Gates UI + read APIs. Does **not** gate ingest/dispatch (Bearer-only). See **SECURITY.md**.

## Wire order

1. Set `VANOS_ACCESS_MODE` (`hybrid` on Vercel, `private` on Tailscale VPS)
2. Set `AGENT_API_TOKEN` + `DASHBOARD_BASIC_*` on the host
3. Add Upstash REST credentials for multi-instance durability
4. Schedule daily `POST /api/v1/sync` from n8n or OpenClaw
5. Confirm green checks under Setup (incl. Tailscale/edge + last Grok ingest)
