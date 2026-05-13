'use client';

import { useEffect, useRef, useState } from 'react';
import { MAX_HISTORY, POLL_INTERVAL_MS } from '../lib/constants';
import type { Counters, Sample } from '../lib/types';

export function usePinger() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [upstream, setUpstream] = useState('');
  const countersRef = useRef<Counters>({ ok: 0, fail: 0, v1: 0, v2: 0, vOther: 0 });

  useEffect(() => {
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
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { samples, upstream, counters: countersRef.current };
}
