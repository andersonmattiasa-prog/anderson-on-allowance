// Browser-side cryptography. The passphrase and derived keys never leave the device.
import type { SealedItem, Vault } from './types';

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

export function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function randomSalt(): string {
  return b64(crypto.getRandomValues(new Uint8Array(16)));
}

export function randomToken(bytes = 32): string {
  return b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(s: string): Promise<string> {
  return toHex(new Uint8Array(await subtle().digest('SHA-256', enc.encode(s))));
}

export const PBKDF2_ITERATIONS = 600_000;

/** Passphrase → 512 bits: 256 for the AES-GCM vault key (non-extractable), 256 for the server auth token. */
export async function deriveKeys(passphrase: string, saltB64: string): Promise<{ key: CryptoKey; token: string }> {
  const base = await subtle().importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await subtle().deriveBits(
      { name: 'PBKDF2', salt: unb64(saltB64) as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      base,
      512,
    ),
  );
  const key = await subtle().importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const token = toHex(bits.slice(32));
  bits.fill(0);
  return { key, token };
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encryptVault(key: CryptoKey, vault: Vault): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const packed = await pipe(enc.encode(JSON.stringify(vault)), new CompressionStream('gzip'));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, packed as BufferSource);
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function decryptVault(key: CryptoKey, blob: string): Promise<Vault> {
  const [ver, iv, ct] = blob.split('.');
  if (ver !== 'v1') throw new Error('Unknown vault format');
  const packed = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(iv) as BufferSource }, key, unb64(ct) as BufferSource);
  const json = await pipe(new Uint8Array(packed), new DecompressionStream('gzip'));
  return JSON.parse(dec.decode(json));
}

/** RSA key pair for the sealed inbox. The server only ever sees the public half. */
export async function generateInboxKeys(): Promise<{ publicJwk: JsonWebKey; privateJwk: JsonWebKey }> {
  const kp = await subtle().generateKey(
    { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  );
  return {
    publicJwk: await subtle().exportKey('jwk', kp.publicKey),
    privateJwk: await subtle().exportKey('jwk', kp.privateKey),
  };
}

const privCache = new WeakMap<JsonWebKey, Promise<CryptoKey>>();
export async function openSealed(privateJwk: JsonWebKey, item: SealedItem): Promise<unknown> {
  let p = privCache.get(privateJwk);
  if (!p) {
    p = subtle().importKey('jwk', privateJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    privCache.set(privateJwk, p);
  }
  const raw = await subtle().decrypt({ name: 'RSA-OAEP' }, await p, unb64(item.wrapped) as BufferSource);
  const k = await subtle().importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(item.iv) as BufferSource }, k, unb64(item.ct) as BufferSource);
  return JSON.parse(dec.decode(pt));
}
