'use client';
import { useEffect, useState } from 'react';
import { useStore } from './store';
import { api } from '@/lib/api';
import { randomToken, sha256Hex } from '@/lib/crypto';
import { exportCSV } from '@/lib/csv';
import { download, todayStr } from '@/lib/util';
import { idbGet } from '@/lib/idb';
import { GMAIL_SCRIPT } from '@/lib/gmail-script';
import { currentSubscription, disablePush, enablePush, pushSupported } from '@/lib/pushClient';
import type { NotifyPrefs } from '@/lib/types';

const NOTIFY_LABELS: [keyof NotifyPrefs, string][] = [
  ['cardDue', 'Card payment due (3 days, 1 day, on the day — skipped for autopay)'],
  ['allowance', 'Allowance at 80% and 100%, right after an Apple Pay purchase'],
  ['monday', 'Monday: this week’s allowance'],
  ['sunday', 'Sunday: week recap'],
  ['review', 'Monthly review reminder (1st–3rd)'],
  ['challenge', 'Challenge start and last day'],
];

function Notifications() {
  const { vault: v, update, token, toast } = useStore();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    currentSubscription().then((s) => setOn(!!s)).catch(() => setOn(false));
  }, []);
  async function toggle() {
    setBusy(true);
    try {
      if (on) {
        await disablePush(token);
        setOn(false);
      } else {
        const err = await enablePush(token);
        if (err) toast(err);
        else setOn(true);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Couldn’t change notifications');
    }
    setBusy(false);
  }
  return (
    <section className="card">
      <h3>Notifications</h3>
      {!pushSupported() ? (
        <p className="muted small">Open Allowance from your Home Screen icon to turn on notifications (iPhone needs the installed app).</p>
      ) : (
        <div className="form">
          <button className={`btn wide ${on ? '' : 'primary'}`} disabled={busy || on === null} onClick={toggle}>
            {on ? 'Turn off on this device' : 'Turn on notifications'}
          </button>
          {on && <button className="btn wide" onClick={() => api('/api/push/test', { method: 'POST', token }).then(() => toast('Test sent')).catch((e) => toast(e.message))}>Send a test</button>}
        </div>
      )}
      <div className="form" style={{ marginTop: 10 }}>
        {NOTIFY_LABELS.map(([k, label]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={v.notify[k]} onChange={(e) => update((d) => void (d.notify[k] = e.target.checked))} /> {label}
          </label>
        ))}
        <p className="muted small">To send reminders while your data stays encrypted, the server keeps only: your weekly allowance and this week’s total, card due days, the active challenge’s name and which month needs a review.</p>
      </div>
    </section>
  );
}

function NumberField({ label, value, onSave, suffix, placeholder }: { label: string; value?: number; onSave: (n: number | undefined) => void; suffix?: string; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="row gap-s">
        <input
          className="input"
          inputMode="decimal"
          defaultValue={value ?? ''}
          placeholder={placeholder}
          onBlur={(e) => {
            const raw = e.target.value.trim().replace(',', '.');
            onSave(raw === '' ? undefined : Number(raw));
          }}
        />
        {suffix && <span className="muted">{suffix}</span>}
      </span>
    </label>
  );
}

function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn small"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

