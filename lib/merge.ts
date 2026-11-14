import type { Rule, Tx, Vault } from './types';

/**
 * Merge two versions of the vault after a save conflict.
 * Transactions: union by id, newest edit wins, deletions from either side stick.
 * Everything else (settings, categories, accounts…): the local device wins, since it's the one acting.
 */
export function mergeVaults(local: Vault, remote: Vault): Vault {
  const deleted = Array.from(new Set([...remote.deleted, ...local.deleted])).slice(-2000);
  const gone = new Set(deleted);

  const byId = new Map<string, Tx>();
  for (const t of remote.transactions) byId.set(t.id, t);
  for (const t of local.transactions) {
    const r = byId.get(t.id);
    if (!r || (t.updatedAt ?? 0) >= (r.updatedAt ?? 0)) byId.set(t.id, t);
  }
  const transactions = [...byId.values()].filter((t) => !gone.has(t.id));

  const rules = new Map<string, Rule>();
  for (const r of remote.rules) rules.set(r.match, r);
  for (const r of local.rules) rules.set(r.match, r);

  return {
    ...remote,
    ...local,
    transactions,
    deleted,
    rules: [...rules.values()].filter((r) => !gone.has(`rule:${r.match}`)),
    seenInbox: Array.from(new Set([...remote.seenInbox, ...local.seenInbox])).slice(-3000),
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  };
}
