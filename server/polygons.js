import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import * as MarchingSquares from 'marchingsquares';
import * as turf from '@turf/turf';

const DATA_DIR = path.join(process.cwd(), 'data');

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
    
    const raw = await img.ensureAlpha().raw().toBuffer();
    const channels = metadata.channels || 3;
    const grid = new Array(height);
    for (let y = 0; y < height; y++) grid[y] = new Array(width);
    let p = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const r = raw[p++] || 0;
        const g = raw[p++] || 0;
        const b = raw[p++] || 0;
        if (channels === 4) p++; // skip alpha
        grid[y][x] = 0.299 * r + 0.587 * g + 0.114 * b;
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
  console.log(`[generatePolygons] Starting with filename=${filename}, threshold=${threshold}, minArea=${minArea}`);
  const { grid, width, height, bbox } = await readRasterGrid(filename);
  console.log(`[generatePolygons] Grid loaded: ${width}x${height}`);

  // Use MarchingSquares to extract contours at threshold
  const contours = MarchingSquares.isoContours(grid, threshold);
  console.log(`[generatePolygons] Found ${contours.length} contours at threshold ${threshold}`);

  const effectiveBbox = bbox || suppliedBbox || null;
  const rawPolygons = contoursToPolygons(contours, width, height, effectiveBbox);
  console.log(`[generatePolygons] Converted to ${rawPolygons.length} polygons`);

  const features = rawPolygons
    .map((p) => ({ feature: p, area: turf.area(p) }))
    .filter((x) => x.area >= minArea)
    .map((x) => x.feature);
  
  console.log(`[generatePolygons] Filtered to ${features.length} features with area >= ${minArea}`);

  const result = turf.featureCollection(features.map((f) => (f.geometry ? f : f)));
  console.log(`[generatePolygons] Returning feature collection with ${result.features.length} features`);
  return result;
}
