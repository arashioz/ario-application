import { API_BASE } from './client';
import { getStoredToken } from './ws';

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readError(res: Response): Promise<Error> {
  const body = await res.json().catch(() => ({ error: res.statusText }));
  return new Error(body.error || 'خطای شبکه');
}

export async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}/admin${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...init.headers },
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

function filenameFrom(res: Response, fallback: string): string {
  const cd = res.headers.get('Content-Disposition') || '';
  const m = /filename="?([^";]+)"?/i.exec(cd);
  return m?.[1] || fallback;
}

/** دانلود فایل از API ادمین با توکن در هدر (لینک مستقیم نمی‌تواند هدر بفرستد) */
export async function adminDownload(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin${path}`, { headers: authHeaders() });
  if (!res.ok) throw await readError(res);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filenameFrom(res, fallbackName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
