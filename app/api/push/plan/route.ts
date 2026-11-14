import { NextResponse } from 'next/server';
import { json, readJson, requireOwner } from '@/lib/server/auth';
import { getPlan, savePlan, type PushPlan } from '@/lib/server/push';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request) {
  const meta = await requireOwner(req);
  if (meta instanceof NextResponse) return meta;
  const p = await readJson<PushPlan>(req, 20_000);
  if (!p || typeof p.weekly !== 'number' || typeof p.weekStart !== 'string' || !p.prefs) return json({ error: 'Bad plan' }, 400);
  const old = await getPlan();
  // Keep warnings already sent this week so they don't repeat.
  const warned = old && old.weekStart === p.weekStart ? Math.max(old.warned, p.warned || 0) : p.warned || 0;
  await savePlan({
    tz: String(p.tz || 'Europe/Brussels').slice(0, 64),
    primary: p.primary === 'CAD' ? 'CAD' : 'EUR',
    fxRate: Number(p.fxRate) || 1.5,
    weekly: p.weekly,
    weekStart: p.weekStart,
    weekSpent: Number(p.weekSpent) || 0,
    warned,
    cards: (p.cards || []).slice(0, 10).map((c) => ({ name: String(c.name).slice(0, 60), dueDay: Number(c.dueDay), autopay: !!c.autopay })),
    challenge: p.challenge ? { name: String(p.challenge.name).slice(0, 60), start: p.challenge.start, end: p.challenge.end } : undefined,
    reviewPending: p.reviewPending ? String(p.reviewPending).slice(0, 30) : undefined,
    prefs: p.prefs,
    updatedAt: Date.now(),
  });
  return json({ ok: true });
}
