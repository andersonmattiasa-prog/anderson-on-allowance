import { randomUUID } from 'crypto';
import { after } from 'next/server';
import { bearer, getMeta, json, safeEqual, seal, sha256 } from '@/lib/server/auth';
import { hlen, hset } from '@/lib/server/store';
import { getPlan, localToday, savePlan, sendAll } from '@/lib/server/push';
import { parseAmount } from '@/lib/money';
import { weekStart } from '@/lib/util';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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
  // Reply to the iPhone right away; the allowance warning runs after the response is sent.
  if (source === 'applepay') after(() => allowanceWarning(payload).catch(() => {}));
  return json({ ok: true });
}

/** The Apple Pay amount is read here only to warn at 80% / 100% of the weekly allowance. */
async function allowanceWarning(payload: unknown) {
  const plan = await getPlan();
  if (!plan || !plan.prefs.allowance || !plan.weekly) return;
  const raw = (payload as Record<string, unknown>)?.amount;
  const a = parseAmount(String(raw ?? ''));
  if (!a || !a.amount) return;
  const cur = a.currency ?? plan.primary;
  const amt = Math.abs(cur === plan.primary ? a.amount : cur === 'EUR' ? a.amount * plan.fxRate : a.amount / plan.fxRate);
  const ws = weekStart(localToday(plan.tz).date);
  if (plan.weekStart !== ws) Object.assign(plan, { weekStart: ws, weekSpent: 0, warned: 0 });
  plan.weekSpent += amt;
  const pct = (plan.weekSpent / plan.weekly) * 100;
  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: plan.primary }).format(n);
  if (pct >= 100 && plan.warned < 100) {
    plan.warned = 100;
    await sendAll({ title: 'Over this week’s allowance', body: `You've spent ${fmt(plan.weekSpent)} of ${fmt(plan.weekly)}. Try a no-spend day tomorrow.`, tag: 'allowance' });
  } else if (pct >= 80 && plan.warned < 80) {
    plan.warned = 80;
    await sendAll({ title: '80% of your allowance', body: `${fmt(plan.weekly - plan.weekSpent)} left for the rest of the week.`, tag: 'allowance' });
  }
  await savePlan(plan);
}
