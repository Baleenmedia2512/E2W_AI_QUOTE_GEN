import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockHistoryGoBack = vi.fn();
const mockHistoryPush = vi.fn();
const mockLogout = vi.fn();

let mockUser: any = null;

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ goBack: mockHistoryGoBack, push: mockHistoryPush }),
}));

vi.mock('../../src/store/authStore', () => ({
  useAuthStore: () => ({ user: mockUser, logout: mockLogout }),
}));

vi.mock('@chakra-ui/react', () => ({
  Box: ({ children }: any) => <div>{children}</div>,
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
  Container: ({ children }: any) => <div>{children}</div>,
  Heading: ({ children }: any) => <h1>{children}</h1>,
  Text: ({ children }: any) => <p>{children}</p>,
  VStack: ({ children }: any) => <div>{children}</div>,
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import UnauthorizedPage from '../../src/pages/UnauthorizedPage';

// ─────────────────────────────────────────────────────────────────────────────

describe('UnauthorizedPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = null;
  });

  describe('rendering', () => {
    it('renders without crashing', () => {
      expect(() => render(<UnauthorizedPage />)).not.toThrow();
    });

    it('renders "Access Denied" heading', () => {
      render(<UnauthorizedPage />);
      expect(screen.getByText('Access Denied')).toBeDefined();
    });

    it('renders permission-denied explanation message', () => {
      render(<UnauthorizedPage />);
      expect(screen.getByText(/don't have permission/i)).toBeDefined();
    });

    it('renders the three action buttons (Home, Back, Logout)', () => {
      render(<UnauthorizedPage />);
      expect(screen.getByText(/Go to Home/i)).toBeDefined();
      expect(screen.getByText(/Go Back/i)).toBeDefined();
      expect(screen.getByText(/Logout/i)).toBeDefined();
    });

    it('renders contact-administrator hint', () => {
      render(<UnauthorizedPage />);
      expect(screen.getByText(/contact your administrator/i)).toBeDefined();
    });
  });

  describe('current role display', () => {
    it('does NOT render role text when user is null', () => {
      mockUser = null;
      render(<UnauthorizedPage />);
      expect(screen.queryByText(/Current role/i)).toBeNull();
    });

    it('renders current role name when user is present', () => {
      mockUser = { id: '1', email: 'a@b.com', full_name: 'A B', role: { role_name: 'viewer', permissions: {} } };
      render(<UnauthorizedPage />);
      expect(screen.getByText(/Current role/i)).toBeDefined();
      expect(screen.getByText('viewer')).toBeDefined();
    });
  });

  describe('navigation actions', () => {
    it('calls history.push("/") when "Go to Home" is clicked', () => {
      render(<UnauthorizedPage />);
      fireEvent.click(screen.getByText(/Go to Home/i));
      expect(mockHistoryPush).toHaveBeenCalledWith('/');
    });

    it('calls history.goBack() when "Go Back" is clicked', () => {
      render(<UnauthorizedPage />);
      fireEvent.click(screen.getByText(/Go Back/i));
      expect(mockHistoryGoBack).toHaveBeenCalled();
    });

    it('calls logout() then redirects to /login when "Logout" is clicked', () => {
      render(<UnauthorizedPage />);
      fireEvent.click(screen.getByText(/Logout/i));
      expect(mockLogout).toHaveBeenCalled();
      expect(mockHistoryPush).toHaveBeenCalledWith('/login');
    });
  });
});
