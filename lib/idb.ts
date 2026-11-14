// Small IndexedDB wrapper for "keep me unlocked" (a non-extractable key) and an offline copy of the encrypted vault.
const DB = 'allowance';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export const idbGet = <T>(k: string) => tx<T | undefined>('readonly', (s) => s.get(k));
export const idbSet = (k: string, v: unknown) => tx<void>('readwrite', (s) => s.put(v, k));
export const idbDel = (k: string) => tx<void>('readwrite', (s) => s.delete(k));

export interface Session {
  key: CryptoKey;
  token: string;
}

export async function saveSession(s: Session, days = 30) {
  await idbSet('session', { key: s.key, token: s.token, expires: Date.now() + days * 864e5 });
}
export async function loadSession(): Promise<Session | null> {
  try {
    const s = await idbGet<Session & { expires: number }>('session');
    if (!s || s.expires < Date.now()) return null;
    return { key: s.key, token: s.token };
  } catch {
    return null;
  }
}
export const clearSession = () => idbDel('session').catch(() => {});

export const cacheVault = (d: { version: number; ct: string }) => idbSet('vaultCache', d).catch(() => {});
export const loadCachedVault = () => idbGet<{ version: number; ct: string }>('vaultCache').catch(() => undefined);
