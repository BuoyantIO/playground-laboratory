import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Runtime configuration exposed to the browser. Each request re-reads
// process.env so that `kubectl set env` followed by a rollout takes effect
// without rebuilding the image.
export async function GET() {
  const pollIntervalMs = Math.max(
    100,
    parseInt(process.env.POLL_INTERVAL_MS || '1000', 10) || 1000,
  );
  const pollEnabled =
    (process.env.POLL_ENABLED ?? 'true').toLowerCase() !== 'false';

  return NextResponse.json({
    pollIntervalMs,
    pollEnabled,
  });
}
