# 🧪 RAG Testing Guide - Step by Step

## ✅ Pre-Flight Checks

### 1. Verify Database Setup (2 minutes)

Open Supabase Dashboard → SQL Editor and run:

```sql
-- Check if pgvector extension is installed
SELECT * FROM pg_extension WHERE extname = 'vector';
-- Should return 1 row

-- Check if document_chunks table exists
SELECT COUNT(*) FROM document_chunks;
-- Should return 0 (empty) or number of existing chunks

-- Check proposals table has RAG columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'proposals' 
AND column_name IN ('chunk_count', 'embedding_status');
-- Should return 2 rows
```

**Expected Results:**
- ✅ pgvector extension exists
- ✅ document_chunks table exists (count = 0 is OK)
- ✅ proposals table has `chunk_count` and `embedding_status` columns

---

## 🧪 Testing the Upload Flow

### Step 1: Start the App with Console Open

```bash
npm run dev
```

**IMPORTANT:** Open browser DevTools (F12) and go to Console tab BEFORE uploading

### Step 2: Upload a PDF Document

1. Go to Documents page
2. Click "Upload Document" or drag & drop a PDF
3. **Watch the console** - you should see these messages:

```
📤 Uploading file to Supabase Storage: {path}
💾 Saving proposal metadata to database, user_id: {id}
✅ Proposal uploaded to cloud successfully
🤖 Starting background RAG processing for: {filename}
```

**If you DON'T see "🤖 Starting background RAG processing":**
- ❌ The RAG process was not triggered
- Check if there's an error in console
- See "Troubleshooting" section below

### Step 3: Wait for RAG Processing (10-30 seconds)

After upload, watch for these console messages:

```
🚀 Processing document for RAG: {filename}
📄 Created 47 chunks
📊 Chunk stats: {...}
✅ RAG processing complete in 4.23s
```

**If you see errors:**
- Note the exact error message
- See "Common Errors" section below

### Step 4: Verify Chunks in Database

Go to Supabase Dashboard → SQL Editor:

```sql
-- Check if chunks were created
SELECT COUNT(*) as total_chunks FROM document_chunks;

-- See chunk details
SELECT 
  p.file_name,
  p.chunk_count,
  p.embedding_status,
  COUNT(dc.id) as actual_chunks
FROM proposals p
LEFT JOIN document_chunks dc ON dc.proposal_id = p.id
GROUP BY p.id, p.file_name, p.chunk_count, p.embedding_status
ORDER BY p.uploaded_at DESC
LIMIT 5;
```

**Expected Results:**
- ✅ `total_chunks` > 0
- ✅ `chunk_count` matches `actual_chunks`
- ✅ `embedding_status` = 'completed'

---

## 🔍 Testing RAG Queries

### Step 1: Go to Chat/Quote Page

Open the chat interface where you normally interact with Gemini.

### Step 2: Ask a Question About Your Document

Example questions:
```
"What services are mentioned in the proposal?"
"What is the pricing for bus branding?"
"Summarize the document"
```

### Step 3: Watch Console During Query

You should see:

```
🔍 Querying RAG system: "What services..."
✅ RAG found 5 relevant chunks (relevance: 87%)
```

**If you DON'T see "🔍 Querying RAG system":**
- RAG query is not being called
- Check geminiService.ts integration
- See troubleshooting below

---

## 🐛 Troubleshooting

### Problem: "document_chunks still empty"

**Possible causes and solutions:**

#### 1. RAG Processing Not Starting

**Symptom:** No "🤖 Starting background RAG processing" in console

**Solution:** Check if `processDocumentForRAGBackground` is being called.

Add temporary debug logging:

```javascript
// In supabaseProposalService.ts, line ~110
console.log('✅ Proposal uploaded to cloud successfully');

// ADD THIS LINE:
console.log('🔍 DEBUG: About to call processDocumentForRAGBackground');

processDocumentForRAGBackground(proposalData.id, file.name, textContent);
```

#### 2. Embedding Model Not Loading

**Symptom:** Console shows "❌ Error: Embedding model not initialized"

**Solution:** 

Check browser console for model loading errors:
- Open DevTools → Console
- Look for errors related to "transformers.js"
- Clear browser cache (Ctrl+Shift+Delete)
- Reload page

Test model manually in console:

```javascript
// In browser console:
import { initializeEmbeddingModel } from './src/services/embeddingService';
await initializeEmbeddingModel();
```

#### 3. Supabase RLS Blocking Inserts

**Symptom:** Error: "new row violates row-level security policy"

**Solution:** Check RLS policies in Supabase:

