import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual, webcrypto } from 'crypto';
import { get } from './store';

export interface Meta {
  salt: string;
  authHash: string;
  publicKey: JsonWebKey;
  ingestHash?: string;
  createdAt: number;
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function getMeta(): Promise<Meta | null> {
  const s = await get('meta');
  return s ? (JSON.parse(s) as Meta) : null;
}

export function bearer(req: Request): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '');
  return m ? m[1].trim() : null;
}

/** Returns the meta record if the request carries the owner's auth token, otherwise a 401 response. */
export async function requireOwner(req: Request): Promise<Meta | NextResponse> {
  const meta = await getMeta();
  const token = bearer(req);
  if (!meta || !token || !safeEqual(sha256(token), meta.authHash)) return json({ error: 'unauthorized' }, 401);
  return meta;
}

/** Seal a payload so only the vault's private key can open it: fresh AES key, wrapped with RSA-OAEP. */
export async function seal(publicJwk: JsonWebKey, payload: unknown) {
  const subtle = webcrypto.subtle;
  const pub = await subtle.importKey('jwk', publicJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const aes = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const raw = await subtle.exportKey('raw', aes);
  const wrapped = await subtle.encrypt({ name: 'RSA-OAEP' }, pub, raw);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify(payload)));
  const b = (x: ArrayBuffer | Uint8Array) => Buffer.from(x as ArrayBuffer).toString('base64');
  return { wrapped: b(wrapped), iv: b(iv), ct: b(ct) };
}

export async function readJson<T>(req: Request, maxBytes = 10_000_000): Promise<T | null> {
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
