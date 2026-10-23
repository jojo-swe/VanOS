# Money — Wave 1 (personal + business cash)

Mission Control **Money** tracks the four Wave‑1 ledgers:

1. **Prenumerationer** — Cursor, OpenRouter, media, domains…
2. **Vardag** — income, bills, expenses, cash buffer / runway
3. **Skatt** — yearly underlag (income / expense / deduction) + rough estimate
4. **Sälj** — FB Marketplace / Blocket / Tradera pipeline

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/money` | Full snapshot + derived totals |
| `POST` | `/api/money/ingest` | Upsert rows (`Bearer $BOTS_INGEST_SECRET`) |

Same ingest secret as Grok Bot / Costs.

## SEK rollups

- Display currency: **SEK**
- USD and EUR lines converted with Riksbanken's daily rates (fetched automatically, `MONEY_FX_AUTO=off` turns that off)
- An ingest with `"usdToSek": 10.8` / `"eurToSek": 11.3` wins while it is newer than Riksbanken's rate
- `MONEY_USD_SEK_RATE` / `MONEY_EUR_SEK_RATE` pin a rate; defaults `10.5` / `11.5`. Details in `AGENT-API.md`

## Example ingest

```bash
curl -X POST "$HOST/api/money/ingest" \
  -H "Authorization: Bearer $BOTS_INGEST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "reportedBy": "n8n",
    "everyday": [{
      "id": "ev-salary",
      "kind": "income",
      "label": "Lön",
      "amount": 28000,
      "currency": "SEK",
      "category": "work",
      "recurring": true
    }]
  }'
```

Tax estimate is a **placeholder** (≈30% of positive profit). Not tax advice — keep real books/kvitton.
