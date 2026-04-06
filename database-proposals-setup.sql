-- ============================================
-- Global Proposals Storage Setup
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Create proposals table for metadata
CREATE TABLE IF NOT EXISTS proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(100) NOT NULL,
  file_size INTEGER NOT NULL,
  file_url TEXT NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  text_content TEXT,
  page_count INTEGER DEFAULT 1,
  uploaded_by_user_id TEXT,  -- Changed from UUID to TEXT for custom auth system
  uploaded_by_name VARCHAR(255),
  uploaded_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_proposals_uploaded_at ON proposals(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_proposals_file_name ON proposals(file_name);
CREATE INDEX IF NOT EXISTS idx_proposals_uploaded_by ON proposals(uploaded_by_user_id);

-- 3. Enable Row Level Security
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS policies

-- Policy: All authenticated users can view all proposals
CREATE POLICY "Allow authenticated users to view all proposals"
ON proposals
FOR SELECT
TO authenticated
USING (true);

-- Policy: All authenticated users can upload proposals
CREATE POLICY "Allow authenticated users to upload proposals"
ON proposals
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = uploaded_by_user_id);

-- Policy: Users can update their own proposals
CREATE POLICY "Allow users to update their own proposals"
ON proposals
FOR UPDATE
TO authenticated
USING (auth.uid() = uploaded_by_user_id)
WITH CHECK (auth.uid() = uploaded_by_user_id);

-- Policy: Users can delete their own proposals (or admins can delete any)
CREATE POLICY "Allow users to delete their own proposals"
ON proposals
FOR DELETE
TO authenticated
USING (auth.uid() = uploaded_by_user_id);

-- 5. Create updated_at trigger
CREATE OR REPLACE FUNCTION update_proposals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_proposals_updated_at ON proposals;
CREATE TRIGGER update_proposals_updated_at
  BEFORE UPDATE ON proposals
  FOR EACH ROW
  EXECUTE FUNCTION update_proposals_updated_at();

-- 6. Create Supabase Storage Bucket (Run this in Supabase Dashboard > Storage)
-- Bucket name: "proposals"
-- Public: false (authenticated access only)
-- File size limit: 10MB
-- Allowed MIME types: application/pdf, image/jpeg, image/jpg, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet

-- 7. Storage policies (Run in SQL after creating bucket)
-- Note: These run automatically when you create bucket with proper settings in Supabase Dashboard

-- Policy: Authenticated users can upload
CREATE POLICY "Authenticated users can upload proposals"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'proposals');

-- Policy: Authenticated users can view all proposals
CREATE POLICY "Authenticated users can view proposals"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'proposals');

-- Policy: Users can delete their own uploads (path starts with their user ID)
CREATE POLICY "Users can delete their own proposals"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'proposals' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 8. Verification queries
SELECT 'Proposals table created' AS status, COUNT(*) AS proposal_count FROM proposals;
SELECT tablename, policyname FROM pg_policies WHERE tablename = 'proposals';

-- ============================================
-- MANUAL STEPS (Supabase Dashboard):
-- ============================================
-- 1. Go to Storage > Create new bucket
-- 2. Bucket name: "proposals"
-- 3. Public: OFF (keep private)
-- 4. File size limit: 10485760 (10MB)
-- 5. Allowed MIME types:
--    - application/pdf
--    - image/jpeg
--    - image/jpg
--    - application/vnd.ms-excel
--    - application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
-- ============================================
