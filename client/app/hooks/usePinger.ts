'use client';

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_POLL_INTERVAL_MS, MAX_HISTORY } from '../lib/constants';
import type { Counters, Sample } from '../lib/types';

interface RuntimeConfig {
  pollIntervalMs: number;
  pollEnabled: boolean;
}

const ZERO_COUNTERS: Counters = { ok: 0, fail: 0, v1: 0, v2: 0, vOther: 0 };

export function usePinger() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [counters, setCounters] = useState<Counters>(ZERO_COUNTERS);
  const [upstream, setUpstream] = useState('');
  const [pollIntervalMs, setPollIntervalMsState] = useState<number>(
    DEFAULT_POLL_INTERVAL_MS,
  );

  // Subscribe to the server-side sample stream. The Next.js pod populates this
  // independently of any browser (see instrumentation.ts), so opening the page
  // shows whatever the pod has been doing.
  useEffect(() => {
    const es = new EventSource('/api/samples/stream');

    es.addEventListener('snapshot', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as {
          samples?: Sample[];
          counters?: Counters;
        };
        if (Array.isArray(data.samples)) {
          setSamples(data.samples.slice(0, MAX_HISTORY));
          const firstWithUpstream = data.samples.find((s) => s.upstream);
          if (firstWithUpstream?.upstream) setUpstream(firstWithUpstream.upstream);
        }
        if (data.counters) setCounters(data.counters);
      } catch {
        // ignore malformed payloads
      }
    });

    es.addEventListener('sample', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as {
          sample?: Sample;
          counters?: Counters;
        };
        if (data.sample) {
          const incoming = data.sample;
          setSamples((prev) => [incoming, ...prev].slice(0, MAX_HISTORY));
          if (incoming.upstream) setUpstream(incoming.upstream);
        }
        if (data.counters) setCounters(data.counters);
      } catch {
        // ignore malformed payloads
      }
    });

    return () => {
      es.close();
    };
  }, []);

  // Load the current server-side ticker config so the dropdown reflects truth.
  useEffect(() => {
    fetch('/api/config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((c: RuntimeConfig) => {
        const interval =
          typeof c.pollIntervalMs === 'number' && c.pollIntervalMs >= 0
            ? c.pollIntervalMs
            : DEFAULT_POLL_INTERVAL_MS;
        setPollIntervalMsState(c.pollEnabled === false ? 0 : interval);
      })
      .catch(() => {
        // /api/config unreachable — keep DEFAULT_POLL_INTERVAL_MS.
      });
  }, []);

  // Push interval changes to the server ticker. The UI dropdown is now a
  // remote control, not a local timer.
  const setPollIntervalMs = useCallback((ms: number) => {
    setPollIntervalMsState(ms);
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pollIntervalMs: ms,
        pollEnabled: ms > 0,
      }),
    }).catch(() => {
      // best-effort — UI state still reflects the user's intent
    });
  }, []);

  return {
    samples,
    upstream,
    counters,
    pollIntervalMs,
    setPollIntervalMs,
  };
}
