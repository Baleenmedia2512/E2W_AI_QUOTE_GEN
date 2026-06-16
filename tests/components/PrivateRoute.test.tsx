import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { PrivateRoute } from '../../src/components/PrivateRoute/PrivateRoute';
import { useAuthStore } from '../../src/store/authStore';

// Mock authStore
vi.mock('../../src/store/authStore', () => ({
  useAuthStore: vi.fn(),
}));

// Helper: build mock auth state
function mockAuth(overrides: {
  isAuthenticated?: boolean;
  hasRole?: (role: string) => boolean;
  hasPermission?: (perm: string) => boolean;
} = {}) {
  vi.mocked(useAuthStore).mockReturnValue({
    isAuthenticated: overrides.isAuthenticated ?? true,
    hasRole: overrides.hasRole ?? (() => true),
    hasPermission: overrides.hasPermission ?? (() => true),
  } as any);
}

// Simple test component
const ProtectedPage = () => <div>Protected Content</div>;

describe('PrivateRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the protected component when user is authenticated', () => {
    mockAuth({ isAuthenticated: true });

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <PrivateRoute path="/protected" component={ProtectedPage} />
      </MemoryRouter>
    );

    expect(screen.getByText('Protected Content')).toBeDefined();
  });

  it('redirects to /login when user is not authenticated', () => {
    mockAuth({ isAuthenticated: false });

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <PrivateRoute path="/protected" component={ProtectedPage} />
      </MemoryRouter>
    );

    expect(screen.queryByText('Protected Content')).toBeNull();
  });

  it('renders component when required role is matched', () => {
    mockAuth({
      isAuthenticated: true,
      hasRole: (role) => role === 'admin',
    });

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <PrivateRoute path="/admin" component={ProtectedPage} requiredRole="admin" />
      </MemoryRouter>
    );

    expect(screen.getByText('Protected Content')).toBeDefined();
  });

  it('redirects to /unauthorized when required role is NOT matched', () => {
    mockAuth({
      isAuthenticated: true,
      hasRole: () => false,
    });

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <PrivateRoute path="/admin" component={ProtectedPage} requiredRole="admin" />
      </MemoryRouter>
    );

    expect(screen.queryByText('Protected Content')).toBeNull();
  });

  it('renders component when required permission is matched', () => {
    mockAuth({
      isAuthenticated: true,
      hasPermission: (perm) => perm === 'view_quotes',
    });

    render(
      <MemoryRouter initialEntries={['/quotes']}>
        <PrivateRoute path="/quotes" component={ProtectedPage} requiredPermission="view_quotes" />
      </MemoryRouter>
    );

    expect(screen.getByText('Protected Content')).toBeDefined();
  });

  it('redirects to /unauthorized when required permission is NOT matched', () => {
    mockAuth({
      isAuthenticated: true,
      hasPermission: () => false,
    });

    render(
      <MemoryRouter initialEntries={['/quotes']}>
        <PrivateRoute path="/quotes" component={ProtectedPage} requiredPermission="view_quotes" />
      </MemoryRouter>
    );

    expect(screen.queryByText('Protected Content')).toBeNull();
  });

  it('renders component when no role or permission requirement is specified', () => {
    mockAuth({ isAuthenticated: true });

    render(
      <MemoryRouter initialEntries={['/open']}>
        <PrivateRoute path="/open" component={ProtectedPage} />
      </MemoryRouter>
    );

    expect(screen.getByText('Protected Content')).toBeDefined();
  });
});
