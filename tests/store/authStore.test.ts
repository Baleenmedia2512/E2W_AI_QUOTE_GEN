import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthUser, LoginCredentials } from '../../src/types/auth';

// ── Mock authService before importing the store ────────────────────────────
// NOTE: vi.mock() is hoisted to the top of the file by Vitest, so the factory
// must use only inline values – no references to variables declared below.
vi.mock('../../src/services/authService', () => ({
  authService: {
    login: vi.fn(),
    logout: vi.fn(),
    saveUser: vi.fn(),
    getCurrentUser: vi.fn(),
  },
}));

// ── Import store AFTER mocks are set up ────────────────────────────────────
import { useAuthStore } from '../../src/store/authStore';
import { authService } from '../../src/services/authService';

// Typed reference to the mocked service (functions are already vi.fn())
const mockAuthService = vi.mocked(authService);

// ── Helpers ────────────────────────────────────────────────────────────────
const mockUser: AuthUser = {
  id: 'user-001',
  email: 'alice@baleenmedia.com',
  full_name: 'Alice Smith',
  role: {
    role_name: 'admin',
    permissions: {
      create_quotes: true,
      edit_quotes: true,
      delete_quotes: false,
      view_all_quotes: true,
    },
  },
};

const validCredentials: LoginCredentials = {
  email: 'alice@baleenmedia.com',
  password: 'correctpassword',
};

