'use client';

import { useEffect, useRef, useState } from 'react';
import { DEFAULT_POLL_INTERVAL_MS, MAX_HISTORY } from '../lib/constants';
import type { Counters, Sample } from '../lib/types';

interface RuntimeConfig {
  pollIntervalMs: number;
  pollEnabled: boolean;
}

export function usePinger() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [upstream, setUpstream] = useState('');
  // Effective polling interval in ms. 0 means paused.
  const [pollIntervalMs, setPollIntervalMs] = useState<number>(
    DEFAULT_POLL_INTERVAL_MS,
  );
  const countersRef = useRef<Counters>({
    ok: 0,
    fail: 0,
    v1: 0,
    v2: 0,
    vOther: 0,
  });

  // Load runtime config from /api/config on mount. POLL_INTERVAL_MS and
  // POLL_ENABLED env vars on the Next.js pod are the source of truth for
  // the initial value; the user can override it via the UI dropdown.
  useEffect(() => {
    fetch('/api/config', { cache: 'no-store' })
      .then(r => r.json())
      .then((c: RuntimeConfig) => {
        const enabled = c.pollEnabled !== false;
        const interval =
          typeof c.pollIntervalMs === 'number' && c.pollIntervalMs > 0
            ? c.pollIntervalMs
            : DEFAULT_POLL_INTERVAL_MS;
        setPollIntervalMs(enabled ? interval : 0);
      })
      .catch(() => {
        // /api/config unreachable — keep DEFAULT_POLL_INTERVAL_MS.
      });
  }, []);

  // Polling loop, restarts whenever the effective interval changes.
  useEffect(() => {
    if (pollIntervalMs <= 0) return;

    let cancelled = false;

    const tick = async () => {
      const t0 = performance.now();
      let sample: Sample;
      try {
        const res = await fetch('/api/ping', { cache: 'no-store' });
        const data = await res.json();
        sample = {
          t: Date.now(),
          status: data.status,
          latencyMs: Math.round(performance.now() - t0),
          body: data.body || '',
          ok: data.ok,
          error: data.error,
          servedBy: data.servedBy,
          appVersion: data.appVersion,
          meshClientId: data.meshClientId,
          proxyError: data.proxyError,
        };
        if (data.upstream) setUpstream(data.upstream);
      } catch (e) {
        sample = {
          t: Date.now(),
          status: 0,
          latencyMs: Math.round(performance.now() - t0),
          body: '',
          ok: false,
          error: String(e),
        };
      }
      if (cancelled) return;
      if (sample.ok) countersRef.current.ok++;
      else countersRef.current.fail++;
      if (sample.ok) {
        if (sample.appVersion === 'v1') countersRef.current.v1++;
        else if (sample.appVersion === 'v2') countersRef.current.v2++;
        else countersRef.current.vOther++;
      }
      setSamples(prev => [sample, ...prev].slice(0, MAX_HISTORY));
    };

    tick();
    const id = setInterval(tick, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollIntervalMs]);

  return {
    samples,
    upstream,
    counters: countersRef.current,
    pollIntervalMs,
    setPollIntervalMs,
  };
}
