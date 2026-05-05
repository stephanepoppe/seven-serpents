import { useMemo, useRef, useState, useCallback } from 'react';
import type { Segment } from '../types';
import { haversineKm } from '../utils/gpxParser';

const CHART_H = 130;
const PAD = { top: 14, right: 12, bottom: 22, left: 46 };
const VIEWBOX_W = 2000; // high-res viewBox for smooth rendering

interface FlatPoint {
  dist: number;  // cumulative km
  ele: number;
  lat: number;
  lon: number;
  color: string;
  segId: number;
}

export interface HoverPoint {
  lat: number;
  lon: number;
  dist: number;
  ele: number;
}

interface Boundary {
  dist: number;
  color: string;
  label: string;
}

interface Props {
  segments: Segment[];
  visibleSegments: Set<number>;
  onHover: (pt: HoverPoint | null) => void;
  externalHover?: { lat: number; lon: number } | null;
}

// Minimal 3-point median to kill GPS spikes, no smoothing of real terrain
function medianFilter(pts: FlatPoint[]): FlatPoint[] {
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    const sorted = [pts[i - 1].ele, p.ele, pts[i + 1].ele].sort((a, b) => a - b);
    return { ...p, ele: sorted[1] };
  });
}

export default function ElevationProfile({ segments, visibleSegments, onHover, externalHover }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ svgX: number; dist: number; ele: number; label: string } | null>(null);

  const { points, boundaries, totalDist, minEle, maxEle } = useMemo(() => {
    const flat: FlatPoint[] = [];
    const bounds: Boundary[] = [];
    let cumDist = 0;

    const ordered = [...segments]
      .filter(s => visibleSegments.has(s.id))
      .sort((a, b) => a.id - b.id);

    for (const seg of ordered) {
      const pts = seg.points.filter(p => p.ele != null && !isNaN(p.ele!));
      if (!pts.length) continue;

      bounds.push({ dist: cumDist, color: seg.color, label: seg.name.replace(/^7S26\.\d+ — /, '') });

      for (let i = 0; i < pts.length; i++) {
        const stepDist = i === 0 ? 0 : haversineKm(pts[i - 1], pts[i]);
        cumDist += stepDist;
        flat.push({ dist: cumDist, ele: pts[i].ele!, lat: pts[i].lat, lon: pts[i].lon, color: seg.color, segId: seg.id });
      }
    }

    const filtered = medianFilter(flat);
    const eles = filtered.map(p => p.ele);
    return {
      points: filtered,
      boundaries: bounds,
      totalDist: cumDist,
      minEle: Math.floor(Math.min(...eles) / 50) * 50,
      maxEle: Math.ceil(Math.max(...eles) / 50) * 50,
    };
  }, [segments, visibleSegments]);

  const innerW = VIEWBOX_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;

  const toX = useCallback((dist: number) => PAD.left + (dist / totalDist) * innerW, [totalDist, innerW]);
  const toY = useCallback((ele: number) => {
    const range = maxEle - minEle || 1;
    return PAD.top + innerH - ((ele - minEle) / range) * innerH;
  }, [minEle, maxEle, innerH]);

  // Build one SVG path per segment
  const segPaths = useMemo(() => {
    if (!points.length || totalDist === 0) return [];
    const segIds = [...new Set(points.map(p => p.segId))];
    return segIds.map(id => {
      const pts = points.filter(p => p.segId === id);
      if (pts.length < 2) return null;
      const color = pts[0].color;
      const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.dist).toFixed(2)},${toY(p.ele).toFixed(2)}`).join('');
      const fill = `${line}L${toX(pts[pts.length - 1].dist).toFixed(2)},${(PAD.top + innerH).toFixed(2)}L${toX(pts[0].dist).toFixed(2)},${(PAD.top + innerH).toFixed(2)}Z`;
      return { id, color, line, fill };
    }).filter(Boolean);
  }, [points, toX, toY, totalDist, innerH]);

  // X ticks every 100km (or 50km for shorter routes)
  const xStep = totalDist > 600 ? 100 : 50;
  const xTicks: number[] = [];
  for (let d = 0; d <= totalDist; d += xStep) xTicks.push(d);

  // Y ticks: 4–5 evenly spaced
  const yRange = maxEle - minEle;
  const rawStep = yRange / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const yStep = Math.ceil(rawStep / magnitude) * magnitude;
  const yTicks: number[] = [];
  for (let e = minEle; e <= maxEle + 1; e += yStep) yTicks.push(e);

  // Resolve external hover (from map) to nearest flat point
  const extCross = useMemo(() => {
    if (!externalHover || !points.length) return null;
    let nearest = points[0], minD = Infinity;
    for (const p of points) {
      const d = haversineKm(p, externalHover);
      if (d < minD) { minD = d; nearest = p; }
    }
    const seg = segments.find(s => s.id === nearest.segId);
    return {
      svgX: toX(nearest.dist),
      dist: nearest.dist,
      ele: Math.round(nearest.ele),
      label: seg?.name.replace(/^7S26\.\d+ — /, '') ?? '',
    };
  }, [externalHover, points, toX, segments]);

  function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || !points.length || totalDist === 0) return;
    const rect = svg.getBoundingClientRect();
    const fracX = (e.clientX - rect.left) / rect.width;
    const dist = ((fracX * VIEWBOX_W - PAD.left) / innerW) * totalDist;
    if (dist < 0 || dist > totalDist) { setHover(null); onHover(null); return; }

    let nearest = points[0], minD = Infinity;
    for (const p of points) {
      const d = Math.abs(p.dist - dist);
      if (d < minD) { minD = d; nearest = p; }
    }
    const seg = segments.find(s => s.id === nearest.segId);
    setHover({
      svgX: toX(nearest.dist),
      dist: nearest.dist,
      ele: Math.round(nearest.ele),
      label: seg?.name.replace(/^7S26\.\d+ — /, '') ?? '',
    });
    onHover({ lat: nearest.lat, lon: nearest.lon, dist: nearest.dist, ele: Math.round(nearest.ele) });
  }

  if (!points.length) return null;

  // Convert svgX to a percentage of the total SVG width for the tooltip
  const tooltipPct = hover ? (hover.svgX / VIEWBOX_W) * 100 : 0;

  return (
    <div className="elevation-profile">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEWBOX_W} ${CHART_H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: CHART_H, display: 'block', cursor: 'crosshair' }}
        onMouseMove={onMouseMove}
        onMouseLeave={() => { setHover(null); onHover(null); }}
      >
        {/* Chart background */}
        <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH}
          fill="rgba(22,27,34,0.5)" />

        {/* Y gridlines */}
        {yTicks.map(e => (
          <line key={e} x1={PAD.left} y1={toY(e)} x2={PAD.left + innerW} y2={toY(e)}
            stroke="#30363d" strokeWidth="0.6" />
        ))}

        {/* Segment boundary lines */}
        {boundaries.slice(1).map(b => (
          <line key={b.dist}
            x1={toX(b.dist)} y1={PAD.top} x2={toX(b.dist)} y2={PAD.top + innerH}
            stroke={b.color} strokeWidth="1" strokeDasharray="4 3" opacity="0.6" />
        ))}

        {/* Filled areas */}
        {segPaths.map(sp => sp && (
          <path key={`f${sp.id}`} d={sp.fill} fill={sp.color} opacity="0.12" />
        ))}

        {/* Elevation lines */}
        {segPaths.map(sp => sp && (
          <path key={`l${sp.id}`} d={sp.line} fill="none" stroke={sp.color} strokeWidth="1.2" strokeLinejoin="round" />
        ))}

        {/* Segment labels centred in each band */}
        {boundaries.map((b, i) => {
          const nextDist = boundaries[i + 1]?.dist ?? totalDist;
          return (
            <text key={b.dist}
              x={toX((b.dist + nextDist) / 2)} y={PAD.top + 10}
              textAnchor="middle" fontSize="9" fill={b.color} opacity="0.9" fontWeight="700">
              {b.label}
            </text>
          );
        })}

        {/* Internal hover crosshair (mouse on graph) */}
        {hover && (
          <line x1={hover.svgX} y1={PAD.top} x2={hover.svgX} y2={PAD.top + innerH}
            stroke="#e6edf3" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.7" />
        )}

        {/* External hover crosshair (mouse on map) */}
        {!hover && extCross && (
          <>
            <line x1={extCross.svgX} y1={PAD.top} x2={extCross.svgX} y2={PAD.top + innerH}
              stroke="#f1c40f" strokeWidth="1" strokeDasharray="3 3" opacity="0.85" />
            <circle cx={extCross.svgX} cy={toY(extCross.ele)} r="3.5"
              fill="#f1c40f" stroke="#0d1117" strokeWidth="1.2" />
          </>
        )}

        {/* Y-axis labels */}
        {yTicks.map(e => (
          <text key={e} x={PAD.left - 5} y={toY(e) + 3.5}
            textAnchor="end" fontSize="9" fill="#8b949e">{e}m</text>
        ))}

        {/* X-axis labels */}
        {xTicks.map(d => (
          <text key={d} x={toX(d)} y={CHART_H - 5}
            textAnchor="middle" fontSize="9" fill="#8b949e">{d}</text>
        ))}

        {/* X-axis unit label */}
        <text x={PAD.left + innerW} y={CHART_H - 5}
          textAnchor="end" fontSize="8" fill="#8b949e" opacity="0.6">km</text>
      </svg>

      {(hover || (!hover && extCross)) && (() => {
        const active = hover ?? extCross!;
        const pct = (active.svgX / VIEWBOX_W) * 100;
        return (
          <div className="elev-tooltip" style={{ left: `${pct}%` }}>
            <span style={{ color: '#8b949e' }}>{active.dist.toFixed(1)} km</span>
            {' · '}
            <span style={{ fontWeight: 600 }}>{active.ele} m</span>
            {' · '}
            <span style={{ color: '#8b949e' }}>{active.label}</span>
          </div>
        );
      })()}
    </div>
  );
}
