import type { Account, Holding, Vault } from './types';
import { toCur } from './money';
import { catMap } from './calc';
import { addMonths, monthOf, todayStr } from './util';

/** USD → CAD from the cached CAD=X quote (fallback 1.38). */
export const usdCad = (v: Vault) => v.quotes['CAD=X']?.price || 1.38;

export function quoteToCad(v: Vault, price: number, currency: string): number {
  if (currency === 'CAD') return price;
  if (currency === 'USD') return price * usdCad(v);
  if (currency === 'EUR') return price * v.fx.rate;
  return price;
}

export const latestValue = (h: Holding) => (h.values.length ? [...h.values].sort((a, b) => a.date.localeCompare(b.date)).at(-1)! : null);

export interface PositionRow {
  id: string;
  name: string;
  ticker?: string;
  units?: number;
  account: string;
  value: number; // CAD
  dayChange: number; // CAD
  priced: boolean;
}

export function portfolio(v: Vault) {
  const rows: PositionRow[] = [];
  for (const p of v.positions) {
    if (!(p.units > 0)) continue;
    const q = v.quotes[p.ticker];
    const value = q ? quoteToCad(v, q.price * p.units, q.currency) : 0;
    const dayChange = q ? quoteToCad(v, (q.price - q.prev) * p.units, q.currency) : 0;
    rows.push({ id: p.id, name: p.name || p.ticker, ticker: p.ticker, units: p.units, account: p.account, value, dayChange, priced: !!q });
  }
  for (const h of v.holdings) {
    const lv = latestValue(h);
    if (!lv || !lv.value) continue;
    rows.push({ id: h.id, name: h.name, account: h.account, value: toCur(lv.value, h.currency, 'CAD', v.fx.rate), dayChange: 0, priced: true });
  }
  const total = rows.reduce((a, r) => a + r.value, 0);
  const dayChange = rows.reduce((a, r) => a + r.dayChange, 0);
  return { rows: rows.sort((a, b) => b.value - a.value), total, dayChange };
}

/** Money moved into investments this month (investing-category transactions + manual log), in the primary currency. */
export function investedIn(v: Vault, month: string): number {
  const cats = catMap(v);
  let sum = 0;
  for (const t of v.transactions) {
    if (t.date.startsWith(month) && cats.get(t.category)?.kind === 'invest' && t.amount < 0) sum += -toCur(t.amount, t.currency, v.settings.primary, v.fx.rate);
  }
  for (const e of v.investLog) if (e.date.startsWith(month)) sum += toCur(e.amount, e.currency, v.settings.primary, v.fx.rate);
  return sum;
}

export function investStreak(v: Vault, today = todayStr()): number {
  const target = (v.settings.income * v.settings.investPercent) / 100;
  let m = monthOf(today);
  if (investedIn(v, m) < target * 0.9) m = addMonths(m, -1);
  let n = 0;
  while (n < 120 && investedIn(v, m) >= target * 0.9) {
    n++;
    m = addMonths(m, -1);
  }
  return n;
}

/** Months to reach `target` from `current`, adding `monthly`, growing at `annual` %. */
export function monthsToGoal(current: number, monthly: number, target: number, annual: number): number | null {
  if (current >= target) return 0;
  const r = annual / 100 / 12;
  let bal = current;
  for (let m = 1; m <= 12 * 60; m++) {
    bal = bal * (1 + r) + monthly;
    if (bal >= target) return m;
  }
  return null;
}

/** Future value of saving `monthly` for `years` at `annual` %. */
export function futureValue(monthly: number, years: number, annual: number): number {
  const r = annual / 100 / 12;
  const n = years * 12;
  return r ? monthly * ((Math.pow(1 + r, n) - 1) / r) : monthly * n;
}

export function projection(current: number, monthly: number, annual: number, years: number) {
  const r = annual / 100 / 12;
  const out: { year: number; value: number }[] = [];
  let bal = current;
  for (let y = 0; y <= years; y++) {
    out.push({ year: y, value: bal });
    for (let m = 0; m < 12; m++) bal = bal * (1 + r) + monthly;
  }
  return out;
}

// ---------- net worth ----------

/** Balance of a bank/card account on a date: opening balance + transactions since. */
export function accountBalance(v: Vault, a: Account, date = todayStr()): number | null {
  const open = v.balances[a.id];
  if (!open) return null;
  let bal = open.balance;
  for (const t of v.transactions) {
    if (t.account !== a.id || t.date <= open.date || t.date > date) continue;
    if (t.charged && t.charged.currency === a.currency) bal += t.charged.amount;
    else bal += toCur(t.amount, t.currency, a.currency, v.fx.rate);
  }
  return bal;
}

export function netWorth(v: Vault, date = todayStr(), investments = portfolio(v).total) {
  let cash = 0;
  let debt = 0;
  const accounts: { account: Account; balance: number | null; cad: number }[] = [];
  for (const a of v.accounts) {
    if (a.type === 'investment') continue;
    const bal = accountBalance(v, a, date);
    const cad = bal == null ? 0 : toCur(bal, a.currency, 'CAD', v.fx.rate);
    accounts.push({ account: a, balance: bal, cad });
    if (bal == null) continue; // unknown balances are left out
    if (cad >= 0) cash += cad;
    else debt += -cad;
  }
  return { investments, cash, debt, total: investments + cash - debt, accounts };
}
