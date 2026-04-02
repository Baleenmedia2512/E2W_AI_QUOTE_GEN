import { create } from 'zustand';
import { AppState, ProposalData, Message, Quote, CompanyInfo, ClientInfo, TemplateType } from '../types';
import { loadCompanyInfo, saveCompanyInfo as saveCompanyInfoToStorage } from '../utils/localStorage';
import { savePageImages as savePageImagesToDB, clearPageImages } from '../utils/imageStorage';
import { DEFAULT_COMPANY_INFO } from '../constants/defaultCompany';
import { companyService } from '../services/companyService';

const initialProposalState: ProposalData = {
  file: null,
  fileName: '',
  fileUrl: '',
  textContent: '',
  pageCount: 0,
  currentPage: 1,
  extractedImages: [],
  pageImages: [],
  uploadedAt: null,
};

// Load template from localStorage
const loadSelectedTemplate = (): TemplateType => {
  try {
    const saved = localStorage.getItem('selectedTemplate');
    if (saved && ['corporate-minimal', 'premium-agency', 'modern-sales', 'classic-business'].includes(saved)) {
      return saved as TemplateType;
    }
  } catch (error) {
    console.error('Failed to load template from localStorage:', error);
  }
  return 'corporate-minimal';
};

// Load quote from localStorage
const loadCurrentQuote = (): Quote | null => {
  try {
    const saved = localStorage.getItem('currentQuote');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.error('Failed to load quote from localStorage:', error);
  }
  return null;
};

// Load client info from localStorage
const loadClientInfo = (): ClientInfo | null => {
  try {
    const saved = localStorage.getItem('clientInfo');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.error('Failed to load client info from localStorage:', error);
  }
  return null;
};

// Load company info with fallback to defaults
const loadCompanyInfoWithDefaults = (): CompanyInfo => {
  const saved = loadCompanyInfo();
  return saved || DEFAULT_COMPANY_INFO;
};

export const useAppStore = create<AppState>((set) => ({
  // Proposal state
  proposal: initialProposalState,
  setProposal: (proposal) =>
    set((state) => {
      if (proposal.pageImages) {
        savePageImagesToDB(proposal.pageImages);
      }
      return { proposal: { ...state.proposal, ...proposal } };
    }),
  resetProposal: () => {
    clearPageImages();
    set({ proposal: initialProposalState });
  },

  // Chat state
  messages: [],
  addMessage: (message: Message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),
  clearMessages: () =>
    set({
      messages: [],
    }),

  // Quote state - Load from localStorage on init
  currentQuote: loadCurrentQuote(),
  setCurrentQuote: (quote: Quote | null) => {
    set({ currentQuote: quote });
    // Persist to localStorage
    if (quote) {
      try {
        localStorage.setItem('currentQuote', JSON.stringify(quote));
      } catch (error) {
        console.error('Failed to save quote to localStorage:', error);
      }
    }
  },
  updateQuote: (quote: Quote) => {
    set({ currentQuote: quote });
    // Persist to localStorage
    try {
      localStorage.setItem('currentQuote', JSON.stringify(quote));
    } catch (error) {
      console.error('Failed to save quote to localStorage:', error);
    }
  },

  // Company state - Load from localStorage on init, fallback to defaults
  companyInfo: loadCompanyInfoWithDefaults(),
  setCompanyInfo: (info: CompanyInfo) => {
    set({ companyInfo: info });
    // Persist to localStorage (always works, fallback)
    try {
      localStorage.setItem('companyInfo', JSON.stringify(info));
    } catch (error) {
      console.error('Failed to save company info to localStorage:', error);
    }
    // Also persist to database (syncs across devices)
    companyService.saveCompanySettings(info).catch(err => {
      console.warn('Database sync failed, localStorage still working:', err);
    });
  },

  // Sync company info from database (call on app init)
  syncCompanyFromDatabase: async () => {
    try {
      const dbCompany = await companyService.getCompanySettings();
      if (dbCompany) {
        console.log('✅ Loaded company info from database');
        set({ companyInfo: dbCompany });
        // Also update localStorage cache
        saveCompanyInfoToStorage(dbCompany);
      } else {
        console.log('ℹ️ No company info in database, using defaults/localStorage');
      }
    } catch (error) {
      console.warn('⚠️ Database sync failed, using localStorage:', error);
    }
  },

  // Enable real-time sync (optional, call after login)
  enableCompanySync: () => {
    const subscription = companyService.subscribeToChanges((updatedCompany) => {
      console.log('🔄 Real-time update: Company info changed');
      set({ companyInfo: updatedCompany });
      saveCompanyInfoToStorage(updatedCompany);
    });
    return subscription;
  },

  // Client state - Load from localStorage on init
  clientInfo: loadClientInfo(),
  setClientInfo: (info: ClientInfo) => {
    set({ clientInfo: info });
    // Persist to localStorage
    try {
      localStorage.setItem('clientInfo', JSON.stringify(info));
    } catch (error) {
      console.error('Failed to save client info to localStorage:', error);
    }
  },

  // Template state - Load from localStorage on init
  selectedTemplate: loadSelectedTemplate(),
  setSelectedTemplate: (template: TemplateType) => {
    console.log('🎨 Setting template in store:', template);
    set({ selectedTemplate: template });
    // Persist to localStorage
    try {
      localStorage.setItem('selectedTemplate', template);
      console.log('✅ Template saved to localStorage:', template);
    } catch (error) {
      console.error('Failed to save template to localStorage:', error);
    }
  },
}));
