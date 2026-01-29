Sentinel ingestion worker (JS)
==============================

This simple Node/Express worker provides an `/api/ingest` endpoint that accepts a JSON body:

POST /api/ingest
{
  "bbox": [minLon, minLat, maxLon, maxLat],
  "date": "2024-12-31",
  "format": "png" // optional
}

- Behavior:
- If `SENTINEL_HUB_ACCESS_TOKEN` (or legacy `SENTINELHUB_ACCESS_TOKEN`) is set, the worker will use it directly.
- Otherwise, if `SENTINEL_HUB_CLIENT_ID` and `SENTINEL_HUB_CLIENT_SECRET` are set, the worker will request an OAuth token from `https://services.sentinel-hub.com/oauth/token` and use that token for the Process API.
- If neither auth is configured, it will generate a placeholder PNG (useful for local development).
- Otherwise, it will generate a placeholder PNG (useful for local development).

Run locally:

```bash
# from repo root
npm run start-worker
```

Environment variables:
- `SENTINEL_HUB_CLIENT_ID` (recommended)
- `SENTINEL_HUB_CLIENT_SECRET` (recommended)
- `SENTINEL_HUB_ACCESS_TOKEN` (optional, if you already have a token)
- `SENTINEL_HUB_PROCESSING_URL` (optional, defaults to sentinel services)
- `WORKER_PORT` (optional, default 4000)
