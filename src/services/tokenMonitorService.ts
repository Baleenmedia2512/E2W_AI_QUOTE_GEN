/**
 * Token Monitoring Service
 * 
 * Tracks AI token usage, calculates costs, and provides session analytics
 * for all Gemini API operations.
 */

import {
  TokenUsageRecord,
  TokenUsageMetrics,
  SessionSummary,
  OperationType,
  GEMINI_PRICING,
  GeminiModel,
  DeltaComparison
} from '../types/token';

// Session management
const STORAGE_KEY = 'e2w_token_usage_session';
let currentSessionId: string = generateSessionId();
let sessionStartTime: Date = new Date();
const sessionRecords: TokenUsageRecord[] = [];

// Generate unique session ID
function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Save session data to localStorage
 */
function saveToLocalStorage(): void {
  try {
    const data = {
      sessionId: currentSessionId,
      startTime: sessionStartTime.toISOString(),
      records: sessionRecords.map(r => ({
        ...r,
        timestamp: r.timestamp.toISOString()
      }))
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.warn('Failed to save token usage to localStorage:', error);
  }
}

/**
 * Load session data from localStorage
 */
function loadFromLocalStorage(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    
    const data = JSON.parse(stored);
    
    // Restore session if within same day (reset daily)
    const storedDate = new Date(data.startTime);
    const today = new Date();
    const isSameDay = storedDate.toDateString() === today.toDateString();
    
    if (isSameDay && data.records) {
      currentSessionId = data.sessionId;
      sessionStartTime = new Date(data.startTime);
      
      // Restore records with Date objects
      data.records.forEach((r: any) => {
        sessionRecords.push({
          ...r,
          timestamp: new Date(r.timestamp)
        });
      });
      
      console.log(`📦 Restored ${sessionRecords.length} token usage records from localStorage`);
    } else {
      // Clear old session data
      localStorage.removeItem(STORAGE_KEY);
      console.log('🔄 Started new daily token usage session');
    }
  } catch (error) {
    console.warn('Failed to load token usage from localStorage:', error);
  }
}

// Initialize: Load existing session on module load
loadFromLocalStorage();

