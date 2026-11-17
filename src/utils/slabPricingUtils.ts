/**
 * Multi-rate slab catalogs (Theatre Screen Ad).
 * Additive path — standard Display + P&F media is unchanged.
 */

import type { QuoteItem } from '../types/quote';
import { computeQuoteItemTotal } from './durationUtils';
import type { DbService } from './serviceResolver';
import { formatServiceDisplayName } from './serviceResolver';
import { buildStructuredServiceHeading } from './serviceHeading';

export interface RateSlab {
  key: string;
  label: string;
  shortLabel: string;
  qty: number;
  minDays: number;
  costUnit: string;
  displayCost: number;
  price: number;
  durationPerSpot?: string;
  qtyUnit?: string;
  displayUnitCostPerDay: number;
  displayUnitPricePerDay: number;
}

/** One cinema row for Excel-style rate card (UI / PDF). */
export interface TheatreRateCardRow {
  serviceId: string;
  state: string;
  city: string;
  cinema: string;
  rate10sWeek: number | null;
  rate20sWeek: number | null;
  rate20s3Weeks: number | null;
  archMonth: number | null;
  kioskMonth: number | null;
  standeeMonth: number | null;
  plasmaCount: number | null;
  plasma10sWeek: number | null;
}

function isNaLike(value: unknown): boolean {
  if (value == null || value === '') return true;
  if (typeof value === 'string' && value.trim().toUpperCase() === 'NA') return true;
  return false;
}

