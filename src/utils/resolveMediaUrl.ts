/**
 * Shared MilesWeb public storage:
 *   NEXT_PUBLIC_UPLOADS_BASE_URL / VITE_UPLOADS_BASE_URL
 *   → https://rms.baleenmedia.com/proposal-images/...
 *
 * Leftover wellnessvalley / costmanager / legacy storage / relative /uploads paths
 * rewrite onto that base.
 */

const UPLOADS_BASE = (
  import.meta.env.NEXT_PUBLIC_UPLOADS_BASE_URL
  || import.meta.env.VITE_UPLOADS_BASE_URL
  || 'https://rms.baleenmedia.com'
).replace(/\/$/, '');

/** Hosts/path prefixes that store the same proposal-images object keys. */
const REMOTE_IMAGE_MARKERS = [
  '://rms.baleenmedia.com/proposal-images/',
  '://www.rms.baleenmedia.com/proposal-images/',
  '://baleenmedia.com/costmanager/proposal-images/',
  '://www.baleenmedia.com/costmanager/proposal-images/',
  '://baleenmedia.in/costmanager/proposal-images/',
  '://www.baleenmedia.in/costmanager/proposal-images/',
  '://wellnessvalley.in/costmanager/proposal-images/',
  '://www.wellnessvalley.in/costmanager/proposal-images/',
  // Legacy object-storage path (migrated) → rewrite to MilesWeb public base
  '://wkwrrdcjknvupwsfdjtd.supabase.co/storage/v1/object/public/proposal-images/',
] as const;

function isBlankOrNa(value: string): boolean {
  return !value || /^(n\/?a|null|undefined)$/i.test(value);
}

function toPublicProposalImageUrl(objectKey: string): string {
  const encoded = objectKey
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${UPLOADS_BASE}/proposal-images/${encoded}`;
}

/** Map DB / legacy media URL strings onto shared MilesWeb public URLs. */
export function resolveMediaUrl(raw: string | null | undefined): string | undefined {
  if (raw == null) return undefined;
  const trimmed = String(raw).trim();
  if (isBlankOrNa(trimmed)) return undefined;

  const lower = trimmed.toLowerCase();
  for (const marker of REMOTE_IMAGE_MARKERS) {
    const idx = lower.indexOf(marker);
    if (idx >= 0) {
      const rest = trimmed.slice(idx + marker.length);
      if (!rest) return undefined;
      return toPublicProposalImageUrl(rest);
    }
  }

  // Old Quote Buddy local proxy paths → shared MilesWeb public base
  if (trimmed.startsWith('/uploads/')) {
    const rest = trimmed.slice('/uploads/'.length).replace(/^proposal-images\//i, '');
    return toPublicProposalImageUrl(rest);
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return undefined;
}
