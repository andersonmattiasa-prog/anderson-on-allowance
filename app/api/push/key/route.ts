import { json } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export function GET() {
  return json({ key: process.env.VAPID_PUBLIC_KEY || null });
}
