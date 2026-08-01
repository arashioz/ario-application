/**
 * روی HTTPS مرورگر ws:// را بلاک می‌کند (mixed content).
 * پس از طریق پروکسی Vite به همان origin وصل می‌شویم: wss://host/ws → backend
 */
const API_HOST = import.meta.env.VITE_API_HOST as string | undefined;
const FORCE_DIRECT = import.meta.env.VITE_DIRECT_API === 'true';

function useSameOriginProxy(): boolean {
  if (FORCE_DIRECT) return false;
  if (typeof window === 'undefined') return true;
  // HTTPS یا همان‌هاست → پروکسی
  return window.location.protocol === 'https:' || !API_HOST;
}

function resolveApiBase(): string {
  if (typeof window !== 'undefined' && useSameOriginProxy()) {
    return `${window.location.origin}/api`;
  }
  const host = API_HOST || '127.0.0.1';
  return `http://${host}:3001/api`;
}

function resolveWsUrl(): string {
  if (typeof window !== 'undefined' && useSameOriginProxy()) {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${window.location.host}/ws`;
  }
  const host = API_HOST || '127.0.0.1';
  return `ws://${host}:3001/ws`;
}

export const API_BASE = resolveApiBase();
export const WS_URL = resolveWsUrl();

/** REST فقط برای health — منطق اصلی روی WS است */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'خطای شبکه');
  }
  return res.json();
}
