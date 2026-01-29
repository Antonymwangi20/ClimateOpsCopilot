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

  // Use sharp (supports GeoTIFF, PNG, JPEG etc.) and produce luminance grid
  try {
    const img = sharp(buffer).ensureAlpha();
    const metadata = await img.metadata();
    const { width, height } = metadata;
    if (!width || !height) throw new Error('Unable to get image dimensions');
    const raw = await img.raw().toBuffer();
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
    return { grid, width, height, bbox: null };
  } catch (e) {
    console.error('Failed to read raster with sharp:', e?.message || e);
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
  const { grid, width, height, bbox } = await readRasterGrid(filename);

  // Use MarchingSquares to extract contours at threshold
  const contours = MarchingSquares.isoContours(grid, threshold);

  const effectiveBbox = bbox || suppliedBbox || null;
  const rawPolygons = contoursToPolygons(contours, width, height, effectiveBbox);

  const features = rawPolygons
    .map((p) => ({ feature: p, area: turf.area(p) }))
    .filter((x) => x.area >= minArea)
    .map((x) => x.feature);

  return turf.featureCollection(features.map((f) => (f.geometry ? f : f)));
}
