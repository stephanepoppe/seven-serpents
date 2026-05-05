import type { SegmentWeather, WeatherDay } from '../types';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

const DAILY_VARS = 'temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,winddirection_10m_dominant,weathercode';

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function isInPast(dateStr: string): boolean {
  const today = new Date().toISOString().split('T')[0];
  return dateStr < today;
}

async function fetchDailyWeather(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
): Promise<WeatherDay[]> {
  const baseUrl = isInPast(endDate) ? ARCHIVE_URL : FORECAST_URL;
  const url = `${baseUrl}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&start_date=${startDate}&end_date=${endDate}&daily=${DAILY_VARS}&timezone=auto`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Weather API error: ${resp.status}`);
  const json = await resp.json();

  if (!json.daily?.time?.length) return [];

  return json.daily.time.map((date: string, i: number) => ({
    date,
    tempMax: json.daily.temperature_2m_max[i],
    tempMin: json.daily.temperature_2m_min[i],
    precipitation: json.daily.precipitation_sum[i] ?? 0,
    windspeedMax: json.daily.windspeed_10m_max[i] ?? 0,
    windDirection: json.daily.winddirection_10m_dominant[i] ?? 0,
    weatherCode: json.daily.weathercode[i] ?? 0,
  }));
}

export async function fetchRouteWeather(
  segments: { id: number; name: string; lat: number; lon: number }[],
  startDate: string,
  daysPerSegment: number,
): Promise<SegmentWeather[]> {
  const results = await Promise.all(
    segments.map(async (seg, i) => {
      const segStart = addDays(startDate, i * daysPerSegment);
      const segEnd = addDays(segStart, daysPerSegment - 1);
      const days = await fetchDailyWeather(seg.lat, seg.lon, segStart, segEnd);
      return {
        segmentId: seg.id,
        segmentName: seg.name,
        lat: seg.lat,
        lon: seg.lon,
        days,
      };
    }),
  );
  return results;
}

export function weatherCodeIcon(code: number): string {
  if (code === 0) return '☀️';
  if (code <= 3) return '⛅';
  if (code <= 49) return '🌫️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '🌨️';
  if (code <= 82) return '🌦️';
  if (code <= 86) return '❄️';
  if (code <= 99) return '⛈️';
  return '🌡️';
}

export function weatherCodeLabel(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 49) return 'Foggy';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  if (code <= 99) return 'Thunderstorm';
  return 'Unknown';
}
