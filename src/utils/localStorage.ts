import { CompanyInfo } from '../types/company';

const COMPANY_INFO_KEY = 'ai_quote_gen_company_info';

export const saveCompanyInfo = (companyInfo: CompanyInfo): void => {
  try {
    localStorage.setItem(COMPANY_INFO_KEY, JSON.stringify(companyInfo));
  } catch (error) {
    console.error('Failed to save company info:', error);
  }
};

export const loadCompanyInfo = (): CompanyInfo | null => {
  try {
    const stored = localStorage.getItem(COMPANY_INFO_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.error('Failed to load company info:', error);
    return null;
  }
};

export const clearCompanyInfo = (): void => {
  try {
    localStorage.removeItem(COMPANY_INFO_KEY);
  } catch (error) {
    console.error('Failed to clear company info:', error);
  }
};

// Session storage for chat history
const CHAT_HISTORY_KEY = 'ai_quote_gen_chat_history';

export const saveChatHistory = (messages: any[]): void => {
  try {
    sessionStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages));
  } catch (error) {
    console.error('Failed to save chat history:', error);
  }
};

export const loadChatHistory = (): any[] | null => {
  try {
    const stored = sessionStorage.getItem(CHAT_HISTORY_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.error('Failed to load chat history:', error);
    return null;
  }
};

export const clearChatHistory = (): void => {
  try {
    sessionStorage.removeItem(CHAT_HISTORY_KEY);
  } catch (error) {
    console.error('Failed to clear chat history:', error);
  }
};
