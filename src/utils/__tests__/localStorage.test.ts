import { describe, it, expect, beforeEach, vi } from 'vitest';

import { CompanyInfo } from '../../types/company';
import {
  saveCompanyInfo,
  loadCompanyInfo,
  clearCompanyInfo,
  saveChatHistory,
  loadChatHistory,
  clearChatHistory,
} from '../localStorage';

const sampleCompany: CompanyInfo = {
  name: 'Acme Corp',
  email: 'hello@acme.com',
  phone: '+91-9999999999',
  address: '1 Main St',
  logo: '',
  gstNumber: '29ABCDE1234F2Z5',
  website: 'https://acme.com',
} as CompanyInfo;

describe('localStorage utilities — company info', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('saves and loads company info', () => {
    saveCompanyInfo(sampleCompany);
    const loaded = loadCompanyInfo();
    expect(loaded).toEqual(sampleCompany);
  });

  it('returns null when no company info stored', () => {
    expect(loadCompanyInfo()).toBeNull();
  });

  it('clearCompanyInfo removes stored data', () => {
    saveCompanyInfo(sampleCompany);
    clearCompanyInfo();
    expect(loadCompanyInfo()).toBeNull();
  });

  it('returns null when stored value is corrupt JSON', () => {
    localStorage.setItem('ai_quote_gen_company_info', '{not valid json');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(loadCompanyInfo()).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('does not throw when localStorage.setItem fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => saveCompanyInfo(sampleCompany)).not.toThrow();
  });
});

describe('localStorage utilities — chat history', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('saves and loads chat history', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    saveChatHistory(messages);
    expect(loadChatHistory()).toEqual(messages);
  });

  it('returns null when no chat history stored', () => {
    expect(loadChatHistory()).toBeNull();
  });

  it('clearChatHistory removes stored data', () => {
    saveChatHistory([{ role: 'user', content: 'hi' }]);
    clearChatHistory();
    expect(loadChatHistory()).toBeNull();
  });

  it('handles empty array', () => {
    saveChatHistory([]);
    expect(loadChatHistory()).toEqual([]);
  });
});
