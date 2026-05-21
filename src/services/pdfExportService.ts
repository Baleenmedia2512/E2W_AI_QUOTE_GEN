import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

import DownloadNotification from '../plugins/downloadNotification';
import { TemplateType } from '../types';
import { logger } from '../utils/logger';

// A4 dimensions at 96dpi (standard web resolution)
const A4_WIDTH_PX = 794;   // 210mm at 96dpi
const A4_HEIGHT_PX = 1123;  // 297mm at 96dpi
// Usable content height per page: A4 (1123px) minus top padding (50) + bottom padding (50) + footer height (~62px) + safety buffer (10px)
const PDF_USABLE_HEIGHT_PX = 951;
const PDF_FONT_FAMILY = "'Calibri'";
const PDF_FONT_LOAD_SPECS = [
  '400 14px Calibri',
  '700 14px Calibri',
];

/**
 * Unified PDF font-size system.
 *
 * Geometry recap: html2canvas captures the DOM at 794 CSS px wide and jsPDF
 * places it into A4 (210 mm), so 1 CSS px ≈ 0.75 pt in the final PDF.
 * Many templates declare body text at 9–11 px → 6.75–8.25 pt (unreadable).
 *
 * Strategy: just before capture, walk the off-screen clone and rewrite every
 * element's font-size to `clamp(MIN, computed × SCALE, MAX)` as an inline
 * !important style. Inline !important beats every template stylesheet, and
 * multiplying (instead of replacing) preserves the original hierarchy
 * (a 9 px caption stays smaller than a 28 px title).
 *
 * Effect (with the current tokens):
 *    9 px → 14 px (floor)   11 px → 16 px   13 px → 18.85 px
 *   16 px → 23.2 px         20 px → 29 px   28 px → 40.6 px
 * Translating to PDF points (× 0.75):
 *   body floor ≈ 10.5 pt    body ≈ 12 pt    titles ≈ 22–30 pt
 *
 * `.company-contact-footer` is excluded so the address + website still fit
 * on one line.
 */
const PDF_FONT_SCALE = 1.45;
const PDF_FONT_MIN_PX = 14;
const PDF_FONT_MAX_PX = 44;
// Subtrees whose font-size must stay exactly as the template CSS declared it.
// Includes the page-footer + every template's header/meta/client blocks so
// the top of the document looks identical to the original design.
const PDF_FONT_SKIP_SELECTOR = [
  // Footer (every template)
  '.company-contact-footer', '.company-contact-footer *',
  // ClassicBusiness header + meta + client block
  '.letterhead', '.letterhead *',
  '.company-contact-section', '.company-contact-section *',
  '.reference-section', '.reference-section *',
  '.client-section', '.client-section *',
  // CorporateMinimal header + client block
  '.template-header', '.template-header *',
  '.client-details', '.client-details *',
  // ModernSales header + info strip + parties (FROM/TO) block
  '.ms-header', '.ms-header *',
  '.ms-info-strip', '.ms-info-strip *',
  '.ms-parties', '.ms-parties *',
  // PremiumAgency header + info strip + parties block
  '.pa-header', '.pa-header *',
  '.pa-info-strip', '.pa-info-strip *',
  '.pa-parties', '.pa-parties *',
  // Bank details (keep small — CSS rules set 12px, don't scale up)
  '.bank-details-section', '.bank-details-section *',
].join(', ');

const normalizeFontSize = (node: HTMLElement): void => {
  if (typeof node.matches === 'function' && node.matches(PDF_FONT_SKIP_SELECTOR)) return;
  const computed = window.getComputedStyle(node).fontSize;
  const px = parseFloat(computed);
  if (!isFinite(px) || px <= 0) return;
  const scaled = Math.min(PDF_FONT_MAX_PX, Math.max(PDF_FONT_MIN_PX, px * PDF_FONT_SCALE));
  if (Math.abs(scaled - px) > 0.25) {
    node.style.setProperty('font-size', `${scaled.toFixed(2)}px`, 'important');
  }
};

const forcePdfFontInTree = (root: HTMLElement): void => {
  root.style.setProperty('font-family', PDF_FONT_FAMILY, 'important');
  root.style.setProperty('font-style', 'normal', 'important');
  normalizeFontSize(root);
  root.querySelectorAll<HTMLElement>('*').forEach((node) => {
    node.style.setProperty('font-family', PDF_FONT_FAMILY, 'important');
    node.style.setProperty('font-style', 'normal', 'important');
    normalizeFontSize(node);
  });
};

const enforcePdfFontInClonedDoc = (doc: Document): void => {
  const style = doc.createElement('style');
  style.textContent = `
    * {
      font-family: ${PDF_FONT_FAMILY} !important;
      font-style: normal !important;
      -webkit-text-size-adjust: 100% !important;
      text-size-adjust: 100% !important;
    }
  `;
  doc.head.appendChild(style);
};

const ensurePdfFontLoaded = async (): Promise<void> => {
  // Load target font once before capture to avoid device-specific fallback glyphs.
  if (!document.fonts) {
    return;
  }

  try {
    await Promise.all(PDF_FONT_LOAD_SPECS.map((spec) => document.fonts.load(spec)));
    await document.fonts.ready;
  } catch (error) {
    console.warn('Ã¢Å¡Â Ã¯Â¸Â PDF font preload failed, continuing with fallback fonts:', error);
  }
};

/** Represents a clickable link annotation to be overlaid on the PDF image */
interface LinkAnnotation {
  url: string;
  x: number; // CSS px from clone left edge
  y: number; // CSS px from clone top edge
  w: number; // CSS px
  h: number; // CSS px
}

// ---------------------------------------------------------------------------
// Smart Block-Based Pagination Ã¢â‚¬â€ Stage 1: Measurement Engine
// ---------------------------------------------------------------------------

/** A single semantic block measured within a PDF section clone */
interface MeasuredBlock {
  index: number;
  type: 'atomic' | 'table' | 'list' | 'header-group';
  height: number;       // px Ã¢â‚¬â€ content height from getBoundingClientRect
  marginBottom: number; // px Ã¢â‚¬â€ bottom spacing between this block and the next
  // Only present when type === 'table': per-row measurements for split pagination
  tableData?: {
    theadHeight: number;
    tfootHeight: number;
    rows: Array<{ height: number }>; // tbody rows only, in DOM order
  };
}

/** Describes which rows of a split table to render on one virtual page */
interface TableSegment {
  blockIndex: number;      // index into MeasuredBlock[] for the table block
  startRow: number;        // first tbody row to show (0-based, inclusive)
  endRow: number;          // last tbody row to show (inclusive)
  includesTfoot: boolean;  // whether to render tfoot on this segment
  isFirstSegment: boolean; // false Ã¢â€ â€™ context blocks before table removed in clone
}

/** A group of block indices that fit together on one physical PDF page */
interface VirtualPage {
  blockIndices: number[];
  totalContentHeight: number; // px Ã¢â‚¬â€ sum of (height + marginBottom) for all blocks on this page
  tableSegment?: TableSegment; // set when this page contains a partial table split
}

/**
 * Captures a specific section at fixed A4 dimensions for consistent PDF output
 */
