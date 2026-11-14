'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MetaInfo, SealedItem, Vault } from '@/lib/types';
import { api, ApiError } from '@/lib/api';
import { decryptVault, encryptVault, openSealed } from '@/lib/crypto';
import { cacheVault, clearSession, loadCachedVault, loadSession, saveSession, type Session } from '@/lib/idb';
import { isFxStale, normalize } from '@/lib/defaults';
import { mergeVaults } from '@/lib/merge';
import { applyInboxItem } from '@/lib/ingest';
import { postBills } from '@/lib/calc';
import { todayStr } from '@/lib/util';
import { StoreCtx, type SheetState, type StoreValue, type SyncState, type Tab } from './store';
import Splash from './Splash';
import { Setup, Unlock } from './Lock';
import Home from './Home';
import Activity from './Activity';
import Budget from './Budget';
import Settings from './Settings';
import TxSheet from './TxSheet';
import ImportSheet from './ImportSheet';

type Phase = 'boot' | 'setup' | 'locked' | 'ready' | 'error';

export default function App() {
  const [phase, setPhase] = useState<Phase>('boot');
  const [splashDone, setSplashDone] = useState(false);
  const [meta, setMeta] = useState<MetaInfo | null>(null);
  const [vault, setVault] = useState<Vault | null>(null);
  const [tab, setTabState] = useState<Tab>('home');
  const [sheet, setSheet] = useState<SheetState>(null);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [remembered, setRememberedState] = useState(false);
  const [bootError, setBootError] = useState('');
  const [toastMsg, setToastMsg] = useState('');

  const vaultRef = useRef<Vault | null>(null);
  const versionRef = useRef(0);
  const sessionRef = useRef<Session | null>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 2800);
  }, []);

  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    window.scrollTo({ top: 0 });
  }, []);

  // ---------- saving ----------

  const flush = useCallback(async (): Promise<void> => {
    if (savingRef.current) await savingRef.current;
    const s = sessionRef.current;
    if (!s || !dirtyRef.current) return;
    const run = (async () => {
      try {
        for (let attempt = 0; attempt < 5 && dirtyRef.current; attempt++) {
          dirtyRef.current = false;
          setSyncState('saving');
          const ct = await encryptVault(s.key, vaultRef.current!);
          const r = await fetch('/api/vault', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` },
            body: JSON.stringify({ version: versionRef.current, ct }),
          });
          if (r.ok) {
            versionRef.current = (await r.json()).version;
            cacheVault({ version: versionRef.current, ct });
            continue;
          }
          if (r.status === 409) {
            // Another device saved first: pull its version and merge both sides.
            const remote = await api<{ version: number; ct: string }>('/api/vault', { token: s.token });
            const merged = mergeVaults(vaultRef.current!, normalize(await decryptVault(s.key, remote.ct)));
            vaultRef.current = merged;
            setVault(merged);
            versionRef.current = remote.version;
            dirtyRef.current = true;
            continue;
          }
          dirtyRef.current = true;
          throw new ApiError(r.status, `Save failed (${r.status})`);
        }
        setSyncState(dirtyRef.current ? 'error' : 'idle');
      } catch (e) {
        dirtyRef.current = true;
        setSyncState(navigator.onLine ? 'error' : 'offline');
        console.error(e);
      }
    })();
    savingRef.current = run;
    await run;
    savingRef.current = null;
  }, []);

  const update = useCallback(
    (fn: (v: Vault) => void) => {
      if (!vaultRef.current) return;
      const next = structuredClone(vaultRef.current);
      fn(next);
      next.updatedAt = Date.now();
      vaultRef.current = next;
      setVault(next);
      dirtyRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), 700);
    },
    [flush],
  );

  // ---------- loading / syncing ----------

  const processInbox = useCallback(async () => {
    const s = sessionRef.current;
    const v = vaultRef.current;
    if (!s || !v?.privateKeyJwk) return;
    const { items } = await api<{ items: SealedItem[] }>('/api/inbox', { token: s.token });
    if (!items.length) return;
    const opened: { item: SealedItem; payload: unknown }[] = [];
    for (const item of items) {
      try {
        opened.push({ item, payload: await openSealed(v.privateKeyJwk, item) });
      } catch {
        opened.push({ item, payload: null }); // can never be opened; drop it
      }
    }
    const before = v.transactions.length;
    update((d) => {
      for (const { item, payload } of opened) if (payload) applyInboxItem(d, item.source, payload, item.at, item.id);
    });
    await flush();
    if (!dirtyRef.current) {
      await api('/api/inbox', { method: 'DELETE', token: s.token, body: { ids: items.map((i) => i.id) } });
      const added = (vaultRef.current?.transactions.length || 0) - before;
      if (added > 0) toast(`${added} new purchase${added > 1 ? 's' : ''} synced`);
    }
  }, [flush, update, toast]);

  const refreshFx = useCallback(async () => {
    const v = vaultRef.current;
    if (!v || !isFxStale(v)) return;
    try {
      const r = await fetch('https://api.frankfurter.dev/v1/latest?base=EUR&symbols=CAD');
      const j = await r.json();
      const rate = Number(j?.rates?.CAD);
      if (rate > 0) update((d) => void (d.fx = { rate, date: todayStr() }));
    } catch {}
  }, [update]);

  const housekeeping = useCallback(async () => {
    const v = vaultRef.current;
    if (!v) return;
    const draft = structuredClone(v);
    if (postBills(draft) > 0) update((d) => void postBills(d));
    await Promise.allSettled([refreshFx(), processInbox()]);
  }, [processInbox, refreshFx, update]);

  /** Pull the latest version from the server (another device may have saved). */
  const pull = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || dirtyRef.current || savingRef.current) return;
    try {
      const remote = await api<{ version: number; ct: string }>('/api/vault', { token: s.token });
      if (remote.version !== versionRef.current && remote.ct && !dirtyRef.current) {
        const v = normalize(await decryptVault(s.key, remote.ct));
        vaultRef.current = v;
        versionRef.current = remote.version;
        setVault(v);
        cacheVault(remote);
      }
      setSyncState('idle');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return lockRef.current(true);
      setSyncState('offline');
    }
  }, []);

  const syncNow = useCallback(async () => {
    await flush();
    await pull();
    await housekeeping();
  }, [flush, pull, housekeeping]);

  const openVault = useCallback(
    async (session: Session, remote?: { version: number; ct: string }) => {
      const res = remote ?? (await api<{ version: number; ct: string }>('/api/vault', { token: session.token }));
      const v = normalize(await decryptVault(session.key, res.ct));
      sessionRef.current = session;
      versionRef.current = res.version;
      vaultRef.current = v;
      dirtyRef.current = false;
      setVault(v);
      setPhase('ready');
      cacheVault(res);
      void housekeeping();
    },
    [housekeeping],
  );

  const lock = useCallback((forget = false) => {
    void flush().finally(() => {
      sessionRef.current = null;
      vaultRef.current = null;
      setVault(null);
      setSheet(null);
      setTabState('home');
      if (forget) {
        void clearSession();
        setRememberedState(false);
      }
      setPhase('locked');
    });
  }, [flush]);
  const lockRef = useRef(lock);
  lockRef.current = lock;

  const setRemembered = useCallback(async (on: boolean) => {
    if (on && sessionRef.current) await saveSession(sessionRef.current);
    else await clearSession();
    setRememberedState(on);
  }, []);

  // ---------- boot ----------

  useEffect(() => {
    const t = setTimeout(() => setSplashDone(true), 1700);
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    (async () => {
      const session = await loadSession();
      try {
        const m = await api<MetaInfo>('/api/meta');
        setMeta(m);
        if (!m.initialized) return setPhase('setup');
        if (session) {
          try {
            await openVault(session);
            setRememberedState(true);
            return;
          } catch (e) {
            if (e instanceof ApiError && e.status === 401) await clearSession();
          }
        }
        setPhase('locked');
      } catch {
        // Offline: open the last saved copy read-only if this device is remembered.
        const cached = await loadCachedVault();
        if (session && cached) {
          try {
            await openVault(session, cached);
            setRememberedState(true);
            setSyncState('offline');
            return;
          } catch {}
        }
        setBootError('Can’t reach the server. Check your connection and try again.');
        setPhase('error');
      }
    })();
    return () => clearTimeout(t);
  }, [openVault]);

  // Pull + sync when the app comes back to the foreground, and every minute while open.
  useEffect(() => {
    if (phase !== 'ready') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void flush().then(pull).then(housekeeping);
      else void flush();
    };
    const onOnline = () => void syncNow();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    const iv = setInterval(() => document.visibilityState === 'visible' && void processInbox().catch(() => {}), 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      clearInterval(iv);
    };
  }, [phase, flush, pull, housekeeping, processInbox, syncNow]);

  const value = useMemo<StoreValue | null>(
    () =>
      vault && sessionRef.current
        ? {
            vault,
            update,
            token: sessionRef.current.token,
            syncState,
            storage: meta?.storage ?? 'redis',
            setTab,
            setSheet,
            lock,
            syncNow,
            remembered,
            setRemembered,
            toast,
          }
        : null,
    [vault, update, syncState, meta, setTab, lock, syncNow, remembered, setRemembered, toast],
  );

  const showSplash = !splashDone || phase === 'boot';

  return (
    <>
      {showSplash && <Splash />}
      {!showSplash && phase === 'error' && (
        <div className="lock">
          <div className="lock-card">
            <h1>Offline</h1>
            <p className="muted">{bootError}</p>
            <button className="btn primary" onClick={() => location.reload()}>Try again</button>
          </div>
        </div>
      )}
      {!showSplash && phase === 'setup' && meta && (
        <Setup meta={meta} onDone={async (session, remember) => {
          if (remember) await saveSession(session);
          setRememberedState(remember);
          await openVault(session);
        }} />
      )}
      {!showSplash && phase === 'locked' && meta?.salt && (
        <Unlock salt={meta.salt} onUnlock={async (session, remember) => {
          await openVault(session);
          if (remember) await saveSession(session);
          setRememberedState(remember);
        }} />
      )}
      {phase === 'ready' && value && (
        <StoreCtx.Provider value={value}>
          <div className={`shell ${showSplash ? 'hidden' : ''}`}>
            <main className="main">
              {tab === 'home' && <Home />}
              {tab === 'activity' && <Activity />}
              {tab === 'budget' && <Budget />}
              {tab === 'settings' && <Settings />}
            </main>
            <nav className="tabbar">
              {([
                ['home', 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z', 'Home'],
                ['activity', 'M4 6h16M4 12h16M4 18h10', 'Activity'],
                ['budget', 'M12 3a9 9 0 1 0 9 9h-9zM15 3.5A9 9 0 0 1 20.5 9H15z', 'Budget'],
                ['settings', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L15 3.5h-4L10.6 6a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.4z', 'Settings'],
              ] as const).map(([id, d, label]) => (
                <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
                  <svg className="ti" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
                  <span>{label}</span>
                </button>
              ))}
            </nav>
            {sheet?.type === 'tx' && <TxSheet id={sheet.id} onClose={() => setSheet(null)} />}
            {sheet?.type === 'add' && <TxSheet onClose={() => setSheet(null)} />}
            {sheet?.type === 'import' && <ImportSheet onClose={() => setSheet(null)} />}
            {syncState !== 'idle' && (
              <div className={`sync-pill ${syncState}`}>
                {syncState === 'saving' ? 'Saving…' : syncState === 'offline' ? 'Offline — changes will sync' : 'Not saved — tap to retry'}
                {syncState === 'error' && <button onClick={() => void syncNow()} aria-label="Retry" />}
              </div>
            )}
            {toastMsg && <div className="toast">{toastMsg}</div>}
          </div>
        </StoreCtx.Provider>
      )}
    </>
  );
}
