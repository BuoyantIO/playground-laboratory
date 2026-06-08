import type { GeneratorConfig, TargetAuthority } from './types';

export const MAX_HISTORY = 120;

// Default polling cadence used when /api/config isn't reachable. The
// authoritative value comes from the POLL_INTERVAL_MS / POLL_ENABLED env
// vars served by /api/config.
export const DEFAULT_POLL_INTERVAL_MS = 1000;

// Selectable polling cadences shown in the UI dropdown. A value of 0
// means polling is paused.
export interface PollIntervalOption {
  label: string;
  value: number;
}

export const POLL_INTERVAL_OPTIONS: PollIntervalOption[] = [
  { label: 'Paused', value: 0 },
  { label: '250 ms', value: 250 },
  { label: '500 ms', value: 500 },
  { label: '1 s', value: 1000 },
  { label: '2 s', value: 2000 },
  { label: '5 s', value: 5000 },
  { label: '10 s', value: 10000 },
  { label: '30 s', value: 30000 },
];

// Concurrency choices shown in the UI (requests kept in flight per tick).
export const CONCURRENCY_OPTIONS: number[] = [1, 2, 4, 8, 16];

// Target authorities selectable in the UI. Labels are resolved via i18n keys
// `target.<value>` in the control itself.
export const TARGET_AUTHORITY_OPTIONS: TargetAuthority[] = [
  'apex',
  'primary',
  'canary',
  'custom',
];

// Client-side fallback used until /api/config responds.
export const DEFAULT_GENERATOR_CONFIG: GeneratorConfig = {
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  pollEnabled: true,
  concurrency: 1,
  target: { authority: 'apex', url: '', path: '/' },
  headers: {},
};

// A sample is considered "stale" if the newest one is older than this; the
// topology liveness chip uses it to flag a generator that stopped pushing.
export const STALE_SAMPLE_MS = 8000;
