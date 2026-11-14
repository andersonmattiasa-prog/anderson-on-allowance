import webpush from 'web-push';
import { createHash } from 'crypto';
import { get, hdel, hgetall, hset, set } from './store';
import type { NotifyPrefs } from '../types';

/**
 * The only plaintext the server keeps, so it can send reminders while the vault stays encrypted:
 * weekly allowance, this week's total, card due days, the active challenge's name and the review month.
 */
export interface PushPlan {
  tz: string;
  primary: 'EUR' | 'CAD';
  fxRate: number; // 1 EUR = x CAD
  weekly: number;
  weekStart: string;
  weekSpent: number;
  warned: number; // 0, 80 or 100 — allowance warnings already sent this week
  cards: { name: string; dueDay: number; autopay: boolean }[];
  challenge?: { name: string; start: string; end: string };
  reviewPending?: string; // month label still to review
  prefs: NotifyPrefs;
  updatedAt: number;
}

export const configured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

function init() {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:owner@example.com', process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
}

export const subKey = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex').slice(0, 32);

export async function addSubscription(sub: webpush.PushSubscription) {
  await hset('push:subs', subKey(sub.endpoint), JSON.stringify(sub));
}
export async function removeSubscription(endpoint: string) {
  await hdel('push:subs', [subKey(endpoint)]);
}

export async function getPlan(): Promise<PushPlan | null> {
  const s = await get('push:plan');
  return s ? (JSON.parse(s) as PushPlan) : null;
}
export const savePlan = (p: PushPlan) => set('push:plan', JSON.stringify(p));

export async function sendAll(payload: { title: string; body: string; tag?: string; url?: string }): Promise<number> {
  if (!configured()) return 0;
  init();
  const subs = await hgetall('push:subs');
  let sent = 0;
  await Promise.all(
    Object.entries(subs).map(async ([k, s]) => {
      try {
        await webpush.sendNotification(JSON.parse(s), JSON.stringify(payload), { TTL: 60 * 60 * 12 });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await hdel('push:subs', [k]);
      }
    }),
  );
  return sent;
}

/** Today's date (YYYY-MM-DD) and weekday in the owner's time zone. */
export function localToday(tz: string) {
  const now = new Date();
  let date: string;
  try {
    date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    date = now.toISOString().slice(0, 10);
  }
  const [y, m, d] = date.split('-').map(Number);
  return { date, weekday: new Date(y, m - 1, d).getDay(), day: d, y, m };
}
