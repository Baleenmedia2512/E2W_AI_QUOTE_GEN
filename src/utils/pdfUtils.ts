import * as pdfjsLib from 'pdfjs-dist';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Configure PDF.js worker - Use unpkg CDN as fallback with proper configuration
// Try multiple CDN sources for better reliability
const workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

console.log('PDF.js worker configured:', workerSrc);

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  imageDataUrl: string;
  croppedImages?: string[];
}

// --- Gemini Vision Auto-Crop Helpers ---

interface ImageBoundingBox {
  box: [number, number, number, number]; // [y_min, x_min, y_max, x_max] in 0-1000 scale
  label: string;
  noPad?: boolean; // true for grid-split boxes that share exact boundaries — skip crop padding to prevent bleed
}

function shouldAttemptCropping(pageText: string): boolean {
  const text = pageText.toLowerCase().replace(/\s*\|\s*/g, '').replace(/\s+/g, ' ');

  if (text.includes('reference image') || text.includes('reference images') ||
      text.includes('design specification') || text.includes('design specifications') ||
      text.includes('design specs') || text.includes('specification') ||
      text.includes('customer review') || text.includes('client review') ||
      text.includes('reference photo') || text.includes('example image') ||
      text.includes('sample photo') ||
      text.includes('sample image') || text.includes('display area')) {
    return true;
  }

  const pagePattern = text.match(/\((\d+)\/(\d+)\)/);
  if (pagePattern && parseInt(pagePattern[1]) >= 2) {
    return true;
  }

  if (pageText.trim().length < 150) {
    return true;
  }

  return false;
}

