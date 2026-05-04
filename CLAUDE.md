# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start Vite dev server
npm run build        # Type-check (tsc) then bundle (vite build)
npm run preview      # Preview production build
npm run fetch-pois   # Regenerate src/data/pois.json from Geoapify + Google APIs
```

`fetch-pois` requires env vars `GEOAPIFY_KEY` and `GOOGLE_KEY`.

## Architecture

**Seven Serpents** is a single-page React + TypeScript + Vite app for planning a 7-segment ~1000 km bikepacking race through Slovenia and Croatia.

### Data flow

1. `App.tsx` fetches 7 GPX files from `/public/gpx/` on load
2. `utils/gpxParser.ts` parses them into track points, waypoints, distances, and elevation gain (haversine math)
3. Ferry crossings are auto-detected when consecutive segment endpoints are >0.5 km apart
4. POI data is pre-generated static JSON (`src/data/pois.json`) — not fetched at runtime
5. Weather is fetched on-demand from Open-Meteo (free, no auth) based on race start date + days-per-segment

### Key files

| File | Role |
|------|------|
| `src/App.tsx` | Root component; owns all state (segments, POIs, ferries, weather, UI toggles) |
| `src/components/Map.tsx` | Leaflet map — route polylines, POI emoji markers, ferry dashed lines, 50 km distance markers |
| `src/components/Sidebar.tsx` | Tabbed control panel (Segments / POIs / Ferries / Weather) |
| `src/utils/gpxParser.ts` | GPX parsing + haversine distance + elevation gain |
| `src/utils/weather.ts` | Open-Meteo API wrapper (forecast + archive) |
| `src/types.ts` | Shared TypeScript interfaces (Segment, POI, Ferry, WeatherData, etc.) |
| `src/data/pois.json` | Pre-fetched POIs — regenerate with `npm run fetch-pois` |
| `scripts/fetch-pois.mjs` | Node script combining Geoapify (OSM/rural) + Google Places (commercial); 1 km radius, 80 m dedup |

### Tech stack

- **React 18** + **react-leaflet 4** + **Leaflet 1.9** for the interactive map (OpenTopoMap tiles)
- **TypeScript 5** strict mode throughout
- **Vite 5** for dev/build
- No backend — all external calls are client-side (Open-Meteo, Leaflet tile server)
- Dark theme via CSS variables in `src/index.css`
