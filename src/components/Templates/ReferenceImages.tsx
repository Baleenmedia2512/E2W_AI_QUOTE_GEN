import React, { useMemo } from 'react';
import './ReferenceImages.css';

interface ExtractedPage {
  pageNumber: number;
  text: string;
  imageDataUrl: string;
}

interface QuoteItem {
  id: string;
  description: string;
  [key: string]: any;
}

interface ReferenceImagesProps {
  proposalPages?: ExtractedPage[];
  items?: QuoteItem[];
}

/**
 * Returns pages whose text contains the exact heading match.
 * Looks for section headings like "BUS FULL BRANDING", "APARTMENT LIFT BRANDING" in the PDF.
 * Uses strict matching to ensure we get the right pages.
 */
function filterPagesByCategory(pages: ExtractedPage[], category: string): ExtractedPage[] {
  console.log('🔍 Filtering pages for category:', category);
  
  // Extract the service type part only (before " - ")
  let serviceTypeOnly = category;
  const dashIndex = category.indexOf(' - ');
  if (dashIndex > 0) {
    serviceTypeOnly = category.substring(0, dashIndex).trim();
    console.log('📌 Using service type only:', serviceTypeOnly);
  }
  
  // Extract meaningful keywords, excluding pricing/quantity terms
  const words = serviceTypeOnly
    .toLowerCase()
    .split(/[\s,\-\/&]+/)
    .filter((w) => 
      w.length >= 3 && 
      !['rental', 'price', 'per', 'month', 'and', 'the', 'for', 'from', 'display', 'printing', 'fixing', 'screen'].includes(w) &&
      !w.includes('(') && !w.includes(')')  // Exclude anything with parentheses
    );
  
  console.log('📝 Extracted keywords:', words);
  
  if (words.length === 0) return [];
  
  // Strategy: Build an exact heading pattern from the category
  // E.g., "Apartment Lift Branding" → /apartment\s+lift\s+branding/i
  // E.g., "Bus Full Branding" → /bus\s+full\s+branding/i
  
  // Create a flexible regex pattern from the keywords
  const keywordPattern = words.join('\\s+');
  const exactHeadingPattern = new RegExp(keywordPattern, 'i');
  
  console.log('🎯 Exact heading pattern:', exactHeadingPattern.source);
  
  // Determine required keywords (all significant words must be present)
  const requiredKeywords = words;
  
  console.log('🔑 Required keywords for matching:', requiredKeywords);

  const matchedPages = pages.filter((page) => {
    // Clean up page text: Remove pipe characters and extra spaces that might split words
    // e.g., "li | ft" becomes "lift", "apartment li | ft branding" becomes "apartment lift branding"
    const pageText = page.text
      .toLowerCase()
      .replace(/\s*\|\s*/g, '') // Remove pipes and surrounding spaces
      .replace(/\s+/g, ' ');    // Normalize multiple spaces to single space
    
    // EXCLUDE pricing summary pages (they contain pricing tables, not reference images)
    const isPricingSummary = pageText.includes('pricing summary') || 
                            pageText.includes('price list') ||
                            pageText.includes('rate card') ||
                            (pageText.includes('activity') && pageText.includes('branding activities')) ||
                            (pageText.includes('unit price') && pageText.includes('total'));
    
    if (isPricingSummary) {
      console.log(`❌ Page ${page.pageNumber} - Excluded (pricing summary table)`);
      return false;
    }
    
    // FLEXIBLE MATCHING: Check if ALL keywords are present (in any order, with flexible spacing)
    const hasAllKeywords = requiredKeywords.every((kw) => pageText.includes(kw));
    
    if (!hasAllKeywords) {
      const missingKeywords = requiredKeywords.filter(kw => !pageText.includes(kw));
      console.log(`❌ Page ${page.pageNumber} - Missing keywords: [${missingKeywords.join(', ')}]`);
      return false;
    }
    
    // If all keywords are present, check if they appear close together (likely a heading)
    // This helps ensure we match section headings like "APARTMENT LIFT BRANDING"
    // and not just pages that happen to contain all words scattered throughout
    const hasHeading = exactHeadingPattern.test(pageText);
    if (hasHeading) {
      console.log(`✅ Page ${page.pageNumber} - EXACT heading match found!`);
      return true;
    }
    
    // Also accept if keywords appear within 100 characters of each other (flexible heading match)
    const keywordPositions = requiredKeywords.map(kw => pageText.indexOf(kw)).filter(pos => pos >= 0);
    if (keywordPositions.length === requiredKeywords.length) {
      const firstPos = Math.min(...keywordPositions);
      const lastPos = Math.max(...keywordPositions);
      const distance = lastPos - firstPos;
      
      if (distance <= 100) {
        console.log(`✅ Page ${page.pageNumber} - Keywords appear close together (distance: ${distance})`);
        return true;
      }
    }
    
    return false;
  });
  
  console.log(`📊 Found ${matchedPages.length} matching pages for "${category}"`);
  return matchedPages;
}

