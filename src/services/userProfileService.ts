import { authService } from './authService';
import { apiFetch } from './apiClient';

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

const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;

export async function uploadProfileImage(file: File): Promise<string> {
  if (!authService.getCurrentUser()?.id) {
    throw new Error('You must be signed in to upload a profile image.');
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.');
  }
  if (file.size > MAX_PROFILE_IMAGE_BYTES) {
    throw new Error('Profile image must be 5MB or smaller.');
  }

  const form = new FormData();
  form.append('file', file);
  const { data, error } = await apiFetch<{ url?: string; profileImage?: string; error?: string }>(
    '/api/profile/me/image',
    { method: 'POST', body: form },
  );
  if (error || !data?.url) {
    throw new Error(data?.error || error || 'Unable to upload profile image.');
  }
  return data.url;
}

export async function getSelfProfile(): Promise<SelfProfile | null> {
  if (!authService.getCurrentUser()?.id) return null;
  const { data, error } = await apiFetch<ProfileMutationResult>('/api/profile/me');
  if (error || !data?.success) return null;
  return {
    name: data.name || '',
    email: data.email || '',
    phone: data.phone || '',
    profileImage: data.profileImage ?? data.image ?? null,
  };
}

export async function updateSelfProfile(
  name: string,
  phone: string,
  profileImage?: string | null,
): Promise<ProfileMutationResult> {
  if (!authService.getCurrentUser()?.id) {
    return { success: false, message: 'You must be signed in to update your profile.' };
  }

  const { data, error } = await apiFetch<ProfileMutationResult>('/api/profile/me', {
    method: 'PUT',
    body: JSON.stringify({ name, phone, profileImage }),
  });

  if (error || !data) {
    return { success: false, message: error || 'Unable to update profile.' };
  }
  return data;
}
