/**
 * Supabase Vector Store Service
 * Manages document chunks and embeddings in PostgreSQL with pgvector
 */

import { supabase } from './supabaseClient';
import { DocumentChunk } from './chunkingService';

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

export interface SimilarChunk {
  id: string;
  proposal_id: string;
  chunk_text: string;
  chunk_metadata: Record<string, any>;
  similarity: number;
}

export interface ChunkWithEmbedding {
  chunk: DocumentChunk;
  embedding: number[];
}

/**
 * Store document chunks with embeddings in Supabase
 */
export async function storeDocumentChunks(
  proposalId: string,
  chunksWithEmbeddings: ChunkWithEmbedding[],
  options: {
    onProgress?: (current: number, total: number) => void;
  } = {}
): Promise<void> {
  const { onProgress } = options;

  if (chunksWithEmbeddings.length === 0) {
    console.warn('⚠️ No chunks to store');
    return;
  }

  try {
    console.log(`📝 Storing ${chunksWithEmbeddings.length} chunks for proposal ${proposalId}`);

    // Prepare data for insertion
    const records = chunksWithEmbeddings.map(({ chunk, embedding }) => ({
      proposal_id: proposalId,
      chunk_index: chunk.index,
      chunk_text: chunk.text,
      chunk_metadata: chunk.metadata,
      embedding: `[${embedding.join(',')}]`, // PostgreSQL vector format
    }));

    // Insert in batches to avoid payload size limits
    const BATCH_SIZE = 50;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, Math.min(i + BATCH_SIZE, records.length));

      const { error } = await supabase
        .from('document_chunks')
        .insert(batch);

      if (error) {
        console.error('❌ Error storing chunks:', error);
        throw new Error(`Failed to store chunks: ${error.message}`);
      }

      if (onProgress) {
        onProgress(Math.min(i + BATCH_SIZE, records.length), records.length);
      }
    }

    // Update proposal embedding status
    const { error: updateError } = await supabase
      .from('proposals')
      .update({ 
        embedding_status: 'completed',
        chunk_count: chunksWithEmbeddings.length 
      })
      .eq('id', proposalId);

    if (updateError) {
      console.warn('⚠️ Failed to update proposal status:', updateError);
    }

    console.log('✅ Chunks stored successfully');
  } catch (error) {
    console.error('❌ Error in storeDocumentChunks:', error);
    throw error;
  }
}

/**
 * Retrieve all chunks for a proposal
 */
export async function getProposalChunks(proposalId: string): Promise<StoredChunk[]> {
  try {
    const { data, error } = await supabase
      .from('document_chunks')
      .select('*')
      .eq('proposal_id', proposalId)
      .order('chunk_index', { ascending: true });

    if (error) {
      console.error('❌ Error fetching chunks:', error);
      throw new Error(`Failed to fetch chunks: ${error.message}`);
    }

    return data || [];
  } catch (error) {
    console.error('❌ Error in getProposalChunks:', error);
    throw error;
  }
}

/**
 * Search for similar chunks using pgvector
 */
export async function searchSimilarChunks(
  queryEmbedding: number[],
  options: {
    matchThreshold?: number;
    matchCount?: number;
    proposalId?: string;
  } = {}
): Promise<SimilarChunk[]> {
  const {
    matchThreshold = 0.7,
    matchCount = 5,
    proposalId = null,
  } = options;

  try {
    // Call the PostgreSQL function we created in the migration
    const { data, error } = await supabase.rpc('match_document_chunks', {
      query_embedding: `[${queryEmbedding.join(',')}]`,
      match_threshold: matchThreshold,
      match_count: matchCount,
      filter_proposal_id: proposalId,
    });

    if (error) {
      console.error('❌ Error searching similar chunks:', error);
      throw new Error(`Failed to search chunks: ${error.message}`);
    }

    console.log(`🔍 Found ${data?.length || 0} similar chunks`);
    return data || [];
  } catch (error) {
    console.error('❌ Error in searchSimilarChunks:', error);
    throw error;
  }
}

