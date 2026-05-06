#!/usr/bin/env node
/**
 * Fetch POIs from two sources and write src/data/pois.json.
 *
 *   Geoapify  → camping, hostel, supermarket, water (OSM data, best rural coverage)
 *   Google    → hotel, restaurant (best accuracy, reviews, opening hours)
 *
 * Usage:
 *   GEOAPIFY_KEY=xxx GOOGLE_KEY=xxx node scripts/fetch-pois.mjs
 *
 * Get keys:
 *   Geoapify : https://myprojects.geoapify.com  (free tier: 3 000 req/day)
 *   Google   : https://console.cloud.google.com → enable "Places API"
 *              (free tier: $200 credit/month, this script costs ~$0.50)
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const GEOAPIFY_KEY = process.env.GEOAPIFY_KEY;
const GOOGLE_KEY   = process.env.GOOGLE_KEY;

if (!GEOAPIFY_KEY) { console.error('Missing GEOAPIFY_KEY env var'); process.exit(1); }
if (!GOOGLE_KEY)   { console.warn('No GOOGLE_KEY — skipping hotels & restaurants (add later to enrich data)'); }

const GPX_FILES = [
  { id: 1, name: '7S26.1 — Slovenia',     file: '7S26_1 - Slovenia.gpx' },
  { id: 2, name: '7S26.2 — Velebit',      file: '7S26_2 - Velebit.gpx' },
  { id: 3, name: '7S26.3 — Pag',          file: '7S26_3 - Pag.gpx' },
  { id: 4, name: '7S26.4 — Rab',          file: '7S26_4 - Rab.gpx' },
  { id: 5, name: '7S26.5 — Krk',          file: '7S26_5 - Krk.gpx' },
  { id: 6, name: '7S26.6 — Cres',         file: '7S26_6 - Cres.gpx' },
  { id: 7, name: '7S26.7 — Učka/Trieste', file: '7S26_7 - Ucka_Trieste.gpx' },
];

const RADIUS_M        = 1000;
const BBOX_BUFFER_DEG = 0.018;  // ~2 km
const SAMPLE_KM_FINE  = 0.5;    // for client-side radius check
const SAMPLE_KM_GOOGLE = 8;     // Google query spacing (5 km radius covers overlap)
const GOOGLE_RADIUS_M = 5000;   // wider than route radius so nothing at corners is missed

// ── GPX ───────────────────────────────────────────────────────────────────

function parseGPXPoints(xml) {
  const points = [];
  const re = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"/g;
  let m;
  while ((m = re.exec(xml)) !== null) points.push({ lat: parseFloat(m[1]), lon: parseFloat(m[2]) });
  return points;
}

// ── Geo helpers ───────────────────────────────────────────────────────────

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function samplePoints(points, intervalKm) {
  if (!points.length) return [];
  const result = [points[0]];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    acc += haversineKm(points[i - 1], points[i]);
    if (acc >= intervalKm) { result.push(points[i]); acc = 0; }
  }
  const last = points[points.length - 1];
  if (result.at(-1) !== last) result.push(last);
  return result;
}

function getBbox(points) {
  const lats = points.map(p => p.lat), lons = points.map(p => p.lon);
  return {
    minLat: Math.min(...lats) - BBOX_BUFFER_DEG,
    maxLat: Math.max(...lats) + BBOX_BUFFER_DEG,
    minLon: Math.min(...lons) - BBOX_BUFFER_DEG,
    maxLon: Math.max(...lons) + BBOX_BUFFER_DEG,
  };
}

function withinRadius(poi, samples) {
  return samples.some(pt => haversineKm(pt, poi) <= RADIUS_M / 1000);
}

// Two POIs in the same category within 80 m are considered duplicates.
function isDuplicate(poi, existing) {
  return existing.some(e => e.category === poi.category && haversineKm(e, poi) < 0.08);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Overpass (mountain huts) ──────────────────────────────────────────────
// Covers: alpine_hut, wilderness_hut, lean_to, shelter
// Data source: OpenStreetMap via public Overpass mirrors

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

function overpassBbox(points) {
  const lats = points.map(p => p.lat), lons = points.map(p => p.lon);
  const buf = BBOX_BUFFER_DEG;
  return `${Math.min(...lats) - buf},${Math.min(...lons) - buf},${Math.max(...lats) + buf},${Math.max(...lons) + buf}`;
}

async function fetchOverpassHuts(points) {
  const bbox = overpassBbox(points);
  const query = `[out:json][timeout:30];
(
  node["tourism"~"^(alpine_hut|wilderness_hut|lean_to|shelter)$"](${bbox});
  way["tourism"~"^(alpine_hut|wilderness_hut|lean_to|shelter)$"](${bbox});
  node["amenity"="shelter"](${bbox});
);
out center;`;

  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'seven-serpents-route-planner/1.0 (bikepacking route app)',
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!resp.ok) continue;
      const json = await resp.json();
      if (json.remark?.includes('timed out') || json.remark?.includes('quota')) continue;

      const pois = [];
      for (const el of json.elements ?? []) {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (lat == null || lon == null) continue;
        const tags = el.tags ?? {};
        const name = tags.name ?? tags['name:en'] ?? tags['name:hr'] ?? tags['name:sl'] ?? 'Mountain hut';
        pois.push({
          id: `osm-${el.type}-${el.id}`,
          lat, lon, name,
          category: 'hut',
          source: 'overpass',
          ...(tags.website   ? { website: tags.website }           : {}),
          ...(tags.phone     ? { phone: tags.phone }               : {}),
          ...(tags['contact:phone'] ? { phone: tags['contact:phone'] } : {}),
        });
      }
      return pois;
    } catch { /* try next mirror */ }
  }
  console.warn('  Overpass: all mirrors failed, skipping huts');
  return [];
}

