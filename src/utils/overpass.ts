import type { POI, POICategory, TrackPoint } from '../types';
import { haversineKm } from './gpxParser';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
];

const CACHE_KEY = 'poi_cache_v2';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Bounding box with a small buffer — fast for Overpass (just a range check).
function getBbox(points: TrackPoint[], bufferDeg = 0.018): string {
  const lats = points.map(p => p.lat);
  const lons = points.map(p => p.lon);
  return [
    Math.min(...lats) - bufferDeg,
    Math.min(...lons) - bufferDeg,
    Math.max(...lats) + bufferDeg,
    Math.max(...lons) + bufferDeg,
  ].join(',');
}

// Client-side filter: keep POIs within radiusM of any sampled route point.
function withinRadius(poi: POI, samples: TrackPoint[], radiusM: number): boolean {
  const radiusKm = radiusM / 1000;
  for (const pt of samples) {
    if (haversineKm(pt, poi) <= radiusKm) return true;
  }
  return false;
}

// Sample every intervalKm so the radius check stays fast.
function sampleRoutePoints(points: TrackPoint[], intervalKm: number): TrackPoint[] {
  if (points.length === 0) return [];
  const result: TrackPoint[] = [points[0]];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    acc += haversineKm(points[i - 1], points[i]);
    if (acc >= intervalKm) { result.push(points[i]); acc = 0; }
  }
  const last = points[points.length - 1];
  if (result[result.length - 1] !== last) result.push(last);
  return result;
}

function detectCategory(tags: Record<string, string>): POICategory | null {
  if (tags.tourism === 'camp_site') return 'camping';
  if (tags.tourism === 'hostel') return 'hostel';
  if (tags.tourism === 'hotel' || tags.tourism === 'motel') return 'hotel';
  if (['restaurant', 'fast_food', 'cafe', 'bar'].includes(tags.amenity)) return 'restaurant';
  if (['supermarket', 'convenience', 'grocery'].includes(tags.shop)) return 'supermarket';
  if (tags.amenity === 'drinking_water' || tags.natural === 'spring') return 'water';
  return null;
}

function buildQuery(bbox: string): string {
  return `[out:json][timeout:25];
(
  node["tourism"~"^(camp_site|hostel|hotel|motel)$"](${bbox});
  way["tourism"~"^(camp_site|hostel|hotel|motel)$"](${bbox});
  node["amenity"~"^(restaurant|fast_food|cafe|bar|drinking_water)$"](${bbox});
  node["shop"~"^(supermarket|convenience|grocery)$"](${bbox});
  node["natural"="spring"]["drinking_water"!="no"](${bbox});
);
out center;`;
}

async function queryWithFallback(query: string): Promise<POI[]> {
  let lastErr = '';

  for (const url of ENDPOINTS) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });

      if (!resp.ok) { lastErr = `HTTP ${resp.status} from ${url}`; continue; }

      const json = await resp.json();

      if (json.remark?.includes('timed out')) { lastErr = `Timeout on ${url}`; continue; }
      if (json.remark?.includes('quota')) { lastErr = `Quota on ${url}`; continue; }

      const pois: POI[] = [];
      for (const el of json.elements ?? []) {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (lat == null || lon == null) continue;
        const tags: Record<string, string> = el.tags ?? {};
        const category = detectCategory(tags);
        if (!category) continue;
        pois.push({
          id: `${el.type}-${el.id}`,
          lat, lon,
          name: tags.name ?? tags['name:en'] ?? tags['name:hr'] ?? category,
          category,
          tags,
        });
      }
      return pois;
    } catch {
      lastErr = `Network error on ${url}`;
    }
  }

  throw new Error(`All Overpass mirrors failed. Last: ${lastErr}`);
}

// ── Cache ──────────────────────────────────────────────────────────────────

interface CacheEntry { pois: POI[]; savedAt: number; cacheKey: string; }

function cacheKey(ids: number[]): string { return ids.join('-'); }

export function loadCachedPOIs(segmentIds: number[]): POI[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (entry.cacheKey !== cacheKey(segmentIds)) return null;
    if (Date.now() - entry.savedAt > CACHE_TTL_MS) return null;
    return entry.pois;
  } catch { return null; }
}

function saveCachedPOIs(ids: number[], pois: POI[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ pois, savedAt: Date.now(), cacheKey: cacheKey(ids) }));
  } catch { /* localStorage full */ }
}

export function clearPOICache(): void {
  localStorage.removeItem(CACHE_KEY);
}

// ── Main export ────────────────────────────────────────────────────────────

export async function fetchPOIs(
  segments: { id: number; points: TrackPoint[] }[],
  radiusM = 1000,
  onProgress?: (done: number, total: number) => void,
): Promise<POI[]> {
  const ids = segments.map(s => s.id);
  const cached = loadCachedPOIs(ids);
  if (cached) { onProgress?.(segments.length, segments.length); return cached; }

  const seen = new Set<string>();
  const all: POI[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const bbox = getBbox(seg.points);
    const query = buildQuery(bbox);

    const raw = await queryWithFallback(query);

    // Filter client-side to 1 km of actual route — bbox may include extra corners.
    const samples = sampleRoutePoints(seg.points, 0.5); // sample every 500 m for accuracy
    for (const poi of raw) {
      if (!seen.has(poi.id) && withinRadius(poi, samples, radiusM)) {
        seen.add(poi.id);
        all.push(poi);
      }
    }

    onProgress?.(i + 1, segments.length);
    if (i < segments.length - 1) await new Promise(r => setTimeout(r, 800));
  }

  saveCachedPOIs(ids, all);
  return all;
}
