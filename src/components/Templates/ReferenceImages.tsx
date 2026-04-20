import React, { useMemo } from 'react';
import './ReferenceImages.css';

interface ExtractedPage {
  pageNumber: number;
  text: string;
  imageDataUrl: string;
  croppedImages?: string[];
}

interface QuoteItem {
  id: string;
  description: string;
  [key: string]: any;
}

interface DisplayImage {
  key: string;
  imageUrl: string;
  alt: string;
  isCropped: boolean;
  pageNumber: number;
}

interface ReferenceImagesProps {
  proposalPages?: ExtractedPage[];
  items?: QuoteItem[];
}

function flattenToDisplayImages(pages: ExtractedPage[], prefix: string): DisplayImage[] {
  const images: DisplayImage[] = [];
  for (const page of pages) {
    if (page.croppedImages && page.croppedImages.length > 0) {
      page.croppedImages.forEach((url, idx) => {
        images.push({
          key: `${prefix}-crop-${page.pageNumber}-${idx}`,
          imageUrl: url,
          alt: `${prefix === 'ref' ? 'Reference image' : 'Design specification'} - Page ${page.pageNumber}`,
          isCropped: true,
          pageNumber: page.pageNumber,
        });
      });
    } else {
      images.push({
        key: `${prefix}-page-${page.pageNumber}`,
        imageUrl: page.imageDataUrl,
        alt: `${prefix === 'ref' ? 'Proposal page' : 'Design specification - Page'} ${page.pageNumber}`,
        isCropped: false,
        pageNumber: page.pageNumber,
      });
    }
  }
  return images;
}

/**
 * Returns pages whose text contains the exact heading match.
 * Looks for section headings like "BUS FULL BRANDING", "APARTMENT LIFT BRANDING" in the PDF.
 * Uses strict matching to ensure we get the right pages.
 */
