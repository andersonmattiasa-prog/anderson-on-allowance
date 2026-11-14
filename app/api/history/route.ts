import { NextResponse } from 'next/server';
import { json, requireOwner } from '@/lib/server/auth';
import { getHistory, parseTickers } from '@/lib/server/yahoo';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const meta = await requireOwner(req);
  if (meta instanceof NextResponse) return meta;
  const url = new URL(req.url);
  return json({ series: await getHistory(parseTickers(url.searchParams.get('t')), url.searchParams.get('range') || '1y') });
}
