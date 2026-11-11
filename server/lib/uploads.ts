import { promises as fs } from 'fs';
import path from 'path';

export const LOCAL_UPLOAD_URL_PREFIX = '/uploads/';

/** Shared Cost Manager public base, e.g. https://wellnessvalley.in/costmanager */
export function uploadsPublicBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_UPLOADS_BASE_URL
    || process.env.VITE_UPLOADS_BASE_URL
    || ''
  ).replace(/\/$/, '');
}

function mileswebUploadUrl(): string {
  return (process.env.MILESWEB_UPLOAD_URL || '').trim();
}

function mileswebUploadSecret(): string {
  return (process.env.MILESWEB_UPLOAD_SECRET || '').trim();
}

export function isMileswebUploadConfigured(): boolean {
  return Boolean(mileswebUploadUrl() && mileswebUploadSecret() && uploadsPublicBaseUrl());
}

/** MilesWeb: public_html/uploads. Local: <repo>/public_html/uploads. */
export function uploadsRoot(): string {
  if (process.env.UPLOAD_ROOT?.trim()) {
    return path.resolve(process.env.UPLOAD_ROOT.trim());
  }
  return path.join(process.cwd(), 'public_html', 'uploads');
}

function normalizeRelativePath(relativePath: string): string {
  const segments = relativePath
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== '.' && segment !== '..');
  if (segments.length === 0) throw new Error('Invalid upload path.');
  return segments.join('/');
}

function absolutePathFor(relativePath: string): string {
  const root = uploadsRoot();
  const absolute = path.resolve(root, relativePath);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error('Invalid upload path.');
  }
  return absolute;
}

export function getLocalUploadUrl(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  const encoded = normalized
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  const publicBase = uploadsPublicBaseUrl();
  if (publicBase) {
    return `${publicBase}/${encoded}`;
  }
  return `${LOCAL_UPLOAD_URL_PREFIX}${encoded}`;
}

/**
 * Cost Manager upload.php bridge — same contract:
 * header X-Upload-Secret, multipart fields path + file
 * → { success, data: { url, path } }
 */
async function saveMileswebUpload(
  relativePath: string,
  data: Buffer,
  contentType?: string,
): Promise<{ url: string; path: string }> {
  const endpoint = mileswebUploadUrl();
  const secret = mileswebUploadSecret();
  if (!endpoint || !secret) {
    throw new Error('MilesWeb upload is not configured.');
  }

  const normalized = normalizeRelativePath(relativePath);
  const fileName = path.posix.basename(normalized);
  const form = new FormData();
  form.append('path', normalized);
  form.append(
    'file',
    new Blob([data], { type: contentType || 'application/octet-stream' }),
    fileName,
  );

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'X-Upload-Secret': secret },
    body: form,
  });
  const text = await res.text();
  let parsed: {
    success?: boolean;
    error?: string;
    data?: { url?: string; path?: string };
  } = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`MilesWeb upload failed (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || !parsed.success || !parsed.data?.url) {
    throw new Error(parsed.error || `MilesWeb upload failed (${res.status})`);
  }

  return {
    url: String(parsed.data.url),
    path: String(parsed.data.path || normalized),
  };
}

async function saveDiskUpload(
  relativePath: string,
  data: Buffer,
): Promise<{ url: string; path: string }> {
  const normalized = normalizeRelativePath(relativePath);
  const ext = path.posix.extname(normalized);
  const base = ext ? normalized.slice(0, -ext.length) : normalized;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? normalized : `${base}-${attempt}${ext}`;
    const absolute = absolutePathFor(candidate);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    try {
      await fs.writeFile(absolute, data, { flag: 'wx' });
      return { url: getLocalUploadUrl(candidate), path: candidate };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') continue;
      throw error;
    }
  }
  throw new Error('Unable to allocate a unique upload file name.');
}

/** Prefer shared MilesWeb bridge when configured; else local disk (dev fallback). */
export async function saveLocalUpload(
  relativePath: string,
  data: Buffer,
  contentType?: string,
): Promise<{ url: string; path: string }> {
  if (isMileswebUploadConfigured()) {
    return saveMileswebUpload(relativePath, data, contentType);
  }
  return saveDiskUpload(relativePath, data);
}

export async function removeLocalUpload(relativePath: string): Promise<void> {
  // MilesWeb bridge has no delete API here — only clear local disk copies.
  if (isMileswebUploadConfigured()) return;
  try {
    await fs.unlink(absolutePathFor(normalizeRelativePath(relativePath)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }
}
