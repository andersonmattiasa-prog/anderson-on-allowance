import type { Challenge, Vault } from './types';
import { catMap, dailyVariable, firstTxDate, inPrimary, plan } from './calc';
import { addDays, monthOf, parseDate, todayStr, weekStart } from './util';
import { investStreak } from './invest';

export interface ChallengeDef {
  type: string;
  name: string;
  icon: string;
  days: number;
  blurb: string;
  /** spending that counts against the challenge on a given day, and the allowed total */
  check: (v: Vault, c: Challenge) => { used: number; limit: number };
}

function spentIn(v: Vault, c: Challenge, cats: string[] | null, filter?: (date: string) => boolean) {
  const cm = catMap(v);
  let sum = 0;
  for (const t of v.transactions) {
    if (t.date < c.start || t.date > c.end) continue;
    if (filter && !filter(t.date)) continue;
    const kind = cm.get(t.category)?.kind;
    if (kind !== 'spend') continue;
    if (cats && !cats.includes(t.category)) continue;
    sum -= inPrimary(v, t);
  }
  return Math.max(0, sum);
}

const isWeekend = (d: string) => [0, 6].includes(parseDate(d).getDay());

export const CHALLENGES: ChallengeDef[] = [
  { type: 'no-takeaway', name: 'No takeaway week', icon: '🥡', days: 7, blurb: 'Seven days without delivery or fast food.', check: (v, c) => ({ used: spentIn(v, c, ['takeaway']), limit: 0 }) },
  { type: 'no-shopping', name: 'No shopping week', icon: '🛍️', days: 7, blurb: 'Nothing from the shopping category for a week.', check: (v, c) => ({ used: spentIn(v, c, ['shopping']), limit: 0 }) },
  { type: 'cafe-10', name: '€10 café week', icon: '☕', days: 7, blurb: 'Keep cafés and bakeries under €10 for the week.', check: (v, c) => ({ used: spentIn(v, c, ['cafes']), limit: 10 }) },
  { type: 'no-spend-weekend', name: 'No-spend weekend', icon: '🧘', days: 2, blurb: 'Saturday and Sunday with zero everyday spending.', check: (v, c) => ({ used: spentIn(v, c, null, isWeekend), limit: 0 }) },
  { type: 'beat-allowance', name: 'Beat the allowance', icon: '🎯', days: 7, blurb: 'Spend less than your weekly allowance.', check: (v, c) => ({ used: spentIn(v, c, null), limit: plan(v, monthOf(c.start)).weekly }) },
  { type: 'no-shopping-30', name: '30 days no shopping', icon: '🏆', days: 30, blurb: 'A full month with no shopping purchases.', check: (v, c) => ({ used: spentIn(v, c, ['shopping']), limit: 0 }) },
];

export function challengeStartDate(type: string, today = todayStr()): string {
  if (type === 'no-spend-weekend') {
    const d = parseDate(today).getDay();
    return d === 6 || d === 0 ? (d === 6 ? today : addDays(today, -1)) : addDays(today, 6 - d);
  }
  return today;
}

export function challengeStatus(v: Vault, c: Challenge, today = todayStr()) {
  const def = CHALLENGES.find((d) => d.type === c.type);
  if (!def) return null;
  const { used, limit } = def.check(v, c);
  const failed = used > limit + 0.005;
  const state = failed ? 'failed' : today > c.end ? 'won' : today < c.start ? 'upcoming' : 'active';
  const daysLeft = Math.max(0, Math.round((parseDate(c.end).getTime() - parseDate(today).getTime()) / 864e5) + 1);
  return { def, used, limit, state, daysLeft } as const;
}

export function streaks(v: Vault, today = todayStr()) {
  const dv = dailyVariable(v);
  const first = firstTxDate(v) ?? today;
  // No-spend days this month
  let noSpend = 0;
  for (let d = `${monthOf(today)}-01`; d <= today; d = addDays(d, 1)) if (d >= first && !((dv.get(d) || 0) > 0)) noSpend++;
  // Weeks in a row under allowance (completed weeks)
  let weeks = 0;
  let ws = addDays(weekStart(today), -7);
  while (ws >= weekStart(first) && weeks < 520) {
    let sum = 0;
    for (let i = 0; i < 7; i++) sum += dv.get(addDays(ws, i)) || 0;
    if (sum > plan(v, monthOf(ws)).weekly) break;
    weeks++;
    ws = addDays(ws, -7);
  }
  return { noSpend, weeksUnder: weeks, monthsInvested: investStreak(v, today) };
}
