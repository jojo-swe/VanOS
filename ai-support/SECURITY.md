# VanOS Mission Control — Security & Access

Goal: **only Jojo** reaches the UI (via Tailscale). Agents (Grok, n8n, OpenClaw) write through a narrow Bearer surface. SSL is handled by the platform — do not manage long-lived cert files by hand.

## Access modes (`VANOS_ACCESS_MODE`)

| Mode | UI | Agent ingest and `/api/mcp` | Best for |
|------|----|--------------|----------|
| **edge** | Not served (404) | Only `POST /api/bots/ingest`, `POST /api/mcp`, and `GET /api/v1/health` | **Vercel** public edge |
| **private** | Basic auth, plus Tailscale allowlist, `X-VanOS-Edge`, and/or CGNAT `100.64.0.0/10` when that check is enabled | Closed unless the caller is on that private network, or `VANOS_PUBLIC_INGEST=true` | **VPS** + Tailscale Serve |
| **hybrid** (prod default if unset) | Basic auth **required** (fail closed) | Wider public bearer surface | Existing hosts. Prefer `edge` on Vercel |
| **public** | Basic auth optional | Bearer | Local `next dev` only |

Unset mode → `public` in development, `hybrid` in production. Set the two production hosts explicitly: `edge` on Vercel, `private` on the VPS. Commands and placeholders: [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).

## Recommended topology (your stack)

```
You (phone/laptop)
    │  Tailscale
    ▼
your VPS
  VANOS_ACCESS_MODE=private
  tailscale serve → :3000
  DASHBOARD_BASIC_* + VANOS_EDGE_SECRET / allowlist
    │
    │  (same Upstash)
    ▼
Vercel (public edge — no dashboard)
  VANOS_ACCESS_MODE=edge
  AGENT_API_TOKEN, BOTS_INGEST_SECRET   # distinct, each ≥ 32 chars
  UPSTASH_REDIS_REST_*
    ▲
    │  HTTPS + Bearer
Grok Bot / n8n (your n8n host) / OpenClaw
```

- **Primary UI:** Tailscale Serve URL (`https://<host>.<tailnet>.ts.net`) — not Vercel. Leave `/dashboard` on that private URL.
- **Public edge:** Vercel HTTPS with `VANOS_ACCESS_MODE=edge`. Ingest uses `BOTS_INGEST_SECRET`. The Grok connector at `https://<app>/api/mcp` uses `Authorization: Bearer $AGENT_API_TOKEN`. Grok cannot join your tailnet. Do not put the dashboard on this host.
- **SSL:** Vercel certs + Tailscale HTTPS certs. On bare VPS without Tailscale for public ports, use Caddy/Let’s Encrypt only for the Funnel alternative.

## Env checklist

```bash
# Mode
VANOS_ACCESS_MODE=private          # VPS
# VANOS_ACCESS_MODE=edge           # Vercel

# UI lock (required in hybrid/private; also required on an edge dashboard when set)
DASHBOARD_BASIC_USER=<dashboard-user>
DASHBOARD_BASIC_PASSWORD=<long-random>   # at least 32 characters when set; under 32 logs config_ok=false reason short_password (warning only, process stays up)

# Tailscale / reverse-proxy gate (private VPS only)
VANOS_ALLOWED_TAILSCALE_USERS=<tailscale-login>
VANOS_EDGE_SECRET=<long-random>    # proxy injects X-VanOS-Edge
# VANOS_TRUST_TAILSCALE_CGNAT=true # VPS only. Never on Vercel.
VANOS_PRIVATE_APP_URL=https://<host>.<tailnet>.ts.net
VANOS_PUBLIC_INGEST_URL=https://<project>.vercel.app
# VANOS_PUBLIC_INGEST=false        # private default. Leave false; Grok uses the edge host.
VANOS_ALLOWED_HOSTS=<host>.<tailnet>.ts.net,<project>.vercel.app

# Tokens (separate values, each at least 32 characters — startup refuses otherwise)
AGENT_API_TOKEN=<long-random>                  # MCP and /api/v1
BOTS_INGEST_SECRET=<different-long-random>     # POST /api/bots/ingest only
# AGENT_API_TOKEN_PREVIOUS=<old-agent-token>   # accept during rotation, then remove
# BOTS_INGEST_SECRET_PREVIOUS=<old-ingest-secret>
# VANOS_ALLOW_INGEST_AS_AGENT=true             # emergency legacy only — avoid on public edges

# Durable
UPSTASH_REDIS_REST_URL=…
UPSTASH_REDIS_REST_TOKEN=…

# Optional
VANOS_RATE_LIMIT_PER_MIN=60
VANOS_REQUIRE_BASIC_AUTH=true
```