async function detectImageRegions(imageDataUrl: string, pageNumber: number): Promise<ImageBoundingBox[]> {
  try {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey || apiKey.trim() === '') return [];

    const genAI = new GoogleGenerativeAI(apiKey.trim());
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

    const base64Data = imageDataUrl.split(',')[1];

    const prompt = `Analyze this advertising/media proposal PDF page image. Detect all reference photographs and advertising mockup images.

Types to detect:
- Metro/train/bus/transit interior photos showing advertising panels or branding inside coaches/compartments
- Vehicle branding mockups: bus, auto-rickshaw, van, car, metro coach exterior wraps
- Outdoor advertising: billboards, hoardings, LED panels, flex prints, lamp post displays, traffic boards
- Signage: standees, branding boards, street furniture displays
- General reference photos and design example images

Critical rules for metro/train interior photos:
- Treat each complete photo of a metro coach interior, train compartment, or transit vehicle interior as ONE bounding box — even if multiple advertisement panels are visible INSIDE the photo
- Do NOT create separate boxes for individual advertisement posters/panels that appear inside a metro/train photo — the whole coach interior view is one image
- If the page has 2 separate metro interior photos (e.g. one above the other), return 2 separate boxes

General rules:
- ONLY detect actual photographs and mockup images — ignore text blocks, tables, headers, footers, page numbers, small logos (under 4% of page area), decorative lines, watermarks
- Each detected region must be at least 4% of the total page area
- Include any visible border or frame within the bounding box
- Detect all photos even if stacked vertically or placed side by side

Return ONLY a valid JSON array (no markdown, no explanation):
[{"box": [y_min, x_min, y_max, x_max], "label": "short description"}]

Coordinates use 0-1000 normalized scale where [0,0] is top-left and [1000,1000] is bottom-right.
If no photos or mockup images are found, return exactly: []`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: 'image/jpeg', data: base64Data } }
    ]);

    const response = await result.response;
    const text = response.text().trim();

    console.log(`📦 Gemini Vision response for page ${pageNumber}:`, text.substring(0, 200));

    let jsonStr = text;
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1];
    }
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return [];

    const rawBoxes: any[] = JSON.parse(arrayMatch[0]);

    // Normalize: Gemini Vision sometimes returns "box" and sometimes "box_2d" as the key.
    // Coerce every item so b.box always holds the coords array before filtering/cropping.
    const boxes: ImageBoundingBox[] = rawBoxes.map((b: any) => ({
      ...b,
      box: (b.box_2d || b.box) as [number, number, number, number],
    }));

    const validBoxes = boxes.filter(b => {
      if (!b.box || !Array.isArray(b.box) || b.box.length !== 4) return false;
      const [yMin, xMin, yMax, xMax] = b.box;
      if (typeof yMin !== 'number' || typeof xMin !== 'number' ||
          typeof yMax !== 'number' || typeof xMax !== 'number') return false;
      if (yMin >= yMax || xMin >= xMax) return false;
      if (yMin < 0 || xMin < 0 || yMax > 1000 || xMax > 1000) return false;
      const area = ((yMax - yMin) * (xMax - xMin)) / (1000 * 1000);
      return area >= 0.04;
    });

    // IoU deduplication: Gemini often returns multiple overlapping boxes for the same
    // visual element (e.g. 5 nearly-identical bounding boxes for one mockup image).
    // Sort by area descending (prefer largest box), then discard any box that overlaps
    // more than 40% with an already-kept box.
    const sorted = [...validBoxes].sort((a, b) => {
      const areaA = (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]);
      const areaB = (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]);
      return areaB - areaA; // largest first
    });
    const deduped: ImageBoundingBox[] = [];
    for (const box of sorted) {
      const [yMin, xMin, yMax, xMax] = box.box;
      const boxArea = (yMax - yMin) * (xMax - xMin);
      const overlaps = deduped.some(k => {
        const [kyMin, kxMin, kyMax, kxMax] = k.box;
        const kArea = (kyMax - kyMin) * (kxMax - kxMin);
        const interY = Math.max(0, Math.min(yMax, kyMax) - Math.max(yMin, kyMin));
        const interX = Math.max(0, Math.min(xMax, kxMax) - Math.max(xMin, kxMin));
        const interArea = interY * interX;
        const unionArea = boxArea + kArea - interArea;
        const iou = unionArea > 0 ? interArea / unionArea : 0;
        return iou > 0.20; // 20% overlap → treat as duplicate (lower = keep adjacent grid photos)
      });
      if (!overlaps) deduped.push(box);
    }
    console.log(`📦 Boxes after IoU dedup: ${deduped.length} (was ${validBoxes.length})`);

    // ── Phase 1: Wide / tall strip splitter ─────────────────────────────────
    // Gemini sometimes returns 2 full-width horizontal strips (one per row)
    // instead of 4 individual photos. Split any box that spans >65% of the page
    // width (or height) into two halves — left/right or top/bottom.
    // Runs only when we have fewer than 4 boxes.
    let working: ImageBoundingBox[] = [...deduped];
    if (working.length < 4) {
      const splitPass: ImageBoundingBox[] = [];
      for (const b of working) {
        const [y0, x0, y1, x1] = b.box;
        const w = x1 - x0;
        const h = y1 - y0;
        const area = (w * h) / (1000 * 1000);
        if (w > 650 && area >= 0.12) {
          // Wide strip → split left / right
          const mx = Math.round((x0 + x1) / 2);
          splitPass.push({ box: [y0, x0, y1, mx] as [number,number,number,number], label: b.label + '-L', noPad: true });
          splitPass.push({ box: [y0, mx, y1, x1] as [number,number,number,number], label: b.label + '-R', noPad: true });
          console.log(`✂️ Split wide strip (w=${w}) into left/right`);
        } else if (h > 600 && area >= 0.12) {
          // Tall strip → split top / bottom
          const my = Math.round((y0 + y1) / 2);
          splitPass.push({ box: [y0, x0, my, x1] as [number,number,number,number], label: b.label + '-T', noPad: true });
          splitPass.push({ box: [my, x0, y1, x1] as [number,number,number,number], label: b.label + '-B', noPad: true });
          console.log(`✂️ Split tall strip (h=${h}) into top/bottom`);
        } else {
          splitPass.push(b);
        }
      }
      if (splitPass.length > working.length) {
        console.log(`✂️ Strip split: ${working.length} → ${splitPass.length} boxes`);
        working = splitPass;
      }
    }
    if (working.length >= 4) return working;

    // ── Phase 2: Single large merged block → 4 quadrants ────────────────────
    // Handles the case where Gemini returns 1 box covering the entire 2×2 grid.
    if (working.length < 3 && working.length > 0) {
      const largest = working.reduce((a, b) => {
        const aArea = (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]);
        const bArea = (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]);
        return bArea > aArea ? b : a;
      });
      const [yMin, xMin, yMax, xMax] = largest.box;
      const largestArea = ((yMax - yMin) * (xMax - xMin)) / (1000 * 1000);
      if (largestArea >= 0.35) {
        const midY = Math.round((yMin + yMax) / 2);
        const midX = Math.round((xMin + xMax) / 2);
        const quadrants: ImageBoundingBox[] = [
          { box: [yMin, xMin, midY, midX] as [number,number,number,number], label: 'grid-tl', noPad: true },
          { box: [yMin, midX, midY, xMax] as [number,number,number,number], label: 'grid-tr', noPad: true },
          { box: [midY, xMin, yMax, midX] as [number,number,number,number], label: 'grid-bl', noPad: true },
          { box: [midY, midX, yMax, xMax] as [number,number,number,number], label: 'grid-br', noPad: true },
        ];
        console.log(`🔲 Grid fallback: splitting 1 large box (area ${(largestArea*100).toFixed(0)}%) into 4 quadrants`);
        const others = working.filter(b => b !== largest);
        return [...quadrants, ...others];
      }
    }

    // ── Phase 3: Quadrant coverage fill ─────────────────────────────────────
    // Handles the "3 detected, 1 missed" case.
    // Uses actual detected box edges as the row/column seam so the filled box
    // aligns perfectly with its neighbours — no bleed or overlap at boundaries.
    if (working.length >= 1 && working.length < 4) {
      let envY0 = 1000, envX0 = 1000, envY1 = 0, envX1 = 0;
      for (const b of working) {
        const [y0, x0, y1, x1] = b.box;
        envY0 = Math.min(envY0, y0); envX0 = Math.min(envX0, x0);
        envY1 = Math.max(envY1, y1); envX1 = Math.max(envX1, x1);
      }
      const envArea = ((envY1 - envY0) * (envX1 - envX0)) / (1000 * 1000);
      if (envArea >= 0.20) {
        const geoMidY = (envY0 + envY1) / 2;
        const geoMidX = (envX0 + envX1) / 2;
        const topRowBoxes  = working.filter(b => (b.box[0] + b.box[2]) / 2 < geoMidY);
        const leftColBoxes = working.filter(b => (b.box[1] + b.box[3]) / 2 < geoMidX);
        const seamY = topRowBoxes.length  > 0 ? Math.max(...topRowBoxes.map(b  => b.box[2])) : geoMidY;
        const seamX = leftColBoxes.length > 0 ? Math.max(...leftColBoxes.map(b => b.box[3])) : geoMidX;
        const gridQuads: Array<[number, number, number, number]> = [
          [envY0, envX0, seamY, seamX],
          [envY0, seamX, seamY, envX1],
          [seamY, envX0, envY1, seamX],
          [seamY, seamX, envY1, envX1],
        ];
        const extra: ImageBoundingBox[] = [];
        for (const [qy0, qx0, qy1, qx1] of gridQuads) {
          const qArea = (qy1 - qy0) * (qx1 - qx0);
          let covered = 0;
          for (const b of working) {
            const [by0, bx0, by1, bx1] = b.box;
            const iy = Math.max(0, Math.min(qy1, by1) - Math.max(qy0, by0));
            const ix = Math.max(0, Math.min(qx1, bx1) - Math.max(qx0, bx0));
            covered += iy * ix;
          }
          if (qArea > 0 && covered / qArea < 0.50) {
            extra.push({ box: [qy0, qx0, qy1, qx1] as [number,number,number,number], label: 'grid-fill', noPad: true });
          }
        }
        if (extra.length > 0 && extra.length < 4) {
          console.log(`🔲 Quadrant fill: adding ${extra.length} uncovered region(s) (seamY=${seamY}, seamX=${seamX})`);
          return [...working, ...extra];
        }
      }
    }

    return working;
  } catch (error) {
    console.warn(`⚠️ Gemini Vision detection failed for page ${pageNumber}:`, error);
    return [];
  }
}