const captureSectionAtA4 = async (
  containerId: string,
): Promise<{ canvas: HTMLCanvasElement; links: LinkAnnotation[] } | null> => {
  const source = document.getElementById(containerId);
  if (!source) {
    console.warn(`Ã¢Å¡Â Ã¯Â¸Â Section ${containerId} not found`);
    return null;
  }

  console.log(`Ã°Å¸â€œÂ¸ Capturing section: ${containerId}`);
  
  // Create off-screen clone at fixed A4 width
  const clone = source.cloneNode(true) as HTMLElement;

  Object.assign(clone.style, {
    position: 'fixed',
    top: '0px',
    left: `-${A4_WIDTH_PX + 100}px`,
    width: `${A4_WIDTH_PX}px`,
    minWidth: `${A4_WIDTH_PX}px`,
    maxWidth: `${A4_WIDTH_PX}px`,
    overflow: 'visible',
    margin: '0',
    boxSizing: 'border-box',
    backgroundColor: '#ffffff',
    display: 'block',
  });

  document.body.appendChild(clone);
  // Must run AFTER appendChild: getComputedStyle returns empty values for
  // detached elements, which would skip the font-size normalization.
  forcePdfFontInTree(clone);
  // Hide footer in the outer clone before html2canvas captures it.
  // compositeWithPageFooter re-renders the footer pinned to the A4 bottom,
  // so this is the only reliable way to prevent the duplicate page number.
  const cloneFooterEl = clone.querySelector<HTMLElement>('.company-contact-footer');
  if (cloneFooterEl) {
    cloneFooterEl.style.cssText += '; display: none !important; visibility: hidden !important;';
  }

  try {
    // Wait for fonts to load
    await document.fonts.ready;
    console.log('Ã¢Å“â€¦ Fonts loaded');
    
    // Wait for all images in the clone to load
    const images = Array.from(clone.querySelectorAll('img'));
    await Promise.all(
      images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve(); // Continue even if image fails
        });
      }),
    );
    console.log(`Ã¢Å“â€¦ ${images.length} images loaded`);

    // Wait for full reflow Ã¢â‚¬â€ longer delay ensures tfoot and all rows are painted
    await new Promise(r => setTimeout(r, 300));

    // Links are collected inside onclone so they are measured from the exact same
    // DOM (and after the exact same font/style application) that html2canvas renders.
    // This eliminates coordinate drift from measuring on the outer clone before
    // html2canvas applies its own internal style pass.
    // Footer links are excluded here — compositeWithPageFooter collects them
    // separately after it knows the footer rendered height.
    const LINK_Y_PAD = 3;
    const links: LinkAnnotation[] = [];

    // Capture with html2canvas at fixed A4 dimensions
    const captureHeight = Math.max(clone.scrollHeight, A4_HEIGHT_PX);
    const canvas = await html2canvas(clone, {
      scale: 2,
      width: A4_WIDTH_PX,
      windowWidth: A4_WIDTH_PX,
      windowHeight: 10000,
      scrollX: 0,
      scrollY: 0,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false,
      onclone: (doc, clonedEl) => {
        enforcePdfFontInClonedDoc(doc);
        // Collect links from the exact DOM html2canvas renders (after fonts + styles settled).
        // Skip footer links — they are collected separately in compositeWithPageFooter.
        const elRect = clonedEl.getBoundingClientRect();
        clonedEl.querySelectorAll('a[href]').forEach((a) => {
          if (a.closest('.company-contact-footer')) return;
          const href = a.getAttribute('href');
          if (!href) return;
          const r = a.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            links.push({
              url: href,
              x: r.left - elRect.left,
              y: (r.top - elRect.top) - LINK_Y_PAD,
              w: r.width,
              h: r.height + LINK_Y_PAD * 2,
            });
          }
        });
        console.log('[PDF] onclone (captureSectionAtA4): ' + links.length + ' links from ' + containerId);
      },
    });

    console.log(`Ã¢Å“â€¦ Section captured: ${canvas.width}x${canvas.height}px`);

    const { canvas: composited, footerLinks } = await compositeWithPageFooter(canvas, source);
    return { canvas: composited, links: [...links, ...footerLinks] };
  } catch (error) {
    console.error(`Ã¢ÂÅ’ Failed to capture ${containerId}:`, error);
    throw error;
  } finally {
    // Clean up clone
    document.body.removeChild(clone);
  }
};

/**
 * Composites a content canvas into a full A4-height canvas with the section's
 * company-contact-footer pinned to the very bottom.
 * Call this after every html2canvas capture (both captureSectionAtA4 and captureVirtualPage)
 * so that every PDF page has a consistent footer at the bottom and white space between.
 */
const compositeWithPageFooter = async (
  contentCanvas: HTMLCanvasElement,
  sectionEl: HTMLElement
): Promise<{ canvas: HTMLCanvasElement; footerLinks: LinkAnnotation[] }> => {
  const SCALE = 2;
  const origFooterEl = sectionEl.querySelector<HTMLElement>('.company-contact-footer');
  if (!origFooterEl) return { canvas: contentCanvas, footerLinks: [] };

  // Clone footer into an off-screen position for isolated capture
  const footerClone = origFooterEl.cloneNode(true) as HTMLElement;
  Object.assign(footerClone.style, {
    position: 'fixed',
    top: '0px',
    left: `-${A4_WIDTH_PX + 100}px`,
    width: `${A4_WIDTH_PX}px`,
    minWidth: `${A4_WIDTH_PX}px`,
    maxWidth: `${A4_WIDTH_PX}px`,
    margin: '0',
    boxSizing: 'border-box',
    backgroundColor: '#ffffff',
  });
  document.body.appendChild(footerClone);
  // Must run AFTER appendChild — see captureSectionAtA4 for rationale.
  forcePdfFontInTree(footerClone);
  // Hide the template page number from the composited footer image — the PDF service
  // injects the correct "i / totalPages" text via jsPDF after all pages are captured,
  // so the template number (which can't know virtual-page splits) must not show.
  const footerPageNumEl = footerClone.querySelector<HTMLElement>('.footer-page-number');
  if (footerPageNumEl) footerPageNumEl.style.cssText += '; visibility: hidden !important; color: transparent !important;';

  try {
    await document.fonts.ready;
    await new Promise(r => setTimeout(r, 80));
    const LINK_Y_PAD = 4;
    const LINK_X_PAD = 2;
    const footerLinkRelPositions: { url: string; x: number; y: number; w: number; h: number }[] = [];
    const footerCanvas = await html2canvas(footerClone, {
      scale: SCALE,
      width: A4_WIDTH_PX,
      windowWidth: A4_WIDTH_PX,
      windowHeight: 200,
      scrollX: 0,
      scrollY: 0,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false,
      onclone: (doc, clonedEl) => {
        enforcePdfFontInClonedDoc(doc);
        // Collect footer link positions relative to the footer element top-left.
        // Absolute Y on the page is computed below once footerCanvas.height is known.
        const elRect = clonedEl.getBoundingClientRect();
        clonedEl.querySelectorAll('a[href]').forEach((a) => {
          const href = a.getAttribute('href');
          if (!href) return;
          const r = a.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            footerLinkRelPositions.push({
              url: href,
              x: Math.max(0, r.left - elRect.left - LINK_X_PAD),
              y: r.top - elRect.top - LINK_Y_PAD,
              w: r.width + LINK_X_PAD * 2,
              h: r.height + LINK_Y_PAD * 2,
            });
          }
        });
      },
    });

    // Build a full A4 canvas: content at top, white space in middle, footer at very bottom
    const FULL_W = A4_WIDTH_PX * SCALE;
    const FULL_H = A4_HEIGHT_PX * SCALE;
    const full = document.createElement('canvas');
    full.width = FULL_W;
    full.height = FULL_H;
    const ctx = full.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, FULL_W, FULL_H);
    ctx.drawImage(contentCanvas, 0, 0);                                   // content at top
    ctx.drawImage(footerCanvas, 0, FULL_H - footerCanvas.height);         // footer at bottom

    // Compute footer-link absolute Y using the actual rendered canvas height.
    // Relative positions were captured inside onclone above.
    const footerCssTopOnPage = A4_HEIGHT_PX - (footerCanvas.height / SCALE);
    const footerLinks: LinkAnnotation[] = footerLinkRelPositions.map(pos => ({
      ...pos,
      y: footerCssTopOnPage + pos.y,
    }));
    console.log('[PDF] compositeWithPageFooter: ' + footerLinks.length + ' footer links');

    return { canvas: full, footerLinks };
  } finally {
    document.body.removeChild(footerClone);
  }
};

