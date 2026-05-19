import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  afterEach(() => {
    // Restore any Storage.prototype spies so they don't leak between tests
    vi.restoreAllMocks();
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

    // Covers: email.trim() called before ilike query.
    // If someone removes trim(), ilike receives the raw spaced string and this test fails in CI.
    it('trims whitespace from email before querying Supabase', async () => {
      const chain = makeMockChain(mockUserRow);
      vi.mocked(supabase.from)
        .mockReturnValueOnce(chain as any)
        .mockReturnValueOnce(makeMockChain(mockRole) as any);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      await authService.login({ email: '  admin@baleenmedia.com  ', password: 'pw' });

      expect(chain.ilike).toHaveBeenCalledWith('email', 'admin@baleenmedia.com');
    });

    // Covers: Array.isArray(user.Role) === true branch.
    // The role query returns an array; the code must take user.Role[0].
    it('extracts first element when user.Role is an array', async () => {
      vi.mocked(supabase.from)
        .mockReturnValueOnce(makeMockChain(mockUserRow) as any)
        .mockReturnValueOnce(makeMockChain([mockRole]) as any);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      const user = await authService.login({ email: 'admin@baleenmedia.com', password: 'pw' });
      expect(user.role.role_name).toBe('Admin');
    });

    // Covers: typeof roleData.permissions !== 'string' branch.
    // When permissions is already a parsed object the code must use it directly, not JSON.parse it.
    it('uses permissions directly when they are already an object', async () => {
      const roleWithObjectPerms = { ...mockRole, permissions: { canEditQuotes: true } };
      vi.mocked(supabase.from)
        .mockReturnValueOnce(makeMockChain(mockUserRow) as any)
        .mockReturnValueOnce(makeMockChain(roleWithObjectPerms) as any);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      const user = await authService.login({ email: 'admin@baleenmedia.com', password: 'pw' });
      expect(user.role.permissions).toEqual({ canEditQuotes: true });
    });

    // Covers: catch(e) block inside permissions JSON.parse.
    // Malformed string causes SyntaxError; permissions must fall back to {}.
    it('falls back to empty permissions when permissions JSON is malformed', async () => {
      const roleWithBadPerms = { ...mockRole, permissions: '{ broken json {{{' };
      vi.mocked(supabase.from)
        .mockReturnValueOnce(makeMockChain(mockUserRow) as any)
        .mockReturnValueOnce(makeMockChain(roleWithBadPerms) as any);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      const user = await authService.login({ email: 'admin@baleenmedia.com', password: 'pw' });
      expect(user.role.permissions).toEqual({});
    });

    // Covers: if (roleData?.permissions) falsy branch.
    // Null permissions skips the parse block entirely; permissions stays {}.
    it('keeps empty permissions when roleData.permissions is null', async () => {
      const roleWithNullPerms = { ...mockRole, permissions: null };
      vi.mocked(supabase.from)
        .mockReturnValueOnce(makeMockChain(mockUserRow) as any)
        .mockReturnValueOnce(makeMockChain(roleWithNullPerms) as any);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      const user = await authService.login({ email: 'admin@baleenmedia.com', password: 'pw' });
      expect(user.role.permissions).toEqual({});
    });

    // Covers: roleData?.name || 'user' right-hand fallback.
    // When the role row has no name the returned role_name must be 'user'.
    it('falls back to "user" role name when role has no name field', async () => {
      const roleNoName = { ...mockRole, name: undefined };
      vi.mocked(supabase.from)
        .mockReturnValueOnce(makeMockChain(mockUserRow) as any)
        .mockReturnValueOnce(makeMockChain(roleNoName) as any);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      const user = await authService.login({ email: 'admin@baleenmedia.com', password: 'pw' });
      expect(user.role.role_name).toBe('user');
    });

    // Covers: bcrypt.compare() rejection propagation.
    // login() has no try/catch around bcrypt so the error propagates raw.
    it('propagates error when bcrypt.compare throws', async () => {
      vi.mocked(supabase.from)
        .mockReturnValueOnce(makeMockChain(mockUserRow) as any)
        .mockReturnValueOnce(makeMockChain(mockRole) as any);
      vi.mocked(bcrypt.compare).mockRejectedValue(new Error('bcrypt internal error') as never);

      await expect(
        authService.login({ email: 'admin@baleenmedia.com', password: 'pw' })
      ).rejects.toThrow('bcrypt internal error');
    });

    // Covers: unhandled Promise rejection from a network-level Supabase failure.
    // single() rejects entirely (no data/error shape), login() has no catch so it propagates.
    it('propagates error when Supabase query rejects at network level', async () => {
      vi.mocked(supabase.from).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockRejectedValue(new Error('Network error')),
      } as any);

      await expect(
        authService.login({ email: 'admin@baleenmedia.com', password: 'pw' })
      ).rejects.toThrow('Network error');
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

    // Covers: catch block in getCurrentUser via a storage-level throw.
    // Distinct from the corrupt-JSON path above — localStorage.getItem itself throws
    // (e.g. SecurityError in a cross-origin iframe or restricted browser context).
    it('returns null when localStorage.getItem throws in getCurrentUser', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('Access denied', 'SecurityError');
      });
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

    // Covers: saveUser has NO try/catch — a setItem failure propagates raw.
    // This test documents the contract: callers must handle storage errors themselves.
    it('propagates error when localStorage.setItem throws in saveUser', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      const user = { id: '1', email: 'a@b.com', full_name: 'User', role: { role_name: 'admin', permissions: {} } };
      expect(() => authService.saveUser(user)).toThrow('QuotaExceededError');
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

    // Covers: permissions[key] === undefined (key absent from object).
    // Distinct from key-present-but-false: undefined === true is false,
    // ensuring the guard passes but the comparison returns false.
    it('returns false when permission key does not exist in permissions object', () => {
      localStorage.setItem('currentUser', JSON.stringify({
        id: '1', email: 'a@b.com', full_name: 'User',
        role: { role_name: 'user', permissions: { canEditQuotes: true } },
      }));
      expect(authService.hasPermission('canDeleteQuotes')).toBe(false);
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
