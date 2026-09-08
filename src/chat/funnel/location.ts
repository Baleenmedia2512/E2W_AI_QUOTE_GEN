/**
 * Funnel location — split from body.ts (Phase 8).
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
import type { ProgressiveSession, ProgressiveTurnResult } from './types';
import { STOP_WORDS, composeReply, logFunnelDebug, preferEngineCopy, stampReplyMeta, stripQtyCityDuration, titleCase } from './shared';
import { CITY_TYPO_ALIASES, PLACE_CUE_WORDS, areaDisplayKey, catalogMetroKeys, extractRealCityFromDbService, funnelCityFromDb, getAreaLabel, getCatalogLocalities, getCatalogTypeKeys, getDbCityLabel, getDirectionLabel, getFunnelAreaLabel, getLocalityFromMetaCity, getMediumKey, getMetaAreaRaw, isDirectionLikeLabel, isExactCatalogMedium, isNumericOnlyLabel, syncCatalogMetroKeys, titleCaseCityKey } from './catalog';
import { copyAskType, copyPlaceServices, copySingleServiceAtPlace, copyUnknownCity, copyUnknownPlace, preferResolvedCoveragePool, uniqueFunnelCityLabels } from './copy';
import { normalizeSegmentPhrase, parseServiceSegments, stripQuoteFiller } from './batchResolve';
import { detectMediaLocal, filterByMediumFamily } from './filterCatalog';
import { advanceFunnel } from './resolveNextStep';

export function detectUnresolvedPlaceAttempt(
  text: string,
  services: DbService[],
): string | null {
  const cleaned = stripQuoteFiller(normalizeSegmentPhrase(text)).trim();
  if (!cleaned || cleaned.length < 4) return null;
  // Already resolved or clearly a service/batch ask — not a failed place
  if (detectCityInText(cleaned, services)) return null;
  if (detectLocalityInText(cleaned, services)) return null;
  if (detectMediaLocal(cleaned, services).length > 0) return null;
  if (parseServiceSegments(cleaned, services).length >= 2) return null;
  if (detectCatalogueBrowseQuery(cleaned)) return null;

  const m = cleaned.match(
    /^\s*(?:near|around|nearby|close\s+to|at)\s+(.+?)\s*$/i,
  );
  if (!m) return null;
  const phrase = m[1]
    .replace(/\b(please|area|location|place|side|road)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (phrase.length < 3) return null;
  // If the phrase alone resolves as a place, caller should have caught it
  if (detectLocalityInText(phrase, services) || detectCityInText(phrase, services)) {
    return null;
  }
  return phrase;
}


export function replyUnresolvedPlace(
  place: string,
  services: DbService[],
  originalText: string,
  reply?: string | null,
): ProgressiveTurnResult {
  const options = uniqueMediumOnlyOptions(services).slice(0, 24);
  return {
    step: options.length ? 'pick_type' : 'no_match',
    botText: reply || copyUnknownPlace(place),
    options,
    allowMulti: options.length > 0,
    session: {
      originalText,
      qty: null,
      // Fresh session — do not keep prior Hoarding/Coimbatore locks
      pendingMedia: [],
      collectedRows: [],
      collectedServiceIds: [],
      medium: undefined,
      browseToken: undefined,
      mediumType: undefined,
      city: undefined,
      area: undefined,
      placeHint: undefined,
      directionHint: undefined,
      candidateServiceIds: undefined,
      workQueue: undefined,
      pendingCityQueue: undefined,
      segments: undefined,
    },
  };
}


export function detectCatalogueBrowseQuery(text: string): CatalogueBrowseKind | null {
  const t = (text || '').trim();
  if (!t) return null;

  if (/^services?\??$/i.test(t)) return 'services';
  if (/^(cities|locations?)\??$/i.test(t)) return 'cities';
  if (/^areas?\??$/i.test(t)) return 'areas';
  if (/^(types?|options?)\??$/i.test(t)) return 'types';

  const lower = t.toLowerCase();
  const listing =
    /\b(what|which|list|show|tell\s+me)\b/.test(lower)
    || /\b(available|availability)\b/.test(lower)
    || /\bdo you (offer|have|provide)\b/.test(lower)
    || /\bwhat('?s| is) available\b/.test(lower);

  if (!listing) return null;

  // Standalone list requests are service-catalogue browse requests.
  if (/^\s*(?:list|show)\s+all(?:\s+(?:services?|products?))?\s*[?!.]*$/i.test(t)) {
    return 'services';
  }

  // Prefer specific axis (types before services — "service types")
  if (/\b(service\s+types?|types?|variants?)\b/.test(lower)) return 'types';
  if (/\b(areas?|localit(?:y|ies)|neighbourhoods?|neighborhoods?)\b/.test(lower)) {
    return 'areas';
  }
  if (/\b(cities|city|locations?|metros?)\b/.test(lower)) return 'cities';
  if (/\b(services?|products?|media)\b/.test(lower)) return 'services';
  if (
    /\bwhat('?s| is) available\b/.test(lower)
    || /\bdo you (offer|have|provide)\b/.test(lower)
  ) {
    return 'services';
  }
  return null;
}

/** Place-only catalogue browse, e.g. "near OMR services". */

export function isPlaceServicesBrowseQuery(text: string, services: DbService[]): boolean {
  if (!/\b(?:services?|options?)\b/i.test(text)) return false;
  if (!/\b(?:in|at|near|around)\b/i.test(text)) return false;
  // A directly named service keeps its existing service-scoped behavior.
  return detectMediaLocal(text, services).length === 0;
}

/**
 * Answer catalogue questions with DB chips — picking a chip continues into the quote funnel.
 */

