export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
  }
}

export async function api<T>(path: string, opts: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const r = await fetch(path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  });
  let data: unknown = null;
  try {
    data = await r.json();
  } catch {}
  if (!r.ok) throw new ApiError(r.status, (data as { error?: string })?.error || `HTTP ${r.status}`, data);
  return data as T;
}
