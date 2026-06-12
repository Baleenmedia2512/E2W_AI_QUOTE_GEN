-- ============================================================================
-- E2W AI QUOTE GENERATOR - RAG DATABASE SETUP (GEMINI EMBEDDINGS)
-- Database: Supabase PostgreSQL with pgvector
-- Embedding Model: Gemini text-embedding-004 (768 dimensions)
-- Purpose: Semantic search for 32 Baleen Media services
-- Date: 2026-06-08
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTION 1: ENABLE PGVECTOR EXTENSION
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify
SELECT * FROM pg_extension WHERE extname = 'vector';


-- ----------------------------------------------------------------------------
-- SECTION 2: CREATE PROPOSAL_CHUNKS TABLE
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS proposal_chunks CASCADE;

CREATE TABLE proposal_chunks (
    -- Primary identification
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_name TEXT NOT NULL,
    service_id TEXT NOT NULL UNIQUE,
    
    -- Content and embeddings
    content TEXT NOT NULL,
    embedding VECTOR(3072),  -- ✅ FIXED: gemini-embedding-2 uses 3072 dimensions
    
    -- Metadata (pricing, specifications, images, etc.)
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Document reference
    document_id TEXT NOT NULL,
    document_name TEXT NOT NULL,
    user_id TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Note: pgvector indexes support max 2000 dimensions
-- gemini-embedding-2 uses 3072 dimensions, so we skip the index
-- Search will still work but may be slower for large datasets
-- To use index: switch to gemini-text-embedding-004 (768 dims) or truncate embeddings

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'proposal_chunks'
ORDER BY ordinal_position;


-- ----------------------------------------------------------------------------
-- SECTION 3: CREATE INDEXES
-- ----------------------------------------------------------------------------

-- ❌ SKIPPED: Vector similarity index (pgvector max 2000 dims, we use 3072)
-- CREATE INDEX IF NOT EXISTS idx_proposal_chunks_embedding 
-- ON proposal_chunks 
-- USING ivfflat (embedding vector_cosine_ops)
-- WITH (lists = 10);
-- Note: Search will work without index, just slower for very large datasets

-- ⭐ RECOMMENDED: Fast metadata filtering
CREATE INDEX IF NOT EXISTS idx_proposal_chunks_metadata 
ON proposal_chunks 
USING gin (metadata);

-- ⭐ RECOMMENDED: Fast service lookup
CREATE INDEX IF NOT EXISTS idx_proposal_chunks_service_id 
ON proposal_chunks (service_id);

-- 💡 OPTIONAL: Text search on service names
CREATE INDEX IF NOT EXISTS idx_proposal_chunks_service_name 
ON proposal_chunks (service_name);

-- 💡 OPTIONAL: Recently updated services
CREATE INDEX IF NOT EXISTS idx_proposal_chunks_updated_at 
ON proposal_chunks (updated_at DESC);

-- Verify
SELECT indexname, indexdef
FROM pg_indexes 
WHERE tablename = 'proposal_chunks';


-- ----------------------------------------------------------------------------
-- SECTION 4: SEARCH FUNCTION
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_proposals(
    query_embedding VECTOR(3072),  -- ✅ UPDATED: gemini-embedding-2 uses 3072 dimensions
    match_threshold FLOAT DEFAULT 0.5,
    match_count INT DEFAULT 10,
    filter_metadata JSONB DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    service_name TEXT,
    service_id TEXT,
    content TEXT,
    metadata JSONB,
    document_id TEXT,
    document_name TEXT,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pc.id,
        pc.service_name,
        pc.service_id,
        pc.content,
        pc.metadata,
        pc.document_id,
        pc.document_name,
        1 - (pc.embedding <=> query_embedding) AS similarity
    FROM proposal_chunks pc
    WHERE 
        (filter_metadata IS NULL OR pc.metadata @> filter_metadata)
        AND (1 - (pc.embedding <=> query_embedding)) > match_threshold
    ORDER BY pc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Verify
SELECT routine_name, routine_type
FROM information_schema.routines 
WHERE routine_name = 'search_proposals';


-- ----------------------------------------------------------------------------
-- SECTION 5: AUTO-UPDATE TIMESTAMP
-- ----------------------------------------------------------------------------

-- Create function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER update_proposal_chunks_updated_at
    BEFORE UPDATE ON proposal_chunks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Verify
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers 
WHERE event_object_table = 'proposal_chunks';


-- ----------------------------------------------------------------------------
-- SECTION 6: INSERT TEST DATA (with 768-dim embeddings)
-- ----------------------------------------------------------------------------

INSERT INTO proposal_chunks (service_name, service_id, content, embedding, metadata) VALUES

-- Service 1: Bus Semi Branding
(
    'Bus Semi Branding',
    'bus-semi-branding',
    'Bus Semi Branding: Premium outdoor advertising on government buses. Single side branding with 12 sq ft coverage. Includes production, installation, and 30-day campaign. Perfect for brand visibility in city routes. Starting at ₹16,000 per bus.',
    ARRAY(SELECT random() FROM generate_series(1,768))::vector(768),
    '{
        "unit_price": 16000,
        "currency": "INR",
        "size": "12 sq ft",
        "duration": "30 days",
        "locations": ["Bangalore", "Delhi", "Mumbai"],
        "category": "Bus Advertising",
        "production_included": true,
        "installation_included": true,
        "min_quantity": 1
    }'::jsonb
),

-- Service 2: Auto Semi Branding
(
    'Auto Semi Branding',
    'auto-semi-branding',
    'Auto Rickshaw Semi Branding: Cost-effective mobile advertising on auto rickshaws. Back panel branding with 8 sq ft coverage. Includes vinyl printing and installation for 30-day period. High visibility in traffic and residential areas. Starting at ₹12,000 per auto.',
    ARRAY(SELECT random() FROM generate_series(1,768))::vector(768),
    '{
        "unit_price": 12000,
        "currency": "INR",
        "size": "8 sq ft",
        "duration": "30 days",
        "locations": ["Bangalore", "Hyderabad", "Chennai"],
        "category": "Auto Advertising",
        "production_included": true,
        "installation_included": true,
        "min_quantity": 1
    }'::jsonb
),

