'use client';
import { useEffect } from 'react';
import type { Tx } from '@/lib/types';
import { useMoney, useStore } from './store';
import { inPrimary } from '@/lib/calc';
import { fmt } from '@/lib/money';

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('noscroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('noscroll');
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Progress({ value, max, tone }: { value: number; max: number; tone?: 'good' | 'warn' | 'bad' }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const t = tone ?? (value > max ? 'bad' : value > max * 0.8 ? 'warn' : 'good');
  return (
    <div className="progress">
      <div className={`progress-fill ${t}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function TxRow({ t }: { t: Tx }) {
  const { vault: v, setSheet } = useStore();
  const { p } = useMoney();
  const cat = v.categories.find((c) => c.id === t.category);
  const acct = v.accounts.find((a) => a.id === t.account);
  const amt = inPrimary(v, t);
  const foreign = t.currency !== v.settings.primary;
  return (
    <button className="tx" onClick={() => setSheet({ type: 'tx', id: t.id })}>
      <span className="tx-icon">{cat?.icon ?? '•'}</span>
      <span className="tx-main">
        <span className="tx-merchant">{t.merchant}</span>
        <span className="tx-sub">
          {cat?.name ?? 'Uncategorised'} · {acct?.name ?? t.account}
          {t.note ? ` · ${t.note}` : ''}
        </span>
      </span>
      <span className="tx-amt">
        <span className={amt > 0 ? 'pos' : ''}>{amt > 0 ? p(amt, 2, true) : p(-amt)}</span>
        {(foreign || t.charged) && (
          <span className="tx-sub">
            {foreign ? fmt(Math.abs(t.amount), t.currency) : ''}
            {t.charged ? `${foreign ? ' · ' : ''}charged ${fmt(Math.abs(t.charged.amount), t.charged.currency)}` : ''}
          </span>
        )}
      </span>
    </button>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
