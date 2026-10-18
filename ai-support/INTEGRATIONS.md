# GitHub, Notion, Slack, Obsidian, and Riksbanken

Read-only panels on Mission Control (**Integrations**). Each one stays off until its env vars are set. Nothing here writes to GitHub, Notion, or the vault. Slack can also receive notifications from Mission Control through an incoming webhook.

The dashboard routes use the same basic auth and TOTP gate as the rest of the UI. Agents call the `/api/v1` routes with `Authorization: Bearer $AGENT_API_TOKEN`.

| Surface | Path | Auth |
|---------|------|------|
| Dashboard | `GET /api/github` | Basic auth (+ TOTP when enabled) or agent token |
| Dashboard | `GET /api/notion` | same |
| Dashboard | `GET /api/obsidian` | same. `?q=` searches notes |
| Dashboard | `GET /api/slack` | same |
| Agent | `GET /api/v1/github` | `AGENT_API_TOKEN` |
| Agent | `GET /api/v1/notion` | `AGENT_API_TOKEN` |
| Agent | `GET /api/v1/obsidian` | `AGENT_API_TOKEN`. `?q=` searches notes |
| Agent | `GET /api/v1/slack` | `AGENT_API_TOKEN` |

Responses are cached for about a minute (15 seconds after an error). Each upstream request times out after 8 seconds. Tokens are not written to the access log or included in error text.

Set these on the VPS. The Vercel demo shows sample data and calls none of these services.

## GitHub

```bash
GITHUB_TOKEN=          # fine-grained personal access token, read-only
GITHUB_OWNER=jojo-swe
```

The panel lists open pull requests, the latest commits, and workflow runs whose newest conclusion is `failure` or `timed_out`, across the repos this token can see for `GITHUB_OWNER`. It scans the 12 most recently pushed repositories.

Token permissions (repository access limited to the repos you want):

| Permission | Access |
|------------|--------|
| Metadata | Read (required by GitHub) |
| Contents | Read (commits) |
| Pull requests | Read |
| Actions | Read (workflow runs) |

Do not grant write permissions. `GITHUB_TOKEN` missing means the panel stays idle and no request is sent.

## Notion

```bash
NOTION_TOKEN=            # internal integration secret
NOTION_DATABASE_IDS=     # comma-separated database ids or notion.so URLs
# Optional, these are the defaults:
# NOTION_STATUS_PROPERTY=Status
# NOTION_DONE_VALUE=Klart
```

Create an internal integration, then share each database with it (including **Att göra för John (botarna)**). The panel queries each database for rows whose `Status` is not `Klart`. `Status` can be a Notion status or select property.

Both `NOTION_TOKEN` and at least one database id are required. If either is missing, Notion stays off and no request is sent.

## Slack

Slack does two separate things. Set either or both.

### Notifications

```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/…   # incoming webhook
SLACK_NOTIFY=errors   # errors (default) | all | off
```

Create a Slack app, turn on **Incoming Webhooks**, and add one to the channel that should get alerts. Only `https://hooks.slack.com/services/…` and `/triggers/…` URLs are accepted; anything else leaves notifications off and the Setup panel says why.

What is sent:

| Event | `errors` | `all` |
|-------|----------|-------|
| A bot event with `type: "error"`, a heartbeat with `status: "error"`, or an alert with severity `error` | yes | yes |
| A dispatch the bot's webhook did not accept | yes | yes |
| A bot event with `type: "result"` | no | yes |

The same notice is sent once per 10 minutes and at most 20 go out per minute, so a looping bot cannot flood the channel. A replayed idempotency key does not notify again. Bot text is escaped, so a bot cannot ping `@channel` or hide a link. Sending runs in the background with a 5-second timeout: a slow or failing Slack never delays or breaks ingest or dispatch. Demo mode sends nothing.

### Panel

```bash
SLACK_BOT_TOKEN=xoxb-…
SLACK_CHANNEL_IDS=C0123ABCD,C0456EFGH   # channel ids, not #names; at most 10
```

Give the app's bot token these **read** scopes: `channels:history`, `channels:read`, and for private channels `groups:history` and `groups:read`. Add `users:read` to show names instead of user ids. Install the app, then `/invite` the bot to each channel. The panel shows the latest 10 messages per channel, with join/leave noise filtered out, and links each message to Slack. Copy a channel id from the channel's details in Slack.

### Connection

Slack also appears under **Connections**. It shows as live when the panel or notifications are configured. Agents can report Slack status through connections ingest, for example `{"connections":[{"id":"slack","wire":"error","detail":"Bot removed from #ops"}]}`. A reported `error` is shown as is.

## Obsidian

Obsidian has no cloud API. Use a folder on the Mission Control host, the Local REST API plugin, or both.

```bash
# Absolute path to the vault folder. Not /, /home, /tmp, or another system root.
OBSIDIAN_VAULT_PATH=/absolute/path/to/vault

# Optional. The Local REST API plugin. Set both, or neither.
OBSIDIAN_API_URL=http://127.0.0.1:27123
OBSIDIAN_API_KEY=
# Exact true only, for the plugin's self-signed HTTPS cert on a trusted network.
# OBSIDIAN_API_INSECURE=true
```

- Recent notes come from the vault folder (modification time). Hidden folders such as `.obsidian` are skipped, and symlinks are not followed.
- Search uses the Local REST API when `OBSIDIAN_API_URL` and `OBSIDIAN_API_KEY` are both set, and falls back to reading markdown in the vault.
- With only the API, recent notes are a bounded directory listing (no modification times).
- The API key is sent as a bearer header, never in the URL.

The plugin's HTTP port is `27123`. Its HTTPS port (`27124`) uses a certificate Node will reject unless `OBSIDIAN_API_INSECURE=true`.

## Riksbanken exchange rates

Unlike the panels above, this one is **on by default** because it needs no key. Mission Control fetches Riksbanken's daily mid rates for USD and EUR from the public SWEA API and uses them for money totals and the display currency:

```
GET https://api.riksbank.se/swea/v1/Observations/Latest/SEKUSDPMI   → {"date":"2026-10-16","value":9.90403}
GET https://api.riksbank.se/swea/v1/Observations/Latest/SEKEURPMI   → {"date":"2026-10-16","value":11.145}
```

- Rates are stored in the durable store (`fx-riksbank`) and refreshed at most every 12 hours. A page never waits for Riksbanken: it uses the stored rates, and a stale copy refreshes in the background. Until the first fetch lands, the rates fall back as described below.
- A failed or odd answer (not a positive rate, not a real date) keeps the last good rates and is retried after 30 minutes. Requests go only to `api.riksbank.se`, time out after 5 seconds, and send no credentials.
- Off in the demo. Set `MONEY_FX_AUTO=off` to turn it off. Env pins (`MONEY_USD_SEK_RATE`, `MONEY_EUR_SEK_RATE`) win over it either way; the full precedence is in `AGENT-API.md` under "Currencies and exchange rates".