function resetStore() {
  localStorage.clear();
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('authStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  // ── Initial state ────────────────────────────────────────────────────
  describe('initial state', () => {
    it('user is null', () => {
      expect(useAuthStore.getState().user).toBeNull();
    });

    it('isAuthenticated is false', () => {
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it('isLoading is false', () => {
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('error is null', () => {
      expect(useAuthStore.getState().error).toBeNull();
    });
  });

  // ── login action ──────────────────────────────────────────────────────
  describe('login action', () => {
    it('sets isAuthenticated to true and user on successful login', async () => {
      mockAuthService.login.mockResolvedValueOnce(mockUser);

      await useAuthStore.getState().login(validCredentials);

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual(mockUser);
      expect(state.error).toBeNull();
      expect(state.isLoading).toBe(false);
    });

    it('calls authService.saveUser after successful login', async () => {
      mockAuthService.login.mockResolvedValueOnce(mockUser);

      await useAuthStore.getState().login(validCredentials);

      expect(mockAuthService.saveUser).toHaveBeenCalledWith(mockUser);
    });

    it('sets error message when login fails with wrong password', async () => {
      mockAuthService.login.mockRejectedValueOnce(new Error('Invalid credentials'));

      await expect(useAuthStore.getState().login(validCredentials)).rejects.toThrow(
        'Invalid credentials',
      );

      const state = useAuthStore.getState();
      expect(state.error).toBe('Invalid credentials');
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(state.isLoading).toBe(false);
    });

    it('sets a fallback error message when error has no message', async () => {
      mockAuthService.login.mockRejectedValueOnce({});

      await expect(useAuthStore.getState().login(validCredentials)).rejects.toBeTruthy();

      expect(useAuthStore.getState().error).toBe('Login failed');
    });

    it('resets error to null before each login attempt', async () => {
      // Simulate previous error state
      useAuthStore.setState({ error: 'old error' });
      mockAuthService.login.mockResolvedValueOnce(mockUser);

      await useAuthStore.getState().login(validCredentials);

      expect(useAuthStore.getState().error).toBeNull();
    });
  });

  // ── logout action ─────────────────────────────────────────────────────
  describe('logout action', () => {
    beforeEach(async () => {
      mockAuthService.login.mockResolvedValueOnce(mockUser);
      await useAuthStore.getState().login(validCredentials);
    });

    it('sets user to null after logout', () => {
      useAuthStore.getState().logout();
      expect(useAuthStore.getState().user).toBeNull();
    });

    it('sets isAuthenticated to false after logout', () => {
      useAuthStore.getState().logout();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it('clears error on logout', () => {
      useAuthStore.setState({ error: 'some error' });
      useAuthStore.getState().logout();
      expect(useAuthStore.getState().error).toBeNull();
    });

    it('calls authService.logout', () => {
      useAuthStore.getState().logout();
      expect(mockAuthService.logout).toHaveBeenCalledOnce();
    });
  });

  // ── setUser action ────────────────────────────────────────────────────
  describe('setUser action', () => {
    it('sets isAuthenticated true when a valid user is passed', () => {
      useAuthStore.getState().setUser(mockUser);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user).toEqual(mockUser);
    });

    it('sets isAuthenticated false when null is passed', () => {
      useAuthStore.getState().setUser(mockUser);
      useAuthStore.getState().setUser(null);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().user).toBeNull();
    });

    it('calls authService.saveUser when a non-null user is set', () => {
      useAuthStore.getState().setUser(mockUser);
      expect(mockAuthService.saveUser).toHaveBeenCalledWith(mockUser);
    });

    it('does not call authService.saveUser when null is passed', () => {
      useAuthStore.getState().setUser(null);
      expect(mockAuthService.saveUser).not.toHaveBeenCalled();
    });
  });

  // ── clearError action ─────────────────────────────────────────────────
  describe('clearError action', () => {
    it('sets error to null', () => {
      useAuthStore.setState({ error: 'Something went wrong' });
      useAuthStore.getState().clearError();
      expect(useAuthStore.getState().error).toBeNull();
    });

    it('does not throw when error is already null', () => {
      expect(() => useAuthStore.getState().clearError()).not.toThrow();
    });
  });

  // ── checkAuth helper ──────────────────────────────────────────────────
  describe('checkAuth helper', () => {
    it('returns false when not authenticated', () => {
      expect(useAuthStore.getState().checkAuth()).toBe(false);
    });

    it('returns true when authenticated with a valid user', async () => {
      mockAuthService.login.mockResolvedValueOnce(mockUser);
      await useAuthStore.getState().login(validCredentials);
      expect(useAuthStore.getState().checkAuth()).toBe(true);
    });
  });

  // ── hasRole helper ────────────────────────────────────────────────────
  describe('hasRole helper', () => {
    beforeEach(async () => {
      mockAuthService.login.mockResolvedValueOnce(mockUser);
      await useAuthStore.getState().login(validCredentials);
    });

    it('returns true when user has the specified role', () => {
      expect(useAuthStore.getState().hasRole('admin')).toBe(true);
    });

    it('is case-insensitive for role comparison', () => {
      expect(useAuthStore.getState().hasRole('ADMIN')).toBe(true);
      expect(useAuthStore.getState().hasRole('Admin')).toBe(true);
    });

    it('returns false when user does not have the specified role', () => {
      expect(useAuthStore.getState().hasRole('superuser')).toBe(false);
    });

    it('returns false when no user is logged in', () => {
      useAuthStore.setState({ user: null });
      expect(useAuthStore.getState().hasRole('admin')).toBe(false);
    });
  });

  // ── hasPermission helper ──────────────────────────────────────────────
  describe('hasPermission helper', () => {
    beforeEach(async () => {
      mockAuthService.login.mockResolvedValueOnce(mockUser);
      await useAuthStore.getState().login(validCredentials);
    });

    it('returns true when user has the permission set to true', () => {
      expect(useAuthStore.getState().hasPermission('create_quotes')).toBe(true);
    });

    it('returns false when permission is explicitly set to false', () => {
      expect(useAuthStore.getState().hasPermission('delete_quotes')).toBe(false);
    });

    it('returns false when permission does not exist', () => {
      expect(useAuthStore.getState().hasPermission('non_existent_permission')).toBe(false);
    });

    it('returns false when no user is logged in', () => {
      useAuthStore.setState({ user: null });
      expect(useAuthStore.getState().hasPermission('create_quotes')).toBe(false);
    });
  });

  // ── getUserRole helper ────────────────────────────────────────────────
  describe('getUserRole helper', () => {
    it('returns null when no user is logged in', () => {
      expect(useAuthStore.getState().getUserRole()).toBeNull();
    });

    it('returns the role name when user is logged in', async () => {
      mockAuthService.login.mockResolvedValueOnce(mockUser);
      await useAuthStore.getState().login(validCredentials);
      expect(useAuthStore.getState().getUserRole()).toBe('admin');
    });
  });

  // ── initAuth helper ───────────────────────────────────────────────────
  describe('initAuth helper', () => {
    it('sets user and isAuthenticated from localStorage on init', () => {
      mockAuthService.getCurrentUser.mockReturnValueOnce(mockUser);
      useAuthStore.getState().initAuth();
      expect(useAuthStore.getState().user).toEqual(mockUser);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });

    it('leaves state unchanged when no user in localStorage', () => {
      mockAuthService.getCurrentUser.mockReturnValueOnce(null);
      useAuthStore.getState().initAuth();
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });
});
