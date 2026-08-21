/**
 * Load quote details from vendor_rate_chunks (preferred_vendor_rank = 1).
 * Uses: pricing, terms, images, review.
 * Cost fields are never read.
 * Missing extras → keep proposal_chunks values (full fallback when no vendor match).
 */

import { canonicalizeServiceName } from '../utils/serviceNameUtils';
import { supabase } from './supabaseClient';
import type {
  VendorImageRef,
  VendorPricingBlock,
  VendorRateRow,
  VendorReview,
} from '../types/vendorRate';
import type { DbService } from '../utils/serviceResolver';
import {
  extractMediumTypeFromDisplayName,
  extractMediumTypeFromServiceId,
  stripMediumTypeFromDisplayName,
} from '../utils/serviceResolver';
import { pickMaterialFromMeta, hasMeaningfulScalar } from '../utils/specMaterial';

const FILLER_TOKENS = new Set([
  'branding',
  'advertising',
  'ads',
  'ad',
  'service',
  'services',
]);

let vendorRatesCache: VendorRateRow[] = [];
let vendorRatesCacheAt = 0;
const VENDOR_RATES_CACHE_TTL_MS = 60_000;
let vendorRatesInflight: Promise<VendorRateRow[]> | null = null;

export function getVendorRatesCache(): VendorRateRow[] {
  return vendorRatesCache;
}

/** Drop in-memory vendor cache (e.g. after upload). */
export function invalidateVendorRatesCache(): void {
  vendorRatesCache = [];
  vendorRatesCacheAt = 0;
  vendorRatesInflight = null;
}

function isNaLike(value: unknown): boolean {
  if (value == null || value === '') return true;
  if (typeof value === 'string' && value.trim().toUpperCase() === 'NA') return true;
  return false;
}

function hasUsableAmount(value: unknown): boolean {
  if (isNaLike(value)) return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function pickString(...values: unknown[]): string {
  for (const v of values) {
    if (v == null) continue;
    const s = String(v).trim();
    if (!s || s.toUpperCase() === 'NA') continue;
    return s;
  }
  return '';
}

function coreTokens(name: string): string[] {
  return canonicalizeServiceName(name)
    .split(/\s+/)
    .filter((t) => t.length > 0 && !FILLER_TOKENS.has(t));
}

/** LED vs Non-LED and Lit vs Non-Lit are distinct — never fuzzy-cross-match. */
function litVariant(name: string): 'led' | 'non-led' | 'lit' | 'non-lit' | 'none' {
  const c = canonicalizeServiceName(name);
  if (/\bnon[\s-]*led\b/.test(c)) return 'non-led';
  if (/\bled\b/.test(c)) return 'led';
  if (/\bnon[\s-]*lit\b/.test(c)) return 'non-lit';
  if (/\blit\b/.test(c)) return 'lit';
  return 'none';
}

function litVariantsCompatible(a: string, b: string): boolean {
  const va = litVariant(a);
  const vb = litVariant(b);
  if (va === 'none' || vb === 'none') return true;
  // LED family
  if ((va === 'led' || va === 'non-led') && (vb === 'led' || vb === 'non-led')) {
    return va === vb;
  }
  // Lit family (bus shelter panels etc.)
  if ((va === 'lit' || va === 'non-lit') && (vb === 'lit' || vb === 'non-lit')) {
    return va === vb;
  }
  return true;
}

export function fuzzyServiceMatch(a: string, b: string): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  if (!litVariantsCompatible(a, b)) return false;

  const ca = canonicalizeServiceName(a);
  const cb = canonicalizeServiceName(b);
  if (ca === cb) return true;
  if (ca.includes(cb) || cb.includes(ca)) return true;

  const tokensA = coreTokens(a);
  const tokensB = coreTokens(b);
  if (tokensA.length === 0 || tokensB.length === 0) return false;

  const [short, long] =
    tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];

  return short.every((t) => long.includes(t));
}

function fuzzyMatchScore(medium: string, serviceName: string): number {
  if (!litVariantsCompatible(medium, serviceName)) return 0;

  const tokensM = coreTokens(medium);
  const tokensS = coreTokens(serviceName);
  if (tokensM.length === 0 || tokensS.length === 0) return 0;

  const [short, long] =
    tokensM.length <= tokensS.length ? [tokensM, tokensS] : [tokensS, tokensM];
  const matched = short.filter((t) => long.includes(t)).length;
  return matched / short.length;
}

function parseImages(meta: Record<string, unknown>): VendorImageRef[] | undefined {
  const raw = meta.images;
  if (Array.isArray(raw) && raw.length > 0) {
    const out: VendorImageRef[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const img = item as Record<string, unknown>;
      const url = pickString(img.url);
      if (!url) continue;
      out.push({
        url,
        type: pickString(img.type) || 'reference',
        pageNumber: Number(img.pageNumber) || undefined,
      });
    }
    if (out.length > 0) return out;
  }

  // Fallback single URL fields on vendor metadata
  const built: VendorImageRef[] = [];
  const ref = pickString(meta.reference_image);
  if (ref) built.push({ url: ref, type: 'reference', pageNumber: 1 });
  const rev = pickString(meta.customer_review);
  if (rev) built.push({ url: rev, type: 'review', pageNumber: 1 });
  return built.length > 0 ? built : undefined;
}

function parseReview(meta: Record<string, unknown>): VendorReview | undefined {
  const raw = meta.review;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const reviewText = pickString(r.reviewText);
  const reviewerName = pickString(r.reviewerName);
  if (!reviewText && !reviewerName) return undefined;
  return {
    reviewUrl: pickString(r.reviewUrl) || undefined,
    starCount: Number(r.starCount) || undefined,
    reviewText: reviewText || undefined,
    reviewerName: reviewerName || undefined,
  };
}

