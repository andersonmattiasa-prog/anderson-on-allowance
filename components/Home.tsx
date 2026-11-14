'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMoney, useStore } from './store';
import { Empty, Progress, TxRow } from './ui';
import { cardAlerts, catMap, dailyVariable, dayNet, greenStreak, monthStats, plan, trend } from '@/lib/calc';
import { addDays, addMonths, monthLabel, monthOf, todayStr, weekdayShort, weekStart } from '@/lib/util';

function useInstallHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem('installHintDismissed') === '1';
    } catch {}
    setShow(!standalone && !dismissed);
  }, []);
  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem('installHintDismissed', '1');
    } catch {}
  };
  return { show, dismiss };
}

export default function Home() {
  const { vault: v, setTab, setSheet } = useStore();
  const { p, s } = useMoney();
  const install = useInstallHint();
  const today = todayStr();
  const month = monthOf(today);
  const day = Number(today.slice(8));

  const d = useMemo(() => {
    const pl = plan(v, month);
    const st = monthStats(v, month);
    const lastMonth = addMonths(month, -1);
    const lastByNow = monthStats(v, lastMonth, day);
    const left = pl.pay - pl.invest - st.spent;
    const daysLeft = pl.dim - day + 1;
    const dv = dailyVariable(v);
    const ws = weekStart(today);
    const week = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    const weekNets = week.map((x) => (x > today ? null : dayNet(v, x, dv)));
    let monthNet = 0;
    for (let i = 1; i <= day; i++) monthNet += dayNet(v, `${month}-${String(i).padStart(2, '0')}`, dv);
    const weekSpent = week.filter((x) => x <= today).reduce((a, x) => a + (dv.get(x) || 0), 0);
    const cats = catMap(v);
    const watch = v.categories
      .filter((c) => c.kind === 'spend' && c.limit)
      .map((c) => ({ c, spent: st.byCat.get(c.id) || 0 }))
      .filter(({ c, spent }) => c.watch || spent >= (c.limit || 0) * 0.8)
      .sort((a, b) => b.spent / (b.c.limit || 1) - a.spent / (a.c.limit || 1))
      .slice(0, 5);
    const places = [...st.byMerchant.values()].sort((a, b) => b.total - a.total).slice(0, 5);
    const tr = trend(v, 6, today);
    const recent = [...v.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt).slice(0, 6);
    // Insight: biggest change vs last month by this date.
    let insight = '';
    let bestDelta = 0;
    for (const [id, amt] of st.byCat) {
      const c = cats.get(id);
      if (c?.kind !== 'spend') continue;
      const delta = amt - (lastByNow.byCat.get(id) || 0);
      if (Math.abs(delta) > Math.abs(bestDelta) && Math.abs(delta) >= 10) {
        bestDelta = delta;
        insight = `${c.icon} ${c.name} is ${delta > 0 ? 'up' : 'down'} ${p(Math.abs(delta), 0)} vs. this point last month.`;
      }
    }
    return {
      pl, st, left, daysLeft, perDay: left / daysLeft, week, weekNets, monthNet, streak: greenStreak(v, dv, today),
      weekSpent, watch, places, tr, recent, insight, lastByNow, alerts: cardAlerts(v, today),
    };
  }, [v, month, day, today, p]);

  const { pl, st } = d;
  const allowanceLeft = pl.weekly - d.weekSpent;
  const allowanceTone = d.weekSpent > pl.weekly ? 'bad' : d.weekSpent > pl.weekly * 0.8 ? 'warn' : 'good';
  const maxNet = Math.max(pl.dailyPay * 0.6, ...d.weekNets.map((n) => Math.abs(n ?? 0)));
  const maxTrend = Math.max(1, ...d.tr.map((x) => x.spent));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">{monthLabel(month)}</p>
          <h1>Anderson on Allowance</h1>
        </div>
      </header>

      {install.show && (
        <div className="card install">
          <strong>Add to your Home Screen</strong>
          <p className="muted small">
            In Safari, tap <b>Share</b> <span aria-hidden>⬆︎</span> then <b>Add to Home Screen</b>. It opens full-screen like an app.
          </p>
          <button className="link" onClick={install.dismiss}>Got it</button>
        </div>
      )}

      {v.transactions.length === 0 && (
        <div className="card">
          <strong>Let’s get your spending in</strong>
          <p className="muted small">Import a CSV from Wise, Scotiabank or Coast Capital, or set up Apple Pay and email-alert syncing in Settings.</p>
          <div className="row gap">
            <button className="btn primary" onClick={() => setSheet({ type: 'import' })}>Import CSV</button>
            <button className="btn" onClick={() => setTab('settings')}>Set up syncing</button>
          </div>
        </div>
      )}

      <section className="card hero">
        <p className="eyebrow">Spent this month</p>
        <div className="big">{p(st.spent)}</div>
        <p className="muted small">{s(st.spent)} · last month by today: {p(d.lastByNow.spent, 0)}</p>
        <div className="split">
          <div>
            <p className="eyebrow">Left to spend</p>
            <div className={`mid ${d.left < 0 ? 'neg' : 'pos'}`}>{p(d.left)}</div>
            <p className="muted small">after investing {p(pl.invest, 0)}</p>
          </div>
          <div>
            <p className="eyebrow">Per day</p>
            <div className={`mid ${d.perDay < 0 ? 'neg' : ''}`}>{p(d.perDay)}</div>
            <p className="muted small">for {d.daysLeft} day{d.daysLeft === 1 ? '' : 's'}</p>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Daily net</h3>
          <span className={`chip ${d.monthNet >= 0 ? 'good' : 'bad'}`}>{p(d.monthNet, 0, true)} this month</span>
        </div>
        <div className="netbars">
          {d.week.map((x, i) => {
            const n = d.weekNets[i];
            const h = n == null ? 0 : Math.max(4, (Math.abs(n) / maxNet) * 44);
            return (
              <div key={x} className={`netbar ${x === addDays(todayStr(), 0) ? 'today' : ''}`}>
                <div className="netbar-up">{n != null && n >= 0 && <div className="bar good" style={{ height: h }} />}</div>
                <div className="netbar-down">{n != null && n < 0 && <div className="bar bad" style={{ height: h }} />}</div>
                <span className="netbar-label">{weekdayShort(x)}</span>
              </div>
            );
          })}
        </div>
        <p className="muted small">
          Each day earns {p(pl.dailyPay - pl.dailyInvest - pl.dailyFixed)} after investing and a share of rent &amp; bills.
          {d.streak > 0 ? ` 🔥 ${d.streak} green day${d.streak > 1 ? 's' : ''} in a row.` : ''}
        </p>
      </section>

      {d.alerts.map((a) => (
        <div key={a.account} className={`card alert ${a.autopay ? '' : a.days <= 1 ? 'bad' : 'warn'}`}>
          💳 <strong>{a.name}</strong> {a.days === 0 ? 'is due today' : `is due in ${a.days} day${a.days > 1 ? 's' : ''}`}
          {a.autopay ? ' — autopay is on.' : '. Pay the statement balance to avoid interest.'}
        </div>
      ))}

      <section className="card">
        <div className="card-head">
          <h3>This week’s allowance</h3>
          <span className={`chip ${allowanceTone}`}>{allowanceLeft >= 0 ? `${p(allowanceLeft, 0)} left` : `${p(-allowanceLeft, 0)} over`}</span>
        </div>
        <Progress value={d.weekSpent} max={pl.weekly} />
        <p className="muted small">
          {p(d.weekSpent)} of {p(pl.weekly, 0)} on everyday spending since Monday.
        </p>
      </section>

      {d.insight && <div className="card insight">💡 {d.insight}</div>}

      {d.watch.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h3>Areas to watch</h3>
            <button className="link" onClick={() => setTab('budget')}>Budget</button>
          </div>
          {d.watch.map(({ c, spent }) => (
            <div key={c.id} className="limit-row">
              <div className="row between">
                <span>{c.icon} {c.name}</span>
                <span className="muted small">{p(spent, 0)} / {p(c.limit || 0, 0)}</span>
              </div>
              <Progress value={spent} max={c.limit || 0} />
            </div>
          ))}
        </section>
      )}

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

      <section className="card">
        <h3>Last 6 months</h3>
        <div className="trend">
          {d.tr.map((x) => (
            <div key={x.month} className={`trend-col ${x.month === month ? 'current' : ''}`}>
              <span className="trend-val">{x.spent > 0 ? p(x.spent, 0) : ''}</span>
              <div className="trend-bar" style={{ height: `${(x.spent / maxTrend) * 90}px` }} />
              <span className="trend-label">{monthLabel(x.month, 'short')}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Recent</h3>
          <button className="link" onClick={() => setTab('activity')}>All activity</button>
        </div>
        {d.recent.length ? d.recent.map((t) => <TxRow key={t.id} t={t} />) : <Empty>No purchases yet.</Empty>}
      </section>
    </div>
  );
}
