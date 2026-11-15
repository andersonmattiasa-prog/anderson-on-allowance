'use client';
import { useMemo, useState } from 'react';
import type { Bill, Currency } from '@/lib/types';
import { useMoney, useStore } from './store';
import { Progress, Sheet } from './ui';
import { monthStats, plan, recurring } from '@/lib/calc';
import { fmt } from '@/lib/money';
import { daysInMonth, monthLabel, monthOf, todayStr, uid } from '@/lib/util';

export default function Budget() {
  const { vault: v, update, syncNow, toast } = useStore();
  const { p } = useMoney();
  const [refreshing, setRefreshing] = useState(false);
  const month = monthOf(todayStr());
  const day = Number(todayStr().slice(8));
  const pl = plan(v, month);
  const st = monthStats(v, month);
  const rec = useMemo(() => recurring(v), [v]);
  const [editingBill, setEditingBill] = useState<Bill | 'new' | null>(null);
  const pace = day / daysInMonth(month);

  const spendCats = v.categories.filter((c) => c.kind === 'spend');
  const fixedCats = v.categories.filter((c) => c.kind === 'fixed');
  const totalLimits = spendCats.reduce((a, c) => a + (c.limit || 0), 0);

  const setLimit = (id: string, value: string) =>
    update((d) => {
      const c = d.categories.find((x) => x.id === id);
      if (c) c.limit = value === '' ? undefined : Math.max(0, Number(value) || 0);
    });
  const toggleWatch = (id: string) =>
    update((d) => {
      const c = d.categories.find((x) => x.id === id);
      if (c) c.watch = !c.watch;
    });

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">{monthLabel(month)}</p>
          <h1>Budget</h1>
        </div>
        <button className="btn small" disabled={refreshing} aria-label="Refresh" onClick={async () => { setRefreshing(true); await syncNow(); setRefreshing(false); toast('Up to date'); }}>{refreshing ? '…' : '↻ Refresh'}</button>
      </header>

      <section className="card">
        <h3>Monthly plan</h3>
        <div className="plan">
          <div className="row between"><span>Pay</span><span>{p(pl.pay)}</span></div>
          <div className="row between"><span>Invest ({v.settings.investPercent}%)</span><span>−{p(pl.invest)}</span></div>
          <div className="row between"><span>Rent, bills &amp; subscriptions</span><span>−{p(pl.fixed)}</span></div>
          <div className="row between strong"><span>For everyday spending</span><span>{p(pl.spendable)}</span></div>
          <div className="row between muted small"><span>Weekly allowance{v.settings.weeklyAllowance ? ' (set by you)' : ''}</span><span>{p(pl.weekly)}</span></div>
          <div className="row between muted small"><span>Category limits add up to</span><span className={totalLimits > pl.spendable ? 'neg' : ''}>{p(totalLimits, 0)}</span></div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Everyday spending</h3>
          <span className="muted small">{p(st.variable, 0)} spent</span>
        </div>
        <p className="muted small">Each bar fills as you spend. The thin line shows how far through the month you are, so a bar past the line means you’re ahead of pace. Tap a limit to change it. ★ shows the category on Home.</p>
        {spendCats.map((c) => {
          const spent = st.byCat.get(c.id) || 0;
          return (
            <div key={c.id} className="limit-row">
              <div className="row between">
                <span>
                  <button className={`star ${c.watch ? 'on' : ''}`} onClick={() => toggleWatch(c.id)} aria-label="Watch">★</button>
                  {c.icon} {c.name}
                </span>
                {c.limit ? (
                  <span className={`chip ${spent > c.limit ? 'bad' : spent > c.limit * 0.8 ? 'warn' : 'good'}`}>
                    {spent > c.limit ? `${p(spent - c.limit, 0)} over` : `${p(c.limit - spent, 0)} left`}
                  </span>
                ) : null}
              </div>
              <div className="pace-wrap">
                <Progress value={spent} max={c.limit || 0} />
                {c.limit ? <div className="pace" style={{ left: `${pace * 100}%` }} /> : null}
              </div>
              <div className="row between small budget-line">
                <span className="muted">Spent <strong className="ink">{p(spent, 0)}</strong></span>
                <label className="row gap-s muted">
                  Monthly limit
                  <input className="input tiny" inputMode="decimal" defaultValue={c.limit ?? ''} placeholder="none" onBlur={(e) => setLimit(c.id, e.target.value)} aria-label={`${c.name} monthly limit`} />
                </label>
              </div>
            </div>
          );
        })}
      </section>

      <section className="card">
        <h3>Fixed costs</h3>
        {fixedCats.map((c) => {
          const spent = st.byCat.get(c.id) || 0;
          return (
            <div key={c.id} className="list-line">
              <div className="row between">
                <span>{c.icon} {c.name}</span>
                <span className="small">Paid <strong>{p(spent, 0)}</strong> this month</span>
              </div>
              {c.id !== 'rent' && (
                <div className="row between small budget-line">
                  <span />
                  <label className="row gap-s muted">
                    Monthly budget
                    <input className="input tiny" inputMode="decimal" defaultValue={c.limit ?? ''} placeholder="none" onBlur={(e) => setLimit(c.id, e.target.value)} aria-label={`${c.name} monthly budget`} />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Monthly bills</h3>
          <button className="link" onClick={() => setEditingBill('new')}>+ Add</button>
        </div>
        <p className="muted small">Posted automatically on their day each month (skipped if the bank already sent it).</p>
        {v.bills.map((b) => (
          <button key={b.id} className="row between list-line plain" onClick={() => setEditingBill(b)}>
            <span>{b.name} <span className="muted small">· day {b.day}</span></span>
            <span>{fmt(b.amount, b.currency)}</span>
          </button>
        ))}
      </section>

      {rec.length > 0 && (
        <section className="card">
          <h3>Recurring payments found</h3>
          {rec.map((r) => (
            <div key={r.name} className="row between list-line">
              <span>{r.name} <span className="muted small">· {r.months} months</span></span>
              <span>~{p(r.avg)}</span>
            </div>
          ))}
        </section>
      )}

      {editingBill && <BillSheet bill={editingBill === 'new' ? null : editingBill} onClose={() => setEditingBill(null)} />}
    </div>
  );
}

function BillSheet({ bill, onClose }: { bill: Bill | null; onClose: () => void }) {
  const { vault: v, update } = useStore();
  const [b, setB] = useState<Bill>(bill ?? { id: uid(), name: '', amount: 0, currency: 'EUR', day: 1, category: 'subscriptions', account: 'wise' });
  const save = () => {
    if (!b.name || !(b.amount > 0)) return;
    update((d) => {
      d.bills = [...d.bills.filter((x) => x.id !== b.id), { ...b, day: Math.min(31, Math.max(1, Math.round(b.day))) }];
    });
    onClose();
  };
  const remove = () => {
    update((d) => void (d.bills = d.bills.filter((x) => x.id !== b.id)));
    onClose();
  };
  return (
    <Sheet title={bill ? 'Edit bill' : 'New bill'} onClose={onClose}>
      <div className="form">
        <label className="field"><span>Name</span><input className="input" value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} /></label>
        <div className="row gap">
          <label className="field grow"><span>Amount</span><input className="input" inputMode="decimal" defaultValue={b.amount || ''} onChange={(e) => setB({ ...b, amount: Number(e.target.value.replace(',', '.')) })} /></label>
          <label className="field"><span>Currency</span>
            <select className="input" value={b.currency} onChange={(e) => setB({ ...b, currency: e.target.value as Currency })}><option>EUR</option><option>CAD</option></select>
          </label>
          <label className="field"><span>Day</span><input className="input" type="number" min={1} max={31} value={b.day} onChange={(e) => setB({ ...b, day: Number(e.target.value) })} /></label>
        </div>
        <label className="field"><span>Category</span>
          <select className="input" value={b.category} onChange={(e) => setB({ ...b, category: e.target.value })}>
            {v.categories.filter((c) => c.kind === 'fixed').map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Paid from</span>
          <select className="input" value={b.account} onChange={(e) => setB({ ...b, account: e.target.value })}>
            {v.accounts.filter((a) => a.type !== 'investment').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <button className="btn primary wide" onClick={save}>Save</button>
        {bill && <button className="btn danger wide" onClick={remove}>Remove bill</button>}
      </div>
    </Sheet>
  );
}
