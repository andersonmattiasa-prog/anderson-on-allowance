import type { Vault } from './types';
import { addMonths, daysInMonth, monthOf, todayStr } from './util';

/**
 * The monthly check-in opens on the last day of a month and stays open until the 5th of the next.
 * It's done once that month's review is saved.
 */
export function checkinInfo(v: Vault, today = todayStr()) {
  const month = monthOf(today);
  const dim = daysInMonth(month);
  const day = Number(today.slice(8));
  const target = day === dim ? month : day <= 5 ? addMonths(month, -1) : null;
  const hasData = (m: string) => v.transactions.some((t) => t.date.startsWith(m));
  const due = !!target && hasData(target) && !v.reviews.some((r) => r.month === target);
  const nextDate = `${month}-${String(dim).padStart(2, '0')}`;
  return { due, month: target, daysTo: dim - day, nextDate };
}
