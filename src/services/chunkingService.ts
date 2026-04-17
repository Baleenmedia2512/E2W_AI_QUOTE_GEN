/**
 * Document Chunking Service
 * Splits documents into semantic chunks for RAG processing
 */

export interface DocumentChunk {
  index: number;
  text: string;
  metadata: {
    startChar: number;
    endChar: number;
    wordCount: number;
    source?: string;
  };
}

export interface ChunkingOptions {
  chunkSize?: number; // Characters per chunk
  chunkOverlap?: number; // Overlap between chunks
  minChunkSize?: number; // Minimum chunk size
  preserveParagraphs?: boolean; // Try to keep paragraphs intact
}

const DEFAULT_OPTIONS: Required<ChunkingOptions> = {
  chunkSize: 1000, // ~200-250 words
  chunkOverlap: 200, // 20% overlap for context continuity
  minChunkSize: 100, // Minimum viable chunk
  preserveParagraphs: true,
};

/**
 * Clean and normalize text
 */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, '\n') // Normalize line endings
    .replace(/\t/g, ' ') // Replace tabs with spaces
    .replace(/\n{3,}/g, '\n\n') // Normalize multiple newlines
    .replace(/[ ]{2,}/g, ' ') // Normalize multiple spaces
    .trim();
}

/**
 * Split text into sentences (simple approach)
 */
function splitIntoSentences(text: string): string[] {
  // Split on sentence endings but keep common abbreviations intact
  const sentences: string[] = [];
  const parts = text.split(/([.!?]+\s+)/);
  
  let currentSentence = '';
  for (let i = 0; i < parts.length; i++) {
    currentSentence += parts[i];
    
    // If this is a sentence-ending pattern and next part starts with capital
    if (parts[i].match(/[.!?]+\s+/) && parts[i + 1]) {
      const nextChar = parts[i + 1].trim()[0];
      if (nextChar && nextChar === nextChar.toUpperCase()) {
        sentences.push(currentSentence.trim());
        currentSentence = '';
      }
    }
  }
  
  if (currentSentence.trim()) {
    sentences.push(currentSentence.trim());
  }
  
  return sentences.filter(s => s.length > 0);
}

/**
 * Split text into paragraphs
 */
function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

/**
 * Count words in text
 */
function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Main chunking function - splits text into overlapping chunks
 */
export function chunkText(
  text: string,
  options: ChunkingOptions = {}
): DocumentChunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const cleanedText = cleanText(text);
  
  if (cleanedText.length === 0) {
    return [];
  }

  const chunks: DocumentChunk[] = [];
  
  if (opts.preserveParagraphs) {
    // Strategy: Split by paragraphs, then combine to fit chunk size
    const paragraphs = splitIntoParagraphs(cleanedText);
    let currentChunk = '';
    let currentStartChar = 0;
    let chunkIndex = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const testChunk = currentChunk + (currentChunk ? '\n\n' : '') + para;

      if (testChunk.length > opts.chunkSize && currentChunk.length > opts.minChunkSize) {
        // Save current chunk
        chunks.push({
          index: chunkIndex++,
          text: currentChunk,
          metadata: {
            startChar: currentStartChar,
            endChar: currentStartChar + currentChunk.length,
            wordCount: countWords(currentChunk),
          },
        });

        // Start new chunk with overlap
        const overlapText = getOverlapText(currentChunk, opts.chunkOverlap);
        currentChunk = overlapText + (overlapText ? '\n\n' : '') + para;
        currentStartChar = currentStartChar + currentChunk.length - overlapText.length;
      } else {
        currentChunk = testChunk;
      }
    }

    // Add remaining chunk
    if (currentChunk.length >= opts.minChunkSize) {
      chunks.push({
        index: chunkIndex++,
        text: currentChunk,
        metadata: {
          startChar: currentStartChar,
          endChar: currentStartChar + currentChunk.length,
          wordCount: countWords(currentChunk),
        },
      });
    }
  } else {
    // Simple sliding window approach
    let position = 0;
    let chunkIndex = 0;

    while (position < cleanedText.length) {
      let endPosition = Math.min(position + opts.chunkSize, cleanedText.length);

      // Try to end at sentence boundary
      if (endPosition < cleanedText.length) {
        const nextPeriod = cleanedText.indexOf('. ', endPosition);
        const nextNewline = cleanedText.indexOf('\n', endPosition);
        const boundary = Math.min(
          nextPeriod !== -1 ? nextPeriod + 1 : Infinity,
          nextNewline !== -1 ? nextNewline : Infinity
        );

        if (boundary !== Infinity && boundary - endPosition < 100) {
          endPosition = boundary;
        }
      }

      const chunkText = cleanedText.slice(position, endPosition).trim();

      if (chunkText.length >= opts.minChunkSize) {
        chunks.push({
          index: chunkIndex++,
          text: chunkText,
          metadata: {
            startChar: position,
            endChar: endPosition,
            wordCount: countWords(chunkText),
          },
        });
      }

      position = endPosition - opts.chunkOverlap;
      if (position <= 0) position = endPosition;
    }
  }

  return chunks;
}

/**
 * Get overlap text from end of chunk
 */
function getOverlapText(text: string, overlapSize: number): string {
  if (text.length <= overlapSize) {
    return text;
  }

  const overlap = text.slice(-overlapSize);
  
  // Try to start at sentence boundary
  const sentenceStart = overlap.indexOf('. ');
  if (sentenceStart !== -1 && sentenceStart < overlapSize / 2) {
    return overlap.slice(sentenceStart + 2);
  }

  return overlap;
}

/**
 * Chunk a document with metadata
 */
export function chunkDocument(
  text: string,
  documentId: string,
  fileName: string,
  options: ChunkingOptions = {}
): DocumentChunk[] {
  const chunks = chunkText(text, options);
  
  // Add document metadata to each chunk
  return chunks.map(chunk => ({
    ...chunk,
    metadata: {
      ...chunk.metadata,
      source: fileName,
      documentId,
    },
  }));
}

/**
 * Get chunk statistics
 */
export function getChunkStatistics(chunks: DocumentChunk[]) {
  if (chunks.length === 0) {
    return {
      totalChunks: 0,
      totalCharacters: 0,
      totalWords: 0,
      avgChunkSize: 0,
      avgWordCount: 0,
      minChunkSize: 0,
      maxChunkSize: 0,
    };
  }

  const totalChars = chunks.reduce((sum, c) => sum + c.text.length, 0);
  const totalWords = chunks.reduce((sum, c) => sum + c.metadata.wordCount, 0);
  const chunkSizes = chunks.map(c => c.text.length);

  return {
    totalChunks: chunks.length,
    totalCharacters: totalChars,
    totalWords: totalWords,
    avgChunkSize: Math.round(totalChars / chunks.length),
    avgWordCount: Math.round(totalWords / chunks.length),
    minChunkSize: Math.min(...chunkSizes),
    maxChunkSize: Math.max(...chunkSizes),
  };
}

/**
 * Preview chunks (for debugging)
 */
export function previewChunks(chunks: DocumentChunk[], maxPreview: number = 100): void {
  console.log('📄 Chunk Preview:');
  console.log(getChunkStatistics(chunks));
  console.log('\nFirst 3 chunks:');
  
  chunks.slice(0, 3).forEach(chunk => {
    const preview = chunk.text.slice(0, maxPreview);
    console.log(`\n[Chunk ${chunk.index}] ${chunk.metadata.wordCount} words`);
    console.log(`${preview}${chunk.text.length > maxPreview ? '...' : ''}`);
  });
}
