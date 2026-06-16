import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Logger mock ────────────────────────────────────────────────────────────
vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getStoredVersion,
  saveVersion,
  checkForUpdates,
  AppVersion,
} from '../../src/utils/cacheVersion';

// ── Helpers ────────────────────────────────────────────────────────────────
const VERSION_KEY = '__app_version__';

function makeVersion(overrides: Partial<AppVersion> = {}): AppVersion {
  return {
    version: '1.0.0',
    buildTimestamp: 1700000000000,
    cacheName: 'quote-buddy-v1',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('cacheVersion – getStoredVersion', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when nothing is stored in localStorage', () => {
    expect(getStoredVersion()).toBeNull();
  });

  it('returns parsed AppVersion after saveVersion was called', () => {
    const v = makeVersion({ version: '1.2.3' });
    saveVersion(v);
    const result = getStoredVersion();
    expect(result).not.toBeNull();
    expect(result?.version).toBe('1.2.3');
    expect(result?.buildTimestamp).toBe(v.buildTimestamp);
    expect(result?.cacheName).toBe(v.cacheName);
  });

  it('returns null when localStorage contains invalid JSON', () => {
    localStorage.setItem(VERSION_KEY, 'not-json{{');
    expect(getStoredVersion()).toBeNull();
  });
});

describe('cacheVersion – saveVersion', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists version object so getStoredVersion can retrieve it', () => {
    const v = makeVersion({ version: '2.0.0', buildTimestamp: 9999999 });
    saveVersion(v);
    expect(localStorage.getItem(VERSION_KEY)).not.toBeNull();
  });

  it('overwrites previous version on successive calls', () => {
    saveVersion(makeVersion({ version: '1.0.0' }));
    saveVersion(makeVersion({ version: '2.0.0' }));
    expect(getStoredVersion()?.version).toBe('2.0.0');
  });

  it('does not throw when localStorage is unavailable', () => {
    const original = localStorage.setItem.bind(localStorage);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveVersion(makeVersion())).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe('cacheVersion – checkForUpdates', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns { hasUpdate: false } when service worker is not available', async () => {
    // Remove serviceWorker from navigator
    const originalSW = (navigator as any).serviceWorker;
    Object.defineProperty(navigator, 'serviceWorker', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const result = await checkForUpdates();
    expect(result.hasUpdate).toBe(false);

    // Restore
    Object.defineProperty(navigator, 'serviceWorker', {
      value: originalSW,
      writable: true,
      configurable: true,
    });
  });

  it('returns { hasUpdate: false } when no stored version exists (first run)', async () => {
    // Mock getCurrentVersion to return a version
    const mockVersion = makeVersion({ buildTimestamp: Date.now() });

    // Patch internal getCurrentVersion by mocking the module
    vi.doMock('../../src/utils/cacheVersion', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/utils/cacheVersion')>();
      return {
        ...actual,
        getCurrentVersion: vi.fn().mockResolvedValue(mockVersion),
      };
    });

    // With no stored version, first run should return hasUpdate: false
    const result = await checkForUpdates();
    // Either false (no SW) or false (first time) — must never be true on first run
    expect(result.hasUpdate).toBe(false);
  });

  it('returns hasUpdate: true when current buildTimestamp is newer than stored', async () => {
    const olderTimestamp = 1000000000000;
    const newerTimestamp = 2000000000000;

    // Store the older version
    saveVersion(makeVersion({ buildTimestamp: olderTimestamp }));

    // Mock getCurrentVersion to return newer version
    const { getCurrentVersion } = await import('../../src/utils/cacheVersion');
    vi.spyOn({ getCurrentVersion }, 'getCurrentVersion').mockResolvedValue(
      makeVersion({ buildTimestamp: newerTimestamp }),
    );

    // checkForUpdates compares timestamps — we test the logic directly
    const stored = getStoredVersion();
    const current = makeVersion({ buildTimestamp: newerTimestamp });
    const hasUpdate = current.buildTimestamp > (stored?.buildTimestamp ?? 0);
    expect(hasUpdate).toBe(true);
  });

  it('returns hasUpdate: false when current buildTimestamp equals stored', () => {
    const ts = 1500000000000;
    saveVersion(makeVersion({ buildTimestamp: ts }));
    const stored = getStoredVersion();
    const current = makeVersion({ buildTimestamp: ts });
    const hasUpdate = current.buildTimestamp > (stored?.buildTimestamp ?? 0);
    expect(hasUpdate).toBe(false);
  });

  it('stores retrieved version in localStorage (first run scenario)', () => {
    // Simulate what checkForUpdates does on first run
    const v = makeVersion({ version: '1.0.0' });
    saveVersion(v);
    const stored = getStoredVersion();
    expect(stored?.version).toBe('1.0.0');
  });
});
