'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Currency, Goal, Vault } from '@/lib/types';
import { useStore } from './store';
import { Progress, Sheet } from './ui';
import { LineChart, type Point } from './Chart';
import { api } from '@/lib/api';
import { fmt, toCur } from '@/lib/money';
import { accountBalance, investedIn, monthsToGoal, netWorth, portfolio, projection, latestValue } from '@/lib/invest';
import { cardAlerts } from '@/lib/calc';
import { monthOf, parseDate, todayStr, uid } from '@/lib/util';

type Range = '1D' | '1W' | '1M' | '6M' | '1Y' | '5Y';
const RANGE_API: Record<Exclude<Range, '1D'>, string> = { '1W': '1mo', '1M': '1mo', '6M': '6mo', '1Y': '1y', '5Y': '5y' };
type History = Record<string, { currency: string; points: [number, number][] }>;

const cad = (n: number, d = 0) => fmt(n, 'CAD', { decimals: d });

/** Portfolio value over time = current units × historical prices (+ hand-entered fund/cash values held flat). */
function buildSeries(v: Vault, hist: History, sinceMs: number): Point[] {
  const fxPts = hist['CAD=X']?.points ?? [];
  const manual = v.holdings.reduce((a, h) => a + (latestValue(h) ? toCur(latestValue(h)!.value, h.currency, 'CAD', v.fx.rate) : 0), 0);
  const positions = v.positions.filter((p) => p.units > 0 && hist[p.ticker]?.points.length);
  const days = new Set<string>();
  for (const p of positions) for (const [t] of hist[p.ticker].points) if (t >= sinceMs) days.add(new Date(t).toISOString().slice(0, 10));
  const at = (pts: [number, number][], t: number) => {
    let lo = 0, hi = pts.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid][0] <= t) (ans = mid), (lo = mid + 1);
      else hi = mid - 1;
    }
    return ans >= 0 ? pts[ans][1] : pts.length ? pts[0][1] : 0;
  };
  return [...days].sort().map((d) => {
    const t = Date.parse(d) + 86_399_000;
    let total = manual;
    for (const p of positions) {
      const h = hist[p.ticker];
      const price = at(h.points, t);
      const fx = h.currency === 'USD' ? (fxPts.length ? at(fxPts, t) : v.quotes['CAD=X']?.price ?? 1.38) : h.currency === 'EUR' ? v.fx.rate : 1;
      total += price * p.units * fx;
    }
    return { t: Date.parse(d), v: total };
  });
}

