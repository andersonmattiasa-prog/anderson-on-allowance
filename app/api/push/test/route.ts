import { NextResponse } from 'next/server';
import { json, requireOwner } from '@/lib/server/auth';
import { configured, sendAll } from '@/lib/server/push';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const meta = await requireOwner(req);
  if (meta instanceof NextResponse) return meta;
  if (!configured()) return json({ error: 'Notifications are not set up on the server (VAPID keys missing).' }, 503);
  const sent = await sendAll({ title: 'Anderson Ahead', body: 'Notifications are working 🎉', tag: 'test' });
  return json({ sent });
}
