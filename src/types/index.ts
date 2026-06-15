import { Message } from './chat';
import { Quote, QuoteItem, LineItem } from './quote';
import { CompanyInfo } from './company';
import { ClientInfo } from './client';
import { TemplateData, TemplateProps, TemplateType, Template, TemplateMetadata } from './template';
import { Lead, LeadSearchResult } from './lead';
import { 
  TokenUsageRecord, 
  TokenUsageMetrics, 
  SessionSummary, 
  OperationType,
  DeltaComparison,
  GeminiModel,
  GEMINI_PRICING
} from './token';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  imageDataUrl: string;
  croppedImages?: string[];
  imageType?: 'reference' | 'specification' | 'review'; // Image classification
  // Source tracking for multi-PDF isolation
  sourceId?: string;   // proposalId this page came from
  sourceName?: string; // fileName this page came from
  /** proposal_chunks.service_id — used for direct image lookup in preview */
  serviceId?: string;
  serviceName?: string;
  city?: string;
  metadata?: Record<string, unknown>;
}

// Active proposal loaded by user for multi-location quote generation
export interface ActiveProposal {
  id: string;
  fileName: string;
  fileType: string;
  pageCount: number;
  textContent: string;
  fileUrl: string;
  pageImages: ExtractedPage[];
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

  // Multi-location active proposals (additive - does not affect existing flow)
  activeProposals: ActiveProposal[];
  addActiveProposal: (id: string) => Promise<void>;
  removeActiveProposal: (id: string) => void;
  restoreActiveProposals: () => Promise<void>;

  // Cloud Service Pages (PRIMARY DATA SOURCE from proposal_chunks)
  cloudServicePages: ExtractedPage[];
  loadCloudServices: () => Promise<ExtractedPage[]>;
}

export type { Message, Quote, QuoteItem, LineItem, CompanyInfo, ClientInfo, TemplateData, TemplateProps, TemplateType, Template, TemplateMetadata, Lead, LeadSearchResult, TokenUsageRecord, TokenUsageMetrics, SessionSummary, OperationType, DeltaComparison, GeminiModel };
export { GEMINI_PRICING } from './token';