// ── Geoapify ──────────────────────────────────────────────────────────────
// Covers: camping, hostel, supermarket, drinking water
// Data source: OpenStreetMap (best for rural / outdoor categories)

const GEOAPIFY_CATEGORIES = [
  'camping.camp_site',
  'camping.caravan_site',
  'accommodation.hostel',
  'accommodation.hotel',
  'accommodation.guest_house',
  'catering.restaurant',
  'catering.fast_food',
  'catering.cafe',
  'commercial.food_and_drink.bakery',
  'commercial.supermarket',
  'commercial.convenience',
  'amenity.drinking_water',
].join(',');

function geoapifyCategory(cats) {
  if (!cats) return null;
  const c = Array.isArray(cats) ? cats.join(',') : String(cats);
  if (c.includes('camping'))        return 'camping';
  if (c.includes('hostel'))         return 'hostel';
  if (c.includes('hotel') || c.includes('guest_house')) return 'hotel';
  if (c.includes('food_and_drink.bakery') || c.includes('food_and_drink.pastry')) return 'bakery';
  if (c.includes('restaurant') || c.includes('fast_food') || c.includes('cafe')) return 'restaurant';
  if (c.includes('supermarket') || c.includes('convenience')) return 'supermarket';
  if (c.includes('drinking_water')) return 'water';
  return null;
}

// Query in 20 km chunks so the 500-result limit is applied locally, not globally.
// A single bbox over a 300 km route fills the limit with city POIs and misses rural areas.
const GEOAPIFY_CHUNK_KM = 20;
const GEOAPIFY_CHUNK_BUFFER_DEG = 0.18; // ~20 km buffer around each chunk centre

async function fetchGeoapify(points) {
  const chunkCentres = samplePoints(points, GEOAPIFY_CHUNK_KM);
  const pois = [];
  const seenIds = new Set();

  for (const centre of chunkCentres) {
    const buf = GEOAPIFY_CHUNK_BUFFER_DEG;
    const filter = `rect:${centre.lon - buf},${centre.lat - buf},${centre.lon + buf},${centre.lat + buf}`;
    const url = `https://api.geoapify.com/v2/places?categories=${GEOAPIFY_CATEGORIES}&filter=${filter}&limit=500&apiKey=${GEOAPIFY_KEY}`;

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Geoapify HTTP ${resp.status}: ${await resp.text()}`);
    const json = await resp.json();

    for (const f of json.features ?? []) {
      const [lon, lat] = f.geometry.coordinates;
      const p = f.properties;
      if (seenIds.has(p.place_id)) continue;
      seenIds.add(p.place_id);
      const category = geoapifyCategory(p.categories);
      if (!category) continue;

      const poi = {
        id:       `geo-${p.place_id}`,
        lat, lon,
        name:     p.name || category,
        category,
        source:   'geoapify',
      };
      if (p.website)                poi.website      = p.website;
      if (p.contact?.phone)         poi.phone        = p.contact.phone;
      if (p.opening_hours)          poi.openingHours = p.opening_hours;
      pois.push(poi);
    }

    await sleep(200);
  }
  return pois;
}

// ── Google Places ─────────────────────────────────────────────────────────
// Covers: hotel, restaurant
// Data source: Google Maps (best accuracy for commercial POIs)

function googleCategory(types) {
  if (!types) return null;
  if (types.includes('lodging'))     return 'hotel';
  if (types.includes('restaurant'))  return 'restaurant';
  if (types.includes('cafe'))        return 'restaurant';
  if (types.includes('bar'))         return 'restaurant';
  return null;
}

async function fetchGooglePage(lat, lon, type, pageToken) {
  let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lon}&radius=${GOOGLE_RADIUS_M}&type=${type}&key=${GOOGLE_KEY}`;
  if (pageToken) url += `&pagetoken=${pageToken}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Google Places HTTP ${resp.status}`);
  return resp.json();
}

