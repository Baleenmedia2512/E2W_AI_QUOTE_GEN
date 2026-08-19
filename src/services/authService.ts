import { supabase } from './supabaseClient';
import { AuthUser, LoginCredentials } from '../types/auth';

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
      throw new Error(data?.error || error?.message || 'Invalid email or password');
    }

    localStorage.setItem('authSessionToken', data.token);
    return data.user as AuthUser;
  }

  /**
   * Logout - clear local storage
   */
  logout(): void {
    localStorage.removeItem('currentUser');
    localStorage.removeItem('authToken');
    localStorage.removeItem('authSessionToken');
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
    return localStorage.getItem('authSessionToken');
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.getCurrentUser() !== null;
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
