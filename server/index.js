#!/usr/bin/env node
import express from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import sharp from 'sharp';
import { createServer } from 'http';
import { Server as IOServer } from 'socket.io';
import dotenv from 'dotenv';
import multer from 'multer';
import { GoogleGenAI, Type } from '@google/genai';

import { preprocessFile } from './preprocess.js';
import { generatePolygons } from './polygons.js';

const app = express();
// Increase body parser limits to allow larger payloads from clients (adjust if needed)
// Raised to 50mb to accommodate larger uploads or rich JSON payloads from the frontend.
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Simple CORS for browser access from the frontend dev server
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.WORKER_CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Load server-side env vars from server/.env.local if present
dotenv.config({ path: path.join(process.cwd(), 'server', '.env.local') });

const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Configure multer for file uploads (store in data dir with timestamp)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
    cb(null, DATA_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.tiff';
    cb(null, `upload_${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

// Log sentinel configuration (non-secret) to help debugging
const sentinelHubUrlCfg = process.env.SENTINELHUB_PROCESSING_URL || process.env.SENTINEL_HUB_PROCESSING_URL;
console.log('Sentinel Hub processing URL:', sentinelHubUrlCfg ? sentinelHubUrlCfg : 'not configured');
console.log('Sentinel Hub client credentials present:', !!(process.env.SENTINEL_HUB_CLIENT_ID && process.env.SENTINEL_HUB_CLIENT_SECRET));

// Helper to save a buffer stream to file
async function saveBufferToFile(buffer, filename) {
  const filePath = path.join(DATA_DIR, filename);
  await fs.promises.writeFile(filePath, buffer);
  return filePath;
}

// Simple in-memory caches with TTL
const ingestCache = new Map(); // key: JSON.stringify({bbox,date}) -> { filename, expires }
const preprocessCache = new Map(); // key: filename|bbox -> { outFilename, expires }
const polygonsCache = new Map(); // key: filename|threshold|minArea -> { collection, expires }
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

function getCached(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.expires && Date.now() > entry.expires) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(map, key, value, ttlMs = CACHE_TTL_MS) {
  map.set(key, { value, expires: Date.now() + ttlMs });
}

// Simple retry helper for axios POST
async function axiosPostWithRetry(url, body, opts = {}, retries = 3, delay = 1000) {
  try {
    return await axios.post(url, body, opts);
  } catch (err) {
    if (retries <= 0) throw err;
    console.warn(`Request failed, retrying in ${delay}ms...`, err?.message || err);
    await new Promise((r) => setTimeout(r, delay));
    return axiosPostWithRetry(url, body, opts, retries - 1, delay * 2);
  }
}

// Token helper (reusable)
async function requestClientTokenIfConfigured() {
  const clientId = process.env.SENTINEL_HUB_CLIENT_ID;
  const clientSecret = process.env.SENTINEL_HUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Client credentials not configured');
  const tokenUrl = 'https://services.sentinel-hub.com/oauth/token';
  const params = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
  console.log('Requesting Sentinel Hub client token from', tokenUrl);
  const resp = await axios.post(tokenUrl, params.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });
  console.log('Token request response status:', resp.status);
  return resp.data && resp.data.access_token;
}

const httpServer = createServer(app);
const io = new IOServer(httpServer, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// Debug config endpoint
app.get('/api/config', (req, res) => {
  const sentinelHubUrl = process.env.SENTINELHUB_PROCESSING_URL || process.env.SENTINEL_HUB_PROCESSING_URL;
  const hasClientCreds = !!(process.env.SENTINEL_HUB_CLIENT_ID && process.env.SENTINEL_HUB_CLIENT_SECRET);
  const hasAccessToken = !!(process.env.SENTINEL_HUB_ACCESS_TOKEN || process.env.SENTINELHUB_ACCESS_TOKEN);
  res.json({ sentinelHubUrl: !!sentinelHubUrl, hasClientCreds, hasAccessToken });
});

// Real Gemini-backed plan generation (server-side bridge)
app.post('/api/gemini-plan', express.json(), async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GENAI_API_KEY || process.env.API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'GEMINI_API_KEY not configured on server' });

    const { location, floodPolygons, weather, confidenceMetrics } = req.body || {};

    const ai = new GoogleGenAI({ apiKey });

    // Build system instruction with weather context
    const systemInstruction = `
      MISSION: Generate a climate operations plan for ${location}.
      CURRENT WEATHER: ${weather?.description || 'unknown'}, Temp ${weather?.temperature || 'N/A'}°C, Rain ${weather?.rainfall || 'N/A'}.
      RETURN: JSON matching schema with riskLevel, summary, reasoningTrace, overallConfidence, weather, floodPolygons, confidenceMetrics, checklists.
    `;

    const parts = [{ text: `Analyze ${location} and create an operations plan.` }];
    if (floodPolygons && floodPolygons.length > 0) {
      parts.push({ text: `Detected ${floodPolygons.length} polygon(s).` });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: { parts },
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            riskLevel: { type: Type.STRING },
            summary: { type: Type.STRING },
            reasoningTrace: { type: Type.STRING },
            overallConfidence: { type: Type.NUMBER },
            weather: { type: Type.OBJECT },
            floodPolygons: { type: Type.ARRAY },
            confidenceMetrics: { type: Type.OBJECT },
            checklists: { type: Type.ARRAY }
          },
          required: ['riskLevel','summary','reasoningTrace']
        }
      }
    });

    const text = response.text || '{}';
    const rawCandidates = response.candidates || null;
    let planData = {};
    try { planData = JSON.parse(text); } catch (e) { console.error('Failed to parse Gemini response', e); }

    const plan = {
      id: Math.random().toString(36).substr(2,9),
      timestamp: new Date().toISOString(),
      location: location || 'unknown',
      riskLevel: planData.riskLevel || 'MEDIUM',
      summary: planData.summary || planData.description || 'No summary',
      reasoningTrace: planData.reasoningTrace || JSON.stringify(planData).slice(0,100),
      overallConfidence: planData.overallConfidence || 50,
      weather: planData.weather || weather || { temperature: 0, rainfall: 'N/A', windSpeed: 'N/A', windDirection: 'N/A' },
      confidenceMetrics: planData.confidenceMetrics || confidenceMetrics || { satellite: 50, weather: 50, documents: 20 },
      checklists: planData.checklists || [],
      floodPolygons: planData.floodPolygons || floodPolygons || [],
      groundingUrls: [],
      rawAIResponse: {
        text,
        candidates: rawCandidates
      }
    };

    io.emit('ai-plan', plan);
    return res.json(plan);
  } catch (e) {
    console.error('gemini-plan failed', e?.message || e);
    return res.status(500).json({ error: 'Gemini plan generation failed', detail: String(e) });
  }
});

// Note: simulated Gemini endpoint removed — use /api/gemini-plan (real model) or keep demo separately.

// Debug token test endpoint (attempts to fetch a token using client credentials)
app.post('/api/token-test', async (req, res) => {
  try {
    const token = await requestClientTokenIfConfigured();
    if (token) return res.json({ ok: true, message: 'Token obtained' });
    return res.status(500).json({ ok: false, error: 'No token in response' });
  } catch (e) {
    console.error('Token test failed', e?.message || e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// Attempt to fetch GeoTIFF from Sentinel Hub Process API if configuration exists.
app.post('/api/ingest', upload.single('image'), async (req, res) => {
  // Accept either multipart upload (image file) or JSON body with bbox/date for Sentinel ingest
  if (req.file) {
    try {
      const savedName = path.basename(req.file.path);
      const payload = { ok: true, source: 'upload', path: `/data/${savedName}`, filePath: req.file.path, size: req.file.size };
      io.emit('new-image', payload);
      return res.json(payload);
    } catch (e) {
      console.error('Upload ingest failed', e);
      return res.status(500).json({ error: 'Upload ingest failed: ' + String(e) });
    }
  }

  const { bbox, date, format = 'png', token: requestToken } = req.body || {};

  if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) {
    return res.status(400).json({ error: 'Missing or invalid bbox. Provide [minLon, minLat, maxLon, maxLat].' });
  }

  try {
    const sentinelHubUrl = process.env.SENTINELHUB_PROCESSING_URL || process.env.SENTINEL_HUB_PROCESSING_URL; // e.g. https://services.sentinel-hub.com/api/v1/process

    // Determine auth: explicit access token OR client credentials
    const accessToken = process.env.SENTINEL_HUB_ACCESS_TOKEN || process.env.SENTINELHUB_ACCESS_TOKEN;
    const clientId = process.env.SENTINEL_HUB_CLIENT_ID;
    const clientSecret = process.env.SENTINEL_HUB_CLIENT_SECRET;

    // helper to get a token via client credentials
    async function requestClientToken() {
      const tokenUrl = 'https://services.sentinel-hub.com/oauth/token';
      const params = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
      console.log('Requesting Sentinel Hub client token from', tokenUrl);
      const resp = await axios.post(tokenUrl, params.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });
      console.log('Token request response status:', resp.status);
      return resp.data && resp.data.access_token;
    }

    // Acquire token if using client credentials
    let tokenToUse = requestToken || accessToken;
    if (!tokenToUse && clientId && clientSecret) {
      try {
        tokenToUse = await requestClientToken();
      } catch (e) {
        console.warn('Failed to fetch sentinel hub token using client credentials', e?.message || e);
      }
    }

    if (sentinelHubUrl && !tokenToUse) {
      console.warn('Sentinel Hub processing URL is set but no access token or client credentials were available. Provide `SENTINEL_HUB_ACCESS_TOKEN` or `SENTINEL_HUB_CLIENT_ID/SECRET`, or pass `token` in the POST body.');
      alert('Sentinel Hub access token or client credentials not configured. Please set SENTINEL_HUB_ACCESS_TOKEN or SENTINEL_HUB_CLIENT_ID and SENTINEL_HUB_CLIENT_SECRET in your .env.local file.');
    }

    if (sentinelHubUrl && tokenToUse) {
      // Build a minimal process request. Users can customize evalscript via env or extend this code.
      const evalscript = process.env.SENTINELHUB_EVALSCRIPT || `//VERSION=3\nfunction setup() {return {input:[{bands:["B04","B03","B02"],units:"REFLECTANCE"}],output:{bands:3}};}\nfunction evaluatePixel(sample){return [sample.B04, sample.B03, sample.B02];}`;

      const buildBody = (queryDate) => ({
        input: {
          bounds: { bbox, properties: { crs: process.env.SENTINELHUB_BBOX_CRS || 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
          data: [{ type: 'sentinel-2-l2a', dataFilter: { timeRange: { from: `${queryDate}T00:00:00Z`, to: `${queryDate}T23:59:59Z` } } }]
        },
        evalscript,
        output: { responses: [{ identifier: 'default', format: { type: process.env.SENTINELHUB_OUTPUT_FORMAT || 'image/png' } }] }
      });

      // check ingest cache
      const ingestKey = JSON.stringify({ bbox, date });
      const cached = getCached(ingestCache, ingestKey);
      if (cached && fs.existsSync(path.join(DATA_DIR, cached.filename))) {
        const payload = { ok: true, source: 'cache', path: `/data/${cached.filename}`, filePath: path.join(DATA_DIR, cached.filename) };
        io.emit('new-image', payload);
        return res.json(payload);
      }

      // Helper to try a specific date
      async function tryFetchImagery(queryDate, isRetry = false) {
        try {
          console.log(`${isRetry ? '[Fallback] ' : ''}Sending Process API request for date: ${queryDate}`);
          const body = buildBody(queryDate);
          console.log('Process request body preview:', { bbox, date: queryDate, outputFormat: body.output });
          const acceptType = body?.output?.responses?.[0]?.format?.type || 'application/octet-stream';
          const resp = await axiosPostWithRetry(sentinelHubUrl, body, {
            responseType: 'arraybuffer',
            headers: { Accept: acceptType, 'Content-Type': 'application/json', Authorization: `Bearer ${tokenToUse}` },
            timeout: 120000
          });

          console.log('Process API response status:', resp.status, 'size:', resp.data ? resp.data.length : 0);
          if (!resp.data || resp.data.length < 1000) {
            console.warn(`Response too small (${resp.data ? resp.data.length : 0} bytes) for date ${queryDate}`);
            return null;
          }
          return resp;
        } catch (err) {
          console.error(`Imagery fetch failed for ${queryDate}:`, err?.message || err);
          return null;
        }
      }

      // Try the requested date first
      let resp = await tryFetchImagery(date, false);
      
      // If no data, try progressively older dates (7, 14, 21, 30 days back)
      const fallbackOffsets = [7, 14, 21, 30, 45, 60];
      for (const offset of fallbackOffsets) {
        if (resp) break;
        const fallbackDate = new Date(date);
        fallbackDate.setDate(fallbackDate.getDate() - offset);
        const fallbackDateStr = fallbackDate.toISOString().slice(0, 10);
        console.log(`No imagery for current attempt, trying fallback: ${fallbackDateStr} (${offset} days back)`);
        resp = await tryFetchImagery(fallbackDateStr, true);
      }

      if (!resp) {
        return res.status(500).json({ error: 'No Sentinel-2 imagery available for the requested location. Tried dates from ' + date + ' back to 60 days prior. The location may have cloud cover or insufficient satellite passes.' });
      }

      try {
        const filename = `sentinel_${Date.now()}.tiff`;
        const filePath = await saveBufferToFile(Buffer.from(resp.data), filename);
        setCached(ingestCache, ingestKey, { filename });
        const payload = { ok: true, source: 'sentinel-hub', path: `/data/${filename}`, filePath };
        io.emit('new-image', payload);
        return res.json(payload);
      } catch (err) {
        try {
          const txt = Buffer.isBuffer(err?.response?.data) ? err.response.data.toString('utf8') : JSON.stringify(err?.response?.data);
          console.error('Save/emit failed:', txt);
        } catch (e) {
          // ignore
        }
        return res.status(500).json({ error: 'Failed to save imagery: ' + err?.message });
      }
    }

    // Fallback: create a small placeholder PNG with metadata overlay — useful for local development/demo.
    const width = 1024;
    const height = 1024;
    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#cbd5e1" />
      <text x="50%" y="45%" font-size="20" text-anchor="middle" fill="#0f172a">Placeholder imagery</text>
      <text x="50%" y="55%" font-size="14" text-anchor="middle" fill="#0f172a">bbox: ${bbox.join(', ')}</text>
      <text x="50%" y="60%" font-size="14" text-anchor="middle" fill="#0f172a">date: ${date}</text>
    </svg>`;

    const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
    const filename = `placeholder_${Date.now()}.${format}`;
    const filePath = await saveBufferToFile(pngBuffer, filename);
    const payload = { ok: true, source: 'placeholder', path: `/data/${filename}`, filePath };
    io.emit('new-image', payload);
    return res.json(payload);
  } catch (err) {
    console.error('Ingest error', err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// Serve saved files
app.use('/data', express.static(path.join(process.cwd(), 'data')));

app.get('/api/list', async (req, res) => {
  const files = await fs.promises.readdir(DATA_DIR);
  res.json({ files });
});

// Preprocess endpoint already registered via import; emit event when processed
app.post('/api/preprocess', async (req, res) => {
  const { filename, bbox, outWidth, outFormat } = req.body || {};
  if (!filename) return res.status(400).json({ ok: false, error: 'Missing filename in body' });
  try {
    const key = `${filename}|${JSON.stringify(bbox||null)}|${outWidth||''}|${outFormat||''}`;
    const cached = getCached(preprocessCache, key);
    if (cached && fs.existsSync(path.join(DATA_DIR, cached.outFilename))) {
      const payload = { ok: true, outFilename: cached.outFilename, outPath: path.join(DATA_DIR, cached.outFilename), path: `/data/${cached.outFilename}` };
      io.emit('processed-image', payload);
      return res.json(payload);
    }

    const result = await preprocessFile({ filename, bbox, outWidth, outFormat });
    setCached(preprocessCache, key, { outFilename: result.outFilename });
    const payload = { ok: true, ...result, path: `/data/${result.outFilename}` };
    io.emit('processed-image', payload);
    return res.json(payload);
  } catch (e) {
    console.error('Preprocess failed', e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// Polygons extraction endpoint
app.post('/api/polygons', async (req, res) => {
  const { filename, threshold = 128, minArea = 10, bbox } = req.body || {};
  if (!filename) return res.status(400).json({ ok: false, error: 'Missing filename in body' });
  try {
    const key = `${filename}|${threshold}|${minArea}`;
    const cached = getCached(polygonsCache, key);
    if (cached) {
      const payload = { ok: true, collection: cached };
      io.emit('flood-polygons', payload);
      return res.json(payload);
    }

    const collection = await generatePolygons({ filename, threshold, minArea, bbox });
    setCached(polygonsCache, key, collection);
    const payload = { ok: true, collection };
    io.emit('flood-polygons', payload);
    return res.json(payload);
  } catch (e) {
    console.error('Polygons generation failed', e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

const PORT = process.env.WORKER_PORT || 4000;
httpServer.listen(PORT, () => console.log(`Sentinel ingestion worker listening on http://localhost:${PORT}`));
