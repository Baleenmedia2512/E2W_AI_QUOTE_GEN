import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { authService } from '../services/authService';
import { AuthUser, LoginCredentials } from '../types/auth';

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

      // Check if authenticated
      checkAuth: () => {
        const state = get();
        return state.isAuthenticated && state.user !== null;
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

      // Initialize auth from localStorage
      initAuth: () => {
        const user = authService.getCurrentUser();
        if (user) {
          set({ 
            user, 
            isAuthenticated: true 
          });
        }
      }
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