// Generate unique record ID
function generateRecordId(): string {
  return `rec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Calculate token costs based on Gemini pricing
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: GeminiModel = 'gemini-2.5-flash-lite'
): { inputCost: number; outputCost: number; totalCost: number } {
  const pricing = GEMINI_PRICING[model];
  
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
  const totalCost = inputCost + outputCost;
  
  return {
    inputCost: Number(inputCost.toFixed(6)),
    outputCost: Number(outputCost.toFixed(6)),
    totalCost: Number(totalCost.toFixed(6))
  };
}

/**
 * Track a single API call with comprehensive logging
 */
export function trackTokenUsage(params: {
  operationType: OperationType;
  operationDetails: string;
  inputTokens: number;
  outputTokens: number;
  processingTimeMs: number;
  model?: GeminiModel;
  pdfId?: string;
  pdfFileName?: string;
  isFullUpload?: boolean;
  isDeltaUpdate?: boolean;
  changedPages?: number[];
  contextSize?: number;
  responseSize?: number;
  userId?: string;
}): TokenUsageRecord {
  const {
    operationType,
    operationDetails,
    inputTokens,
    outputTokens,
    processingTimeMs,
    model = 'gemini-2.5-flash-lite',
    pdfId,
    pdfFileName,
    isFullUpload,
    isDeltaUpdate,
    changedPages,
    contextSize,
    responseSize,
    userId
  } = params;
  
  // Calculate costs
  const costs = calculateCost(inputTokens, outputTokens, model);
  
  // Create metrics
  const metrics: TokenUsageMetrics = {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputCost: costs.inputCost,
    outputCost: costs.outputCost,
    totalCost: costs.totalCost,
    processingTimeMs
  };
  
  // Create record
  const record: TokenUsageRecord = {
    id: generateRecordId(),
    sessionId: currentSessionId,
    userId,
    timestamp: new Date(),
    operationType,
    operationDetails,
    metrics,
    pdfId,
    pdfFileName,
    isFullUpload,
    isDeltaUpdate,
    changedPages,
    contextSize,
    responseSize
  };
  
  // Add to session
  sessionRecords.push(record);
  
  // Save to localStorage
  saveToLocalStorage();
  
  // Log comprehensive details
  console.log('✅ [API RESPONSE] Gemini Response', {
    operation: operationType,
    responseLength: responseSize,
    processingTime: `${(processingTimeMs / 1000).toFixed(1)}s`,
    
    // 🎯 TOKEN USAGE
    tokens: {
      input: inputTokens,
      output: outputTokens,
      total: inputTokens + outputTokens
    },
    
    // 💰 COST CALCULATION
    cost: {
      inputCost: costs.inputCost.toFixed(6),
      outputCost: costs.outputCost.toFixed(6),
      totalCost: `$${costs.totalCost.toFixed(4)}`,
      currency: 'USD'
    },
    
    // Session totals
    sessionTotals: {
      operations: sessionRecords.length,
      totalCost: `$${getSessionSummary().cost.total.toFixed(4)}`
    },
    
    timestamp: record.timestamp.toISOString()
  });
  
  return record;
}

/**
 * Log API request start
 */
export function logApiRequest(params: {
  operationType: OperationType;
  model?: GeminiModel;
  estimatedInputTokens: number;
  contextDetails?: any;
}): { startTime: number } {
  const startTime = Date.now();
  
  console.log('🚀 [API CALL] Gemini Request', {
    operation: params.operationType,
    model: params.model || 'gemini-2.5-flash-lite',
    estimatedInputTokens: params.estimatedInputTokens,
    ...params.contextDetails,
    timestamp: new Date().toISOString()
  });
  
  return { startTime };
}

/**
 * Get current session summary
 */
export function getSessionSummary(): SessionSummary {
  const now = new Date();
  const durationMs = now.getTime() - sessionStartTime.getTime();
  const durationMinutes = Math.round(durationMs / 60000);
  
  // Count operations by type
  const pdfUploads = sessionRecords.filter(r => 
    r.operationType === 'pdf_upload' && r.isFullUpload
  ).length;
  
  const pdfUpdates = sessionRecords.filter(r => 
    r.operationType === 'pdf_update' || (r.operationType === 'pdf_upload' && r.isDeltaUpdate)
  ).length;
  
  const chatMessages = sessionRecords.filter(r => 
    r.operationType === 'chat_query'
  ).length;
  
  const quotesGenerated = sessionRecords.filter(r => 
    r.operationType === 'quote_generation'
  ).length;
  
  // DEBUG: Log all operations in session
  console.log('🔍 Token Debug - All Operations in Session:');
  const operationCounts = sessionRecords.reduce((acc, r) => {
    acc[r.operationType] = (acc[r.operationType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.table(operationCounts);
  
  sessionRecords.forEach(r => {
    console.log(`- ${r.operationType}: ${r.metrics.inputTokens}/${r.metrics.outputTokens} tokens (${r.pdfFileName || 'N/A'})`);
  });
  
  // Calculate totals
  const totalInput = sessionRecords.reduce((sum, r) => sum + r.metrics.inputTokens, 0);
  const totalOutput = sessionRecords.reduce((sum, r) => sum + r.metrics.outputTokens, 0);
  const grandTotal = totalInput + totalOutput;
  
  console.log(`📊 Total Input: ${totalInput}, Total Output: ${totalOutput}, Grand Total: ${grandTotal}`);
  
  // Calculate costs by type
  const uploadCost = sessionRecords
    .filter(r => r.operationType === 'pdf_upload' && r.isFullUpload)
    .reduce((sum, r) => sum + r.metrics.totalCost, 0);
    
  const updateCost = sessionRecords
    .filter(r => r.operationType === 'pdf_update' || (r.operationType === 'pdf_upload' && r.isDeltaUpdate))
    .reduce((sum, r) => sum + r.metrics.totalCost, 0);
    
  const chatCost = sessionRecords
    .filter(r => r.operationType === 'chat_query' || r.operationType === 'quote_generation')
    .reduce((sum, r) => sum + r.metrics.totalCost, 0);
    
  const totalCost = uploadCost + updateCost + chatCost;
  
  // Calculate averages
  const tokensPerChat = chatMessages > 0 ? Math.round(grandTotal / chatMessages) : 0;
  const costPerChat = chatMessages > 0 ? chatCost / chatMessages : 0;
  const tokensPerUpload = pdfUploads > 0 ? Math.round(totalInput / pdfUploads) : 0;
  const costPerUpload = pdfUploads > 0 ? uploadCost / pdfUploads : 0;
  
  return {
    sessionId: currentSessionId,
    userId: sessionRecords[0]?.userId,
    startTime: sessionStartTime,
    endTime: now,
    durationMinutes,
    operations: {
      pdfUploads,
      pdfUpdates,
      chatMessages,
      quotesGenerated,
      totalOperations: sessionRecords.length
    },
    tokens: {
      totalInput,
      totalOutput,
      grandTotal
    },
    cost: {
      uploads: uploadCost,
      updates: updateCost,
      chats: chatCost,
      total: totalCost
    },
    averages: {
      tokensPerChat,
      costPerChat,
      tokensPerUpload,
      costPerUpload
    },
    records: [...sessionRecords],
    cards: {
      pdfUpload: buildPdfUploadCardData(),
      quoteGeneration: buildQuoteGenerationCardData(),
      chatOperations: buildChatOperationsCardData(),
      imageProcessing: buildImageProcessingCardData()
    }
  };
}

/**
 * Build PDF Upload card data
 */
function buildPdfUploadCardData() {
  const pdfUploadRecords = sessionRecords.filter(r => 
    r.operationType === 'pdf_upload' || r.operationType === 'service_extraction'
  );
  
  const imageDetectionRecords = sessionRecords.filter(r => 
    r.operationType === 'image_detection'
  );
  
  const registryBuildRecords = sessionRecords.filter(r => 
    r.operationType === 'registry_build'
  );
  
  if (pdfUploadRecords.length === 0) return undefined;
  
  // Build individual upload entries - one per upload (no grouping by filename)
  const uploads = pdfUploadRecords.map((uploadRecord, index) => {
    const fileName = uploadRecord.pdfFileName || 'Unknown';
    const pageCount = uploadRecord.contextSize || 0;
    
    // Get only this specific upload's metrics
    const initialInput = uploadRecord.metrics.inputTokens;
    const initialOutput = uploadRecord.metrics.outputTokens;
    const initialTime = uploadRecord.metrics.processingTimeMs / 1000;
    const initialCost = uploadRecord.metrics.totalCost;
    
    // Get image detection records for this specific PDF upload
    // Match by filename AND timestamp proximity (within 5 minutes to capture auto-load)
    const uploadTime = uploadRecord.timestamp.getTime();
    const pdfImageDetections = imageDetectionRecords.filter(r => {
      const timeDiff = Math.abs(r.timestamp.getTime() - uploadTime);
      return r.pdfFileName === fileName && timeDiff < 300000; // Within 5 minutes
    });
    
    const imageInput = pdfImageDetections.reduce((sum, r) => sum + r.metrics.inputTokens, 0);
    const imageOutput = pdfImageDetections.reduce((sum, r) => sum + r.metrics.outputTokens, 0);
    const imageTime = pdfImageDetections.reduce((sum, r) => sum + r.metrics.processingTimeMs, 0) / 1000;
    const imageCost = pdfImageDetections.reduce((sum, r) => sum + r.metrics.totalCost, 0);
    
    // Get registry build records for this specific PDF upload
    // Match by filename AND timestamp proximity (within 5 minutes to capture auto-load)
    const pdfRegistryBuilds = registryBuildRecords.filter(r => {
      const timeDiff = Math.abs(r.timestamp.getTime() - uploadTime);
      return r.pdfFileName === fileName && timeDiff < 300000; // Within 5 minutes
    });
    
    const registryInput = pdfRegistryBuilds.reduce((sum, r) => sum + r.metrics.inputTokens, 0);
    const registryOutput = pdfRegistryBuilds.reduce((sum, r) => sum + r.metrics.outputTokens, 0);
    const registryTime = pdfRegistryBuilds.reduce((sum, r) => sum + r.metrics.processingTimeMs, 0) / 1000;
    const registryCost = pdfRegistryBuilds.reduce((sum, r) => sum + r.metrics.totalCost, 0);
    
    return {
      uploadNumber: index + 1,
      fileName,
      pageCount,
      servicesFound: 35, // TODO: Extract from actual service extraction
      
      initialUpload: {
        inputTokens: initialInput,
        outputTokens: initialOutput,
        timeSeconds: initialTime,
        cost: initialCost
      },
      
      imageDetection: {
        pagesProcessed: pdfImageDetections.length,
        imagesExtracted: pdfImageDetections.length * 2, // Average estimate
        inputTokens: imageInput,
        outputTokens: imageOutput,
        timeSeconds: imageTime,
        cost: imageCost
      },
      
      registryBuild: {
        operationsCount: pdfRegistryBuilds.length,
        inputTokens: registryInput,
        outputTokens: registryOutput,
        timeSeconds: registryTime,
        cost: registryCost
      },
      
      uploadTotal: initialInput + initialOutput + imageInput + imageOutput + registryInput + registryOutput,
      uploadCost: initialCost + imageCost + registryCost
    };
  });
  
  // Calculate totals across all uploads
  const totalTokens = uploads.reduce((sum, u) => sum + u.uploadTotal, 0);
  const totalCost = uploads.reduce((sum, u) => sum + u.uploadCost, 0);
  
  return {
    totalUploads: uploads.length,
    uploads,
    totalTokens,
    totalCost
  };
}

/**
 * Build Quote Generation card data
 */
function buildQuoteGenerationCardData() {
  const quoteRecords = sessionRecords.filter(r => 
    r.operationType === 'quote_generation'
  );
  
  if (quoteRecords.length === 0) return undefined;
  
  const batches = quoteRecords.map((record, index) => {
    const serviceCount = 10; // TODO: Extract from operation details
    const serviceNames = ['Bus Branding', 'Auto Stickers', 'Metro Arch']; // TODO: Extract actual names
    
    return {
      batchNumber: index + 1,
      serviceCount,
      serviceNames,
      inputTokens: record.metrics.inputTokens,
      outputTokens: record.metrics.outputTokens,
      timeSeconds: record.metrics.processingTimeMs / 1000,
      cost: record.metrics.totalCost,
      costPerService: record.metrics.totalCost / serviceCount
    };
  });
  
  const totalInput = quoteRecords.reduce((sum, r) => sum + r.metrics.inputTokens, 0);
  const totalOutput = quoteRecords.reduce((sum, r) => sum + r.metrics.outputTokens, 0);
  const totalCost = quoteRecords.reduce((sum, r) => sum + r.metrics.totalCost, 0);
  const totalQuotes = batches.reduce((sum, b) => sum + b.serviceCount, 0);
  
  return {
    totalBatches: batches.length,
    batches,
    totalInput,
    totalOutput,
    totalCost,
    averageCostPerQuote: totalQuotes > 0 ? totalCost / totalQuotes : 0
  };
}

/**
 * Build Chat Operations card data (all chat queries and quote requests)
 */
function buildChatOperationsCardData() {
  const chatRecords = sessionRecords.filter(r => 
    r.operationType === 'chat_query' || r.operationType === 'quote_generation'
  );
  
  if (chatRecords.length === 0) return undefined;
  
  const operations = chatRecords.map((record, index) => ({
    operationNumber: index + 1,
    type: record.operationType as 'chat_query' | 'quote_generation',
    userMessage: record.operationDetails,
    timestamp: record.timestamp,
    inputTokens: record.metrics.inputTokens,
    outputTokens: record.metrics.outputTokens,
    timeSeconds: record.metrics.processingTimeMs / 1000,
    cost: record.metrics.totalCost
  }));
  
  const totalInput = chatRecords.reduce((sum, r) => sum + r.metrics.inputTokens, 0);
  const totalOutput = chatRecords.reduce((sum, r) => sum + r.metrics.outputTokens, 0);
  const totalCost = chatRecords.reduce((sum, r) => sum + r.metrics.totalCost, 0);
  
  return {
    totalOperations: operations.length,
    operations,
    totalInput,
    totalOutput,
    totalCost
  };
}

/**
 * Build Image Processing card data
 */
function buildImageProcessingCardData() {
  const imageRecords = sessionRecords.filter(r => 
    r.operationType === 'image_detection'
  );
  
  if (imageRecords.length === 0) return undefined;
  
  const totalInput = imageRecords.reduce((sum, r) => sum + r.metrics.inputTokens, 0);
  const totalOutput = imageRecords.reduce((sum, r) => sum + r.metrics.outputTokens, 0);
  const totalTime = imageRecords.reduce((sum, r) => sum + r.metrics.processingTimeMs, 0) / 1000;
  const totalCost = imageRecords.reduce((sum, r) => sum + r.metrics.totalCost, 0);
  
  return {
    method: 'gemini' as const,
    
    uploadDetection: {
      pagesProcessed: imageRecords.length,
      imagesDetected: imageRecords.length * 2, // Average estimate
      inputTokens: totalInput,
      outputTokens: totalOutput,
      timeSeconds: totalTime,
      cost: totalCost
    },
    
    previewDetection: {
      pagesViewed: 0, // TODO: Track preview separately
      reDetections: 0,
      cost: 0
    },
    
    totalCost,
    nativeCostComparison: '$0 with native extraction'
  };
}

/**
 * Log session summary to console
 */
export function logSessionSummary(): void {
  const summary = getSessionSummary();
  
  console.log('📊 [SESSION SUMMARY]', {
    sessionId: summary.sessionId,
    userId: summary.userId || 'anonymous',
    duration: `${summary.durationMinutes} minutes`,
    
    operations: {
      pdfUploads: summary.operations.pdfUploads,
      pdfUpdates: summary.operations.pdfUpdates,
      chatMessages: summary.operations.chatMessages,
      quotesGenerated: summary.operations.quotesGenerated
    },
    
    tokens: {
      totalInput: summary.tokens.totalInput,
      totalOutput: summary.tokens.totalOutput,
      grandTotal: summary.tokens.grandTotal
    },
    
    cost: {
      uploads: `$${summary.cost.uploads.toFixed(4)}`,
      updates: `$${summary.cost.updates.toFixed(4)}`,
      chats: `$${summary.cost.chats.toFixed(4)}`,
      total: `$${summary.cost.total.toFixed(4)}`
    },
    
    averages: {
      tokensPerChat: summary.averages.tokensPerChat,
      costPerChat: `$${summary.averages.costPerChat.toFixed(4)}`,
      tokensPerUpload: summary.averages.tokensPerUpload,
      costPerUpload: `$${summary.averages.costPerUpload.toFixed(4)}`
    },
    
    timestamp: new Date().toISOString()
  });
}

/**
 * Reset session (for new user session)
 */
export function resetSession(): void {
  currentSessionId = generateSessionId();
  sessionStartTime = new Date();
  sessionRecords.length = 0;
  
  // Clear localStorage
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear localStorage:', error);
  }
  
  console.log('🔄 [SESSION RESET]', {
    newSessionId: currentSessionId,
    timestamp: sessionStartTime.toISOString()
  });
}

/**
 * Log delta comparison for PDF updates
 */
export function logDeltaComparison(comparison: DeltaComparison): void {
  console.log('🔐 [DELTA DETECTION]', {
    newFileHash: comparison.newFileHash.substring(0, 12) + '...',
    previousFileHash: comparison.previousFileHash.substring(0, 12) + '...',
    filesIdentical: comparison.filesIdentical,
    
    pageComparison: {
      totalPages: comparison.totalPages,
      unchangedPages: comparison.unchangedPages,
      changedPages: comparison.changedPages,
      changedCount: comparison.changedCount,
      changePercentage: `${comparison.changePercentage.toFixed(1)}%`
    },
    
    optimizationPlan: {
      skipPages: comparison.optimizationPlan.skipPages,
      processPages: comparison.optimizationPlan.processPages,
      expectedTokenSavings: `${comparison.optimizationPlan.expectedTokenSavings.toFixed(1)}%`,
      estimatedTokens: comparison.optimizationPlan.estimatedTokens,
      estimatedCost: `$${comparison.optimizationPlan.estimatedCost.toFixed(4)}`
    }
  });
  
  // Log actual results if available
  if (comparison.actualResults) {
    console.log('💰 [DELTA SAVINGS]', {
      tokensUsed: comparison.actualResults.tokensUsed,
      tokensSaved: comparison.actualResults.tokensSaved,
      savingsPercentage: `${comparison.actualResults.savingsPercentage.toFixed(1)}%`,
      costThisUpdate: `$${comparison.actualResults.costThisUpdate.toFixed(4)}`,
      costFullUpdate: `$${comparison.actualResults.costFullUpdate.toFixed(4)}`,
      savings: `$${comparison.actualResults.costSavings.toFixed(4)}`
    });
  }
}

/**
 * Estimate tokens from text length
 * Rule of thumb: ~4 characters per token for English text
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Export current session data
 */
export function exportSessionData(): SessionSummary {
  return getSessionSummary();
}

/**
 * Get session ID
 */
export function getCurrentSessionId(): string {
  return currentSessionId;
}

// Auto-log session summary every 5 minutes
if (typeof window !== 'undefined') {
  setInterval(() => {
    if (sessionRecords.length > 0) {
      logSessionSummary();
    }
  }, 5 * 60 * 1000); // 5 minutes
}
