import type { GeneratorConfig, TargetAuthority } from './types';

export const MAX_INTERVAL_MS = 60000;
export const MAX_CONCURRENCY = 50;

const AUTHORITIES: TargetAuthority[] = ['apex', 'primary', 'canary', 'custom'];

function clampInterval(ms: number): number {
  return Math.max(0, Math.min(MAX_INTERVAL_MS, Math.round(ms)));
}

function clampConcurrency(n: number): number {
  return Math.max(1, Math.min(MAX_CONCURRENCY, Math.round(n)));
}

function normalizePath(path: string): string {
  if (!path) return '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function seedFromEnv(): GeneratorConfig {
  const interval = parseInt(process.env.POLL_INTERVAL_MS || '1000', 10);
  const concurrency = parseInt(process.env.CONCURRENCY || '1', 10);
  const authority = (process.env.TARGET_AUTHORITY || 'apex') as TargetAuthority;
  return {
    pollIntervalMs: Number.isFinite(interval) ? clampInterval(interval) : 1000,
    pollEnabled: (process.env.POLL_ENABLED ?? 'true').toLowerCase() !== 'false',
    concurrency: Number.isFinite(concurrency) ? clampConcurrency(concurrency) : 1,
    target: {
      authority: AUTHORITIES.includes(authority) ? authority : 'apex',
      url: process.env.TARGET_URL || '',
      path: normalizePath(process.env.TARGET_PATH || '/'),
    },
    headers: {},
  };
}

// Holds the live generator config the dashboard owns. The generator pulls this
// over HTTP (GET /api/config) and applies it; the UI mutates it (POST). Kept as
// a global singleton so it survives Next.js dev hot-reloads.
class ConfigStore {
  private config: GeneratorConfig = seedFromEnv();

  get(): GeneratorConfig {
    return {
      ...this.config,
      target: { ...this.config.target },
      headers: { ...this.config.headers },
    };
  }

  // Merge a (possibly partial, possibly untrusted) patch with validation.
  update(patch: Record<string, unknown>): GeneratorConfig {
    const c = this.config;

    if (typeof patch.pollIntervalMs === 'number' && Number.isFinite(patch.pollIntervalMs)) {
      c.pollIntervalMs = clampInterval(patch.pollIntervalMs);
    }
    if (typeof patch.pollEnabled === 'boolean') {
      c.pollEnabled = patch.pollEnabled;
    }
    if (typeof patch.concurrency === 'number' && Number.isFinite(patch.concurrency)) {
      c.concurrency = clampConcurrency(patch.concurrency);
    }
    if (patch.target && typeof patch.target === 'object') {
      const t = patch.target as Record<string, unknown>;
      if (typeof t.authority === 'string' && AUTHORITIES.includes(t.authority as TargetAuthority)) {
        c.target.authority = t.authority as TargetAuthority;
      }
      if (typeof t.url === 'string') c.target.url = t.url;
      if (typeof t.path === 'string') c.target.path = normalizePath(t.path);
    }
    if (patch.headers && typeof patch.headers === 'object' && !Array.isArray(patch.headers)) {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(patch.headers as Record<string, unknown>)) {
        if (k && typeof v === 'string') next[k] = v;
      }
      c.headers = next;
    }

    return this.get();
  }
}

const globalForConfig = globalThis as unknown as { __configStore?: ConfigStore };

export const configStore: ConfigStore =
  globalForConfig.__configStore ?? (globalForConfig.__configStore = new ConfigStore());