/**
 * Extract the main service type from all quote items.
 * E.g., "Bus Full Branding - Display Price" → "Bus Full Branding"
 * E.g., "Apartment Lift Branding - Printing" → "Apartment Lift Branding"
 */
function extractServiceType(items: QuoteItem[]): string | null {
  // Look for common service type patterns in item descriptions
  for (const item of items) {
    const desc = item.description;
    
    // Try to extract everything before " - " (the service type is usually before the dash)
    const dashMatch = desc.match(/^([^-]+)\s*-/);
    if (dashMatch) {
      const beforeDash = dashMatch[1].trim();
      // Check if it contains "branding" or other service keywords
      if (beforeDash.toLowerCase().includes('branding') || 
          beforeDash.toLowerCase().includes('shelter') ||
          beforeDash.toLowerCase().includes('signage') ||
          beforeDash.toLowerCase().includes('printing')) {
        console.log('📌 Extracted service type from dash pattern:', beforeDash);
        return beforeDash;
      }
    }
    
    // Fallback: Match any "[Something] Branding" pattern
    const brandingMatch = desc.match(/([a-z\s]+branding)/i);
    if (brandingMatch) {
      const serviceType = brandingMatch[1].trim();
      console.log('📌 Extracted service type from branding pattern:', serviceType);
      return serviceType;
    }
    
    // Also check for specific vehicle/building patterns (backward compatibility)
    const vehicleMatch = desc.match(/(bus|auto|tempo|apartment|building|lift|elevator|residential|commercial)\s+(full|semi|back|panel|shelter|rickshaw|branding)/i);
    if (vehicleMatch) {
      console.log('📌 Extracted service type from vehicle/building pattern:', vehicleMatch[0]);
      return vehicleMatch[0];
    }
  }
  
  return null;
}

/**
 * Automatically filter pages by ALL quote item descriptions.
 * Returns pages that match any of the quote items.
 * Prioritizes pages with (2/2), (2/3), (3/3) etc. patterns (reference image pages).
 */
function filterPagesByQuoteItems(pages: ExtractedPage[], items: QuoteItem[]): ExtractedPage[] {
  if (!items || items.length === 0) {
    console.log('⚠️ No quote items provided');
    return [];
  }
  
  const matchedPages = new Set<number>();
  
  // First, try to extract a common service type from all items
  const serviceType = extractServiceType(items);
  if (serviceType) {
    console.log('🎯 Detected service type:', serviceType);
    
    // Use the service type to filter pages
    const matchingPages = filterPagesByCategory(pages, serviceType);
    
    if (matchingPages.length > 0) {
      console.log(`📊 Found ${matchingPages.length} pages matching service type`);
      
      // Filter to only reference pages (2/X or higher)
      // BUT ALSO accept pages with (X/2) where X >= 2 (like 2/2)
      const referencePages = matchingPages.filter(page => {
        // Clean up text: remove pipes that might split words
        const text = page.text
          .toLowerCase()
          .replace(/\s*\|\s*/g, '') // Remove pipes and surrounding spaces
          .replace(/\s+/g, ' ');    // Normalize spaces
        
        // Skip pricing summary pages
        const isPricingSummary = text.includes('pricing summary') || 
                                text.includes('price list') ||
                                text.includes('rate card') ||
                                (text.includes('activity') && text.includes('branding activities')) ||
                                (text.includes('unit price') && text.includes('total'));
        
        if (isPricingSummary) {
          console.log(`  ❌ Page ${page.pageNumber} - Excluded (pricing summary)`);
          return false;
        }
        
        const pattern = text.match(/\((\d+)\/(\d+)\)/);
        if (pattern) {
          const pageNum = parseInt(pattern[1]);
          const totalPages = parseInt(pattern[2]);
          console.log(`  📄 Page ${page.pageNumber} has pattern (${pageNum}/${totalPages})`);
          // Accept if page number is 2 or higher (reference images, not pricing)
          return pageNum >= 2;
        }
        console.log(`  📄 Page ${page.pageNumber} - No (X/Y) pattern found`);
        
        // If no pattern, check if it looks like a reference page (has "reference" in text)
        const looksLikeReference = text.includes('reference image') || 
                                  text.includes('sample') ||
                                  text.includes('example') ||
                                  !isPricingSummary; // Accept if not a pricing page
        
        return looksLikeReference;
      });
      
      if (referencePages.length > 0) {
        console.log(`✅ Found ${referencePages.length} reference pages for service type "${serviceType}"`);
        referencePages.forEach((page) => matchedPages.add(page.pageNumber));
        const result = pages.filter((page) => matchedPages.has(page.pageNumber));
        return result;
      } else {
        // If no (X/Y) pattern found, return all matching pages
        console.log(`⚠️ No (X/Y) pattern found, using all ${matchingPages.length} matching pages`);
        matchingPages.forEach((page) => matchedPages.add(page.pageNumber));
        const result = pages.filter((page) => matchedPages.has(page.pageNumber));
        return result;
      }
    }
  }
  
  // Fallback: Process each item individually
  items.forEach((item) => {
    console.log('🔍 Processing item:', item.description);
    const matchingPages = filterPagesByCategory(pages, item.description);
    
    if (matchingPages.length === 0) {
      console.log(`⚠️ No pages found for "${item.description}"`);
      return;
    }
    
    // First try: ONLY pages with (2/X), (3/X), (4/X) etc. patterns (reference image pages)
    // This filters out the first page (1/X) which is usually the pricing table
    const referencePages = matchingPages.filter(page => {
      // Clean up text: remove pipes that might split words
      const text = page.text
        .toLowerCase()
        .replace(/\s*\|\s*/g, '') // Remove pipes and surrounding spaces
        .replace(/\s+/g, ' ');    // Normalize spaces
        
      const hasReferencePattern = text.match(/\(([2-9]\d*)\/(\d+)\)/);
      if (hasReferencePattern) {
        console.log(`  ✅ Page ${page.pageNumber} has reference pattern: (2/X) or higher`);
      }
      return hasReferencePattern;
    });
    
    // If we found reference pages with the pattern, use those (preferred)
    if (referencePages.length > 0) {
      console.log(`✅ Using ${referencePages.length} reference pages with (X/Y) pattern`);
      referencePages.forEach((page) => matchedPages.add(page.pageNumber));
    } else {
      // Fallback: Include all matching pages if no (X/Y) pattern found
      // (user's PDF might not have the pattern)
      console.log(`⚠️ No (X/Y) pattern found, using all ${matchingPages.length} matching pages`);
      matchingPages.forEach((page) => matchedPages.add(page.pageNumber));
    }
  });
  
  const result = pages.filter((page) => matchedPages.has(page.pageNumber));
  console.log(`📊 Final result: ${result.length} reference pages out of ${pages.length} total pages`);
  
  return result;
}

