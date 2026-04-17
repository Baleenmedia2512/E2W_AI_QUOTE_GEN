# 🔧 Quick Fix: document_chunks Still Empty

## The Problem
You uploaded a document but `document_chunks` table is still empty.

## Step-by-Step Debugging

### 1️⃣ Open Browser Console (MOST IMPORTANT!)

Press **F12** to open DevTools, then click **Console** tab.

**Keep this open while uploading!**

---

### 2️⃣ Upload a Document and Watch Console

You should see these messages IN THIS ORDER:

```
✅ Proposal uploaded to cloud successfully
🤖 Starting background RAG processing for: your-file.pdf
📊 RAG Debug - Proposal ID: abc-123-def
📊 RAG Debug - Text Length: 12345
🚀 Processing document for RAG: your-file.pdf
📄 Created 47 chunks
✅ RAG processing complete for: your-file.pdf
```

**If you DON'T see "🤖 Starting background RAG processing":**
- Something is wrong BEFORE RAG starts
- Jump to **Problem A** below

**If you see "🤖 Starting..." but then "❌❌❌ RAG PROCESSING FAILED":**
- RAG started but crashed
- Jump to **Problem B** below

**If you see nothing after "✅ Proposal uploaded":**
- Processing might be happening silently
- Jump to **Problem C** below

---

## Problem A: RAG Not Starting

**Symptoms:**
- No "🤖 Starting background RAG processing" message
- Console stops after "✅ Proposal uploaded"

**Causes & Solutions:**

### Check 1: Text Content Empty
```javascript
// In console, run:
const { supabase } = await import('./src/services/supabaseClient.js');
const { data } = await supabase
  .from('proposals')
  .select('file_name, text_content')
  .order('uploaded_at', { ascending: false })
  .limit(1)
  .single();

console.log('File:', data.file_name);
console.log('Text Length:', data.text_content?.length || 0);
console.log('Preview:', data.text_content?.substring(0, 200));
```

**If text_content length is 0 or null:**
- PDF is image-based (scanned) - OCR needed
- PDF is encrypted/protected
- PDF extraction failed

**Solution:** Try a different PDF that has actual text (not scanned images)

### Check 2: Function Not Called
Look at the code around line 110 in `supabaseProposalService.ts`:

```typescript
console.log('✅ Proposal uploaded to cloud successfully');

// THIS LINE SHOULD BE HERE:
processDocumentForRAGBackground(proposalData.id, file.name, textContent);
```

If this line is missing or commented out, the function never runs.

---

## Problem B: RAG Processing Failed

**Symptoms:**
- You see "🤖 Starting background RAG processing"
- Then "❌❌❌ RAG PROCESSING FAILED"
- Error details in console

**Check the Error Message:**

### Error: "Embedding model not initialized"

**Solution:**
```javascript
// In console, manually initialize:
const { initializeEmbeddingModel } = await import('./src/services/embeddingService.js');
await initializeEmbeddingModel();
```

Wait 5-10 seconds. Should see: "✅ Embedding model ready"

If it fails:
- Clear browser cache (Ctrl+Shift+Delete)
- Check network connection (model downloads from CDN)
- Check console for 403/404 errors

### Error: "No chunks created from document"

**Text too short.**

Check text length:
```javascript
const { data } = await import('./src/services/supabaseClient.js').then(m => 
  m.supabase.from('proposals').select('text_content').order('uploaded_at', { ascending: false }).limit(1).single()
);
console.log('Length:', data.text_content?.length);
```

Must be at least 100 characters.

### Error: "new row violates row-level security policy"

**RLS blocking inserts.**

Fix in Supabase SQL Editor:

```sql
-- Check if you're authenticated
SELECT auth.uid();

-- If returns NULL, you're not authenticated
-- Solution: Login to the app first

-- OR temporarily disable RLS (for testing only!)
ALTER TABLE document_chunks DISABLE ROW LEVEL SECURITY;
-- Re-enable after testing:
-- ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
```

### Error: "relation 'document_chunks' does not exist"

**Table not created.**

Run the database setup SQL again:
- Open `database-rag-setup.sql`
- Copy entire contents
- Paste in Supabase SQL Editor
- Run

---

## Problem C: Silent Processing

**Symptoms:**
- Upload completes
- No error messages
- No success messages either
- Chunks still empty after 1 minute

**This is weird. Let's investigate:**

### Step 1: Check if Function Exists
```javascript
const { processDocumentForRAG } = await import('./src/services/ragService.js');
console.log('Function exists:', typeof processDocumentForRAG);
```

Should show: `Function exists: function`

### Step 2: Manually Process Latest Upload
```javascript
const { supabase } = await import('./src/services/supabaseClient.js');
const { processDocumentForRAG } = await import('./src/services/ragService.js');

// Get latest proposal
const { data: proposal } = await supabase
  .from('proposals')
  .select('*')
  .order('uploaded_at', { ascending: false })
  .limit(1)
  .single();

console.log('Processing:', proposal.file_name);

// Manually trigger RAG
const result = await processDocumentForRAG(
  proposal.id,
  proposal.file_name,
  proposal.text_content,
  { replaceExisting: true }
);

console.log('Result:', result);
```

This will process it manually and show exactly where it fails.

---

## Problem D: Everything Looks Right But Still Empty

**Nuclear option - Manual verification:**

### 1. Check Supabase is Connected
```javascript
const { supabase } = await import('./src/services/supabaseClient.js');
const { data, error } = await supabase.from('proposals').select('count');
console.log('Connected:', !error);
```

### 2. Check pgvector Extension
In Supabase SQL Editor:
```sql
SELECT * FROM pg_extension WHERE extname = 'vector';
```

Should return 1 row. If empty:
```sql
CREATE EXTENSION vector;
```

### 3. Test Direct Insert
```sql
-- Get a proposal ID
SELECT id FROM proposals LIMIT 1;

-- Try manual insert (replace with actual proposal ID)
INSERT INTO document_chunks (
  proposal_id,
  chunk_index,
  chunk_text,
  embedding
) VALUES (
  'your-proposal-id-here',
  0,
  'Test chunk',
  array_fill(0, ARRAY[384])::vector
);

-- Check if it worked
SELECT COUNT(*) FROM document_chunks;
```

If this fails, the problem is database-level (RLS, permissions, etc.)

---

## Quick Checklist

Work through this in order:

1. [ ] Console is open (F12 → Console tab)
2. [ ] Upload document
3. [ ] See "🤖 Starting background RAG processing"?
   - **NO** → Problem A (RAG not starting)
   - **YES** → Continue
4. [ ] See "❌❌❌ RAG PROCESSING FAILED"?
   - **YES** → Problem B (Check error message)
   - **NO** → Continue
5. [ ] See "✅ RAG processing complete"?
   - **NO** → Problem C (Silent processing)
   - **YES** → Continue
6. [ ] Run SQL: `SELECT COUNT(*) FROM document_chunks;`
   - **0** → Problem D (Everything looks right but empty)
   - **> 0** → SUCCESS! It's working!

---

## Still Stuck?

Run the debug script:

```javascript
// Copy contents of rag-debug-test.js into console
// Then run:
await testRAGSystem()
```

This will test every component and tell you exactly what's broken.

Post the output if you need help.
