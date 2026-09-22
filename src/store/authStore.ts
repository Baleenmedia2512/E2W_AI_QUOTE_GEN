import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AuthUser, LoginCredentials } from '../types/auth';
import { authService } from '../services/authService';

interface AuthState {
  // State
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
  setUser: (user: AuthUser | null) => void;
  clearError: () => void;
  
  // Helpers
  checkAuth: () => boolean;
  hasRole: (roleName: string) => boolean;
  hasPermission: (permission: string) => boolean;
  getUserRole: () => string | null;
  initAuth: () => void;
  /** Silently extend session while user keeps using the app. */
  refreshSessionIfNeeded: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      // Login action
      login: async (credentials: LoginCredentials) => {
        set({ isLoading: true, error: null });
        try {
          const user = await authService.login(credentials);
          authService.saveUser(user);
          set({ 
            user, 
            isAuthenticated: true, 
            isLoading: false,
            error: null
          });
        } catch (error: any) {
          set({ 
            error: error.message || 'Login failed', 
            isLoading: false,
            isAuthenticated: false,
            user: null
          });
          throw error;
        }
      },

      // Logout action
      logout: () => {
        authService.logout();
        set({ 
          user: null, 
          isAuthenticated: false,
          error: null
        });
      },

      // Set user manually
      setUser: (user: AuthUser | null) => {
        if (user) {
          authService.saveUser(user);
        }
        set({ 
          user, 
          isAuthenticated: !!user 
        });
      },

      // Clear error
      clearError: () => {
        set({ error: null });
      },

      // Check if authenticated (Zustand flag + valid HMAC session token)
      checkAuth: () => {
        const state = get();
        if (!state.isAuthenticated || !state.user) return false;
        return authService.hasValidSessionToken();
      },

      // Check if user has specific role
      hasRole: (roleName: string) => {
        const user = get().user;
        if (!user?.role) return false;
        return user.role.role_name.toLowerCase() === roleName.toLowerCase();
      },

      // Check if user has specific permission
      hasPermission: (permission: string) => {
        const user = get().user;
        if (!user?.role?.permissions) return false;
        return user.role.permissions[permission] === true;
      },

      // Get user's role name
      getUserRole: () => {
        const user = get().user;
        return user?.role?.role_name || null;
      },

      // Initialize auth from localStorage (require valid session token for email/API)
      initAuth: () => {
        const user = authService.getCurrentUser();
        if (user && authService.hasValidSessionToken()) {
          set({
            user,
            isAuthenticated: true,
          });
          // Extend TTL in the background so daily users stay signed in.
          void get().refreshSessionIfNeeded();
          return;
        }
        // User object without token (or expired) looked "logged in" but email failed —
        // clear and require a fresh login so download+email works.
        if (user || get().isAuthenticated) {
          authService.logout();
        }
        set({
          user: null,
          isAuthenticated: false,
          error: null,
        });
      },

      refreshSessionIfNeeded: async () => {
        if (!authService.hasValidSessionToken()) return;
        const ok = await authService.refreshSession();
        if (!ok) return;
        const user = authService.getCurrentUser();
        if (user) {
          set({ user, isAuthenticated: true });
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ 
        user: state.user, 
        isAuthenticated: state.isAuthenticated 
      })
    }
  )
);

// Initialize auth on module load
useAuthStore.getState().initAuth();
