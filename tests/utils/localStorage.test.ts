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

describe('localStorage utils', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
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
  });
});
