import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { TemplateType } from '../types';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import DownloadNotification from '../plugins/downloadNotification';

// A4 dimensions at 96dpi (standard web resolution)
const A4_WIDTH_PX = 794;   // 210mm at 96dpi

/**
 * Captures a specific section at fixed A4 dimensions for consistent PDF output
 */
const captureSectionAtA4 = async (containerId: string): Promise<HTMLCanvasElement | null> => {
  const source = document.getElementById(containerId);
  if (!source) {
    console.warn(`⚠️ Section ${containerId} not found`);
    return null;
  }

  console.log(`📸 Capturing section: ${containerId}`);
  
  // Create off-screen clone at fixed A4 width
  const clone = source.cloneNode(true) as HTMLElement;
  
  Object.assign(clone.style, {
    position: 'fixed',
    top: '-99999px',
    left: '-99999px',
    width: `${A4_WIDTH_PX}px`,
    minWidth: `${A4_WIDTH_PX}px`,
    maxWidth: `${A4_WIDTH_PX}px`,
    overflow: 'hidden',
    margin: '0',
    // NO padding here - let CSS handle it via template classes
    boxSizing: 'border-box',
    backgroundColor: '#ffffff',
    display: 'block'
  });
  
  document.body.appendChild(clone);

  try {
    // Wait for fonts to load
    await document.fonts.ready;
    console.log('✅ Fonts loaded');
    
    // Wait for all images in the clone to load
    const images = Array.from(clone.querySelectorAll('img'));
    await Promise.all(
      images.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve(); // Continue even if image fails
        });
      })
    );
    console.log(`✅ ${images.length} images loaded`);

    // Small delay for final reflow
    await new Promise(r => setTimeout(r, 150));

    // Capture with html2canvas at fixed A4 width
    const canvas = await html2canvas(clone, {
      scale: 2,
      width: A4_WIDTH_PX,
      windowWidth: A4_WIDTH_PX,
      scrollX: 0,
      scrollY: 0,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false
    });

    console.log(`✅ Section captured: ${canvas.width}x${canvas.height}px`);
    return canvas;
  } catch (error) {
    console.error(`❌ Failed to capture ${containerId}:`, error);
    throw error;
  } finally {
    // Clean up clone
    document.body.removeChild(clone);
  }
};

/**
 * Legacy fallback: capture entire element if section IDs not found
 */
