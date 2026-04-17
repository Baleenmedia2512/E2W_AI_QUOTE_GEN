/**
 * RAG (Retrieval-Augmented Generation) Service
 * Orchestrates the entire RAG pipeline:
 * 1. Process documents -> chunks
 * 2. Generate embeddings locally
 * 3. Store in Supabase
 * 4. Retrieve relevant context for queries
 */

import { 
  chunkDocument, 
  DocumentChunk, 
  getChunkStatistics,
  ChunkingOptions 
} from './chunkingService';
import {
  generateEmbedding,
  generateBatchEmbeddings,
  initializeEmbeddingModel,
} from './embeddingService';
import {
  storeDocumentChunks,
  searchSimilarChunks,
  hasProposalEmbeddings,
  getProposalChunks,
  deleteProposalChunks,
  SimilarChunk,
  ChunkWithEmbedding,
} from './vectorStoreService';

export interface RAGProcessingResult {
  proposalId: string;
  fileName: string;
  chunksCreated: number;
  embeddingsGenerated: number;
  processingTime: number;
  stats: ReturnType<typeof getChunkStatistics>;
}

export interface RAGQueryResult {
  context: string;
  chunks: SimilarChunk[];
  queryTime: number;
  relevanceScore: number;
}

/**
 * Process a document for RAG
 * This is the main entry point for adding documents to the RAG system
 */
export async function processDocumentForRAG(
  proposalId: string,
  fileName: string,
  documentText: string,
  options: {
    chunkingOptions?: ChunkingOptions;
    onProgress?: (stage: string, current: number, total: number) => void;
    replaceExisting?: boolean;
  } = {}
): Promise<RAGProcessingResult> {
  const { chunkingOptions, onProgress, replaceExisting = false } = options;
  const startTime = performance.now();

  try {
    console.log(`🚀 Processing document for RAG: ${fileName}`);

    // Step 0: Initialize model if needed
    onProgress?.('Initializing model', 0, 1);
    await initializeEmbeddingModel();

    // Step 1: Check if embeddings already exist
    if (!replaceExisting && await hasProposalEmbeddings(proposalId)) {
      console.log('ℹ️ Embeddings already exist for this proposal');
      const chunks = await getProposalChunks(proposalId);
      return {
        proposalId,
        fileName,
        chunksCreated: chunks.length,
        embeddingsGenerated: chunks.length,
        processingTime: 0,
        stats: getChunkStatistics(chunks.map(c => ({
          index: c.chunk_index,
          text: c.chunk_text,
          metadata: c.chunk_metadata,
        }))),
      };
    }

    // Step 2: Delete existing chunks if replacing
    if (replaceExisting) {
      onProgress?.('Deleting existing chunks', 0, 1);
      await deleteProposalChunks(proposalId);
    }

    // Step 3: Chunk the document
    onProgress?.('Chunking document', 0, 1);
    const chunks = chunkDocument(
      documentText,
      proposalId,
      fileName,
      chunkingOptions
    );

    if (chunks.length === 0) {
      throw new Error('No chunks created from document. Text may be too short.');
    }

    console.log(`📄 Created ${chunks.length} chunks`);
    const stats = getChunkStatistics(chunks);
    console.log('📊 Chunk stats:', stats);

    // Step 4: Generate embeddings for all chunks
    onProgress?.('Generating embeddings', 0, chunks.length);
    
    const texts = chunks.map(c => c.text);
    const embeddingResults = await generateBatchEmbeddings(texts, {
      batchSize: 10,
      onProgress: (current, total) => {
        onProgress?.('Generating embeddings', current, total);
      },
    });

    // Step 5: Combine chunks with embeddings
    const chunksWithEmbeddings: ChunkWithEmbedding[] = chunks.map((chunk, i) => ({
      chunk,
      embedding: embeddingResults.embeddings[i],
    }));

    // Step 6: Store in Supabase
    onProgress?.('Storing in database', 0, chunks.length);
    await storeDocumentChunks(proposalId, chunksWithEmbeddings, {
      onProgress: (current, total) => {
        onProgress?.('Storing in database', current, total);
      },
    });

    const processingTime = performance.now() - startTime;

    console.log(`✅ RAG processing complete in ${(processingTime / 1000).toFixed(2)}s`);

    return {
      proposalId,
      fileName,
      chunksCreated: chunks.length,
      embeddingsGenerated: embeddingResults.embeddings.length,
      processingTime,
      stats,
    };
  } catch (error) {
    console.error('❌ Error processing document for RAG:', error);
    throw error;
  }
}

/**
 * Query the RAG system to get relevant context
 * This is called before sending a message to Gemini
 */
