import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { TemplateType } from '../types';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import DownloadNotification from '../plugins/downloadNotification';

// A4 dimensions at 96dpi (standard web resolution)
const A4_WIDTH_PX = 794;   // 210mm at 96dpi
// const A4_HEIGHT_PX = 1123;  // 297mm at 96dpi

/** Represents a clickable link annotation to be overlaid on the PDF image */
interface LinkAnnotation {
  url: string;
  x: number; // CSS px from clone left edge
  y: number; // CSS px from clone top edge
  w: number; // CSS px
  h: number; // CSS px
}

/**
 * Captures a specific section at fixed A4 dimensions for consistent PDF output
 */
const captureSectionAtA4 = async (containerId: string): Promise<{ canvas: HTMLCanvasElement; links: LinkAnnotation[] } | null> => {
  const source = document.getElementById(containerId);
  if (!source) {
    console.warn(`⚠️ Section ${containerId} not found`);
    return null;
  }

  console.log(`📸 Capturing section: ${containerId}`);
  
  // Create off-screen clone at fixed A4 width
  const clone = source.cloneNode(true) as HTMLElement;
  
  Object.assign(clone.style, {
    position: 'absolute',
    top: '0',
    left: `-${A4_WIDTH_PX + 50}px`,  // off-screen LEFT only — vertical at 0 ensures full Chrome paint
    width: `${A4_WIDTH_PX}px`,
    minWidth: `${A4_WIDTH_PX}px`,
    maxWidth: `${A4_WIDTH_PX}px`,
    overflow: 'visible',
    margin: '0',
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

    // Wait for full reflow — longer delay ensures tfoot and all rows are painted
    await new Promise(r => setTimeout(r, 300));

    // Do NOT pass height — let html2canvas measure the element itself.
    // Passing an explicit height that is even 1px short clips the tfoot (TOTAL row).
    // windowHeight: large value ensures the simulated viewport covers the full table.
    const canvas = await html2canvas(clone, {
      scale: 2,
      width: A4_WIDTH_PX,
      windowWidth: A4_WIDTH_PX,
      windowHeight: 10000,  // large simulated viewport — never clips tall tables
      scrollX: 0,
      scrollY: 0,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false
    });

    console.log(`✅ Section captured: ${canvas.width}x${canvas.height}px`);

    // Collect link annotations WHILE clone is still in DOM
    const cloneRect = clone.getBoundingClientRect();
    const links: LinkAnnotation[] = [];
    clone.querySelectorAll('a[href]').forEach((el) => {
      const href = el.getAttribute('href');
      if (!href) return;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        links.push({
          url: href,
          x: rect.left - cloneRect.left,
          y: rect.top - cloneRect.top,
          w: rect.width,
          h: rect.height,
        });
      }
    });
    console.log(`🔗 Collected ${links.length} link annotations from ${containerId}`);

    return { canvas, links };
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
  _templateType: TemplateType,
  clientName?: string
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

    // Helper to overlay link annotations on the current PDF page
    const addLinkAnnotations = (
      links: LinkAnnotation[],
      xBase: number,       // mm x offset (for centered scaled images)
      cssToPdf: number,    // CSS px → PDF mm conversion factor
      pageYOffset: number  // mm offset for current page (multi-page splits)
    ) => {
      links.forEach(({ url, x, y, w, h }) => {
        const pdfX = xBase + x * cssToPdf;
        const pdfY = y * cssToPdf - pageYOffset;
        const pdfW = w * cssToPdf;
        const pdfH = h * cssToPdf;
        if (pdfW > 0 && pdfH > 0 && pdfY + pdfH > 0 && pdfY < pdfHeight) {
          pdf.link(pdfX, Math.max(0, pdfY), pdfW, pdfH, { url });
        }
      });
    };

    // Helper to add a captured canvas to the PDF
    // Each section (summary, service detail, reference images) is designed as ONE page.
    // Always scale to fit on a single A4 page unless content is more than 2x A4 height.
    const addCanvasToPDF = (canvas: HTMLCanvasElement, links: LinkAnnotation[], label: string, isFirstPage: boolean) => {
      if (!isFirstPage) {
        pdf.addPage();
      }
      pageCount++;
      const imgData = canvas.toDataURL('image/png');
      const aspectRatio = canvas.height / canvas.width;
      const imgHeight = pdfWidth * aspectRatio;
      const cssToPdf = pdfWidth / A4_WIDTH_PX; // CSS px → PDF mm

      if (imgHeight <= pdfHeight) {
        // Content fits within A4 — render at full page
        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, imgHeight);
        addLinkAnnotations(links, 0, cssToPdf, 0);
        console.log(`✅ Page ${pageCount} added (${label}): ${pdfWidth}×${Math.round(imgHeight)}mm`);
      } else if (imgHeight <= pdfHeight * 1.5) {
        // Content overflows but is less than 1.5x A4 — scale to fit on one page
        const scale = pdfHeight / imgHeight;
        const scaledWidth = pdfWidth * scale;
        const xOffset = (pdfWidth - scaledWidth) / 2; // Center horizontally
        pdf.addImage(imgData, 'PNG', xOffset, 0, scaledWidth, pdfHeight);
        addLinkAnnotations(links, xOffset, scaledWidth / A4_WIDTH_PX, 0);
        console.log(`✅ Page ${pageCount} added (${label}): scaled to fit (${Math.round(imgHeight - pdfHeight)}mm overflow)`);
      } else {
        // Content is very tall (>1.5x A4) — split across multiple pages
        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, imgHeight);
        addLinkAnnotations(links, 0, cssToPdf, 0);
        console.log(`✅ Page ${pageCount} added (${label}): ${pdfWidth}×${Math.round(imgHeight)}mm`);
        
        let remainingHeight = imgHeight - pdfHeight;
        let yOffset = -pdfHeight;
        let pageYStart = pdfHeight;
        while (remainingHeight > 0) {
          pdf.addPage();
          pageCount++;
          pdf.addImage(imgData, 'PNG', 0, yOffset, pdfWidth, imgHeight);
          addLinkAnnotations(links, 0, cssToPdf, pageYStart);
          yOffset -= pdfHeight;
          pageYStart += pdfHeight;
          remainingHeight -= pdfHeight;
          console.log(`✅ Additional page ${pageCount} added for overflow`);
        }
      }
    };

    // Check if this is a multi-service quote (has pdf-page-summary)
    const isMultiService = !!document.getElementById('pdf-page-summary');

    if (isMultiService) {
      // --- MULTI-SERVICE QUOTE ---
      console.log('📄 Multi-service quote detected');

      // Capture summary page
      const summaryResult = await captureSectionAtA4('pdf-page-summary');
      if (summaryResult) {
        addCanvasToPDF(summaryResult.canvas, summaryResult.links, 'summary', true);
      }

      // Capture each service group page + its reference images
      let serviceIndex = 0;
      while (true) {
        const serviceResult = await captureSectionAtA4(`pdf-service-${serviceIndex}`);
        if (!serviceResult) break; // No more service pages

        addCanvasToPDF(serviceResult.canvas, serviceResult.links, `service-${serviceIndex}`, pageCount === 0);

        // Capture reference images for this service
        const refResult = await captureSectionAtA4(`pdf-service-ref-${serviceIndex}`);
        if (refResult && refResult.canvas.height > 10) {
          addCanvasToPDF(refResult.canvas, refResult.links, `service-ref-${serviceIndex}`, false);
        }

        // Capture specific Terms & Conditions for this service (appears right after customer review)
        const specificTermsResult = await captureSectionAtA4(`pdf-service-specific-terms-${serviceIndex}`);
        if (specificTermsResult && specificTermsResult.canvas.height > 10) {
          addCanvasToPDF(specificTermsResult.canvas, specificTermsResult.links, `service-specific-terms-${serviceIndex}`, false);
        }

        serviceIndex++;
      }

      // Terms & Conditions (Last page - multi-service)
      console.log('📄 Checking for T&C page (multi-service)...');
      const termsMultiResult = await captureSectionAtA4('pdf-page-terms');
      if (termsMultiResult && termsMultiResult.canvas.height > 10) {
        addCanvasToPDF(termsMultiResult.canvas, termsMultiResult.links, 'terms', false);
      } else {
        console.log('ℹ️ No multi-service T&C section found or section is empty');
      }

      if (pageCount === 0) {
        console.warn('⚠️ No multi-service sections captured, using fallback');
        await legacyFullCapture(element, pdf, pdfWidth, pdfHeight);
        pageCount = 1;
      }
    } else {
      // --- SINGLE-SERVICE QUOTE (original behavior) ---
      console.log('📄 Capturing quotation content...');
      const quotationResult = await captureSectionAtA4('pdf-page-1');
      
      if (quotationResult) {
        addCanvasToPDF(quotationResult.canvas, quotationResult.links, 'quotation', true);
      } else {
        console.warn('⚠️ Quotation section not found, using fallback full capture');
        await legacyFullCapture(element, pdf, pdfWidth, pdfHeight);
        pageCount = 1;
      }

      // Reference Images (Page 2+)
      console.log('📄 Checking for reference images...');
      const referenceResult = await captureSectionAtA4('pdf-page-2');
      
      if (referenceResult && referenceResult.canvas.height > 10) {
        addCanvasToPDF(referenceResult.canvas, referenceResult.links, 'references', false);
      } else {
        console.log('ℹ️ No reference images section found or section is empty');
      }

      // Terms & Conditions (Last page)
      console.log('📄 Checking for T&C page...');
      const termsResult = await captureSectionAtA4('pdf-page-3');
      if (termsResult && termsResult.canvas.height > 10) {
        addCanvasToPDF(termsResult.canvas, termsResult.links, 'terms', false);
      } else {
        console.log('ℹ️ No T&C section found or section is empty');
      }

      // General Terms & Conditions + Bank Details (final page in CorporateMinimal/ModernSales/PremiumAgency single-service)
      console.log('📄 Checking for general T&C + banking page...');
      const generalTermsResult = await captureSectionAtA4('pdf-page-terms');
      if (generalTermsResult && generalTermsResult.canvas.height > 10) {
        addCanvasToPDF(generalTermsResult.canvas, generalTermsResult.links, 'general-terms', false);
      } else {
        console.log('ℹ️ No general T&C/banking section found or section is empty');
      }
    }

    console.log(`📄 PDF created with ${pageCount} pages`);

    // Add PDF metadata
    pdf.setProperties({
      title: `Quote ${quoteNumber}`,
      subject: 'Quote Document',
      author: 'Quote Buddy',
      keywords: 'quote, proposal',
      creator: 'E2W Quote System'
    });

    // For mobile, set initial view to fit width
    if (isMobileDevice) {
      // @ts-ignore - jsPDF doesn't have types for setDisplayMode
      pdf.setDisplayMode('fullwidth', 'continuous');
    }

    // Generate filename
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const clientStr = (clientName || '').replace(/\s+/g, '');
    const filename = `${dateStr}_${clientStr}_${quoteNumber}.pdf`;

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
        
        // Show download notification (optional - may not be registered yet)
        try {
          await DownloadNotification.showDownloadNotification({
            filePath: filePath,
            fileName: filename,
            title: 'PDF Downloaded',
            message: `${filename} is ready to view`
          });
          console.log('✅ Download notification shown');
        } catch (notifError) {
          console.error('⚠️ Notification plugin not available:', notifError);
          // Continue - notification is optional
        }
        
        // Auto-open PDF directly in default PDF viewer (no share dialog)
        try {
          await FileOpener.open({
            filePath: result.uri,
            contentType: 'application/pdf',
            openWithDefault: true
          });
          console.log('✅ PDF auto-opened in default viewer');
        } catch (openError) {
          console.error('⚠️ Failed to auto-open PDF:', openError);
          // Show success message as fallback
          alert(`PDF saved successfully!\n\nFile: ${filename}\nLocation: Documents folder\n\nPlease open it from your file manager.`);
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

    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const finalFilename = filename || `${timestamp}__${quoteNumber}.pdf`;

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
