import { AuthUser, LoginCredentials } from '../types/auth';
import { apiFetch } from './apiClient';

const SESSION_TOKEN_KEY = 'authSessionToken';

function decodeSessionPayload(token: string): { email?: string; exp?: number } | null {
  try {
    const [payloadPart] = token.split('.');
    if (!payloadPart) return null;
    const padded = payloadPart.replace(/-/g, '+').replace(/_/g, '/').padEnd(
      Math.ceil(payloadPart.length / 4) * 4,
      '=',
    );
    const parsed = JSON.parse(atob(padded)) as { email?: unknown; exp?: unknown };
    return {
      email: typeof parsed.email === 'string' ? parsed.email : undefined,
      exp: typeof parsed.exp === 'number' ? parsed.exp : Number(parsed.exp),
    };
  } catch {
    return null;
  }
}

class AuthService {
  async login(credentials: LoginCredentials): Promise<AuthUser> {
    const { data, error } = await apiFetch<{ user?: AuthUser; token?: string; error?: string }>(
      '/api/auth/session',
      {
        method: 'POST',
        body: JSON.stringify(credentials),
      },
    );

    if (error || !data?.user || !data?.token) {
      throw new Error(data?.error || error || 'Invalid email or password');
    }

    localStorage.setItem(SESSION_TOKEN_KEY, data.token);
    return data.user;
  }

  logout(): void {
    localStorage.removeItem('currentUser');
    localStorage.removeItem('authToken');
    localStorage.removeItem(SESSION_TOKEN_KEY);
    console.log('✅ User logged out successfully');
  }

  getCurrentUser(): AuthUser | null {
    try {
      const userStr = localStorage.getItem('currentUser');
      if (userStr) return JSON.parse(userStr) as AuthUser;
      return null;
    } catch (error) {
      console.error('Error getting current user:', error);
      return null;
    }
  }

  saveUser(user: AuthUser): void {
    localStorage.setItem('currentUser', JSON.stringify(user));
  }

  getSessionToken(): string | null {
    return localStorage.getItem(SESSION_TOKEN_KEY);
  }

  async refreshSession(): Promise<boolean> {
    const token = this.getSessionToken();
    if (!token || !this.hasValidSessionToken()) return false;

    const { data, error } = await apiFetch<{ user?: AuthUser; token?: string }>(
      '/api/auth/session',
      {
        method: 'POST',
        body: JSON.stringify({ action: 'refresh' }),
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (error || !data?.token) return false;
    localStorage.setItem(SESSION_TOKEN_KEY, data.token);
    if (data.user) this.saveUser(data.user);
    return true;
  }

  hasValidSessionToken(): boolean {
    const token = this.getSessionToken();
    if (!token) return false;
    const payload = decodeSessionPayload(token);
    if (!payload?.exp) return false;
    return payload.exp > Math.floor(Date.now() / 1000);
  }
}

export const authService = new AuthService();
