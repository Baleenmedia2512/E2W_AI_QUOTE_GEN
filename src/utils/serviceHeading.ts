import { canonicalizeServiceName } from './serviceNameUtils';
import type { DbService } from './serviceResolver';

/** Tokens that stay fully uppercase in headings. */
const HEADING_ACRONYMS = new Set([
  'led',
  'lcd',
  'oled',
  'dlf',
  'ecr',
  'omr',
  'gst',
  'ifsc',
  'abn',
  'atm',
  'tv',
  'ac',
  'fm',
  'rto',
  'vr',
]);

function formatHeadingWord(word: string): string {
  const cleaned = word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
  if (!cleaned) return word;
  const lower = cleaned.toLowerCase();
  if (HEADING_ACRONYMS.has(lower)) return lower.toUpperCase();
  if (/^[A-Z]{2,5}$/.test(cleaned) && cleaned.length <= 5) return cleaned.toUpperCase();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

function formatHeadingPart(raw: string): string {
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(formatHeadingWord)
    .join(' ');
}

function isBlankOrNa(raw?: string | null): boolean {
  const t = (raw || '').trim();
  return !t || t === '—' || t.toUpperCase() === 'NA';
}

/**
 * Drop empty / NA parts and remove overlaps
 * (e.g. "Airport towards DLF City" when already covered by a longer part).
 */
export function dedupeHeadingParts(parts: Array<string | null | undefined>): string[] {
  const formatted: string[] = [];
  for (const p of parts) {
    if (isBlankOrNa(p)) continue;
    const next = formatHeadingPart(String(p));
    if (!next) continue;
    const key = canonicalizeServiceName(next);
    if (!key) continue;

    // Drop if this part is already contained in an existing part
    const covered = formatted.some((f) => {
      const fk = canonicalizeServiceName(f);
      return fk === key || fk.includes(key);
    });
    if (covered) continue;

    // Drop earlier shorter parts that this longer one covers
    for (let i = formatted.length - 1; i >= 0; i -= 1) {
      const fk = canonicalizeServiceName(formatted[i]);
      if (key !== fk && key.includes(fk)) {
        formatted.splice(i, 1);
      }
    }
    formatted.push(next);
  }
  return formatted;
}

function metaString(svc: DbService, ...keys: string[]): string | null {
  const meta = (svc.metadata || {}) as Record<string, unknown>;
  for (const k of keys) {
    const v = meta[k];
    if (typeof v === 'string' && !isBlankOrNa(v)) return v.trim();
  }
  return null;
}

function mediumFromSvc(svc: DbService): string | null {
  const fromMeta = metaString(svc, 'medium', 'medium_name');
  if (fromMeta) return fromMeta.split('|')[0].trim();
  const name = (svc.service_name || '').split(/[·—–]/)[0].trim();
  if (name && name.length <= 60) return name;
  return null;
}

function mediumTypeFromSvc(svc: DbService): string | null {
  const raw = metaString(svc, 'medium_type', 'mediumType', 'type_of_medium');
  if (!raw) return null;
  const lower = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (lower === 'fl' || lower === 'front lit') return 'Frontlit';
  if (lower === 'nl' || lower === 'non lit' || lower === 'not lit') return 'Nonlit';
  return raw;
}

function cityFromSvc(svc: DbService): string | null {
  const meta = metaString(svc, 'city');
  if (meta && !/towards|flyover|road near/i.test(meta) && meta.split(/\s+/).length <= 3) {
    return meta;
  }
  const locs = (svc.metadata as { locations?: string[] } | undefined)?.locations;
  if (Array.isArray(locs) && locs[0] && !isBlankOrNa(locs[0])) return String(locs[0]).trim();
  return null;
}

function areaFromSvc(svc: DbService): string | null {
  return metaString(svc, 'area_name', 'area', 'locality');
}

function directionFromSvc(svc: DbService): string | null {
  return metaString(svc, 'direction_remarks', 'direction');
}

/**
 * Medium → Type → City → Area → Direction (deduped).
 * Example: Hoarding · Frontlit · Chennai · Airport Road near Kathibara Flyover · Airport towards DLF City
 */
export function buildStructuredServiceHeading(svc: DbService): string {
  return dedupeHeadingParts([
    mediumFromSvc(svc),
    mediumTypeFromSvc(svc),
    cityFromSvc(svc),
    areaFromSvc(svc),
    directionFromSvc(svc),
  ]).join(' · ');
}

/** PDF / preview: dedupe separators and show ALL CAPS. */
export function formatServiceHeadingDisplay(raw: string): string {
  if (!raw?.trim()) return raw;
  const parts = raw
    .split(/\s*[·|,—–]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const cleaned = dedupeHeadingParts(parts).join(' · ');
  return cleaned.toUpperCase();
}
