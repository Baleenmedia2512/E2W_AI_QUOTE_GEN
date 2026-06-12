/**
 * Supabase Proposal Service - Cloud Storage for Shared Proposals
 * Enables team-wide visibility of uploaded proposals
 */

import { supabase } from './supabaseClient';
import { StoredProposal } from '../types';

export interface CloudProposal {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  file_url: string;
  storage_path: string;
  text_content: string;
  page_count: number;
  uploaded_by_user_id: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
}

/**
 * Upload file to Supabase Storage and save metadata
 */
export async function uploadProposalToCloud(
  file: File,
  textContent: string,
  pageCount: number,
  userId?: string,
  userName?: string
): Promise<{ success: boolean; proposal?: CloudProposal; error?: string }> {
  try {
    // Get current user if not provided (optional - works without auth)
    let currentUserId = userId || 'anonymous';
    let currentUserName = userName || 'App User';

    // Try to get authenticated user, but don't fail if not authenticated
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        currentUserId = user.id;
        currentUserName = user.email || 'Authenticated User';
        console.log('✅ Authenticated user:', currentUserId, currentUserName);
      } else {
        console.log('ℹ️ No auth session, using anonymous upload');
      }
    } catch (authError) {
      // Auth failed - continue with anonymous upload
      console.log('ℹ️ Auth check failed, continuing with anonymous upload');
    }

    // Create storage path: user_id/timestamp_filename
    const timestamp = Date.now();
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${currentUserId}/${timestamp}_${sanitizedFileName}`;

    // Upload file to Supabase Storage
    console.log('📤 Uploading file to Supabase Storage:', storagePath);
    const { error: uploadError } = await supabase.storage
      .from('proposals')
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      console.error('❌ Storage upload error:', uploadError);
      return { success: false, error: uploadError.message };
    }

    // Get public URL for the file
    const { data: urlData } = supabase.storage
      .from('proposals')
      .getPublicUrl(storagePath);

    const fileUrl = urlData.publicUrl;

    // Save metadata to database
    console.log('💾 Saving proposal metadata to database, user_id:', currentUserId);
    const { data: proposalData, error: dbError } = await supabase
      .from('proposals')
      .insert({
        file_name: file.name,
        file_type: file.type || 'application/pdf',
        file_size: file.size,
        file_url: fileUrl,
        storage_path: storagePath,
        text_content: textContent,
        page_count: pageCount,
        uploaded_by_user_id: currentUserId,  // TEXT column accepts any string
        uploaded_by_name: currentUserName,
      })
      .select()
      .single();

    if (dbError) {
      console.error('❌ Database insert error:', dbError);
      // Cleanup: delete uploaded file
      await supabase.storage.from('proposals').remove([storagePath]);
      return { success: false, error: dbError.message };
    }

    console.log('✅ Proposal uploaded to cloud successfully');
    return { success: true, proposal: proposalData };
  } catch (error: any) {
    console.error('❌ Upload to cloud failed:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Load all proposals from cloud (visible to all users)
 */
export async function loadAllProposalsFromCloud(
  limit: number = 20
): Promise<CloudProposal[]> {
  try {
    console.log('📂 Loading proposals from cloud...');
    const { data, error } = await supabase
      .from('proposals')
      .select('*')
      .order('uploaded_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('❌ Error loading proposals from cloud:', error);
      return [];
    }

    console.log(`✅ Loaded ${data?.length || 0} proposals from cloud`);
    return data || [];
  } catch (error) {
    console.error('❌ Exception loading proposals:', error);
    return [];
  }
}

/**
 * Load a specific proposal from cloud
 */
export async function loadProposalFromCloud(id: string): Promise<CloudProposal | null> {
  try {
    const { data, error } = await supabase
      .from('proposals')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('❌ Error loading proposal:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('❌ Exception loading proposal:', error);
    return null;
  }
}

/**
 * Delete proposal from cloud (file + metadata)
 */
export async function deleteProposalFromCloud(id: string): Promise<boolean> {
  try {
    // Get proposal to find storage path
    const { data: proposal } = await supabase
      .from('proposals')
      .select('storage_path')
      .eq('id', id)
      .single();

    if (!proposal) {
      console.error('❌ Proposal not found');
      return false;
    }

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from('proposals')
      .remove([proposal.storage_path]);

    if (storageError) {
      console.warn('⚠️ Storage delete error:', storageError);
      // Continue anyway to delete database record
    }

    // Delete from database
    const { error: dbError } = await supabase
      .from('proposals')
      .delete()
      .eq('id', id);

    if (dbError) {
      console.error('❌ Database delete error:', dbError);
      return false;
    }

    console.log('✅ Proposal deleted from cloud');
    return true;
  } catch (error) {
    console.error('❌ Exception deleting proposal:', error);
    return false;
  }
}

/**
 * Check if a proposal with same name and size exists in cloud
 */
export async function findCloudDuplicate(
  fileName: string,
  fileSize: number
): Promise<CloudProposal | null> {
  try {
    const { data, error } = await supabase
      .from('proposals')
      .select('*')
      .eq('file_name', fileName)
      .eq('file_size', fileSize)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('❌ Error checking for duplicates:', error);
      return null;
    }

    if (data) {
      console.log('🔍 Found duplicate in cloud:', data.file_name);
    }

    return data;
  } catch (error) {
    console.error('❌ Exception checking duplicates:', error);
    return null;
  }
}

/**
 * Download file from cloud storage
 */
export async function downloadProposalFile(storagePath: string): Promise<Blob | null> {
  try {
    const { data, error } = await supabase.storage
      .from('proposals')
      .download(storagePath);

    if (error) {
      console.error('❌ Error downloading file:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('❌ Exception downloading file:', error);
    return null;
  }
}

/**
 * Check if Supabase is properly configured
 * NOTE: Temporarily disabled — RLS policies on Supabase block anon uploads.
 * App falls back to IndexedDB (local storage) until Supabase policies are fixed.
 */
export async function checkCloudStorageAvailability(): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('proposals')
      .select('id')
      .limit(1);

    if (error) {
      console.warn('⚠️ Cloud storage unavailable:', error.message);
      return false;
    }

    console.log('☁️ Cloud storage available');
    return true;
  } catch (error) {
    console.warn('⚠️ Cloud storage check failed:', error);
    return false;
  }
}

/**
 * Helper: Convert CloudProposal to StoredProposal format
 * Used for compatibility with local IndexedDB storage interface
 */
export function cloudProposalToStored(cloud: CloudProposal): StoredProposal {
  return {
    id: cloud.id,
    fileName: cloud.file_name,
    fileType: cloud.file_type,
    fileSize: cloud.file_size,
    fileBlob: null, // Blob will be downloaded on-demand when selected
    textContent: cloud.text_content,
    pageCount: cloud.page_count,
    extractedImages: [],
    pageImages: [],
    uploadedAt: new Date(cloud.uploaded_at),
    // Cloud-specific fields
    isCloudStored: true,
    fileUrl: cloud.file_url,
    storagePath: cloud.storage_path,
    uploadedByUserId: cloud.uploaded_by_user_id,
    uploadedByName: cloud.uploaded_by_name,
  };
}

/**
 * Save Gemini OCR review data back to proposal_chunks metadata.
 * Called once after first OCR — subsequent renders use DB data (no extra API call).
 */
export async function saveReviewToCloud(
  serviceId: string,
  reviewData: { reviewerName: string; starCount: number; reviewText: string }
): Promise<void> {
  try {
    // Fetch current metadata first
    const { data, error: fetchErr } = await supabase
      .from('proposal_chunks')
      .select('metadata')
      .eq('service_id', serviceId)
      .single();

    if (fetchErr || !data) {
      console.warn(`⚠️ [saveReviewToCloud] Could not fetch service "${serviceId}":`, fetchErr?.message);
      return;
    }

    const updatedMetadata = { ...(data.metadata || {}), review: reviewData };

    const { error: updateErr } = await supabase
      .from('proposal_chunks')
      .update({ metadata: updatedMetadata })
      .eq('service_id', serviceId);

    if (updateErr) {
      console.warn(`⚠️ [saveReviewToCloud] Update failed for "${serviceId}":`, updateErr.message);
    } else {
      console.log(`✅ [saveReviewToCloud] Saved review for "${serviceId}": ${reviewData.reviewerName}`);
    }
  } catch (err) {
    console.warn(`⚠️ [saveReviewToCloud] Exception:`, err);
  }
}

/**
 * Load all services from proposal_chunks table (PRIMARY DATA SOURCE)
 * This is the cloud-first approach for fetching service data with images
 */
export async function loadAllServicesFromCloud(): Promise<any[]> {
  try {
    console.log('☁️ Querying proposal_chunks table...');
    
    const { data, error } = await supabase
      .from('proposal_chunks')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('❌ Error loading services from proposal_chunks:', error);
      throw error;
    }
    
    console.log(`✅ Loaded ${data?.length || 0} services from proposal_chunks`);
    return data || [];
  } catch (error) {
    console.error('❌ Exception loading services:', error);
    throw error;
  }
}

/**
 * Transform proposal_chunks data to ExtractedPage format
 * Converts cloud service records into preview-ready page objects
 */
export function transformServicesToPages(services: any[]): any[] {
  console.log(`🔄 Transforming ${services.length} services to page format...`);

  // Map DB image type enum → exact heading keyword that ReferenceImages component expects.
  // getRefImagePages()  checks for 'reference image'
  // REVIEW_HEADING_PATTERN checks for 'customer review feedback'
  // extractSpecSectionImage checks for 'design specification'
  const headingMap: Record<string, string> = {
    'reference':     'REFERENCE IMAGE',
    'review':        'CUSTOMER REVIEW FEEDBACK FOR OUR SERVICE',
    'specification': 'DESIGN SPECIFICATION',
  };
  
  const pages: any[] = [];
  
  services.forEach((service) => {
    // metadata.images is Array<{ url, type, pageNumber }>
    const images: Array<{ url: string; type: string; pageNumber?: number }> = service.metadata?.images || [];
    const locations = service.metadata?.locations || ['General'];
    const city = (locations[0] || 'General').toLowerCase();

    if (images.length > 0) {
      images.forEach((img) => {
        const imageType = img.type || 'reference';
        // Prefix text with correct section heading so ReferenceImages keyword checks work.
        // Format: "<HEADING>\n<SERVICE NAME>\n<DESCRIPTION>"
        // For review pages: if metadata.review exists (saved after first OCR), use real reviewer
        // text so extractCustomerReview() gets the right data without any Gemini call.
        const headingPrefix = headingMap[imageType] || 'REFERENCE IMAGE';
        let pageText: string;
        if (imageType === 'review' && service.metadata?.review) {
          const r = service.metadata.review;
          // Format matches what extractCustomerReview() expects:
          // "CUSTOMER REVIEW FEEDBACK FOR OUR SERVICE\n<reviewerName>\n<reviewText>"
          pageText = `${headingPrefix}\n${r.reviewerName}\n${'★'.repeat(Math.min(5, r.starCount || 5))}\n${r.reviewText}`;
          console.log(`☁️ [REVIEW-FROM-DB] "${service.service_name}": ${r.reviewerName}`);
        } else if (imageType === 'specification') {
          // Spec pages: inject size + material from metadata so extractDesignSpecFields can parse them
          const m2 = service.metadata || {};
          const sizeLines = m2.size
            ? typeof m2.size === 'object'
              ? Object.entries(m2.size).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('\n')
              : `Size: ${m2.size}`
            : '';
          const materialLine = m2.material ? `Material: ${m2.material}` : '';
          pageText = [headingPrefix, service.service_name, sizeLines, materialLine]
            .filter(Boolean).join('\n');
        } else {
          pageText = `${headingPrefix}\n${service.service_name}\n${service.content || ''}`;
        }

        pages.push({
          pageNumber: img.pageNumber || pages.length + 1,
          text: pageText,
          imageDataUrl: img.url,
          croppedImages: [img.url],
          croppedImagesWithTypes: [{ dataUrl: img.url, imageType }],
          imageType,
          sourceId: service.id,
          sourceName: service.document_name || 'Cloud Rate Card',
          serviceName: service.service_name,
          serviceId: service.service_id,
          city,
          metadata: service.metadata,
        });
      });

      // Fallback: if no specification-type image exists but metadata has size/material data,
      // inject a synthetic text-only spec page so the Display Specification section renders.
      // This covers services like Auto Semi Branding that only have reference + review images.
      const hasSpecImage = images.some(img => img.type === 'specification');
      if (!hasSpecImage) {
        const m = service.metadata || {};
        const sizeLines = m.size
          ? typeof m.size === 'object'
            ? Object.entries(m.size).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('\n')
            : `Size: ${m.size}`
          : '';
        const materialLine = m.material ? `Material: ${m.material}` : '';
        const specBody = [sizeLines, materialLine].filter(Boolean).join('\n');
        if (specBody.trim()) {
          const syntheticText = ['DESIGN SPECIFICATION', service.service_name, specBody].join('\n');
          pages.push({
            pageNumber: pages.length + 1,
            text: syntheticText,
            imageDataUrl: '',       // no image — text-only spec page
            croppedImages: [],
            croppedImagesWithTypes: [],
            imageType: 'specification',
            sourceId: service.id,
            sourceName: service.document_name || 'Cloud Rate Card',
            serviceName: service.service_name,
            serviceId: service.service_id,
            city,
            metadata: service.metadata,
          });
          console.log(`📐 [SPEC-FALLBACK] Created synthetic spec page for "${service.service_name}" (size/material from metadata)`);
        }
      }
    } else {
      console.warn(`⚠️ Service "${service.service_name}" has no images in metadata`);
    }
  });
  
  // ── CLOUD DATA SOURCE CONFIRMATION ──────────────────────────────────────
  const refCount  = pages.filter(p => p.imageType === 'reference').length;
  const specCount = pages.filter(p => p.imageType === 'specification').length;
  const revCount  = pages.filter(p => p.imageType === 'review').length;
  console.log('☁️ ═══════════════════════════════════════════════════');
  console.log('☁️  DATA SOURCE: CLOUD (Supabase proposal_chunks)');
  console.log(`☁️  Services loaded : ${services.length}`);
  console.log(`☁️  Total pages     : ${pages.length}`);
  console.log(`☁️    Reference     : ${refCount}`);
  console.log(`☁️    Specification : ${specCount}`);
  console.log(`☁️    Review        : ${revCount}`);
  console.log('☁️  All images are Supabase URLs — no IndexedDB used');
  console.log('☁️ ═══════════════════════════════════════════════════');
  
  return pages;
}
