/**
 * Funnel textTurn — split from body.ts (Phase 8).
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
import { STOP_WORDS, compactFunnelReply, logFunnelDebug, preferEngineCopy, titleCase } from './shared';
import { catalogMetroKeys, detectExactCatalogSelection, detectMediumTypeInText, extractRealCityFromDbService, friendlyServiceLabel, funnelCityFromDb, getCatalogTypeKeys, getChipImageUrl, getMediumKey, getMetaAreaRaw, getMetaCityRaw, hasExplicitQty, isExactCatalogMedium, parseDurationFromText, parseQtyFromText, syncCatalogMetroKeys } from './catalog';
import { buildPlaceOfferTurn, copyAskType, copyGreeting, copyPlaceServices, copyPlaceUnavailableContinue, copyUnknownCity, copyWhichService, directionSatisfiesPlaceIntent, extractPlaceIntentToken, extractUnresolvedSitePhrase, placeUnavailablePrep, withBatchUnavailableNote } from './copy';
import { detectCatalogueBrowseQuery, detectCitiesInText, detectCityInText, detectDbCityInText, detectDirectionInText, detectLocalityInText, detectUnresolvedPlaceAttempt, extractExplicitAreaPhrase, extractExplicitLocationPhrase, extractGeocodePlaceHint, inferCityForLocality, isAmbiguousPlaceQuery, isCityOnlyQuery, isLocalityOnlyQuery, isPlaceServicesBrowseQuery, localityCompatibleWithCity, replyUnresolvedPlace, startCatalogueBrowse, startPlaceTypeBrowse, suggestPartialService } from './location';
import { bestFuzzyGuess, detectFeatureClarifyHint, detectMediaLocal, filterByBrowseToken, filterForBrowseOrFamily, filterPoolBySession, isCatalogMediumToken, isExactMediaQuery, isSameMediumFamily, matchServices, serviceMatchesCityLabel, serviceMatchesExplicitArea, softClarifyNeed, softCorrectMediaWordsInText, startMediumFlow, typesForClarify, uniqueMediumOnlyOptions } from './filterCatalog';
import { extractBatchPlaceHint, normalizeSegmentPhrase, parseServiceSegments, startBatchMultiSelect, startBatchWithCityCandidates, stripQuoteFiller } from './batchResolve';
import { advanceFunnel, isNewServiceSwitch, isSameBatchEcho, priorHasFunnelLocks, stripQtyCityDuration } from './resolveNextStep';
import { finalizeSelection } from './finalize';

export function isSmallTalk(text: string): ProgressiveTurnResult | null {
  const t = text.trim();
  if (!t) return null;

  const session: ProgressiveSession = { originalText: t, qty: null };

  if (/^(hi|hello|hey|hii|hai|hlo|helo|howdy|yo|hola)[\s!.]*$/i.test(t)
    || /^(good\s+(morning|afternoon|evening))[\s!.]*$/i.test(t)) {
    return {
      step: 'small_talk',
      botText: copyGreeting(t),
      options: [],
      session,
    };
  }

  if (/^(thanks|thank\s*you|thx|ty)[\s!.]*$/i.test(t)) {
    return {
      step: 'small_talk',
      botText: compactFunnelReply("You're welcome!", 'Which service do you need?'),
      options: [],
      session,
    };
  }

  if (/^(help|how\s+(does\s+this\s+work|to\s+use)|what\s+can\s+you\s+do)[\s?.!]*$/i.test(t)) {
    return {
      step: 'small_talk',
      botText: compactFunnelReply('Tell me the service or city you need.'),
      options: [],
      session,
    };
  }

  // Incomplete: "i need a", "i want", "looking for"
  if (/^(i\s+)?(need|want|looking\s+for)\s*(a|an|some)?\s*$/i.test(t)) {
    return {
      step: 'small_talk',
      botText: 'Which service do you need?',
      options: [],
      session,
    };
  }

  return null;
}


export function mergePriorWithDetected(
  prior: ProgressiveSession,
  detected: {
    originalText: string;
    qty: number | null;
    durationText: string | null;
    city: string | null;
    localityHint: string | null;
    directionHint: string | null;
    media: string[];
    shortReply: string | null;
    mediumType?: string | null;
  },
  services: DbService[],
): ProgressiveSession {
  const newMedia = detected.media[0]
    ? canonicalizeServiceName(detected.media[0])
    : null;
  const priorMed = canonicalizeServiceName(
    prior.medium || prior.browseToken || '',
  );
  // Family token → more specific medium in text ("bus" → "bus semi"): upgrade lock
  const familyUpgrade =
    !!newMedia
    && !!priorMed
    && newMedia !== priorMed
    && newMedia.startsWith(`${priorMed} `);
  const sameService =
    !!newMedia
    && !!priorMed
    && !familyUpgrade
    && (
      priorMed === newMedia
      || isSameMediumFamily(priorMed, newMedia)
      || isSameMediumFamily(newMedia, priorMed)
    );
  const cityFromText = detected.city || null;
  // Never treat the same label as both city and area
  const areaFromText =
    detected.localityHint
    && !(
      cityFromText
      && canonicalizeServiceName(detected.localityHint)
        === canonicalizeServiceName(cityFromText)
    )
      ? detected.localityHint
      : null;
  const dirFromText = detected.directionHint?.trim() || null;
  const typeFromText = detected.mediumType
    ? canonicalizeServiceName(detected.mediumType)
    : null;

  // Same multi-service list ("bus and auto" after "bus and auto in chennai")
  // is not a switch to media[0] (Auto / a longer Bus catalog name).
  const echoSegs = parseServiceSegments(detected.originalText, services);
  const batchEcho = isSameBatchEcho(
    prior,
    echoSegs.length >= 2
      ? echoSegs
      : detected.media.map((token) => ({ token })),
  );

  // ── Different service name OR family→exact upgrade = fresh / upgraded funnel ──
  // Never reuse prior mediumType / city / area / direction from the old turn
  // unless this message supplies them (upgrade may keep city when still in text).
  if (!batchEcho && ((newMedia && !sameService) || familyUpgrade)) {
    return {
      originalText: detected.originalText,
      qty: detected.qty,
      durationText: detected.durationText || undefined,
      medium: newMedia,
      browseToken: newMedia,
      city: cityFromText || (familyUpgrade ? prior.city : undefined),
      area: areaFromText || undefined,
      placeHint: areaFromText || undefined,
      directionHint: dirFromText || undefined,
      mediumType: typeFromText || undefined,
      typesResolved: typeFromText ? true : undefined,
      candidateServiceIds: undefined,
      pendingRows: undefined,
      pendingMedia: detected.media.length > 1 ? detected.media.slice(1) : [],
      collectedRows: [],
      collectedServiceIds: [],
      segments: undefined,
      workQueue: undefined,
      pendingCityQueue: undefined,
      qtyByServiceId: undefined,
      needsContinueConfirm: false,
      batchUnavailableNote: undefined,
      batchUnavailableSpoken: undefined,
      batchUnavailableLabels: undefined,
      batchServiceLabels: undefined,
      lastOpener: prior.lastOpener,
      openerIdx: prior.openerIdx,
    };
  }

  // ── Same service echo OR no service in text: refine current funnel ──
  const cityChanged =
    !!cityFromText
    && canonicalizeServiceName(cityFromText)
      !== canonicalizeServiceName(prior.city || '');
  const priorAreaKey = canonicalizeServiceName(prior.area || prior.placeHint || '');
  const areaChanged =
    !!areaFromText
    && canonicalizeServiceName(areaFromText) !== priorAreaKey;
  const areaSameAgain =
    !!areaFromText
    && canonicalizeServiceName(areaFromText) === priorAreaKey
    && !!priorAreaKey;

  let nextCity = cityFromText || (cityChanged ? undefined : prior.city);
  // City change clears area unless this message also names an area
  const nextArea = areaFromText
    || (cityChanged ? undefined : prior.area);
  const nextPlace = areaFromText
    || (cityChanged ? undefined : prior.placeHint);

  // Place change outside locked city (e.g. Hoarding·Chittoor + "omr") → never keep
  // Chittoor · Omr. Clear / re-lock city from place inventory.
  const mediumForPlace = prior.medium || prior.browseToken || newMedia || undefined;
  let placeRescopedCity = false;
  if (
    areaFromText
    && nextCity
    && !cityFromText
    && !localityCompatibleWithCity(services, mediumForPlace, nextCity, areaFromText)
  ) {
    nextCity = inferCityForLocality(services, mediumForPlace, areaFromText);
    placeRescopedCity = true;
  }

  // Area change → clear direction; same area again → keep direction; else overlay dir
  let nextDirection = prior.directionHint;
  if (areaChanged || cityChanged || placeRescopedCity) {
    nextDirection = dirFromText || undefined;
  } else if (dirFromText) {
    nextDirection = dirFromText;
  } else if (areaSameAgain) {
    nextDirection = prior.directionHint;
  }

  const clearSitePool = cityChanged || areaChanged || placeRescopedCity;

  // Type from this message overrides; city change keeps prior type (final rule)
  const nextType = typeFromText || prior.mediumType;
  const typeChanged =
    !!typeFromText
    && canonicalizeServiceName(typeFromText)
      !== canonicalizeServiceName(prior.mediumType || '');
  if (typeChanged) {
    nextDirection = dirFromText || undefined;
  }

  const lockedMedium = prior.medium || prior.browseToken || newMedia || undefined;

  return {
    ...prior,
    originalText: detected.originalText,
    qty: detected.qty ?? prior.qty,
    durationText: detected.durationText ?? prior.durationText,
    city: nextCity || undefined,
    area: nextArea,
    placeHint: nextPlace,
    medium: lockedMedium,
    browseToken: prior.browseToken || prior.medium || newMedia || undefined,
    mediumType: nextType,
    typesResolved: typeFromText
      ? true
      : prior.typesResolved,
    candidateServiceIds: clearSitePool || typeChanged ? undefined : prior.candidateServiceIds,
    directionHint: nextDirection,
    pendingRows: clearSitePool || typeChanged ? undefined : prior.pendingRows,
    // New typed place = new quote basket (never keep Chennai 81 lines + Chittoor queue).
    collectedRows: clearSitePool ? [] : prior.collectedRows,
    collectedServiceIds: clearSitePool ? [] : prior.collectedServiceIds,
    workQueue: clearSitePool ? undefined : prior.workQueue,
    pendingCityQueue: clearSitePool ? undefined : prior.pendingCityQueue,
    needsContinueConfirm:
      cityChanged || areaChanged || typeChanged || placeRescopedCity
        ? false
        : prior.needsContinueConfirm,
  };
}

/**
 * Match typed text to an open chip / confirm option (same as tapping).
 * Uses DB-backed option labels/ids only — no hardcoded service lists.
 */

