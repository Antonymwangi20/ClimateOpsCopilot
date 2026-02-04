import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import * as MarchingSquares from 'marchingsquares';
import * as turf from '@turf/turf';

const DATA_DIR = path.join(process.cwd(), 'data');

// Sensor-aware parameter presets
const SENSOR_PRESETS = {
  'sentinel-2': { threshold: 180, minArea: 100000, label: 'optical-NDWI' },
  'sentinel-1': { threshold: 100, minArea: 10000, label: 'radar-VV' },
  'landsat-8': { threshold: 160, minArea: 50000, label: 'optical-NDWI' }
};

function mergeOverlappingPolygons(features, overlapThreshold = 0.1) {
  if (!features || features.length === 0) return features;
  
  let merged = [...features];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < merged.length && !changed; i++) {
      for (let j = i + 1; j < merged.length && !changed; j++) {
        try {
          const pi = merged[i];
          const pj = merged[j];
          const intersection = turf.intersect(pi, pj);
          if (intersection && intersection.geometry) {
            const areaI = turf.area(pi);
            const areaJ = turf.area(pj);
            const areaInt = turf.area(intersection);
            const overlapRatio = areaInt / Math.min(areaI, areaJ);
            if (overlapRatio > overlapThreshold) {
              const union = turf.union(pi, pj);
              merged.splice(j, 1);
              merged[i] = union;
              changed = true;
            }
          }
        } catch (e) {
          // ignore
        }
      }
    }
  }
  return merged;
}

async function readRasterGrid(filename) {
  const inputPath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(inputPath)) throw new Error('Input file not found: ' + filename);

  const buffer = await fs.promises.readFile(inputPath);
  console.log(`[readRasterGrid] Read ${buffer.length} bytes from ${filename}`);

  // Use sharp (supports GeoTIFF, PNG, JPEG etc.) and produce luminance grid
  try {
    const img = sharp(buffer);
    const metadata = await img.metadata();
    console.log(`[readRasterGrid] Image metadata:`, { format: metadata.format, width: metadata.width, height: metadata.height, channels: metadata.channels });
    
    const { width, height } = metadata;
    if (!width || !height) throw new Error('Unable to get image dimensions');
    
    // Read raw pixel data. The ingest evalscript now produces a single-band NDWI
    // image scaled to 0-255 where ~128 == NDWI 0. But support multi-channel images
    // gracefully (convert to luminance if RGB).
    const raw = await img.raw().toBuffer();
    const channels = metadata.channels || 1;
    const grid = new Array(height);
    for (let y = 0; y < height; y++) grid[y] = new Array(width);
    let p = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let value = 0;
        if (channels === 1) {
          value = raw[p++] || 0;
        } else if (channels >= 3) {
          const r = raw[p++] || 0;
          const g = raw[p++] || 0;
          const b = raw[p++] || 0;
          if (channels === 4) p++; // skip alpha
          // Convert RGB to luminance as fallback when NDWI single-band isn't provided
          value = 0.299 * r + 0.587 * g + 0.114 * b;
        } else {
          // Unexpected channel count — read first channel
          value = raw[p++] || 0;
        }
        grid[y][x] = value;
      }
    }
    // No georeferencing; caller may supply bbox mapping
    console.log(`[readRasterGrid] Generated grid: ${width}x${height}`);
    return { grid, width, height, bbox: null };
  } catch (e) {
    console.error('Failed to read raster with sharp:', e?.message || e);
    console.error('File size:', buffer.length, 'First 100 bytes:', buffer.slice(0, 100).toString('hex'));
    throw new Error('Unable to read image file: ' + e?.message);
  }
}