export function startCatalogueBrowse(
  kind: CatalogueBrowseKind,
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  const scopedCity = session.city;
  const scopedMed = session.browseToken || session.medium;
  const resolved = session.resolvedLocation;
  let pool = [...services];
  if (scopedCity) {
    pool = pool.filter((s) => serviceMatchesCityLabel(s, scopedCity, resolved));
  } else if (resolved) {
    const covered = pool.filter(
      (s) => hasQuotablePricing(s) && serviceCoversResolvedLocation(s, resolved),
    );
    const preferred = preferResolvedCoveragePool(covered, resolved);
    pool = preferred.length ? preferred : covered;
  }
  // Cities/areas/types can be scoped to a named service; "what services?" lists the full menu
  if (kind !== 'services' && scopedMed) {
    const by = filterForBrowseOrFamily(pool, scopedMed);
    if (by.length) pool = by;
  }

  if (!pool.length) {
    if (scopedCity || resolved) {
      const placeLabel =
        scopedCity
        || resolved?.town
        || resolved?.district
        || 'that place';
      return {
        step: 'no_match',
        botText: copyUnknownCity(placeLabel, session),
        options: [],
        session: stampReplyMeta(session, '', `browse:${kind}:${placeLabel}`),
      };
    }
    return softClarifyNeed(services, session, reply);
  }

  if (kind === 'services') {
    const options = uniqueMediumOnlyOptions(pool).slice(0, 40);
    if (!options.length) {
      return softClarifyNeed(services, session, reply);
    }
    const placeLabel =
      scopedCity
      || resolved?.town
      || resolved?.district
      || null;
    const { text, opener } = composeReply(session, {
      avail: placeLabel
        ? `Services available in ${placeLabel}.`
        : 'Advertising services available.',
      ask: 'Which service do you need?',
    });
    return {
      step: 'pick_type',
      botText: preferEngineCopy(reply, text),
      options,
      allowMulti: true,
      session: stampReplyMeta(
        {
          ...session,
          // Fresh service pick from catalogue
          medium: undefined,
          browseToken: undefined,
          mediumType: undefined,
          typesResolved: undefined,
          // Keep geography; sole parent city when library scoped
          city:
            scopedCity
            || (
              resolved && uniqueFunnelCityLabels(pool).size === 1
                ? [...uniqueFunnelCityLabels(pool).values()][0]
                : session.city
            ),
          resolvedLocation: resolved || undefined,
          candidateServiceIds: pool.map((s) => s.service_id),
          needsContinueConfirm: false,
        },
        opener,
      ),
    };
  }

  if (kind === 'cities') {
    const options = uniqueCityOptionsFromPool(pool, scopedMed).slice(0, 40);
    if (!options.length) {
      return {
        step: 'no_match',
        botText: composeReply(session, {
          avail: scopedMed
            ? `No cities listed for ${titleCase(scopedMed)}.`
            : 'No cities listed.',
          ask: 'Please choose a service first.',
        }).text,
        options: uniqueMediumOnlyOptions(services).slice(0, 24),
        allowMulti: true,
        session: stampReplyMeta(
          { ...session, medium: undefined, browseToken: undefined },
          '',
          `browse:cities:empty`,
        ),
      };
    }
    if (options.length === 1) {
      return advanceFunnel(
        lockOneCity(
          {
            ...session,
            medium: scopedMed ? canonicalizeServiceName(scopedMed) : session.medium,
            browseToken: scopedMed ? canonicalizeServiceName(scopedMed) : session.browseToken,
            candidateServiceIds: pool.map((s) => s.service_id),
          },
          pool,
          options[0].city || options[0].label,
        ),
        services,
        reply
          || composeReply(session, {
            avail: `${scopedMed ? `${titleCase(scopedMed)} ` : ''}available in ${options[0].label}.`,
          }).text,
      );
    }
    const { text, opener } = composeReply(session, {
      avail: scopedMed
        ? `${titleCase(scopedMed)} available in these cities.`
        : 'Available in these cities.',
      ask: 'Which city do you need?',
    });
    return {
      step: 'pick_city',
      botText: preferEngineCopy(reply, text),
      options,
      allowMulti: true,
      session: stampReplyMeta(
        {
          ...session,
          candidateServiceIds: pool.map((s) => s.service_id),
          needsContinueConfirm: false,
        },
        opener,
      ),
    };
  }

  if (kind === 'areas') {
    const options = uniqueAreaOptionsFromPool(pool, scopedCity, scopedMed).slice(0, 40);
    if (!options.length) {
      return {
        step: 'no_match',
        botText: composeReply(session, {
          avail: scopedCity
            ? `No areas listed in ${scopedCity}.`
            : 'No areas listed for that selection.',
          ask: 'Please choose a city or service.',
        }).text,
        options: scopedCity
          ? uniqueMediumOnlyOptions(pool).slice(0, 24)
          : uniqueCityOptionsFromPool(services).slice(0, 24),
        allowMulti: true,
        session: stampReplyMeta(session, '', 'browse:areas:empty'),
      };
    }
    if (options.length === 1) {
      return advanceFunnel(
        {
          ...session,
          area: options[0].label,
          placeHint: options[0].label,
          candidateServiceIds: pool.map((s) => s.service_id),
        },
        services,
        reply
          || composeReply(session, {
            avail: `Services available in ${options[0].label}.`,
          }).text,
      );
    }
    const { text, opener } = composeReply(session, {
      avail: scopedCity
        ? `Areas available in ${scopedCity}.`
        : 'Areas available.',
      ask: 'Which area do you need?',
    });
    return {
      step: 'pick_area',
      botText: preferEngineCopy(reply, text),
      options,
      allowMulti: true,
      session: stampReplyMeta(
        {
          ...session,
          candidateServiceIds: pool.map((s) => s.service_id),
          needsContinueConfirm: false,
        },
        opener,
      ),
    };
  }

  // types
  const exact = scopedMed && isExactCatalogMedium(scopedMed, services);
  const options = (
    exact
      ? uniqueTypeOnlyOptions(pool, scopedMed)
      : uniqueMediumLabelsWithExamples(pool)
  ).slice(0, 40);
  if (!options.length) {
    return startCatalogueBrowse('services', session, services, reply);
  }
  if (options.length === 1) {
    return advanceFunnel(
      {
        ...session,
        medium: canonicalizeServiceName(options[0].medium || scopedMed || ''),
        mediumType: options[0].mediumType
          ? canonicalizeServiceName(options[0].mediumType)
          : session.mediumType,
        typesResolved: true,
        browseToken: canonicalizeServiceName(options[0].medium || scopedMed || ''),
        candidateServiceIds: pool.map((s) => s.service_id),
      },
      services,
      reply,
    );
  }
  const typeAsk = copyAskType(
    scopedMed || undefined,
    session,
    scopedCity || session.city || null,
  );
  return {
    step: 'pick_type',
    botText: preferEngineCopy(reply, typeAsk),
    options,
    allowMulti: true,
    session: stampReplyMeta(
      {
        ...session,
        candidateServiceIds: pool.map((s) => s.service_id),
        needsContinueConfirm: false,
      },
      '',
    ),
  };
}

