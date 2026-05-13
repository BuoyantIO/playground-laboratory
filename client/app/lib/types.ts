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
};

export type Counters = {
  ok: number;
  fail: number;
  v1: number;
  v2: number;
  vOther: number;
};
