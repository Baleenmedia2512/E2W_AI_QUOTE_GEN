import { supabase } from './supabaseClient';
import { AuthUser, LoginCredentials } from '../types/auth';
import { extractEdgeFunctionMessage } from '../utils/edgeFunctionError';

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
  /**
   * Login with email and password
   * Queries the database for user credentials and verifies password
   */
  async login(credentials: LoginCredentials): Promise<AuthUser> {
    const { data, error } = await supabase.functions.invoke('auth-session', {
      body: credentials,
      headers: { 'Content-Type': 'application/json' },
    });

    if (error || !data?.user || !data?.token) {
      const message = await extractEdgeFunctionMessage(
        error,
        data,
        'Invalid email or password',
      );
      throw new Error(message);
    }

    localStorage.setItem(SESSION_TOKEN_KEY, data.token);
    return data.user as AuthUser;
  }

  /**
   * Logout - clear local storage
   */
  logout(): void {
    localStorage.removeItem('currentUser');
    localStorage.removeItem('authToken');
    localStorage.removeItem(SESSION_TOKEN_KEY);
    console.log('✅ User logged out successfully');
  }

  /**
   * Get current user from localStorage
   */
  getCurrentUser(): AuthUser | null {
    try {
      const userStr = localStorage.getItem('currentUser');
      if (userStr) {
        return JSON.parse(userStr) as AuthUser;
      }
      return null;
    } catch (error) {
      console.error('Error getting current user:', error);
      return null;
    }
  }

  /**
   * Save user to localStorage
   */
  saveUser(user: AuthUser): void {
    localStorage.setItem('currentUser', JSON.stringify(user));
  }

  /**
   * Return the server-verifiable session token created during login.
   */
  getSessionToken(): string | null {
    return localStorage.getItem(SESSION_TOKEN_KEY);
  }

  /**
   * Silently extend the session (new 30-day token) while the current token is still valid.
   * Call on app open so active users rarely need to type a password again.
   */
  async refreshSession(): Promise<boolean> {
    const token = this.getSessionToken();
    if (!token || !this.hasValidSessionToken()) return false;

    const { data, error } = await supabase.functions.invoke('auth-session', {
      body: { action: 'refresh' },
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (error || !data?.token) return false;

    localStorage.setItem(SESSION_TOKEN_KEY, data.token);
    if (data.user) {
      this.saveUser(data.user as AuthUser);
    }
    return true;
  }

  /**
   * True when the HMAC session token exists and has not passed its exp claim.
   * Email send and other Edge Functions require this — a stored user alone is not enough.
   */
  hasValidSessionToken(): boolean {
    const token = this.getSessionToken();
    if (!token) return false;
    const payload = decodeSessionPayload(token);
    if (!payload?.exp || !Number.isFinite(payload.exp)) return false;
    // Small skew so we re-login slightly before the server rejects.
    return payload.exp > Math.floor(Date.now() / 1000) + 30;
  }

  /**
   * If user exists without a valid session token, clear the stale session.
   * Returns true only when both user and token are usable.
   */
  ensureValidSession(): boolean {
    const user = this.getCurrentUser();
    if (!user) return false;
    if (this.hasValidSessionToken()) return true;
    this.logout();
    return false;
  }

  /**
   * Check if user is authenticated (user profile + valid email/session token).
   */
  isAuthenticated(): boolean {
    return this.ensureValidSession();
  }

  /**
   * Check if user has specific permission
   */
  hasPermission(permission: string): boolean {
    const user = this.getCurrentUser();
    if (!user?.role?.permissions) return false;
    return user.role.permissions[permission] === true;
  }

  /**
   * Check if user has specific role
   */
  hasRole(roleName: string): boolean {
    const user = this.getCurrentUser();
    if (!user?.role) return false;
    return user.role.role_name.toLowerCase() === roleName.toLowerCase();
  }

  /**
   * Get user's role name
   */
  getUserRole(): string | null {
    const user = this.getCurrentUser();
    return user?.role?.role_name || null;
  }
}

// Export singleton instance
export const authService = new AuthService();
