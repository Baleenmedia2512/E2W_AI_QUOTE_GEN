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
