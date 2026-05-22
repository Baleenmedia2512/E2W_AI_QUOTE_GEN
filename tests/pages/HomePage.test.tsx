import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockHistoryPush = vi.fn();

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ push: mockHistoryPush }),
}));

vi.mock('../../src/components/ChatInterface/ChatInterface', () => ({
  default: () => <div data-testid="chat-interface">ChatInterface</div>,
}));

vi.mock('../../src/components/UserProfile', () => ({
  UserProfile: () => <div data-testid="user-profile">UserProfile</div>,
}));

vi.mock('@chakra-ui/react', () => ({
  Box: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>,
  Flex: ({ children }: any) => <div>{children}</div>,
  Heading: ({ children }: any) => <h1>{children}</h1>,
  HStack: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>,
  Text: ({ children }: any) => <p>{children}</p>,
  Icon: () => <span />,
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('react-icons/fi', () => ({
  FiHome: () => <span />,
  FiFileText: () => <span />,
  FiEye: () => <span />,
  FiMessageSquare: () => <span />,
  FiFolder: () => <span />,
}));

// __APP_VERSION__ is injected by Vite — stub it for the test environment
(globalThis as any).__APP_VERSION__ = '1.0.0-test';

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import HomePage from '../../src/pages/HomePage';

// ─────────────────────────────────────────────────────────────────────────────

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    expect(() => render(<HomePage />)).not.toThrow();
  });

  it('renders the "Quote Buddy" brand', () => {
    render(<HomePage />);
    // Brand appears in mobile + desktop headers
    const matches = screen.getAllByText(/Quote Buddy/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('renders the ChatInterface component', () => {
    render(<HomePage />);
    expect(screen.getByTestId('chat-interface')).toBeDefined();
  });

  it('renders the UserProfile component', () => {
    render(<HomePage />);
    expect(screen.getAllByTestId('user-profile').length).toBeGreaterThan(0);
  });

  it('renders all 4 nav items: Home, Docs, Quote, Preview', () => {
    render(<HomePage />);
    expect(screen.getByText('Home')).toBeDefined();
    expect(screen.getByText('Docs')).toBeDefined();
    expect(screen.getByText('Quote')).toBeDefined();
    expect(screen.getByText('Preview')).toBeDefined();
  });

  it('navigates to /documents when Docs is clicked', () => {
    render(<HomePage />);
    fireEvent.click(screen.getByText('Docs'));
    expect(mockHistoryPush).toHaveBeenCalledWith('/documents');
  });

  it('navigates to /quote when Quote is clicked', () => {
    render(<HomePage />);
    fireEvent.click(screen.getByText('Quote'));
    expect(mockHistoryPush).toHaveBeenCalledWith('/quote');
  });

  it('navigates to /preview when Preview is clicked', () => {
    render(<HomePage />);
    fireEvent.click(screen.getByText('Preview'));
    expect(mockHistoryPush).toHaveBeenCalledWith('/preview');
  });

  it('displays the app version badge', () => {
    render(<HomePage />);
    expect(screen.getAllByText(/v1\.0\.0-test/).length).toBeGreaterThan(0);
  });
});
