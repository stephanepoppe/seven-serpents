import type { TrackPoint, Waypoint } from '../types';

export function parseGPX(xml: string): { points: TrackPoint[]; waypoints: Waypoint[] } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');

  const points: TrackPoint[] = Array.from(doc.querySelectorAll('trkpt')).map(pt => ({
    lat: parseFloat(pt.getAttribute('lat')!),
    lon: parseFloat(pt.getAttribute('lon')!),
    ele: parseFloat(pt.querySelector('ele')?.textContent ?? 'NaN') || undefined,
  }));

  const waypoints: Waypoint[] = Array.from(doc.querySelectorAll('wpt')).map(wpt => ({
    lat: parseFloat(wpt.getAttribute('lat')!),
    lon: parseFloat(wpt.getAttribute('lon')!),
    name: wpt.querySelector('name')?.textContent ?? '',
    sym: wpt.querySelector('sym')?.textContent ?? undefined,
  }));

  return { points, waypoints };
}

export function haversineKm(a: TrackPoint, b: TrackPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

export function calcDistance(points: TrackPoint[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversineKm(points[i - 1], points[i]);
  return d;
}

export function calcElevationGain(points: TrackPoint[]): number {
  let gain = 0;
  for (let i = 1; i < points.length; i++) {
    const diff = (points[i].ele ?? 0) - (points[i - 1].ele ?? 0);
    if (diff > 0) gain += diff;
  }
  return gain;
}

export function downsample(points: TrackPoint[], max: number): TrackPoint[] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  return points.filter((_, i) => i % step === 0 || i === points.length - 1);
}
