'use client';
import { createContext, useContext } from 'react';
import type { Vault } from '@/lib/types';
import { fmt } from '@/lib/money';
import { toSecondary } from '@/lib/calc';

export type Tab = 'home' | 'activity' | 'budget' | 'settings';
export type SheetState = { type: 'tx'; id: string } | { type: 'add' } | { type: 'import' } | null;
export type SyncState = 'idle' | 'saving' | 'offline' | 'error';

export interface StoreValue {
  vault: Vault;
  update: (fn: (v: Vault) => void) => void;
  token: string;
  syncState: SyncState;
  storage: 'redis' | 'local';
  setTab: (t: Tab) => void;
  setSheet: (s: SheetState) => void;
  lock: (forget?: boolean) => void;
  syncNow: () => Promise<void>;
  remembered: boolean;
  setRemembered: (on: boolean) => Promise<void>;
  toast: (msg: string) => void;
}

export const StoreCtx = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const s = useContext(StoreCtx);
  if (!s) throw new Error('Store missing');
  return s;
}

/** Format an amount already in the primary currency, with the secondary below. */
export function useMoney() {
  const { vault: v } = useStore();
  const p = (n: number, decimals = 2, sign = false) => fmt(n, v.settings.primary, { decimals, sign });
  const s = (n: number, decimals = 0) => fmt(toSecondary(v, n), v.settings.secondary, { decimals });
  return { p, s, primary: v.settings.primary, secondary: v.settings.secondary };
}
