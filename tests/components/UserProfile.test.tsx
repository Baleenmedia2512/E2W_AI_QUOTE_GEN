import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockHistoryPush = vi.fn();
const mockLogout = vi.fn();
const mockToast = vi.fn();

let mockAuthState = {
  user: null as any,
  logout: mockLogout,
  isAuthenticated: false,
};

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ push: mockHistoryPush }),
}));

vi.mock('../../src/store/authStore', () => ({
  useAuthStore: () => mockAuthState,
}));

vi.mock('@chakra-ui/react', () => ({
  Box: ({ children }: any) => <div>{children}</div>,
  Button: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
  Menu: ({ children }: any) => <div>{children}</div>,
  MenuButton: ({ children }: any) => <div>{children}</div>,
  MenuList: ({ children }: any) => <div>{children}</div>,
  MenuItem: ({ children, onClick }: any) => (
    <div role="menuitem" onClick={onClick}>{children}</div>
  ),
  MenuDivider: () => <hr />,
  Avatar: ({ name }: any) => <span data-testid="avatar">{name}</span>,
  Text: ({ children }: any) => <span>{children}</span>,
  HStack: ({ children }: any) => <div>{children}</div>,
  VStack: ({ children }: any) => <div>{children}</div>,
  Badge: ({ children, colorScheme }: any) => (
    <span data-color-scheme={colorScheme}>{children}</span>
  ),
  useToast: () => mockToast,
}));

vi.mock('@chakra-ui/icons', () => ({
  ChevronDownIcon: () => <span />,
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import { UserProfile } from '../../src/components/UserProfile/UserProfile';

// ─────────────────────────────────────────────────────────────────────────────

describe('UserProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState = { user: null, logout: mockLogout, isAuthenticated: false };
  });

  // ── Unauthenticated state ──────────────────────────────────────────────────
  describe('when not authenticated', () => {
    it('renders a "Login" button', () => {
      render(<UserProfile />);
      expect(screen.getByText('Login')).toBeDefined();
    });

    it('navigates to /login when the Login button is clicked', () => {
      render(<UserProfile />);
      fireEvent.click(screen.getByText('Login'));
      expect(mockHistoryPush).toHaveBeenCalledWith('/login');
    });

    it('renders a Login button when authenticated flag is true but user is null', () => {
      mockAuthState = { user: null, logout: mockLogout, isAuthenticated: true };
      render(<UserProfile />);
      expect(screen.getByText('Login')).toBeDefined();
    });
  });

  // ── Authenticated state ────────────────────────────────────────────────────
  describe('when authenticated', () => {
    beforeEach(() => {
      mockAuthState = {
        user: {
          id: 'u1',
          email: 'admin@example.com',
          full_name: 'Admin User',
          role: { role_name: 'admin', permissions: {} },
        },
        logout: mockLogout,
        isAuthenticated: true,
      };
    });

    it('renders the user avatar with full name', () => {
      render(<UserProfile />);
      const avatars = screen.getAllByTestId('avatar');
      expect(avatars.length).toBeGreaterThan(0);
      expect(avatars[0].textContent).toBe('Admin User');
    });

    it('renders the user email in the menu', () => {
      render(<UserProfile />);
      expect(screen.getByText('admin@example.com')).toBeDefined();
    });

    it('renders the role badge', () => {
      render(<UserProfile />);
      const roleBadges = screen.getAllByText('admin');
      expect(roleBadges.length).toBeGreaterThan(0);
    });

    it('renders the Logout menu item', () => {
      render(<UserProfile />);
      expect(screen.getByText('Logout')).toBeDefined();
    });

    it('triggers logout → toast → push("/login") when Logout is clicked', () => {
      render(<UserProfile />);
      fireEvent.click(screen.getByText('Logout'));

      expect(mockLogout).toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Logged out successfully',
          status: 'success',
        }),
      );
      expect(mockHistoryPush).toHaveBeenCalledWith('/login');
    });

    it('uses role color "red" for admin', () => {
      render(<UserProfile />);
      const badges = screen.getAllByText('admin');
      // At least one rendered badge should carry the admin color
      const hasRed = badges.some((el) => el.getAttribute('data-color-scheme') === 'red');
      expect(hasRed).toBe(true);
    });

    it('uses role color "purple" for manager', () => {
      mockAuthState = {
        ...mockAuthState,
        user: { ...mockAuthState.user, role: { role_name: 'manager', permissions: {} } },
      };
      render(<UserProfile />);
      const badges = screen.getAllByText('manager');
      expect(badges.some((el) => el.getAttribute('data-color-scheme') === 'purple')).toBe(true);
    });

    it('uses role color "blue" for sales', () => {
      mockAuthState = {
        ...mockAuthState,
        user: { ...mockAuthState.user, role: { role_name: 'sales', permissions: {} } },
      };
      render(<UserProfile />);
      const badges = screen.getAllByText('sales');
      expect(badges.some((el) => el.getAttribute('data-color-scheme') === 'blue')).toBe(true);
    });

    it('uses role color "green" for viewer', () => {
      mockAuthState = {
        ...mockAuthState,
        user: { ...mockAuthState.user, role: { role_name: 'viewer', permissions: {} } },
      };
      render(<UserProfile />);
      const badges = screen.getAllByText('viewer');
      expect(badges.some((el) => el.getAttribute('data-color-scheme') === 'green')).toBe(true);
    });

    it('falls back to "gray" for unknown role names', () => {
      mockAuthState = {
        ...mockAuthState,
        user: { ...mockAuthState.user, role: { role_name: 'unknown_role', permissions: {} } },
      };
      render(<UserProfile />);
      const badges = screen.getAllByText('unknown_role');
      expect(badges.some((el) => el.getAttribute('data-color-scheme') === 'gray')).toBe(true);
    });

    it('handles role name case-insensitively (ADMIN → red)', () => {
      mockAuthState = {
        ...mockAuthState,
        user: { ...mockAuthState.user, role: { role_name: 'ADMIN', permissions: {} } },
      };
      render(<UserProfile />);
      const badges = screen.getAllByText('ADMIN');
      expect(badges.some((el) => el.getAttribute('data-color-scheme') === 'red')).toBe(true);
    });
  });
});
