import { useState } from 'react';
import type { Segment, POI, POICategory, Ferry, SegmentWeather } from '../types';
import { weatherCodeIcon, weatherCodeLabel } from '../utils/weather';

const WIND_DIRS = ['N','NE','E','SE','S','SW','W','NW'];
function windDirAbbr(deg: number): string {
  return WIND_DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

// Bearing from start to end of a segment (degrees, 0=North)
function segmentBearing(seg: Segment): number {
  const pts = seg.points;
  if (pts.length < 2) return 0;
  const a = pts[0], b = pts[pts.length - 1];
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

// Headwind if wind comes from within 90° of travel direction; tailwind otherwise
function windEmoji(windDir: number, bearing: number): string {
  const diff = Math.abs(((windDir - bearing + 180) % 360) - 180);
  return diff < 90 ? '🪖' : '🍑';
}

const CATEGORIES: { key: POICategory; label: string; emoji: string }[] = [
  { key: 'camping',    label: 'Camping',      emoji: '🏕️' },
  { key: 'hostel',     label: 'Hostel',       emoji: '🏠' },
  { key: 'hotel',      label: 'Hotel',        emoji: '🏨' },
  { key: 'restaurant', label: 'Restaurant',   emoji: '🍴' },
  { key: 'supermarket',label: 'Supermarket',  emoji: '🛒' },
  { key: 'water',      label: 'Water source', emoji: '💧' },
  { key: 'hut',        label: 'Mountain hut', emoji: '🛖' },
  { key: 'bakery',     label: 'Bakery',       emoji: '🥐' },
];

interface Props {
  segments: Segment[];
  visibleSegments: Set<number>;
  onToggleSegment: (id: number) => void;
  pois: POI[];
  visibleCategories: Set<POICategory>;
  onToggleCategory: (cat: POICategory) => void;
  onSetAllCategories: (cats: Set<POICategory>) => void;
  ferries: Ferry[];
  weatherData: SegmentWeather[];
  loadingWeather: boolean;
  weatherError: string | null;
  raceStartDate: string;
  daysPerSegment: number;
  onRaceStartDateChange: (d: string) => void;
  onDaysPerSegmentChange: (n: number) => void;
  onFetchWeather: () => void;
  activeTab: 'segments' | 'pois' | 'ferries' | 'weather';
  onTabChange: (tab: 'segments' | 'pois' | 'ferries' | 'weather') => void;
}

export default function Sidebar({
  segments, visibleSegments, onToggleSegment,
  pois, visibleCategories, onToggleCategory, onSetAllCategories,
  ferries,
  weatherData, loadingWeather, weatherError,
  raceStartDate, daysPerSegment,
  onRaceStartDateChange, onDaysPerSegmentChange, onFetchWeather,
  activeTab, onTabChange,
}: Props) {
  const totalDistance = segments.reduce((s, seg) => s + seg.distanceKm, 0);
  const totalElevation = segments.reduce((s, seg) => s + seg.elevationGainM, 0);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-header-left">
          <div className="logo">
            🐍 Seven Serpents
            <a
              href="https://github.com/stephanepoppe/seven-serpents"
              target="_blank"
              rel="noopener noreferrer"
              title="View source on GitHub"
              style={{ marginLeft: '8px', opacity: 0.55, lineHeight: 1, verticalAlign: 'middle', display: 'inline-flex' }}
            >
              <svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
                  0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52
                  -.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2
                  -3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82
                  .64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08
                  2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01
                  1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
          </a>
        </div>
          {segments.length > 0 && (
            <div className="totals">
              {totalDistance.toFixed(0)} km &nbsp;·&nbsp; ↑{Math.round(totalElevation / 1000)}k m
            </div>
          )}
        </div>
        <button className="sidebar-toggle" onClick={() => setCollapsed(c => !c)} aria-label="Toggle panel">
          {collapsed ? '▲' : '▼'}
        </button>
      </div>

      <nav className="tabs">
        {(['segments', 'pois', 'ferries', 'weather'] as const).map(tab => (
          <button
            key={tab}
            className={`tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => onTabChange(tab)}
          >
            {tab === 'segments' && '🗺️'}
            {tab === 'pois' && '📍'}
            {tab === 'ferries' && '⛴️'}
            {tab === 'weather' && '🌤️'}
            <span>{tab.charAt(0).toUpperCase() + tab.slice(1)}</span>
          </button>
        ))}
      </nav>

      <div className="tab-content">
        {activeTab === 'segments' && (
          <div className="section">
            {segments.length === 0 && <div className="hint">Loading segments…</div>}
            {segments.map(seg => (
              <label key={seg.id} className="segment-row">
                <input
                  type="checkbox"
                  checked={visibleSegments.has(seg.id)}
                  onChange={() => onToggleSegment(seg.id)}
                />
                <span className="seg-dot" style={{ background: seg.color }} />
                <span className="seg-name">{seg.name}</span>
                <span className="seg-stats">
                  {seg.distanceKm.toFixed(1)} km<br />
                  <small>↑{Math.round(seg.elevationGainM)} m</small>
                </span>
              </label>
            ))}
          </div>
        )}

        {activeTab === 'pois' && (
          <div className="section">
            {pois.length === 0 && (
              <div className="hint">
                No POI data bundled yet.<br />
                Run <code>npm run fetch-pois</code> once to generate it.
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              <button className="clear-btn" onClick={() => onSetAllCategories(new Set(CATEGORIES.map(c => c.key)))}>All</button>
              <button className="clear-btn" onClick={() => onSetAllCategories(new Set())}>None</button>
            </div>
            <div className="category-filters">
              {CATEGORIES.map(({ key, label, emoji }) => {
                const count = pois.filter(p => p.category === key).length;
                return (
                  <label key={key} className="category-row">
                    <input
                      type="checkbox"
                      checked={visibleCategories.has(key)}
                      onChange={() => onToggleCategory(key)}
                    />
                    <span>{emoji} {label}</span>
                    {count > 0 && <span className="badge">{count}</span>}
                  </label>
                );
              })}
            </div>
            {pois.length > 0 && (
              <div className="hint">{pois.length} POIs bundled · re-run fetch-pois to refresh</div>
            )}
          </div>
        )}

        {activeTab === 'ferries' && (
          <div className="section">
            {ferries.length === 0 && segments.length === 0 && (
              <div className="hint">Loading route…</div>
            )}
            {ferries.length === 0 && segments.length > 0 && (
              <div className="hint">No ferry crossings detected (gap &gt; 0.5 km between segments).</div>
            )}
            {ferries.map(ferry => (
              <div key={ferry.id} className="ferry-card">
                <div className="ferry-title">⛴️ Ferry crossing</div>
                <div className="ferry-route">
                  <span style={{ opacity: 0.8 }}>{ferry.fromName}</span>
                  <span className="arrow"> → </span>
                  <span style={{ opacity: 0.8 }}>{ferry.toName}</span>
                </div>
                <div className="ferry-detail">~{ferry.distanceKm.toFixed(1)} km as the crow flies</div>
                <div className="ferry-note">
                  Check local schedules — Croatian ferries often run seasonally.
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'weather' && (
          <div className="section">
            <div className="weather-controls">
              <label className="field-label">
                Race start date
                <input
                  type="date"
                  className="date-input"
                  value={raceStartDate}
                  onChange={e => onRaceStartDateChange(e.target.value)}
                />
              </label>
              <label className="field-label">
                Days per segment: <strong>{daysPerSegment}</strong>
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={daysPerSegment}
                  onChange={e => onDaysPerSegmentChange(Number(e.target.value))}
                  className="range-input"
                />
              </label>
              <button
                className="fetch-btn"
                onClick={onFetchWeather}
                disabled={loadingWeather || segments.length === 0}
              >
                {loadingWeather ? '⏳ Loading…' : 'Fetch weather forecast'}
              </button>
              {weatherError && <div className="error">{weatherError}</div>}
              <div className="hint">
                Uses Open-Meteo (free). Past dates use archive; future dates use forecast.
              </div>
            </div>

            {weatherData.map(sw => {
              const seg = segments.find(s => s.id === sw.segmentId);
              const bearing = seg ? segmentBearing(seg) : 0;
              return (
              <div key={sw.segmentId} className="weather-card">
                <div className="weather-seg-name">
                  <span
                    className="seg-dot"
                    style={{ background: seg?.color ?? '#888' }}
                  />
                  {sw.segmentName}
                </div>
                {sw.days.map(day => (
                  <div key={day.date} className="weather-day">
                    <span className="weather-date">{day.date}</span>
                    <span className="weather-icon" title={weatherCodeLabel(day.weatherCode)}>
                      {weatherCodeIcon(day.weatherCode)}
                    </span>
                    <span className="weather-temp">
                      {Math.round(day.tempMax)}°/{Math.round(day.tempMin)}°C
                    </span>
                    <span className="weather-extra">
                      💧{day.precipitation.toFixed(1)} mm &nbsp;
                      <span
                        title={`Wind direction: ${day.windDirection}°`}
                        style={{ display: 'inline-block', transform: `rotate(${day.windDirection}deg)`, fontSize: 12, lineHeight: 1 }}
                      >↑</span>
                      {windDirAbbr(day.windDirection)} {Math.round(day.windspeedMax)} km/h &nbsp;
                      <span title={windEmoji(day.windDirection, bearing) === '🪖' ? 'Headwind' : 'Tailwind'}>
                        {windEmoji(day.windDirection, bearing)}
                      </span>
                    </span>
                  </div>
                ))}
                {sw.days.length === 0 && (
                  <div className="hint">No data for this period.</div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
