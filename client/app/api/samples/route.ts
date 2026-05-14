import { NextResponse } from 'next/server';
import { samplesStore } from '../../lib/samplesStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(samplesStore.snapshot());
}
