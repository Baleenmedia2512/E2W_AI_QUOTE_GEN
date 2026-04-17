-- ============================================
-- RAG System Setup - Document Chunks + Vector Storage
-- Run this in Supabase SQL Editor AFTER database-proposals-setup.sql
-- ============================================

-- 1. Enable pgvector extension (requires superuser, run in Supabase Dashboard)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Create document_chunks table for RAG
CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  chunk_metadata JSONB DEFAULT '{}'::jsonb,
  embedding vector(384), -- 384 dimensions for all-MiniLM-L6-v2 model
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Ensure unique chunks per proposal
  UNIQUE(proposal_id, chunk_index)
);

-- 3. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_chunks_proposal_id ON document_chunks(proposal_id);
CREATE INDEX IF NOT EXISTS idx_chunks_created_at ON document_chunks(created_at DESC);

-- 4. Create vector similarity index (HNSW for fast approximate search)
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw 
ON document_chunks 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Alternative: IVFFlat index (use if HNSW not available)
-- CREATE INDEX IF NOT EXISTS idx_chunks_embedding_ivfflat 
-- ON document_chunks 
-- USING ivfflat (embedding vector_cosine_ops)
-- WITH (lists = 100);

-- 5. Enable Row Level Security
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

-- 6. Create RLS policies (allow both authenticated and anonymous users)

-- Policy: Authenticated users can view all chunks
CREATE POLICY "Allow authenticated users to view all chunks"
ON document_chunks
FOR SELECT
TO authenticated
USING (true);

-- Policy: Anonymous users can view all chunks
CREATE POLICY "Allow anonymous users to view all chunks"
ON document_chunks
FOR SELECT
TO anon
USING (true);

-- Policy: Authenticated users can insert chunks
CREATE POLICY "Allow authenticated users to insert chunks"
ON document_chunks
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Policy: Anonymous users can insert chunks
CREATE POLICY "Allow anonymous users to insert chunks"
ON document_chunks
FOR INSERT
TO anon
WITH CHECK (true);

-- Policy: Authenticated users can update chunks
CREATE POLICY "Allow authenticated users to update chunks"
ON document_chunks
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Policy: Anonymous users can update chunks
CREATE POLICY "Allow anonymous users to update chunks"
ON document_chunks
FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);

-- Policy: Authenticated users can delete chunks
CREATE POLICY "Allow authenticated users to delete chunks"
ON document_chunks
FOR DELETE
TO authenticated
USING (true);

-- Policy: Anonymous users can delete chunks
CREATE POLICY "Allow anonymous users to delete chunks"
ON document_chunks
FOR DELETE
TO anon
USING (true);

-- 7. Create updated_at trigger
CREATE OR REPLACE FUNCTION update_document_chunks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_document_chunks_updated_at ON document_chunks;
CREATE TRIGGER update_document_chunks_updated_at
  BEFORE UPDATE ON document_chunks
  FOR EACH ROW
  EXECUTE FUNCTION update_document_chunks_updated_at();

-- 8. Create similarity search function
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding vector(384),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5,
  filter_proposal_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  proposal_id uuid,
  chunk_text text,
  chunk_metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    document_chunks.id,
    document_chunks.proposal_id,
    document_chunks.chunk_text,
    document_chunks.chunk_metadata,
    1 - (document_chunks.embedding <=> query_embedding) AS similarity
  FROM document_chunks
  WHERE 
    (filter_proposal_id IS NULL OR document_chunks.proposal_id = filter_proposal_id)
    AND (1 - (document_chunks.embedding <=> query_embedding)) > match_threshold
  ORDER BY document_chunks.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 9. Create function to get chunks by proposal
CREATE OR REPLACE FUNCTION get_proposal_chunks(p_proposal_id uuid)
RETURNS TABLE (
  id uuid,
  chunk_index integer,
  chunk_text text,
  chunk_metadata jsonb
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    document_chunks.id,
    document_chunks.chunk_index,
    document_chunks.chunk_text,
    document_chunks.chunk_metadata
  FROM document_chunks
  WHERE document_chunks.proposal_id = p_proposal_id
  ORDER BY document_chunks.chunk_index;
END;
$$;

-- 10. Add chunk statistics to proposals table
ALTER TABLE proposals 
ADD COLUMN IF NOT EXISTS chunk_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS embedding_status VARCHAR(50) DEFAULT 'pending';

-- 11. Create function to update proposal chunk count
CREATE OR REPLACE FUNCTION update_proposal_chunk_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE proposals
  SET 
    chunk_count = (
      SELECT COUNT(*) 
      FROM document_chunks 
      WHERE proposal_id = COALESCE(NEW.proposal_id, OLD.proposal_id)
    ),
    embedding_status = CASE 
      WHEN (SELECT COUNT(*) FROM document_chunks WHERE proposal_id = COALESCE(NEW.proposal_id, OLD.proposal_id) AND embedding IS NOT NULL) > 0 
      THEN 'completed'
      ELSE 'pending'
    END
  WHERE id = COALESCE(NEW.proposal_id, OLD.proposal_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 12. Create trigger to auto-update chunk counts
DROP TRIGGER IF EXISTS update_proposal_chunk_count_trigger ON document_chunks;
CREATE TRIGGER update_proposal_chunk_count_trigger
  AFTER INSERT OR UPDATE OR DELETE ON document_chunks
  FOR EACH ROW
  EXECUTE FUNCTION update_proposal_chunk_count();

-- ============================================
-- Verification Queries
-- ============================================

-- Check if pgvector is installed
SELECT * FROM pg_extension WHERE extname = 'vector';

-- Check tables
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('proposals', 'document_chunks');

-- Check indexes
SELECT indexname, tablename FROM pg_indexes 
WHERE tablename IN ('proposals', 'document_chunks');

-- Test vector operations (should return TRUE)
SELECT '[1,2,3]'::vector(3) <=> '[1,2,3]'::vector(3) = 0 AS vector_test;

-- ============================================
-- Usage Examples
-- ============================================

/*

-- 1. Query similar chunks
SELECT * FROM match_document_chunks(
  query_embedding := '[0.1, 0.2, ...]'::vector(384),
  match_threshold := 0.7,
  match_count := 5
);

-- 2. Get all chunks for a proposal
SELECT * FROM get_proposal_chunks('proposal-uuid-here');

-- 3. Check proposal embedding status
SELECT id, file_name, chunk_count, embedding_status 
FROM proposals 
WHERE embedding_status = 'completed';

-- 4. Delete all chunks for a proposal (cascades automatically)
DELETE FROM proposals WHERE id = 'proposal-uuid-here';

*/
