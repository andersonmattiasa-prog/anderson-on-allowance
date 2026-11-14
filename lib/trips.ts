import type { Trip, Tx, Vault } from './types';
import { addDays, diffDays, normText } from './util';
import { catMap, inPrimary } from './calc';

const NEVER_TRIP_KINDS = new Set(['fixed', 'income', 'transfer', 'invest']);
const BOOKING = /\b(booking|airbnb|hotel|hostel|eurostar|thalys|sncf|ouigo|trainline|flixbus|ryanair|easyjet|vueling|transavia|klm|lufthansa|air france|air canada|westjet|brussels airlines|expedia|hostelworld|wizz|nmbs|sncb)\b/;
const ONLINE = /\b(netflix|spotify|apple com|icloud|amazon|google|chatgpt|openai|patreon|steam)\b/;

/** Which trip (if any) a transaction belongs to. Manual choices win; links to deleted trips are ignored. */
export function tripOf(v: Vault, t: Tx, cats = catMap(v)): Trip | null {
  if (t.tripLocked) {
    const chosen = t.trip ? v.trips.find((x) => x.id === t.trip) : undefined;
    if (chosen) return chosen;
    if (!t.trip) return null; // excluded by hand
  }
  const kind = cats.get(t.category)?.kind;
  if (!kind || NEVER_TRIP_KINDS.has(kind) || t.amount >= 0) return null;
  const text = normText(`${t.merchant} ${t.description ?? ''}`);
  for (const trip of v.trips) {
    const words = trip.words.map(normText).filter((w) => w.trim());
    // Purchases naming the destination count even if bought weeks before.
    if (words.some((w) => text.includes(w)) && t.date >= addDays(trip.start, -120) && t.date <= addDays(trip.end, 7)) return trip;
  }
  if (v.settings.homePlaces.some((h) => text.includes(normText(h)))) return null;
  if (ONLINE.test(text)) return null;
  for (const trip of v.trips) {
    // Everything spent during the trip (+1 day for card posting lag).
    if (t.date >= trip.start && t.date <= addDays(trip.end, 1)) return trip;
  }
  return null;
}

export function tripSummary(v: Vault, trip: Trip) {
  const cats = catMap(v);
  const items = v.transactions.filter((t) => tripOf(v, t, cats)?.id === trip.id);
  const total = items.reduce((a, t) => a - inPrimary(v, t), 0);
  const byCat = new Map<string, number>();
  for (const t of items) byCat.set(t.category, (byCat.get(t.category) || 0) - inPrimary(v, t));
  const days = diffDays(trip.end, trip.start) + 1;
  return { items: items.sort((a, b) => a.date.localeCompare(b.date)), total, byCat, days };
}

/** Older travel bookings (train, hotel, flight sites) that might belong to this trip. */
export function bookingSuggestions(v: Vault, trip: Trip): Tx[] {
  const cats = catMap(v);
  return v.transactions.filter(
    (t) =>
      t.amount < 0 && !t.tripLocked && t.date >= addDays(trip.start, -90) && t.date < trip.start &&
      BOOKING.test(normText(`${t.merchant} ${t.description ?? ''}`)) && !tripOf(v, t, cats),
  );
}
