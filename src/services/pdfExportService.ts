/**
 * pdfExportService.ts  (React-PDF version)
 *
 * Replaces the html2canvas + jsPDF pipeline with @react-pdf/renderer.
 *
 * Flow (NEW — DB-first):
 *  1. QuotePreviewPage calls exportToPDF(..., documentIds)
 *  2. We query vendor_rate_chunks (rank=1) for images / specs / review
 *  3. Build pdfData[] directly from metadata.images
 *  4. Falls back to DOM store (ReferenceImages) if DB has no images for a service
 *  5. Render CorporateMinimalPDF to a blob — zero Gemini calls
 *  6. Mobile: save without prompting and open in the platform's download/documents location
 *  7. Web: trigger an automatic file download with QT_Client_Label_HHMMSS.pdf naming
 */

import React from 'react';
import { pdf } from '@react-pdf/renderer';
import { TemplateType } from '../types';
import { TemplateData } from '../types/template';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import CorporateMinimalPDF, { ServicePdfData, PdfExportMode } from '../components/Templates/CorporateMinimalPDF';
import { loadAllServicesFromCloud, buildMetroSpecText } from './supabaseProposalService';
import type { DbService } from '../utils/serviceResolver';
import { extractMetroMultiTableSpec, type PdfSpecGroup } from '../utils/metroSpecParser';
import { pickMaterialFromMeta, pickDisplayDimensionFields } from '../utils/specMaterial';
import { useAppStore } from '../store';

const isMobile = () => Capacitor.isNativePlatform();
const DEBUG_PDF_EXPORT = true;

const compactUrl = (url: string): string => {
  if (!url) return '(empty)';
  if (url.startsWith('data:')) return `${url.slice(0, 32)}... [data-url len=${url.length}]`;
  return url.length > 140 ? `${url.slice(0, 140)}...` : url;
};

const debugSummarizePdfData = (pdfData: ServicePdfData[]): void => {
  if (!DEBUG_PDF_EXPORT) return;
  console.groupCollapsed(`📄 [PDF-DEBUG] pdfData summary (${pdfData.length} service entries)`);
  pdfData.forEach((entry, idx) => {
    console.log(
      `${idx + 1}. key="${entry.serviceKey}" | ref=${entry.refImages?.length || 0} | specImg=${entry.specImages?.length || 0} | specGroups=${entry.specGroups?.length || 0} | specFields=${entry.specFields?.length || 0} | review=${entry.review ? 'yes' : 'no'}`,
    );
    if (entry.refImages?.length) console.log(`   ref[0]: ${compactUrl(entry.refImages[0])}`);
    if (entry.specImages?.length) console.log(`   specImg[0]: ${compactUrl(entry.specImages[0])}`);
  });
  console.groupEnd();
};

