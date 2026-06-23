import { NextResponse } from 'next/server';
import { findTutorial } from '../../../lib/tutorials';
import { loadTutorialContent } from '../../../lib/tutorials.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Serves a tutorial's markdown ({ en, kr }) to the client-side tutorial panel.
// The standalone /tutorials/[slug] pages bake content at build time; the panel
// fetches it at runtime through here.
export async function GET(
  _req: Request,
  { params }: { params: { slug: string } },
) {
  // Validate against the known list - also prevents path traversal via slug.
  if (!findTutorial(params.slug)) {
    return new NextResponse(null, { status: 404 });
  }
  try {
    return NextResponse.json(await loadTutorialContent(params.slug));
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