/**
 * Delete all chunks for a proposal
 */
export async function deleteProposalChunks(proposalId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('document_chunks')
      .delete()
      .eq('proposal_id', proposalId);

    if (error) {
      console.error('❌ Error deleting chunks:', error);
      throw new Error(`Failed to delete chunks: ${error.message}`);
    }

    console.log('✅ Chunks deleted successfully');
  } catch (error) {
    console.error('❌ Error in deleteProposalChunks:', error);
    throw error;
  }
}

/**
 * Get chunk count for a proposal
 */
export async function getProposalChunkCount(proposalId: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('document_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('proposal_id', proposalId);

    if (error) {
      console.error('❌ Error counting chunks:', error);
      return 0;
    }

    return count || 0;
  } catch (error) {
    console.error('❌ Error in getProposalChunkCount:', error);
    return 0;
  }
}

/**
 * Check if proposal has embeddings
 */
export async function hasProposalEmbeddings(proposalId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('proposals')
      .select('embedding_status, chunk_count')
      .eq('id', proposalId)
      .single();

    if (error) {
      console.error('❌ Error checking embeddings:', error);
      return false;
    }

    return data?.embedding_status === 'completed' && data?.chunk_count > 0;
  } catch (error) {
    console.error('❌ Error in hasProposalEmbeddings:', error);
    return false;
  }
}

/**
 * Get all proposals with embedding status
 */
export async function getProposalsWithEmbeddings(): Promise<Array<{
  id: string;
  file_name: string;
  chunk_count: number;
  embedding_status: string;
  uploaded_at: string;
}>> {
  try {
    const { data, error } = await supabase
      .from('proposals')
      .select('id, file_name, chunk_count, embedding_status, uploaded_at')
      .order('uploaded_at', { ascending: false });

    if (error) {
      console.error('❌ Error fetching proposals:', error);
      throw new Error(`Failed to fetch proposals: ${error.message}`);
    }

    return data || [];
  } catch (error) {
    console.error('❌ Error in getProposalsWithEmbeddings:', error);
    throw error;
  }
}

/**
 * Update chunk embedding (if regenerating)
 */
export async function updateChunkEmbedding(
  chunkId: string,
  embedding: number[]
): Promise<void> {
  try {
    const { error } = await supabase
      .from('document_chunks')
      .update({ 
        embedding: `[${embedding.join(',')}]`,
        updated_at: new Date().toISOString()
      })
      .eq('id', chunkId);

    if (error) {
      console.error('❌ Error updating chunk embedding:', error);
      throw new Error(`Failed to update embedding: ${error.message}`);
    }
  } catch (error) {
    console.error('❌ Error in updateChunkEmbedding:', error);
    throw error;
  }
}

/**
 * Get statistics about stored chunks
 */
export async function getVectorStoreStats(): Promise<{
  totalChunks: number;
  totalProposals: number;
  proposalsWithEmbeddings: number;
  averageChunksPerProposal: number;
}> {
  try {
    // Get total chunks
    const { count: totalChunks } = await supabase
      .from('document_chunks')
      .select('*', { count: 'exact', head: true });

    // Get proposals stats
    const { data: proposals } = await supabase
      .from('proposals')
      .select('id, chunk_count, embedding_status');

    const totalProposals = proposals?.length || 0;
    const proposalsWithEmbeddings = proposals?.filter(
      p => p.embedding_status === 'completed'
    ).length || 0;
    
    const avgChunks = totalProposals > 0 
      ? (totalChunks || 0) / totalProposals 
      : 0;

    return {
      totalChunks: totalChunks || 0,
      totalProposals,
      proposalsWithEmbeddings,
      averageChunksPerProposal: Math.round(avgChunks),
    };
  } catch (error) {
    console.error('❌ Error getting vector store stats:', error);
    return {
      totalChunks: 0,
      totalProposals: 0,
      proposalsWithEmbeddings: 0,
      averageChunksPerProposal: 0,
    };
  }
}
