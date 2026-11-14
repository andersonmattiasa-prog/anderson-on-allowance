import { NextResponse } from 'next/server';
import { json, readJson, requireOwner } from '@/lib/server/auth';
import { addSubscription, removeSubscription } from '@/lib/server/push';

export const dynamic = 'force-dynamic';

interface Sub { endpoint?: string; keys?: { p256dh?: string; auth?: string } }

export async function POST(req: Request) {
  const meta = await requireOwner(req);
  if (meta instanceof NextResponse) return meta;
  const sub = await readJson<Sub>(req, 10_000);
  if (!sub?.endpoint?.startsWith('https://') || !sub.keys?.p256dh || !sub.keys.auth) return json({ error: 'Bad subscription' }, 400);
  await addSubscription({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
  return json({ ok: true });
}

export async function DELETE(req: Request) {
  const meta = await requireOwner(req);
  if (meta instanceof NextResponse) return meta;
  const body = await readJson<{ endpoint?: string }>(req, 10_000);
  if (body?.endpoint) await removeSubscription(body.endpoint);
  return json({ ok: true });
}
