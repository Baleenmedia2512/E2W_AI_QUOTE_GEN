import React, { useMemo, useState, useEffect } from 'react';
import './ReferenceImages.css';
import { extractReviewViaGemini, cropReferencePageImage, cropPageStrippingHeaderFooter, cropPageHalf } from '../../utils/pdfUtils';

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

interface ReferenceImagesProps {
  proposalPages?: ExtractedPage[];
  items?: QuoteItem[];
}

interface CustomerReviewData {
  reviewerName: string;
  starCount: number;
  reviewText: string;
  reviewUrl: string | null;
}

interface SpecGroup {
  heading: string | null;
  fields: Array<{ label: string; value: string }>;
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
          // Compound word check: PDF sometimes glues words together (e.g. "awarnessdirectio")
          // Try matching keyword against the first (kw.length+2) characters of longer words
          if (word.length > kw.length + 2 && kw.length >= 5) {
            const prefix = word.substring(0, kw.length + 2);
            if (kw.substring(0, 4) === prefix.substring(0, 4)) {
              let commonChars = 0;
              const kwChars = kw.split('');
              const prefChars = prefix.split('');
              const usedIdx = new Set();
              for (const kwChar of kwChars) {
                for (let i = 0; i < prefChars.length; i++) {
                  if (!usedIdx.has(i) && kwChar === prefChars[i]) {
                    commonChars++;
                    usedIdx.add(i);
                    break;
                  }
                }
              }
              if (commonChars / kw.length >= 0.85) return true;
            }
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
          // Compound word check: PDF sometimes glues words together (e.g. "awarnessdirectio")
          // Try matching keyword against the first (kw.length+2) characters of longer words
          if (word.length > kw.length + 2 && kw.length >= 5) {
            const prefix = word.substring(0, kw.length + 2);
            if (kw.substring(0, 4) === prefix.substring(0, 4)) {
              let commonChars = 0;
              const kwChars = kw.split('');
              const prefChars = prefix.split('');
              const usedIdx = new Set();
              for (const kwChar of kwChars) {
                for (let i = 0; i < prefChars.length; i++) {
                  if (!usedIdx.has(i) && kwChar === prefChars[i]) {
                    commonChars++;
                    usedIdx.add(i);
                    break;
                  }
                }
              }
              if (commonChars / kw.length >= 0.85) {
                console.log(`  ✓ Found compound-word match: "${kw}" matched as prefix of "${word}"`);
                return true;
              }
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

    // All keywords confirmed present via fuzzy/synonym matching — accept the page.
    // This handles PDFs with typos (e.g. "awarnessdirectio") where exact heading
    // reconstruction fails but keywords are definitively present.
    if (hasAllKeywords) {
      console.log(`✅ Page ${page.pageNumber} - Accepted (all keywords confirmed via fuzzy match)`);
      return true;
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
                     pageText.includes('reference images') ||
                     pageText.includes('referenceimage') ||
                     pageText.includes('reference photo') ||
                     pageText.includes('reference photos') ||
                     pageText.includes('example image') ||
                     pageText.includes('sample photo') ||
                     pageText.includes('design specification') ||
                     pageText.includes('design specifications') ||
                     pageText.includes('design specs') ||
                     pageText.includes('specification') ||
                     pageText.includes('customer review') ||
                     pageText.includes('client review') ||
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
                           nextText.includes('reference images') ||
                           nextText.includes('referenceimage') ||
                           nextText.includes('reference photo') ||
                           nextText.includes('reference photos') ||
                           nextText.includes('example image') ||
                           nextText.includes('sample photo') ||
                           nextText.includes('design specification') ||
                           nextText.includes('design specifications') ||
                           nextText.includes('design specs') ||
                           nextText.includes('specification') ||
                           nextText.includes('customer review') ||
                           nextText.includes('client review') ||
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

// --- Smart Content Extraction Helpers ---

function extractDesignSpecFields(pages: ExtractedPage[]): SpecGroup[] {
  for (const page of pages) {
    const text = page.text;
    const specMatch = text.match(/display area[^\n]*design spec[^\n]*/i)
                   || text.match(/design\s*spec[^\n]*/i)
                   || text.match(/display\s*area[^\n]*/i)
                   || text.match(/specification[^\n]*/i);
    if (!specMatch || specMatch.index === undefined) continue;
    const afterSpec = text.substring(specMatch.index + specMatch[0].length);
    const endMatch = afterSpec.match(/\n(reference\s*image|customer review|click here)/i);
    const specSection = endMatch && endMatch.index !== undefined ? afterSpec.substring(0, endMatch.index) : afterSpec;

    const dimensionFields: Array<{ label: string; value: string }> = [];
    const materialFields: Array<{ label: string; value: string }> = [];

    /**
     * Is this pipe-column a continuation of the previous dimension value?
     * e.g. "wxh ) inches", "( wxh ) inches" — these appear as separate columns
     * in the PDF because the PDF renderer splits on the opening parenthesis.
     */
    const isDimContinuation = (part: string): boolean => {
      if (!part) return false;
      // Starts with open-paren, lowercase, or known dimension residual words
      if (/^\(/.test(part)) return true;
      if (/^(wxh|wdh|wxd|w\s*x\s*h|inches|cms?|mm\b)/i.test(part)) return true;
      // Starts with lowercase and no colon label pattern
      if (/^[a-z]/.test(part) && !/^[a-z][a-z\s]{1,25}:\s*\S/i.test(part)) return true;
      // Contains only closing paren + unit
      if (/^\)\s*(inches|cms?|mm|feet|ft)?$/i.test(part)) return true;
      return false;
    };

    const lines = specSection.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      // Split line on pipe separators (tab-pipe-tab, space-pipe-space, or bare pipe)
      const parts = line.split(/\t\|\t|\s\|\s|\|/).map(p => p.trim()).filter(p => p.length > 0);

      if (parts.length === 1) {
        // Single column — classify by content
        const part = parts[0];
        if (/^materials?\s*:?\s*$/i.test(part)) continue;
        const colonMatch = part.match(/^([^:]{1,50}):\s*(.+)$/);
        if (colonMatch) {
          const label = colonMatch[1].trim();
          const value = colonMatch[2].trim();
          const isDim = /\d["'x×(]/i.test(value) || /side|front|back|top|bottom|left|right|dimension|size/i.test(label);
          if (isDim) dimensionFields.push({ label, value });
          else materialFields.push({ label, value });
        }
        continue;
      }

      // Multi-column line — first collect the full dimension string by consuming
      // any continuation parts that belong to the dimension value.
      let dimEnd = 1; // exclusive index where dimension columns end
      while (dimEnd < parts.length && isDimContinuation(parts[dimEnd])) {
        dimEnd++;
      }

      // Build and parse the dimension entry from parts[0..dimEnd-1]
      const fullDimStr = parts.slice(0, dimEnd).join(' ').trim();
      const dimColon = fullDimStr.match(/^([^:]{1,60}):\s*(.+)$/);
      if (dimColon) {
        dimensionFields.push({ label: dimColon[1].trim(), value: dimColon[2].trim() });
      }

      // Handle PDF format where label and value are in separate pipe-columns:
      // e.g. "Material:\t|\tSun Pack" → parts[0]="Material:" parts[1]="Sun Pack"
      // dimColon fails because fullDimStr="Material:" has no inline value.
      if (!dimColon && dimEnd === 1 && /:\s*$/.test(parts[0]) && parts.length >= 2) {
        const label = parts[0].replace(/:\s*$/, '').trim();
        const value = parts.slice(1).join(' ').trim();
        if (label && value) {
          const isDim = /\d["'x×(]/i.test(value) || /side|front|back|top|bottom|left|right|dimension|size/i.test(label);
          if (isDim) dimensionFields.push({ label, value });
          else materialFields.push({ label, value });
        }
        continue;
      }

      // Remaining parts are the material columns
      const remaining = parts.slice(dimEnd);
      if (remaining.length === 0) continue;

      // Skip if all remaining is just a bare "Material:" heading
      const remainingJoined = remaining.join(' ').trim();
      if (/^materials?\s*:?\s*$/i.test(remainingJoined)) continue;

      if (remaining.length >= 2) {
        // Pattern: ["3 sides:", "Rexine"] or ["Top:", "Vinyl sticker"]
        const matLabel = remaining[0].replace(/:$/, '').trim();
        const matValue = remaining.slice(1).join(' ').trim();
        if (matLabel && matValue && !/^materials?$/i.test(matLabel)) {
          materialFields.push({ label: matLabel, value: matValue });
        }
      } else {
        // Pattern: ["Top: Vinyl sticker"] — single colon entry
        const rc = remaining[0].match(/^([^:]{1,50}):\s*(.+)$/);
        if (rc && !/^materials?$/i.test(rc[1])) {
          materialFields.push({ label: rc[1].trim(), value: rc[2].trim() });
        }
      }
    }

    const groups: SpecGroup[] = [];
    if (dimensionFields.length > 0) groups.push({ heading: null, fields: dimensionFields });
    if (materialFields.length > 0) groups.push({ heading: 'Material', fields: materialFields });
    if (groups.length > 0) return groups;
  }
  return [];
}

// Matches any heading that indicates a customer/google review section
const REVIEW_HEADING_PATTERN = /customer\s+review|client\s+review|google\s+review\s+feedback|google\s+review|review\s+feedback\s+for|testimonials?|client\s+feedback|customer\s+feedback/i;

function extractCustomerReview(pages: ExtractedPage[]): CustomerReviewData | null {
  for (const page of pages) {
    const text = page.text;
    if (!REVIEW_HEADING_PATTERN.test(text)) continue;
    const reviewMatch = text.match(/(?:customer review|client review|google review[^\n]*|review feedback[^\n]*|testimonials?|client feedback|customer feedback)/i);
    if (!reviewMatch || reviewMatch.index === undefined) continue;
    const afterReview = text.substring(reviewMatch.index + reviewMatch[0].length);
    const lines = afterReview.split('\n').map(l => l.trim()).filter(Boolean);

    let reviewerName = '';
    let starCount = 0;
    const reviewLines: string[] = [];
    let reviewUrl: string | null = null;

    // Lines that are UI/navigation/metadata — never treat as name or review text
    const isSkippable = (line: string): boolean => {
      if (/^back\s+to\s+summary/i.test(line)) return true;
      if (/^click here|^see the review|^view review|^click here to view/i.test(line)) return true;
      if (/edited\s+\d+|\d+\s*(week|month|day|hour|year)s?\s+ago/i.test(line)) return true;
      if (/^page\s*\d+$/i.test(line)) return true;
      if (/^\d+$/.test(line)) return true; // bare page number
      if (line.length <= 1) return true;
      return false;
    };

    for (const line of lines) {
      // 1. Extract URL first
      const urlMatch = line.match(/https?:\/\/[^\s]+/);
      if (urlMatch) { reviewUrl = urlMatch[0]; continue; }

      // 2. Skip navigation / metadata
      if (isSkippable(line)) continue;

      // 3. Extract star count — supports ★, ☆, ⭐ emoji
      if (starCount === 0) {
        const filledStars = (line.match(/[★⭐]/g) || []).length;
        if (filledStars > 0) {
          starCount = filledStars;
          // If line has real text after the stars (not just timestamp), add it as review text
          const afterStars = line
            .replace(/^[★☆⭐✩\s]+/, '')
            .replace(/edited\s+\d+.*/i, '')
            .trim();
          if (afterStars.length > 15) reviewLines.push(afterStars);
          continue;
        }
      }

      // 4. Extract reviewer name — first short capitalised line that looks like a person name
      if (!reviewerName && line.length <= 50 && line.split(' ').length <= 5 && !/^\d/.test(line) && /[A-Z]/.test(line)) {
        reviewerName = line;
        continue;
      }

      // 5. Collect review body text
      if (line.length > 15) reviewLines.push(line);
    }

    if (reviewerName || reviewLines.length > 0 || reviewUrl) {
      return {
        reviewerName: reviewerName || 'Customer',
        starCount: Math.min(5, Math.max(1, starCount || 5)),
        reviewText: reviewLines.join(' '),
        reviewUrl,
      };
    }
  }
  return null;
}

/** Pages that belong to the Design Specification section (not Reference Image pages) */
function getSpecPages(pages: ExtractedPage[]): ExtractedPage[] {
  return pages.filter(page => {
    const text = page.text.toLowerCase().replace(/\s*\|\s*/g, ' ');
    const hasSpec = text.includes('design specification') ||
                    text.includes('design specifications') ||
                    text.includes('design specs') ||
                    text.includes('specification') ||
                    text.includes('display area');
    if (!hasSpec) return false;
    const hasRefImg = text.includes('reference image') || text.includes('reference images');
    // If BOTH headings appear on the same page, qualify as spec page only when
    // the spec heading comes BEFORE the reference image heading in the text.
    // This handles PDFs where Design Spec and Reference Image share a single page.
    if (hasRefImg) {
      const specPos = Math.min(
        text.includes('design specification') ? text.indexOf('design specification') : Infinity,
        text.includes('design specifications') ? text.indexOf('design specifications') : Infinity,
        text.includes('design specs') ? text.indexOf('design specs') : Infinity,
        text.includes('specification') ? text.indexOf('specification') : Infinity,
        text.includes('display area') ? text.indexOf('display area') : Infinity
      );
      const refPos = Math.min(
        text.includes('reference image') ? text.indexOf('reference image') : Infinity,
        text.includes('reference images') ? text.indexOf('reference images') : Infinity,
        text.includes('reference photo') ? text.indexOf('reference photo') : Infinity,
        text.includes('reference photos') ? text.indexOf('reference photos') : Infinity,
        text.includes('example image') ? text.indexOf('example image') : Infinity,
        text.includes('sample photo') ? text.indexOf('sample photo') : Infinity
      );
      return specPos < refPos;
    }
    return true;
  });
}

/** Pages that belong strictly under the Reference Image heading */
function getRefImagePages(pages: ExtractedPage[]): ExtractedPage[] {
  return pages.filter(page => {
    const text = page.text.toLowerCase().replace(/\s*\|\s*/g, ' ');
    return text.includes('reference image') || text.includes('reference images') ||
           text.includes('referenceimage') ||
           text.includes('reference photo') || text.includes('reference photos') ||
           text.includes('example image') || text.includes('sample photo');
  });
}

/**
 * Extract best image for Design Specification section.
 * Only picks from spec pages — never from reference image pages.
 * Skips cropped images from pages that ALSO have a reference image heading,
 * because those cropped images are real-world photos (not design diagrams).
 */
function extractSpecSectionImage(pages: ExtractedPage[]): string | null {
  const specPages = getSpecPages(pages);

  // Helper: does this page also contain a reference image heading?
  const pageHasRefHeading = (page: ExtractedPage): boolean => {
    const t = page.text.toLowerCase().replace(/\s*\|\s*/g, ' ');
    return t.includes('reference image') || t.includes('reference images') ||
           t.includes('reference photo') || t.includes('reference photos') ||
           t.includes('example image') || t.includes('sample photo');
  };

  // First pass: prefer cropped image ONLY from pages that are pure spec pages
  // (no reference image heading on the same page — so the cropped image is a diagram, not a photo)
  for (const page of specPages) {
    if (pageHasRefHeading(page)) continue; // skip shared pages — their cropped image is a reference photo
    if (page.croppedImages && page.croppedImages.length > 0) return page.croppedImages[0];
  }

  // Second pass: fallback to full page image only when page is diagram-heavy
  // (very little text AND no reference image heading — means it's a layout/measurement slide)
  for (const page of specPages) {
    if (pageHasRefHeading(page)) continue; // skip shared pages
    const textLen = page.text.replace(/[^a-z]/gi, '').length;
    if (textLen < 300) return page.imageDataUrl;
  }

  return null;
}

/**
 * Extract best image for Reference Image section.
 * ONLY picks from pages that have "Reference Image" heading.
 * Never falls back to spec page images.
 */
function extractRefSectionImage(pages: ExtractedPage[]): string | null {
  const refPages = getRefImagePages(pages);
  if (refPages.length === 0) return null;
  // Prefer cropped image
  for (const page of refPages) {
    if (page.croppedImages && page.croppedImages.length > 0) return page.croppedImages[0];
  }
  // Fallback: full page image of reference page
  return refPages[0].imageDataUrl;
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

  // Customer review pages: sweep ALL proposalPages unconditionally.
  // This is separate from filteredPages so spec/ref image logic is completely unaffected.
  const reviewPages = useMemo(() => {
    if (!proposalPages) return [];
    const filteredPageNums = new Set(filteredPages.map(p => p.pageNumber));
    const extra = proposalPages.filter(p =>
      !filteredPageNums.has(p.pageNumber) &&
      REVIEW_HEADING_PATTERN.test(p.text)
    );
    if (extra.length > 0) {
      console.log('📝 ReferenceImages: Found', extra.length, 'customer review page(s) outside filtered set');
    }
    return [...filteredPages, ...extra];
  }, [proposalPages, filteredPages]);

  // Smart content extraction from parsed text — section-aware
  // specGroups and image extraction use filteredPages ONLY (unchanged behaviour)
  const specGroups = useMemo(() => extractDesignSpecFields(filteredPages), [filteredPages]);
  const hasSpecContent = specGroups.some(g => g.fields.length > 0);
  // Spec image: only from Design Specification pages
  const specImageUrl = useMemo(() => extractSpecSectionImage(filteredPages), [filteredPages]);
  // Reference image: only from Reference Image pages — never falls back to spec pages
  const refImageUrl = useMemo(() => extractRefSectionImage(filteredPages), [filteredPages]);
  // Customer review uses reviewPages (filteredPages + any customer review pages from full proposal)
  const customerReview = useMemo(() => extractCustomerReview(reviewPages), [reviewPages]);

  // Gemini OCR fallback: fires only when pdfjs text extraction couldn't get name or review body.
  // Does NOT affect filteredPages, specGroups, specImageUrl, or refImageUrl.
  const [geminiReview, setGeminiReview] = useState<{ reviewerName: string; starCount: number; reviewText: string } | null>(null);
  useEffect(() => {
    // Only run if review card data is incomplete (name fell back to "Customer" or text is empty)
    const needsOCR = customerReview && (
      customerReview.reviewerName === 'Customer' || customerReview.reviewText === ''
    );
    if (!needsOCR) { setGeminiReview(null); return; }

    // Find the review page image to send to Gemini
    const reviewPage = reviewPages.find(p => REVIEW_HEADING_PATTERN.test(p.text));
    if (!reviewPage) return;

    let cancelled = false;
    console.log('🔍 Triggering Gemini OCR for review page', reviewPage.pageNumber);
    extractReviewViaGemini(reviewPage.imageDataUrl).then(data => {
      if (!cancelled && data) {
        console.log('✅ Gemini review OCR result:', data);
        setGeminiReview(data);
      }
    });
    return () => { cancelled = true; };
  }, [customerReview, reviewPages]);

  // Merge: Gemini OCR fills in missing name/text; URL always comes from pdfjs text layer
  const finalReview = customerReview ? {
    ...customerReview,
    reviewerName: geminiReview?.reviewerName || customerReview.reviewerName,
    starCount:    geminiReview?.starCount    ?? customerReview.starCount,
    reviewText:   geminiReview?.reviewText   || customerReview.reviewText,
  } : null;

  // Lazy Gemini Vision crop for Reference Image section.
  // Fires only when the ref page has no croppedImages (upload-time crop was skipped or returned empty).
  // Does NOT affect spec image, customer review, or filteredPages logic.
  const [lazyCroppedRefImage, setLazyCroppedRefImage] = useState<string | null>(null);
  useEffect(() => {
    // Find the reference image page inside filteredPages (including new heading variants)
    const refPage = filteredPages.find(p => {
      const t = p.text.toLowerCase().replace(/\s*\|\s*/g, ' ');
      return t.includes('reference image') || t.includes('reference images') ||
             t.includes('reference photo') || t.includes('reference photos') ||
             t.includes('example image') || t.includes('sample photo');
    });
    // Only fire if ref page exists AND has no cropped images (so full-page fallback is active)
    if (!refPage || (refPage.croppedImages && refPage.croppedImages.length > 0)) {
      setLazyCroppedRefImage(null);
      return;
    }
    let cancelled = false;
    console.log('🔍 Triggering lazy Gemini Vision crop for reference page', refPage.pageNumber);
    cropReferencePageImage(refPage.imageDataUrl, refPage.pageNumber).then(async cropped => {
      if (cancelled) return;
      if (cropped.length > 0) {
        console.log('✅ Lazy crop: got', cropped.length, 'image(s) from reference page', refPage.pageNumber);
        setLazyCroppedRefImage(cropped[0]);
      } else {
        // Gemini Vision returned nothing — use geometric header/footer strip as fallback
        console.log('⚠️ Gemini Vision empty, using geometric strip for reference page', refPage.pageNumber);
        const stripped = await cropPageStrippingHeaderFooter(refPage.imageDataUrl);
        if (!cancelled) setLazyCroppedRefImage(stripped);
      }
    });
    return () => { cancelled = true; };
  }, [filteredPages]);

  // Lazy spec section image crop for shared-page case (Lamp Post Die Cutting etc).
  // Fires only when the spec page is ALSO a reference image page (both headings on same page).
  // Uses top-half geometric crop so spec diagram (top) is separated from reference photo (bottom).
  // Does NOT affect pages where spec and ref image are on separate pages.
  const [lazyCroppedSpecImage, setLazyCroppedSpecImage] = useState<string | null>(null);
  useEffect(() => {
    const specPage = filteredPages.find(p => {
      const t = p.text.toLowerCase().replace(/\s*\|\s*/g, ' ');
      const hasSpec = t.includes('design specification') || t.includes('design specifications') ||
                      t.includes('design specs') || t.includes('specification') || t.includes('display area');
      const hasRef  = t.includes('reference image') || t.includes('reference images') ||
                      t.includes('reference photo') || t.includes('reference photos') ||
                      t.includes('example image') || t.includes('sample photo');
      // Only trigger for SHARED pages (both headings present) — separate pages use normal flow
      return hasSpec && hasRef;
    });
    if (!specPage) {
      setLazyCroppedSpecImage(null);
      return;
    }
    let cancelled = false;
    console.log('🔍 Triggering lazy top-half crop for shared spec/ref page', specPage.pageNumber);
    cropPageHalf(specPage.imageDataUrl, 'top').then(cropped => {
      if (!cancelled) {
        console.log('✅ Lazy spec top-half crop done for page', specPage.pageNumber);
        setLazyCroppedSpecImage(cropped);
      }
    });
    return () => { cancelled = true; };
  }, [filteredPages]);

  if (!proposalPages || proposalPages.length === 0) {
    console.log('❌ ReferenceImages: No proposal pages, returning null');
    return null;
  }
  if (filteredPages.length === 0) {
    console.log('⚠️ ReferenceImages: No filtered pages found');
    return null;
  }

  console.log('✅ ReferenceImages: Rendering smart layout for', filteredPages.length, 'pages');

  return (
    <div className="smart-reference-page">
      <div className="pdf-top-spacer" />

      {/* Design Specification */}
      {(hasSpecContent || specImageUrl) && (
        <div className="smart-section">
          <h3 className="smart-section-heading">
            <span className="smart-heading-bar" />
            Display Area / Design Specification
          </h3>
          {hasSpecContent && (
            <div className="spec-table">
              {specGroups.map((group, gi) => (
                <React.Fragment key={gi}>
                  {group.heading && (
                    <div className="spec-group-heading">{group.heading}</div>
                  )}
                  {group.fields.map((f, fi) => (
                    <div key={fi} className="spec-row">
                      <span className="spec-label">{f.label}</span>
                      <span className="spec-value">{f.value}</span>
                    </div>
                  ))}
                </React.Fragment>
              ))}
            </div>
          )}
          {specImageUrl && (
            <div className="ref-img-container spec-img-container">
              <img src={lazyCroppedSpecImage ?? specImageUrl} alt="Design specification diagram" className="ref-img" />
            </div>
          )}
        </div>
      )}

      {/* Reference Image */}
      {refImageUrl && (
        <div className="smart-section">
          <h3 className="smart-section-heading">
            <span className="smart-heading-bar" />
            Reference Image
          </h3>
          <div className="ref-img-container">
            <img src={lazyCroppedRefImage ?? refImageUrl} alt="Reference" className="ref-img" />
          </div>
        </div>
      )}

      {/* Customer Review */}
      {finalReview && (
        <div className="smart-section">
          <h3 className="smart-section-heading">
            <span className="smart-heading-bar" />
            Customer Review
          </h3>
          <div className="review-card">
            <div className="review-header">
              <span className="review-avatar">{finalReview.reviewerName.charAt(0).toUpperCase()}</span>
              <div className="review-meta">
                <span className="review-name">{finalReview.reviewerName}</span>
                <span className="review-stars">
                  {'★'.repeat(finalReview.starCount)}{'☆'.repeat(Math.max(0, 5 - finalReview.starCount))}
                </span>
              </div>
            </div>
            {finalReview.reviewText && (
              <p className="review-body">{finalReview.reviewText}</p>
            )}
            {finalReview.reviewUrl && (
              <a
                href={finalReview.reviewUrl}
                className="review-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                Click here to see the review
              </a>
            )}
          </div>
        </div>
      )}

      {/* Fallback: show full-page images when text extraction yields nothing */}
      {!hasSpecContent && !customerReview && filteredPages.length > 0 && (
        <div className="smart-section">
          <h3 className="smart-section-heading">
            <span className="smart-heading-bar" />
            Reference Images from Proposal
          </h3>
          <div className="ref-img-container">
            {filteredPages.map(page => (
              <img key={page.pageNumber} src={page.imageDataUrl} alt={`Page ${page.pageNumber}`} className="ref-img fallback-img" style={{ marginBottom: '20px' }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
