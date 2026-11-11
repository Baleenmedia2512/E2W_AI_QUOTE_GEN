/**
 * Proposal Service — Prisma/MySQL via local /api (MilesWeb uploads).
 */

import { StoredProposal } from '../types';
import {
  formatMaterialSpecLines,
  formatDisplayDimensionSpecLines,
  formatDesignSpecificationDetailLines,
  pickMaterialFromMeta,
} from '../utils/specMaterial';
import { apiFetch } from './apiClient';
import { authService } from './authService';

export interface CloudProposal {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  file_url: string;
  storage_path: string;
  text_content: string;
  page_count: number;
  uploaded_by_user_id: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
}

/**
 * Upload file to Supabase Storage and save metadata
 */
export async function uploadProposalToCloud(
  file: File,
  textContent: string,
  pageCount: number,
  userId?: string,
  userName?: string
): Promise<{ success: boolean; proposal?: CloudProposal; error?: string }> {
  try {
    const currentUser = authService.getCurrentUser();
    const currentUserId = userId || currentUser?.id || 'anonymous';
    const currentUserName = userName || currentUser?.full_name || currentUser?.email || 'App User';

    const form = new FormData();
    form.append('file', file);
    form.append('textContent', textContent);
    form.append('pageCount', String(pageCount));
    form.append('userId', currentUserId);
    form.append('userName', currentUserName);

    const { data, error } = await apiFetch<{ success?: boolean; proposal?: CloudProposal; error?: string }>(
      '/api/proposals',
      { method: 'POST', body: form },
    );

    if (error || !data?.success || !data.proposal) {
      return { success: false, error: data?.error || error || 'Upload failed' };
    }

    console.log('✅ Proposal uploaded to MilesWeb successfully');
    return { success: true, proposal: data.proposal };
  } catch (error: any) {
    console.error('❌ Upload to cloud failed:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Load all proposals from cloud (visible to all users)
 */
export async function loadAllProposalsFromCloud(
  limit: number = 20
): Promise<CloudProposal[]> {
  try {
    console.log('📂 Loading proposals from API...');
    const { data, error } = await apiFetch<{ data?: CloudProposal[] }>(
      `/api/proposals?limit=${limit}`,
    );
    if (error) {
      console.error('❌ Error loading proposals from cloud:', error);
      return [];
    }
    console.log(`✅ Loaded ${data?.data?.length || 0} proposals from cloud`);
    return data?.data || [];
  } catch (error) {
    console.error('❌ Exception loading proposals:', error);
    return [];
  }
}

/**
 * Load a specific proposal from cloud
 */
export async function loadProposalFromCloud(id: string): Promise<CloudProposal | null> {
  try {
    const all = await loadAllProposalsFromCloud(200);
    return all.find((p) => p.id === id) || null;
  } catch (error) {
    console.error('❌ Exception loading proposal:', error);
    return null;
  }
}

/**
 * Delete proposal from cloud (file + metadata)
 */
export async function deleteProposalFromCloud(id: string): Promise<boolean> {
  try {
    const { error } = await apiFetch(`/api/proposals/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (error) {
      console.error('❌ Database delete error:', error);
      return false;
    }
    console.log('✅ Proposal deleted from cloud');
    return true;
  } catch (error) {
    console.error('❌ Exception deleting proposal:', error);
    return false;
  }
}

/**
 * Check if a proposal with same name and size exists in cloud
 */
export async function findCloudDuplicate(
  fileName: string,
  fileSize: number
): Promise<CloudProposal | null> {
  try {
    const all = await loadAllProposalsFromCloud(100);
    const data = all.find((p) => p.file_name === fileName && p.file_size === fileSize) || null;
    if (data) console.log('🔍 Found duplicate in cloud:', data.file_name);
    return data;
  } catch (error) {
    console.error('❌ Exception checking duplicates:', error);
    return null;
  }
}

/**
 * Download file from cloud storage
 */
export async function downloadProposalFile(storagePath: string): Promise<Blob | null> {
  try {
    const { resolveMediaUrl } = await import('../utils/resolveMediaUrl');
    const uploadsBase = (
      import.meta.env.NEXT_PUBLIC_UPLOADS_BASE_URL
      || import.meta.env.VITE_UPLOADS_BASE_URL
      || 'https://baleenmedia.in/costmanager'
    ).replace(/\/$/, '');
    const raw = storagePath.startsWith('http') || storagePath.startsWith('/')
      ? storagePath
      : `${uploadsBase}/proposals/${storagePath.replace(/^\/+/, '')}`;
    const url = resolveMediaUrl(raw) || raw;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.blob();
  } catch (error) {
    console.error('❌ Exception downloading file:', error);
    return null;
  }
}

/**
 * Check if Supabase is properly configured
 * NOTE: Temporarily disabled — RLS policies on Supabase block anon uploads.
 * App falls back to IndexedDB (local storage) until Supabase policies are fixed.
 */
export async function checkCloudStorageAvailability(): Promise<boolean> {
  try {
    const { error } = await apiFetch('/api/health');
    if (error) {
      console.warn('⚠️ Cloud storage unavailable:', error);
      return false;
    }
    console.log('☁️ Local API / MilesWeb storage available');
    return true;
  } catch (error) {
    console.warn('⚠️ Cloud storage check failed:', error);
    return false;
  }
}

/**
 * Helper: Convert CloudProposal to StoredProposal format
 * Used for compatibility with local IndexedDB storage interface
 */
export function cloudProposalToStored(cloud: CloudProposal): StoredProposal {
  return {
    id: cloud.id,
    fileName: cloud.file_name,
    fileType: cloud.file_type,
    fileSize: cloud.file_size,
    fileBlob: null, // Blob will be downloaded on-demand when selected
    textContent: cloud.text_content,
    pageCount: cloud.page_count,
    extractedImages: [],
    pageImages: [],
    uploadedAt: new Date(cloud.uploaded_at),
    // Cloud-specific fields
    isCloudStored: true,
    fileUrl: cloud.file_url,
    storagePath: cloud.storage_path,
    uploadedByUserId: cloud.uploaded_by_user_id,
    uploadedByName: cloud.uploaded_by_name,
  };
}

/**
 * Save Gemini OCR review data back to proposal_chunks metadata.
 * DISABLED: proposal_chunks fetch/update commented out.
 */
export async function saveReviewToCloud(
  _serviceId: string,
  _reviewData: { reviewerName: string; starCount: number; reviewText: string }
): Promise<void> {
  console.log('⚠️ [saveReviewToCloud] DISABLED — proposal_chunks commented out');
  return;
  /*
  try {
    // Fetch current metadata first
    const { data, error: fetchErr } = await supabase
      .from('proposal_chunks')
      .select('metadata')
      .eq('service_id', serviceId)
      .single();

    if (fetchErr || !data) {
      console.warn(`⚠️ [saveReviewToCloud] Could not fetch service "${serviceId}":`, fetchErr?.message);
      return;
    }

    const updatedMetadata = { ...(data.metadata || {}), review: reviewData };

    const { error: updateErr } = await supabase
      .from('proposal_chunks')
      .update({ metadata: updatedMetadata })
      .eq('service_id', serviceId);

    if (updateErr) {
      console.warn(`⚠️ [saveReviewToCloud] Update failed for "${serviceId}":`, updateErr.message);
    } else {
      console.log(`✅ [saveReviewToCloud] Saved review for "${serviceId}": ${reviewData.reviewerName}`);
    }
  } catch (err) {
    console.warn(`⚠️ [saveReviewToCloud] Exception:`, err);
  }
  */
}

/**
 * Load all services for quotes.
 * Catalog + pricing from vendor_rate_chunks only (preferred_vendor_rank = 1).
 * proposal_chunks is NOT used.
 */
export async function loadAllServicesFromCloud(): Promise<any[]> {
  try {
    console.log('☁️ [loadAllServicesFromCloud] vendor_rate_chunks rank=1 only (proposal_chunks DISABLED)');

    const { loadVendorRatesFromCloud, vendorRatesToDbServices } = await import('./vendorRateService');
    const vendorRates = await loadVendorRatesFromCloud();
    const services = vendorRatesToDbServices(vendorRates);

    console.log(`✅ Loaded ${services.length} services from vendor_rate_chunks (rank=1)`);
    return services;
  } catch (error) {
    console.error('❌ Exception loading services:', error);
    throw error;
  }
}

/**
 * Build spec page text for Metro-style services (Metro Train Inside Branding, etc.)
 * that store rich coach-by-coach data in metadata.specifications.
 *
 * Output format understood by extractMetroMultiTableSpec in ReferenceImages.tsx:
 *   DESIGN SPECIFICATION
 *   INTERIOR TRAIN DIMENSIONS ( WX H )
 *   Type of Media | Size (Inches) | Qty
 *   Card | 12.75 x18.75 inches | 68
 *   ...
 *    | Total Media | 79
 *   Card Material Area | Card Display Area
 *   18.75 x 12.75 | 17.75 x 11.75
 *   Coach-1 - Ladies Coach
 *   Type of Media | Size (Inches) | Qty
 *   Cards | 12.75 x 18.75 | 14
 *   ...
 *
 * Returns null when specs has no coach-entry keys → non-metro services are unaffected.
 */
export function buildMetroSpecText(specs: Record<string, unknown>): string | null {
  // Detect coach-style: at least one "coach_N..." key that holds an entry object
  const COACH_RE = /^coach_(\d+)/;
  const hasCoachEntries = Object.entries(specs).some(
    ([k, v]) =>
      COACH_RE.test(k) &&
      v && typeof v === 'object' && !Array.isArray(v) &&
      'type_of_media' in (v as object),
  );
  if (!hasCoachEntries) return null;

  type Item = {
    key: string;
    coachNum: string;
    type_of_media: string;
    size_in_inches: string;
    qty: number;
  };

  const items: Item[] = [];
  for (const [key, val] of Object.entries(specs)) {
    if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
    const e = val as Record<string, unknown>;
    if (!e.type_of_media || !e.size_in_inches) continue;

    const coachMatch = key.match(/^coach_(\d+)/);
    // driver_door_sticker is physically in Coach-4 per standard metro layout
    const coachNum = coachMatch ? coachMatch[1]
      : key === 'driver_door_sticker' ? '4'
      : null;
    if (!coachNum) continue;

    items.push({
      key,
      coachNum,
      type_of_media: String(e.type_of_media),
      size_in_inches: String(e.size_in_inches),
      qty: Number(e.qty) || 0,
    });
  }
  if (items.length === 0) return null;

  // ── Summary: INTERIOR TRAIN DIMENSIONS ──────────────────────────────────
  // Aggregate by normalised size; display as "Card" / "Sticker" generic labels
  // (matching the screenshot where connector stickers also show as "Sticker")
  const normalizeSize = (s: string) =>
    s.replace(/\s/g, '').replace(/\*/g, 'x').toLowerCase();

  const aggMap = new Map<string, { label: string; size: string; qty: number }>();
  for (const item of items) {
    const aggLabel = /^cards?$/i.test(item.type_of_media) ? 'Card' : 'Sticker';
    const normSize = normalizeSize(item.size_in_inches);
    const aggKey = `${aggLabel}||${normSize}`;
    const existing = aggMap.get(aggKey);
    if (existing) {
      existing.qty += item.qty;
    } else {
      const dispSize = item.size_in_inches.replace(/\s*inches\s*/i, '').trim() + ' inches';
      aggMap.set(aggKey, { label: aggLabel, size: dispSize, qty: item.qty });
    }
  }

  // Sort: Card first; within Sticker sort by qty descending
  const summaryRows = [...aggMap.values()].sort((a, b) => {
    if (a.label === 'Card' && b.label !== 'Card') return -1;
    if (a.label !== 'Card' && b.label === 'Card') return 1;
    return b.qty - a.qty;
  });
  const totalQty = summaryRows.reduce((s, r) => s + r.qty, 0);

  const lines: string[] = [
    'DESIGN SPECIFICATION',
    'INTERIOR TRAIN DIMENSIONS ( WX H )',
    'Type of Media | Size (Inches) | Qty',
    ...summaryRows.map(r => `${r.label} | ${r.size} | ${r.qty}`),
    ` | Total Media | ${totalQty}`,
  ];

  // ── Card Material Area / Card Display Area ───────────────────────────────
  const cardMaterial = specs['card_material_area'];
  const cardDisplay  = specs['card_display_area'];
  if (cardMaterial && cardDisplay) {
    lines.push(`Card Material Area | Card Display Area`);
    lines.push(`${cardMaterial} | ${cardDisplay}`);
  }

  // ── Per-coach tables ─────────────────────────────────────────────────────
  const coachNums = [...new Set(items.map(i => i.coachNum))].sort(
    (a, b) => Number(a) - Number(b),
  );

  for (const num of coachNums) {
    const coachItems = items.filter(i => i.coachNum === num);

    // Base key: starts with coach_N, does NOT end with _stickers / _connector_stickers
    const baseKey = coachItems
      .map(i => i.key)
      .filter(
        k =>
          k.startsWith(`coach_${num}`) &&
          !k.endsWith('_stickers') &&
          !k.endsWith('_connector_stickers'),
      )
      .sort((a, b) => a.length - b.length)[0]; // shortest = most generic

    let heading: string;
    if (baseKey) {
      const sub = baseKey
        .replace(new RegExp(`^coach_${num}`), '')
        .replace(/^_/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
      heading = sub ? `Coach-${num} - ${sub}` : `Coach-${num}`;
    } else {
      heading = `Coach-${num}`;
    }

    lines.push(heading);
    lines.push('Type of Media | Size (Inches) | Qty');
    for (const item of coachItems) {
      const type =
        item.key === 'driver_door_sticker' ? 'Driver Door - Sticker' : item.type_of_media;
      lines.push(`${type} | ${item.size_in_inches} | ${item.qty}`);
    }
  }

  return lines.join('\n');
}

/**
 * Build spec page text for Metro Elevator / Elevated Metro Station services only.
 * Detected by metadata.specifications.monthly_average_passenger_footfall being a
 * nested object (blue_line_stations, green_line_stations, etc.).
 *
 * Footfall + operational fields are placed BEFORE "DESIGN SPECIFICATION" so
 * extractDesignSpecFields treats them as a context group (MONTHLY AVERAGE PASSENGER FOOTFALL).
 *
 * Returns null for all other services — no impact on coach metro, auto, LED, etc.
 */
function formatSpecKeyLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function buildElevatedMetroSpecText(specs: Record<string, unknown>): string | null {
  const footfall = specs['monthly_average_passenger_footfall'];
  if (!footfall || typeof footfall !== 'object' || Array.isArray(footfall)) {
    return null;
  }

  const lines: string[] = ['MONTHLY AVERAGE PASSENGER FOOTFALL'];

  for (const [k, v] of Object.entries(footfall as Record<string, unknown>)) {
    if (v === null || v === undefined || String(v).trim() === '') continue;
    lines.push(`${formatSpecKeyLabel(k)}: ${v}`);
  }

  const SKIP_KEYS = new Set(['monthly_average_passenger_footfall', 'interior_dimensions']);
  for (const [k, v] of Object.entries(specs)) {
    if (SKIP_KEYS.has(k)) continue;
    if (v === null || v === undefined || String(v).trim() === '') continue;
    if (typeof v === 'object') continue;
    lines.push(`${formatSpecKeyLabel(k)}: ${v}`);
  }

  lines.push('DESIGN SPECIFICATION');
  return lines.join('\n');
}

/**
 * Convert a raw size/material string into one or more "Label: value" lines that
 * extractDesignSpecFields can parse.
 *
 * Three input formats are handled:
 *  A) "Left side: 18"x18, Right side: 18x18, Back side: 44x20"  ← comma + label-colon
 *     → split on ", <Label>:" → each part becomes its own line
 *  B) "Left side\n18"x18\nRight side\n18x18"  ← newline-separated (raw PDF text)
 *     → rejoin pairs of (label, value) lines using ":" separator
 *  C) "18x18 (wxh) inches"  ← flat value with no labels at all
 *     → prefix with the provided fallbackLabel so the parser always sees a colon entry
 *
 * Without this function the parser receives lines like "18x18 inches" with no colon and
 * silently drops them, causing the entire Display Specification section to vanish.
 */
function splitSpecString(raw: string, fallbackLabel = 'Size'): string {
  if (!raw.trim()) return '';

  // ── Format A: comma-separated "Label: value, Label: value" ──────────────────
  if (/,\s*[A-Za-z][A-Za-z0-9 ]*:/.test(raw)) {
    const parts = raw.split(/,\s*(?=[A-Za-z][A-Za-z0-9 ]*:)/);
    return parts.map(p => p.trim()).filter(Boolean).join('\n');
  }

  // ── Format B: newline-separated, alternating label/value lines ───────────────
  if (/\n/.test(raw)) {
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const result: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const cur = lines[i];
      const next = lines[i + 1];
      // Already has "Label: value" on one line → keep as-is
      if (/^[^:]{1,50}:\s*.+/.test(cur)) {
        result.push(cur);
        continue;
      }
      // Tab-separated "Label\tValue" on one line
      if (cur.includes('\t')) {
        const [lbl, ...rest] = cur.split('\t');
        result.push(`${lbl.trim()}: ${rest.join(' ').trim()}`);
        continue;
      }
      // Standalone label (no colon, no digit) + next line is the value (has digits or is short)
      if (!/\d/.test(cur) && cur.length <= 30 && next && !/^[^:]{1,50}:/.test(next)) {
        result.push(`${cur}: ${next}`);
        i++; // consume the value line
        continue;
      }
      result.push(cur);
    }
    return result.filter(Boolean).join('\n');
  }

  // ── Format C: flat string with no labels ─────────────────────────────────────
  // Ensure the parser always finds at least one "Label: value" entry.
  return raw.includes(':') ? raw : `${fallbackLabel}: ${raw}`;
}

/**
 * Transform vendor_rate_chunks (as DbService) data to ExtractedPage format
 * Converts cloud service records into preview-ready page objects
 */
export function transformServicesToPages(services: any[]): any[] {
  console.log(`🔄 Transforming ${services.length} services to page format...`);

  // Map DB image type enum → exact heading keyword that ReferenceImages component expects.
  // getRefImagePages()  checks for 'reference image'
  // REVIEW_HEADING_PATTERN checks for 'customer review feedback'
  // extractSpecSectionImage checks for 'design specification'
  const headingMap: Record<string, string> = {
    'reference':     'REFERENCE IMAGE',
    'review':        'CUSTOMER REVIEW FEEDBACK FOR OUR SERVICE',
    'specification': 'DESIGN SPECIFICATION',
  };
  
  const pages: any[] = [];
  
  services.forEach((service) => {
    // metadata.images is Array<{ url, type, pageNumber }>
    const images: Array<{ url: string; type: string; pageNumber?: number }> = service.metadata?.images || [];
    const locations = service.metadata?.locations || ['General'];
    const city = (locations[0] || 'General').toLowerCase();

    if (images.length > 0) {
      images.forEach((img) => {
        const imageType = img.type || 'reference';
        // Prefix text with correct section heading so ReferenceImages keyword checks work.
        // Format: "<HEADING>\n<SERVICE NAME>\n<DESCRIPTION>"
        // For review pages: if metadata.review exists (saved after first OCR), use real reviewer
        // text so extractCustomerReview() gets the right data without any Gemini call.
        const headingPrefix = headingMap[imageType] || 'REFERENCE IMAGE';
        let pageText: string;
        if (imageType === 'review' && service.metadata?.review) {
          const r = service.metadata.review;
          // Format matches what extractCustomerReview() expects:
          // "CUSTOMER REVIEW FEEDBACK FOR OUR SERVICE\n<reviewerName>\n<reviewText>"
          pageText = `${headingPrefix}\n${r.reviewerName}\n${'★'.repeat(Math.min(5, r.starCount || 5))}\n${r.reviewText}`;
          console.log(`☁️ [REVIEW-FROM-DB] "${service.service_name}": ${r.reviewerName}`);
        } else if (imageType === 'specification') {
          const m2 = service.metadata || {};
          const specsObj = m2.specifications && typeof m2.specifications === 'object'
            ? (m2.specifications as Record<string, unknown>)
            : null;
          const metroPageText = specsObj ? buildMetroSpecText(specsObj) : null;
          const elevatedPageText = !metroPageText && specsObj
            ? buildElevatedMetroSpecText(specsObj)
            : null;

          if (metroPageText) {
            pageText = metroPageText;
            console.log(`🚇 [METRO-SPEC] Using metro spec text for "${service.service_name}" (spec image path)`);
          } else if (elevatedPageText) {
            pageText = elevatedPageText;
            console.log(`🛗 [ELEVATED-METRO-SPEC] Using elevated metro spec for "${service.service_name}"`);
          } else {
            // Flat size / material (all other services)
            const sizeLines = m2.size
              ? typeof m2.size === 'object'
                ? Object.entries(m2.size).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('\n')
                : splitSpecString(String(m2.size), 'Size')
              : '';
            const materialVal = pickMaterialFromMeta(m2 as Record<string, unknown>);
            const materialLines = materialVal
              ? formatMaterialSpecLines(materialVal, splitSpecString)
              : '';
            const dimensionLines = formatDisplayDimensionSpecLines(m2 as Record<string, unknown>);
            const designDetailLines = formatDesignSpecificationDetailLines(
              m2 as Record<string, unknown>,
            );
            // Flat specifications fallback when size+material+dimensions+design details are all absent
            const flatSpecLines = (!sizeLines && !materialLines && !dimensionLines && !designDetailLines &&
              m2.specifications && typeof m2.specifications === 'object' &&
              !Array.isArray(m2.specifications))
              ? Object.entries(m2.specifications as Record<string, unknown>)
                  .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '' && typeof v !== 'object')
                  .map(([k, v]) => {
                    const label = k
                      .replace(/_/g, ' ')
                      .replace(/\b\w/g, c => c.toUpperCase());
                    return `${label}: ${v}`;
                  })
                  .join('\n')
              : '';
            // Do NOT include service.service_name in the spec body — short word-only
            // lines are orphan-merged into the first dimension label by the parser.
            pageText = [
              headingPrefix,
              dimensionLines,
              designDetailLines,
              sizeLines,
              materialLines,
              flatSpecLines,
            ]
              .filter(Boolean).join('\n');
          }
        } else {
          pageText = `${headingPrefix}\n${service.service_name}\n${service.content || ''}`;
        }

        pages.push({
          pageNumber: img.pageNumber || pages.length + 1,
          text: pageText,
          imageDataUrl: img.url,
          croppedImages: [img.url],
          croppedImagesWithTypes: [{ dataUrl: img.url, imageType }],
          imageType,
          sourceId: service.id,
          sourceName: service.document_name || 'Cloud Rate Card',
          serviceName: service.service_name,
          serviceId: service.service_id,
          city,
          metadata: service.metadata,
        });
      });

      // Fallback: if no review-type image but metadata.review exists, inject a synthetic review page.
      const hasReviewImage = images.some((img) => img.type === 'review');
      if (!hasReviewImage && service.metadata?.review) {
        const r = service.metadata.review;
        const reviewText = [
          'CUSTOMER REVIEW FEEDBACK FOR OUR SERVICE',
          r.reviewerName || 'Customer',
          '★'.repeat(Math.min(5, r.starCount || 5)),
          r.reviewText || '',
        ].join('\n');
        const reviewImgUrl = images.find((img) => img.type === 'reference')?.url || '';
        pages.push({
          pageNumber: pages.length + 1,
          text: reviewText,
          imageDataUrl: reviewImgUrl,
          croppedImages: reviewImgUrl ? [reviewImgUrl] : [],
          croppedImagesWithTypes: reviewImgUrl ? [{ dataUrl: reviewImgUrl, imageType: 'review' }] : [],
          imageType: 'review',
          sourceId: service.id,
          sourceName: service.document_name || 'Cloud Rate Card',
          serviceName: service.service_name,
          serviceId: service.service_id,
          city,
          metadata: service.metadata,
        });
        console.log(`⭐ [REVIEW-FALLBACK] Synthetic review page for "${service.service_name}": ${r.reviewerName}`);
      }

      // Fallback: if no specification-type image exists but metadata has size/material data,
      // inject a synthetic text-only spec page so the Display Specification section renders.
      // This covers services like Auto Semi Branding that only have reference + review images.
      const hasSpecImage = images.some(img => img.type === 'specification');
      if (!hasSpecImage) {
        const m = service.metadata || {};

        const specsObj = m.specifications && typeof m.specifications === 'object'
          ? (m.specifications as Record<string, unknown>)
          : null;
        const metroText = specsObj ? buildMetroSpecText(specsObj) : null;
        const elevatedText = !metroText && specsObj
          ? buildElevatedMetroSpecText(specsObj)
          : null;

        if (metroText) {
          pages.push({
            pageNumber: pages.length + 1,
            text: metroText,
            imageDataUrl: '',
            croppedImages: [],
            croppedImagesWithTypes: [],
            imageType: 'specification',
            sourceId: service.id,
            sourceName: service.document_name || 'Cloud Rate Card',
            serviceName: service.service_name,
            serviceId: service.service_id,
            city,
            metadata: service.metadata,
          });
          console.log(`🚇 [METRO-SPEC] Created metro spec page for "${service.service_name}"`);
        } else if (elevatedText) {
          pages.push({
            pageNumber: pages.length + 1,
            text: elevatedText,
            imageDataUrl: '',
            croppedImages: [],
            croppedImagesWithTypes: [],
            imageType: 'specification',
            sourceId: service.id,
            sourceName: service.document_name || 'Cloud Rate Card',
            serviceName: service.service_name,
            serviceId: service.service_id,
            city,
            metadata: service.metadata,
          });
          console.log(`🛗 [ELEVATED-METRO-SPEC] Created elevated metro spec page for "${service.service_name}"`);
        } else {
          // ── Flat size / material fallback (all other services) ──────────────
          const sizeLines = m.size
            ? typeof m.size === 'object'
              ? Object.entries(m.size).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('\n')
              : splitSpecString(String(m.size), 'Size')
            : '';
          const materialVal = pickMaterialFromMeta(m as Record<string, unknown>);
          const materialLines = materialVal
            ? formatMaterialSpecLines(materialVal, splitSpecString)
            : '';
          const dimensionLines = formatDisplayDimensionSpecLines(m as Record<string, unknown>);
          const designDetailLines = formatDesignSpecificationDetailLines(
            m as Record<string, unknown>,
          );

          // ── Flat specifications object fallback (e.g. LED Hoardings) ─────────
          // When size AND material AND dimensions AND design details are all absent,
          // convert metadata.specifications (a plain key→value map) into "Label: value"
          // lines so the spec section still renders for services like LED Hoardings.
          const flatSpecLines = (!sizeLines && !materialLines && !dimensionLines && !designDetailLines &&
            m.specifications && typeof m.specifications === 'object' &&
            !Array.isArray(m.specifications))
            ? Object.entries(m.specifications as Record<string, unknown>)
                .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '' && typeof v !== 'object')
                .map(([k, v]) => {
                  const label = k
                    .replace(/_/g, ' ')
                    .replace(/\b\w/g, c => c.toUpperCase());
                  return `${label}: ${v}`;
                })
                .join('\n')
            : '';

          const specBody = [
            dimensionLines,
            designDetailLines,
            sizeLines,
            materialLines,
            flatSpecLines,
          ].filter(Boolean).join('\n');
          if (specBody.trim()) {
            const syntheticText = ['DESIGN SPECIFICATION', specBody].join('\n');
            pages.push({
              pageNumber: pages.length + 1,
              text: syntheticText,
              imageDataUrl: '',
              croppedImages: [],
              croppedImagesWithTypes: [],
              imageType: 'specification',
              sourceId: service.id,
              sourceName: service.document_name || 'Cloud Rate Card',
              serviceName: service.service_name,
              serviceId: service.service_id,
              city,
              metadata: service.metadata,
            });
            console.log(`📐 [SPEC-FALLBACK] Created synthetic spec page for "${service.service_name}" (size/material/design details from metadata)`);
          }
        }
      }
    } else {
      // No images[] — still build pages from vendor metadata fallbacks
      const m = service.metadata || {};
      const refUrl = typeof m.reference_image === 'string' ? m.reference_image : '';
      const reviewUrl = typeof m.customer_review === 'string' ? m.customer_review : '';
      const specsObj = m.specifications && typeof m.specifications === 'object'
        ? (m.specifications as Record<string, unknown>)
        : null;

      if (refUrl) {
        pages.push({
          pageNumber: pages.length + 1,
          text: `REFERENCE IMAGE\n${service.service_name}\n${service.content || ''}`,
          imageDataUrl: refUrl,
          croppedImages: [refUrl],
          croppedImagesWithTypes: [{ dataUrl: refUrl, imageType: 'reference' }],
          imageType: 'reference',
          sourceId: service.id,
          sourceName: service.document_name || 'Cloud Rate Card',
          serviceName: service.service_name,
          serviceId: service.service_id,
          city,
          metadata: service.metadata,
        });
      }

      const metroText = specsObj ? buildMetroSpecText(specsObj) : null;
      const elevatedText = !metroText && specsObj ? buildElevatedMetroSpecText(specsObj) : null;
      if (metroText || elevatedText) {
        pages.push({
          pageNumber: pages.length + 1,
          text: metroText || elevatedText,
          imageDataUrl: '',
          croppedImages: [],
          croppedImagesWithTypes: [],
          imageType: 'specification',
          sourceId: service.id,
          sourceName: service.document_name || 'Cloud Rate Card',
          serviceName: service.service_name,
          serviceId: service.service_id,
          city,
          metadata: service.metadata,
        });
        console.log(`🚇 [METRO-SPEC] Created metro spec page (no images[]) for "${service.service_name}"`);
      }

      if (m.review || reviewUrl) {
        const r = m.review || {};
        const reviewText = m.review
          ? `CUSTOMER REVIEW FEEDBACK FOR OUR SERVICE\n${r.reviewerName || ''}\n${'★'.repeat(Math.min(5, r.starCount || 5))}\n${r.reviewText || ''}`
          : `CUSTOMER REVIEW FEEDBACK FOR OUR SERVICE\n${service.service_name}`;
        pages.push({
          pageNumber: pages.length + 1,
          text: reviewText,
          imageDataUrl: reviewUrl || '',
          croppedImages: reviewUrl ? [reviewUrl] : [],
          croppedImagesWithTypes: reviewUrl ? [{ dataUrl: reviewUrl, imageType: 'review' }] : [],
          imageType: 'review',
          sourceId: service.id,
          sourceName: service.document_name || 'Cloud Rate Card',
          serviceName: service.service_name,
          serviceId: service.service_id,
          city,
          metadata: service.metadata,
        });
      }

      if (!refUrl && !metroText && !elevatedText && !m.review && !reviewUrl) {
        console.warn(`⚠️ Service "${service.service_name}" has no images/specs in vendor metadata`);
      }
    }
  });
  
  // ── CLOUD DATA SOURCE CONFIRMATION ──────────────────────────────────────
  const refCount  = pages.filter(p => p.imageType === 'reference').length;
  const specCount = pages.filter(p => p.imageType === 'specification').length;
  const revCount  = pages.filter(p => p.imageType === 'review').length;
  console.log('☁️ ═══════════════════════════════════════════════════');
  console.log('☁️  DATA SOURCE: CLOUD (vendor_rate_chunks rank=1 only; proposal_chunks DISABLED)');
  console.log(`☁️  Services loaded : ${services.length}`);
  console.log(`☁️  Total pages     : ${pages.length}`);
  console.log(`☁️    Reference     : ${refCount}`);
  console.log(`☁️    Specification : ${specCount}`);
  console.log(`☁️    Review        : ${revCount}`);
  console.log('☁️  All images are Supabase URLs — no IndexedDB used');
  console.log('☁️ ═══════════════════════════════════════════════════');
  
  return pages;
}
