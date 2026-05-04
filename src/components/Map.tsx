import { useEffect, useRef, useMemo } from 'react';
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
};

function poiIcon(category: POICategory) {
  return L.divIcon({
    html: `<span style="font-size:18px;line-height:1;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.7))">${POI_EMOJIS[category]}</span>`,
    className: '',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
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
}

export default function MapView({ segments, visibleSegments, pois, ferries }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const poiLayerRef = useRef<L.LayerGroup | null>(null);
  const ferryLayerRef = useRef<L.LayerGroup | null>(null);
  const distLayerRef = useRef<L.LayerGroup | null>(null);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [44.8, 14.8],
      zoom: 7,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
      maxZoom: 17,
    }).addTo(map);

    routeLayerRef.current = L.layerGroup().addTo(map);
    distLayerRef.current = L.layerGroup().addTo(map);
    poiLayerRef.current = L.layerGroup().addTo(map);
    ferryLayerRef.current = L.layerGroup().addTo(map);

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
      const latlngs = seg.displayPoints.map(p => [p.lat, p.lon] as L.LatLngTuple);
      if (!latlngs.length) continue;

      L.polyline(latlngs, {
        color: seg.color,
        weight: 3.5,
        opacity: 0.9,
      })
        .bindPopup(`<b style="color:${seg.color}">${seg.name}</b><br>${seg.distanceKm.toFixed(1)} km &nbsp;↑${Math.round(seg.elevationGainM)} m`)
        .addTo(layer);

      bounds.push(...latlngs.map(ll => L.latLng(ll[0], ll[1])));
    }

    if (bounds.length && mapRef.current) {
      mapRef.current.fitBounds(L.latLngBounds(bounds), { padding: [30, 30] });
    }
  }, [segments, visibleSegments]);

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
        .bindPopup(`<b>⛴️ Ferry</b><br>${ferry.fromName} → ${ferry.toName}<br>${ferry.distanceKm.toFixed(1)} km across`)
        .addTo(layer);

      const midLat = (ferry.fromPoint.lat + ferry.toPoint.lat) / 2;
      const midLon = (ferry.fromPoint.lon + ferry.toPoint.lon) / 2;
      L.marker([midLat, midLon], { icon: ferryIcon() })
        .bindPopup(`<b>⛴️ Ferry crossing</b><br>${ferry.fromName} → ${ferry.toName}<br>${ferry.distanceKm.toFixed(1)} km`)
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
              background:rgba(15,17,23,0.85);
              border:1.5px solid #58a6ff;
              color:#58a6ff;
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

  // Satisfy exhaustive-deps for useMemo (not used but listed to avoid lint)
  useMemo(() => null, []);

  return <div ref={containerRef} className="map-container" />;
}