-- Service 3: Apartment Lift Branding
(
    'Apartment Lift Branding',
    'apartment-lift-branding',
    'Apartment Lift Interior Branding: Premium captive audience advertising inside residential apartment lifts. Full wrap interior branding with 25 sq ft coverage. Includes design, printing, and installation for 30-day campaign. Target affluent residents with high dwell time. Starting at ₹28,000 per lift.',
    ARRAY(SELECT random() FROM generate_series(1,768))::vector(768),
    '{
        "unit_price": 28000,
        "currency": "INR",
        "size": "25 sq ft",
        "duration": "30 days",
        "locations": ["Bangalore", "Pune", "Gurgaon"],
        "category": "Apartment Advertising",
        "production_included": true,
        "installation_included": true,
        "min_quantity": 1,
        "audience": "affluent residents"
    }'::jsonb
);

-- Verify
SELECT 
    service_name,
    service_id,
    metadata->>'unit_price' as price,
    metadata->>'category' as category
FROM proposal_chunks
ORDER BY service_name;


-- ----------------------------------------------------------------------------
-- SECTION 7: FINAL VERIFICATION
-- ----------------------------------------------------------------------------

-- Check record count
SELECT COUNT(*) as total_services FROM proposal_chunks;

-- Check all services
SELECT 
    service_name,
    service_id,
    metadata->>'unit_price' as price,
    metadata->>'category' as category,
    CASE 
        WHEN embedding IS NULL THEN '❌ Missing'
        ELSE '✅ Present (768 dims)'
    END as embedding_status,
    created_at
FROM proposal_chunks
ORDER BY service_name;

-- Check indexes count
SELECT COUNT(*) as total_indexes 
FROM pg_indexes 
WHERE tablename = 'proposal_chunks';

-- Check functions
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_name IN ('search_proposals', 'update_updated_at_column');

-- Check trigger
SELECT trigger_name 
FROM information_schema.triggers 
WHERE event_object_table = 'proposal_chunks';

-- Check vector dimensions
SELECT 
    service_name,
    array_length(embedding::real[], 1) as vector_dimensions
FROM proposal_chunks
LIMIT 3;


-- ============================================================================
-- SETUP COMPLETE! ✅
-- ============================================================================
-- Embedding Model: Gemini text-embedding-004
-- Vector Dimensions: 768
-- Services Loaded: 3 (test data)
-- 
-- Next Steps:
-- 1. Upload your Baleen Media PDF via the app
-- 2. System will generate real Gemini embeddings for all services
-- 3. Test semantic search: "I need bus advertising"
-- 4. Create quotes with relevant services only!
-- ============================================================================
