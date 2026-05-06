export interface TrackPoint {
  lat: number;
  lon: number;
  ele?: number;
}

export interface Waypoint {
  lat: number;
  lon: number;
  name: string;
  sym?: string;
}

export interface Segment {
  id: number;
  name: string;
  filename: string;
  color: string;
  points: TrackPoint[];
  displayPoints: TrackPoint[];
  waypoints: Waypoint[];
  distanceKm: number;
  elevationGainM: number;
}

export type POICategory = 'camping' | 'hostel' | 'hotel' | 'restaurant' | 'supermarket' | 'water' | 'hut' | 'bakery';

export interface POI {
  id: string;
  lat: number;
  lon: number;
  name: string;
  category: POICategory;
  website?: string;
  phone?: string;
  openingHours?: string;
  tags: Record<string, string>;
}

export interface Ferry {
  id: string;
  fromSegmentId: number;
  toSegmentId: number;
  fromName: string;
  toName: string;
  fromPoint: TrackPoint;
  toPoint: TrackPoint;
  distanceKm: number;
}

export interface WeatherDay {
  date: string;
  tempMax: number;
  tempMin: number;
  precipitation: number;
  windspeedMax: number;
  windDirection: number;
  weatherCode: number;
}

export interface SegmentWeather {
  segmentId: number;
  segmentName: string;
  lat: number;
  lon: number;
  days: WeatherDay[];
}
