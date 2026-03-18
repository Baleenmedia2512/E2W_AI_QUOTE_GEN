import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export interface PDFExtractionResult {
  textContent: string;
  pageCount: number;
  images: string[];
}

export const extractPDFContent = async (file: File): Promise<PDFExtractionResult> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pageCount = pdf.numPages;
    
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
    }

    return {
      textContent: textContent.trim(),
      pageCount,
      images,
    };
  } catch (error) {
    console.error('Error extracting PDF content:', error);
    throw new Error('Failed to extract PDF content');
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