export default function Invest() {
  const { vault: v, token, refreshQuotes, toast } = useStore();
  const [range, setRange] = useState<Range>('1M');
  const [hist, setHist] = useState<Record<string, History>>({});
  const [loading, setLoading] = useState(false);
  const [sheet, setSheet] = useState<null | 'holdings' | 'log' | 'balances' | { goal: Goal | null }>(null);
  const today = todayStr();
  const month = monthOf(today);
  const pf = useMemo(() => portfolio(v), [v]);
  const nw = useMemo(() => netWorth(v, today, pf.total), [v, today, pf.total]);
  const tickers = v.positions.filter((p) => p.units > 0).map((p) => p.ticker);
  const tickerKey = tickers.join(',');
  const inflight = useRef(new Set<string>());

  useEffect(() => {
    if (range === '1D' || !tickerKey) return;
    const apiRange = RANGE_API[range];
    const key = `${apiRange}|${tickerKey}`;
    if (hist[key] || inflight.current.has(key)) return;
    inflight.current.add(key);
    setLoading(true);
    api<{ series: History }>(`/api/history?range=${apiRange}&t=${encodeURIComponent(tickerKey + ',CAD=X')}`, { token })
      .then((r) => setHist((h) => ({ ...h, [key]: r.series })))
      .catch(() => toast('Couldn’t load price history'))
      .finally(() => {
        inflight.current.delete(key);
        setLoading(false);
      });
  }, [range, tickerKey, token, hist, toast]);

  const series: Point[] = useMemo(() => {
    if (range === '1D') {
      const now = Date.now();
      return [{ t: now - 864e5, v: pf.total - pf.dayChange }, { t: now, v: pf.total }];
    }
    const h = hist[`${RANGE_API[range]}|${tickerKey}`];
    if (!h) return [];
    const since = range === '1W' ? Date.now() - 7 * 864e5 : 0;
    const s = buildSeries(v, h, since);
    if (s.length) s.push({ t: Date.now(), v: pf.total });
    return s;
  }, [range, hist, tickerKey, v, pf]);

  const change = series.length >= 2 ? series[series.length - 1].v - series[0].v : 0;
  const changePct = series.length >= 2 && series[0].v ? (change / series[0].v) * 100 : 0;

  // 15% plan
  const target = (v.settings.income * v.settings.investPercent) / 100;
  const invested = investedIn(v, month);
  const targetCad = toCur(target, v.settings.primary, 'CAD', v.fx.rate);
  const monthlyCad = targetCad;

  const goals = v.goals.map((g) => {
    const saved = g.source === 'investments' ? pf.total : g.saved || 0;
    const months = monthsToGoal(saved, g.source === 'investments' ? monthlyCad : monthlyCad * 0.25, g.target, v.settings.assumedReturn);
    return { g, saved, months };
  });
  const proj = projection(pf.total, monthlyCad, v.settings.assumedReturn, 30);
  const daysSinceCheck = v.lastInvestCheck ? Math.round((parseDate(today).getTime() - parseDate(v.lastInvestCheck).getTime()) / 864e5) : null;
  const stale = Object.values(v.quotes).length && v.quotes['CAD=X']?.date ? new Date(v.quotes['CAD=X'].date) : null;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Invest</h1>
        <button className="btn small" onClick={() => refreshQuotes(true).then(() => toast('Prices updated'))}>Refresh prices</button>
      </header>

      {(daysSinceCheck == null || daysSinceCheck > 30) && (
        <div className="card alert warn">
          📋 <strong>Monthly investment check.</strong> Update share counts, cash and fund values so everything stays accurate.{' '}
          <button className="link" onClick={() => setSheet('holdings')}>Start</button>
        </div>
      )}

      <section className="card hero">
        <p className="eyebrow">Net worth</p>
        <div className="big">{cad(nw.total)}</div>
        <p className="muted small">≈ {fmt(toCur(nw.total, 'CAD', 'EUR', v.fx.rate), 'EUR', { decimals: 0 })}</p>
        <div className="split three">
          <div><p className="eyebrow">Invested</p><div className="mid small-mid">{cad(nw.investments)}</div></div>
          <div><p className="eyebrow">Cash</p><div className="mid small-mid">{cad(nw.cash)}</div></div>
          <div><p className="eyebrow">Cards</p><div className="mid small-mid">−{cad(nw.debt)}</div></div>
        </div>
        {nw.accounts.some((a) => a.balance == null) && (
          <p className="muted small" style={{ marginTop: 10 }}>
            Some balances aren’t entered yet, so they’re left out. <button className="link gold" onClick={() => setSheet('balances')}>Enter balances</button>
          </p>
        )}
      </section>

      {cardAlerts(v, today).map((a) => (
        <div key={a.account} className={`card alert ${a.autopay ? '' : 'warn'}`}>
          💳 {a.name} {a.days === 0 ? 'is due today' : `is due in ${a.days} day${a.days > 1 ? 's' : ''}`}{a.autopay ? ' (autopay).' : '.'}
          {(() => {
            const acc = v.accounts.find((x) => x.id === a.account)!;
            const bal = accountBalance(v, acc);
            return bal != null && bal < 0 ? ` Balance ${fmt(-bal, acc.currency)}.` : '';
          })()}
        </div>
      ))}

      <section className="card">
        <div className="card-head">
          <h3>Performance</h3>
          <span className="muted small">{cad(pf.total)}</span>
        </div>
        {tickers.length === 0 && pf.total === 0 ? (
          <p className="muted small">Add your holdings to see performance. <button className="link" onClick={() => setSheet('holdings')}>Add holdings</button></p>
        ) : (
          <>
            <div className="seg six">
              {(['1D', '1W', '1M', '6M', '1Y', '5Y'] as Range[]).map((r) => (
                <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>
              ))}
            </div>
            <p className={`perf ${change >= 0 ? 'pos' : 'neg'}`}>
              {change >= 0 ? '▲' : '▼'} {cad(Math.abs(change))} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)
              <span className="muted small"> {range === '1D' ? 'today' : `past ${range}`}</span>
            </p>
            {loading && !series.length ? <div className="chart-empty muted small">Loading prices…</div> : <LineChart points={series} format={(x) => cad(x)} />}
            <p className="muted small">Current share counts × past prices; fund, cash and managed values are held at their latest entry.{stale ? ` Prices from ${stale.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}.` : ''}</p>
          </>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h3>{v.settings.investPercent}% of every paycheck</h3>
          <button className="link" onClick={() => setSheet('log')}>+ Log</button>
        </div>
        <div className="row between">
          <span>{fmt(invested, v.settings.primary)} of {fmt(target, v.settings.primary, { decimals: 0 })}</span>
          <span className="muted small">{cad(targetCad)} / month</span>
        </div>
        <Progress value={invested} max={target} tone={invested >= target ? 'good' : invested > 0 ? 'warn' : 'bad'} />
        <p className="muted small">Transfers to Wealthsimple or Odlum Brown count automatically. Use + Log for anything else.</p>
      </section>

      <AimsEditor />

      <section className="card">
        <div className="card-head">
          <h3>Savings targets</h3>
          <button className="link" onClick={() => setSheet({ goal: null })}>+ Add</button>
        </div>
        {goals.map(({ g, saved, months }) => (
          <button key={g.id} className="goal plain" onClick={() => setSheet({ goal: g })}>
            <div className="row between">
              <span>{g.icon} {g.name}</span>
              <span className="small">{cad(saved)} / {cad(g.target)}</span>
            </div>
            <Progress value={saved} max={g.target} tone="good" />
            <p className="muted small">
              {saved >= g.target ? 'Reached 🎉' : `${cad(g.target - saved)} to go`}
              {months != null && saved < g.target ? ` · about ${months >= 12 ? `${(months / 12).toFixed(1)} years` : `${months} months`} at your current pace` : ''}
            </p>
          </button>
        ))}
      </section>

      <section className="card">
        <h3>If you keep going</h3>
        <p className="muted small">Investing {cad(monthlyCad)}/month at an assumed {v.settings.assumedReturn}% a year.</p>
        <div className="proj">
          {[5, 10, 20, 30].map((y) => (
            <div key={y}>
              <span className="eyebrow">{y} yrs</span>
              <strong>{cad(proj[y].value)}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Holdings</h3>
          <button className="link" onClick={() => setSheet('holdings')}>Edit</button>
        </div>
        {pf.rows.length === 0 && <p className="muted small">No holdings yet.</p>}
        {pf.rows.map((r) => (
          <div key={r.id} className="list-line">
            <div className="row between">
              <span>
                {r.name} {r.units ? <span className="muted small">× {r.units}</span> : null}
              </span>
              <span>{r.priced ? cad(r.value) : <span className="muted small">no price</span>}</span>
            </div>
            <div className="row between small muted">
              <span>{v.accounts.find((a) => a.id === r.account)?.name ?? r.account}</span>
              <span>
                {pf.total ? `${((r.value / pf.total) * 100).toFixed(1)}%` : ''}
                {r.dayChange ? <span className={r.dayChange >= 0 ? 'pos' : 'neg'}> · {r.dayChange >= 0 ? '+' : '−'}{cad(Math.abs(r.dayChange), 0)} today</span> : null}
              </span>
            </div>
          </div>
        ))}
      </section>

      {sheet === 'holdings' && <HoldingsSheet onClose={() => setSheet(null)} />}
      {sheet === 'balances' && <BalancesSheet onClose={() => setSheet(null)} />}
      {sheet === 'log' && <LogSheet onClose={() => setSheet(null)} />}
      {sheet && typeof sheet === 'object' && <GoalSheet goal={sheet.goal} onClose={() => setSheet(null)} />}
    </div>
  );
}

function HoldingsSheet({ onClose }: { onClose: () => void }) {
  const { vault: v, update, refreshQuotes, toast } = useStore();
  const [positions, setPositions] = useState(v.positions.map((p) => ({ ...p })));
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(v.holdings.map((h) => [h.id, latestValue(h)?.value?.toString() ?? ''])));
  const invAccounts = v.accounts.filter((a) => a.type === 'investment');

  function save() {
    const today = todayStr();
    update((d) => {
      d.positions = positions
        .map((p) => ({ ...p, ticker: p.ticker.trim().toUpperCase(), units: Number(String(p.units).replace(',', '.')) || 0 }))
        .filter((p) => p.ticker);
      for (const h of d.holdings) {
        const raw = values[h.id];
        if (raw == null || raw.trim() === '') continue;
        const val = Number(raw.replace(/[, ]/g, ''));
        if (!isFinite(val)) continue;
        h.values = [...h.values.filter((x) => x.date !== today), { date: today, value: val }].slice(-60);
      }
      d.lastInvestCheck = today;
    });
    onClose();
    toast('Holdings saved');
    setTimeout(() => void refreshQuotes(true), 800);
  }

  return (
    <Sheet title="Holdings & monthly check" onClose={onClose}>
      <div className="form">
        <p className="muted small">Shares are priced daily from Yahoo Finance (only the ticker symbols leave your phone). Use .TO for Toronto listings.</p>
        <h3>Shares</h3>
        {positions.map((p, i) => (
          <div key={p.id} className="pos-row">
            <input className="input" value={p.ticker} placeholder="Ticker" onChange={(e) => setPositions(positions.map((x, j) => (j === i ? { ...x, ticker: e.target.value } : x)))} />
            <input className="input" inputMode="decimal" value={p.units || ''} placeholder="Units" onChange={(e) => setPositions(positions.map((x, j) => (j === i ? { ...x, units: e.target.value as unknown as number } : x)))} />
            <select className="input" value={p.account} onChange={(e) => setPositions(positions.map((x, j) => (j === i ? { ...x, account: e.target.value } : x)))}>
              {invAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button className="icon-btn" aria-label="Remove" onClick={() => setPositions(positions.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button className="btn small" onClick={() => setPositions([...positions, { id: uid(), ticker: '', units: 0, account: invAccounts[0]?.id ?? 'odlum' }])}>+ Add a ticker</button>
        <h3>Funds, cash &amp; managed accounts (CA$)</h3>
        {v.holdings.map((h) => (
          <label key={h.id} className="field">
            <span>{h.name}{latestValue(h) ? ` · last ${latestValue(h)!.date}` : ''}</span>
            <input className="input" inputMode="decimal" value={values[h.id] ?? ''} placeholder="Current value" onChange={(e) => setValues({ ...values, [h.id]: e.target.value })} />
          </label>
        ))}
        <button className="btn primary wide" onClick={save}>Save — monthly check done</button>
      </div>
    </Sheet>
  );
}

function BalancesSheet({ onClose }: { onClose: () => void }) {
  const { vault: v, update } = useStore();
  const accts = v.accounts.filter((a) => a.type !== 'investment');
  const [vals, setVals] = useState<Record<string, string>>(
    Object.fromEntries(accts.map((a) => {
      const b = accountBalance(v, a);
      return [a.id, b == null ? '' : String(Math.round(Math.abs(b) * 100) / 100)];
    })),
  );
  function save() {
    const today = todayStr();
    update((d) => {
      for (const a of accts) {
        const raw = vals[a.id]?.trim();
        if (!raw) continue;
        const n = Math.abs(Number(raw.replace(/[, ]/g, '')));
        if (!isFinite(n)) continue;
        d.balances[a.id] = { date: today, balance: a.type === 'credit' ? -n : n };
      }
    });
    onClose();
  }
  return (
    <Sheet title="Account balances" onClose={onClose}>
      <div className="form">
        <p className="muted small">Enter today’s balance once — after that, new transactions keep it up to date. For cards, enter what you owe.</p>
        {accts.map((a) => (
          <label key={a.id} className="field">
            <span>{a.name} ({a.currency}){a.type === 'credit' ? ' — owed' : ''}</span>
            <input className="input" inputMode="decimal" value={vals[a.id] ?? ''} placeholder="Unknown" onChange={(e) => setVals({ ...vals, [a.id]: e.target.value })} />
          </label>
        ))}
        <button className="btn primary wide" onClick={save}>Save balances</button>
      </div>
    </Sheet>
  );
}

function LogSheet({ onClose }: { onClose: () => void }) {
  const { vault: v, update } = useStore();
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>(v.settings.primary);
  const [date, setDate] = useState(todayStr());
  const [note, setNote] = useState('');
  const month = monthOf(todayStr());
  return (
    <Sheet title="Log an investment" onClose={onClose}>
      <div className="form">
        <div className="row gap">
          <label className="field grow"><span>Amount</span><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></label>
          <label className="field"><span>Currency</span>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}><option>EUR</option><option>CAD</option></select>
          </label>
        </div>
        <label className="field"><span>Date</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field"><span>Note</span><input className="input" value={note} placeholder="e.g. Wealthsimple deposit" onChange={(e) => setNote(e.target.value)} /></label>
        <button
          className="btn primary wide"
          onClick={() => {
            const n = Number(amount.replace(',', '.'));
            if (!(n > 0)) return;
            update((d) => void d.investLog.push({ id: uid(), date, amount: n, currency, note: note || undefined }));
            onClose();
          }}
        >
          Log it
        </button>
        {v.investLog.filter((e) => e.date.startsWith(month)).length > 0 && (
          <>
            <h3>This month</h3>
            {v.investLog.filter((e) => e.date.startsWith(month)).map((e) => (
              <div key={e.id} className="row between list-line">
                <span>{e.date} {e.note ? `· ${e.note}` : ''}</span>
                <span className="row gap-s">
                  {fmt(e.amount, e.currency)}
                  <button className="link" onClick={() => update((d) => { d.investLog = d.investLog.filter((x) => x.id !== e.id); d.deleted.push(`invest:${e.id}`); })}>Remove</button>
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </Sheet>
  );
}

function GoalSheet({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const { update } = useStore();
  const [g, setG] = useState<Goal>(goal ?? { id: uid(), name: '', icon: '🎯', target: 1000, source: 'manual', saved: 0 });
  return (
    <Sheet title={goal ? 'Edit goal' : 'New goal'} onClose={onClose}>
      <div className="form">
        <div className="row gap">
          <label className="field" style={{ width: 70 }}><span>Icon</span><input className="input" value={g.icon} onChange={(e) => setG({ ...g, icon: e.target.value })} /></label>
          <label className="field grow"><span>Name</span><input className="input" value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} /></label>
        </div>
        <label className="field"><span>Target (CA$)</span><input className="input" inputMode="decimal" defaultValue={g.target} onChange={(e) => setG({ ...g, target: Number(e.target.value.replace(/[, ]/g, '')) || 0 })} /></label>
        <label className="field"><span>Progress comes from</span>
          <select className="input" value={g.source} onChange={(e) => setG({ ...g, source: e.target.value as Goal['source'] })}>
            <option value="investments">All my investments</option>
            <option value="manual">An amount I enter</option>
          </select>
        </label>
        {g.source === 'manual' && (
          <label className="field"><span>Saved so far (CA$)</span><input className="input" inputMode="decimal" defaultValue={g.saved ?? 0} onChange={(e) => setG({ ...g, saved: Number(e.target.value.replace(/[, ]/g, '')) || 0 })} /></label>
        )}
        <button className="btn primary wide" onClick={() => {
          if (!g.name || !(g.target > 0)) return;
          update((d) => void (d.goals = goal ? d.goals.map((x) => (x.id === g.id ? g : x)) : [...d.goals, g]));
          onClose();
        }}>Save goal</button>
        {goal && <button className="btn danger wide" onClick={() => { update((d) => void (d.goals = d.goals.filter((x) => x.id !== g.id))); onClose(); }}>Remove goal</button>}
      </div>
    </Sheet>
  );
}

function AimsEditor() {
  const { vault: v, update, toast } = useStore();
  const [text, setText] = useState((v.aims ?? []).join('\n'));
  const [editing, setEditing] = useState(false);
  return (
    <section className="card">
      <div className="card-head">
        <h3>My goals</h3>
        {!editing && <button className="link" onClick={() => setEditing(true)}>Edit</button>}
      </div>
      {editing ? (
        <div className="form">
          <label className="field" htmlFor="aims-text"><span>One goal per line</span></label>
          <textarea id="aims-text" className="input" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row gap">
            <button className="btn primary grow" onClick={() => {
              const aims = text.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 12);
              update((d) => void (d.aims = aims));
              setEditing(false);
              toast('Goals saved');
            }}>Save goals</button>
            <button className="btn grow" onClick={() => { setText((v.aims ?? []).join('\n')); setEditing(false); }}>Cancel</button>
          </div>
        </div>
      ) : (v.aims ?? []).length ? (
        <ul className="aims">{(v.aims ?? []).map((a) => <li key={a}>{a}</li>)}</ul>
      ) : (
        <p className="muted small">No goals written yet.</p>
      )}
    </section>
  );
}