function cropImageRegions(imageDataUrl: string, boxes: ImageBoundingBox[]): Promise<string[]> {
  return new Promise((resolve) => {
    if (boxes.length === 0) {
      resolve([]);
      return;
    }

    const img = new Image();
    img.onload = () => {
      const croppedImages: string[] = [];
      const width = img.naturalWidth;
      const height = img.naturalHeight;

      for (const item of boxes) {
        try {
          // item.box is already normalized (box_2d || box) from detectImageRegions
          const [yMin, xMin, yMax, xMax] = item.box;
          const padding = item.noPad ? 0 : 15; // grid-split boxes share exact boundaries — no padding to prevent bleed
          const sx = Math.max(0, Math.round(((xMin - padding) / 1000) * width));
          const sy = Math.max(0, Math.round(((yMin - padding) / 1000) * height));
          const ex = Math.min(width, Math.round(((xMax + padding) / 1000) * width));
          const ey = Math.min(height, Math.round(((yMax + padding) / 1000) * height));
          const sw = ex - sx;
          const sh = ey - sy;

          if (sw < 30 || sh < 30) continue;

          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = sw;
          cropCanvas.height = sh;
          const ctx = cropCanvas.getContext('2d');
          if (!ctx) continue;

          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
          croppedImages.push(cropCanvas.toDataURL('image/jpeg', 0.85));
        } catch (err) {
          console.warn('⚠️ Failed to crop region:', err);
        }
      }

      resolve(croppedImages);
    };
    img.onerror = () => resolve([]);
    img.src = imageDataUrl;
  });
}