function contoursToPolygons(contours, width, height, bbox) {
  const polygons = [];
  for (const contour of contours) {
    if (!contour || contour.length < 3) continue;
    const coords = contour.map(([x, y]) => {
      if (bbox) {
        const [minX, minY, maxX, maxY] = bbox;
        const lon = minX + (x / width) * (maxX - minX);
        const lat = maxY - (y / height) * (maxY - minY);
        return [lon, lat];
      }
      return [x, y];
    });
    if (coords.length > 0 && (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1])) {
      coords.push(coords[0]);
    }
    try {
      const poly = turf.polygon([coords]);
      polygons.push(poly);
    } catch (e) {
      continue;
    }
  }
  return polygons;
}

export async function generatePolygons({ filename, threshold = 128, minArea = 10, bbox: suppliedBbox = null }) {
  // Infer sensor from filename for parameter tuning
  let effectiveThreshold = threshold;
  let effectiveMinArea = minArea;
  let sensorLabel = 'unknown';
  for (const [sensorId, preset] of Object.entries(SENSOR_PRESETS)) {
    if (filename.includes(sensorId)) {
      effectiveThreshold = preset.threshold;
      effectiveMinArea = preset.minArea;
      sensorLabel = preset.label;
      console.log(`[generatePolygons] Detected sensor: ${sensorId}, using preset threshold=${effectiveThreshold}, minArea=${effectiveMinArea}`);
      break;
    }
  }

  console.log(`[generatePolygons] Starting with filename=${filename}, threshold=${effectiveThreshold}, minArea=${effectiveMinArea}, sensor=${sensorLabel}`);
  const { grid, width, height, bbox } = await readRasterGrid(filename);
  console.log(`[generatePolygons] Grid loaded: ${width}x${height}`);

  // Use MarchingSquares to extract contours at threshold
  const contours = MarchingSquares.isoContours(grid, effectiveThreshold);
  console.log(`[generatePolygons] Found ${contours.length} contours at threshold ${effectiveThreshold}`);

  // Sanity guard: if we get an enormous number of contours, likely noise/grid artifacts
  if (contours.length > 500) {
    console.warn('[generatePolygons] Aborting: too many contours detected (>500) — likely raster noise');
    return turf.featureCollection([]);
  }

  const effectiveBbox = bbox || suppliedBbox || null;
  const rawPolygons = contoursToPolygons(contours, width, height, effectiveBbox);
  console.log(`[generatePolygons] Converted to ${rawPolygons.length} polygons`);

  // Filter by area
  let features = rawPolygons
    .map((p) => ({ feature: p, area: turf.area(p) }))
    .filter((x) => x.area >= effectiveMinArea)
    .map((x) => x.feature);

  console.log(`[generatePolygons] Filtered to ${features.length} features with area >= ${effectiveMinArea}`);

  // If a bbox was provided, compute coverage and abort if it is unreasonably large
  if (effectiveBbox && features.length > 0) {
    try {
      const bboxPoly = turf.bboxPolygon(effectiveBbox);
      const bboxArea = turf.area(bboxPoly) || 0.000001;
      const totalArea = features.reduce((s, f) => s + turf.area(f), 0);
      const coverage = totalArea / bboxArea;
      console.log(`[generatePolygons] Detected total polygon area ${totalArea.toFixed(2)} m^2, bbox area ${bboxArea.toFixed(2)} m^2, coverage ${(coverage * 100).toFixed(2)}%`);
      if (coverage > 0.30) {
        console.warn('[generatePolygons] Aborting: polygon coverage > 30% of bbox — likely noise');
        return turf.featureCollection([]);
      }
    } catch (e) {
      console.warn('Failed to compute bbox coverage:', e?.message || e);
    }
  }

  // Merge overlapping detections to reduce redundancy
  if (features.length > 1) {
    features = mergeOverlappingPolygons(features, 0.1);
    console.log(`[generatePolygons] After merging overlaps: ${features.length} features`);
  }

  // Return features as a FeatureCollection
  const result = turf.featureCollection(features.map((f) => (f.geometry ? f : f)));
  console.log(`[generatePolygons] Returning feature collection with ${result.features.length} features`);
  return result;
}
