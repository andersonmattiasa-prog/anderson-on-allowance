import type { Currency } from './types';

/** rate: 1 EUR = rate CAD */
export function toCur(amount: number, from: Currency, to: Currency, rate: number): number {
  if (from === to) return amount;
  return from === 'EUR' ? amount * rate : amount / rate;
}

const formatters = new Map<string, Intl.NumberFormat>();
export function fmt(amount: number, cur: Currency, opts: { decimals?: number; sign?: boolean } = {}): string {
  const d = opts.decimals ?? 2;
  const k = cur + d;
  let f = formatters.get(k);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, minimumFractionDigits: d, maximumFractionDigits: d });
    formatters.set(k, f);
  }
  const rounded = Math.round(Math.abs(amount) * 10 ** d) / 10 ** d;
  const s = f.format(rounded);
  if (amount < 0 && rounded > 0) return '−' + s;
  if (opts.sign && amount > 0 && rounded > 0) return '+' + s;
  return s;
}

/** Parse amounts like "€12,50", "CA$1,234.56", "-12.5", "(45.00)", "12.50 EUR". */
export function parseAmount(input: string): { amount: number; currency?: Currency } | null {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;
  let currency: Currency | undefined;
  if (/€|\beur\b/i.test(s)) currency = 'EUR';
  else if (/ca\$|c\$|\bcad\b|\$/i.test(s)) currency = 'CAD';
  const negative = /^\s*[-−–]|[-−–]\s*$|^\(.*\)$|-\s*[€$]|[€$]\s*-/.test(s);
  let n = s.replace(/[^\d.,]/g, '');
  if (!n || !/\d/.test(n)) return null;
  const lastComma = n.lastIndexOf(',');
  const lastDot = n.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) n = n.replace(/\./g, '').replace(',', '.');
    else n = n.replace(/,/g, '');
  } else if (lastComma > -1) {
    n = /,\d{1,2}$/.test(n) && (n.match(/,/g) || []).length === 1 ? n.replace(',', '.') : n.replace(/,/g, '');
  }
  const value = parseFloat(n);
  if (!isFinite(value)) return null;
  return { amount: negative ? -value : value, currency };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
