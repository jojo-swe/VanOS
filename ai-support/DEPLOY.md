# Deploy notes

Mission Control runs on a VPS. Vercel only serves the public demo. Full setup and topology: [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) and [SECURITY.md](./SECURITY.md).

## VPS

`VANOS_ACCESS_MODE=private`, Node on `127.0.0.1:3000`, Tailscale Serve on 443 for the dashboard and Tailscale Funnel on 8443 for `/api/bots/ingest`, `/api/mcp` and `/api/v1/health`. Data is stored in `.data/bots` (or `VANOS_DATA_DIR`) unless Upstash is configured. Commands and env: [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md#vps-tailscale-serve-for-the-dashboard-funnel-for-bots).

## Vercel (demo only)

Mission Control lives in `ai-support/`. The root `vercel.json` builds it with `@vercel/next`:

```json
{
  "version": 2,
  "builds": [{ "src": "ai-support/package.json", "use": "@vercel/next" }]
}
```

Do not set `outputDirectory`: the Next.js builder owns `.next`, and pointing Output Directory at `ai-support/.next` makes Vercel treat the app as a static export and breaks previews.

Env on the Vercel project:

- `VANOS_DEMO_MODE=true` (exact value). Sample data, no sign-in, every write refused.
- Nothing else secret: no `AGENT_API_TOKEN`, `BOTS_INGEST_SECRET`, dashboard password, session or TOTP secrets, Upstash, or integration tokens.

Turn off Vercel Deployment Protection for Production, or visitors get a Vercel login. See [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md#vercel-public-demo).