/**
 * Exported wrapper: Detect and crop reference image regions from a single page.
 * Called lazily at render time when upload-time cropping was skipped or returned empty.
 * Does NOT affect the main extractPDFContent upload flow.
 */
export async function cropReferencePageImage(imageDataUrl: string, pageNumber: number): Promise<string[]> {
  const boxes = await detectImageRegions(imageDataUrl, pageNumber);
  if (boxes.length === 0) return [];
  return cropImageRegions(imageDataUrl, boxes);
}

/**
 * Geometric fallback: strip header (~18%) and footer (~8%) from a page image.
 * Used when Gemini Vision returns no bounding boxes but full-page fallback would show
 * heading text / whitespace / nav buttons.
 * Pure canvas math — no API call.
 */
export function cropPageStrippingHeaderFooter(imageDataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const topCut = Math.round(h * 0.18);   // strip top 18% (heading + whitespace)
      const bottomCut = Math.round(h * 0.08); // strip bottom 8% (footer/nav buttons)
      const newH = h - topCut - bottomCut;
      if (newH < 50) { resolve(imageDataUrl); return; }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = newH;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(imageDataUrl); return; }
      ctx.drawImage(img, 0, topCut, w, newH, 0, 0, w, newH);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(imageDataUrl);
    img.src = imageDataUrl;
  });
}

/**
 * Spec diagram crop: pixel-scans the image to find exact top/bottom boundaries of
 * non-white content (the dimension diagram), then crops tightly to that region with
 * a small padding. Skips the top 30% of the page first to avoid matching heading text.
 * Pure canvas math — no API call.
 */
