'use client';
import { useRef, useState } from 'react';
import type { MetaInfo } from '@/lib/types';
import { api, ApiError } from '@/lib/api';
import { deriveKeys, encryptVault, generateInboxKeys, randomSalt } from '@/lib/crypto';
import { defaultVault } from '@/lib/defaults';
import type { Session } from '@/lib/idb';

export function Unlock({ salt, onUnlock }: { salt: string; onUnlock: (s: Session, remember: boolean) => Promise<void> }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Read straight from the form so password-manager autofill always works.
    const data = new FormData(formRef.current!);
    const pass = String(data.get('passphrase') || '');
    const remember = data.get('remember') === 'on';
    if (!pass) return setError('Enter your passphrase.');
    setBusy(true);
    setError('');
    try {
      const { key, token } = await deriveKeys(pass, salt);
      await onUnlock({ key, token }, remember);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'That passphrase didn’t work.' : 'Couldn’t unlock — check your connection.');
      setBusy(false);
    }
  }

  return (
    <div className="lock">
      <form className="lock-card" ref={formRef} onSubmit={submit}>
        <img className="lock-mark" src="/icons/mark.png" alt="" width={64} height={65} />
        <h1>Anderson on Allowance</h1>
        <p className="muted">Your data is encrypted on this device. Enter your passphrase to unlock.</p>
        <input type="text" name="username" autoComplete="username" value="Allowance" readOnly hidden />
        <input className="input" type="password" name="passphrase" autoComplete="current-password" placeholder="Passphrase" autoFocus />
        <label className="check">
          <input type="checkbox" name="remember" defaultChecked /> Keep me unlocked on this device for 30 days
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Unlocking…' : 'Unlock'}</button>
      </form>
    </div>
  );
}

export function Setup({ meta, onDone }: { meta: MetaInfo; onDone: (s: Session, remember: boolean) => Promise<void> }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const data = new FormData(formRef.current!);
    const pass = String(data.get('passphrase') || '');
    const confirm = String(data.get('confirm') || '');
    const income = Number(data.get('income'));
    if (pass.length < 12) return setError('Use at least 12 characters — a few random words works well.');
    if (pass !== confirm) return setError('The two passphrases don’t match.');
    if (!data.get('understand')) return setError('Please tick the box: there is no way to recover a lost passphrase.');
    setBusy(true);
    setError('');
    try {
      const salt = randomSalt();
      const [{ key, token }, inbox] = await Promise.all([deriveKeys(pass, salt), generateInboxKeys()]);
      const vault = defaultVault(inbox.privateJwk);
      if (income > 0) vault.settings.income = income;
      const ct = await encryptVault(key, vault);
      await api('/api/setup', { method: 'POST', token, body: { setupCode: data.get('setupCode') || '', salt, publicKey: inbox.publicJwk, ct } });
      await onDone({ key, token }, data.get('remember') === 'on');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
      setBusy(false);
    }
  }

  return (
    <div className="lock">
      <form className="lock-card" ref={formRef} onSubmit={submit}>
        <img className="lock-mark" src="/icons/mark.png" alt="" width={64} height={65} />
        <h1>Create your vault</h1>
        <p className="muted">
          Everything is encrypted in your browser with this passphrase before it’s saved. The server only stores scrambled data.
        </p>
        <input type="text" name="username" autoComplete="username" value="Allowance" readOnly hidden />
        <input className="input" type="password" name="passphrase" autoComplete="new-password" placeholder="New passphrase" />
        <input className="input" type="password" name="confirm" autoComplete="new-password" placeholder="Repeat passphrase" />
        <label className="field">
          <span>Monthly take-home pay (€)</span>
          <input className="input" name="income" type="number" inputMode="decimal" defaultValue={1468} />
        </label>
        {meta.setupCodeRequired && <input className="input" name="setupCode" placeholder="Setup code" autoComplete="off" />}
        <label className="check">
          <input type="checkbox" name="understand" /> I understand a forgotten passphrase means the data is gone for good.
        </label>
        <label className="check">
          <input type="checkbox" name="remember" defaultChecked /> Keep me unlocked on this device for 30 days
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create vault'}</button>
        {meta.storage === 'local' && <p className="muted small">Development mode: data is stored in a local file.</p>}
      </form>
    </div>
  );
}
