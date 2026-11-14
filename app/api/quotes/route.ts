import { NextResponse } from 'next/server';
import { json, requireOwner } from '@/lib/server/auth';
import { getQuotes, parseTickers } from '@/lib/server/yahoo';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const meta = await requireOwner(req);
  if (meta instanceof NextResponse) return meta;
  const tickers = parseTickers(new URL(req.url).searchParams.get('t'));
  return json({ quotes: await getQuotes(tickers) });
}