export async function queryRAG(
  userQuery: string,
  options: {
    matchThreshold?: number;
    matchCount?: number;
    proposalId?: string;
    minContextLength?: number;
  } = {}
): Promise<RAGQueryResult> {
  const {
    matchThreshold = 0.7,
    matchCount = 5,
    proposalId,
    minContextLength = 100,
  } = options;

  const startTime = performance.now();

  try {
    console.log(`🔍 Querying RAG system: "${userQuery.slice(0, 50)}..."`);

    // Step 1: Generate embedding for query
    const { embedding } = await generateEmbedding(userQuery);

    // Step 2: Search for similar chunks
    const chunks = await searchSimilarChunks(embedding, {
      matchThreshold,
      matchCount,
      proposalId,
    });

    if (chunks.length === 0) {
      console.log('ℹ️ No relevant chunks found');
      return {
        context: '',
        chunks: [],
        queryTime: performance.now() - startTime,
        relevanceScore: 0,
      };
    }

    // Step 3: Build context from chunks
    const context = buildContext(chunks, minContextLength);
    
    // Step 4: Calculate average relevance score
    const avgRelevance = chunks.reduce((sum, c) => sum + c.similarity, 0) / chunks.length;

    const queryTime = performance.now() - startTime;

    console.log(`✅ Found ${chunks.length} relevant chunks (avg similarity: ${avgRelevance.toFixed(2)})`);

    return {
      context,
      chunks,
      queryTime,
      relevanceScore: avgRelevance,
    };
  } catch (error) {
    console.error('❌ Error querying RAG:', error);
    throw error;
  }
}

/**
 * Build formatted context string from chunks
 */
function buildContext(chunks: SimilarChunk[], minLength: number): string {
  if (chunks.length === 0) return '';

  let context = '--- Relevant Context from Proposals ---\n\n';

  chunks.forEach((chunk, index) => {
    const source = chunk.chunk_metadata?.source || 'Unknown';
    const similarity = (chunk.similarity * 100).toFixed(0);
    
    context += `[Source ${index + 1}: ${source} - Relevance: ${similarity}%]\n`;
    context += `${chunk.chunk_text}\n\n`;
  });

  context += '--- End of Context ---\n';

  // Ensure minimum context length
  if (context.length < minLength && chunks.length > 0) {
    console.warn('⚠️ Context shorter than minimum length');
  }

  return context;
}

/**
 * Process multiple documents in parallel
 */
export async function processBatchDocuments(
  documents: Array<{
    proposalId: string;
    fileName: string;
    text: string;
  }>,
  options: {
    chunkingOptions?: ChunkingOptions;
    onProgress?: (fileName: string, stage: string, current: number, total: number) => void;
    onComplete?: (fileName: string, result: RAGProcessingResult) => void;
    onError?: (fileName: string, error: Error) => void;
  } = {}
): Promise<RAGProcessingResult[]> {
  const { chunkingOptions, onProgress, onComplete, onError } = options;

  console.log(`📚 Processing ${documents.length} documents...`);

  const results: RAGProcessingResult[] = [];

  // Process sequentially to avoid overwhelming the system
  for (const doc of documents) {
    try {
      const result = await processDocumentForRAG(
        doc.proposalId,
        doc.fileName,
        doc.text,
        {
          chunkingOptions,
          onProgress: (stage, current, total) => {
            onProgress?.(doc.fileName, stage, current, total);
          },
        }
      );

      results.push(result);
      onComplete?.(doc.fileName, result);
    } catch (error) {
      console.error(`❌ Error processing ${doc.fileName}:`, error);
      onError?.(doc.fileName, error as Error);
    }
  }

  console.log(`✅ Processed ${results.length}/${documents.length} documents successfully`);

  return results;
}

/**
 * Check if RAG is available and ready
 */
export async function isRAGReady(): Promise<boolean> {
  try {
    await initializeEmbeddingModel();
    return true;
  } catch (error) {
    console.error('❌ RAG not ready:', error);
    return false;
  }
}

/**
 * Get RAG system status
 */
export async function getRAGStatus() {
  try {
    const { getModelInfo } = await import('./embeddingService');
    const { getVectorStoreStats } = await import('./vectorStoreService');

    const modelInfo = getModelInfo();
    const storeStats = await getVectorStoreStats();

    return {
      modelInfo,
      storeStats,
      isReady: modelInfo.isLoaded,
    };
  } catch (error) {
    console.error('❌ Error getting RAG status:', error);
    return {
      modelInfo: null,
      storeStats: null,
      isReady: false,
    };
  }
}
