import type { Counters, Sample } from '../lib/types';
import { ClientIcon, ServerIcon } from './Icons';

export function Topology({
  samples,
  counters,
  upstream,
}: {
  samples: Sample[];
  counters: Counters;
  upstream: string;
}) {
  const latest = samples[0];
  const { ok: okCount, fail: failCount, v1: v1Count, v2: v2Count } = counters;
  const total = okCount + failCount;

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

  // Geometry — client left, fork in the middle, two servers on the right.
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

  return (
    <div className="overflow-hidden rounded-card border border-gray1 bg-white">
      <div className="grid grid-cols-1 gap-6 px-6 py-8 md:grid-cols-[1fr_2fr_1fr] md:items-center md:gap-4 md:px-10 md:py-10">
        <Node
          title="Next.js client"
          subtitle="this browser"
          tag="playground-client"
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
                x={(clientX + forkX) / 2 - 85}
                y={yMid - 15}
                width="170"
                height="30"
                rx="15"
                fill={meshed || !latest ? '#003359' : '#5a1626'}
              />
              <text
                x={(clientX + forkX) / 2}
                y={yMid + 4}
                textAnchor="middle"
                fill={meshed || !latest ? '#64f9bf' : '#ff7490'}
                style={{
                  fontFamily: 'Inconsolata, monospace',
                  fontSize: '13px',
                  fontWeight: 600,
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

            {/* GET / label */}
            <text
              x={(clientX + forkX) / 2}
              y={yMid - 24}
              textAnchor="middle"
              fill="#4d708b"
              style={{
                fontFamily: 'Inconsolata, monospace',
                fontSize: '12px',
              }}
            >
              GET /
            </text>

            {/* Status / latency label under the trunk */}
            <text
              x={(clientX + forkX) / 2}
              y={yMid + 35}
              textAnchor="middle"
              fill="#8099ac"
              style={{
                fontFamily: 'Inconsolata, monospace',
                fontSize: '12px',
              }}
            >
              {latest
                ? `${latest.status || 'ERR'} · ${latest.latencyMs} ms`
                : 'waiting…'}
            </text>

            {/* v1 / v2 chips on the right */}
            {[
              { y: yV1, label: 'v1', count: v1Count, active: targetVersion === 'v1' },
              { y: yV2, label: 'v2', count: v2Count, active: targetVersion === 'v2' },
            ].map(b => (
              <g key={b.label}>
                <rect
                  x={serverX - 36}
                  y={b.y - 11}
                  width="36"
                  height="22"
                  rx="11"
                  fill={b.active ? '#003359' : '#e5ebee'}
                />
                <text
                  x={serverX - 18}
                  y={b.y + 4}
                  textAnchor="middle"
                  fill={b.active ? '#64f9bf' : '#4d708b'}
                  style={{
                    fontFamily: 'Inconsolata, monospace',
                    fontSize: '11px',
                    fontWeight: 600,
                  }}
                >
                  {b.label}
                </text>
                <text
                  x={serverX - 18}
                  y={b.y + 26}
                  textAnchor="middle"
                  fill="#8099ac"
                  style={{
                    fontFamily: 'Inconsolata, monospace',
                    fontSize: '10px',
                  }}
                >
                  {b.count}
                </text>
              </g>
            ))}

            {/* Pulse from client to the targeted version */}
            {latest && (
              <g
                key={`${total}-${targetVersion}`}
                className="pulse-travel"
                style={{
                  ['--travel-x' as string]: `${pulseDestX - clientX}px`,
                  ['--travel-y' as string]: `${pulseDestY - yMid}px`,
                }}
              >
                <circle cx={clientX} cy={yMid} r="5" fill={pulseColor} />
                <circle cx={clientX} cy={yMid} r="9" fill={pulseColor} opacity="0.25" />
              </g>
            )}
          </svg>
        </div>

        <div className="flex flex-col gap-3">
          <Node
            title="Go server v1"
            subtitle={
              latest?.appVersion === 'v1' && latest?.servedBy
                ? `pod · ${latest.servedBy}`
                : 'playground-server-http-primary'
            }
            tag={`playground-server-http · v1 · ${v1Count} hits`}
            variant={targetVersion === 'v1' ? 'solid' : 'outline'}
            glowKey={v1Count}
          />
          <Node
            title="Go server v2"
            subtitle={
              latest?.appVersion === 'v2' && latest?.servedBy
                ? `pod · ${latest.servedBy}`
                : 'playground-server-http-canary'
            }
            tag={`playground-server-http · v2 · ${v2Count} hits`}
            variant={targetVersion === 'v2' ? 'solid' : 'outline'}
            glowKey={v2Count}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-gray1 bg-navy-3 px-6 py-3 font-mono text-xs text-navy-60 md:px-10">
        <span>
          upstream <span className="text-navy">{upstream || '—'}</span>
        </span>
        <span className="text-navy-30">·</span>
        <span>
          mtls{' '}
          <span className={meshed ? 'text-green' : 'text-red'}>
            {!latest ? '—' : meshed ? 'verified' : 'absent'}
          </span>
        </span>
        <span className="text-navy-30">·</span>
        <span>
          client-id{' '}
          <span className="text-navy truncate">
            {latest?.meshClientId || '—'}
          </span>
        </span>
        <span className="text-navy-30">·</span>
        <span>
          v1 <span className="text-navy">{v1Count}</span>
        </span>
        <span className="text-navy-30">·</span>
        <span>
          v2 <span className="text-navy">{v2Count}</span>
        </span>
        <span className="text-navy-30">·</span>
        <span>
          ok <span className="text-green">{okCount}</span>
        </span>
        <span className="text-navy-30">·</span>
        <span>
          fail <span className="text-red">{failCount}</span>
        </span>
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
  tag: string;
  variant: 'solid' | 'outline';
  glowKey: number;
}) {
  const solid = variant === 'solid';
  return (
    <div
      key={glowKey}
      className={`node-glow flex items-center gap-4 rounded-card px-5 py-4 ${
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
        <div className="font-sans text-sm font-semibold">{title}</div>
        <div
          className={`truncate font-mono text-xs ${
            solid ? 'text-white/60' : 'text-navy-60'
          }`}
        >
          {subtitle}
        </div>
        <div
          className={`mt-1 inline-block rounded-full px-2 py-0.5 font-mono text-[10px] ${
            solid ? 'bg-white/10 text-white/80' : 'bg-navy-5 text-navy-70'
          }`}
        >
          {tag}
        </div>
      </div>
    </div>
  );
}
