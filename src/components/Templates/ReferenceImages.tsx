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
 * SKIPS THE FIRST PAGE of each matched section (typically pricing/terms).
 */
function filterPagesByQuoteItems(pages: ExtractedPage[], items: QuoteItem[]): ExtractedPage[] {
  if (!items || items.length === 0) return pages;
  
  const matchedPages = new Set<number>();
  
  items.forEach((item) => {
    const matchingPages = filterPagesByCategory(pages, item.description);
    
    // Sort by page number and skip the first page (index 0)
    const sortedPages = matchingPages.sort((a, b) => a.pageNumber - b.pageNumber);
    
    // Skip first page, take pages from index 1 onwards (pages 2 and 3)
    sortedPages.slice(1).forEach((page) => matchedPages.add(page.pageNumber));
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

  if (!proposalPages || proposalPages.length === 0) return null;
  if (filteredPages.length === 0) return null;

  return (
    <div className="reference-images-section">
      <h3 className="reference-images-title">Reference Images from Proposal</h3>
      <div className="reference-images-grid">
        {filteredPages.map((page) => (
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
    </div>
  );
};