export function cropSpecDiagram(imageDataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;

      // Render full image to a canvas so we can read pixels
      const scanCanvas = document.createElement('canvas');
      scanCanvas.width = w;
      scanCanvas.height = h;
      const scanCtx = scanCanvas.getContext('2d');
      if (!scanCtx) { resolve(imageDataUrl); return; }
      scanCtx.drawImage(img, 0, 0, w, h);
      const pixels = scanCtx.getImageData(0, 0, w, h).data;

      // Returns true if a row has enough strongly-dark pixels to be real
      // diagram content. Ignores faint diagonal watermarks ("BALEEN MEDIA")
      // by requiring DARK pixels (channel < 180) AND a minimum count per row.
      const rowHasContent = (y: number): boolean => {
        const base = y * w * 4;
        let darkCount = 0;
        const required = Math.max(8, Math.round(w * 0.01)); // ~1% of width, at least 8 px
        for (let x = 0; x < w; x++) {
          const i = base + x * 4;
          if (pixels[i] < 180 && pixels[i + 1] < 180 && pixels[i + 2] < 180) {
            darkCount++;
            if (darkCount >= required) return true;
          }
        }
        return false;
      };

      // The page top contains: "Back to Summary" button, "DESIGN SPECIFICATIONS"
      // heading, and "Material: Vinyl sticker..." text. The actual diagram begins
      // roughly at 38% down. Skip past all of that.
      const scanStart = Math.round(h * 0.38);
      // End scanning at 91% — page numbers/footers typically sit in the bottom 8-9%
      const scanEnd = Math.round(h * 0.91);

      let contentTop = -1;
      let contentBottom = -1;

      for (let y = scanStart; y < scanEnd; y++) {
        if (rowHasContent(y)) { contentTop = y; break; }
      }
      for (let y = scanEnd; y >= scanStart; y--) {
        if (rowHasContent(y)) { contentBottom = y; break; }
      }

      // Fallback to fixed crop if scan found nothing
      if (contentTop === -1 || contentBottom === -1) {
        const topCut = Math.round(h * 0.38);
        const bottomCut = Math.round(h * 0.09);
        const newH = h - topCut - bottomCut;
        if (newH < 50) { resolve(imageDataUrl); return; }
        const fallbackCanvas = document.createElement('canvas');
        fallbackCanvas.width = w;
        fallbackCanvas.height = newH;
        const fc = fallbackCanvas.getContext('2d');
        if (!fc) { resolve(imageDataUrl); return; }
        fc.drawImage(img, 0, topCut, w, newH, 0, 0, w, newH);
        resolve(fallbackCanvas.toDataURL('image/jpeg', 0.85));
        return;
      }

      // Add padding around the detected content
      const pad = Math.round(h * 0.005); // 0.5% padding (tight)
      const cropTop = Math.max(0, contentTop - pad);
      const cropBottom = Math.min(h, contentBottom + pad);
      const cropH = cropBottom - cropTop;

      if (cropH < 50) { resolve(imageDataUrl); return; }

      const outCanvas = document.createElement('canvas');
      outCanvas.width = w;
      outCanvas.height = cropH;
      const outCtx = outCanvas.getContext('2d');
      if (!outCtx) { resolve(imageDataUrl); return; }
      outCtx.drawImage(img, 0, cropTop, w, cropH, 0, 0, w, cropH);
      resolve(outCanvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(imageDataUrl);
    img.src = imageDataUrl;
  });
}

/**
 * Geometric crop: return only the top half or bottom half of a page image.
 * Used to separate Design Specification (top) from Reference Image (bottom)
 * when both sections share the same PDF page.
 * Pure canvas math — no API call.
 */
export function cropPageHalf(imageDataUrl: string, half: 'top' | 'bottom'): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const halfH = Math.round(h * 0.5);
      const sy = half === 'top' ? 0 : halfH;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = halfH;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(imageDataUrl); return; }
      ctx.drawImage(img, 0, sy, w, halfH, 0, 0, w, halfH);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(imageDataUrl);
    img.src = imageDataUrl;
  });
}

/**
 * Crops the spec section above the reference image.
 * Returns the top 55% of the page — where the spec heading, material text and
 * dimension diagram live — discarding the reference photo at the bottom.
 * Pure canvas math — no API call.
 */
export function cropSpecAboveReference(imageDataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const cropH = Math.round(h * 0.55);
      if (cropH < 50) { resolve(imageDataUrl); return; }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = cropH;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(imageDataUrl); return; }
      ctx.drawImage(img, 0, 0, w, cropH, 0, 0, w, cropH);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(imageDataUrl);
    img.src = imageDataUrl;
  });
}

/**
 * Crop a page starting at a given percentage from the top, down to the bottom.
 * E.g. cropPageFromPercent(url, 0.30) returns the bottom 70% of the page.
 * Used when header + spec text block occupies a known fraction of the page.
 */
export function cropPageFromPercent(imageDataUrl: string, fromTopPercent: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const sy = Math.round(h * fromTopPercent);
      const newH = h - sy;
      if (newH < 50) { resolve(imageDataUrl); return; }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = newH;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(imageDataUrl); return; }
      ctx.drawImage(img, 0, sy, w, newH, 0, 0, w, newH);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(imageDataUrl);
    img.src = imageDataUrl;
  });
}

// --- End Auto-Crop Helpers ---

// --- Customer Review OCR via Gemini Vision ---

export interface GeminiReviewData {
  reviewerName: string;
  starCount: number;
  reviewText: string;
}

/**
 * Uses Gemini Vision to OCR the customer review card embedded as an image inside a PDF page.
 * Only called when pdfjs text extraction could not find reviewer name / review body.
 */
