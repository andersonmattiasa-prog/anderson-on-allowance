export const uid = () => crypto.randomUUID();

const pad = (n: number) => String(n).padStart(2, '0');

export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const todayStr = () => localDate();

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return localDate(d);
}
/** a - b in days */
export function diffDays(a: string, b: string): number {
  return Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / 864e5);
}
/** Monday of the week containing s */
export function weekStart(s: string): string {
  const d = parseDate(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localDate(d);
}
export const monthOf = (s: string) => s.slice(0, 7);
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
export function monthLabel(month: string, style: 'long' | 'short' = 'long'): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: style, ...(style === 'long' ? { year: 'numeric' } : {}) });
}
export function dayLabel(date: string, today = todayStr()): string {
  const diff = diffDays(today, date);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return parseDate(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
export const weekdayShort = (date: string) => parseDate(date).toLocaleDateString('en-GB', { weekday: 'narrow' });

export function normText(s: string): string {
  return (
    ' ' +
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim() +
    ' '
  );
}

export function prettyMerchant(s: string): string {
  let m = s.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
  m = m.replace(/^(sq|sp|tst|pp|paypal|sumup|zettle|izettle)\s?\*\s?/i, '');
  if (m && m === m.toUpperCase() && /[A-Z]/.test(m)) {
    m = m.toLowerCase().replace(/(^|[\s\-/&(])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  }
  return m || 'Unknown';
}

export function download(filename: string, data: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
