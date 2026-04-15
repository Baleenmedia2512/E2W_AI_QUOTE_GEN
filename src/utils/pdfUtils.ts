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
}

function shouldAttemptCropping(pageText: string): boolean {
  const text = pageText.toLowerCase().replace(/\s*\|\s*/g, '').replace(/\s+/g, ' ');

  if (text.includes('reference image') || text.includes('design specification') ||
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

    const prompt = `Analyze this advertising/media proposal PDF page image. Detect all product photographs, reference photos, vehicle branding mockups, bus/auto/van/car wrapped images, signage photos, billboard images, hoarding images, and design example images.

Rules:
- ONLY detect actual photographs, mockup images, and product images
- IGNORE: text-only areas, pricing tables, rate cards, headers, footers, page numbers, small logos (under 5% of page), decorative lines/shapes/swooshes, watermarks, background patterns
- Each detected region must be at least 8% of the total page area
- If an image has a visible border or frame, include it within the bounding box
- Detect images even if they overlap or are stacked vertically

Return ONLY a valid JSON array (no markdown, no explanation, no extra text):
[{"box": [y_min, x_min, y_max, x_max], "label": "short description"}]

Coordinates use 0-1000 normalized scale where [0,0] is top-left corner and [1000,1000] is bottom-right corner.
If no product images or photos are found on this page, return exactly: []`;

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

    const boxes: ImageBoundingBox[] = JSON.parse(arrayMatch[0]);

    return boxes.filter(b => {
      if (!b.box || !Array.isArray(b.box) || b.box.length !== 4) return false;
      const [yMin, xMin, yMax, xMax] = b.box;
      if (typeof yMin !== 'number' || typeof xMin !== 'number' ||
          typeof yMax !== 'number' || typeof xMax !== 'number') return false;
      if (yMin >= yMax || xMin >= xMax) return false;
      if (yMin < 0 || xMin < 0 || yMax > 1000 || xMax > 1000) return false;
      const area = ((yMax - yMin) * (xMax - xMin)) / (1000 * 1000);
      return area >= 0.05;
    });
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
          const [yMin, xMin, yMax, xMax] = item.box;
          const padding = 15; // 1.5% padding
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

// --- End Auto-Crop Helpers ---

export interface PDFExtractionResult {
  textContent: string;
  pageCount: number;
  images: string[];
  pageImages: ExtractedPage[];
}

export const extractPDFContent = async (file: File): Promise<PDFExtractionResult> => {
  try {
    console.log('Starting PDF extraction for:', file.name);
    const arrayBuffer = await file.arrayBuffer();
    console.log('ArrayBuffer loaded, size:', arrayBuffer.byteLength);
    
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pageCount = pdf.numPages;
    console.log('PDF loaded successfully, pages:', pageCount);
    
    let textContent = '';
    const images: string[] = [];
    const pageImages: ExtractedPage[] = [];

    // Extract text and render page images
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      
      // Preserve layout structure: group text items by their Y position (line)
      // This prevents prices from different columns being jumbled together
      const items = content.items as any[];
      if (items.length === 0) {
        textContent += '\n\n';
        continue;
      }

      // Sort by Y position (descending = top-to-bottom) then X position (left-to-right)
      const sortedItems = [...items].filter(item => item.str && item.str.trim()).sort((a, b) => {
        const yDiff = b.transform[5] - a.transform[5];
        if (Math.abs(yDiff) > 5) return yDiff; // Different lines (5pt threshold)
        return a.transform[4] - b.transform[4]; // Same line, sort left-to-right
      });

      let pageText = '';
      let lastY = -1;
      for (const item of sortedItems) {
        const currentY = Math.round(item.transform[5]);
        if (lastY !== -1 && Math.abs(currentY - lastY) > 5) {
          pageText += '\n'; // New line
        } else if (lastY !== -1) {
          // Same line - use tab to separate columns
          const gap = item.transform[4] - (sortedItems[sortedItems.indexOf(item) - 1]?.transform[4] || 0);
          pageText += gap > 50 ? '\t|\t' : ' ';
        }
        pageText += item.str;
        lastY = currentY;
      }

      textContent += pageText + '\n\n';
      console.log(`Page ${i}/${pageCount} extracted, text length:`, pageText.length);

      // Render page as image for reference
      try {
        const viewport = page.getViewport({ scale: 1.0 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          await page.render({ canvasContext: ctx, viewport }).promise;
          const imageDataUrl = canvas.toDataURL('image/jpeg', 0.7);
          pageImages.push({
            pageNumber: i,
            text: pageText,
            imageDataUrl,
          });
          console.log(`Page ${i}/${pageCount} rendered as image`);
        }
      } catch (imgErr) {
        console.warn(`Failed to render page ${i} as image:`, imgErr);
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
