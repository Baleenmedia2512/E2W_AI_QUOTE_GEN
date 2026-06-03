import React, { useMemo, useState, useEffect, useRef } from 'react';
import './ReferenceImages.css';
import { extractReviewViaGemini, cropReferencePageImage, cropPageStrippingHeaderFooter, cropSpecAboveReference, cropSpecDiagram, cropPageHalf, cropPageFromPercent } from '../../utils/pdfUtils';
import { getCityServiceRegistry, canonicalizeServiceName, getPageIndexForCity } from '../../hooks/useCityServiceRegistry';

interface ExtractedPage {
  pageNumber: number;
  text: string;
  imageDataUrl: string;
  croppedImages?: string[];
  sourceId?: string;
  sourceName?: string;
}

interface QuoteItem {
  id: string;
  description: string;
  [key: string]: any;
}

interface ReferenceImagesProps {
  proposalPages?: ExtractedPage[];
  proposalPageMap?: Record<string, ExtractedPage[]>; // fileName.toLowerCase() → pages
  items?: QuoteItem[];
  terms?: string[];
  /** Render ONLY the Display Specification block (for embedding inside pdf-service-N) */
  specOnly?: boolean;
  /** Skip the Display Specification block (use in pdf-service-ref-N when specOnly is used above) */
  noSpec?: boolean;
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
  /** Multi-column table headers — used for metro-style multi-table specs */
  tableHeaders?: string[];
  /** Multi-column table rows — used for metro-style multi-table specs */
  tableRows?: string[][];
}


/**
 * Returns pages whose text contains the exact heading match.
 * Looks for section headings like "BUS FULL BRANDING", "APARTMENT LIFT BRANDING" in the PDF.
 * Uses strict matching to ensure we get the right pages.
 */
