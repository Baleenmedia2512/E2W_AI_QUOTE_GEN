-- ============================================
-- FIX: Add Anonymous User Policies for document_chunks
-- Run this in Supabase SQL Editor to fix RLS error
-- ============================================

-- This fixes the error:
-- "new row violates row-level security policy for table 'document_chunks'"

-- Add policies for anonymous (anon) users to match authenticated users

-- Policy: Anonymous users can view all chunks
CREATE POLICY IF NOT EXISTS "Allow anonymous users to view all chunks"
ON document_chunks
FOR SELECT
TO anon
USING (true);

-- Policy: Anonymous users can insert chunks
CREATE POLICY IF NOT EXISTS "Allow anonymous users to insert chunks"
ON document_chunks
FOR INSERT
TO anon
WITH CHECK (true);

-- Policy: Anonymous users can update chunks
CREATE POLICY IF NOT EXISTS "Allow anonymous users to update chunks"
ON document_chunks
FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);

-- Policy: Anonymous users can delete chunks
CREATE POLICY IF NOT EXISTS "Allow anonymous users to delete chunks"
ON document_chunks
FOR DELETE
TO anon
USING (true);

-- Verify policies were created
SELECT 
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
FROM pg_policies 
WHERE tablename = 'document_chunks'
ORDER BY policyname;

-- You should see policies for both 'authenticated' and 'anon' roles
