import type { Sample } from './types';

export function getUpstreamUrl(): string {
  return (
    process.env.SERVER_URL ||
    'http://playground-server-http.playground.svc.cluster.local:8080'
  );
}

export async function performPing(): Promise<Sample> {
  const url = getUpstreamUrl();
  const timeoutMs = parseInt(process.env.FETCH_TIMEOUT_MS || '0', 10);
  const started = Date.now();

  const controller = new AbortController();
  const timeoutId =
    timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
    });
    const body = await res.text();
    return {
      t: started,
      status: res.status,
      latencyMs: Date.now() - started,
      body,
      ok: res.ok,
      servedBy: res.headers.get('x-served-by') ?? undefined,
      appVersion: res.headers.get('x-app-version') ?? undefined,
      meshClientId: res.headers.get('x-mesh-client-id') ?? undefined,
      proxyError: res.headers.get('l5d-proxy-error') ?? undefined,
      upstream: url,
    };
  } catch (e) {
    return {
      t: started,
      status: 0,
      latencyMs: Date.now() - started,
      body: '',
      ok: false,
      error: String(e),
      upstream: url,
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