/**
 * Pure DOM measurement pass.
 * Clones a section at A4 width, waits for layout to settle, then measures
 * every [data-pdf-block] element using getBoundingClientRect().
 *
 * Does NOT call html2canvas. The existing capture flow is completely unchanged.
 * Returns an empty array if the section has no [data-pdf-block] attributes.
 */
const measureSectionBlocks = async (containerId: string): Promise<MeasuredBlock[]> => {
  const source = document.getElementById(containerId);
  if (!source) {
    console.warn(`Ã¢Å¡Â Ã¯Â¸Â measureSectionBlocks: section "${containerId}" not found`);
    return [];
  }

  if (source.querySelectorAll('[data-pdf-block]').length === 0) {
    console.log(`Ã¢â€žÂ¹Ã¯Â¸Â measureSectionBlocks: no [data-pdf-block] elements in "${containerId}", skipping`);
    return [];
  }

  const clone = source.cloneNode(true) as HTMLElement;
  Object.assign(clone.style, {
    position: 'fixed',
    top: '0px',
    left: `-${A4_WIDTH_PX + 100}px`,
    width: `${A4_WIDTH_PX}px`,
    minWidth: `${A4_WIDTH_PX}px`,
    maxWidth: `${A4_WIDTH_PX}px`,
    overflow: 'visible',
    margin: '0',
    boxSizing: 'border-box',
    backgroundColor: '#ffffff',
    display: 'block',
  });
  document.body.appendChild(clone);
  // Must run AFTER appendChild — see captureSectionAtA4 for rationale.
  forcePdfFontInTree(clone);

  try {
    await document.fonts.ready;
    // Two rAF cycles guarantee layout is fully resolved Ã¢â‚¬â€ more reliable than a fixed timeout
    await new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );

    const blockElements = clone.querySelectorAll<HTMLElement>('[data-pdf-block]');
    const measured: MeasuredBlock[] = [];

    blockElements.forEach((el, index) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const marginBottom = parseFloat(style.marginBottom) || 0;
      const type = (el.getAttribute('data-pdf-block') || 'atomic') as MeasuredBlock['type'];
      const block: MeasuredBlock = { index, type, height: rect.height, marginBottom };

      // For table blocks: also measure thead, each tbody row, and tfoot individually
      if (type === 'table') {
        const table = el.querySelector('table');
        if (table) {
          const thead = table.querySelector('thead');
          const tfoot = table.querySelector('tfoot');
          const tbodyRows = Array.from(table.querySelectorAll('tbody tr'));
          block.tableData = {
            theadHeight: thead ? thead.getBoundingClientRect().height : 0,
            tfootHeight: tfoot ? tfoot.getBoundingClientRect().height : 0,
            rows: tbodyRows.map(tr => ({ height: tr.getBoundingClientRect().height })),
          };
        }
      }

      measured.push(block);
    });

    console.log(`Ã°Å¸â€œÂ measureSectionBlocks("${containerId}"): ${measured.length} blocks measured`, measured);
    return measured;
  } finally {
    document.body.removeChild(clone);
  }
};

/**
 * Pure function Ã¢â‚¬â€ no DOM access, no side effects.
 * Assigns measured blocks to virtual pages based on available height.
 *
 * Rules:
 *   - If a block fits in remaining space  Ã¢â€ â€™ place on current page
 *   - If a block does not fit            Ã¢â€ â€™ flush current page, start new page
 *   - header-group orphan prevention     Ã¢â€ â€™ never leave a heading alone at the
 *     bottom of a page without its following sibling
 */
const computeVirtualPages = (
  blocks: MeasuredBlock[],
  usableHeight: number
): VirtualPage[] => {
  if (blocks.length === 0) return [];

  const pages: VirtualPage[] = [];
  let current: VirtualPage = { blockIndices: [], totalContentHeight: 0 };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const blockHeight = block.height + block.marginBottom;
    const wouldFit = current.totalContentHeight + blockHeight <= usableHeight;

    if (!wouldFit) {
      // Block does not fit Ã¢â‚¬â€ flush current page and start a new one
      if (current.blockIndices.length > 0 && current.totalContentHeight > 0) pages.push(current);
      current = { blockIndices: [i], totalContentHeight: blockHeight };
      continue;
    }

    // header-group orphan rule: heading fits but its next sibling would not Ã¢â‚¬â€
    // push heading to next page so it always appears above its content
    if (block.type === 'header-group' && i + 1 < blocks.length) {
      const next = blocks[i + 1];
      const nextFitsAfterHeader =
        current.totalContentHeight + blockHeight + next.height + next.marginBottom <= usableHeight;
      if (!nextFitsAfterHeader && current.blockIndices.length > 0 && current.totalContentHeight > 0) {
        pages.push(current);
        current = { blockIndices: [i], totalContentHeight: blockHeight };
        continue;
      }
    }

    current.blockIndices.push(i);
    current.totalContentHeight += blockHeight;
  }

  if (current.blockIndices.length > 0 && current.totalContentHeight > 0) pages.push(current);
  return pages;
};

/**
 * Extended virtual page computation with table-row-aware splitting.
 * Use this for sections that may contain data-pdf-block="table" elements.
 *
 * Additional rules beyond computeVirtualPages:
 *   - Table rows never split mid-row
 *   - tfoot stays with at least one tbody row (orphan prevention via cost model)
 *   - Continuation pages contain only the table block (context blocks excluded)
 *   - thead is included in every segment (repeated on continuation pages)
 *   - Single oversized row is forced onto a page rather than dropped
 */
