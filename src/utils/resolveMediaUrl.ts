/**
 * Shared MilesWeb public storage:
 *   NEXT_PUBLIC_UPLOADS_BASE_URL / VITE_UPLOADS_BASE_URL
 *   → https://baleenmedia.in/costmanager/proposal-images/...
 *
 * Leftover wellnessvalley / supabase / relative /uploads paths rewrite to that base.
 */

const UPLOADS_BASE = (
  import.meta.env.NEXT_PUBLIC_UPLOADS_BASE_URL
  || import.meta.env.VITE_UPLOADS_BASE_URL
  || 'https://baleenmedia.in/costmanager'
).replace(/\/$/, '');

const REMOTE_IMAGE_MARKERS = [
  '://baleenmedia.in/costmanager/proposal-images/',
  '://www.baleenmedia.in/costmanager/proposal-images/',
  '://wellnessvalley.in/costmanager/proposal-images/',
  '://www.wellnessvalley.in/costmanager/proposal-images/',
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
    return `${UPLOADS_BASE}/${trimmed.slice('/uploads/'.length)}`;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return undefined;
}
