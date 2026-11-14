export type Currency = 'EUR' | 'CAD';
export type CatKind = 'spend' | 'fixed' | 'income' | 'transfer' | 'invest';
export type TxSource = 'csv' | 'applepay' | 'email' | 'wise' | 'manual' | 'bill';
export type DateOrder = 'YMD' | 'DMY' | 'MDY';

export interface Category {
  id: string;
  name: string;
  icon: string;
  kind: CatKind;
  /** monthly limit in the primary currency */
  limit?: number;
  watch?: boolean;
}

export interface Account {
  id: string;
  name: string;
  type: 'bank' | 'credit' | 'investment' | 'cash';
  currency: Currency;
  dueDay?: number;
  autopay?: boolean;
  /** words that identify this account in card names, emails and file names */
  match: string[];
}

export interface Tx {
  id: string;
  date: string; // YYYY-MM-DD, local
  amount: number; // signed: negative = money out
  currency: Currency;
  merchant: string;
  description?: string;
  account: string;
  category: string;
  note?: string;
  source: TxSource;
  manualCat?: boolean;
  bill?: string;
  /** amount actually charged to the card, when different from the purchase currency */
  charged?: { amount: number; currency: Currency };
  alerted?: boolean; // linked to a bank alert
  applePay?: boolean; // linked to an Apple Pay automation
  reconciled?: boolean; // matched to a CSV row
  csvKey?: string;
  updatedAt: number;
}

export interface Rule {
  match: string;
  category: string;
}

export interface Bill {
  id: string;
  name: string;
  amount: number; // positive
  currency: Currency;
  day: number;
  category: string;
  account: string;
}

export interface ImportMapping {
  key: string;
  hasHeader: boolean;
  date: number;
  amount: number;
  debit: number;
  credit: number;
  type: number;
  merchant: number;
  description: number;
  currency: number;
  dateOrder: DateOrder;
  invert: boolean;
}

export interface Settings {
  primary: Currency;
  secondary: Currency;
  income: number; // monthly, primary currency
  investPercent: number;
  assumedReturn: number;
  weeklyAllowance?: number;
  homePlaces: string[];
}

export interface Vault {
  v: number;
  settings: Settings;
  accounts: Account[];
  categories: Category[];
  rules: Rule[];
  bills: Bill[];
  transactions: Tx[];
  importMappings: ImportMapping[];
  /** 1 EUR = rate CAD */
  fx: { rate: number; date: string };
  privateKeyJwk: JsonWebKey | null;
  ingestToken?: string;
  deleted: string[];
  seenInbox: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SealedItem {
  id: string;
  at: number;
  source: 'applepay' | 'email' | 'wise' | 'manual';
  wrapped: string;
  iv: string;
  ct: string;
}

export interface MetaInfo {
  initialized: boolean;
  salt: string | null;
  setupCodeRequired: boolean;
  storage: 'redis' | 'local';
}
