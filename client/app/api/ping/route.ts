import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const url = process.env.SERVER_URL || 'http://playground-server-http.playground.svc.cluster.local:8080';
  const timeoutMs = parseInt(process.env.FETCH_TIMEOUT_MS || '0', 10);
  const started = Date.now();

  const controller = new AbortController();
  const timeoutId =
    timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
    const body = await res.text();
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      body,
      latencyMs: Date.now() - started,
      upstream: url,
      servedBy: res.headers.get('x-served-by'),
      appVersion: res.headers.get('x-app-version') || '',
      meshClientId: res.headers.get('x-mesh-client-id') || '',
      proxyError: res.headers.get('l5d-proxy-error') || '',
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      status: 0,
      body: '',
      error: String(e),
      latencyMs: Date.now() - started,
      upstream: url,
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
