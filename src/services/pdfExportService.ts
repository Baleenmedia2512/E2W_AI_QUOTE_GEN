/**
 * pdfExportService.ts  (React-PDF version)
 *
 * Replaces the html2canvas + jsPDF pipeline with @react-pdf/renderer.
 *
 * Flow (NEW — DB-first):
 *  1. QuotePreviewPage calls exportToPDF(..., documentIds)
 *  2. We query proposal_chunks from Supabase for those documentIds
 *  3. Build pdfData[] directly from metadata.images (already uploaded at PDF-upload time)
 *  4. Falls back to DOM store (ReferenceImages) if DB has no images for a service
 *  5. Render CorporateMinimalPDF to a blob — zero Gemini calls
 *  6. Mobile: save to Documents + open in native viewer
 *  7. Web: browser download
 */

import React from 'react';
import { pdf } from '@react-pdf/renderer';
import { TemplateType } from '../types';
import { TemplateData } from '../types/template';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import CorporateMinimalPDF, { ServicePdfData } from '../components/Templates/CorporateMinimalPDF';
import { supabase } from './supabaseClient';

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
      `${idx + 1}. key="${entry.serviceKey}" | ref=${entry.refImages?.length || 0} | specImg=${entry.specImages?.length || 0} | specFields=${entry.specFields?.length || 0} | review=${entry.review ? 'yes' : 'no'}`,
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

/**
 * Fetch pdfData from Supabase proposal_chunks for the given document IDs.
 * Reads metadata.images (typed reference/specification/review URLs uploaded at PDF-upload time).
 * Returns empty array if DB has no data — caller falls back to DOM store.
 */
