'use client';
import { useMemo, useRef, useState } from 'react';

export interface Point {
  t: number;
  v: number;
}

/** Small interactive line chart: drag or hover to read a value. */
export function LineChart({ points, format, height = 150, tone }: { points: Point[]; format: (v: number) => string; height?: number; tone?: 'good' | 'bad' }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 340;
  const H = height;
  const { path, area, xs, ys } = useMemo(() => {
    if (points.length < 2) return { path: '', area: '', xs: [] as number[], ys: [] as number[] };
    const min = Math.min(...points.map((p) => p.v));
    const max = Math.max(...points.map((p) => p.v));
    const span = max - min || 1;
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const xs = points.map((p) => ((p.t - t0) / (t1 - t0 || 1)) * W);
    const ys = points.map((p) => 8 + (1 - (p.v - min) / span) * (H - 16));
    const path = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join('');
    return { path, area: `${path}L${W},${H}L0,${H}Z`, xs, ys };
  }, [points, H]);

  if (points.length < 2) return <div className="chart-empty muted small">Not enough data for a chart yet.</div>;
  const t = tone ?? (points[points.length - 1].v >= points[0].v ? 'good' : 'bad');

  function onMove(e: React.PointerEvent) {
    const r = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
    setHover(best);
  }

  const h = hover != null ? points[hover] : null;
  return (
    <div className="chart">
      <div className="chart-read small">
        {h ? (
          <>
            <strong>{format(h.v)}</strong> <span className="muted">{new Date(h.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          </>
        ) : (
          <span className="muted">Touch the chart to see values</span>
        )}
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className={`chart-svg ${t}`}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
        style={{ height: H, touchAction: 'none' }}
      >
        <path d={area} className="chart-area" />
        <path d={path} className="chart-line" vectorEffect="non-scaling-stroke" />
        {hover != null && (
          <>
            <line x1={xs[hover]} x2={xs[hover]} y1={0} y2={H} className="chart-cursor" vectorEffect="non-scaling-stroke" />
            <circle cx={xs[hover]} cy={ys[hover]} r={3.5} className="chart-dot" />
          </>
        )}
      </svg>
    </div>
  );
}

export function Sparkbars({ values, highlightLast = true }: { values: number[]; highlightLast?: boolean }) {
  const max = Math.max(1, ...values);
  return (
    <span className="sparkbars" aria-hidden>
      {values.map((v, i) => (
        <span key={i} className={highlightLast && i === values.length - 1 ? 'last' : ''} style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
      ))}
    </span>
  );
}
