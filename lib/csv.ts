import type { Account, Currency, DateOrder, ImportMapping, Tx, Vault } from './types';
import { parseAmount, round2 } from './money';
import { localDate, normText, prettyMerchant, uid } from './util';
import { categorize } from './categorize';
import { findPendingMatch } from './ingest';

function countOutsideQuotes(line: string, ch: string): number {
  let q = false;
  let n = 0;
  for (const c of line) {
    if (c === '"') q = !q;
    else if (c === ch && !q) n++;
  }
  return n;
}

export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5);
  let best = ',';
  let bestScore = 0;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const score = Math.min(...counts);
    if (score > bestScore) (best = d), (bestScore = score);
  }
  return best;
}

export function parseCSV(text: string, delim = detectDelimiter(text)): string[][] {
  text = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') (field += '"'), i++;
        else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) row.push(field), (field = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c));
}

// ---------- dates ----------

function dateParts(s: string): number[] | null {
  const m = s.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function detectDateOrder(values: string[]): DateOrder {
  let dmy = false;
  let mdy = false;
  let ymd = 0;
  let slash = 0;
  for (const v of values) {
    const p = dateParts(v);
    if (!p) continue;
    if (p[0] > 31) ymd++;
    else {
      if (p[0] > 12) dmy = true;
      if (p[1] > 12) mdy = true;
    }
    if (v.includes('/')) slash++;
  }
  if (ymd) return 'YMD';
  if (dmy && !mdy) return 'DMY';
  if (mdy && !dmy) return 'MDY';
  return slash ? 'MDY' : 'DMY';
}

export function parseDateWith(s: string, order: DateOrder): string | null {
  const p = dateParts(s.trim());
  if (p) {
    let [y, m, d] = order === 'YMD' ? p : order === 'DMY' ? [p[2], p[1], p[0]] : [p[2], p[0], p[1]];
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  if (/[a-z]{3}/i.test(s)) {
    const t = Date.parse(s);
    if (!isNaN(t)) return localDate(new Date(t));
  }
  return null;
}

const looksDate = (s: string) => !!dateParts(s) || (/[a-z]{3}/i.test(s) && /\d/.test(s) && !isNaN(Date.parse(s)));
const looksNum = (s: string) => /^[-−(]?\s*[€$]?\s*[\d.,]+\s*\)?(\s*(eur|cad))?$/i.test(s.trim()) && /\d/.test(s);

// ---------- mapping ----------

export function headerKey(rows: string[][]): string {
  return rows[0].map((h) => normText(h).trim()).join('|');
}

export function guessMapping(rows: string[][], account?: Account): ImportMapping {
  const first = rows[0] || [];
  const hasHeader = first.filter((c) => /[a-z]/i.test(c) && !looksDate(c) && !looksNum(c)).length >= Math.ceil(first.length / 2);
  const header = hasHeader ? first.map((h) => h.toLowerCase().trim()) : [];
  const data = rows.slice(hasHeader ? 1 : 0, 40);
  const cols = first.length;
  const idx = (rx: RegExp, exclude?: RegExp) => header.findIndex((h) => rx.test(h) && !(exclude && exclude.test(h)));
  const share = (i: number, test: (s: string) => boolean) => {
    const vals = data.map((r) => r[i] ?? '').filter(Boolean);
    return vals.length ? vals.filter(test).length / vals.length : 0;
  };

  let date = idx(/^(transaction )?date$|^datum|^posted|^date|date$/, /value|valeur/);
  if (date < 0) for (let i = 0; i < cols; i++) if (share(i, looksDate) > 0.8) { date = i; break; }

  let amount = idx(/^amount|montant|bedrag|^amt|amount$/, /balance|fee|original|exchange/);
  let debit = idx(/debit|withdraw|money out|paid out/, /type/);
  let credit = idx(/credit|deposit|money in|paid in/, /type|card/);
  const type = idx(/type of transaction|^type$|debit\/credit|dr\/cr|transaction type/);
  if (amount >= 0) (debit = -1), (credit = -1);
  if (amount < 0 && debit < 0) {
    let bestI = -1;
    let bestS = 0;
    for (let i = 0; i < cols; i++) {
      if (i === date) continue;
      const s = share(i, looksNum);
      if (s > bestS + 0.01 || (s === bestS && bestI >= 0 && share(i, (x) => /^[-−(]/.test(x)) > share(bestI, (x) => /^[-−(]/.test(x)))) (bestI = i), (bestS = s);
    }
    if (bestS > 0.8) amount = bestI;
  }

  let merchant = -1;
  for (const rx of [/^merchant( name)?$/, /merchant/, /^payee( name)?$/, /counterparty|beneficiary/, /^name$/]) {
    merchant = idx(rx);
    if (merchant >= 0) break;
  }
  let description = idx(/description|details|libell|omschrijving|memo|narrative|payment reference|reference/, /sub/);
  if (merchant < 0 && description < 0) {
    let bestI = -1;
    let bestLen = 0;
    for (let i = 0; i < cols; i++) {
      if ([date, amount, debit, credit].includes(i)) continue;
      const len = data.reduce((a, r) => a + ((r[i] || '').match(/[a-z]/gi)?.length || 0), 0);
      if (len > bestLen) (bestI = i), (bestLen = len);
    }
    merchant = bestI;
  }
  if (merchant < 0) (merchant = description), (description = -1);
  const currency = idx(/^currency$|^devise$|^munt$|^ccy$/);

  const dateOrder = detectDateOrder(data.map((r) => r[date] || ''));
  const mapping: ImportMapping = { key: hasHeader ? headerKey(rows) : `cols:${cols}`, hasHeader, date, amount, debit, credit, type, merchant, description, currency, dateOrder, invert: false };
  if (account?.type === 'credit' && type < 0 && amount >= 0) {
    const vals = data.map((r) => parseAmount(r[amount] || '')?.amount ?? 0).filter((x) => x);
    mapping.invert = vals.filter((x) => x > 0).length > vals.length / 2;
  }
  return mapping;
}

export interface ParsedRow {
  date: string;
  amount: number;
  currency: Currency;
  merchant: string;
  description: string;
}

export function rowToTx(row: string[], m: ImportMapping, account: Account): ParsedRow | null {
  const date = m.date >= 0 ? parseDateWith(row[m.date] || '', m.dateOrder) : null;
  if (!date) return null;
  let amount: number | null = null;
  let cur: Currency | undefined;
  if (m.amount >= 0) {
    const a = parseAmount(row[m.amount] || '');
    if (a) (amount = a.amount), (cur = a.currency);
  } else {
    const d = m.debit >= 0 ? parseAmount(row[m.debit] || '') : null;
    const c = m.credit >= 0 ? parseAmount(row[m.credit] || '') : null;
    if (d && d.amount) (amount = -Math.abs(d.amount)), (cur = d.currency);
    else if (c && c.amount) (amount = Math.abs(c.amount)), (cur = c.currency);
  }
  if (amount == null || amount === 0) return null;
  if (m.type >= 0) {
    const t = (row[m.type] || '').toLowerCase();
    if (/debit|^dr$|withdraw|purchase/.test(t)) amount = -Math.abs(amount);
    else if (/credit|^cr$|deposit|payment|refund/.test(t)) amount = Math.abs(amount);
  }
  if (m.invert) amount = -amount;
  const colCur = m.currency >= 0 ? (row[m.currency] || '').toUpperCase() : '';
  const currency: Currency = colCur === 'EUR' || colCur === 'CAD' ? colCur : cur ?? account.currency;
  let rawMerchant = (m.merchant >= 0 ? row[m.merchant] : '') || (m.description >= 0 ? row[m.description] : '') || 'Unknown';
  // Wise-style descriptions: "Card transaction of 9.80 EUR issued by Deliveroo"
  const issued = /issued by\s+(.+)$/i.exec(rawMerchant) || /^(?:received money from|sent money to)\s+(.+?)(?:\s+with reference.*)?$/i.exec(rawMerchant);
  if (issued) rawMerchant = issued[1];
  const description = m.description >= 0 && m.description !== m.merchant ? row[m.description] || '' : '';
  return { date, amount: round2(amount), currency, merchant: prettyMerchant(rawMerchant), description };
}

export function accountFromFilename(v: Vault, name: string): string | null {
  const n = normText(name.replace(/\.[a-z]+$/i, ''));
  for (const a of v.accounts) for (const w of a.match) if (w && n.includes(normText(w))) return a.id;
  return null;
}

const csvKeyOf = (r: ParsedRow) => `${r.date}|${r.amount.toFixed(2)}|${normText(r.description || r.merchant).trim()}`;

/** Add rows; skip ones already imported (counted, so two identical same-day purchases both stay); reconcile with auto-synced items. */
export function importRows(v: Vault, rows: ParsedRow[], accountId: string) {
  const counts = new Map<string, number>();
  for (const t of v.transactions) if (t.csvKey && t.account === accountId) counts.set(t.csvKey, (counts.get(t.csvKey) || 0) + 1);
  let added = 0, dupes = 0, matched = 0;
  const now = Date.now();
  for (const r of rows) {
    const key = csvKeyOf(r);
    const c = counts.get(key) || 0;
    if (c > 0) {
      counts.set(key, c - 1);
      dupes++;
      continue;
    }
    const pending = findPendingMatch(v, accountId, r.date, r.amount, r.currency);
    if (pending) {
      pending.reconciled = true;
      pending.csvKey = key;
      if (!pending.description) pending.description = r.description || r.merchant;
      pending.updatedAt = now;
      matched++;
      continue;
    }
    const tx: Tx = {
      id: uid(),
      date: r.date,
      amount: r.amount,
      currency: r.currency,
      merchant: r.merchant,
      description: r.description || undefined,
      account: accountId,
      category: categorize(v, r.merchant, r.description, r.amount),
      source: 'csv',
      reconciled: true,
      csvKey: key,
      updatedAt: now,
    };
    v.transactions.push(tx);
    added++;
  }
  return { added, dupes, matched };
}

export function exportCSV(v: Vault): string {
  const cats = new Map(v.categories.map((c) => [c.id, c.name]));
  const accts = new Map(v.accounts.map((a) => [a.id, a.name]));
  const esc = (s: unknown) => {
    const x = s == null ? '' : String(s);
    return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
  };
  const lines = [['Date', 'Merchant', 'Amount', 'Currency', 'Charged', 'Charged currency', 'Category', 'Account', 'Note', 'Description', 'Source'].join(',')];
  for (const t of [...v.transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push([t.date, t.merchant, t.amount, t.currency, t.charged?.amount ?? '', t.charged?.currency ?? '', cats.get(t.category) ?? t.category, accts.get(t.account) ?? t.account, t.note, t.description, t.source].map(esc).join(','));
  }
  return lines.join('\n');
}
