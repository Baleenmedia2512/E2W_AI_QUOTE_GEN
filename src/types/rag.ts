/**
 * RAG (Retrieval-Augmented Generation) Type Definitions
 */

// Document chunk with metadata
export interface DocumentChunk {
  index: number;
  text: string;
  metadata: {
    startChar: number;
    endChar: number;
    wordCount: number;
    source?: string;
    documentId?: string;
  };
}

// Stored chunk in database
export interface StoredChunk {
  id: string;
  proposal_id: string;
  chunk_index: number;
  chunk_text: string;
  chunk_metadata: Record<string, any>;
  embedding: number[] | null;
  created_at: string;
  updated_at: string;
}

// Similar chunk from search
export interface SimilarChunk {
  id: string;
  proposal_id: string;
  chunk_text: string;
  chunk_metadata: Record<string, any>;
  similarity: number;
}

// Embedding result
export interface EmbeddingResult {
  embedding: number[];
  dimensions: number;
  modelName: string;
  processingTime: number;
}

// RAG query result
export interface RAGQueryResult {
  context: string;
  chunks: SimilarChunk[];
  queryTime: number;
  relevanceScore: number;
}

// RAG processing result
export interface RAGProcessingResult {
  proposalId: string;
  fileName: string;
  chunksCreated: number;
  embeddingsGenerated: number;
  processingTime: number;
  stats: ChunkStatistics;
}

// Chunk statistics
export interface ChunkStatistics {
  totalChunks: number;
  totalCharacters: number;
  totalWords: number;
  avgChunkSize: number;
  avgWordCount: number;
  minChunkSize: number;
  maxChunkSize: number;
}

// RAG system status
export interface RAGSystemStatus {
  modelInfo: {
    name: string;
    dimensions: number;
    isLoaded: boolean;
    isInitializing: boolean;
    approximateSize: string;
    provider: string;
  } | null;
  storeStats: {
    totalChunks: number;
    totalProposals: number;
    proposalsWithEmbeddings: number;
    averageChunksPerProposal: number;
  } | null;
  isReady: boolean;
}

// Chunking options
export interface ChunkingOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  minChunkSize?: number;
  preserveParagraphs?: boolean;
}

// RAG processing options
export interface RAGProcessingOptions {
  chunkingOptions?: ChunkingOptions;
  onProgress?: (stage: string, current: number, total: number) => void;
  replaceExisting?: boolean;
}

// RAG query options
export interface RAGQueryOptions {
  matchThreshold?: number;
  matchCount?: number;
  proposalId?: string;
  minContextLength?: number;
}
