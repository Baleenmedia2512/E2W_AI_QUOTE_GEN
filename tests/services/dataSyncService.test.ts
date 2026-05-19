import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  saveDataUnified,
  loadDataUnified,
  getSyncStatus,
  clearAllCache,
} from '../../src/services/dataSyncService';

describe('dataSyncService', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  // ─────────────────────────────────────────────
  // saveDataUnified
  // ─────────────────────────────────────────────
  describe('saveDataUnified', () => {
    it('saves to localStorage by default', async () => {
      const data = { name: 'Test Company', phone: '123456' };
      const result = await saveDataUnified('company_data', data, { localStorage: true, cloud: false });

      expect(result.success).toBe(true);
      expect(result.source).toContain('localStorage');

      const stored = localStorage.getItem('company_data');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed.data).toEqual(data);
    });

    it('wraps data with timestamp and source metadata', async () => {
      const before = Date.now();
      await saveDataUnified('meta_test', { value: 42 }, { localStorage: true, cloud: false });
      const after = Date.now();

      const raw = JSON.parse(localStorage.getItem('meta_test')!);
      expect(raw.timestamp).toBeGreaterThanOrEqual(before);
      expect(raw.timestamp).toBeLessThanOrEqual(after);
      expect(raw.source).toBe('localStorage');
    });

    it('returns success: false when localStorage is disabled and cloud fails', async () => {
      // With cloud: false and localStorage: false, no source saves
      const result = await saveDataUnified('empty_test', { x: 1 }, {
        localStorage: false,
        cloud: false,
      });
      expect(result.success).toBe(false);
    });

    it('does not throw when localStorage throws quota error', async () => {
      const originalSetItem = localStorage.setItem.bind(localStorage);
      vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
        throw new DOMException('QuotaExceededError');
      });

      const result = await saveDataUnified('quota_test', { big: true }, {
        localStorage: true,
        cloud: false,
      });
      // Should not throw, may or may not succeed depending on fallback
      expect(result).toBeDefined();

      // Restore
      Storage.prototype.setItem = originalSetItem;
    });
  });

  // ─────────────────────────────────────────────
  // loadDataUnified
  // ─────────────────────────────────────────────
  describe('loadDataUnified', () => {
    it('returns stored data from localStorage', async () => {
      const data = { name: 'Baleen Media', value: 100 };
      await saveDataUnified('load_test', data, { localStorage: true, cloud: false });

      const loaded = await loadDataUnified('load_test');
      expect(loaded).toEqual(data);
    });

    it('returns null when key does not exist', async () => {
      const loaded = await loadDataUnified('nonexistent_key_xyz');
      expect(loaded).toBeNull();
    });

    it('returns null when stored data is older than maxAge', async () => {
      // Save data with a very old timestamp
      const staleData = {
        data: { value: 'old' },
        timestamp: Date.now() - 99999999, // very old
        source: 'localStorage',
        synced: true,
      };
      localStorage.setItem('stale_key', JSON.stringify(staleData));

      const loaded = await loadDataUnified('stale_key', { maxAge: 1000 }); // 1 second max
      expect(loaded).toBeNull();
    });

    it('returns data within maxAge threshold', async () => {
      const data = { value: 'fresh' };
      await saveDataUnified('fresh_key', data, { localStorage: true, cloud: false });

      const loaded = await loadDataUnified('fresh_key', { maxAge: 60000 }); // 60s
      expect(loaded).toEqual(data);
    });
  });

  // ─────────────────────────────────────────────
  // getSyncStatus
  // ─────────────────────────────────────────────
  describe('getSyncStatus', () => {
    it('returns a SyncStatus object', () => {
      const status = getSyncStatus();
      // lastSync can be null (no syncs yet) or a Date
      expect(status.lastSync === null || status.lastSync instanceof Date).toBe(true);
      expect(typeof status.pendingChanges).toBe('number');
      expect(typeof status.conflictsDetected).toBe('number');
      expect(typeof status.isSyncing).toBe('boolean');
    });

    it('pendingChanges is a non-negative number', () => {
      const status = getSyncStatus();
      expect(status.pendingChanges).toBeGreaterThanOrEqual(0);
    });

    it('isSyncing is false when no sync is running', () => {
      const status = getSyncStatus();
      expect(status.isSyncing).toBe(false);
    });

    it('lastSync is null initially', () => {
      const status = getSyncStatus();
      expect(status.lastSync).toBeNull();
    });
  });

  // ─────────────────────────────────────────────
  // clearAllCache
  // ─────────────────────────────────────────────
  describe('clearAllCache', () => {
    it('removes non-auth keys from localStorage', async () => {
      localStorage.setItem('company_data', JSON.stringify({ name: 'Test' }));
      localStorage.setItem('quote_cache', JSON.stringify({ items: [] }));
      localStorage.setItem('auth-storage', JSON.stringify({ token: 'keep-me' }));

      await clearAllCache();

      expect(localStorage.getItem('company_data')).toBeNull();
      expect(localStorage.getItem('quote_cache')).toBeNull();
      // Auth key should be preserved
      expect(localStorage.getItem('auth-storage')).not.toBeNull();
    });

    it('does not throw when localStorage is empty', async () => {
      await expect(clearAllCache()).resolves.not.toThrow();
    });
  });
});
