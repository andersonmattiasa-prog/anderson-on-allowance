import type { Category, CatKind, Tx, Vault } from './types';
import { toCur } from './money';
import { addDays, addMonths, daysInMonth, diffDays, monthOf, parseDate, todayStr } from './util';
import { merchantKey } from './categorize';
import { tripOf } from './trips';

export const catMap = (v: Vault) => new Map<string, Category>(v.categories.map((c) => [c.id, c]));
export const inPrimary = (v: Vault, t: Pick<Tx, 'amount' | 'currency'>) => toCur(t.amount, t.currency, v.settings.primary, v.fx.rate);
export const toPrimary = (v: Vault, amount: number, cur: Tx['currency']) => toCur(amount, cur, v.settings.primary, v.fx.rate);
export const toSecondary = (v: Vault, amountPrimary: number) => toCur(amountPrimary, v.settings.primary, v.settings.secondary, v.fx.rate);

const SPENDING: CatKind[] = ['spend', 'fixed'];

/** The month's plan: pay, investing, fixed costs and what's left for everyday spending. */
export function plan(v: Vault, month: string) {
  const dim = daysInMonth(month);
  const pay = v.settings.income;
  const invest = (pay * v.settings.investPercent) / 100;
  const billsByCat = new Map<string, number>();
  for (const b of v.bills) billsByCat.set(b.category, (billsByCat.get(b.category) || 0) + toPrimary(v, b.amount, b.currency));
  let fixed = 0;
  for (const c of v.categories) if (c.kind === 'fixed') fixed += Math.max(billsByCat.get(c.id) || 0, c.limit || 0);
  const spendable = pay - invest - fixed;
  const weekly = v.settings.weeklyAllowance ?? Math.max(0, spendable / (dim / 7));
  return { dim, pay, invest, fixed, spendable, weekly, dailyPay: pay / dim, dailyFixed: fixed / dim, dailyInvest: invest / dim };
}

export interface MerchantAgg {
  name: string;
  total: number;
  count: number;
}

export function monthStats(v: Vault, month: string, uptoDay?: number) {
  const cats = catMap(v);
  let spent = 0, variable = 0, fixedSpent = 0, income = 0, invested = 0, tripSpent = 0;
  const byCat = new Map<string, number>();
  const byMerchant = new Map<string, MerchantAgg>();
  for (const t of v.transactions) {
    if (!t.date.startsWith(month)) continue;
    if (uptoDay && Number(t.date.slice(8)) > uptoDay) continue;
    const c = cats.get(t.category);
    if (!c) continue;
    const a = inPrimary(v, t);
    if (SPENDING.includes(c.kind)) {
      spent -= a;
      // Trips are planned spending: counted in the month's total, kept out of everyday spending.
      if (c.kind === 'spend' && v.trips.length && tripOf(v, t, cats)) {
        tripSpent -= a;
        continue;
      }
      if (c.kind === 'spend') variable -= a;
      else fixedSpent -= a;
      byCat.set(c.id, (byCat.get(c.id) || 0) - a);
      if (c.kind === 'spend') {
        const k = merchantKey(t.merchant) || t.merchant;
        const m = byMerchant.get(k) || { name: t.merchant, total: 0, count: 0 };
        m.total -= a;
        m.count++;
        byMerchant.set(k, m);
      }
    } else if (c.kind === 'income' && a > 0) income += a;
    else if (c.kind === 'invest') invested -= a;
  }
  return { spent, variable, fixedSpent, income, invested, tripSpent, byCat, byMerchant };
}

/** Everyday (non-fixed) spending per day, in the primary currency. */
export function dailyVariable(v: Vault): Map<string, number> {
  const cats = catMap(v);
  const out = new Map<string, number>();
  for (const t of v.transactions) {
    if (cats.get(t.category)?.kind !== 'spend') continue;
    if (v.trips.length && tripOf(v, t, cats)) continue; // trips don't count against the day
    out.set(t.date, (out.get(t.date) || 0) - inPrimary(v, t));
  }
  return out;
}

export function firstTxDate(v: Vault): string | null {
  let min: string | null = null;
  for (const t of v.transactions) if (!min || t.date < min) min = t.date;
  return min;
}

