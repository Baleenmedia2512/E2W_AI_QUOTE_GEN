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
 * Returns pages whose text contains ALL meaningful keywords from the category description.
 * This ensures "Full Bus Branding" only matches pages with "full" + "bus" + "branding",
 * not just pages with any one of those words.
 */
function filterPagesByCategory(pages: ExtractedPage[], category: string): ExtractedPage[] {
  const keywords = category
    .toLowerCase()
    .split(/[\s,\-\/&]+/)
    .filter((w) => w.length >= 3);

  if (keywords.length === 0) return [];

  return pages.filter((page) => {
    const pageText = page.text.toLowerCase();
    // Require ALL keywords to be present in the page (not just any one)
    return keywords.every((kw) => pageText.includes(kw));
  });
}

/**
 * Automatically filter pages by ALL quote item descriptions.
 * Returns pages that match any of the quote items.
 * ONLY includes pages with (2/2), (2/3), (3/3) etc. patterns - actual reference image pages.
 */
function filterPagesByQuoteItems(pages: ExtractedPage[], items: QuoteItem[]): ExtractedPage[] {
  if (!items || items.length === 0) return pages;
  
  const matchedPages = new Set<number>();
  
  items.forEach((item) => {
    const matchingPages = filterPagesByCategory(pages, item.description);
    
    // ONLY include pages with (2/X), (3/X), (4/X) etc. patterns
    // These are the actual reference image pages, not pricing pages
    const relevantPages = matchingPages.filter(page => {
      const text = page.text.toLowerCase();
      // Only include pages with (2/2), (2/3), (3/3), etc. - reference image pages
      // This automatically excludes (1/X) pricing pages and pricing summary tables
      return text.match(/\(\s*[2-9]\d*\s*\/\s*\d+\s*\)/);
    });
    
    // Add all relevant reference image pages
    relevantPages.forEach((page) => matchedPages.add(page.pageNumber));
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