export const ReferenceImages: React.FC<ReferenceImagesProps> = ({ proposalPages, items }) => {
  // Automatically filter pages by quote items
  const filteredPages = useMemo(() => {
    if (!proposalPages || proposalPages.length === 0) {
      console.log('❌ ReferenceImages: No proposal pages available');
      return [];
    }
    
    console.log('📄 ReferenceImages: Processing', proposalPages.length, 'proposal pages');
    console.log('📋 ReferenceImages: Quote items:', items?.map(i => i.description));
    
    // Debug: Log first page text to see what we're working with
    if (proposalPages.length > 0) {
      console.log('📝 Sample page text:', proposalPages[0].text.substring(0, 200));
    }
    
    // Automatically filter by quote items - no manual selection
    const filtered = filterPagesByQuoteItems(proposalPages, items || []);
    console.log('✅ ReferenceImages: Filtered to', filtered.length, 'pages');
    
    return filtered;
  }, [proposalPages, items]);

  // Group images into pairs (max 2 per page)
  const groupedPages = useMemo(() => {
    const groups: ExtractedPage[][] = [];
    for (let i = 0; i < filteredPages.length; i += 2) {
      groups.push(filteredPages.slice(i, i + 2));
    }
    return groups;
  }, [filteredPages]);

  if (!proposalPages || proposalPages.length === 0) {
    console.log('❌ ReferenceImages: No proposal pages, returning null');
    return null;
  }
  if (filteredPages.length === 0) {
    console.log('⚠️ ReferenceImages: No filtered pages found');
    console.log('💡 Available pages:', proposalPages.length);
    console.log('💡 Quote items:', items?.map(i => i.description) || []);
    console.log('💡 Tip: Check if page text contains keywords from quote items');
    
    // In development, show a helpful message
    if (process.env.NODE_ENV === 'development') {
      return (
        <div style={{ padding: '20px', margin: '20px', border: '2px dashed #ccc', background: '#f9f9f9' }}>
          <h4>⚠️ No Reference Images Found</h4>
          <p>No pages matched the quote items. Check browser console for details.</p>
          <ul>
            <li>Available pages: {proposalPages.length}</li>
            <li>Quote items: {items?.length || 0}</li>
            {items && items.length > 0 && (
              <li>Looking for: {items.map(i => i.description).join(', ')}</li>
            )}
          </ul>
        </div>
      );
    }
    
    return null;
  }

  console.log('✅ ReferenceImages: Rendering', filteredPages.length, 'pages');

  return (
    <>
      <div className="reference-page-break" style={{ pageBreakBefore: 'always', height: '1px', clear: 'both' }}></div>
      <div className="reference-images-section">
        <h3 className="reference-images-title">Reference Images from Proposal</h3>
        <div className="reference-images-grid">
          {groupedPages.map((group, groupIndex) => (
            <div key={`group-${groupIndex}`} className="reference-image-row">
              {group.map((page) => (
                <div key={page.pageNumber} className="reference-image-item">
                  <img
                    src={page.imageDataUrl}
                    alt={`Proposal page ${page.pageNumber}`}
                    className="reference-image"
                  />
                  <span className="reference-image-caption">Page {page.pageNumber}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
};
