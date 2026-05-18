import { describe, it, expect, beforeEach, vi } from 'vitest';

import { authService } from '../../services/authService';
import { AuthUser } from '../../types/auth';
import { useAuthStore } from '../authStore';

vi.mock('../../services/authService', () => ({
  authService: {
    login: vi.fn(),
    logout: vi.fn(),
    saveUser: vi.fn(),
    getCurrentUser: vi.fn(() => null),
  },
}));

const adminUser: AuthUser = {
  id: '1',
  email: 'admin@acme.com',
  full_name: 'Admin User',
  role: {
    role_name: 'Admin',
    permissions: { canEditQuotes: true, canDeleteQuotes: false },
  },
};

const regularUser: AuthUser = {
  id: '2',
  email: 'user@acme.com',
  full_name: 'Regular User',
  role: {
    role_name: 'user',
    permissions: {},
  },
};

function resetStore(): void {
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
  });
}

describe('authStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetStore();
  });

  describe('login', () => {
    it('sets user and authenticated state on success', async () => {
      vi.mocked(authService.login).mockResolvedValue(adminUser);

      await useAuthStore.getState().login({ email: 'a@b.com', password: 'pw' });

      const state = useAuthStore.getState();
      expect(state.user).toEqual(adminUser);
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(authService.saveUser).toHaveBeenCalledWith(adminUser);
    });

    it('sets error and rethrows on failure', async () => {
      vi.mocked(authService.login).mockRejectedValue(new Error('Invalid credentials'));

      await expect(
        useAuthStore.getState().login({ email: 'a@b.com', password: 'wrong' }),
      ).rejects.toThrow('Invalid credentials');

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Invalid credentials');
    });

    it('toggles isLoading during the call', async () => {
      let loadingDuringCall = false;
      vi.mocked(authService.login).mockImplementation(async () => {
        loadingDuringCall = useAuthStore.getState().isLoading;
        return adminUser;
      });

      await useAuthStore.getState().login({ email: 'a@b.com', password: 'pw' });

      expect(loadingDuringCall).toBe(true);
      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  describe('logout', () => {
    it('clears user state and calls authService.logout', () => {
      useAuthStore.setState({ user: adminUser, isAuthenticated: true, error: 'old' });

      useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.error).toBeNull();
      expect(authService.logout).toHaveBeenCalled();
    });
  });

  describe('setUser', () => {
    it('saves user and marks authenticated', () => {
      useAuthStore.getState().setUser(adminUser);

      const state = useAuthStore.getState();
      expect(state.user).toEqual(adminUser);
      expect(state.isAuthenticated).toBe(true);
      expect(authService.saveUser).toHaveBeenCalledWith(adminUser);
    });

    it('clears user when null and does not call saveUser', () => {
      useAuthStore.setState({ user: adminUser, isAuthenticated: true });

      useAuthStore.getState().setUser(null);

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(authService.saveUser).not.toHaveBeenCalled();
    });
  });

  describe('clearError', () => {
    it('resets error to null', () => {
      useAuthStore.setState({ error: 'something broke' });
      useAuthStore.getState().clearError();
      expect(useAuthStore.getState().error).toBeNull();
    });
  });

  describe('checkAuth', () => {
    it('returns true when authenticated with user', () => {
      useAuthStore.setState({ user: adminUser, isAuthenticated: true });
      expect(useAuthStore.getState().checkAuth()).toBe(true);
    });

    it('returns false when isAuthenticated is false', () => {
      useAuthStore.setState({ user: adminUser, isAuthenticated: false });
      expect(useAuthStore.getState().checkAuth()).toBe(false);
    });

    it('returns false when user is null', () => {
      useAuthStore.setState({ user: null, isAuthenticated: true });
      expect(useAuthStore.getState().checkAuth()).toBe(false);
    });
  });

  describe('hasRole', () => {
    it('returns true for matching role (case-insensitive)', () => {
      useAuthStore.setState({ user: adminUser });
      expect(useAuthStore.getState().hasRole('admin')).toBe(true);
      expect(useAuthStore.getState().hasRole('ADMIN')).toBe(true);
      expect(useAuthStore.getState().hasRole('Admin')).toBe(true);
    });

    it('returns false for non-matching role', () => {
      useAuthStore.setState({ user: adminUser });
      expect(useAuthStore.getState().hasRole('user')).toBe(false);
    });

    it('returns false when user is null', () => {
      expect(useAuthStore.getState().hasRole('admin')).toBe(false);
    });
  });

  describe('hasPermission', () => {
    it('returns true when permission is granted', () => {
      useAuthStore.setState({ user: adminUser });
      expect(useAuthStore.getState().hasPermission('canEditQuotes')).toBe(true);
    });

    it('returns false when permission is explicitly false', () => {
      useAuthStore.setState({ user: adminUser });
      expect(useAuthStore.getState().hasPermission('canDeleteQuotes')).toBe(false);
    });

    it('returns false for unknown permission', () => {
      useAuthStore.setState({ user: adminUser });
      expect(useAuthStore.getState().hasPermission('nonexistent')).toBe(false);
    });

    it('returns false when user has no permissions', () => {
      useAuthStore.setState({ user: regularUser });
      expect(useAuthStore.getState().hasPermission('any')).toBe(false);
    });

    it('returns false when user is null', () => {
      expect(useAuthStore.getState().hasPermission('any')).toBe(false);
    });
  });

  describe('getUserRole', () => {
    it('returns role name when user has role', () => {
      useAuthStore.setState({ user: adminUser });
      expect(useAuthStore.getState().getUserRole()).toBe('Admin');
    });

    it('returns null when user is null', () => {
      expect(useAuthStore.getState().getUserRole()).toBeNull();
    });
  });

  describe('initAuth', () => {
    it('restores user from authService when present', () => {
      vi.mocked(authService.getCurrentUser).mockReturnValue(adminUser);

      useAuthStore.getState().initAuth();

      const state = useAuthStore.getState();
      expect(state.user).toEqual(adminUser);
      expect(state.isAuthenticated).toBe(true);
    });

    it('leaves state empty when no stored user', () => {
      vi.mocked(authService.getCurrentUser).mockReturnValue(null);

      useAuthStore.getState().initAuth();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });
  });
});
