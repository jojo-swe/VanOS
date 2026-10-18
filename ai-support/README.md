# VanOS Mission Control (`ai-support`)

Next.js App Router app for the VanOS life/ops dashboard.

| Route | What |
|-------|------|
| `/dashboard` | Mission Control UI |
| `/support` | Support chat shell (AI backend not wired yet) |
| `/api/v1/*` | Agent API — Bearer `AGENT_API_TOKEN` |
| `/api/mcp` | Grok Bot MCP connector (Streamable HTTP, same token) |
| `/api/bots/*` | Grok dispatch/ingest bridge |
| `/api/costs`, `/money`, `/connections` | Domain snapshots + ingest |
| `/api/homeassistant`, `/api/displayfusion` | Home / PC controls |
| `/api/github`, `/api/notion`, `/api/obsidian` | Read-only integrations (off until env is set) |

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard).

## Demo mode

Set `VANOS_DEMO_MODE=true` (that exact string) to serve the public sample. Sign-in and TOTP are skipped, panels use seeded sample data, and write/ingest routes return 403. A Demo banner is shown with no repository link unless `VANOS_DEMO_REPO_URL` is an http(s) URL. Leave the variable unset for a real host. Vercel setup, including the owner step to turn off Deployment Protection, is in the root [README](../README.md#public-demo-on-vercel).

## Appearance

Mission Control follows the operating system color scheme (`prefers-color-scheme`) until you choose otherwise. The header control (from the `md` breakpoint up) and the phone section menu offer **Light**, **Dark**, and **System**. The choice is stored in `localStorage` under `vanos-theme` and applied to the whole app, including `/` and `/support`.

A blocking script in the document head sets `data-theme` before first paint, so a saved choice does not flash the other palette. With JavaScript disabled, or with no saved choice, the page stays on System.

Colors are the existing CSS variables (`--bg`, `--ink`, `--muted-fg`, `--accent`, and the status pairs). Dark mode swaps those tokens; layout, type, and the phone drawer do not change. The Integrations panel uses the same tokens for headings, borders, status text, search fields, and buttons. Body text, muted labels, status chips, and danger text meet WCAG AA (4.5:1) on the background, surface, and panel in both themes. The light copper wordmark (`#c45c26` on `#eef3f1`, about 3.8:1) is unchanged and is only used at display size. `npm test` includes `src/lib/theme/contrast.test.ts`, which fails if a token drops under those ratios.

Grok Bots report into Mission Control with `POST /api/bots/ingest` (`Authorization: Bearer $BOTS_INGEST_SECRET`). The body is an event: `botId` or `botName`, `type` (`status` | `result` | `error`), `title`, `body`, plus optional `links`, `metadata`, `timestamp`, and an idempotency key. The Grok Bots view lists the latest event per bot. Paste-ready curl: [GROK-PROMPT.md](./GROK-PROMPT.md).

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local dev server |
| `npm run build` / `start` | Production |
| `npm run lint` | ESLint |
| `npm test` | Route tests, including GitHub, Notion, and Obsidian with mocked APIs |
| `npm run smoke:security` | Auth / middleware smoke checks |
| `npm run mcp` | Local stdio MCP server (Cursor / Hermes on this machine) |

## Docs

| File | Topic |
|------|--------|
| [../README.md](../README.md) | Repo overview, setup, deployment |
| [DEPLOY.md](./DEPLOY.md) | Vercel notes |
| [SECURITY.md](./SECURITY.md) | Access modes, Tailscale, tokens |
| [GROK-PROMPT.md](./GROK-PROMPT.md) | Paste-ready Grok Bot prompt |
| [GROK-BOTS.md](./GROK-BOTS.md) | Dispatch / ingest bridge |
| [../CHANGELOG.md](../CHANGELOG.md) | Notable app changes |
| [AGENT-API.md](./AGENT-API.md) | REST + MCP |
| [AGENT-SYNC.md](./AGENT-SYNC.md) | Daily digest + durable store |
| [HOME-LAB.md](./HOME-LAB.md) | Home Assistant + DisplayFusion |
| [INTEGRATIONS.md](./INTEGRATIONS.md) | GitHub, Notion, Obsidian |
| [MONEY.md](./MONEY.md) / [CONNECTIONS.md](./CONNECTIONS.md) | Domain ingest |

Root deployment and env tables live in the [repo README](../README.md#deployment).

## Grok Bot connector

Grok Bot runs in Cursor's cloud, so it can only attach a **public HTTPS** MCP server. The stdio process (`npm run mcp`, `mcp/server.ts`) is for a local Cursor or Hermes session on your machine. The connector lives at `POST /api/mcp` inside this Next.js app instead of a second package: one deploy, the same `AGENT_API_TOKEN` check as `/api/v1/*`, and the same public bearer edge as ingest.

The route speaks stateless [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) (JSON responses, no session). `GET` and `DELETE` return 405.

### Add the connector

In a Grok Bot chat, ask it to add the server. Keep the token as the placeholder below in anything you paste into git or a transcript. When the Bot asks for the header value, give it the real `AGENT_API_TOKEN` from the server env only.

| Setting | Value |
|---------|--------|
| Name | `vanos` |
| URL | `https://<your-public-host>/api/mcp` |
| Header | `Authorization: Bearer $AGENT_API_TOKEN` |

```text
Add a custom MCP server named vanos at https://<your-public-host>/api/mcp.
Header name: Authorization
Header value: Bearer $AGENT_API_TOKEN
```

The private dashboard (`/dashboard` and the other UI routes) stays behind Tailscale in `private` mode, or behind basic auth in `hybrid`. `/api/mcp` and the ingest routes are the public edge: reachable without Tailscale, rejected without the bearer token. In `private` mode, `VANOS_PUBLIC_INGEST=false` closes that edge as well.

### Tools

| Tool | Access |
|------|--------|
| `vanos_list_agents` | Read agents and Grok Bot targets (no webhook URLs) |
| `vanos_agent_status` | Read one agent's status and latest event |
| `vanos_get_costs` | Read the costs snapshot |
| `vanos_recent_bot_events` | Read recent bot events |
| `vanos_get_connections` | Read the connections snapshot |
| `vanos_create_dispatch` | Create a task (`POST /api/v1/dispatch`) |
| `vanos_post_bot_event` | Create a bot event (same fields as `/api/bots/ingest`) |

No delete, overwrite, Home Assistant, or DisplayFusion tool is registered.

Limits: request body 64KB, `VANOS_RATE_LIMIT_PER_MIN` per IP (default 60). Posting a bot event also uses the ingest cap of 30/minute for that bot.
