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
 * Returns pages whose text contains the specific service type keywords.
 * Uses smart matching: "Bus Full Branding" requires both "bus" AND "full",
 * while "Bus" alone matches any bus page.
 */
function filterPagesByCategory(pages: ExtractedPage[], category: string): ExtractedPage[] {
  const desc = category.toLowerCase();
  
  // Extract meaningful keywords, excluding pricing/quantity terms
  const words = category
    .toLowerCase()
    .split(/[\s,\-\/&]+/)
    .filter((w) => 
      w.length >= 3 && 
      !['rental', 'price', 'per', 'month', 'printing', 'fixing', 'display'].includes(w)
    );
  
  if (words.length === 0) return [];
  
  // Determine which keywords MUST be present
  let requiredKeywords: string[] = [];
  
  // Check for specific branding types (these require both vehicle + type)
  if (desc.includes('full') && (desc.includes('bus') || desc.includes('auto') || desc.includes('tempo'))) {
    // "Bus Full Branding" requires BOTH "bus" AND "full"
    if (desc.includes('bus')) requiredKeywords = ['bus', 'full'];
    else if (desc.includes('auto')) requiredKeywords = ['auto', 'full'];
    else if (desc.includes('tempo')) requiredKeywords = ['tempo', 'full'];
  } else if (desc.includes('semi') && (desc.includes('bus') || desc.includes('auto'))) {
    // "Bus Semi Branding" requires BOTH "bus" AND "semi"
    if (desc.includes('bus')) requiredKeywords = ['bus', 'semi'];
    else if (desc.includes('auto')) requiredKeywords = ['auto', 'semi'];
  } else if (desc.includes('back') && (desc.includes('bus') || desc.includes('auto'))) {
    // "Auto Back Branding" requires BOTH "auto" AND "back"
    if (desc.includes('bus')) requiredKeywords = ['bus', 'back'];
    else if (desc.includes('auto')) requiredKeywords = ['auto', 'back'];
  } else if (desc.includes('shelter')) {
    // "Bus Shelter" requires BOTH "bus" AND "shelter"
    requiredKeywords = ['bus', 'shelter'];
  } else {
    // Default: use the first 2 meaningful words (or just 1 if only 1 exists)
    requiredKeywords = words.slice(0, 2);
  }

  return pages.filter((page) => {
    const pageText = page.text.toLowerCase();
    // ALL required keywords must be present in the page
    return requiredKeywords.every((kw) => pageText.includes(kw));
  });
}

/**
 * Automatically filter pages by ALL quote item descriptions.
 * Returns pages that match any of the quote items.
 * Prioritizes pages with (2/2), (2/3), (3/3) etc. patterns, but includes all matches if no pattern found.
 */
function filterPagesByQuoteItems(pages: ExtractedPage[], items: QuoteItem[]): ExtractedPage[] {
  if (!items || items.length === 0) return pages;
  
  const matchedPages = new Set<number>();
  
  items.forEach((item) => {
    const matchingPages = filterPagesByCategory(pages, item.description);
    
    // First try: ONLY pages with (2/X), (3/X), (4/X) etc. patterns (reference image pages)
    const referencePages = matchingPages.filter(page => {
      const text = page.text.toLowerCase();
      return text.match(/\(\s*[2-9]\d*\s*\/\s*\d+\s*\)/);
    });
    
    // If we found reference pages with the pattern, use those
    if (referencePages.length > 0) {
      referencePages.forEach((page) => matchedPages.add(page.pageNumber));
    } else {
      // Fallback: If no pattern found, include all matching pages
      // (user's PDF might not have the (X/Y) pattern)
      matchingPages.forEach((page) => matchedPages.add(page.pageNumber));
    }
  });
  
  return pages.filter((page) => matchedPages.has(page.pageNumber));
}

export const ReferenceImages: React.FC<ReferenceImagesProps> = ({ proposalPages, items }) => {
  // Automatically filter pages by quote items
  const filteredPages = useMemo(() => {
    if (!proposalPages || proposalPages.length === 0) return [];
    
    // Automatically filter by quote items - no manual selection
    return filterPagesByQuoteItems(proposalPages, items || []);
  }, [proposalPages, items]);

  // Group images into pairs (max 2 per page)
  const groupedPages = useMemo(() => {
    const groups: ExtractedPage[][] = [];
    for (let i = 0; i < filteredPages.length; i += 2) {
      groups.push(filteredPages.slice(i, i + 2));
    }
    return groups;
  }, [filteredPages]);

  if (!proposalPages || proposalPages.length === 0) return null;
  if (filteredPages.length === 0) return null;

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
