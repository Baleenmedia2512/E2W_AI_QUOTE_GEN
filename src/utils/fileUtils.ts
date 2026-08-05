import * as XLSX from 'xlsx';

export interface FileExtractionResult {
  textContent: string;
  pageCount: number;
  images: string[];
  pageImages: Array<{ pageNumber: number; text: string; imageDataUrl: string }>;
}

/**
 * Validate image file (JPEG/JPG)
 */
export const validateImageFile = (file: File): { valid: boolean; error?: string } => {
  const maxSizeMB = Number(import.meta.env.VITE_MAX_FILE_SIZE_MB) || 10;
  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  const validTypes = ['image/jpeg', 'image/jpg'];
  if (!validTypes.includes(file.type.toLowerCase())) {
    return { valid: false, error: 'Only JPEG/JPG image files are allowed' };
  }

  if (file.size > maxSizeBytes) {
    return { valid: false, error: `File size must be less than ${maxSizeMB}MB` };
  }

  return { valid: true };
};

/**
 * Validate Excel file (XLSX/XLS)
 */
export const validateExcelFile = (file: File): { valid: boolean; error?: string } => {
  const maxSizeMB = Number(import.meta.env.VITE_MAX_FILE_SIZE_MB) || 10;
  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  const validTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
  ];
  
  const hasValidType = validTypes.includes(file.type) || 
                       file.name.toLowerCase().endsWith('.xlsx') || 
                       file.name.toLowerCase().endsWith('.xls');
  
  if (!hasValidType) {
    return { valid: false, error: 'Only Excel files (.xlsx, .xls) are allowed' };
  }

  if (file.size > maxSizeBytes) {
    return { valid: false, error: `File size must be less than ${maxSizeMB}MB` };
  }

  return { valid: true };
};

/**
 * Prepare image for display. OCR / Gemini Vision is disabled — qty-unit AI only.
 */
export const extractImageContent = async (file: File): Promise<FileExtractionResult> => {
  try {
    console.log('Starting image extraction for:', file.name, '(OCR disabled)');

    const arrayBuffer = await file.arrayBuffer();
    const base64String = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );
    const imageDataUrl = `data:${file.type};base64,${base64String}`;
    const textContent = '[OCR disabled — image uploaded for display only]';

    return {
      textContent,
      pageCount: 1,
      images: [imageDataUrl],
      pageImages: [{
        pageNumber: 1,
        text: textContent,
        imageDataUrl
      }]
    };
  } catch (error: any) {
    console.error('Error preparing image content:', error);
    throw new Error(`Failed to prepare image: ${error.message || 'Unknown error'}`);
  }
};

/**
 * Extract text from Excel file
 */
export const extractExcelContent = async (file: File): Promise<FileExtractionResult> => {
  try {
    console.log('Starting Excel extraction for:', file.name);
    
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    
    console.log('Excel workbook loaded, sheets:', workbook.SheetNames.length);
    
    let textContent = '';
    const sheets = workbook.SheetNames;
    
    // Extract content from all sheets
    sheets.forEach((sheetName, index) => {
      const worksheet = workbook.Sheets[sheetName];
      
      // Add sheet header
      textContent += `\n${'='.repeat(60)}\n`;
      textContent += `SHEET ${index + 1}: ${sheetName}\n`;
      textContent += `${'='.repeat(60)}\n\n`;
      
      // Convert sheet to CSV format with pipe delimiters for better structure
      // This preserves table layout better than plain text
      const csv = XLSX.utils.sheet_to_csv(worksheet, { FS: '\t|\t' });
      
      if (csv.trim()) {
        textContent += csv + '\n\n';
      } else {
        textContent += '(Empty sheet)\n\n';
      }
    });
    
    const finalText = textContent.trim();
    console.log('Excel extraction complete. Total text length:', finalText.length);
    
    if (finalText.length === 0) {
      throw new Error('Excel file appears to be empty or contains no readable data.');
    }
    
    // Create a simple preview image (optional - could be enhanced later)
    const pageImages = sheets.map((sheetName, index) => ({
      pageNumber: index + 1,
      text: `Sheet: ${sheetName}`,
      imageDataUrl: '' // No visual preview for now
    }));
    
    return {
      textContent: finalText,
      pageCount: sheets.length,
      images: [],
      pageImages
    };
  } catch (error: any) {
    console.error('Error extracting Excel content:', error);
    throw new Error(`Failed to extract Excel content: ${error.message || 'Unknown error'}`);
  }
};

/**
 * Detect file type from File object
 */
export const detectFileType = (file: File): 'pdf' | 'image' | 'excel' | 'unknown' => {
  const fileName = file.name.toLowerCase();
  const fileType = file.type.toLowerCase();
  
  // Check PDF
  if (fileType.includes('pdf') || fileName.endsWith('.pdf')) {
    return 'pdf';
  }
  
  // Check Image (JPEG/JPG)
  if (fileType.includes('jpeg') || fileType.includes('jpg') || 
      fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
    return 'image';
  }
  
  // Check Excel
  if (fileType.includes('spreadsheet') || fileType.includes('excel') ||
      fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
    return 'excel';
  }
  
  return 'unknown';
};
