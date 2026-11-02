# AGENTS.md — Mission Control (`ai-support/`)

Instructions for coding agents (Claude Code, Codex, Cursor, Copilot, …) working on the Mission Control app. The `AGENTS.md` at the repo root is something else: it is the OpenClaw main agent's startup file. Do not edit it for coding guidance.

## What this is

Mission Control is the dashboard and agent API for Jojo's AI org. Next.js 16 (App Router) / React 19 / TypeScript / Tailwind v4, one Node process.

- **Production:** one VPS, `VANOS_ACCESS_MODE=private`. Tailscale Serve (port 443) for the dashboard, Tailscale Funnel (port 8443) for `/api/bots/ingest`, `/api/mcp` and `/api/v1/health` only.
- **Vercel:** the public demo only (`VANOS_DEMO_MODE=true`: sample data, every write refused, no secrets).
- Details: `../docs/DEPLOYMENT.md`, `SECURITY.md`.

## Commands

Run from `ai-support/`:

```bash
npm ci
npm run dev             # localhost:3000
npm run lint
npm run typecheck
npm test                # explicit file list in package.json
npm run build
npm run check:edge      # after build: edge-mode 404 checks
npm run smoke:security  # proxy/auth smoke checks
```

Before you push, run all of them. CI (`.github/workflows/`) runs lint, tests, build, the edge check, the security smoke test, and a gitleaks scan on every PR.

- `npm test` runs only the files listed in the `test` script in `package.json`. **Add every new `*.test.ts` there**, or it never runs.
- Tests read real env vars. If a GitHub test fails locally, unset `GITHUB_TOKEN` / `GH_TOKEN`.
- The `test` script sets `MONEY_FX_AUTO=off` so no test reaches Riksbanken; `currency/riksbank.test.ts` turns it back on with a fake fetch.
- Fonts are vendored in `src/app/fonts/` and loaded with `next/font/local`. Do not switch back to `next/font/google`: the build must not need the network.
- Stale `.next/types` can break `tsc` after switching branches: `rm -rf .next`.

## Map

| Path | What |
|------|------|
| `src/proxy.ts` | The access gate (Next 16's name for middleware). Access modes, Basic auth, TOTP, session cookie, rate limits. **Async**: tests must `await proxy(req)`. |
| `src/lib/security/` | Auth pieces: `paths.ts` (which paths are public, private, or open on the edge), `dashboard-auth.ts`, `csrf.ts`, `session.ts`, `session-generation.ts` (durable value logout rotates to revoke every cookie), `totp.ts`, `rate-limit.ts`, `access-log.ts`. |
| `src/app/api/v1/*` | Agent API, `Authorization: Bearer $AGENT_API_TOKEN`. |
| `src/app/api/bots/ingest` | Bot reports, `Bearer $BOTS_INGEST_SECRET`. |
| `src/app/api/mcp` | Grok MCP connector (`src/lib/mcp/`). Read tools plus two creates; never add a destructive tool. |
| `src/app/api/<x>` (no `v1`) | Dashboard routes, Basic auth or session. |
| `src/lib/durable/` | Storage: JSON files in `.data/bots` or Upstash. |
| `src/lib/http/` | `readJsonObject` (body caps) and shared zod helpers. |
| `src/lib/<domain>/` | One folder per domain: `bots`, `costs`, `money`, `connections`, `sync`, `homeassistant`, `displayfusion`, `github`, `notion`, `obsidian`, `slack`. |
| `src/lib/demo/` | Demo mode and sample data. |
| `src/components/dashboard/` | Client panels. |
| `bridges/displayfusion/` | Windows PowerShell bridge that runs on Jojo's PC. |
| `mcp/server.ts` | Local stdio MCP server (operator use, not exposed). |

## How to build things here

**Write routes**, in this order:

1. Read the body with `readJsonObject(req, maxBytes)`, never `req.json()`.
2. Validate with a zod schema (see `costs/parse-ingest.ts`, `src/lib/http/schema.ts`). Invalid rows in a list are skipped with `validItems`; a wrong-typed single field is a `400`.
3. Store with `durableUpdateJson(key, update)`. Never read, change and `durableSetJson` in two steps: concurrent writes would lose data. `update` may run more than once, so keep it free of side effects.
4. Wrap the handler in `withDurableErrors` so a failed write answers `503`, not `ok: true`. A log of something that already happened (an HA call, a DisplayFusion run) uses `bestEffortWrite` instead.
5. Filter stored data on read too (`keepValid`), so an old malformed row cannot break a panel.

**Bot events** go through `acceptBotIngest` (`src/lib/bots/accept.ts`), and **dispatches** go through `dispatchToBot` (`src/lib/bots/dispatch.ts`). Do not write a second path.

**Integrations** (GitHub, Notion, Slack…) follow one pattern: `config.ts` (env, off until set), `client.ts` (`timedFetch` with `allowHosts`, a timeout, and the token in `secrets`), `snapshot.ts` (demo sample, then cache via `integrations/cache.ts`), a dashboard route plus a `/api/v1` route, a section in `IntegrationsPanel.tsx`, and a row in `sync/setup.ts`. New paths must be added to the lists in `src/lib/security/paths.ts`.

**Outbound notifications** (Slack) never block or throw: use `notifyInBackground`, and escape all bot text.

## Security rules

These are not optional. The app controls Home Assistant and a Windows PC.

- **Fail closed.** Missing config means 401, 503 or "off", never open. Unknown paths are private.
- **Keep tokens separate.** `AGENT_API_TOKEN`, `BOTS_INGEST_SECRET`, the DisplayFusion bridge secret and the dashboard password do different things. Do not let one stand in for another.
- **Browser mutations** go through `guardBasicAuthMutation` (JSON plus same-origin). `X-VanOS-Edge` is a network signal, not a credential.
- **Allowlists for actions:** Home Assistant `HA_ALLOWED_SERVICES`, the DisplayFusion catalog plus `parseDfArgs`. Never pass caller input straight to a device.
- **Outbound fetches** use `timedFetch` with an `allowHosts` list and the secrets to scrub. No user-controlled URLs.
- **Never log or return tokens.** Never commit `.env*` files; `.env.example` holds placeholders only.
- **Demo mode** must stay read-only with sample data. Check `isDemoMode()` in new stores and routes.

## Docs and changelog

- **Changelog:** add a line under `## Unreleased` in `../CHANGELOG.md` for any change a user or agent would notice.
- **Docs:** update the doc that describes the surface you changed: `AGENT-API.md`, `INTEGRATIONS.md`, `SECURITY.md`, `HOME-LAB.md`, `../docs/DEPLOYMENT.md`, and `.env.example` for new env vars.
- **Language:** Jojo writes in Swedish. Code, comments, docs and commit messages stay in English.
