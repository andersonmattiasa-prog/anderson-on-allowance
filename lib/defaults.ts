import type { Account, Bill, Category, Goal, Holding, NotifyPrefs, Position, Settings, Vault } from './types';
import { todayStr } from './util';

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'rent', name: 'Rent', icon: '🏠', kind: 'fixed' },
  { id: 'groceries', name: 'Groceries', icon: '🛒', kind: 'spend', limit: 150 },
  { id: 'eating-out', name: 'Eating out', icon: '🍽️', kind: 'spend', limit: 40, watch: true },
  { id: 'cafes', name: 'Cafés & bakeries', icon: '☕', kind: 'spend', limit: 30, watch: true },
  { id: 'takeaway', name: 'Takeaway & fast food', icon: '🍔', kind: 'spend', limit: 25, watch: true },
  { id: 'transport', name: 'Transport', icon: '🚇', kind: 'spend', limit: 35 },
  { id: 'shopping', name: 'Shopping', icon: '🛍️', kind: 'spend', limit: 30, watch: true },
  { id: 'entertainment', name: 'Going out & fun', icon: '🎟️', kind: 'spend', limit: 30 },
  { id: 'travel', name: 'Travel', icon: '✈️', kind: 'spend', limit: 30 },
  { id: 'health', name: 'Health & fitness', icon: '💊', kind: 'spend', limit: 20 },
  { id: 'personal', name: 'Personal care', icon: '🧴', kind: 'spend', limit: 15 },
  { id: 'gifts', name: 'Gifts', icon: '🎁', kind: 'spend', limit: 10 },
  { id: 'other', name: 'Other', icon: '📦', kind: 'spend', limit: 10 },
  { id: 'subscriptions', name: 'Subscriptions', icon: '🔁', kind: 'fixed', limit: 20 },
  { id: 'phone', name: 'Phone & internet', icon: '📱', kind: 'fixed', limit: 15 },
  { id: 'income', name: 'Income', icon: '💶', kind: 'income' },
  { id: 'invest', name: 'Investing', icon: '📈', kind: 'invest' },
  { id: 'transfer', name: 'Transfers & card payments', icon: '🔄', kind: 'transfer' },
];

export const DEFAULT_ACCOUNTS: Account[] = [
  { id: 'wise', name: 'Wise', type: 'bank', currency: 'EUR', match: ['wise', 'transferwise'] },
  { id: 'scotia-visa', name: 'Scotiabank Passport Visa', type: 'credit', currency: 'CAD', dueDay: 12, match: ['scotia', 'scotiabank', 'passport'] },
  { id: 'coast-mc', name: 'Coast Capital Mastercard', type: 'credit', currency: 'CAD', dueDay: 3, autopay: true, match: ['coast', 'mastercard', 'cardwise', 'collabria'] },
  { id: 'coast-bank', name: 'Coast Capital chequing', type: 'bank', currency: 'CAD', match: ['chequing'] },
  { id: 'cash', name: 'Cash', type: 'cash', currency: 'EUR', match: [] },
  { id: 'wealthsimple', name: 'Wealthsimple TFSA', type: 'investment', currency: 'CAD', match: ['wealthsimple'] },
  { id: 'odlum', name: 'Odlum Brown', type: 'investment', currency: 'CAD', match: ['odlum'] },
];

export const DEFAULT_BILLS: Bill[] = [
  { id: 'rent', name: 'Cohabs rent', amount: 790, currency: 'EUR', day: 1, category: 'rent', account: 'wise' },
];

export const DEFAULT_SETTINGS: Settings = {
  primary: 'EUR',
  secondary: 'CAD',
  income: 1468,
  investPercent: 15,
  assumedReturn: 5,
  homePlaces: ['brussels', 'bruxelles', 'brussel', 'ixelles', 'elsene', 'etterbeek', 'saint gilles', 'schaerbeek', 'uccle', 'woluwe'],
};

export const DEFAULT_POSITIONS: Position[] = ['BEPC.TO', 'BMO.TO', 'CVE.TO', 'CVX', 'FLNC', 'FTS.TO', 'NTR.TO', 'GM'].map((ticker) => ({
  id: ticker,
  ticker,
  units: 0,
  account: 'odlum',
}));

