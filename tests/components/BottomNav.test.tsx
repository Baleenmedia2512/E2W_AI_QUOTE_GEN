import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// ── Mocks ─────────────────────────────────────────────────────────────────────
const mockHistoryPush = vi.fn();
let mockPathname = '/';

vi.mock('react-router-dom', () => ({
  useHistory: () => ({ push: mockHistoryPush }),
  useLocation: () => ({ pathname: mockPathname }),
}));

vi.mock('@chakra-ui/react', () => ({
  Box: ({ children }: any) => <div>{children}</div>,
  HStack: ({ children }: any) => <div>{children}</div>,
  VStack: ({ children, onClick, 'aria-label': label, role }: any) => (
    <div role={role} aria-label={label} onClick={onClick}>{children}</div>
  ),
  Text: ({ children }: any) => <span>{children}</span>,
  Icon: () => <span />,
}));

vi.mock('react-icons/fi', () => ({
  FiHome: () => <span />,
  FiFolder: () => <span />,
  FiFileText: () => <span />,
  FiEye: () => <span />,
}));

vi.mock('../../src/components/BottomNav/BottomNav.css', () => ({}), { virtual: true } as any);

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import BottomNav from '../../src/components/BottomNav/BottomNav';

// ─────────────────────────────────────────────────────────────────────────────

describe('BottomNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = '/';
  });

  describe('rendering', () => {
    it('renders without crashing', () => {
      expect(() => render(<BottomNav />)).not.toThrow();
    });

    it('renders all 4 nav items with aria-labels', () => {
      render(<BottomNav />);
      expect(screen.getByRole('button', { name: 'Home' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Docs' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Quote' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Preview' })).toBeDefined();
    });

    it('renders nav labels as text', () => {
      render(<BottomNav />);
      expect(screen.getByText('Home')).toBeDefined();
      expect(screen.getByText('Docs')).toBeDefined();
      expect(screen.getByText('Quote')).toBeDefined();
      expect(screen.getByText('Preview')).toBeDefined();
    });
  });

  describe('navigation', () => {
    it('calls history.push("/") when Home is clicked', () => {
      render(<BottomNav />);
      fireEvent.click(screen.getByRole('button', { name: 'Home' }));
      expect(mockHistoryPush).toHaveBeenCalledWith('/');
    });

    it('calls history.push("/documents") when Docs is clicked', () => {
      render(<BottomNav />);
      fireEvent.click(screen.getByRole('button', { name: 'Docs' }));
      expect(mockHistoryPush).toHaveBeenCalledWith('/documents');
    });

    it('calls history.push("/quote") when Quote is clicked', () => {
      render(<BottomNav />);
      fireEvent.click(screen.getByRole('button', { name: 'Quote' }));
      expect(mockHistoryPush).toHaveBeenCalledWith('/quote');
    });

    it('calls history.push("/preview") when Preview is clicked', () => {
      render(<BottomNav />);
      fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
      expect(mockHistoryPush).toHaveBeenCalledWith('/preview');
    });
  });

  describe('active state (location-based)', () => {
    it('does not crash when current path matches a nav item', () => {
      mockPathname = '/quote';
      expect(() => render(<BottomNav />)).not.toThrow();
      expect(screen.getByRole('button', { name: 'Quote' })).toBeDefined();
    });

    it('does not crash when current path matches no nav item', () => {
      mockPathname = '/unknown-route';
      expect(() => render(<BottomNav />)).not.toThrow();
    });
  });
});
