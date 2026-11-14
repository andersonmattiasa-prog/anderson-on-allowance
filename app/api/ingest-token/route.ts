import { NextResponse } from 'next/server';
import { json, readJson, requireOwner } from '@/lib/server/auth';
import { set } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

/** Store the hash of a new sync key (used by the Apple Pay shortcut, Gmail script and Wise webhook). */
export async function PUT(req: Request) {
  const meta = await requireOwner(req);
  if (meta instanceof NextResponse) return meta;
  const body = await readJson<{ hash?: string }>(req);
  if (!body?.hash || !/^[0-9a-f]{64}$/.test(body.hash)) return json({ error: 'Bad hash' }, 400);
  await set('meta', JSON.stringify({ ...meta, ingestHash: body.hash }));
  return json({ ok: true });
}
