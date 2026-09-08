/**
 * Funnel copy — split from body.ts (Phase 8).
 */
import {
  ConfirmationRow,
  extractCityFromDbService,
  extractQueryWords,
  getMinQuantityFromDbService,
  geoNamesLooselyMatch,
  serviceCoversResolvedLocation,
  serviceMatchesQuery,
} from '../../utils/cloudQuoteValidation';
import { canonicalizeServiceName } from '../../utils/serviceNameUtils';
import { hasQuotablePricing, pickPreferredDbService } from '../../utils/dbPricingUtils';
import type { DbService } from '../../utils/serviceResolver';
import { formatServiceDisplayName } from '../../utils/serviceResolver';
import { getServiceScopedUserMessage, parseDurationFromUserText, toCampaignDays } from '../../utils/durationUtils';
import { resolveMediaAgainstCatalog } from '../../services/chatIntentAiService';
import {
  directionKeys,
  isStrongDirectionMatch,
  scoreDirectionMatch,
} from '../../utils/directionMatcher';
import type { ResolvedLocation } from '../../types/location';
import { STOP_WORDS, compactFunnelReply, composeReply, isCompactReply, joinNoteAndAsk, replyLines, stripQtyCityDuration, titleCase } from './shared';
import { detectCityInText } from './location';
import { catalogMetroKeys, funnelCityFromDb, getAreaLabel, getCatalogTypeKeys, getDirectionLabel, getFunnelAreaLabel, getMediumTypeFromDb, getMetaAreaRaw, isExactCatalogMedium } from './catalog';

export function copyAskType(
  token?: string | null,
  session?: ProgressiveSession | null,
  cityOverride?: string | null,
): string {
  const label = titleCase(token || 'this');
  const city = (cityOverride ?? session?.city ?? '').trim();
  return compactFunnelReply(
    `I understand you're looking for advertising services in ${label}.`,
    city
      ? `I have the below options for you in ${city}.`
      : 'I have the below options for you.',
  );
}


export function copyAskCities(
  medium?: string | null,
  session?: ProgressiveSession | null,
): string {
  const svc = titleCase(medium || 'This');
  if (session?.unresolvedPlaceOffer) {
    return composeReply(session, {
      avail: `${svc} in these places.`,
      ask: 'Which city do you need?',
    }).text;
  }
  return composeReply(session, {
    avail: `${svc} in more cities.`,
    ask: 'Which city do you need?',
  }).text;
}


export function formatPlacePrep(place: string): string {
  const cleaned = place.replace(/^near\s+/i, '').trim();
  const parts = cleaned.split(/\s*·\s*/).map((p) => p.trim()).filter(Boolean);
  const landmark = parts.find((p) => /^(omr|ecr|airport)\b/i.test(p));
  if (landmark) return `near ${landmark}`;
  if (/^(omr|ecr|airport)\b/i.test(cleaned)) return `near ${cleaned}`;
  return `in ${cleaned}`;
}


export function copyPlaceServices(
  place: string,
  session?: ProgressiveSession | null,
): string {
  return composeReply(session, {
    avail: `Services available ${formatPlacePrep(place)}.`,
    ask: 'Which service do you need?',
  }).text;
}


export function copySingleServiceAtPlace(
  service: string,
  place: string,
  session?: ProgressiveSession | null,
): string {
  return composeReply(session, {
    avail: `${titleCase(service)} available ${formatPlacePrep(place)}.`,
  }).text;
}

/**
 * Type ask at a place — still only mention city when session has a city lock.
 * Place/corridor alone does not add “in OMR” on this template (product: city or nothing).
 */

export function copyAskTypeAtPlace(
  medium: string | undefined | null,
  _place: string,
  session?: ProgressiveSession | null,
): string {
  return copyAskType(medium, session);
}

/** Type-step copy: never reuse place “which service?” reply after medium was auto-locked. */

export function isCityAskCopy(text: string | null | undefined): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  return /\bwhich\b[\s\S]*\bcity\b/i.test(t);
}


