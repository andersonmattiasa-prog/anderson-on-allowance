// Key-value storage: Upstash Redis in production, a local JSON file in development.
import { promises as fs } from 'fs';
import path from 'path';

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const usingRedis = !!(REDIS_URL && REDIS_TOKEN);

async function redis<T = unknown>(cmd: (string | number)[]): Promise<T> {
  const r = await fetch(REDIS_URL!, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
    cache: 'no-store',
  });
  const j = (await r.json()) as { result?: T; error?: string };
  if (!r.ok || j.error) throw new Error(`Redis error: ${j.error || r.status}`);
  return j.result as T;
}

// ---- local file fallback (dev only) ----
type DB = Record<string, unknown>;
const FILE = path.join(process.cwd(), '.data', 'store.json');
let chain: Promise<unknown> = Promise.resolve();
function local<T>(fn: (db: DB) => T, write: boolean): Promise<T> {
  if (process.env.VERCEL) throw new Error('No database configured. Connect Upstash Redis in Vercel.');
  const run = chain.then(async () => {
    let db: DB = {};
    try {
      db = JSON.parse(await fs.readFile(FILE, 'utf8'));
    } catch {}
    const res = fn(db);
    if (write) {
      await fs.mkdir(path.dirname(FILE), { recursive: true });
      await fs.writeFile(FILE, JSON.stringify(db));
    }
    return res;
  });
  chain = run.catch(() => {});
  return run;
}

export async function get(key: string): Promise<string | null> {
  if (usingRedis) return redis<string | null>(['GET', key]);
  return local((db) => (db[key] as string | undefined) ?? null, false);
}
export async function set(key: string, value: string): Promise<void> {
  if (usingRedis) return void (await redis(['SET', key, value]));
  return local((db) => void (db[key] = value), true);
}
export async function setNX(key: string, value: string): Promise<boolean> {
  if (usingRedis) return (await redis<string | null>(['SET', key, value, 'NX'])) === 'OK';
  return local((db) => (key in db ? false : ((db[key] = value), true)), true);
}
export async function del(...keys: string[]): Promise<void> {
  if (usingRedis) return void (await redis(['DEL', ...keys]));
  return local((db) => keys.forEach((k) => delete db[k]), true);
}
export async function hset(key: string, field: string, value: string): Promise<void> {
  if (usingRedis) return void (await redis(['HSET', key, field, value]));
  return local((db) => void (((db[key] ||= {}) as Record<string, string>)[field] = value), true);
}
export async function hgetall(key: string): Promise<Record<string, string>> {
  if (usingRedis) {
    const flat = (await redis<string[] | null>(['HGETALL', key])) || [];
    const out: Record<string, string> = {};
    for (let i = 0; i < flat.length; i += 2) out[flat[i]] = flat[i + 1];
    return out;
  }
  return local((db) => ({ ...((db[key] as Record<string, string>) || {}) }), false);
}
export async function hdel(key: string, fields: string[]): Promise<void> {
  if (!fields.length) return;
  if (usingRedis) return void (await redis(['HDEL', key, ...fields]));
  return local((db) => fields.forEach((f) => delete ((db[key] as Record<string, string>) || {})[f]), true);
}
export async function hlen(key: string): Promise<number> {
  if (usingRedis) return redis<number>(['HLEN', key]);
  return local((db) => Object.keys((db[key] as object) || {}).length, false);
}

const CAS = `
local v = tonumber(redis.call('GET', KEYS[1]) or '0')
if v ~= tonumber(ARGV[1]) then return {0, v} end
redis.call('SET', KEYS[2], ARGV[2])
redis.call('SET', KEYS[1], tostring(v + 1))
return {1, v + 1}`;

/** Save the vault only if nobody else saved since `expected`. */
export async function compareAndSetVault(expected: number, ct: string): Promise<{ ok: boolean; version: number }> {
  if (usingRedis) {
    const [ok, version] = await redis<[number, number]>(['EVAL', CAS, 2, 'vault:version', 'vault:ct', String(expected), ct]);
    return { ok: ok === 1, version };
  }
  return local((db) => {
    const v = Number(db['vault:version'] || 0);
    if (v !== expected) return { ok: false, version: v };
    db['vault:ct'] = ct;
    db['vault:version'] = String(v + 1);
    return { ok: true, version: v + 1 };
  }, true);
}
