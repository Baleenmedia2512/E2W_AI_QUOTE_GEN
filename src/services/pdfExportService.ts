import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { TemplateType } from '../types';

export const exportToPDF = async (
  element: HTMLElement,
  quoteNumber: string,
  _templateType: TemplateType
): Promise<void> => {
  try {
    console.log('📸 Starting PDF export process...');
    console.log('Element to capture:', element);
    console.log('Quote number:', quoteNumber);
    
    // Show loading state
    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = 'wait';

    console.log('📸 Capturing element as canvas...');

    // Force desktop A4 layout for PDF capture regardless of screen size
    const a4WidthPx = 794; // 210mm at 96dpi
    const originalStyle = element.getAttribute('style') || '';
    const originalClass = element.className;
    element.style.width = `${a4WidthPx}px`;
    element.style.maxWidth = `${a4WidthPx}px`;
    element.style.minWidth = `${a4WidthPx}px`;
    element.style.position = 'absolute';
    element.style.left = '-9999px';
    element.style.top = '0';
    // Force desktop styles by adding a class
    element.classList.add('pdf-export-mode');

    // Let the browser reflow with desktop dimensions
    await new Promise(r => setTimeout(r, 100));

    // Capture the element as canvas with high quality
    const canvas = await html2canvas(element, {
      scale: 2, // Higher quality
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: true,
      width: a4WidthPx,
      windowWidth: a4WidthPx
    });

    // Restore original styles immediately after capture
    element.setAttribute('style', originalStyle);
    element.className = originalClass;
    
    console.log('✅ Canvas captured:', canvas.width, 'x', canvas.height);

    // Calculate dimensions for A4 in portrait mode
    const imgWidth = 210; // A4 width in mm
    const pageHeight = 297; // A4 height in mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    // Create PDF
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    let heightLeft = imgHeight;
    let position = 0;
    let pageNumber = 1;

    // Add image to first page
    const imgData = canvas.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
    heightLeft -= pageHeight;

    // Add additional pages if needed
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pageNumber++;
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
      heightLeft -= pageHeight;
    }

    // Generate filename
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `Quote_${quoteNumber}_${timestamp}.pdf`;

    console.log('💾 Saving PDF as:', filename);
    // Save the PDF
    pdf.save(filename);

    // Restore cursor
    document.body.style.cursor = originalCursor;
    
    console.log('✅ PDF saved successfully');
    return Promise.resolve();
  } catch (error) {
    console.error('PDF Export Error:', error);
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
  }
): Promise<void> => {
  const {
    quoteNumber,
    templateType: _templateType,
    filename,
    scale = 2,
    orientation = 'portrait'
  } = options;

  try {
    document.body.style.cursor = 'wait';

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

    await new Promise(r => setTimeout(r, 100));

    const canvas = await html2canvas(element, {
      scale,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      width: a4WidthPx,
      windowWidth: a4WidthPx
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
      compress: true
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

    const timestamp = new Date().toISOString().split('T')[0];
    const finalFilename = filename || `Quote_${quoteNumber}_${timestamp}.pdf`;

    pdf.save(finalFilename);
    document.body.style.cursor = 'default';

    return Promise.resolve();
  } catch (error) {
    console.error('PDF Export Error:', error);
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
    console.error('Element is null');
    return false;
  }

  if (element.scrollHeight === 0 || element.scrollWidth === 0) {
    console.error('Element has no dimensions');
    return false;
  }

  return true;
};