const legacyFullCapture = async (
  element: HTMLElement,
  pdf: jsPDF,
  pdfWidth: number,
  pdfHeight: number
): Promise<void> => {
  console.log('🔄 Using legacy full-element capture');
  
  const originalStyle = element.getAttribute('style') || '';
  const originalClass = element.className;
  
  Object.assign(element.style, {
    width: `${A4_WIDTH_PX}px`,
    minWidth: `${A4_WIDTH_PX}px`,
    maxWidth: `${A4_WIDTH_PX}px`,
    position: 'absolute',
    left: '-9999px',
    top: '0'
  });
  
  await document.fonts.ready;
  await new Promise(r => setTimeout(r, 200));
  
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    allowTaint: false,
    backgroundColor: '#ffffff',
    logging: false,
    width: A4_WIDTH_PX,
    windowWidth: A4_WIDTH_PX,
    scrollX: 0,
    scrollY: 0
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
  _templateType: TemplateType
): Promise<void> => {
  try {
    console.log('📸 Starting PDF export process...');
    console.log('Element to capture:', element);
    console.log('Quote number:', quoteNumber);
    
    // Show loading state
    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = 'wait';

    const isMobileDevice = isMobile();
    console.log('📱 Device type:', isMobileDevice ? 'Mobile' : 'Desktop');

    // Create PDF with A4 dimensions
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4', // Always A4: 210mm × 297mm
      compress: true
    });

    const pdfWidth = 210; // mm
    const pdfHeight = 297; // mm
    let pageCount = 0;

    // --- SECTION 1: Quotation Content (Page 1) ---
    console.log('📄 Capturing quotation content...');
    const quotationCanvas = await captureSectionAtA4('pdf-page-1');
    
    if (quotationCanvas) {
      const imgData1 = quotationCanvas.toDataURL('image/png');
      const aspectRatio1 = quotationCanvas.height / quotationCanvas.width;
      const imgHeight1 = pdfWidth * aspectRatio1;
      
      // Handle multi-page for quotation if needed
      pdf.addImage(imgData1, 'PNG', 0, 0, pdfWidth, imgHeight1);
      pageCount++;
      console.log(`✅ Page 1 added (quotation): ${pdfWidth}×${Math.round(imgHeight1)}mm`);
      
      // If quotation content overflows, add pages
      let remainingHeight = imgHeight1 - pdfHeight;
      let yOffset = -pdfHeight;
      while (remainingHeight > 0) {
        pdf.addPage();
        pageCount++;
        pdf.addImage(imgData1, 'PNG', 0, yOffset, pdfWidth, imgHeight1);
        yOffset -= pdfHeight;
        remainingHeight -= pdfHeight;
      }
    } else {
      console.warn('⚠️ Quotation section not found, using fallback full capture');
      // Fallback to original method if sections not found
      await legacyFullCapture(element, pdf, pdfWidth, pdfHeight);
      pageCount = 1;
    }

    // --- SECTION 2: Reference Images (Page 2+) ---
    console.log('📄 Checking for reference images...');
    const referenceCanvas = await captureSectionAtA4('pdf-page-2');
    
    if (referenceCanvas && referenceCanvas.height > 10) { // Check if section has content
      pdf.addPage();
      pageCount++;
      
      const imgData2 = referenceCanvas.toDataURL('image/png');
      const aspectRatio2 = referenceCanvas.height / referenceCanvas.width;
      const imgHeight2 = pdfWidth * aspectRatio2;
      
      pdf.addImage(imgData2, 'PNG', 0, 0, pdfWidth, imgHeight2);
      console.log(`✅ Page ${pageCount} added (references): ${pdfWidth}×${Math.round(imgHeight2)}mm`);
      
      // If reference section is tall, handle multi-page
      let remainingHeight = imgHeight2 - pdfHeight;
      let yOffset = -pdfHeight;
      
      while (remainingHeight > 0) {
        pdf.addPage();
        pageCount++;
        pdf.addImage(imgData2, 'PNG', 0, yOffset, pdfWidth, imgHeight2);
        yOffset -= pdfHeight;
        remainingHeight -= pdfHeight;
        console.log(`✅ Additional page ${pageCount} added for overflow`);
      }
    } else {
      console.log('ℹ️ No reference images section found or section is empty');
    }

    console.log(`📄 PDF created with ${pageCount} pages`);

    // Add PDF metadata
    pdf.setProperties({
      title: `Quote ${quoteNumber}`,
      subject: 'Quote Document',
      author: 'AI Quote Generator',
      keywords: 'quote, proposal',
      creator: 'E2W Quote System'
    });

    // For mobile, set initial view to fit width
    if (isMobileDevice) {
      // @ts-ignore - jsPDF doesn't have types for setDisplayMode
      pdf.setDisplayMode('fullwidth', 'continuous');
    }

    // Generate filename
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `Quote_${quoteNumber}_${timestamp}.pdf`;

    console.log('💾 Saving PDF as:', filename);
    
    // Handle mobile vs web differently
    if (isMobile()) {
      console.log('📱 Mobile detected - using Filesystem API');
      try {
        // Get PDF as base64
        const pdfBase64 = pdf.output('dataurlstring').split(',')[1];
        
        // Save to device's documents directory
        const result = await Filesystem.writeFile({
          path: filename,
          data: pdfBase64,
          directory: Directory.Documents,
          recursive: true
        });
        
        console.log('✅ PDF saved to:', result.uri);
        
        // Extract the actual file path from the URI
        const filePath = result.uri.replace('file://', '');
        
        // Show download notification
        try {
          await DownloadNotification.showDownloadNotification({
            filePath: filePath,
            fileName: filename,
            title: 'PDF Downloaded',
            message: `${filename} is ready to view`
          });
          console.log('✅ Download notification shown');
        } catch (notifError) {
          console.error('⚠️ Failed to show notification:', notifError);
          // Continue even if notification fails
        }
        
        // Show success message
        alert(`PDF saved successfully!\n\nFile: ${filename}\nLocation: Documents folder\n\nTap the notification to open the file.`);
        
        // Try to share if available (optional)
        try {
          if (navigator.share) {
            const pdfBlob = pdf.output('blob');
            const file = new File([pdfBlob], filename, { type: 'application/pdf' });
            await navigator.share({
              files: [file],
              title: `Quote ${quoteNumber}`,
              text: `Quote document ${filename}`
            });
            console.log('✅ PDF shared successfully');
          }
        } catch (shareError) {
          console.log('ℹ️ Share not available or cancelled:', shareError);
          // Not a critical error - file is already saved
        }
      } catch (error) {
        console.error('❌ Mobile save error:', error);
        // Fallback to browser download
        console.log('🔄 Falling back to browser download');
        pdf.save(filename);
      }
    } else {
      // Web browser - use normal download
      console.log('💻 Web detected - using browser download');
      pdf.save(filename);
    }

    // Restore cursor
    document.body.style.cursor = originalCursor;
    
    console.log('✅ PDF export complete');
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

    // Handle mobile vs web differently
    if (isMobile()) {
      console.log('📱 Mobile detected - using Filesystem API');
      try {
        const pdfBase64 = pdf.output('dataurlstring').split(',')[1];
        
        const result = await Filesystem.writeFile({
          path: finalFilename,
          data: pdfBase64,
          directory: Directory.Documents,
          recursive: true
        });
        
        console.log('✅ PDF saved to:', result.uri);
        
        // Extract the actual file path from the URI
        const filePath = result.uri.replace('file://', '');
        
        // Show download notification
        try {
          await DownloadNotification.showDownloadNotification({
            filePath: filePath,
            fileName: finalFilename,
            title: 'PDF Downloaded',
            message: `${finalFilename} is ready to view`
          });
          console.log('✅ Download notification shown');
        } catch (notifError) {
          console.error('⚠️ Failed to show notification:', notifError);
        }
        
        alert(`PDF saved successfully!\n\nFile: ${finalFilename}\nLocation: Documents folder\n\nTap the notification to open.`);
        
        // Try to share if available
        if (navigator.share) {
          const pdfBlob = pdf.output('blob');
          const file = new File([pdfBlob], finalFilename, { type: 'application/pdf' });
          await navigator.share({
            files: [file],
            title: `Quote ${quoteNumber}`,
            text: `Quote document ${finalFilename}`
          });
        }
      } catch (error) {
        console.error('❌ Mobile save error:', error);
        pdf.save(finalFilename);
      }
    } else {
      pdf.save(finalFilename);
    }
    
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
