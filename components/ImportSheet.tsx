'use client';
import { useMemo, useState } from 'react';
import type { DateOrder, ImportMapping } from '@/lib/types';
import { useStore } from './store';
import { Sheet } from './ui';
import { accountFromFilename, guessMapping, headerKey, importRows, parseCSV, rowToTx } from '@/lib/csv';
import { fmt } from '@/lib/money';

interface Loaded {
  name: string;
  rows: string[][];
}

export default function ImportSheet({ onClose }: { onClose: () => void }) {
  const { vault: v, update, toast } = useStore();
  const [file, setFile] = useState<Loaded | null>(null);
  const [account, setAccount] = useState('');
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [result, setResult] = useState<string>('');

  async function onFile(f: File) {
    const text = await f.text();
    const rows = parseCSV(text);
    if (rows.length < 2) return toast('That file doesn’t look like a CSV with transactions.');
    const acct = accountFromFilename(v, f.name) ?? '';
    const saved = v.importMappings.find((m) => m.key === headerKey(rows) || m.key === `cols:${rows[0].length}`);
    setFile({ name: f.name, rows });
    setAccount(acct);
    setMapping(saved ?? guessMapping(rows, v.accounts.find((a) => a.id === acct)));
    setResult('');
  }

  const acct = v.accounts.find((a) => a.id === account);
  const parsed = useMemo(() => {
    if (!file || !mapping || !acct) return [];
    return file.rows.slice(mapping.hasHeader ? 1 : 0).map((r) => rowToTx(r, mapping, acct));
  }, [file, mapping, acct]);
  const good = parsed.filter((r): r is NonNullable<typeof r> => !!r);

  function doImport() {
    if (!acct || !mapping) return;
    let res = { added: 0, dupes: 0, matched: 0 };
    update((d) => {
      res = importRows(d, good, acct.id);
      d.importMappings = [mapping, ...d.importMappings.filter((m) => m.key !== mapping.key)].slice(0, 20);
    });
    setResult(`Added ${res.added}. ${res.matched ? `Matched ${res.matched} already-synced purchase${res.matched > 1 ? 's' : ''}. ` : ''}${res.dupes ? `Skipped ${res.dupes} already imported.` : ''}`);
    setFile(null);
  }

  const cols = file?.rows[0] ?? [];
  const colOptions = [
    <option key={-1} value={-1}>—</option>,
    ...cols.map((c, i) => <option key={i} value={i}>{mapping?.hasHeader ? c : `Column ${i + 1} (${c.slice(0, 18)})`}</option>),
  ];
  const sel = (key: keyof ImportMapping, label: string) =>
    mapping && (
      <label className="field">
        <span>{label}</span>
        <select className="input" value={mapping[key] as number} onChange={(e) => setMapping({ ...mapping, [key]: Number(e.target.value) })}>
          {colOptions}
        </select>
      </label>
    );

  return (
    <Sheet title="Import a CSV" onClose={onClose}>
      <div className="form">
        {result && <div className="card good-bg">{result}</div>}
        {!file && (
          <>
            <p className="muted small">
              Download a CSV from Wise, Scotiabank or Coast Capital and pick it here. Purchases already synced from Apple Pay or bank
              alerts are matched, not doubled, and re-importing the same file is safe.
            </p>
            <label className="btn primary wide file-btn">
              Choose CSV file
              <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} hidden />
            </label>
          </>
        )}
        {file && mapping && (
          <>
            <p className="small"><strong>{file.name}</strong> · {file.rows.length - (mapping.hasHeader ? 1 : 0)} rows</p>
            <label className="field">
              <span>Account</span>
              <select className="input" value={account} onChange={(e) => setAccount(e.target.value)}>
                <option value="">Choose…</option>
                {v.accounts.filter((a) => a.type !== 'investment').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <details className="mapping">
              <summary>Columns {good.length ? '' : '— check these'}</summary>
              <label className="check">
                <input type="checkbox" checked={mapping.hasHeader} onChange={(e) => setMapping({ ...mapping, hasHeader: e.target.checked })} /> First row is a header
              </label>
              {sel('date', 'Date')}
              <label className="field">
                <span>Date format</span>
                <select className="input" value={mapping.dateOrder} onChange={(e) => setMapping({ ...mapping, dateOrder: e.target.value as DateOrder })}>
                  <option value="YMD">Year-Month-Day</option>
                  <option value="DMY">Day/Month/Year</option>
                  <option value="MDY">Month/Day/Year</option>
                </select>
              </label>
              {sel('amount', 'Amount (signed)')}
              {sel('debit', 'Or: money out column')}
              {sel('credit', 'Or: money in column')}
              {sel('type', 'Debit/credit type column')}
              {sel('merchant', 'Merchant')}
              {sel('description', 'Description')}
              {sel('currency', 'Currency')}
              <label className="check">
                <input type="checkbox" checked={mapping.invert} onChange={(e) => setMapping({ ...mapping, invert: e.target.checked })} /> Purchases are positive numbers (flip signs)
              </label>
            </details>
            {acct && (
              <div className="preview">
                <p className="eyebrow">Preview</p>
                {good.slice(0, 6).map((r, i) => (
                  <div key={i} className="row between list-line small">
                    <span>{r.date} · {r.merchant}</span>
                    <span className={r.amount > 0 ? 'pos' : ''}>{fmt(r.amount, r.currency, { sign: true })}</span>
                  </div>
                ))}
                {parsed.length - good.length > 0 && <p className="muted small">{parsed.length - good.length} rows couldn’t be read and will be skipped.</p>}
              </div>
            )}
            <button className="btn primary wide" disabled={!acct || !good.length} onClick={doImport}>
              {acct ? `Import ${good.length} rows` : 'Choose the account first'}
            </button>
            <button className="btn wide" onClick={() => setFile(null)}>Choose a different file</button>
          </>
        )}
      </div>
    </Sheet>
  );
}
