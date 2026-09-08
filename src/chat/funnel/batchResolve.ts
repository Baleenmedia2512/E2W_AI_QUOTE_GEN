/**
 * Funnel batchResolve — split from body.ts (Phase 8).
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
import { FAMILY_NEEDS_ADS_WORD, STOP_WORDS, compactFunnelReply, joinNoteAndAsk, logFunnelDebug, titleCase } from './shared';
import { bestCatalogMediumForPhrase, detectExactCatalogSelection, extractRealCityFromDbService, funnelCityFromDb, getCatalogTypeKeys, getDbCityLabel, getDirectionLabel, getFunnelAreaLabel, getLocalityFromMetaCity, getMediumKey, getMediumTypeFromDb, getMetaAreaRaw, getMetaCityRaw, isExactCatalogMedium, parseQtyFromText, resolveExactMediumKey } from './catalog';
import { stripQtyCityDuration } from './shared';
import { collectedServiceLabels, copyBatchAutoAddedThenAsk, copyBatchNextService, copyBatchSkipCitiesContinue, copyBatchStart, copyNoCurrentPricing, copyUnknownCity, copyUnknownService, formatBatchServiceList, formatBatchUnavailableNote, withBatchStepPrompt, withBatchUnavailableNote } from './copy';
import { detectCitiesInText, detectCityInText, detectLocalityInText, suggestPartialPlace, suggestPartialService } from './location';
import { browseTokenVariants, detectMediaLocal, filterByBrowseToken, filterByExactMedium, filterForBrowseOrFamily, getCatalogMediumAliases, isMetroSegmentToken, isSameMediumFamily, isShortAmbiguousQuery, mergeMetroFamilyServices, serviceMatchesCityLabel, startMediumFlow, uniqueAreaOptionsFromPool, uniqueCityOptionsFromPool, uniqueMediumLabelsWithExamples, uniqueMediumOnlyOptions, uniqueTypeOnlyOptions } from './filterCatalog';
import { advanceFunnel } from './resolveNextStep';
import { buildRowsForServices, finalizeSelection } from './finalize';

export type BatchWorkItem = {
  medium: string;
  browseToken?: string;
  qty: number | null;
  city?: string;
  area?: string;
  mediumType?: string;
  candidateServiceIds?: string[];
};

export const MAX_BATCH_SEGMENTS = 20;

export function normalizeSegmentPhrase(text: string): string {
  return text
    .replace(/mobile\s*vans?/gi, 'mobile van')
    .replace(/mobilevan/gi, 'mobile van')
    .replace(/awarness/gi, 'awareness')
    .replace(/elevetaed/gi, 'elevated')
    .replace(/app?art+ment/gi, 'apartment')
    // Product alias: "apartment screen" means the lobby-screen service,
    // not the separate apartment-lift service.
    .replace(/\bapartment\s+screen\b/gi, 'apartment lobby screen')
    // Glue fixes: "2and" / "100and" / "poster2 and" → proper spaces for qty+and splits
    .replace(/(\d)\s*(and|&|\+)\s*/gi, '$1 $2 ')
    .replace(/(\d)(and|&|\+)/gi, '$1 $2 ')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function poolForBatchWork(services: DbService[], w: BatchWorkItem): DbService[] {
  let pool = w.candidateServiceIds?.length
    ? services.filter((s) => w.candidateServiceIds!.includes(s.service_id))
    : [...services];
  const token = w.browseToken || w.medium;
  if (w.medium && isExactCatalogMedium(w.medium, services)) {
    const exact = filterByExactMedium(pool, w.medium);
    if (exact.length) pool = exact;
  } else if (token) {
    const browse = filterForBrowseOrFamily(pool, token);
    if (browse.length) pool = browse;
  }
  if (w.city) {
    const scoped = pool.filter((s) => serviceMatchesCityLabel(s, w.city!));
    // City named on the work item → never fall back to other metros
    return scoped;
  }
  return pool;
}

/**
 * Auto-resolve a batch work item when every funnel step has 0/1 DB option.
 * Returns null if any step has 2+ choices (must ask the user).
 */

export function tryAutoResolveBatchWork(
  w: BatchWorkItem,
  services: DbService[],
): { reps: DbService[]; label: string; city?: string } | null {
  let pool = poolForBatchWork(services, w);
  if (!pool.length) return null;

  let medium = canonicalizeServiceName(w.medium);
  let mediumType: string | undefined;

  if (!isExactCatalogMedium(medium, services)) {
    const familyTok = canonicalizeServiceName(w.browseToken || medium);
    if (isMetroSegmentToken(familyTok)) {
      pool = mergeMetroFamilyServices(services, pool);
    }
    const mediums = uniqueMediumOnlyOptions(pool);
    if (mediums.length > 1) return null;
    if (mediums.length === 1) {
      medium = canonicalizeServiceName(mediums[0].medium || medium);
      const exact = filterByExactMedium(pool, medium);
      if (exact.length) pool = exact;
    } else {
      const familyOpts = uniqueMediumLabelsWithExamples(pool);
      if (familyOpts.length > 1) return null;
      if (familyOpts.length === 1) {
        medium = canonicalizeServiceName(familyOpts[0].medium || medium);
        mediumType = familyOpts[0].mediumType
          ? canonicalizeServiceName(familyOpts[0].mediumType)
          : undefined;
      }
    }
  }

  const types = uniqueTypeOnlyOptions(pool, medium);
  if (types.length > 1) return null;
  if (types.length === 1) {
    mediumType = canonicalizeServiceName(types[0].mediumType || types[0].label);
    const typed = pool.filter((s) => {
      const got = getMediumTypeFromDb(s);
      return !!got && canonicalizeServiceName(got) === mediumType;
    });
    if (typed.length) pool = typed;
  }

  let city = w.city;
  const cities = uniqueCityOptionsFromPool(pool, medium);
  if (!city) {
    if (cities.length > 1) return null;
    if (cities.length === 1) city = cities[0].city || cities[0].label;
  }
  if (city) {
    const scoped = pool.filter((s) => serviceMatchesCityLabel(s, city!));
    // Locked city with zero inventory → do not auto-add from another city
    if (!scoped.length) return null;
    pool = scoped;
  }

  const areas = uniqueAreaOptionsFromPool(pool, city, medium);
  if (areas.length > 1) return null;
  if (areas.length === 1) {
    const aKey = canonicalizeServiceName(areas[0].label);
    const narrowed = pool.filter(
      (s) => canonicalizeServiceName(getFunnelAreaLabel(s) || '') === aKey,
    );
    if (narrowed.length) pool = narrowed;
  }

  const withDir = pool.filter((s) => !!getDirectionLabel(s));
  const dirKeys = [
    ...new Set(
      withDir
        .map((s) => canonicalizeServiceName(getDirectionLabel(s) || ''))
        .filter(Boolean),
    ),
  ];
  if (dirKeys.length > 1) return null;

  const rep = (dirKeys.length === 1 ? withDir[0] : undefined) || pool[0];
  if (!rep) return null;

  const label = mediumType
    ? `${titleCase(medium)} — ${titleCase(mediumType)}`
    : titleCase(w.browseToken || medium);

  return { reps: [rep], label, city };
}

/**
 * Split batch work: auto-add skippable services, keep only items that need a choice.
 */

