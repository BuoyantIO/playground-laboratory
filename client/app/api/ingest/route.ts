import { NextResponse } from 'next/server';
import { samplesStore } from '../../lib/samplesStore';
import type { Sample } from '../../lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isSample(v: unknown): v is Sample {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as Sample).t === 'number' &&
    typeof (v as Sample).status === 'number' &&
    typeof (v as Sample).ok === 'boolean'
  );
}

// Ingest endpoint: the playground-client generator POSTs each Sample here. We
// record it into the shared store, which fans out to the SSE stream the
// browser is watching - so the dashboard's flow diagram + counters stay live.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const batch =
    body && typeof body === 'object' && Array.isArray((body as { samples?: unknown }).samples)
      ? (body as { samples: unknown[] }).samples
      : [body];

  let recorded = 0;
  for (const s of batch) {
    if (isSample(s)) {
      samplesStore.record(s);
      recorded++;
    }
  }

  if (recorded === 0) return new NextResponse(null, { status: 400 });
  return new NextResponse(null, { status: 204 });
}
