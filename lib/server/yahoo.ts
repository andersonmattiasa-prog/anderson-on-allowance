// Server-side price lookups. Only ticker symbols are sent to Yahoo Finance.
const TICKER = /^[A-Z0-9.=^-]{1,15}$/i;

export function parseTickers(raw: string | null): string[] {
  return Array.from(new Set((raw || '').split(',').map((t) => t.trim().toUpperCase()).filter((t) => TICKER.test(t)))).slice(0, 30);
}

interface ChartMeta { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number; currency?: string; regularMarketTime?: number }
interface ChartResult { meta: ChartMeta; timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[]; adjclose?: { adjclose?: (number | null)[] }[] } }

async function chart(ticker: string, range: string, interval: string): Promise<ChartResult | null> {
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AndersonAhead/1.0)' },
        next: { revalidate: 300 },
      });
      if (!r.ok) continue;
      const j = (await r.json()) as { chart?: { result?: ChartResult[] } };
      const res = j.chart?.result?.[0];
      if (res) return res;
    } catch {}
  }
  return null;
}

export async function getQuotes(tickers: string[]) {
  const out: Record<string, { price: number; prev: number; currency: string; date: string }> = {};
  await Promise.all(
    tickers.map(async (t) => {
      const c = await chart(t, '5d', '1d');
      const m = c?.meta;
      if (!m?.regularMarketPrice) return;
      const closes = (c?.indicators?.quote?.[0]?.close || []).filter((x): x is number => typeof x === 'number');
      const prev = closes.length >= 2 ? closes[closes.length - 2] : m.chartPreviousClose ?? m.previousClose ?? m.regularMarketPrice;
      out[t] = {
        price: m.regularMarketPrice,
        prev,
        currency: (m.currency || 'CAD').toUpperCase(),
        date: new Date((m.regularMarketTime || Date.now() / 1000) * 1000).toISOString().slice(0, 10),
      };
    }),
  );
  return out;
}

const RANGES: Record<string, string> = { '1mo': '1d', '6mo': '1d', '1y': '1d', '5y': '1wk' };

export async function getHistory(tickers: string[], range: string) {
  const interval = RANGES[range] ?? '1d';
  const r = RANGES[range] ? range : '1y';
  const out: Record<string, { currency: string; points: [number, number][] }> = {};
  await Promise.all(
    tickers.map(async (t) => {
      const c = await chart(t, r, interval);
      if (!c?.timestamp) return;
      const closes = c.indicators?.quote?.[0]?.close || [];
      const points: [number, number][] = [];
      c.timestamp.forEach((ts, i) => {
        const v = closes[i];
        if (typeof v === 'number') points.push([ts * 1000, v]);
      });
      out[t] = { currency: (c.meta.currency || 'CAD').toUpperCase(), points };
    }),
  );
  return out;
}
