import { NextResponse } from 'next/server';
import { json, readJson, requireOwner } from '@/lib/server/auth';
import { compareAndSetVault, get } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const meta = await requireOwner(req);
  if (meta instanceof NextResponse) return meta;
  const [ct, version] = await Promise.all([get('vault:ct'), get('vault:version')]);
  return json({ version: Number(version || 0), ct });
}

export async function PUT(req: Request) {
  const meta = await requireOwner(req);
  if (meta instanceof NextResponse) return meta;
  const body = await readJson<{ version?: number; ct?: string }>(req, 9_000_000);
  if (!body || typeof body.version !== 'number' || typeof body.ct !== 'string' || !body.ct.startsWith('v1.')) {
    return json({ error: 'Bad request' }, 400);
  }
  const res = await compareAndSetVault(body.version, body.ct);
  if (!res.ok) return json({ error: 'conflict', version: res.version }, 409);
  return json({ version: res.version });
}
