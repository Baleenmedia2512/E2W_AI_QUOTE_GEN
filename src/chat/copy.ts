const MAX_LINES = 2;

/** Availability line + ask line, max two lines (DB-driven copy only). */
export function formatReply(avail?: string | null, ask?: string | null): string {
  const lines = [avail, ask]
    .map((s) => (s || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .slice(0, MAX_LINES);
  return lines.join('\n');
}
