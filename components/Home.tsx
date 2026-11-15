'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMoney, useStore } from './store';
import { Empty, Progress, TxRow } from './ui';
import { cardAlerts, catMap, dailyVariable, dayNet, greenStreak, monthStats, plan, trend } from '@/lib/calc';
import { addDays, addMonths, monthLabel, monthOf, parseDate, todayStr, weekdayShort, weekStart } from '@/lib/util';
import { monthsToGoal, portfolio } from '@/lib/invest';
import { CHALLENGES, challengeStartDate, challengeStatus, streaks } from '@/lib/streaks';
import { fmt, toCur } from '@/lib/money';
import { Sheet } from './ui';

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
    const earnPerDay = pl.dailyPay - pl.dailyInvest - pl.dailyFixed;
    const spentToday = dv.get(today) || 0;
    const todayNet = earnPerDay - spentToday;
    const pastWeek = weekNets.filter((n): n is number => n != null);
    const greenDaysWeek = pastWeek.filter((n) => n >= 0).length;
    const streakNow = greenStreak(v, dv, today);
    let netMsg: string;
    if (spentToday < 0.01) netMsg = `No spending yet today — you're ${p(earnPerDay)} in the green. 🙌`;
    else if (todayNet >= earnPerDay * 0.5) netMsg = `Nicely done — ${p(todayNet)} to spare today. 🌱`;
    else if (todayNet >= 0) netMsg = `Still in the green, with ${p(todayNet)} to spare. Easy does it for the rest of the day.`;
    else netMsg = `${p(-todayNet)} over today. A no-spend day tomorrow puts you right back in the green. 💪`;
    return {
      earnPerDay, spentToday, todayNet, greenDaysWeek, daysSoFarWeek: pastWeek.length, netMsg,
      pl, st, left, daysLeft, perDay: left / daysLeft, week, weekNets, monthNet, streak: streakNow,
      weekSpent, watch, places, tr, recent, insight, lastByNow, alerts: cardAlerts(v, today),
    };
  }, [v, month, day, today, p]);

  const { pl, st } = d;
  const allowanceLeft = pl.weekly - d.weekSpent;
  const allowanceTone = d.weekSpent > pl.weekly ? 'bad' : d.weekSpent > pl.weekly * 0.8 ? 'warn' : 'good';
  const maxNet = Math.max(pl.dailyPay * 0.6, ...d.weekNets.map((n) => Math.abs(n ?? 0)));
  const maxTrend = Math.max(1, ...d.tr.map((x) => x.variable));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">{monthLabel(month)}</p>
          <h1>Anderson Ahead</h1>
        </div>
        <button className="icon-btn gear" aria-label="Settings" onClick={() => setTab('settings')}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L15 3.5h-4L10.6 6a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.4z" /></svg>
        </button>
      </header>

      <GoalCard />

      <section className={`card net-card ${d.todayNet >= 0 ? 'green' : 'red'}`}>
        <p className="eyebrow">Your daily net · today</p>
        <div className="net-big">{p(d.todayNet, 2, true)}</div>
        <div className="net-math small">
          <span>Free to spend today <strong>{p(d.earnPerDay)}</strong></span>
          <span className="net-op">−</span>
          <span>Spent today <strong>{p(d.spentToday)}</strong></span>
        </div>
        <p className="net-msg">{d.netMsg}</p>
        <div className="netbars">
          {d.week.map((x, i) => {
            const n = d.weekNets[i];
            const h = n == null ? 0 : Math.max(4, (Math.abs(n) / maxNet) * 40);
            return (
              <div key={x} className={`netbar ${x === today ? 'today' : ''}`}>
                <div className="netbar-up">{n != null && n >= 0 && <div className="bar good" style={{ height: h }} />}</div>
                <div className="netbar-down">{n != null && n < 0 && <div className="bar bad" style={{ height: h }} />}</div>
                <span className="netbar-label">{weekdayShort(x)}</span>
              </div>
            );
          })}
        </div>
        <div className="row between small net-foot">
          <span>{d.greenDaysWeek} of {d.daysSoFarWeek} days green this week{d.streak > 1 ? ` · 🔥 ${d.streak} in a row` : ''}</span>
          <span className={d.monthNet >= 0 ? 'pos' : 'neg'}>{p(d.monthNet, 0, true)} this month</span>
        </div>
        <details className="net-why small">
          <summary>How “free to spend today” is worked out</summary>
          <div className="row between"><span>Pay per day ({p(pl.pay, 0)} ÷ {pl.dim} days)</span><span>{p(pl.dailyPay)}</span></div>
          <div className="row between"><span>Investing {v.settings.investPercent}%</span><span>−{p(pl.dailyInvest)}</span></div>
          <div className="row between"><span>Rent, bills &amp; subscriptions ({p(pl.fixed, 0)} a month)</span><span>−{p(pl.dailyFixed)}</span></div>
          <div className="row between strong"><span>Free to spend today</span><span>{p(d.earnPerDay)}</span></div>
          <p className="muted">Stay under it and the day is green. Change rent and bills in Budget, and the investing % in Settings.</p>
        </details>
      </section>

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
        <p className="eyebrow">Everyday spending this month</p>
        <div className="big">{p(st.variable)}</div>
        <p className="muted small">{s(st.variable)} · last month by today: {p(d.lastByNow.variable, 0)}</p>
        <p className="hero-fixed small">🏠 Rent &amp; bills: {p(st.fixedSpent, 0)}{st.fixedSpent >= pl.fixed - 1 ? ' — all paid' : ` of ${p(pl.fixed, 0)}`}</p>
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

      <OtherAlerts />

      <StreaksCard />

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
        <h3>Everyday spending, last 6 months</h3>
        <div className="trend">
          {d.tr.map((x) => (
            <div key={x.month} className={`trend-col ${x.month === month ? 'current' : ''}`}>
              <span className="trend-val">{x.variable > 0 ? p(x.variable, 0) : ''}</span>
              <div className="trend-bar" style={{ height: `${(x.variable / maxTrend) * 90}px` }} />
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

function GoalCard() {
  const { vault: v, setTab } = useStore();
  const aims = v.aims ?? [];
  const goal = v.goals[0];
  const pf = portfolio(v);
  const saved = goal ? (goal.source === 'investments' ? pf.total : goal.saved || 0) : 0;
  const monthly = toCur((v.settings.income * v.settings.investPercent) / 100, v.settings.primary, 'CAD', v.fx.rate);
  const months = goal ? monthsToGoal(saved, monthly, goal.target, v.settings.assumedReturn) : null;
  const cad = (n: number) => fmt(n, 'CAD', { decimals: 0 });
  if (!aims.length && !goal) return null;
  return (
    <section className="card goals-card">
      <div className="card-head">
        <h3>My goals</h3>
        <button className="link" onClick={() => setTab('invest')}>Edit</button>
      </div>
      {aims.length > 0 && (
        <ul className="aims">
          {aims.map((a) => <li key={a}>{a}</li>)}
        </ul>
      )}
      {goal && (
        <button className="goal-progress plain-card" onClick={() => setTab('invest')}>
          <div className="row between small">
            <span>{goal.icon} {goal.name}</span>
            <span className="muted">{Math.min(100, Math.round((saved / goal.target) * 100))}% · {cad(saved)} of {cad(goal.target)}</span>
          </div>
          <Progress value={saved} max={goal.target} tone="good" />
          {months != null && saved < goal.target && (
            <p className="muted small">About {months >= 12 ? `${(months / 12).toFixed(1)} years` : `${months} months`} at your current pace.</p>
          )}
        </button>
      )}
    </section>
  );
}

function OtherAlerts() {
  const { vault: v, setTab } = useStore();
  const today = todayStr();
  const last = addMonths(monthOf(today), -1);
  const needsReview = !v.reviews.some((r) => r.month === last) && v.transactions.some((t) => t.date.startsWith(last));
  const hasHoldings = v.positions.some((p) => p.units > 0) || v.holdings.some((h) => h.values.length);
  const checkDue = hasHoldings && (!v.lastInvestCheck || (parseDate(today).getTime() - parseDate(v.lastInvestCheck).getTime()) / 864e5 > 30);
  return (
    <>
      {needsReview && (
        <button className="card alert warn plain-card" onClick={() => setTab('insights')}>
          📝 <strong>Review {monthLabel(last, 'long')}</strong> — 3 minutes on what went well and one change.
        </button>
      )}
      {checkDue && (
        <button className="card alert plain-card" onClick={() => setTab('invest')}>
          📋 <strong>Monthly investment check</strong> — update share counts and fund values.
        </button>
      )}
    </>
  );
}

function StreaksCard() {
  const { vault: v, update } = useStore();
  const [picking, setPicking] = useState(false);
  const today = todayStr();
  const st = streaks(v, today);
  const green = greenStreak(v, dailyVariable(v), today);
  const statuses = v.challenges.map((c) => ({ c, s: challengeStatus(v, c, today) })).filter((x) => x.s);
  const current = statuses.find((x) => x.s!.state === 'active' || x.s!.state === 'upcoming');
  const recent = statuses.filter((x) => x.s!.state !== 'active' && x.s!.state !== 'upcoming' && x.c.end >= addDays(today, -7));
  const { p } = useMoney();

  return (
    <section className="card">
      <div className="card-head">
        <h3>Streaks</h3>
      </div>
      <div className="streaks">
        <div><strong>{green}</strong><span>green days</span></div>
        <div><strong>{st.noSpend}</strong><span>no-spend days</span></div>
        <div><strong>{st.weeksUnder}</strong><span>weeks under</span></div>
        <div><strong>{st.monthsInvested}</strong><span>months invested</span></div>
      </div>
      {current ? (
        <div className="challenge">
          <div className="row between">
            <strong>{current.s!.def.icon} {current.s!.def.name}</strong>
            <span className="chip good">{current.s!.state === 'upcoming' ? 'starts soon' : `${current.s!.daysLeft} day${current.s!.daysLeft === 1 ? '' : 's'} left`}</span>
          </div>
          <p className="muted small">
            {current.s!.def.blurb} {current.s!.limit > 0 ? `${p(current.s!.used)} of ${p(current.s!.limit, 0)} used.` : current.s!.used > 0 ? '' : 'Clean so far 👌'}
          </p>
          <button className="link small" onClick={() => update((d) => { d.challenges = d.challenges.filter((x) => x.id !== current.c.id); d.deleted.push(`challenge:${current.c.id}`); })}>Give up</button>
        </div>
      ) : (
        <button className="btn small" onClick={() => setPicking(true)}>Start a challenge</button>
      )}
      {recent.map(({ c, s }) => (
        <p key={c.id} className="small">{s!.state === 'won' ? `🏆 You won “${s!.def.name}”!` : `“${s!.def.name}” didn’t work out this time — try again?`}</p>
      ))}
      {picking && (
        <Sheet title="Pick a challenge" onClose={() => setPicking(false)}>
          <div className="form">
            {CHALLENGES.map((ch) => (
              <button
                key={ch.type}
                className="card plain-card challenge-pick"
                onClick={() => {
                  const start = challengeStartDate(ch.type, today);
                  update((d) => void d.challenges.push({ id: crypto.randomUUID(), type: ch.type, start, end: addDays(start, ch.days - 1) }));
                  setPicking(false);
                }}
              >
                <strong>{ch.icon} {ch.name}</strong>
                <span className="muted small">{ch.blurb}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </section>
  );
}