const computeVirtualPagesWithTableRows = (
  blocks: MeasuredBlock[],
  usableHeight: number
): VirtualPage[] => {
  if (blocks.length === 0) return [];

  const pages: VirtualPage[] = [];
  let current: VirtualPage = { blockIndices: [], totalContentHeight: 0 };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // Ã¢â€â‚¬Ã¢â€â‚¬ Non-table blocks: same rules as computeVirtualPages Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    if (block.type !== 'table' || !block.tableData) {
      const blockHeight = block.height + block.marginBottom;
      const wouldFit = current.totalContentHeight + blockHeight <= usableHeight;

      if (!wouldFit) {
        if (current.blockIndices.length > 0 && current.totalContentHeight > 0) pages.push(current);
        current = { blockIndices: [i], totalContentHeight: blockHeight };
        continue;
      }

      // header-group orphan rule: never leave a heading alone at the bottom.
      // For table blocks, check against the MINIMUM table unit (thead + 1st row)
      // rather than the full table height, so the heading stays with the first
      // table segment instead of being pushed to an otherwise empty page.
      if (block.type === 'header-group' && i + 1 < blocks.length) {
        const next = blocks[i + 1];
        const nextCheckHeight =
          next.type === 'table' && next.tableData
            ? next.tableData.theadHeight + (next.tableData.rows[0]?.height ?? 0)
            : next.height + next.marginBottom;
        const nextFits = current.totalContentHeight + blockHeight + nextCheckHeight <= usableHeight;
        if (!nextFits && current.blockIndices.length > 0 && current.totalContentHeight > 0) {
          pages.push(current);
          current = { blockIndices: [i], totalContentHeight: blockHeight };
          continue;
        }
      }

      current.blockIndices.push(i);
      current.totalContentHeight += blockHeight;
      continue;
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Table block: row-aware pagination Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    const { theadHeight, tfootHeight, rows } = block.tableData;

    // Fast path: entire table fits in remaining space Ã¢â‚¬â€ no splitting needed
    if (current.totalContentHeight + block.height + block.marginBottom <= usableHeight) {
      current.blockIndices.push(i);
      current.totalContentHeight += block.height + block.marginBottom;
      continue;
    }

    // If minimum table unit (thead + 1 row) does not fit on remaining space:
    // flush current page and start fresh so the table gets a full page.
    const minUnit = theadHeight + (rows[0]?.height ?? 0);
    if (usableHeight - current.totalContentHeight < minUnit && current.blockIndices.length > 0) {
      pages.push(current);
      current = { blockIndices: [], totalContentHeight: 0 };
    }

    // Greedily assign rows to segments across pages
    let rowCursor = 0;
    let isFirstSegment = true;

    while (rowCursor < rows.length) {
      const remaining = usableHeight - current.totalContentHeight;
      const rowBudget = remaining - theadHeight;

      let tally = 0;
      let segEnd = rowCursor - 1; // last row index committed to this segment

      for (let r = rowCursor; r < rows.length; r++) {
        const rowH = rows[r].height;
        // Cost includes tfoot for the final row (orphan prevention: tfoot travels with last row)
        const cost = rowH + (r === rows.length - 1 ? tfootHeight : 0);

        if (tally + cost <= rowBudget) {
          tally += rowH;
          segEnd = r;
        } else {
          // Row doesn't fit Ã¢â‚¬â€ if nothing committed yet, force it (oversized row safety)
          if (segEnd < rowCursor) {
            tally += rowH;
            segEnd = r;
          }
          break;
        }
      }

      // Clamp to a valid row index
      if (segEnd < rowCursor) segEnd = rowCursor;

      const includesTfoot = segEnd === rows.length - 1;
      const segmentHeight = theadHeight + tally + (includesTfoot ? tfootHeight : 0);

      current.blockIndices.push(i);
      current.totalContentHeight += segmentHeight + (includesTfoot ? block.marginBottom : 0);
      current.tableSegment = {
        blockIndex: i,
        startRow: rowCursor,
        endRow: segEnd,
        includesTfoot,
        isFirstSegment,
      };

      if (current.blockIndices.length > 0 && current.totalContentHeight > 0) {
        pages.push(current);
      }
      rowCursor = segEnd + 1;
      isFirstSegment = false;

      // Start a fresh page for the next segment (if any rows remain)
      if (rowCursor < rows.length) {
        current = { blockIndices: [], totalContentHeight: 0 };
      }
    }

    // After the table is fully distributed, reset current for any following blocks
    current = { blockIndices: [], totalContentHeight: 0 };
  }

  if (current.blockIndices.length > 0 && current.totalContentHeight > 0) pages.push(current);
  return pages;
};

/**
 * Captures a single virtual page by cloning the section and DOM-manipulating the clone.
 *
 * What this does per virtual page:
 *   - Removes blocks whose indices are NOT in virtualPage.blockIndices
 *   - If virtualPage.tableSegment is set:
 *       Ã¢â‚¬Â¢ Removes tbody rows outside [startRow, endRow]
 *       Ã¢â‚¬Â¢ Removes tfoot when !includesTfoot
 *   - Context blocks (header, client info) are auto-absent on continuation pages
 *     because their indices are excluded from blockIndices
 */
const captureVirtualPage = async (
  containerId: string,
  virtualPage: VirtualPage,
  _blocks: MeasuredBlock[]
): Promise<{ canvas: HTMLCanvasElement; links: LinkAnnotation[] } | null> => {
  const source = document.getElementById(containerId);
  if (!source) {
    console.warn(`Ã¢Å¡Â Ã¯Â¸Â captureVirtualPage: section "${containerId}" not found`);
    return null;
  }

  const clone = source.cloneNode(true) as HTMLElement;
  Object.assign(clone.style, {
    position: 'fixed',
    top: '0px',
    left: `-${A4_WIDTH_PX + 100}px`,
    width: `${A4_WIDTH_PX}px`,
    minWidth: `${A4_WIDTH_PX}px`,
    maxWidth: `${A4_WIDTH_PX}px`,
    overflow: 'visible',
    margin: '0',
    boxSizing: 'border-box',
    backgroundColor: '#ffffff',
    display: 'block',
  });
  document.body.appendChild(clone);
  // Must run AFTER appendChild — see captureSectionAtA4 for rationale.
  forcePdfFontInTree(clone);

  try {
    // Hide footer from inline flow — it will be composited at the bottom of the full A4 canvas
    const cloneFooterEl = clone.querySelector<HTMLElement>('.company-contact-footer');
    if (cloneFooterEl) cloneFooterEl.style.display = 'none';

    // Snapshot block elements BEFORE any removal so indices remain stable
    const blockEls = Array.from(clone.querySelectorAll<HTMLElement>('[data-pdf-block]'));

    // Remove blocks not assigned to this virtual page
    blockEls.forEach((el, idx) => {
      if (!virtualPage.blockIndices.includes(idx)) {
        el.remove();
      }
    });

    // Guard: if no [data-pdf-block] elements remain, the virtual page is empty Ã¢â‚¬â€ skip capture
    if (clone.querySelectorAll('[data-pdf-block]').length === 0) {
      console.warn(`Ã¢Å¡Â Ã¯Â¸Â Skipping empty virtual page (no visible blocks) for "${containerId}"`);
      return null;
    }

    // Apply table row filtering when this page contains a partial table segment
    const seg = virtualPage.tableSegment;
    if (seg) {
      const tableBlockEl = blockEls[seg.blockIndex];
      if (tableBlockEl) {
        const table = tableBlockEl.querySelector('table');
        if (table) {
          // Remove tbody rows outside [startRow, endRow]
          const tbodyRows = Array.from(table.querySelectorAll('tbody tr'));
          tbodyRows.forEach((row, rowIdx) => {
            if (rowIdx < seg.startRow || rowIdx > seg.endRow) {
              row.remove();
            }
          });
          // Remove tfoot when this segment does not include the totals row
          if (!seg.includesTfoot) {
            table.querySelector('tfoot')?.remove();
          }
        }
      }
    }

    // Wait for layout + images to settle
    await document.fonts.ready;
    const images = Array.from(clone.querySelectorAll('img'));
    await Promise.all(
      images.map(img =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>(res => { img.onload = () => res(); img.onerror = () => res(); })
      )
    );
    await new Promise(r => setTimeout(r, 300));

    // Links are collected inside onclone — same rationale as captureSectionAtA4.
    // The footer is already hidden above so all collected links belong to the content.
    const LINK_Y_PAD = 3;
    const links: LinkAnnotation[] = [];

    const canvas = await html2canvas(clone, {
      scale: 2,
      width: A4_WIDTH_PX,
      windowWidth: A4_WIDTH_PX,
      windowHeight: 10000,
      scrollX: 0,
      scrollY: 0,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false,
      onclone: (doc, clonedEl) => {
        enforcePdfFontInClonedDoc(doc);
        const elRect = clonedEl.getBoundingClientRect();
        clonedEl.querySelectorAll('a[href]').forEach((a) => {
          const href = a.getAttribute('href');
          if (!href) return;
          const r = a.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            links.push({
              url: href,
              x: r.left - elRect.left,
              y: (r.top - elRect.top) - LINK_Y_PAD,
              w: r.width,
              h: r.height + LINK_Y_PAD * 2,
            });
          }
        });
        console.log('[PDF] onclone (captureVirtualPage): ' + links.length + ' links');
      },
    });

    console.log(`Ã¢Å“â€¦ Virtual page captured: ${canvas.width}Ãƒâ€”${canvas.height}px`);
    const { canvas: composited, footerLinks } = await compositeWithPageFooter(canvas, source);
    return { canvas: composited, links: [...links, ...footerLinks] };
  } catch (error) {
    console.error(`Ã¢ÂÅ’ captureVirtualPage failed for "${containerId}":`, error);
    throw error;
  } finally {
    document.body.removeChild(clone);
  }
};