```sql
-- Check if user is authenticated
SELECT auth.uid();
-- Should return a UUID

-- Check RLS policies
SELECT * FROM pg_policies WHERE tablename = 'document_chunks';
-- Should show INSERT policy for authenticated users

-- Test direct insert (as authenticated user)
INSERT INTO document_chunks (proposal_id, chunk_index, chunk_text, embedding)
VALUES (
  (SELECT id FROM proposals LIMIT 1),
  0,
  'Test chunk',
  array_fill(0, ARRAY[384])::vector
);
```

#### 4. Text Content Empty

**Symptom:** Error: "No chunks created from document"

**Solution:** Check if PDF text extraction worked:

```sql
-- Check if text_content was saved
SELECT 
  file_name, 
  LENGTH(text_content) as text_length,
  LEFT(text_content, 100) as text_preview
FROM proposals
ORDER BY uploaded_at DESC
LIMIT 5;
```

If `text_length` = 0:
- PDF might be image-based (scanned)
- PDF might be encrypted/protected
- Try a different PDF file

---

## 🔧 Manual Testing Commands

### Test in Browser Console

```javascript
// 1. Test embedding model
import { initializeEmbeddingModel, generateEmbedding } from './src/services/embeddingService';
await initializeEmbeddingModel();
const result = await generateEmbedding("test query");
console.log("Embedding dimension:", result.embedding.length); // Should be 384

// 2. Test document processing
import { processDocumentForRAG } from './src/services/ragService';
const result = await processDocumentForRAG(
  'test-proposal-id',
  'test.pdf',
  'This is a test document with some sample text. It should be chunked and embedded.',
  { replaceExisting: true }
);
console.log("Result:", result);

// 3. Test RAG query
import { queryRAG } from './src/services/ragService';
const queryResult = await queryRAG("test query");
console.log("Query result:", queryResult);
```

### Test via SQL

```sql
-- 1. Check if chunks exist
SELECT 
  p.file_name,
  COUNT(dc.id) as chunks,
  AVG(LENGTH(dc.chunk_text)) as avg_chunk_size
FROM proposals p
LEFT JOIN document_chunks dc ON dc.proposal_id = p.id
GROUP BY p.id, p.file_name;

-- 2. View sample chunks
SELECT 
  chunk_index,
  LEFT(chunk_text, 100) as preview,
  LENGTH(chunk_text) as size,
  array_length(embedding, 1) as embedding_dim
FROM document_chunks
WHERE proposal_id = (SELECT id FROM proposals ORDER BY uploaded_at DESC LIMIT 1)
ORDER BY chunk_index
LIMIT 5;

-- 3. Test similarity search (requires a real embedding)
-- First, get an embedding from the console, then:
SELECT * FROM match_document_chunks(
  array_fill(0.1, ARRAY[384])::vector,  -- Replace with real embedding
  0.7,  -- threshold
  5     -- limit
);
```

---

## 📊 Expected Console Output (Full Flow)

When everything works correctly, you should see:

```
1. UPLOAD:
📤 Uploading file to Supabase Storage: user123/1234567890_proposal.pdf
💾 Saving proposal metadata to database, user_id: user123
✅ Proposal uploaded to cloud successfully

2. RAG PROCESSING:
🤖 Starting background RAG processing for: proposal.pdf
🚀 Processing document for RAG: proposal.pdf
📄 Created 47 chunks
📊 Chunk stats: {
  totalChunks: 47,
  avgChunkSize: 856,
  minChunkSize: 234,
  maxChunkSize: 1200,
  totalWords: 9876
}
📊 RAG Generating embeddings: 10/47
📊 RAG Generating embeddings: 20/47
📊 RAG Generating embeddings: 30/47
📊 RAG Generating embeddings: 40/47
📊 RAG Generating embeddings: 47/47
📊 RAG Storing in database: 47/47
✅ RAG processing complete in 4.23s
✅ RAG processing complete for: proposal.pdf

3. QUERY:
🔍 Querying RAG system: "What services are available?"
✅ RAG found 5 relevant chunks (relevance: 87%)
```

---

## 🚀 Quick Test Checklist

Use this to quickly verify everything is working:

- [ ] Database tables exist (pgvector, document_chunks, proposals columns)
- [ ] App starts without errors
- [ ] Console shows embedding model loading on startup
- [ ] Upload triggers "🤖 Starting background RAG processing"
- [ ] Processing completes with "✅ RAG processing complete"
- [ ] Database shows chunks: `SELECT COUNT(*) FROM document_chunks;` > 0
- [ ] Chat queries trigger "🔍 Querying RAG system"
- [ ] Query finds relevant chunks

---

## 📧 Reporting Issues

If still not working, provide:

1. **Console output** (copy full log from upload to completion)
2. **Database queries:**
   ```sql
   SELECT COUNT(*) FROM document_chunks;
   SELECT * FROM proposals ORDER BY uploaded_at DESC LIMIT 1;
   ```
3. **Error messages** (if any)
4. **Browser and version** (Chrome, Firefox, etc.)
5. **File being tested** (size, type, is it text-based?)