Generate secrets: `openssl rand -base64 32`

## Tailscale Serve (VPS)

```bash
# App binds localhost only
HOSTNAME=127.0.0.1 npm run start -- -p 3000

# HTTPS on your tailnet (Tailscale manages certs)
tailscale serve --bg https / http://127.0.0.1:3000
```

- Use **Serve**, not **Funnel**, for the UI.
- ACL: only your user/devices.
- Phone: Tailscale app → MagicDNS HTTPS URL → basic auth once (and TOTP, if set). The session cookie then skips both until it expires or you log out.

If Serve does not inject identity headers in your version, set a shared edge secret in the proxy:

```caddy
# Example: only reachable on tailnet interface; stamp edge header.
# Drop any client copy first, then set it on the upstream request.
request_header -X-VanOS-Edge
reverse_proxy 127.0.0.1:3000 {
	header_up X-VanOS-Edge {$VANOS_EDGE_SECRET}
}
```

## Vercel (public edge)

1. `VANOS_ACCESS_MODE=edge`
2. Set `AGENT_API_TOKEN` and `BOTS_INGEST_SECRET` to different values, each at least 32 characters, plus Upstash
3. Point Grok ingest at `https://<project>.vercel.app/api/bots/ingest` with `Authorization: Bearer $BOTS_INGEST_SECRET`. Point the Grok Bot MCP connector at `https://<project>.vercel.app/api/mcp` with `Authorization: Bearer $AGENT_API_TOKEN`
4. The dashboard is not on this host. Open the Tailscale URL
5. Do not set `VANOS_TRUST_TAILSCALE_CGNAT` here
6. Optional: `VANOS_ALLOWED_HOSTS=<project>.vercel.app`

## n8n

- Keep n8n on your n8n host; HTTP Request nodes → **Vercel** ingest URL + Bearer
- Or install Tailscale on your VPS and call the private Serve URL (no public ingest needed)

## What the proxy enforces

The gate is `src/proxy.ts` (`export function proxy`), next to `app/`. Next.js 16 still loads a deprecated `middleware.ts`, but a catch-all `routes` rewrite in the repo-root `vercel.json` is merged ahead of that proxy, so the page function renders the dashboard with status 200. Do not add one. `VANOS_ACCESS_MODE` is read with a static `process.env.VANOS_ACCESS_MODE` access so the proxy bundle keeps the value. Closed paths return `404` from the proxy before a page or route handler runs. Route handlers also return `404` before reading stores, and pages call `notFound()` from a nested layout or page — not the root layout, which can render a not-found fragment with status 200. `/`, `/dashboard`, and `/support` are `force-dynamic`, so they are not written into the static output.

