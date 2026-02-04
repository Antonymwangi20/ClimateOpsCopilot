import fs from 'fs';
import path from 'path';
import axios from 'axios';

const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

async function saveBufferToFile(buffer, filename) {
  const filePath = path.join(DATA_DIR, filename);
  await fs.promises.writeFile(filePath, buffer);
  return filePath;
}

async function axiosPostWithRetry(url, body, opts = {}, retries = 3, delay = 1000) {
  try {
    return await axios.post(url, body, opts);
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise((r) => setTimeout(r, delay));
    return axiosPostWithRetry(url, body, opts, retries - 1, delay * 2);
  }
}

async function requestClientToken(clientId, clientSecret) {
  if (!clientId || !clientSecret) throw new Error('Client credentials not configured');
  const tokenUrl = 'https://services.sentinel-hub.com/oauth/token';
  const params = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
  const resp = await axios.post(tokenUrl, params.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });
  return resp.data && resp.data.access_token;
}

function buildProcessBody({bbox, date, evalscript, dataType, outputFormat}) {
  return {
    input: {
      bounds: { bbox, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
      data: [{ type: dataType, dataFilter: { timeRange: { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` } } }]
    },
    evalscript,
    output: { responses: [{ identifier: 'default', format: { type: outputFormat || 'image/png' } }] }
  };
}

async function tryFetchImagery({ sentinelHubUrl, token, bbox, date, dataType, evalscript, outputFormat }) {
  try {
    const body = buildProcessBody({ bbox, date, evalscript, dataType, outputFormat });
    const acceptType = (body?.output?.responses?.[0]?.format?.type) || 'application/octet-stream';
    const resp = await axiosPostWithRetry(sentinelHubUrl, body, {
      responseType: 'arraybuffer',
      headers: { Accept: acceptType, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      timeout: 120000
    });
    if (!resp || !resp.data) return null;
    const buf = Buffer.from(resp.data);
    // Log content-type for troubleshooting
    try { console.log('[ingestor.tryFetchImagery] content-type:', resp.headers && resp.headers['content-type']); } catch (e) {}

    function isValidPNG(b) {
      return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
    }
    function isValidTIFF(b) {
      return b.length > 4 && ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4D && b[1] === 0x4D));
    }

    const fmt = (outputFormat || '').toLowerCase();
    if (fmt.includes('png')) {
      if (!isValidPNG(buf)) return null;
    } else if (fmt.includes('tiff') || fmt.includes('geotiff') || fmt.includes('tif')) {
      if (!isValidTIFF(buf)) return null;
    } else {
      // Unknown expected format — accept any non-empty buffer
      if (buf.length === 0) return null;
    }

    return resp;
  } catch (e) {
    console.warn('tryFetchImagery error:', e?.message || e);
    return null;
  }
}

async function ingestSource({ sentinelHubUrl, token, bbox, date, source }) {
  // source: { id, dataType, modality, evalscript, outputFormat, resolution }
  const resp = await tryFetchImagery({ sentinelHubUrl, token, bbox, date, dataType: source.dataType, evalscript: source.evalscript, outputFormat: source.outputFormat });
  if (!resp) return { success: false };

  const ext = (source.outputFormat && source.outputFormat.includes('tiff')) ? 'tiff' : 'png';
  const filename = `${source.id}_${Date.now()}.${ext}`;
  const filePath = await saveBufferToFile(Buffer.from(resp.data), filename);

  return {
    success: true,
    source: source.id,
    modality: source.modality,
    resolution: source.resolution || null,
    timestamp: date,
    data_uri: `/data/${filename}`,
    filePath,
    filename
  };
}

const DEFAULT_SOURCES = [
  {
    id: 'sentinel-2',
    dataType: 'sentinel-2-l2a',
    modality: 'optical',
    resolution: '10m',
    outputFormat: 'image/tiff',
    // NDWI single-band scaled to 0-255
    evalscript: `//VERSION=3\nfunction setup() {return {input:[{bands:["B03","B08"],units:"REFLECTANCE"}],output:{bands:1}};}\nfunction evaluatePixel(sample){const g=sample.B03;const nir=sample.B08;const ndwi=(g-nir)/(g+nir+1e-6);const scaled=Math.round((ndwi+1.0)*127.5);return [scaled];}`
  },
  {
    id: 'sentinel-1',
    dataType: 'sentinel-1-grd',
    modality: 'radar',
    resolution: '10m',
    outputFormat: 'image/tiff',
    // Basic VV intensity output (may require hub-side processing)
    evalscript: `//VERSION=3\nfunction setup(){return {input:[{bands:["VV"], units:"DB"}], output:{bands:1}};}\nfunction evaluatePixel(sample){return [Math.round(sample.VV)];}`
  },
  {
    id: 'landsat-8',
    dataType: 'landsat-8-l2',
    modality: 'optical',
    resolution: '30m',
    outputFormat: 'image/tiff',
    evalscript: `//VERSION=3\nfunction setup(){return {input:[{bands:["B3","B5"], units:"REFLECTANCE"}], output:{bands:1}};}\nfunction evaluatePixel(sample){const g=sample.B3;const nir=sample.B5;const ndwi=(g-nir)/(g+nir+1e-6);const scaled=Math.round((ndwi+1.0)*127.5);return [scaled];}`
  }
];

async function ingestBest({ sentinelHubUrl, clientId, clientSecret, bbox, date, priority = DEFAULT_SOURCES }) {
  // Acquire token if not provided
  let token = null;
  if (!clientId && !clientSecret) throw new Error('No Sentinel Hub credentials provided');
  try {
    token = await requestClientToken(clientId, clientSecret);
  } catch (e) {
    // Token request failed — give up earlier
    throw new Error('Failed to obtain Sentinel Hub token: ' + String(e?.message || e));
  }

  for (const src of priority) {
    try {
      const result = await ingestSource({ sentinelHubUrl, token, bbox, date, source: src });
      if (result && result.success) return result;
    } catch (e) {
      // Try next
      continue;
    }
  }
  return { success: false };
}

// Lightweight precache: given an array of AOIs (objects {id,bbox,date}), ingest and write catalog
async function preCacheAOIs({ sentinelHubUrl, clientId, clientSecret, aoiList = [], outCatalog = path.join(DATA_DIR, 'catalog.json') }) {
  const catalog = [];
  for (const aoi of aoiList) {
    try {
      const res = await ingestBest({ sentinelHubUrl, clientId, clientSecret, bbox: aoi.bbox, date: aoi.date });
      if (res && res.success) {
        catalog.push({ id: aoi.id, bbox: aoi.bbox, date: aoi.date, best: res });
      } else {
        catalog.push({ id: aoi.id, bbox: aoi.bbox, date: aoi.date, best: null });
      }
    } catch (e) {
      catalog.push({ id: aoi.id, bbox: aoi.bbox, date: aoi.date, error: String(e) });
    }
  }
  await fs.promises.writeFile(outCatalog, JSON.stringify(catalog, null, 2));
  return catalog;
}

export { ingestBest, preCacheAOIs, DEFAULT_SOURCES };
