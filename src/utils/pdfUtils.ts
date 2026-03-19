import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker - Use unpkg CDN as fallback with proper configuration
// Try multiple CDN sources for better reliability
const workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

console.log('PDF.js worker configured:', workerSrc);

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  imageDataUrl: string;
}

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
