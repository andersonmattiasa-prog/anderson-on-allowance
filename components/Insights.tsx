'use client';
import { useMemo, useState } from 'react';
import type { Review, Trip, Vault } from '@/lib/types';
import { useMoney, useStore } from './store';
import { Empty, Progress, Sheet, TxRow } from './ui';
import { Sparkbars } from './Chart';
import { catMap, dailyVariable, greenStreak, inPrimary, monthStats, plan } from '@/lib/calc';
import { bookingSuggestions, tripSummary } from '@/lib/trips';
import { investedIn, investStreak } from '@/lib/invest';
import { streaks } from '@/lib/streaks';
import { addDays, addMonths, daysInMonth, monthLabel, monthOf, parseDate, todayStr, uid } from '@/lib/util';
import { fmt, toCur } from '@/lib/money';

type View = { kind: 'main' } | { kind: 'trip'; id: string } | { kind: 'review'; month: string };

export default function Insights() {
  const [view, setView] = useState<View>({ kind: 'main' });
  if (view.kind === 'trip') return <TripView id={view.id} back={() => setView({ kind: 'main' })} />;
  if (view.kind === 'review') return <ReviewView month={view.month} back={() => setView({ kind: 'main' })} />;
  return <Main open={setView} />;
}

/** Average spending per category in the previous `n` months, up to the same day of the month. */
function usualByDay(v: Vault, month: string, day: number, n = 3) {
  const out = new Map<string, number>();
  let months = 0;
  for (let i = 1; i <= n; i++) {
    const m = addMonths(month, -i);
    if (!v.transactions.some((t) => t.date.startsWith(m))) continue;
    months++;
    for (const [c, a] of monthStats(v, m, Math.min(day, daysInMonth(m))).byCat) out.set(c, (out.get(c) || 0) + a);
  }
  if (months) for (const [c, a] of out) out.set(c, a / months);
  return { usual: out, months };
}

function achievements(v: Vault) {
  const dv = dailyVariable(v);
  const st = streaks(v);
  const list: { icon: string; name: string; got: boolean }[] = [];
  const last = addMonths(monthOf(todayStr()), -1);
  const lp = plan(v, last);
  const ls = monthStats(v, last);
  list.push({ icon: '🌱', name: 'First 7 green days in a row', got: greenStreak(v, dv) >= 7 });
  list.push({ icon: '🧊', name: '5 no-spend days in a month', got: st.noSpend >= 5 });
  list.push({ icon: '🎯', name: '4 weeks under allowance', got: st.weeksUnder >= 4 });
  list.push({ icon: '📈', name: 'Invested 3 months running', got: investStreak(v) >= 3 });
  list.push({ icon: '🏅', name: 'Finished last month under budget', got: ls.spent > 0 && ls.spent <= lp.pay - lp.invest });
  list.push({ icon: '🏆', name: 'Won a challenge', got: v.challenges.some((c) => c.end < todayStr()) });
  list.push({ icon: '📝', name: 'Did a monthly review', got: v.reviews.length > 0 });
  return list;
}

