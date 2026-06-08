import { NextResponse } from 'next/server';
import { configStore } from '../../lib/configStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// The dashboard owns the live generator config. The playground-client
// generator pulls it (GET) and the UI mutates it (POST, partial body).
export async function GET() {
  return NextResponse.json(configStore.get());
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // Ignore malformed bodies; treat as no-op.
  }
  return NextResponse.json(configStore.update(body));
}