export function typeStepBotText(
  reply: string | null | undefined,
  medium: string | undefined,
  place?: string | null,
  session?: ProgressiveSession | null,
): string {
  const placeAsk =
    !!reply
    && (/which (advertising )?service/i.test(reply)
      || /following services/i.test(reply)
      || /here[’']s what we (offer|found)/i.test(reply)
      || /looking in /i.test(reply)
      || /^sure!/i.test(reply.trim())
      || /^great!/i.test(reply.trim()));
  if (place && medium && (!reply || placeAsk || isCityAskCopy(reply) || !isCompactReply(reply))) {
    return copyAskTypeAtPlace(medium, place, session);
  }
  // Place-first (avinasi): keep "Services available in … / Which service?"
  // — do not rewrite to "advertising services in This".
  if (placeAsk && reply && !medium) {
    return String(reply).trim();
  }
  if (isCompactReply(reply) && !placeAsk && !isCityAskCopy(reply)) {
    return String(reply).trim();
  }
  return copyAskType(medium, session);
}


export function copyAskArea(
  city?: string | null,
  medium?: string | null,
  session?: ProgressiveSession | null,
): string {
  const svc = titleCase(medium || 'This');
  return composeReply(session, {
    avail: city ? `${svc} in more ${city} areas.` : `${svc} in more than one area.`,
    ask: 'Which area do you need?',
  }).text;
}


export function copyAskDirection(
  locationLabel: string,
  mediumName: string,
  session?: ProgressiveSession | null,
): string {
  const loc = locationLabel || 'that area';
  const svc = titleCase(mediumName || 'This');
  return composeReply(session, {
    avail: `${svc} sites available in ${loc}.`,
    ask: 'Which location do you need?',
  }).text;
}


export function copyQuoteReady(
  session?: ProgressiveSession | null,
  rows?: ConfirmationRow[],
): string {
  const labels = [
    ...new Set(
      (rows || [])
        .map((row) => row.service.trim())
        .filter(Boolean),
    ),
  ];
  const selectedLabel =
    labels.length === 1
      ? labels[0]
      : labels.length > 1
        ? `${labels.slice(0, 3).join(', ')}${labels.length > 3 ? ` +${labels.length - 3} more` : ''}`
        : [
          session?.medium ? titleCase(session.medium) : '',
          session?.mediumType ? titleCase(session.mediumType) : '',
        ].filter(Boolean).join(' — ');
  const cities = [
    ...new Set(
      (rows || [])
        .map((row) => row.city.trim())
        .filter(Boolean),
    ),
  ];
  const cityText =
    cities.length === 1
      ? ` is available only in ${cities[0]}`
      : cities.length > 1
        ? ` is available in ${cities.join(' and ')}`
        : '';
  const availability = selectedLabel
    ? `${selectedLabel}${cityText}.`
    : 'Your quotation is ready.';
  return compactFunnelReply(
    availability,
    'Your quotation is ready.\nOpening quotation preview.',
  );
}


export function copyUnknownService(session?: ProgressiveSession | null): string {
  return composeReply(session, {
    avail: 'No matching advertising service.',
    ask: 'Please choose an option below.',
  }).text;
}

/**
 * Soft-clarify when the user's named service/place/city isn't offerable.
 * Names what they asked for, then points at the option chips.
 */

export function copyUnavailableUserAsk(
  details: { service?: string | null; site?: string | null; city?: string | null },
  session?: ProgressiveSession | null,
): string {
  const svc = details.service ? titleCase(details.service.trim()) : '';
  const site = details.site ? titleCase(details.site.trim()) : '';
  const city = details.city ? titleCase(details.city.trim()) : '';

  let what = '';
  if (svc && site) what = `${svc} near ${site}`;
  else if (svc && city) what = `${svc} in ${city}`;
  else if (site) what = `services near ${site}`;
  else if (city) what = `services in ${city}`;
  else if (svc) what = svc;

  if (!what) return copyUnknownService(session);

  return composeReply(session, {
    avail: `Not providing ${what}.`,
    ask: 'Please choose an option below.',
  }).text;
}

/**
 * Pull service + site + city labels from the user message for unavailable copy.
 * Uses catalog when possible; otherwise keeps the user's own words (e.g. "booth").
 */

export function extractUserAskDetails(
  text: string,
  services: DbService[],
  opts?: {
    media?: string[];
    directionHint?: string | null;
    city?: string | null;
    mediumHint?: string | null;
  },
): { service: string | null; site: string | null; city: string | null } {
  const media = (opts?.media || []).filter(Boolean);
  const city =
    opts?.city
    || detectCityInText(text, services)
    || null;

  let service =
    (opts?.mediumHint || '').trim()
    || (media[0] || '').trim()
    || null;

  if (!service) {
    const beforePlace = text.match(
      /^(.+?)\s+(?:near|around|nearby|close\s+to|beside|opp(?:osite)?\.?|at|in)\s+/i,
    );
    const focus = beforePlace ? beforePlace[1] : text;
    const words = extractQueryWords(stripQuoteFiller(normalizeSegmentPhrase(focus)))
      .filter((w) => !STOP_WORDS.has(w))
      .filter((w) => !/^\d+$/.test(w))
      .filter((w) => !SKIP_MEDIA_FUZZY.has(w));

    const catalogKeys = getCatalogTypeKeys(services).map((m) => canonicalizeServiceName(m));
    const catalogWords = words.filter((w) => {
      if (GENERIC_MEDIUM_TAILS.has(w)) return false;
      return catalogKeys.some((key) => {
        const parts = key.split(/\s+/);
        return parts.includes(w) || parts[0] === w || key === w;
      });
    });
    if (catalogWords.length) {
      service = catalogWords.join(' ');
    } else if (words.length) {
      // Keep user-named service token even when catalog has no match (booth, …)
      service = words.slice(0, 3).join(' ');
    }
  }

  const site = extractUnresolvedSitePhrase(
    text,
    services,
    service ? [service, ...media] : media,
    opts?.directionHint,
  );

  return {
    service: service ? canonicalizeServiceName(service) : null,
    site,
    city,
  };
}


export function copyUnknownCity(city: string, session?: ProgressiveSession | null): string {
  const key = `city:${canonicalizeServiceName(city)}`;
  if (session?.lastErrorKey === key) {
    return composeReply(session, {
      avail: `Still no services in ${city}.`,
      ask: 'Please try another city.',
    }).text;
  }
  return composeReply(session, {
    avail: `Not providing services in ${city}.`,
    ask: 'Please choose another city.',
  }).text;
}


export function copyUnknownArea(area: string, session?: ProgressiveSession | null): string {
  const key = `area:${canonicalizeServiceName(area)}`;
  if (session?.lastErrorKey === key) {
    return composeReply(session, {
      avail: `Still no match for ${area}.`,
      ask: 'Please pick another area.',
    }).text;
  }
  return composeReply(session, {
    avail: `Not providing this in ${area}.`,
    ask: 'Please choose another area.',
  }).text;
}

/** Place query failed (typo / unknown) — never keep a prior city session. */

export function copyUnknownPlace(place: string, session?: ProgressiveSession | null): string {
  const label = titleCase(place.trim()) || 'that place';
  return composeReply(session, {
    avail: `Couldn't find a place matching “${label}”.`,
    ask: 'Please choose a service below.',
  }).text;
}

/**
 * Service matched, but the named place/city/site is not in the catalogue.
 * Plain note only — prefixed once onto the next funnel ask (no extra opener).
 */

export function copyPlaceUnavailableContinue(
  service: string,
  place: string,
  prep: 'in' | 'near' = 'in',
  _session?: ProgressiveSession | null,
): string {
  const svc = titleCase(service || 'this service');
  const loc = titleCase(place.trim()) || 'that place';
  return `Not providing ${svc} ${prep} ${loc}.`;
}

/** @deprecated Use copyPlaceUnavailableContinue */

export function copySiteUnavailableContinue(
  service: string,
  site: string,
  session?: ProgressiveSession | null,
): string {
  return copyPlaceUnavailableContinue(service, site, 'near', session);
}

/** User named a place via near/in/at/flyover (not bare service-only text). */

export function hasNamedPlaceCue(text: string): boolean {
  return /\b(near|around|nearby|close\s+to|beside|opp(?:osite)?\.?|at|in|towards?|fly\s*overs?|flyovers?|junction|signal|bridge)\b/i.test(
    text,
  );
}

/** Prefer "in" when the user wrote "in …"; "near" only for landmark-style cues. */

export function placeUnavailablePrep(text: string): 'in' | 'near' {
  if (/\bin\b/i.test(text)) return 'in';
  if (
    /\b(near|around|nearby|close\s+to|beside|opp(?:osite)?\.?|towards?|fly\s*overs?|flyovers?|junction|signal|bridge)\b/i.test(
      text,
    )
  ) {
    return 'near';
  }
  return 'in';
}


export function formatAvailablePlaceList(labels: string[]): string {
  const unique = [...new Set(labels.map((l) => l.trim()).filter(Boolean))];
  if (!unique.length) return '';
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')}, and ${unique[unique.length - 1]}`;
}

/**
 * After naming an unavailable place — say where we currently offer this service.
 */

export function copyOfferWhereAvailable(
  service: string,
  placeLabels: string[],
  session?: ProgressiveSession | null,
): string {
  void service;
  if (placeLabels.length > 1) {
    return composeReply(session, {
      avail: 'Available in these cities.',
      ask: 'Which city do you need?',
    }).text;
  }
  const list = formatAvailablePlaceList(placeLabels);
  return composeReply(session, {
    avail: list ? `Available in ${list}.` : 'Available in other places.',
    ask: 'Which city do you need?',
  }).text;
}

/**
 * Place token from "in Guindy" / "near Gemini Fly Over" after stripping service words.
 * Prefer near/around/at site cues over a leading "in {city}" so
 * "hoarding in Chennai near Gemini Fly Over" → Gemini Fly Over (not "Chennai near …").
 */

export function extractPlaceIntentToken(
  text: string,
  mediaTokens: string[],
  services: DbService[],
): string | null {
  const nearM = text.match(
    /\b(?:near|around|nearby|close\s+to|beside|opp(?:osite)?\.?)\s+(.+)$/i,
  );
  const inM = text.match(/\b(?:at|in)\s+(.+)$/i);
  const m = nearM || inM;
  if (!m) return null;
  let rest = stripQuoteFiller(normalizeSegmentPhrase(m[1])).trim();
  // When we fell back to "in …", drop a leading known/DB city so site words remain
  if (!nearM && inM) {
    const leadingCity =
      detectCityInText(rest, services)
      || detectDbCityInText(rest, services);
    if (leadingCity) {
      rest = rest
        .replace(
          new RegExp(
            `^${leadingCity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
            'i',
          ),
          ' ',
        )
        .trim();
      // "Chennai near Gemini…" after stripping city → still has near-clause
      const nestedNear = rest.match(
        /\b(?:near|around|nearby|close\s+to|beside|opp(?:osite)?\.?)\s+(.+)$/i,
      );
      if (nestedNear) rest = nestedNear[1].trim();
    }
  }
  for (const media of mediaTokens) {
    const key = canonicalizeServiceName(media);
    if (!key) continue;
    rest = rest.replace(
      new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'ig'),
      ' ',
    );
  }
  const words = extractQueryWords(rest)
    .filter((w) => !STOP_WORDS.has(w))
    .filter((w) => !isCatalogMediumToken(w, services))
    .filter((w) => !GENERIC_MEDIUM_TAILS.has(w));
  if (!words.length) return null;
  return words.join(' ');
}

/**
 * True when a direction hit really is the user's named place for these rows.
 * "Towards Guindy" is NOT "in Guindy"; area/city/site name Guindy is.
 */

export function directionSatisfiesPlaceIntent(
  placeToken: string,
  hit: { phrase: string; area?: string },
  scopedServices: DbService[],
): boolean {
  let p = canonicalizeServiceName(placeToken);
  if (!p || p.length < 3) return true;

  // Strip city tokens from place intent ("chennai gemini fly over" → site words)
  for (const s of scopedServices) {
    const city = canonicalizeServiceName(funnelCityFromDb(s) || '');
    if (city && (p === city || p.startsWith(`${city} `) || p.endsWith(` ${city}`) || p.includes(` ${city} `))) {
      p = p
        .replace(new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }
  for (const metro of catalogMetroKeys()) {
    if (p === metro || p.startsWith(`${metro} `) || p.endsWith(` ${metro}`) || p.includes(` ${metro} `)) {
      p = p
        .replace(new RegExp(`\\b${metro.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }
  if (!p || p.length < 3) return true;

  const phrase = canonicalizeServiceName(hit.phrase || '');
  // Destination-style directions are not "in {place}" locks
  if (/^towards?\b/.test(phrase) && phrase !== p && !phrase.startsWith(`${p} `)) {
    const areaHit = scopedServices.some((s) => {
      const area = canonicalizeServiceName(
        getFunnelAreaLabel(s) || getAreaLabel(s) || '',
      );
      const city = canonicalizeServiceName(funnelCityFromDb(s) || '');
      return area === p || city === p;
    });
    if (!areaHit) return false;
  }

  return scopedServices.some((s) => {
    const area = canonicalizeServiceName(
      getFunnelAreaLabel(s) || getAreaLabel(s) || hit.area || '',
    );
    const city = canonicalizeServiceName(funnelCityFromDb(s) || '');
    const dir = canonicalizeServiceName(getDirectionLabel(s) || '');
    if (area === p || city === p) return true;
    if (dir === p) return true;
    // Multi-word site (Gemini Flyover) — all place words appear, not only "towards X"
    if (!/^towards?\b/.test(dir)) {
      const placeWords = p.split(/\s+/).filter((w) => w.length >= 3);
      if (
        placeWords.length
        && placeWords.every((w) => dir.includes(w) || area.includes(w))
      ) {
        return true;
      }
    }
    return false;
  });
}

/**
 * Leftover place/city/site phrase after stripping known service tokens.
 * Catalog-driven — never invents a place; only returns what the user typed.
 * Fires for "near Gemini", "in Guindy", "in Singapore", "in ghandipuram".
 */

export function extractUnresolvedSitePhrase(
  text: string,
  services: DbService[],
  mediaTokens: string[],
  intentDirectionHint?: string | null,
): string | null {
  const hinted = (intentDirectionHint || '').trim();
  if (hinted.length >= 3) {
    if (detectLocalityInText(hinted, services)) return null;
    if (detectCityInText(hinted, services)) return null;
    const dirHit = detectDirectionInText(hinted, services);
    if (dirHit) {
      const matched = services.filter((s) => dirHit.serviceIds.includes(s.service_id));
      const scoped = mediaTokens.length
        ? [...new Map(
          mediaTokens
            .flatMap((m) => filterForBrowseOrFamily(matched, m))
            .map((s) => [s.service_id, s]),
        ).values()]
        : matched;
      if (
        directionSatisfiesPlaceIntent(
          hinted,
          dirHit,
          scoped.length ? scoped : matched,
        )
      ) {
        return null;
      }
    }
    return titleCase(hinted);
  }

  if (!hasNamedPlaceCue(text)) return null;

  let rest = stripQuoteFiller(normalizeSegmentPhrase(text)).trim();
  if (!rest) return null;
  rest = stripQtyCityDuration(rest, detectCityInText(text, services));

  // Drop place prepositions so "in Guindy" / "near Gemini Fly Over" → place words
  rest = rest.replace(
    /\b(near|around|nearby|close\s+to|beside|opp(?:osite)?\.?|at|in|for|towards?)\b/gi,
    ' ',
  );

  for (const m of mediaTokens) {
    const key = canonicalizeServiceName(m);
    if (!key) continue;
    rest = rest.replace(
      new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'ig'),
      ' ',
    );
    for (const w of key.split(/\s+/)) {
      if (w.length < 3) continue;
      if (isCatalogMediumToken(w, services) || GENERIC_MEDIUM_TAILS.has(w)) {
        rest = rest.replace(
          new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'ig'),
          ' ',
        );
      }
    }
  }

  // Strip known medium_type tokens for this media family (Frontlit / Nonlit / Semi…)
  const typeKeys = new Set<string>();
  for (const m of mediaTokens) {
    for (const s of filterForBrowseOrFamily(services, m)) {
      const t = getMediumTypeFromDb(s);
      if (t) typeKeys.add(canonicalizeServiceName(t));
    }
  }
  // Also strip common type words from the media token itself (bus semi → semi)
  for (const m of mediaTokens) {
    for (const w of canonicalizeServiceName(m).split(/\s+/)) {
      if (w.length >= 3) typeKeys.add(w);
    }
  }
  for (const t of typeKeys) {
    if (t.length < 3) continue;
    rest = rest.replace(
      new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'ig'),
      ' ',
    );
  }

  const cityHit = detectCityInText(text, services);
  if (cityHit) {
    rest = rest.replace(
      new RegExp(`\\b${cityHit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'ig'),
      ' ',
    );
  }

  const words = extractQueryWords(rest)
    .filter((w) => !STOP_WORDS.has(w))
    .filter((w) => !SKIP_MEDIA_FUZZY.has(w))
    .filter((w) => !isCatalogMediumToken(w, services))
    .filter((w) => !GENERIC_MEDIUM_TAILS.has(w))
    .filter((w) => !typeKeys.has(w));
  if (!words.length) return null;
  if (words.length === 1 && words[0].length < 4) return null;

  const phrase = words.join(' ');
  if (phrase.length < 4) return null;
  if (detectLocalityInText(phrase, services)) return null;
  if (detectCityInText(phrase, services)) return null;
  // Direction substring alone ("Towards Guindy") is NOT a resolved "in Guindy"
  const dirHit = detectDirectionInText(phrase, services);
  if (dirHit) {
    const matched = services.filter((s) => dirHit.serviceIds.includes(s.service_id));
    const scoped = mediaTokens.length
      ? [...new Map(
        mediaTokens
          .flatMap((m) => filterForBrowseOrFamily(matched, m))
          .map((s) => [s.service_id, s]),
      ).values()]
      : matched;
    if (
      directionSatisfiesPlaceIntent(
        phrase,
        dirHit,
        scoped.length ? scoped : matched,
      )
    ) {
      return null;
    }
  }
  return titleCase(phrase);
}

/**
 * Build a city/area offer turn when the named place is unavailable for this service.
 * Never jumps to quote_ready. Prefer showing where we currently offer (cities/areas).
 */
/** Statewide inventory labels like "Any City In Tamilnadu" — not a real metro chip. */

export function isStatewideFunnelCityLabel(city: string): boolean {
  const k = canonicalizeServiceName(city || '');
  if (!k) return false;
  return (
    /^any\s+city\b/.test(k)
    || /\bin\s+tamil\s*nadu\b/.test(k)
    || /\bstatewide\b/.test(k)
  );
}

/**
 * Prefer DB rows whose city/area matches Nominatim town or district
 * (Avinashi → Coimbatore, Adyar → Chennai). Fall back to full covered set
 * (statewide TN) when no parent-city rows exist (Puliyangudi).
 */

export function preferResolvedCoveragePool(
  covered: DbService[],
  resolved: ResolvedLocation,
): DbService[] {
  const town = resolved.town?.trim() || '';
  const district = resolved.district?.trim() || '';
  if (!town && !district) return covered;

  const specific = covered.filter((s) => {
    const city = funnelCityFromDb(s);
    if (!city || isStatewideFunnelCityLabel(city)) return false;
    if (town && geoNamesLooselyMatch(city, town)) return true;
    if (district && geoNamesLooselyMatch(city, district)) return true;
    const area = getMetaAreaRaw(s);
    if (town && area && geoNamesLooselyMatch(area, town)) return true;
    return false;
  });
  return specific.length > 0 ? specific : covered;
}

/** Unique funnel city labels from a pool (canonicalize-deduped). */

export function uniqueFunnelCityLabels(pool: DbService[]): Map<string, string> {
  const cities = new Map<string, string>();
  for (const s of pool) {
    const city = funnelCityFromDb(s);
    if (!city) continue;
    const key = canonicalizeServiceName(city);
    if (key && !cities.has(key)) cities.set(key, city);
  }
  return cities;
}


export function buildPlaceOfferTurn(
  medium: string,
  place: string,
  session: ProgressiveSession,
  services: DbService[],
  prep: 'in' | 'near' = 'in',
): ProgressiveTurnResult {
  const medKey = canonicalizeServiceName(medium);
  const pool = filterForBrowseOrFamily(services, medKey);

  // Library hierarchy: if Nominatim says this place is in a state that statewide
  // inventory covers, continue the funnel — do not say "Not providing".
  const resolved = session.resolvedLocation;
  if (resolved) {
    const covered = pool.filter(
      (s) => hasQuotablePricing(s) && serviceCoversResolvedLocation(s, resolved),
    );
    if (covered.length > 0) {
      // Prefer parent-city inventory (Avinashi→Coimbatore) over every statewide
      // TN city. Never lock city to the raw Nominatim town — that is not a DB city
      // and caused Chennai+Coimbatore re-ask with duplicates.
      const preferred = preferResolvedCoveragePool(covered, resolved);
      const coveredCities = uniqueFunnelCityLabels(preferred);
      const soleDbCity =
        coveredCities.size === 1 ? [...coveredCities.values()][0]! : null;
      return startMediumFlow(
        medKey,
        {
          ...session,
          medium: isExactCatalogMedium(medKey, services) ? medKey : undefined,
          browseToken: medKey,
          // Only lock a real DB city label (Adyar→Chennai). Multi-city → ask later.
          city: soleDbCity || undefined,
          resolvedLocation: resolved,
          // Do not force area=Adyar/Avinashi when DB rows live under parent city —
          // that empties the pool via filterByLocality.
          area: undefined,
          placeHint: undefined,
          directionHint: undefined,
          candidateServiceIds: preferred.map((s) => s.service_id),
          unresolvedPlaceOffer: false,
          batchUnavailableNote: undefined,
          batchUnavailableSpoken: false,
          needsContinueConfirm: false,
          pendingMedia: [],
        },
        services,
      );
    }
  }

  const note = copyPlaceUnavailableContinue(medKey, place, prep, session);
  const exact = isExactCatalogMedium(medKey, services);
  const sess: ProgressiveSession = {
    ...session,
    medium: exact ? medKey : undefined,
    browseToken: medKey,
    city: undefined,
    area: undefined,
    placeHint: undefined,
    directionHint: undefined,
    candidateServiceIds: pool.map((s) => s.service_id),
    unresolvedPlaceOffer: true,
    batchUnavailableNote: note,
    batchUnavailableSpoken: false,
    needsContinueConfirm: false,
    pendingMedia: [],
  };

  const label = sess.medium || medKey;
  let cityPool = pool;
  if (sess.medium) {
    const exactPool = filterByExactMedium(pool, sess.medium);
    if (exactPool.length) cityPool = exactPool;
  }
  const cities = uniqueCityOptionsFromPool(cityPool, label);
  // Sole DB city that covers the resolved geography → continue without "Not providing"
  if (
    cities.length === 1
    && resolved
    && cityPool.some((s) => hasQuotablePricing(s) && serviceCoversResolvedLocation(s, resolved))
  ) {
    const only = cities[0]!;
    return startMediumFlow(
      label,
      {
        ...sess,
        city: only.city || only.label,
        resolvedLocation: resolved,
        unresolvedPlaceOffer: false,
        batchUnavailableNote: undefined,
        batchUnavailableSpoken: false,
        candidateServiceIds: cityPool
          .filter((s) => serviceCoversResolvedLocation(s, resolved))
          .map((s) => s.service_id),
      },
      services,
    );
  }
  if (cities.length >= 1) {
    // Named place is NOT covered (Kudiri outside TN, library miss, etc.).
    // Never auto-lock the sole statewide city into a silent quote — offer where
    // we do provide and let the user Confirm.
    const placeLabels = cities.map((c) => c.city || c.label).filter(Boolean) as string[];
    const ask = copyOfferWhereAvailable(label, placeLabels, { ...sess, medium: label });
    const noted = withBatchUnavailableNote(ask, { ...sess, medium: label });
    return {
      step: 'pick_city',
      botText: noted.botText,
      options: cities,
      allowMulti: cities.length > 1,
      session: noted.session,
    };
  }

  const areas = uniqueAreaOptionsFromPool(pool, undefined, label);
  if (areas.length >= 1) {
    const placeLabels = areas.map((a) => a.label).filter(Boolean);
    const ask = copyOfferWhereAvailable(label, placeLabels, { ...sess, medium: label });
    const noted = withBatchUnavailableNote(ask, { ...sess, medium: label });
    return {
      step: 'pick_area',
      botText: noted.botText,
      options: areas,
      allowMulti: true,
      session: noted.session,
    };
  }

  // No city/area metadata — fall back to type chips, still keep the unavailable note
  if (!exact) {
    const mediums = uniqueMediumOnlyOptions(pool);
    if (mediums.length > 1) {
      const ask = copyAskType(medKey, sess);
      const noted = withBatchUnavailableNote(ask, sess);
      return {
        step: 'pick_type',
        botText: noted.botText,
        options: mediums,
        allowMulti: true,
        session: { ...noted.session, medium: undefined, browseToken: medKey },
      };
    }
  }

  return softClarifyNeed(services, { ...sess, medium: label }, note);
}

/**
 * "near vadaplani" / "around xyz" when locality/city didn't resolve.
 * Returns the attempted place phrase, or null if this isn't a place attempt.
 */

export function copyNotOfferedInCity(
  service: string,
  city: string,
  session?: ProgressiveSession | null,
): string {
  return composeReply(session, {
    avail: `Not providing ${titleCase(service)} in ${city}.`,
  }).text;
}

/** Service missing in named city → offer cities where it *is* available. */

export function copyNotOfferedInCityAskCities(
  service: string,
  city: string,
  session?: ProgressiveSession | null,
): string {
  return composeReply(session, {
    avail: `Not providing ${titleCase(service)} in ${city}.`,
    ask: 'Which city do you need?',
  }).text;
}


export function copyGreeting(userText?: string): string {
  const greeting = /^hello\b/i.test((userText || '').trim()) ? 'Hello' : 'Hi';
  return compactFunnelReply(
    `${greeting} 👋  Which service do you need?`,
    'E.g., bus branding, cab branding, or hoarding Services',
  );
}


export function copyWhichService(session?: ProgressiveSession | null): string {
  return composeReply(session, {
    ask: 'Which service do you need?',
  }).text;
}

/**
 * Detect listing / availability questions (not a plain quote request).
 * Examples: "what services are available?", "which cities?", "areas available in chennai"
 */

export function collectedServiceLabels(
  rows: ConfirmationRow[] | undefined,
): string | null {
  if (!rows?.length) return null;
  const names = [
    ...new Set(
      rows
        .map((r) => (r.service || '').split(/[·—–]/)[0].trim())
        .filter(Boolean),
    ),
  ];
  if (!names.length) return null;
  if (names.length <= 8) return names.join(', ');
  return `${names.slice(0, 6).join(', ')} +${names.length - 6} more`;
}

/** @deprecated Prefer collectedServiceLabels for batch "Added …" copy. */

export function lastCollectedServiceLabel(
  rows: ConfirmationRow[] | undefined,
): string | null {
  return collectedServiceLabels(rows);
}

/**
 * Batch handoff: what we locked → what’s next (conversational).
 * Prefer "Now choosing …" — avoid "Next — Auto" (reads like "next auto").
 */

export function formatBatchServiceList(labels: string[]): string {
  if (labels.length <= 1) return labels[0] || 'services';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}


export function copyBatchSkipCitiesContinue(
  serviceLabels: string[],
  deadCities: string[],
  continueCity: string,
): string {
  const svc = formatBatchServiceList(serviceLabels);
  const dead = formatBatchServiceList(deadCities);
  const verb = serviceLabels.length === 1 ? "isn't" : "aren't";
  return `${svc} ${verb} in ${dead}. Continuing in ${continueCity}.`;
}


export function copyBatchStart(city: string, count: number, firstLabel: string, allLabels?: string[]): string {
  void count;
  void allLabels;
  return copyAskType(firstLabel, null, city);
}

/**
 * Batch handoff: what we locked → what’s next (conversational).
 * Prefer "Now choosing …" — avoid "Next — Auto" (reads like "next auto").
 */

export function copyBatchNextService(opts: {
  finishedLabel?: string | null;
  nextLabel: string;
  city?: string;
  remainingAfter: number;
}): string {
  void opts.finishedLabel;
  const where = opts.city ? ` in ${opts.city}` : '';
  return `Now choosing ${opts.nextLabel}${where}.`;
}


export function copyBatchStepWhy(step: ProgressiveStep | string | undefined): string {
  switch (step) {
    case 'pick_type':
      return 'I have the below options for you.';
    case 'pick_area':
      return 'Which area do you need?';
    case 'pick_direction':
      return 'Which location do you need?';
    case 'pick_city':
      return 'Which city do you need?';
    default:
      return '';
  }
}


export function withBatchStepPrompt(
  result: ProgressiveTurnResult,
  handoff: string,
): ProgressiveTurnResult {
  const trimmed = handoff.trim();
  if (!trimmed) return result;
  // Prefer short handoff + why (avoid stacking long paragraphs)
  if (result.step === 'min_qty_confirm' || result.step === 'quote_ready') {
    return result;
  }
  // Type chips → full understand + options copy (with city when locked)
  if (result.step === 'pick_type') {
    const med = result.session.browseToken || result.session.medium || '';
    const typeAsk = copyAskType(med, result.session);
    const choosing = replyLines(trimmed).find((line) => /^now choosing\b/i.test(line));
    if (choosing) {
      const city = (result.session.city || '').trim();
      const line2 = city
        ? `I have the below options for you in ${city}.`
        : 'I have the below options for you.';
      return { ...result, botText: compactFunnelReply(choosing, line2) };
    }
    // Handoff already is a full type ask / auto-added ask — keep if it matches template
    if (/i understand you'?re looking for advertising services/i.test(trimmed)) {
      return { ...result, botText: trimmed };
    }
    return { ...result, botText: typeAsk };
  }
  const why = copyBatchStepWhy(result.step);
  const choosing = replyLines(trimmed).find((line) => /^now choosing\b/i.test(line));
  // Keep the current service on line 1; put the step ask on line 2.
  if (choosing && why) {
    return { ...result, botText: compactFunnelReply(choosing, why) };
  }
  // Handoff already includes the ask ("which Bus option?")
  if (/\bwhich\b.+\boption\b/i.test(trimmed)) {
    return { ...result, botText: trimmed };
  }
  if (!why) return { ...result, botText: choosing || trimmed };
  return {
    ...result,
    botText: joinNoteAndAsk(choosing || trimmed, why),
  };
}



export function copyBatchAutoAddedThenAsk(
  autoLabels: string[],
  nextLabel: string,
  city?: string,
  allLabels?: string[],
): string {
  void allLabels;
  if (autoLabels.length) {
    const where = city ? ` in ${city}` : '';
    return compactFunnelReply(
      `${formatBatchServiceList(autoLabels)} added${where}.`,
      copyAskType(nextLabel, null, city).split('\n').slice(-1)[0],
    );
  }
  return copyAskType(nextLabel, null, city);
}


export function withBatchUnavailableNote(
  botText: string,
  session: ProgressiveSession,
): { botText: string; session: ProgressiveSession } {
  const note = (session.batchUnavailableNote || '').trim();
  if (!note || session.batchUnavailableSpoken) {
    return { botText, session };
  }
  // Avoid double-prefix if caller already included the note
  if (
    botText.includes(note)
    || /isn['’]t available in|not providing|currently not (offering|providing)/i.test(botText)
  ) {
    return {
      botText,
      session: { ...session, batchUnavailableSpoken: true },
    };
  }
  return {
    botText: joinNoteAndAsk(note, botText),
    session: { ...session, batchUnavailableSpoken: true },
  };
}


export function formatBatchUnavailableNote(city: string, missing: string[], available: string[]): string {
  const miss =
    missing.length === 1
      ? missing[0]
      : missing.length === 2
        ? `${missing[0]} and ${missing[1]}`
        : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
  const have =
    available.length === 0
      ? ''
      : available.length === 1
        ? available[0]
        : available.length === 2
          ? `${available[0]} and ${available[1]}`
          : `${available.slice(0, -1).join(', ')} and ${available[available.length - 1]}`;
  if (have) {
    return compactFunnelReply(
      `Not providing ${miss} in ${city}.`,
      have ? `Continuing with ${have}.` : undefined,
    );
  }
  return `Not providing ${miss} in ${city}.`;
}

/** Rank-1 medium exists but vendor_rate_chunks has no usable rate. */

export function copyNoCurrentPricing(labels: string[], nextLabel?: string): string {
  const miss = formatBatchServiceList(labels);
  const noun = labels.length === 1 ? 'this service' : 'these services';
  if (nextLabel) {
    return compactFunnelReply(
      `Currently no pricing for ${miss}. We can't generate a quote for ${noun} right now.`,
      `Now choosing ${nextLabel}.`,
    );
  }
  return compactFunnelReply(
    `Currently no pricing for ${miss}.`,
    `We can't generate a quote for ${noun} right now.`,
  );
}


export function minQtyConfirmBotText(
  details: Array<{ service: string; requested: number; minimum: number }>,
  stillBelow = false,
): string {
  // The warning card already shows each service, requested quantity, and
  // minimum quantity. Keep the chat response area empty to avoid duplicating
  // the same warning in a separate assistant bubble.
  return '';
  /*
  const tip = 'Or tap the pencil to edit the qty yourself.';
  if (details.length === 1) {
    const d = details[0];
    if (stillBelow) {
      return (
        `That's still below the minimum for ${d.service} `
        + `(minimum ${d.minimum.toLocaleString()}, you entered ${d.requested.toLocaleString()}).\n\n`
        + `Shall we use ${d.minimum.toLocaleString()}, or edit again?`
      );
    }
    return (
      `You asked for ${d.requested.toLocaleString()} on ${d.service}, `
      + `but the minimum is ${d.minimum.toLocaleString()}.\n\n`
      + `Shall we use the minimum so I can continue? ${tip}`
    );
  }
  if (stillBelow) {
    return `Some quantities are still below minimums.\n\nShall we use the minimums, or edit again?`;
  }
  const names = details
    .slice(0, 3)
    .map((d) => d.service)
    .join(', ');
  const extra = details.length > 3 ? ` +${details.length - 3} more` : '';
  return (
    `A few lines are below minimums (${names}${extra}).\n\n`
    + `Shall we use the minimums so I can finish your quote? ${tip}`
  );
  */
}


export function minQtyConfirmOptions(): ProgressiveOption[] {
  return [
    { id: 'yes_min', label: 'Yes, use minimums' },
    { id: 'no_min', label: "No, I'll adjust" },
  ];
}

/**
 * Apply pencil-edited qtys on a min-qty card.
 * Still below min → same-card re-ask. All OK → quote_ready with edited qtys.
 */