async function fetchGoogleAlongRoute(points, type) {
  const samples = samplePoints(points, SAMPLE_KM_GOOGLE);
  const seen = new Set();
  const pois = [];

  for (const pt of samples) {
    let pageToken = null;
    do {
      if (pageToken) await sleep(2000); // Google requires a delay before using page tokens
      const json = await fetchGooglePage(pt.lat, pt.lon, type, pageToken);

      if (json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
        console.warn(`  Google ${type} warning: ${json.status} — ${json.error_message ?? ''}`);
        break;
      }

      for (const r of json.results ?? []) {
        if (seen.has(r.place_id)) continue;
        seen.add(r.place_id);
        const category = googleCategory(r.types);
        if (!category) continue;
        pois.push({
          id:       `goog-${r.place_id}`,
          lat:      r.geometry.location.lat,
          lon:      r.geometry.location.lng,
          name:     r.name,
          category,
          source:   'google',
          // Google Maps deep link — opens directly to the place
          website:  `https://www.google.com/maps/place/?q=place_id:${r.place_id}`,
          openingHours: r.opening_hours?.open_now != null
            ? (r.opening_hours.open_now ? 'Open now' : 'Closed now')
            : undefined,
        });
      }

      pageToken = json.next_page_token ?? null;
    } while (pageToken);

    await sleep(200); // be polite between location queries
  }

  return pois;
}

// ── Main ──────────────────────────────────────────────────────────────────

const all = [];
const seen = new Set();

function addPOI(poi, samples) {
  if (!withinRadius(poi, samples)) return;
  if (seen.has(poi.id)) return;
  if (isDuplicate(poi, all)) return;
  seen.add(poi.id);
  // Strip internal source field before saving
  const { source: _, ...clean } = poi;
  all.push(clean);
}

for (const src of GPX_FILES) {
  console.log(`\n[${src.id}/7] ${src.name}`);

  const xml    = readFileSync(join(ROOT, 'public', 'gpx', src.file), 'utf8');
  const points = parseGPXPoints(xml);
  const samples = samplePoints(points, SAMPLE_KM_FINE);
  console.log(`  ${points.length} track points, ${samples.length} radius-check samples`);

  // Overpass — mountain huts
  process.stdout.write('  Overpass (alpine huts/shelters)… ');
  const hutPOIs = await fetchOverpassHuts(points);
  let hutsAdded = 0;
  for (const poi of hutPOIs) { const before = all.length; addPOI(poi, samples); if (all.length > before) hutsAdded++; }
  console.log(`${hutsAdded} added`);

  await sleep(1000);

  // Geoapify
  process.stdout.write('  Geoapify (camping/hostel/supermarket/water)… ');
  const geoPOIs = await fetchGeoapify(points);
  let geoAdded = 0;
  for (const poi of geoPOIs) { const before = all.length; addPOI(poi, samples); if (all.length > before) geoAdded++; }
  console.log(`${geoAdded} added`);

  if (GOOGLE_KEY) {
    // Google — hotels
    process.stdout.write('  Google Places (hotels)… ');
    const hotels = await fetchGoogleAlongRoute(points, 'lodging');
    let hotelsAdded = 0;
    for (const poi of hotels) { const before = all.length; addPOI(poi, samples); if (all.length > before) hotelsAdded++; }
    console.log(`${hotelsAdded} added`);

    await sleep(500);

    // Google — restaurants
    process.stdout.write('  Google Places (restaurants)… ');
    const restaurants = await fetchGoogleAlongRoute(points, 'restaurant');
    let restAdded = 0;
    for (const poi of restaurants) { const before = all.length; addPOI(poi, samples); if (all.length > before) restAdded++; }
    console.log(`${restAdded} added`);
  }

  console.log(`  Segment total so far: ${all.length} POIs`);

  if (src.id < GPX_FILES.length) await sleep(1000);
}

const outPath = join(ROOT, 'src', 'data', 'pois.json');
writeFileSync(outPath, JSON.stringify(all, null, 2));
console.log(`\nDone. Wrote ${all.length} POIs to src/data/pois.json`);
