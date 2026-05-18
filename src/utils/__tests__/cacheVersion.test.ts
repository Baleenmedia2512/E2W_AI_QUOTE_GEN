import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { getStoredVersion, saveVersion, type AppVersion } from '../cacheVersion';

describe('cacheVersion - storage helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  const sampleVersion: AppVersion = {
    version: '1.2.3',
    buildTimestamp: 1_700_000_000_000,
    cacheName: 'app-v1.2.3',
  };

  describe('saveVersion / getStoredVersion roundtrip', () => {
    it('returns null when no version stored', () => {
      expect(getStoredVersion()).toBeNull();
    });

    it('persists version and retrieves the same shape', () => {
      saveVersion(sampleVersion);
      const loaded = getStoredVersion();
      expect(loaded).toEqual(sampleVersion);
    });

    it('overwrites previous version on save', () => {
      saveVersion(sampleVersion);
      const newer: AppVersion = { ...sampleVersion, version: '1.2.4', buildTimestamp: 1_700_000_999_999 };
      saveVersion(newer);
      expect(getStoredVersion()).toEqual(newer);
    });

    it('returns null and logs error when stored value is malformed JSON', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      localStorage.setItem('__app_version__', '{not-json');
      expect(getStoredVersion()).toBeNull();
      expect(errorSpy).toHaveBeenCalled();
    });

    it('does not throw when localStorage.setItem fails', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota exceeded');
      });

      expect(() => saveVersion(sampleVersion)).not.toThrow();
      expect(errorSpy).toHaveBeenCalled();

      setItemSpy.mockRestore();
    });

    it('does not throw when localStorage.getItem throws', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage disabled');
      });

      expect(getStoredVersion()).toBeNull();
      expect(errorSpy).toHaveBeenCalled();

      getItemSpy.mockRestore();
    });
  });
});