export function partitionBatchWork(
  workItems: BatchWorkItem[],
  services: DbService[],
  session: ProgressiveSession,
  qtyByServiceId: Record<string, number>,
): {
  needAsk: BatchWorkItem[];
  seedRows: ConfirmationRow[];
  seedIds: string[];
  autoLabels: string[];
} {
  const needAsk: BatchWorkItem[] = [];
  const autoLabels: string[] = [];
  let seedRows: ConfirmationRow[] = [...(session.collectedRows || [])];
  let seedIds: string[] = [...(session.collectedServiceIds || [])];

  for (const w of workItems) {
    const resolved = tryAutoResolveBatchWork(w, services);
    if (!resolved) {
      needAsk.push(w);
      continue;
    }
    autoLabels.push(resolved.label);
    const built = buildRowsForServices(
      resolved.reps,
      w.qty,
      session.durationText,
      session.originalText,
      {
        ...qtyByServiceId,
        ...Object.fromEntries(
          resolved.reps.map((r) => [r.service_id, w.qty ?? qtyByServiceId[r.service_id]]),
        ),
      },
    );
    seedRows = [...seedRows, ...built.rows];
    seedIds = [...seedIds, ...resolved.reps.map((r) => r.service_id)];
  }

  return { needAsk, seedRows, seedIds, autoLabels };
}

/**
 * Start multi-service batch: first work item enters the funnel; rest stay on workQueue.
 * Never auto-seed later services into collectedRows — process one service at a time.
 */

export function launchSequentialBatchWork(
  workItems: BatchWorkItem[],
  segments: BatchSegment[] | undefined,
  session: ProgressiveSession,
  services: DbService[],
  opts: {
    reply?: string | null;
    unavailableNote?: string;
    availLabels?: string[];
    missingLabels?: string[];
    qtyByServiceId?: Record<string, number>;
    batchUnavailableLabels?: string[];
    lockedCity?: string;
    autoLabels?: string[];
  },
): ProgressiveTurnResult {
  if (!workItems.length) {
    return {
      step: 'no_match',
      botText: opts.unavailableNote || copyUnknownService(),
      options: [],
      session,
    };
  }

  const [askFirst, ...askRest] = workItems;
  const qtyByServiceId = opts.qtyByServiceId || { ...(session.qtyByServiceId || {}) };
  const availLabels = opts.availLabels
    || workItems.map((w) => titleCase(w.browseToken || w.medium));
  const firstLabel = titleCase(askFirst.browseToken || askFirst.medium);
  const sessionCity = opts.lockedCity || askFirst.city;

  const askLine = opts.autoLabels?.length
    ? copyBatchAutoAddedThenAsk(opts.autoLabels, firstLabel, sessionCity, availLabels)
    : sessionCity
      ? copyBatchStart(sessionCity, workItems.length, firstLabel, availLabels)
      : copyBatchAutoAddedThenAsk([], firstLabel, undefined, availLabels);

  // Explicit Mobile Van variants go through the normal funnel (city auto-lock →
  // "Now choosing …"). Mid-turn auto-add left bot text on Mobile Van while
  // chips asked No Parking.

  let intro = '';
  if (opts.unavailableNote) {
    intro = joinNoteAndAsk(opts.unavailableNote, askLine);
  } else if (opts.missingLabels?.length) {
    intro = joinNoteAndAsk(`Couldn't match ${opts.missingLabels[0]}.`, askLine);
  } else {
    intro = askLine;
  }

  const exactKey = resolveExactMediumKey(askFirst.medium, services);
  const result = startMediumFlow(
    exactKey || askFirst.medium,
    {
      ...session,
      city: sessionCity,
      medium: exactKey || undefined,
      browseToken: askFirst.browseToken || askFirst.medium,
      mediumType: askFirst.mediumType,
      typesResolved: askFirst.mediumType ? true : undefined,
      qty: askFirst.qty,
      qtyByServiceId,
      segments,
      candidateServiceIds: askFirst.candidateServiceIds,
      workQueue: askRest,
      collectedRows: [...(session.collectedRows || [])],
      collectedServiceIds: [...(session.collectedServiceIds || [])],
      pendingMedia: [],
      pendingCityQueue: undefined,
      needsContinueConfirm: false,
      area: undefined,
      placeHint: undefined,
      directionHint: undefined,
      batchGroupMap: undefined,
      batchServiceLabels: availLabels,
      batchUnavailableLabels: opts.batchUnavailableLabels,
      batchUnavailableNote: opts.unavailableNote,
      batchUnavailableSpoken: false,
    },
    services,
    opts.reply || intro.trim(),
  );
  const noted = withBatchUnavailableNote(result.botText, {
    ...result.session,
    batchUnavailableNote: opts.unavailableNote || result.session.batchUnavailableNote,
    batchUnavailableSpoken: false,
  });
  // If startMediumFlow already advanced to the next batch service (e.g. Mobile Van
  // auto-locked city → Now choosing No Parking), do NOT overwrite chips' ask with
  // the stale "Starting Mobile Van…" intro.
  const resultToken = canonicalizeServiceName(
    result.session.browseToken || result.session.medium || '',
  );
  const askToken = canonicalizeServiceName(askFirst.browseToken || askFirst.medium);
  const advancedPastFirst =
    !!resultToken
    && !!askToken
    && resultToken !== askToken
    && !resultToken.startsWith(`${askToken} `)
    && !askToken.startsWith(`${resultToken} `);
  if (advancedPastFirst) {
    return {
      ...result,
      botText: noted.botText,
      session: {
        ...noted.session,
        batchServiceLabels: availLabels,
        batchUnavailableLabels: opts.batchUnavailableLabels,
        batchUnavailableNote: opts.unavailableNote,
      },
    };
  }
  const prompted = withBatchStepPrompt(
    { ...result, botText: noted.botText, session: noted.session },
    intro.trim(),
  );
  return {
    ...prompted,
    session: {
      ...prompted.session,
      batchServiceLabels: availLabels,
      batchUnavailableLabels: opts.batchUnavailableLabels,
      batchUnavailableNote: opts.unavailableNote,
    },
  };
}


export function extractExplicitSharedLocationValues(
  text: string,
  segments: BatchSegment[],
  services: DbService[],
): string[] | null {
  // Resolve the location clause before comma/and service splitting. This is
  // important for "auto and cab in madurai, dubai": Dubai is a location even
  // when it is not present in the DB and must never become a service segment.
  // Strip "quote for …" first — otherwise "give quote for bus and auto" treats
  // Bus/Auto as cities ("Not offering Bus or Auto in Bus or Auto").
  const normalized = stripQuoteFiller(normalizeSegmentPhrase(text));
  const match = normalized.match(/\b(in|at|for)\s+(.+?)\s*$/i);
  if (!match || segments.length < 2) return null;

  const preposition = (match[1] || '').toLowerCase();
  const prefix = match.index != null ? normalized.slice(0, match.index).trim() : '';
  // `for` introduces services unless a catalog service already precedes it
  // ("bus and auto for Chennai and Madurai").
  if (preposition === 'for' && detectMediaLocal(prefix, services).length === 0) {
    return null;
  }

  const clause = match[2]
    .replace(/[.!?]+$/g, '')
    .trim();
  if (!clause || /^\d+\s*(?:days?|weeks?|months?)$/i.test(clause)) return null;

  const values = clause
    .split(/\s*(?:,|\band\b|&|\+)\s*/i)
    .map((value) => value.trim())
    .filter((value) => /^[a-z][a-z\s.-]{2,}$/i.test(value));
  if (values.length < 2) return null;

  // A multi-value clause is a shared location list unless a value is a catalog
  // service / family token (bus, auto). Do not use broad browse matching for
  // unknown places such as Dubai — those must remain locations.
  if (values.some((value) => isServiceLikeLocationValue(value, services))) {
    return null;
  }

  return [...new Map(
    values.map((value) => [canonicalizeServiceName(value), titleCase(value)] as const),
  ).values()];
}


export function isServiceLikeLocationValue(value: string, services: DbService[]): boolean {
  const key = canonicalizeServiceName(value);
  if (!key) return false;
  if (FAMILY_NEEDS_ADS_WORD.has(key)) return true;
  if (isExactCatalogMedium(value, services)) return true;
  return detectMediaLocal(value, services).length > 0;
}