/** Labels for every collected batch line (not just the last). */

export function extractExplicitLocationPhrase(
  text: string,
  services: DbService[] = [],
): string | null {
  // Service-segment parsing has priority. If a multi-service request already
  // contains a DB-backed city (for example, both segments resolve to Chennai),
  // never reinterpret the service wording after "for" as a place.
  if (
    services.length > 0
    && parseServiceSegments(text, services).some((segment) => !!segment.city)
  ) {
    return null;
  }

  // A valid DB city later in the same quote phrase means `for` is introducing
  // services, e.g. "quote for no parking boards and hoarding in Chennai".
  // Do not reinterpret the service text before that city as a location.
  if (/\bfor\b/i.test(text) && detectCityInText(text, services)) {
    return null;
  }

  // `for` commonly introduces the requested service:
  // "quote for no parking boards and hoarding in Chennai".
  // Resolve the complete remainder before extracting a place, otherwise the
  // first service phrase can be incorrectly reported as a location.
  const stripped = stripQuoteFiller(normalizeSegmentPhrase(text));
  const forMatch = stripped.match(/\bfor\s+(.+?)\s*$/i);
  const forRemainder = forMatch?.[1]?.trim();
  if (forRemainder && services.length > 0) {
    const remainderCity = detectCityInText(forRemainder, services);
    if (
      matchSegmentHits(services, forRemainder, remainderCity)
        .length > 0
      || parseServiceSegments(forRemainder, services).length >= 1
      || isServiceLikeLocationValue(forRemainder, services)
    ) {
      return null;
    }
  }

  const match = stripped.match(
    // "for Kaniyakumari" is also a location form in quote requests
    // ("bus and auto for Kaniyakumari"). The boundary prevents duration
    // phrases such as "for 5 months" from being treated as locations.
    /\b(?:in|at|near|around|for)\s+([a-z][a-z\s.-]*?)(?=$|[,.!?]|\s+\d|\s+(?:for|with|and)\b)/i,
  );
  const value = match?.[1]?.trim().replace(/\s+/g, ' ');
  const valueKey = canonicalizeServiceName(value || '');
  const valueWords = valueKey.split(/\s+/).filter((word) => word.length >= 2);
  const isCatalogService = services.some((service) => {
    const serviceKey = canonicalizeServiceName(
      (service.service_name || '').split(/[·—–|]/)[0] || '',
    );
    if (serviceKey === valueKey) return true;
    const hay = canonicalizeServiceName(
      `${getMediumKey(service)} ${(service.service_name || '').split(/[·—–|]/)[0] || ''}`,
    ).split(/\s+/);
    return valueWords.length > 1 && valueWords.every((word) => hay.includes(word));
  });
  const isCatalogMediaPhrase =
    !!value && services.length > 0 && detectMediaLocal(value, services).length > 0;
  // "quote for Metro Station Branding" uses "for" before a service, not a
  // location. Only an unmatched phrase can continue as an explicit place.
  if (isCatalogService || isCatalogMediaPhrase) return null;
  return value && value.length >= 3 ? value : null;
}

/** A near/around phrase is an area/place request, not a city lock. */

export function extractExplicitAreaPhrase(text: string): string | null {
  const match = text.match(
    /\b(?:near|around|nearby|close\s+to)\s+([a-z][a-z\s.-]*?)(?=$|[,.!?]|\s+\d|\s+(?:for|with|and)\b)/i,
  );
  const value = match?.[1]?.trim().replace(/\s+/g, ' ');
  return value && value.length >= 3 ? value : null;
}


export function detectCityInText(text: string, services?: DbService[]): string | null {
  const all = detectCitiesInText(text, services);
  if (all[0]) return all[0];
  return null;
}

/**
 * Place name to geocode via Nominatim when not already a catalog/metro city.
 * "bus semi in puliyangudi" → Puliyangudi. Skips multi-city lists and service phrases.
 * Also: "services in avinasi" / bare "avinasi" (no media words).
 */