const probeImageUrl = async (url: string): Promise<{ ok: boolean; detail: string }> => {
  if (!url) return { ok: false, detail: 'empty url' };

  // Data URLs are already in-memory payloads; no network/cors fetch needed.
  if (url.startsWith('data:')) {
    return { ok: true, detail: `data-url (${url.slice(0, 20)}..., len=${url.length})` };
  }

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { method: 'GET', mode: 'cors', signal: ctrl.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      return { ok: false, detail: `HTTP ${res.status}` };
    }
    const ct = res.headers.get('content-type') || 'unknown-type';
    return { ok: true, detail: `HTTP ${res.status} ${ct}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
};

const debugProbeImageSources = async (pdfData: ServicePdfData[]): Promise<void> => {
  if (!DEBUG_PDF_EXPORT) return;
  const allUrls = [
    ...pdfData.flatMap((d) => d.refImages || []),
    ...pdfData.flatMap((d) => d.specImages || []),
  ].filter(Boolean);
  const uniqueUrls = [...new Set(allUrls)];
  const sample = uniqueUrls.slice(0, 12);

  console.groupCollapsed(`🖼️ [PDF-DEBUG] probing ${sample.length}/${uniqueUrls.length} image URLs before render`);
  for (let i = 0; i < sample.length; i += 1) {
    const url = sample[i];
    const result = await probeImageUrl(url);
    const mark = result.ok ? '✅' : '❌';
    console.log(`${mark} [${i + 1}] ${compactUrl(url)} -> ${result.detail}`);
  }
  if (uniqueUrls.length > sample.length) {
    console.log(`ℹ️ Skipped probing ${uniqueUrls.length - sample.length} additional URLs to keep logs readable.`);
  }
  console.groupEnd();
};

/**
 * Read the ServicePdfData[] that ReferenceImages.tsx stored in
 * the DOM attribute `data-pdf-store` on the element with id="pdf-data-store".
 * Returns empty array when not found (screen preview not yet ready).
 */
const readPdfDataFromDom = (): ServicePdfData[] => {
  try {
    const el = document.getElementById('pdf-data-store');
    if (!el) return [];
    const raw = el.getAttribute('data-pdf-store');
    if (!raw) return [];
    return JSON.parse(raw) as ServicePdfData[];
  } catch {
    return [];
  }
};

/**
 * Read TemplateData from the DOM attribute `data-template-store` on
 * element id="pdf-data-store".  Injected by QuotePreviewPage before export.
 */
const readTemplateDataFromDom = (): TemplateData | null => {
  try {
    const el = document.getElementById('pdf-data-store');
    if (!el) return null;
    const raw = el.getAttribute('data-template-store');
    if (!raw) return null;
    return JSON.parse(raw) as TemplateData;
  } catch {
    return null;
  }
};

const formatClientNameForFilename = (clientName: string): string => {
  const trimmed = clientName.trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'Client';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
};

const getQuoteFilenameLabel = (exportMode: PdfExportMode): string => {
  if (exportMode === 'summary') return 'Summarized Quote';
  return 'Detailed Quote';
};

/**
 * Wait for all ReferenceImages blocks to finish async image/spec resolution.
 * They mark themselves with data-pdf-ready="true" when stable.
 */
const waitForPdfReady = async (timeoutMs: number = 8000): Promise<void> =>
  new Promise((resolve) => {
    const started = Date.now();
    const poll = () => {
      const blocks = Array.from(document.querySelectorAll<HTMLElement>('[data-pdf-ready]'));
      if (blocks.length === 0) {
        resolve();
        return;
      }
      const allReady = blocks.every((el) => el.getAttribute('data-pdf-ready') === 'true');
      if (allReady) {
        resolve();
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        console.warn('pdfExportService: timed out waiting for data-pdf-ready, exporting with current data');
        resolve();
        return;
      }
      setTimeout(poll, 120);
    };
    poll();
  });

const formatSpecLabel = (key: string): string =>
  key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Flatten vendor metadata.specifications into PDF label/value rows.
 * Handles metro coach objects (nested), elevated footfall nests, and plain strings.
 * Previously only string values were kept — nested coach specs were silently dropped.
 */
const flattenSpecificationsToFields = (
  specs: Record<string, unknown> | null | undefined,
): Array<{ label: string; value: string }> => {
  if (!specs || typeof specs !== 'object' || Array.isArray(specs)) return [];

  const fields: Array<{ label: string; value: string }> = [];
  const COACH_RE = /^coach[_\s-]*(\d+)/i;

  // ── Metro format A: coach_1_ladies_coach: { type_of_media, size_in_inches, qty } ──
  const metroItems: Array<{ coachNum: string; key: string; media: string; size: string; qty: string }> = [];
  for (const [key, val] of Object.entries(specs)) {
    if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
    const e = val as Record<string, unknown>;
    if (!e.type_of_media) continue;
    const size = e.size_in_inches ?? e.size;
    if (size == null || String(size).trim() === '') continue;
    const coachMatch = key.match(COACH_RE);
    const coachNum = coachMatch
      ? coachMatch[1]
      : key === 'driver_door_sticker'
        ? '4'
        : '';
    if (!coachNum && key !== 'driver_door_sticker') continue;
    metroItems.push({
      coachNum,
      key,
      media: key === 'driver_door_sticker' ? 'Driver Door Sticker' : String(e.type_of_media),
      size: String(size),
      qty: e.qty != null ? String(e.qty) : e.quantity != null ? String(e.quantity) : '',
    });
  }

  if (metroItems.length > 0) {
    if (specs.card_material_area != null && String(specs.card_material_area).trim()) {
      fields.push({ label: 'Card Material Area', value: String(specs.card_material_area) });
    }
    if (specs.card_display_area != null && String(specs.card_display_area).trim()) {
      fields.push({ label: 'Card Display Area', value: String(specs.card_display_area) });
    }
    for (const item of metroItems) {
      const label = item.coachNum ? `Coach ${item.coachNum}: ${item.media}` : item.media;
      const value = item.qty ? `${item.size} (qty ${item.qty})` : item.size;
      fields.push({ label, value });
    }
    return fields;
  }

  // ── Metro format B / nested: coach_1: { name, Cards: { size, quantity } } ──
  for (const [key, val] of Object.entries(specs)) {
    if (!COACH_RE.test(key) || !val || typeof val !== 'object' || Array.isArray(val)) continue;
    const coach = val as Record<string, unknown>;
    const coachNum = key.match(COACH_RE)?.[1] || '';
    const coachName = typeof coach.name === 'string' ? coach.name.trim() : '';
    const heading = coachNum
      ? `Coach ${coachNum}${coachName ? ` — ${coachName}` : ''}`
      : coachName || formatSpecLabel(key);

    for (const [itemKey, itemVal] of Object.entries(coach)) {
      if (itemKey === 'name') continue;
      if (itemVal && typeof itemVal === 'object' && !Array.isArray(itemVal)) {
        const item = itemVal as Record<string, unknown>;
        const size = item.size != null ? String(item.size) : item.size_in_inches != null ? String(item.size_in_inches) : '';
        const qty = item.quantity != null ? String(item.quantity) : item.qty != null ? String(item.qty) : '';
        const value = [size, qty ? `(qty ${qty})` : ''].filter(Boolean).join(' ').trim();
        if (value) fields.push({ label: `${heading}: ${formatSpecLabel(itemKey)}`, value });
      } else if (
        (typeof itemVal === 'string' || typeof itemVal === 'number') &&
        String(itemVal).trim() &&
        String(itemVal).toUpperCase() !== 'NA'
      ) {
        fields.push({ label: `${heading}: ${formatSpecLabel(itemKey)}`, value: String(itemVal) });
      }
    }
  }
  if (fields.length > 0) {
    // Still include top-level scalar areas if present
    for (const scalarKey of ['card_material_area', 'card_display_area']) {
      if (specs[scalarKey] != null && String(specs[scalarKey]).trim()) {
        fields.unshift({ label: formatSpecLabel(scalarKey), value: String(specs[scalarKey]) });
      }
    }
    return fields;
  }

  // ── Generic: scalars + one-level nested objects (footfall, size maps, etc.) ──
  for (const [key, value] of Object.entries(specs)) {
    if (value == null) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const s = String(value).trim();
      if (s && s.toUpperCase() !== 'NA') fields.push({ label: formatSpecLabel(key), value: s });
      continue;
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      for (const [sk, sv] of Object.entries(value as Record<string, unknown>)) {
        if (sv == null) continue;
        if (typeof sv === 'string' || typeof sv === 'number' || typeof sv === 'boolean') {
          const s = String(sv).trim();
          if (s && s.toUpperCase() !== 'NA') {
            fields.push({ label: `${formatSpecLabel(key)}: ${formatSpecLabel(sk)}`, value: s });
          }
        }
      }
    }
  }
  return fields;
};

/** City slug from vendor metadata / locations / trailing service_id. */
const cityFromDbService = (row: DbService): string => {
  const meta = row.metadata || {};
  const metaCity = typeof (meta as { city?: string }).city === 'string'
    ? (meta as { city: string }).city.trim().toLowerCase()
    : '';
  if (metaCity) return metaCity;
  const loc = Array.isArray(meta.locations) && meta.locations[0]
    ? String(meta.locations[0]).trim().toLowerCase()
    : '';
  if (loc && loc !== 'general') return loc;
  const sid = (row.service_id || '').toLowerCase();
  const cities = [
    'chennai', 'madurai', 'coimbatore', 'salem', 'trichy', 'bangalore', 'mumbai',
    'delhi', 'hyderabad', 'pune', 'kolkata',
  ];
  for (const c of cities) {
    if (sid.endsWith(`-${c}`)) return c;
  }
  return '';
};

/**
 * Lookup key used by CorporateMinimal / CorporateMinimalPDF:
 *   `${city}|${serviceName.toLowerCase()}` or just service name.
 */
const pdfServiceKey = (city: string, serviceName: string, fallbackId: string): string => {
  const name = (serviceName || '').trim().toLowerCase();
  if (city && name) return `${city}|${name}`;
  if (name) return name;
  return fallbackId;
};

/**
 * Fetch pdfData from vendor_rate_chunks (rank=1) via loadAllServicesFromCloud.
 * Builds ref/spec images + flattened string spec fields for CorporateMinimalPDF.
 */
const fetchPdfDataFromDB = async (_documentIds: string[]): Promise<ServicePdfData[]> => {
  try {
    console.log('[PDF-DB] Loading from vendor_rate_chunks (rank=1)...');
    const services: DbService[] = (await loadAllServicesFromCloud()) || [];
    if (!services.length) {
      console.warn('[PDF-DB] No vendor_rate_chunks services loaded');
      return [];
    }

    const pdfData: ServicePdfData[] = [];

    for (const row of services) {
      const images: Array<{ url: string; type: string }> = row.metadata?.images || [];
      const refImages = images.filter((img) => img.type === 'reference').map((img) => img.url);
      const specImages = images.filter((img) => img.type === 'specification').map((img) => img.url);
      // Fallbacks when images[] lacks typed entries
      if (refImages.length === 0 && typeof row.metadata?.reference_image === 'string') {
        refImages.push(row.metadata.reference_image);
      }
      const reviewRaw = row.metadata?.review;
      const customerReviewUrl = typeof row.metadata?.customer_review === 'string' ? row.metadata.customer_review : null;
      const review =
        reviewRaw &&
        typeof reviewRaw.reviewerName === 'string' &&
        typeof reviewRaw.reviewText === 'string'
          ? {
              reviewerName: reviewRaw.reviewerName,
              starCount: reviewRaw.starCount ?? 5,
              reviewText: reviewRaw.reviewText,
              reviewUrl: reviewRaw.reviewUrl ?? customerReviewUrl ?? null,
            }
          : null;

      const specsObj =
        row.metadata?.specifications && typeof row.metadata.specifications === 'object'
          ? (row.metadata.specifications as Record<string, unknown>)
          : null;

      let specGroups: PdfSpecGroup[] | undefined;
      if (specsObj) {
        const metroText = buildMetroSpecText(specsObj);
        if (metroText) {
          const groups = extractMetroMultiTableSpec(metroText);
          if (groups?.length) specGroups = groups;
        }
      }

      let specFields: Array<{ label: string; value: string }> = [];
      if (!specGroups?.length) {
        // DB display dimensions first (Width / Height / Length), then other specs
        const dimFields = pickDisplayDimensionFields(
          (row.metadata || {}) as Record<string, unknown>,
        );
        specFields = [...dimFields];

        const flat = flattenSpecificationsToFields(specsObj);
        for (const f of flat) {
          if (!specFields.some((x) => x.label.toLowerCase() === f.label.toLowerCase())) {
            specFields.push(f);
          }
        }
        if (
          specFields.length === dimFields.length &&
          typeof row.metadata?.size === 'string' &&
          row.metadata.size.trim()
        ) {
          specFields.push({ label: 'Size', value: row.metadata.size });
        }
        const materialVal = pickMaterialFromMeta(
          (row.metadata || {}) as Record<string, unknown>,
        );
        if (materialVal != null) {
          if (!specFields.some((f) => /material/i.test(f.label))) {
            if (typeof materialVal === 'string') {
              specFields.push({ label: 'Material', value: materialVal });
            } else {
              const joined = Object.entries(materialVal)
                .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
                .join('\n');
              if (joined.trim()) {
                specFields.push({ label: 'Material', value: joined });
              }
            }
          }
        }
      }

      const city = cityFromDbService(row);
      const serviceKey = pdfServiceKey(city, row.service_name, row.service_id);
      console.log(
        `[PDF-DB] ${serviceKey} (id=${row.service_id}): ref=${refImages.length} specImg=${specImages.length} specGroups=${specGroups?.length || 0} specFields=${specFields.length} review=${review ? 'yes' : 'no'}`,
      );

      const entry: ServicePdfData = { serviceKey, refImages, specImages, specFields, specGroups, review };
      pdfData.push(entry);

      // Alias under service_id so single-service preview keys (item.serviceId) still merge
      if (row.service_id && row.service_id !== serviceKey) {
        pdfData.push({ ...entry, serviceKey: row.service_id });
      }
    }

    console.log(`[PDF-DB] Built ${pdfData.length} entries from vendor_rate_chunks`);
    return pdfData;
  } catch (err) {
    console.error('[PDF-DB] fetchPdfDataFromDB failed:', err);
    return [];
  }
};

/** Fuzzy-match DOM bridge entry to a DB entry (keys often differ: service_id vs city|name). */
const findDomMatch = (dbEntry: ServicePdfData, domData: ServicePdfData[]): ServicePdfData | undefined => {
  const exact = domData.find((d) => d.serviceKey === dbEntry.serviceKey);
  if (exact) return exact;

  const dbKey = dbEntry.serviceKey.toLowerCase();
  const dbName = dbKey.includes('|') ? dbKey.split('|').slice(1).join('|') : dbKey.replace(/-/g, ' ');

  return domData.find((d) => {
    const dk = d.serviceKey.toLowerCase();
    if (dk === dbKey) return true;
    if (dk.includes('|') && dbKey.includes('|') && dk.split('|')[1] === dbKey.split('|')[1]) return true;
    const dName = dk.includes('|') ? dk.split('|').slice(1).join('|') : dk.replace(/-/g, ' ');
    return Boolean(dbName) && (dName === dbName || dk.includes(dbName.replace(/\s+/g, '-')) || dbKey.includes(dName.replace(/\s+/g, '-')));
  });
};

/** Merge DB + DOM: prefer richer specs/images; keep unmatched DOM entries (quote services). */
const mergePdfData = (dbData: ServicePdfData[], domData: ServicePdfData[]): ServicePdfData[] => {
  if (!domData.length) return dbData;
  if (!dbData.length) return domData;

  const usedDom = new Set<string>();
  const merged = dbData.map((dbEntry) => {
    const domEntry = findDomMatch(dbEntry, domData);
    if (!domEntry) return dbEntry;
    usedDom.add(domEntry.serviceKey);

    const useDomRefs = (domEntry.refImages?.length ?? 0) > 0;
    const useDomSpecImgs = (domEntry.specImages?.length ?? 0) > 0;
    const domHasTables = domEntry.specGroups?.some((g) => (g.tableRows?.length ?? 0) > 0) ?? false;
    const dbHasTables = dbEntry.specGroups?.some((g) => (g.tableRows?.length ?? 0) > 0) ?? false;
    const useDomSpecGroups =
      domHasTables ||
      ((domEntry.specGroups?.length ?? 0) > 0 && !dbHasTables);
    const useDomFields =
      !useDomSpecGroups &&
      (domEntry.specFields?.length ?? 0) > (dbEntry.specFields?.length ?? 0);

    console.log(
      `[PDF-EXPORT] Merge ${dbEntry.serviceKey}↔${domEntry.serviceKey}: refs=${useDomRefs ? 'DOM' : 'DB'} specGroups=${useDomSpecGroups ? 'DOM' : 'DB'} fields=${useDomFields ? 'DOM' : 'DB'}`,
    );

    return {
      ...dbEntry,
      refImages: useDomRefs ? domEntry.refImages : dbEntry.refImages,
      specImages: useDomSpecImgs ? domEntry.specImages : dbEntry.specImages,
      specGroups: useDomSpecGroups
        ? domEntry.specGroups
        : dbEntry.specGroups?.length
          ? dbEntry.specGroups
          : domEntry.specGroups,
      specFields: useDomSpecGroups
        ? []
        : useDomFields
          ? domEntry.specFields
          : dbEntry.specFields?.length
            ? dbEntry.specFields
            : domEntry.specFields,
      review: domEntry.review ?? dbEntry.review,
    };
  });

  for (const dom of domData) {
    if (!usedDom.has(dom.serviceKey)) {
      console.log(`[PDF-EXPORT] Keeping unmatched DOM entry: ${dom.serviceKey} (groups=${dom.specGroups?.length || 0}, fields=${dom.specFields?.length || 0})`);
      merged.push(dom);
    }
  }
  return merged;
};

/**
 * Pre-flight: fetch every image URL and return a base64 data URL + dimensions.
 * This sidesteps React-PDF's internal worker fetch (which may hit CORS or timeout).
 * Also logs full diagnostics for each image.
 */
const prefetchImagesToBase64 = async (pdfData: ServicePdfData[]): Promise<ServicePdfData[]> => {
  const convertUrl = async (url: string, label: string): Promise<{ base64: string; width: number; height: number }> => {
    if (!url || url.startsWith('data:')) {
      // Already base64 — still probe dimensions
      const img = new window.Image();
      const dims = await new Promise<{ width: number; height: number }>((resolve) => {
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ width: 0, height: 0 });
        img.src = url;
      });
      return { base64: url, ...dims };
    }
    try {
      console.groupCollapsed(`🔍 [PREFETCH] ${label}`);
      console.log(`  src: ${url.slice(0, 100)}`);

      const res = await fetch(url, { mode: 'cors' });
      const status = res.status;
      const ct = res.headers.get('content-type') || 'unknown';
      console.log(`  fetch: ${res.ok ? '✅ SUCCESS' : '❌ FAILED'} | status=${status} | contentType=${ct}`);

      if (!res.ok) {
        console.groupEnd();
        return { base64: url, width: 0, height: 0 };
      }

      const blob = await res.blob();
      console.log(`  blobSize: ${(blob.size / 1024).toFixed(1)}KB`);

      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });

      const img = new window.Image();
      const dims = await new Promise<{ width: number; height: number }>((resolve) => {
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ width: 0, height: 0 });
        img.src = base64;
      });
      console.log(`  dimensions: ${dims.width}×${dims.height}px | aspect=${dims.width && dims.height ? (dims.width/dims.height).toFixed(2) : 'N/A'}`);
      console.log(`  base64 preview: ${base64.slice(0, 40)}... len=${base64.length}`);
      console.groupEnd();
      return { base64, ...dims };
    } catch (err) {
      console.error(`  ❌ EXCEPTION: ${err}`);
      console.groupEnd();
      return { base64: url, width: 0, height: 0 };
    }
  };

  return Promise.all(pdfData.map(async (entry) => {
    const refResults = await Promise.all(
      (entry.refImages || []).map((url, i) => convertUrl(url, `${entry.serviceKey} ref[${i}]`))
    );
    const specResults = await Promise.all(
      (entry.specImages || []).map((url, i) => convertUrl(url, `${entry.serviceKey} spec[${i}]`))
    );
    return {
      ...entry,
      refImages: refResults.map(r => r.base64),
      refImageDimensions: refResults.map(r => ({ width: r.width, height: r.height })),
      specImages: specResults.map(r => r.base64),
    };
  }));
};

export const exportToPDF = async (
  _element: HTMLElement,       // kept for API compatibility — not used by React-PDF
  quoteNumber: string,
  _templateType: TemplateType, // future: switch on template type
  clientName?: string,
  documentIds?: string[],      // proposal document IDs to load images from DB
  exportMode: PdfExportMode = 'full',
  shouldDownload = true,
): Promise<{ pdfBlob: Blob; filename: string }> => {
  const originalCursor = document.body.style.cursor;
  document.body.style.cursor = 'wait';

  try {
    const templateData = readTemplateDataFromDom();
    if (!templateData) {
      throw new Error('Template data not found. Please wait for the preview to load.');
    }

    // DOM JSON can lag behind preview edits (huge data-template-store / async floors).
    // Quote, company, and client in the Zustand store are the source of truth.
    const live = useAppStore.getState();
    if (live.currentQuote) templateData.quote = live.currentQuote;
    if (live.companyInfo) templateData.company = live.companyInfo;
    if (live.clientInfo) templateData.client = live.clientInfo;

    // Always load vendor catalog for images/specs (documentIds kept for API compat).
    // Rank-1 vendor_rate_chunks is the source of truth — not proposal_chunks.
    let pdfData: ServicePdfData[] = [];
    console.log('[PDF-EXPORT] Fetching images/specs from vendor_rate_chunks...', documentIds?.length ? `docIds=${documentIds.length}` : '(no proposal docIds)');
    pdfData = await fetchPdfDataFromDB(documentIds || []);

    // Always wait for preview bridge, then merge. DOM often has richer metro
    // specFields (parsed tables); DB keys were historically service_id-only.
    await waitForPdfReady();
    await new Promise((r) => setTimeout(r, 80));
    const domData = readPdfDataFromDom();

    if (pdfData.length === 0) {
      console.log('[PDF-EXPORT] DB empty — using DOM store');
      pdfData = domData;
    } else if (domData.length > 0) {
      console.log(
        `[PDF-EXPORT] Merging DB (${pdfData.length}) with DOM bridge (${domData.length})`,
      );
      pdfData = mergePdfData(pdfData, domData);
    } else {
      console.log('[PDF-EXPORT] DOM bridge empty — using DB images/specs');
    }

    debugSummarizePdfData(pdfData);
    await debugProbeImageSources(pdfData);

    // Pre-fetch all images as base64 — fixes React-PDF worker CORS/fetch issues
    // and gives us full diagnostics before render
    console.log('[PDF-EXPORT] Pre-fetching images as base64...');
    pdfData = await prefetchImagesToBase64(pdfData);
    console.log('[PDF-EXPORT] Pre-fetch complete. Rendering PDF...');

    // Render to blob using React-PDF
    const doc = React.createElement(CorporateMinimalPDF, { data: templateData, pdfData, exportMode }) as any;
    const blob = await pdf(doc).toBlob();

    // Generate filename
    const clientStr = formatClientNameForFilename(clientName || '');
    const quoteLabel = getQuoteFilenameLabel(exportMode);
    const stamp = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timePart = `${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;
    const filename = `${quoteNumber}_${clientStr}_${quoteLabel}_${timePart}.pdf`;

      if (shouldDownload && isMobile()) {
        // ── Mobile: save to Documents folder and open ──────────────────
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
        );
        const isAndroid = Capacitor.getPlatform() === 'android';
        const result = await Filesystem.writeFile({
          // Android exposes the shared Downloads folder through ExternalStorage.
          // iOS has no shared Downloads directory, so Documents is the closest
          // system-managed location and does not show a folder picker.
          path: isAndroid ? `Download/QuoteBuddy/${filename}` : `QuoteBuddy/${filename}`,
          data: base64,
          directory: isAndroid ? Directory.ExternalStorage : Directory.Documents,
          recursive: true,
        });
        await FileOpener.open({ filePath: result.uri, contentType: 'application/pdf' });
      } else if (shouldDownload) {
        downloadPdfBlob(blob, filename);
      }
      return { pdfBlob: blob, filename };
  } finally {
    document.body.style.cursor = originalCursor;
  }
};

/**
 * Trigger an automatic browser download with the intended filename
 * (e.g. QT-652030_Naresh_Detailed Quote_105248.pdf).
 * Prefer this over opening a blob tab — new tabs ignore `download` names.
 */
export const downloadPdfBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'quote.pdf';
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

/** @deprecated Use downloadPdfBlob — kept so older imports keep compiling. */
export const openPdfBlobInNewTab = (blob: Blob, filename: string): void => {
  downloadPdfBlob(blob, filename);
};
