import { NextResponse } from 'next/server';
import { json, readJson, requireOwner } from '@/lib/server/auth';
import { hdel, hgetall } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const meta = await requireOwner(req);
  if (meta instanceof NextResponse) return meta;
  const all = await hgetall('inbox');
  const items = Object.values(all)
    .map((s) => JSON.parse(s))
    .sort((a, b) => a.at - b.at);
  return json({ items });
}

export async function DELETE(req: Request) {
  const meta = await requireOwner(req);
  if (meta instanceof NextResponse) return meta;
  const body = await readJson<{ ids?: string[] }>(req);
  const ids = (body?.ids || []).filter((x) => typeof x === 'string').slice(0, 1000);
  await hdel('inbox', ids);
  return json({ ok: true, removed: ids.length });
}
