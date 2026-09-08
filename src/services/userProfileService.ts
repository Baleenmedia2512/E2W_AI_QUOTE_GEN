import { supabase } from './supabaseClient';
import { authService } from './authService';

export interface SelfProfile {
  name: string;
  email: string;
  phone: string;
  profileImage: string | null;
}

export interface ProfileMutationResult {
  success: boolean;
  message: string;
  name?: string;
  email?: string;
  phone?: string;
  image?: string | null;
  profileImage?: string | null;
}

const PROFILE_IMAGE_BUCKET = 'profile-images';
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
  const isDirectProfileResponse =
    body.success === undefined
    && (typeof body.name === 'string' || typeof body.email === 'string' || body.image !== undefined);

  return {
    success: body.success === true || isDirectProfileResponse,
    message: body.message || (body.success === true ? 'Success' : fallback),
    name: body.name,
    email: body.email,
    phone: body.phone,
    // The database column is `image`; profileImage remains the UI alias.
    profileImage: body.profileImage ?? body.image ?? null,
  };
}

async function uploadToProfileBucket(file: File, userId: string): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.');
  }

  if (file.size > MAX_PROFILE_IMAGE_BYTES) {
    throw new Error('Profile image must be 5MB or smaller.');
  }

  const path = `${userId}/profile.jpg`;
  const { error } = await supabase.storage.from(PROFILE_IMAGE_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: true,
    contentType: file.type || 'image/jpeg',
  });

  if (error) {
    throw new Error(error.message || 'Unable to upload profile image.');
  }

  const { data } = supabase.storage.from(PROFILE_IMAGE_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) {
    throw new Error('Unable to resolve the uploaded profile image.');
  }

  const separator = data.publicUrl.includes('?') ? '&' : '?';
  return `${data.publicUrl}${separator}v=${Date.now()}`;
}

export async function uploadProfileImage(file: File): Promise<string> {
  const currentUserId = authService.getCurrentUser()?.id;
  if (!currentUserId) {
    throw new Error('You must be signed in to upload a profile image.');
  }

  return uploadToProfileBucket(file, currentUserId);
}

export async function getSelfProfile(): Promise<SelfProfile | null> {
  const currentUserId = authService.getCurrentUser()?.id;
  if (!currentUserId) return null;

  const { data, error } = await supabase.rpc('get_self_profile', {
    p_user_id: currentUserId,
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
    phone: result.phone || '',
    profileImage: result.profileImage || null,
  };
}

export async function updateSelfProfile(
  name: string,
  phone: string,
  profileImage?: string | null,
): Promise<ProfileMutationResult> {
  const currentUserId = authService.getCurrentUser()?.id;
  if (!currentUserId) {
    return { success: false, message: 'You must be signed in to update your profile.' };
  }

  const { data, error } = await supabase.rpc('update_self_profile', {
    p_user_id: currentUserId,
    p_name: name,
    p_phone: phone,
    p_image: profileImage || null,
  });

  if (error) {
    return {
      success: false,
      message: error.message || 'Unable to update profile.',
    };
  }

  return asProfileResult(data, 'Unable to update profile.');
}

