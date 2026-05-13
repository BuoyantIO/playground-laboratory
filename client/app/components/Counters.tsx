import { latencyTone, statusLabel } from '../lib/format';
import type { Counters as CountersType, Sample } from '../lib/types';
import { Stat } from './Stat';

export function Counters({
  samples,
  counters,
}: {
  samples: Sample[];
  counters: CountersType;
}) {
  const latest = samples[0];
  const total = counters.ok + counters.fail;
  const successRate = total ? Math.round((counters.ok / total) * 100) : 0;
  const avgLatency = samples.length
    ? Math.round(samples.reduce((s, x) => s + x.latencyMs, 0) / samples.length)
    : 0;
  const maxLatency = samples.length ? Math.max(...samples.map(s => s.latencyMs)) : 0;

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Stat
        label="Last response"
        value={latest ? statusLabel(latest) : '—'}
        tone={!latest ? undefined : latest.ok ? 'ok' : 'err'}
      />
      <Stat
        label="Last latency"
        value={latest ? `${latest.latencyMs} ms` : '—'}
        tone={latencyTone(latest?.latencyMs)}
      />
      <Stat
        label="Success rate"
        value={`${successRate}%`}
        tone={successRate >= 95 ? 'ok' : successRate >= 50 ? 'warn' : 'err'}
        okCount={counters.ok}
        failCount={counters.fail}
        highlight
      />
      <Stat
        label="Avg latency"
        value={`${avgLatency} ms`}
        sub={`max ${maxLatency} ms`}
      />
    </div>
  );
}