function filterPagesByCategory(pages: ExtractedPage[], category: string): ExtractedPage[] {
  console.log('🔍 Filtering pages for category:', category);
  
  // Extract the service type part by removing pricing/quantity suffixes
  // Preserves sub-type qualifiers like "Underground Station", "Interior", "Non LED"
  // E.g., "Metro Branding – Underground Station - Display Price" → "Metro Branding – Underground Station"
  // E.g., "Mobile Van - Non LED Printing & Fixing Price" → "Mobile Van - Non LED"
  let serviceTypeOnly = category;
  const pricingSuffixPattern = /\b(printing\s*&?\s*fixing|display\s+price|rental\s+price|printing\s+price|fixing\s+price)\b/i;
  const pricingMatch = category.match(pricingSuffixPattern);
  if (pricingMatch && pricingMatch.index && pricingMatch.index > 0) {
    serviceTypeOnly = category.substring(0, pricingMatch.index).replace(/[\s\-–—&]+$/, '').trim();
    console.log('📌 Using service type (pricing suffix removed):', serviceTypeOnly);
  } else {
    // Only fall back to first-dash split if no sub-type qualifiers are present
    // Sub-type qualifiers: words like interior, underground, exterior, station, etc.
    const subTypePattern = /\b(interior|underground|exterior|station|rooftop|skyway|elevated|platform|non\s*led|led)\b/i;
    const hasSubType = subTypePattern.test(category);
    
    if (hasSubType) {
      // Has sub-type — strip only known pricing terms from the end, keep everything else
      serviceTypeOnly = category
        .replace(/\s*[-–—]\s*\b(display\s+price|rental\s+price|printing\s+price|fixing\s+price|printing\s*&?\s*fixing\s*price?|per\s+month|rate|price)\b.*$/i, '')
        .replace(/[\s\-–—&]+$/, '').trim();
      console.log('📌 Using service type (sub-type preserved):', serviceTypeOnly);
    } else {
      const dashIndex = category.indexOf(' - ');
      if (dashIndex > 0) {
        serviceTypeOnly = category.substring(0, dashIndex).trim();
        console.log('📌 Using service type only:', serviceTypeOnly);
      }
    }
  }
  
  // Synonym map for common advertising/media industry terms
  const synonymMap: Record<string, string[]> = {
    'ads': ['branding', 'advertising', 'ad', 'advertisement', 'advertisements'],
    'branding': ['ads', 'advertising', 'ad', 'advertisement'],
    'ad': ['branding', 'ads', 'advertising'],
    'advertising': ['branding', 'ads', 'ad'],
    'board': ['boards'],
    'boards': ['board'],
    'sticker': ['stickers'],
    'stickers': ['sticker'],
    'poster': ['posters'],
    'posters': ['poster'],
  };

  // Extract meaningful keywords, excluding pricing/quantity terms
  const words = serviceTypeOnly
    .toLowerCase()
    .replace(/[()]/g, ' ')  // Replace parentheses with spaces so inner words are preserved
    .split(/[\s,\-\/&]+/)
    .filter((w) => 
      w.length >= 3 && 
      !['rental', 'price', 'per', 'month', 'and', 'the', 'for', 'from', 'display', 'printing', 'fixing'].includes(w)
    );
  
  console.log('📝 Extracted keywords:', words);
  
  if (words.length === 0) return [];
  
  // Deduplicate keywords to avoid requiring the same word multiple times
  // e.g., "Mobile Van Branding - Mobile Van - LED Branding" should only require 'mobile', 'van', 'branding', 'led' once each
  const requiredKeywords = [...new Set(words)];
  
  console.log('🔑 Required keywords for matching:', requiredKeywords);
  
  // Strategy: Build an exact heading pattern from the category
  // E.g., "Apartment Lift Branding" → /apartment\s+lift\s+branding/i
  // E.g., "Bus Full Branding" → /bus\s+full\s+branding/i
  
  // Create a flexible regex pattern from the keywords
  const keywordPattern = words.join('\\s+');
  const exactHeadingPattern = new RegExp(keywordPattern, 'i');
  
  console.log('🎯 Exact heading pattern:', exactHeadingPattern.source);

  const matchedPages = pages.filter((page) => {
    // Clean up page text: Remove pipe characters and extra spaces that might split words
    // e.g., "li | ft" becomes "lift", "apartment li | ft branding" becomes "apartment lift branding"
    const pageText = page.text
      .toLowerCase()
      .replace(/\s*\|\s*/g, '') // Remove pipes and surrounding spaces
      .replace(/[()]/g, ' ')   // Replace parentheses with spaces so compound words like "starflex" become separate
      .replace(/\s+/g, ' ');    // Normalize multiple spaces to single space
    
    console.log(`🔍 Checking Page ${page.pageNumber} for keywords: [${requiredKeywords.join(', ')}]`);
    
    // EXCLUDE pricing summary pages (they contain pricing tables, not reference images)
    // Detect currency symbols/patterns that indicate pricing content
    const hasCurrencyPatterns = (pageText.match(/₹|rs\.?\s*[\d,]+|[\d,]+\.00/g) || []).length >= 3;
    const hasPricingColumns = (pageText.includes('unit price') || pageText.includes('unit of measure') || 
                               pageText.includes('price per') || pageText.includes('campaign'));
    const hasQuantityColumns = pageText.includes('quantity') || pageText.includes('min.') || pageText.includes('min ');
    const isPricingSummary = pageText.includes('pricing summary') || 
                            pageText.includes('price list') ||
                            pageText.includes('rate card') ||
                            (pageText.includes('activity') && pageText.includes('branding activities')) ||
                            (pageText.includes('unit price') && pageText.includes('total')) ||
                            (hasCurrencyPatterns && hasPricingColumns) ||
                            (hasCurrencyPatterns && hasQuantityColumns);
    
    if (isPricingSummary) {
      console.log(`❌ Page ${page.pageNumber} - Excluded (pricing summary table)`);
      return false;
    }
    
    // Helper: check if a single keyword (or its synonyms/variations) appears in the page text
    const keywordFoundInText = (kw: string, text: string): boolean => {
      // Check exact match first
      if (text.includes(kw)) return true;
      
      // Check synonyms
      const synonyms = synonymMap[kw];
      if (synonyms) {
        for (const syn of synonyms) {
          if (text.includes(syn)) {
            console.log(`  ✓ Synonym match: "${kw}" matched via synonym "${syn}"`);
            return true;
          }
        }
      }
      
      // For words ending in 's', also check without the 's'
      if (kw.endsWith('s') && kw.length > 4) {
        const withoutS = kw.slice(0, -1);
        if (!['awarenes', 'busines', 'congres', 'proces'].includes(withoutS)) {
          if (text.includes(withoutS)) return true;
        }
      }
      
      // For words not ending in 's', also check with 's' added
      if (!kw.endsWith('s')) {
        const withS = kw + 's';
        if (text.includes(withS)) return true;
      }
      
      // Fuzzy match for longer words (5+ chars)
      if (kw.length >= 5) {
        const words = text.split(' ');
        for (const word of words) {
          if (word.length >= kw.length - 2 && word.length <= kw.length + 2) {
            const startMatch = kw.substring(0, 4) === word.substring(0, 4);
            if (startMatch) return true;
            
            let commonChars = 0;
            const kwChars = kw.split('');
            const wordChars = word.split('');
            const usedIndices = new Set();
            for (const kwChar of kwChars) {
              for (let i = 0; i < wordChars.length; i++) {
                if (!usedIndices.has(i) && kwChar === wordChars[i]) {
                  commonChars++;
                  usedIndices.add(i);
                  break;
                }
              }
            }
            if (commonChars / kw.length >= 0.85) return true;
          }
        }
      }
      
      return false;
    };

    // FLEXIBLE MATCHING: Check if ALL keywords are present (in any order, with flexible spacing)
    // For each keyword, check both the original form and without trailing 's' (for plural/singular)
    const hasAllKeywords = requiredKeywords.every((kw) => {
      // Check exact match first
      if (pageText.includes(kw)) return true;
      
      // Check synonyms from synonymMap
      const synonyms = synonymMap[kw];
      if (synonyms) {
        for (const syn of synonyms) {
          if (pageText.includes(syn)) {
            console.log(`  ✓ Synonym match: "${kw}" matched via synonym "${syn}"`);
            return true;
          }
        }
      }
      
      // For words ending in 's', also check without the 's' (boards -> board)
      if (kw.endsWith('s') && kw.length > 4) {
        const withoutS = kw.slice(0, -1);
        if (!['awarenes', 'busines', 'congres', 'proces'].includes(withoutS)) {
          if (pageText.includes(withoutS)) {
            console.log(`  ✓ Found variation: "${kw}" matched as "${withoutS}"`);
            return true;
          }
        }
      }
      
      // For words not ending in 's', also check with 's' added (board -> boards)
      if (!kw.endsWith('s')) {
        const withS = kw + 's';
        if (pageText.includes(withS)) {
          console.log(`  ✓ Found variation: "${kw}" matched as "${withS}"`);
          return true;
        }
      }
      
      // Fuzzy match for longer words (5+ chars)
      if (kw.length >= 5) {
        const words = pageText.split(' ');
        for (const word of words) {
          if (word.length >= kw.length - 2 && word.length <= kw.length + 2) {
            const startMatch = kw.substring(0, 4) === word.substring(0, 4);
            if (startMatch) {
              console.log(`  ✓ Found fuzzy match: "${kw}" matched as "${word}" (same start + similar length)`);
              return true;
            }
            
            let commonChars = 0;
            const kwChars = kw.split('');
            const wordChars = word.split('');
            const usedIndices = new Set();
            
            for (const kwChar of kwChars) {
              for (let i = 0; i < wordChars.length; i++) {
                if (!usedIndices.has(i) && kwChar === wordChars[i]) {
                  commonChars++;
                  usedIndices.add(i);
                  break;
                }
              }
            }
            
            const similarity = commonChars / kw.length;
            if (similarity >= 0.85) {
              console.log(`  ✓ Found fuzzy match: "${kw}" matched as "${word}" (${Math.round(similarity * 100)}% characters match)`);
              return true;
            }
          }
        }
      }
      
      return false;
    });
    
    // RELAXED MATCHING: If strict match fails, try matching with at least 75% of keywords
    // This handles cases where keyword naming differs slightly from PDF headings
    const matchedCount = requiredKeywords.filter(kw => keywordFoundInText(kw, pageText)).length;
    const matchRatio = matchedCount / requiredKeywords.length;
    
    // Negation words like "non" are critical differentiators — they MUST be present
    // Without "non", "LED" vs "Non LED" would be indistinguishable
    const negationWords = ['non', 'not', 'without', 'no'];
    const criticalKeywords = requiredKeywords.filter(kw => negationWords.includes(kw));
    const hasMissingCritical = criticalKeywords.some(kw => !keywordFoundInText(kw, pageText));
    
    const hasRelaxedMatch = !hasAllKeywords && matchRatio >= 0.75 && matchedCount >= 2 && !hasMissingCritical;
    
    if (!hasAllKeywords && !hasRelaxedMatch) {
      // Use the same flexible matching for reporting missing keywords
      const missingKeywords = requiredKeywords.filter(kw => !keywordFoundInText(kw, pageText));
      
      console.log(`❌ Page ${page.pageNumber} - Missing keywords: [${missingKeywords.join(', ')}] (matched ${matchedCount}/${requiredKeywords.length})`);
      console.log(`   Page text sample: ${pageText.substring(0, 200)}...`);
      return false;
    }
    
    if (hasRelaxedMatch) {
      console.log(`✅ Page ${page.pageNumber} - RELAXED match (${matchedCount}/${requiredKeywords.length} keywords, ${Math.round(matchRatio * 100)}%)`);
    }
    
    // PRIORITY 1: Check if this is explicitly a reference image page
    const isReferenceImagePage = pageText.includes('reference image') || 
                                pageText.includes('reference images') ||
                                pageText.includes('sample image') ||
                                pageText.includes('display area') ||
                                pageText.includes('design specification');
    
    if (isReferenceImagePage) {
      console.log(`✅ Page ${page.pageNumber} - REFERENCE IMAGE page detected!`);
      return true;
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
  
  // POST-PROCESSING: Look for reference image pages adjacent to keyword matches
  // E.g., if page 32 has keywords but page 33 is reference image, include page 33
  const pageNumbersToInclude = new Set<number>();
  
  matchedPages.forEach((page) => {
    const pageText = page.text.toLowerCase().replace(/\s*\|\s*/g, '').replace(/\s+/g, ' ');
    
    // Check if this page has (1/X) pattern - skip it entirely
    const hasFirstPagePattern = pageText.match(/\(1\/\d+\)/);
    if (hasFirstPagePattern) {
      console.log(`🔄 Page ${page.pageNumber} - Excluded (1/X pattern)`);
      return;
    }
    
    // Check if this is a reference image page
    const isRefPage = pageText.includes('reference image') || 
                     pageText.includes('design specification') ||
                     pageText.match(/\(([2-9]\d*)\/\d+\)/);
    
    if (isRefPage) {
      console.log(`🎯 Page ${page.pageNumber} - Reference image page found`);
      pageNumbersToInclude.add(page.pageNumber);
      return;
    }
    
    // Check adjacent pages (next page) for reference images
    const nextPage = pages.find(p => p.pageNumber === page.pageNumber + 1);
    if (nextPage) {
      const nextText = nextPage.text.toLowerCase().replace(/\s*\|\s*/g, '').replace(/\s+/g, ' ');
      const nextIsRefPage = nextText.includes('reference image') || 
                           nextText.includes('design specification') ||
                           nextText.match(/\(([2-9]\d*)\/\d+\)/);
      
      if (nextIsRefPage) {
        console.log(`🔄 Page ${page.pageNumber} - Skipped, using next page ${nextPage.pageNumber} (reference page)`);
        pageNumbersToInclude.add(nextPage.pageNumber);
        return;
      }
    }
    
    // No reference page found in adjacent pages, include current page
    console.log(`✅ Page ${page.pageNumber} - Included (keyword match)`);
    pageNumbersToInclude.add(page.pageNumber);
  });
  
  const refinedPages = pages.filter(p => pageNumbersToInclude.has(p.pageNumber));
  console.log(`📊 After refinement: ${refinedPages.length} pages for "${category}"`);
  return refinedPages;
}

/**
 * Extract the main service type from all quote items.
 * Removes only pricing/quantity suffixes, preserving sub-type qualifiers.
 * E.g., "Bus Full Branding - Display Price" → "Bus Full Branding"
 * E.g., "Metro Branding – Underground Station - Display Price" → "Metro Branding – Underground Station"
 * E.g., "Apartment Lift Branding - Printing & Fixing Price" → "Apartment Lift Branding"
 */
// @ts-ignore: utility function kept for future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function extractServiceType(items: QuoteItem[]): string | null {
  // Pricing/quantity suffixes to strip — the part AFTER the real service name
  const pricingSuffixPattern = /\s*[-–—]\s*\b(display\s+price|rental\s+price|printing\s+price|fixing\s+price|printing\s*&?\s*fixing\s*price?|per\s+month|rate|price)\b.*$/i;

  for (const item of items) {
    const desc = item.description;
    
    // Step 1: Strip pricing suffix only (preserves sub-type like "Underground Station")
    let serviceType = desc.replace(pricingSuffixPattern, '').trim();
    // Also strip trailing dashes/spaces
    serviceType = serviceType.replace(/[\s\-–—&]+$/, '').trim();
    
    const lower = serviceType.toLowerCase();
    
    // Check if the cleaned string contains a service keyword
    if (lower.includes('branding') || 
        lower.includes('shelter') ||
        lower.includes('signage') ||
        lower.includes('printing') ||
        lower.includes('ads') ||
        lower.includes('advertising') ||
        lower.includes('screen') ||
        lower.includes('lobby') ||
        lower.includes('hoarding') ||
        lower.includes('board')) {
      console.log('📌 Extracted service type (pricing suffix removed):', serviceType);
      return serviceType;
    }
    
    // Fallback: Try splitting at first dash only if no pricing suffix was found
    const dashMatch = desc.match(/^([^-–—]+)\s*[-–—]/);
    if (dashMatch) {
      const beforeDash = dashMatch[1].trim();
      const bdLower = beforeDash.toLowerCase();
      if (bdLower.includes('branding') || 
          bdLower.includes('shelter') ||
          bdLower.includes('signage') ||
          bdLower.includes('printing') ||
          bdLower.includes('ads') ||
          bdLower.includes('advertising') ||
          bdLower.includes('screen') ||
          bdLower.includes('lobby')) {
        console.log('📌 Extracted service type from dash pattern:', beforeDash);
        return beforeDash;
      }
    }
    
    // Fallback: Match any "[Something] Branding" pattern
    const brandingMatch = desc.match(/([a-z\s]+branding)/i);
    if (brandingMatch) {
      const matchedType = brandingMatch[1].trim();
      console.log('📌 Extracted service type from branding pattern:', matchedType);
      return matchedType;
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
 * Extract ALL unique service types from quote items (for multi-service quotes).
 * Returns an array of unique service type strings.
 */
function extractAllServiceTypes(items: QuoteItem[]): string[] {
  const pricingSuffixPattern = /\s*[-–—]\s*\b(display\s+price|rental\s+price|printing\s+price|fixing\s+price|printing\s*&?\s*fixing\s*price?|per\s+month|rate|price)\b.*$/i;
  const seen = new Set<string>();
  const results: string[] = [];

  for (const item of items) {
    const desc = item.description;
    
    let serviceType = desc.replace(pricingSuffixPattern, '').trim();
    serviceType = serviceType.replace(/[\s\-–—&]+$/, '').trim();
    
    const lower = serviceType.toLowerCase();
    let extracted: string | null = null;
    
    if (lower.includes('branding') || 
        lower.includes('shelter') ||
        lower.includes('signage') ||
        lower.includes('printing') ||
        lower.includes('ads') ||
        lower.includes('advertising') ||
        lower.includes('screen') ||
        lower.includes('lobby') ||
        lower.includes('hoarding') ||
        lower.includes('board')) {
      extracted = serviceType;
    }
    
    if (!extracted) {
      const dashMatch = desc.match(/^([^-–—]+)\s*[-–—]/);
      if (dashMatch) {
        const beforeDash = dashMatch[1].trim();
        const bdLower = beforeDash.toLowerCase();
        if (bdLower.includes('branding') || bdLower.includes('shelter') ||
            bdLower.includes('signage') || bdLower.includes('printing') ||
            bdLower.includes('ads') || bdLower.includes('advertising') ||
            bdLower.includes('screen') || bdLower.includes('lobby')) {
          extracted = beforeDash;
        }
      }
    }
    
    if (!extracted) {
      const brandingMatch = desc.match(/([a-z\s]+branding)/i);
      if (brandingMatch) extracted = brandingMatch[1].trim();
    }
    
    if (!extracted) {
      const vehicleMatch = desc.match(/(bus|auto|tempo|apartment|building|lift|elevator|residential|commercial)\s+(full|semi|back|panel|shelter|rickshaw|branding)/i);
      if (vehicleMatch) extracted = vehicleMatch[0];
    }
    
    if (extracted) {
      const key = extracted.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        results.push(extracted);
        console.log('📌 Extracted service type:', extracted);
      }
    }
  }
  
  return results;
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
  
  // Extract ALL unique service types from quote items
  const serviceTypes = extractAllServiceTypes(items);
  
  if (serviceTypes.length > 0) {
    console.log(`🎯 Detected ${serviceTypes.length} service type(s):`, serviceTypes);
    
    // Loop through EACH service type and collect pages
    for (const serviceType of serviceTypes) {
      console.log(`\n🔍 Searching pages for: "${serviceType}"`);
      const matchingPages = filterPagesByCategory(pages, serviceType);
      
      if (matchingPages.length > 0) {
        console.log(`📊 Found ${matchingPages.length} pages matching "${serviceType}"`);
        
        // Filter to only reference pages (2/X or higher)
        const referencePages = matchingPages.filter(page => {
          const text = page.text
            .toLowerCase()
            .replace(/\s*\|\s*/g, '')
            .replace(/\s+/g, ' ');
          
          // Skip pricing summary pages
          const innerCurrencyMatches = (text.match(/₹|rs\.?\s*[\d,]+|[\d,]+\.00/g) || []).length;
          const innerHasPricingCols = text.includes('unit price') || text.includes('unit of measure') || 
                                      text.includes('price per') || text.includes('campaign');
          const innerHasQtyCols = text.includes('quantity') || text.includes('min.') || text.includes('min ');
          const isPricingSummary = text.includes('pricing summary') || 
                                  text.includes('price list') ||
                                  text.includes('rate card') ||
                                  (text.includes('activity') && text.includes('branding activities')) ||
                                  (text.includes('unit price') && text.includes('total')) ||
                                  (innerCurrencyMatches >= 3 && innerHasPricingCols) ||
                                  (innerCurrencyMatches >= 3 && innerHasQtyCols);
          
          if (isPricingSummary) {
            return false;
          }
          
          const pattern = text.match(/\((\d+)\/(\d+)\)/);
          if (pattern) {
            const pageNum = parseInt(pattern[1]);
            if (pageNum === 1) return false;
            return pageNum >= 2;
          }
          
          const hasFirstPagePattern = text.match(/\(1\/\d+\)/);
          if (hasFirstPagePattern) return false;
          
          const looksLikeReference = text.includes('reference image') || 
                                    text.includes('sample') ||
                                    text.includes('example') ||
                                    !isPricingSummary;
          
          return looksLikeReference;
        });
        
        if (referencePages.length > 0) {
          console.log(`✅ Found ${referencePages.length} reference pages for "${serviceType}"`);
          referencePages.forEach((page) => matchedPages.add(page.pageNumber));
        } else {
          // Fallback: include all matching except (1/X) pricing pages
          const filteredMatchingPages = matchingPages.filter(page => {
            const text = page.text.toLowerCase().replace(/\s*\|\s*/g, '').replace(/\s+/g, ' ');
            const hasFirstPagePattern = text.match(/\(1\/\d+\)/);
            return !hasFirstPagePattern;
          });
          filteredMatchingPages.forEach((page) => matchedPages.add(page.pageNumber));
        }
      } else {
        console.log(`⚠️ No pages found for "${serviceType}"`);
      }
    }
    
    if (matchedPages.size > 0) {
      const result = pages.filter((page) => matchedPages.has(page.pageNumber));
      console.log(`📊 Final result: ${result.length} reference pages for ${serviceTypes.length} service type(s)`);
      return result;
    }
  }
  
  // Fallback: Process each item individually (unchanged from original)
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
        
      // EXPLICIT CHECK: Exclude any page with (1/X) pattern (pricing page)
      const hasFirstPagePattern = text.match(/\(1\/\d+\)/);
      if (hasFirstPagePattern) {
        console.log(`  ❌ Page ${page.pageNumber} - Excluded (found (1/X) pattern - pricing page)`);
        return false;
      }
        
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
      // BUT STILL exclude any (1/X) pages to avoid showing pricing pages
      console.log(`⚠️ No (X/Y) pattern found for reference pages, checking all ${matchingPages.length} matching pages`);
      
      const filteredMatchingPages = matchingPages.filter(page => {
        const text = page.text.toLowerCase().replace(/\s*\|\s*/g, '').replace(/\s+/g, ' ');
        
        // EXPLICIT CHECK: Exclude any page with (1/X) pattern (pricing page)
        const hasFirstPagePattern = text.match(/\(1\/\d+\)/);
        if (hasFirstPagePattern) {
          console.log(`  ❌ Page ${page.pageNumber} - Excluded from fallback (found (1/X) pattern)`);
          return false;
        }
        return true;
      });
      
      console.log(`📊 After filtering out (1/X) pages: ${filteredMatchingPages.length} pages remain`);
      filteredMatchingPages.forEach((page) => matchedPages.add(page.pageNumber));
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

  // Separate filtered pages into design specification pages and reference image pages
  const { designSpecPages, referenceImagePages } = useMemo(() => {
    const designSpec: ExtractedPage[] = [];
    const reference: ExtractedPage[] = [];
    
    // Filter out direct JPEG uploads (single-page JPEG files)
    // This excludes JPEG images uploaded directly, but keeps PDF-rendered images
    const isDirectJPEGUpload = proposalPages && 
                               proposalPages.length === 1 && 
                               proposalPages[0].imageDataUrl?.startsWith('data:image/jpeg');
    
    if (isDirectJPEGUpload) {
      console.log('🚫 ReferenceImages: Direct JPEG upload detected - skipping visual display');
      return { designSpecPages: [], referenceImagePages: [] };
    }
    
    for (const page of filteredPages) {
      const text = page.text
        .toLowerCase()
        .replace(/\s*\|\s*/g, '')
        .replace(/\s+/g, ' ');
      
      // Detect if page is actually a pricing table (should be excluded entirely)
      const currencyMatches = (text.match(/₹|rs\.?\s*[\d,]+|[\d,]+\.00/g) || []).length;
      const isPricingTable = currencyMatches >= 3 && 
                            (text.includes('unit price') || text.includes('unit of measure') || 
                             text.includes('price per') || text.includes('quantity') ||
                             text.includes('campaign') || text.includes('min.'));
      
      if (isPricingTable) {
        console.log(`🚫 Page ${page.pageNumber} - Excluded from sections (pricing table with ${currencyMatches} currency references)`);
        continue; // Skip pricing tables entirely — they are NOT reference images or design specs
      }
      
      const hasDesignSpec = text.includes('design specification') ||
                           text.includes('design specifications') ||
                           text.includes('display area');
      const hasReferenceImage = text.includes('reference image') ||
                                text.includes('reference images');
      
      // Check for (X/Y) page numbering pattern
      const pagePattern = text.match(/\((\d+)\/(\d+)\)/);
      const pageNum = pagePattern ? parseInt(pagePattern[1]) : 0;
      const totalPages = pagePattern ? parseInt(pagePattern[2]) : 0;
      // Last page of a section (e.g., 2/2, 3/3) is always reference images
      const isLastPage = pagePattern ? pageNum === totalPages && pageNum >= 2 : false;
      
      // Detect if page is image-heavy (has cropped images or very little text)
      // Pages with "Design Specification" heading but mostly photos should go to reference images
      const hasCroppedImages = page.croppedImages && page.croppedImages.length > 0;
      const isTextLight = text.replace(/[^a-z]/g, '').length < 200; // Very little actual text content
      const isImageHeavyPage = hasCroppedImages || isTextLight;
      // Page numbered 2+ in a multi-page section is always a visual/reference page
      const isLaterPage = pagePattern ? pageNum >= 2 : false;
      
      // Classify as Design Spec ONLY if:
      // 1. Has design spec keywords AND
      // 2. Does NOT have "reference image" text AND
      // 3. Is NOT the last page of a multi-page section AND
      // 4. Is NOT an image-heavy page (photos with "Design Spec" title = reference, not spec)
      // 5. Is NOT a later page (2/3, 3/3 etc.) in a multi-page section
      if (hasDesignSpec && !hasReferenceImage && !isLastPage && !isImageHeavyPage && !isLaterPage) {
        designSpec.push(page);
        console.log(`📐 Page ${page.pageNumber} → Design Specification (text-heavy spec page)`);
      } else {
        reference.push(page);
        console.log(`🖼️ Page ${page.pageNumber} → Reference Images (${isImageHeavyPage ? 'image-heavy' : isLaterPage ? 'later page in section' : isLastPage ? 'last page' : hasReferenceImage ? 'has reference keyword' : 'default'})`);
      }
    }
    
    return { designSpecPages: designSpec, referenceImagePages: reference };
  }, [filteredPages, proposalPages]);

  // Group images into pairs (max 2 per page) — flatten cropped images
  const groupedDesignSpec = useMemo(() => {
    const displayImages = flattenToDisplayImages(designSpecPages, 'design-spec');
    const groups: DisplayImage[][] = [];
    for (let i = 0; i < displayImages.length; i += 2) {
      groups.push(displayImages.slice(i, i + 2));
    }
    return groups;
  }, [designSpecPages]);

  const groupedReferenceImages = useMemo(() => {
    const displayImages = flattenToDisplayImages(referenceImagePages, 'ref');
    const groups: DisplayImage[][] = [];
    for (let i = 0; i < displayImages.length; i += 2) {
      groups.push(displayImages.slice(i, i + 2));
    }
    return groups;
  }, [referenceImagePages]);

  if (!proposalPages || proposalPages.length === 0) {
    console.log('❌ ReferenceImages: No proposal pages, returning null');
    return null;
  }
  if (filteredPages.length === 0) {
    console.log('⚠️ ReferenceImages: No filtered pages found');
    console.log('💡 Available pages:', proposalPages.length);
    console.log('💡 Quote items:', items?.map(i => i.description) || []);
    console.log('💡 Tip: Check if page text contains keywords from quote items');
    
    // No matches found - return null to show clean quote without reference images
    return null;
  }

  console.log('✅ ReferenceImages: Rendering', filteredPages.length, 'pages');

  return (
    <div className="reference-images-section">
      {/* Structural spacer to force top spacing in PDF */}
      <div className="pdf-top-spacer" style={{ height: '80px', width: '100%', display: 'block' }}></div>
      
      {groupedDesignSpec.length > 0 && (
        <>
          <h3 className="reference-images-title">Design Specification</h3>
          <div className="reference-images-grid">
            {groupedDesignSpec.map((group, groupIndex) => (
              <div key={`design-spec-group-${groupIndex}`} className="reference-image-row">
                {group.map((img) => (
                  <div key={img.key} className={`reference-image-item${img.isCropped ? ' cropped' : ''}`}>
                    <img
                      src={img.imageUrl}
                      alt={img.alt}
                      className={`reference-image${img.isCropped ? ' cropped-image' : ''}`}
                    />
                    {!img.isCropped && <span className="reference-image-caption">Page {img.pageNumber}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {groupedReferenceImages.length > 0 && (
        <>
          <h3 className="reference-images-title">Reference Images from Proposal</h3>
          <div className="reference-images-grid">
            {groupedReferenceImages.map((group, groupIndex) => (
              <div key={`ref-group-${groupIndex}`} className="reference-image-row">
                {group.map((img) => (
                  <div key={img.key} className={`reference-image-item${img.isCropped ? ' cropped' : ''}`}>
                    <img
                      src={img.imageUrl}
                      alt={img.alt}
                      className={`reference-image${img.isCropped ? ' cropped-image' : ''}`}
                    />
                    {!img.isCropped && <span className="reference-image-caption">Page {img.pageNumber}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