/**
 * Poll until the element with [data-pdf-ready] inside sectionId reports "true".
 * Used for pdf-service-ref-N sections that contain async Gemini image crops.
 * Returns immediately if no [data-pdf-ready] element is found (section has no async content).
 */
const waitForPdfReady = async (sectionId: string): Promise<void> => {
  const source = document.getElementById(sectionId);
  if (!source) return;
  const readyEl = source.querySelector('[data-pdf-ready]');
  if (!readyEl) return; // no async content Ã¢â‚¬â€ nothing to wait for
  const MAX_WAIT = 15000;
  const POLL_INTERVAL = 150;
  const start = Date.now();
  console.log(`Ã¢ÂÂ³ Waiting for ReferenceImages readiness: ${sectionId}...`);
  while (true) {
    if (readyEl.getAttribute('data-pdf-ready') === 'true') return;
    if (Date.now() - start >= MAX_WAIT) {
      console.warn(`Ã¢Å¡Â Ã¯Â¸Â waitForPdfReady: timeout reached for "${sectionId}" Ã¢â‚¬â€ continuing export`);
      return;
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
};

/**
 * Legacy fallback: capture entire element if section IDs not found
 */
const legacyFullCapture = async (
  element: HTMLElement,
  pdf: jsPDF,
  pdfWidth: number,
  pdfHeight: number,
): Promise<void> => {
  console.log('Ã°Å¸â€â€ž Using legacy full-element capture');
  
  const originalStyle = element.getAttribute('style') || '';
  const originalClass = element.className;

  Object.assign(element.style, {
    width: `${A4_WIDTH_PX}px`,
    minWidth: `${A4_WIDTH_PX}px`,
    maxWidth: `${A4_WIDTH_PX}px`,
    position: 'absolute',
    left: '-9999px',
    top: '0',
  });

  await document.fonts.ready;
  await new Promise((r) => setTimeout(r, 200));

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    allowTaint: false,
    backgroundColor: '#ffffff',
    logging: false,
    width: A4_WIDTH_PX,
    windowWidth: A4_WIDTH_PX,
    scrollX: 0,
    scrollY: 0,
    onclone: (doc) => {
      enforcePdfFontInClonedDoc(doc);
    },
  });

  // Restore styles
  element.setAttribute('style', originalStyle);
  element.className = originalClass;

  const imgData = canvas.toDataURL('image/png');
  const aspectRatio = canvas.height / canvas.width;
  const imgHeight = pdfWidth * aspectRatio;

  pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, imgHeight);

  // Handle multi-page if needed
  let remainingHeight = imgHeight - pdfHeight;
  let yOffset = -pdfHeight;

  while (remainingHeight > 0) {
    console.log('Ã°Å¸â€œâ€ž pdf.addPage() called', { where: 'legacyFullCapture overflow', currentPageBefore: pdf.getCurrentPageInfo().pageNumber, stack: new Error().stack });
    pdf.addPage();
    pdf.addImage(imgData, 'PNG', 0, yOffset, pdfWidth, imgHeight);
    yOffset -= pdfHeight;
    remainingHeight -= pdfHeight;
  }
};

// Check if running on mobile (Capacitor native app)
const isMobile = () => Capacitor.isNativePlatform();