export function extractSharedBatchCities(
  text: string,
  segments: BatchSegment[],
  services?: DbService[],
): string[] | null {
  const explicitLocations = services
    ? extractExplicitSharedLocationValues(text, segments, services)
    : null;
  if (explicitLocations?.length) return explicitLocations;

  const cities = detectCitiesInText(text, services);
  if (cities.length < 2) return null;

  const segsWithCity = segments.filter((s) => !!s.city);
  const uniqueSegCities = [
    ...new Map(
      segsWithCity.map((s) => [canonicalizeServiceName(s.city!), s.city!] as const),
    ).values(),
  ];
  // Different services already tagged with different cities → per-segment
  // (e.g. "cab madurai and auto in chennai"), even if another segment has no city.
  if (uniqueSegCities.length >= 2) {
    return null;
  }
  return cities;
}

/** Cache localities per services array identity (avoids rebuild on every detect). */

/** Distinct localities / areas from DB (Padur, Saidapet, … — not metro cities or service types). */


/** Normalize joined spellings only for service-list parsing. */

export function normalizeSegmentServiceWords(text: string): string {
  return text
    .replace(/\blamp[\s-]?post\b/gi, 'lamp post')
    .replace(/\blampost\b/gi, 'lamp post');
}

/** Match DB rows for a multi-word segment token (e.g. "bus semi", "apartment lift"). */

export function matchSegmentHits(
  services: DbService[],
  token: string,
  city: string | null,
  resolvedLocation?: ResolvedLocation | null,
): DbService[] {
  const words = canonicalizeServiceName(normalizeSegmentPhrase(token))
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  if (!words.length) return [];

  // Narrow pool first (avoid O(all services × regex) on mega multi-service messages)
  let pool = services;
  const family = words[0];
  if (family.length >= 3) {
    const familyHits = filterForBrowseOrFamily(services, family);
    if (familyHits.length > 0 && familyHits.length < services.length) {
      pool = familyHits;
    }
  }

  const variantsByWord = words.map((w) => browseTokenVariants(w, services));
  let hits = pool.filter((s) => {
    const hay = canonicalizeServiceName(
      `${getMediumKey(s)} ${(s.service_name || '').split(/[·—–|]/)[0] || ''} ${s.service_id || ''}`,
    );
    return variantsByWord.every((variants) =>
      variants.some((v) => hay.includes(v)),
    );
  });

  if (!hits.length) {
    hits = filterByBrowseToken(services, words.join(' '));
  }
  // Do not fall back from a qualified phrase to its first family word.
  // "apartment screen" must not broaden into every Apartment service,
  // while a bare "apartment" query is handled by the family browse path.

  // Safe service-phrase fallback: when the user supplies the vehicle plus a
  // catalog qualifier ("auto sticker"), match every meaningful word against
  // the exact DB service row. This is deliberately before the city filter and
  // never invents a missing service; multiple matching rows remain multiple
  // choices for the normal funnel.
  if (words.length > 1) {
    const qualifiedHits = pool.filter((s) => {
      const hay = canonicalizeServiceName(
        `${getMediumKey(s)} ${(s.service_name || '').split(/[·—–|]/)[0] || ''}`,
      );
      return words.every((word) => hay.split(/\s+/).includes(word));
    });
    if (qualifiedHits.length > 0) {
      hits = qualifiedHits;
    } else if (words.length >= 3) {
      // User named a longer product ("bus semi wrap") that no row fully covers —
      // do not keep looser bus+semi siblings (Bus Semi Branding).
      hits = hits.filter((s) => {
        const hay = canonicalizeServiceName(
          `${getMediumKey(s)} ${(s.service_name || '').split(/[·—–|]/)[0] || ''}`,
        );
        return words.every((word) => hay.includes(word));
      });
    }
  }

  // Strict city lock: empty = not offered in this city (do not fall back to all cities).
  // Pass Nominatim hierarchy so statewide TN rows cover Chennai / Madurai / etc.
  if (city) {
    hits = hits.filter((s) =>
      serviceMatchesCityLabel(s, city, resolvedLocation, services),
    );
  }

  // "metro" segment → include Train Inside / Train Wrap even without the word "metro"
  if (isMetroSegmentToken(words.join(' ')) || isMetroSegmentToken(token)) {
    hits = mergeMetroFamilyServices(services, hits);
    if (city) {
      hits = hits.filter((s) =>
        serviceMatchesCityLabel(s, city, resolvedLocation, services),
      );
    }
  }
  return hits;
}

/** Drop "need a quote for / i want / please" filler so segments become "bus", not "need a quote for bus". */

