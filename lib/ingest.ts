// Turns sealed inbox items (Apple Pay, bank alert emails, Wise, manual) into transactions, merging duplicates.
import type { Currency, Tx, Vault } from './types';
import { categorize, similarMerchant } from './categorize';
import { parseAmount, round2 } from './money';
import { inPrimary, toPrimary } from './calc';
import { diffDays, localDate, normText, prettyMerchant, uid } from './util';

type Payload = Record<string, unknown>;
const str = (x: unknown) => (x == null ? '' : String(x));

export function accountFromText(v: Vault, text: string): string | null {
  const n = normText(text);
  let best: string | null = null;
  let bestLen = 0;
  for (const a of v.accounts) {
    for (const w of a.match) {
      const nw = normText(w);
      if (nw.trim() && n.includes(nw) && nw.length > bestLen) {
        best = a.id;
        bestLen = nw.length;
      }
    }
  }
  return best;
}

function newTx(v: Vault, t: Omit<Tx, 'id' | 'updatedAt' | 'category'> & { category?: string; id?: string }): Tx {
  const tx: Tx = {
    ...t,
    id: t.id || uid(),
    category: t.category || categorize(v, t.merchant, t.description || '', t.amount),
    updatedAt: Date.now(),
  };
  v.transactions.push(tx);
  return tx;
}

function amountsClose(v: Vault, a: number, aCur: Currency, b: number, bCur: Currency, tolerance = 0.05): boolean {
  const pa = toPrimary(v, a, aCur);
  const pb = toPrimary(v, b, bCur);
  return Math.abs(pa - pb) <= Math.max(0.02, Math.abs(pa) * tolerance);
}

// ---------- Apple Pay (iPhone Shortcut: Transaction automation) ----------

export function applyApplePay(v: Vault, p: Payload, at: number) {
  const merchant = prettyMerchant(str(p.merchant ?? p.Merchant) || 'Apple Pay');
  const amt = parseAmount(str(p.amount ?? p.Amount));
  if (!amt || !amt.amount) return;
  const account = accountFromText(v, `${str(p.card ?? p.Card)} ${str(p.name ?? p.Name)}`) ?? v.accounts[0].id;
  const acct = v.accounts.find((a) => a.id === account)!;
  const currency = amt.currency ?? acct.currency;
  const amount = -Math.abs(amt.amount);
  const date = localDate(new Date(at));

  // A bank alert for this purchase may already be here: merge into one transaction.
  const alert = v.transactions.find(
    (t) =>
      t.alerted && !t.applePay && t.account === account && t.amount < 0 && Math.abs(diffDays(t.date, date)) <= 3 &&
      (similarMerchant(t.merchant, merchant) || amountsClose(v, t.amount, t.currency, amount, currency)),
  );
  if (alert) {
    if (alert.currency !== currency) alert.charged = { amount: alert.amount, currency: alert.currency };
    alert.amount = amount;
    alert.currency = currency;
    alert.merchant = merchant;
    alert.applePay = true;
    if (!alert.manualCat) alert.category = categorize(v, merchant, alert.description || '', amount);
    alert.updatedAt = Date.now();
    return;
  }
  newTx(v, { date, amount, currency, merchant, account, source: 'applepay', applePay: true });
}

// ---------- Bank alert emails (forwarded by the Gmail Apps Script) ----------

export interface CardAlert {
  account: string;
  amount: number;
  currency: Currency;
  merchant: string;
  date: string;
}

const NOT_PURCHASE = /statement|password|security code|verification|verify|sign[- ]?in|log[- ]?in|profile|payment (received|due)|minimum payment|e-?statement|settings/i;
const AMT = String.raw`(C?A?\$|€|EUR\s?|CAD\s?)\s?([\d,]+(?:\.\d{1,2})?)`;

export function parseAlertEmail(v: Vault, p: Payload): CardAlert | null {
  const subject = str(p.subject);
  const body = str(p.body);
  const from = str(p.from);
  const text = `${subject} . ${body}`.replace(/\s+/g, ' ');

  let sym = '';
  let num = '';
  let merchant = '';
  let m = new RegExp(String.raw`(?:for|of)\s+(?:an?\s+(?:amount|purchase)\s+of\s+)?${AMT}\s*(?:CAD|USD|EUR)?\s+(?:was\s+(?:made|charged|approved)\s+)?at\s+(.+?)\s+(?:on|using|with|from)\s+(?:your\s+)?(?:account|card|credit|scotia|visa|master)`, 'i').exec(text);
  if (m) [, sym, num, merchant] = m;
  if (!m) {
    m = new RegExp(String.raw`\bat\s+([A-Za-z0-9][^.;\n]{1,60}?)\s+for\s+(?:an?\s+amount\s+of\s+)?${AMT}`, 'i').exec(text);
    if (m) [, merchant, sym, num] = m;
  }
  if (!m) {
    m = new RegExp(String.raw`${AMT}[^.]{0,60}?\bat\s+([A-Za-z0-9][^.,;\n]{1,50}?)(?:\s+on\b|\s+using\b|\s+with\b|[.,;]|$)`, 'i').exec(text);
    if (m) [, sym, num, merchant] = m;
  }
  if (!m) return null;
  if (NOT_PURCHASE.test(subject) && !/purchase|authori[sz]ation|transaction/i.test(subject)) return null;

  const account =
    accountFromText(v, `${from} ${subject}`) ??
    accountFromText(v, body) ??
    (/scotia/i.test(from) ? 'scotia-visa' : v.accounts.find((a) => a.type === 'credit')?.id ?? v.accounts[0].id);
  const acct = v.accounts.find((a) => a.id === account)!;
  const value = parseAmount(num)?.amount;
  if (!value) return null;
  const refund = /refund|credited to your|return|reversal/i.test(text);
  const currency: Currency = /€|EUR/.test(sym) ? 'EUR' : acct.currency;
  const when = p.date ? new Date(str(p.date)) : new Date();
  return {
    account,
    amount: refund ? Math.abs(value) : -Math.abs(value),
    currency,
    merchant: prettyMerchant(merchant.replace(/\s+(in|à|a)\s+[A-Z\s]+$/i, '')),
    date: localDate(isNaN(when.getTime()) ? new Date() : when),
  };
}

