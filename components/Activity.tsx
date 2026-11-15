'use client';
import { useMemo, useState } from 'react';
import { useMoney, useStore } from './store';
import { Empty, TxRow } from './ui';
import { catMap, inPrimary } from '@/lib/calc';
import { dayLabel, normText } from '@/lib/util';

const PAGE = 150;

export default function Activity() {
  const { vault: v, setSheet, syncNow, toast } = useStore();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await syncNow();
    setRefreshing(false);
    toast('Up to date');
  };
  const { p } = useMoney();
  const [q, setQ] = useState('');
  const [account, setAccount] = useState('');
  const [category, setCategory] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const filtered = useMemo(() => {
    const nq = normText(q).trim();
    return v.transactions
      .filter((t) => (!account || t.account === account) && (!category || t.category === category))
      .filter((t) => !nq || normText(`${t.merchant} ${t.description ?? ''} ${t.note ?? ''} ${Math.abs(t.amount).toFixed(2)}`).includes(nq))
      .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
  }, [v.transactions, q, account, category]);

  const groups = useMemo(() => {
    const cats = catMap(v);
    const out: { date: string; items: typeof filtered; spent: number }[] = [];
    for (const t of filtered.slice(0, limit)) {
      let g = out[out.length - 1];
      if (!g || g.date !== t.date) out.push((g = { date: t.date, items: [], spent: 0 }));
      g.items.push(t);
      const kind = cats.get(t.category)?.kind;
      if (kind === 'spend' || kind === 'fixed') g.spent -= inPrimary(v, t);
    }
    return out;
  }, [filtered, limit, v]);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Activity</h1>
        <div className="row gap-s">
          <button className="btn small" onClick={refresh} disabled={refreshing} aria-label="Refresh">{refreshing ? '…' : '↻'}</button>
          <button className="btn small" onClick={() => setSheet({ type: 'import' })}>Import</button>
          <button className="btn small primary" onClick={() => setSheet({ type: 'add' })}>+ Add</button>
        </div>
      </header>
      <div className="filters">
        <input className="input" type="search" placeholder="Search merchant, note or amount" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="row gap">
          <select className="input" value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">All accounts</option>
            {v.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {v.categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </div>
      </div>
      {groups.length === 0 && <Empty>{v.transactions.length ? 'Nothing matches.' : 'No transactions yet — import a CSV or add one.'}</Empty>}
      {groups.map((g) => (
        <section key={g.date} className="day-group">
          <div className="day-head">
            <span>{dayLabel(g.date)}</span>
            <span className="muted small">{g.spent > 0.004 ? `${p(g.spent)} spent` : ''}</span>
          </div>
          <div className="card flush">{g.items.map((t) => <TxRow key={t.id} t={t} />)}</div>
        </section>
      ))}
      {filtered.length > limit && (
        <button className="btn wide" onClick={() => setLimit(limit + PAGE)}>Show more ({filtered.length - limit} left)</button>
      )}
    </div>
  );
}
