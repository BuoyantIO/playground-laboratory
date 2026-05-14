'use client';

import { niceCeil } from '../lib/format';
import { useTranslation } from '../lib/i18n';
import type { Sample } from '../lib/types';

export function LatencyChart({ samples }: { samples: Sample[] }) {
  const { t } = useTranslation();
  if (samples.length < 2) {
    return (
      <div className="flex h-32 items-center justify-center rounded-card border border-gray1 bg-white font-mono text-sm text-navy-40">
        {t('chart.collecting')}
      </div>
    );
  }

  const W = 1000;
  const H = 160;
  const PAD = { top: 16, right: 16, bottom: 24, left: 36 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const ordered = [...samples].reverse();
  const max = Math.max(...ordered.map(s => s.latencyMs), 50);
  const niceMax = niceCeil(max);
  const stepX = innerW / Math.max(ordered.length - 1, 1);

  const pts = ordered.map((s, i) => ({
    x: PAD.left + i * stepX,
    y: PAD.top + innerH - (s.latencyMs / niceMax) * innerH,
    ok: s.ok,
    s,
  }));

  const linePath = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L ${pts[pts.length - 1].x.toFixed(
    1,
  )} ${PAD.top + innerH} L ${pts[0].x.toFixed(1)} ${PAD.top + innerH} Z`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => ({
    y: PAD.top + innerH - f * innerH,
    v: Math.round(niceMax * f),
  }));

  return (
    <div className="rounded-card border border-gray1 bg-white p-4 md:p-6">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-40 w-full md:h-48"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="lat-grad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#64f9bf" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#64f9bf" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map(t => (
          <g key={t.v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={t.y}
              y2={t.y}
              stroke="#e5ebee"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 6}
              y={t.y + 3}
              textAnchor="end"
              fill="#8099ac"
              style={{ fontFamily: 'Inconsolata, monospace', fontSize: '10px' }}
            >
              {t.v}
            </text>
          </g>
        ))}

        <path d={areaPath} fill="url(#lat-grad)" />
        <path d={linePath} stroke="#003359" strokeWidth="1.5" fill="none" />

        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={p.ok ? 1.6 : 2.6}
            fill={p.ok ? '#02ca7c' : '#e9556f'}
          />
        ))}

        <text
          x={W - PAD.right}
          y={H - 6}
          textAnchor="end"
          fill="#8099ac"
          style={{ fontFamily: 'Inconsolata, monospace', fontSize: '10px' }}
        >
          {t('chart.now')}
        </text>
        <text
          x={PAD.left}
          y={H - 6}
          textAnchor="start"
          fill="#8099ac"
          style={{ fontFamily: 'Inconsolata, monospace', fontSize: '10px' }}
        >
          {t('chart.ago', { n: ordered.length })}
        </text>
        <text
          x={PAD.left}
          y={PAD.top - 4}
          fill="#8099ac"
          style={{ fontFamily: 'Inconsolata, monospace', fontSize: '10px' }}
        >
          ms
        </text>
      </svg>
    </div>
  );
}
