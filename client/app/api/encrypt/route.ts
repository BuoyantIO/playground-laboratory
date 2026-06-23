import crypto from 'node:crypto';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Real AES-256-GCM encryption of a request blob, returned as hex. Used by the
// "Raw request" viewer to show what a request looks like on the wire when the
// call went over mTLS: genuine ciphertext (random key + IV each call), not a
// made-up string. The wire layout is iv(12) | ciphertext | authTag(16).
export async function POST(req: Request) {
  let text = '';
  try {
    const body = (await req.json()) as { text?: unknown };
    text = typeof body.text === 'string' ? body.text : '';
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const hex = Buffer.concat([iv, ct, tag]).toString('hex');

  return NextResponse.json({ hex });
}
