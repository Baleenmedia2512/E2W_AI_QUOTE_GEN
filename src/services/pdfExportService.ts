import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { TemplateType } from '../types';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import DownloadNotification from '../plugins/downloadNotification';

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

    console.log('📸 Capturing element as canvas...');

    // Detect if mobile for optimized PDF size
    const isMobileDevice = isMobile();
    const deviceWidth = window.innerWidth;
    
    // For mobile, use device-optimized width; for desktop, use A4
    const pdfWidthPx = isMobileDevice ? Math.min(deviceWidth, 700) : 794; // 794 = 210mm at 96dpi
    const scaleFactor = isMobileDevice ? 1.5 : 2; // Lower scale for mobile to reduce file size
    
    console.log('📱 Export settings:', { isMobileDevice, pdfWidthPx, scaleFactor });
    
    const originalStyle = element.getAttribute('style') || '';
    const originalClass = element.className;
    element.style.width = `${pdfWidthPx}px`;
    element.style.maxWidth = `${pdfWidthPx}px`;
    element.style.minWidth = `${pdfWidthPx}px`;
    element.style.position = 'absolute';
    element.style.left = '-9999px';
    element.style.top = '0';
    // Force desktop styles by adding a class
    element.classList.add('pdf-export-mode');
    
    // Add mobile-specific class for mobile exports
    if (isMobileDevice) {
      element.classList.add('pdf-export-mobile');
      element.style.fontSize = '13px'; // Slightly larger text for mobile
    }

    // Calculate dynamic page break for reference images section
    const pageBreakElement = element.querySelector('.reference-page-break') as HTMLElement;
    const referenceSection = element.querySelector('.reference-images-section') as HTMLElement;
    
    if (pageBreakElement && referenceSection) {
      // Get position of page break element
      const pageBreakRect = pageBreakElement.getBoundingClientRect();
      const containerRect = element.getBoundingClientRect();
      
      // Calculate absolute position from top
      const contentBeforeBreak = pageBreakRect.top - containerRect.top;
      
      // Page height calculation based on device
      const pageHeightPx = isMobileDevice ? 900 : 1123;
      
      // Calculate how much content fills the current page
      const contentOnFirstPage = contentBeforeBreak % pageHeightPx;
      
      // Calculate spacer needed to reach exactly the next page boundary
      // Add safety margin to ensure section title starts on new page
      const spacerHeight = contentOnFirstPage > 0 
        ? (pageHeightPx - contentOnFirstPage) + (isMobileDevice ? 50 : 100)
        : (isMobileDevice ? 100 : 200);
      
      pageBreakElement.style.height = `${spacerHeight}px`;
      console.log('📐 Page break spacer:', {
        contentBefore: Math.round(contentBeforeBreak),
        contentOnPage: Math.round(contentOnFirstPage),
        spacerHeight: Math.round(spacerHeight),
        totalAfterSpacer: Math.round(contentBeforeBreak + spacerHeight)
      });
    }

    // Let the browser reflow with new dimensions
    await new Promise(r => setTimeout(r, 200));

    // Capture the element as canvas with appropriate quality
    const canvas = await html2canvas(element, {
      scale: scaleFactor,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: true,
      width: pdfWidthPx,
      windowWidth: pdfWidthPx
    });

    // Restore original styles immediately after capture
    element.setAttribute('style', originalStyle);
    element.className = originalClass;
    
    console.log('✅ Canvas captured:', canvas.width, 'x', canvas.height);

    // Calculate dimensions - use A4 for desktop, mobile-optimized for mobile
    const imgWidth = isMobileDevice ? 180 : 210; // Slightly smaller for mobile  
    const pageHeight = isMobileDevice ? 270 : 297; // A4 height adjusted for mobile
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    // Create PDF with appropriate size
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: isMobileDevice ? [imgWidth, pageHeight] : 'a4', // Custom size for mobile
      compress: true
    });

    let heightLeft = imgHeight;
    let position = 0;
    let pageNumber = 1;

    // Add image to first page
    const imgData = canvas.toDataURL('image/png', 0.92); // Slightly compressed for mobile
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

    console.log(`📄 PDF created with ${pageNumber} pages`);

    // Add PDF metadata for better mobile viewing
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
