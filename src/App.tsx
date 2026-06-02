import { useEffect, useState } from 'react';
import type { Segment, POI, POICategory, Ferry, SegmentWeather } from './types';
import type { HoverPoint } from './components/ElevationProfile';
import { parseGPX, calcDistance, calcElevationGain, downsample, haversineKm } from './utils/gpxParser';
import { fetchRouteWeather } from './utils/weather';
import MapView from './components/Map';
import Sidebar from './components/Sidebar';
import ElevationProfile from './components/ElevationProfile';

// POI data is pre-fetched via `npm run fetch-pois` and bundled statically.
import poisJson from './data/pois.json';
const bundledPOIs = poisJson as POI[];

import surfaceJson from './data/surface.json';
const surfaceData = surfaceJson as unknown as Record<string, [number, number][]>;

const GPX_SOURCES = [
  { id: 1, name: '7S26.1 — Slovenia',      filename: '7S26_1 - Slovenia.gpx',      color: '#e74c3c' },
  { id: 2, name: '7S26.2 — Velebit',       filename: '7S26_2 - Velebit.gpx',       color: '#e67e22' },
  { id: 3, name: '7S26.3 — Pag',           filename: '7S26_3 - Pag.gpx',           color: '#f1c40f' },
  { id: 4, name: '7S26.4 — Rab',           filename: '7S26_4 - Rab.gpx',           color: '#2ecc71' },
  { id: 5, name: '7S26.5 — Krk',           filename: '7S26_5 - Krk.gpx',           color: '#1abc9c' },
  { id: 6, name: '7S26.6 — Cres',          filename: '7S26_6 - Cres.gpx',          color: '#3498db' },
  { id: 7, name: '7S26.7 — Učka/Trieste',  filename: '7S26_7 - Ucka_Trieste.gpx',  color: '#a855f7' },
];

const FERRY_THRESHOLD_KM = 0.5;

export default function App() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [visibleSegments, setVisibleSegments] = useState<Set<number>>(new Set());
  const [ferries, setFerries] = useState<Ferry[]>([]);
  const [pois] = useState<POI[]>(bundledPOIs);
  const [visibleCategories, setVisibleCategories] = useState<Set<POICategory>>(
    new Set(['camping', 'hostel', 'hotel', 'restaurant', 'supermarket', 'water', 'hut', 'bakery']),
  );
  const [weatherData, setWeatherData] = useState<SegmentWeather[]>([]);
  const [loadingWeather, setLoadingWeather] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [raceStartDate, setRaceStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [daysPerSegment, setDaysPerSegment] = useState(2);
  const [activeTab, setActiveTab] = useState<'segments' | 'pois' | 'ferries' | 'weather'>('segments');
  const [elevationHover, setElevationHover] = useState<HoverPoint | null>(null);
  const [routeHover, setRouteHover] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    Promise.all(
      GPX_SOURCES.map(async src => {
        const resp = await fetch(`${import.meta.env.BASE_URL}gpx/${src.filename}`);
        const xml = await resp.text();
        const { points, waypoints } = parseGPX(xml);
        return {
          id: src.id,
          name: src.name,
          filename: src.filename,
          color: src.color,
          points,
          displayPoints: downsample(points, 1000),
          waypoints,
          distanceKm: calcDistance(points),
          elevationGainM: calcElevationGain(points),
        } as Segment;
      }),
    ).then(loaded => {
      setSegments(loaded);
      setVisibleSegments(new Set(loaded.map(s => s.id)));

      const detected: Ferry[] = [];

      // Intra-segment ferries: consecutive point jumps > 1.0 km (avoids GPS artifacts)
      const INTRA_FERRY_KM = 1.0;
      for (const seg of loaded) {
        const pts = seg.points;
        for (let i = 1; i < pts.length; i++) {
          const dist = haversineKm(pts[i - 1], pts[i]);
          if (dist > INTRA_FERRY_KM) {
            detected.push({
              id: `ferry-${seg.id}-${seg.id}-${i}`,
              fromSegmentId: seg.id,
              toSegmentId: seg.id,
              fromName: seg.name,
              toName: seg.name,
              fromPoint: pts[i - 1],
              toPoint: pts[i],
              distanceKm: dist,
            });
          }
        }
      }

      // Inter-segment ferries: gap between consecutive segment endpoints
      for (let i = 0; i < loaded.length - 1; i++) {
        const a = loaded[i];
        const b = loaded[i + 1];
        if (!a.points.length || !b.points.length) continue;
        const fromPoint = a.points[a.points.length - 1];
        const toPoint = b.points[0];
        const dist = haversineKm(fromPoint, toPoint);
        if (dist > FERRY_THRESHOLD_KM) {
          detected.push({
            id: `ferry-${a.id}-${b.id}`,
            fromSegmentId: a.id,
            toSegmentId: b.id,
            fromName: a.name,
            toName: b.name,
            fromPoint,
            toPoint,
            distanceKm: dist,
          });
        }
      }
      setFerries(detected);
    });
  }, []);

  async function handleFetchWeather() {
    setLoadingWeather(true);
    setWeatherError(null);
    try {
      const weatherSegments = segments.map(s => {
        const mid = s.points[Math.floor(s.points.length / 2)];
        return { id: s.id, name: s.name, lat: mid.lat, lon: mid.lon };
      });
      const result = await fetchRouteWeather(weatherSegments, raceStartDate, daysPerSegment);
      setWeatherData(result);
    } catch (err) {
      setWeatherError(err instanceof Error ? err.message : 'Failed to load weather');
    } finally {
      setLoadingWeather(false);
    }
  }

  function toggleSegment(id: number) {
    setVisibleSegments(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleCategory(cat: POICategory) {
    setVisibleCategories(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  }

  function setAllCategories(cats: Set<POICategory>) {
    setVisibleCategories(cats);
  }

  const routeStart = segments[0]?.points[0];
  const visiblePOIs = pois.filter(p => {
    if (!visibleCategories.has(p.category)) return false;
    if (routeStart && haversineKm(routeStart, p) < 5) return false;
    return true;
  });

  return (
    <div className="app">
      <Sidebar
        segments={segments}
        visibleSegments={visibleSegments}
        onToggleSegment={toggleSegment}
        pois={pois}
        visibleCategories={visibleCategories}
        onToggleCategory={toggleCategory}
        onSetAllCategories={setAllCategories}
        ferries={ferries}
        weatherData={weatherData}
        loadingWeather={loadingWeather}
        weatherError={weatherError}
        raceStartDate={raceStartDate}
        daysPerSegment={daysPerSegment}
        onRaceStartDateChange={setRaceStartDate}
        onDaysPerSegmentChange={setDaysPerSegment}
        onFetchWeather={handleFetchWeather}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <div className="map-column">
        <MapView
          segments={segments}
          visibleSegments={visibleSegments}
          pois={visiblePOIs}
          ferries={ferries}
          elevationHover={elevationHover}
          surfaceData={surfaceData}
          onRouteHover={setRouteHover}
        />
        <ElevationProfile segments={segments} visibleSegments={visibleSegments} onHover={setElevationHover} externalHover={routeHover} />
      </div>
    </div>
  );
}