- **Edge** (`VANOS_ACCESS_MODE=edge`): answers `/api/bots/ingest`, `/api/mcp`, and `/api/v1/health` only. Every other path, including `/`, `/dashboard`, and `/_next`, is 404. `VANOS_EDGE_DASHBOARD=true` also serves the dashboard pages, the APIs they fetch, and static assets. That flag is a route allowlist. The dashboard and its read APIs still require Basic auth or a valid session cookie; with `DASHBOARD_BASIC_*` unset they answer `503` instead of opening. Any other value leaves the strict 404 in place. Ingest and MCP are rate-limited per IP (`VANOS_RATE_LIMIT_PER_MIN`, default 60/minute) before the route checks the bearer token. On Vercel (`VERCEL=1`) the client IP comes from Vercel's own `X-Real-IP` / `X-Forwarded-For`, and with Upstash configured the counters are shared by every instance (`vanos:rl:*` keys, fixed one-minute windows). Without Upstash, or if it does not answer within 1.5s, each instance counts on its own. Health is rate-limited on its own bucket and stays sparse unless the agent token is presented.
- **Private UI** (`/`, `/support`, `/dashboard`, `/api/bots/dispatch`, read APIs, `/api/setup`): network gate (private, on by default) + basic auth or a valid session cookie (hybrid/private). The gate accepts an allowlisted `Tailscale-User-Login` only when `VANOS_TRUST_PROXY=true`, `X-VanOS-Edge`, or — only when `VANOS_TRUST_TAILSCALE_CGNAT=true` — a source address in `100.64.0.0/10`. Forwarded addresses count for CGNAT only when `VANOS_TRUST_PROXY=true`. A rejected Tailscale login does not fall through to CGNAT. Public ingest on this host defaults **off**. Failed basic-auth attempts share the same per-IP rate limit. The Basic user name and password are always both compared, in constant time over SHA-256 digests, so the response time does not reveal whether the user name was right or how long either value is.
- **Dashboard session** (`VANOS_SESSION_SECRET`, at least 32 characters, stable across restarts): after Basic auth succeeds, and after TOTP when that is configured, the proxy sets `vanos_session`. The cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, signed with HMAC-SHA256, and lives for `VANOS_SESSION_TTL_DAYS` (default 30, clamped to 1…365). `VANOS_SESSION_TTL_SECONDS` is not read. A valid cookie skips both the Basic challenge and TOTP on dashboard routes. It is bound to the current dashboard user, password, and TOTP secret; changing any of those, or the session secret, invalidates it. It also carries the current **session generation**, a random value kept in the durable store (`auth-session-generation`: Upstash, or `.data/bots/auth-session-generation.json`). The compares are constant time. The process does not generate a secret, so a boot-time random value cannot be used. Open the Tailscale Serve HTTPS URL so the browser will store the `Secure` cookie. The cookie does not authorize `/api/v1/*`, ingest, or MCP. If the secret is unset and TOTP is off, dashboard routes keep prompting for Basic auth.
- **Logout** (`GET` or `POST /api/auth/logout`) clears the cookie in that browser and, when the request is authenticated (a current session cookie or the Basic credential), stores a new session generation. That signs out **every** session, including a copied cookie, at once on this process (and within 10 seconds on any other instance sharing the store). An unauthenticated logout only clears the cookie, so nobody can sign the owner out without a credential. A cross-origin logout is rejected and changes nothing. If storage cannot be written, logout answers `503` (cookie still cleared in that browser) and logs `logout` with `revoked: false`; try again. The proxy caches the generation for 10 seconds. If storage stops answering, the last value read is used for up to 15 minutes; after that, or after a restart with storage still down, no cookie is accepted and none is issued: the dashboard asks for Basic auth on every request, and with TOTP on the code step answers `503` until storage is back. A missing or wiped generation document signs everyone out, and the next login writes a new one. A document that cannot be parsed is treated as an outage, and an authenticated logout rewrites it. Cookies from before this change (`v2`) are rejected once, so the browser logs in again after the upgrade.
- **Optional TOTP** (`VANOS_TOTP_SECRET`, base32): after basic auth succeeds, the dashboard asks for an RFC 6238 code (6 digits, 30 seconds, ±1 step) or a one-time recovery code. Success sets the session cookie and answers `303` with a relative `Location` (`/dashboard`, or a same-origin `next` path). That header is not resolved from the request URL, so a reverse-proxy bind address such as `https://0.0.0.0:3000` is not sent to the browser. `next` must start with a single `/`, must not start with `//`, and must not contain a scheme. Unset means this step does not exist; Basic auth alone issues the cookie when `VANOS_SESSION_SECRET` is set. Used codes and the attempt counter (`VANOS_TOTP_MAX_ATTEMPTS` per `VANOS_TOTP_ATTEMPT_WINDOW_SEC`) live in the durable store (Upstash, or `.data/bots/totp-replay.json` and `.data/bots/auth-attempts.json`), so a restart neither lets a code be replayed nor resets the counter. Codes are stored as an HMAC under the TOTP secret, never in the clear, and records expire with the ±1 step window. The process also keeps its own copy: a code it has seen is rejected even if storage fails, and if storage cannot be written the per-process record and counter alone apply (logged as `durable_write_failed`, label `totp-replay`). The proxy reads Basic from `Authorization` before TOTP, so a Bearer token in that header fails Basic auth and does not skip the code. Send Basic in `Authorization` and the agent token in `X-VanOS-Agent-Token` to skip TOTP without a browser session. `BOTS_INGEST_SECRET` does not. Bots should read status with `GET /api/v1/health` or `GET /api/v1/snapshot` and `Authorization: Bearer <AGENT_API_TOKEN>` (snapshot is not on the edge allowlist), and post reports with `POST /api/bots/ingest` and `Authorization: Bearer <BOTS_INGEST_SECRET>`. A `DASHBOARD_BASIC_PASSWORD` under 32 characters logs `config_ok: false` with `reason: "short_password"` (warning only; the process stays up). Setup and log lines: [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).
- **Hybrid bearer paths**: ingest/sync/`/api/v1/dispatch`/`/api/mcp`/HA/DF agent routes + DF bridge callbacks; rate-limited; route still checks Bearer or bridge secret. `/api/mcp` is the Grok connector (Streamable HTTP, 64KB body cap, `AGENT_API_TOKEN`). Per-bot ingest has a second limit inside `POST /api/bots/ingest`.
- **Health / discovery**: sparse JSON for anonymous; full inventory only with `AGENT_API_TOKEN`. Discovery (`/api/v1`) is not part of the edge surface.
- **Tailscale-User-Login**: ignored unless `VANOS_TRUST_PROXY=true`, and then only when `VANOS_ALLOWED_TAILSCALE_USERS` allowlists the login (empty allowlist = fail closed). Prefer `VANOS_EDGE_SECRET` on proxies. `X-VanOS-Edge` does not authorize DisplayFusion. DisplayFusion commands must match the script catalog.
- **Token split**: ingest secret cannot call Agent API / HA / DF / MCP; agent token cannot call ingest routes. Startup refuses if the two values are equal or either is shorter than 32 characters.
- **Public MCP tools**: the Grok connector registers read tools plus `vanos_create_dispatch` and `vanos_post_bot_event`. Every tool sets `destructiveHint: false`. There is no delete, drop, purge, or device-control tool on `/api/mcp`. Local stdio MCP (`npm run mcp`) is a separate operator process and is not mounted on the public edge.
- **Security headers**: CSP, frame deny, nosniff, referrer, COOP, CORP, Permissions-Policy, and HSTS when HTTPS
- **Host allowlist** when `VANOS_ALLOWED_HOSTS` is set

