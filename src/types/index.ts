import { Message } from './chat';
import { Quote, QuoteItem, LineItem } from './quote';
import { CompanyInfo } from './company';
import { ClientInfo } from './client';
import { TemplateData, TemplateProps, TemplateType, Template, TemplateMetadata } from './template';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  imageDataUrl: string;
}

export interface ProposalData {
  file: File | null;
  fileName: string;
  fileUrl: string;
  textContent: string;
  pageCount: number;
  currentPage: number;
  extractedImages: string[];
  pageImages: ExtractedPage[];
  uploadedAt: Date | null;
}

export interface AppState {
  // Proposal state
  proposal: ProposalData;
  setProposal: (proposal: Partial<ProposalData>) => void;
  resetProposal: () => void;

  // Chat state
  messages: Message[];
  addMessage: (message: Message) => void;
  clearMessages: () => void;

  // Quote state
  currentQuote: Quote | null;
  setCurrentQuote: (quote: Quote | null) => void;
  updateQuote: (quote: Quote) => void;

  // Company state
  companyInfo: CompanyInfo | null;
  setCompanyInfo: (info: CompanyInfo) => void;

  // Client state
  clientInfo: ClientInfo | null;
  setClientInfo: (info: ClientInfo) => void;

  // Template state
  selectedTemplate: TemplateType;
  setSelectedTemplate: (template: TemplateType) => void;
}

export type { Message, Quote, QuoteItem, LineItem, CompanyInfo, ClientInfo, TemplateData, TemplateProps, TemplateType, Template, TemplateMetadata };
