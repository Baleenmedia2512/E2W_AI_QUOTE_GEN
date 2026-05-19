import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { Header } from '../../src/components/Header/Header';

// Mock Chakra UI with minimal stubs
vi.mock('@chakra-ui/react', () => ({
  Box: ({ children }: any) => <div>{children}</div>,
  Container: ({ children }: any) => <div>{children}</div>,
  HStack: ({ children }: any) => <div>{children}</div>,
  Heading: ({ children, size, color }: any) => <h1 data-testid="heading" data-color={color}>{children}</h1>,
  Spacer: () => <div />,
}));

// Mock UserProfile
vi.mock('../../src/components/UserProfile', () => ({
  UserProfile: () => <div data-testid="user-profile">User Profile</div>,
}));

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Quote Buddy branding', () => {
    render(<Header />);
    expect(screen.getByText('Quote Buddy')).toBeDefined();
  });

  it('renders a heading element', () => {
    render(<Header />);
    expect(screen.getByTestId('heading')).toBeDefined();
  });

  it('renders the UserProfile component', () => {
    render(<Header />);
    expect(screen.getByTestId('user-profile')).toBeDefined();
  });

  it('heading text is "Quote Buddy"', () => {
    render(<Header />);
    const heading = screen.getByTestId('heading');
    expect(heading.textContent).toBe('Quote Buddy');
  });
});