export const DEFAULT_HOLDINGS: Holding[] = [
  { id: 'odlum-cash', name: 'Odlum Brown cash', account: 'odlum', kind: 'cash', currency: 'CAD', values: [] },
  { id: 'rbf554', name: 'RBF554 fund', account: 'odlum', kind: 'fund', currency: 'CAD', values: [] },
  { id: 'ws-tfsa', name: 'Wealthsimple TFSA (managed)', account: 'wealthsimple', kind: 'managed', currency: 'CAD', values: [] },
];

export const DEFAULT_GOALS: Goal[] = [
  { id: 'home', name: 'Home down payment', icon: '🏡', target: 138000, source: 'investments' },
];

export const DEFAULT_AIMS = [
  'Know how much I spend each month and where it goes',
  'Find what to cut back on and follow my budget',
  'Invest part of every paycheck (15%)',
  'Stay in the green every day',
  'Save for a home down payment',
];

export const DEFAULT_NOTIFY: NotifyPrefs = { cardDue: true, allowance: true, monday: true, sunday: true, review: true, challenge: true };

export function defaultVault(privateKeyJwk: JsonWebKey | null): Vault {
  const now = Date.now();
  return {
    v: 1,
    settings: { ...DEFAULT_SETTINGS },
    accounts: DEFAULT_ACCOUNTS.map((a) => ({ ...a, match: [...a.match] })),
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    rules: [],
    bills: DEFAULT_BILLS.map((b) => ({ ...b })),
    transactions: [],
    importMappings: [],
    fx: { rate: 1.57, date: '2000-01-01' },
    privateKeyJwk,
    trips: [],
    positions: DEFAULT_POSITIONS.map((p) => ({ ...p })),
    holdings: DEFAULT_HOLDINGS.map((h) => ({ ...h, values: [] })),
    quotes: {},
    balances: {},
    goals: DEFAULT_GOALS.map((g) => ({ ...g })),
    aims: [...DEFAULT_AIMS],
    reviews: [],
    challenges: [],
    investLog: [],
    notify: { ...DEFAULT_NOTIFY },
    deleted: [],
    seenInbox: [],
    createdAt: now,
    updatedAt: now,
  };
}

const CORE_CATEGORIES = ['income', 'invest', 'transfer', 'other'];

/** Fill in anything missing from older vaults. */
export function normalize(raw: Partial<Vault> | null | undefined): Vault {
  const d = defaultVault(raw?.privateKeyJwk ?? null);
  const v: Vault = { ...d, ...(raw || {}) } as Vault;
  v.settings = { ...d.settings, ...(raw?.settings || {}) };
  for (const k of ['accounts', 'categories', 'rules', 'bills', 'transactions', 'importMappings', 'deleted', 'seenInbox', 'trips', 'positions', 'holdings', 'goals', 'reviews', 'challenges', 'investLog'] as const) {
    if (!Array.isArray(v[k])) (v as unknown as Record<string, unknown>)[k] = (d as unknown as Record<string, unknown>)[k];
  }
  for (const id of CORE_CATEGORIES) {
    if (!v.categories.some((c) => c.id === id)) v.categories.push({ ...DEFAULT_CATEGORIES.find((c) => c.id === id)! });
  }
  if (!v.accounts.some((a) => a.id === 'cash')) v.accounts.push({ ...DEFAULT_ACCOUNTS.find((a) => a.id === 'cash')! });
  if (!v.quotes || typeof v.quotes !== 'object') v.quotes = {};
  if (!v.balances || typeof v.balances !== 'object') v.balances = {};
  v.notify = { ...DEFAULT_NOTIFY, ...(raw?.notify || {}) };
  if (!Array.isArray(v.aims)) {
    // One-time update: written goals replace the old "Next trip" and "Emergency fund" targets.
    v.aims = [...DEFAULT_AIMS];
    v.goals = v.goals.filter((g) => !(g.id === 'trip' || g.id === 'emergency'));
  }
  if (!v.fx || !v.fx.rate) v.fx = { rate: 1.57, date: '2000-01-01' };
  return v;
}

export const isFxStale = (v: Vault) => v.fx.date < todayStr();
