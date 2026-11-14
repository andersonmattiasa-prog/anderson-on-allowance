import { ImageResponse } from 'next/og';
import { IconArt } from '@/components/IconArt';

const SIZES: Record<string, { px: number; padded: boolean }> = {
  '192': { px: 192, padded: false },
  '512': { px: 512, padded: false },
  'maskable-512': { px: 512, padded: true },
};

export function generateStaticParams() {
  return Object.keys(SIZES).map((size) => ({ size }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ size: string }> }) {
  const s = SIZES[(await ctx.params).size];
  if (!s) return new Response('Not found', { status: 404 });
  return new ImageResponse(<IconArt size={s.px} padded={s.padded} />, { width: s.px, height: s.px });
}
