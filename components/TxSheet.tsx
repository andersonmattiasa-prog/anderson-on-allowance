'use client';
import { useState } from 'react';
import type { Currency, Tx } from '@/lib/types';
import { useStore } from './store';
import { Sheet } from './ui';
import { categorize, learnRule, merchantKey } from '@/lib/categorize';
import { fmt, parseAmount, round2 } from '@/lib/money';
import { todayStr, uid } from '@/lib/util';

export default function TxSheet({ id, onClose }: { id?: string; onClose: () => void }) {
  const { vault: v, update, toast } = useStore();
  const existing = id ? v.transactions.find((t) => t.id === id) : undefined;
  const isNew = !existing;

  const [date, setDate] = useState(existing?.date ?? todayStr());
  const [merchant, setMerchant] = useState(existing?.merchant ?? '');
  const [amount, setAmount] = useState(existing ? String(Math.abs(existing.amount)) : '');
  const [isIncome, setIsIncome] = useState(existing ? existing.amount > 0 : false);
  const [currency, setCurrency] = useState<Currency>(existing?.currency ?? v.settings.primary);
  const [account, setAccount] = useState(existing?.account ?? 'cash');
  const [category, setCategory] = useState(existing?.category ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [applyAll, setApplyAll] = useState(true);

  if (id && !existing) {
    return <Sheet title="Transaction" onClose={onClose}><p className="muted">This transaction no longer exists.</p></Sheet>;
  }

  const sameMerchantCount = existing ? v.transactions.filter((t) => t.id !== existing.id && merchantKey(t.merchant) === merchantKey(existing.merchant)).length : 0;
  const catChanged = !!existing && category !== existing.category;

  function save() {
    const a = parseAmount(amount);
    if (!a || !a.amount) return toast('Enter an amount');
    if (!merchant.trim()) return toast('Enter where you spent it');
    const signed = round2(isIncome ? Math.abs(a.amount) : -Math.abs(a.amount));
    update((d) => {
      if (existing) {
        const t = d.transactions.find((x) => x.id === existing.id);
        if (!t) return;
        if (t.amount !== signed || t.currency !== currency) t.charged = t.charged && t.currency === currency ? t.charged : undefined;
        Object.assign(t, { date, merchant: merchant.trim(), amount: signed, currency, account, note: note.trim() || undefined, updatedAt: Date.now() });
        if (catChanged) {
          t.category = category;
          t.manualCat = true;
          if (applyAll) {
            const n = learnRule(d, t.merchant, category);
            if (n) toast(`Also updated ${n} other ${t.merchant} purchase${n > 1 ? 's' : ''}`);
          }
        }
      } else {
        const tx: Tx = {
          id: uid(),
          date,
          merchant: merchant.trim(),
          amount: signed,
          currency,
          account,
          category: category || categorize(d, merchant, '', signed),
          note: note.trim() || undefined,
          source: 'manual',
          manualCat: !!category,
          updatedAt: Date.now(),
        };
        d.transactions.push(tx);
      }
    });
    onClose();
  }

  function remove() {
    if (!existing || !confirm(`Delete ${existing.merchant}?`)) return;
    update((d) => {
      d.transactions = d.transactions.filter((t) => t.id !== existing.id);
      d.deleted.push(existing.id);
    });
    onClose();
  }

  return (
    <Sheet title={isNew ? 'Add a purchase' : 'Edit transaction'} onClose={onClose}>
      <div className="form">
        <div className="seg">
          <button className={!isIncome ? 'on' : ''} onClick={() => setIsIncome(false)}>Spent</button>
          <button className={isIncome ? 'on' : ''} onClick={() => setIsIncome(true)}>Received</button>
        </div>
        <div className="row gap">
          <label className="field grow">
            <span>Amount</span>
            <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus={isNew} />
          </label>
          <label className="field">
            <span>Currency</span>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              <option>EUR</option>
              <option>CAD</option>
            </select>
          </label>
        </div>
        {existing?.charged && (
          <p className="muted small">Card charged {fmt(existing.charged.amount, existing.charged.currency)}.</p>
        )}
        <label className="field">
          <span>Where</span>
          <input className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="e.g. Delhaize" />
        </label>
        <div className="row gap">
          <label className="field grow">
            <span>Date</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field grow">
            <span>Account</span>
            <select className="input" value={account} onChange={(e) => setAccount(e.target.value)}>
              {v.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Category</span>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {isNew && <option value="">Automatic</option>}
            {v.categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </label>
        {catChanged && (
          <label className="check">
            <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
            Always use this category for {existing!.merchant}{sameMerchantCount ? ` (${sameMerchantCount} other purchase${sameMerchantCount > 1 ? 's' : ''})` : ''}
          </label>
        )}
        <label className="field">
          <span>Note</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </label>
        {existing && (
          <p className="muted small">
            Source: {existing.source === 'applepay' ? 'Apple Pay' : existing.source === 'email' ? 'bank alert' : existing.source}
            {existing.alerted && existing.applePay ? ' + bank alert' : ''}
            {existing.description ? ` · ${existing.description}` : ''}
          </p>
        )}
        <button className="btn primary wide" onClick={save}>{isNew ? 'Add' : 'Save'}</button>
        {existing && <button className="btn danger wide" onClick={remove}>Delete</button>}
      </div>
    </Sheet>
  );
}