function filterPagesByCategory(pages: ExtractedPage[], category: string, cityKey?: string): ExtractedPage[] {
  console.log('🔍 Filtering pages for category:', category);

  // Strip city prefix if present e.g. "Madurai - Auto Semi Branding - Display Price"
  const cityPrefixRe = /^(chennai|madurai|coimbatore|salem|trichy|tirupur|erode|vellore|tirunelveli|bangalore|hyderabad|mumbai|delhi)\s*[-–—]\s*/i;
  const cleanCategory = category.replace(cityPrefixRe, '');
  if (cleanCategory !== category) {
    console.log('🏙️ Stripped city prefix, using:', cleanCategory);
  }
  // Use cleaned category for all subsequent matching
  category = cleanCategory;
  // Extract the service type part by removing pricing/quantity suffixes
  // Preserves sub-type qualifiers like "Underground Station", "Interior", "Non LED"
  // E.g., "Metro Branding – Underground Station - Display Price" → "Metro Branding – Underground Station"
  // E.g., "Mobile Van - Non LED Printing & Fixing Price" → "Mobile Van - Non LED"
  let serviceTypeOnly = category;
  const pricingSuffixPattern = /\b(printing\s*&?\s*fixing|display\s+price|rental\s+price|printing\s+price|fixing\s+price|design\s+price|creative\s+price|\w+\s+price|\w+\s+charge)\b/i;
  const pricingMatch = category.match(pricingSuffixPattern);
  if (pricingMatch && pricingMatch.index && pricingMatch.index > 0) {
    serviceTypeOnly = category.substring(0, pricingMatch.index).replace(/[\s\-–—&]+$/, '').trim();
    console.log('📌 Using service type (pricing suffix removed):', serviceTypeOnly);
  } else {
    // Only fall back to first-dash split if no sub-type qualifiers are present
    // Sub-type qualifiers: words like interior, underground, exterior, station,
    // variant descriptors like without/single/double/panel/light/lit/unlit, etc.
    const subTypePattern = /\b(interior|underground|exterior|station|rooftop|skyway|elevated|platform|non\s*led|led|without|single|double|triple|panel|light|lit|unlit|backlit|front.?lit)\b/i;
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
  // Also includes common OCR/PDF typos as synonyms
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
    'hoarding': ['hoardings'],
    'hoardings': ['hoarding'],
    'banner': ['banners'],
    'banners': ['banner'],
    // Vehicle / transit synonyms
    'cab': ['taxi', 'car', 'cab'],
    'taxi': ['cab', 'car', 'taxi'],
    'van': ['vehicle', 'van'],
    'mobile': ['mobile'],
    // Print / media synonyms
    'advertisement': ['ad', 'ads', 'advert', 'advertising'],
    'radio': ['fm', 'radio', 'broadcast'],
    // PDF typo corrections
    'awareness': ['awarness', 'awarenes', 'awarness'],
    'direction': ['directio', 'dirction'],
  };

  // Extract meaningful keywords, excluding pricing/quantity terms
  // IMPORTANT: sub-type differentiators like "paper", "size", "a4", "a5" MUST be kept
  // so that "NEWSPAPER INSERTION_PAPER SIZE" and "NEWSPAPER INSERTION_A4/A5" each match
  // their own specific PDF page instead of both matching the first found page.
  const allWords = serviceTypeOnly
    .toLowerCase()
    .replace(/[()]/g, ' ')  // Replace parentheses with spaces
    .split(/[\s,\-\/&_]+/)  // underscore also treated as separator (INSERTION_A4 → insertion, a4)
    .filter((w) => w.length >= 1);

  // Pricing/filler words to always discard
  const pricingWords = new Set(['rental', 'price', 'per', 'month', 'and', 'the', 'for', 'from',
    'display', 'printing', 'fixing', 'design', 'creative', 'extra', 'charge', 'rate',
    'ads']); // 'ads' is a generic suffix ("Lobby Screen Ads") that never appears in PDF headings

  // Size/unit tokens — always discard. They appear as PDF heading prefixes ("30 Sqft",
  // "33x50 cm") but are never reliable discriminators AND they cause allKeywordsInHeading
  // to fail when the PDF renders them differently ("Sq.Ft", "sq ft", "sq.ft.").
  const sizeUnitWords = new Set<string>();
  allWords.forEach((w, i) => {
    if (/^\d+$/.test(w)) { sizeUnitWords.add(w); } // bare numbers: "30"
    if (/^(sqft|sqm|sqcm|sqin|sqyd)$/.test(w)) { sizeUnitWords.add(w); } // area units
    if (/^\d+(x|×)\d+$/.test(w)) { sizeUnitWords.add(w); } // "33x50"
    // also drop the unit word immediately following a bare number (e.g. "30 sqft")
    if (i > 0 && /^\d+$/.test(allWords[i - 1]) && /^(ft|cm|mm|inch|sqft|sqm|sqcm|sqin)$/.test(w)) {
      sizeUnitWords.add(w);
    }
  });

  // Core service words — always kept regardless of length
  const coreWords = allWords.filter(w => !pricingWords.has(w) && !sizeUnitWords.has(w) && w.length >= 3);

  // Short sub-type codes (a4, a5, a3, b4, b5, etc.) — keep ONLY if there are other
  // items in the same category that would otherwise produce identical keyword sets.
  // Strategy: always include them — they are critical differentiators.
  const shortCodes = allWords.filter(w => /^[a-z]\d$/.test(w)); // e.g. a4, a5, b5

  const words = [...new Set([...coreWords, ...shortCodes])];
  
  console.log('📝 Extracted keywords:', words);
  
  if (words.length === 0) return [];
  
  // Deduplicate keywords to avoid requiring the same word multiple times
  // e.g., "Mobile Van Branding - Mobile Van - LED Branding" should only require 'mobile', 'van', 'branding', 'led' once each
  const requiredKeywords = [...new Set(words)];
  
  console.log('🔑 Required keywords for matching:', requiredKeywords);
  
  // Strategy: Build an exact heading pattern from the category
  // E.g., "Apartment Lift Branding" → /apartment\s+lift\s+branding/i
  // E.g., "Bus Full Branding" → /bus\s+full\s+branding/i
  
  // Create a flexible regex pattern from the keywords, allowing singular/plural variants
  const keywordPatternParts = words.map(w => {
    // Allow optional trailing 's' for singular/plural matching
    return `${w}s?`;
  });
  const keywordPattern = keywordPatternParts.join('\\s+');
  const exactHeadingPattern = new RegExp(keywordPattern, 'i');
  
  console.log('🎯 Exact heading pattern:', exactHeadingPattern.source);

  const matchedPages = pages.filter((page) => {
    // Clean up page text: Remove pipe characters and extra spaces that might split words
    // e.g., "li | ft" becomes "lift", "apartment li | ft branding" becomes "apartment lift branding"
    const rawPageText = page.text
      .toLowerCase()
      .replace(/\s*\|\s*/g, '') // Remove pipes and surrounding spaces
      .replace(/[()]/g, ' ')   // Replace parentheses with spaces
      .replace(/_/g, ' ')      // Split underscore-glued tokens
      .replace(/\s+/g, ' ')    // Normalize multiple spaces to single space
      .trim();

    // COMPOUND-WORD SPLIT: The PDF renderer concatenates words without spaces.
    // e.g., "NEWSPAPER INSERTION" → "newspaperinsertion", "PAPER SIZE" → "papersize"
    // Also handles PDF typos like "awarness" for "awareness", "awarnessdirectio" etc.
    // For each required keyword (and its known typo variants), if it appears at the START
    // of a compound token, insert a space AFTER it so downstream matching works correctly.
    const typoVariants: Record<string, string[]> = {
      'awareness': ['awarness', 'awarenes'],
      'direction': ['directio', 'dirction'],
    };
    let pageText = rawPageText;
    for (const kw of requiredKeywords) {
      const variants = [kw, ...(typoVariants[kw] || [])];
      for (const variant of variants) {
        const escV = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Insert space AFTER variant when it starts a compound word (not preceded by a letter)
        pageText = pageText.replace(new RegExp('(?<![a-z])(' + escV + ')(?=[a-z])', 'g'), '$1 ');
        pageText = pageText.replace(/\s+/g, ' ').trim();
      }
    }

    console.log(`🔍 Checking Page ${page.pageNumber} for keywords: [${requiredKeywords.join(', ')}]`);
    
    // EXCLUDE pricing summary pages (they contain pricing tables, not reference images)
    // Detect currency symbols/patterns that indicate pricing content
    const hasCurrencyPatterns = (pageText.match(/₹|rs\.?\s*[\d,]+|[\d,]+\.00/g) || []).length >= 3;
    const hasPricingColumns = (pageText.includes('unit price') || pageText.includes('unit of measure') || 
                               pageText.includes('price per') || pageText.includes('campaign'));
    const hasQuantityColumns = pageText.includes('quantity') || pageText.includes('min.') || pageText.includes('min ');
    // NOTE: 'rate card' alone is NOT enough to block — newspaper insertion PDFs are themselves
    // rate cards, so every page would be blocked. Only block when combined with pricing signals.
    const isPricingSummary = pageText.includes('pricing summary') || 
                            pageText.includes('price list') ||
                            (pageText.includes('rate card') && hasCurrencyPatterns && (hasPricingColumns || hasQuantityColumns)) ||
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
      // Use word-boundary regex as primary check so 'paper' does NOT match inside 'newspaper'
      const wbRegex = new RegExp('(?<![a-z0-9])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])', 'i');
      if (wbRegex.test(text)) return true;
      
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
        if (!['busines', 'congres', 'proces'].includes(withoutS)) {
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
      // Use word-boundary regex so 'paper' does NOT match inside 'newspaper'
      const wbRegex = new RegExp('(?<![a-z0-9])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])', 'i');
      if (wbRegex.test(pageText)) return true;
      
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
        if (!['busines', 'congres', 'proces'].includes(withoutS)) {
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
    
    // RELAXED MATCHING: If strict match fails, try matching with at least 85% of keywords
    // This handles cases where keyword naming differs slightly from PDF headings.
    // Threshold raised from 75% to 85% to prevent sub-type cross-matching
    // (e.g. "paper" from "PAPER SIZE" must not cause A4/A5 page to match at 75%).
    const matchedCount = requiredKeywords.filter(kw => keywordFoundInText(kw, pageText)).length;
    const matchRatio = matchedCount / requiredKeywords.length;
    
    // Negation words like "non" are critical differentiators — they MUST be present
    // Without "non", "LED" vs "Non LED" would be indistinguishable.
    // Sub-type size codes (a4, a5, paper, size) are also critical differentiators.
    const negationWords = ['non', 'not', 'without', 'no'];
    const sizeCodePattern = /^([a-z]\d|paper|size)$/;
    const criticalKeywords = requiredKeywords.filter(kw => negationWords.includes(kw) || sizeCodePattern.test(kw));
    const hasMissingCritical = criticalKeywords.some(kw => !keywordFoundInText(kw, pageText));
    
    const hasRelaxedMatch = !hasAllKeywords && matchRatio >= 0.85 && matchedCount >= 2 && !hasMissingCritical;
    
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
    
    // STRICT HEADING CHECK FIRST: PDF reference pages have the service name at the very top
    // (e.g. "AUTO BACK STICKERS (2/3)" or "AUTO SEMI BRANDING (2/3)").
    // Reject pages whose first ~120 chars (the heading area) don't contain all keywords.
    // This MUST run before the reference-image-page priority check, otherwise pages with
    // generic markers like "DESIGN SPECIFICATIONS" / "DISPLAY AREA" (present on every spec page)
    // would be wrongly accepted regardless of what service they actually depict.
    const headingArea = pageText.substring(0, 120);
    // guardHeadingArea: only the PRIMARY service heading, before any navigation pipe (|).
    // PDF pages often render navigation links like "← TRAFFIC AWARENESS BOARD | DIRECTION BOARD →"
    // in the first 120 chars. Using the full headingArea for conflict guards causes false
    // self-rejections (the correct page sees the neighbouring service name in its nav bar).
    const guardHeadingArea = headingArea.split('|')[0].trim();

    // ════════════ DEBUG: dump what the guards actually see ════════════
    console.group(`🔬 [DEBUG] Page ${page.pageNumber} guard inputs`);
    console.log('  pageText[0..120]  (pipe-stripped):', JSON.stringify(headingArea));
    console.log('  guardHeadingArea  (after split|[0]):', JSON.stringify(guardHeadingArea));
    console.log('  raw page.text[0..300]:', JSON.stringify(page.text.substring(0, 300)));
    console.groupEnd();
    // ═════════════════════════════════════════════════════════════════
    const allKeywordsInHeading = requiredKeywords.every(kw => {
      if (headingArea.includes(kw)) return true;
      if (kw.endsWith('s') && kw.length > 4 && headingArea.includes(kw.slice(0, -1))) return true;
      if (!kw.endsWith('s') && headingArea.includes(kw + 's')) return true;
      // Synonym-aware fallback — fixes pages where the PDF heading uses a misspelled
      // variant (e.g. "awarness" instead of "awareness") which the strict includes()
      // would otherwise reject before the proximity check ever runs.
      const synonyms = synonymMap[kw];
      if (synonyms) {
        for (const syn of synonyms) {
          if (headingArea.includes(syn)) return true;
        }
      }
      return false;
    });
    if (!allKeywordsInHeading) {
      console.warn(`❌ [HEADING-REJECT] Page ${page.pageNumber}`);
      console.warn('   headingArea (pipe-stripped):', JSON.stringify(headingArea));
      console.warn('   raw page.text[0..300]:', JSON.stringify(page.text.substring(0, 300)));
      console.warn('   requiredKeywords:', requiredKeywords);
      return false;
    }

    // CONFLICT GUARD: Dynamically compute sibling-discriminator exclusions from the registry.
    // A "sibling" is a service that shares ≥2 NON-GENERIC tokens with the current query.
    // Generic tokens (branding, board, advertisement) are so common they don't uniquely
    // identify a sibling relationship — excluding them prevents false positives like
    // "auto semi branding" being treated as a sibling of "bus semi branding" just
    // because they share "semi" + "branding".
    // Falls back to hardcoded pairs when registry is not yet loaded (safe silent fallback).
    const GENERIC_TOKENS = new Set(['branding', 'board', 'advertisement', 'advertising']);
    const registryConflictFound = (() => {
      const registry = cityKey ? getCityServiceRegistry().get(cityKey) : null;
      if (!registry || registry.status !== 'ready') {
        console.log(`⚠️ [ConflictGuard] Registry not ready for "${cityKey}" — using static fallback`);
        return false;
      }
      const queryTokens = new Set(requiredKeywords);
      const queryNonGeneric = requiredKeywords.filter(t => !GENERIC_TOKENS.has(t));
      console.log(`🛡️ [ConflictGuard] Page ${page.pageNumber} | query non-generic tokens: [${queryNonGeneric.join(', ')}] | guardHeading: "${guardHeadingArea.substring(0, 60)}"`);
      for (const entry of Object.values(registry.entries)) {
        const siblingTokens = entry.canonicalName.split(/\s+/).filter(Boolean);
        const siblingNonGeneric = siblingTokens.filter(t => !GENERIC_TOKENS.has(t));
        // Normalize plural/singular before comparing so "sticker" ≅ "stickers" are treated
        // as the same token — prevents the registry singular from appearing in siblingUnique
        // and causing a self-rejection on the correct page.
        const normalize = (t: string) => t.endsWith('s') && t.length > 4 ? t.slice(0, -1) : t;
        const normalizedQueryTokens = new Set([...queryTokens].map(normalize));
        const sharedNonGeneric = siblingNonGeneric.filter(t => normalizedQueryTokens.has(normalize(t)));
        // Only consider true siblings: share ≥2 non-generic tokens but differ in at least 1
        if (sharedNonGeneric.length < 2) continue;
        const siblingUnique = siblingNonGeneric.filter(t => !normalizedQueryTokens.has(normalize(t)));
        if (siblingUnique.length === 0) continue; // same service, skip
        // Use word-boundary regex so "sticker" does NOT match inside "stickers" and vice versa
        const conflictingToken = siblingUnique.find(t => {
          const wbRe = new RegExp('(?<![a-z0-9])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])', 'i');
          return wbRe.test(guardHeadingArea);
        });
        if (conflictingToken) {
          console.warn(`❌ [CONFLICT-GUARD] Page ${page.pageNumber} — sibling "${entry.canonicalName}" discriminator "${conflictingToken}" found in guardHeading`);
          console.warn('   guardHeadingArea:', JSON.stringify(guardHeadingArea));
          console.warn('   raw page.text[0..300]:', JSON.stringify(page.text.substring(0, 300)));
          return true;
        }
        console.log(`  ℹ️ [ConflictGuard] Sibling "${entry.canonicalName}" | unique: [${siblingUnique.join(', ')}] | not in guardHeading ✓`);
      }
      return false;
    })();

    if (registryConflictFound) return false;

    // STATIC CONFLICT GUARD (fallback when registry not yet loaded):
    // Hardcoded pairs for the known Chennai PDF conflicts.
    const conflictGuards: Array<{ requiredAll: string[]; excludeIfHeadingHas: string[] }> = [
      { requiredAll: ['sun', 'pack'],    excludeIfHeadingHas: ['dye', 'cutting'] },
      { requiredAll: ['dye', 'cutting'], excludeIfHeadingHas: ['sun', 'pack'] },
      { requiredAll: ['awareness'],      excludeIfHeadingHas: ['direction'] },
      { requiredAll: ['direction'],      excludeIfHeadingHas: ['awareness'] },
      { requiredAll: ['printing'],       excludeIfHeadingHas: ['distribution'] },
      { requiredAll: ['distribution'],   excludeIfHeadingHas: ['printing'] },
    ];
    for (const guard of conflictGuards) {
      const guardApplies = guard.requiredAll.every(t => requiredKeywords.includes(t));
      if (guardApplies) {
        const conflictFound = guard.excludeIfHeadingHas.some(excl => guardHeadingArea.includes(excl));
        if (conflictFound) {
          console.warn(`❌ [STATIC-CONFLICT] Page ${page.pageNumber} - guardHeading contains conflicting keyword for [${guard.excludeIfHeadingHas.join(', ')}]`);
          console.warn('   guardHeadingArea:', JSON.stringify(guardHeadingArea));
          console.warn('   raw page.text[0..300]:', JSON.stringify(page.text.substring(0, 300)));
          return false;
        }
      }
    }

    // Check if the service heading phrase appears on this page (also try plural variant)
    const hasHeading = exactHeadingPattern.test(pageText) ||
      new RegExp(words.join('\\s+') + 's?', 'i').test(pageText);

    // SLIDING WINDOW: find the tightest cluster of all keywords across all their occurrences.
    // Collects every position where each keyword (or plural/singular variant) appears,
    // then picks the combination with the smallest span.
    // This prevents nav-button occurrences at the top of the page from poisoning the distance.
    const allOccurrences: number[][] = requiredKeywords.map(kw => {
      const positions: number[] = [];
      // Include the keyword itself, plural/singular variants, and any known synonyms/typos
      const variants = [
        kw,
        kw + 's',
        kw.endsWith('s') ? kw.slice(0, -1) : null,
        ...(synonymMap[kw] || []),
      ].filter(Boolean) as string[];
      for (const v of variants) {
        // Use word-boundary search: find positions where v appears as a standalone word
        // This prevents 'paper' from matching the position inside 'newspaper'
        const variantRegex = new RegExp('(?<![a-z0-9])' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])', 'gi');
        let match: RegExpExecArray | null;
        while ((match = variantRegex.exec(pageText)) !== null) {
          positions.push(match.index);
        }
      }
      return [...new Set(positions)].sort((a, b) => a - b);
    });
    const allKeywordsLocated = allOccurrences.every(occ => occ.length > 0);

    // Find minimum span across all position combinations (greedy: fix first keyword occurrence,
    // pick nearest occurrence of each subsequent keyword)
    let minSpan = Infinity;
    if (allKeywordsLocated) {
      for (const startPos of allOccurrences[0]) {
        let span = 0;
        let maxPos = startPos;
        let minPos = startPos;
        let valid = true;
        for (let i = 1; i < allOccurrences.length; i++) {
          // Pick the occurrence of this keyword closest to the current window center
          const center = (maxPos + minPos) / 2;
          const closest = allOccurrences[i].reduce((best, pos) =>
            Math.abs(pos - center) < Math.abs(best - center) ? pos : best
          );
          maxPos = Math.max(maxPos, closest);
          minPos = Math.min(minPos, closest);
          span = maxPos - minPos;
          if (span > 200) { valid = false; break; } // early exit if already too spread
        }
        if (valid && span < minSpan) minSpan = span;
      }
    }
    const keywordsAreClose = allKeywordsLocated && minSpan <= 120;
    console.log(`📏 Page ${page.pageNumber} - keyword cluster min span: ${minSpan}, close: ${keywordsAreClose}`);

    // NEGATION GUARD: If the query does NOT include a negation word (non/no/without),
    // but the page heading contains a negation word immediately before one of the required
    // keywords, reject the page.
    // e.g. query "Mobile Van LED" must not match page heading "Mobile Van Non LED".
    // 'no' is intentionally excluded: it is a product name component ("No Parking", "No Entry"),
    // not a variant qualifier. Only 'non' reliably signals product variants ("Non LED", "Non-lit").
    const queryHasNegation = requiredKeywords.some(kw => ['non', 'without', 'not'].includes(kw));
    if (!queryHasNegation && (hasHeading || keywordsAreClose)) {
      // Use the tightest cluster window for negation checking
      const clusterPositions = allKeywordsLocated
        ? allOccurrences.map(occ => occ[0])
        : [];
      const windowStart = clusterPositions.length > 0 ? Math.max(0, Math.min(...clusterPositions) - 10) : 0;
      const windowEnd   = clusterPositions.length > 0 ? Math.min(pageText.length, Math.max(...clusterPositions) + 30) : 150;
      const headingWindow = pageText.substring(windowStart, windowEnd);
      // Check if any negation word precedes a required keyword in that window
      // 'no' excluded — it is part of product names ("No Parking"), not a variant negator.
      // ── DEBUG ──
      console.log(`🔬 [NEGATION-CHECK] Page ${page.pageNumber} headingWindow: ${JSON.stringify(headingWindow)}`);
      const negationPattern = /\b(non|without|not)\s+\w+/g;
      let negMatch: RegExpExecArray | null;
      while ((negMatch = negationPattern.exec(headingWindow)) !== null) {
        const wordAfterNeg = negMatch[0].split(/\s+/)[1];
        if (requiredKeywords.some(kw => wordAfterNeg.startsWith(kw.substring(0, 3)))) {
          console.warn(`❌ [NEGATION-REJECT] Page ${page.pageNumber} - matched "${negMatch[0]}" in headingWindow`);
          console.warn('   headingWindow:', JSON.stringify(headingWindow));
          console.warn('   windowStart:', windowStart, 'windowEnd:', windowEnd);
          console.warn('   clusterPositions:', clusterPositions);
          console.warn('   raw page.text[0..400]:', JSON.stringify(page.text.substring(0, 400)));
          return false;
        }
      }
    }

    // PRIORITY 1: Reference/spec page AND the service heading is present on the same page.
    // Both conditions are REQUIRED — prevents accepting another product's ref page that
    // happens to contain scattered keywords (e.g. "auto" in title, "back" in spec, "sticker" in material).
    // (only reached when heading already matches the required service)
    const isReferenceImagePage = pageText.includes('reference image') || 
                                pageText.includes('reference images') ||
                                pageText.includes('sample image') ||
                                pageText.includes('display area') ||
                                pageText.includes('design specification') ||
                                // Newspaper insertion specific headings
                                pageText.includes('ad specification') ||
                                pageText.includes('creative specification') ||
                                pageText.includes('size specification') ||
                                pageText.includes('ad visual') ||
                                pageText.includes('sample ad') ||
                                pageText.includes('newspaper sample') ||
                                pageText.includes('col. cm') ||
                                pageText.includes('col cm') ||
                                pageText.includes('column size') ||
                                pageText.includes('column cm') ||
                                pageText.includes('ad size') ||
                                pageText.includes('creative size');
    
    if (isReferenceImagePage && (hasHeading || keywordsAreClose)) {
      console.log(`✅ Page ${page.pageNumber} - REFERENCE IMAGE page with heading match!`);
      return true;
    }

    // PRIORITY 2: Exact heading phrase found on page
    if (hasHeading) {
      console.log(`✅ Page ${page.pageNumber} - EXACT heading match found!`);
      return true;
    }
    
    // Also accept if keywords appear within 60 characters of each other (flexible heading match)
    // Tight window prevents false positives where keywords appear scattered across the page
    // e.g. "auto" in heading + "back" in navigation + "stickers" via fuzzy ≠ "auto back stickers"
    const keywordPositions = requiredKeywords.map(kw => {
      // indexOf for exact, otherwise try synonym/variation positions
      let pos = pageText.indexOf(kw);
      if (pos === -1 && !kw.endsWith('s')) pos = pageText.indexOf(kw + 's');
      if (pos === -1 && kw.endsWith('s')) pos = pageText.indexOf(kw.slice(0, -1));
      // Synonym-aware position lookup — fixes pages where the PDF uses a misspelled
      // variant (e.g. "awarness") so the proximity check no longer silently drops
      // the keyword and skip itself when the synonym map already knows the variant.
      if (pos === -1) {
        const synonyms = synonymMap[kw];
        if (synonyms) {
          for (const syn of synonyms) {
            const sp = pageText.indexOf(syn);
            if (sp !== -1) { pos = sp; break; }
          }
        }
      }
      return pos;
    }).filter(pos => pos >= 0);
    if (keywordPositions.length === requiredKeywords.length) {
      const firstPos = Math.min(...keywordPositions);
      const lastPos = Math.max(...keywordPositions);
      const distance = lastPos - firstPos;
      
      if (distance <= 60) {
        console.log(`✅ Page ${page.pageNumber} - Keywords appear close together (distance: ${distance})`);
        return true;
      } else {
        console.log(`❌ Page ${page.pageNumber} - Keywords too far apart (distance: ${distance}), likely scattered`);
      }
    }
    

    // PRIORITY 3: Keywords appear within 100 characters of each other (flexible heading match)
    if (keywordsAreClose) {
      console.log(`✅ Page ${page.pageNumber} - Keywords appear close together`);
      return true;
    }

    // REJECT: keywords are scattered across different sections of the page (e.g. service name
    // in heading, "back" in size spec, "sticker" in material field) — high false-positive risk.
    console.log(`⚠️ Page ${page.pageNumber} - Keywords too scattered, rejecting to avoid wrong product match`);
    return false;
  });
  
  console.log(`📊 Found ${matchedPages.length} matching pages for "${category}"`);
  
  // POST-PROCESSING: Look for reference image pages adjacent to keyword matches
  // E.g., if page 32 has keywords but page 33 is reference image, include page 33
  const pageNumbersToInclude = new Set<number>();
  
  matchedPages.forEach((page) => {
    const pageText = page.text.toLowerCase().replace(/\s*\|\s*/g, '').replace(/\s+/g, ' ');
    
    // Check if this page has (1/X) pattern - normally a pricing-summary page we skip.
    // EXCEPTION: some proposals put SPECIFICATION on the same page as the pricing
    // (e.g. BaleenMedia LED Hoardings 1/3 has DISPLAY PRICE + SPECIFICATION together).
    // Keep it so spec text / spec image can be extracted.
    const hasFirstPagePattern = pageText.match(/\(1\/\d+\)/);
    if (hasFirstPagePattern) {
      const hasSpecOnFirstPage = pageText.includes('specification') ||
                                 pageText.includes('design spec') ||
                                 pageText.includes('display area') ||
                                 pageText.includes('ad specification') ||
                                 pageText.includes('creative specification') ||
                                 pageText.includes('size specification') ||
                                 pageText.includes('ad size') ||
                                 pageText.includes('creative size');
      if (!hasSpecOnFirstPage) {
        console.log(`🔄 Page ${page.pageNumber} - Excluded (1/X pattern)`);
        return;
      }
      console.log(`✅ Page ${page.pageNumber} - (1/X) kept because it contains SPECIFICATION`);
      pageNumbersToInclude.add(page.pageNumber);
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
                     // Newspaper insertion specific headings
                     pageText.includes('ad specification') ||
                     pageText.includes('creative specification') ||
                     pageText.includes('size specification') ||
                     pageText.includes('ad visual') ||
                     pageText.includes('sample ad') ||
                     pageText.includes('newspaper sample') ||
                     pageText.includes('col. cm') ||
                     pageText.includes('col cm') ||
                     pageText.includes('column size') ||
                     pageText.includes('ad size') ||
                     pageText.includes('creative size') ||
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
                           // Newspaper insertion specific headings
                           nextText.includes('ad specification') ||
                           nextText.includes('creative specification') ||
                           nextText.includes('size specification') ||
                           nextText.includes('ad visual') ||
                           nextText.includes('sample ad') ||
                           nextText.includes('newspaper sample') ||
                           nextText.includes('col. cm') ||
                           nextText.includes('col cm') ||
                           nextText.includes('column size') ||
                           nextText.includes('ad size') ||
                           nextText.includes('creative size') ||
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
  const pricingSuffixPattern = /\s*[-–—]\s*\b(display\s+price|rental\s+price|printing\s+price|fixing\s+price|design\s+price|creative\s+price|printing\s*&?\s*fixing\s*price?|per\s+month|rate|price|\w+\s+price|\w+\s+charge)\b.*$/i;
  const seen = new Set<string>();

  const results: string[] = [];

  // Known city names to strip from multi-city description prefixes
  // e.g. "Madurai - Auto Semi Branding - Display Price" → "Auto Semi Branding - Display Price"
  const cityPrefixPattern = /^(chennai|madurai|coimbatore|salem|trichy|tirupur|erode|vellore|tirunelveli|bangalore|hyderabad|mumbai|delhi)\s*[-–—]\s*/i;

  for (const item of items) {
    // Strip city prefix if present before processing
    const rawDesc = item.description.replace(cityPrefixPattern, '');
    const desc = rawDesc;
    
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
        lower.includes('advertisement') ||
        lower.includes('screen') ||
        lower.includes('lobby') ||
        lower.includes('hoarding') ||
        lower.includes('board') ||
        lower.includes('sticker') ||
        lower.includes('banner') ||
        lower.includes('poster') ||
        lower.includes('flex') ||
        lower.includes('standee') ||
        lower.includes('display') ||
        lower.includes('newspaper') ||
        lower.includes('insertion') ||
        lower.includes('pamphlet') ||
        lower.includes('leaflet') ||
        lower.includes('flyer') ||
        lower.includes('classified') ||
        lower.includes('distribution') ||
        lower.includes('barricade') ||
        lower.includes('awareness') ||
        lower.includes('direction') ||
        lower.includes('mobile') ||
        lower.includes('van') ||
        lower.includes('cab') ||
        lower.includes('taxi') ||
        lower.includes('radio') ||
        lower.includes('metro') ||
        lower.includes('lamp') ||
        lower.includes('hoardings')) {
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
            bdLower.includes('advertisement') ||
            bdLower.includes('screen') || bdLower.includes('lobby') ||
            bdLower.includes('sticker') || bdLower.includes('banner') ||
            bdLower.includes('poster') || bdLower.includes('flex') ||
            bdLower.includes('standee') || bdLower.includes('display') ||
            bdLower.includes('newspaper') || bdLower.includes('insertion') ||
            bdLower.includes('pamphlet') || bdLower.includes('leaflet') ||
            bdLower.includes('flyer') || bdLower.includes('classified') ||
            bdLower.includes('mobile') || bdLower.includes('van') ||
            bdLower.includes('cab') || bdLower.includes('taxi') ||
            bdLower.includes('radio') || bdLower.includes('metro') ||
            bdLower.includes('lamp') || bdLower.includes('board')) {
          extracted = beforeDash;
        }
      }
    }
    
    if (!extracted) {
      const brandingMatch = desc.match(/([a-z\s]+branding)/i);
      if (brandingMatch) extracted = brandingMatch[1].trim();
    }
    
    if (!extracted) {
      // Capture vehicle + qualifier + optional trailing noun (e.g. "Auto Back Stickers", "Bus Semi Panel Branding", "Mobile Van LED")
      const vehicleMatch = desc.match(/(bus|auto|mobile|van|cab|taxi|tempo|apartment|building|lift|elevator|residential|commercial)\s+(full|semi|back|panel|shelter|rickshaw|branding|led|non|van)(\s+[a-z]+)*/i);
      if (vehicleMatch) extracted = vehicleMatch[0].trim();
    }

    if (!extracted) {
      // Newspaper / print media keywords
      const printMatch = desc.match(/(newspaper|insertion|pamphlet|leaflet|flyer|handbill|classified|display\s+ad|print\s+ad)(\s+[a-z]+)*/i);
      if (printMatch) extracted = printMatch[0].trim();
    }

    // Final fallback: use the full pricing-suffix-stripped service type
    if (!extracted && serviceType.length > 0) {
      extracted = serviceType;
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

  // Derive city key from item descriptions so it can be forwarded to filterPagesByCategory
  const cityKey = extractCityFromItems(items) ?? undefined;
  
  const matchedPages = new Set<number>();
  
  // Extract ALL unique service types from quote items
  const serviceTypes = extractAllServiceTypes(items);
  
  if (serviceTypes.length > 0) {
    console.log(`🎯 Detected ${serviceTypes.length} service type(s):`, serviceTypes);
    
    // Loop through EACH service type and collect pages
    for (const serviceType of serviceTypes) {
      // ── FAST PATH: direct page-index lookup — exact, deterministic, no fuzzy matching ──
      // The index is built once from PDF pageImages using (N/M) page markers.
      // If a hit is found, use those page numbers directly and skip the 300-line keyword scan.
      if (cityKey) {
        const pageIndexMap = getPageIndexForCity(cityKey);
        if (pageIndexMap) {
          // Gemini descriptions often duplicate the service name:
          //   "30 Sqft Flex Banner - 30 Sqft FLEX BANNER"
          //   "Direction Board - DIRECTION BOARD"
          //   "Pamphlet Printing A5 - PAMPHLET PRINTING_ A5"
          // canonicalizeServiceName of the full string produces a doubled key that
          // never matches the registry. Fix: try each " - " segment individually so
          // we find the segment whose canonical matches the registry key.
          // The underscore in "PAMPHLET PRINTING_ A5" is preserved by normalizeSvc
          // and is part of the registry key — trying the ALLCAPS segment finds it.
          const segments = serviceType.split(/\s+-\s+/);
          let indexedNums: number[] | undefined;
          let matchedCanonical = '';
          for (const seg of segments) {
            const c = canonicalizeServiceName(seg.trim());
            if (pageIndexMap[c] && pageIndexMap[c].length > 0) {
              indexedNums = pageIndexMap[c];
              matchedCanonical = c;
              break;
            }
          }
          if (indexedNums && indexedNums.length > 0) {
            console.log(`📇 [PageIndex] Direct hit: "${matchedCanonical}" → pages [${indexedNums.join(', ')}]`);
            indexedNums.forEach(n => matchedPages.add(n));
            continue; // skip keyword scan entirely
          }
          console.log(`📇 [PageIndex] Miss for "${serviceType}" — falling back to keyword scan`);
        }
      }

      console.group(`🔍 [ReferenceImages] Searching pages for: "${serviceType}" | city: "${cityKey ?? 'unknown'}"`);
      const matchingPages = filterPagesByCategory(pages, serviceType, cityKey);
      console.groupEnd();
      
      if (matchingPages.length > 0) {
        console.log(`📊 Found ${matchingPages.length} pages matching "${serviceType}"`);
        // DEBUG: dump first 250 chars of each matched page so we can see what's actually on it
        matchingPages.forEach(p => {
          console.log(`   📄 Page ${p.pageNumber} text:`, p.text.replace(/\s+/g, ' ').substring(0, 250));
        });
        
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

    // BASE-TYPE FALLBACK: If no pages matched the full specific service type
    // (e.g. "Bus Shelter - Single Panel - Without Light" found nothing),
    // retry using only the base type (everything before the first " - ").
    // This ensures generic reference images still appear when the PDF has no
    // variant-specific page, while the negation guard prevents showing
    // contradictory content (e.g. "With Light" page for a "Without Light" item).
    if (matchedPages.size === 0) {
      for (const serviceType of serviceTypes) {
        const dashIdx = serviceType.indexOf(' - ');
        if (dashIdx <= 0) continue; // no variant suffix to strip
        const baseType = serviceType.substring(0, dashIdx).trim();
        console.log(`🔄 Variant fallback: trying base type "${baseType}" for "${serviceType}"`);
        const fallbackPages = filterPagesByCategory(pages, baseType, cityKey);
        if (fallbackPages.length > 0) {
          console.log(`✅ Variant fallback: found ${fallbackPages.length} pages for base type "${baseType}"`);
          const queryLower = serviceType.toLowerCase();
          const wantsWithout = /\bwithout\b/.test(queryLower);
          const wantsWith = /\bwith\s+(light|illumination)\b|\bbacklit\b/.test(queryLower);
          fallbackPages
            .filter(p => {
              const pt = p.text.toLowerCase().replace(/\s*\|\s*/g, '').replace(/\s+/g, ' ');
              // Skip page that explicitly describes the opposite variant
              if (wantsWithout && /\bwith\s+light\b|\bbacklit\b|\bfront.?lit\b|\bwith\s+illumination\b/.test(pt)) return false;
              if (wantsWith && /\bwithout\s+light\b|\bunlit\b/.test(pt)) return false;
              return true;
            })
            .forEach(p => matchedPages.add(p.pageNumber));
        }
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
    const matchingPages = filterPagesByCategory(pages, item.description, cityKey);
    
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

/**
 * Merges pipe-split parts for dimension/header values that were split by the PDF extractor.
 * e.g. ["Size in Inches", "(", "W x H", ")"] → ["Size in Inches ( W x H )"]
 */
function mergePipeParts(parts: string[]): string[] {
  const merged: string[] = [];
  for (const p of parts) {
    const isContinuation =
      merged.length > 0 &&
      (/^\(/.test(p) || /^(wxh|w\s*x\s*h|wdh|inches|cms?|mm)\b/i.test(p) || /^\)/.test(p));
    if (isContinuation) {
      merged[merged.length - 1] = merged[merged.length - 1] + ' ' + p;
    } else {
      merged.push(p);
    }
  }
  return merged;
}

/**
 * Detects and parses metro train inside branding design spec.
 * Activated when the spec section contains coach group headings (Coach-1, Coach-2, …).
 * Returns null if this is not a metro multi-table spec (falls back to generic parser).
 */
function extractMetroMultiTableSpec(specSection: string): SpecGroup[] | null {
  const lines = specSection.split('\n').map(l => l.trim()).filter(Boolean);
  // Only activate if there is at least one coach heading line
  const COACH_RE = /^coach[-\s]*\d/i;
  if (!lines.some(l => COACH_RE.test(l))) return null;

  const groups: SpecGroup[] = [];
  let currentHeading: string | null = null;
  let currentHeaders: string[] = [];
  let currentRows: string[][] = [];
  // Tracks a single-part line that may be the first half of a multi-line cell label
  // (e.g. "Driver Door -" before "Sticker | 23.5 x 56 | 1" on the next line)
  let pendingLabel: string | null = null;
  // After a data row is pushed, a plain-text single-part line may be a continuation
  // of that row's first cell (e.g. "Sticker" appearing after "Driver Door - | 23.5 x 56 | 1")
  let lastWasDataRow = false;
  // Set when "Card Material Area" header is encountered — skip the immediately following
  // dimensions value line (e.g. "18.75 x 12.75 | 17.75 x 11.75") that belongs to it
  let skipNextDataRow = false;

  const flushGroup = () => {
    if (currentRows.length > 0) {
      // Auto-expand headers when data rows have more columns than detected headers
      // (happens when the SIZE column header lands on a separate line in PDF extraction)
      const maxCols = Math.max(...currentRows.map(r => r.length));
      const headers = [...currentHeaders];
      if (headers.length > 0 && headers.length < maxCols) {
        const lastHeader = headers.pop()!;
        while (headers.length < maxCols - 1) {
          headers.push('Size (Inches)');
        }
        headers.push(lastHeader);
      }
      groups.push({
        heading: currentHeading,
        fields: [],
        tableHeaders: headers.length > 0 ? headers : undefined,
        tableRows: [...currentRows],
      });
    }
    currentHeading = null;
    currentHeaders = [];
    currentRows = [];
    pendingLabel = null;
    lastWasDataRow = false;
    skipNextDataRow = false;
  };

  for (const line of lines) {
    const parts = line.split(/\t\|\t|\s\|\s|\|/).map(p => p.trim()).filter(p => p.length > 0);

    // Coach heading (Coach-1, Coach-2 Ladies Coach, etc.)
    if (COACH_RE.test(line)) {
      pendingLabel = null;
      lastWasDataRow = false;
      skipNextDataRow = false;
      flushGroup();
      currentHeading = line;
      continue;
    }

    // Summary heading (Interior Train Dimensions…)
    if (/interior\s+train\s+dim/i.test(line) && parts.length === 1) {
      pendingLabel = null;
      lastWasDataRow = false;
      skipNextDataRow = false;
      flushGroup();
      currentHeading = line;
      continue;
    }

    // "Card Material Area | Card Display Area" header line: flush the current summary group
    // and start a new mini 2-column group so it renders as its own table block
    if (/card\s+material\s+area/i.test(line)) {
      pendingLabel = null;
      lastWasDataRow = false;
      flushGroup();
      // The parts of this line become column headers (e.g. ["Card Material Area", "Card Display Area"])
      currentHeaders = parts.length >= 2 ? [...parts] : [line];
      currentHeading = null;
      skipNextDataRow = false; // next multi-part line is the value row — keep it
      continue;
    }

    // Skip orphaned "Card Display Area" if it somehow arrives on its own line
    if (/^\s*card\s+display\s+area\s*$/i.test(line)) {
      pendingLabel = null;
      lastWasDataRow = false;
      continue;
    }

    // Skip the dimension value row that follows "Card Material Area" only when flagged
    // (flag is no longer set for card material area — kept for any future use)
    if (skipNextDataRow && parts.length >= 2) {
      skipNextDataRow = false;
      lastWasDataRow = false;
      continue;
    }
    skipNextDataRow = false;

    // "Total Media" row: keep it in the summary group (Interior Train Dimensions),
    // skip it in coach groups where it would just repeat the per-coach sub-total
    const isCoachGroup = currentHeading ? COACH_RE.test(currentHeading) : false;
    if (isCoachGroup && parts.length > 0 && /^total\s+media/i.test(parts[0])) {
      pendingLabel = null;
      lastWasDataRow = false;
      continue;
    }

    if (line.length < 2) continue;

    // Column header row: first part matches "type of media" / "material" / generic header
    if (
      parts.length >= 2 &&
      /^(type\s*of\s*media|material|description|item)/i.test(parts[0])
    ) {
      currentHeaders = mergePipeParts(parts);
      pendingLabel = null;
      lastWasDataRow = false;
      continue;
    }

    // Orphaned SIZE column header: "size...inches" on its own line after main headers
    // (PDF splits "Type of Media | Qty" onto one line, SIZE header onto the next)
    if (
      parts.length === 1 &&
      currentHeaders.length > 0 &&
      currentRows.length === 0 &&
      /size.+inch/i.test(line)
    ) {
      // Insert as second-to-last column header (before Qty)
      const lastHeader = currentHeaders.pop()!;
      currentHeaders.push(line, lastHeader);
      lastWasDataRow = false;
      continue;
    }

    // Data rows: 2+ pipe-separated parts
    if (parts.length >= 2) {
      let row = mergePipeParts(parts);
      // If there's a pending label and the row is short (missing the TYPE OF MEDIA column),
      // prepend the pending label — handles "Driver Door -\nSticker | 23.5 x 56 | 1" cells
      if (pendingLabel !== null && row.length < 3) {
        row = [pendingLabel, ...row];
      }
      pendingLabel = null;
      // "Total Media" rows lose their leading empty cell during PDF extraction
      // (e.g. "| Total Media | 79" → ["Total Media", "79"]).  Left-pad to 3 cols
      // so "79" lands in the QTY column, not the SIZE column.
      if (/^total\s+media/i.test(row[0])) {
        while (row.length < 3) row = ['', ...row];
      }
      currentRows.push(row);
      lastWasDataRow = true;
      continue;
    }

    // Single-part line handling
    if (parts.length === 1) {
      // Post-row continuation: the PDF emits the data row first, then the second visual line
      // of a wrapped cell on the next text line (e.g. "Driver Door - | 23.5x56 | 1" then "Sticker").
      // Append to the previous row's first cell as long as:
      //  - it looks like plain text (no leading digit)
      //  - it does NOT end with '-' (a trailing dash means it's the START of a new multi-line
      //    label such as "Driver Door -", not a continuation of the previous row)
      if (lastWasDataRow && currentRows.length > 0 && !/^\d/.test(line) && !line.endsWith('-')) {
        currentRows[currentRows.length - 1][0] += ' ' + line;
        // Keep lastWasDataRow true — there could be more continuation lines
        continue;
      }
      lastWasDataRow = false;
      // Pre-row label accumulation: handles "Driver Door -\nSticker\n23.5x56 | 1" ordering
      pendingLabel = pendingLabel ? pendingLabel + ' ' + line : line;
    }
  }

  flushGroup();
  return groups.length > 0 ? groups : null;
}

function extractDesignSpecFields(pages: ExtractedPage[]): SpecGroup[] {
  for (const page of pages) {
    const text = page.text;
    const specMatch = text.match(/display area[^\n]*design spec[^\n]*/i)
                   || text.match(/design\s*spec[^\n]*/i)
                   || text.match(/display\s*area[^\n]*/i)
                   || text.match(/specification[^\n]*/i)
                   // Newspaper insertion specific spec headings
                   || text.match(/ad\s*spec[^\n]*/i)
                   || text.match(/creative\s*spec[^\n]*/i)
                   || text.match(/size\s*spec[^\n]*/i)
                   || text.match(/col\.?\s*cm[^\n]*/i)
                   || text.match(/column\s*size[^\n]*/i)
                   || text.match(/ad\s*size[^\n]*/i)
                   || text.match(/creative\s*size[^\n]*/i);
    if (!specMatch || specMatch.index === undefined) continue;
    const afterSpec = text.substring(specMatch.index + specMatch[0].length);
    const endMatch = afterSpec.match(/\n(reference\s*image|ad\s*visual|sample\s*ad|newspaper\s*sample|customer review|click here|terms\s*&?\s*conditions?|google\s+review)/i);
    const specSection = endMatch && endMatch.index !== undefined ? afterSpec.substring(0, endMatch.index) : afterSpec;

    // ── Metro multi-table detection (coach-group style, e.g. Metro Train Inside Branding) ──
    const metroGroups = extractMetroMultiTableSpec(specSection);
    if (metroGroups) return metroGroups;
    // ────────────────────────────────────────────────────────────────────────────────────────

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

    const rawLines = specSection.split('\n').map(l => l.trim()).filter(Boolean);
    console.log('🔍 [SPEC-PARSE] Raw lines from spec section:', rawLines);
    // Pre-merge orphan label lines (PDF extractor often breaks "Operations Timing" into
    // two lines: "Operations" then "Timing : 13 hours of display") and pull continuation
    // lines into the previous value (e.g. "time between 07.00 – 23.00" belongs to the
    // previous "Operations Timing" entry).
    const lines: string[] = [];
    for (let li = 0; li < rawLines.length; li++) {
      const cur = rawLines[li];
      const next = rawLines[li + 1];
      // Orphan label merge: short word-only line (no colon, no pipe) + next line starting with colon-bearing pattern.
      // "Operations" + "Timing : 13 hours" → "Operations Timing : 13 hours"
      if (next && !cur.includes(':') && !cur.includes('|') && cur.length <= 25 &&
          /^[A-Za-z][A-Za-z.]*(\s+[A-Za-z][A-Za-z.]*){0,2}$/.test(cur) &&
          /:/.test(next)) {
        const merged = `${cur} ${next}`;
        console.log(`🔗 [ORPHAN-MERGE] "${cur}" + "${next}" → "${merged}"`);
        lines.push(merged);
        li++;
        continue;
      }
      // Continuation merge: current line has no colon-label pattern (i.e. it's not a
      // new "Label: value" entry) and previous line had a colon → append to previous
      // line's value. Allow pipes in current line (PDF often splits values like
      // "time between 07.00 | to 23.00" with tab-pipe-tab). Skip if current looks
      // like a heading (ALL CAPS) or starts with a label-colon pattern.
      const prev = lines[lines.length - 1];
      const looksLikeHeading = /^[A-Z][A-Z0-9 &\-\/]{2,}$/.test(cur);
      // Strip pipes when checking for a colon-bearing label (so "time between 07.00 | to 23.00"
      // is not treated as a new entry just because it has a pipe).
      const curStripped = cur.replace(/\s*\|\s*/g, ' ').trim();
      const isNewLabelEntry = /^[A-Za-z][A-Za-z\s.]{1,40}:\s*\S/.test(curStripped);
      if (prev && prev.includes(':') && !isNewLabelEntry && !looksLikeHeading) {
        lines[lines.length - 1] = `${prev} ${curStripped}`;
        console.log(`🔗 [CONTINUATION-MERGE] "${cur}" → appended to previous line → "${lines[lines.length - 1]}"`);
        continue;
      }
      lines.push(cur);
    }
    console.log('✅ [SPEC-PARSE] Merged lines:', lines);
    for (const line of lines) {
      // Split line on pipe separators (tab-pipe-tab, space-pipe-space, or bare pipe)
      const parts = line.split(/\t\|\t|\s\|\s|\|/).map(p => p.trim()).filter(p => p.length > 0);

      if (parts.length === 1) {
        // Single column — classify by content
        let part = parts[0];
        if (/^materials?\s*:?\s*$/i.test(part)) continue;

        // Two-column PDF layout: extractor may have concatenated left-column "Label: value"
        // with right-column "Label: value" / "Material:" onto the same physical line.
        // Detect a SECOND "Label: value" pattern starting after the first value and split.
        // e.g. "Right side: 18x18 (wxh) inches Material:" → ["Right side: 18x18 (wxh) inches", "Material:"]
        // e.g. "Back side: 44x20 (wxh) inches 3 sides: Rexine" → ["Back side: ...", "3 sides: Rexine"]
        const secondColonRe = /\s+([A-Z0-9][A-Za-z0-9 ]{1,30}):\s*/g;
        secondColonRe.lastIndex = 0;
        const firstColon = part.indexOf(':');
        if (firstColon !== -1) {
          secondColonRe.lastIndex = firstColon + 1;
          const m2 = secondColonRe.exec(part);
          if (m2 && m2.index > firstColon) {
            const leftPart = part.substring(0, m2.index).trim();
            const rightPart = part.substring(m2.index).trim();
            console.log(`✂️ [2COL-SPLIT] "${part}" → ["${leftPart}", "${rightPart}"]`);
            // Process leftPart now, push rightPart back into queue by appending a second iteration
            part = leftPart;
            // Recursively handle the right part by inlining the same logic
            const rightColon = rightPart.match(/^([^:]{1,50}):\s*(.*)$/);
            if (rightColon) {
              const rLabel = rightColon[1].trim();
              const rValue = rightColon[2].trim();
              if (rValue && !/^materials?$/i.test(rLabel)) {
                const rIsDim = /\d["'x×(]/i.test(rValue) || /\d\s+[x×]\s+\d/i.test(rValue) || /side|front|back|top|bottom|left|right|dimension|size/i.test(rLabel);
                if (rIsDim) dimensionFields.push({ label: rLabel, value: rValue });
                else materialFields.push({ label: rLabel, value: rValue });
              }
              // bare "Material:" with no value → drop, used only as section header
            }
          }
        }

        const colonMatch = part.match(/^([^:]{1,50}):\s*(.+)$/);
        if (colonMatch) {
          const label = colonMatch[1].trim();
          const value = colonMatch[2].trim();
          const isDim = /\d["'x×(]/i.test(value) || /\d\s+[x×]\s+\d/i.test(value) || /side|front|back|top|bottom|left|right|dimension|size/i.test(label);
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
        let dcLabel = dimColon[1].trim();
        let dcValue = dimColon[2].trim();
        // If the extracted value is itself an incomplete sub-label (ends with ':'),
        // the actual dimension number is in the trailing pipe columns.
        // e.g. "Size: Top Panel:" | "25.9 x 2.75" | "(wxh) FT"
        //   → label="Size", value="Top Panel: 25.9 x 2.75 (wxh) FT"
        if (/:\s*$/.test(dcValue) && dimEnd < parts.length) {
          const rest = parts.slice(dimEnd).join(' ').trim();
          dcValue = `${dcValue} ${rest}`.trim();
          dimEnd = parts.length; // mark all remaining parts as consumed
        }
        dimensionFields.push({ label: dcLabel, value: dcValue });
      }

      // Handle PDF format where label and value are in separate pipe-columns:
      // e.g. "Material:\t|\tSun Pack" → parts[0]="Material:" parts[1]="Sun Pack"
      // dimColon fails because fullDimStr="Material:" has no inline value.
      if (!dimColon && dimEnd === 1 && /:\s*$/.test(parts[0]) && parts.length >= 2) {
        const label = parts[0].replace(/:\s*$/, '').trim();
        const value = parts.slice(1).join(' ').trim();
        if (label && value) {
          const isDim = /\d["'x×(]/i.test(value) || /\d\s+[x×]\s+\d/i.test(value) || /side|front|back|top|bottom|left|right|dimension|size/i.test(label);
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

    // Post-process dimensionFields: if a field has a "container" label (Size, Dimension…)
    // whose value itself contains a sub-label colon pattern ("Top Panel: 25.9 x 2.75 (wxh) FT"),
    // promote it to a SpecGroup heading and absorb subsequent sub-panel rows into it.
    const SIZE_CONTAINER_RE = /^(size|dimensions?|display\s*size|ad\s*size|panel\s*size|creative\s*size)$/i;
    const SUB_PANEL_RE = /^(top|bottom|left|right|front|back|[a-z]+\s+panel|[a-z]+\s+side|[a-z]+\s+face)/i;

    const containerIdx = dimensionFields.findIndex(f => SIZE_CONTAINER_RE.test(f.label.trim()));
    if (containerIdx !== -1) {
      const containerField = dimensionFields[containerIdx];
      const subColon = containerField.value.match(/^([^:]{1,40}):\s*(.+)$/);

      // Case A: value contains a sub-label ("Top Panel: 25.9 x 2.75 (wxh) FT")
      // → create Size group with sub-panel rows
      if (subColon) {
        const sizeGroupFields: Array<{ label: string; value: string }> = [
          { label: subColon[1].trim(), value: subColon[2].trim() }
        ];
        const consumed = new Set<number>([containerIdx]);
        for (let i = containerIdx + 1; i < dimensionFields.length; i++) {
          if (SUB_PANEL_RE.test(dimensionFields[i].label.trim())) {
            sizeGroupFields.push(dimensionFields[i]);
            consumed.add(i);
          }
        }
        const remainingDimFields = dimensionFields.filter((_, i) => !consumed.has(i));
        groups.push({ heading: containerField.label, fields: sizeGroupFields });
        if (remainingDimFields.length > 0) groups.push({ heading: null, fields: remainingDimFields });
        if (materialFields.length > 0) groups.push({ heading: 'Material', fields: materialFields });
        return groups;
      }

      // Case B: single value, no sub-label ("Size: A2 (16.5 x 23.4 inches)")
      // → promote to a group so it renders consistently; renderHeadingAsRow
      //   will fire (no remaining fields) and show it as a clean spec-row.
      const remainingDimFields = dimensionFields.filter((_, i) => i !== containerIdx);
      groups.push({ heading: containerField.label, fields: [{ label: containerField.label, value: containerField.value }] });
      if (remainingDimFields.length > 0) groups.push({ heading: null, fields: remainingDimFields });
      if (materialFields.length > 0) groups.push({ heading: 'Material', fields: materialFields });
      return groups;
    }

    if (dimensionFields.length > 0) groups.push({ heading: null, fields: dimensionFields });
    if (materialFields.length > 0) {
      // Only attach the "Material" heading when dimensions also exist (i.e. it's a real
      // two-section spec). For pure operational/info spec blocks the heading is misleading.
      const matHeading = dimensionFields.length > 0 ? 'Material' : null;
      groups.push({ heading: matHeading, fields: materialFields });
    }
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
  console.log(`\n🔬 [SPEC-DEBUG] getSpecPages: checking ${pages.length} filtered page(s)`);
  return pages.filter(page => {
    const text = page.text.toLowerCase().replace(/\s*\|\s*/g, ' ');
    const hasSpec = text.includes('design specification') ||
                    text.includes('design specifications') ||
                    text.includes('design specs') ||
                    text.includes('specification') ||
                    text.includes('display area') ||
                    // Newspaper insertion specific spec headings
                    text.includes('ad specification') ||
                    text.includes('creative specification') ||
                    text.includes('size specification') ||
                    text.includes('col. cm') ||
                    text.includes('col cm') ||
                    text.includes('column size') ||
                    text.includes('column cm') ||
                    text.includes('ad size') ||
                    text.includes('creative size');
    console.log(`   [SPEC-DEBUG] Page ${page.pageNumber}: textLen=${page.text.length} hasSpecKeyword=${hasSpec} first200="${page.text.substring(0, 200).replace(/\n/g, '|')}"`);
    if (!hasSpec) return false;
    const hasRefImg = text.includes('reference image') || text.includes('reference images') ||
                      text.includes('ad visual') || text.includes('sample ad') ||
                      text.includes('newspaper sample');
    // If BOTH headings appear on the same page, qualify as spec page only when
    // the spec heading comes BEFORE the reference image heading in the text.
    // This handles PDFs where Design Spec and Reference Image share a single page.
    if (hasRefImg) {
      const specPos = Math.min(
        text.includes('design specification') ? text.indexOf('design specification') : Infinity,
        text.includes('design specifications') ? text.indexOf('design specifications') : Infinity,
        text.includes('design specs') ? text.indexOf('design specs') : Infinity,
        text.includes('specification') ? text.indexOf('specification') : Infinity,
        text.includes('display area') ? text.indexOf('display area') : Infinity,
        text.includes('ad specification') ? text.indexOf('ad specification') : Infinity,
        text.includes('creative specification') ? text.indexOf('creative specification') : Infinity,
        text.includes('size specification') ? text.indexOf('size specification') : Infinity,
        text.includes('col. cm') ? text.indexOf('col. cm') : Infinity,
        text.includes('col cm') ? text.indexOf('col cm') : Infinity,
        text.includes('column size') ? text.indexOf('column size') : Infinity,
        text.includes('ad size') ? text.indexOf('ad size') : Infinity,
        text.includes('creative size') ? text.indexOf('creative size') : Infinity
      );
      const refPos = Math.min(
        text.includes('reference image') ? text.indexOf('reference image') : Infinity,
        text.includes('reference images') ? text.indexOf('reference images') : Infinity,
        text.includes('reference photo') ? text.indexOf('reference photo') : Infinity,
        text.includes('reference photos') ? text.indexOf('reference photos') : Infinity,
        text.includes('example image') ? text.indexOf('example image') : Infinity,
        text.includes('sample photo') ? text.indexOf('sample photo') : Infinity,
        text.includes('ad visual') ? text.indexOf('ad visual') : Infinity,
        text.includes('sample ad') ? text.indexOf('sample ad') : Infinity,
        text.includes('newspaper sample') ? text.indexOf('newspaper sample') : Infinity
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
           text.includes('example image') || text.includes('sample photo') ||
           // Newspaper insertion specific reference/visual headings
           text.includes('ad visual') || text.includes('sample ad') ||
           text.includes('newspaper sample') || text.includes('creative preview') ||
           text.includes('sample advertisement') || text.includes('ad preview');
  });
}

/**
 * Extract best image for Design Specification section.
 * Only picks from spec pages — never from reference image pages.
 * Skips cropped images from pages that ALSO have a reference image heading,
 * because those cropped images are real-world photos (not design diagrams).
 */
function extractSpecSectionImage(pages: ExtractedPage[]): string[] {
  const specPages = getSpecPages(pages);
  console.log(`\n📐 [SPEC-DEBUG] extractSpecSectionImage: ${specPages.length} spec page(s) found`);
  specPages.forEach(p => {
    const hasRef = p.text.toLowerCase().includes('reference image') || p.text.toLowerCase().includes('reference images');
    console.log(`   [SPEC-DEBUG] Spec page ${p.pageNumber}: croppedImages=${p.croppedImages?.length ?? 0} hasRefHeading=${hasRef} textLen=${p.text.length}`);
  });

  // Helper: does this page also contain a reference image heading?
  const pageHasRefHeading = (page: ExtractedPage): boolean => {
    const t = page.text.toLowerCase().replace(/\s*\|\s*/g, ' ');
    return t.includes('reference image') || t.includes('reference images') ||
           t.includes('reference photo') || t.includes('reference photos') ||
           t.includes('example image') || t.includes('sample photo');
  };

  // First pass: return ALL cropped images from pure spec pages so multi-diagram
  // services (e.g. Mobile Van LED with 4 panel diagrams) show every diagram.
  for (const page of specPages) {
    if (pageHasRefHeading(page)) continue; // skip shared pages — their cropped image is a reference photo
    if (page.croppedImages && page.croppedImages.length > 0) return [...page.croppedImages];
  }

  // Second pass: fallback to full page image only when page is diagram-heavy
  // (very little text AND no reference image heading — means it's a layout/measurement slide).
  // Skip when the page is actually a mixed pricing + spec text page (e.g. BaleenMedia
  // LED Hoardings 1/3 with DISPLAY PRICE + SPECIFICATION + Terms together) — those
  // pages have no diagram, so showing the raw page raster is wrong.
  const isMixedPricingPage = (page: ExtractedPage): boolean => {
    const t = page.text.toLowerCase();
    return t.includes('display price') ||
           t.includes('rental price') ||
           t.includes('printing & fixing') ||
           t.includes('min. quantity') ||
           t.includes('min quantity') ||
           /₹\s*[\d,]/.test(page.text) ||
           (t.includes('terms') && t.includes('conditions'));
  };
  for (const page of specPages) {
    if (pageHasRefHeading(page)) continue; // skip shared pages
    if (isMixedPricingPage(page)) continue; // skip pricing+spec pages
    const textLen = page.text.replace(/[^a-z]/gi, '').length;
    if (textLen < 300) return [page.imageDataUrl];
  }

  return [];
}

/**
 * Extract ALL reference images from Reference Image section pages.
 * ONLY picks from pages that have "Reference Image" heading.
 * Never falls back to spec page images.
 * Returns an array so all cropped images (not just index 0) are shown.
 */
function extractRefSectionImages(pages: ExtractedPage[]): string[] {
  const refPages = getRefImagePages(pages);
  if (refPages.length === 0) return [];

  // ── PER-PAGE STORED CROP DEBUG ───────────────────────────────────────────
  console.log(`📸 Ref pages found: ${refPages.length}`);
  refPages.forEach(p => {
    const n = p.croppedImages?.length ?? 0;
    console.log(`   Ref page ${p.pageNumber}: ${n > 0 ? `✅ ${n} stored cropped image(s)` : '⚠️  0 stored (will trigger lazy re-crop)'}`);
  });
  // ─────────────────────────────────────────────────────────────────────────

  // Collect ALL cropped images from ALL ref pages
  const allCropped: string[] = [];
  for (const page of refPages) {
    if (page.croppedImages && page.croppedImages.length > 0) {
      allCropped.push(...page.croppedImages);
    }
  }
  if (allCropped.length > 0) {
    // If additional ref pages have no croppedImages, include their full page image
    // (handles multi-page reference image sections where only some pages were cropped at upload time)
    for (const page of refPages) {
      if (!page.croppedImages || page.croppedImages.length === 0) {
        allCropped.push(page.imageDataUrl);
      }
    }
    return allCropped;
  }
  // Fallback: full page image of first reference page (contains all photos as one tall image)
  return [refPages[0].imageDataUrl];
}

// Known city names for multi-location quote extraction
const CITY_NAMES = ['chennai', 'madurai', 'coimbatore', 'salem', 'trichy', 'tiruchirappalli',
  'erode', 'tirunelveli', 'vellore', 'thanjavur', 'tiruppur', 'hosur', 'bangalore', 'mumbai',
  'delhi', 'hyderabad', 'pune', 'kolkata', 'ahmedabad', 'surat', 'jaipur', 'lucknow',
  'kochi', 'vizag', 'visakhapatnam', 'nagpur', 'nashik', 'mysore', 'mysuru'];

/**
 * Extract city name from quote item descriptions.
 * Returns the first city found in any item description (case-insensitive).
 */
function extractCityFromItems(items: QuoteItem[]): string | null {
  for (const item of items) {
    const desc = item.description.toLowerCase();
    for (const city of CITY_NAMES) {
      if (desc.includes(city)) return city;
    }
  }
  return null;
}

/**
 * Given a proposalPageMap and a city name, find the pages for that city's PDF.
 * Map keys are full lowercase filenames like "coimbatore rate card.pdf".
 */
function getPagesForCity(proposalPageMap: Record<string, ExtractedPage[]>, city: string): ExtractedPage[] | null {
  const key = Object.keys(proposalPageMap).find(k => k.includes(city));
  if (key) return proposalPageMap[key];
  return null;
}

export const ReferenceImages: React.FC<ReferenceImagesProps> = ({ proposalPages, proposalPageMap, items, terms = [], specOnly = false, noSpec = false }) => {
  // Determine which pages to use: city-isolated from map, or all flat pages
  const resolvedPages = useMemo(() => {
    if (proposalPageMap && items && items.length > 0) {
      const city = extractCityFromItems(items);
      if (city) {
        const cityPages = getPagesForCity(proposalPageMap, city);
        if (cityPages && cityPages.length > 0) {
          console.log(`🌆 ReferenceImages: Using ${cityPages.length} pages from city "${city}"`);
          return cityPages;
        }
      }
    }
    return proposalPages;
  }, [proposalPages, proposalPageMap, items]);

  // Automatically filter pages by quote items
  const filteredPages = useMemo(() => {
    if (!resolvedPages || resolvedPages.length === 0) {
      console.log('❌ ReferenceImages: No proposal pages available');
      return [];
    }
    
    console.log('📄 ReferenceImages: Processing', resolvedPages.length, 'proposal pages');
    console.log('📋 ReferenceImages: Quote items:', items?.map(i => i.description));
    
    // Debug: Log first page text to see what we're working with
    if (resolvedPages.length > 0) {
      console.log('📝 Sample page text:', resolvedPages[0].text.substring(0, 200));
    }
    
    // Automatically filter by quote items - no manual selection
    const filtered = filterPagesByQuoteItems(resolvedPages, items || []);
    console.log('✅ ReferenceImages: Filtered to', filtered.length, 'pages');
    
    return filtered;
  }, [resolvedPages, items]);
  // This is separate from filteredPages so spec/ref image logic is completely unaffected.
  const reviewPages = useMemo(() => {
    if (!resolvedPages) return [];
    const filteredPageNums = new Set(filteredPages.map(p => p.pageNumber));
    const extra = resolvedPages.filter(p =>
      !filteredPageNums.has(p.pageNumber) &&
      REVIEW_HEADING_PATTERN.test(p.text)
    );
    if (extra.length > 0) {
      console.log('📝 ReferenceImages: Found', extra.length, 'customer review page(s) outside filtered set');
    }
    return [...filteredPages, ...extra];
  }, [resolvedPages, filteredPages]);

  // Augment filteredPages with sibling (1/N) pages from the same service that contain
  // SPECIFICATION text. Some proposals (e.g. BaleenMedia LED Hoardings) place
  // DISPLAY PRICE + SPECIFICATION + Terms together on the 1/N page — that page is
  // (correctly) excluded from reference-image picks but still holds the spec we need.
  const specSourcePages = useMemo(() => {
    if (!resolvedPages || filteredPages.length === 0) return filteredPages;
    const SPEC_RE = /(design\s*spec|specification|display\s*area|ad\s*spec|creative\s*spec|size\s*spec|col\.?\s*cm|column\s*size|ad\s*size|creative\s*size)/i;
    const HEADING_RE = /^([A-Z][A-Z0-9 &\-\/]{2,})\s*\(\d+\/\d+\)/m;
    const existingNums = new Set(filteredPages.map(p => p.pageNumber));
    const extras: ExtractedPage[] = [];

    // Build heading prefixes from filteredPages (e.g. "LED HOARDINGS")
    const headingPrefixes = new Set<string>();
    for (const fp of filteredPages) {
      const m = fp.text.match(HEADING_RE);
      if (m) headingPrefixes.add(m[1].trim().toUpperCase());
    }

    for (const page of resolvedPages) {
      if (existingNums.has(page.pageNumber)) continue;
      // Must be a (1/N) page
      if (!/\(1\/\d+\)/.test(page.text)) continue;
      // Must contain spec text
      if (!SPEC_RE.test(page.text)) continue;
      // Heading must match one of the filtered service headings
      const m = page.text.match(HEADING_RE);
      if (!m) continue;
      const heading = m[1].trim().toUpperCase();
      if (!headingPrefixes.has(heading)) continue;
      console.log(`📐 [SPEC] Including sibling (1/N) page ${page.pageNumber} for heading "${heading}"`);
      extras.push(page);
    }

    return extras.length > 0 ? [...filteredPages, ...extras] : filteredPages;
  }, [resolvedPages, filteredPages]);

  // Smart content extraction from parsed text — section-aware
  // specGroups and image extraction use specSourcePages (filteredPages + sibling 1/N spec pages)
  const specGroups = useMemo(() => extractDesignSpecFields(specSourcePages), [specSourcePages]);
  // Require at least one field with a non-empty value (a heading-only group is not "content")
  const hasSpecContent = specGroups.some(g =>
    g.fields.some(f => (f.value || '').trim().length > 0) ||
    (g.tableRows !== undefined && g.tableRows.length > 0)
  );
  // hasMeaningfulSpec: true only when spec table has dimension/measurement data (not just material name)
  const hasMeaningfulSpec = useMemo(() => {
    if (!hasSpecContent) return false;
    // Metro-style table groups always contain meaningful dimension/quantity data
    if (specGroups.some(g => g.tableRows && g.tableRows.length > 0)) return true;
    const totalFields = specGroups.reduce((sum, g) => sum + g.fields.length, 0);
    if (totalFields > 2) return true;
    const dimensionKeywords = /\d[\s]*["'x×(]|\b(inches|inch|cm|mm|feet|ft|size|width|height|dimension|side|driver|conductor)\b/i;
    return specGroups.some(g => g.fields.some(f =>
      dimensionKeywords.test(f.value) || dimensionKeywords.test(f.label)
    ));
  }, [specGroups, hasSpecContent]);
  // Spec image: only from Design Specification pages
  const specImageUrl = useMemo(() => extractSpecSectionImage(specSourcePages), [specSourcePages]);
  // Reference images: ALL images from Reference Image pages — never falls back to spec pages
  const refImageUrls = useMemo(() => extractRefSectionImages(filteredPages), [filteredPages]);
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
  const [lazyCroppedRefImages, setLazyCroppedRefImages] = useState<string[]>([]);
  // true while Gemini lazy crop is in-flight — suppresses the full-page fallback so the
  // raw PDF page (with header/watermark) never flashes before the clean crop arrives.
  const [refImagesLoading, setRefImagesLoading] = useState<boolean>(false);
  useEffect(() => {
    // Find the reference image page inside filteredPages (including new heading variants)
    const refPage = filteredPages.find(p => {
      const t = p.text.toLowerCase().replace(/\s*\|\s*/g, ' ');
      return t.includes('reference image') || t.includes('reference images') ||
             t.includes('reference photo') || t.includes('reference photos') ||
             t.includes('example image') || t.includes('sample photo');
    });
    // Fire lazy re-crop if:
    // - ref page has 0 cropped images (upload-time crop was skipped/empty), OR
    // - ref page has 5+ cropped images (likely Gemini returned duplicate bounding boxes at upload time)
    // Skip when upload found 1-4 images (native extraction produced reliable crops)
    if (!refPage) {
      setRefImagesLoading(false);
      setLazyCroppedRefImages([]);
      return;
    }
    const storedCount = refPage.croppedImages?.length ?? 0;
    if (storedCount >= 1 && storedCount <= 4) {
      // Native extraction produced at least 1 crop — trust it, skip Gemini re-crop
      setRefImagesLoading(false);
      setLazyCroppedRefImages([]);
      return;
    }
    // storedCount === 0 or >= 5 — Gemini re-crop needed.
    // Set loading=true NOW so the full-page fallback is suppressed during the async wait.
    setRefImagesLoading(true);
    console.log(`🔁 Lazy re-crop triggered: stored count = ${storedCount} (${storedCount === 0 ? 'empty' : 'suspicious duplicate count'})`);
    let cancelled = false;
    console.log('🔍 Triggering lazy Gemini Vision crop for reference page', refPage.pageNumber);
    cropReferencePageImage(refPage.imageDataUrl, refPage.pageNumber).then(async cropped => {
      if (cancelled) return;
      if (cropped.length > 0) {
        console.log('✅ Lazy crop: got', cropped.length, 'image(s) from reference page', refPage.pageNumber);
        setLazyCroppedRefImages(cropped);
        setRefImagesLoading(false);
      } else {
        // Gemini Vision returned nothing — use geometric header/footer strip as fallback
        console.log('⚠️ Gemini Vision empty, using geometric strip for reference page', refPage.pageNumber);
        const stripped = await cropPageStrippingHeaderFooter(refPage.imageDataUrl);
        if (!cancelled) {
          setLazyCroppedRefImages([stripped]);
          setRefImagesLoading(false);
        }
      }
    });
    return () => { cancelled = true; };
  }, [filteredPages]);

  // Lazy spec section image crop.
  // Case A (shared page): spec + ref headings on same page → geometric top-half crop.
  // Case B (spec-only page with photos): spec heading only, no cropped images yet,
  //         full-page fallback is being used → Gemini Vision crop to extract vehicle photos.
  const [lazyCroppedSpecImage, setLazyCroppedSpecImage] = useState<string | null>(null);
  useEffect(() => {
    // Case A: shared page (both spec AND ref headings present)
    const sharedPage = filteredPages.find(p => {
      const t = p.text.toLowerCase().replace(/\s*\|\s*/g, ' ');
      const hasSpec = t.includes('design specification') || t.includes('design specifications') ||
                      t.includes('design specs') || t.includes('specification') || t.includes('display area');
      const hasRef  = t.includes('reference image') || t.includes('reference images') ||
                      t.includes('reference photo') || t.includes('reference photos') ||
                      t.includes('example image') || t.includes('sample photo');
      return hasSpec && hasRef;
    });
    if (sharedPage) {
      let cancelled = false;
      console.log('🔍 Triggering lazy top-half crop for shared spec/ref page', sharedPage.pageNumber);
      cropPageHalf(sharedPage.imageDataUrl, 'top').then(cropped => {
        if (!cancelled) {
          console.log('✅ Lazy spec top-half crop done for page', sharedPage.pageNumber);
          setLazyCroppedSpecImage(cropped);
        }
      });
      return () => { cancelled = true; };
    }

    // Case B: pure spec page with no cropped images — full-page fallback is active.
    // Use geometric header/footer strip ONLY — preserves the full SIZE CHART diagram
    // (title + vehicle + numbered arrows + measurements) intact.
    // Gemini Vision is intentionally NOT used here: it isolates photos, which destroys
    // the annotated diagram structure that is the actual spec content.
    const pureSpecPage = filteredPages.find(p => {
      const t = p.text.toLowerCase().replace(/\s*\|\s*/g, ' ');
      const hasSpec = t.includes('design specification') || t.includes('design specifications') ||
                      t.includes('design specs') || t.includes('specification') || t.includes('display area');
      const hasRef  = t.includes('reference image') || t.includes('reference images') ||
                      t.includes('reference photo') || t.includes('reference photos') ||
                      t.includes('example image') || t.includes('sample photo');
      // Pure spec page only (not shared). Always strip — even if upload-time Gemini Vision
      // already produced croppedImages, those were photo-only crops that destroy the
      // annotated SIZE CHART diagram. cropPageStrippingHeaderFooter is always correct here.
      return hasSpec && !hasRef;
    });
    if (!pureSpecPage) {
      setLazyCroppedSpecImage(null);
      return;
    }
    // Cut at 30% from top: removes nav bar (~8%) + spec text heading + fields (~22%)
    // leaving the SIZE CHART diagram (title + van + annotations) intact.
    let cancelled = false;
    console.log('🔍 30% top-cut crop for pure spec page', pureSpecPage.pageNumber);
    cropPageFromPercent(pureSpecPage.imageDataUrl, 0.13002).then(cropped => {
      if (!cancelled) {
        console.log('✅ 30% top-cut crop done for pure spec page', pureSpecPage.pageNumber);
        setLazyCroppedSpecImage(cropped);
      }
    });
    return () => { cancelled = true; };
  }, [filteredPages]);

  // Lazy crop for PURE spec pages (spec heading only, no reference image heading on same page).
  // Fires when the spec page has no croppedImages — strips header/footer so only the diagram shows.
  // Does NOT affect shared pages (handled by lazyCroppedSpecImage above) or pages with croppedImages.
  const [lazyCroppedPureSpecImage, setLazyCroppedPureSpecImage] = useState<string | null>(null);
  useEffect(() => {
    const pureSpecPage = filteredPages.find(p => {
      const t = p.text.toLowerCase().replace(/\s*\|\s*/g, ' ');
      const hasSpec = t.includes('design specification') || t.includes('design specifications') ||
                      t.includes('design specs') || t.includes('specification') || t.includes('display area');
      const hasRef  = t.includes('reference image') || t.includes('reference images') ||
                      t.includes('reference photo') || t.includes('reference photos') ||
                      t.includes('example image') || t.includes('sample photo');
      // Pure spec pages (no reference image heading) — always run the full-page
      // header/footer strip, because pre-cropped images may capture only the
      // first diagram strip (driver side) and miss conductor side / bus back.
      return hasSpec && !hasRef;
    });
    if (!pureSpecPage) {
      setLazyCroppedPureSpecImage(null);
      return;
    }
    // Skip lazy crop when upload-time produced any stored crop (≥1).
    // Upload-time Gemini Vision already found the correct content boundaries.
    // Lazy geometric crop (13% cut) overrides those and clips headings like
    // "Cab Branding Layout Size". Only run lazy crop for legacy PDFs with 0 crops.
    if ((pureSpecPage.croppedImages?.length ?? 0) >= 1) {
      setLazyCroppedPureSpecImage(null);
      return;
    }
    let cancelled = false;
    console.log('🔍 Triggering header/footer strip for pure spec page', pureSpecPage.pageNumber);
    cropSpecDiagram(pureSpecPage.imageDataUrl).then(cropped => {
      if (!cancelled) {
        console.log('✅ Pure spec page strip done for page', pureSpecPage.pageNumber);
        setLazyCroppedPureSpecImage(cropped);
      }
    });
    return () => { cancelled = true; };
  }, [filteredPages]);

  // ─── PDF readiness tracking ───────────────────────────────────────────────
  // containerRef is attached to the root <div> so pdfExportService can poll
  // data-pdf-ready="true" before capturing this section.
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialise data-pdf-ready="false" on mount (imperatively, so React re-renders
  // cannot override it between the time we set it and the async ops settle).
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.setAttribute('data-pdf-ready', 'false');
    }
  }, []); // mount only

  // Debounce: after every async state/data change, reset a 500 ms timer.
  // When 500 ms elapses with no further changes, all async ops have settled
  // and we can mark the section ready for PDF capture.
  // IMPORTANT: include the derived data (filteredPages, specGroups, refImageUrls)
  // so that when proposalPages arrive async from IndexedDB and re-derive the
  // content, the readiness timer restarts. Otherwise the section can report
  // ready=true while the spec-table / images are still rendering, causing
  // measureSectionBlocks to capture a too-small height and the smart-pagination
  // engine to place the block on a page where its actual rendered height
  // overflows into the footer overlay.
  //
  // Additionally: only set ready=true once filteredPages is non-empty. The
  // initial render happens with filteredPages=[] (proposalPages still loading
  // from IndexedDB). If we set ready=true on that empty state, waitForPdfReady
  // returns immediately and measureSectionBlocks captures a too-small height
  // for the spec / refImages blocks (heading only, no content).
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.setAttribute('data-pdf-ready', 'false');
    }
    // Wait for real data before becoming ready. If there are no filtered pages
    // yet, stay false — the next render (when proposalPages arrives) will
    // re-trigger this effect with non-empty filteredPages.
    if (filteredPages.length === 0) return;
    const tid = setTimeout(() => {
      if (containerRef.current) {
        containerRef.current.setAttribute('data-pdf-ready', 'true');
      }
    }, 500);
    return () => clearTimeout(tid);
  }, [geminiReview, lazyCroppedRefImages, lazyCroppedSpecImage, lazyCroppedPureSpecImage, filteredPages, specGroups, refImageUrls, hasSpecContent, specImageUrl]);
  // ─────────────────────────────────────────────────────────────────────────

  if (!resolvedPages || resolvedPages.length === 0) {
    console.log('❌ ReferenceImages: No proposal pages, returning null');
    return null;
  }
  if (filteredPages.length === 0) {
    console.log('⚠️ ReferenceImages: No filtered pages found');
    return null;
  }

  // specOnly: if there is no spec to display, return null so waitForPdfReady finds no element and proceeds immediately
  if (specOnly && !hasSpecContent && specImageUrl.length === 0) return null;

  // While Gemini lazy crop is in-flight, suppress the full-page fallback (refImageUrls would
  // contain the raw PDF page with header/watermark). Show nothing until the clean crop arrives.
  const finalRefImageUrls = lazyCroppedRefImages.length > 0 ? lazyCroppedRefImages
                          : refImagesLoading                 ? []
                          :                                    refImageUrls;
  const showSingleCenteredRef = specImageUrl.length === 0 && finalRefImageUrls.length === 1;

  // Resolved spec image sources:
  // 1. If upload-time stored ≥1 crop, use them directly — Gemini Vision found correct
  //    content boundaries at upload time. Skip ALL lazy crops which use dumb geometric
  //    cuts that clip headings (e.g. "Cab Branding Layout Size").
  // 2. Only use lazy crops for legacy PDFs with 0 stored crops.
  const specImgSrcs: string[] =
    specImageUrl.length >= 1 ? specImageUrl :
    lazyCroppedPureSpecImage ? [lazyCroppedPureSpecImage] :
    lazyCroppedSpecImage ? [lazyCroppedSpecImage] :
    specImageUrl;

  // ── RENDER-TIME IMAGE COUNT DEBUG ────────────────────────────────────────
  console.log(`\n🖼️  ===== IMAGES LOADED FOR QUOTE =====`);
  console.log(`   Stored upload-time : ${refImageUrls.length} image(s)`);
  console.log(`   Lazy re-crop result: ${lazyCroppedRefImages.length} image(s)`);
  console.log(`   ► Displaying       : ${finalRefImageUrls.length} image(s)` +
    (lazyCroppedRefImages.length > 0 ? ' (from lazy re-crop)' :
     refImageUrls.length > 0        ? ' (from stored crop)'  :
                                       ' (fallback full page)'));
  console.log(`=======================================\n`);
  // ─────────────────────────────────────────────────────────────────────────

  console.log('✅ ReferenceImages: Rendering smart layout for', filteredPages.length, 'pages');

  // Whether the spec section has metro-style multi-table groups (e.g. Metro Train Inside Branding).
  // When true, each coach group gets its own data-pdf-block="atomic" so the page engine can break
  // between groups instead of forcing every coach table onto the same page.
  const hasMetroStyleTables = specGroups.some(g => g.tableRows && g.tableRows.length > 0);

  // Renders the inner content of a single spec group (shared between metro and non-metro paths).
  const renderSingleSpecGroup = (group: SpecGroup, gi: number) => {
    if (group.tableRows && group.tableRows.length > 0) {
      return (
        <div key={gi} className="spec-coach-group">
          {group.heading && <div className="spec-coach-heading">{group.heading}</div>}
          <table className="spec-data-table">
            {group.tableHeaders && group.tableHeaders.length > 0 && (
              <thead>
                <tr>
                  {group.tableHeaders.map((h, hi) => <th key={hi}>{h}</th>)}
                </tr>
              </thead>
            )}
            <tbody>
              {group.tableRows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => <td key={ci}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    const headingLower = group.heading?.trim().toLowerCase() || '';
    const inlineValues = group.heading
      ? group.fields.filter(f => f.label.trim().toLowerCase() === headingLower).map(f => f.value)
      : [];
    const remainingFields = group.heading
      ? group.fields.filter(f => f.label.trim().toLowerCase() !== headingLower)
      : group.fields;
    return (
      <React.Fragment key={gi}>
        {group.heading && (
          <div className="spec-row">
            <span className="spec-label spec-label--group">{group.heading}</span>
            <span className="spec-value">{inlineValues.join(', ')}</span>
          </div>
        )}
        {remainingFields.map((f, fi) => (
          <div key={fi} className="spec-row">
            <span className="spec-label">{f.label}</span>
            <span className="spec-value">{f.value}</span>
          </div>
        ))}
      </React.Fragment>
    );
  };

  // specOnly: render ONLY the Display Specification block (no spacer, no images, no review, no terms)
  if (specOnly) {
    return (
      <div className="smart-reference-page" ref={containerRef}>
        {(hasSpecContent || specImageUrl.length > 0) && (
          hasMetroStyleTables ? (
            <>
              {/* Heading travels with the first coach group — prevents orphan heading at page bottom */}
              {specGroups.map((group, gi) => (
                <div key={gi} className={`smart-section${group.tableRows ? '' : ' spec-table'}`} data-pdf-block="atomic">
                  {gi === 0 && (
                    <h3 className="smart-section-heading">
                      <span className="smart-heading-bar" />
                      2. Display Specification
                    </h3>
                  )}
                  {renderSingleSpecGroup(group, gi)}
                </div>
              ))}
              {specImageUrl.length > 0 && (
                <div className="smart-section" data-pdf-block="atomic">
                  <div className="ref-img-container spec-img-container">
                    {specImgSrcs.length >= 2 ? (
                      <div className="spec-img-grid">
                        {specImgSrcs.map((s, i) => <img key={i} src={s} alt={`Specification diagram ${i + 1}`} className="ref-img spec-img-grid-item" />)}
                      </div>
                    ) : (
                      <img src={specImgSrcs[0]} alt="Design specification diagram" className="ref-img" />
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="smart-section" data-pdf-block="atomic">
              <h3 className="smart-section-heading">
                <span className="smart-heading-bar" />
                2. Display Specification
              </h3>
              {hasSpecContent && (
                <div className="spec-table">
                  {specGroups.map((group, gi) => renderSingleSpecGroup(group, gi))}
                </div>
              )}
              {specImageUrl.length > 0 && (
                <div className="ref-img-container spec-img-container">
                  {specImgSrcs.length >= 2 ? (
                    <div className="spec-img-grid">
                      {specImgSrcs.map((s, i) => <img key={i} src={s} alt={`Specification diagram ${i + 1}`} className="ref-img spec-img-grid-item" />)}
                    </div>
                  ) : (
                    <img src={specImgSrcs[0]} alt="Design specification diagram" className="ref-img" />
                  )}
                </div>
              )}
            </div>
          )
        )}
      </div>
    );
  }

  return (
    <div className="smart-reference-page" ref={containerRef}>
      {/* pdf-top-spacer must be a tracked block so the engine removes it from continuation pages */}
      <div className="pdf-top-spacer" data-pdf-block="atomic" />

      {!noSpec && (hasSpecContent || specImageUrl.length > 0) && (
        hasMetroStyleTables ? (
          <>
            {/* Heading travels with the first coach group — prevents orphan heading at page bottom */}
            {specGroups.map((group, gi) => (
              <div key={gi} className={`smart-section${group.tableRows ? '' : ' spec-table'}`} data-pdf-block="atomic">
                {gi === 0 && (
                  <h3 className="smart-section-heading">
                    <span className="smart-heading-bar" />
                    2. Display Specification
                  </h3>
                )}
                {renderSingleSpecGroup(group, gi)}
              </div>
            ))}
            {/* Show spec image when spec has no meaningful dimensional content */}
            {specImageUrl.length > 0 && (
              <div className="smart-section" data-pdf-block="atomic">
                <div className="ref-img-container spec-img-container">
                  {specImgSrcs.length >= 2 ? (
                    <div className="spec-img-grid">
                      {specImgSrcs.map((s, i) => <img key={i} src={s} alt={`Specification diagram ${i + 1}`} className="ref-img spec-img-grid-item" />)}
                    </div>
                  ) : (
                    <img src={specImgSrcs[0]} alt="Design specification diagram" className="ref-img" />
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="smart-section" data-pdf-block="atomic">
            <h3 className="smart-section-heading">
              <span className="smart-heading-bar" />
              2. Display Specification
            </h3>
            {hasSpecContent && (
              <div className="spec-table">
                {specGroups.map((group, gi) => renderSingleSpecGroup(group, gi))}
              </div>
            )}
            {/* Show spec image when available */}
            {specImageUrl.length > 0 && (
              <div className="ref-img-container spec-img-container">
                {specImgSrcs.length >= 2 ? (
                  <div className="spec-img-grid">
                    {specImgSrcs.map((s, i) => <img key={i} src={s} alt={`Specification diagram ${i + 1}`} className="ref-img spec-img-grid-item" />)}
                  </div>
                ) : (
                  <img src={specImgSrcs[0]} alt="Design specification diagram" className="ref-img" />
                )}
              </div>
            )}
          </div>
        )
      )}

      {/* Reference Images — each image is its own atomic block so the greedy
          packer can place them individually. The section heading travels with
          the first image so it is never orphaned at the bottom of a page. */}
      {refImageUrls.length > 0 && finalRefImageUrls.map((src, idx) => (
        <div key={idx} className="smart-section" data-pdf-block="atomic">
          {idx === 0 && (
            <h3 className="smart-section-heading">
              <span className="smart-heading-bar" />
              3. Reference Images
            </h3>
          )}
          <div className="ref-img-container ref-img-single-center">
            <img
              src={src}
              alt={`Reference ${idx + 1}`}
              className={`ref-img ${finalRefImageUrls.length === 1 ? 'ref-img-single' : ''}`}
            />
          </div>
        </div>
      ))}

      {/* Customer Review */}
      {finalReview && (
        <div className="smart-section" data-pdf-block="atomic">
          <h3 className="smart-section-heading">
            <span className="smart-heading-bar" />
            4. Customer Review
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

      {terms.length > 0 && (
        <div className="smart-section" data-pdf-block="atomic">
          <h3 className="smart-section-heading">
            <span className="smart-heading-bar" />
            5. Terms &amp; Conditions
          </h3>
          <div className="review-card">
            <ul className="ref-terms-list">
              {terms.map((term, idx) => (
                <li key={idx}><span className="ref-bullet-dot"></span>{term}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Fallback: show full-page images when text extraction yields nothing.
          Each fallback image is its own block to prevent splitting. */}
      {!hasSpecContent && !customerReview && filteredPages.length > 0 && (
        <div className="smart-section" data-pdf-block="atomic">
          <h3 className="smart-section-heading">
            <span className="smart-heading-bar" />
            3. Reference Images from Proposal
          </h3>
          {filteredPages.map(page => (
            <div key={page.pageNumber} data-pdf-block="atomic">
              <img key={page.pageNumber} src={page.imageDataUrl} alt={`Page ${page.pageNumber}`} className="ref-img fallback-img" style={{ marginBottom: '20px' }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};