const fetchPdfDataFromDB = async (documentIds: string[]): Promise<ServicePdfData[]> => {
  if (!documentIds || documentIds.length === 0) return [];
  try {
    const { data, error } = await supabase
      .from('proposal_chunks')
      .select('service_id, service_name, metadata')
      .in('document_id', documentIds);

    if (error || !data || data.length === 0) {
      console.warn('[PDF-DB] No chunks found for documentIds:', documentIds, error?.message);
      return [];
    }

    console.log(`[PDF-DB] Loaded ${data.length} chunks from DB for ${documentIds.length} document(s)`);

    return data.map((row: any): ServicePdfData => {
      const images: Array<{ url: string; type: string }> = row.metadata?.images || [];
      const refImages = images.filter((img) => img.type === 'reference').map((img) => img.url);
      const specImages = images.filter((img) => img.type === 'specification').map((img) => img.url);
      const review = row.metadata?.review ?? null;

      // Flatten specification fields from metadata
      const specFields: Array<{ label: string; value: string }> = [];
      const specs = row.metadata?.specifications;
      if (specs && typeof specs === 'object') {
        for (const [label, value] of Object.entries(specs)) {
          if (typeof value === 'string' && value) {
            specFields.push({ label, value });
          }
        }
      }

      // serviceKey must match the key used in CorporateMinimalPDF grouping:
      // city|serviceType or just serviceType (all lowercase)
      const serviceKey = row.service_id as string;

      console.log(`[PDF-DB] ${serviceKey}: ref=${refImages.length} spec=${specImages.length} review=${review ? 'yes' : 'no'}`);
      if (refImages.length > 0) {
        console.log(`[PDF-DB]   refImages[0] URL: ${refImages[0]}`);
        // Probe actual pixel dimensions (fire-and-forget, non-blocking)
        const img = new window.Image();
        img.onload = () => {
          console.log(`[PDF-DB]   ✅ refImages[0] actual dimensions: ${img.naturalWidth}×${img.naturalHeight}px  aspect=${(img.naturalWidth/img.naturalHeight).toFixed(2)}:1`);
          if (img.naturalHeight < 100) {
            console.warn(`[PDF-DB]   ⚠️ IMAGE IS A THIN STRIP — height only ${img.naturalHeight}px! Source crop saved at upload time is wrong.`);
          }
        };
        img.onerror = () => console.error(`[PDF-DB]   ❌ Failed to load image: ${refImages[0]}`);
        img.src = refImages[0];
      }

      return { serviceKey, refImages, specImages, specFields, review };
    });
  } catch (err) {
    console.error('[PDF-DB] fetchPdfDataFromDB failed:', err);
    return [];
  }
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
  documentIds?: string[],      // NEW: proposal document IDs to load images from DB
): Promise<void> => {
  const originalCursor = document.body.style.cursor;
  document.body.style.cursor = 'wait';

  try {
    const templateData = readTemplateDataFromDom();
    if (!templateData) {
      throw new Error('Template data not found. Please wait for the preview to load.');
    }

    // Try DB first (fast, no Gemini calls)
    let pdfData: ServicePdfData[] = [];
    if (documentIds && documentIds.length > 0) {
      console.log('[PDF-EXPORT] Fetching images from DB for documentIds:', documentIds);
      pdfData = await fetchPdfDataFromDB(documentIds);
    }

    // Fall back to DOM store (ReferenceImages) if DB had no data.
    // When DB has data, still let the DOM bridge override images because it can
    // reject bad/tight stored reference crops at preview time.
    if (pdfData.length === 0) {
      console.log('[PDF-EXPORT] DB empty — falling back to DOM store (waitForPdfReady)');
      await waitForPdfReady();
      await new Promise((r) => setTimeout(r, 80));
      pdfData = readPdfDataFromDom();
    } else {
      console.log(`[PDF-EXPORT] DB returned ${pdfData.length} service(s) — checking DOM bridge for corrected images`);
      await waitForPdfReady();
      await new Promise((r) => setTimeout(r, 80));
      const domData = readPdfDataFromDom();
      if (domData.length > 0) {
        const domByKey = new Map(domData.map((entry) => [entry.serviceKey, entry]));
        pdfData = pdfData.map((dbEntry) => {
          const domEntry = domByKey.get(dbEntry.serviceKey);
          if (!domEntry) return dbEntry;
          const useDomRefs = (domEntry.refImages?.length ?? 0) > 0;
          const useDomSpecs = (domEntry.specImages?.length ?? 0) > 0;
          console.log(
            `[PDF-EXPORT] Merge ${dbEntry.serviceKey}: refs=${useDomRefs ? 'DOM' : 'DB'} specs=${useDomSpecs ? 'DOM' : 'DB'}`,
          );
          return {
            ...dbEntry,
            refImages: useDomRefs ? domEntry.refImages : dbEntry.refImages,
            specImages: useDomSpecs ? domEntry.specImages : dbEntry.specImages,
            specFields: domEntry.specFields?.length ? domEntry.specFields : dbEntry.specFields,
            review: domEntry.review ?? dbEntry.review,
          };
        });
      } else {
        console.log('[PDF-EXPORT] DOM bridge empty — using DB images');
      }
    }

    debugSummarizePdfData(pdfData);
    await debugProbeImageSources(pdfData);

    // Pre-fetch all images as base64 — fixes React-PDF worker CORS/fetch issues
    // and gives us full diagnostics before render
    console.log('[PDF-EXPORT] Pre-fetching images as base64...');
    pdfData = await prefetchImagesToBase64(pdfData);
    console.log('[PDF-EXPORT] Pre-fetch complete. Rendering PDF...');

    // Render to blob using React-PDF
    const doc = React.createElement(CorporateMinimalPDF, { data: templateData, pdfData }) as any;
    const blob = await pdf(doc).toBlob();

    // Generate filename
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const clientStr = (clientName || '').replace(/\s+/g, '');
    const filename = `${dateStr}_${clientStr}_${quoteNumber}.pdf`;

    if (isMobile()) {
      // ── Mobile: save to Documents folder and open ──────────────────
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
      );
      const result = await Filesystem.writeFile({
        path: `QuoteBuddy/${filename}`,
        data: base64,
        directory: Directory.Documents,
        recursive: true,
      });
      await FileOpener.open({ filePath: result.uri, contentType: 'application/pdf' });
    } else {
      // ── Web: browser download ───────────────────────────────────────
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  } finally {
    document.body.style.cursor = originalCursor;
  }
};
