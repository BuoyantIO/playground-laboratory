export type Sample = {
  t: number;
  status: number;
  latencyMs: number;
  body: string;
  ok: boolean;
  error?: string;
  servedBy?: string;
  appVersion?: string;
  meshClientId?: string;
  proxyError?: string;
  upstream?: string;
};

export type Counters = {
  ok: number;
  fail: number;
  v1: number;
  v2: number;
  vOther: number;
};

// Which destination the traffic generator aims at. `apex` is the round-robin
// Service (playground-server-http); primary/canary target the per-role
// Services directly; custom uses an explicit URL.
export type TargetAuthority = 'apex' | 'primary' | 'canary' | 'custom';

export type TargetConfig = {
  authority: TargetAuthority;
  // Only used when authority === 'custom'.
  url: string;
  // Request path, always begins with '/'.
  path: string;
};

// The full live-config contract shared between the dashboard (source of truth)
// and the playground-client generator (which pulls it). A POST to /api/config
// may carry any subset of these fields.
export type GeneratorConfig = {
  pollIntervalMs: number;
  pollEnabled: boolean;
  concurrency: number;
  target: TargetConfig;
  headers: Record<string, string>;
};
