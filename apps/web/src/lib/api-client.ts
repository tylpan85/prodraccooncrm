import type { ErrorEnvelope, ItemEnvelope, ItemsEnvelope } from '@openclaw/shared';

const API_PORT = 4000;

function getApiUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:${API_PORT}`;
  }
  return `http://localhost:${API_PORT}`;
}

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  skipRefresh?: boolean;
}

async function refreshOnce(): Promise<boolean> {
  try {
    const res = await fetch(`${getApiUrl()}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await fetch(`${getApiUrl()}${path}`, {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  if (res.status === 401 && !opts.skipRefresh && !path.startsWith('/api/auth/')) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      return apiFetch<T>(path, { ...opts, skipRefresh: true });
    }
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const env = json as ErrorEnvelope | null;
    throw new ApiClientError(
      res.status,
      env?.error?.code ?? 'UNKNOWN',
      env?.error?.message ?? `Request failed (${res.status})`,
      env?.error?.details,
    );
  }

  return json as T;
}

export function apiItem<T>(path: string, opts?: RequestOptions): Promise<T> {
  return apiFetch<ItemEnvelope<T>>(path, opts).then((env) => env.item);
}

export function apiItems<T>(
  path: string,
  opts?: RequestOptions,
): Promise<{ items: T[]; nextCursor?: string | null }> {
  return apiFetch<ItemsEnvelope<T>>(path, opts).then((env) => ({
    items: env.items,
    nextCursor: env.nextCursor ?? null,
  }));
}
