import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockHistoryReplace = vi.fn();
const mockHistoryPush = vi.fn();
const mockLogin = vi.fn();
const mockClearError = vi.fn();
const mockToast = vi.fn();

let mockLocationState: { from?: string } = {};
let mockAuthState = {
  login: mockLogin,
  isAuthenticated: false,
  error: null as string | null,
  clearError: mockClearError,
};

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ replace: mockHistoryReplace, push: mockHistoryPush }),
  useLocation: () => ({ state: mockLocationState }),
}));

vi.mock('../../src/store/authStore', () => ({
  useAuthStore: () => mockAuthState,
}));

vi.mock('@chakra-ui/react', () => ({
  Box: ({ children }: any) => <div>{children}</div>,
  Button: ({ children, onClick, type, isLoading, isDisabled }: any) => (
    <button type={type} onClick={onClick} disabled={isLoading || isDisabled}>
      {children}
    </button>
  ),
  FormControl: ({ children }: any) => <div>{children}</div>,
  FormLabel: ({ children }: any) => <label>{children}</label>,
  Input: ({ value, onChange, type, placeholder, ...rest }: any) => (
    <input value={value} onChange={onChange} type={type} placeholder={placeholder} {...rest} />
  ),
  VStack: ({ children, as, onSubmit }: any) => {
    const Tag: any = as || 'div';
    return <Tag onSubmit={onSubmit}>{children}</Tag>;
  },
  Heading: ({ children }: any) => <h1>{children}</h1>,
  Text: ({ children }: any) => <p>{children}</p>,
  useToast: () => mockToast,
  InputGroup: ({ children }: any) => <div>{children}</div>,
  InputRightElement: ({ children }: any) => <div>{children}</div>,
  IconButton: ({ onClick, 'aria-label': label }: any) => (
    <button onClick={onClick} aria-label={label}>{label}</button>
  ),
  FormErrorMessage: ({ children }: any) => <span>{children}</span>,
  Link: ({ children }: any) => <a>{children}</a>,
  Container: ({ children }: any) => <div>{children}</div>,
  Flex: ({ children }: any) => <div>{children}</div>,
  HStack: ({ children }: any) => <div>{children}</div>,
  Badge: ({ children }: any) => <span>{children}</span>,
  Icon: () => <span />,
}));

