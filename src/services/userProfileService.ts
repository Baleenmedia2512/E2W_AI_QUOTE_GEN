import { supabase } from './supabaseClient';
import { authService } from './authService';
import { CompanyInfo } from '../types/company';

export interface SelfProfile {
  name: string;
  email: string;
  profileImage: string | null;
}

export interface ProfileMutationResult {
  success: boolean;
  message: string;
  name?: string;
  email?: string;
  profileImage?: string | null;
}

const PROFILE_IMAGE_BUCKETS = ['profile-images', 'proposal-images'] as const;
const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;

function asProfileResult(data: unknown, fallback: string): ProfileMutationResult {
  let parsed: unknown = data;

  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data);
    } catch {
      return { success: false, message: fallback };
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { success: false, message: fallback };
  }

  const body = parsed as ProfileMutationResult;
  return {
    success: body.success === true,
    message: body.message || (body.success === true ? 'Success' : fallback),
    name: body.name,
    email: body.email,
    profileImage: body.profileImage ?? null,
  };
}

async function uploadToBucket(
  bucket: string,
  path: string,
  file: File,
): Promise<string | null> {
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: true,
    contentType: file.type || 'image/jpeg',
  });

  if (error) {
    console.warn(`Profile image upload failed for bucket ${bucket}:`, error.message);
    return null;
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || null;
}

export async function uploadProfileImage(userId: string, file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.');
  }

  if (file.size > MAX_PROFILE_IMAGE_BYTES) {
    throw new Error('Profile image must be 5MB or smaller.');
  }

  const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `profiles/${userId}/${Date.now()}.${extension}`;

  for (const bucket of PROFILE_IMAGE_BUCKETS) {
    const publicUrl = await uploadToBucket(bucket, path, file);
    if (publicUrl) return publicUrl;
  }

  throw new Error('Unable to upload profile image.');
}

export async function getSelfProfile(userId: string): Promise<SelfProfile | null> {
  const { data, error } = await supabase.rpc('get_self_profile', {
    p_user_id: userId,
  });

  if (error) {
    console.warn('get_self_profile RPC failed:', error.message);
    return null;
  }

  const result = asProfileResult(data, 'Unable to load profile.');
  if (!result.success) return null;

  return {
    name: result.name || '',
    email: result.email || '',
    profileImage: result.profileImage || null,
  };
}

export async function updateSelfProfile(
  userId: string,
  name: string,
  profileImage?: string | null,
): Promise<ProfileMutationResult> {
  const { data, error } = await supabase.rpc('update_self_profile', {
    p_user_id: userId,
    p_name: name,
    p_profile_image: profileImage || null,
  });

  if (error) {
    return {
      success: false,
      message: error.message || 'Unable to update profile.',
    };
  }

  return asProfileResult(data, 'Unable to update profile.');
}

export async function updateCompanyProfile(companyInfo: CompanyInfo): Promise<ProfileMutationResult> {
  const currentUser = authService.getCurrentUser();
  if (!currentUser?.id) {
    return { success: false, message: 'You must be signed in to update the company profile.' };
  }

  const { data, error } = await supabase.rpc('update_company_profile', {
    p_user_id: currentUser.id,
    p_company: {
      name: companyInfo.name,
      address: companyInfo.address,
      gst: companyInfo.gst,
      abn: companyInfo.abn || '',
      phone: companyInfo.phone,
      email: companyInfo.email,
      logo: companyInfo.logo || '',
      website: companyInfo.website || '',
      signature: companyInfo.signature || '',
      designation: companyInfo.designation || '',
    },
  });

  if (error) {
    return {
      success: false,
      message: error.message || 'Unable to save company profile.',
    };
  }

  return asProfileResult(data, 'Unable to save company profile.');
}