function Main({ open }: { open: (v: View) => void }) {
  const { vault: v } = useStore();
  const { p } = useMoney();
  const [newTrip, setNewTrip] = useState(false);
  const today = todayStr();
  const month = monthOf(today);
  const day = Number(today.slice(8));

  const d = useMemo(() => {
    const cats = catMap(v);
    const st = monthStats(v, month);
    const { usual, months } = usualByDay(v, month, day);
    const where = [...new Set([...st.byCat.keys(), ...usual.keys()])]
      .map((id) => ({ c: cats.get(id)!, now: st.byCat.get(id) || 0, usual: usual.get(id) || 0 }))
      .filter((x) => x.c && x.c.kind === 'spend' && (x.now > 0.5 || x.usual > 0.5))
      .sort((a, b) => b.now - a.now);
    const trendMonths = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5));
    const trendStats = trendMonths.map((m) => monthStats(v, m));
    const catTrends = v.categories
      .filter((c) => c.kind === 'spend')
      .map((c) => ({ c, vals: trendStats.map((s) => Math.max(0, s.byCat.get(c.id) || 0)) }))
      .filter((x) => x.vals.some((y) => y > 0));
    // Ideas
    const ideas: string[] = [];
    for (const w of where) {
      if (w.usual > 5 && w.now > w.usual * 1.25 && w.now - w.usual > 10) {
        ideas.push(`${w.c.icon} ${w.c.name}: ${p(w.now, 0)} so far vs. ${p(w.usual, 0)} usually by now. Pulling back for the rest of the month saves ~${p((w.now - w.usual) * 0.5, 0)}.`);
      }
    }
    const places = [...st.byMerchant.values()].sort((a, b) => b.total - a.total);
    for (const m of places.slice(0, 3)) {
      if (m.count >= 4) ideas.push(`☝️ ${m.count} visits to ${m.name} this month (${p(m.total, 0)}). Halving that would save ~${p((m.total / day) * daysInMonth(month) * 0.5, 0)} a month.`);
    }
    const eat = (st.byCat.get('eating-out') || 0) + (st.byCat.get('takeaway') || 0);
    if (eat > 40) ideas.push(`🍳 Swapping one meal out a week for cooking at home saves about ${p((eat / day) * 7 * 0.35 * 52 / 12, 0)} a month.`);
    const biggest = v.transactions
      .filter((t) => t.date.startsWith(month) && ['spend'].includes(cats.get(t.category)?.kind ?? ''))
      .sort((a, b) => inPrimary(v, a) - inPrimary(v, b))
      .slice(0, 5);
    // Weekday spending over the last 12 weeks
    const dv = dailyVariable(v);
    const wd = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 1; i <= 84; i++) {
      const date = addDays(today, -i);
      wd[(parseDate(date).getDay() + 6) % 7] += dv.get(date) || 0;
    }
    const lastMonth = addMonths(month, -1);
    const needsReview = !v.reviews.some((r) => r.month === lastMonth) && v.transactions.some((t) => t.date.startsWith(lastMonth));
    return { where, months, catTrends, trendMonths, ideas, places: places.slice(0, 6), biggest, wd: wd.map((x) => x / 12), lastMonth, needsReview };
  }, [v, month, day, today, p]);

  const maxWd = Math.max(1, ...d.wd);
  const ach = achievements(v);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">{monthLabel(month)}</p>
          <h1>Insights</h1>
        </div>
      </header>

      {d.needsReview && (
        <button className="card review-cta plain-card" onClick={() => open({ kind: 'review', month: d.lastMonth })}>
          📝 <strong>Review {monthLabel(d.lastMonth, 'long')}</strong>
          <span className="muted small"> — 3 minutes: what went well, and one change for this month.</span>
        </button>
      )}

      <section className="card">
        <h3>Where your money went</h3>
        <p className="muted small">{d.months ? `Compared with your usual spending by day ${day} (last ${d.months} month${d.months > 1 ? 's' : ''}).` : 'Comparisons appear once there’s an earlier month of data.'}</p>
        {d.where.length === 0 && <Empty>Nothing spent yet this month.</Empty>}
        {d.where.map(({ c, now, usual }) => {
          const delta = now - usual;
          return (
            <div key={c.id} className="row between list-line">
              <span>{c.icon} {c.name}</span>
              <span className="row gap-s">
                <span>{p(now, 0)}</span>
                {d.months > 0 && Math.abs(delta) >= 1 && (
                  <span className={`chip ${delta > 0 ? 'bad' : 'good'}`}>{delta > 0 ? '+' : '−'}{p(Math.abs(delta), 0)}</span>
                )}
              </span>
            </div>
          );
        })}
      </section>

      {d.ideas.length > 0 && (
        <section className="card">
          <h3>Ideas to cut back</h3>
          {d.ideas.slice(0, 5).map((i) => <p key={i} className="small idea">{i}</p>)}
        </section>
      )}

      <section className="card">
        <h3>Trips</h3>
        {v.trips.length === 0 && <p className="muted small">Add a trip and its spending is gathered automatically — including bookings made weeks before.</p>}
        {[...v.trips].sort((a, b) => b.start.localeCompare(a.start)).map((t) => {
          const s = tripSummary(v, t);
          return (
            <button key={t.id} className="row between list-line plain" onClick={() => open({ kind: 'trip', id: t.id })}>
              <span>✈️ {t.name} <span className="muted small">· {parseDate(t.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></span>
              <span>{p(s.total, 0)} <span className="muted small">{fmt(toCur(s.total, v.settings.primary, v.settings.secondary, v.fx.rate), v.settings.secondary, { decimals: 0 })}</span></span>
            </button>
          );
        })}
        <button className="btn small" style={{ marginTop: 8 }} onClick={() => setNewTrip(true)}>+ New trip</button>
      </section>

      <section className="card">
        <h3>Categories over 6 months</h3>
        {d.catTrends.map(({ c, vals }) => (
          <div key={c.id} className="row between list-line">
            <span>{c.icon} {c.name}</span>
            <span className="row gap">
              <Sparkbars values={vals} />
              <span className="small trend-num">{p(vals[5], 0)}</span>
            </span>
          </div>
        ))}
        {d.catTrends.length === 0 && <Empty>No data yet.</Empty>}
      </section>

      {d.places.length > 0 && (
        <section className="card">
          <h3>Top places this month</h3>
          {d.places.map((m) => (
            <div key={m.name} className="row between list-line">
              <span>{m.name} <span className="muted small">×{m.count}</span></span>
              <span>{p(m.total)}</span>
            </div>
          ))}
        </section>
      )}

      {d.biggest.length > 0 && (
        <section className="card">
          <h3>Biggest purchases</h3>
          {d.biggest.map((t) => <TxRow key={t.id} t={t} />)}
        </section>
      )}

      <section className="card">
        <h3>Spending by weekday</h3>
        <p className="muted small">Average everyday spending, last 12 weeks.</p>
        <div className="weekday">
          {d.wd.map((x, i) => (
            <div key={i} className="weekday-col">
              <span className="trend-val">{x >= 1 ? p(x, 0) : ''}</span>
              <div className="trend-bar" style={{ height: `${(x / maxWd) * 70}px` }} />
              <span className="trend-label">{['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Achievements</h3>
        <div className="badges">
          {ach.map((a) => (
            <div key={a.name} className={`badge ${a.got ? 'got' : ''}`}>
              <span>{a.icon}</span>
              <span className="small">{a.name}</span>
            </div>
          ))}
        </div>
      </section>

      {v.reviews.length > 0 && (
        <section className="card">
          <h3>Past reviews</h3>
          {[...v.reviews].sort((a, b) => b.month.localeCompare(a.month)).map((r) => (
            <button key={r.month} className="row between list-line plain" onClick={() => open({ kind: 'review', month: r.month })}>
              <span>{monthLabel(r.month)}</span>
              <span className="muted small">{r.change ? `Change: ${r.change.slice(0, 28)}${r.change.length > 28 ? '…' : ''}` : ''}</span>
            </button>
          ))}
        </section>
      )}

      {newTrip && <TripSheet trip={null} onClose={(id) => { setNewTrip(false); if (id) open({ kind: 'trip', id }); }} />}
    </div>
  );
}

function TripSheet({ trip, onClose }: { trip: Trip | null; onClose: (id?: string) => void }) {
  const { update } = useStore();
  const [t, setT] = useState<Trip>(trip ?? { id: uid(), name: '', words: [], start: todayStr(), end: addDays(todayStr(), 3) });
  const [words, setWords] = useState((trip?.words ?? []).join(', '));
  return (
    <Sheet title={trip ? 'Edit trip' : 'New trip'} onClose={() => onClose()}>
      <div className="form">
        <label className="field"><span>Name</span><input className="input" value={t.name} placeholder="e.g. Paris" onChange={(e) => setT({ ...t, name: e.target.value })} /></label>
        <label className="field"><span>Place words (comma-separated)</span><input className="input" value={words} placeholder="paris, versailles" onChange={(e) => setWords(e.target.value)} /></label>
        <div className="row gap">
          <label className="field grow"><span>From</span><input className="input" type="date" value={t.start} onChange={(e) => setT({ ...t, start: e.target.value })} /></label>
          <label className="field grow"><span>To</span><input className="input" type="date" value={t.end} onChange={(e) => setT({ ...t, end: e.target.value })} /></label>
        </div>
        <button className="btn primary wide" onClick={() => {
          if (!t.name || t.end < t.start) return;
          const w = words.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
          const final = { ...t, words: w.length ? w : [t.name.toLowerCase()] };
          update((d) => void (d.trips = [...d.trips.filter((x) => x.id !== t.id), final]));
          onClose(t.id);
        }}>Save trip</button>
      </div>
    </Sheet>
  );
}

function TripView({ id, back }: { id: string; back: () => void }) {
  const { vault: v, update } = useStore();
  const { p, s } = useMoney();
  const [edit, setEdit] = useState(false);
  const trip = v.trips.find((t) => t.id === id);
  if (!trip) return <div className="page"><button className="link" onClick={back}>‹ Insights</button><Empty>Trip not found.</Empty></div>;
  const sum = tripSummary(v, trip);
  const sugg = bookingSuggestions(v, trip);
  const cats = catMap(v);

  const setMembership = (txId: string, include: boolean) =>
    update((d) => {
      const t = d.transactions.find((x) => x.id === txId);
      if (!t) return;
      t.trip = include ? trip.id : undefined;
      t.tripLocked = true;
      t.updatedAt = Date.now();
    });

  return (
    <div className="page">
      <button className="link back" onClick={back}>‹ Insights</button>
      <section className="card hero">
        <p className="eyebrow">{parseDate(trip.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – {parseDate(trip.end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
        <h1>{trip.name}</h1>
        <div className="big" style={{ marginTop: 8 }}>{p(sum.total)}</div>
        <p className="muted small">{s(sum.total)} · {p(sum.total / sum.days, 0)} per day over {sum.days} day{sum.days > 1 ? 's' : ''}</p>
      </section>
      <section className="card">
        <h3>By category</h3>
        {[...sum.byCat].sort((a, b) => b[1] - a[1]).map(([c, a]) => (
          <div key={c} className="limit-row">
            <div className="row between"><span>{cats.get(c)?.icon} {cats.get(c)?.name ?? c}</span><span>{p(a)}</span></div>
            <Progress value={a} max={sum.total} tone="good" />
          </div>
        ))}
      </section>
      {sugg.length > 0 && (
        <section className="card">
          <h3>Earlier bookings?</h3>
          <p className="muted small">These look like travel bookings made before the trip.</p>
          {sugg.map((t) => (
            <div key={t.id} className="row between list-line">
              <span>{t.merchant} <span className="muted small">· {t.date}</span></span>
              <span className="row gap-s">{p(-inPrimary(v, t))}<button className="btn small" onClick={() => setMembership(t.id, true)}>Add</button></span>
            </div>
          ))}
        </section>
      )}
      <section className="card">
        <h3>Purchases</h3>
        <p className="muted small">Found automatically: purchases naming the place, plus everything during the trip except home-city shops, rent and online subscriptions.</p>
        {sum.items.map((t) => (
          <div key={t.id} className="trip-tx">
            <TxRow t={t} />
            <button className="link small" onClick={() => setMembership(t.id, false)}>Not part of trip</button>
          </div>
        ))}
        {sum.items.length === 0 && <Empty>No purchases found for these dates yet.</Empty>}
      </section>
      <div className="row gap">
        <button className="btn grow" onClick={() => setEdit(true)}>Edit trip</button>
        <button className="btn danger grow" onClick={() => {
          update((d) => { d.trips = d.trips.filter((x) => x.id !== trip.id); d.deleted.push(`trip:${trip.id}`); });
          back();
        }}>Delete trip</button>
      </div>
      {edit && <TripSheet trip={trip} onClose={() => setEdit(false)} />}
    </div>
  );
}

function ReviewView({ month, back }: { month: string; back: () => void }) {
  const { vault: v, update, toast } = useStore();
  const { p } = useMoney();
  const existing = v.reviews.find((r) => r.month === month);
  const prevReview = v.reviews.find((r) => r.month === addMonths(month, -1));
  const [reflection, setReflection] = useState(existing?.reflection ?? '');
  const [change, setChange] = useState(existing?.change ?? '');
  const [stuck, setStuck] = useState<Review['stuck']>(prevReview?.stuck);

  const pl = plan(v, month);
  const st = monthStats(v, month);
  const prev = monthStats(v, addMonths(month, -1));
  const cats = catMap(v);
  const budget = pl.pay - pl.invest;
  const invested = investedIn(v, month);
  const deltas = [...new Set([...st.byCat.keys(), ...prev.byCat.keys()])]
    .filter((id) => cats.get(id)?.kind === 'spend')
    .map((id) => ({ c: cats.get(id)!, d: (st.byCat.get(id) || 0) - (prev.byCat.get(id) || 0) }))
    .filter((x) => Math.abs(x.d) >= 5)
    .sort((a, b) => b.d - a.d);
  const top = [...st.byCat].filter(([id]) => cats.get(id)?.kind === 'spend').sort((a, b) => b[1] - a[1])[0];

  function save() {
    update((d) => {
      d.reviews = [...d.reviews.filter((r) => r.month !== month), { month, reflection, change, savedAt: Date.now() }];
      if (prevReview && stuck) d.reviews = d.reviews.map((r) => (r.month === prevReview.month ? { ...r, stuck } : r));
    });
    toast('Review saved');
    back();
  }

  return (
    <div className="page">
      <button className="link back" onClick={back}>‹ Insights</button>
      <header className="page-head"><div><p className="eyebrow">Monthly review</p><h1>{monthLabel(month)}</h1></div></header>
      <section className={`card ${st.spent <= budget ? 'good-bg' : 'bad-bg'}`}>
        <strong>{st.spent <= budget ? `Under budget by ${p(budget - st.spent, 0)} 🎉` : `Over budget by ${p(st.spent - budget, 0)}`}</strong>
        <p className="small">Spent {p(st.spent, 0)} of {p(budget, 0)} (pay after investing).</p>
      </section>
      <section className="card">
        <h3>Investing</h3>
        <div className="row between"><span>{p(invested, 0)} of {p(pl.invest, 0)}</span><span className="muted small">{pl.invest ? Math.round((invested / pl.invest) * 100) : 0}%</span></div>
        <Progress value={invested} max={pl.invest} tone={invested >= pl.invest * 0.9 ? 'good' : 'warn'} />
      </section>
      <section className="card">
        <h3>What changed vs. the month before</h3>
        {deltas.length === 0 && <p className="muted small">No big changes.</p>}
        {deltas.slice(0, 3).filter((x) => x.d > 0).map(({ c, d }) => <div key={c.id} className="row between list-line"><span>{c.icon} {c.name}</span><span className="neg">+{p(d, 0)}</span></div>)}
        {deltas.slice(-3).filter((x) => x.d < 0).map(({ c, d }) => <div key={c.id} className="row between list-line"><span>{c.icon} {c.name}</span><span className="pos">−{p(-d, 0)}</span></div>)}
        {top && <p className="muted small" style={{ marginTop: 8 }}>Most money went to {cats.get(top[0])?.name} ({p(top[1], 0)}).</p>}
      </section>
      {prevReview?.change && (
        <section className="card">
          <h3>Did last month’s change stick?</h3>
          <p className="small">“{prevReview.change}”</p>
          <div className="seg three">
            {(['yes', 'partly', 'no'] as const).map((x) => <button key={x} className={stuck === x ? 'on' : ''} onClick={() => setStuck(x)}>{x[0].toUpperCase() + x.slice(1)}</button>)}
          </div>
        </section>
      )}
      <section className="card form">
        <label className="field"><span>How did the month feel? What went well?</span>
          <textarea className="input" rows={3} value={reflection} onChange={(e) => setReflection(e.target.value)} />
        </label>
        <label className="field"><span>One change for next month</span>
          <input className="input" value={change} placeholder="e.g. Cook at home on Wednesdays" onChange={(e) => setChange(e.target.value)} />
        </label>
        <button className="btn primary wide" onClick={save}>Save review</button>
      </section>
    </div>
  );
}
