import { create } from 'zustand';
import { AppState, ProposalData, Message, Quote, CompanyInfo, ClientInfo, TemplateType } from '../types';
import { loadCompanyInfo } from '../utils/localStorage';

const initialProposalState: ProposalData = {
  file: null,
  fileName: '',
  fileUrl: '',
  textContent: '',
  pageCount: 0,
  currentPage: 1,
  extractedImages: [],
  uploadedAt: null,
};

export const useAppStore = create<AppState>((set) => ({
  // Proposal state
  proposal: initialProposalState,
  setProposal: (proposal) =>
    set((state) => ({
      proposal: { ...state.proposal, ...proposal },
    })),
  resetProposal: () =>
    set({
      proposal: initialProposalState,
    }),

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

  // Quote state
  currentQuote: null,
  setCurrentQuote: (quote: Quote | null) =>
    set({
      currentQuote: quote,
    }),
  updateQuote: (quote: Quote) =>
    set({
      currentQuote: quote,
    }),

  // Company state
  companyInfo: loadCompanyInfo(),
  setCompanyInfo: (info: CompanyInfo) =>
    set({
      companyInfo: info,
    }),

  // Client state
  clientInfo: null,
  setClientInfo: (info: ClientInfo) =>
    set({
      clientInfo: info,
    }),

  // Template state
  selectedTemplate: 'corporate-minimal' as TemplateType,
  setSelectedTemplate: (template: TemplateType) =>
    set({
      selectedTemplate: template,
    }),
}));
