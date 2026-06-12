# 📦 SUPABASE STORAGE SETUP FOR IMAGES

## 🎯 Setup Image Storage Bucket

### **Step 1: Create Storage Bucket**

1. Go to Supabase Dashboard
2. Click **"Storage"** in left sidebar
3. Click **"New bucket"** button
4. Enter bucket name: `proposal-images`
5. **Public bucket:** ✅ **YES** (check this box)
6. Click **"Create bucket"**

---

### **Step 2: Set Storage Policies (Optional)**

If you want to restrict who can upload:

```sql
-- Allow authenticated users to upload
CREATE POLICY "Allow authenticated uploads"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'proposal-images');

-- Allow public read access
CREATE POLICY "Allow public read access"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'proposal-images');

-- Allow authenticated users to delete their uploads
CREATE POLICY "Allow authenticated deletes"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'proposal-images');
```

---

### **Step 3: Verify Bucket**

Run this query in SQL Editor:

```sql
SELECT * FROM storage.buckets WHERE name = 'proposal-images';
```

Should return 1 row showing the bucket exists.

---

## 🖼️ IMAGE EXTRACTION WORKFLOW

### **What Happens When You Upload PDF:**

```
1. Upload PDF (131 pages)
   ↓
2. Extract Text
   ↓
3. Extract Images (using pdf.js)
   ↓
4. Upload Images to Supabase Storage
   - Bucket: proposal-images
   - Path: rate-card-images/page{N}-img{i}-{timestamp}.jpg
   ↓
5. Get Public URLs
   - Example: https://xxx.supabase.co/storage/v1/object/public/proposal-images/...
   ↓
6. Store URLs in Database
   - metadata.images: array of image URLs
   - metadata.thumbnail: first image URL
   ↓
7. Display in UI
   - Show images with services
   - Use in quote generation
```

---

## 📊 METADATA WITH IMAGES

### **Database Structure:**

```json
{
  "unit_price": 16000,
  "currency": "INR",
  "size": "12 sq ft",
  "duration": "30 days",
  "locations": ["Bangalore", "Delhi"],
  "category": "Bus Advertising",
  "images": [
    "https://xxx.supabase.co/storage/v1/object/public/proposal-images/page5-img1.jpg",
    "https://xxx.supabase.co/storage/v1/object/public/proposal-images/page5-img2.jpg"
  ],
  "thumbnail": "https://xxx.supabase.co/storage/v1/object/public/proposal-images/page5-img1.jpg"
}
```

---

## 🎨 DISPLAY IMAGES IN UI

### **Example Query to Get Service with Images:**

```typescript
const { data } = await supabase
  .from('proposal_chunks')
  .select('*')
  .eq('service_id', 'bus-semi-branding')
  .single();

// Access images
const images = data.metadata.images; // Array of URLs
const thumbnail = data.metadata.thumbnail; // First image
```

### **Display in React Component:**

```tsx
<div className="service-card">
  {service.metadata.thumbnail && (
    <img 
      src={service.metadata.thumbnail} 
      alt={service.service_name}
      className="service-thumbnail"
    />
  )}
  <h3>{service.service_name}</h3>
  <p>Price: ₹{service.metadata.unit_price}</p>
  
  {/* Image gallery */}
  <div className="image-gallery">
    {service.metadata.images?.map((url, index) => (
      <img 
        key={index}
        src={url} 
        alt={`${service.service_name} ${index + 1}`}
        className="gallery-image"
      />
    ))}
  </div>
</div>
```

---

## ⚙️ CONFIGURATION

### **Storage Limits:**

- **Free tier:** 1 GB storage
- **Pro tier:** 100 GB storage
- **Image formats:** JPEG, PNG, WebP, GIF
- **Max file size:** 50 MB per file

### **Optimize Images:**

The extraction function automatically:
- ✅ Converts to JPEG
- ✅ Sets quality to 95%
- ✅ Generates unique filenames with timestamps

---

## 🔒 SECURITY BEST PRACTICES

### **1. Public Bucket (Current Setup):**
- ✅ Anyone can view images
- ✅ Good for public marketing materials
- ⚠️ URLs are publicly accessible

### **2. Private Bucket (Alternative):**
- ✅ Requires authentication to view
- ✅ Better for sensitive data
- ⚠️ Need to generate signed URLs

To make bucket private:
1. Go to Storage → proposal-images
2. Uncheck "Public bucket"
3. Add RLS policies for access control

---

## 🚀 READY TO USE!

After setting up the bucket, you can:
1. Upload your Baleen Media PDF
2. Images will be automatically extracted
3. Uploaded to Supabase Storage
4. URLs stored in database
5. Available for display in UI

**Bucket name:** `proposal-images`  
**Status:** Public (anyone can view)  
**Location:** Your Supabase project storage

---

## ✅ VERIFICATION

Check that images are uploaded:

```sql
-- Count images in storage
SELECT COUNT(*) 
FROM storage.objects 
WHERE bucket_id = 'proposal-images';

-- View all images
SELECT name, created_at 
FROM storage.objects 
WHERE bucket_id = 'proposal-images'
ORDER BY created_at DESC;
```

---

## 📝 TROUBLESHOOTING

### **Error: "Bucket not found"**
Solution: Create the bucket in Supabase Dashboard → Storage

### **Error: "Permission denied"**
Solution: Make bucket public or add proper RLS policies

### **Images not extracting**
Solution: Check browser console for pdf.js errors

### **Storage quota exceeded**
Solution: Upgrade to Pro tier or delete old images

---

## 🎯 NEXT STEPS

After setup:
1. ✅ Create bucket
2. ✅ Upload PDF with images
3. ✅ Verify images in storage
4. ✅ Display images in UI
5. ✅ Use images in quote generation

**Ready to extract images from your PDF!** 🖼️
