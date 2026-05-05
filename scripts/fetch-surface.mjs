#!/usr/bin/env node
/**
 * Classify each GPX track point as on-road or off-road by snapping to
 * nearby OSM ways via Overpass, then write src/data/surface.json.
 *
 * Usage:
 *   node scripts/fetch-surface.mjs
 *
 * No API keys required — uses the public Overpass API.
 *
 * Output format:
 *   { "1": [[start_km, end_km], ...], "2": [...], ... }
 *   Each array contains [start, end] km ranges that are OFF-ROAD.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const GPX_FILES = [
  { id: 1, file: '7S26_1 - Slovenia.gpx' },
  { id: 2, file: '7S26_2 - Velebit.gpx' },
  { id: 3, file: '7S26_3 - Pag.gpx' },
  { id: 4, file: '7S26_4 - Rab.gpx' },
  { id: 5, file: '7S26_5 - Krk.gpx' },
  { id: 6, file: '7S26_6 - Cres.gpx' },
  { id: 7, file: '7S26_7 - Ucka_Trieste.gpx' },
];

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
];

// Ways where we ride off-road
const OFF_ROAD_HIGHWAYS = new Set(['track', 'path', 'bridleway', 'footway']);
// Surfaces that override highway classification → definitely off-road
const OFF_ROAD_SURFACES = new Set(['unpaved', 'gravel', 'dirt', 'grass', 'ground', 'sand', 'compacted', 'fine_gravel', 'pebblestone', 'earth', 'mud']);
// Surfaces that override → definitely on-road
const ON_ROAD_SURFACES  = new Set(['paved', 'asphalt', 'concrete', 'cobblestone', 'paving_stones', 'sett', 'metal']);

const SNAP_THRESHOLD_M  = 20;   // only consider ways within 20 m
const SMOOTH_WINDOW_PTS = 15;   // smooth out short noise bursts
const MIN_SECTION_KM    = 0.15; // drop off-road sections shorter than 150 m

// ── Geo helpers ───────────────────────────────────────────────────────────

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

// Approximate distance in metres from point P to line segment AB (using flat-earth)
function distToSegmentM(p, a, b) {
  const cos = Math.cos((p.lat + a.lat) / 2 * Math.PI / 180);
  const px = (p.lon - a.lon) * cos, py = p.lat - a.lat;
  const ax = 0, ay = 0;
  const bx = (b.lon - a.lon) * cos, by = b.lat - a.lat;
  const len2 = bx * bx + by * by;
  let t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
  const dx = px - ax - t * bx, dy = py - ay - t * by;
  return Math.sqrt(dx * dx + dy * dy) * 111320;
}

function parseGPX(xml) {
  const re = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"/g;
  const pts = []; let m;
  while ((m = re.exec(xml)) !== null) pts.push({ lat: parseFloat(m[1]), lon: parseFloat(m[2]) });
  return pts;
}

function getBbox(pts, buf = 0.02) {
  const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
  return `${Math.min(...lats)-buf},${Math.min(...lons)-buf},${Math.max(...lats)+buf},${Math.max(...lons)+buf}`;
}

function samplePoints(pts, intervalKm) {
  const r = [pts[0]]; let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += haversineKm(pts[i-1], pts[i]);
    if (acc >= intervalKm) { r.push(pts[i]); acc = 0; }
  }
  if (r[r.length - 1] !== pts[pts.length - 1]) r.push(pts[pts.length - 1]);
  return r;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Overpass ──────────────────────────────────────────────────────────────

async function queryOverpass(query) {
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'seven-serpents-route-planner/1.0 (bikepacking route app)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(60000),
      });
      if (!resp.ok) continue;
      const json = await resp.json();
      if (json.remark?.includes('timed out') || json.remark?.includes('quota')) continue;
      return json.elements ?? [];
    } catch { /* try next */ }
  }
  throw new Error('All Overpass mirrors failed');
}

// Fetch all way geometries with highway/surface tags for a bbox chunk
async function fetchWays(bbox) {
  const query = `[out:json][timeout:55];
(
  way["highway"](${bbox});
  way["surface"](${bbox});
);
out geom qt;`;
  return queryOverpass(query);
}

// ── Classification ────────────────────────────────────────────────────────

function classifyWay(tags) {
  const hw = tags.highway ?? '';
  const sf = tags.surface ?? '';
  if (ON_ROAD_SURFACES.has(sf))  return 'onroad';
  if (OFF_ROAD_SURFACES.has(sf)) return 'offroad';
  if (OFF_ROAD_HIGHWAYS.has(hw)) return 'offroad';
  // Residential/service/cycleway without explicit surface → assume on-road
  return 'onroad';
}