/** Normalize Supabase row — quote fields only; cost fields ignored. */
export function normalizeVendorRateRow(row: Record<string, unknown>): VendorRateRow | null {
  const meta =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : row;

  const pricingRaw = meta.pricing ?? row.pricing;
  const pricing = (
    pricingRaw && typeof pricingRaw === 'object' && !Array.isArray(pricingRaw)
      ? pricingRaw
      : {}
  ) as VendorPricingBlock;
  // Accept both snake_case and camelCase price fields from vendor metadata
  const displayUnitPricePerDay =
    pricing.display_unit_price_per_day ??
    meta.display_unit_price_per_day ??
    (pricing as { displayUnitPricePerDay?: unknown }).displayUnitPricePerDay;
  const displayPrice = pricing.display_price ?? (pricing as { displayPrice?: unknown }).displayPrice;
  const pfPrice =
    pricing.printing_and_mounting_price ??
    (pricing as { printingAndMountingPrice?: unknown }).printingAndMountingPrice;
  // Keep rank-1 identity rows even when price is 0 / NA so chat can discover
  // the medium. Quote generation still rejects non-quotable pricing later.

  // Normalize camelCase into snake_case for downstream quote builders
  if (displayUnitPricePerDay != null && pricing.display_unit_price_per_day == null) {
    pricing.display_unit_price_per_day = displayUnitPricePerDay as number | string;
  }
  if (displayPrice != null && pricing.display_price == null) {
    pricing.display_price = displayPrice as number | string;
  }
  if (pfPrice != null && pricing.printing_and_mounting_price == null) {
    pricing.printing_and_mounting_price = pfPrice as number | string;
  }

  const rankRaw = row.preferred_vendor_rank ?? meta.preferred_vendor_rank;
  const rank = Number(rankRaw);

  const terms = pickString(meta.terms);
  const images = parseImages(meta);
  const review = parseReview(meta);

  // Qty + duration: vendor top-level ONLY (never pricing.min_qty / pricing.min_days)
  const vendorMinQty = !isNaLike(meta.min_qty)
    ? (meta.min_qty as number | string)
    : !isNaLike(row.min_qty)
      ? (row.min_qty as number | string)
      : undefined;
  const vendorMinDays = !isNaLike(meta.min_days)
    ? (meta.min_days as number | string)
    : !isNaLike(row.min_days)
      ? (row.min_days as number | string)
      : !isNaLike(meta.min_duration)
        ? (meta.min_duration as number | string)
        : !isNaLike(row.min_duration)
          ? (row.min_duration as number | string)
          : undefined;
  const vendorQtyUnit =
    pickString(meta.qty_measurement_unit, row.qty_measurement_unit) || undefined;

  // Medium type discriminator (elevated / underground / …)
  let mediumType =
    pickString(
      meta.medium_type,
      row.medium_type,
      meta.mediumType,
      meta.type_of_medium,
      meta.subtype,
      meta.sub_type,
    ) || undefined;
  if (!mediumType) {
    const structure = pickString(meta.structure, pricing.structure);
    const m = structure.match(/\b(elevated|underground|interior|inside|outside|wrap|platform|lobby)\b/i);
    if (m) mediumType = m[1];
  }
  if (mediumType && mediumType.toUpperCase() === 'NA') mediumType = undefined;

  const specifications =
    meta.specifications && typeof meta.specifications === 'object' && !Array.isArray(meta.specifications)
      ? (meta.specifications as Record<string, unknown>)
      : undefined;
  const size =
    meta.size != null && String(meta.size).trim() !== '' && String(meta.size).toUpperCase() !== 'NA'
      ? (meta.size as string | Record<string, unknown>)
      : undefined;
  // Prefer material / materials from DB; omit when missing, empty, or NA
  const material = pickMaterialFromMeta(meta as Record<string, unknown>);
  const pickDim = (...keys: string[]): string | number | undefined => {
    for (const k of keys) {
      const v = meta[k] ?? row[k];
      if (hasMeaningfulScalar(v) && (typeof v === 'string' || typeof v === 'number')) {
        return typeof v === 'string' ? v.trim() : v;
      }
    }
    return undefined;
  };
  const displayWidth = pickDim('display_width', 'width');
  const displayHeight = pickDim('display_height', 'height');
  const displayLength = pickDim('display_length', 'length');
  const referenceImage = pickString(meta.reference_image) || undefined;
  const customerReview = pickString(meta.customer_review) || undefined;
  // Unique site id from DB column / metadata (keeps each hoarding area separate)
  const serviceId =
    pickString(row.service_id, meta.service_id) || undefined;
  const directionRemarks =
    pickString(meta.direction_remarks, row.direction_remarks) || undefined;
  const areaName = pickString(meta.area_name, row.area_name) || undefined;

  const pickCost = (...keys: string[]): number | string | undefined => {
    for (const k of keys) {
      const v = meta[k] ?? row[k] ?? (pricing as Record<string, unknown>)[k];
      if (isNaLike(v)) continue;
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
      if (typeof v === 'string') {
        const cleaned = v
          .trim()
          .replace(/,/g, '')
          .replace(/^₹\s*/u, '')
          .replace(/^Rs\.?\s*/i, '')
          .trim();
        if (isNaLike(cleaned)) continue;
        const n = Number(cleaned);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
    return undefined;
  };

  const medium = pickString(meta.medium, row.medium, meta.medium_name, row.medium_name);
  const serviceName = pickString(row.service_name, meta.service_name);
  if (!medium && !serviceId && !serviceName) return null;

  return {
    medium,
    city: pickString(meta.city, row.city).toLowerCase(),
    vendor_name: pickString(meta.vendor_name, row.vendor_name) || undefined,
    service_id: serviceId,
    // MEDIUM ID from admin UI may be rate_key or medium_id (never row UUID)
    rate_key:
      pickString(meta.rate_key, row.rate_key, meta.medium_id, row.medium_id) ||
      undefined,
    medium_type: mediumType,
    preferred_vendor_rank: Number.isFinite(rank) ? rank : undefined,
    pricing,
    terms: terms || undefined,
    images,
    review,
    lead_time_days: isNaLike(meta.lead_time_days) ? undefined : meta.lead_time_days as number | string,
    qty_measurement_unit: vendorQtyUnit,
    min_qty: vendorMinQty,
    min_days: vendorMinDays,
    // Legacy alias for older readers while rows migrate
    min_duration: vendorMinDays,
    direction_remarks: directionRemarks,
    area_name: areaName,
    specifications,
    size,
    material,
    display_width: displayWidth,
    display_height: displayHeight,
    display_length: displayLength,
    reference_image: referenceImage,
    customer_review: customerReview,
    display_unit_cost_per_day: pickCost('display_unit_cost_per_day'),
    display_cost: pickCost('display_cost'),
    display_cost_measurement_unit:
      pickString(meta.display_cost_measurement_unit, row.display_cost_measurement_unit) || undefined,
    printing_cost: pickCost('printing_cost', 'printingCost'),
    mounting_cost: pickCost('mounting_cost', 'fixing_cost', 'mountingCost', 'fixingCost'),
    printing_and_mounting_cost: pickCost(
      'printing_and_mounting_cost',
      'printingAndMountingCost',
      'printing_mounting_cost',
      'production_cost',
      'pf_cost',
      'unit_cost',
      'total_unit_cost',
    ),
    display_unit_price_per_day: pickCost('display_unit_price_per_day'),
  };
}

export async function loadVendorRatesFromCloud(): Promise<VendorRateRow[]> {
  const now = Date.now();
  if (
    vendorRatesCache.length > 0
    && now - vendorRatesCacheAt < VENDOR_RATES_CACHE_TTL_MS
  ) {
    return vendorRatesCache;
  }
  if (vendorRatesInflight) return vendorRatesInflight;

  vendorRatesInflight = (async () => {
    try {
      let data: Record<string, unknown>[] | null = null;
      let error: { message: string } | null = null;

      const ranked = await supabase
        .from('vendor_rate_chunks')
        .select('*')
        .eq('preferred_vendor_rank', 1);

      if (ranked.error) {
        console.warn(
          '⚠️ [vendor_rate_chunks] Rank filter failed, loading all then filtering client-side:',
          ranked.error.message,
        );
        const all = await supabase.from('vendor_rate_chunks').select('*');
        data = (all.data || []) as Record<string, unknown>[];
        error = all.error;
      } else {
        data = (ranked.data || []) as Record<string, unknown>[];
      }

      if (error) {
        console.warn(
          '⚠️ [vendor_rate_chunks] Unavailable — full fallback to proposal_chunks:',
          error.message,
        );
        vendorRatesCache = [];
        vendorRatesCacheAt = 0;
        return [];
      }

      const rank1Rows = (data || []).filter((row) => {
        const rank = Number(
          row.preferred_vendor_rank ??
            (row.metadata as Record<string, unknown> | undefined)?.preferred_vendor_rank,
        );
        if (!Number.isFinite(rank)) return true;
        return rank === 1;
      });

      const rows = rank1Rows
        .map((row) => normalizeVendorRateRow(row))
        .filter((r): r is VendorRateRow => r != null)
        .map(sanitizeVendorPipeFields);

      vendorRatesCache = rows;
      vendorRatesCacheAt = Date.now();
      console.log(
        `💰 [vendor_rate_chunks] Rank=1: ${rank1Rows.length}; catalog: ${rows.length}` +
          (rank1Rows.length > rows.length
            ? ` (${rank1Rows.length - rows.length} skipped — no medium/service identity)`
            : ''),
      );
      return rows;
    } catch (err) {
      console.warn('⚠️ [vendor_rate_chunks] Load failed — full fallback to proposal_chunks:', err);
      vendorRatesCache = [];
      vendorRatesCacheAt = 0;
      return [];
    } finally {
      vendorRatesInflight = null;
    }
  })();

  return vendorRatesInflight;
}

function citiesMatch(a: string, b: string): boolean {
  const x = a.toLowerCase().replace(/\s+/g, ' ').trim();
  const y = b.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!x || !y) return false;
  return x === y;
}

function vendorRateHasUsablePricing(row: VendorRateRow): boolean {
  const pricing = row.pricing || {};
  return [
    pricing.display_price,
    pricing.printing_and_mounting_price,
    pricing.total_price,
  ].some((value) => Number(value) > 0);
}

/**
 * Select one vendor deterministically when the database contains duplicate
 * rank-1 rows for the same service/site. Rank remains the primary rule;
 * completeness and stable vendor identity only resolve ties.
 */
function compareVendorRatePreference(a: VendorRateRow, b: VendorRateRow): number {
  const rankA = Number.isFinite(Number(a.preferred_vendor_rank))
    ? Number(a.preferred_vendor_rank)
    : Number.MAX_SAFE_INTEGER;
  const rankB = Number.isFinite(Number(b.preferred_vendor_rank))
    ? Number(b.preferred_vendor_rank)
    : Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) return rankA - rankB;

  const usableA = vendorRateHasUsablePricing(a);
  const usableB = vendorRateHasUsablePricing(b);
  if (usableA !== usableB) return usableA ? -1 : 1;

  const vendorA = (a.vendor_name || '').trim().toLowerCase();
  const vendorB = (b.vendor_name || '').trim().toLowerCase();
  const vendorCompare = vendorA.localeCompare(vendorB);
  if (vendorCompare !== 0) return vendorCompare;

  return (a.rate_key || '').localeCompare(b.rate_key || '');
}

