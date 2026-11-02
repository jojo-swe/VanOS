# Connections — Wave 2 (knowledge & files)

Mission Control **Connections** surfaces:

| Surface | Wire today | Sync path |
|---------|------------|-----------|
| **Gmail** | MCP ready in Cursor | Agent/n8n → `/api/connections/ingest` mail digest |
| **GitHub** | Read-only REST when `GITHUB_TOKEN` is set | Integrations panel + `GET /api/v1/github`. Ingest still accepted. |
| **Notion** | Internal integration when `NOTION_TOKEN` and `NOTION_DATABASE_IDS` are set | Integrations panel + `GET /api/v1/notion`. Ingest still accepted. |
| **Obsidian** | Local vault and/or Local REST API | Integrations panel + `GET /api/v1/obsidian`. See `INTEGRATIONS.md`. |
| **Joplin** | Ingest only (local) | Export/sync → ingest |
| **Google Drive** | MCP ready | Recent files digest |
| **OneDrive / iCloud** | Missing | Later wave |
| **Home Assistant** | REST (env) | **Home / PC** panel + `/api/v1/homeassistant` — see `HOME-LAB.md` |
| **DisplayFusion** | Windows bridge | **Home / PC** panel + `/api/v1/displayfusion` — see `HOME-LAB.md` |

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/api/connections` | — |
| `POST` | `/api/connections/ingest` | `Bearer $BOTS_INGEST_SECRET` |

## Example

```bash
curl -X POST "$HOST/api/connections/ingest" \
  -H "Authorization: Bearer $BOTS_INGEST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "reportedBy": "grok-bot",
    "mail": { "unread": 2, "important": 1, "threads": [] },
    "github": {
      "repos": [{
        "id": "r-vanos",
        "name": "jojo-swe/VanOS",
        "private": true,
        "openPrs": 1,
        "openIssues": 0,
        "ci": "ok",
        "lastPush": "now"
      }],
      "prs": []
    },
    "notion": { "connected": true, "pages": [] },
    "joplin": { "connected": true, "noteCount": 12, "notes": [] }
  }'
```

Dashboard does **not** hold OAuth tokens for Gmail/Drive/Notion. Cursor MCP (or n8n) reads those APIs and posts a safe digest here.
