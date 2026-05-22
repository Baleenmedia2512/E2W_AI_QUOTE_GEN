import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authService } from '../../src/services/authService';
import { AuthUser } from '../../src/types/auth';

// Silence logger noise
vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/services/supabaseClient', () => ({
  supabase: { from: vi.fn() },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const makeUser = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  id: 'user-1',
  email: 'user@example.com',
  full_name: 'Test User',
  role: {
    role_name: 'admin',
    permissions: {
      create_quotes: true,
      edit_quotes: true,
      delete_quotes: false,
    },
  },
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('authService — permission/role helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ── isAuthenticated ────────────────────────────────────────────────────────
  describe('isAuthenticated', () => {
    it('returns false when no user is stored in localStorage', () => {
      expect(authService.isAuthenticated()).toBe(false);
    });

    it('returns true when a valid user is stored in localStorage', () => {
      authService.saveUser(makeUser());
      expect(authService.isAuthenticated()).toBe(true);
    });

    it('returns false after logout clears storage', () => {
      authService.saveUser(makeUser());
      authService.logout();
      expect(authService.isAuthenticated()).toBe(false);
    });

    it('returns false when localStorage contains corrupt JSON', () => {
      localStorage.setItem('currentUser', '{not valid json');
      expect(authService.isAuthenticated()).toBe(false);
    });
  });

  // ── hasPermission ──────────────────────────────────────────────────────────
  describe('hasPermission', () => {
    it('returns false when no user is logged in', () => {
      expect(authService.hasPermission('create_quotes')).toBe(false);
    });

    it('returns true for a permission set to true', () => {
      authService.saveUser(makeUser());
      expect(authService.hasPermission('create_quotes')).toBe(true);
      expect(authService.hasPermission('edit_quotes')).toBe(true);
    });

    it('returns false for a permission explicitly set to false', () => {
      authService.saveUser(makeUser());
      expect(authService.hasPermission('delete_quotes')).toBe(false);
    });

    it('returns false for a permission not present in the map', () => {
      authService.saveUser(makeUser());
      expect(authService.hasPermission('manage_users')).toBe(false);
    });

    it('returns false when user has no role object', () => {
      const malformed = { id: '1', email: 'x@y.com', full_name: 'X', role: undefined } as any;
      localStorage.setItem('currentUser', JSON.stringify(malformed));
      expect(authService.hasPermission('create_quotes')).toBe(false);
    });

    it('returns false when role has no permissions map', () => {
      const noPerms = makeUser({ role: { role_name: 'guest', permissions: undefined as any } });
      authService.saveUser(noPerms);
      expect(authService.hasPermission('any')).toBe(false);
    });

    it('does NOT return true for truthy non-boolean values (strict === true)', () => {
      const user = makeUser({
        role: {
          role_name: 'admin',
          permissions: { create_quotes: 'yes' as any },
        },
      });
      authService.saveUser(user);
      expect(authService.hasPermission('create_quotes')).toBe(false);
    });
  });

  // ── hasRole ────────────────────────────────────────────────────────────────
  describe('hasRole', () => {
    it('returns false when no user is logged in', () => {
      expect(authService.hasRole('admin')).toBe(false);
    });

    it('returns true when role matches exactly (lowercase)', () => {
      authService.saveUser(makeUser({ role: { role_name: 'admin', permissions: {} } }));
      expect(authService.hasRole('admin')).toBe(true);
    });

    it('is case-insensitive', () => {
      authService.saveUser(makeUser({ role: { role_name: 'Admin', permissions: {} } }));
      expect(authService.hasRole('admin')).toBe(true);
      expect(authService.hasRole('ADMIN')).toBe(true);
      expect(authService.hasRole('AdMiN')).toBe(true);
    });

    it('returns false when role does not match', () => {
      authService.saveUser(makeUser({ role: { role_name: 'viewer', permissions: {} } }));
      expect(authService.hasRole('admin')).toBe(false);
    });

    it('returns false when user has no role', () => {
      const malformed = { id: '1', email: 'x@y.com', full_name: 'X' } as any;
      localStorage.setItem('currentUser', JSON.stringify(malformed));
      expect(authService.hasRole('admin')).toBe(false);
    });
  });

  // ── getUserRole ────────────────────────────────────────────────────────────
  describe('getUserRole', () => {
    it('returns null when no user is logged in', () => {
      expect(authService.getUserRole()).toBeNull();
    });

    it('returns the role_name of the logged-in user', () => {
      authService.saveUser(makeUser({ role: { role_name: 'manager', permissions: {} } }));
      expect(authService.getUserRole()).toBe('manager');
    });

    it('returns null when user has no role object', () => {
      const malformed = { id: '1', email: 'x@y.com', full_name: 'X' } as any;
      localStorage.setItem('currentUser', JSON.stringify(malformed));
      expect(authService.getUserRole()).toBeNull();
    });

    it('preserves original case of the role name', () => {
      authService.saveUser(makeUser({ role: { role_name: 'Sales', permissions: {} } }));
      expect(authService.getUserRole()).toBe('Sales');
    });
  });
});
