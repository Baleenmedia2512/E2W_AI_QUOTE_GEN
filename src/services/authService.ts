import bcrypt from 'bcryptjs';

import { AuthUser, LoginCredentials } from '../types/auth';

import { supabase } from './supabaseClient';
import { logger } from '../utils/logger';

class AuthService {
  /**
   * Login with email and password
   * Queries the database for user credentials and verifies password
   */
  async login(credentials: LoginCredentials): Promise<AuthUser> {
    const { email, password } = credentials;

    // Query user first - table name is 'User' (CamelCase)
    // Use ilike for case-insensitive email matching
    const { data: user, error } = await supabase
      .from('User')
      .select('*')
      .ilike('email', email.trim())
      .single();

    if (error || !user) {
      logger.error('Login error:', error);
      throw new Error('Invalid email or password');
    }

    // Fetch role separately - table name is 'Role' (CamelCase)
    const { data: role, error: roleError } = await supabase
      .from('Role')
      .select('*')
      .eq('id', user.roleId)
      .single();

    if (roleError || !role) {
      logger.error('Role fetch error:', roleError);
      throw new Error('Unable to fetch user role');
    }

    // Attach role to user object
    user.Role = role;

    // Check if account is active
    if (!user.isActive) {
      throw new Error('Your account has been deactivated. Please contact administrator.');
    }

    // Verify password with bcrypt
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      throw new Error('Invalid email or password');
    }

    // Note: Update last login timestamp if column exists
    // await supabase
    //   .from('User')
    //   .update({ lastLogin: new Date().toISOString() })
    //   .eq('id', user.id);

    // Return user data without password
    const roleData = Array.isArray(user.Role) ? user.Role[0] : user.Role;
    
    // Parse permissions if it's a JSON string
    let permissions = {};
    if (roleData?.permissions) {
      try {
        permissions = typeof roleData.permissions === 'string' 
          ? JSON.parse(roleData.permissions) 
          : roleData.permissions;
      } catch (e) {
        logger.error('Failed to parse permissions:', e);
      }
    }
    
    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      full_name: user.name,
      role: {
        role_name: roleData?.name || 'user',
        permissions: permissions,
      },
    };

    return authUser;
  }

  /**
   * Logout - clear local storage
   */
  logout(): void {
    localStorage.removeItem('currentUser');
    localStorage.removeItem('authToken');
    logger.info('✅ User logged out successfully');
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
      logger.error('Error getting current user:', error);
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