// For each GPX point, find the closest way within SNAP_THRESHOLD_M and
// return 'offroad' | 'onroad' | 'unknown'
function labelPoints(pts, ways) {
  // Pre-process ways into segments for fast lookup
  const segments = [];
  for (const way of ways) {
    const cls = classifyWay(way.tags ?? {});
    const nodes = way.geometry ?? [];
    for (let i = 1; i < nodes.length; i++) {
      segments.push({ a: nodes[i-1], b: nodes[i], cls });
    }
  }

  return pts.map(p => {
    let minDist = Infinity, nearest = 'unknown';
    for (const { a, b, cls } of segments) {
      // Quick lat/lon bbox pre-filter
      const minLat = Math.min(a.lat, b.lat) - 0.001;
      const maxLat = Math.max(a.lat, b.lat) + 0.001;
      const minLon = Math.min(a.lon, b.lon) - 0.001;
      const maxLon = Math.max(a.lon, b.lon) + 0.001;
      if (p.lat < minLat || p.lat > maxLat || p.lon < minLon || p.lon > maxLon) continue;
      const d = distToSegmentM(p, a, b);
      if (d < minDist) { minDist = d; nearest = cls; }
    }
    return minDist <= SNAP_THRESHOLD_M ? nearest : 'unknown';
  });
}

// Majority-vote smoothing over a window to remove noise
function smoothLabels(labels) {
  const W = SMOOTH_WINDOW_PTS;
  return labels.map((_, i) => {
    const slice = labels.slice(Math.max(0, i - W), Math.min(labels.length, i + W + 1));
    const offCount = slice.filter(l => l === 'offroad').length;
    return offCount > slice.length / 2 ? 'offroad' : 'onroad';
  });
}

// Convert label array + distances to [start_km, end_km] off-road ranges
function toOffRoadRanges(pts, labels) {
  let cumDist = 0;
  const dists = [0];
  for (let i = 1; i < pts.length; i++) {
    cumDist += haversineKm(pts[i-1], pts[i]);
    dists.push(cumDist);
  }

  const ranges = [];
  let start = null;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === 'offroad' && start === null) start = dists[i];
    if (labels[i] !== 'offroad' && start !== null) {
      if (dists[i] - start >= MIN_SECTION_KM) ranges.push([+start.toFixed(2), +dists[i].toFixed(2)]);
      start = null;
    }
  }
  if (start !== null && cumDist - start >= MIN_SECTION_KM) {
    ranges.push([+start.toFixed(2), +cumDist.toFixed(2)]);
  }
  return ranges;
}

// ── Main ──────────────────────────────────────────────────────────────────

// Optional: --segments 3,7  to only re-process specific segment IDs
const onlyIds = process.argv.includes('--segments')
  ? process.argv[process.argv.indexOf('--segments') + 1].split(',').map(Number)
  : null;

const outPath = join(ROOT, 'src', 'data', 'surface.json');
let result = {};
try { result = JSON.parse(readFileSync(outPath, 'utf8')); } catch { /* first run */ }

for (const src of GPX_FILES) {
  if (onlyIds && !onlyIds.includes(src.id)) continue;
  console.log(`\n[${src.id}/7] ${src.file}`);
  const xml = readFileSync(join(ROOT, 'public', 'gpx', src.file), 'utf8');
  const pts = parseGPX(xml);
  console.log(`  ${pts.length} track points`);

  // Query Overpass in 30 km chunks to avoid timeouts on large bbox
  const chunkCentres = samplePoints(pts, 30);
  const allWays = [];
  const seenWayIds = new Set();
  const CHUNK_BUF = 0.27; // ~30 km buffer around each chunk centre

  for (let i = 0; i < chunkCentres.length; i++) {
    const c = chunkCentres[i];
    const bbox = `${c.lat-CHUNK_BUF},${c.lon-CHUNK_BUF},${c.lat+CHUNK_BUF},${c.lon+CHUNK_BUF}`;
    process.stdout.write(`  Chunk ${i+1}/${chunkCentres.length}… `);
    try {
      const ways = await fetchWays(bbox);
      let added = 0;
      for (const w of ways) {
        if (!seenWayIds.has(w.id)) { seenWayIds.add(w.id); allWays.push(w); added++; }
      }
      console.log(`${added} new ways (${allWays.length} total)`);
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
    }
    if (i < chunkCentres.length - 1) await sleep(1200);
  }

  console.log(`  Labelling ${pts.length} points against ${allWays.length} ways…`);
  const rawLabels = labelPoints(pts, allWays);
  const smoothed  = smoothLabels(rawLabels);
  const ranges    = toOffRoadRanges(pts, smoothed);

  const offRoadKm = ranges.reduce((s, [a, b]) => s + b - a, 0);
  const totalKm   = ranges.length ? ranges[ranges.length-1][1] : 0;
  console.log(`  Off-road sections: ${ranges.length}  (${offRoadKm.toFixed(1)} km off-road)`);

  result[src.id] = ranges;
  if (src.id < GPX_FILES.length) await sleep(2000);
}

writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(`\nDone. Wrote ${outPath}`);
