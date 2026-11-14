import { getMeta, json } from '@/lib/server/auth';
import { usingRedis } from '@/lib/server/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const meta = await getMeta();
  return json({
    initialized: !!meta,
    salt: meta?.salt ?? null,
    setupCodeRequired: !!process.env.SETUP_CODE,
    storage: usingRedis ? 'redis' : 'local',
  });
}
