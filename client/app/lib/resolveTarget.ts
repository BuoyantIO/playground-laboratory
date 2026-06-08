import type { TargetConfig } from './types';

// The apex base URL the generator points at by default. Comes from SERVER_URL
// (set by the chart, e.g. http://playground-server-http.playground.svc.cluster.local:8080).
function apexBase(): string {
  return (
    process.env.SERVER_URL ||
    'http://playground-server-http.playground.svc.cluster.local:8080'
  ).replace(/\/+$/, '');
}

// Derive the primary/canary per-role Service URL from the apex base by
// suffixing the first host label (the Service name). This keeps the namespace,
// port and scheme identical to whatever SERVER_URL points at.
function withRole(base: string, role: 'primary' | 'canary'): string {
  try {
    const u = new URL(base);
    const labels = u.hostname.split('.');
    labels[0] = `${labels[0]}-${role}`;
    u.hostname = labels.join('.');
    return u.origin;
  } catch {
    return base;
  }
}

function normalizePath(path: string): string {
  if (!path) return '/';
  return path.startsWith('/') ? path : `/${path}`;
}

// Resolve a TargetConfig to a concrete request URL. Shared by the generator.
export function resolveTarget(target: TargetConfig): string {
  const path = normalizePath(target.path);

  if (target.authority === 'custom') {
    const base = (target.url || apexBase()).replace(/\/+$/, '');
    return base + path;
  }

  let base = apexBase();
  if (target.authority === 'primary') base = withRole(base, 'primary');
  else if (target.authority === 'canary') base = withRole(base, 'canary');
  return base + path;
}
