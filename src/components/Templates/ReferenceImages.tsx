import React, { useMemo, useState, useEffect, useRef } from 'react';
import './ReferenceImages.css';
import {
  extractReviewViaGemini,
  cropReferencePageImage,
  cropPageStrippingHeaderFooter,
  cropSpecDiagram,
  cropPageHalf,
  cropPageFromPercent,
} from '../../utils/pdfUtils';
import { logger } from '../../utils/logger';

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
}

/**
 * Returns pages whose text contains the exact heading match.
 * Looks for section headings like "BUS FULL BRANDING", "APARTMENT LIFT BRANDING" in the PDF.
 * Uses strict matching to ensure we get the right pages.
 */
function filterPagesByCategory(pages: ExtractedPage[], category: string): ExtractedPage[] {
  logger.info('🔍 Filtering pages for category:', category);

  // Strip city prefix if present e.g. "Madurai - Auto Semi Branding - Display Price"
  const cityPrefixRe =
    /^(chennai|madurai|coimbatore|salem|trichy|tirupur|erode|vellore|tirunelveli|bangalore|hyderabad|mumbai|delhi)\s*[-–—]\s*/i;
  const cleanCategory = category.replace(cityPrefixRe, '');
  if (cleanCategory !== category) {
    logger.info('🏙️ Stripped city prefix, using:', cleanCategory);
  }
  // Use cleaned category for all subsequent matching
  category = cleanCategory;
  // Extract the service type part by removing pricing/quantity suffixes
  // Preserves sub-type qualifiers like "Underground Station", "Interior", "Non LED"
  // E.g., "Metro Branding – Underground Station - Display Price" → "Metro Branding – Underground Station"
  // E.g., "Mobile Van - Non LED Printing & Fixing Price" → "Mobile Van - Non LED"
  let serviceTypeOnly = category;
  const pricingSuffixPattern =
    /\b(printing\s*&?\s*fixing|display\s+price|rental\s+price|printing\s+price|fixing\s+price|design\s+price|creative\s+price|\w+\s+price|\w+\s+charge)\b/i;
  const pricingMatch = category.match(pricingSuffixPattern);
  if (pricingMatch && pricingMatch.index && pricingMatch.index > 0) {
    serviceTypeOnly = category
      .substring(0, pricingMatch.index)
      .replace(/[\s\-–—&]+$/, '')
      .trim();
    logger.info('📌 Using service type (pricing suffix removed):', serviceTypeOnly);
  } else {
    // Only fall back to first-dash split if no sub-type qualifiers are present
    // Sub-type qualifiers: words like interior, underground, exterior, station, etc.
    const subTypePattern =
      /\b(interior|underground|exterior|station|rooftop|skyway|elevated|platform|non\s*led|led)\b/i;
    const hasSubType = subTypePattern.test(category);

    if (hasSubType) {
      // Has sub-type — strip only known pricing terms from the end, keep everything else
      serviceTypeOnly = category
        .replace(
          /\s*[-–—]\s*\b(display\s+price|rental\s+price|printing\s+price|fixing\s+price|printing\s*&?\s*fixing\s*price?|per\s+month|rate|price)\b.*$/i,
          '',
        )
        .replace(/[\s\-–—&]+$/, '')
        .trim();
      logger.info('📌 Using service type (sub-type preserved):', serviceTypeOnly);
    } else {
      const dashIndex = category.indexOf(' - ');
      if (dashIndex > 0) {
        serviceTypeOnly = category.substring(0, dashIndex).trim();
        logger.info('📌 Using service type only:', serviceTypeOnly);
      }
    }
  }

  // Synonym map for common advertising/media industry terms
  // Also includes common OCR/PDF typos as synonyms
  const synonymMap: Record<string, string[]> = {
    ads: ['branding', 'advertising', 'ad', 'advertisement', 'advertisements'],
    branding: ['ads', 'advertising', 'ad', 'advertisement'],
    ad: ['branding', 'ads', 'advertising'],
    advertising: ['branding', 'ads', 'ad'],
    board: ['boards'],
    boards: ['board'],
    sticker: ['stickers'],
    stickers: ['sticker'],
    poster: ['posters'],
    posters: ['poster'],
    hoarding: ['hoardings'],
    hoardings: ['hoarding'],
    banner: ['banners'],
    banners: ['banner'],
    // Vehicle / transit synonyms
    cab: ['taxi', 'car', 'cab'],
    taxi: ['cab', 'car', 'taxi'],
    van: ['vehicle', 'van'],
    mobile: ['mobile'],
    // Print / media synonyms
    advertisement: ['ad', 'ads', 'advert', 'advertising'],
    radio: ['fm', 'radio', 'broadcast'],
    // PDF typo corrections
    awareness: ['awarness', 'awarenes', 'awarness'],
    direction: ['directio', 'dirction'],
  };

  // Extract meaningful keywords, excluding pricing/quantity terms
  // IMPORTANT: sub-type differentiators like "paper", "size", "a4", "a5" MUST be kept
  // so that "NEWSPAPER INSERTION_PAPER SIZE" and "NEWSPAPER INSERTION_A4/A5" each match
  // their own specific PDF page instead of both matching the first found page.
  const allWords = serviceTypeOnly
    .toLowerCase()
    .replace(/[()]/g, ' ') // Replace parentheses with spaces
    .split(/[\s,\-/&_]+/) // underscore also treated as separator (INSERTION_A4 → insertion, a4)
    .filter((w) => w.length >= 1);

  // Pricing/filler words to always discard
  const pricingWords = new Set([
    'rental',
    'price',
    'per',
    'month',
    'and',
    'the',
    'for',
    'from',
    'display',
    'printing',
    'fixing',
    'design',
    'creative',
    'extra',
    'charge',
    'rate',
    'ads',
  ]); // 'ads' is a generic suffix ("Lobby Screen Ads") that never appears in PDF headings

  // Core service words — always kept regardless of length
  const coreWords = allWords.filter((w) => !pricingWords.has(w) && w.length >= 3);

  // Short sub-type codes (a4, a5, a3, b4, b5, etc.) — keep ONLY if there are other
  // items in the same category that would otherwise produce identical keyword sets.
  // Strategy: always include them — they are critical differentiators.
  const shortCodes = allWords.filter((w) => /^[a-z]\d$/.test(w)); // e.g. a4, a5, b5

  const words = [...new Set([...coreWords, ...shortCodes])];

  logger.info('📝 Extracted keywords:', words);

  if (words.length === 0) return [];

  // Deduplicate keywords to avoid requiring the same word multiple times
  // e.g., "Mobile Van Branding - Mobile Van - LED Branding" should only require 'mobile', 'van', 'branding', 'led' once each
  const requiredKeywords = [...new Set(words)];

  logger.info('🔑 Required keywords for matching:', requiredKeywords);

  // Strategy: Build an exact heading pattern from the category
  // E.g., "Apartment Lift Branding" → /apartment\s+lift\s+branding/i
  // E.g., "Bus Full Branding" → /bus\s+full\s+branding/i

  // Create a flexible regex pattern from the keywords, allowing singular/plural variants
  const keywordPatternParts = words.map((w) => {
    // Allow optional trailing 's' for singular/plural matching
    return `${w}s?`;
  });
  const keywordPattern = keywordPatternParts.join('\\s+');
  const exactHeadingPattern = new RegExp(keywordPattern, 'i');

  logger.info('🎯 Exact heading pattern:', exactHeadingPattern.source);

  const matchedPages = pages.filter((page) => {
    // Clean up page text: Remove pipe characters and extra spaces that might split words
    // e.g., "li | ft" becomes "lift", "apartment li | ft branding" becomes "apartment lift branding"
    const rawPageText = page.text
      .toLowerCase()
      .replace(/\s*\|\s*/g, '') // Remove pipes and surrounding spaces
      .replace(/[()]/g, ' ') // Replace parentheses with spaces
      .replace(/_/g, ' ') // Split underscore-glued tokens
      .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
      .trim();

    // COMPOUND-WORD SPLIT: The PDF renderer concatenates words without spaces.
    // e.g., "NEWSPAPER INSERTION" → "newspaperinsertion", "PAPER SIZE" → "papersize"
    // Also handles PDF typos like "awarness" for "awareness", "awarnessdirectio" etc.
    // For each required keyword (and its known typo variants), if it appears at the START
    // of a compound token, insert a space AFTER it so downstream matching works correctly.
    const typoVariants: Record<string, string[]> = {
      awareness: ['awarness', 'awarenes'],
      direction: ['directio', 'dirction'],
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

    logger.info(
      `🔍 Checking Page ${page.pageNumber} for keywords: [${requiredKeywords.join(', ')}]`,
    );

    // EXCLUDE pricing summary pages (they contain pricing tables, not reference images)
    // Detect currency symbols/patterns that indicate pricing content
    const hasCurrencyPatterns = (pageText.match(/₹|rs\.?\s*[\d,]+|[\d,]+\.00/g) || []).length >= 3;
    const hasPricingColumns =
      pageText.includes('unit price') ||
      pageText.includes('unit of measure') ||
      pageText.includes('price per') ||
      pageText.includes('campaign');
    const hasQuantityColumns =
      pageText.includes('quantity') || pageText.includes('min.') || pageText.includes('min ');
    // NOTE: 'rate card' alone is NOT enough to block — newspaper insertion PDFs are themselves
    // rate cards, so every page would be blocked. Only block when combined with pricing signals.
    const isPricingSummary =
      pageText.includes('pricing summary') ||
      pageText.includes('price list') ||
      (pageText.includes('rate card') &&
        hasCurrencyPatterns &&
        (hasPricingColumns || hasQuantityColumns)) ||
      (pageText.includes('activity') && pageText.includes('branding activities')) ||
      (pageText.includes('unit price') && pageText.includes('total')) ||
      (hasCurrencyPatterns && hasPricingColumns) ||
      (hasCurrencyPatterns && hasQuantityColumns);

    if (isPricingSummary) {
      logger.info(`❌ Page ${page.pageNumber} - Excluded (pricing summary table)`);
      return false;
    }

    // Helper: check if a single keyword (or its synonyms/variations) appears in the page text
    const keywordFoundInText = (kw: string, text: string): boolean => {
      // Use word-boundary regex as primary check so 'paper' does NOT match inside 'newspaper'
      const wbRegex = new RegExp(
        '(?<![a-z0-9])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])',
        'i',
      );
      if (wbRegex.test(text)) return true;

      // Check synonyms
      const synonyms = synonymMap[kw];
      if (synonyms) {
        for (const syn of synonyms) {
          if (text.includes(syn)) {
            logger.info(`  ✓ Synonym match: "${kw}" matched via synonym "${syn}"`);
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
      const wbRegex = new RegExp(
        '(?<![a-z0-9])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])',
        'i',
      );
      if (wbRegex.test(pageText)) return true;

      // Check synonyms from synonymMap
      const synonyms = synonymMap[kw];
      if (synonyms) {
        for (const syn of synonyms) {
          if (pageText.includes(syn)) {
            logger.info(`  ✓ Synonym match: "${kw}" matched via synonym "${syn}"`);
            return true;
          }
        }
      }

      // For words ending in 's', also check without the 's' (boards -> board)
      if (kw.endsWith('s') && kw.length > 4) {
        const withoutS = kw.slice(0, -1);
        if (!['busines', 'congres', 'proces'].includes(withoutS)) {
          if (pageText.includes(withoutS)) {
            logger.info(`  ✓ Found variation: "${kw}" matched as "${withoutS}"`);
            return true;
          }
        }
      }

      // For words not ending in 's', also check with 's' added (board -> boards)
      if (!kw.endsWith('s')) {
        const withS = kw + 's';
        if (pageText.includes(withS)) {
          logger.info(`  ✓ Found variation: "${kw}" matched as "${withS}"`);
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
              logger.info(
                `  ✓ Found fuzzy match: "${kw}" matched as "${word}" (same start + similar length)`,
              );
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
              logger.info(
                `  ✓ Found fuzzy match: "${kw}" matched as "${word}" (${Math.round(similarity * 100)}% characters match)`,
              );
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
                logger.info(
                  `  ✓ Found compound-word match: "${kw}" matched as prefix of "${word}"`,
                );
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
    const matchedCount = requiredKeywords.filter((kw) => keywordFoundInText(kw, pageText)).length;
    const matchRatio = matchedCount / requiredKeywords.length;

    // Negation words like "non" are critical differentiators — they MUST be present
    // Without "non", "LED" vs "Non LED" would be indistinguishable.
    // Sub-type size codes (a4, a5, paper, size) are also critical differentiators.
    const negationWords = ['non', 'not', 'without', 'no'];
    const sizeCodePattern = /^([a-z]\d|paper|size)$/;
    const criticalKeywords = requiredKeywords.filter(
      (kw) => negationWords.includes(kw) || sizeCodePattern.test(kw),
    );
    const hasMissingCritical = criticalKeywords.some((kw) => !keywordFoundInText(kw, pageText));

    const hasRelaxedMatch =
      !hasAllKeywords && matchRatio >= 0.85 && matchedCount >= 2 && !hasMissingCritical;

    if (!hasAllKeywords && !hasRelaxedMatch) {
      // Use the same flexible matching for reporting missing keywords
      const missingKeywords = requiredKeywords.filter((kw) => !keywordFoundInText(kw, pageText));

      logger.info(
        `❌ Page ${page.pageNumber} - Missing keywords: [${missingKeywords.join(', ')}] (matched ${matchedCount}/${requiredKeywords.length})`,
      );
      logger.info(`   Page text sample: ${pageText.substring(0, 200)}...`);
      return false;
    }

    if (hasRelaxedMatch) {
      logger.info(
        `✅ Page ${page.pageNumber} - RELAXED match (${matchedCount}/${requiredKeywords.length} keywords, ${Math.round(matchRatio * 100)}%)`,
      );
    }

    // STRICT HEADING CHECK FIRST: PDF reference pages have the service name at the very top
    // (e.g. "AUTO BACK STICKERS (2/3)" or "AUTO SEMI BRANDING (2/3)").
    // Reject pages whose first ~120 chars (the heading area) don't contain all keywords.
    // This MUST run before the reference-image-page priority check, otherwise pages with
    // generic markers like "DESIGN SPECIFICATIONS" / "DISPLAY AREA" (present on every spec page)
    // would be wrongly accepted regardless of what service they actually depict.
    const headingArea = pageText.substring(0, 120);
    const allKeywordsInHeading = requiredKeywords.every((kw) => {
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
      logger.info(
        `❌ Page ${page.pageNumber} - Keywords not all in heading area. Heading: "${headingArea.substring(0, 60)}..."`,
      );
      return false;
    }

    // Check if the service heading phrase appears on this page (also try plural variant)
    const hasHeading =
      exactHeadingPattern.test(pageText) ||
      new RegExp(words.join('\\s+') + 's?', 'i').test(pageText);

    // SLIDING WINDOW: find the tightest cluster of all keywords across all their occurrences.
    // Collects every position where each keyword (or plural/singular variant) appears,
    // then picks the combination with the smallest span.
    // This prevents nav-button occurrences at the top of the page from poisoning the distance.
    const allOccurrences: number[][] = requiredKeywords.map((kw) => {
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
        const variantRegex = new RegExp(
          '(?<![a-z0-9])' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])',
          'gi',
        );
        let match: RegExpExecArray | null;
        while ((match = variantRegex.exec(pageText)) !== null) {
          positions.push(match.index);
        }
      }
      return [...new Set(positions)].sort((a, b) => a - b);
    });
    const allKeywordsLocated = allOccurrences.every((occ) => occ.length > 0);

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
            Math.abs(pos - center) < Math.abs(best - center) ? pos : best,
          );
          maxPos = Math.max(maxPos, closest);
          minPos = Math.min(minPos, closest);
          span = maxPos - minPos;
          if (span > 200) {
            valid = false;
            break;
          } // early exit if already too spread
        }
        if (valid && span < minSpan) minSpan = span;
      }
    }
    const keywordsAreClose = allKeywordsLocated && minSpan <= 120;
    logger.info(
      `📏 Page ${page.pageNumber} - keyword cluster min span: ${minSpan}, close: ${keywordsAreClose}`,
    );

    // NEGATION GUARD: If the query does NOT include a negation word (non/no/without),
    // but the page heading contains a negation word immediately before one of the required
    // keywords, reject the page.
    // e.g. query "Mobile Van LED" must not match page heading "Mobile Van Non LED".
    // 'no' is intentionally excluded: it is a product name component ("No Parking", "No Entry"),
    // not a variant qualifier. Only 'non' reliably signals product variants ("Non LED", "Non-lit").
    const queryHasNegation = requiredKeywords.some((kw) => ['non', 'without', 'not'].includes(kw));
    if (!queryHasNegation && (hasHeading || keywordsAreClose)) {
      // Use the tightest cluster window for negation checking
      const clusterPositions = allKeywordsLocated ? allOccurrences.map((occ) => occ[0]) : [];
      const windowStart =
        clusterPositions.length > 0 ? Math.max(0, Math.min(...clusterPositions) - 10) : 0;
      const windowEnd =
        clusterPositions.length > 0
          ? Math.min(pageText.length, Math.max(...clusterPositions) + 30)
          : 150;
      const headingWindow = pageText.substring(windowStart, windowEnd);
      // Check if any negation word precedes a required keyword in that window
      // 'no' excluded — it is part of product names ("No Parking"), not a variant negator.
      const negationPattern = /\b(non|without|not)\s+\w+/g;
      let negMatch: RegExpExecArray | null;
      while ((negMatch = negationPattern.exec(headingWindow)) !== null) {
        const wordAfterNeg = negMatch[0].split(/\s+/)[1];
        if (requiredKeywords.some((kw) => wordAfterNeg.startsWith(kw.substring(0, 3)))) {
          logger.info(
            `❌ Page ${page.pageNumber} - Negation guard: page heading has "${negMatch[0]}" but query requires positive match`,
          );
          return false;
        }
      }
    }

    // PRIORITY 1: Reference/spec page AND the service heading is present on the same page.
    // Both conditions are REQUIRED — prevents accepting another product's ref page that
    // happens to contain scattered keywords (e.g. "auto" in title, "back" in spec, "sticker" in material).
    // (only reached when heading already matches the required service)
    const isReferenceImagePage =
      pageText.includes('reference image') ||
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
      logger.info(`✅ Page ${page.pageNumber} - REFERENCE IMAGE page with heading match!`);
      return true;
    }

    // PRIORITY 2: Exact heading phrase found on page
    if (hasHeading) {
      logger.info(`✅ Page ${page.pageNumber} - EXACT heading match found!`);
      return true;
    }

    // Also accept if keywords appear within 60 characters of each other (flexible heading match)
    // Tight window prevents false positives where keywords appear scattered across the page
    // e.g. "auto" in heading + "back" in navigation + "stickers" via fuzzy ≠ "auto back stickers"
    const keywordPositions = requiredKeywords
      .map((kw) => {
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
              if (sp !== -1) {
                pos = sp;
                break;
              }
            }
          }
        }
        return pos;
      })
      .filter((pos) => pos >= 0);
    if (keywordPositions.length === requiredKeywords.length) {
      const firstPos = Math.min(...keywordPositions);
      const lastPos = Math.max(...keywordPositions);
      const distance = lastPos - firstPos;

      if (distance <= 60) {
        logger.info(
          `✅ Page ${page.pageNumber} - Keywords appear close together (distance: ${distance})`,
        );
        return true;
      } else {
        logger.info(
          `❌ Page ${page.pageNumber} - Keywords too far apart (distance: ${distance}), likely scattered`,
        );
      }
    }

    // PRIORITY 3: Keywords appear within 100 characters of each other (flexible heading match)
    if (keywordsAreClose) {
      logger.info(`✅ Page ${page.pageNumber} - Keywords appear close together`);
      return true;
    }

    // REJECT: keywords are scattered across different sections of the page (e.g. service name
    // in heading, "back" in size spec, "sticker" in material field) — high false-positive risk.
    logger.info(
      `⚠️ Page ${page.pageNumber} - Keywords too scattered, rejecting to avoid wrong product match`,
    );
    return false;
  });

  logger.info(`📊 Found ${matchedPages.length} matching pages for "${category}"`);

  // POST-PROCESSING: Look for reference image pages adjacent to keyword matches
  // E.g., if page 32 has keywords but page 33 is reference image, include page 33
  const pageNumbersToInclude = new Set<number>();

  matchedPages.forEach((page) => {
    const pageText = page.text
      .toLowerCase()
      .replace(/\s*\|\s*/g, '')
      .replace(/\s+/g, ' ');

    // Check if this page has (1/X) pattern - skip it entirely
    const hasFirstPagePattern = pageText.match(/\(1\/\d+\)/);
    if (hasFirstPagePattern) {
      logger.info(`🔄 Page ${page.pageNumber} - Excluded (1/X pattern)`);
      return;
    }

    // Check if this is a reference image page
    const isRefPage =
      pageText.includes('reference image') ||
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
      logger.info(`🎯 Page ${page.pageNumber} - Reference image page found`);
      pageNumbersToInclude.add(page.pageNumber);
      return;
    }

    // Check adjacent pages (next page) for reference images
    const nextPage = pages.find((p) => p.pageNumber === page.pageNumber + 1);
    if (nextPage) {
      const nextText = nextPage.text
        .toLowerCase()
        .replace(/\s*\|\s*/g, '')
        .replace(/\s+/g, ' ');
      const nextIsRefPage =
        nextText.includes('reference image') ||
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
        logger.info(
          `🔄 Page ${page.pageNumber} - Skipped, using next page ${nextPage.pageNumber} (reference page)`,
        );
        pageNumbersToInclude.add(nextPage.pageNumber);
        return;
      }
    }

    // No reference page found in adjacent pages, include current page
    logger.info(`✅ Page ${page.pageNumber} - Included (keyword match)`);
    pageNumbersToInclude.add(page.pageNumber);
  });

  const refinedPages = pages.filter((p) => pageNumbersToInclude.has(p.pageNumber));
  logger.info(`📊 After refinement: ${refinedPages.length} pages for "${category}"`);
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
  const pricingSuffixPattern =
    /\s*[-–—]\s*\b(display\s+price|rental\s+price|printing\s+price|fixing\s+price|printing\s*&?\s*fixing\s*price?|per\s+month|rate|price)\b.*$/i;

  for (const item of items) {
    const desc = item.description;

    // Step 1: Strip pricing suffix only (preserves sub-type like "Underground Station")
    let serviceType = desc.replace(pricingSuffixPattern, '').trim();
    // Also strip trailing dashes/spaces
    serviceType = serviceType.replace(/[\s\-–—&]+$/, '').trim();

    const lower = serviceType.toLowerCase();

    // Check if the cleaned string contains a service keyword
    if (
      lower.includes('branding') ||
      lower.includes('shelter') ||
      lower.includes('signage') ||
      lower.includes('printing') ||
      lower.includes('ads') ||
      lower.includes('advertising') ||
      lower.includes('screen') ||
      lower.includes('lobby') ||
      lower.includes('hoarding') ||
      lower.includes('board')
    ) {
      logger.info('📌 Extracted service type (pricing suffix removed):', serviceType);
      return serviceType;
    }

    // Fallback: Try splitting at first dash only if no pricing suffix was found
    const dashMatch = desc.match(/^([^-–—]+)\s*[-–—]/);
    if (dashMatch) {
      const beforeDash = dashMatch[1].trim();
      const bdLower = beforeDash.toLowerCase();
      if (
        bdLower.includes('branding') ||
        bdLower.includes('shelter') ||
        bdLower.includes('signage') ||
        bdLower.includes('printing') ||
        bdLower.includes('ads') ||
        bdLower.includes('advertising') ||
        bdLower.includes('screen') ||
        bdLower.includes('lobby')
      ) {
        logger.info('📌 Extracted service type from dash pattern:', beforeDash);
        return beforeDash;
      }
    }

    // Fallback: Match any "[Something] Branding" pattern
    const brandingMatch = desc.match(/([a-z\s]+branding)/i);
    if (brandingMatch) {
      const matchedType = brandingMatch[1].trim();
      logger.info('📌 Extracted service type from branding pattern:', matchedType);
      return matchedType;
    }

    // Also check for specific vehicle/building patterns (backward compatibility)
    const vehicleMatch = desc.match(
      /(bus|auto|tempo|apartment|building|lift|elevator|residential|commercial)\s+(full|semi|back|panel|shelter|rickshaw|branding)/i,
    );
    if (vehicleMatch) {
      logger.info('📌 Extracted service type from vehicle/building pattern:', vehicleMatch[0]);
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
  const pricingSuffixPattern =
    /\s*[-–—]\s*\b(display\s+price|rental\s+price|printing\s+price|fixing\s+price|design\s+price|creative\s+price|printing\s*&?\s*fixing\s*price?|per\s+month|rate|price|\w+\s+price|\w+\s+charge)\b.*$/i;
  const seen = new Set<string>();
  const results: string[] = [];

  // Known city names to strip from multi-city description prefixes
  // e.g. "Madurai - Auto Semi Branding - Display Price" → "Auto Semi Branding - Display Price"
  const cityPrefixPattern =
    /^(chennai|madurai|coimbatore|salem|trichy|tirupur|erode|vellore|tirunelveli|bangalore|hyderabad|mumbai|delhi)\s*[-–—]\s*/i;

  for (const item of items) {
    // Strip city prefix if present before processing
    const rawDesc = item.description.replace(cityPrefixPattern, '');
    const desc = rawDesc;

    let serviceType = desc.replace(pricingSuffixPattern, '').trim();
    serviceType = serviceType.replace(/[\s\-–—&]+$/, '').trim();

    const lower = serviceType.toLowerCase();
    let extracted: string | null = null;

    if (
      lower.includes('branding') ||
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
      lower.includes('hoardings')
    ) {
      extracted = serviceType;
    }

    if (!extracted) {
      const dashMatch = desc.match(/^([^-–—]+)\s*[-–—]/);
      if (dashMatch) {
        const beforeDash = dashMatch[1].trim();
        const bdLower = beforeDash.toLowerCase();
        if (
          bdLower.includes('branding') ||
          bdLower.includes('shelter') ||
          bdLower.includes('signage') ||
          bdLower.includes('printing') ||
          bdLower.includes('ads') ||
          bdLower.includes('advertising') ||
          bdLower.includes('advertisement') ||
          bdLower.includes('screen') ||
          bdLower.includes('lobby') ||
          bdLower.includes('sticker') ||
          bdLower.includes('banner') ||
          bdLower.includes('poster') ||
          bdLower.includes('flex') ||
          bdLower.includes('standee') ||
          bdLower.includes('display') ||
          bdLower.includes('newspaper') ||
          bdLower.includes('insertion') ||
          bdLower.includes('pamphlet') ||
          bdLower.includes('leaflet') ||
          bdLower.includes('flyer') ||
          bdLower.includes('classified') ||
          bdLower.includes('mobile') ||
          bdLower.includes('van') ||
          bdLower.includes('cab') ||
          bdLower.includes('taxi') ||
          bdLower.includes('radio') ||
          bdLower.includes('metro') ||
          bdLower.includes('lamp') ||
          bdLower.includes('board')
        ) {
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
      const vehicleMatch = desc.match(
        /(bus|auto|mobile|van|cab|taxi|tempo|apartment|building|lift|elevator|residential|commercial)\s+(full|semi|back|panel|shelter|rickshaw|branding|led|non|van)(\s+[a-z]+)*/i,
      );
      if (vehicleMatch) extracted = vehicleMatch[0].trim();
    }

    if (!extracted) {
      // Newspaper / print media keywords
      const printMatch = desc.match(
        /(newspaper|insertion|pamphlet|leaflet|flyer|handbill|classified|display\s+ad|print\s+ad)(\s+[a-z]+)*/i,
      );
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
        logger.info('📌 Extracted service type:', extracted);
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
    logger.info('⚠️ No quote items provided');
    return [];
  }

  const matchedPages = new Set<number>();

  // Extract ALL unique service types from quote items
  const serviceTypes = extractAllServiceTypes(items);

  if (serviceTypes.length > 0) {
    logger.info(`🎯 Detected ${serviceTypes.length} service type(s):`, serviceTypes);

    // Loop through EACH service type and collect pages
    for (const serviceType of serviceTypes) {
      logger.info(`\n🔍 Searching pages for: "${serviceType}"`);
      const matchingPages = filterPagesByCategory(pages, serviceType);

      if (matchingPages.length > 0) {
        logger.info(`📊 Found ${matchingPages.length} pages matching "${serviceType}"`);
        // DEBUG: dump first 250 chars of each matched page so we can see what's actually on it
        matchingPages.forEach((p) => {
          logger.info(
            `   📄 Page ${p.pageNumber} text:`,
            p.text.replace(/\s+/g, ' ').substring(0, 250),
          );
        });

        // Filter to only reference pages (2/X or higher)
        const referencePages = matchingPages.filter((page) => {
          const text = page.text
            .toLowerCase()
            .replace(/\s*\|\s*/g, '')
            .replace(/\s+/g, ' ');

          // Skip pricing summary pages
          const innerCurrencyMatches = (text.match(/₹|rs\.?\s*[\d,]+|[\d,]+\.00/g) || []).length;
          const innerHasPricingCols =
            text.includes('unit price') ||
            text.includes('unit of measure') ||
            text.includes('price per') ||
            text.includes('campaign');
          const innerHasQtyCols =
            text.includes('quantity') || text.includes('min.') || text.includes('min ');
          const isPricingSummary =
            text.includes('pricing summary') ||
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

          const looksLikeReference =
            text.includes('reference image') ||
            text.includes('sample') ||
            text.includes('example') ||
            !isPricingSummary;

          return looksLikeReference;
        });

        if (referencePages.length > 0) {
          logger.info(`✅ Found ${referencePages.length} reference pages for "${serviceType}"`);
          referencePages.forEach((page) => matchedPages.add(page.pageNumber));
        } else {
          // Fallback: include all matching except (1/X) pricing pages
          const filteredMatchingPages = matchingPages.filter((page) => {
            const text = page.text
              .toLowerCase()
              .replace(/\s*\|\s*/g, '')
              .replace(/\s+/g, ' ');
            const hasFirstPagePattern = text.match(/\(1\/\d+\)/);
            return !hasFirstPagePattern;
          });
          filteredMatchingPages.forEach((page) => matchedPages.add(page.pageNumber));
        }
      } else {
        logger.info(`⚠️ No pages found for "${serviceType}"`);
      }
    }

    if (matchedPages.size > 0) {
      const result = pages.filter((page) => matchedPages.has(page.pageNumber));
      logger.info(
        `📊 Final result: ${result.length} reference pages for ${serviceTypes.length} service type(s)`,
      );
      return result;
    }
  }

  // Fallback: Process each item individually (unchanged from original)
  items.forEach((item) => {
    logger.info('🔍 Processing item:', item.description);
    const matchingPages = filterPagesByCategory(pages, item.description);

    if (matchingPages.length === 0) {
      logger.info(`⚠️ No pages found for "${item.description}"`);
      return;
    }

    // First try: ONLY pages with (2/X), (3/X), (4/X) etc. patterns (reference image pages)
    // This filters out the first page (1/X) which is usually the pricing table
    const referencePages = matchingPages.filter((page) => {
      // Clean up text: remove pipes that might split words
      const text = page.text
        .toLowerCase()
        .replace(/\s*\|\s*/g, '') // Remove pipes and surrounding spaces
        .replace(/\s+/g, ' '); // Normalize spaces

      // EXPLICIT CHECK: Exclude any page with (1/X) pattern (pricing page)
      const hasFirstPagePattern = text.match(/\(1\/\d+\)/);
      if (hasFirstPagePattern) {
        logger.info(`  ❌ Page ${page.pageNumber} - Excluded (found (1/X) pattern - pricing page)`);
        return false;
      }

      const hasReferencePattern = text.match(/\(([2-9]\d*)\/(\d+)\)/);
      if (hasReferencePattern) {
        logger.info(`  ✅ Page ${page.pageNumber} has reference pattern: (2/X) or higher`);
      }
      return hasReferencePattern;
    });

    // If we found reference pages with the pattern, use those (preferred)
    if (referencePages.length > 0) {
      logger.info(`✅ Using ${referencePages.length} reference pages with (X/Y) pattern`);
      referencePages.forEach((page) => matchedPages.add(page.pageNumber));
    } else {
      // Fallback: Include all matching pages if no (X/Y) pattern found
      // (user's PDF might not have the pattern)
      // BUT STILL exclude any (1/X) pages to avoid showing pricing pages
      logger.info(
        `⚠️ No (X/Y) pattern found for reference pages, checking all ${matchingPages.length} matching pages`,
      );

      const filteredMatchingPages = matchingPages.filter((page) => {
        const text = page.text
          .toLowerCase()
          .replace(/\s*\|\s*/g, '')
          .replace(/\s+/g, ' ');

        // EXPLICIT CHECK: Exclude any page with (1/X) pattern (pricing page)
        const hasFirstPagePattern = text.match(/\(1\/\d+\)/);
        if (hasFirstPagePattern) {
          logger.info(
            `  ❌ Page ${page.pageNumber} - Excluded from fallback (found (1/X) pattern)`,
          );
          return false;
        }
        return true;
      });

      logger.info(
        `📊 After filtering out (1/X) pages: ${filteredMatchingPages.length} pages remain`,
      );
      filteredMatchingPages.forEach((page) => matchedPages.add(page.pageNumber));
    }
  });

  const result = pages.filter((page) => matchedPages.has(page.pageNumber));
  logger.info(
    `📊 Final result: ${result.length} reference pages out of ${pages.length} total pages`,
  );

  return result;
}

// --- Smart Content Extraction Helpers ---

function extractDesignSpecFields(pages: ExtractedPage[]): SpecGroup[] {
  for (const page of pages) {
    const text = page.text;
    const specMatch =
      text.match(/display area[^\n]*design spec[^\n]*/i) ||
      text.match(/design\s*spec[^\n]*/i) ||
      text.match(/display\s*area[^\n]*/i) ||
      text.match(/specification[^\n]*/i) ||
      // Newspaper insertion specific spec headings
      text.match(/ad\s*spec[^\n]*/i) ||
      text.match(/creative\s*spec[^\n]*/i) ||
      text.match(/size\s*spec[^\n]*/i) ||
      text.match(/col\.?\s*cm[^\n]*/i) ||
      text.match(/column\s*size[^\n]*/i) ||
      text.match(/ad\s*size[^\n]*/i) ||
      text.match(/creative\s*size[^\n]*/i);
    if (!specMatch || specMatch.index === undefined) continue;
    const afterSpec = text.substring(specMatch.index + specMatch[0].length);
    const endMatch = afterSpec.match(
      /\n(reference\s*image|ad\s*visual|sample\s*ad|newspaper\s*sample|customer review|click here)/i,
    );
    const specSection =
      endMatch && endMatch.index !== undefined ? afterSpec.substring(0, endMatch.index) : afterSpec;

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

    const lines = specSection
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      // Split line on pipe separators (tab-pipe-tab, space-pipe-space, or bare pipe)
      const parts = line
        .split(/\t\|\t|\s\|\s|\|/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      if (parts.length === 1) {
        // Single column — classify by content
        const part = parts[0];
        if (/^materials?\s*:?\s*$/i.test(part)) continue;
        const colonMatch = part.match(/^([^:]{1,50}):\s*(.+)$/);
        if (colonMatch) {
          const label = colonMatch[1].trim();
          const value = colonMatch[2].trim();
          const isDim =
            /\d["'x×(]/i.test(value) ||
            /side|front|back|top|bottom|left|right|dimension|size/i.test(label);
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
          const isDim =
            /\d["'x×(]/i.test(value) ||
            /side|front|back|top|bottom|left|right|dimension|size/i.test(label);
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
const REVIEW_HEADING_PATTERN =
  /customer\s+review|client\s+review|google\s+review\s+feedback|google\s+review|review\s+feedback\s+for|testimonials?|client\s+feedback|customer\s+feedback/i;

function extractCustomerReview(pages: ExtractedPage[]): CustomerReviewData | null {
  for (const page of pages) {
    const text = page.text;
    if (!REVIEW_HEADING_PATTERN.test(text)) continue;
    const reviewMatch = text.match(
      /(?:customer review|client review|google review[^\n]*|review feedback[^\n]*|testimonials?|client feedback|customer feedback)/i,
    );
    if (!reviewMatch || reviewMatch.index === undefined) continue;
    const afterReview = text.substring(reviewMatch.index + reviewMatch[0].length);
    const lines = afterReview
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

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
      if (urlMatch) {
        reviewUrl = urlMatch[0];
        continue;
      }

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
      if (
        !reviewerName &&
        line.length <= 50 &&
        line.split(' ').length <= 5 &&
        !/^\d/.test(line) &&
        /[A-Z]/.test(line)
      ) {
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
  return pages.filter((page) => {
    const text = page.text.toLowerCase().replace(/\s*\|\s*/g, ' ');
    const hasSpec =
      text.includes('design specification') ||
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
    if (!hasSpec) return false;
    const hasRefImg =
      text.includes('reference image') ||
      text.includes('reference images') ||
      text.includes('ad visual') ||
      text.includes('sample ad') ||
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
        text.includes('creative size') ? text.indexOf('creative size') : Infinity,
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
        text.includes('newspaper sample') ? text.indexOf('newspaper sample') : Infinity,
      );
      return specPos < refPos;
    }
    return true;
  });
}

/** Pages that belong strictly under the Reference Image heading */
function getRefImagePages(pages: ExtractedPage[]): ExtractedPage[] {
  return pages.filter((page) => {
    const text = page.text.toLowerCase().replace(/\s*\|\s*/g, ' ');
    return (
      text.includes('reference image') ||
      text.includes('reference images') ||
      text.includes('referenceimage') ||
      text.includes('reference photo') ||
      text.includes('reference photos') ||
      text.includes('example image') ||
      text.includes('sample photo') ||
      // Newspaper insertion specific reference/visual headings
      text.includes('ad visual') ||
      text.includes('sample ad') ||
      text.includes('newspaper sample') ||
      text.includes('creative preview') ||
      text.includes('sample advertisement') ||
      text.includes('ad preview')
    );
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
    return (
      t.includes('reference image') ||
      t.includes('reference images') ||
      t.includes('reference photo') ||
      t.includes('reference photos') ||
      t.includes('example image') ||
      t.includes('sample photo')
    );
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
 * Extract ALL reference images from Reference Image section pages.
 * ONLY picks from pages that have "Reference Image" heading.
 * Never falls back to spec page images.
 * Returns an array so all cropped images (not just index 0) are shown.
 */
function extractRefSectionImages(pages: ExtractedPage[]): string[] {
  const refPages = getRefImagePages(pages);
  if (refPages.length === 0) return [];
  // Collect ALL cropped images from ALL ref pages
  const allCropped: string[] = [];
  for (const page of refPages) {
    if (page.croppedImages && page.croppedImages.length > 0) {
      allCropped.push(...page.croppedImages);
    }
  }
  if (allCropped.length > 0) return allCropped;
  // Fallback: full page image of first reference page (contains all photos as one tall image)
  return [refPages[0].imageDataUrl];
}

// Known city names for multi-location quote extraction
const CITY_NAMES = [
  'chennai',
  'madurai',
  'coimbatore',
  'salem',
  'trichy',
  'tiruchirappalli',
  'erode',
  'tirunelveli',
  'vellore',
  'thanjavur',
  'tiruppur',
  'hosur',
  'bangalore',
  'mumbai',
  'delhi',
  'hyderabad',
  'pune',
  'kolkata',
  'ahmedabad',
  'surat',
  'jaipur',
  'lucknow',
  'kochi',
  'vizag',
  'visakhapatnam',
  'nagpur',
  'nashik',
  'mysore',
  'mysuru',
];

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
function getPagesForCity(
  proposalPageMap: Record<string, ExtractedPage[]>,
  city: string,
): ExtractedPage[] | null {
  const key = Object.keys(proposalPageMap).find((k) => k.includes(city));
  if (key) return proposalPageMap[key];
  return null;
}

export const ReferenceImages: React.FC<ReferenceImagesProps> = ({
  proposalPages,
  proposalPageMap,
  items,
  terms = [],
  specOnly = false,
  noSpec = false,
}) => {
  // Determine which pages to use: city-isolated from map, or all flat pages
  const resolvedPages = useMemo(() => {
    if (proposalPageMap && items && items.length > 0) {
      const city = extractCityFromItems(items);
      if (city) {
        const cityPages = getPagesForCity(proposalPageMap, city);
        if (cityPages && cityPages.length > 0) {
          logger.info(`🌆 ReferenceImages: Using ${cityPages.length} pages from city "${city}"`);
          return cityPages;
        }
      }
    }
    return proposalPages;
  }, [proposalPages, proposalPageMap, items]);

  // Automatically filter pages by quote items
  const filteredPages = useMemo(() => {
    if (!resolvedPages || resolvedPages.length === 0) {
      logger.info('❌ ReferenceImages: No proposal pages available');
      return [];
    }

    logger.info('📄 ReferenceImages: Processing', resolvedPages.length, 'proposal pages');
    logger.info(
      '📋 ReferenceImages: Quote items:',
      items?.map((i) => i.description),
    );

    // Debug: Log first page text to see what we're working with
    if (resolvedPages.length > 0) {
      logger.info('📝 Sample page text:', resolvedPages[0].text.substring(0, 200));
    }

    // Automatically filter by quote items - no manual selection
    const filtered = filterPagesByQuoteItems(resolvedPages, items || []);
    logger.info('✅ ReferenceImages: Filtered to', filtered.length, 'pages');

    return filtered;
  }, [resolvedPages, items]);
  // This is separate from filteredPages so spec/ref image logic is completely unaffected.
  const reviewPages = useMemo(() => {
    if (!resolvedPages) return [];
    const filteredPageNums = new Set(filteredPages.map((p) => p.pageNumber));
    const extra = resolvedPages.filter(
      (p) => !filteredPageNums.has(p.pageNumber) && REVIEW_HEADING_PATTERN.test(p.text),
    );
    if (extra.length > 0) {
      logger.info(
        '📝 ReferenceImages: Found',
        extra.length,
        'customer review page(s) outside filtered set',
      );
    }
    return [...filteredPages, ...extra];
  }, [resolvedPages, filteredPages]);

  // Smart content extraction from parsed text — section-aware
  // specGroups and image extraction use filteredPages ONLY (unchanged behaviour)
  const specGroups = useMemo(() => extractDesignSpecFields(filteredPages), [filteredPages]);
  const hasSpecContent = specGroups.some((g) => g.fields.length > 0);
  // hasMeaningfulSpec: true only when spec table has dimension/measurement data (not just material name)
  const hasMeaningfulSpec = useMemo(() => {
    if (!hasSpecContent) return false;
    const totalFields = specGroups.reduce((sum, g) => sum + g.fields.length, 0);
    if (totalFields > 2) return true;
    const dimensionKeywords =
      /\d[\s]*["'x×(]|\b(inches|inch|cm|mm|feet|ft|size|width|height|dimension|side|driver|conductor)\b/i;
    return specGroups.some((g) =>
      g.fields.some((f) => dimensionKeywords.test(f.value) || dimensionKeywords.test(f.label)),
    );
  }, [specGroups, hasSpecContent]);
  // Spec image: only from Design Specification pages
  const specImageUrl = useMemo(() => extractSpecSectionImage(filteredPages), [filteredPages]);
  // Reference images: ALL images from Reference Image pages — never falls back to spec pages
  const refImageUrls = useMemo(() => extractRefSectionImages(filteredPages), [filteredPages]);
  // Customer review uses reviewPages (filteredPages + any customer review pages from full proposal)
  const customerReview = useMemo(() => extractCustomerReview(reviewPages), [reviewPages]);

  // Gemini OCR fallback: fires only when pdfjs text extraction couldn't get name or review body.
  // Does NOT affect filteredPages, specGroups, specImageUrl, or refImageUrl.
  const [geminiReview, setGeminiReview] = useState<{
    reviewerName: string;
    starCount: number;
    reviewText: string;
  } | null>(null);
  useEffect(() => {
    // Only run if review card data is incomplete (name fell back to "Customer" or text is empty)
    const needsOCR =
      customerReview &&
      (customerReview.reviewerName === 'Customer' || customerReview.reviewText === '');
    if (!needsOCR) {
      setGeminiReview(null);
      return;
    }

    // Find the review page image to send to Gemini
    const reviewPage = reviewPages.find((p) => REVIEW_HEADING_PATTERN.test(p.text));
    if (!reviewPage) return;

    let cancelled = false;
    logger.info('🔍 Triggering Gemini OCR for review page', reviewPage.pageNumber);
    extractReviewViaGemini(reviewPage.imageDataUrl).then((data) => {
      if (!cancelled && data) {
        logger.info('✅ Gemini review OCR result:', data);
        setGeminiReview(data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [customerReview, reviewPages]);

  // Merge: Gemini OCR fills in missing name/text; URL always comes from pdfjs text layer
  const finalReview = customerReview
    ? {
        ...customerReview,
        reviewerName: geminiReview?.reviewerName || customerReview.reviewerName,
        starCount: geminiReview?.starCount ?? customerReview.starCount,
        reviewText: geminiReview?.reviewText || customerReview.reviewText,
      }
    : null;

  // Lazy Gemini Vision crop for Reference Image section.
  // Fires only when the ref page has no croppedImages (upload-time crop was skipped or returned empty).
  // Does NOT affect spec image, customer review, or filteredPages logic.
  const [lazyCroppedRefImages, setLazyCroppedRefImages] = useState<string[]>([]);
  useEffect(() => {
    // Find the reference image page inside filteredPages (including new heading variants)
    const refPage = filteredPages.find((p) => {
      const t = p.text.toLowerCase().replace(/\s*\|\s*/g, ' ');
      return (
        t.includes('reference image') ||
        t.includes('reference images') ||
        t.includes('reference photo') ||
        t.includes('reference photos') ||
        t.includes('example image') ||
        t.includes('sample photo')
      );
    });
    // Fire lazy re-crop if:
    // - ref page has 0 cropped images (upload-time crop was skipped/empty), OR
    // - ref page has only 1 cropped image (upload-time Gemini may have missed others on the same page), OR
    // - ref page has 5+ cropped images (likely Gemini returned duplicate bounding boxes at upload time)
    // Skip only when upload found 2-4 images (reasonable range, assumed correct)
    if (!refPage) {
      setLazyCroppedRefImages([]);
      return;
    }
    const storedCount = refPage.croppedImages?.length ?? 0;
    if (storedCount >= 2 && storedCount <= 4) {
      setLazyCroppedRefImages([]);
      return;
    }
    logger.info(
      `🔁 Lazy re-crop triggered: stored count = ${storedCount} (${storedCount === 0 ? 'empty' : storedCount === 1 ? 'may have missed images' : 'suspicious duplicate count'})`,
    );
    let cancelled = false;
    logger.info('🔍 Triggering lazy Gemini Vision crop for reference page', refPage.pageNumber);
    cropReferencePageImage(refPage.imageDataUrl, refPage.pageNumber).then(async (cropped) => {
      if (cancelled) return;
      if (cropped.length > 0) {
        logger.info(
          '✅ Lazy crop: got',
          cropped.length,
          'image(s) from reference page',
          refPage.pageNumber,
        );
        setLazyCroppedRefImages(cropped);
      } else {
        // Gemini Vision returned nothing — use geometric header/footer strip as fallback
        logger.info(
          '⚠️ Gemini Vision empty, using geometric strip for reference page',
          refPage.pageNumber,
        );
        const stripped = await cropPageStrippingHeaderFooter(refPage.imageDataUrl);
        if (!cancelled) setLazyCroppedRefImages([stripped]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [filteredPages]);

  // Lazy spec section image crop.
  // Case A (shared page): spec + ref headings on same page → geometric top-half crop.
  // Case B (spec-only page with photos): spec heading only, no cropped images yet,
  //         full-page fallback is being used → Gemini Vision crop to extract vehicle photos.
  const [lazyCroppedSpecImage, setLazyCroppedSpecImage] = useState<string | null>(null);
  useEffect(() => {
    // Case A: shared page (both spec AND ref headings present)
    const sharedPage = filteredPages.find((p) => {
      const t = p.text.toLowerCase().replace(/\s*\|\s*/g, ' ');
      const hasSpec =
        t.includes('design specification') ||
        t.includes('design specifications') ||
        t.includes('design specs') ||
        t.includes('specification') ||
        t.includes('display area');
      const hasRef =
        t.includes('reference image') ||
        t.includes('reference images') ||
        t.includes('reference photo') ||
        t.includes('reference photos') ||
        t.includes('example image') ||
        t.includes('sample photo');
      return hasSpec && hasRef;
    });
    if (sharedPage) {
      let cancelled = false;
      logger.info(
        '🔍 Triggering lazy top-half crop for shared spec/ref page',
        sharedPage.pageNumber,
      );
      cropPageHalf(sharedPage.imageDataUrl, 'top').then((cropped) => {
        if (!cancelled) {
          logger.info('✅ Lazy spec top-half crop done for page', sharedPage.pageNumber);
          setLazyCroppedSpecImage(cropped);
        }
      });
      return () => {
        cancelled = true;
      };
    }

    // Case B: pure spec page with no cropped images — full-page fallback is active.
    // Use geometric header/footer strip ONLY — preserves the full SIZE CHART diagram
    // (title + vehicle + numbered arrows + measurements) intact.
    // Gemini Vision is intentionally NOT used here: it isolates photos, which destroys
    // the annotated diagram structure that is the actual spec content.
    const pureSpecPage = filteredPages.find((p) => {
      const t = p.text.toLowerCase().replace(/\s*\|\s*/g, ' ');
      const hasSpec =
        t.includes('design specification') ||
        t.includes('design specifications') ||
        t.includes('design specs') ||
        t.includes('specification') ||
        t.includes('display area');
      const hasRef =
        t.includes('reference image') ||
        t.includes('reference images') ||
        t.includes('reference photo') ||
        t.includes('reference photos') ||
        t.includes('example image') ||
        t.includes('sample photo');
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
    logger.info('🔍 30% top-cut crop for pure spec page', pureSpecPage.pageNumber);
    cropPageFromPercent(pureSpecPage.imageDataUrl, 0.13002).then((cropped) => {
      if (!cancelled) {
        logger.info('✅ 30% top-cut crop done for pure spec page', pureSpecPage.pageNumber);
        setLazyCroppedSpecImage(cropped);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [filteredPages]);

  // Lazy crop for PURE spec pages (spec heading only, no reference image heading on same page).
  // Fires when the spec page has no croppedImages — strips header/footer so only the diagram shows.
  // Does NOT affect shared pages (handled by lazyCroppedSpecImage above) or pages with croppedImages.
  const [lazyCroppedPureSpecImage, setLazyCroppedPureSpecImage] = useState<string | null>(null);
  useEffect(() => {
    const pureSpecPage = filteredPages.find((p) => {
      const t = p.text.toLowerCase().replace(/\s*\|\s*/g, ' ');
      const hasSpec =
        t.includes('design specification') ||
        t.includes('design specifications') ||
        t.includes('design specs') ||
        t.includes('specification') ||
        t.includes('display area');
      const hasRef =
        t.includes('reference image') ||
        t.includes('reference images') ||
        t.includes('reference photo') ||
        t.includes('reference photos') ||
        t.includes('example image') ||
        t.includes('sample photo');
      // Pure spec pages (no reference image heading) — always run the full-page
      // header/footer strip, because pre-cropped images may capture only the
      // first diagram strip (driver side) and miss conductor side / bus back.
      return hasSpec && !hasRef;
    });
    if (!pureSpecPage) {
      setLazyCroppedPureSpecImage(null);
      return;
    }
    let cancelled = false;
    logger.info('🔍 Triggering header/footer strip for pure spec page', pureSpecPage.pageNumber);
    cropSpecDiagram(pureSpecPage.imageDataUrl).then((cropped) => {
      if (!cancelled) {
        logger.info('✅ Pure spec page strip done for page', pureSpecPage.pageNumber);
        setLazyCroppedPureSpecImage(cropped);
      }
    });
    return () => {
      cancelled = true;
    };
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

  // Debounce: after every async state change, reset a 500 ms timer.
  // When 500 ms elapses with no further changes, all async ops have settled
  // and we can mark the section ready for PDF capture.
  useEffect(() => {
    const tid = setTimeout(() => {
      if (containerRef.current) {
        containerRef.current.setAttribute('data-pdf-ready', 'true');
      }
    }, 500);
    return () => clearTimeout(tid);
  }, [geminiReview, lazyCroppedRefImages, lazyCroppedSpecImage, lazyCroppedPureSpecImage]);
  // ─────────────────────────────────────────────────────────────────────────

  if (!resolvedPages || resolvedPages.length === 0) {
    logger.info('❌ ReferenceImages: No proposal pages, returning null');
    return null;
  }
  if (filteredPages.length === 0) {
    logger.info('⚠️ ReferenceImages: No filtered pages found');
    return null;
  }

  // specOnly: if there is no spec to display, return null so waitForPdfReady finds no element and proceeds immediately
  if (specOnly && !hasSpecContent && !specImageUrl) return null;

  const finalRefImageUrls = lazyCroppedRefImages.length > 0 ? lazyCroppedRefImages : refImageUrls;
  const showSingleCenteredRef = !specImageUrl && finalRefImageUrls.length === 1;

  logger.debug('✅ ReferenceImages: Rendering smart layout for', filteredPages.length, 'pages');

  // specOnly: render ONLY the Display Specification block (no spacer, no images, no review, no terms)
  if (specOnly) {
    return (
      <div className="smart-reference-page" ref={containerRef}>
        {(hasSpecContent || specImageUrl) && (
          <div className="smart-section" data-pdf-block="atomic">
            <h3 className="smart-section-heading">
              <span className="smart-heading-bar" />
              2. Display Specification
            </h3>
            {hasSpecContent && (
              <div className="spec-table">
                {specGroups.map((group, gi) => (
                  <React.Fragment key={gi}>
                    {group.heading && <div className="spec-group-heading">{group.heading}</div>}
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
            {specImageUrl && !hasMeaningfulSpec && (
              <div className="ref-img-container spec-img-container">
                <img
                  src={lazyCroppedSpecImage ?? lazyCroppedPureSpecImage ?? specImageUrl}
                  alt="Design specification diagram"
                  className="ref-img"
                />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="smart-reference-page" ref={containerRef}>
      <div className="pdf-top-spacer" />

      {/* Design Specification */}
      {!noSpec && (hasSpecContent || specImageUrl) && (
        <div className="smart-section" data-pdf-block="atomic">
          <h3 className="smart-section-heading">
            <span className="smart-heading-bar" />
            2. Display Specification
          </h3>
          {hasSpecContent && (
            <div className="spec-table">
              {specGroups.map((group, gi) => (
                <React.Fragment key={gi}>
                  {group.heading && <div className="spec-group-heading">{group.heading}</div>}
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
          {/* Show spec image when: no spec at all, OR spec has only minimal content (material only, no dimensions) */}
          {specImageUrl && !hasMeaningfulSpec && (
            <div className="ref-img-container spec-img-container">
              <img
                src={lazyCroppedSpecImage ?? lazyCroppedPureSpecImage ?? specImageUrl}
                alt="Design specification diagram"
                className="ref-img"
              />
            </div>
          )}
        </div>
      )}

      {/* Reference Images — each image is its own data-pdf-block so no image is ever
          sliced at a page boundary. The heading appears only on the first block. */}
      {refImageUrls.length > 0 &&
        finalRefImageUrls.map((src, idx) => (
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
              <span className="review-avatar">
                {finalReview.reviewerName.charAt(0).toUpperCase()}
              </span>
              <div className="review-meta">
                <span className="review-name">{finalReview.reviewerName}</span>
                <span className="review-stars">
                  {'★'.repeat(finalReview.starCount)}
                  {'☆'.repeat(Math.max(0, 5 - finalReview.starCount))}
                </span>
              </div>
            </div>
            {finalReview.reviewText && <p className="review-body">{finalReview.reviewText}</p>}
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
                <li key={idx}>{term}</li>
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
          {filteredPages.map((page) => (
            <div key={page.pageNumber} data-pdf-block="atomic">
              <img
                key={page.pageNumber}
                src={page.imageDataUrl}
                alt={`Page ${page.pageNumber}`}
                className="ref-img fallback-img"
                style={{ marginBottom: '20px' }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