function readPositive(value: unknown): number {
  if (isNaLike(value)) return 0;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function coerceSlabsObject(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function isNonTypeMediumType(raw: string | null | undefined): boolean {
  const t = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
  return t === 'multi rate slabs' || t === 'multirateslabs';
}

export function isSlabPricingService(svc: DbService | null | undefined): boolean {
  return listRateSlabs(svc).length > 0;
}

function stripCinemaPrefix(label: string, areaName?: string): string {
  let s = label.trim();
  if (areaName) {
    const re = new RegExp(
      `^${areaName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[·•\\-]\\s*`,
      'i',
    );
    s = s.replace(re, '').trim();
  }
  return s.replace(/\s+/g, ' ').trim() || label.trim();
}

function formatInrShort(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

export function listRateSlabs(svc: DbService | null | undefined): RateSlab[] {
  if (!svc?.metadata) return [];
  const meta = svc.metadata as Record<string, unknown>;
  const raw = coerceSlabsObject(meta.slabs);
  if (!raw) return [];

  const areaName = String(meta.area_name || meta.area || '').trim();
  const entries = Object.entries(raw).filter(([k]) => /^slab_\d+$/i.test(k));
  entries.sort((a, b) => {
    const na = Number(a[0].replace(/\D/g, '')) || 0;
    const nb = Number(b[0].replace(/\D/g, '')) || 0;
    return na - nb;
  });

  const out: RateSlab[] = [];
  for (const [key, value] of entries) {
    if (!value || typeof value !== 'object') continue;
    const s = value as Record<string, unknown>;
    const displayCost = readPositive(s.display_cost);
    const price = readPositive(s.price);
    // Client-facing package rate = selling price; cost is margin floor only.
    const selling = price > 0 ? price : displayCost;
    if (selling <= 0) continue;

    const minDays = Math.max(1, Math.round(readPositive(s.min_days) || 1));
    const qty = Math.max(1, Math.round(readPositive(s.qty) || 1));
    const label = String(s.label || key).trim() || key;
    const costAmt = displayCost > 0 ? displayCost : selling;

    out.push({
      key: key.toLowerCase(),
      label,
      shortLabel: stripCinemaPrefix(label, areaName || undefined),
      qty,
      minDays,
      costUnit: String(s.cost_unit || '').trim().toUpperCase() || 'DAY',
      displayCost: costAmt,
      price: selling,
      durationPerSpot: isNaLike(s.duration_per_spot)
        ? undefined
        : String(s.duration_per_spot).trim(),
      qtyUnit: isNaLike(s.qty_measurement_unit)
        ? undefined
        : String(s.qty_measurement_unit).trim(),
      displayUnitCostPerDay:
        readPositive(s.display_unit_cost_per_day) || costAmt / minDays,
      displayUnitPricePerDay:
        readPositive(s.display_unit_price_per_day) || selling / minDays,
    });
  }
  return out;
}

export function findRateSlab(
  svc: DbService | null | undefined,
  slabKey: string,
): RateSlab | null {
  const key = slabKey.trim().toLowerCase();
  return listRateSlabs(svc).find((s) => s.key === key) || null;
}

export function formatSlabChipLabel(slab: RateSlab): string {
  const unit =
    slab.costUnit === 'WEEK'
      ? 'wk'
      : slab.costUnit === 'MONTH'
        ? 'mo'
        : slab.costUnit.toLowerCase();
  return `${slab.shortLabel} · ${formatInrShort(slab.price)}/${unit}`;
}

/** Global package chip (multi-cinema) — no cinema name, selling price sample optional. */
export function formatSlabPackageChipLabel(slab: RateSlab, showPrice = false): string {
  const unit =
    slab.costUnit === 'WEEK'
      ? 'wk'
      : slab.costUnit === 'MONTH'
        ? 'mo'
        : slab.costUnit.toLowerCase();
  const base = slab.shortLabel.replace(/^rate\s+(for\s+)?/i, '').trim() || slab.shortLabel;
  if (!showPrice) return base;
  return `${base} · ${formatInrShort(slab.price)}/${unit}`;
}

/** Area chip enrichment: cinema + primary selling rate (10s/wk when present). */
export function formatCinemaAreaChipLabel(svc: DbService): string | null {
  if (!isSlabPricingService(svc)) return null;
  const meta = (svc.metadata || {}) as Record<string, unknown>;
  const cinema = String(meta.area_name || meta.area || '').trim();
  if (!cinema) return null;
  const slabs = listRateSlabs(svc);
  const primary =
    slabs.find((s) => s.key === 'slab_1')
    || slabs[0];
  if (!primary) return cinema;
  const unit =
    primary.costUnit === 'WEEK'
      ? 'wk'
      : primary.costUnit === 'MONTH'
        ? 'mo'
        : primary.costUnit.toLowerCase();
  return `${cinema} · ${formatInrShort(primary.price)}/${unit}`;
}

export function slabQuoteServiceId(baseServiceId: string, slabKey: string): string {
  return `${baseServiceId}|${slabKey.toLowerCase()}`;
}

export function parseSlabServiceId(
  serviceId: string | null | undefined,
): { baseId: string; slabKey: string } | null {
  const raw = String(serviceId || '').trim();
  if (!raw.includes('|')) return null;
  const idx = raw.lastIndexOf('|');
  const baseId = raw.slice(0, idx).trim();
  const slabKey = raw.slice(idx + 1).trim().toLowerCase();
  if (!baseId || !/^slab_\d+$/i.test(slabKey)) return null;
  return { baseId, slabKey };
}

function pluralUnit(unit: string, qty: number): string {
  const u = unit.trim() || 'unit';
  if (qty === 1) return u;
  if (/s$/i.test(u)) return u;
  return `${u}s`;
}

function sellingOf(slabs: RateSlab[], key: string): number | null {
  const s = slabs.find((x) => x.key === key);
  return s && s.price > 0 ? s.price : null;
}

/** Excel-style rate card row from one catalog cinema (selling prices). */
export function buildTheatreRateCardRow(svc: DbService): TheatreRateCardRow | null {
  const slabs = listRateSlabs(svc);
  if (!slabs.length) return null;
  const meta = (svc.metadata || {}) as Record<string, unknown>;
  const cinema = String(meta.area_name || meta.area || svc.service_name || '').trim();
  const city = String(meta.city || '').trim();
  const dir = String(meta.direction_remarks || '');
  const stateMatch = dir.match(/state\s*:\s*([^|·\n]+)/i);
  const state = (stateMatch?.[1] || '').trim();
  const plasma = slabs.find((s) => s.key === 'slab_7');

  return {
    serviceId: svc.service_id,
    state: state || '—',
    city: city || '—',
    cinema: cinema || '—',
    rate10sWeek: sellingOf(slabs, 'slab_1'),
    rate20sWeek: sellingOf(slabs, 'slab_2'),
    rate20s3Weeks: sellingOf(slabs, 'slab_3'),
    archMonth: sellingOf(slabs, 'slab_4'),
    kioskMonth: sellingOf(slabs, 'slab_5'),
    standeeMonth: sellingOf(slabs, 'slab_6'),
    plasmaCount: plasma && plasma.qty > 0 ? plasma.qty : null,
    plasma10sWeek: plasma ? plasma.price : null,
  };
}

/**
 * Package line per selected slab.
 * qty=1 × daily selling × min_days ≈ price (client rate).
 */
export function buildLineItemsFromSlabs(
  svc: DbService,
  slabKeys: string[],
  sectionIndex: number,
): QuoteItem[] {
  const keys = [...new Set(slabKeys.map((k) => k.trim().toLowerCase()).filter(Boolean))];
  if (!keys.length) return [];

  const meta = (svc.metadata || {}) as Record<string, unknown>;
  const cinema = String(meta.area_name || meta.area || '').trim();
  const medium = String(meta.medium || '').trim();
  const city = String(meta.city || '').trim();
  const structured = buildStructuredServiceHeading(svc);
  const baseName =
    [medium || null, cinema || null].filter(Boolean).join(' · ')
    || structured
    || formatServiceDisplayName(svc);
  const mediumLabel = medium || undefined;
  const vendorLabel =
    String(meta.vendor_name || svc.document_name || '').trim() || undefined;

  const items: QuoteItem[] = [];
  let lineIndex = 0;

  for (const key of keys) {
    const slab = findRateSlab(svc, key);
    if (!slab) continue;
    const qtyNote =
      slab.qty > 1
        ? ` (${slab.qty} ${pluralUnit(slab.qtyUnit || 'screen', slab.qty)})`
        : '';
    const serviceName = `${baseName} · ${slab.shortLabel}${qtyNote}`;
    const dailySell = slab.displayUnitPricePerDay;
    const dailyCost = slab.displayUnitCostPerDay;
    const line: QuoteItem = {
      id: `${sectionIndex}-${lineIndex++}`,
      title: serviceName,
      description: `${serviceName} - Display Price`,
      serviceId: slabQuoteServiceId(svc.service_id, slab.key),
      serviceName,
      quantity: 1,
      quantityUnit: 'package',
      rate: dailySell,
      duration: slab.minDays,
      durationUnit: 'days',
      durationIsAuto: true,
      minimumQuantity: 1,
      total: 0,
      vendorDisplayUnitCostPerDay: dailyCost > 0 ? dailyCost : dailySell,
      vendorName: vendorLabel,
      medium: mediumLabel,
      adType: slab.shortLabel,
      city: city || undefined,
      vendorCostExclGst: dailyCost > 0 ? dailyCost : undefined,
      remark: slab.durationPerSpot || undefined,
    };
    line.total = computeQuoteItemTotal(line);
    items.push(line);
  }

  return items;
}
