/**
 * Token Usage Monitoring Types
 * 
 * Tracks AI token consumption, costs, and performance metrics
 * for all Gemini API operations (uploads, chat, quote generation)
 */

export type OperationType = 
  | 'pdf_upload'           // Initial PDF upload and service extraction
  | 'pdf_update'           // Delta update when re-uploading changed PDF
  | 'chat_query'           // User chat message
  | 'quote_generation'     // AI quote generation
  | 'service_extraction'   // Service registry building
  | 'registry_build'       // City service registry construction
  | 'review_ocr'           // Customer review OCR from images
  | 'image_detection';     // PDF image region detection (fallback)

export interface TokenUsageMetrics {
  // Token counts (from Gemini API response.usageMetadata)
  inputTokens: number;      // promptTokenCount
  outputTokens: number;     // candidatesTokenCount
  totalTokens: number;      // totalTokenCount
  
  // Cost calculation (Gemini 2.5 Flash pricing)
  inputCost: number;        // inputTokens * $0.075 / 1M
  outputCost: number;       // outputTokens * $0.30 / 1M
  totalCost: number;        // inputCost + outputCost
  
  // Performance
  processingTimeMs: number; // Time taken for API call
}

export interface TokenUsageRecord {
  // Identity
  id: string;               // Unique record ID
  sessionId: string;        // Current session ID
  userId?: string;          // User ID (if authenticated)
  timestamp: Date;          // When operation occurred
  
  // Operation details
  operationType: OperationType;
  operationDetails: string; // Human-readable description
  
  // Metrics
  metrics: TokenUsageMetrics;
  
  // PDF-specific tracking
  pdfId?: string;           // Proposal ID (if related to PDF)
  pdfFileName?: string;     // File name
  isFullUpload?: boolean;   // First-time upload (full processing)
  isDeltaUpdate?: boolean;  // Re-upload with changes (incremental)
  changedPages?: number[];  // Which pages changed (delta updates)
  
  // Context info
  contextSize?: number;     // Size of context sent to AI
  responseSize?: number;    // Size of AI response
}

export interface SessionSummary {
  sessionId: string;
  userId?: string;
  startTime: Date;
  endTime?: Date;
  durationMinutes: number;
  
  // Operation counts
  operations: {
    pdfUploads: number;
    pdfUpdates: number;
    chatMessages: number;
    quotesGenerated: number;
    totalOperations: number;
  };
  
  // Token totals
  tokens: {
    totalInput: number;
    totalOutput: number;
    grandTotal: number;
  };
  
  // Cost totals
  cost: {
    uploads: number;
    updates: number;
    chats: number;
    total: number;
  };
  
  // Averages
  averages: {
    tokensPerChat: number;
    costPerChat: number;
    tokensPerUpload: number;
    costPerUpload: number;
  };
  
  // All records in this session
  records: TokenUsageRecord[];
  
  // Card-specific data
  cards: {
    pdfUpload?: PdfUploadCardData;
    quoteGeneration?: QuoteGenerationCardData;
    chatOperations?: ChatOperationsCardData;
    imageProcessing?: ImageProcessingCardData;
  };
}

// Card 1: PDF Upload & Initial Processing
export interface PdfUploadCardData {
  totalUploads: number;
  uploads: Array<{
    uploadNumber: number;
    fileName: string;
    pageCount: number;
    servicesFound: number;
    
    initialUpload: {
      inputTokens: number;
      outputTokens: number;
      timeSeconds: number;
      cost: number;
    };
    
    imageDetection: {
      pagesProcessed: number;
      imagesExtracted: number;
      inputTokens: number;
      outputTokens: number;
      timeSeconds: number;
      cost: number;
    };
    
    registryBuild: {
      operationsCount: number;
      inputTokens: number;
      outputTokens: number;
      timeSeconds: number;
      cost: number;
    };
    
    uploadTotal: number;
    uploadCost: number;
  }>;
  
  totalTokens: number;
  totalCost: number;
}

// Card 2: Quote Generation
export interface QuoteGenerationCardData {
  totalBatches: number;
  batches: Array<{
    batchNumber: number;
    serviceCount: number;
    serviceNames: string[];
    inputTokens: number;
    outputTokens: number;
    timeSeconds: number;
    cost: number;
    costPerService: number;
  }>;
  
  totalInput: number;
  totalOutput: number;
  totalCost: number;
  averageCostPerQuote: number;
}

// Card 3: Chat Operations (All chat queries and quote requests)
export interface ChatOperationsCardData {
  totalOperations: number;
  operations: Array<{
    operationNumber: number;
    type: 'chat_query' | 'quote_generation';
    userMessage: string;
    timestamp: Date;
    inputTokens: number;
    outputTokens: number;
    timeSeconds: number;
    cost: number;
  }>;
  
  totalInput: number;
  totalOutput: number;
  totalCost: number;
}

// Card 4: Image Processing
export interface ImageProcessingCardData {
  method: 'native' | 'gemini';
  
  uploadDetection: {
    pagesProcessed: number;
    imagesDetected: number;
    inputTokens: number;
    outputTokens: number;
    timeSeconds: number;
    cost: number;
  };
  
  previewDetection: {
    pagesViewed: number;
    reDetections: number;
    cost: number;
  };
  
  totalCost: number;
  nativeCostComparison: string; // e.g., "$0 with native extraction"
}

export interface DeltaComparison {
  // File comparison
  previousFileHash: string;
  newFileHash: string;
  filesIdentical: boolean;
  
  // Page-level changes
  totalPages: number;
  unchangedPages: number;
  changedPages: number[];
  changedCount: number;
  changePercentage: number;
  
  // Optimization metrics
  optimizationPlan: {
    skipPages: number;
    processPages: number;
    expectedTokenSavings: number;  // Percentage
    estimatedTokens: number;
    estimatedCost: number;
  };
  
  // Actual results (after processing)
  actualResults?: {
    tokensUsed: number;
    tokensSaved: number;
    savingsPercentage: number;
    costThisUpdate: number;
    costFullUpdate: number;
    costSavings: number;
  };
}

// Gemini pricing constants (as of 2026)
export const GEMINI_PRICING = {
  'gemini-2.5-flash-lite': {
    inputPer1M: 0.075,   // $0.075 per 1M input tokens
    outputPer1M: 0.30,   // $0.30 per 1M output tokens
  },
  'gemini-1.5-flash': {
    inputPer1M: 0.075,
    outputPer1M: 0.30,
  },
  'gemini-1.5-pro': {
    inputPer1M: 1.25,
    outputPer1M: 5.00,
  },
} as const;

export type GeminiModel = keyof typeof GEMINI_PRICING;