export function applyCardAlert(v: Vault, a: CardAlert) {
  // One purchase can produce several alerts: skip repeats.
  const dupe = v.transactions.some(
    (t) =>
      t.alerted && t.account === a.account && Math.abs(diffDays(t.date, a.date)) <= 2 &&
      Math.abs((t.charged?.amount ?? t.amount) - a.amount) < 0.005 && similarMerchant(t.merchant, a.merchant),
  );
  if (dupe) return;

  const ap = v.transactions.find(
    (t) =>
      t.applePay && !t.alerted && t.account === a.account && Math.abs(diffDays(t.date, a.date)) <= 3 && t.amount < 0 &&
      (similarMerchant(t.merchant, a.merchant) || amountsClose(v, t.amount, t.currency, a.amount, a.currency)),
  );
  if (ap) {
    ap.alerted = true;
    if (ap.currency !== a.currency) ap.charged = { amount: a.amount, currency: a.currency };
    ap.updatedAt = Date.now();
    return;
  }
  newTx(v, { date: a.date, amount: a.amount, currency: a.currency, merchant: a.merchant, account: a.account, source: 'email', alerted: true });
}

// ---------- Wise webhook (balance credits only; card purchases come via Apple Pay) ----------

export function applyWise(v: Vault, p: Payload) {
  const data = (p.data || {}) as Payload;
  const type = str(data.transaction_type).toLowerCase();
  if (type !== 'credit') return;
  const amount = Number(data.amount);
  const currency = str(data.currency).toUpperCase();
  if (!amount || (currency !== 'EUR' && currency !== 'CAD')) return;
  const date = localDate(new Date(str(data.occurred_at) || Date.now()));
  const isPay = toPrimary(v, amount, currency as Currency) >= v.settings.income * 0.7;
  newTx(v, {
    date,
    amount: Math.abs(amount),
    currency: currency as Currency,
    merchant: isPay ? 'Pay' : 'Wise deposit',
    description: str(p.event_type),
    account: 'wise',
    source: 'wise',
    category: isPay ? 'income' : 'transfer',
  });
}

// ---------- Manual (e.g. another shortcut) ----------

export function applyManual(v: Vault, p: Payload, at: number) {
  const amt = parseAmount(str(p.amount));
  if (!amt) return;
  const merchant = prettyMerchant(str(p.merchant) || 'Cash');
  const account = accountFromText(v, str(p.account || p.card)) ?? 'cash';
  const acct = v.accounts.find((a) => a.id === account)!;
  newTx(v, {
    date: /^\d{4}-\d{2}-\d{2}$/.test(str(p.date)) ? str(p.date) : localDate(new Date(at)),
    amount: amt.amount > 0 && !p.income ? -amt.amount : amt.amount,
    currency: amt.currency ?? acct.currency,
    merchant,
    note: str(p.note) || undefined,
    account,
    source: 'manual',
    category: v.categories.some((c) => c.id === p.category) ? str(p.category) : undefined,
  });
}

export function applyInboxItem(v: Vault, source: string, payload: unknown, at: number, itemId: string) {
  if (v.seenInbox.includes(itemId)) return;
  v.seenInbox.push(itemId);
  const p = (payload && typeof payload === 'object' ? payload : {}) as Payload;
  if (p.id) {
    const key = `${source}:${str(p.id)}`;
    if (v.seenInbox.includes(key)) return;
    v.seenInbox.push(key);
  }
  if (v.seenInbox.length > 3000) v.seenInbox = v.seenInbox.slice(-3000);
  if (source === 'applepay') applyApplePay(v, p, at);
  else if (source === 'email') {
    const a = parseAlertEmail(v, p);
    if (a) applyCardAlert(v, a);
  } else if (source === 'wise') applyWise(v, p);
  else if (source === 'manual') applyManual(v, p, at);
}

/** Used by CSV import: does a bank row correspond to a purchase that already arrived automatically? */
export function findPendingMatch(v: Vault, account: string, date: string, amount: number, currency: Currency): Tx | undefined {
  return v.transactions.find((t) => {
    if (t.reconciled || t.source === 'csv' || t.source === 'bill' || t.account !== account) return false;
    const d = diffDays(date, t.date);
    if (d < -2 || d > 5) return false;
    if (t.charged && t.charged.currency === currency && Math.abs(t.charged.amount - amount) < 0.011) return true;
    return t.currency === currency && Math.abs(t.amount - amount) < 0.011;
  });
}

export { round2, inPrimary };
