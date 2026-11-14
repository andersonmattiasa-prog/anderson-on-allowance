import type { Vault } from './types';
import { api } from './api';
import { dailyVariable, plan as monthPlan } from './calc';
import { challengeStatus } from './streaks';
import { addDays, addMonths, monthLabel, monthOf, todayStr, weekStart } from './util';

/** The small plaintext summary the server needs to send reminders. */
export function buildPushPlan(v: Vault) {
  const today = todayStr();
  const ws = weekStart(today);
  const dv = dailyVariable(v);
  let weekSpent = 0;
  for (let i = 0; i < 7; i++) weekSpent += dv.get(addDays(ws, i)) || 0;
  const p = monthPlan(v, monthOf(today));
  const active = v.challenges
    .map((c) => ({ c, s: challengeStatus(v, c, today) }))
    .find(({ s }) => s && (s.state === 'active' || s.state === 'upcoming'));
  const lastMonth = addMonths(monthOf(today), -1);
  const reviewed = v.reviews.some((r) => r.month === lastMonth);
  const hasData = v.transactions.some((t) => t.date.startsWith(lastMonth));
  return {
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Brussels',
    primary: v.settings.primary,
    fxRate: v.fx.rate,
    weekly: Math.round(p.weekly * 100) / 100,
    weekStart: ws,
    weekSpent: Math.round(weekSpent * 100) / 100,
    warned: weekSpent >= p.weekly ? 100 : weekSpent >= p.weekly * 0.8 ? 80 : 0,
    cards: v.accounts.filter((a) => a.type === 'credit' && a.dueDay).map((a) => ({ name: a.name, dueDay: a.dueDay!, autopay: !!a.autopay })),
    challenge: active ? { name: active.s!.def.name, start: active.c.start, end: active.c.end } : undefined,
    reviewPending: !reviewed && hasData ? monthLabel(lastMonth, 'long') : undefined,
    prefs: v.notify,
  };
}

const b64urlToBytes = (s: string) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
};

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function enablePush(token: string): Promise<string | null> {
  if (!pushSupported()) return 'This browser can’t receive notifications. On iPhone, open the app from the Home Screen icon first.';
  const { key } = await api<{ key: string | null }>('/api/push/key');
  if (!key) return 'Notifications aren’t set up on the server yet.';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'Notifications were not allowed. You can turn them on in iPhone Settings → Notifications → Anderson Ahead.';
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key) as BufferSource });
  await api('/api/push/subscribe', { method: 'POST', token, body: sub.toJSON() });
  return null;
}

export async function disablePush(token: string) {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('/api/push/subscribe', { method: 'DELETE', token, body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}
