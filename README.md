# Climate Ops Copilot

A full-stack climate operations assistant that ingests satellite imagery, preprocesses rasters, extracts flood polygons, and generates AI-augmented operation plans using Gemini 3 Flash. Features real-time Socket.IO streaming, live weather integration, and interactive map visualization.

## What it does
- **Frontend**: React 19 + Vite UI with Leaflet map, live geocoding, and real-time polygon rendering.
- **Backend**: Node.js Express worker providing ingest/preprocess/polygonize/Gemini endpoints with Socket.IO streaming.
- **Data pipeline**: Sentinel satellite imagery → preprocessing → contour extraction → flood polygons → AI-driven operations plan.
- **AI**: Server-side Gemini 3 Flash integration for context-aware disaster response planning with auditable reasoning.

## Architecture
- **Frontend** (root): `index.tsx`, `App.tsx`, `components/*` (Map, Sidebar, Operations Plan, UI components).
- **Backend** (server): `server/index.js` (Express + Socket.IO), `server/preprocess.js`, `server/polygons.js`.
- **Services**: `services/weatherService.ts` (OpenWeather), `services/geminiService.ts` (browser-side SDK optional).
- **Storage**: Cloud-native (Cloudflare R2) in production; local `data/` dir in development.

## Local Development

### Prerequisites
- Node.js 18+, npm
- Linux users: `apt install libvips-tools` (required by `sharp`)

### Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   
   Create `.env.local` at project root:
   ```
   VITE_OPENWEATHER_API_KEY=your_openweather_key
   ```
   
   Create `server/.env.local` (for production with Cloudflare R2):
   ```
   GEMINI_API_KEY=your_gemini_api_key
   OPENWEATHER_API_KEY=your_openweather_key
   SENTINEL_HUB_CLIENT_ID=optional_sentinel_id
   SENTINEL_HUB_CLIENT_SECRET=optional_sentinel_secret
   
   # Production R2 storage (optional, defaults to local filesystem)
   STORAGE_TYPE=r2
   R2_ACCOUNT_ID=your-account-id
   R2_ACCESS_KEY_ID=your_key
   R2_SECRET_ACCESS_KEY=your_secret
   R2_BUCKET=climate-ops-satellite
   ```

3. **Start development servers**
   ```bash
   # Terminal 1: Backend worker (port 4000)
   npm run start-worker
   
   # Terminal 2: Frontend dev server (port 3000)
   npm run dev
   ```

   Open http://localhost:3000. Click "Initiate Operations Loop" to run the full pipeline.

## API Endpoints

| Endpoint | Method | Body | Returns |
|----------|--------|------|---------|
| `/api/ingest` | POST | `{ bbox, date }` | `{ ok, source, path, filePath }` |
| `/api/preprocess` | POST | `{ filename, bbox?, outWidth? }` | Processed image metadata |
| `/api/polygons` | POST | `{ filename, threshold?, minArea? }` | GeoJSON FeatureCollection |
| `/api/gemini-plan` | POST | `{ region, confidence, polygons, ... }` | `{ plan, rawAIResponse, ... }` |
| `WS /socket.io` | WebSocket | — | Real-time: `new-image`, `processed-image`, `flood-polygons` |

## Production Deployment

### Architecture for Scale

```
┌─────────────────┐
│  React Frontend │ (Vercel / Netlify / Cloudflare Pages)
├─────────────────┤
│  Express Worker │ (Railway / Render / AWS ECS)
├─────────────────┤
│  Cloud Storage  │ (AWS S3 / GCS / Azure Blob)
├─────────────────┤
│  APIs           │ (Sentinel Hub, OpenWeather, Gemini)
└─────────────────┘
```

### Storage Migration

**Local dev** → Save to `data/` (file system)