export const exportToPDF = async (
  element: HTMLElement,
  quoteNumber: string,
  _templateType: TemplateType,
  clientName?: string,
): Promise<void> => {
  try {
    console.group('Ã°Å¸â€Â§ PDF EXPORT TRACE Ã¢â‚¬â€ ' + quoteNumber);
    console.log('Ã°Å¸â€œÂ¸ Starting PDF export process...');
    console.log('Element to capture:', element);
    console.log('Quote number:', quoteNumber);
    
    // Show loading state
    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = 'wait';
    await ensurePdfFontLoaded();

    const isMobileDevice = isMobile();
    console.log('Ã°Å¸â€œÂ± Device type:', isMobileDevice ? 'Mobile' : 'Desktop');

    // Create PDF with A4 dimensions
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4', // Always A4: 210mm Ãƒâ€” 297mm
      compress: true
    });

    const pdfWidth = 210; // mm
    const pdfHeight = 297; // mm
    let pageCount = 0;

    // Helper to overlay link annotations on the current PDF page
    const addLinkAnnotations = (
      links: LinkAnnotation[],
      xBase: number,       // mm x offset (for centered scaled images)
      cssToPdf: number,    // CSS px Ã¢â€ â€™ PDF mm conversion factor
      pageYOffset: number  // mm offset for current page (multi-page splits)
    ) => {
      links.forEach(({ url, x, y, w, h }) => {
        const pdfX = xBase + x * cssToPdf;
        const pdfY = y * cssToPdf - pageYOffset;
        const pdfW = w * cssToPdf;
        const pdfH = h * cssToPdf;
        if (pdfW > 0 && pdfH > 0 && pdfY + pdfH > 0 && pdfY < pdfHeight) {
          const finalY = Math.max(0, pdfY);
          pdf.link(pdfX, finalY, pdfW, pdfH, { url });
          console.log(`[PDF] link added page=${pageCount} url=${url} x=${pdfX.toFixed(2)} y=${finalY.toFixed(2)} w=${pdfW.toFixed(2)} h=${pdfH.toFixed(2)}`);
        }
      });
    };

    // Helper to add a captured canvas to the PDF.
    // Each HTML section maps to EXACTLY ONE PDF page.
    // If content overflows A4 height it is scaled down proportionally to fit Ã¢â‚¬â€
    // this prevents images from being sliced across page boundaries and keeps
    // hard-coded footer page numbers (e.g. "2 / 4") accurate.
    const addCanvasToPDF = (canvas: HTMLCanvasElement, links: LinkAnnotation[], label: string, isFirstPage: boolean) => {
      console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â addCanvasToPDF START', { label, isFirstPage, currentPdfPage: pdf.getCurrentPageInfo().pageNumber, canvasWidth: canvas.width, canvasHeight: canvas.height });
      if (!isFirstPage) {
        console.log('Ã°Å¸â€œâ€ž pdf.addPage() called', { where: 'addCanvasToPDF Ã¢â‚¬â€ not first page', label, currentPageBefore: pdf.getCurrentPageInfo().pageNumber, stack: new Error().stack });
        pdf.addPage();
      }
      pageCount++;
      const imgData = canvas.toDataURL('image/png');
      const aspectRatio = canvas.height / canvas.width;
      const imgHeight = pdfWidth * aspectRatio;
      const cssToPdf = pdfWidth / A4_WIDTH_PX; // CSS px Ã¢â€ â€™ PDF mm

      if (imgHeight <= pdfHeight) {
        // Content fits within A4 Ã¢â‚¬â€ render at natural size
        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, imgHeight);
        addLinkAnnotations(links, 0, cssToPdf, 0);
        console.log(`Ã¢Å“â€¦ Page ${pageCount} added (${label}): ${pdfWidth}Ãƒâ€”${Math.round(imgHeight)}mm`);
      } else {
        // Split long content (like pricing tables) across pages instead of shrinking.
        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, imgHeight);
        addLinkAnnotations(links, 0, cssToPdf, 0);
        console.log(`Ã¢Å“â€¦ Page ${pageCount} added (${label}): ${pdfWidth}Ãƒâ€”${Math.round(imgHeight)}mm`);

        let remainingHeight = imgHeight - pdfHeight;
        let yOffset = -pdfHeight;
        let pageYStart = pdfHeight;
        while (remainingHeight > 0.5) {
          console.log('Ã°Å¸â€œâ€ž pdf.addPage() called', { where: 'addCanvasToPDF overflow loop', label, currentPageBefore: pdf.getCurrentPageInfo().pageNumber, stack: new Error().stack });
          pdf.addPage();
          pageCount++;
          pdf.addImage(imgData, 'PNG', 0, yOffset, pdfWidth, imgHeight);
          addLinkAnnotations(links, 0, cssToPdf, pageYStart);
          yOffset -= pdfHeight;
          pageYStart += pdfHeight;
          remainingHeight -= pdfHeight;
          console.log(`Ã¢Å“â€¦ Additional page ${pageCount} added for overflow`);
        }
      }
      console.log('Ã¢Å“â€¦ addCanvasToPDF END', { label, currentPdfPage: pdf.getCurrentPageInfo().pageNumber, totalPageCount: pageCount });
    };

    // Check if this is a multi-service quote (has pdf-page-summary)
    const isMultiService = !!document.getElementById('pdf-page-summary');

    if (isMultiService) {
      // --- MULTI-SERVICE QUOTE ---
      console.log('Ã°Å¸â€œâ€ž Multi-service quote detected');

      // Ã¢â€â‚¬Ã¢â€â‚¬ Helper: smart-capture one section with overflow-aware block pagination Ã¢â€â‚¬Ã¢â€â‚¬
      // When scrollHeight > PDF_USABLE_HEIGHT_PX, measure blocks Ã¢â€ â€™ virtual pages Ã¢â€ â€™ capture each.
      // Otherwise falls back to captureSectionAtA4 (single capture, no splitting).
      const captureSmartSection = async (
        sectionId: string,
        label: string
      ): Promise<boolean> => {
        const source = document.getElementById(sectionId);
        if (!source) return false;
        const isFirstOfDoc = pageCount === 0;
        console.log(`Ã°Å¸â€œÂ Smart pagination enabled: ${sectionId}`);
        if (source.scrollHeight > PDF_USABLE_HEIGHT_PX) {
          const blocks = await measureSectionBlocks(sectionId);
          if (blocks.length > 0) {
            const vPages = computeVirtualPagesWithTableRows(blocks, PDF_USABLE_HEIGHT_PX);
            console.log(`Ã¯Â¿Â½ Smart section START: ${sectionId}`, { virtualPages: vPages.length });
            console.log(`Ã°Å¸â€œâ€ž Virtual pages generated: ${vPages.length}`);
            for (let vp = 0; vp < vPages.length; vp++) {
              console.log(`Ã°Å¸â€œâ€ž Rendering virtual page ${vp + 1}/${vPages.length}`, { sectionId, currentPdfPage: pdf.getCurrentPageInfo().pageNumber });
              console.log(`Ã°Å¸Â§Â© Capturing virtual page ${vp + 1}/${vPages.length}`);
              const vpResult = await captureVirtualPage(sectionId, vPages[vp], blocks);
              if (vpResult) {
                addCanvasToPDF(vpResult.canvas, vpResult.links, `${label}-vp${vp}`, isFirstOfDoc && vp === 0);
                console.log(`Ã¢Å“â€¦ Virtual page inserted`, { sectionId, vp, insertedPdfPage: pdf.getCurrentPageInfo().pageNumber });
              } else {
                console.log(`Ã¢Å¡Â Ã¯Â¸Â Virtual page ${vp + 1} returned null Ã¢â‚¬â€ skipped`, { sectionId });
              }
            }
            return true;
          }
        }
        // Fast path
        const result = await captureSectionAtA4(sectionId);
        if (result) {
          addCanvasToPDF(result.canvas, result.links, label, isFirstOfDoc);
          return true;
        }
        return false;
      };

      // Capture summary page (smart pagination)
      await captureSmartSection('pdf-page-summary', 'summary');

      // Capture each service group page + its reference images
      let serviceIndex = 0;
      while (true) {
        const serviceSource = document.getElementById(`pdf-service-${serviceIndex}`);
        if (!serviceSource) break; // no more service pages

        // Wait for the specOnly ReferenceImages inside pdf-service-N (if any) to be ready
        await waitForPdfReady(`pdf-service-${serviceIndex}`);
        await captureSmartSection(`pdf-service-${serviceIndex}`, `service-${serviceIndex}`);

        // Wait for reference image async ops, then capture with smart pagination
        await waitForPdfReady(`pdf-service-ref-${serviceIndex}`);
        const refSource = document.getElementById(`pdf-service-ref-${serviceIndex}`);
        if (refSource) {
          console.log(`Ã°Å¸â€œÂ Smart pagination enabled: pdf-service-ref-${serviceIndex}`);
          if (refSource.scrollHeight > PDF_USABLE_HEIGHT_PX) {
            const refBlocks = await measureSectionBlocks(`pdf-service-ref-${serviceIndex}`);
            if (refBlocks.length > 0) {
              const refVPages = computeVirtualPages(refBlocks, PDF_USABLE_HEIGHT_PX);
              console.log(`Ã°Å¸â€œâ€ž Virtual pages generated: ${refVPages.length}`);
              for (let vp = 0; vp < refVPages.length; vp++) {
                console.log(`Ã°Å¸Â§Â© Capturing virtual page ${vp + 1}/${refVPages.length}`);
                const vpResult = await captureVirtualPage(`pdf-service-ref-${serviceIndex}`, refVPages[vp], refBlocks);
                if (vpResult) {
                  addCanvasToPDF(vpResult.canvas, vpResult.links, `service-ref-${serviceIndex}-vp${vp}`, false);
                }
              }
            } else {
              const refResult = await captureSectionAtA4(`pdf-service-ref-${serviceIndex}`);
              if (refResult && refResult.canvas.height > 10) {
                addCanvasToPDF(refResult.canvas, refResult.links, `service-ref-${serviceIndex}`, false);
              }
            }
          } else {
            const refResult = await captureSectionAtA4(`pdf-service-ref-${serviceIndex}`);
            if (refResult && refResult.canvas.height > 10) {
              addCanvasToPDF(refResult.canvas, refResult.links, `service-ref-${serviceIndex}`, false);
            }
          }
        }

        serviceIndex++;
      }

      // Terms & Conditions (Last page - multi-service) Ã¢â‚¬â€ smart pagination
      await captureSmartSection('pdf-page-terms', 'terms');

      if (pageCount === 0) {
        console.warn('Ã¢Å¡Â Ã¯Â¸Â No multi-service sections captured, using fallback');
        await legacyFullCapture(element, pdf, pdfWidth, pdfHeight);
        pageCount = 1;
      }
    } else {
      // --- SINGLE-SERVICE QUOTE ---
      console.log('Ã°Å¸â€œâ€ž Capturing quotation content...');
      await waitForPdfReady('pdf-page-1');
      const page1Source = document.getElementById('pdf-page-1');

      if (page1Source && page1Source.scrollHeight > PDF_USABLE_HEIGHT_PX) {
        // Overflow detected Ã¢â€ â€™ smart block-row pagination
        console.log(`Ã°Å¸â€œÂ pdf-page-1 overflows (${page1Source.scrollHeight}px > ${PDF_USABLE_HEIGHT_PX}px) Ã¢â€ â€™ smart pagination`);
        const page1Blocks = await measureSectionBlocks('pdf-page-1');
        if (page1Blocks.length > 0) {
          const page1VPages = computeVirtualPagesWithTableRows(page1Blocks, PDF_USABLE_HEIGHT_PX);
          console.log(`Ã°Å¸â€œâ€ž [SmartPagination] pdf-page-1 Ã¢â€ â€™ ${page1VPages.length} virtual page(s):`, page1VPages);
          for (let vp = 0; vp < page1VPages.length; vp++) {
            const vpResult = await captureVirtualPage('pdf-page-1', page1VPages[vp], page1Blocks);
            if (vpResult) {
              addCanvasToPDF(vpResult.canvas, vpResult.links, `page-1-vp${vp}`, vp === 0 && pageCount === 0);
            }
          }
        } else {
          // No blocks annotated Ã¢â‚¬â€ fall back to standard single capture
          const quotationResult = await captureSectionAtA4('pdf-page-1');
          if (quotationResult) {
            addCanvasToPDF(quotationResult.canvas, quotationResult.links, 'quotation', true);
          }
        }
      } else {
        // Fast path: section fits on one page Ã¢â‚¬â€ use existing capture unchanged
        const quotationResult = await captureSectionAtA4('pdf-page-1');
        if (quotationResult) {
          addCanvasToPDF(quotationResult.canvas, quotationResult.links, 'quotation', true);
        } else {
          console.warn('Ã¢Å¡Â Ã¯Â¸Â Quotation section not found, using fallback full capture');
          await legacyFullCapture(element, pdf, pdfWidth, pdfHeight);
          pageCount = 1;
        }
      }

      // Reference Images (Page 2+) — smart pagination so T&C never shares space with ref images
      console.log('Ã°Å¸â€œâ€ž Checking for reference images...');
      await waitForPdfReady('pdf-page-2');
      const page2Source = document.getElementById('pdf-page-2');
      if (page2Source) {
        if (page2Source.scrollHeight > PDF_USABLE_HEIGHT_PX) {
          const page2Blocks = await measureSectionBlocks('pdf-page-2');
          if (page2Blocks.length > 0) {
            const page2VPages = computeVirtualPages(page2Blocks, PDF_USABLE_HEIGHT_PX);
            console.log(`[SmartPagination] pdf-page-2 => ${page2VPages.length} virtual page(s):`, page2VPages);
            for (let vp = 0; vp < page2VPages.length; vp++) {
              const vpResult = await captureVirtualPage('pdf-page-2', page2VPages[vp], page2Blocks);
              if (vpResult) {
                addCanvasToPDF(vpResult.canvas, vpResult.links, `page-2-vp${vp}`, false);
              }
            }
          } else {
            const referenceResult = await captureSectionAtA4('pdf-page-2');
            if (referenceResult && referenceResult.canvas.height > 10) {
              addCanvasToPDF(referenceResult.canvas, referenceResult.links, 'references', false);
            }
          }
        } else {
          const referenceResult = await captureSectionAtA4('pdf-page-2');
          if (referenceResult && referenceResult.canvas.height > 10) {
            addCanvasToPDF(referenceResult.canvas, referenceResult.links, 'references', false);
          } else {
            console.log('Ã¢â€žÂ¹Ã¯Â¸Â No reference images section found or section is empty');
          }
        }
      }
      // General Terms & Conditions + Bank Details (final page) Ã¢â‚¬â€ smart pagination
      console.log('Ã°Å¸â€œâ€ž Checking for general T&C + banking page...');
      const termsSource = document.getElementById('pdf-page-terms');
      if (termsSource) {
        console.log(`Ã°Å¸â€œÂ Smart pagination enabled: pdf-page-terms`);
        if (termsSource.scrollHeight > PDF_USABLE_HEIGHT_PX) {
          const termsBlocks = await measureSectionBlocks('pdf-page-terms');
          if (termsBlocks.length > 0) {
            const termsVPages = computeVirtualPages(termsBlocks, PDF_USABLE_HEIGHT_PX);
            console.log(`Ã°Å¸â€œâ€ž Virtual pages generated: ${termsVPages.length}`);
            for (let vp = 0; vp < termsVPages.length; vp++) {
              console.log(`Ã°Å¸Â§Â© Capturing virtual page ${vp + 1}/${termsVPages.length}`);
              const vpResult = await captureVirtualPage('pdf-page-terms', termsVPages[vp], termsBlocks);
              if (vpResult) {
                addCanvasToPDF(vpResult.canvas, vpResult.links, `terms-vp${vp}`, false);
              }
            }
          } else {
            const generalTermsResult = await captureSectionAtA4('pdf-page-terms');
            if (generalTermsResult && generalTermsResult.canvas.height > 10) {
              addCanvasToPDF(generalTermsResult.canvas, generalTermsResult.links, 'general-terms', false);
            }
          }
        } else {
          const generalTermsResult = await captureSectionAtA4('pdf-page-terms');
          if (generalTermsResult && generalTermsResult.canvas.height > 10) {
            addCanvasToPDF(generalTermsResult.canvas, generalTermsResult.links, 'general-terms', false);
          } else {
            console.log('Ã¢â€žÂ¹Ã¯Â¸Â No general T&C/banking section found or section is empty');
          }
        }
      }
    }

    console.log(`Ã°Å¸â€œâ€ž PDF created with ${pageCount} pages`);

    // Inject dynamic page numbers into every page footer.
    // The footer contains a <span class="footer-page-placeholder"> (empty) in the HTML;
    // we write the "i / N" text via jsPDF so the total is always accurate regardless
    // of how many virtual pages the smart pagination generated.
    const totalPages = pageCount;
    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i);
      pdf.setFontSize(11);
      pdf.setTextColor(100, 100, 100);
      pdf.text(`${i} / ${totalPages}`, pdfWidth / 2, 292, { align: 'center' });
    }
    // Reset font state so metadata setters below are unaffected
    pdf.setTextColor(0, 0, 0);

    // Add PDF metadata
    pdf.setProperties({
      title: `Quote ${quoteNumber}`,
      subject: 'Quote Document',
      author: 'Quote Buddy',
      keywords: 'quote, proposal',
      creator: 'E2W Quote System',
    });

    // For mobile, set initial view to fit width
    if (isMobileDevice) {
      // @ts-ignore - jsPDF doesn't have types for setDisplayMode
      pdf.setDisplayMode('fullwidth', 'continuous');
    }

    // Generate filename
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const clientStr = (clientName || '').replace(/\s+/g, '');
    const filename = `${dateStr}_${clientStr}_${quoteNumber}.pdf`;

    console.log('Ã°Å¸â€œËœ FINAL PDF PAGE COUNT', pdf.getNumberOfPages());
    console.log('Ã°Å¸â€™Â¾ Saving PDF as:', filename);
    console.groupEnd(); // close Ã°Å¸â€Â§ PDF EXPORT TRACE group

    // Handle mobile vs web differently
    if (isMobile()) {
      console.log('Ã°Å¸â€œÂ± Mobile detected - using Filesystem API');
      try {
        // Get PDF as base64
        const pdfBase64 = pdf.output('dataurlstring').split(',')[1];

        // Save to device's documents directory
        const result = await Filesystem.writeFile({
          path: filename,
          data: pdfBase64,
          directory: Directory.Documents,
          recursive: true,
        });
        
        console.log('Ã¢Å“â€¦ PDF saved to:', result.uri);
        
        // Extract the actual file path from the URI
        const filePath = result.uri.replace('file://', '');

        // Show download notification (optional - may not be registered yet)
        try {
          await DownloadNotification.showDownloadNotification({
            filePath: filePath,
            fileName: filename,
            title: 'PDF Downloaded',
            message: `${filename} is ready to view`,
          });
          console.log('Ã¢Å“â€¦ Download notification shown');
        } catch (notifError) {
          console.error('Ã¢Å¡Â Ã¯Â¸Â Notification plugin not available:', notifError);
          // Continue - notification is optional
        }

        // Auto-open PDF directly in default PDF viewer (no share dialog)
        try {
          await FileOpener.open({
            filePath: result.uri,
            contentType: 'application/pdf',
            openWithDefault: true,
          });
          console.log('Ã¢Å“â€¦ PDF auto-opened in default viewer');
        } catch (openError) {
          console.error('Ã¢Å¡Â Ã¯Â¸Â Failed to auto-open PDF:', openError);
          // Show success message as fallback
          alert(
            `PDF saved successfully!\n\nFile: ${filename}\nLocation: Documents folder\n\nPlease open it from your file manager.`,
          );
        }
      } catch (error) {
        console.error('Ã¢ÂÅ’ Mobile save error:', error);
        // Fallback to browser download
        console.log('Ã°Å¸â€â€ž Falling back to browser download');
        pdf.save(filename);
      }
    } else {
      // Web browser - use normal download
      console.log('Ã°Å¸â€™Â» Web detected - using browser download');
      pdf.save(filename);
    }

    // Restore cursor
    document.body.style.cursor = originalCursor;
    
    console.log('Ã¢Å“â€¦ PDF export complete');
    console.groupCollapsed('Ã°Å¸â€œâ€¹ PDF EXPORT SUMMARY');
    console.table({
      'Quote Number': quoteNumber,
      'Client Name': clientName || 'Ã¢â‚¬â€',
      'Filename': filename,
      'Total Pages': pageCount,
      'jsPDF Page Count': pdf.getNumberOfPages(),
      'Quote Type': isMultiService ? 'Multi-Service' : 'Single-Service',
      'Device': isMobileDevice ? 'Mobile' : 'Desktop',
    });
    console.groupEnd();
    return Promise.resolve();
  } catch (error) {
    logger.error('PDF Export Error:', error);
    document.body.style.cursor = 'default';
    throw new Error('Failed to generate PDF. Please try again.');
  }
};