export function stripQuoteFiller(text: string): string {
  return text
    .replace(/\baquotes?\b/gi, 'quote')
    .replace(
      /\b((i\s+)?(need|want|looking\s+for|give(\s+me)?|get(\s+me)?|please)\s+)?(a\s+)?(quote|quotation|price|rates?)\s+(for|of)\b/gi,
      ' ',
    )
    .replace(/\b(i\s+)?(need|want|looking\s+for)\b/gi, ' ')
    .replace(/\b(please|kindly)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compact segment token to catalog media (bus / auto) — never keep filler phrases. */

export function refineSegmentToken(raw: string, services: DbService[]): string {
  const cleaned = stripQuoteFiller(raw)
    // Qty prefixes ("200 lamp post…") must not block catalog phrase match
    .replace(/^\d+\s*/u, '')
    .replace(/\b\d+\s*(days?|months?|weeks?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cleanedKey = canonicalizeServiceName(cleaned);
  if (!cleanedKey) return cleanedKey;

  // Exact catalog medium key match
  const exactCatalogMedium = getCatalogTypeKeys(services).find(
    (medium) => canonicalizeServiceName(medium) === cleanedKey,
  );
  if (exactCatalogMedium) return exactCatalogMedium;

  // Longest unambiguous catalog medium covered by this phrase.
  // "lamp post sun pack with reeper" → Lamp Post Boards (Sun Pack) - With Reeper
  // "bus semi wrap" → Bus Semi Wrap (not Bus Semi Branding)
  // Ambiguous short families ("lamp post", "bus semi") stay unresolved → ask.
  const phraseHit = bestCatalogMediumForPhrase(cleanedKey, services);
  if (phraseHit) return phraseHit;

  const media = detectMediaLocal(cleaned, services);
  if (media.length >= 1) {
    const mediaKey = canonicalizeServiceName(media[0]);
    // Keep catalog qualifiers such as "sticker", "semi", or "back".
    // Previously "auto stickers" became only "auto" here, so the exact
    // catalog service "Auto Back Sticker" could never be selected.
    if (cleanedKey === mediaKey) return media[0];
  }
  const words = canonicalizeServiceName(cleaned)
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  if (words.length) {
    const joined = words.join(' ');
    const again = detectMediaLocal(joined, services);
    if (again.length >= 1) return again[0];
    return joined;
  }
  return cleanedKey;
}

/**
 * Resolve a multi-word user phrase to one catalog medium when the match is unique.
 * Requires 2+ query words so bare family tokens (bus / lamp) still ask.
 * @see bestCatalogMediumForPhrase in ./catalog
 */

export function extractUnknownExplicitSegmentCity(
  part: string,
  services: DbService[],
): string | null {
  const match = part.match(/\b(?:in|at|near|for)\s+([a-z][a-z\s.-]*?)\s*$/i);
  const value = match?.[1]?.trim().replace(/\s+/g, ' ');
  if (!value || value.length < 3 || /^\d+\s*(?:days?|weeks?|months?)$/i.test(value)) {
    return null;
  }
  if (detectCityInText(value, services) || detectLocalityInText(value, services)) {
    return null;
  }
  if (detectMediaLocal(value, services).length > 0) return null;
  return titleCase(value);
}

/**
 * Split "50 bus semi and 10 bus shelter and auto 100" into qty+token segments.
 * Returns [] when the message is not a multi-service list.
 * Shared city ("bus and auto in chennai") applies only when exactly one metro
 * is named across parts. Mixed ("cab madurai and auto in chennai") keeps per-part cities.
 * Unknown short tokens (e.g. trailing "gandhi") are omitted from segments
 * and returned via extractBatchPlaceHint().
 */

export function parseServiceSegments(text: string, services: DbService[]): BatchSegment[] {
  const normalized = normalizeSegmentServiceWords(
    stripQuoteFiller(normalizeSegmentPhrase(text)),
  );
  // For a shared location list, remove the location suffix before splitting
  // service clauses. Otherwise "Dubai" in "... Chennai, Madurai, and Dubai"
  // becomes a fake service segment.
  const sharedLocationMatch = normalized.match(/\b(in|at|for)\s+(.+?)\s*$/i);
  const sharedLocationPrefix = sharedLocationMatch?.index != null
    ? normalized.slice(0, sharedLocationMatch.index).trim()
    : '';
  const sharedLocationPreposition = sharedLocationMatch?.[1]?.toLowerCase();
  const sharedLocationValues = sharedLocationMatch?.[1]
    ?.replace(/[.!?]+$/g, '')
    .split(/\s*(?:,|\band\b|&|\+)\s*/i)
    .map((value) => value.trim())
    .filter((value) => /^[a-z][a-z\s.-]{2,}$/i.test(value)) || [];
  const hasSharedLocationSuffix =
    sharedLocationValues.length >= 2
    && !sharedLocationValues.some((value) => isServiceLikeLocationValue(value, services))
    // "quote for service A and service B in Chennai" is a service phrase,
    // not a shared location suffix. `for` is a location cue only when the
    // preceding text already contains a catalog service.
    && (
      sharedLocationPreposition !== 'for'
      || detectMediaLocal(sharedLocationPrefix, services).length > 0
    );
  const serviceText = hasSharedLocationSuffix && sharedLocationMatch?.index != null
    ? normalized.slice(0, sharedLocationMatch.index).trim()
    : normalized;
  const parts = serviceText
    .split(/\s*(?:\band\b|,|&|\+)\s*/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 1);
  if (parts.length < 2) {
    logFunnelDebug('parseServiceSegments', {
      text,
      normalized,
      sharedLocationPreposition,
      sharedLocationPrefix,
      sharedLocationValues,
      hasSharedLocationSuffix,
      parts,
      partsJson: JSON.stringify(parts),
      segmentsJson: '[]',
      segments: [],
    });
    return [];
  }

  // City per part only. Shared city applies when exactly ONE metro is named across parts
  // ("bus and auto in chennai"). Mixed ("cab madurai and auto in chennai") → no smear.
  const partCities = parts.map(
    (p) => detectCityInText(p, services) || extractUnknownExplicitSegmentCity(p, services),
  );
  // A city clause applies to the service terms immediately before it:
  // "apartment and police in Dubai" means both services are for Dubai.
  // Fill only backwards to the previous explicit city boundary, preserving
  // mixed requests such as "police in Dubai and bus in Madurai".
  for (let i = 0; i < parts.length; i++) {
    if (!partCities[i]) continue;
    let j = i - 1;
    while (j >= 0 && !partCities[j]) {
      partCities[j] = partCities[i];
      j -= 1;
    }
  }
  const uniquePartCityKeys = [
    ...new Set(
      partCities
        .filter((c): c is string => !!c)
        .map((c) => canonicalizeServiceName(c)),
    ),
  ];
  const sharedCity =
    uniquePartCityKeys.length === 1
      ? partCities.find((c): c is string => !!c) || null
      : null;

  const segments: BatchSegment[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const partCity = partCities[i] || sharedCity;
    const qty = parseQtyFromText(part);
    const stripped = stripQtyCityDuration(stripQuoteFiller(part), partCity);
    const token = refineSegmentToken(stripped, services);
    if (!token || token.length < 2) continue;
    // Skip pure city / filler leftovers
    if (partCity && canonicalizeServiceName(token) === canonicalizeServiceName(partCity)) {
      continue;
    }

    const hits = matchSegmentHits(services, token, partCity);
    if (hits.length > 0) {
      segments.push({ raw: part, token, qty, city: partCity });
      continue;
    }
    const media = detectMediaLocal(stripped, services);
    if (media.length) {
      segments.push({ raw: part, token: media[0], qty, city: partCity });
      continue;
    }
    const tokenKey = canonicalizeServiceName(token);
    // Keep known family tokens even with zero inventory (so batch can say "not providing")
    if (FAMILY_NEEDS_ADS_WORD.has(tokenKey) || tokenKey.length >= 4) {
      segments.push({ raw: part, token, qty, city: partCity });
      continue;
    }
    // Unmatched short place-like token (gandhi) — skip as service segment
    if (isShortAmbiguousQuery(stripped) && !qty) continue;
    // Keep phrase so batch UI can still try fuzzy browse
    segments.push({ raw: part, token, qty, city: partCity });
  }

  const result = segments.length >= 2 ? segments : [];
  logFunnelDebug('parseServiceSegments', {
    text,
    normalized,
    serviceText,
    sharedLocationPreposition,
    sharedLocationPrefix,
    sharedLocationValues,
    hasSharedLocationSuffix,
    parts,
    partsJson: JSON.stringify(parts),
    segmentsJson: JSON.stringify(result),
    segments: result.map((segment) => ({
      raw: segment.raw,
      token: segment.token,
      qty: segment.qty,
      city: segment.city,
    })),
  });
  return result;
}

/** Trailing / unmatched short place hint from a multi-service message (e.g. "… and gandhi"). */

export function extractBatchPlaceHint(text: string, services: DbService[]): string | null {
  const normalized = stripQuoteFiller(normalizeSegmentPhrase(text));
  const parts = normalized
    .split(/\s*(?:\band\b|,|&|\+)\s*/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 1);
  for (const part of parts) {
    const city = detectCityInText(part, services);
    const qty = parseQtyFromText(part);
    const stripped = stripQtyCityDuration(stripQuoteFiller(part), city);
    if (qty || !isShortAmbiguousQuery(stripped)) continue;
    if (matchSegmentHits(services, refineSegmentToken(stripped, services), city).length > 0) continue;
    if (detectMediaLocal(stripped, services).length > 0) continue;
    const place = suggestPartialPlace(stripped, services) || detectLocalityInText(stripped, services);
    if (place) return place;
    if (suggestPartialService(stripped, services)) continue;
  }
  return null;
}

/**
 * Group key for deduplication: medium family + city/locality.
 * All bus shelter sites in Anna Nagar share the same key → one chip.
 */

export function batchGroupKey(svc: DbService): string {
  const medium = canonicalizeServiceName(getMediumKey(svc));
  const city = (getLocalityFromMetaCity(svc) || extractRealCityFromDbService(svc) || '').toLowerCase();
  return `${medium}|${city}`;
}

/**
 * Prefer longer / more-specific segments; drop family duplicates.
 * e.g. "metro station elevated" keeps, bare "metro" drops;
 * "bus semi" kept alongside "bus shelter" (shelter is not a style token).
 */

export function dedupeBatchSegments(segments: BatchSegment[]): BatchSegment[] {
  if (segments.length <= 1) return segments;

  type Scored = { seg: BatchSegment; index: number; key: string };
  const scored: Scored[] = segments
    .map((seg, index) => ({
      seg: { ...seg },
      index,
      key: canonicalizeServiceName(seg.token),
    }))
    .filter((x) => x.key.length >= 2);

  const covers = (longer: string, shorter: string): boolean => {
    if (!longer || !shorter) return false;
    if (longer === shorter) return true;
    if (longer.startsWith(`${shorter} `)) return true;
    if (
      isMetroSegmentToken(shorter)
      && isMetroSegmentToken(longer)
      && longer.length >= shorter.length
    ) {
      return true;
    }
    // "bus semi" covers bare "bus"; "bus shelter" does not
    if (longer !== shorter && isSameMediumFamily(longer, shorter)) return true;
    return false;
  };

  const bySpecificity = [...scored].sort(
    (a, b) => b.key.length - a.key.length || a.index - b.index,
  );
  const kept: Scored[] = [];

  for (const item of bySpecificity) {
    const exact = kept.find((k) => k.key === item.key);
    if (exact) {
      if (
        (item.seg.qty ?? 0) > 0
        && !(exact.seg.qty != null && exact.seg.qty > 0)
      ) {
        exact.seg = { ...exact.seg, qty: item.seg.qty };
      }
      continue;
    }
    if (kept.some((k) => k.key !== item.key && covers(k.key, item.key))) {
      continue;
    }
    for (let i = kept.length - 1; i >= 0; i--) {
      if (kept[i].key !== item.key && covers(item.key, kept[i].key)) {
        if (
          (kept[i].seg.qty ?? 0) > 0
          && !(item.seg.qty != null && item.seg.qty > 0)
        ) {
          item.seg = { ...item.seg, qty: kept[i].seg.qty };
        }
        kept.splice(i, 1);
      }
    }
    kept.push(item);
  }

  kept.sort((a, b) => a.index - b.index);
  return kept.map((k) => k.seg);
}

/** Multi-service batch entry.
 *  - All segments share one city → startBatchWithCityLock
 *  - Mixed / no cities → sequential Type → City → Area → Direction per service (ask only if 2+)
 *  - Dedupes metro / family duplicates before starting
 */

export function startBatchMultiSelect(
  segments: BatchSegment[],
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  if (segments.length > MAX_BATCH_SEGMENTS) {
    const preview = segments
      .slice(0, 6)
      .map((s) => titleCase(s.token))
      .join(', ');
    return {
      step: 'small_talk',
      botText:
        reply
        || compactFunnelReply(
          `That's ${segments.length} services — max ${MAX_BATCH_SEGMENTS}.`,
          `Try starting with ${preview}.`,
        ),
      options: [],
      session: {
        ...session,
        segments: undefined,
        pendingMedia: [],
        qty: null,
      },
    };
  }

  // Shared multi-city list: "bus and auto in madurai and chennai"
  // (not per-service "cab madurai and auto in chennai")
  const originalText = session.originalText || '';
  const sharedMultiCities = extractSharedBatchCities(originalText, segments, services);
  if (sharedMultiCities?.length) {
    const clearSegs = dedupeBatchSegments(
      segments.map((s) => ({ ...s, city: null })),
    );
    return startBatchWithCityCandidates(
      clearSegs,
      sharedMultiCities,
      session,
      services,
      reply,
    );
  }

  // Shared city lock only when every named segment agrees on ONE city
  // (e.g. "bus, auto in chennai"). Mixed Madurai+Chennai per service → sequential.
  const namedCities = segments
    .map((s) => s.city)
    .filter((c): c is string => !!c);
  const uniqueNamed = [
    ...new Map(
      namedCities.map((c) => [canonicalizeServiceName(c), c] as const),
    ).values(),
  ];

  let sharedCity: string | null = null;
  if (uniqueNamed.length === 1) {
    sharedCity = uniqueNamed[0]!;
  } else if (uniqueNamed.length === 0 && session.city) {
    sharedCity = session.city;
  }

  const rawSegs = sharedCity
    ? segments.map((s) => ({ ...s, city: s.city || sharedCity! }))
    : segments;
  const segs = dedupeBatchSegments(rawSegs);

  // City already named ("bus, auto in chennai") → never re-ask city list upfront
  if (sharedCity && uniqueNamed.length <= 1) {
    return startBatchWithCityLock(segs, sharedCity, session, services, reply);
  }

  return startBatchSequentialFunnel(segs, session, services, reply);
}

/**
 * Multi-service, no shared city: one service at a time through the full funnel
 * (Type → City → Area → Direction). Skip 0/1; ask only when 2+.
 * Services that exist in exactly one DB city label are auto-locked —
 * no OK Continue one-by-one. 2+ DB city labels → leave city unlocked.
 */

export function startBatchSequentialFunnel(
  segments: BatchSegment[],
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  const qtyByServiceId: Record<string, number> = { ...(session.qtyByServiceId || {}) };
  type WorkItem = {
    medium: string;
    browseToken?: string;
    qty: number | null;
    city?: string;
    mediumType?: string;
    candidateServiceIds?: string[];
  };
  const workItems: WorkItem[] = [];
  const missingLabels: string[] = [];
  /** Service named with a city that has no inventory there — do not add from elsewhere */
  const cityUnavailable: Array<{ label: string; city: string }> = [];
  const seenTok = new Set<string>();

  /**
   * Auto-lock only when priced (else all) hits share exactly one funnel city.
   * Uses DB metadata.city / area_name — never known-metro-only matching that
   * invents Chennai/Madurai when other DB cities also exist.
   */
  const soleFunnelCityForHits = (hits: DbService[]): string | null => {
    const byKey = new Map<string, string>();
    for (const h of hits) {
      const city = funnelCityFromDb(h);
      if (!city) continue;
      const key = canonicalizeServiceName(city);
      if (!key || byKey.has(key)) continue;
      byKey.set(key, city);
    }
    if (byKey.size !== 1) return null;
    return [...byKey.values()][0]!;
  };

  for (const seg of segments) {
    // Prefer the already qty/city-stripped segment token from parseServiceSegments.
    // Refining raw ("200 lamp post…") used to keep the digits and miss the catalog phrase.
    const token =
      refineSegmentToken(seg.token, services)
      || refineSegmentToken(seg.raw, services)
      || seg.token;
    const key = canonicalizeServiceName(token);
    if (!key || seenTok.has(key)) continue;
    if (
      [...seenTok].some(
        (k) =>
          k.startsWith(`${key} `)
          || (isMetroSegmentToken(key) && isMetroSegmentToken(k) && k.length > key.length)
          || (k !== key && isSameMediumFamily(k, key)),
      )
    ) {
      continue;
    }
    seenTok.add(key);

    let hits = matchSegmentHits(services, token, seg.city, session.resolvedLocation);
    if (!hits.length) {
      if (seg.city) {
        // City was explicit — never widen to other cities; skip this service
        const elsewhere = filterForBrowseOrFamily(services, token);
        if (elsewhere.length) {
          cityUnavailable.push({ label: titleCase(token), city: seg.city });
        } else {
          missingLabels.push(titleCase(token));
        }
        continue;
      }
      hits = filterForBrowseOrFamily(services, token);
    }
    if (!hits.length) {
      missingLabels.push(titleCase(token));
      continue;
    }
    if (seg.qty != null && seg.qty > 0) {
      for (const h of hits) qtyByServiceId[h.service_id] = seg.qty;
    }

    // Prefer priced inventory when auto-locking a sole city so an unpriced
    // Madurai (or other) row cannot invent a city the user never named.
    const pricedHits = hits.filter(hasQuotablePricing);
    const soleCity = seg.city
      || soleFunnelCityForHits(pricedHits.length ? pricedHits : hits)
      || undefined;

    const exactSel = detectExactCatalogSelection(seg.raw, services);
    const exactKey = resolveExactMediumKey(token, services);
    let medium = exactKey || key;
    let mediumType: string | undefined;
    if (exactSel?.medium) {
      const selKey = canonicalizeServiceName(exactSel.medium);
      if (
        selKey === key
        || selKey === exactKey
        || selKey.startsWith(`${key} `)
        || key.startsWith(`${selKey} `)
        || isSameMediumFamily(selKey, key)
        || isSameMediumFamily(key, selKey)
      ) {
        medium = selKey;
        mediumType = exactSel.mediumType
          ? canonicalizeServiceName(exactSel.mediumType)
          : undefined;
      }
    }

    workItems.push({
      medium,
      browseToken: medium,
      qty: seg.qty ?? null,
      city: soleCity,
      mediumType,
      candidateServiceIds: (pricedHits.length ? pricedHits : hits)
        .filter((h) => {
          if (!exactKey && !exactSel?.medium) return true;
          const aliases = getCatalogMediumAliases(h);
          return aliases.includes(canonicalizeServiceName(medium));
        })
        .map((h) => h.service_id),
    });
  }

  if (!workItems.length) {
    const cityNote = cityUnavailable.length
      ? cityUnavailable
          .map((u) => `Not providing ${u.label} in ${u.city}.`)
          .join('\n')
      : '';
    return {
      step: 'no_match',
      botText:
        reply
        || cityNote
        || (missingLabels.length
          ? compactFunnelReply(
            `Couldn't find ${missingLabels.join(', ')}.`,
            'Please choose an available service.',
          )
          : copyUnknownService()),
      options: [],
      session: { ...session, segments, pendingMedia: [], qty: null },
    };
  }

  const [first, ...rest] = workItems;
  const availLabels = workItems.map((w) => titleCase(w.browseToken || w.medium));

  // Build unavailable note for session (prefix min_qty / later turns via withBatchUnavailableNote)
  let unavailableNote: string | undefined;
  if (cityUnavailable.length) {
    const byCity = new Map<string, string[]>();
    for (const u of cityUnavailable) {
      const list = byCity.get(u.city) || [];
      list.push(u.label);
      byCity.set(u.city, list);
    }
    unavailableNote = [...byCity.entries()]
      .map(([city, labels]) => formatBatchUnavailableNote(city, labels, availLabels))
      .join('\n');
  }

  void first;
  void rest;
  return launchSequentialBatchWork(workItems, segments, session, services, {
    reply,
    unavailableNote,
    availLabels,
    missingLabels,
    qtyByServiceId,
    batchUnavailableLabels: cityUnavailable.length
      ? cityUnavailable.map((u) => u.label)
      : undefined,
  });
}

/**
 * User already named cities in text ("police booth in chennai and madurai").
 * Do NOT re-ask city chips — start Type/Area/Direction per city (DB-driven, no hardcoding).
 * Single-site cities seed into the quote; multi-site cities go on workQueue.
 */

export function beginMultiCityMediumFlow(
  mediumToken: string,
  cities: string[],
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  const token = canonicalizeServiceName(mediumToken);
  const medium = token;
  type WorkItem = {
    medium: string;
    browseToken?: string;
    qty: number | null;
    city?: string;
    area?: string;
    candidateServiceIds?: string[];
  };
  const readyReps: DbService[] = [];
  const needFunnel: WorkItem[] = [];

  for (const cityLabel of cities) {
    let hits = isExactCatalogMedium(medium, services)
      ? filterByExactMedium(services, medium)
      : filterForBrowseOrFamily(services, token);
    if (session.mediumType) {
      const mt = canonicalizeServiceName(session.mediumType);
      hits = hits.filter((s) => {
        const got = getMediumTypeFromDb(s);
        return !!got && canonicalizeServiceName(got) === mt;
      });
    }
    hits = hits.filter((s) => serviceMatchesCityLabel(s, cityLabel));
    if (!hits.length) continue;

    const withDir = hits.filter((s) => !!getDirectionLabel(s));
    const dirKeys = [
      ...new Set(
        withDir
          .map((s) => canonicalizeServiceName(getDirectionLabel(s) || ''))
          .filter(Boolean),
      ),
    ];

    if (dirKeys.length <= 1 || hits.length === 1) {
      const rep = (dirKeys.length === 1 && withDir[0]) || hits[0];
      if (rep) readyReps.push(rep);
    } else {
      needFunnel.push({
        medium: medium || token,
        browseToken: medium || token,
        qty: session.qty,
        city: cityLabel,
        candidateServiceIds: hits.map((s) => s.service_id),
      });
    }
  }

  if (readyReps.length > 0 && needFunnel.length === 0) {
    return finalizeSelection(readyReps, {
      ...session,
      medium: canonicalizeServiceName(medium),
      browseToken: canonicalizeServiceName(token),
      needsContinueConfirm: false,
      // Keep any distinct batch services that were already queued while
      // resolving this medium's city/site selection.
      workQueue: session.workQueue,
      pendingCityQueue: undefined,
      area: undefined,
      placeHint: undefined,
      segments: undefined,
    }, services);
  }

  let seedRows: ConfirmationRow[] = [...(session.collectedRows || [])];
  let seedIds: string[] = [...(session.collectedServiceIds || [])];
  if (readyReps.length > 0) {
    const built = buildRowsForServices(
      readyReps,
      session.qty,
      session.durationText,
      session.originalText,
      session.qtyByServiceId,
    );
    seedRows = [...seedRows, ...built.rows];
    seedIds = [...seedIds, ...readyReps.map((s) => s.service_id)];
  }

  if (!needFunnel.length) {
    if (seedRows.length) {
      return finalizeSelection([], {
        ...session,
        medium: canonicalizeServiceName(medium),
        browseToken: canonicalizeServiceName(token),
        collectedRows: seedRows,
        collectedServiceIds: seedIds,
        needsContinueConfirm: false,
        pendingCityQueue: undefined,
        workQueue: session.workQueue,
        segments: undefined,
      }, services);
    }
    return {
      step: 'no_match',
      botText: reply || copyUnknownCity('those cities'),
      options: [],
      session,
    };
  }

  const [first, ...rest] = needFunnel;
  return advanceFunnel(
    {
      ...session,
      medium: canonicalizeServiceName(first.medium),
      browseToken: canonicalizeServiceName(first.browseToken || first.medium),
      mediumType: session.mediumType,
      city: first.city,
      area: undefined,
      placeHint: undefined,
      qty: first.qty,
      candidateServiceIds: first.candidateServiceIds,
      workQueue: [...rest, ...(session.workQueue || [])],
      pendingCityQueue: undefined,
      collectedRows: seedRows,
      collectedServiceIds: seedIds,
      needsContinueConfirm: false,
      segments: undefined,
    },
    services,
    reply
      || (rest.length
        ? `Starting ${first.city}.`
        : undefined),
  );
}

/**
 * Batch named several cities together ("in madurai and chennai"):
 * - Cities with no inventory for the asked services → note + skip
 * - Exactly one usable city → city-lock there
 * - 2+ usable cities already named in text → use them all (never re-ask city chips)
 */

export function startBatchWithCityCandidates(
  segments: BatchSegment[],
  cities: string[],
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  const deduped = dedupeBatchSegments(segments);
  const tokens: string[] = [];
  const seenTok = new Set<string>();
  for (const seg of deduped) {
    const token = refineSegmentToken(seg.token, services) || seg.token;
    const key = canonicalizeServiceName(token);
    if (!key || seenTok.has(key)) continue;
    seenTok.add(key);
    tokens.push(token);
  }
  const serviceLabels = tokens.map((t) => titleCase(t));

  const cityHasAny = (city: string): boolean => {
    for (const token of tokens) {
      let hits = matchSegmentHits(services, token, city, session.resolvedLocation);
      if (!hits.length) {
        hits = filterForBrowseOrFamily(services, token).filter((s) =>
          serviceMatchesCityLabel(s, city, session.resolvedLocation),
        );
      }
      if (hits.length) return true;
    }
    return false;
  };

  const usable = cities.filter((c) => cityHasAny(c));
  const dead = cities.filter((c) => !cityHasAny(c));

  const svcList =
    serviceLabels.length <= 1
      ? serviceLabels[0] || 'those services'
      : serviceLabels.length === 2
        ? `${serviceLabels[0]} or ${serviceLabels[1]}`
        : `${serviceLabels.slice(0, -1).join(', ')}, or ${serviceLabels[serviceLabels.length - 1]}`;

  let unavailableNote: string | undefined;
  if (dead.length && usable.length === 1) {
    unavailableNote = copyBatchSkipCitiesContinue(
      serviceLabels,
      dead,
      usable[0]!,
    );
  } else if (dead.length && usable.length > 1) {
    unavailableNote = copyBatchSkipCitiesContinue(
      serviceLabels,
      dead,
      formatBatchServiceList(usable),
    );
  }

  if (!usable.length) {
    const cityList =
      cities.length === 2
        ? `${cities[0]} or ${cities[1]}`
        : cities.join(', ');
    return {
      step: 'no_match',
      botText:
        reply
        || compactFunnelReply(
          `Not offering ${svcList} in ${cityList}.`,
          'Please choose another city or service.',
        ),
      options: [],
      session: {
        ...session,
        segments: deduped,
        pendingMedia: [],
        needsContinueConfirm: false,
      },
    };
  }

  if (usable.length === 1) {
    return startBatchWithCityLock(
      deduped,
      usable[0]!,
      {
        ...session,
        city: usable[0],
        batchUnavailableNote: unavailableNote,
        batchUnavailableSpoken: false,
      },
      services,
      reply,
    );
  }

  // 2+ usable cities already named in the user message → use all (no city re-ask).
  // Keep service token(s) — never clear medium/browseToken (that caused "not in those cities").
  const primaryToken = tokens[0] || session.medium || session.browseToken || '';
  const baseSession: ProgressiveSession = {
    ...session,
    medium: canonicalizeServiceName(
      tokens.length === 1
        ? (isExactCatalogMedium(primaryToken, services) ? primaryToken : session.medium || primaryToken)
        : session.medium || primaryToken,
    ),
    browseToken: canonicalizeServiceName(primaryToken),
    city: undefined,
    area: undefined,
    placeHint: undefined,
    directionHint: undefined,
    pendingMedia: tokens.length > 1 ? tokens.slice(1) : [],
    segments: tokens.length > 1 ? deduped.map((s) => ({ ...s, city: null })) : undefined,
    batchServiceLabels: serviceLabels,
    batchUnavailableNote: unavailableNote,
    batchUnavailableSpoken: false,
    needsContinueConfirm: false,
  };

  // Single service × many cities
  if (tokens.length === 1) {
    const result = beginMultiCityMediumFlow(
      primaryToken,
      usable,
      baseSession,
      services,
      reply,
    );
    if (unavailableNote && !/not providing|aren't|isn't|continuing/i.test(result.botText || '')) {
      return {
        ...result,
        botText: joinNoteAndAsk(unavailableNote, result.botText),
        session: {
          ...result.session,
          batchUnavailableNote: unavailableNote,
          batchUnavailableSpoken: true,
        },
      };
    }
    return result;
  }

  // Multi-service × named cities: queue each service×city that has inventory
  type WorkItem = {
    medium: string;
    browseToken?: string;
    qty: number | null;
    city?: string;
    candidateServiceIds?: string[];
  };
  const workItems: WorkItem[] = [];
  const seen = new Set<string>();
  for (const seg of deduped) {
    const token = refineSegmentToken(seg.token, services) || seg.token;
    const med = canonicalizeServiceName(token);
    if (!med) continue;
    for (const city of usable) {
      let hits = matchSegmentHits(services, token, city, session.resolvedLocation);
      if (!hits.length) {
        hits = filterForBrowseOrFamily(services, token).filter((s) =>
          serviceMatchesCityLabel(s, city, session.resolvedLocation),
        );
      }
      if (!hits.length) continue;
      const key = `${med}|${canonicalizeServiceName(city)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      workItems.push({
        medium: med,
        browseToken: med,
        qty: seg.qty ?? session.qty,
        city,
        candidateServiceIds: hits.map((s) => s.service_id),
      });
    }
  }

  if (!workItems.length) {
    return {
      step: 'no_match',
      botText:
        reply
        || unavailableNote
        || `Not offering ${svcList} in those cities.`,
      options: [],
      session: baseSession,
    };
  }

  const [first, ...rest] = workItems;
  const handoff = unavailableNote
    ? joinNoteAndAsk(
      unavailableNote,
      `Starting ${titleCase(first.medium)} in ${first.city}.`,
    )
    : (rest.length
      ? `Starting ${titleCase(first.medium)} in ${first.city}.`
      : undefined);
  return advanceFunnel(
    {
      ...baseSession,
      medium: canonicalizeServiceName(
        isExactCatalogMedium(first.medium, services) ? first.medium : first.medium,
      ),
      browseToken: canonicalizeServiceName(first.browseToken || first.medium),
      city: first.city,
      qty: first.qty,
      candidateServiceIds: first.candidateServiceIds,
      workQueue: rest,
      segments: deduped,
      batchUnavailableSpoken: !!unavailableNote,
    },
    services,
    reply || handoff,
  );
}

/**
 * Multi-service + city already known (e.g. "bus, auto in chennai"):
 * - Scope to that city only (no city chip list)
 * - Ask types for services that exist there
 * - Clearly say which requested services are NOT offered in that city
 */

export function startBatchWithCityLock(
  segments: BatchSegment[],
  city: string,
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  type Avail = {
    token: string;
    qty: number | null;
    hits: DbService[];
  };
  const available: Avail[] = [];
  const missingLabels: string[] = [];
  const qtyByServiceId: Record<string, number> = { ...(session.qtyByServiceId || {}) };
  const resolved = session.resolvedLocation || null;

  // Dedupe by token (bus, bus → one) + metro family specifics
  const deduped = dedupeBatchSegments(segments);
  const seenTok = new Set<string>();
  for (const seg of deduped) {
    const token = refineSegmentToken(seg.token, services) || seg.token;
    const key = canonicalizeServiceName(token);
    if (!key || seenTok.has(key)) continue;
    seenTok.add(key);

    let hits = matchSegmentHits(services, token, city, resolved);
    const strictHitIds = hits.map((hit) => hit.service_id);
    if (!hits.length) {
      hits = filterForBrowseOrFamily(services, token).filter((s) =>
        serviceMatchesCityLabel(s, city, resolved),
      );
    }
    if (!hits.length) {
      // Final DB-only fallback for service rows whose catalog medium key is
      // broader than the displayed service name (for example, "Auto" rows
      // named "Auto Back Sticker"). Keep the city filter strict.
      const tokenWords = canonicalizeServiceName(token)
        .split(/\s+/)
        .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));
      hits = services.filter((service) => {
        if (!serviceMatchesCityLabel(service, city, resolved)) return false;
        const hay = canonicalizeServiceName(
          `${getMediumKey(service)} ${(service.service_name || '').split(/[·—–|]/)[0] || ''}`,
        ).split(/\s+/);
        return tokenWords.length > 0 && tokenWords.every((word) => hay.includes(word));
      });
    }
    logFunnelDebug('batchCityServiceMatch', {
      city,
      raw: seg.raw,
      inputToken: seg.token,
      refinedToken: token,
      normalizedKey: key,
      hasResolved: !!resolved,
      resolvedState: resolved?.state || null,
      strictHitIds,
      finalHitIds: hits.map((hit) => hit.service_id),
      finalHitNames: hits.map((hit) => hit.service_name),
      cityRows: services
        .filter((service) => serviceMatchesCityLabel(service, city, resolved))
        .filter((service) => canonicalizeServiceName(
          `${getMediumKey(service)} ${(service.service_name || '').split(/[·—–|]/)[0] || ''}`,
        ).includes(key))
        .slice(0, 10)
        .map((service) => ({
          id: service.service_id,
          name: service.service_name,
          metadataCity: getMetaCityRaw(service),
          dbCity: getDbCityLabel(service),
          area: getMetaAreaRaw(service),
        })),
    });
    if (!hits.length) {
      missingLabels.push(titleCase(token));
      continue;
    }
    if (seg.qty != null && seg.qty > 0) {
      for (const h of hits) qtyByServiceId[h.service_id] = seg.qty;
    }
    available.push({ token, qty: seg.qty ?? null, hits });
  }

  const availLabels = available.map((a) => titleCase(a.token));

  if (!available.length) {
    const asked = [...seenTok].map((t) => titleCase(t));
    const list =
      asked.length <= 1
        ? asked[0] || 'those services'
        : asked.length === 2
          ? `${asked[0]} or ${asked[1]}`
          : `${asked.slice(0, -1).join(', ')}, or ${asked[asked.length - 1]}`;
    return {
      step: 'no_match',
      botText:
        reply
        || compactFunnelReply(
          `Not offering ${list} in ${city}.`,
          'Please choose another city or service.',
        ),
      options: [],
      session: {
        ...session,
        city,
        segments,
        pendingMedia: [],
        needsContinueConfirm: false,
      },
    };
  }

  const workItems = available.map((a) => ({
    medium: canonicalizeServiceName(a.token),
    browseToken: canonicalizeServiceName(a.token),
    qty: a.qty,
    city,
    candidateServiceIds: a.hits.map((h) => h.service_id),
  }));

  let unavailableNote: string | undefined = session.batchUnavailableNote?.trim() || undefined;
  if (missingLabels.length && availLabels.length) {
    const perCity = formatBatchUnavailableNote(city, missingLabels, availLabels);
    unavailableNote = unavailableNote ? joinNoteAndAsk(unavailableNote, perCity) : perCity;
  }

  return launchSequentialBatchWork(workItems, segments, { ...session, city, qtyByServiceId }, services, {
    reply,
    unavailableNote,
    availLabels,
    missingLabels,
    qtyByServiceId,
    batchUnavailableLabels: missingLabels.length ? missingLabels : undefined,
    lockedCity: city,
  });
}

/** Family match: "bus" → bus full/semi; not bus stand. Name fallback uses same rule. */

export function workQueueHasOtherCities(session: ProgressiveSession): boolean {
  const cur = canonicalizeServiceName(session.city || '');
  return (session.workQueue || []).some((w) => {
    const wc = canonicalizeServiceName(w.city || '');
    return !!wc && (!cur || wc !== cur);
  });
}

/**
 * True when the queue still has a different requested service (Hoarding → No Parking)
 * even if both share the same city. Type leftovers on the same medium return false.
 */

export function workQueueHasOtherServices(session: ProgressiveSession): boolean {
  const cur = canonicalizeServiceName(session.medium || session.browseToken || '');
  return (session.workQueue || []).some((w) => {
    const wm = canonicalizeServiceName(w.medium || w.browseToken || '');
    if (!wm) return false;
    if (!cur) return true;
    return wm !== cur;
  });
}

/**
 * Remaining batch work that must run before quote_ready.
 * Same-medium type leftovers (Frontlit → Nonlit, same city) return false so we
 * never say “Now choosing Hoarding” after a type union.
 */

export function workQueueMustContinue(session: ProgressiveSession): boolean {
  if ((session.pendingCityQueue || []).length > 0) return true;
  if (workQueueHasOtherCities(session)) return true;
  if (workQueueHasOtherServices(session)) return true;
  return false;
}


export function continuePendingWork(
  session: ProgressiveSession,
  collectedRows: ConfirmationRow[],
  collectedServiceIds: string[],
  services: DbService[],
): ProgressiveTurnResult | null {
  const cityQueue = [...(session.pendingCityQueue || [])];
  if (cityQueue.length > 0) {
    const nextCity = cityQueue.shift()!;
    return advanceFunnel(
      {
        ...session,
        city: nextCity,
        area: session.placeHint || undefined,
        directionHint: undefined,
        mediumType: session.mediumType,
        pendingCityQueue: cityQueue,
        collectedRows,
        collectedServiceIds,
        candidateServiceIds: undefined,
        pendingRows: undefined,
      },
      services,
      compactFunnelReply(
        `Now choosing ${titleCase(session.medium || 'service')} in ${nextCity}.`,
      ),
    );
  }

  const workQueue = [...(session.workQueue || [])];
  if (workQueue.length > 0) {
    const next = workQueue.shift()!;
    const browse = canonicalizeServiceName(next.browseToken || next.medium);
    const med = resolveExactMediumKey(next.medium, services)
      || canonicalizeServiceName(next.medium);
    const exact = isExactCatalogMedium(med, services);
    const nextLabel = titleCase(browse || med);
    const sameMediumAsCurrent =
      !!session.medium
      && canonicalizeServiceName(session.medium) === med;
    const handoff = copyBatchNextService({
      finishedLabel: collectedServiceLabels(collectedRows),
      nextLabel,
      city: next.city || next.area,
      remainingAfter: workQueue.length,
    });
    const result = startMediumFlow(
      med,
      {
        ...session,
        medium: exact ? med : undefined,
        browseToken: browse,
        // Same medium, next city — keep type (Frontlit); new service clears type
        mediumType: sameMediumAsCurrent ? session.mediumType : undefined,
        typesResolved: sameMediumAsCurrent ? session.typesResolved : undefined,
        city: next.city,
        area: next.area || undefined,
        placeHint: undefined,
        qty: next.qty,
        directionHint: undefined,
        pendingCityQueue: undefined,
        workQueue,
        collectedRows,
        collectedServiceIds,
        candidateServiceIds: next.candidateServiceIds,
        pendingRows: undefined,
        needsContinueConfirm: false,
        batchServiceLabels: session.batchServiceLabels,
      },
      services,
      handoff,
    );
    return withBatchStepPrompt(result, handoff);
  }
  return null;
}


export function continueAfterNoPricing(
  session: ProgressiveSession,
  services: DbService[],
  unpricedLabels: string[],
): ProgressiveTurnResult {
  const labels = unpricedLabels.filter(Boolean);
  const note = copyNoCurrentPricing(labels);
  return {
    step: 'no_match',
    botText: note,
    options: [],
    session: {
      ...session,
      needsContinueConfirm: false,
      pendingRows: undefined,
      candidateServiceIds: undefined,
      medium: undefined,
      browseToken: undefined,
      mediumType: undefined,
      typesResolved: undefined,
      workQueue: undefined,
      pendingCityQueue: undefined,
      area: undefined,
      placeHint: undefined,
      directionHint: undefined,
    },
  };
}


export function resolveBatchFromSegments(
  segments: BatchSegment[],
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  return startBatchMultiSelect(segments, session, services, reply);
}

/** Phase 4 — advance workQueue / pendingCityQueue after one service completes. */

export function continueBatchQueue(
  session: ProgressiveSession,
  collectedRows: ConfirmationRow[],
  collectedServiceIds: string[],
  services: DbService[],
): ProgressiveTurnResult | null {
  return continuePendingWork(session, collectedRows, collectedServiceIds, services);
}

/** Phase 5 — chip/confirm inner (exported for continueChatAction). */

/** Single batch entry replacing startBatchMultiSelect / Sequential / CityCandidates / CityLock. */
export function batchResolve(
  segments: BatchSegment[],
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
): ProgressiveTurnResult {
  return resolveBatchFromSegments(segments, session, services, reply);
}