**Production** → Save to cloud object storage:
- **AWS S3**: Set `STORAGE_TYPE=s3` + `AWS_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- **Google Cloud Storage**: Set `STORAGE_TYPE=gcs` + `GCS_BUCKET`, `GOOGLE_APPLICATION_CREDENTIALS`
- **Azure Blob**: Set `STORAGE_TYPE=azure` + `AZURE_CONTAINER`, `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_KEY`

### Docker

Build and run containerized:

```bash
# Build image
docker build -t climate-ops-copilot .

# Run container
docker run -p 3000:3000 -p 4000:4000 \
  -e GEMINI_API_KEY=xxx \
  -e OPENWEATHER_API_KEY=yyy \
  -e STORAGE_TYPE=s3 \
  -e AWS_BUCKET=climate-ops \
  climate-ops-copilot
```

### One-Click Deployment

#### Railway
1. Connect GitHub repo to [Railway](https://railway.app)
2. Add service: Select Node.js
3. Set environment variables:
   - `GEMINI_API_KEY`
   - `OPENWEATHER_API_KEY`
   - `STORAGE_TYPE=s3` (or omit for local)
   - AWS/GCS credentials (if using cloud storage)
4. Deploy (Railway auto-detects `npm run build` and start)

#### Render
1. Connect repo at [render.com](https://render.com)
2. Create Web Service (Node)
3. Set start command: `npm run build && npm run start`
4. Add environment variables (same as above)
5. Deploy

#### Vercel (Frontend only)
1. Deploy frontend-only to Vercel (static build)
   ```bash
   npm run build
   ```
2. Deploy backend worker separately (Railway/Render)
3. Set frontend env var: `VITE_WORKER_API=https://your-worker.railway.app`

### Environment Variables Reference

| Variable | Required | Purpose |
|----------|----------|---------|
| `GEMINI_API_KEY` | ✓ (recommended) | Google Gemini 3 Flash API key for AI planning |
| `OPENWEATHER_API_KEY` | ✓ (recommended) | OpenWeather API for live weather in plans |
| `SENTINEL_HUB_CLIENT_ID` | Optional | Sentinel Hub OAuth ID (imagery ingestion) |
| `SENTINEL_HUB_CLIENT_SECRET` | Optional | Sentinel Hub OAuth secret |
| `STORAGE_TYPE` | Optional | `s3`, `gcs`, `azure`, or omit for local `data/` |
| `AWS_BUCKET` | If `STORAGE_TYPE=s3` | S3 bucket name |
| `AWS_REGION` | If `STORAGE_TYPE=s3` | AWS region (e.g., `us-east-1`) |
| `AWS_ACCESS_KEY_ID` | If `STORAGE_TYPE=s3` | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | If `STORAGE_TYPE=s3` | AWS secret key |
| `GCS_BUCKET` | If `STORAGE_TYPE=gcs` | Google Cloud Storage bucket |
| `GOOGLE_APPLICATION_CREDENTIALS` | If `STORAGE_TYPE=gcs` | Path to GCS JSON service account key |
| `PORT` | Optional | Server port (default: 4000) |
| `WORKER_CORS_ORIGIN` | Optional | CORS origin for worker (default: `*`) |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Port 4000 in use | `lsof -ti:4000 \| xargs kill -9` or set `PORT=4001` |
| CORS errors | Ensure worker runs from project root; check `WORKER_CORS_ORIGIN` |
| Missing `sharp` native libs | Linux: `apt install libvips-tools` |
| Sentinel returns 400 | Check logs for API error; verify credentials and date format |
| Cloud storage not uploading | Verify credentials, bucket/container name, and IAM permissions |

## Development Notes

- **WebSocket**: Socket.IO auto-reconnects; set `debug=true` in browser console for detailed logs.
- **Gemini integration**: Raw API responses cached in `rawAIResponse` field for auditing; collapsible UI panel shows candidates and grounding.
- **Confidence metrics**: Dynamic (based on imagery size, polygon count, data availability); not hardcoded.
- **Multipart uploads**: Use `multer` for large files (>10MB); binary streaming reduces payload overhead.

## License
MIT

---