export const exportToPDFWithOptions = async (
  element: HTMLElement,
  options: {
    quoteNumber: string;
    templateType: TemplateType;
    filename?: string;
    scale?: number;
    orientation?: 'portrait' | 'landscape';
  },
): Promise<void> => {
  const {
    quoteNumber,
    templateType: _templateType,
    filename,
    scale = 2,
    orientation = 'portrait',
  } = options;

  try {
    document.body.style.cursor = 'wait';
    await ensurePdfFontLoaded();

    // Force desktop A4 layout for PDF capture regardless of screen size
    const a4WidthPx = orientation === 'portrait' ? 794 : 1123; // 210mm or 297mm at 96dpi
    const originalStyle = element.getAttribute('style') || '';
    const originalClass = element.className;
    element.style.width = `${a4WidthPx}px`;
    element.style.maxWidth = `${a4WidthPx}px`;
    element.style.minWidth = `${a4WidthPx}px`;
    element.style.position = 'absolute';
    element.style.left = '-9999px';
    element.style.top = '0';
    element.classList.add('pdf-export-mode');

    await new Promise((r) => setTimeout(r, 100));

    const canvas = await html2canvas(element, {
      scale,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      width: a4WidthPx,
      windowWidth: a4WidthPx,
      onclone: (doc) => {
        enforcePdfFontInClonedDoc(doc);
      },
    });

    // Restore original styles immediately after capture
    element.setAttribute('style', originalStyle);
    element.className = originalClass;

    const imgWidth = orientation === 'portrait' ? 210 : 297;
    const pageHeight = orientation === 'portrait' ? 297 : 210;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    const pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    const imgData = canvas.toDataURL('image/png', 0.95);
    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const finalFilename = filename || `${timestamp}__${quoteNumber}.pdf`;

    // Handle mobile vs web differently
    if (isMobile()) {
      console.log('Ã°Å¸â€œÂ± Mobile detected - using Filesystem API');
      try {
        const pdfBase64 = pdf.output('dataurlstring').split(',')[1];

        const result = await Filesystem.writeFile({
          path: finalFilename,
          data: pdfBase64,
          directory: Directory.Documents,
          recursive: true,
        });
        
        console.log('Ã¢Å“â€¦ PDF saved to:', result.uri);
        
        // Extract the actual file path from the URI
        const filePath = result.uri.replace('file://', '');

        // Show download notification
        try {
          await DownloadNotification.showDownloadNotification({
            filePath: filePath,
            fileName: finalFilename,
            title: 'PDF Downloaded',
            message: `${finalFilename} is ready to view`,
          });
          console.log('Ã¢Å“â€¦ Download notification shown');
        } catch (notifError) {
          console.error('Ã¢Å¡Â Ã¯Â¸Â Failed to show notification:', notifError);
        }

        alert(
          `PDF saved successfully!\n\nFile: ${finalFilename}\nLocation: Documents folder\n\nTap the notification to open.`,
        );

        // Try to share if available
        if (navigator.share) {
          const pdfBlob = pdf.output('blob');
          const file = new File([pdfBlob], finalFilename, { type: 'application/pdf' });
          await navigator.share({
            files: [file],
            title: `Quote ${quoteNumber}`,
            text: `Quote document ${finalFilename}`,
          });
        }
      } catch (error) {
        console.error('Ã¢ÂÅ’ Mobile save error:', error);
        pdf.save(finalFilename);
      }
    } else {
      pdf.save(finalFilename);
    }

    document.body.style.cursor = 'default';

    return Promise.resolve();
  } catch (error) {
    logger.error('PDF Export Error:', error);
    document.body.style.cursor = 'default';
    throw error;
  }
};

// Function to estimate PDF file size
export const estimatePDFSize = (element: HTMLElement): number => {
  const width = element.scrollWidth;
  const height = element.scrollHeight;
  // Rough estimation: (width * height * 0.001) KB
  return Math.round((width * height * 0.001) / 1024); // in MB
};

// Function to validate element before export
export const validateElementForExport = (element: HTMLElement | null): boolean => {
  if (!element) {
    logger.error('Element is null');
    return false;
  }

  if (element.scrollHeight === 0 || element.scrollWidth === 0) {
    logger.error('Element has no dimensions');
    return false;
  }

  return true;
};

