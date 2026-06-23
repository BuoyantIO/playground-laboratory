'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { STALE_SAMPLE_MS } from '../lib/constants';
import { useTranslation } from '../lib/i18n';
import type { Counters, Sample } from '../lib/types';
import { ClientIcon, ServerIcon } from './Icons';

export function Topology({
  samples,
  counters,
  upstream,
  concurrency,
}: {
  samples: Sample[];
  counters: Counters;
  upstream: string;
  concurrency: number;
}) {
  const { t } = useTranslation();
  const latest = samples[0];
  const { ok: okCount, fail: failCount, v1: v1Count, v2: v2Count } = counters;
  const total = okCount + failCount;

  // Tick a clock so the generator-liveness chip counts up between samples. It
  // starts at 0 (matching SSR) and only becomes meaningful after mount, so the
  // chip renders client-side only and avoids a hydration mismatch.
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ageMs = latest && now ? now - latest.t : null;
  const liveness =
    now === 0
      ? null
      : ageMs === null
        ? { text: t('topology.genNone'), live: false }
        : ageMs > STALE_SAMPLE_MS
          ? { text: t('topology.genStale', { n: Math.round(ageMs / 1000) }), live: false }
          : { text: t('topology.genLive', { n: Math.max(0, Math.round(ageMs / 1000)) }), live: true };

  const ok = latest?.ok;
  const meshed = !!latest?.meshClientId;
  const targetVersion = latest?.appVersion === 'v2' ? 'v2' : 'v1';
  const pulseColor = !latest ? '#cedde9' : ok ? '#02ca7c' : '#e9556f';
  const lineActive = !latest ? '#cedde9' : ok ? '#64f9bf' : '#ff7490';
  const lineDim = '#cedde9';
  const protocol = latest
    ? meshed
      ? 'HTTP/1.1 · mTLS'
      : 'HTTP/1.1 · plaintext'
    : 'HTTP/1.1';

  // Geometry - client left, fork in the middle, two servers on the right.
  const W = 480;
  const H = 200;
  const clientX = 8;
  const forkX = 220;
  const serverX = 472;
  const yMid = 100;
  const yV1 = 40;
  const yV2 = 160;
  const yTarget = targetVersion === 'v2' ? yV2 : yV1;
  const pulseDestX = serverX - 4;
  const pulseDestY = yTarget;

  // How many in-flight request "lanes" to animate as a staggered train, so the
  // concurrency setting is visible in the flow (capped to keep it readable).
  const laneCount = Math.min(Math.max(1, Math.round(concurrency)), 6);

  // Most-recent serving pod per version (and the client pod), so the nodes show
  // real pod names instead of generic labels.
  const v1Pod = samples.find((s) => s.appVersion === 'v1' && s.servedBy)?.servedBy;
  const v2Pod = samples.find((s) => s.appVersion === 'v2' && s.servedBy)?.servedBy;
  const clientPod = samples.find((s) => s.clientPod)?.clientPod;

  return (
    <div className="overflow-hidden rounded-card border border-gray1 bg-white">
      <div className="grid grid-cols-1 gap-6 px-6 py-8 md:grid-cols-[1fr_2fr_1fr] md:items-center md:gap-4 md:px-10 md:py-10">
        <Node
          title={clientPod || 'playground-client'}
          subtitle={t('topology.generatorSub')}
          variant="outline"
          glowKey={total}
        />

        <div className="relative flex items-center justify-center">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full max-w-[480px]"
            preserveAspectRatio="xMidYMid meet"
            aria-hidden
          >
            <defs>
              <marker
                id="arrow-active"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M0,0 L10,5 L0,10 Z" fill={lineActive} />
              </marker>
              <marker
                id="arrow-dim"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M0,0 L10,5 L0,10 Z" fill={lineDim} />
              </marker>
            </defs>

            {/* Trunk: client → fork */}
            <line
              x1={clientX}
              y1={yMid}
              x2={forkX}
              y2={yMid}
              stroke={lineActive}
              strokeWidth="2"
              strokeDasharray="4 6"
            />

            {/* Protocol pill on the trunk */}
            <g>
              <rect
                x={(clientX + forkX) / 2 - 108}
                y={yMid - 19}
                width="216"
                height="38"
                rx="19"
                fill={meshed || !latest ? '#003359' : '#5a1626'}
              />
              <text
                x={(clientX + forkX) / 2}
                y={yMid + 6}
                textAnchor="middle"
                fill={meshed || !latest ? '#64f9bf' : '#ff7490'}
                style={{
                  fontFamily: 'Inconsolata, monospace',
                  fontSize: '17px',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                }}
              >
                {protocol}
              </text>
            </g>

            {/* Fork → v1 (upper) */}
            <path
              d={`M ${forkX} ${yMid} L ${forkX + 20} ${yMid} L ${serverX - 40} ${yV1} L ${serverX} ${yV1}`}
              fill="none"
              stroke={targetVersion === 'v1' ? lineActive : lineDim}
              strokeWidth="2"
              strokeDasharray="4 6"
              markerEnd={
                targetVersion === 'v1' ? 'url(#arrow-active)' : 'url(#arrow-dim)'
              }
            />
            {/* Fork → v2 (lower) */}
            <path
              d={`M ${forkX} ${yMid} L ${forkX + 20} ${yMid} L ${serverX - 40} ${yV2} L ${serverX} ${yV2}`}
              fill="none"
              stroke={targetVersion === 'v2' ? lineActive : lineDim}
              strokeWidth="2"
              strokeDasharray="4 6"
              markerEnd={
                targetVersion === 'v2' ? 'url(#arrow-active)' : 'url(#arrow-dim)'
              }
            />

            {/* GET / label, with the live lane count (= concurrency) */}
            <text
              x={(clientX + forkX) / 2}
              y={yMid - 28}
              textAnchor="middle"
              style={{ fontFamily: 'Inconsolata, monospace', fontSize: '16px' }}
            >
              <tspan fill="#4d708b">GET /</tspan>
              {concurrency > 1 && (
                <tspan fill="#003359" fontWeight={700}>
                  {'  ·  ×'}
                  {concurrency} lanes
                </tspan>
              )}
            </text>

            {/* Status / latency label under the trunk */}
            <text
              x={(clientX + forkX) / 2}
              y={yMid + 38}
              textAnchor="middle"
              fill="#8099ac"
              style={{
                fontFamily: 'Inconsolata, monospace',
                fontSize: '16px',
              }}
            >
              {latest
                ? `${latest.status || 'ERR'} · ${latest.latencyMs} ms`
                : t('topology.waiting')}
            </text>

            {/* v1 / v2 chips on the right */}
            {[
              { y: yV1, label: 'v1', count: v1Count, active: targetVersion === 'v1' },
              { y: yV2, label: 'v2', count: v2Count, active: targetVersion === 'v2' },
            ].map(b => (
              <g key={b.label}>
                <rect
                  x={serverX - 48}
                  y={b.y - 14}
                  width="48"
                  height="28"
                  rx="14"
                  fill={b.active ? '#003359' : '#e5ebee'}
                />
                <text
                  x={serverX - 24}
                  y={b.y + 5}
                  textAnchor="middle"
                  fill={b.active ? '#64f9bf' : '#4d708b'}
                  style={{
                    fontFamily: 'Inconsolata, monospace',
                    fontSize: '15px',
                    fontWeight: 700,
                  }}
                >
                  {b.label}
                </text>
                <text
                  x={serverX - 24}
                  y={b.y + 32}
                  textAnchor="middle"
                  fill="#66859b"
                  style={{
                    fontFamily: 'Inconsolata, monospace',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
                >
                  {b.count}
                </text>
              </g>
            ))}

            {/* Pulses from client to the targeted version - one per lane, in a
                staggered train so higher concurrency reads as busier traffic. */}
            {latest &&
              Array.from({ length: laneCount }).map((_, i) => (
                <g
                  key={`${total}-${targetVersion}-${i}`}
                  className="pulse-travel"
                  style={{
                    ['--fork-x' as string]: `${forkX - clientX}px`,
                    ['--travel-x' as string]: `${pulseDestX - clientX}px`,
                    ['--travel-y' as string]: `${pulseDestY - yMid}px`,
                    animationDelay: `${i * 0.11}s`,
                  }}
                >
                  <circle cx={clientX} cy={yMid} r="5" fill={pulseColor} />
                  <circle cx={clientX} cy={yMid} r="9" fill={pulseColor} opacity="0.25" />
                </g>
              ))}
          </svg>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <Node
            title={v1Pod || 'playground-server-http-primary'}
            subtitle="primary · v1"
            tag={t('topology.hits', { n: v1Count })}
            variant={targetVersion === 'v1' ? 'solid' : 'outline'}
            glowKey={v1Count}
          />
          <Node
            title={v2Pod || 'playground-server-http-canary'}
            subtitle="canary · v2"
            tag={t('topology.hits', { n: v2Count })}
            variant={targetVersion === 'v2' ? 'solid' : 'outline'}
            glowKey={v2Count}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-gray1 bg-navy-3 px-6 py-3.5 font-mono text-xs text-navy-70 md:px-10">
        {liveness && (
          <>
            <Metric label={t('topology.genLabel')}>
              <Dotted live={liveness.live}>{liveness.text}</Dotted>
            </Metric>
            <Sep />
          </>
        )}
        <Metric label="lanes">
          <span className="text-navy">×{concurrency}</span>
        </Metric>
        <Sep />
        <Metric label="upstream">
          <span
            className="inline-block max-w-[20rem] truncate align-bottom text-navy"
            title={upstream || undefined}
          >
            {upstream || '-'}
          </span>
        </Metric>
        <Sep />
        <Metric label="wire">
          {!latest ? (
            <span className="text-navy-40">-</span>
          ) : (
            <Dotted live={meshed}>{meshed ? 'mTLS' : 'plaintext'}</Dotted>
          )}
        </Metric>
        <Sep />
        <Metric label="client-id">
          <span
            className="inline-block max-w-[11rem] truncate align-bottom text-navy"
            title={latest?.meshClientId || undefined}
          >
            {latest?.meshClientId || '-'}
          </span>
        </Metric>
        <Sep />
        <Metric label="v1">
          <span className="text-navy">{v1Count}</span>
        </Metric>
        <Metric label="v2">
          <span className="text-navy">{v2Count}</span>
        </Metric>
        <Sep />
        <Metric label="ok">
          <span className="text-green">{okCount}</span>
        </Metric>
        <Metric label="fail">
          <span className={failCount ? 'text-red' : 'text-navy-40'}>
            {failCount}
          </span>
        </Metric>
      </div>
    </div>
  );
}

function Node({
  title,
  subtitle,
  tag,
  variant,
  glowKey,
}: {
  title: string;
  subtitle: string;
  tag?: string;
  variant: 'solid' | 'outline';
  glowKey: number;
}) {
  const solid = variant === 'solid';
  return (
    <div
      key={glowKey}
      className={`node-glow flex min-w-0 items-center gap-4 rounded-card px-5 py-4 ${
        solid ? 'bg-navy text-white' : 'border border-navy bg-white text-navy'
      }`}
    >
      <div
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-button ${
          solid ? 'bg-white/10' : 'bg-electric/30'
        }`}
      >
        {solid ? (
          <ServerIcon className="h-6 w-6 text-electric" />
        ) : (
          <ClientIcon className="h-6 w-6 text-navy" />
        )}
      </div>
      <div className="min-w-0">
        <div className="break-words font-mono text-[13px] font-semibold leading-tight">
          {title}
        </div>
        <div
          className={`truncate font-mono text-xs ${
            solid ? 'text-white/60' : 'text-navy-60'
          }`}
        >
          {subtitle}
        </div>
        {tag && (
          <div
            className={`mt-1.5 inline-block max-w-full truncate whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[11px] ${
              solid ? 'bg-white/10 text-white/80' : 'bg-navy-5 text-navy-70'
            }`}
          >
            {tag}
          </div>
        )}
      </div>
    </div>
  );
}

// A single label/value unit in the status strip: a small muted uppercase label
// followed by its (stronger-weight) value.
function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[10px] uppercase tracking-[0.12em] text-navy-40">
        {label}
      </span>
      <span className="font-medium">{children}</span>
    </span>
  );
}

// Thin vertical divider between status-strip groups.
function Sep() {
  return <span className="h-3.5 w-px shrink-0 bg-navy-10" aria-hidden />;
}

// Value with a leading status dot, green when live/verified, red otherwise.
function Dotted({ live, children }: { live: boolean; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${live ? 'text-green' : 'text-red'}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-green' : 'bg-red'}`} />
      {children}
    </span>
  );
}
