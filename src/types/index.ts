import { Message } from './chat';
import { Quote, QuoteItem, LineItem } from './quote';
import { CompanyInfo } from './company';
import { ClientInfo } from './client';
import { TemplateData, TemplateProps, TemplateType, Template, TemplateMetadata } from './template';
import { Lead, LeadSearchResult } from './lead';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  imageDataUrl: string;
}

export interface StoredProposal {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  fileBlob: Blob | null; // Null for cloud proposals (downloaded on-demand)
  textContent: string;
  pageCount: number;
  extractedImages: string[];
  pageImages: any[];
  uploadedAt: Date;
  // Cloud storage fields (optional - only when loaded from cloud)
  isCloudStored?: boolean;
  fileUrl?: string;
  storagePath?: string;
  uploadedByUserId?: string | null;
  uploadedByName?: string | null;
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
  syncCompanyFromDatabase: () => Promise<void>;
  enableCompanySync: () => any;

  // Client state
  clientInfo: ClientInfo | null;
  setClientInfo: (info: ClientInfo) => void;

  // Template state
  selectedTemplate: TemplateType;
  setSelectedTemplate: (template: TemplateType) => void;

  // Proposal Library state (IndexedDB + Cloud hybrid)
  recentProposals: StoredProposal[];
  loadRecentProposals: () => Promise<void>;
  selectProposal: (id: string) => Promise<void>;
  deleteProposalFromLibrary: (id: string) => Promise<void>;
  
  // Cloud storage state (NEW - additive)
  cloudStorageEnabled: boolean;
  checkCloudStorage: () => Promise<void>;
}

export type { Message, Quote, QuoteItem, LineItem, CompanyInfo, ClientInfo, TemplateData, TemplateProps, TemplateType, Template, TemplateMetadata, Lead, LeadSearchResult };