vi.mock('@chakra-ui/icons', () => ({
  ViewIcon: () => <span />,
  ViewOffIcon: () => <span />,
  LockIcon: () => <span />,
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import LoginPage from '../../src/pages/LoginPage';

// ─────────────────────────────────────────────────────────────────────────────

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocationState = {};
    mockAuthState = {
      login: mockLogin,
      isAuthenticated: false,
      error: null,
      clearError: mockClearError,
    };
  });

  // ── Rendering ──────────────────────────────────────────────────────────────
  describe('rendering', () => {
    it('renders without crashing', () => {
      expect(() => render(<LoginPage />)).not.toThrow();
    });

    it('renders email and password inputs', () => {
      render(<LoginPage />);
      const inputs = screen.getAllByPlaceholderText(/.+/);
      // At least 2 inputs (email + password)
      expect(inputs.length).toBeGreaterThanOrEqual(2);
    });

    it('renders the QuoteAI brand heading', () => {
      render(<LoginPage />);
      expect(screen.getByText(/QuoteAI/i)).toBeDefined();
    });
  });

  // ── Form Validation ────────────────────────────────────────────────────────
  describe('form validation', () => {
    it('shows warning toast when email and password are empty on submit', async () => {
      const { container } = render(<LoginPage />);
      const form = container.querySelector('form');
      expect(form).not.toBeNull();

      fireEvent.submit(form!);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Missing fields',
            status: 'warning',
          }),
        );
      });
      // login() must NOT have been called
      expect(mockLogin).not.toHaveBeenCalled();
    });

    it('shows warning toast when only email is provided', async () => {
      const { container } = render(<LoginPage />);
      const emailInput = container.querySelector('input[type="email"]') as HTMLInputElement;
      fireEvent.change(emailInput, { target: { value: 'user@example.com' } });

      const form = container.querySelector('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'warning' }),
        );
      });
      expect(mockLogin).not.toHaveBeenCalled();
    });
  });

  // ── Successful Login ───────────────────────────────────────────────────────
  describe('successful login', () => {
    it('calls login() with trimmed credentials when form is valid', async () => {
      mockLogin.mockResolvedValueOnce(undefined);
      const { container } = render(<LoginPage />);
      const emailInput = container.querySelector('input[type="email"]') as HTMLInputElement;
      const passwordInput = container.querySelector('input[type="password"]') as HTMLInputElement;

      fireEvent.change(emailInput, { target: { value: 'user@example.com' } });
      fireEvent.change(passwordInput, { target: { value: 'secret123' } });

      const form = container.querySelector('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(mockLogin).toHaveBeenCalledWith({
          email: 'user@example.com',
          password: 'secret123',
        });
      });
    });

    it('clears previous error before attempting login', async () => {
      mockLogin.mockResolvedValueOnce(undefined);
      const { container } = render(<LoginPage />);
      fireEvent.change(container.querySelector('input[type="email"]')!, {
        target: { value: 'a@b.com' },
      });
      fireEvent.change(container.querySelector('input[type="password"]')!, {
        target: { value: 'pw' },
      });
      fireEvent.submit(container.querySelector('form')!);

      await waitFor(() => {
        expect(mockClearError).toHaveBeenCalled();
      });
    });

    it('redirects to "/" by default after successful login', async () => {
      mockLogin.mockResolvedValueOnce(undefined);
      const { container } = render(<LoginPage />);
      fireEvent.change(container.querySelector('input[type="email"]')!, {
        target: { value: 'a@b.com' },
      });
      fireEvent.change(container.querySelector('input[type="password"]')!, {
        target: { value: 'pw' },
      });
      fireEvent.submit(container.querySelector('form')!);

      await waitFor(() => {
        expect(mockHistoryPush).toHaveBeenCalledWith('/');
      });
    });

    it('redirects to location.state.from when present (deep-link)', async () => {
      mockLogin.mockResolvedValueOnce(undefined);
      mockLocationState = { from: '/quote' };

      const { container } = render(<LoginPage />);
      fireEvent.change(container.querySelector('input[type="email"]')!, {
        target: { value: 'a@b.com' },
      });
      fireEvent.change(container.querySelector('input[type="password"]')!, {
        target: { value: 'pw' },
      });
      fireEvent.submit(container.querySelector('form')!);

      await waitFor(() => {
        expect(mockHistoryPush).toHaveBeenCalledWith('/quote');
      });
    });

    it('shows success toast after successful login', async () => {
      mockLogin.mockResolvedValueOnce(undefined);
      const { container } = render(<LoginPage />);
      fireEvent.change(container.querySelector('input[type="email"]')!, {
        target: { value: 'a@b.com' },
      });
      fireEvent.change(container.querySelector('input[type="password"]')!, {
        target: { value: 'pw' },
      });
      fireEvent.submit(container.querySelector('form')!);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Login successful',
            status: 'success',
          }),
        );
      });
    });
  });

  // ── Failed Login ───────────────────────────────────────────────────────────
  describe('failed login', () => {
    it('shows error toast with error message on login failure', async () => {
      mockLogin.mockRejectedValueOnce(new Error('Invalid email or password'));

      const { container } = render(<LoginPage />);
      fireEvent.change(container.querySelector('input[type="email"]')!, {
        target: { value: 'a@b.com' },
      });
      fireEvent.change(container.querySelector('input[type="password"]')!, {
        target: { value: 'wrong' },
      });
      fireEvent.submit(container.querySelector('form')!);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Login failed',
            description: 'Invalid email or password',
            status: 'error',
          }),
        );
      });
      expect(mockHistoryPush).not.toHaveBeenCalled();
    });

    it('shows fallback message when error has no message', async () => {
      mockLogin.mockRejectedValueOnce({});

      const { container } = render(<LoginPage />);
      fireEvent.change(container.querySelector('input[type="email"]')!, {
        target: { value: 'a@b.com' },
      });
      fireEvent.change(container.querySelector('input[type="password"]')!, {
        target: { value: 'pw' },
      });
      fireEvent.submit(container.querySelector('form')!);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Login failed',
            description: 'Invalid credentials',
            status: 'error',
          }),
        );
      });
    });
  });

  // ── Already-Authenticated Redirect ─────────────────────────────────────────
  describe('auto-redirect when already authenticated', () => {
    it('redirects to "/" on mount if user is already authenticated', () => {
      mockAuthState.isAuthenticated = true;
      render(<LoginPage />);
      expect(mockHistoryReplace).toHaveBeenCalledWith('/');
    });

    it('redirects to location.state.from when already authenticated', () => {
      mockAuthState.isAuthenticated = true;
      mockLocationState = { from: '/documents' };
      render(<LoginPage />);
      expect(mockHistoryReplace).toHaveBeenCalledWith('/documents');
    });
  });
});
