# 🐍 Seven Serpents

Route planning app for a 7-segment ~1000 km bikepacking race through Slovenia and Croatia.

**Live app → [stephanepoppe.github.io/seven-serpents](https://stephanepoppe.github.io/seven-serpents/)**

## Features

- Interactive map with all 7 route segments, color-coded
- On-road vs off-road sections shown as solid/dotted lines (from OSM data)
- POI markers along the route: camping, hostels, hotels, restaurants, supermarkets, water sources, mountain huts
- Ferry crossings with schedule, fares, and operator info
- Elevation profile graph with bidirectional hover (map ↔ profile)
- 50 km distance markers along the route
- Weather forecast per segment based on race start date
- Wind direction with headwind/tailwind indicator

## Segments

| # | Segment | Color |
|---|---------|-------|
| 1 | Slovenia | red |
| 2 | Velebit | orange |
| 3 | Pag | yellow |
| 4 | Rab | green |
| 5 | Krk | teal |
| 6 | Cres | blue |
| 7 | Učka / Trieste | purple |

## Development

```bash
npm install
npm run dev
```

## Regenerating data

POIs and surface classification are pre-generated and committed. To refresh:

```bash
# POIs (requires API keys)
GEOAPIFY_KEY=xxx GOOGLE_KEY=xxx npm run fetch-pois

# Off-road surface data (no keys needed, uses public Overpass API)
node scripts/fetch-surface.mjs

# Reprocess specific segments only
node scripts/fetch-surface.mjs --segments 3,7
```

Get API keys:
- Geoapify: [myprojects.geoapify.com](https://myprojects.geoapify.com) (free tier: 3000 req/day)
- Google: [console.cloud.google.com](https://console.cloud.google.com) → enable Places API (~$0.50 for a full run)

## Tech stack

- React 18 + TypeScript 5 + Vite 5
- Leaflet 1.9 for the map (CartoDB Positron tiles)
- Weather from [Open-Meteo](https://open-meteo.com/) (free, no auth)
- No backend — fully static, hosted on GitHub Pages
