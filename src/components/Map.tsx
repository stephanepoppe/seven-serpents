import { useEffect, useRef, useMemo, useCallback } from 'react';
import ferryData from '../data/ferries.json';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Segment, POI, POICategory, Ferry, TrackPoint } from '../types';
import { haversineKm } from '../utils/gpxParser';

// Fix Leaflet default icon paths broken by bundlers
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

const POI_EMOJIS: Record<POICategory, string> = {
  camping:    '🏕️',
  hostel:     '🏠',
  hotel:      '🏨',
  restaurant: '🍴',
  supermarket:'🛒',
  water:      '💧',
  hut:        '🛖',
};

function poiIcon(category: POICategory) {
  return L.divIcon({
    html: `<span style="font-size:18px;line-height:1;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.7))">${POI_EMOJIS[category]}</span>`,
    className: '',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

const ferryInfo = ferryData as Record<string, {
  from: string; to: string; operator: string; line: string;
  duration: number; note: string; lowSeason: string; highSeason: string;
  passengerFare: string; bikeFare: string;
}>;

function ferryPopup(ferry: Ferry): string {
  const key = `${ferry.fromSegmentId}-${ferry.toSegmentId}`;
  const info = ferryInfo[key];
  if (!info) return `<b>⛴️ Ferry</b><br>${ferry.fromName} → ${ferry.toName}<br>${ferry.distanceKm.toFixed(1)} km`;
  return `
    <b style="font-size:13px">⛴️ ${info.from} → ${info.to}</b><br>
    <span style="color:#555">${info.operator} · Line ${info.line}</span><br>
    <hr style="margin:4px 0;border-color:#eee">
    🕐 <b>${info.duration} min</b> &nbsp;|&nbsp; ${ferry.distanceKm.toFixed(1)} km<br>
    <br>
    <b style="color:#555">Low season:</b> ${info.lowSeason}<br>
    <b style="color:#555">High season:</b> ${info.highSeason}<br>
    <br>
    🚶 ${info.passengerFare} &nbsp;&nbsp; 🚲 ${info.bikeFare}<br>
    <span style="color:#888;font-size:10px">${info.note}</span>
  `.trim();
}

function ferryIcon() {
  return L.divIcon({
    html: `<span style="font-size:22px;line-height:1;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.7))">⛴️</span>`,
    className: '',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

interface Props {
  segments: Segment[];
  visibleSegments: Set<number>;
  pois: POI[];
  ferries: Ferry[];
  elevationHover?: { lat: number; lon: number } | null;
  surfaceData?: Record<string, [number, number][]>;
  onRouteHover?: (pt: { lat: number; lon: number } | null) => void;
}

export default function MapView({ segments, visibleSegments, pois, ferries, elevationHover, surfaceData, onRouteHover }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const poiLayerRef = useRef<L.LayerGroup | null>(null);
  const ferryLayerRef = useRef<L.LayerGroup | null>(null);
  const distLayerRef = useRef<L.LayerGroup | null>(null);
  const hoverMarkerRef = useRef<L.CircleMarker | null>(null);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [44.8, 14.8],
      zoom: 7,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 19,
    }).addTo(map);

    routeLayerRef.current = L.layerGroup().addTo(map);
    distLayerRef.current = L.layerGroup().addTo(map);
    poiLayerRef.current = L.layerGroup().addTo(map);
    ferryLayerRef.current = L.layerGroup().addTo(map);

    // Compass — static north-up (CartoDB Positron never rotates)
    const Compass = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div');
        div.innerHTML = `
          <svg width="72" height="72" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg"
            style="display:block;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.22))">
            <circle cx="36" cy="36" r="34" fill="white" stroke="#d0d0d0" stroke-width="1.5"/>
            <!-- Cardinal tick marks -->
            <line x1="36" y1="4"  x2="36" y2="11" stroke="#bbb" stroke-width="1.5"/>
            <line x1="36" y1="61" x2="36" y2="68" stroke="#bbb" stroke-width="1.5"/>
            <line x1="4"  y1="36" x2="11" y2="36" stroke="#bbb" stroke-width="1.5"/>
            <line x1="61" y1="36" x2="68" y2="36" stroke="#bbb" stroke-width="1.5"/>
            <!-- North needle (red) -->
            <polygon points="36,8 31,36 36,30 41,36" fill="#e74c3c"/>
            <!-- South needle (grey) -->
            <polygon points="36,64 31,36 36,42 41,36" fill="#888"/>
            <circle cx="36" cy="36" r="3.5" fill="#333"/>
            <!-- Cardinal labels -->
            <text x="36" y="20" text-anchor="middle" font-size="10" font-weight="700"
              font-family="sans-serif" fill="#e74c3c">N</text>
            <text x="36" y="58" text-anchor="middle" font-size="9"
              font-family="sans-serif" fill="#888">S</text>
            <text x="57" y="40" text-anchor="middle" font-size="9"
              font-family="sans-serif" fill="#888">E</text>
            <text x="15" y="40" text-anchor="middle" font-size="9"
              font-family="sans-serif" fill="#888">W</text>
          </svg>`;
        L.DomEvent.disableClickPropagation(div);
        return div;
      },
    });
    new Compass({ position: 'bottomright' }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update route lines
  useEffect(() => {
    const layer = routeLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    const bounds: L.LatLng[] = [];

    for (const seg of segments) {
      if (!visibleSegments.has(seg.id)) continue;
      const pts = seg.displayPoints;
      if (!pts.length) continue;

      const offRoadRanges: [number, number][] = surfaceData?.[seg.id] ?? [];

      // surface.json distances were computed from full-res seg.points.
      // Map each displayPoint back to its full-res cumulative distance so ranges match.
      const fullPts = seg.points.length ? seg.points : pts;
      const fullCumDists: number[] = [0];
      for (let i = 1; i < fullPts.length; i++) {
        fullCumDists.push(fullCumDists[i - 1] + haversineKm(fullPts[i - 1], fullPts[i]));
      }
      // displayPoints are sampled at evenly-spaced indices of fullPts
      const n = fullPts.length, maxPts = pts.length;
      const step = maxPts > 1 ? (n - 1) / (maxPts - 1) : 1;
      const cumDists: number[] = pts.map((_, i) => {
        const fullIdx = Math.min(n - 1, Math.round(i * step));
        return fullCumDists[fullIdx];
      });

      const isOffRoad = (d: number) => offRoadRanges.some(([a, b]) => d >= a && d <= b);

      // Split into runs of on-road / off-road points
      let runStart = 0;
      let runIsOff = isOffRoad(cumDists[0]);
      const popup = `<b style="color:${seg.color}">${seg.name}</b><br>${seg.distanceKm.toFixed(1)} km &nbsp;↑${Math.round(seg.elevationGainM)} m`;

      const flushRun = (end: number, off: boolean) => {
        const latlngs = pts.slice(runStart, end + 1).map(p => [p.lat, p.lon] as L.LatLngTuple);
        if (latlngs.length < 2) return;
        const line = L.polyline(latlngs, {
          color: seg.color,
          weight: off ? 2.5 : 3.5,
          opacity: off ? 0.85 : 0.9,
          dashArray: off ? '6 5' : undefined,
        }).bindPopup(popup);
        if (onRouteHover) {
          line.on('mousemove', (e: L.LeafletMouseEvent) => onRouteHover({ lat: e.latlng.lat, lon: e.latlng.lng }));
          line.on('mouseout', () => onRouteHover(null));
        }
        line.addTo(layer);
      };

      for (let i = 1; i < pts.length; i++) {
        const off = isOffRoad(cumDists[i]);
        if (off !== runIsOff) {
          flushRun(i, runIsOff);
          runStart = i;
          runIsOff = off;
        }
      }
      flushRun(pts.length - 1, runIsOff);

      bounds.push(...pts.map(p => L.latLng(p.lat, p.lon)));
    }

    if (bounds.length && mapRef.current) {
      mapRef.current.fitBounds(L.latLngBounds(bounds), { padding: [30, 30] });
    }
  }, [segments, visibleSegments, surfaceData]);

  // Update POI markers
  useEffect(() => {
    const layer = poiLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    for (const poi of pois) {
      const lines: string[] = [`<b>${poi.name}</b>`];
      if (poi.openingHours) lines.push(`<small>🕐 ${poi.openingHours}</small>`);
      if (poi.phone) lines.push(`<small>📞 <a href="tel:${poi.phone}" style="color:#58a6ff">${poi.phone}</a></small>`);
      if (poi.website) {
        const display = poi.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
        lines.push(`<small>🔗 <a href="${poi.website}" target="_blank" rel="noopener" style="color:#58a6ff">${display}</a></small>`);
      }
      L.marker([poi.lat, poi.lon], { icon: poiIcon(poi.category) })
        .bindPopup(lines.join('<br>'))
        .addTo(layer);
    }
  }, [pois]);

  // Update ferry lines
  useEffect(() => {
    const layer = ferryLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    for (const ferry of ferries) {
      const from: L.LatLngTuple = [ferry.fromPoint.lat, ferry.fromPoint.lon];
      const to: L.LatLngTuple = [ferry.toPoint.lat, ferry.toPoint.lon];

      L.polyline([from, to], {
        color: '#67e8f9',
        weight: 2,
        opacity: 0.7,
        dashArray: '8 6',
      })
        .bindPopup(ferryPopup(ferry))
        .addTo(layer);

      const midLat = (ferry.fromPoint.lat + ferry.toPoint.lat) / 2;
      const midLon = (ferry.fromPoint.lon + ferry.toPoint.lon) / 2;
      L.marker([midLat, midLon], { icon: ferryIcon() })
        .bindPopup(ferryPopup(ferry))
        .addTo(layer);
    }
  }, [ferries]);

  // Distance markers every 50 km (cumulative across all visible segments in order)
  useEffect(() => {
    const layer = distLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    const INTERVAL = 50;
    let cumDist = 0;
    let nextMark = INTERVAL;

    const ordered = [...segments]
      .filter(s => visibleSegments.has(s.id))
      .sort((a, b) => a.id - b.id);

    for (const seg of ordered) {
      const pts: TrackPoint[] = seg.points.length ? seg.points : seg.displayPoints;
      for (let i = 1; i < pts.length; i++) {
        const step = haversineKm(pts[i - 1], pts[i]);
        const before = cumDist;
        cumDist += step;

        while (nextMark <= cumDist) {
          const ratio = step > 0 ? (nextMark - before) / step : 0;
          const lat = pts[i - 1].lat + ratio * (pts[i].lat - pts[i - 1].lat);
          const lon = pts[i - 1].lon + ratio * (pts[i].lon - pts[i - 1].lon);

          const icon = L.divIcon({
            html: `<div style="
              background:rgba(255,255,255,0.9);
              border:1.5px solid #1a73e8;
              color:#1a73e8;
              font-size:10px;
              font-weight:700;
              font-family:sans-serif;
              padding:2px 5px;
              border-radius:10px;
              white-space:nowrap;
              line-height:1.3;
            ">${nextMark}</div>`,
            className: '',
            iconSize: undefined,
            iconAnchor: [18, 10],
          });

          L.marker([lat, lon], { icon, interactive: false }).addTo(layer);
          nextMark += INTERVAL;
        }
      }
    }
  }, [segments, visibleSegments]);

  // Elevation profile hover marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (elevationHover) {
      if (hoverMarkerRef.current) {
        hoverMarkerRef.current.setLatLng([elevationHover.lat, elevationHover.lon]);
      } else {
        hoverMarkerRef.current = L.circleMarker([elevationHover.lat, elevationHover.lon], {
          radius: 7,
          color: '#ffffff',
          fillColor: '#58a6ff',
          fillOpacity: 1,
          weight: 2,
          interactive: false,
        }).addTo(map);
      }
    } else {
      hoverMarkerRef.current?.remove();
      hoverMarkerRef.current = null;
    }
  }, [elevationHover]);

  // Satisfy exhaustive-deps for useMemo (not used but listed to avoid lint)
  useMemo(() => null, []);

  // Suppress unused import warning
  void useCallback;

  return <div ref={containerRef} className="map-container" />;
}
