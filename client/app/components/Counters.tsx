'use client';

import { useTranslation } from '../lib/i18n';
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
  const { t } = useTranslation();
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
        label={t('counters.lastResponse')}
        value={latest ? statusLabel(latest) : '—'}
        tone={!latest ? undefined : latest.ok ? 'ok' : 'err'}
      />
      <Stat
        label={t('counters.lastLatency')}
        value={latest ? `${latest.latencyMs} ms` : '—'}
        tone={latencyTone(latest?.latencyMs)}
      />
      <Stat
        label={t('counters.successRate')}
        value={`${successRate}%`}
        tone={successRate >= 95 ? 'ok' : successRate >= 50 ? 'warn' : 'err'}
        okCount={counters.ok}
        failCount={counters.fail}
        highlight
      />
      <Stat
        label={t('counters.avgLatency')}
        value={`${avgLatency} ms`}
        sub={t('counters.max', { ms: maxLatency })}
      />
    </div>
  );
}
