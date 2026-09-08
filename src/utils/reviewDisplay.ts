/**
 * Display reviewer names in Title Case: "anandan sankar" → "Anandan Sankar"
 */
export function formatReviewerDisplayName(name: string | null | undefined): string {
  const raw = (name || '').trim();
  if (!raw) return 'Customer';
  return raw
    .split(/\s+/)
    .map((word) => {
      if (!word) return word;
      // Keep short particles uppercase-first only; lowercase remainder
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}