function pickPreferredVendorRate(rows: VendorRateRow[]): VendorRateRow {
  if (rows.length === 0) {
    throw new Error('Cannot select a preferred vendor from an empty list');
  }
  return [...rows].sort(compareVendorRatePreference)[0];
}

/** Resolve full preferred vendor row (or null → keep all proposal_chunks data). */
export function resolveVendorRateRow(
  serviceName: string,
  cityHint: string | null | undefined,
  rates: VendorRateRow[] = vendorRatesCache,
  serviceId?: string | null,
): VendorRateRow | null {
  if ((!serviceName?.trim() && !serviceId?.trim()) || rates.length === 0) return null;

  const city = cityHint?.toLowerCase().trim() || '';
  const mediumHint =
    extractMediumTypeFromServiceId(serviceId || '', serviceName) ||
    extractMediumTypeFromDisplayName(serviceName);
  const baseName = stripMediumTypeFromDisplayName(serviceName) || serviceName;
  // Include service_id tokens so truncated names (e.g. "NON I") still match non-lit / single-panel keys
  const matchLabel = [baseName, (serviceId || '').replace(/-/g, ' ')].filter(Boolean).join(' ');

  // Prefer exact DB service_id match (unique per site — never collapse areas)
  if (serviceId?.trim()) {
    const sid = serviceId.toLowerCase().trim();
    const byServiceId = rates.filter(
      (r) => (r.service_id || '').toLowerCase().trim() === sid,
    );
    if (byServiceId.length === 1) {
      console.log(
        `💰 [VendorMatch] service_id "${sid}" → ${byServiceId[0].vendor_name || 'unknown'} (${byServiceId[0].direction_remarks || byServiceId[0].rate_key || 'ok'})`,
      );
      return byServiceId[0];
    }
    if (byServiceId.length > 1) {
      console.warn(
        `⚠️ [VendorMatch] Duplicate service_id "${sid}" (${byServiceId.length} rows) — selecting preferred row`,
      );
      return pickPreferredVendorRate(byServiceId);
    }

    // Fallback: rate_key / medium_id match (legacy cleaned keys)
    const byKey = rates.filter((r) => {
      const key = (r.rate_key || '').toLowerCase();
      if (!key) return false;
      return key === sid || key.startsWith(sid) || sid.startsWith(key) || key.includes(sid) || sid.includes(key);
    });
    // When a city is supplied, never fall back to a rate from another city.
    const keyPool = city
      ? byKey.filter((r) => citiesMatch(r.city, city))
      : byKey;
    if (keyPool.length >= 1) {
      const chosen = pickPreferredVendorRate(keyPool);
      console.log(
        `💰 [VendorMatch] rate_key~service_id "${sid}" → ${chosen.vendor_name || 'unknown'} (${chosen.rate_key})`,
      );
      return chosen;
    }
  }

  // Also try expected slug: {service-kebab}-{city}
  if (baseName?.trim() && city) {
    const expectedKey = `${baseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')}-${city}`;
    const byExpected = rates.filter((r) => (r.rate_key || '').toLowerCase() === expectedKey);
    if (byExpected.length >= 1) {
      console.log(
        `💰 [VendorMatch] expected rate_key "${expectedKey}" → ${byExpected[0].vendor_name || 'unknown'}`,
      );
      return byExpected[0];
    }
  }

  let matches = rates.filter(
    (r) =>
      fuzzyServiceMatch(r.medium, matchLabel) ||
      fuzzyServiceMatch((r.rate_key || '').replace(/-/g, ' '), matchLabel),
  );

  if (city) {
    // A requested city with no exact match must remain unresolved.
    matches = matches.filter((r) => citiesMatch(r.city, city));
  }

  // Prefer vendor rows whose medium / rate_key encodes the same medium type
  if (mediumHint && matches.length > 1) {
    const mediumCanon = canonicalizeServiceName(mediumHint);
    const typed = matches.filter((r) => {
      const hay = `${r.medium || ''} ${r.rate_key || ''}`.toLowerCase();
      return hay.includes(mediumCanon) || canonicalizeServiceName(r.medium || '').includes(mediumCanon);
    });
    if (typed.length > 0) matches = typed;
  }

  // Avoid polluted vendor medium labels when cleaner matches exist
  if (matches.length > 1) {
    const clean = matches.filter((r) => !/cost-|\s·\s|#\d+/i.test(r.medium || ''));
    if (clean.length > 0) matches = clean;
  }

  if (matches.length === 0) {
    console.log(
      `💰 [VendorMatch] No rank=1 vendor for "${serviceName}" @ ${city || 'any'} — no vendor pricing`,
    );
    return null;
  }

  if (matches.length > 1) {
    matches = [...matches].sort((a, b) => {
      const scoreDiff =
        fuzzyMatchScore(b.medium, matchLabel) - fuzzyMatchScore(a.medium, matchLabel);
      if (scoreDiff !== 0) return scoreDiff;
      return compareVendorRatePreference(a, b);
    });
  }

  const chosen = matches[0];
  console.log(
    `💰 [VendorMatch] "${serviceName}" @ ${city || 'any'} → ` +
      `"${chosen.medium}" / ${chosen.vendor_name || 'unknown'} ` +
      `display=${chosen.pricing?.display_price} ` +
      `terms=${chosen.terms ? 'vendor' : 'proposal'} ` +
      `images=${chosen.images?.length ?? 0} ` +
      `review=${chosen.review ? 'vendor' : 'proposal'}`,
  );

  return chosen;
}

/** @deprecated Use resolveVendorRateRow — kept for callers that only need pricing. */
export function resolveVendorPricing(
  serviceName: string,
  cityHint: string | null | undefined,
  rates: VendorRateRow[] = vendorRatesCache,
): VendorPricingBlock | null {
  return resolveVendorRateRow(serviceName, cityHint, rates)?.pricing ?? null;
}

const DB_VENDOR = 'vendor_rate_chunks';
const DB_PROPOSAL = 'proposal_chunks';

/** Strip qty/duration from pricing so quote logic never reads pricing.min_qty / min_days. */
function pricingRatesOnly(pricing: VendorPricingBlock): VendorPricingBlock {
  const {
    min_qty: _mq,
    min_duration: _md,
    min_days: _mdays,
    duration_measurement_unit: _du,
    qty_measurement_unit: _qu,
    ...rates
  } = pricing as VendorPricingBlock & { min_quantity?: unknown };
  delete (rates as Record<string, unknown>).min_quantity;
  return rates;
}

/**
 * Apply vendor quote fields onto a service.
 * - pricing rates: display + P&F from vendor_rate_chunks
 * - min_qty / min_days: vendor top-level ONLY (never pricing.*)
 * - cost fields: never copied
 */
export function applyVendorDetailsToService(svc: DbService, vendor: VendorRateRow): DbService {
  const pricing = vendor.pricing;
  if (!pricing) return stripProposalPricing(svc);

  const meta = { ...(svc.metadata || {}) } as Record<string, unknown>;
  const sources: Record<string, string> = {};

  // Rates only — strip pricing.min_qty / pricing.min_days
  meta.pricing = pricingRatesOnly(pricing);
  if (vendor.medium) {
    meta.medium = vendor.medium;
  }
  sources.pricing = DB_VENDOR;
  sources.display_price = `${DB_VENDOR} (${pricing.display_price ?? 'NA'})`;
  sources.printing_and_mounting_price = `${DB_VENDOR} (${pricing.printing_and_mounting_price ?? 'NA'})`;
  sources.official_and_incidental_price = `${DB_VENDOR} (${pricing.official_and_incidental_price ?? 'NA'})`;

  // Qty: vendor top-level only — no pricing fallback
  if (vendor.min_qty != null && !isNaLike(vendor.min_qty)) {
    meta.min_quantity = vendor.min_qty;
    meta.min_qty = vendor.min_qty;
    sources.min_qty = `${DB_VENDOR} vendor (${vendor.min_qty})`;
  } else {
    delete meta.min_quantity;
    delete meta.min_qty;
    sources.min_qty = 'none (vendor top-level only)';
  }

  // Duration days: vendor top-level only — no pricing / duration_measurement_unit
  const minDays = vendor.min_days ?? vendor.min_duration;
  if (minDays != null && !isNaLike(minDays)) {
    meta.min_days = minDays;
    meta.min_duration = minDays; // legacy alias
    meta.duration = `${minDays} days`;
    sources.min_days = `${DB_VENDOR} vendor (${minDays})`;
  } else {
    delete meta.min_days;
    delete meta.min_duration;
    delete meta.duration;
    sources.min_days = 'none (vendor top-level only)';
  }
  delete meta.duration_measurement_unit;
  sources.duration_unit = 'days (fixed)';

  // Qty unit: vendor top-level only (raw unit for Qty column, e.g. "bus" not "per bus")
  if (vendor.qty_measurement_unit && !isNaLike(vendor.qty_measurement_unit)) {
    meta.qty_measurement_unit = String(vendor.qty_measurement_unit).trim();
    meta.unit_label = String(vendor.qty_measurement_unit).trim().replace(/^per\s+/i, '');
    sources.unit_label = DB_VENDOR;
  } else {
    delete meta.qty_measurement_unit;
    sources.unit_label = 'none (vendor top-level only)';
  }

  // Remaining: vendor if present, else keep proposal_chunks
  if (vendor.terms) {
    meta.terms = vendor.terms;
    sources.terms = DB_VENDOR;
  } else {
    sources.terms = meta.terms ? DB_PROPOSAL : 'none';
  }

  if (vendor.images && vendor.images.length > 0) {
    meta.images = vendor.images;
    sources.images = `${DB_VENDOR} (${vendor.images.length})`;
  } else {
    const existing = Array.isArray(meta.images) ? meta.images.length : 0;
    sources.images = existing > 0 ? `${DB_PROPOSAL} (${existing})` : 'none';
  }

  if (vendor.review) {
    meta.review = vendor.review;
    sources.review = DB_VENDOR;
  } else {
    sources.review = meta.review ? DB_PROPOSAL : 'none';
  }

  if (vendor.lead_time_days != null && !isNaLike(vendor.lead_time_days)) {
    meta.lead_time_days = vendor.lead_time_days;
    sources.lead_time_days = DB_VENDOR;
  } else {
    sources.lead_time_days = meta.lead_time_days != null ? DB_PROPOSAL : 'none';
  }

  if (vendor.city) {
    const locs = Array.isArray(meta.locations) ? [...(meta.locations as string[])] : [];
    const cityLabel = vendor.city.charAt(0).toUpperCase() + vendor.city.slice(1);
    if (!locs.some((l) => String(l).toLowerCase().includes(vendor.city))) {
      locs.unshift(cityLabel);
    }
    meta.locations = locs;
    sources.city = DB_VENDOR;
  }

  console.log(
    `📦 [DataSource] "${svc.service_name}" (${svc.service_id})`,
    {
      vendor: vendor.vendor_name || 'unknown',
      medium: vendor.medium,
      city: vendor.city,
      sources,
    },
  );

  return {
    ...svc,
    metadata: meta,
  };
}

/**
 * Remove proposal_chunks pricing so quote cannot fall back to old rates.
 * Terms / images / review on the service are left intact.
 */
export function stripProposalPricing(svc: DbService): DbService {
  const meta = { ...(svc.metadata || {}) } as Record<string, unknown>;
  // OLD proposal_chunks.metadata.pricing — blocked for quote generation
  delete meta.pricing;
  console.log(
    `📦 [DataSource] "${svc.service_name}" — pricing cleared (vendor_rate_chunks required; proposal_chunks pricing disabled)`,
  );
  return { ...svc, metadata: meta };
}

/** @deprecated Prefer applyVendorDetailsToService with full vendor row. */
export function applyVendorPricingToService(
  svc: DbService,
  pricing: VendorPricingBlock,
): DbService {
  return applyVendorDetailsToService(svc, { medium: '', city: '', pricing });
}

const VENDOR_CITY_KEYS = [
  'chennai', 'madurai', 'coimbatore', 'salem', 'trichy', 'tiruchirappalli',
  'erode', 'tirunelveli', 'tenkasi', 'vellore', 'thanjavur', 'tiruppur', 'hosur',
  'bangalore', 'bengaluru', 'mumbai', 'delhi', 'hyderabad', 'pune', 'kolkata',
];

function isPipeNaSeg(s: string): boolean {
  const t = s.trim();
  return !t || t.toUpperCase() === 'NA';
}

/**
 * Parse composite vendor keys shaped like:
 * "bus shelter – double panel – lit|skyrams|chennai|na|na|na|na|na|1|shelter|na|na|na|30|days"
 */
function parsePipeDelimitedVendorKey(raw: string): {
  serviceName: string;
  vendorName?: string;
  city?: string;
  minQty?: string;
  qtyUnit?: string;
  minDuration?: string;
  durationUnit?: string;
  cleanRateKey: string;
} | null {
  if (!raw.includes('|')) return null;
  const parts = raw.split('|').map((p) => p.trim());
  const serviceName = parts[0];
  if (!serviceName || isPipeNaSeg(serviceName)) return null;

  const vendorName =
    parts[1] && !isPipeNaSeg(parts[1]) ? parts[1].trim() : undefined;

  let city: string | undefined;
  for (const p of parts) {
    const lower = p.toLowerCase();
    if (VENDOR_CITY_KEYS.includes(lower)) {
      city = lower;
      break;
    }
  }

  let minQty: string | undefined;
  let qtyUnit: string | undefined;
  let minDuration: string | undefined;
  let durationUnit: string | undefined;

  for (let i = 2; i < parts.length; i++) {
    if (isPipeNaSeg(parts[i]) || !/^\d+(\.\d+)?$/.test(parts[i])) continue;
    const next = parts[i + 1];
    if (!next || isPipeNaSeg(next)) continue;
    if (/^days?$/i.test(next)) {
      minDuration = parts[i];
      durationUnit = next.toLowerCase().startsWith('day') ? 'days' : next;
      continue;
    }
    if (
      !minQty &&
      !/^\d+$/.test(next) &&
      !VENDOR_CITY_KEYS.includes(next.toLowerCase())
    ) {
      minQty = parts[i];
      qtyUnit = next;
    }
  }

  const nameSlug = serviceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const cleanRateKey = city ? `${nameSlug}-${city}` : nameSlug;

  return {
    serviceName,
    vendorName,
    city,
    minQty,
    qtyUnit,
    minDuration,
    durationUnit,
    cleanRateKey,
  };
}

/** Normalize medium_type for slug / label (elevated, underground, …). */
function normalizeMediumTypeToken(raw?: string): string {
  if (!raw?.trim()) return '';
  const t = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!t || t === 'na') return '';
  return t;
}