export async function extractReviewViaGemini(imageDataUrl: string): Promise<GeminiReviewData | null> {
  try {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey || apiKey.trim() === '') return null;

    const genAI = new GoogleGenerativeAI(apiKey.trim());
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

    const base64Data = imageDataUrl.split(',')[1];

    const prompt = `This is a page from an advertising proposal PDF. It contains a Google Review / customer review card embedded as an image.

Extract the following from the review card:
1. Reviewer name (the person who wrote the review)
2. Star rating (count the filled stars, a number from 1 to 5)
3. Review text (the full review paragraph written by the customer)

Return ONLY valid JSON, no markdown, no extra text:
{"reviewerName": "...", "starCount": 5, "reviewText": "..."}

If you cannot find any review content, return exactly: null`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: 'image/jpeg', data: base64Data } }
    ]);

    const response = await result.response;
    const text = response.text().trim();

    console.log('🔍 Gemini review OCR response:', text.substring(0, 300));

    if (text === 'null' || text === '') return null;

    let jsonStr = text;
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1];
    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!objMatch) return null;

    const parsed = JSON.parse(objMatch[0]);
    if (!parsed || typeof parsed !== 'object') return null;

    return {
      reviewerName: String(parsed.reviewerName || '').trim() || 'Customer',
      starCount: Math.min(5, Math.max(1, Number(parsed.starCount) || 5)),
      reviewText: String(parsed.reviewText || '').trim(),
    };
  } catch (error) {
    console.warn('⚠️ Gemini review OCR failed:', error);
    return null;
  }
}

// --- End Customer Review OCR ---

export interface PDFExtractionResult {
  textContent: string;
  pageCount: number;
  images: string[];
  pageImages: ExtractedPage[];
}

