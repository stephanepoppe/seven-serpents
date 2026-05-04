import type { Segment, POI, POICategory, Ferry, SegmentWeather } from '../types';
import { weatherCodeIcon, weatherCodeLabel } from '../utils/weather';

const CATEGORIES: { key: POICategory; label: string; emoji: string }[] = [
  { key: 'camping',    label: 'Camping',      emoji: '🏕️' },
  { key: 'hostel',     label: 'Hostel',       emoji: '🏠' },
  { key: 'hotel',      label: 'Hotel',        emoji: '🏨' },
  { key: 'restaurant', label: 'Restaurant',   emoji: '🍴' },
  { key: 'supermarket',label: 'Supermarket',  emoji: '🛒' },
  { key: 'water',      label: 'Water source', emoji: '💧' },
];

interface Props {
  segments: Segment[];
  visibleSegments: Set<number>;
  onToggleSegment: (id: number) => void;
  pois: POI[];
  visibleCategories: Set<POICategory>;
  onToggleCategory: (cat: POICategory) => void;
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
  pois, visibleCategories, onToggleCategory,
  ferries,
  weatherData, loadingWeather, weatherError,
  raceStartDate, daysPerSegment,
  onRaceStartDateChange, onDaysPerSegmentChange, onFetchWeather,
  activeTab, onTabChange,
}: Props) {
  const totalDistance = segments.reduce((s, seg) => s + seg.distanceKm, 0);
  const totalElevation = segments.reduce((s, seg) => s + seg.elevationGainM, 0);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">🐍 Seven Serpents</div>
        {segments.length > 0 && (
          <div className="totals">
            {totalDistance.toFixed(0)} km &nbsp;·&nbsp; ↑{Math.round(totalElevation / 1000)}k m
          </div>
        )}
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

            {weatherData.map(sw => (
              <div key={sw.segmentId} className="weather-card">
                <div className="weather-seg-name">
                  <span
                    className="seg-dot"
                    style={{ background: segments.find(s => s.id === sw.segmentId)?.color ?? '#888' }}
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
                      💨{Math.round(day.windspeedMax)} km/h
                    </span>
                  </div>
                ))}
                {sw.days.length === 0 && (
                  <div className="hint">No data for this period.</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