function titleCaseMediumType(raw: string): string {
  return raw
    .split(/[\s\-_/]+/)
    .filter(Boolean)
    .map((w) => {
      const lower = w.toLowerCase();
      if (lower === 'led' || lower === 'lcd' || lower === 'oled') return lower.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

/** Strip pipe-dump keys into clean medium / rate_key / city / vendor fields. */
function sanitizeVendorPipeFields(v: VendorRateRow): VendorRateRow {
  const typeSlug = normalizeMediumTypeToken(v.medium_type);
  const pipeSource =
    (v.rate_key && v.rate_key.includes('|') && v.rate_key) ||
    (v.medium && v.medium.includes('|') && v.medium) ||
    '';
  const parsed = pipeSource ? parsePipeDelimitedVendorKey(pipeSource) : null;
  if (!parsed) {
    // Still strip accidental leading name-only pollution
    let medium = v.medium;
    if (medium && medium.includes('|')) {
      medium = medium.split('|')[0].trim();
    }
    // Bake medium_type into rate_key when missing from id
    let rateKey = v.rate_key;
    if (typeSlug && rateKey && !rateKey.includes('|') && !rateKey.toLowerCase().includes(typeSlug)) {
      const city = cityFromRateKey(rateKey) || v.city || '';
      let base = rateKey.toLowerCase();
      if (city && base.endsWith(`-${city}`)) {
        base = base.slice(0, -(city.length + 1));
      }
      rateKey = city ? `${base}-${typeSlug}-${city}` : `${base}-${typeSlug}`;
    }
    return { ...v, medium, rate_key: rateKey, medium_type: typeSlug || v.medium_type };
  }

  let cleanRateKey = parsed.cleanRateKey;
  if (typeSlug && !cleanRateKey.toLowerCase().includes(typeSlug)) {
    const city = parsed.city || v.city || '';
    const nameSlug = parsed.serviceName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    cleanRateKey = city
      ? `${nameSlug}-${typeSlug}-${city}`
      : `${nameSlug}-${typeSlug}`;
  }

  return {
    ...v,
    medium: parsed.serviceName,
    rate_key: cleanRateKey,
    medium_type: typeSlug || v.medium_type,
    city: v.city || parsed.city || '',
    vendor_name: v.vendor_name || parsed.vendorName,
    min_qty: v.min_qty ?? parsed.minQty,
    qty_measurement_unit: v.qty_measurement_unit,
    min_days: v.min_days ?? v.min_duration ?? parsed.minDuration,
    min_duration: v.min_days ?? v.min_duration ?? parsed.minDuration,
  };
}

function cityHintFromService(svc: DbService): string | null {
  const locs: string[] = svc.metadata?.locations || [];
  if (locs[0]) return locs[0].toLowerCase();

  const metaCity = (svc.metadata as { city?: string } | undefined)?.city;
  if (metaCity) return String(metaCity).toLowerCase();

  const sid = (svc.service_id || '').toLowerCase();
  const cities = [...VENDOR_CITY_KEYS].sort((a, b) => b.length - a.length);
  for (const city of cities) {
    if (sid.endsWith(`-${city}`)) return city;
  }

  const doc = (svc.document_name || '').toLowerCase();
  if (doc) {
    const base = doc.replace(/\.(pdf|xlsx?|jpeg|jpg|png)$/i, '');
    const part = base.split(/[_\-\s]+/)[0];
    if (part && part.length >= 3) return part;
  }

  return null;
}

export function mergeVendorPricingIntoServices(
  services: DbService[],
  rates: VendorRateRow[] = vendorRatesCache,
): DbService[] {
  if (!rates.length) {
    console.log(
      `📦 [DataSource] No vendor_rate_chunks rows — stripping proposal_chunks pricing on all services`,
    );
    // OLD: return services (would keep proposal_chunks pricing)
    return services.map(stripProposalPricing);
  }

  return services.map((svc) => {
    const city = cityHintFromService(svc);
    const vendor = resolveVendorRateRow(svc.service_name, city, rates, svc.service_id);
    if (!vendor) {
      // OLD: return svc with proposal_chunks.pricing — disabled
      console.log(
        `📦 [DataSource] "${svc.service_name}" @ ${city || 'any'} → no vendor pricing (error if quoted)`,
      );
      return stripProposalPricing(svc);
    }
    return applyVendorDetailsToService(svc, vendor);
  });
}

export function applyVendorPricingForQuoteRow(
  svc: DbService,
  serviceName: string,
  cityHint: string | null | undefined,
  rates: VendorRateRow[] = vendorRatesCache,
): DbService {
  // Catalog already built from vendor_rate_chunks — keep pricing if already quotable
  const existingPricing = svc.metadata?.pricing;
  if (existingPricing && typeof existingPricing === 'object') {
    const p = existingPricing as Record<string, unknown>;
    const has =
      hasUsableAmount(p.display_price) ||
      hasUsableAmount(p.printing_and_mounting_price) ||
      hasUsableAmount(p.total_price);
    if (has) return svc;
  }

  const vendor = resolveVendorRateRow(
    serviceName,
    cityHint,
    rates,
    svc.service_id,
  );
  if (!vendor) {
    console.log(
      `📦 [DataSource] Quote row "${serviceName}" @ ${cityHint || 'any'} → ERROR path (no vendor_rate_chunks pricing)`,
    );
    return stripProposalPricing(svc);
  }
  return applyVendorDetailsToService(svc, vendor);
}

/** Pull trailing city slug from medium id e.g. bus-shelter-single-panel-non-lit-chennai */
function cityFromRateKey(rateKey: string): string {
  const sid = rateKey.toLowerCase();
  const cities = [...VENDOR_CITY_KEYS].sort((a, b) => b.length - a.length);
  for (const city of cities) {
    if (sid.endsWith(`-${city}`)) return city;
  }
  return '';
}

/** True when vendor medium text looks polluted (NA / cost / specs junk). */
function isPollutedMediumLabel(raw: string): boolean {
  const s = raw.trim();
  if (!s) return true;
  if (s.length > 60) return true;
  if (/cost-|\s·\s|#\d+/i.test(s)) return true;
  if (/\bna\b/i.test(s)) return true;
  if (/naxna|single\s*window|min\s*\d+|90\s*days/i.test(s)) return true;
  // Too many tokens usually means concatenated metadata
  if (s.split(/[\s–—\-]+/).filter(Boolean).length > 8) return true;
  return false;
}

/** Title-case words from a kebab / spaced slug. */
function titleCaseWords(parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((w) => {
      const lower = w.toLowerCase();
      if (lower === 'led' || lower === 'lcd' || lower === 'oled') return lower.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Clean UI label: prefer medium name + type + site location.
 * Never show polluted vendor medium text (NA / cost / vendor junk / pipe dumps).
 * Appends medium_type and direction_remarks when present so each site is distinct.
 */
function displayNameFromVendor(v: VendorRateRow): string {
  const rateKey = (v.rate_key || '').trim();
  let rawMedium = (v.medium || '').trim();
  // Pipe dump safety: "name|vendor|city|na|..." → name only
  if (rawMedium.includes('|')) rawMedium = rawMedium.split('|')[0].trim();
  if (rateKey.includes('|')) {
    const parsed = parsePipeDelimitedVendorKey(rateKey);
    if (parsed?.serviceName) {
      rawMedium = parsed.serviceName;
    }
  }

  let base = '';

  // 1) Prefer clean medium field (short product name)
  if (rawMedium && !isPollutedMediumLabel(rawMedium)) {
    base = titleCaseWords(rawMedium.split(/[\s–—\-/]+/));
  }

  // 2) Fallback: clean rate_key / medium-id slug (kebab) — strip city + type suffixes
  if (!base) {
    const slugSource =
      (rateKey && !rateKey.includes('|') ? rateKey : '') ||
      (/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(rawMedium) ? rawMedium : '');

    if (slugSource) {
      let slug = slugSource.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const city = cityFromRateKey(slug);
      if (city) slug = slug.slice(0, -(city.length + 1));
      const typeSlug = normalizeMediumTypeToken(v.medium_type);
      if (typeSlug && slug.endsWith(`-${typeSlug}`)) {
        slug = slug.slice(0, -(typeSlug.length + 1));
      }
      // Drop trailing direction/area fragments (towards-*, flyover, road tokens after first 1–3 words)
      const parts = slug.split('-').filter(Boolean);
      const cutAt = parts.findIndex((p, i) =>
        i > 0 && /^(towards|near|flyover|opp|opposite|junction)$/i.test(p),
      );
      const keep = cutAt >= 0 ? parts.slice(0, cutAt) : parts.slice(0, Math.min(parts.length, 4));
      base = titleCaseWords(keep.length ? keep : parts);
    }
  }

  if (!base) base = 'Service';

  const typeSlug = normalizeMediumTypeToken(v.medium_type);
  let label = base;
  if (typeSlug) {
    const typeLabel = titleCaseMediumType(typeSlug.replace(/-/g, ' '));
    if (!canonicalizeServiceName(base).includes(canonicalizeServiceName(typeLabel))) {
      label = `${base} — ${typeLabel}`;
    }
  }

  // Do NOT append area/direction here — those belong in structured PDF headings only.
  // (Appending them caused "Hoarding … — Area · Dir — Hoarding City Dir" duplicates.)
  return label;
}

/**
 * Build quote catalog directly from vendor_rate_chunks (rank=1 usable rows).
 * Does NOT read proposal_chunks.
 * One catalog entry per DB service_id (unique site) — never collapse on city/medium.
 */
export function vendorRatesToDbServices(
  rates: VendorRateRow[] = vendorRatesCache,
): DbService[] {
  const byKey = new Map<string, DbService>();

  rates.forEach((v, idx) => {
    const cleaned = sanitizeVendorPipeFields(v);
    const rateKey =
      (cleaned.rate_key || '').trim() ||
      (/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test((cleaned.medium || '').trim())
        ? (cleaned.medium || '').trim()
        : '');
    const city = (cleaned.city || cityFromRateKey(rateKey) || '').toLowerCase();
    const displayName = displayNameFromVendor({ ...cleaned, rate_key: rateKey || cleaned.rate_key });
    const mediumSlug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const citySlug = city.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'na';
    // Prefer unique DB service_id so every area/towards site stays separate
    const dbServiceId = (cleaned.service_id || '').trim();
    const serviceId =
      dbServiceId ||
      (rateKey && !rateKey.includes('|') ? rateKey : '') ||
      `${mediumSlug}-${citySlug}-${idx}` ||
      `vendor-${idx}`;

    // Rates only — strip pricing.min_qty / pricing.min_days
    const {
      min_qty: _pq,
      min_duration: _pd,
      min_days: _pdays,
      duration_measurement_unit: _pdu,
      qty_measurement_unit: _pqu,
      ...pricingRates
    } = (cleaned.pricing || {}) as Record<string, unknown>;
    delete pricingRates.min_quantity;

    const cityLabel = city ? city.charAt(0).toUpperCase() + city.slice(1) : undefined;

    const minQtyNum =
      cleaned.min_qty != null && !Number.isNaN(Number(cleaned.min_qty))
        ? Number(cleaned.min_qty)
        : undefined;

    const minDays = cleaned.min_days ?? cleaned.min_duration;

    const svc: DbService = {
      service_id: serviceId,
      service_name: displayName,
      content: displayName,
      document_name: cleaned.vendor_name || 'vendor_rate_chunks',
      metadata: {
        pricing: pricingRates,
        terms: cleaned.terms,
        images: cleaned.images || [],
        review: cleaned.review,
        locations: cityLabel ? [cityLabel] : [],
        medium: cleaned.medium,
        medium_type: cleaned.medium_type,
        city: cleaned.city || city,
        vendor_name: cleaned.vendor_name,
        preferred_vendor_rank: cleaned.preferred_vendor_rank ?? 1,
        min_quantity: minQtyNum,
        min_qty: cleaned.min_qty,
        min_days: minDays,
        min_duration: minDays,
        duration:
          minDays != null ? `${minDays} days` : undefined,
        qty_measurement_unit: cleaned.qty_measurement_unit,
        lead_time_days: cleaned.lead_time_days,
        unit_label: cleaned.qty_measurement_unit
          ? String(cleaned.qty_measurement_unit).trim().replace(/^per\s+/i, '')
          : undefined,
        direction_remarks: cleaned.direction_remarks,
        area_name: cleaned.area_name,
        // PDF / Display Specification — from vendor_rate_chunks.metadata
        specifications: cleaned.specifications,
        size: cleaned.size,
        material: cleaned.material,
        display_width: cleaned.display_width,
        display_height: cleaned.display_height,
        display_length: cleaned.display_length,
        reference_image: cleaned.reference_image,
        customer_review: cleaned.customer_review,
        // Cost fields for 4% margin checks
        display_unit_cost_per_day: cleaned.display_unit_cost_per_day,
        display_cost: cleaned.display_cost,
        display_cost_measurement_unit: cleaned.display_cost_measurement_unit,
        printing_cost: cleaned.printing_cost,
        mounting_cost: cleaned.mounting_cost,
        printing_and_mounting_cost: cleaned.printing_and_mounting_cost,
        display_unit_price_per_day: cleaned.display_unit_price_per_day,
      } as DbService['metadata'],
    };

    // One row per unique DB service_id
    const mapKey = serviceId.toLowerCase();
    const existing = byKey.get(mapKey);
    if (!existing) {
      byKey.set(mapKey, svc);
      return;
    }
    // Resolve duplicate service_id rows deterministically. The database normally
    // assigns one preferred rank, but duplicate rank-1 rows must not make the
    // quote depend on query order.
    const prevPricing = (existing.metadata?.pricing || {}) as Record<string, unknown>;
    const nextPricing = (svc.metadata?.pricing || {}) as Record<string, unknown>;
    const prevMeta = (existing.metadata || {}) as Record<string, unknown>;
    const nextMeta = (svc.metadata || {}) as Record<string, unknown>;
    const prevRank = Number(prevMeta.preferred_vendor_rank);
    const nextRank = Number(nextMeta.preferred_vendor_rank);
    const prevPrice =
      Number(prevPricing.display_unit_price_per_day) ||
      Number(prevMeta.display_unit_price_per_day) ||
      Number(prevPricing.display_price) ||
      0;
    const nextPrice =
      Number(nextPricing.display_unit_price_per_day) ||
      Number(nextMeta.display_unit_price_per_day) ||
      Number(nextPricing.display_price) ||
      0;
    const prevVendor = String(prevMeta.vendor_name || '').trim().toLowerCase();
    const nextVendor = String(nextMeta.vendor_name || '').trim().toLowerCase();
    const preferNext =
      (Number.isFinite(nextRank) && !Number.isFinite(prevRank)) ||
      (Number.isFinite(nextRank) &&
        Number.isFinite(prevRank) &&
        nextRank < prevRank) ||
      ((nextRank === prevRank || (!Number.isFinite(nextRank) && !Number.isFinite(prevRank))) &&
        nextPrice > 0 &&
        prevPrice <= 0) ||
      ((nextRank === prevRank || (!Number.isFinite(nextRank) && !Number.isFinite(prevRank))) &&
        nextPrice > 0 &&
        prevPrice > 0 &&
        nextVendor.localeCompare(prevVendor) < 0);
    if (preferNext) {
      byKey.set(mapKey, svc);
    }
  });

  const services = [...byKey.values()];
  console.log(
    `📦 [vendorRatesToDbServices] Built ${services.length} catalog services from vendor_rate_chunks (keyed by service_id)`,
  );
  return services;
}
