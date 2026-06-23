import type { Sample } from './types';

export function getUpstreamUrl(): string {
  return (
    process.env.SERVER_URL ||
    'http://playground-server-http.playground.svc.cluster.local:8080'
  );
}

// Serialize the actual HTTP request that goes out - request line, Host, and the
// headers we attach. This is the real on-the-wire request (when the call is
// plaintext); the dashboard shows it as-is, or encrypted when it went over mTLS.
export function buildRawRequest(
  url: string,
  headers?: Record<string, string>,
): string {
  let path = '/';
  let host = '';
  try {
    const u = new URL(url);
    path = (u.pathname || '/') + (u.search || '');
    host = u.host;
  } catch {
    /* fall back to defaults */
  }
  const lines = [`GET ${path} HTTP/1.1`, `Host: ${host}`];
  for (const [k, v] of Object.entries(headers || {})) lines.push(`${k}: ${v}`);
  // Headers the fetch runtime (undici) adds for us.
  lines.push('Accept: */*', 'Accept-Encoding: gzip, deflate', 'Connection: keep-alive');
  return lines.join('\r\n') + '\r\n\r\n';
}

// Perform a single GET against `url`, attaching `headers`, and return a Sample
// describing the result. Shared by the dashboard's manual /api/ping and by the
// standalone traffic generator (which supplies a resolved target + headers).
export async function performPingTo(
  url: string,
  headers?: Record<string, string>,
  timeoutMs: number = parseInt(process.env.FETCH_TIMEOUT_MS || '0', 10),
): Promise<Sample> {
  const started = Date.now();

  const controller = new AbortController();
  const timeoutId =
    timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers,
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
      request: buildRawRequest(url, headers),
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
      request: buildRawRequest(url, headers),
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// Back-compat helper: ping the default upstream (apex Service) with no extra
// headers. Used by the dashboard's manual /api/ping route.
export async function performPing(): Promise<Sample> {
  return performPingTo(getUpstreamUrl());
}
