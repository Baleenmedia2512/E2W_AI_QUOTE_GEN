# 🚀 Quick Start: RAG System Setup

## ⏱️ 5-Minute Setup Guide

### Step 1: Run Database Migration (2 minutes)

1. **Open Supabase Dashboard**
   - Go to: https://supabase.com/dashboard
   - Select your project

2. **Open SQL Editor**
   - Click "SQL Editor" in left sidebar

3. **Run Migration**
   - Open file: `database-rag-setup.sql`
   - Copy entire contents
   - Paste into SQL Editor
   - Click **"Run"**

4. **Verify Success**
   - You should see: "Success. No rows returned"
   - Check that these tables exist:
     - ✅ `document_chunks`
     - ✅ `proposals` (with new columns: `chunk_count`, `embedding_status`)

### Step 2: Start the App (1 minute)

```bash
# Dependencies already installed
npm run dev
```

**What happens on startup:**
- ✅ RAG model preloads in background (~5-10 seconds first time)
- ✅ Model cached in browser for instant future loads
- ✅ Console shows: "✅ Embedding model ready for use"

### Step 3: Upload a Test Document (1 minute)

1. Open the app (usually http://localhost:5173)
2. Upload any PDF proposal
3. Watch the console:
   ```
   📤 Uploading file to Supabase Storage
   ✅ Proposal uploaded to cloud successfully
   🤖 Starting background RAG processing
   📄 Created 47 chunks
   ✅ Generated 47 embeddings in 4.23s
   ✅ Chunks stored successfully
   ✅ RAG processing complete
   ```

### Step 4: Test RAG in Chat (1 minute)

1. Go to Chat/Quote page
2. Ask a question about your uploaded proposal:
   ```
   "What services are available for bus branding?"
   ```
3. Watch the console:
   ```
   🔍 Querying RAG system...
   ✅ RAG found 5 relevant chunks (relevance: 87%)
   ```
4. Gemini response now includes relevant context!

---

## ✅ Verification

### Check RAG Status in Console

```javascript
// Open browser console and run:
import { getRAGStatus } from './src/services/ragService.ts';
const status = await getRAGStatus();
console.log(status);

// Should show:
// {
//   modelInfo: { isLoaded: true, name: "Xenova/all-MiniLM-L6-v2" },
//   storeStats: { totalChunks: 47, proposalsWithEmbeddings: 1 },
//   isReady: true
// }
```

### Check Database

```sql
-- In Supabase SQL Editor:

-- 1. Check if pgvector is installed
SELECT * FROM pg_extension WHERE extname = 'vector';

-- 2. Check chunks were created
SELECT COUNT(*) as total_chunks FROM document_chunks;

-- 3. Check proposals with embeddings
SELECT id, file_name, chunk_count, embedding_status 
FROM proposals 
WHERE embedding_status = 'completed';
```

---

## 🎯 What's Working Now

### ✅ Automatic Processing
- Every uploaded proposal is automatically processed for RAG
- Happens in background (doesn't block UI)
- Progress logged to console

### ✅ Smart Search
- User questions trigger semantic search
- Top 5 most relevant chunks retrieved
- Context injected into Gemini

### ✅ Enhanced Responses
- Gemini sees relevant proposal sections
- More accurate quote generation
- Better service recommendations

---

## 🐛 Common Issues

### Issue: Model Not Loading

**Symptom:** Console shows "Failed to initialize embedding model"

**Fix:**
1. Check internet connection (first download only)
2. Wait 10-15 seconds for download
3. Refresh page if needed

### Issue: No Chunks Created

**Symptom:** `chunk_count = 0` in database

**Fix:**
1. Check if proposal has text content
2. Look for errors in console
3. Try reuploading the document

### Issue: RAG Not Finding Results

**Symptom:** "No relevant chunks found"

**Fix:**
1. Lower threshold: `matchThreshold: 0.5` (in geminiService.ts)
2. Check if chunks exist: `SELECT COUNT(*) FROM document_chunks;`
3. Try more specific questions

---

## 🎨 Customization

### Adjust Chunk Size

Edit `src/services/ragService.ts`:

```typescript
const chunkingOptions = {
  chunkSize: 800,  // Smaller chunks = more precise
  // or
  chunkSize: 1500, // Larger chunks = more context
};
```

### Change Number of Results

Edit `src/services/geminiService.ts`:

```typescript
const ragResult = await queryRAG(userMessage, {
  matchCount: 3,  // Fewer = faster, more focused
  // or
  matchCount: 10, // More = comprehensive
});
```

### Disable RAG Temporarily

```typescript
await sendMessageToGemini({
  userMessage: 'your question',
  useRAG: false,  // Use full documents instead
});
```

---

## 📊 Performance Tips

### First Load (One-Time)
- Model download: ~10 seconds
- Size: ~22MB
- **After:** Instant (cached)

### Processing Speed
- Small doc (10 pages): ~2-3 seconds
- Medium doc (50 pages): ~10-15 seconds
- Large doc (200 pages): ~30-45 seconds

### Memory Usage
- Model: ~50MB RAM
- Per document: ~150KB storage
- Browser cache: ~30MB

---

## 🎉 Success Indicators

Look for these in console:

```
✅ Supabase connection successful
✅ Embedding model ready for use
📤 Uploading file to Supabase Storage
🤖 Starting background RAG processing
📄 Created X chunks
✅ Generated X embeddings
✅ Chunks stored successfully
🔍 Querying RAG system...
✅ RAG found X relevant chunks
```

---

## 📚 Next Steps

1. **Upload Multiple Documents**
   - RAG searches across all documents
   - More documents = better context

2. **Test Different Queries**
   - Specific: "bus branding full wrap price"
   - General: "available services"
   - Comparison: "difference between lit and non-lit"

3. **Monitor Performance**
   - Check chunk counts: `SELECT * FROM proposals;`
   - View stats: `getRAGStatus()`
   - Optimize if needed

---

## 💡 Pro Tips

1. **Preload Model:** App preloads on startup (no action needed)
2. **Background Processing:** Upload continues while RAG processes
3. **Fallback:** If RAG fails, system uses full documents
4. **Offline:** Model works offline after first download
5. **Cost:** $0 for embeddings (runs locally!)

---

## 🆘 Need Help?

1. **Check Console:** Most issues show detailed errors
2. **Verify Database:** Run SQL verification queries
3. **Test Components:**
   - Embedding: `generateEmbedding('test')`
   - Storage: `SELECT COUNT(*) FROM document_chunks;`
   - RAG: `queryRAG('test query')`
4. **Read Full Guide:** See `RAG_SETUP.md` for details

---

**That's it! Your RAG system is ready. 🚀**

Upload documents → Ask questions → Get enhanced responses! ✨
