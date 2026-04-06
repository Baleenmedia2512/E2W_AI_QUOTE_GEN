# Global Shared Proposal Library - Cloud Storage Setup

## 🎯 Overview
Your app now has a **global shared proposal library** where all users can see proposals uploaded by anyone in the team! This is achieved through a hybrid storage approach:

- **Local Storage (IndexedDB)**: For offline capability and fast access
- **Cloud Storage (Supabase)**: For team-wide visibility and sharing

## ✨ Features Implemented

### 1. **Global Visibility**
- When a user uploads a PDF/Excel/JPEG, it's automatically saved to both local storage AND cloud storage
- All users can see ALL proposals uploaded by anyone
- Each proposal shows who uploaded it (with user's name)

### 2. **Duplicate Detection (Hybrid)**
- Checks BOTH local IndexedDB and cloud Supabase for duplicates
- Asks user to confirm before replacing existing files

### 3. **Seamless Hybrid Storage**
- Local proposals work offline
- Cloud proposals download on-demand when selected
- Automatic fallback to local-only if cloud is unavailable

### 4. **Beautiful UI**
- Cloud proposals show ☁️ indicator with uploader's name
- Recent uploads section displays merged results from both sources

## 📋 Supabase Setup Required

### Step 1: Run the SQL Schema
1. Open your Supabase dashboard: https://app.supabase.com
2. Go to **SQL Editor** tab
3. Copy and paste the entire contents of `database-proposals-setup.sql`
4. Click **Run** to execute

This will create:
- `proposals` table for metadata
- Row Level Security (RLS) policies for authenticated users
- Indexes for fast queries
- Storage bucket policies

### Step 2: Create Storage Bucket
1. In Supabase dashboard, go to **Storage** section
2. Click **New Bucket**
3. Bucket name: `proposals` (exactly this name)
4. Make it **private** (the SQL script already sets up policies)
5. Click **Create bucket**

### Step 3: Verify Users Table
Your app should already have a `users` table with `full_name` column from the authentication setup. If not, the cloud storage will use the user's email as the display name.

### Step 4: Test!
1. Deploy the updated app
2. Login as User A
3. Upload a PDF file
4. See it appear in Recent Uploads with ☁️ indicator
5. Login as User B on a different browser/device
6. See the same proposal appears in their Recent Uploads!

## 🔧 How It Works

### Upload Flow:
```
User uploads file
  ↓
1. Save to IndexedDB (local) ✅
2. Upload to Supabase Storage ✅
3. Save metadata to proposals table ✅
4. Reload recent proposals (merges local + cloud) ✅
```

### Load Flow:
```
Open Recent Uploads section
  ↓
1. Load from IndexedDB (fast, local) 📦
2. Load from Supabase (cloud, team-wide) ☁️
3. Merge unique proposals by ID
4. Display sorted by newest first
```

### Select Flow:
```
User clicks a proposal card
  ↓
Is it in local storage?
  YES → Load from IndexedDB instantly 🚀
  NO  → Download from Supabase cloud ⬇️
  ↓
Process and display normally
```

## 💾 Backward Compatibility

✅ **ZERO BREAKING CHANGES** - All existing functionality preserved:
- Local IndexedDB proposal library still works
- Offline capability maintained
- No changes to existing code behavior
- Cloud storage is purely additive

If Supabase is unavailable:
- App automatically falls back to local-only mode
- All existing features continue to work
- User gets a console warning but no errors

## 📊 File Structure Created

```
src/
├── services/
│   └── supabaseProposalService.ts  ← NEW - Cloud storage service
├── types/
│   └── index.ts                     ← UPDATED - Added cloud fields
├── store/
│   └── index.ts                     ← UPDATED - Hybrid storage logic
├── components/
│   └── ProposalUpload/
│       └── ProposalUpload.tsx       ← UPDATED - Cloud support + UI
database-proposals-setup.sql          ← NEW - Supabase schema
CLOUD_STORAGE_SETUP.md               ← NEW - This guide!
```

## 🎨 UI Changes

### Recent Uploads Section:
- Shows proposals from both local and cloud
- Cloud proposals have **blue badge** with ☁️ and uploader's name
- Local-only proposals show without badge
- All proposals show: pages, file size, upload time

### Duplicate Modal:
- Checks both local and cloud before upload
- Asks "File already exists. Replace?" if duplicate found
- Deletes old from both storages when replacing

## 🔒 Security

- Row Level Security (RLS) enabled on `proposals` table
- Only authenticated users can upload/view/delete
- Storage bucket uses secure policies
- Users can only delete their own uploads (enforced by RLS)

## 📖 API Functions

### In `supabaseProposalService.ts`:

```typescript
// Upload file to cloud
uploadProposalToCloud(file, textContent, pageCount, userId?, userName?)

// Load all proposals from cloud (team-wide)
loadAllProposalsFromCloud()

// Load single proposal from cloud
loadProposalFromCloud(id)

// Delete proposal from cloud
deleteProposalFromCloud(id)

// Check for duplicate in cloud
findCloudDuplicate(fileName, fileSize)

// Download file blob from cloud storage
downloadProposalFile(storagePath)

// Check if cloud storage is available
checkCloudStorageAvailability()

// Convert CloudProposal to StoredProposal format
cloudProposalToStored(cloudProposal)
```

## 🚀 Next Steps

1. ✅ Run `database-proposals-setup.sql` in Supabase SQL Editor
2. ✅ Create `proposals` storage bucket in Supabase Dashboard
3. ✅ Deploy the updated app
4. ✅ Test with multiple users to see team-wide sharing!

---

**That's it!** Your app now has a fully functional global shared proposal library with automatic cloud sync! 🎉
