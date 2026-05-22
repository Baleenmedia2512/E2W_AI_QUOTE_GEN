/**
 * chatHelpers.ts
 *
 * Pure helper functions extracted from ChatInterface.tsx to enable unit testing
 * without rendering the full component. These helpers have no side effects and
 * depend only on their arguments + static constants (KNOWN_CITY_LIST).
 *
 * Governance: Part 3.5 — No Scattered Business Logic.
 * The routing logic for chat message classification lives here and ONLY here.
 */

import { KNOWN_CITY_LIST } from '../../hooks/useCityServiceRegistry';
import { ActiveProposal } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Detect whether a user request is already fully specified — i.e. it contains
 * complete service names or a multi-city pattern with known cities — and
 * therefore should skip the MULTIPLE_MATCH picker and go straight to Gemini
 * as an EXACT_MATCH.
 */
export const isFullySpecifiedRequest = (userRequest: string): boolean => {
  const request = userRequest.toLowerCase();

  // Check for multi-city pattern: "CityName qty service, CityName qty service"
  // e.g. "Chennai 50 auto full branding, Madurai 100 auto semi branding"
  // Uses KNOWN_CITY_LIST to stay in sync with the rest of the app
  const commaParts = request
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (commaParts.length > 1) {
    const allPartsHaveCity = commaParts.every((part) =>
      KNOWN_CITY_LIST.some((city) => part.startsWith(city)),
    );
    if (allPartsHaveCity) {
      logger.info('✅ Client-side detection: Multi-city request detected, treating as EXACT_MATCH');
      return true;
    }
  }

  // Check if request contains complete service specifications
  // These patterns indicate the user has already specified the full service name
  const fullServicePatterns = [
    /bus full branding/i,
    /bus semi branding/i,
    /bus back panel/i,
    /auto full branding/i,
    /auto back stickers/i,
    /metro interior/i,
    /cab\s+(?:full|back|interior)/i,
    /tempo\s+(?:full|back)/i,
    /apartment\s+lift/i,
    /traffic\s+(?:awareness|signal)/i,
  ];

  // If request matches any full service pattern, it's fully specified
  const hasFullServiceName = fullServicePatterns.some((pattern) => pattern.test(request));

  if (hasFullServiceName) {
    logger.info(
      '✅ Client-side detection: Request contains full service names, will skip MULTIPLE_MATCH',
    );
    return true;
  }

  return false;
};

/**
 * Extract city names from a list of activeProposals by matching file names
 * against KNOWN_CITY_LIST. Falls back to cleaned file names when no city matched.
 */
export const getAvailableCities = (activeProposals: ActiveProposal[]): string[] => {
  const cities: string[] = [];
  activeProposals.forEach((p) => {
    const nameLower = p.fileName.toLowerCase();
    KNOWN_CITY_LIST.forEach((city) => {
      if (nameLower.includes(city) && !cities.find((c) => c.toLowerCase() === city)) {
        cities.push(city.charAt(0).toUpperCase() + city.slice(1));
      }
    });
  });
  // Fallback: if no known city matched, use cleaned file names as city labels
  if (cities.length === 0) {
    activeProposals.forEach((p) => {
      const name = p.fileName
        .replace(/\.(pdf|xlsx?)$/i, '')
        .replace(/[_-]+/g, ' ')
        .trim();
      if (!cities.includes(name)) cities.push(name);
    });
  }
  return cities;
};

/**
 * Return the first city from `cities` that appears as a substring in `text`
 * (case-insensitive). Returns null when no city is found.
 */
export const detectCityInText = (text: string, cities: string[]): string | null => {
  const lower = text.toLowerCase();
  return cities.find((c) => lower.includes(c.toLowerCase())) || null;
};

/**
 * Detect "city-only" queries — the user typed one or more known city names
 * with no service / quantity. Returns lowercase city keys (matches registry keys),
 * or [] if the query contains anything beyond city names + filler words.
 *
 * Examples that match:   "madurai" · "coimbatore" · "show services in chennai"
 *                        "madurai, trichy" · "what's available in chennai"
 * Examples that DO NOT:  "50 auto chennai" · "bus in madurai" · "chennai vs madurai"
 *
 * @param text           The cleaned user input text.
 * @param availableCities  Lowercase city names from getAvailableCities().map(c => c.toLowerCase()).
 */
export const detectCityOnlyQuery = (text: string, availableCities: string[]): string[] => {
  if (availableCities.length === 0) return [];
  if (/\d/.test(text)) return []; // any digit → not a city-only query

  const cleaned = text
    .toLowerCase()
    .replace(/[?!.,;:]/g, ' ')
    .replace(
      /\b(show|me|all|list|services?|in|for|of|the|a|an|please|what|whats|which|available|need|want|i|about|tell|give)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const cities: string[] = [];
  for (const t of tokens) {
    const match = availableCities.find((c) => c === t);
    if (!match) return []; // any non-city token disqualifies the query
    if (!cities.includes(match)) cities.push(match);
  }
  return cities;
};