export function canSkipChatIntentAi(userText: string, services: DbService[]): boolean {
  const t = (userText || '').trim();
  if (!t) return true;
  if (/^(hi|hello|hey|hii|hai|hlo|helo|howdy|yo|hola)[\s!.]*$/i.test(t)) return true;
  if (/^(thanks|thank\s*you|thx|ok|okay|bye)[\s!.]*$/i.test(t)) return true;
  if (detectCatalogueBrowseQuery(t)) return true;
  if (isCityOnlyQuery(t, services)) return true;
  if (isLocalityOnlyQuery(t, services)) return true;
  if (parseServiceSegments(t, services).length >= 2) return true;
  const mediaLocal = detectMediaLocal(t, services);
  if (mediaLocal.length >= 1) {
    // Keep Gemini in the loop for service + possible site/direction wording.
    // Plain service requests still use the fast local path.
    const regexDirectionContext =
      /\b(near|around|at|towards?|opposite|signal|road|street|junction|flyover)\b/i.test(t);
    // A city mention can be found inside a direction remark ("towards
    // Chennai"). It is not a site request, so it must not force the slower AI
    // intent path or let direction matching override the city funnel.
    const requestedCity = detectCityInText(t, services);
    const localDirectionHit = requestedCity ? null : detectDirectionInText(t, services);
    const hasDirectionContext = regexDirectionContext || !!localDirectionHit;
    const skip = !hasDirectionContext;
    logFunnelDebug('canSkipChatIntentAi', {
      text: t,
      mediaLocal,
      regexDirectionContext,
      localDirectionHit: localDirectionHit
        ? {
            phrase: localDirectionHit.phrase,
            serviceIds: localDirectionHit.serviceIds.slice(0, 8),
            area: localDirectionHit.area || null,
          }
        : null,
      skipAi: skip,
    });
    return skip;
  }
  logFunnelDebug('canSkipChatIntentAi', {
    text: t,
    mediaLocal: [],
    skipAi: false,
    reason: 'no_local_media_or_special_case',
  });
  return false;
}

/**
 * Resolve one user free-text turn into the next progressive step.
 * @deprecated Phase 6 — use handleChatTurnSync from ./handleChatTurn via ./progressiveApi.
 */

export function resolveProgressiveText(
  userText: string,
  services: DbService[],
  prior?: ProgressiveSession | null,
  intent?: IntentOverlay | null,
): ProgressiveTurnResult {
  return resolveProgressiveTextLegacy(userText, services, prior, intent);
}


