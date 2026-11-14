import { randomUUID } from 'crypto';
import { bearer, getMeta, json, safeEqual, seal, sha256 } from '@/lib/server/auth';
import { hlen, hset } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

const SOURCES = new Set(['applepay', 'email', 'wise', 'manual']);
const MAX_ITEMS = 2000;

/** Receive a purchase and seal it immediately with the vault's public key. The server can't read it afterwards. */
export async function POST(req: Request, ctx: { params: Promise<{ source: string }> }) {
  const { source } = await ctx.params;
  if (!SOURCES.has(source)) return json({ error: 'Unknown source' }, 404);
  const meta = await getMeta();
  const url = new URL(req.url);
  const key = bearer(req) || req.headers.get('x-sync-key') || url.searchParams.get('key');
  if (!meta?.ingestHash || !key || !safeEqual(sha256(key), meta.ingestHash)) return json({ error: 'unauthorized' }, 401);

  const text = await req.text();
  if (text.length > 64_000) return json({ error: 'Too large' }, 413);
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : Object.fromEntries(url.searchParams);
  } catch {
    payload = { text };
  }
  if (payload && typeof payload === 'object') delete (payload as Record<string, unknown>).key;
  if ((await hlen('inbox')) >= MAX_ITEMS) return json({ error: 'Inbox full — open the app to sync' }, 507);

  const item = { id: randomUUID(), at: Date.now(), source, ...(await seal(meta.publicKey, payload)) };
  await hset('inbox', item.id, JSON.stringify(item));
  return json({ ok: true });
}
