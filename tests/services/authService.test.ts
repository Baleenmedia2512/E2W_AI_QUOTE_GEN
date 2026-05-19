import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authService } from '../../src/services/authService';

// Mock supabase
vi.mock('../../src/services/supabaseClient', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

// Mock bcrypt
vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
  },
}));

import { supabase } from '../../src/services/supabaseClient';
import bcrypt from 'bcryptjs';

const mockUserRow = {
  id: 'db-user-001',
  email: 'admin@baleenmedia.com',
  name: 'Admin User',
  password: '$2b$10$hashedpassword',
  isActive: true,
  roleId: 'role-001',
  Role: { id: 'role-001', name: 'Admin', permissions: JSON.stringify({ canEditQuotes: true }) },
};

const mockRole = {
  id: 'role-001',
  name: 'Admin',
  permissions: JSON.stringify({ canEditQuotes: true, canDeleteQuotes: false }),
};

function makeMockChain(data: any, error: any = null) {
  return {
    select: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
  };
}

describe('authService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  // ─────────────────────────────────────────────
  // login
  // ─────────────────────────────────────────────
  describe('login', () => {
    it('returns AuthUser on successful login', async () => {
      vi.mocked(supabase.from)
        .mockReturnValueOnce(makeMockChain(mockUserRow) as any)
        .mockReturnValueOnce(makeMockChain(mockRole) as any);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      const user = await authService.login({
        email: 'admin@baleenmedia.com',
        password: 'correctPassword',
      });

      expect(user.email).toBe('admin@baleenmedia.com');
      expect(user.full_name).toBe('Admin User');
      expect(user.role.role_name).toBe('Admin');
    });

    it('throws on wrong password', async () => {
      vi.mocked(supabase.from)
        .mockReturnValueOnce(makeMockChain(mockUserRow) as any)
        .mockReturnValueOnce(makeMockChain(mockRole) as any);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      await expect(
        authService.login({ email: 'admin@baleenmedia.com', password: 'wrongPassword' })
      ).rejects.toThrow('Invalid email or password');
    });

    it('throws when user is not found', async () => {
      vi.mocked(supabase.from).mockReturnValueOnce(
        makeMockChain(null, { message: 'No rows found' }) as any
      );

      await expect(
        authService.login({ email: 'noone@example.com', password: 'pw' })
      ).rejects.toThrow('Invalid email or password');
    });

    it('throws when account is inactive', async () => {
      const inactiveUser = { ...mockUserRow, isActive: false };
      vi.mocked(supabase.from)
        .mockReturnValueOnce(makeMockChain(inactiveUser) as any)
        .mockReturnValueOnce(makeMockChain(mockRole) as any);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      await expect(
        authService.login({ email: 'admin@baleenmedia.com', password: 'pw' })
      ).rejects.toThrow('deactivated');
    });

    it('throws when role cannot be fetched', async () => {
      vi.mocked(supabase.from)
        .mockReturnValueOnce(makeMockChain(mockUserRow) as any)
        .mockReturnValueOnce(makeMockChain(null, { message: 'Role not found' }) as any);

      await expect(
        authService.login({ email: 'admin@baleenmedia.com', password: 'pw' })
      ).rejects.toThrow('Unable to fetch user role');
    });
  });

  // ─────────────────────────────────────────────
  // logout
  // ─────────────────────────────────────────────
  describe('logout', () => {
    it('removes currentUser and authToken from localStorage', () => {
      localStorage.setItem('currentUser', '{"id":"1"}');
      localStorage.setItem('authToken', 'token123');

      authService.logout();

      expect(localStorage.getItem('currentUser')).toBeNull();
      expect(localStorage.getItem('authToken')).toBeNull();
    });
  });

  // ─────────────────────────────────────────────
  // getCurrentUser
  // ─────────────────────────────────────────────
  describe('getCurrentUser', () => {
    it('returns AuthUser from localStorage when present', () => {
      const stored = { id: '1', email: 'a@b.com', full_name: 'User', role: { role_name: 'user', permissions: {} } };
      localStorage.setItem('currentUser', JSON.stringify(stored));
      expect(authService.getCurrentUser()).toEqual(stored);
    });

    it('returns null when localStorage is empty', () => {
      expect(authService.getCurrentUser()).toBeNull();
    });

    it('returns null when stored value is corrupted JSON', () => {
      localStorage.setItem('currentUser', '{{broken');
      expect(authService.getCurrentUser()).toBeNull();
    });
  });

  // ─────────────────────────────────────────────
  // saveUser
  // ─────────────────────────────────────────────
  describe('saveUser', () => {
    it('saves user to localStorage', () => {
      const user = { id: '1', email: 'a@b.com', full_name: 'User', role: { role_name: 'admin', permissions: {} } };
      authService.saveUser(user);
      expect(JSON.parse(localStorage.getItem('currentUser')!)).toEqual(user);
    });
  });

  // ─────────────────────────────────────────────
  // isAuthenticated
  // ─────────────────────────────────────────────
  describe('isAuthenticated', () => {
    it('returns true when user is in localStorage', () => {
      localStorage.setItem('currentUser', JSON.stringify({ id: '1', email: 'a@b.com', full_name: 'U', role: { role_name: 'user', permissions: {} } }));
      expect(authService.isAuthenticated()).toBe(true);
    });

    it('returns false when localStorage is empty', () => {
      expect(authService.isAuthenticated()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // hasPermission
  // ─────────────────────────────────────────────
  describe('hasPermission', () => {
    it('returns true for a granted permission', () => {
      localStorage.setItem('currentUser', JSON.stringify({
        id: '1', email: 'a@b.com', full_name: 'Admin',
        role: { role_name: 'Admin', permissions: { canEditQuotes: true } },
      }));
      expect(authService.hasPermission('canEditQuotes')).toBe(true);
    });

    it('returns false for a denied permission', () => {
      localStorage.setItem('currentUser', JSON.stringify({
        id: '1', email: 'a@b.com', full_name: 'User',
        role: { role_name: 'user', permissions: { canEditQuotes: false } },
      }));
      expect(authService.hasPermission('canEditQuotes')).toBe(false);
    });

    it('returns false when user has no permissions object', () => {
      expect(authService.hasPermission('canEditQuotes')).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // hasRole / getUserRole
  // ─────────────────────────────────────────────
  describe('hasRole', () => {
    it('returns true for matching role (case-insensitive)', () => {
      localStorage.setItem('currentUser', JSON.stringify({
        id: '1', email: 'a@b.com', full_name: 'Admin',
        role: { role_name: 'Admin', permissions: {} },
      }));
      expect(authService.hasRole('admin')).toBe(true);
      expect(authService.hasRole('ADMIN')).toBe(true);
    });

    it('returns false for non-matching role', () => {
      localStorage.setItem('currentUser', JSON.stringify({
        id: '1', email: 'a@b.com', full_name: 'User',
        role: { role_name: 'user', permissions: {} },
      }));
      expect(authService.hasRole('admin')).toBe(false);
    });

    it('returns false when no user', () => {
      expect(authService.hasRole('admin')).toBe(false);
    });
  });

  describe('getUserRole', () => {
    it('returns role name when user is logged in', () => {
      localStorage.setItem('currentUser', JSON.stringify({
        id: '1', email: 'a@b.com', full_name: 'Admin',
        role: { role_name: 'Admin', permissions: {} },
      }));
      expect(authService.getUserRole()).toBe('Admin');
    });

    it('returns null when not logged in', () => {
      expect(authService.getUserRole()).toBeNull();
    });
  });
});
