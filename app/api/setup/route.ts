import { bearer, json, readJson, safeEqual, sha256 } from '@/lib/server/auth';
import { compareAndSetVault, setNX } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

interface Body { setupCode?: string; salt?: string; publicKey?: JsonWebKey; ct?: string }

export async function POST(req: Request) {
  const code = process.env.SETUP_CODE;
  const body = await readJson<Body>(req);
  const token = bearer(req);
  if (!body || !token || typeof body.salt !== 'string' || typeof body.ct !== 'string' || !body.publicKey?.n) {
    return json({ error: 'Missing fields' }, 400);
  }
  if (code) {
    if (!safeEqual(String(body.setupCode || ''), code)) return json({ error: 'Wrong setup code' }, 403);
  } else if (process.env.VERCEL) {
    return json({ error: 'Set a SETUP_CODE environment variable in Vercel first.' }, 403);
  }
  const meta = { salt: body.salt, authHash: sha256(token), publicKey: body.publicKey, createdAt: Date.now() };
  if (!(await setNX('meta', JSON.stringify(meta)))) return json({ error: 'A vault already exists' }, 409);
  const res = await compareAndSetVault(0, body.ct);
  return json({ version: res.version });
}
