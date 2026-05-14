import { NextResponse } from 'next/server';
import { ticker } from '../../lib/ticker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_INTERVAL_MS = 60000;

function snapshot() {
  return {
    pollIntervalMs: ticker.intervalMs,
    pollEnabled: ticker.isActive(),
  };
}

export async function GET() {
  return NextResponse.json(snapshot());
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // Ignore malformed bodies; treat as no-op.
  }

  if (typeof body.pollIntervalMs === 'number' && Number.isFinite(body.pollIntervalMs)) {
    const ms = Math.max(0, Math.min(MAX_INTERVAL_MS, body.pollIntervalMs));
    ticker.setInterval(ms);
  }
  if (typeof body.pollEnabled === 'boolean') {
    ticker.setEnabled(body.pollEnabled);
  }

  return NextResponse.json(snapshot());
}
