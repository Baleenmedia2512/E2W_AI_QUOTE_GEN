const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const SESSION_TOKEN_KEY = 'authSessionToken';

function apiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

function readSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<{ data: T | null; error: string | null; status: number }> {
  try {
    const headers = new Headers(init.headers || {});
    if (!headers.has('Content-Type') && !(init.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    const token = readSessionToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const res = await fetch(apiUrl(path), { ...init, headers });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    if (!res.ok) {
      const message =
        parsed && typeof parsed === 'object'
          ? String(
              (parsed as { error?: unknown; message?: unknown }).error
                || (parsed as { message?: unknown }).message
                || `Request failed (${res.status})`,
            )
          : `Request failed (${res.status})`;
      return { data: parsed as T, error: message, status: res.status };
    }

    return { data: parsed as T, error: null, status: res.status };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Network error',
      status: 0,
    };
  }
}

export { apiUrl };
