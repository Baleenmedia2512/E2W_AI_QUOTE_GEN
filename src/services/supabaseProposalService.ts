/**
 * Supabase Proposal Service - Cloud Storage for Shared Proposals
 * Enables team-wide visibility of uploaded proposals
 */

import { supabase } from './supabaseClient';
import { StoredProposal } from '../types';

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
    // Get current user if not provided (optional - works without auth)
    let currentUserId = userId || 'anonymous';
    let currentUserName = userName || 'App User';

    // Try to get authenticated user, but don't fail if not authenticated
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        currentUserId = user.id;
        currentUserName = user.email || 'Authenticated User';
        console.log('✅ Authenticated user:', currentUserId, currentUserName);
      } else {
        console.log('ℹ️ No auth session, using anonymous upload');
      }
    } catch (authError) {
      // Auth failed - continue with anonymous upload
      console.log('ℹ️ Auth check failed, continuing with anonymous upload');
    }

    // Create storage path: user_id/timestamp_filename
    const timestamp = Date.now();
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${currentUserId}/${timestamp}_${sanitizedFileName}`;

    // Upload file to Supabase Storage
    console.log('📤 Uploading file to Supabase Storage:', storagePath);
    const { error: uploadError } = await supabase.storage
      .from('proposals')
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      console.error('❌ Storage upload error:', uploadError);
      return { success: false, error: uploadError.message };
    }

    // Get public URL for the file
    const { data: urlData } = supabase.storage
      .from('proposals')
      .getPublicUrl(storagePath);

    const fileUrl = urlData.publicUrl;

    // Save metadata to database
    console.log('💾 Saving proposal metadata to database, user_id:', currentUserId);
    const { data: proposalData, error: dbError } = await supabase
      .from('proposals')
      .insert({
        file_name: file.name,
        file_type: file.type || 'application/pdf',
        file_size: file.size,
        file_url: fileUrl,
        storage_path: storagePath,
        text_content: textContent,
        page_count: pageCount,
        uploaded_by_user_id: currentUserId,  // TEXT column accepts any string
        uploaded_by_name: currentUserName,
      })
      .select()
      .single();

    if (dbError) {
      console.error('❌ Database insert error:', dbError);
      // Cleanup: delete uploaded file
      await supabase.storage.from('proposals').remove([storagePath]);
      return { success: false, error: dbError.message };
    }

    console.log('✅ Proposal uploaded to cloud successfully');
    return { success: true, proposal: proposalData };
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
    console.log('📂 Loading proposals from cloud...');
    const { data, error } = await supabase
      .from('proposals')
      .select('*')
      .order('uploaded_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('❌ Error loading proposals from cloud:', error);
      return [];
    }

    console.log(`✅ Loaded ${data?.length || 0} proposals from cloud`);
    return data || [];
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
    const { data, error } = await supabase
      .from('proposals')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('❌ Error loading proposal:', error);
      return null;
    }

    return data;
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
    // Get proposal to find storage path
    const { data: proposal } = await supabase
      .from('proposals')
      .select('storage_path')
      .eq('id', id)
      .single();

    if (!proposal) {
      console.error('❌ Proposal not found');
      return false;
    }

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from('proposals')
      .remove([proposal.storage_path]);

    if (storageError) {
      console.warn('⚠️ Storage delete error:', storageError);
      // Continue anyway to delete database record
    }

    // Delete from database
    const { error: dbError } = await supabase
      .from('proposals')
      .delete()
      .eq('id', id);

    if (dbError) {
      console.error('❌ Database delete error:', dbError);
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
    const { data, error } = await supabase
      .from('proposals')
      .select('*')
      .eq('file_name', fileName)
      .eq('file_size', fileSize)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('❌ Error checking for duplicates:', error);
      return null;
    }

    if (data) {
      console.log('🔍 Found duplicate in cloud:', data.file_name);
    }

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
    const { data, error } = await supabase.storage
      .from('proposals')
      .download(storagePath);

    if (error) {
      console.error('❌ Error downloading file:', error);
      return null;
    }

    return data;
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
    const { error } = await supabase
      .from('proposals')
      .select('id')
      .limit(1);

    if (error) {
      console.warn('⚠️ Cloud storage unavailable:', error.message);
      return false;
    }

    console.log('☁️ Cloud storage available');
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
 * Called once after first OCR — subsequent renders use DB data (no extra API call).
 */
export async function saveReviewToCloud(
  serviceId: string,
  reviewData: { reviewerName: string; starCount: number; reviewText: string }
): Promise<void> {
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
}

/**
 * Load all services from proposal_chunks table (PRIMARY DATA SOURCE)
 * This is the cloud-first approach for fetching service data with images
 */
export async function loadAllServicesFromCloud(): Promise<any[]> {
  try {
    console.log('☁️ Querying proposal_chunks table...');
    
    const { data, error } = await supabase
      .from('proposal_chunks')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('❌ Error loading services from proposal_chunks:', error);
      throw error;
    }
    
    console.log(`✅ Loaded ${data?.length || 0} services from proposal_chunks`);
    return data || [];
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
function buildMetroSpecText(specs: Record<string, unknown>): string | null {
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
 * Transform proposal_chunks data to ExtractedPage format
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
            const materialLines = m2.material
              ? splitSpecString(String(m2.material), 'Material')
              : '';
            // Flat specifications fallback when size+material are both absent
            const flatSpecLines = (!sizeLines && !materialLines &&
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
            pageText = [headingPrefix, sizeLines, materialLines, flatSpecLines]
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
          const materialLines = m.material
            ? splitSpecString(String(m.material), 'Material')
            : '';

          // ── Flat specifications object fallback (e.g. LED Hoardings) ─────────
          // When size AND material are both absent, convert metadata.specifications
          // (a plain key→value map) into "Label: value" lines so the spec section
          // still renders for services like LED Hoardings that store operational
          // data (creative_duration, operations_timing, etc.) only in specifications.
          const flatSpecLines = (!sizeLines && !materialLines &&
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

          const specBody = [sizeLines, materialLines, flatSpecLines].filter(Boolean).join('\n');
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
            console.log(`📐 [SPEC-FALLBACK] Created synthetic spec page for "${service.service_name}" (size/material from metadata)`);
          }
        }
      }
    } else {
      console.warn(`⚠️ Service "${service.service_name}" has no images in metadata`);
    }
  });
  
  // ── CLOUD DATA SOURCE CONFIRMATION ──────────────────────────────────────
  const refCount  = pages.filter(p => p.imageType === 'reference').length;
  const specCount = pages.filter(p => p.imageType === 'specification').length;
  const revCount  = pages.filter(p => p.imageType === 'review').length;
  console.log('☁️ ═══════════════════════════════════════════════════');
  console.log('☁️  DATA SOURCE: CLOUD (Supabase proposal_chunks)');
  console.log(`☁️  Services loaded : ${services.length}`);
  console.log(`☁️  Total pages     : ${pages.length}`);
  console.log(`☁️    Reference     : ${refCount}`);
  console.log(`☁️    Specification : ${specCount}`);
  console.log(`☁️    Review        : ${revCount}`);
  console.log('☁️  All images are Supabase URLs — no IndexedDB used');
  console.log('☁️ ═══════════════════════════════════════════════════');
  
  return pages;
}
