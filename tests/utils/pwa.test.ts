import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Logger mock ────────────────────────────────────────────────────────────
vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerServiceWorker } from '../../src/utils/pwa';
import { logger } from '../../src/utils/logger';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a fake ServiceWorkerRegistration-like object. */
function makeFakeRegistration(): ServiceWorkerRegistration {
  return { scope: '/', active: null } as unknown as ServiceWorkerRegistration;
}

/**
 * Patch navigator.serviceWorker to a custom value for one test.
 * Returns a restore function to be called in afterEach.
 */
function patchServiceWorker(value: unknown): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
  Object.defineProperty(navigator, 'serviceWorker', {
    value,
    writable: true,
    configurable: true,
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(navigator, 'serviceWorker', descriptor);
    } else {
      // jsdom may have put it on the prototype — just set to undefined on instance
      Object.defineProperty(navigator, 'serviceWorker', {
        value: undefined,
        writable: true,
        configurable: true,
      });
    }
  };
}

/**
 * Set navigator.serviceWorker to undefined so that calling .register() throws.
 * Note: in jsdom, `'serviceWorker' in navigator` is always true (property exists
 * on the prototype), so the `else` branch of pwa.ts is unreachable in unit tests.
 * Setting value to undefined exercises the catch block instead.
 */
function stubServiceWorkerUndefined(): () => void {
  const proto = Object.getPrototypeOf(navigator);
  const protoDescriptor = Object.getOwnPropertyDescriptor(proto, 'serviceWorker');
  const instanceDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

  Object.defineProperty(navigator, 'serviceWorker', {
    value: undefined,
    writable: true,
    configurable: true,
  });

  return () => {
    if (instanceDescriptor) {
      Object.defineProperty(navigator, 'serviceWorker', instanceDescriptor);
    } else {
      // Restore prototype descriptor and remove own property shadow
      if (protoDescriptor) {
        Object.defineProperty(proto, 'serviceWorker', protoDescriptor);
      }
      // Delete own property so prototype getter is used again
      try { delete (navigator as Record<string, unknown>).serviceWorker; } catch { /* ignored */ }
    }
  };
}

// ── Test Suite ─────────────────────────────────────────────────────────────

describe('registerServiceWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────
  // Branch: navigator.serviceWorker is unavailable
  // (In jsdom, 'serviceWorker' in navigator is always true because
  //  the property exists on the prototype. Setting it to undefined
  //  exercises the catch block — the closest testable equivalent
  //  of the "not supported" path.)
  // ─────────────────────────────────────────────
  describe('when navigator.serviceWorker is undefined (SW unavailable)', () => {
    let restore: () => void;

    beforeEach(() => {
      restore = stubServiceWorkerUndefined();
    });

    afterEach(() => {
      restore();
    });

    it('rejects when serviceWorker is unavailable', async () => {
      await expect(registerServiceWorker()).rejects.toThrow();
    });

    it('calls logger.error when registration cannot be performed', async () => {
      await registerServiceWorker().catch(() => {});
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('registration failed'),
        expect.any(Error),
      );
    });

    it('does NOT call logger.info (registration never succeeded)', async () => {
      await registerServiceWorker().catch(() => {});
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────
  // Branch 2: Service Worker registration SUCCEEDS
  // ─────────────────────────────────────────────
  describe('when serviceWorker.register resolves successfully', () => {
    let restore: () => void;
    const fakeRegistration = makeFakeRegistration();
    const mockRegister = vi.fn().mockResolvedValue(fakeRegistration);

    beforeEach(() => {
      restore = patchServiceWorker({ register: mockRegister });
    });

    afterEach(() => {
      restore();
    });

    it('resolves without throwing', async () => {
      await expect(registerServiceWorker()).resolves.toBeUndefined();
    });

    it('calls navigator.serviceWorker.register with correct path and scope', async () => {
      await registerServiceWorker();
      expect(mockRegister).toHaveBeenCalledWith('/service-worker.js', { scope: '/' });
    });

    it('calls logger.info with success message', async () => {
      await registerServiceWorker();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('registered successfully'),
        fakeRegistration,
      );
    });

    it('does NOT call logger.error on success', async () => {
      await registerServiceWorker();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('does NOT call logger.warn on success', async () => {
      await registerServiceWorker();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('registers with exactly scope "/"', async () => {
      await registerServiceWorker();
      const [, options] = mockRegister.mock.calls[0];
      expect(options.scope).toBe('/');
    });
  });

  // ─────────────────────────────────────────────
  // Branch 3: Service Worker registration FAILS
  // ─────────────────────────────────────────────
  describe('when serviceWorker.register rejects', () => {
    let restore: () => void;
    const networkError = new Error('Failed to fetch service worker');
    const mockRegister = vi.fn().mockRejectedValue(networkError);

    beforeEach(() => {
      restore = patchServiceWorker({ register: mockRegister });
    });

    afterEach(() => {
      restore();
    });

    it('rejects with the original error', async () => {
      await expect(registerServiceWorker()).rejects.toThrow('Failed to fetch service worker');
    });

    it('calls logger.error with the error', async () => {
      await registerServiceWorker().catch(() => {});
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('registration failed'),
        networkError,
      );
    });

    it('does NOT call logger.warn (different branch)', async () => {
      await registerServiceWorker().catch(() => {});
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('propagates the exact same error object', async () => {
      let caught: unknown;
      await registerServiceWorker().catch((e) => { caught = e; });
      expect(caught).toBe(networkError);
    });
  });

  // ─────────────────────────────────────────────
  // Edge: multiple consecutive calls
  // ─────────────────────────────────────────────
  describe('called multiple times with a working serviceWorker', () => {
    let restore: () => void;
    const mockRegister = vi.fn().mockResolvedValue(makeFakeRegistration());

    beforeEach(() => {
      restore = patchServiceWorker({ register: mockRegister });
    });

    afterEach(() => {
      restore();
    });

    it('registers each time it is called', async () => {
      await registerServiceWorker();
      await registerServiceWorker();
      expect(mockRegister).toHaveBeenCalledTimes(2);
    });
  });
});
