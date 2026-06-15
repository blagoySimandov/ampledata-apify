# AmpleData Enrichment — Apify Actor

Enrich a CSV through the [AmpleData](https://api.ampledata.ai) API: upload a list, define
the columns you want filled in plain English, and get back cited, confidence-scored cells.

The actor runs one enrichment job and is **cancellable** — aborting the Apify run cancels the
underlying AmpleData job via `POST /jobs/{jobID}/cancel`.

## Bring your own key

This actor does **not** ship with an API key. Each user supplies their own AmpleData key in the
`apiToken` input. Enrichment is billed per cell against that key's account balance, so you only
ever pay for your own runs. Generate a key at <https://api.ampledata.ai> account settings.

## Input

| Field | Required | Description |
| --- | --- | --- |
| `apiToken` | yes | AmpleData API key (`sk_live_...`). Generate from account settings. |
| `columns` | yes | Columns to enrich. Each: `{ name, type, description }`. `type` ∈ `string\|number\|boolean\|date`. |
| `csv` | one of | Inline CSV (first row = header). |
| `csvUrl` | one of | URL of a CSV to download. Takes precedence over `csv`. |
| `keyColumns` | no | Identifying columns (e.g. `["company"]`). Empty → AmpleData picks. |
| `keyColumnDescription` | no | Plain-English description of the key column. |
| `rowLimit` | no | Max rows to process. |
| `baseUrl` | no | API base URL. Default `https://api.ampledata.ai/api/v1`. |
| `pollIntervalSecs` | no | Progress poll interval. Default `5`. |

### Example

```json
{
  "apiToken": "sk_live_...",
  "csv": "company\nstripe.com\nfigma.com",
  "keyColumns": ["company"],
  "columns": [
    { "name": "industry", "type": "string", "description": "Primary industry" }
  ]
}
```

## Output

Each enriched row is pushed to the default dataset:

```json
{
  "key": "stripe.com",
  "extracted_data": { "industry": "Fintech" },
  "confidence": { "industry": { "score": 0.9, "reason": "..." } },
  "sources": ["https://..."]
}
```

A summary is written to the key-value store under `OUTPUT`:
`{ jobId, status, totalRows, resultCount }`.

## How it works

1. `POST /enrichment-signed-url` → signed upload URL + `sourceId`
2. `PUT` the CSV bytes to the signed URL
3. `POST /sources/{sourceId}/enrich` → `jobId`
4. Poll `GET /jobs/{jobId}/progress` until `COMPLETED` / `CANCELLED`
5. `GET /jobs/{jobId}/results` → dataset

## Develop

```bash
npm install
npm run build
apify run    # uses storage/key_value_stores/default/INPUT.json
```

## Deploy

```bash
apify login
apify push
```
