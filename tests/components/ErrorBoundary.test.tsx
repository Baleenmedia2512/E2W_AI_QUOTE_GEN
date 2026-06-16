import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ErrorBoundary } from '../../src/components/ErrorBoundary/ErrorBoundary';

// Mock logger to prevent noise in test output
vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  __internal: {
    isProd: false,
    envLevel: 'debug',
    redactString: (s: string) => s,
  },
}));

// Helper: suppress React error boundary console.error in test output
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

// Component that throws on render
const ThrowingComponent = ({ shouldThrow = true }: { shouldThrow?: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test explosion!');
  }
  return <div>Normal content</div>;
};

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy.mockImplementation(() => {}); // keep tests clean
  });

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <div>Safe Content</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('Safe Content')).toBeDefined();
  });

  it('renders fallback when child throws (custom fallback prop)', () => {
    render(
      <ErrorBoundary fallback={<div>Custom Fallback UI</div>}>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText('Custom Fallback UI')).toBeDefined();
    expect(screen.queryByText('Normal content')).toBeNull();
  });

  it('renders built-in error UI when no fallback prop is given', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    // The built-in error UI has a Try Again button
    expect(
      screen.queryByText(/Something went wrong/i) ||
      screen.queryByText(/Try Again/i) ||
      screen.queryByText(/Reload/i)
    ).not.toBeNull();
  });

  it('calls logger.error when a child throws', async () => {
    const { logger } = await import('../../src/utils/logger');

    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(logger.error).toHaveBeenCalled();
  });

  it('does NOT display error UI when children render normally', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Normal content')).toBeDefined();
    expect(screen.queryByText(/Try Again/i)).toBeNull();
  });

  it('can wrap multiple children', () => {
    render(
      <ErrorBoundary>
        <div>Child A</div>
        <div>Child B</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('Child A')).toBeDefined();
    expect(screen.getByText('Child B')).toBeDefined();
  });
});