export default function Settings() {
  const { vault: v, update, token, lock, remembered, setRemembered, toast, syncNow, storage, setTab } = useStore();
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(location.origin), []);
  const s = v.settings;

  async function newSyncKey() {
    if (v.ingestToken && !confirm('Make a new sync key? The Apple Pay shortcut and Gmail script will need the new one.')) return;
    const key = randomToken();
    await api('/api/ingest-token', { method: 'PUT', token, body: { hash: await sha256Hex(key) } });
    update((d) => void (d.ingestToken = key));
    toast('New sync key saved');
  }

  async function backup() {
    await syncNow();
    const cached = await idbGet<{ version: number; ct: string }>('vaultCache');
    if (!cached) return toast('Nothing to back up yet');
    download(`allowance-backup-${todayStr()}.vault`, JSON.stringify({ app: 'anderson-on-allowance', ...cached }), 'application/json');
  }

  const syncUrl = (src: string) => `${origin}/api/ingest/${src}`;
  const script = v.ingestToken ? GMAIL_SCRIPT.replace('__ENDPOINT__', syncUrl('email')).replace('__SYNC_KEY__', v.ingestToken) : '';

  return (
    <div className="page">
      <header className="page-head"><h1>Settings</h1><button className="link" onClick={() => setTab('home')}>Done</button></header>

      <section className="card">
        <h3>Your plan</h3>
        <div className="form">
          <NumberField label={`Monthly pay (${s.primary})`} value={s.income} onSave={(n) => n && update((d) => void (d.settings.income = n))} />
          <NumberField label="Invest from each paycheck" value={s.investPercent} suffix="%" onSave={(n) => n != null && update((d) => void (d.settings.investPercent = Math.min(90, Math.max(0, n))))} />
          <NumberField label="Assumed yearly investment return" value={s.assumedReturn} suffix="%" onSave={(n) => n != null && update((d) => void (d.settings.assumedReturn = Math.min(20, Math.max(0, n))))} />
          <NumberField label="Weekly allowance (leave empty to calculate)" value={s.weeklyAllowance} placeholder="Automatic" onSave={(n) => update((d) => void (d.settings.weeklyAllowance = n && n > 0 ? n : undefined))} />
          <label className="field">
            <span>Home places (words that mean “not a trip”)</span>
            <input className="input" defaultValue={s.homePlaces.join(', ')} onBlur={(e) => update((d) => void (d.settings.homePlaces = e.target.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)))} />
          </label>
          <p className="muted small">Exchange rate: €1 = CA${v.fx.rate.toFixed(4)} ({v.fx.date === '2000-01-01' ? 'default' : v.fx.date}).</p>
        </div>
      </section>

      <section className="card">
        <h3>Accounts</h3>
        <p className="muted small">Match words link Apple Pay card names, bank emails and CSV file names to the right account.</p>
        {v.accounts.map((a) => (
          <details key={a.id} className="acct">
            <summary>
              <span>{a.name}</span>
              <span className="muted small">{a.type} · {a.currency}{a.dueDay ? ` · due ${a.dueDay}` : ''}{a.autopay ? ' · autopay' : ''}</span>
            </summary>
            <div className="form">
              <label className="field"><span>Name</span>
                <input className="input" defaultValue={a.name} onBlur={(e) => update((d) => void (d.accounts.find((x) => x.id === a.id)!.name = e.target.value || a.name))} />
              </label>
              <label className="field"><span>Match words (comma-separated)</span>
                <input className="input" defaultValue={a.match.join(', ')} onBlur={(e) => update((d) => void (d.accounts.find((x) => x.id === a.id)!.match = e.target.value.split(',').map((x) => x.trim()).filter(Boolean)))} />
              </label>
              {a.type === 'credit' && (
                <>
                  <NumberField label="Statement due day" value={a.dueDay} onSave={(n) => update((d) => void (d.accounts.find((x) => x.id === a.id)!.dueDay = n && n >= 1 && n <= 31 ? Math.round(n) : undefined))} />
                  <label className="check">
                    <input type="checkbox" defaultChecked={a.autopay} onChange={(e) => update((d) => void (d.accounts.find((x) => x.id === a.id)!.autopay = e.target.checked))} /> Autopay is on
                  </label>
                </>
              )}
            </div>
          </details>
        ))}
      </section>

      <section className="card">
        <h3>Automatic syncing</h3>
        <p className="muted small">
          Purchases sent here are sealed with your vault’s public key the moment they arrive. The sync key can only send — it can’t read anything.
        </p>
        {!v.ingestToken ? (
          <button className="btn primary wide" onClick={newSyncKey}>Create sync key</button>
        ) : (
          <>
            <label className="field">
              <span>Sync key</span>
              <span className="row gap-s">
                <input className="input mono" readOnly value={v.ingestToken} />
                <Copy text={v.ingestToken} />
              </span>
            </label>
            <details className="howto">
              <summary>📱 Apple Pay → instant purchases</summary>
              <ol className="small">
                <li>Open <b>Shortcuts</b> → <b>Automation</b> → <b>+</b> → <b>Transaction</b>. Pick your cards, choose <b>Run Immediately</b>.</li>
                <li>Add <b>Get Contents of URL</b>. URL: <code>{syncUrl('applepay')}</code> <Copy text={syncUrl('applepay')} label="Copy URL" /></li>
                <li>Method <b>POST</b>. Add header <code>Authorization</code> = <code>Bearer {v.ingestToken.slice(0, 6)}…</code> <Copy text={`Bearer ${v.ingestToken}`} label="Copy value" /></li>
                <li>Request Body <b>JSON</b> with fields: <code>merchant</code> = Shortcut Input › Merchant, <code>amount</code> = Shortcut Input › Amount, <code>card</code> = Shortcut Input › Card or Pass.</li>
              </ol>
            </details>
            <details className="howto">
              <summary>✉️ Bank alert emails → Gmail</summary>
              <ol className="small">
                <li>Go to <b>script.google.com</b> → New project. Name it “Allowance alerts”.</li>
                <li>Paste the script below (it already contains your URL and sync key) and save. <Copy text={script} label="Copy script" /></li>
                <li>Pick <code>install</code> in the function menu and press <b>Run</b>. Allow access to Gmail. It then checks every 5 minutes.</li>
                <li>In Scotiabank InfoAlerts and CardWise, send purchase alerts to this Gmail address with a $1 threshold.</li>
              </ol>
            </details>
            <details className="howto">
              <summary>🏦 Wise deposits (optional)</summary>
              <p className="small">In Wise → Settings → Developer tools → Webhooks, add <code>{syncUrl('wise')}?key=…</code> for “Balance deposit” events. <Copy text={`${syncUrl('wise')}?key=${v.ingestToken}`} label="Copy URL" /></p>
            </details>
            <button className="btn wide" onClick={newSyncKey}>Make a new sync key</button>
          </>
        )}
      </section>

      <Notifications />

      <section className="card">
        <h3>Learned rules</h3>
        {v.rules.length === 0 && <p className="muted small">When you change a category and tick “always”, the rule appears here.</p>}
        {v.rules.map((r) => (
          <div key={r.match} className="row between list-line">
            <span>{r.match} → {v.categories.find((c) => c.id === r.category)?.name ?? r.category}</span>
            <button className="link" onClick={() => update((d) => { d.rules = d.rules.filter((x) => x.match !== r.match); d.deleted.push(`rule:${r.match}`); })}>Remove</button>
          </div>
        ))}
      </section>

      <section className="card">
        <h3>Security &amp; data</h3>
        <div className="form">
          <label className="check">
            <input type="checkbox" checked={remembered} onChange={(e) => void setRemembered(e.target.checked)} /> Keep me unlocked on this device (30 days)
          </label>
          <button className="btn wide" onClick={backup}>Download encrypted backup</button>
          <button className="btn wide" onClick={() => download(`allowance-${todayStr()}.csv`, exportCSV(v), 'text/csv')}>Export transactions as CSV</button>
          <button className="btn wide" onClick={() => lock(false)}>Lock now</button>
          <button className="btn danger wide" onClick={() => lock(true)}>Lock and forget this device</button>
          <p className="muted small">
            {v.transactions.length} transactions · storage: {storage === 'redis' ? 'Upstash Redis (encrypted)' : 'local file (development)'}.
            There is no passphrase recovery — keep a backup somewhere safe.
          </p>
        </div>
      </section>
    </div>
  );
}
