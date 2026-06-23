'use client';

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_GENERATOR_CONFIG, MAX_HISTORY } from '../lib/constants';
import type { Counters, GeneratorConfig, Sample } from '../lib/types';

const ZERO_COUNTERS: Counters = { ok: 0, fail: 0, v1: 0, v2: 0, vOther: 0 };

export function usePinger() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [counters, setCounters] = useState<Counters>(ZERO_COUNTERS);
  const [upstream, setUpstream] = useState('');
  const [config, setConfigState] = useState<GeneratorConfig>(
    DEFAULT_GENERATOR_CONFIG,
  );

  // Subscribe to the dashboard's sample stream. Samples are produced by the
  // separate playground-client generator and pushed to /api/ingest, which fans
  // them out here - so opening the page shows whatever the generator has been
  // doing, with no browser-side traffic generation.
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

  // Load the live generator config so the controls reflect the source of truth.
  useEffect(() => {
    fetch('/api/config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((c: GeneratorConfig) =>
        setConfigState((prev) => ({
          ...prev,
          ...c,
          target: { ...prev.target, ...c.target },
          headers: c.headers ?? prev.headers,
        })),
      )
      .catch(() => {
        // /api/config unreachable - keep defaults.
      });
  }, []);

  // Apply a (partial) config change: optimistic local update, then POST and
  // reconcile with the server's validated/clamped response. The dashboard is
  // the source of truth; the generator picks the change up on its next poll.
  const setConfig = useCallback((patch: Partial<GeneratorConfig>) => {
    setConfigState((prev) => ({
      ...prev,
      ...patch,
      target: patch.target ? { ...prev.target, ...patch.target } : prev.target,
      headers: patch.headers ?? prev.headers,
    }));
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
      .then((r) => r.json())
      .then((c: GeneratorConfig) => setConfigState(c))
      .catch(() => {
        // best-effort - local state still reflects the user's intent
      });
  }, []);

  return { samples, upstream, counters, config, setConfig };
}
