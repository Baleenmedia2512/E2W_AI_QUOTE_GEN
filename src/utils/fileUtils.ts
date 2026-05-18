import { GoogleGenerativeAI } from '@google/generative-ai';
import * as XLSX from 'xlsx';
import { logger } from './logger';

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
 * Extract text from image using Gemini Vision API
 */
export const extractImageContent = async (file: File): Promise<FileExtractionResult> => {
  try {
    logger.info('Starting image extraction for:', file.name);
    
    // Convert image to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64String = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );
    
    // Create object URL for display
    const imageDataUrl = `data:${file.type};base64,${base64String}`;
    
    // Use Gemini Vision API for OCR
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('Gemini API key not configured. Please add VITE_GEMINI_API_KEY to your .env file.');
    }
    
    const genAI = new GoogleGenerativeAI(apiKey.trim());
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    
    logger.info('Sending image to Gemini Vision API for text extraction...');
    
    const prompt = `Extract ALL text content from this image. Preserve the layout, structure, and formatting as much as possible. Include:
- All headings and titles
- All body text and paragraphs
- All tables, pricing, and numerical data
- All lists and bullet points
- All labels and descriptions

Format the output as clean, structured text that maintains the original document's hierarchy and organization. Use tabs or pipes (|) to separate columns in tables.

CRITICAL FOR TABLES (ESPECIALLY RATE CARDS):
1. If the image contains a table with COLUMN HEADERS at the top, you MUST preserve them EXACTLY and align them with their data columns
2. For each data row, explicitly label which value belongs to which column
3. For rate card tables with editions/cities as rows and categories as columns:
   - First line: Extract ALL column headers from left to right (e.g., "Edition | Business/Finance | Education | Real Estate | Rental | Automobile Used | Automobile New | Service")
   - Each data row: Start with the row label (edition/city name), then list ALL values in the SAME ORDER as the headers
   - Use consistent pipe (|) separators between columns
   - Example format:
     Edition | Column1 | Column2 | Column3 | Column4
     City1   | Value1  | Value2  | Value3  | Value4
     City2   | Value1  | Value2  | Value3  | Value4
4. VERIFY: Count the number of columns in the header row and ensure each data row has the SAME number of values
5. If a table has merged cells or complex structure, use clear labels like "Column Name: Value" for each cell`;
    
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: file.type,
          data: base64String
        }
      }
    ]);
    
    const response = await result.response;
    const textContent = response.text();
    
    logger.info('Image text extraction successful, length:', textContent.length);
    
    if (!textContent || textContent.trim().length === 0) {
      throw new Error('No text could be extracted from the image. The image may not contain readable text.');
    }
    
    return {
      textContent: textContent.trim(),
      pageCount: 1,
      images: [imageDataUrl],
      pageImages: [{
        pageNumber: 1,
        text: textContent.trim(),
        imageDataUrl
      }]
    };
  } catch (error: any) {
    logger.error('Error extracting image content:', error);
    throw new Error(`Failed to extract text from image: ${error.message || 'Unknown error'}`);
  }
};

/**
 * Extract text from Excel file
 */
export const extractExcelContent = async (file: File): Promise<FileExtractionResult> => {
  try {
    logger.info('Starting Excel extraction for:', file.name);
    
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    
    logger.info('Excel workbook loaded, sheets:', workbook.SheetNames.length);
    
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
    logger.info('Excel extraction complete. Total text length:', finalText.length);
    
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
    logger.error('Error extracting Excel content:', error);
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
