/**
 * Local Embedding Service using Transformers.js
 * Generates embeddings 100% locally in the browser
 * Model: all-MiniLM-L6-v2 (384 dimensions)
 */

import { pipeline, env, Pipeline } from '@xenova/transformers';

// Configure Transformers.js
env.allowLocalModels = false; // Use CDN models
env.allowRemoteModels = true;

// Singleton pipeline instance
let embeddingPipeline: Pipeline | null = null;
let isInitializing = false;
let initializationPromise: Promise<void> | null = null;

export interface EmbeddingResult {
  embedding: number[];
  dimensions: number;
  modelName: string;
  processingTime: number;
}

export interface BatchEmbeddingResult {
  embeddings: number[][];
  dimensions: number;
  modelName: string;
  totalProcessingTime: number;
  averagePerItem: number;
}

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIMENSIONS = 384;

/**
 * Initialize the embedding model
 * Downloads model on first run (~22MB), then cached
 */
export async function initializeEmbeddingModel(): Promise<void> {
  if (embeddingPipeline) {
    console.log('✅ Embedding model already loaded');
    return;
  }

  if (isInitializing && initializationPromise) {
    console.log('⏳ Waiting for model initialization...');
    return initializationPromise;
  }

  isInitializing = true;
  initializationPromise = (async () => {
    try {
      console.log('📦 Initializing embedding model:', MODEL_NAME);
      console.log('⏳ First load will download ~22MB (cached after)...');
      
      const startTime = performance.now();
      
      // Create feature extraction pipeline
      embeddingPipeline = await pipeline('feature-extraction', MODEL_NAME);
      
      const loadTime = performance.now() - startTime;
      console.log(`✅ Model loaded in ${(loadTime / 1000).toFixed(2)}s`);
      
      isInitializing = false;
    } catch (error) {
      isInitializing = false;
      embeddingPipeline = null;
      console.error('❌ Failed to initialize embedding model:', error);
      throw new Error('Failed to load embedding model. Check console for details.');
    }
  })();

  return initializationPromise;
}

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  if (!text || text.trim().length === 0) {
    throw new Error('Cannot generate embedding for empty text');
  }

  // Initialize model if needed
  if (!embeddingPipeline) {
    await initializeEmbeddingModel();
  }

  if (!embeddingPipeline) {
    throw new Error('Embedding model not initialized');
  }

  try {
    const startTime = performance.now();
    
    // Generate embedding
    const output = await embeddingPipeline(text, {
      pooling: 'mean', // Mean pooling for sentence embeddings
      normalize: true, // L2 normalization
    });

    // Extract the embedding array
    const embedding = Array.from(output.data) as number[];
    
    const processingTime = performance.now() - startTime;

    // Verify dimensions
    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      console.warn(
        `⚠️ Unexpected embedding dimensions: ${embedding.length} (expected ${EMBEDDING_DIMENSIONS})`
      );
    }

    return {
      embedding,
      dimensions: embedding.length,
      modelName: MODEL_NAME,
      processingTime,
    };
  } catch (error) {
    console.error('❌ Error generating embedding:', error);
    throw new Error('Failed to generate embedding. See console for details.');
  }
}

/**
 * Generate embeddings for multiple texts in batch
 * More efficient than calling generateEmbedding multiple times
 */
export async function generateBatchEmbeddings(
  texts: string[],
  options: {
    batchSize?: number;
    onProgress?: (current: number, total: number) => void;
  } = {}
): Promise<BatchEmbeddingResult> {
  const { batchSize = 10, onProgress } = options;

  if (texts.length === 0) {
    return {
      embeddings: [],
      dimensions: EMBEDDING_DIMENSIONS,
      modelName: MODEL_NAME,
      totalProcessingTime: 0,
      averagePerItem: 0,
    };
  }

  // Initialize model if needed
  if (!embeddingPipeline) {
    await initializeEmbeddingModel();
  }

  if (!embeddingPipeline) {
    throw new Error('Embedding model not initialized');
  }

  const startTime = performance.now();
  const embeddings: number[][] = [];

  try {
    // Process in batches to avoid memory issues
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, Math.min(i + batchSize, texts.length));
      
      // Generate embeddings for batch
      const batchResults = await Promise.all(
        batch.map(async (text) => {
          if (!text || text.trim().length === 0) {
            console.warn(`⚠️ Skipping empty text at index ${i}`);
            return new Array(EMBEDDING_DIMENSIONS).fill(0);
          }
          
          const output = await embeddingPipeline!(text, {
            pooling: 'mean',
            normalize: true,
          });
          
          return Array.from(output.data) as number[];
        })
      );

      embeddings.push(...batchResults);

      // Report progress
      if (onProgress) {
        onProgress(embeddings.length, texts.length);
      }
    }

    const totalProcessingTime = performance.now() - startTime;
    const averagePerItem = totalProcessingTime / texts.length;

    console.log(
      `✅ Generated ${embeddings.length} embeddings in ${(totalProcessingTime / 1000).toFixed(2)}s` +
      ` (avg: ${averagePerItem.toFixed(0)}ms per item)`
    );

    return {
      embeddings,
      dimensions: EMBEDDING_DIMENSIONS,
      modelName: MODEL_NAME,
      totalProcessingTime,
      averagePerItem,
    };
  } catch (error) {
    console.error('❌ Error generating batch embeddings:', error);
    throw new Error('Failed to generate batch embeddings. See console for details.');
  }
}

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(embedding1: number[], embedding2: number[]): number {
  if (embedding1.length !== embedding2.length) {
    throw new Error('Embeddings must have the same dimensions');
  }

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < embedding1.length; i++) {
    dotProduct += embedding1[i] * embedding2[i];
    norm1 += embedding1[i] * embedding1[i];
    norm2 += embedding2[i] * embedding2[i];
  }

  const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
  
  if (magnitude === 0) {
    return 0;
  }

  return dotProduct / magnitude;
}

/**
 * Preload the model (call on app startup)
 */
export async function preloadEmbeddingModel(): Promise<void> {
  console.log('🚀 Preloading embedding model in background...');
  
  try {
    await initializeEmbeddingModel();
    
    // Test with a simple embedding to warm up the model
    await generateEmbedding('test');
    
    console.log('✅ Embedding model ready for use');
  } catch (error) {
    console.error('⚠️ Failed to preload embedding model:', error);
  }
}

/**
 * Get model info
 */
export function getModelInfo() {
  return {
    name: MODEL_NAME,
    dimensions: EMBEDDING_DIMENSIONS,
    isLoaded: embeddingPipeline !== null,
    isInitializing,
    approximateSize: '~22MB',
    provider: 'Transformers.js (Local)',
  };
}

/**
 * Clear the model from memory (use if needed to free resources)
 */
export async function unloadEmbeddingModel(): Promise<void> {
  if (embeddingPipeline) {
    console.log('🗑️ Unloading embedding model...');
    // The pipeline doesn't have a dispose method, just clear the reference
    embeddingPipeline = null;
    console.log('✅ Model unloaded');
  }
}
