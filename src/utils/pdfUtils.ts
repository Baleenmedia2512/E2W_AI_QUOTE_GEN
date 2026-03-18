import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker - Use unpkg CDN as fallback with proper configuration
// Try multiple CDN sources for better reliability
const workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

console.log('PDF.js worker configured:', workerSrc);

export interface PDFExtractionResult {
  textContent: string;
  pageCount: number;
  images: string[];
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

    // Extract text from all pages
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => item.str)
        .join(' ');
      textContent += pageText + '\n\n';
      console.log(`Page ${i}/${pageCount} extracted, text length:`, pageText.length);
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