## Token separation and rotation

The process calls `assertTokenSeparation()` from `src/instrumentation.ts` when the server boots.

- `AGENT_API_TOKEN` and `BOTS_INGEST_SECRET` must differ.
- Each configured token, including `AGENT_API_TOKEN_PREVIOUS` and `BOTS_INGEST_SECRET_PREVIOUS`, must be at least 32 characters.
- A previous token must not equal the other role's current or previous token.
- Unset tokens do not crash startup; those routes return 503 until the env is set.
- The check prints the variable names only. It does not log secret values.

Rotation (one token at a time):

1. Generate the new value (`openssl rand -base64 32`).
2. Set `AGENT_API_TOKEN_PREVIOUS` (or `BOTS_INGEST_SECRET_PREVIOUS`) to the value that is live now.
3. Set the primary variable to the new value. Deploy Vercel and the VPS.
4. Update Grok, n8n, and local MCP to the new value. Both values work until you remove `*_PREVIOUS`.
5. Remove the `*_PREVIOUS` variable and deploy again.
6. Confirm Setup on the private dashboard is green, and that ingest still rejects the agent token.

## Secret scanning

`.github/workflows/secret-scan.yml` runs gitleaks on pull requests and on pushes to `main`. Do not commit `.env`, tokens, or Tailscale auth keys. Placeholders in docs use angle brackets, not live secrets.

## Backup / restore

| Data | Where | Restore |
|------|-------|---------|
| Overlays (bots, costs, money, connections, sync) | Upstash keys `vanos:*` or `.data/bots/*.json` | Re-set Upstash or copy JSON files |
| Auth state (`auth-session-generation`, `totp-replay`, `auth-attempts`) | Same store | Not needed. Losing it signs every browser out; the next login starts over |
| Agent personas | Live OpenClaw workspaces (local only) | Never committed; local tarballs |
| Env secrets | Vercel / VPS env — **not** in git | Password manager |

Export Upstash: use Redis `DUMP`/`RESTORE` or periodic JSON pull via a trusted cron with Bearer → snapshot.

## Do not

- Commit tokens or `.env`
- Set `AGENT_API_TOKEN` and `BOTS_INGEST_SECRET` to the same string, or use a short password as either
- Expose Funnel for the whole app, or serve the dashboard from the Vercel edge host
- Enable `VANOS_TRUST_TAILSCALE_CGNAT` on Vercel (clients can spoof forwarded addresses there)
- Rely on basic auth alone on a public Vercel UI as your only control
- Put `AGENT_API_TOKEN` in client-side JavaScript
- Trust bare `Tailscale-User-Login` on Vercel without an allowlist + edge secret
- Leave `VANOS_ALLOWED_TAILSCALE_USERS` empty in `private` mode and expect the login header to pass (the UI gate rejects it). Use the allowlist, `VANOS_EDGE_SECRET`, or CGNAT trust on the VPS
