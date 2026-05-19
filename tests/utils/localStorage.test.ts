import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  saveCompanyInfo,
  loadCompanyInfo,
  clearCompanyInfo,
  saveChatHistory,
  loadChatHistory,
  clearChatHistory,
} from '../../src/utils/localStorage';
import { sampleCompany, minimalCompany } from '../fixtures/companies';
import { logger } from '../../src/utils/logger';

// Mock the logger module so we can assert on logger.error calls
// without triggering real console output in CI/CD pipelines.
vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('localStorage utils', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // restoreAllMocks undoes any mockImplementation overrides set via vi.spyOn
    // so that a spy from one test does not leak into the next test.
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────
  // saveCompanyInfo / loadCompanyInfo
  // ─────────────────────────────────────────────
  describe('saveCompanyInfo', () => {
    it('persists company info to localStorage', () => {
      saveCompanyInfo(sampleCompany);
      const raw = localStorage.getItem('ai_quote_gen_company_info');
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toEqual(sampleCompany);
    });

    it('overwrites existing company info on re-save', () => {
      saveCompanyInfo(sampleCompany);
      saveCompanyInfo(minimalCompany);
      const loaded = loadCompanyInfo();
      expect(loaded?.name).toBe('Test Company');
    });

    // ERROR PATH: covers the catch block in saveCompanyInfo.
    // Validates that when localStorage.setItem throws (e.g. QuotaExceededError
    // in private-browsing or storage-full scenarios), the function:
    //   1. does NOT propagate the exception to the caller
    //   2. calls logger.error with the expected message and the error object
    it('calls logger.error and does not throw when localStorage.setItem throws', () => {
      // jsdom binds storage methods on Storage.prototype, not the instance,
      // so we must spy on the prototype for the mock to intercept the call.
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      expect(() => saveCompanyInfo(sampleCompany)).not.toThrow();
      expect(logger.error).toHaveBeenCalledOnce();
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to save company info:',
        expect.any(Error),
      );
    });

    // EDGE CASE: verifies JSON.stringify + JSON.parse round-trip preserves
    // special characters (quotes, angle brackets, apostrophes) without corruption.
    it('correctly round-trips company info containing special characters', () => {
      const special = { ...sampleCompany, name: "O'Brien & \"Sons\" <Ltd>" };
      saveCompanyInfo(special);
      expect(loadCompanyInfo()?.name).toBe("O'Brien & \"Sons\" <Ltd>");
    });
  });

  describe('loadCompanyInfo', () => {
    it('returns parsed CompanyInfo when key exists', () => {
      saveCompanyInfo(sampleCompany);
      const loaded = loadCompanyInfo();
      expect(loaded).toEqual(sampleCompany);
    });

    it('returns null when key does not exist', () => {
      expect(loadCompanyInfo()).toBeNull();
    });

    it('returns null when stored value is corrupted JSON', () => {
      localStorage.setItem('ai_quote_gen_company_info', 'not-valid-json{{{');
      expect(loadCompanyInfo()).toBeNull();
    });

    // ERROR PATH: covers the catch block in loadCompanyInfo via a storage-level
    // throw (distinct from the corrupt-JSON path above). Simulates a browser
    // SecurityError (e.g. cross-origin iframe blocking storage access).
    // Validates that the function returns null and logs the error.
    it('calls logger.error and returns null when localStorage.getItem throws', () => {
      // Spy on Storage.prototype so jsdom routes the call through our mock.
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('Access denied', 'SecurityError');
      });
      expect(loadCompanyInfo()).toBeNull();
      expect(logger.error).toHaveBeenCalledOnce();
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to load company info:',
        expect.any(DOMException),
      );
    });
  });

  describe('clearCompanyInfo', () => {
    it('removes company info from localStorage', () => {
      saveCompanyInfo(sampleCompany);
      clearCompanyInfo();
      expect(localStorage.getItem('ai_quote_gen_company_info')).toBeNull();
    });

    it('does not throw when key does not exist', () => {
      expect(() => clearCompanyInfo()).not.toThrow();
    });

    // ERROR PATH: covers the catch block in clearCompanyInfo.
    // Validates that when localStorage.removeItem throws, the function
    // swallows the error silently and logs it via logger.error.
    it('calls logger.error and does not throw when localStorage.removeItem throws', () => {
      // Spy on Storage.prototype so jsdom routes the call through our mock.
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('removeItem failed');
      });
      expect(() => clearCompanyInfo()).not.toThrow();
      expect(logger.error).toHaveBeenCalledOnce();
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to clear company info:',
        expect.any(Error),
      );
    });
  });

  // ─────────────────────────────────────────────
  // saveChatHistory / loadChatHistory
  // ─────────────────────────────────────────────
  describe('saveChatHistory', () => {
    it('persists chat messages to sessionStorage', () => {
      const messages = [{ role: 'user', content: 'Hello' }, { role: 'ai', content: 'Hi' }];
      saveChatHistory(messages);
      const raw = sessionStorage.getItem('ai_quote_gen_chat_history');
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toEqual(messages);
    });

    it('persists empty array', () => {
      saveChatHistory([]);
      expect(loadChatHistory()).toEqual([]);
    });

    // EDGE CASE: ensures nested objects (timestamp, tags array) survive the
    // JSON.stringify → JSON.parse round-trip without data loss or type coercion.
    it('preserves nested object structure in chat history', () => {
      const messages = [
        { role: 'user', content: 'hi', meta: { timestamp: 12345, tags: ['a', 'b'] } },
      ];
      saveChatHistory(messages);
      expect(loadChatHistory()).toEqual(messages);
    });

    // ERROR PATH: covers the catch block in saveChatHistory.
    // Simulates sessionStorage quota exceeded (common on mobile browsers).
    // Validates the function does not throw and logs the error.
    it('calls logger.error and does not throw when sessionStorage.setItem throws', () => {
      // localStorage and sessionStorage share Storage.prototype in jsdom.
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      expect(() => saveChatHistory([{ role: 'user', content: 'hi' }])).not.toThrow();
      expect(logger.error).toHaveBeenCalledOnce();
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to save chat history:',
        expect.any(Error),
      );
    });
  });

  describe('loadChatHistory', () => {
    it('returns parsed array when history exists', () => {
      const messages = [{ role: 'user', content: 'Test' }];
      saveChatHistory(messages);
      expect(loadChatHistory()).toEqual(messages);
    });

    it('returns null when history is not set', () => {
      expect(loadChatHistory()).toBeNull();
    });

    it('returns null when stored value is corrupted JSON', () => {
      sessionStorage.setItem('ai_quote_gen_chat_history', '[[broken json');
      expect(loadChatHistory()).toBeNull();
    });

    // ERROR PATH: covers the catch block in loadChatHistory via a storage-level
    // throw. Distinct from the corrupt-JSON path — the storage API itself throws
    // (e.g. SecurityError in restricted browser contexts).
    // Validates that the function returns null and calls logger.error.
    it('calls logger.error and returns null when sessionStorage.getItem throws', () => {
      // Spy on Storage.prototype so jsdom routes the call through our mock.
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('Access denied', 'SecurityError');
      });
      expect(loadChatHistory()).toBeNull();
      expect(logger.error).toHaveBeenCalledOnce();
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to load chat history:',
        expect.any(DOMException),
      );
    });
  });

  describe('clearChatHistory', () => {
    it('removes chat history from sessionStorage', () => {
      saveChatHistory([{ role: 'user', content: 'Hello' }]);
      clearChatHistory();
      expect(sessionStorage.getItem('ai_quote_gen_chat_history')).toBeNull();
    });

    it('does not throw when key does not exist', () => {
      expect(() => clearChatHistory()).not.toThrow();
    });

    // ERROR PATH: covers the catch block in clearChatHistory.
    // Validates that when sessionStorage.removeItem throws, the function
    // swallows the error silently and logs it via logger.error.
    it('calls logger.error and does not throw when sessionStorage.removeItem throws', () => {
      // Spy on Storage.prototype so jsdom routes the call through our mock.
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('removeItem failed');
      });
      expect(() => clearChatHistory()).not.toThrow();
      expect(logger.error).toHaveBeenCalledOnce();
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to clear chat history:',
        expect.any(Error),
      );
    });
  });
});
