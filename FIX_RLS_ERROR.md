# ✅ FIXED: Row Level Security Error

## The Problem
```
Error: new row violates row-level security policy for table "document_chunks"
```

Your chunks were created successfully (55 chunks!), but Supabase RLS blocked the insert because you're uploading anonymously.

---

## 🚀 Quick Fix (2 minutes)

### Step 1: Open Supabase SQL Editor
1. Go to https://supabase.com/dashboard
2. Select your project
3. Click **SQL Editor** in left sidebar

### Step 2: Run the Fix
1. Open file: `database-rag-fix-rls.sql`
2. Copy entire contents
3. Paste into SQL Editor
4. Click **Run**

### Step 3: Test Again
1. Go back to your app
2. Upload the same PDF again (or any PDF)
3. Watch console - should now see:

```
🚀 Processing document for RAG: your-file.pdf
📄 Created 55 chunks
✅ Chunks stored successfully
✅ RAG processing complete
```

### Step 4: Verify in Database
Run this SQL to confirm:

```sql
SELECT COUNT(*) as total_chunks FROM document_chunks;
```

Should return > 0!

---

## What Was Fixed?

**Before:** Only authenticated users could insert chunks
**After:** Both authenticated AND anonymous users can insert chunks

This matches your proposals table setup (which allows anonymous uploads).

---

## Why Did This Happen?

The original RLS policies only had:
```sql
TO authenticated  -- ❌ Only logged-in users
```

The fix added:
```sql
TO anon  -- ✅ Also anonymous users
```

---

## Next Steps

Once you run the fix:
1. Upload your PDF again
2. Check the console - should complete successfully
3. Query database to see your chunks!

```sql
-- See your chunks
SELECT 
  p.file_name,
  COUNT(dc.id) as chunk_count
FROM proposals p
LEFT JOIN document_chunks dc ON dc.proposal_id = p.id
GROUP BY p.id, p.file_name
ORDER BY p.uploaded_at DESC;
```

---

**Run the SQL fix now and try uploading again!** 🎉