export function resolveProgressiveTextLegacy(
  userText: string,
  services: DbService[],
  prior?: ProgressiveSession | null,
  intent?: IntentOverlay | null,
): ProgressiveTurnResult {
  syncCatalogMetroKeys(services);
  // Silent media plural/synonym + light typo fix (service words only — not cities/places)
  const originalText = softCorrectMediaWordsInText(
    normalizeSegmentPhrase(userText.trim()),
    services,
  );

  // Carry Nominatim hierarchy from ChatInterface (or prior turn)
  const resolvedLocation =
    intent?.resolvedLocation
    ?? prior?.resolvedLocation
    ?? null;
  if (resolvedLocation) {
    prior = prior
      ? { ...prior, resolvedLocation }
      : { originalText, qty: null, resolvedLocation };
  }

  // AI greeting / help shortcuts
  if (intent?.kind === 'greeting') {
    return {
      step: 'small_talk',
      botText: copyGreeting(originalText),
      options: [],
      session: { originalText, qty: null },
    };
  }
  if (intent?.kind === 'help') {
    return {
      step: 'small_talk',
      botText: compactFunnelReply('Tell me the service or city you need.'),
      options: [],
      session: { originalText, qty: null },
    };
  }
  if (intent?.kind === 'services_browse') {
    return startCatalogueBrowse(
      'services',
      {
        ...(prior || {}),
        originalText,
        qty: null,
      },
      services,
      null,
    );
  }

  const talk = isSmallTalk(originalText);
  if (talk) return talk;

  const qty = hasExplicitQty(originalText)
    ? (parseQtyFromText(originalText)
      ?? (intent?.qty != null ? Number(intent.qty) : null))
    : null;
  const durationText = intent?.duration ?? parseDurationFromText(originalText);

  // City only from user text (or AI when that city literally appears in the message).
  // Prevents AI inventing Thoraipakkam/etc. and collapsing the apartment city list.
  const explicitAreaPhrase = extractExplicitAreaPhrase(originalText);
  const cityFromText = detectCityInText(originalText, services);
  const cityFromAi = intent?.city ? titleCase(String(intent.city)) : null;
  // Keep explicit city when both "near X" and "in Chennai" appear in one sentence.
  const city =
    explicitAreaPhrase && !cityFromText
      ? null
      : (
        cityFromText
        || (cityFromAi
          && new RegExp(
            `\\b${cityFromAi.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
            'i',
          ).test(originalText)
          ? cityFromAi
          : null)
      )
    || null;
  const explicitPlaceArea = explicitAreaPhrase
    ? (
      detectLocalityInText(explicitAreaPhrase, services)
      || detectLocalityInText(`near ${explicitAreaPhrase}`, services)
    )
    : null;

  const catalogTypes = getCatalogTypeKeys(services);
  const mediaFromAi = (intent?.media || [])
    .map((m) => String(m).trim())
    .filter(Boolean);
  // Prefer AI media (already catalog-resolved by caller); else local catalog-only detect
  const mediaLocal = detectMediaLocal(originalText, services);
  let media =
    mediaFromAi.length > 0
      ? mediaFromAi
      : intent?.medium
        ? [String(intent.medium)]
        : mediaLocal;

  // Map free labels onto catalog keys when needed
  if (media.length && catalogTypes.length) {
    const resolved = resolveMediaAgainstCatalog(media, catalogTypes);
    if (resolved.length) media = resolved;
  }
  const batchSegmentsBeforeLocation = parseServiceSegments(originalText, services);

  // An explicit location must never be silently discarded. If it is not
  // present in the DB-backed city/area vocabulary, stop before any generic
  // service match can reach quote_ready.
  // Multi-service requests must be handled by the batch resolver; a single
  // global "for ..." extraction can never safely represent all services.
  const explicitLocation =
    media.length >= 2
      ? null
      : extractExplicitLocationPhrase(originalText, services);
  const explicitDirection = explicitLocation
    ? detectDirectionInText(explicitLocation, services)
      || detectDirectionInText(originalText, services)
    : null;
  // When a request contains both a place clause and an explicit city clause
  // (for example, "bus shelter near Gemini Flyover and auto in Chennai"),
  // keep the city evidence even though `city` is intentionally cleared for
  // the area-first funnel.
  const explicitCityInText = detectCityInText(originalText, services);
  const knownLocation =
    city
    || explicitCityInText
    || batchSegmentsBeforeLocation.find((segment) => !!segment.city)?.city
    || detectLocalityInText(originalText, services)
    || detectDbCityInText(originalText, services)
    || explicitDirection;
  if (
    media.length > 0
    && explicitLocation
    && !knownLocation
    // A multi-service request must go through the batch resolver, which keeps
    // each service/city/area scope separate. The global location rejection is
    // only safe for a single-service request.
    && media.length < 2
    && batchSegmentsBeforeLocation.length < 2
  ) {
    const serviceLabel = media
      .map((value) => String(value).trim())
      .filter(Boolean)
      .join(' and ');
    return buildPlaceOfferTurn(
      serviceLabel || media[0],
      explicitLocation,
      {
        originalText,
        qty,
        durationText,
        medium: serviceLabel || undefined,
        resolvedLocation: resolvedLocation || prior?.resolvedLocation || null,
      },
      services,
      placeUnavailablePrep(originalText),
    );
  }

  // Prefer exact full-phrase catalog medium when user typed it (apartment demo)
  if (mediaLocal.length === 1 && isExactMediaQuery(originalText, services)) {
    media = mediaLocal;
  }

  // Prefer longer / more specific text media over short AI family tokens
  // ("bus semi chennai" + intent.media=["bus"] → keep "bus semi").
  if (mediaLocal.length && mediaFromAi.length) {
    const localBest = [...mediaLocal].sort((a, b) => b.length - a.length)[0] || '';
    const aiBest = [...mediaFromAi].sort((a, b) => b.length - a.length)[0] || '';
    const localKey = canonicalizeServiceName(localBest);
    const aiKey = canonicalizeServiceName(aiBest);
    if (
      localKey
      && (
        localKey.length > aiKey.length
        || (isExactCatalogMedium(localKey, services) && !isExactCatalogMedium(aiKey, services))
        || (localKey.startsWith(`${aiKey} `) && localKey !== aiKey)
      )
    ) {
      media = mediaLocal;
    }
  }

  // A complete service + DB type phrase wins over a broader AI/family match.
  // Example: "Mobile Van Non LED branding - 30 days" must lock Mobile Van
  // + Non LED before the normal family/type branch runs.
  const exactCatalogSelection =
    batchSegmentsBeforeLocation.length < 2
      ? detectExactCatalogSelection(originalText, services)
      : null;
  if (exactCatalogSelection) {
    media = [canonicalizeServiceName(exactCatalogSelection.medium)];
  }

  // Bare family token (hoarding) when catalog only has "LED Hoarding" etc.
  // Keep DB-driven: only tokens that appear in catalog medium keys and have browse hits.
  if (!media.length) {
    const familyTokens = extractQueryWords(originalText)
      .filter((w) => !STOP_WORDS.has(w))
      .filter((w) => isCatalogMediumToken(w, services))
      .filter((w) => filterForBrowseOrFamily(services, w).length > 0);
    if (familyTokens.length) {
      media = [...new Set(familyTokens.map((w) => canonicalizeServiceName(w)))];
    }
  }

  logFunnelDebug('mediaResolve', {
    originalText,
    mediaFromAi,
    mediaLocal,
    mediaFinal: media,
    catalogHasHoarding: catalogTypes.some((t) => /hoarding/i.test(t)),
    catalogHoardingLike: catalogTypes.filter((t) => /hoarding|board|flight/i.test(t)).slice(0, 12),
    intentDirectionHint: intent?.directionHint || null,
    localityHintPreview: detectLocalityInText(originalText, services),
  });

  // Phase 1: AI shortReply is parse-only — never surface in botText or reply args.
  const shortReply = null;

  // Area only from exact locality in user text — ignore invented AI areaHint
  const earlyPreservePrior =
    priorHasFunnelLocks(prior)
    && batchSegmentsBeforeLocation.length < 2;
  let localityHintRaw = detectLocalityInText(originalText, services);
  // Direction landmark inside a locked area funnel (e.g. "quote for navalur" on OMR)
  // must not be treated as an area change or trigger place-unavailable.
  if (earlyPreservePrior && prior?.area && localityHintRaw) {
    const dirPreview = stripQuoteFiller(normalizeSegmentPhrase(originalText));
    const dirPool = filterPoolBySession(services, {
      ...prior,
      directionHint: undefined,
    });
    if (detectDirectionInText(dirPreview, dirPool, { preferArea: prior.area })) {
      localityHintRaw = null;
    }
  }
  const localityHint =
    localityHintRaw
    && city
    && canonicalizeServiceName(localityHintRaw) === canonicalizeServiceName(city)
      ? null
      : localityHintRaw;
  // Resolve multi-service clauses before applying a single global area
  // constraint. For example, "bus shelter near Gemini Flyover and auto in
  // Chennai" has two independent scopes and must not be rejected as one
  // request near Gemini Flyover.
  // Explicit place requests are stricter than city requests. Do not let a
  // parent city (for example Chennai) make a service appear available near a
  // place (for example OMR) when the DB has no matching area/locality row.
  if (localityHint && media.length > 0 && batchSegmentsBeforeLocation.length < 2) {
    const areaPool = [
      ...new Map(
        media.flatMap((medium) => filterForBrowseOrFamily(services, medium))
          .map((service) => [service.service_id, service] as const),
      ).values(),
    ];
    const areaHits = areaPool.filter((service) =>
      serviceMatchesExplicitArea(service, localityHint),
    );
    if (areaHits.length === 0) {
      const serviceLabel = media.map((value) => String(value).trim()).filter(Boolean).join(' and ');
      return {
        step: 'no_match',
        botText: copyPlaceUnavailableContinue(
          serviceLabel || 'these services',
          localityHint,
          'near',
          { originalText, qty, durationText, medium: serviceLabel || undefined },
        ),
        options: [],
        session: {
          originalText,
          qty,
          durationText,
          medium: serviceLabel || undefined,
          browseToken: serviceLabel || undefined,
          city: undefined,
          area: undefined,
          placeHint: undefined,
          pendingMedia: [],
        },
      };
    }
  }

  const typeFromText =
    exactCatalogSelection?.mediumType
    || detectMediumTypeInText(
      originalText,
      services,
      media[0] || null,
    );

  const earlySegmentsCheck = batchSegmentsBeforeLocation;

  // "near vadaplani" typo / unknown place — NEVER continue prior Coimbatore/Hoarding session
  const unresolvedPlace = detectUnresolvedPlaceAttempt(originalText, services);
  if (
    unresolvedPlace
    && !localityHint
    && !city
    && media.length === 0
    && earlySegmentsCheck.length < 2
  ) {
    return replyUnresolvedPlace(
      unresolvedPlace,
      services,
      originalText,
      // Do not reuse Gemini's generic city-browse reply here. An unresolved
      // "near ..." place must explicitly say that the place was not found.
      undefined,
    );
  }

  const preservePrior =
    priorHasFunnelLocks(prior)
    && (
      earlySegmentsCheck.length < 2
      || isSameBatchEcho(prior, earlySegmentsCheck)
    );

  // Direction from this message (for refine / new-service keep-if-provided)
  let directionFromText: string | null = null;
  if (!isCityOnlyQuery(originalText, services) && !isLocalityOnlyQuery(originalText, services)) {
    // Remove request filler before matching a typed site name
    // ("give me a quote for navalur" → "navalur").
    const dirQuery = intent?.directionHint?.trim()
      || stripQuoteFiller(normalizeSegmentPhrase(originalText));
    // When a direction is being chosen inside an active place/city funnel,
    // search only that funnel's inventory. Otherwise a same-named landmark
    // from another city can win and empty the current OMR pool.
    const directionServices = preservePrior
      && prior
      && !isNewServiceSwitch(prior, media)
      ? filterPoolBySession(services, { ...prior, directionHint: undefined })
      : services;
    const dirHit = detectDirectionInText(
      dirQuery,
      directionServices,
      preservePrior && prior?.area ? { preferArea: prior.area } : undefined,
    );
    if (dirHit?.phrase) {
      const textKey = canonicalizeServiceName(originalText);
      const isPureArea =
        !!localityHint && textKey === canonicalizeServiceName(localityHint);
      const isPureCity = !!city && textKey === canonicalizeServiceName(city);
      const directionMatchesRequestedCity =
        !city
        || directionServices
          .filter((service) => dirHit.serviceIds.includes(service.service_id))
          .some((service) => serviceMatchesCityLabel(service, city));
      // Don't treat a pure area/city answer as a direction lock
      if (!isPureArea && !isPureCity && directionMatchesRequestedCity) {
        directionFromText = dirHit.phrase;
      }
    }
  }

  /** Near-clause place: locality detect, or direction hit area (e.g. Gemini Flyover area_name). */
  const nearPlaceArea =
    localityHint
    || explicitPlaceArea
    || (directionFromText
      ? (
        detectDirectionInText(
          intent?.directionHint?.trim()
            || stripQuoteFiller(normalizeSegmentPhrase(originalText)),
          services,
        )?.area
        || null
      )
      : null);

  // Change selection: keep prior locks; free text overlays only what changed
  // NEW SERVICE → reset old locks; keep only entities in this message
  const baseSessionFields: ProgressiveSession = preservePrior
    ? mergePriorWithDetected(prior!, {
      originalText,
      qty,
      durationText,
      city,
      localityHint,
      directionHint: directionFromText,
      media,
      shortReply,
      mediumType: typeFromText,
    }, services)
    : {
      originalText,
      qty,
      durationText,
      pendingMedia: [],
      collectedRows: [],
      collectedServiceIds: [],
      city: city || undefined,
      area: nearPlaceArea || undefined,
      placeHint: nearPlaceArea || undefined,
      directionHint: directionFromText || undefined,
      mediumType: typeFromText
        ? canonicalizeServiceName(typeFromText)
        : undefined,
      typesResolved: typeFromText ? true : undefined,
      resolvedLocation: resolvedLocation || undefined,
    };

  // Always keep Nominatim hierarchy on the active session
  if (resolvedLocation && !baseSessionFields.resolvedLocation) {
    baseSessionFields.resolvedLocation = resolvedLocation;
  }

  // When refining mid-funnel with city/area only, restore media from prior for downstream
  if (preservePrior && media.length === 0) {
    const locked = baseSessionFields.browseToken || baseSessionFields.medium;
    if (locked) media = [locked];
  }
  if (preservePrior && !city && baseSessionFields.city) {
    // city variable used below — allow prior city to remain via baseSessionFields only
  }

  // Catalogue Q&A: "what services/cities/areas/types are available?" → chips → quote funnel
  const placeServicesBrowse = isPlaceServicesBrowseQuery(originalText, services);
  const detectedBrowseKind =
    detectCatalogueBrowseQuery(originalText)
    || (placeServicesBrowse ? 'services' : null);
  const requestedAvailabilityCities =
    /\b(?:where|which\s+cities?|what\s+cities?)\b.*\bavailable\b|\bavailable\b.*\b(?:where|which\s+cities?|what\s+cities?)\b/i
      .test(originalText)
    && !mediaLocal.length
    && !!(baseSessionFields.medium || baseSessionFields.browseToken);
  const browseKind =
    requestedAvailabilityCities && detectedBrowseKind === 'services'
      ? 'cities'
      : detectedBrowseKind;
  if (browseKind && earlySegmentsCheck.length < 2) {
    return startCatalogueBrowse(
      browseKind,
      {
        ...baseSessionFields,
        city: city || (placeServicesBrowse ? undefined : baseSessionFields.city),
        area: localityHint || baseSessionFields.area,
        placeHint: localityHint || baseSessionFields.placeHint,
        // Scope cities/areas/types to a named service; "what services?" lists the full menu
        medium:
          browseKind === 'services'
            ? undefined
            : (media[0]
              ? canonicalizeServiceName(media[0])
              : baseSessionFields.medium),
        browseToken:
          browseKind === 'services'
            ? undefined
            : (media[0]
              ? canonicalizeServiceName(media[0])
              : baseSessionFields.browseToken),
      },
      services,
      shortReply,
    );
  }

  // Partial service name (e.g. "bus semi") → enter funnel directly (no Did you mean)
  // Skip when "led"/feature words span multiple catalog types
  const earlyFeatureHint = detectFeatureClarifyHint(originalText, services, city);
  if (
    media.length === 0
    && earlySegmentsCheck.length < 2
    && !isCityOnlyQuery(originalText, services)
    && !isLocalityOnlyQuery(originalText, services)
    && mediaFromAi.length === 0
    && !earlyFeatureHint
    && !preservePrior
  ) {
    const svcSug = suggestPartialService(originalText, services);
    if (svcSug) {
      return startMediumFlow(
        svcSug,
        {
          ...baseSessionFields,
          medium: canonicalizeServiceName(svcSug),
          browseToken: canonicalizeServiceName(svcSug),
        },
        services,
        shortReply,
      );
    }
  }

  // City + Area (no service) → ask Service → Type → Direction
  if (
    city
    && localityHint
    && canonicalizeServiceName(city) !== canonicalizeServiceName(localityHint)
    && media.length === 0
  ) {
    return advanceFunnel(
      {
        ...baseSessionFields,
        city,
        area: localityHint,
        placeHint: localityHint,
        medium: undefined,
        browseToken: undefined,
        mediumType: undefined,
        typesResolved: undefined,
        directionHint: undefined,
        candidateServiceIds: undefined,
      },
      services,
      preferEngineCopy(
        shortReply,
        compactFunnelReply(
          `Services in ${city} · ${localityHint}.`,
          'Which service do you need?',
        ),
      ),
    );
  }

  // Site / direction first (e.g. "Gemini Flyover") → Service → Type → City → Area
  const cityOnlyEarly = isCityOnlyQuery(originalText, services);
  const localityOnlyEarly = isLocalityOnlyQuery(originalText, services);
  const skipDirectionRoute =
    !!directionFromText
    || (
      preservePrior
      && !!prior?.area
      && !!(prior?.medium || prior?.browseToken)
    );
  if (!cityOnlyEarly && !localityOnlyEarly && !skipDirectionRoute) {
    // Gemini extracts only the user's raw site phrase; DB-backed matching
    // below remains authoritative and rejects invented directions.
    const directionQuery = intent?.directionHint?.trim()
      || stripQuoteFiller(normalizeSegmentPhrase(originalText));
    const directionPool =
      preservePrior && prior && !isNewServiceSwitch(prior, media)
        ? filterPoolBySession(services, { ...prior, directionHint: undefined })
        : services;
    const directionHit = detectDirectionInText(
      directionQuery,
      directionPool,
      preservePrior && prior?.area ? { preferArea: prior.area } : undefined,
    );
    logFunnelDebug('directionRoute', {
      originalText,
      directionQuery,
      intentDirectionHint: intent?.directionHint || null,
      media,
      city,
      localityHint: localityHint || null,
      directionHit: directionHit
        ? {
            phrase: directionHit.phrase,
            serviceIds: directionHit.serviceIds.slice(0, 8),
            area: directionHit.area || null,
          }
        : null,
    });
    if (directionHit) {
      const textKey = canonicalizeServiceName(originalText);
      const isPureArea =
        !!localityHint && textKey === canonicalizeServiceName(localityHint);
      const isPureCity = !!city && textKey === canonicalizeServiceName(city);
      if (!isPureArea && !isPureCity) {
        const matchedDirectionServices = services.filter((s) =>
          directionHit.serviceIds.includes(s.service_id),
        );
        // If a service is also named, keep only direction rows belonging to
        // that service. A conflicting service must not broaden the direction
        // back to the full catalogue.
        let directionServiceHits = media.length
          ? [...new Map(
            media
              .flatMap((m) => filterForBrowseOrFamily(matchedDirectionServices, m))
              .map((s) => [s.service_id, s]),
          ).values()]
          : matchedDirectionServices;
        // A city word can occur inside direction_remarks ("towards Chennai").
        // Once the request names a city, direction candidates must belong to
        // that row's actual DB city before they can enter the direction route.
        if (city) {
          directionServiceHits = directionServiceHits.filter((s) =>
            serviceMatchesCityLabel(s, city, undefined, services),
          );
        }
        logFunnelDebug('directionRoute.filterByMedia', {
          media,
          matchedDirectionCount: matchedDirectionServices.length,
          directionServiceHits: directionServiceHits.length,
          matchedMediums: [
            ...new Set(
              matchedDirectionServices.map((s) => getMediumKey(s)).filter(Boolean),
            ),
          ],
        });

        // "bus in Guindy" must not lock a direction that only says "Towards Guindy"
        // unless area/city/site truly is that place for the matched service.
        const placeIntent = extractPlaceIntentToken(originalText, media, services);
        const placeOk =
          !placeIntent
          || directionSatisfiesPlaceIntent(
            placeIntent,
            directionHit,
            directionServiceHits.length ? directionServiceHits : matchedDirectionServices,
          );

        if (media.length > 0 && directionServiceHits.length === 0) {
          // The text contains a direction, but not for the detected service.
          // Continue with the normal service flow below.
          logFunnelDebug('directionRoute.bypass', {
            reason: 'media_filter_emptied_direction_hits',
            media,
          });
        } else if (!placeOk) {
          logFunnelDebug('directionRoute.bypass', {
            reason: 'place_intent_not_satisfied',
            placeIntent,
            directionPhrase: directionHit.phrase,
          });
        } else {
          const dirServices = directionServiceHits;
          const mediums = uniqueMediumOnlyOptions(dirServices);
          const onlyMedium =
            mediums.length === 1 ? mediums[0].medium : undefined;
          const place =
            localityHint
            || directionHit.area
            || (preservePrior ? baseSessionFields.area || prior?.area : undefined)
            || undefined;
          return advanceFunnel(
            {
              ...baseSessionFields,
              directionHint: directionHit.phrase,
              medium: onlyMedium
                ? canonicalizeServiceName(onlyMedium)
                : (media[0]
                  ? canonicalizeServiceName(media[0])
                  : baseSessionFields.medium),
              browseToken: onlyMedium
                ? canonicalizeServiceName(onlyMedium)
                : (media[0]
                  ? canonicalizeServiceName(media[0])
                  : baseSessionFields.browseToken),
              mediumType: typeFromText
                ? canonicalizeServiceName(typeFromText)
                : baseSessionFields.mediumType,
              typesResolved: typeFromText || baseSessionFields.typesResolved
                ? true
                : undefined,
              city: city || directionHit.city || baseSessionFields.city,
              area: place,
              placeHint: place,
              candidateServiceIds: dirServices.map((s) => s.service_id),
              needsContinueConfirm: true,
            },
            services,
            onlyMedium || media[0]
              ? undefined
              : compactFunnelReply(
                `Sites matching “${titleCase(originalText.trim())}”.`,
                'Which service do you need?',
              ),
          );
        }
      } else {
        logFunnelDebug('directionRoute.bypass', {
          reason: isPureArea ? 'pure_area' : 'pure_city',
          localityHint,
          city,
        });
      }
    }
  }

  // Locality-only ("saidapet" / "near ecr" / "OMR"):
  // - No active service → place-first browse (list services at that place).
  // - Active service funnel → area change only: keep medium / mediumType / city,
  //   clear area-dependent location/direction, continue that service's funnel.
  const earlyLocality = localityOnlyEarly;
  if (earlyLocality) {
    const lockedMed =
      preservePrior
        ? (
          baseSessionFields.medium
          || baseSessionFields.browseToken
          || prior?.medium
          || prior?.browseToken
        )
        : undefined;
    if (lockedMed) {
      // DB city label typed while funnel is active → CITY CHANGE (not area under prior city)
      const dbCityHit =
        detectDbCityInText(earlyLocality, services)
        || (
          canonicalizeServiceName(earlyLocality)
            === canonicalizeServiceName(detectDbCityInText(originalText, services) || '')
            ? earlyLocality
            : null
        );
      const cityLabel = dbCityHit || detectCityInText(earlyLocality, services);
      const isCityRelabel =
        !!cityLabel
        && canonicalizeServiceName(cityLabel)
          !== canonicalizeServiceName(baseSessionFields.city || '');
      // Only treat as city when this label is a catalog city for the locked medium
      // and not an area_name under the current city.
      const medPool = filterForBrowseOrFamily(services, lockedMed);
      const appearsAsCity = medPool.some(
        (s) =>
          canonicalizeServiceName(getMetaCityRaw(s) || '')
          === canonicalizeServiceName(cityLabel || earlyLocality),
      );
      const appearsAsAreaUnderCurrent = medPool.some((s) => {
        const areaKey = canonicalizeServiceName(getMetaAreaRaw(s) || '');
        const cityKey = canonicalizeServiceName(funnelCityFromDb(s) || '');
        return (
          areaKey === canonicalizeServiceName(earlyLocality)
          && (
            !baseSessionFields.city
            || cityKey === canonicalizeServiceName(baseSessionFields.city)
          )
        );
      });
      if (appearsAsCity && isCityRelabel && !appearsAsAreaUnderCurrent) {
        logFunnelDebug('cityChangeInActiveFunnel', {
          earlyLocality,
          cityLabel,
          lockedMed,
          priorCity: baseSessionFields.city || null,
        });
        return advanceFunnel(
          {
            ...baseSessionFields,
            medium:
              baseSessionFields.medium || canonicalizeServiceName(lockedMed),
            browseToken:
              baseSessionFields.browseToken || canonicalizeServiceName(lockedMed),
            city: cityLabel || earlyLocality,
            area: undefined,
            placeHint: undefined,
            directionHint: undefined,
            candidateServiceIds: undefined,
            needsContinueConfirm: false,
            collectedRows: [],
            collectedServiceIds: [],
            pendingCityQueue: undefined,
            workQueue: undefined,
          },
          services,
          shortReply,
          { allowAutoFinalize: false },
        );
      }
      logFunnelDebug('areaChangeInActiveFunnel', {
        earlyLocality,
        lockedMed,
        mediumType: baseSessionFields.mediumType || null,
        city: baseSessionFields.city || null,
        clearedDirection: !baseSessionFields.directionHint,
      });
      return advanceFunnel(
        {
          ...baseSessionFields,
          medium:
            baseSessionFields.medium || canonicalizeServiceName(lockedMed),
          browseToken:
            baseSessionFields.browseToken || canonicalizeServiceName(lockedMed),
          area: earlyLocality,
          placeHint: earlyLocality,
          // mergePriorWithDetected already cleared direction on area change
          directionHint: baseSessionFields.directionHint,
          candidateServiceIds: undefined,
          needsContinueConfirm: false,
          collectedRows: [],
          collectedServiceIds: [],
          pendingCityQueue: undefined,
          workQueue: undefined,
        },
        services,
        shortReply,
        { allowAutoFinalize: false },
      );
    }
    return startPlaceTypeBrowse(
      earlyLocality,
      false,
      {
        ...baseSessionFields,
        medium: undefined,
        browseToken: undefined,
        mediumType: undefined,
        typesResolved: undefined,
        directionHint: undefined,
        candidateServiceIds: undefined,
      },
      services,
      shortReply,
    );
  }

  // Multi-service "X and Y and Z" → batch multi-select (before clarify / single-medium flows)
  const earlySegments = parseServiceSegments(originalText, services);
  if (earlySegments.length >= 2) {
    const sameEcho = isSameBatchEcho(prior, earlySegments);
    // Same list, no new city → keep the active service step (Bus types in Chennai).
    // Restarting the batch would drop the city lock and can skip Bus into Auto.
    if (
      sameEcho
      && prior
      && !city
      && (prior.medium || prior.browseToken || (prior.workQueue && prior.workQueue.length))
    ) {
      return advanceFunnel(
        {
          ...prior,
          originalText,
          qty: qty ?? prior.qty ?? null,
          durationText: durationText || prior.durationText,
        },
        services,
        shortReply,
      );
    }
    const placeHint = extractBatchPlaceHint(originalText, services) || undefined;
    const lockedCity = city
      || baseSessionFields.city
      || (sameEcho ? prior?.city : undefined);
    return startBatchMultiSelect(
      earlySegments,
      {
        ...baseSessionFields,
        city: lockedCity || undefined,
        placeHint: placeHint || baseSessionFields.placeHint,
        area: placeHint || baseSessionFields.area,
        qty: null,
      },
      services,
      null,
    );
  }

  const featureHint =
    (intent?.kind === 'clarify_type' || intent?.ambiguous
      ? (intent?.clarifyHint || detectFeatureClarifyHint(originalText, services, city))
      : null)
    || detectFeatureClarifyHint(originalText, services, city);

  // Ambiguous place (bus stand) / feature (led) → ask type chips, do not collapse to one medium
  if (featureHint && mediaFromAi.length < 2) {
    const hint = intent?.clarifyHint || featureHint;
    const types = typesForClarify(services, city, hint === 'that' ? null : hint);
    if (types.length > 1) {
      return {
        step: 'pick_type',
          botText: preferEngineCopy(
            shortReply,
            hint === 'that'
            ? copyAskType('this', { originalText, qty: null, city: city || undefined })
            : copyAskType(hint, { originalText, qty: null, city: city || undefined }, city),
          ),
        options: types,
        allowMulti: true,
        session: {
          originalText,
          // Keep hint so a follow-up place ("near omr") stays scoped to this family
          browseToken:
            hint && hint !== 'that'
              ? canonicalizeServiceName(hint)
              : undefined,
          city: city || undefined,
          qty,
          durationText,
          pendingMedia: [],
          candidateServiceIds: types
            .map((t) => t.serviceId)
            .filter((id): id is string => !!id),
        },
      };
    }
    // Single browse hit for feature → start that medium
    const browseHits =
      hint && hint !== 'that' ? filterByBrowseToken(services, hint) : [];
    if (browseHits.length > 0 && !isAmbiguousPlaceQuery(originalText)) {
      const mediums = uniqueMediumOnlyOptions(browseHits);
      if (mediums.length === 1) {
        return startMediumFlow(
          mediums[0].medium || hint,
          {
            originalText,
            medium: canonicalizeServiceName(mediums[0].medium || hint),
            browseToken: canonicalizeServiceName(mediums[0].medium || hint),
            city: city || undefined,
            qty,
            durationText,
            pendingMedia: [],
            collectedRows: [],
            collectedServiceIds: [],
          },
          services,
          shortReply,
        );
      }
      if (mediums.length > 1) {
        return {
          step: 'pick_type',
          botText: preferEngineCopy(shortReply, copyAskType(hint, {
            originalText,
            qty: null,
            city: city || undefined,
          }, city)),
          options: mediums,
          allowMulti: true,
          session: {
            originalText,
            browseToken: canonicalizeServiceName(hint),
            city: city || undefined,
            qty,
            durationText,
            pendingMedia: [],
          },
        };
      }
    }
    return {
      step: 'pick_type',
      botText: preferEngineCopy(
        shortReply,
        copyAskType(
          hint === 'that' ? 'this' : hint,
          { originalText, qty: null, city: city || undefined },
          city,
        ),
      ),
      options: types.length ? types : uniqueMediumOnlyOptions(services),
      allowMulti: true,
      session: {
        originalText,
        browseToken:
          hint && hint !== 'that'
            ? canonicalizeServiceName(hint)
            : undefined,
        city: city || undefined,
        qty,
        durationText,
        pendingMedia: [],
      },
    };
  }

  // AI city browse, metro-only, or locality-only → list DB types at that place.
  // Never city-browse when the user (or local detect) already named a service —
  // e.g. intent.kind=city_browse + "bus semi chennai" must lock Bus Semi.
  const cityOnly = isCityOnlyQuery(originalText, services);
  const localityOnly = isLocalityOnlyQuery(originalText, services);
  const textNamesService =
    mediaLocal.length > 0
    || media.length > 0
    || detectMediaLocal(originalText, services).length > 0;
  // City named + no media (even if AI kind=quote) → browse services in that city
  const cityBrowseFallback =
    !cityOnly
    && !localityOnly
    && !!city
    && media.length === 0
    && detectMediaLocal(originalText, services).length === 0;
  const lockedMedForCity =
    preservePrior
      ? (baseSessionFields.medium || baseSessionFields.browseToken)
      : null;
  if (
    (intent?.kind === 'city_browse' || cityOnly || localityOnly || cityBrowseFallback)
    && !lockedMedForCity
    && !textNamesService
  ) {
    if (localityOnly) {
      return startPlaceTypeBrowse(
        localityOnly,
        false,
        {
          originalText,
          qty,
          durationText,
          pendingMedia: [],
          collectedRows: [],
          collectedServiceIds: [],
          resolvedLocation: resolvedLocation || undefined,
        },
        services,
        shortReply,
      );
    }
    const browseCity = cityOnly || city;
    if (browseCity) {
      // Known metros (Madurai/Chennai…) → city filter; locality-as-city (Hosur/Padur) → area filter
      const isKnownMetro = catalogMetroKeys().includes(browseCity.toLowerCase());
      return startPlaceTypeBrowse(
        browseCity,
        isKnownMetro,
        {
          originalText,
          city: isKnownMetro ? browseCity : undefined,
          qty,
          durationText,
          pendingMedia: [],
          collectedRows: [],
          collectedServiceIds: [],
          resolvedLocation: resolvedLocation || undefined,
        },
        services,
        shortReply,
      );
    }
  }

  // Library-resolved town (avinasi / services in avinasi) with no service → list covering services
  if (
    resolvedLocation
    && !lockedMedForCity
    && !textNamesService
    && media.length === 0
    && !cityOnly
    && !localityOnly
  ) {
    const placeLabel =
      extractGeocodePlaceHint(originalText, services)
      || resolvedLocation.town
      || resolvedLocation.district
      || null;
    if (placeLabel && !catalogMetroKeys().includes(placeLabel.toLowerCase())) {
      return startPlaceTypeBrowse(
        placeLabel,
        false,
        {
          originalText,
          qty,
          durationText,
          pendingMedia: [],
          collectedRows: [],
          collectedServiceIds: [],
          resolvedLocation,
        },
        services,
        shortReply,
      );
    }
  }

  // Mid-funnel city/area/direction refine with service already locked → continue funnel
  if (lockedMedForCity && (cityOnly || localityOnly || city || localityHint || directionFromText)) {
    const multiCitiesRefine = detectCitiesInText(originalText, services);
    // "bus semi in madurai and chennai" must NOT lock the first city and dump a
    // city-wide browse — skip dead cities / ask among usable ones.
    if (multiCitiesRefine.length >= 2 && !localityOnly && !localityHint) {
      const refineToken =
        (media[0] && canonicalizeServiceName(media[0]))
        || lockedMedForCity;
      return startBatchWithCityCandidates(
        [{
          raw: originalText,
          token: refineToken,
          qty,
          city: null,
        }],
        multiCitiesRefine,
        {
          ...baseSessionFields,
          medium: isExactCatalogMedium(refineToken, services)
            ? canonicalizeServiceName(refineToken)
            : baseSessionFields.medium,
          browseToken: canonicalizeServiceName(
            isExactCatalogMedium(refineToken, services)
              ? refineToken
              : (baseSessionFields.browseToken || lockedMedForCity),
          ),
          city: undefined,
          area: undefined,
          placeHint: undefined,
          directionHint: undefined,
          originalText,
          qty,
          durationText,
          pendingMedia: [],
        },
        services,
        shortReply,
      );
    }

    const lockedKey = canonicalizeServiceName(lockedMedForCity);
    const exactLocked = isExactCatalogMedium(lockedKey, services);
    // User typed a more specific medium than the locked family ("bus" → "bus semi")
    // with a city → start that exact medium; do not stay on family Shelter chips.
    const textMediaKey = media[0] ? canonicalizeServiceName(media[0]) : '';
    const upgradeToExact =
      !!textMediaKey
      && textMediaKey !== lockedKey
      && isExactCatalogMedium(textMediaKey, services)
      && (
        isSameMediumFamily(lockedKey, textMediaKey)
        || isSameMediumFamily(textMediaKey, lockedKey)
        || textMediaKey.startsWith(`${lockedKey} `)
      );
    if (upgradeToExact) {
      return startMediumFlow(
        textMediaKey,
        {
          ...baseSessionFields,
          medium: textMediaKey,
          browseToken: textMediaKey,
          city: cityOnly || city || baseSessionFields.city || undefined,
          area: localityOnly || localityHint || undefined,
          placeHint: localityOnly || localityHint || undefined,
          directionHint: directionFromText || undefined,
          originalText,
          qty: qty ?? baseSessionFields.qty,
          durationText: durationText ?? baseSessionFields.durationText,
          candidateServiceIds: undefined,
          needsContinueConfirm: false,
          pendingMedia: [],
        },
        services,
        shortReply,
      );
    }

    // Family browseToken (auto / bus) must stay browse-only — never promote to medium
    // or a sole city row (e.g. Auto Semi Bangalore) auto-quotes past the type ask.
    return advanceFunnel(
      {
        ...baseSessionFields,
        medium: exactLocked
          ? (baseSessionFields.medium || lockedKey)
          : (baseSessionFields.medium && isExactCatalogMedium(baseSessionFields.medium, services)
            ? baseSessionFields.medium
            : undefined),
        browseToken:
          baseSessionFields.browseToken || lockedKey,
        city: cityOnly || city || baseSessionFields.city || undefined,
        area:
          localityOnly
          || localityHint
          || (cityOnly || (city && !baseSessionFields.city)
            ? undefined
            : baseSessionFields.area)
          || undefined,
        placeHint:
          localityOnly
          || localityHint
          || (cityOnly || (city && !baseSessionFields.city)
            ? undefined
            : baseSessionFields.placeHint || baseSessionFields.area)
          || undefined,
        directionHint: (cityOnly || localityOnly)
          ? undefined
          : (baseSessionFields.directionHint || directionFromText || undefined),
      },
      services,
      shortReply,
      localityOnly || cityOnly
        ? { allowAutoFinalize: false }
        : undefined,
    );
  }

  const stripped = stripQtyCityDuration(originalText, city);
  let words = extractQueryWords(stripped).filter((w) => !STOP_WORDS.has(w));
  if (intent?.areaHint) {
    const aWords = extractQueryWords(String(intent.areaHint));
    if (aWords.length) words = [...new Set([...words, ...aWords])];
  }

  if (words.length === 0 && !city && media.length === 0) {
    return {
      step: 'small_talk',
      botText: preferEngineCopy(shortReply, copyWhichService()),
      options: [],
      session: { originalText, qty: null },
    };
  }

  const sessionBase: ProgressiveSession = preservePrior
    ? {
      ...baseSessionFields,
      medium: media[0]
        ? canonicalizeServiceName(media[0])
        : baseSessionFields.medium,
      browseToken: media[0]
        ? canonicalizeServiceName(media[0])
        : baseSessionFields.browseToken,
      city: city || baseSessionFields.city,
      area: localityHint || baseSessionFields.area,
      placeHint: localityHint || baseSessionFields.placeHint,
      mediumType: typeFromText
        ? canonicalizeServiceName(typeFromText)
        : baseSessionFields.mediumType,
      typesResolved: typeFromText
        ? true
        : baseSessionFields.typesResolved,
      qty: qty ?? baseSessionFields.qty,
      durationText: durationText ?? baseSessionFields.durationText,
      pendingMedia: media.length > 1 ? media.slice(1) : [],
    }
    : {
      originalText,
      medium: media[0] ? canonicalizeServiceName(media[0]) : undefined,
      browseToken: media[0] ? canonicalizeServiceName(media[0]) : undefined,
      city: city || undefined,
      area: nearPlaceArea || undefined,
      placeHint: nearPlaceArea || undefined,
      directionHint: directionFromText || undefined,
      mediumType: typeFromText
        ? canonicalizeServiceName(typeFromText)
        : undefined,
      typesResolved: typeFromText ? true : undefined,
      qty,
      durationText,
      pendingMedia: media.length > 1 ? media.slice(1) : media.length === 1 ? [] : [],
      collectedRows: [],
      collectedServiceIds: [],
      resolvedLocation: resolvedLocation || baseSessionFields.resolvedLocation || undefined,
    };

  if (!services.length) {
    return {
      step: 'no_match',
      botText: compactFunnelReply('No rate cards loaded yet.', 'Please upload proposals first.'),
      options: [],
      session: sessionBase,
    };
  }

  // Multi-service list ("50 bus and 10 shelter and …") → one multi-select chip list
  const segments = parseServiceSegments(originalText, services);
  if (segments.length >= 2) {
    return startBatchMultiSelect(segments, sessionBase, services, null);
  }

  // AI returned multiple media without "and"-parsed segments → same batch UI
  if (media.length >= 2) {
    const fromMedia: BatchSegment[] = media.map((m) => ({
      raw: m,
      token: canonicalizeServiceName(m),
      qty,
      city,
    }));
    return startBatchMultiSelect(fromMedia, sessionBase, services, null);
  }

  // Single media → resolve locality in same text (apartment in adyar) inside startMediumFlow
  if (media.length === 1) {
    const first = media[0];
    const priorMed = canonicalizeServiceName(
      baseSessionFields.medium || baseSessionFields.browseToken || '',
    );
    const newMed = canonicalizeServiceName(first);
    const stuckCityOnly =
      preservePrior
      && prior
      && !prior.medium
      && !prior.browseToken
      && !!prior.city;

    // Stuck Madurai-only lock after unavailable-city copy; prior text named 2+ cities.
    if (stuckCityOnly && newMed) {
      const named = detectCitiesInText(prior.originalText || '', services);
      if (named.length >= 2) {
        return startBatchWithCityCandidates(
          [{
            raw: originalText,
            token: first,
            qty,
            city: null,
          }],
          named,
          {
            ...sessionBase,
            medium: newMed,
            browseToken: newMed,
            city: undefined,
            area: undefined,
            placeHint: undefined,
            directionHint: undefined,
            originalText,
            qty,
            durationText,
            pendingMedia: [],
            batchUnavailableNote: prior.batchUnavailableNote,
            batchUnavailableSpoken: prior.batchUnavailableSpoken,
          },
          services,
          shortReply,
        );
      }
    }

    const sameServiceEcho =
      preservePrior
      && !!priorMed
      && !!newMed
      && (
        priorMed === newMed
        || isSameMediumFamily(priorMed, newMed)
        || isSameMediumFamily(newMed, priorMed)
      );
    // Bare same-service echo (only the service word): continue funnel with prior locks.
    // Do NOT restart via startMediumFlow (that cleared candidates and skipped city).
    const bareEcho =
      sameServiceEcho
      && !stuckCityOnly
      && !city
      && !localityHint
      && !directionFromText
      && !typeFromText;
    if (bareEcho) {
      logFunnelDebug('sameServiceEchoContinue', {
        originalText,
        priorMed,
        mediumType: baseSessionFields.mediumType || null,
        city: baseSessionFields.city || null,
        area: baseSessionFields.area || baseSessionFields.placeHint || null,
      });
      return advanceFunnel(
        {
          ...baseSessionFields,
          medium: baseSessionFields.medium || newMed,
          browseToken: baseSessionFields.browseToken || baseSessionFields.medium || newMed,
          originalText,
          qty: qty ?? baseSessionFields.qty,
          durationText: durationText ?? baseSessionFields.durationText,
          // Keep type/city/area; clear site lock so we re-show previous step (not auto-quote)
          directionHint: undefined,
          candidateServiceIds: undefined,
          needsContinueConfirm: false,
          pendingRows: undefined,
        },
        services,
        shortReply,
        // Never auto-quote on bare service echo — re-ask missing / confirm site
        { allowAutoFinalize: false },
      );
    }

    const locInText = detectLocalityInText(originalText, services);
    // If detectCityInText mis-tagged a locality, clear it (metros-only now, belt-and-suspenders)
    const cityForSession =
      city
      && locInText
      && canonicalizeServiceName(city) === canonicalizeServiceName(locInText)
        ? null
        : city;
    // Locality-only message that is NOT also a catalog medium → place type browse
    const mediaInText = detectMediaLocal(
      stripQtyCityDuration(originalText, cityForSession),
      services,
    );
    if (locInText && mediaInText.length === 0) {
      return startPlaceTypeBrowse(locInText, false, {
        ...sessionBase,
        city: undefined,
      }, services, shortReply);
    }

    // Service found, but named place/city/site is not in catalogue
    // (Guindy, Singapore, ghandipuram, Gemini Fly Over, …).
    // Say so, then offer where we currently provide this service — never silent quote.
    const unresolvedPlace = extractUnresolvedSitePhrase(
      originalText,
      services,
      media,
      intent?.directionHint,
    );
    const prep = placeUnavailablePrep(originalText);

    if (unresolvedPlace && !locInText && !cityForSession) {
      logFunnelDebug('placeUnavailableOffer', {
        unresolvedPlace,
        media: first,
        prep,
        hasResolved: !!sessionBase.resolvedLocation,
        resolvedState: sessionBase.resolvedLocation?.state || null,
      });
      return buildPlaceOfferTurn(
        first,
        unresolvedPlace,
        {
          ...sessionBase,
          pendingMedia: [],
          qty,
          durationText,
          originalText,
          resolvedLocation:
            sessionBase.resolvedLocation
            || resolvedLocation
            || intent?.resolvedLocation
            || null,
        },
        services,
        prep,
      );
    }

    // Known metro locked but leftover site still unresolved (rare) — note + continue
    const placeMissNote =
      unresolvedPlace && !locInText
        ? copyPlaceUnavailableContinue(first, unresolvedPlace, prep, sessionBase)
        : null;

    // Single service + multiple metros in one message
    // ("bus semi in madurai and chennai") → skip cities with no inventory; continue usable ones.
    // parseServiceSegments returns [] when only one service is named, so handle here.
    const multiCities = detectCitiesInText(originalText, services);
    if (multiCities.length >= 2 && !locInText) {
      logFunnelDebug('singleServiceMultiCity', {
        media: first,
        cities: multiCities,
      });
      return startBatchWithCityCandidates(
        [{
          raw: originalText,
          token: first,
          qty,
          city: null,
        }],
        multiCities,
        {
          ...sessionBase,
          medium: canonicalizeServiceName(first),
          browseToken: canonicalizeServiceName(first),
          city: undefined,
          area: undefined,
          placeHint: undefined,
          directionHint: undefined,
          originalText,
          qty,
          durationText,
          pendingMedia: [],
        },
        services,
        shortReply,
      );
    }

    // Service named in text → startMediumFlow (different service already reset in merge;
    // same-service with extra entities overlays city/area/type above).
    // Hoarding has several city choices. Even when the initial sentence names a
    // city, keep the normal Type → City funnel so the city chip is confirmed
    // before any site can be finalized. Do not repeat this on a later turn after
    // the user has already selected a city.
    const hoardingCityNeedsConfirmation =
      !preservePrior
      && !!cityForSession
      && /^hoardings?$/.test(canonicalizeServiceName(first))
      && !locInText
      && !nearPlaceArea
      && !directionFromText
      && !explicitAreaPhrase;
    const mediumResult = startMediumFlow(
      first,
      {
        ...sessionBase,
        pendingMedia: sessionBase.pendingMedia || [],
        medium: canonicalizeServiceName(first),
        browseToken: canonicalizeServiceName(first),
        city: hoardingCityNeedsConfirmation
          ? undefined
          : (cityForSession || sessionBase.city || undefined),
        area: locInText || sessionBase.area,
        placeHint: locInText || sessionBase.placeHint || sessionBase.area,
        needsContinueConfirm: !!locInText && !sessionBase.city,
        workQueue: sessionBase.workQueue,
        pendingCityQueue: sessionBase.pendingCityQueue,
        unresolvedPlaceOffer: !!placeMissNote,
        batchUnavailableNote: placeMissNote || sessionBase.batchUnavailableNote,
        batchUnavailableSpoken: placeMissNote ? false : sessionBase.batchUnavailableSpoken,
      },
      services,
      shortReply,
    );

    if (
      placeMissNote
      && unresolvedPlace
      && (mediumResult.step === 'quote_ready' || mediumResult.step === 'min_qty_confirm')
    ) {
      return buildPlaceOfferTurn(
        first,
        unresolvedPlace,
        { ...sessionBase, pendingMedia: [], qty, durationText, originalText },
        services,
        prep,
      );
    }

    if (placeMissNote) {
      const noted = withBatchUnavailableNote(mediumResult.botText, {
        ...mediumResult.session,
        batchUnavailableNote: placeMissNote,
        batchUnavailableSpoken: false,
        unresolvedPlaceOffer: true,
      });
      return { ...mediumResult, botText: noted.botText, session: noted.session };
    }
    return mediumResult;
  }

  // Single word that is a locality → types at that place (not "city for Saidapet")
  if (words.length === 1) {
    const token = words[0];
    const asLocality = detectLocalityInText(token, services);
    if (asLocality) {
      return startPlaceTypeBrowse(asLocality, false, sessionBase, services, shortReply);
    }
    if (filterByBrowseToken(services, token).length > 0) {
      return startMediumFlow(
        token,
        {
          ...sessionBase,
          medium: canonicalizeServiceName(token),
          browseToken: canonicalizeServiceName(token),
          pendingMedia: [],
        },
        services,
        shortReply,
      );
    }
  }

  // If first word is a catalog family, use medium flow
  if (words.length >= 1) {
    const familyTry = detectMediaLocal(words.join(' '), services);
    if (familyTry.length >= 2) {
      return startBatchMultiSelect(
        familyTry.map((m) => ({
          raw: m,
          token: m,
          qty,
          city,
        })),
        sessionBase,
        services,
        shortReply,
      );
    }
    if (familyTry.length === 1) {
      return startMediumFlow(
        familyTry[0],
        {
          ...sessionBase,
          medium: familyTry[0],
          browseToken: familyTry[0],
          pendingMedia: [],
        },
        services,
        shortReply,
      );
    }
  }

  // Fallback: word match against catalog
  const mediumHint = words[0] || prior?.medium;
  const matched = matchServices(
    services,
    words.length ? words : mediumHint ? [mediumHint] : [],
    city,
  );

  if (matched.length === 0) {
    const guess = bestFuzzyGuess(services, stripped || originalText, city);
    if (guess && guess.score >= 0.72) {
      const label = friendlyServiceLabel(guess.svc);
      return {
        step: 'did_you_mean',
        botText: preferEngineCopy(shortReply, `Did you mean ${label}?`),
        options: [
          {
            id: 'yes',
            label: 'Yes',
            serviceId: guess.svc.service_id,
            city: extractRealCityFromDbService(guess.svc) || undefined,
            imageUrl: getChipImageUrl(guess.svc),
          },
          { id: 'no', label: 'No' },
        ],
        session: {
          ...sessionBase,
          bestGuessServiceId: guess.svc.service_id,
          bestGuessLabel: label,
          medium: getMediumKey(guess.svc),
        },
      };
    }

    // City known but no media words matched → show services in that city (never dead-end)
    if (city && detectMediaLocal(originalText, services).length === 0) {
      const isKnownMetro = catalogMetroKeys().includes(city.toLowerCase());
      return startPlaceTypeBrowse(
        city,
        isKnownMetro,
        {
          ...sessionBase,
          city: isKnownMetro ? city : undefined,
          area: isKnownMetro ? sessionBase.area : city,
          placeHint: isKnownMetro ? sessionBase.placeHint : city,
        },
        services,
        preferEngineCopy(shortReply, copyPlaceServices(city)),
      );
    }

    return softClarifyNeed(
      services,
      sessionBase,
      city ? copyUnknownCity(city) : undefined,
    );
  }

  if (matched.length === 1) {
    return finalizeSelection([matched[0]], sessionBase, services);
  }

  const mediums = new Set(matched.map(getMediumKey).map(canonicalizeServiceName));
  if (!city && mediums.size === 1) {
    const medium = getMediumKey(matched[0]);
    return startMediumFlow(medium, { ...sessionBase, medium }, services, shortReply);
  }

  if (city) {
    const medium =
      (getMediumKey(matched[0]) || '').split(/\s+/)[0]
      || words[0]
      || sessionBase.medium
      || '';
    return startMediumFlow(
      medium,
      { ...sessionBase, medium },
      services,
      shortReply,
    );
  }

  return softClarifyNeed(services, sessionBase, shortReply);
}


/** Single-segment quote turn after parse. */
export function resolveTextTurn(
  text: string,
  services: DbService[],
  prior?: ProgressiveSession | null,
  intent?: IntentOverlay | null,
): ProgressiveTurnResult {
  return resolveProgressiveTextLegacy(text, services, prior, intent);
}
