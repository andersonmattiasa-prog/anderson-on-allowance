import { json, safeEqual } from '@/lib/server/auth';
import { getPlan, localToday, sendAll } from '@/lib/server/push';

export const dynamic = 'force-dynamic';

const money = (n: number, cur: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n);

/** Daily reminders, run by Vercel Cron at 07:00 UTC. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') || '';
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return json({ error: 'unauthorized' }, 401);
  const plan = await getPlan();
  if (!plan) return json({ ok: true, sent: 0, note: 'no plan yet' });
  const { date, weekday, day, y, m } = localToday(plan.tz);
  const msgs: { title: string; body: string; tag: string }[] = [];
  const p = plan.prefs;

  if (p.cardDue) {
    for (const c of plan.cards) {
      if (c.autopay || !c.dueDay) continue;
      let due = new Date(y, m - 1, Math.min(c.dueDay, new Date(y, m, 0).getDate()));
      const today = new Date(y, m - 1, day);
      if (due < today) due = new Date(y, m, c.dueDay);
      const days = Math.round((due.getTime() - today.getTime()) / 864e5);
      if ([3, 1, 0].includes(days)) {
        msgs.push({ title: `💳 ${c.name}`, body: days === 0 ? 'Payment is due today.' : `Payment is due in ${days} day${days > 1 ? 's' : ''}.`, tag: `card-${c.name}` });
      }
    }
  }
  if (p.monday && weekday === 1) {
    msgs.push({ title: 'New week 🌱', body: `Your allowance this week is ${money(plan.weekly, plan.primary)}. Stay in the green!`, tag: 'monday' });
  }
  if (p.sunday && weekday === 0) {
    const left = plan.weekly - plan.weekSpent;
    msgs.push({
      title: 'Week recap',
      body: left >= 0 ? `You spent ${money(plan.weekSpent, plan.primary)} of ${money(plan.weekly, plan.primary)} — ${money(left, plan.primary)} under. Nice.` : `You spent ${money(plan.weekSpent, plan.primary)}, ${money(-left, plan.primary)} over this week's allowance.`,
      tag: 'sunday',
    });
  }
  if (p.review && plan.reviewPending && day <= 3) {
    msgs.push({ title: 'Monthly review', body: `Take 3 minutes to review ${plan.reviewPending}.`, tag: 'review' });
  }
  if (p.challenge && plan.challenge) {
    if (plan.challenge.start === date) msgs.push({ title: 'Challenge starts today', body: `${plan.challenge.name} — you've got this.`, tag: 'challenge' });
    else if (plan.challenge.end === date) msgs.push({ title: 'Last day!', body: `Finish ${plan.challenge.name} strong today.`, tag: 'challenge' });
  }

  let sent = 0;
  for (const msg of msgs) sent += await sendAll(msg);
  return json({ ok: true, messages: msgs.length, sent });
}