export const extractPDFContent = async (file: File, maxImagePages?: number): Promise<PDFExtractionResult> => {
  try {
    console.log('Starting PDF extraction for:', file.name, maxImagePages ? `(images: smart-select from first ${maxImagePages} pages or reference pages)` : '');
    const arrayBuffer = await file.arrayBuffer();
    console.log('ArrayBuffer loaded, size:', arrayBuffer.byteLength);
    
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pageCount = pdf.numPages;
    console.log('PDF loaded successfully, pages:', pageCount);
    
    let textContent = '';
    const images: string[] = [];
    const pageImages: ExtractedPage[] = [];

    // Keywords that indicate a page has reference images or specs worth rendering
    const referenceKeywords = [
      'reference image', 'reference images', 'sample image', 'display area',
      'design specification', 'design specifications', 'specification',
      '(2/', '(3/', '(4/', '(5/',  // page numbering like (2/3) = second page of section
    ];

    // Phase 1: Extract text from ALL pages
    const allPageTexts: { pageNumber: number; text: string; pdfPage: any }[] = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const items = content.items as any[];
      if (items.length === 0) {
        textContent += '\n\n';
        allPageTexts.push({ pageNumber: i, text: '', pdfPage: page });
        continue;
      }

      const sortedItems = [...items].filter(item => item.str && item.str.trim()).sort((a, b) => {
        const yDiff = b.transform[5] - a.transform[5];
        if (Math.abs(yDiff) > 5) return yDiff;
        return a.transform[4] - b.transform[4];
      });

      let pageText = '';
      let lastY = -1;
      for (const item of sortedItems) {
        const currentY = Math.round(item.transform[5]);
        if (lastY !== -1 && Math.abs(currentY - lastY) > 5) {
          pageText += '\n';
        } else if (lastY !== -1) {
          const gap = item.transform[4] - (sortedItems[sortedItems.indexOf(item) - 1]?.transform[4] || 0);
          pageText += gap > 50 ? '\t|\t' : ' ';
        }
        pageText += item.str;
        lastY = currentY;
      }

      textContent += pageText + '\n\n';
      console.log(`Page ${i}/${pageCount} extracted, text length:`, pageText.length);
      allPageTexts.push({ pageNumber: i, text: pageText, pdfPage: page });
    }

    // Phase 2: Render ALL pages as images so the full PDF is browsable in the UI
    console.log(`🖼️ Rendering all ${allPageTexts.length} pages as images`);

    // Phase 3: Render all pages as images
    for (const { pageNumber, text, pdfPage } of allPageTexts) {
      try {
        const viewport = pdfPage.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          await pdfPage.render({ canvasContext: ctx, viewport }).promise;
          const imageDataUrl = canvas.toDataURL('image/jpeg', 0.92);
          pageImages.push({ pageNumber, text, imageDataUrl });
          console.log(`Page ${pageNumber}/${pageCount} rendered as image`);
        }
      } catch (imgErr) {
        console.warn(`Failed to render page ${pageNumber} as image:`, imgErr);
      }
    }

    const finalText = textContent.trim();
    console.log('PDF extraction complete. Total text length:', finalText.length);
    
    if (finalText.length === 0) {
      console.warn('WARNING: PDF text extraction resulted in empty content');
      throw new Error('PDF appears to be empty or contains only images. Please use a PDF with selectable text.');
    }

    // Auto-crop reference images using Gemini Vision
    try {
      const pagesToCrop = pageImages.filter(p => shouldAttemptCropping(p.text));
      if (pagesToCrop.length > 0) {
        console.log(`🔍 Auto-cropping ${pagesToCrop.length} of ${pageImages.length} pages using Gemini Vision...`);

        for (let i = 0; i < pagesToCrop.length; i += 3) {
          const chunk = pagesToCrop.slice(i, i + 3);
          await Promise.all(chunk.map(async (page) => {
            const boxes = await detectImageRegions(page.imageDataUrl, page.pageNumber);
            if (boxes.length > 0) {
              console.log(`✅ Page ${page.pageNumber}: Detected ${boxes.length} image regions`);
              const cropped = await cropImageRegions(page.imageDataUrl, boxes);
              if (cropped.length > 0) {
                page.croppedImages = cropped;
                console.log(`✅ Page ${page.pageNumber}: Cropped ${cropped.length} images successfully`);
              }
            } else {
              console.log(`ℹ️ Page ${page.pageNumber}: No product images detected`);
            }
          }));

          if (i + 3 < pagesToCrop.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }

        const croppedCount = pageImages.filter(p => p.croppedImages && p.croppedImages.length > 0).length;
        console.log(`🎯 Auto-crop complete: ${croppedCount} pages have cropped images`);

        // ── IMAGE SUMMARY TABLE ──────────────────────────────────────────────
        console.log(`\n📊 ===== PDF IMAGE SUMMARY: "${file.name}" =====`);
        console.log(`   Total pages in PDF : ${pageCount}`);
        console.log(`   Pages rendered     : ${pageImages.length}`);
        console.log(`   Sent to Gemini     : ${pagesToCrop.length}`);
        pageImages.forEach(p => {
          const count = p.croppedImages?.length ?? 0;
          const wasCandidate = pagesToCrop.some(c => c.pageNumber === p.pageNumber);
          const status = count > 0
            ? `✅ ${count} cropped image(s)`
            : wasCandidate
              ? '🔍 candidate — 0 detected'
              : '○ not a candidate';
          console.log(`   Page ${String(p.pageNumber).padStart(2, ' ')} : ${status}`);
        });
        console.log(`   Pages with images  : ${croppedCount} / ${pageImages.length}`);
        console.log(`=================================================\n`);
        // ────────────────────────────────────────────────────────────────────
      }
    } catch (err) {
      console.warn('⚠️ Auto-crop processing failed, continuing with full page images:', err);
    }

    return {
      textContent: finalText,
      pageCount,
      images,
      pageImages,
    };
  } catch (error: any) {
    console.error('Error extracting PDF content:', error);
    if (error.message?.includes('empty') || error.message?.includes('images')) {
      throw error;
    }
    throw new Error(`Failed to extract PDF content: ${error.message || 'Unknown error'}`);
  }
};

export const validatePDFFile = (file: File): { valid: boolean; error?: string } => {
  const maxSizeMB = Number(import.meta.env.VITE_MAX_FILE_SIZE_MB) || 10;
  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  if (!file.type.includes('pdf')) {
    return { valid: false, error: 'Only PDF files are allowed' };
  }

  if (file.size > maxSizeBytes) {
    return { valid: false, error: `File size must be less than ${maxSizeMB}MB` };
  }

  return { valid: true };
};