/** Daily net: pay per day − investing per day − daily share of fixed costs − that day's spending. */
export function dayNet(v: Vault, date: string, dv: Map<string, number>): number {
  const p = plan(v, monthOf(date));
  return p.dailyPay - p.dailyInvest - p.dailyFixed - (dv.get(date) || 0);
}

export function greenStreak(v: Vault, dv: Map<string, number>, today = todayStr()): number {
  const first = firstTxDate(v);
  if (!first) return 0;
  // Today counts once it's green; a red "today" isn't over yet, so count from yesterday.
  let n = 0;
  let d = dayNet(v, today, dv) >= 0 ? today : addDays(today, -1);
  while (d >= first && dayNet(v, d, dv) >= 0 && n < 3650) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export function cardAlerts(v: Vault, today = todayStr()) {
  const out: { account: string; name: string; due: string; days: number; autopay: boolean }[] = [];
  for (const a of v.accounts) {
    if (a.type !== 'credit' || !a.dueDay) continue;
    const t = parseDate(today);
    let due = new Date(t.getFullYear(), t.getMonth(), Math.min(a.dueDay, daysInMonth(monthOf(today))));
    if (due < t) due = new Date(t.getFullYear(), t.getMonth() + 1, a.dueDay);
    const dueStr = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
    const days = diffDays(dueStr, today);
    if (days <= 5) out.push({ account: a.id, name: a.name, due: dueStr, days, autopay: !!a.autopay });
  }
  return out.sort((a, b) => a.days - b.days);
}

export function trend(v: Vault, months: number, today = todayStr()) {
  const cur = monthOf(today);
  return Array.from({ length: months }, (_, i) => {
    const m = addMonths(cur, i - months + 1);
    const s = monthStats(v, m);
    return { month: m, spent: s.spent, variable: s.variable };
  });
}

/** Merchants charged in at least 3 of the last 6 months with a steady amount. */
export function recurring(v: Vault, today = todayStr()) {
  const cats = catMap(v);
  const since = addMonths(monthOf(today), -5);
  const groups = new Map<string, { name: string; months: Set<string>; amounts: number[]; category: string; last: string }>();
  for (const t of v.transactions) {
    const kind = cats.get(t.category)?.kind;
    if (!kind || !SPENDING.includes(kind) || t.amount >= 0 || monthOf(t.date) < since || t.bill) continue;
    const k = merchantKey(t.merchant);
    if (!k) continue;
    const g = groups.get(k) || { name: t.merchant, months: new Set(), amounts: [], category: t.category, last: t.date };
    g.months.add(monthOf(t.date));
    g.amounts.push(-inPrimary(v, t));
    if (t.date > g.last) g.last = t.date;
    groups.set(k, g);
  }
  return [...groups.values()]
    .filter((g) => g.months.size >= 3 && Math.max(...g.amounts) <= Math.min(...g.amounts) * 1.3 && g.amounts.length <= g.months.size * 2)
    .map((g) => ({ name: g.name, category: g.category, avg: g.amounts.reduce((a, b) => a + b, 0) / g.amounts.length, months: g.months.size, last: g.last }))
    .sort((a, b) => b.avg - a.avg);
}

/** Post monthly bills on their day (deterministic ids, so devices don't double-post). */
export function postBills(v: Vault, today = todayStr()): number {
  const month = monthOf(today);
  const day = Number(today.slice(8));
  let n = 0;
  for (const b of v.bills) {
    const postDay = Math.min(b.day, daysInMonth(month));
    if (day < postDay) continue;
    const id = `bill:${b.id}:${month}`;
    if (v.deleted.includes(id) || v.transactions.some((t) => t.id === id)) continue;
    // Skip if the same payment already arrived from the bank this month.
    const already = v.transactions.some(
      (t) => monthOf(t.date) === month && t.category === b.category && Math.abs(Math.abs(t.amount) - b.amount) < 0.01 && !t.bill,
    );
    if (already) continue;
    v.transactions.push({
      id,
      date: `${month}-${String(postDay).padStart(2, '0')}`,
      amount: -b.amount,
      currency: b.currency,
      merchant: b.name,
      account: b.account,
      category: b.category,
      source: 'bill',
      bill: b.id,
      updatedAt: Date.now(),
    });
    n++;
  }
  return n;
}