export function extractGeocodePlaceHint(
  text: string,
  services: DbService[],
): string | null {
  const known = detectCityInText(text, services);
  if (known) return known;
  const cleaned = stripQuoteFiller(normalizeSegmentPhrase(text)).trim();
  if (!cleaned) return null;

  const takePlace = (raw: string): string | null => {
    const place = raw.replace(/[.!?]+$/g, '').replace(/\s+/g, ' ').trim();
    if (place.length < 3) return null;
    if (/\band\b|,|&|\+/.test(place)) return null;
    if (detectMediaLocal(place, services).length > 0) return null;
    if (detectCityInText(place, services)) return detectCityInText(place, services);
    return titleCase(place);
  };

  // "services in avinasi" / "options near avinashi"
  const svcIn = cleaned.match(
    /\b(?:services?|options?)\s+(?:in|at|near|around)\s+([a-z][a-z\s.'-]{2,40}?)\s*$/i,
  );
  if (svcIn) {
    const hit = takePlace(svcIn[1]!);
    if (hit) return hit;
  }

  const m = cleaned.match(/\b(?:in|at|near)\s+([a-z][a-z\s.'-]{2,40}?)\s*$/i);
  if (m) {
    const hit = takePlace(m[1]!);
    if (hit) return hit;
  }

  // Bare place token (avinasi) — no media, no qty, short phrase
  if (
    detectMediaLocal(cleaned, services).length === 0
    && !/\d/.test(cleaned)
    && !detectCatalogueBrowseQuery(cleaned)
    && cleaned.split(/\s+/).filter(Boolean).length <= 4
    && !/\b(and|,|&|\+|quote|generate|please|hello|hi|thanks|thank)\b/i.test(cleaned)
  ) {
    return takePlace(cleaned);
  }

  return null;
}


/**
 * Match a catalog metadata.city label in free text (DB-backed only).
 * Used so non-metro inventory cities still drive CITY CHANGE, not area change.
 */

export function detectDbCityInText(text: string, services: DbService[]): string | null {
  if (!text?.trim() || !services?.length) return null;
  const lower = text.toLowerCase();
  const labels = new Map<string, string>();
  for (const s of services) {
    // Build the location vocabulary from the same DB-backed fields used by
    // city filtering. This keeps typed locations such as Dubai discoverable
    // without requiring a hardcoded city list.
    const rawLabels = [
      getDbCityLabel(s),
      funnelCityFromDb(s),
      getMetaAreaRaw(s),
    ].filter(Boolean) as string[];
    for (const raw of rawLabels) {
      if (isNumericOnlyLabel(raw) || isDirectionLikeLabel(raw)) continue;
      const key = canonicalizeServiceName(raw);
      if (!key || key.length < 3) continue;
      labels.set(key, titleCase(raw));
    }
  }
  const keys = [...labels.keys()].sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const re = new RegExp(
      `\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
      'i',
    );
    if (re.test(lower)) return labels.get(key) || null;
  }
  return null;
}

/** Cities named in text, using the active DB catalog when available. */

export function detectCitiesInText(text: string, services?: DbService[]): string[] {
  if (services?.length) syncCatalogMetroKeys(services);
  const lower = text.toLowerCase();
  type Hit = { label: string; index: number };
  const hits: Hit[] = [];
  const seen = new Set<string>();

  const consider = (raw: string, label: string) => {
    const re = new RegExp(`\\b${raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const m = re.exec(lower);
    if (!m) return;
    const k = canonicalizeServiceName(label);
    if (seen.has(k)) return;
    seen.add(k);
    hits.push({ label, index: m.index });
  };

  const keys = [...catalogMetroKeys()].sort((a, b) => b.length - a.length);
  for (const city of keys) {
    consider(city, titleCaseCityKey(city));
  }
  const typoKeys = Object.keys(CITY_TYPO_ALIASES).sort((a, b) => b.length - a.length);
  for (const typo of typoKeys) {
    const canonical = CITY_TYPO_ALIASES[typo]!;
    consider(typo, titleCaseCityKey(canonical));
  }

  // Catalog values are authoritative for non-metro cities such as Chittoor.
  // This supplements the legacy metro/typo vocabulary without inventing or
  // normalizing a DB city into another label.
  if (services?.length) {
    const dbLabels = new Map<string, string>();
    for (const service of services) {
      const label = funnelCityFromDb(service);
      if (!label) continue;
      const key = canonicalizeServiceName(label);
      if (key) dbLabels.set(key, label);
    }
    for (const [key, label] of dbLabels) {
      consider(key, label);
    }
  }

  return hits.sort((a, b) => a.index - b.index).map((h) => h.label);
}

/**
 * Shared multi-city list for the whole batch: "bus and auto in madurai and chennai".
 * Returns null for per-service cities: "cab madurai and auto in chennai".
 */

export function detectLocalityInText(text: string, services: DbService[]): string | null {
  const words = extractQueryWords(text).filter((w) => !STOP_WORDS.has(w));
  // Fast path: if this is clearly a medium/type word, never treat as locality
  if (words.length === 1) {
    const w = words[0];
    if (filterByMediumFamily(services, w).length > 0) return null;
    const mediumKeys = getCatalogTypeKeys(services).map((m) => canonicalizeServiceName(m));
    if (mediumKeys.some((m) => m === w || m.startsWith(`${w} `) || m.split(/\s+/)[0] === w)) {
      return null;
    }
  }

  const lower = text.toLowerCase();
  const keys = getCatalogLocalities(services)
    .map((l) => l.toLowerCase())
    .filter((l) => l.length >= 3 && !isNumericOnlyLabel(l))
    .sort((a, b) => b.length - a.length);
  for (const loc of keys) {
    if (new RegExp(`\\b${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower)) {
      return titleCase(loc);
    }
  }

  // Core place token after stripping "near" / "in" / … so "near ecr" → ecr → ECR Road
  const coreWords = words.filter((w) => !PLACE_CUE_WORDS.has(w));

  // Unique leading-token / prefix match against catalog localities (DB-driven only).
  // e.g. user "ecr" or "near ecr" → sole catalog area "ECR Road" when that is the only hit.
  if (coreWords.length === 1) {
    const w = coreWords[0];
    if (w.length >= 3) {
      const hits: string[] = [];
      for (const loc of keys) {
        const locKey = canonicalizeServiceName(loc);
        const first = locKey.split(/\s+/).filter(Boolean)[0] || locKey;
        if (first === w || locKey === w || locKey.startsWith(`${w} `)) {
          hits.push(titleCase(loc));
        }
      }
      const uniqKeys = [...new Set(hits.map((h) => canonicalizeServiceName(h)))];
      if (uniqKeys.length === 1) {
        return hits.find((h) => canonicalizeServiceName(h) === uniqKeys[0]) || hits[0];
      }
      // Several "Ecr …" direction-style labels — prefer a short funnel area_name.
      if (hits.length > 1) {
        const areaKeys = new Set<string>();
        for (const s of services) {
          const a = getMetaAreaRaw(s);
          if (a) areaKeys.add(canonicalizeServiceName(a));
        }
        const areaHits = hits.filter((h) => areaKeys.has(canonicalizeServiceName(h)));
        if (areaHits.length >= 1) {
          areaHits.sort(
            (a, b) => canonicalizeServiceName(a).length - canonicalizeServiceName(b).length,
          );
          const areaUniq = [...new Set(areaHits.map((h) => canonicalizeServiceName(h)))];
          if (areaUniq.length === 1) return areaHits[0];
          const roadHit = areaHits.find((h) => canonicalizeServiceName(h) === `${w} road`);
          if (roadHit) return roadHit;
          return areaHits[0];
        }
      }
    }
  }

  // Fallback: single query word appears inside area / locality only (never direction_remarks).
  // Prefer the FULL place label (Gandhi Nagar), never return the partial word alone.
  if (coreWords.length === 1) {
    const w = coreWords[0];
    if (w.length < 4) return null;
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const exact = new Set<string>();
    const partial = new Set<string>();
    for (const s of services) {
      const area = getMetaAreaRaw(s) || getLocalityFromMetaCity(s);
      if (area && re.test(area)) {
        if (canonicalizeServiceName(area) === w) exact.add(titleCase(area));
        else partial.add(titleCase(area));
      }
    }
    if (exact.size === 1) return [...exact][0];
    if (exact.size === 0 && partial.size === 1) return [...partial][0];
    return null;
  }
  return null;
}


export function poolAtLocalityForMedium(
  services: DbService[],
  medium: string | undefined,
  locality: string,
): DbService[] {
  const pool = medium ? filterForBrowseOrFamily(services, medium) : services;
  return filterByLocality(pool, locality);
}

/** True when locked city still has inventory for this medium at the named place. */

export function localityCompatibleWithCity(
  services: DbService[],
  medium: string | undefined,
  city: string,
  locality: string,
): boolean {
  const atPlace = poolAtLocalityForMedium(services, medium, locality);
  if (!atPlace.length) return false;
  return atPlace.some((s) => serviceMatchesCityLabel(s, city));
}

/**
 * When place changes to a locality outside the locked city, pick the sole DB city
 * under that place (or the city label that equals the locality, e.g. OMR).
 */

export function inferCityForLocality(
  services: DbService[],
  medium: string | undefined,
  locality: string,
): string | undefined {
  const atPlace = poolAtLocalityForMedium(services, medium, locality);
  const seen = new Set<string>();
  const cities: string[] = [];
  for (const s of atPlace) {
    const c = funnelCityFromDb(s);
    if (!c) continue;
    const k = canonicalizeServiceName(c);
    if (seen.has(k)) continue;
    seen.add(k);
    cities.push(c);
  }
  if (cities.length === 1) return cities[0];
  const locKey = canonicalizeServiceName(locality);
  return cities.find((c) => canonicalizeServiceName(c) === locKey);
}

/**
 * Road-corridor / direction fallback REMOVED — place match = city or area_name only.
 * Discard type/area ask copy when the pool is empty (would show text with no chips).
 */

export function startPlaceTypeBrowse(
  place: string,
  isMetroCity: boolean,
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  // Place-first: always list services at this place. Never keep a prior medium
  // (that caused "not providing this service in Vadapalani/ECR" with empty chips).
  const sess: ProgressiveSession = {
    ...session,
    medium: undefined,
    browseToken: undefined,
    mediumType: undefined,
    typesResolved: undefined,
    directionHint: undefined,
    workQueue: undefined,
    pendingCityQueue: undefined,
    segments: undefined,
    candidateServiceIds: undefined,
    qty: null,
    qtyByServiceId: undefined,
  };

  const resolved = session.resolvedLocation;
  let hits: DbService[] = [];
  if (resolved) {
    // Library town/district (Avinashi): list services that cover that geography,
    // preferring parent-city inventory over every statewide TN row.
    const covered = services.filter(
      (s) => hasQuotablePricing(s) && serviceCoversResolvedLocation(s, resolved),
    );
    hits = preferResolvedCoveragePool(covered, resolved);
  }
  if (!hits.length) {
    hits = isMetroCity
      ? filterByCity(services, place, resolved)
      : filterByLocality(services, place);
  }
  if (!hits.length) {
    const errKey = `place:${canonicalizeServiceName(place)}`;
    // Place-only miss → do not dump the nationwide catalogue when library said
    // the place is outside coverage (Kudiri). Offer empty / soft ask only.
    const options = resolved
      ? []
      : uniqueMediumOnlyOptions(services).slice(0, 24);
    return {
      step: options.length ? 'pick_type' : 'no_match',
      botText:
        reply
        || composeReply(sess, {
          avail: `Not providing services near ${place}.`,
          ask: options.length
            ? 'Which service do you need?'
            : 'Please try another area.',
          preferredOpeners: [''],
        }).text,
      options,
      allowMulti: options.length > 0,
      session: stampReplyMeta(
        {
          ...sess,
          city: isMetroCity ? place : sess.city,
          area: isMetroCity ? sess.area : place,
          placeHint: isMetroCity ? sess.placeHint : place,
          resolvedLocation: resolved || undefined,
        },
        '',
        errKey,
      ),
    };
  }
  // Multi-city for this place → ask DB city values (OMR / Padur / Chennai as stored)
  // Library-resolved towns: never set area=Avinashi (not in DB) — lock/ask parent cities only.
  const libraryScoped = !!resolved;
  if (!isMetroCity || libraryScoped) {
    const cityMap = uniqueFunnelCityLabels(hits);
    const cities = [...cityMap.values()];
    if (cities.length > 1) {
      const cityOpts = uniqueCityOptionsFromPool(hits);
      const { text, opener } = composeReply(sess, {
        avail: `Services near ${place} in more locations.`,
        ask: 'Which city do you need?',
      });
      return {
        step: 'pick_city',
        botText: reply || text,
        options: cityOpts,
        allowMulti: true,
        session: stampReplyMeta(
          {
            ...sess,
            area: libraryScoped ? undefined : place,
            placeHint: libraryScoped ? undefined : place,
            resolvedLocation: resolved || undefined,
            needsContinueConfirm: false,
            candidateServiceIds: hits.map((h) => h.service_id),
          },
          opener,
        ),
      };
    }
    if (cities.length === 1) {
      return advanceFunnel(
        {
          ...sess,
          area: libraryScoped ? undefined : place,
          placeHint: libraryScoped ? undefined : place,
          city: cities[0],
          resolvedLocation: resolved || undefined,
          needsContinueConfirm: !libraryScoped,
          candidateServiceIds: hits.map((h) => h.service_id),
        },
        services,
        reply || copyPlaceServices(place, sess),
        { allowAutoFinalize: false },
      );
    }
  }

  const mediumOpts = uniqueMediumOnlyOptions(hits);
  const placeReply =
    reply
    || (mediumOpts.length === 1
      ? copySingleServiceAtPlace(
        mediumOpts[0].medium || mediumOpts[0].label,
        place,
        sess,
      )
      : copyPlaceServices(place, sess));

  const soleCity =
    libraryScoped && uniqueFunnelCityLabels(hits).size === 1
      ? [...uniqueFunnelCityLabels(hits).values()][0]
      : undefined;

  return advanceFunnel(
    {
      ...sess,
      // Metro typed as city; place names stay as area/placeHint — city chips use DB values later
      // Library towns: lock sole parent city; never glue area=town.
      city: isMetroCity ? place : (soleCity || sess.city),
      area: isMetroCity || libraryScoped ? sess.area : place,
      placeHint: isMetroCity || libraryScoped ? sess.placeHint : place,
      resolvedLocation: resolved || undefined,
      medium:
        mediumOpts.length === 1
          ? canonicalizeServiceName(mediumOpts[0].medium || '')
          : undefined,
      browseToken:
        mediumOpts.length === 1
          ? canonicalizeServiceName(mediumOpts[0].medium || '')
          : undefined,
      pendingMedia: [],
      candidateServiceIds: hits.map((s) => s.service_id),
      needsContinueConfirm: !libraryScoped,
      pendingCityQueue: undefined,
      workQueue: undefined,
      collectedRows: [],
      collectedServiceIds: [],
    },
    services,
    placeReply,
    { allowAutoFinalize: false },
  );
}

/**
 * Chip thumbnail URL from DB metadata — prefer reference image, else first images[].
 * Returns undefined when none (chip stays text-only).
 */

export function isAmbiguousPlaceQuery(text: string): boolean {
  const t = text.toLowerCase();
  if (/\bbus\s*stands?\b/.test(t)) return true;
  return false;
}

/**
 * Local: single feature word (led) that hits multiple mediums via name/medium → clarify.
 * Does not trigger for clear families like "bus" when all hits share that family.
 */

export function isCityOnlyQuery(text: string, services: DbService[]): string | null {
  // "give me a quote for chennai" → strip filler first so leftover "give" never blocks
  const cleaned = stripQuoteFiller(text);
  const city = detectCityInText(cleaned, services) || detectCityInText(text, services);
  if (!city) return null;
  if (isAmbiguousPlaceQuery(cleaned) || isAmbiguousPlaceQuery(text)) return null;
  if (detectMediaLocal(cleaned, services).length > 0) return null;
  if (detectMediaLocal(text, services).length > 0) return null;
  const stripped = stripQtyCityDuration(cleaned || text, city);
  const words = extractQueryWords(stripped).filter((w) => !STOP_WORDS.has(w));
  const cityTokens = new Set(city.toLowerCase().split(/\s+/));
  const rest = words.filter((w) => !cityTokens.has(w));
  if (rest.length === 0) return city;
  if (rest.every((w) => [
    'service', 'services', 'available', 'list', 'show', 'all', 'options',
    'advertising', 'ads', 'media', 'btl', 'outdoor',
  ].includes(w))) {
    return city;
  }
  return null;
}

/** Locality-only query e.g. "saidapet" / "padur" → browse types at that place. */

export function isLocalityOnlyQuery(text: string, services: DbService[]): string | null {
  if (isCityOnlyQuery(text, services)) return null;
  // Service/medium words (apartment, bus, hoarding…) are never localities
  if (detectMediaLocal(text, services).length > 0) return null;
  if (filterByMediumFamily(services, text.trim()).length > 0) return null;

  const cleaned = stripQuoteFiller(text);
  const dirHit = detectDirectionInText(cleaned, services);
  if (dirHit) {
    const words = extractQueryWords(cleaned).filter((w) => !STOP_WORDS.has(w));
    if (words.length <= 2) return null;
  }

  const locality = detectLocalityInText(text, services);
  if (!locality) return null;
  if (isAmbiguousPlaceQuery(text)) return null;

  // If the detected "locality" is itself a known medium/type token, ignore
  const locKey = canonicalizeServiceName(locality);
  if (filterByMediumFamily(services, locKey).length > 0) return null;
  if (detectMediaLocal(locKey, services).length > 0) return null;

  // Don't treat as locality-only if user also named a clear ad medium (bus, auto, …)
  const stripped = text.replace(
    new RegExp(`\\b${locality.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'ig'),
    ' ',
  );
  const media = detectMediaLocal(stripped, services);
  if (media.length > 0) return null;
  const words = extractQueryWords(stripped).filter((w) => !STOP_WORDS.has(w));
  const locTokens = new Set(locality.toLowerCase().split(/\s+/));
  const rest = words.filter((w) => !locTokens.has(w));
  if (rest.length === 0) return locality;
  if (rest.every((w) => ['service', 'services', 'available', 'list', 'show', 'all', 'options', 'near', 'in', 'at'].includes(w))) {
    return locality;
  }
  return null;
}


export function afterLocationResolved(
  hits: DbService[],
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  return advanceFunnel(
    {
      ...session,
      candidateServiceIds: hits.length
        ? hits.map((s) => s.service_id)
        : session.candidateServiceIds,
    },
    services,
    reply,
  );
}

/**
 * Build direction picker options from direction_remarks.
 *
 * Direction values are deduplicated only within this step. They must not be
 * removed just because the same text was also stored in area_name.
 */
/**
 * True when workQueue still has another city to process (same-medium multi-city Confirm).
 * Distinguishes multi-city continuation from same-medium type leftovers (Frontlit → Nonlit).
 */

export function detectDirectionInText(
  text: string,
  services: DbService[],
  opts?: { preferArea?: string },
): { phrase: string; serviceIds: string[]; city?: string; area?: string } | null {
  const preferAreaKey = opts?.preferArea
    ? areaDisplayKey(opts.preferArea)
    : '';
  const lower = text.toLowerCase().trim();
  if (lower.length < 4) return null;
  // A city name can be a substring of direction_remarks ("towards Chennai").
  // Without an explicit site/direction cue, treat it as a city request rather
  // than selecting whichever direction happens to contain that city word.
  const hasDirectionCue =
    /\b(near|around|at|towards?|opposite|signal|road|street|junction|flyover)\b/i.test(lower);
  if (detectCityInText(lower, services) && !hasDirectionCue) {
    return null;
  }

  // "metro" / "bus" / "led" → service flow, never steal a direction that mentions the word
  const bareWords = extractQueryWords(lower).filter((w) => !STOP_WORDS.has(w));
  if (bareWords.length === 1 && isCatalogMediumToken(bareWords[0], services)) {
    logFunnelDebug('detectDirectionInText.skip', {
      text,
      reason: 'single_catalog_medium_token',
      bareWords,
    });
    return null;
  }
  // Strip catalog service/family tokens from direction scoring even when
  // detectMediaLocal misses (e.g. bare "hoarding" while catalog has "LED Hoarding").
  // Otherwise query compact becomes "hoardinggeminiflyover" and never matches DB.
  const directionIgnoredWords = new Set<string>();
  for (const media of detectMediaLocal(text, services)) {
    for (const w of directionKeys(canonicalizeServiceName(media)).words) {
      directionIgnoredWords.add(w);
    }
  }
  for (const w of bareWords) {
    if (isCatalogMediumToken(w, services)) directionIgnoredWords.add(w);
  }

  type Cand = { phrase: string; score: number; svc: DbService };
  const cands: Cand[] = [];
  const nearMisses: Array<{
    phrase: string;
    score: number;
    medium: string | null;
    area: string | null;
  }> = [];

  for (const s of services) {
    const dir = getDirectionLabel(s);
    const area = getAreaLabel(s) || getLocalityFromMetaCity(s);
    if (dir && dir.length >= 4) {
      let score = scoreDirectionMatch(text, dir, directionIgnoredWords);
      if (preferAreaKey) {
        const svcArea = areaDisplayKey(getAreaLabel(s) || getMetaAreaRaw(s) || '');
        if (svcArea && svcArea === preferAreaKey) score += 0.04;
      }
      if (isStrongDirectionMatch(score)) {
        cands.push({ phrase: dir, score, svc: s });
      } else if (score > 0) {
        nearMisses.push({
          phrase: dir,
          score,
          medium: getMediumKey(s) || null,
          area: area || null,
        });
      }
    }
    // Landmark often lives in area_name (Gemini Flyover) while direction_remarks
    // are road-level. Match area too — still DB-only, never invent places.
    if (area && area.length >= 4 && !isDirectionLikeLabel(area)) {
      const areaScore = scoreDirectionMatch(text, area, directionIgnoredWords);
      if (isStrongDirectionMatch(areaScore)) {
        cands.push({ phrase: area, score: areaScore, svc: s });
      } else if (areaScore > 0) {
        nearMisses.push({
          phrase: `area:${area}`,
          score: areaScore,
          medium: getMediumKey(s) || null,
          area,
        });
      }
    }
  }

  if (!cands.length) {
    nearMisses.sort((a, b) => b.score - a.score || b.phrase.length - a.phrase.length);
    // Also sample area_name hits that mention query tokens (direction_remarks-only miss)
    const areaSamples = services
      .map((s) => {
        const area = getAreaLabel(s) || getLocalityFromMetaCity(s);
        if (!area) return null;
        const score = scoreDirectionMatch(text, area, directionIgnoredWords);
        if (score <= 0) return null;
        return {
          area,
          score,
          medium: getMediumKey(s) || null,
          direction: getDirectionLabel(s),
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b!.score - a!.score))
      .slice(0, 5);
    logFunnelDebug('detectDirectionInText.miss', {
      text,
      ignoredWords: [...directionIgnoredWords],
      bareWords,
      topNearMisses: nearMisses.slice(0, 8),
      areaNameSamples: areaSamples,
      directionRowsScanned: services.filter((s) => !!getDirectionLabel(s)).length,
    });
    return null;
  }
  cands.sort((a, b) => b.score - a.score || b.phrase.length - a.phrase.length);
  const topScore = cands[0].score;
  // Keep near-tied catalog directions so an ambiguous request can still be
  // presented as DB-backed choices instead of guessing one direction.
  const selected = cands.filter((c) => c.score >= topScore - 0.03);
  const bestPhrase = cands[0].phrase;
  const selectedKeys = new Set(selected.map((c) => directionKeys(c.phrase).spaced));
  const byDir = services.filter((s) => {
    const d = getDirectionLabel(s);
    return !!d && selectedKeys.has(directionKeys(d).spaced);
  });
  const byArea = services.filter((s) => {
    const a = getAreaLabel(s) || getLocalityFromMetaCity(s);
    return !!a && selectedKeys.has(directionKeys(a).spaced);
  });
  const matched = selected.map((c) => c.svc);
  const all = [...(byDir.length || byArea.length ? [...byDir, ...byArea] : matched)];
  const uniq = [...new Map(all.map((s) => [s.service_id, s])).values()];
  const areas = [
    ...new Set(
      uniq.map((s) => getAreaLabel(s) || getLocalityFromMetaCity(s)).filter(Boolean) as string[],
    ),
  ];
  const hit = {
    phrase: bestPhrase,
    serviceIds: uniq.map((s) => s.service_id),
    // Never silent-set city — funnel confirms when exactly one remains
    city: undefined as string | undefined,
    area: areas.length === 1 ? areas[0] : undefined,
  };
  logFunnelDebug('detectDirectionInText.hit', {
    text,
    ignoredWords: [...directionIgnoredWords],
    phrase: hit.phrase,
    score: topScore,
    serviceCount: hit.serviceIds.length,
    areas,
    mediums: [...new Set(uniq.map((s) => getMediumKey(s)).filter(Boolean))],
  });
  return hit;
}

/** Resolve token to a single catalog medium key, or null if ambiguous/family. */

export function suggestPartialPlace(text: string, services: DbService[]): string | null {
  const q = canonicalizeServiceName(text);
  if (q.length < 3) return null;
  if (isExactLocalityQuery(text, services)) return null;

  // Prefer short area_name values for place hints (unused for DYM — kept for batch hint)
  const areaSet = new Set<string>();
  for (const s of services) {
    const area = getFunnelAreaLabel(s);
    if (area && area.split(/\s+/).length <= 4) areaSet.add(area);
    const loc = getLocalityFromMetaCity(s);
    if (loc && !isDirectionLikeLabel(loc)) areaSet.add(loc);
  }
  const places = [...areaSet]
    .map((p) => ({ raw: p, key: canonicalizeServiceName(p) }))
    .filter((p) => {
      if (p.key.length <= q.length) return false;
      if (isDirectionLikeLabel(p.raw)) return false;
      if (p.raw.split(/\s+/).length > 4) return false;
      return (
        p.key.startsWith(q)
        || p.key.includes(` ${q}`)
        || new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(p.key)
      );
    })
    .sort((a, b) => a.key.length - b.key.length || a.key.localeCompare(b.key));
  if (!places.length) return null;
  const starts = places.filter(
    (p) => p.key.startsWith(q) || p.key.includes(` ${q}`),
  );
  return (starts.length ? starts : places)[0].raw;
}


export function suggestPartialService(text: string, services: DbService[]): string | null {
  const beforePlace = text.match(
    /^(.+?)\s+(?:near|around|nearby|close\s+to|beside|at|in)\s+/i,
  );
  const focus = beforePlace ? beforePlace[1] : text;
  const candidates = [
    canonicalizeServiceName(focus),
    ...extractQueryWords(focus).filter((w) => !STOP_WORDS.has(w) && w.length >= 3),
  ].filter(Boolean);
  // Prefer longer / more specific candidates first
  const ordered = [...new Set(candidates)].sort((a, b) => b.length - a.length || a.localeCompare(b));

  for (const q of ordered) {
    if (q.length < 3) continue;
    if (GENERIC_MEDIUM_TAILS.has(q)) continue;
    if (isExactMediaQuery(q, services)) return q;
    const catalog = getCatalogTypeKeys(services)
      .map((m) => ({ raw: m, key: canonicalizeServiceName(m) }))
      .filter((m) => m.key.length > q.length && (m.key.includes(q) || m.key.split(/\s+/).includes(q)))
      .sort((a, b) => a.key.length - b.key.length);
    if (catalog.length) return catalog[0].raw;
    // browse: booth → Police Booth via name
    const browse = filterByBrowseToken(services, q);
    const mediums = uniqueMediumOnlyOptions(browse);
    if (mediums.length === 1) {
      const m = mediums[0].medium || '';
      if (canonicalizeServiceName(m) !== q) return m;
    }
  }
  return null;
}


export function buildDidYouMeanTurn(
  label: string,
  kind: 'place' | 'service',
  session: ProgressiveSession,
  serviceId?: string,
): ProgressiveTurnResult {
  return {
    step: 'did_you_mean',
    botText: `Did you mean ${titleCase(label)}?`,
    options: [
      {
        id: 'yes',
        label: 'Yes',
        serviceId,
        medium: kind === 'service' ? label : undefined,
        city: kind === 'place' ? undefined : undefined,
      },
      { id: 'no', label: 'No' },
    ],
    session: {
      ...session,
      bestGuessKind: kind,
      bestGuessLabel: titleCase(label),
      bestGuessServiceId: serviceId,
      medium: kind === 'service' ? canonicalizeServiceName(label) : session.medium,
      placeHint: kind === 'place' ? titleCase(label) : session.placeHint,
    },
  };
}

/**
 * After one city/service finishes, continue pending city queue or batch work queue.
 */

export function pickExamplePlaces(services: DbService[], n = 3): string[] {
  const cities: string[] = [];
  const seen = new Set<string>();
  for (const s of services) {
    const c = extractRealCityFromDbService(s);
    if (!c) continue;
    const key = canonicalizeServiceName(c);
    if (seen.has(key)) continue;
    seen.add(key);
    cities.push(c);
    if (cities.length >= n) return cities;
  }
  for (const loc of getCatalogLocalities(services)) {
    const key = canonicalizeServiceName(loc);
    if (seen.has(key)) continue;
    seen.add(key);
    cities.push(titleCase(loc));
    if (cities.length >= n) break;
  }
  return cities.length ? cities : ['Chennai', 'Madurai', 'Coimbatore'];
}

/**
 * Wrong / unreadable input — no wall of chips; ask again with DB examples.
 */
/**
 * True when prior turn already locked funnel fields — free text should refine, not restart.
 */
