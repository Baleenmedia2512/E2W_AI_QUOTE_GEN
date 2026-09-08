/**
 * Helpers for Design/Display Specification fields from vendor DB metadata.
 * Only show Material / dimensions when metadata has real values (not missing / empty / NA).
 */

export function hasMeaningfulScalar(raw: unknown): boolean {
  if (raw == null) return false;
  if (typeof raw === 'number') return Number.isFinite(raw);
  if (typeof raw === 'boolean') return true;
  if (typeof raw === 'string') {
    const t = raw.trim();
    return t !== '' && t.toUpperCase() !== 'NA';
  }
  return false;
}

export function hasMeaningfulMaterial(raw: unknown): boolean {
  if (raw == null) return false;
  if (typeof raw === 'string') {
    const t = raw.trim();
    return t !== '' && t.toUpperCase() !== 'NA';
  }
  if (typeof raw === 'number') return Number.isFinite(raw);
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.values(raw as Record<string, unknown>).some((v) => {
      if (v == null) return false;
      if (typeof v === 'object') return hasMeaningfulMaterial(v);
      return hasMeaningfulScalar(v);
    });
  }
  return false;
}

/** Prefer `material`, fall back to `materials` (admin / DB naming). */
export function pickMaterialFromMeta(
  meta: Record<string, unknown> | null | undefined,
): string | Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const raw = meta.material ?? meta.materials;
  if (!hasMeaningfulMaterial(raw)) return undefined;
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const entries = Object.entries(raw as Record<string, unknown>).filter(([, v]) =>
      hasMeaningfulMaterial(v),
    );
    if (entries.length === 0) return undefined;
    return Object.fromEntries(entries);
  }
  return undefined;
}

/** Format material for synthetic "Label: value" spec page text. */
export function formatMaterialSpecLines(
  material: string | Record<string, unknown>,
  splitFlat: (raw: string, fallbackLabel: string) => string,
): string {
  if (typeof material === 'object') {
    return Object.entries(material)
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
      .join('\n');
  }
  return splitFlat(String(material), 'Material');
}

const DISPLAY_DIM_KEYS: Array<{ keys: string[]; label: string }> = [
  { keys: ['display_width', 'width'], label: 'Width' },
  { keys: ['display_height', 'height'], label: 'Height' },
  { keys: ['display_length', 'length'], label: 'Length' },
];

/**
 * DB display_width / display_height / display_length → Specification rows.
 * Missing, empty, or "NA" values are omitted.
 */
export function pickDisplayDimensionFields(
  meta: Record<string, unknown> | null | undefined,
): Array<{ label: string; value: string }> {
  if (!meta) return [];
  const out: Array<{ label: string; value: string }> = [];
  for (const { keys, label } of DISPLAY_DIM_KEYS) {
    let value: unknown;
    for (const k of keys) {
      if (hasMeaningfulScalar(meta[k])) {
        value = meta[k];
        break;
      }
    }
    if (value == null || typeof value === 'object') continue;
    out.push({ label, value: String(value).trim() });
  }
  return out;
}

/** "Width: …\\nHeight: …" lines for synthetic DESIGN SPECIFICATION page text. */
export function formatDisplayDimensionSpecLines(
  meta: Record<string, unknown> | null | undefined,
): string {
  return pickDisplayDimensionFields(meta)
    .map((f) => `${f.label}: ${f.value}`)
    .join('\n');
}

/** Collect unique non-empty remarks from quote items / line items for a service. */
export function collectServiceRemarks(
  items?: Array<{ remark?: string; lineItems?: Array<{ remark?: string }> }>,
): string {
  if (!items?.length) return '';
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const candidates: string[] = [];
    if (item.lineItems?.length) {
      for (const li of item.lineItems) {
        if (li.remark?.trim()) candidates.push(li.remark);
      }
    }
    if (item.remark?.trim()) candidates.push(item.remark);
    for (const r of candidates) {
      const dedupeKey = r.trim();
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        out.push(r);
      }
    }
  }
  return out.join('; ');
}
