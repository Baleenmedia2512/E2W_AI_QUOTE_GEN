/**
 * Funnel actions — chip / Confirm continue handlers.
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
import type {
  BatchSegment,
  ProgressiveOption,
  ProgressiveSession,
  ProgressiveStep,
  ProgressiveTurnResult,
} from './types';
import { compactFunnelReply, joinNoteAndAsk, preferEngineCopy, titleCase } from './shared';
import { areaDisplayKey, chipDisplayLabel, detectExactCatalogSelection, extractRealCityFromDbService, friendlyServiceLabel, funnelCityFromDb, getAreaLabel, getDirectionLabel, getFunnelAreaLabel, getLocalityFromMetaCity, getMediumKey, getMediumTypeFromDb, getMetaAreaRaw, getMetaCityRaw, isExactCatalogMedium, isNumericOnlyLabel, matchKnownCityLabel, parseMediumChipToken, serviceMatchesMediumChip, syncCatalogMetroKeys } from './catalog';
import { copyAskArea, copyAskCities, copyAskDirection, copyAskType, copyNoCurrentPricing, copyNotOfferedInCity, copyPlaceServices, copyQuoteReady, copyUnknownArea, copyUnknownCity, copyUnknownService, copyWhichService, minQtyConfirmBotText, minQtyConfirmOptions, typeStepBotText, withBatchStepPrompt, withBatchUnavailableNote } from './copy';
import { afterLocationResolved, startPlaceTypeBrowse } from './location';
import { areasForMediumCity, buildDirectionPicker, buildMultiAreaSitePicker, filterByExactMedium, filterByLocality, filterForBrowseOrFamily, filterHitsBySessionLocation, filterPoolBySession, isAskStepReplyWithoutOptions, isMetroSegmentToken, isSameMediumFamily, lockOneCity, mediumLabelsForCity, mergeMetroFamilyServices, poolForCityOptions, softClarifyNeed, sortTypeOptionsForBatch, startMediumFlow, uniqueAreaOptionsFromPool, uniqueCityOptionsFromPool, uniqueMediumLabelsWithExamples, uniqueMediumOnlyOptions, uniqueProductOptions, uniqueServiceOptions, uniqueTypeOnlyOptions } from './filterCatalog';
import { batchGroupKey, beginMultiCityMediumFlow, continueAfterNoPricing, continuePendingWork, startBatchMultiSelect, startBatchWithCityLock, workQueueHasOtherCities, workQueueMustContinue } from './batchResolve';


import { advanceFunnel } from './resolveNextStep';
import {
  buildRowsForServices,
  finalizeSelection,
  softPickTypes,
} from './finalize';

export function continueProgressiveAction(
  actionId: string,
  session: ProgressiveSession,
  services: DbService[],
  selectedIds?: string[],
): ProgressiveTurnResult {
  return continueProgressiveActionLegacy(actionId, session, services, selectedIds);
}


export function continueProgressiveActionInner(
  actionId: string,
  session: ProgressiveSession,
  services: DbService[],
  selectedIds?: string[],
): ProgressiveTurnResult {
  // Did you mean
  if (actionId === 'yes' && session.bestGuessKind === 'place' && session.bestGuessLabel) {
    const place = session.bestGuessLabel;
    // Batch list was stashed with a trailing place hint
    if (session.segments && session.segments.length >= 2) {
      return startBatchMultiSelect(
        session.segments,
        {
          ...session,
          placeHint: place,
          area: place,
          bestGuessKind: undefined,
          bestGuessLabel: undefined,
          pendingMedia: [],
        },
        services,
      );
    }
    return startPlaceTypeBrowse(
      place,
      false,
      {
        ...session,
        placeHint: place,
        area: place,
        bestGuessKind: undefined,
        bestGuessLabel: undefined,
      },
      services,
    );
  }
  if (actionId === 'yes' && session.bestGuessKind === 'service' && (session.bestGuessLabel || session.medium)) {
    const medium = session.bestGuessLabel || session.medium || '';
    return advanceFunnel(
      {
        ...session,
        medium: canonicalizeServiceName(medium),
        browseToken: canonicalizeServiceName(medium),
        bestGuessKind: undefined,
        bestGuessLabel: undefined,
        bestGuessServiceId: undefined,
        // Full catalog for this service — never skip city when DB has many
        candidateServiceIds: undefined,
        city: undefined,
        area: session.placeHint || undefined,
        mediumType: undefined,
      },
      services,
    );
  }
  if (actionId === 'yes' && session.bestGuessServiceId) {
    const svc = services.find((s) => s.service_id === session.bestGuessServiceId);
    if (svc) {
      return advanceFunnel(
        {
          ...session,
          medium: getMediumKey(svc),
          browseToken: getMediumKey(svc),
          bestGuessServiceId: undefined,
          candidateServiceIds: undefined,
          city: undefined,
          area: session.placeHint || undefined,
          mediumType: undefined,
        },
        services,
      );
    }
  }
  if (actionId === 'no') {
    return softClarifyNeed(services, {
      ...session,
      bestGuessKind: undefined,
      bestGuessLabel: undefined,
      bestGuessServiceId: undefined,
    });
  }

  if (actionId === 'show_others') {
    return softClarifyNeed(
      services,
      session,
      'Which service do you need?',
    );
  }

  if (actionId === 'try_again') {
    return softClarifyNeed(services, session, copyWhichService());
  }

  if (actionId === 'yes_min' && session.pendingRows?.length) {
    return {
      step: 'quote_ready',
      botText: copyQuoteReady(session, session.pendingRows),
      options: [],
      session,
      quoteRows: session.pendingRows,
    };
  }

  if (actionId === 'no_min') {
    const minQty = session.pendingRows?.[0]?.qty;
    return {
      step: 'min_qty_confirm',
      botText: `Please enter a quantity of ${minQty || 'the minimum'} or more to continue.`,
      options: [],
      session,
    };
  }

  // Batch multi-city ask ("madurai and chennai") — city Confirm starts city-locked batch
  if (
    session.segments
    && session.segments.length >= 2
    && !session.medium
    && !session.browseToken
    && !session.workQueue?.length
    && (
      actionId.startsWith('city:')
      || (selectedIds?.length && selectedIds.every((id) => id.startsWith('city:')))
    )
  ) {
    const cities = (selectedIds?.length ? selectedIds : [actionId])
      .filter((id) => id.startsWith('city:'))
      .map((id) => titleCase(id.slice(5)));
    if (cities.length) {
      // Prefer first selected that has inventory; ignore empty picks
      for (const city of cities) {
        const probe = startBatchWithCityLock(
          session.segments,
          city,
          { ...session, city },
          services,
        );
        if (probe.step !== 'no_match') {
          return probe;
        }
      }
      return startBatchWithCityLock(
        session.segments,
        cities[0]!,
        { ...session, city: cities[0] },
        services,
      );
    }
  }

  // One-city confirm: continue Area → Direction → Quote
  if (actionId === 'yes_generate') {
    return advanceFunnel(
      {
        ...session,
        city: session.city || session.bestGuessLabel,
        needsContinueConfirm: false, // User confirmed — allow finalize
      },
      services,
    );
  }

  if (actionId === 'no_generate') {
    return softClarifyNeed(
      services,
      { ...session, city: undefined, needsContinueConfirm: false },
      'Which city or service do you need?',
    );
  }

  // Combined City · Area / locality place pick — supports multi Confirm
  if (
    actionId.startsWith('place:')
    || (selectedIds?.length && selectedIds.every((id) => id.startsWith('place:') || id.startsWith('area:') || id.startsWith('city:')))
  ) {
    const ids = (selectedIds?.length ? selectedIds : [actionId]).filter((id) =>
      id.startsWith('place:') || id.startsWith('area:') || id.startsWith('city:'),
    );
    const token = session.browseToken || session.medium || '';
    const pool = filterForBrowseOrFamily(services, token);
    let allHits: DbService[] = [];
    let lastSession = session;

    for (const id of ids) {
      if (id.startsWith('city:')) {
        const city = titleCase(id.slice(5));
        const nextSession: ProgressiveSession = { ...session, city, area: undefined, browseToken: token, medium: session.medium || token };
        const cityHits = filterHitsBySessionLocation(pool, nextSession);
        // If only city and many have direction → keep accumulating; else accumulate
        for (const h of cityHits) {
          if (!allHits.some((x) => x.service_id === h.service_id)) allHits.push(h);
        }
        lastSession = nextSession;
        continue;
      }
      if (id.startsWith('area:')) {
        const areaKey = id.slice(5);
        const areaPool = session.city
          ? areasForMediumCity(services, token, session.city)
          : pool;
        const areaLabel =
          areaPool
            .map((s) => getFunnelAreaLabel(s) || getAreaLabel(s) || getLocalityFromMetaCity(s))
            .find((a) => a && areaDisplayKey(a) === areaDisplayKey(areaKey))
          || titleCase(areaKey.replace(/-/g, ' '));
        const nextSession: ProgressiveSession = {
          ...session,
          area: areaLabel,
          browseToken: token,
          medium: session.medium || token,
        };
        const hits = filterHitsBySessionLocation(areaPool.length ? areaPool : pool, nextSession);
        for (const h of hits) {
          if (!allHits.some((x) => x.service_id === h.service_id)) allHits.push(h);
        }
        lastSession = nextSession;
        continue;
      }
      // place:
      const payload = id.slice(6);
      const pipe = payload.indexOf('|');
      const cityKey = pipe >= 0 ? payload.slice(0, pipe) : payload;
      const areaKey = pipe >= 0 ? payload.slice(pipe + 1) : '';
      const isLocality = cityKey === 'locality';
      const areaLabel =
        pool
          .map((s) => getAreaLabel(s) || getLocalityFromMetaCity(s))
          .find((a) => a && areaDisplayKey(a) === areaDisplayKey(areaKey))
        || titleCase(areaKey.replace(/-/g, ' '));
      let city: string | undefined;
      if (isLocality) {
        const localityHits = pool.filter((s) => {
          const loc = getLocalityFromMetaCity(s) || getAreaLabel(s);
          return loc && canonicalizeServiceName(loc) === areaKey;
        });
        city = (localityHits.length > 0 ? extractRealCityFromDbService(localityHits[0]) : null) || undefined;
        // Prefer matching by locality for hits
        const locHits = filterByLocality(pool, areaLabel);
        for (const h of locHits) {
          if (!allHits.some((x) => x.service_id === h.service_id)) allHits.push(h);
        }
      } else {
        city = titleCase(cityKey);
        const nextSession: ProgressiveSession = {
          ...session,
          city,
          area: areaLabel,
          browseToken: token || session.browseToken,
          medium: session.medium || token,
        };
        const hits = filterHitsBySessionLocation(pool, nextSession);
        for (const h of hits) {
          if (!allHits.some((x) => x.service_id === h.service_id)) allHits.push(h);
        }
        lastSession = nextSession;
        continue;
      }
      lastSession = {
        ...session,
        city,
        area: areaLabel,
        browseToken: token || session.browseToken,
        medium: session.medium || token,
      };
    }

    // Single city chip → continue funnel (Type → Area → Direction)
    if (ids.length === 1 && ids[0].startsWith('city:')) {
      const city = titleCase(ids[0].slice(5));
      const nextSession: ProgressiveSession = {
        ...session,
        city,
        area: undefined,
        placeHint: undefined,
        needsContinueConfirm: false,
        unresolvedPlaceOffer: false,
        candidateServiceIds: undefined,
        pendingCityQueue: undefined,
      };
      if (token) {
        return advanceFunnel({
          ...nextSession,
          browseToken: token,
          medium: session.medium || token,
        }, services);
      }
      return advanceFunnel(
        nextSession,
        services,
        copyPlaceServices(city),
      );
    }

    // Multi-city / multi-area Confirm → ONE quote with a line per selection (RULE 5)
    if (ids.length > 1) {
      const uniqueCities: string[] = [];
      const uniqueAreas: string[] = [];
      const seenCity = new Set<string>();
      const seenArea = new Set<string>();
      for (const id of ids) {
        let cityLabel = '';
        if (id.startsWith('city:')) {
          cityLabel = titleCase(id.slice(5));
        } else if (id.startsWith('area:')) {
          const areaKey = id.slice(5);
          const areaPool = session.city
            ? areasForMediumCity(services, token, session.city)
            : pool;
          const areaLabel =
            areaPool
              .map((s) => getFunnelAreaLabel(s) || getAreaLabel(s) || getLocalityFromMetaCity(s))
              .find((a) => a && areaDisplayKey(a) === areaDisplayKey(areaKey))
            || titleCase(areaKey.replace(/-/g, ' '));
          const ak = areaDisplayKey(areaLabel);
          if (areaLabel && !seenArea.has(ak)) {
            seenArea.add(ak);
            uniqueAreas.push(areaLabel);
          }
          continue;
        } else if (id.startsWith('place:')) {
          const payload = id.slice(6);
          const pipe = payload.indexOf('|');
          const cityKey = pipe >= 0 ? payload.slice(0, pipe) : payload;
          const areaKey = pipe >= 0 ? payload.slice(pipe + 1) : '';
          if (cityKey === 'locality' && areaKey) {
            const areaLabel =
              pool
                .map((s) => getAreaLabel(s) || getLocalityFromMetaCity(s))
                .find((a) => a && areaDisplayKey(a) === areaDisplayKey(areaKey))
              || titleCase(areaKey.replace(/-/g, ' '));
            const ak = areaDisplayKey(areaLabel);
            if (areaLabel && !seenArea.has(ak)) {
              seenArea.add(ak);
              uniqueAreas.push(areaLabel);
            }
            continue;
          }
          if (cityKey === 'locality') continue;
          cityLabel = titleCase(cityKey);
        }
        const key = cityLabel.toLowerCase();
        if (cityLabel && !seenCity.has(key)) {
          seenCity.add(key);
          uniqueCities.push(cityLabel);
        }
      }

      const medium = canonicalizeServiceName(
        session.medium || token || getMediumKey(allHits[0]) || '',
      );

      // Multi-area (same city) → auto-lock 1-site areas; ask direction only for 2+ site areas
      if (uniqueAreas.length > 0 && uniqueCities.length === 0) {
        const repsByArea = new Map<string, { label: string; reps: DbService[] }>();
        const candPool = session.candidateServiceIds?.length
          ? services.filter((s) => session.candidateServiceIds!.includes(s.service_id))
          : [];
        // Same pool Area chips use (medium + city), then optional candidate intersect
        let basePool = session.city && (token || medium)
          ? areasForMediumCity(services, token || medium, session.city)
          : token || medium
            ? filterForBrowseOrFamily(services, token || medium)
            : services;
        if (session.mediumType) {
          const mt = canonicalizeServiceName(session.mediumType);
          const typed = basePool.filter((s) => {
            const got = getMediumTypeFromDb(s);
            return !!got && canonicalizeServiceName(got) === mt;
          });
          if (typed.length) basePool = typed;
        }
        if (candPool.length) {
          const candSet = new Set(session.candidateServiceIds);
          const narrowed = basePool.filter((s) => candSet.has(s.service_id));
          if (narrowed.length) basePool = narrowed;
        }
        if (!basePool.length && candPool.length) basePool = candPool;

        for (const areaLabel of uniqueAreas) {
          const areaKey = areaDisplayKey(areaLabel);
          let hits = filterHitsBySessionLocation(basePool, {
            ...session,
            area: areaLabel,
            city: session.city,
          });
          if (!hits.length) {
            hits = basePool.filter((s) => {
              const labels = [
                getFunnelAreaLabel(s),
                getAreaLabel(s),
                getLocalityFromMetaCity(s),
                getMetaAreaRaw(s),
              ];
              return labels.some(
                (lab) => lab && areaDisplayKey(lab) === areaKey,
              );
            });
          }
          if (!hits.length) continue;

          const areaReps: DbService[] = [];
          const seenInArea = new Set<string>();
          for (const rep of hits) {
            if (seenInArea.has(rep.service_id)) continue;
            seenInArea.add(rep.service_id);
            areaReps.push(rep);
          }
          if (areaReps.length) {
            repsByArea.set(areaKey, { label: areaLabel, reps: areaReps });
          }
        }

        const autoLocked: DbService[] = [];
        const needPick: DbService[] = [];
        const needPickAreas: string[] = [];
        const seenPick = new Set<string>();
        const seenAuto = new Set<string>();

        for (const { label, reps } of repsByArea.values()) {
          if (reps.length === 1) {
            const only = reps[0];
            if (!seenAuto.has(only.service_id)) {
              seenAuto.add(only.service_id);
              autoLocked.push(only);
            }
          } else if (reps.length >= 2) {
            needPickAreas.push(label);
            for (const rep of reps) {
              if (!seenPick.has(rep.service_id)) {
                seenPick.add(rep.service_id);
                needPick.push(rep);
              }
            }
          }
        }

        if (autoLocked.length === 0 && needPick.length === 0) {
          return {
            step: 'no_match',
            botText: copyUnknownArea('those areas'),
            options: [],
            session,
          };
        }

        // No multi-site areas → quote all single-site locks
        if (needPick.length === 0) {
          return finalizeSelection(autoLocked, {
            ...session,
            needsContinueConfirm: false,
          }, services);
        }

        // Seed single-site rows so Confirm on multi-site chips merges into one quote
        const { rows: autoRows } = buildRowsForServices(
          autoLocked,
          session.qty,
          session.durationText,
          session.originalText,
          session.qtyByServiceId,
        );

        return buildMultiAreaSitePicker(needPick, {
          ...session,
          needsContinueConfirm: false,
          // Keep remaining batch services (for example No Parking Board)
          // while the current service's multi-area sites are being selected.
          workQueue: session.workQueue,
          pendingCityQueue: session.pendingCityQueue,
          collectedRows: [...(session.collectedRows || []), ...autoRows],
          collectedServiceIds: [
            ...(session.collectedServiceIds || []),
            ...autoLocked.map((s) => s.service_id),
          ],
        }, needPickAreas);
      }

      if (uniqueCities.length === 0) {
        return afterLocationResolved(allHits, lastSession, services);
      }

      const mediumToken =
        medium
        || token
        || session.segments?.[0]?.token
        || (session.batchServiceLabels?.[0]
          ? canonicalizeServiceName(session.batchServiceLabels[0])
          : '')
        || '';
      return beginMultiCityMediumFlow(
        mediumToken,
        uniqueCities,
        {
          ...session,
          medium: canonicalizeServiceName(mediumToken || session.medium || ''),
          browseToken: canonicalizeServiceName(mediumToken || session.browseToken || ''),
          needsContinueConfirm: false,
        },
        services,
      );
    }

    return afterLocationResolved(allHits, lastSession, services);
  }

  // City pick (single — multi already handled above when mixed with place/area)
  if (actionId.startsWith('city:') && !(selectedIds && selectedIds.length > 1)) {
    const city = titleCase(actionId.slice(5));
    // Batch services waiting on city (no medium yet)
    if (
      session.segments
      && session.segments.length >= 2
      && !session.medium
      && !session.browseToken
      && !session.workQueue?.length
    ) {
      return startBatchWithCityLock(
        session.segments,
        city,
        { ...session, city },
        services,
      );
    }
    const token = session.browseToken || session.medium || '';
    // Service-first city pick: clear stale area/place + candidates so Madurai isn't
    // filtered by a previous Vadapalani/Hosur session or a type-skewed id list
    const nextSession: ProgressiveSession = {
      ...session,
      city,
      area: undefined,
      placeHint: undefined,
      needsContinueConfirm: false,
      candidateServiceIds: undefined,
      pendingCityQueue: undefined,
    };
    if (token) {
      const cityPool = filterHitsBySessionLocation(
        filterForBrowseOrFamily(services, token),
        { ...nextSession, medium: session.medium || token, browseToken: token },
      );
      if (cityPool.length && !cityPool.some((row) => hasQuotablePricing(row))) {
        const label = uniqueMediumOnlyOptions(cityPool)[0]?.label
          || String(session.medium || token).trim();
        return continueAfterNoPricing(
          {
            ...nextSession,
            browseToken: token,
            medium: session.medium || token,
          },
          services,
          [`${label} (${city})`],
        );
      }
      return advanceFunnel({
        ...nextSession,
        browseToken: token,
        medium: session.medium || token,
      }, services);
    }
    return advanceFunnel(
      nextSession,
      services,
      copyPlaceServices(city),
    );
  }

  // Area-only pick (after city) — single; multi handled in place block above
  if (actionId.startsWith('area:') && !(selectedIds && selectedIds.length > 1)) {
    const areaKey = actionId.slice(5);
    const token = session.browseToken || session.medium || '';
    const pool = session.city
      ? areasForMediumCity(services, token || session.medium || '', session.city)
      : (token ? filterForBrowseOrFamily(services, token) : services);
    const areaLabel =
      pool
        .map((s) => getAreaLabel(s))
        .find((a) => a && areaDisplayKey(a) === areaDisplayKey(areaKey))
      || titleCase(areaKey.replace(/-/g, ' '));
    const nextSession: ProgressiveSession = {
      ...session,
      area: areaLabel,
      browseToken: token || session.browseToken,
      medium: session.medium || token || undefined,
    };
    return advanceFunnel(nextSession, services);
  }

  // Medium / type chip (from city type list or catalog) — after location, narrow to type
  if (actionId.startsWith('medium:') || (selectedIds?.length && selectedIds.every((id) => id.startsWith('medium:')))) {
    // Collect all selected medium tokens (multi-select confirm may send several)
    // Tokens may be "Metro Station" or "Metro Station|elevated" (medium + medium_type).
    const allChips = (selectedIds?.length ? selectedIds : [actionId])
      .filter((id) => id.startsWith('medium:'))
      .map((id) => parseMediumChipToken(id.slice(7)));
    const primary = allChips[0];
    const primaryMedium = primary?.medium || '';
    const pending = session.pendingMedia || [];

    // Multi-service Confirm → one quote with all lines when each medium can resolve
    if (allChips.length > 1) {
      const mediumKeys = [
        ...new Set(
          allChips
            .map((c) => canonicalizeServiceName(c.medium))
            .filter(Boolean),
        ),
      ];
      const typeKeys = [
        ...new Set(
          allChips
            .map((c) => (c.mediumType ? canonicalizeServiceName(c.mediumType) : ''))
            .filter(Boolean),
        ),
      ];
      // Same medium, multiple types (Frontlit + Nonlit / Elevated + Underground):
      // ONE union candidate set. Keep batch workQueue so remaining services still ask.
      const sameMediumMultiType =
        mediumKeys.length === 1
        && typeKeys.length >= 1;
      const isBatchMulti = !!(session.segments && session.segments.length >= 2);
      const keepBatchQueue = isBatchMulti || workQueueMustContinue(session);
      const placeLocked =
        !!(session.placeHint || session.area)
        && !keepBatchQueue;

      if (sameMediumMultiType || placeLocked) {
        const seenIds = new Set<string>();
        const merged: DbService[] = [];
        for (const chip of allChips) {
          const med = canonicalizeServiceName(chip.medium);
          if (!med) continue;
          let hits = filterByExactMedium(services, med);
          if (!hits.length) {
            hits = services.filter((s) => serviceMatchesMediumChip(s, chip));
          }
          hits = filterHitsBySessionLocation(hits, {
            ...session,
            medium: med,
            area: session.area || session.placeHint,
            city: session.city,
          });
          if (chip.mediumType) {
            const mt = canonicalizeServiceName(chip.mediumType);
            const typed = hits.filter((s) => {
              const got = getMediumTypeFromDb(s);
              return !!got && canonicalizeServiceName(got) === mt;
            });
            if (typed.length) hits = typed;
          }
          for (const h of hits) {
            if (!seenIds.has(h.service_id)) {
              seenIds.add(h.service_id);
              merged.push(h);
            }
          }
        }
        if (!merged.length) {
          return softClarifyNeed(
            services,
            session,
            copyUnknownArea(
              session.area || session.placeHint || session.city || 'that place',
            ),
          );
        }
        const selectedLabels = allChips
          .map((c) => {
            const m = titleCase(c.medium);
            return c.mediumType ? `${m} — ${titleCase(c.mediumType)}` : m;
          })
          .join(', ');
        return advanceFunnel(
          {
            ...session,
            medium: canonicalizeServiceName(primaryMedium),
            browseToken: canonicalizeServiceName(primaryMedium),
            // Keep all selected types in candidates — do not lock mediumType to one
            mediumType: typeKeys.length === 1 ? typeKeys[0] : undefined,
            // Critical: skip type re-ask when mediumType is intentionally unset for union
            typesResolved: true,
            candidateServiceIds: merged.map((s) => s.service_id),
            // Batch: keep remaining services. Place-only: clear type leftovers.
            workQueue: keepBatchQueue ? session.workQueue : undefined,
            pendingCityQueue: keepBatchQueue ? session.pendingCityQueue : undefined,
            batchServiceLabels: keepBatchQueue ? session.batchServiceLabels : undefined,
            needsContinueConfirm: placeLocked && !session.city,
            area: session.area || session.placeHint,
            placeHint: session.placeHint || session.area,
          },
          services,
          keepBatchQueue
            ? `Added ${selectedLabels} to your quote.`
            : undefined,
        );
      }

      type WorkItem = {
        medium: string;
        browseToken?: string;
        qty: number | null;
        city?: string;
        candidateServiceIds?: string[];
      };
      const readyReps: DbService[] = [];
      const needFunnel: WorkItem[] = [];
      const unpricedLabels: string[] = [];

      for (const chip of allChips) {
        const med = canonicalizeServiceName(chip.medium);
        if (!med) continue;
        let hits = filterByExactMedium(services, med);
        if (!hits.length) {
          hits = services.filter((s) => serviceMatchesMediumChip(s, chip));
        }
        if (session.city) {
          const scoped = filterHitsBySessionLocation(hits, { ...session, medium: med, city: session.city });
          // City locked → never widen to other metros if this type/medium isn't there
          if (!scoped.length) continue;
          hits = scoped;
        }
        if (session.area || session.placeHint) {
          const scoped = filterHitsBySessionLocation(hits, {
            ...session,
            medium: med,
            area: session.area || session.placeHint,
          });
          if (!scoped.length) continue;
          hits = scoped;
        }
        if (!hits.length) continue;

        if (!hits.some((row) => hasQuotablePricing(row))) {
          unpricedLabels.push(chipDisplayLabel(chip));
          continue;
        }

        if (chip.mediumType) {
          const mt = canonicalizeServiceName(chip.mediumType);
          const typed = hits.filter((s) => {
            const got = getMediumTypeFromDb(s);
            return !!got && canonicalizeServiceName(got) === mt;
          });
          if (typed.length) hits = typed;
          else if (session.city) continue; // type not in locked city
        } else {
          // Multi-select must not skip Type (Elevated / Underground) by auto-picking
          // one site when direction_remarks are empty or a single site exists.
          const types = uniqueTypeOnlyOptions(hits, med);
          if (types.length > 1) {
            needFunnel.push({
              medium: med,
              browseToken: med,
              qty: session.qty,
              city: session.city || undefined,
              candidateServiceIds: hits.map((s) => s.service_id),
            });
            continue;
          }
          if (types.length === 1) {
            const mt = canonicalizeServiceName(types[0].mediumType || types[0].label);
            const typed = hits.filter((s) => {
              const got = getMediumTypeFromDb(s);
              return !!got && canonicalizeServiceName(got) === mt;
            });
            if (typed.length) hits = typed;
          }
        }

        const cities = uniqueCityOptionsFromPool(hits, med);
        // Shared city on session, or exactly one city in pool → try to pick a rep
        const cityLock =
          session.city
          || (cities.length === 1 ? (cities[0].city || cities[0].label) : undefined);

        let scoped = hits;
        if (cityLock) {
          scoped = filterHitsBySessionLocation(hits, {
            ...session,
            medium: med,
            city: cityLock,
          });
          // Never fall back to all cities when a city is locked
          if (!scoped.length) continue;
        }

        const withDir = scoped.filter((s) => !!getDirectionLabel(s));
        const dirKeys = [
          ...new Set(
            withDir
              .map((s) => canonicalizeServiceName(getDirectionLabel(s) || ''))
              .filter(Boolean),
          ),
        ];

        // Ready when city known and at most one direction (or no directions / single site)
        if (cityLock && (dirKeys.length <= 1 || scoped.length === 1)) {
          const rep =
            (dirKeys.length === 1 && (pickPreferredDbService(withDir) || withDir[0]))
            || pickPreferredDbService(scoped)
            || scoped[0];
          if (rep && hasQuotablePricing(rep)) readyReps.push(rep);
          else if (rep) unpricedLabels.push(chipDisplayLabel(chip));
          continue;
        }

        needFunnel.push({
          medium: med,
          browseToken: med,
          qty: session.qty,
          city: cityLock,
          candidateServiceIds: scoped.map((s) => s.service_id),
        });
      }

      // All selected options unavailable or unpriced — skip and continue batch
      if (readyReps.length === 0 && needFunnel.length === 0) {
        if (unpricedLabels.length) {
          return continueAfterNoPricing(session, services, unpricedLabels);
        }
        const label = allChips
          .map((c) => chipDisplayLabel(c))
          .join(', ') || titleCase(session.medium || 'this service');
        if (session.city) {
          const skipMsg = copyNotOfferedInCity(label, session.city, session);
          const continued = continuePendingWork(
            {
              ...session,
              needsContinueConfirm: false,
              pendingRows: undefined,
              candidateServiceIds: undefined,
            },
            [...(session.collectedRows || [])],
            [...(session.collectedServiceIds || [])],
            services,
          );
          if (continued) {
            return {
              ...continued,
              botText: joinNoteAndAsk(skipMsg, continued.botText),
            };
          }
          return softClarifyNeed(services, session, skipMsg);
        }
      }

      // All resolved → collect lines; keep batch workQueue so next services still ask
      if (readyReps.length > 0 && needFunnel.length === 0) {
        const built = buildRowsForServices(
          readyReps,
          session.qty,
          session.durationText,
          session.originalText,
          session.qtyByServiceId,
        );
        const collectedRows = [...(session.collectedRows || []), ...built.rows];
        const collectedServiceIds = [
          ...(session.collectedServiceIds || []),
          ...readyReps.map((s) => s.service_id),
        ];
        const continued = continuePendingWork(
          { ...session, collectedRows, collectedServiceIds },
          collectedRows,
          collectedServiceIds,
          services,
        );
        if (continued) {
          if (unpricedLabels.length) {
            const nextLabel = titleCase(
              continued.session.medium || continued.session.browseToken || '',
            );
            return {
              ...continued,
              botText: copyNoCurrentPricing(unpricedLabels, nextLabel || undefined),
            };
          }
          return continued;
        }
        return finalizeSelection(readyReps, {
          ...session,
          needsContinueConfirm: false,
          // Do NOT clear workQueue — remaining batch services must continue
        }, services);
      }

      // Some need funnel — queue unmet chips AFTER remaining batch work
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

      if (needFunnel.length === 0) {
        if (seedRows.length) {
          const continued = continuePendingWork(
            { ...session, collectedRows: seedRows, collectedServiceIds: seedIds },
            seedRows,
            seedIds,
            services,
          );
          if (continued) return continued;
          return finalizeSelection([], {
            ...session,
            collectedRows: seedRows,
            collectedServiceIds: seedIds,
            needsContinueConfirm: false,
          }, services);
        }
      } else {
        const [first, ...rest] = needFunnel;
        const priorQueue = session.workQueue || [];
        const nextLabel = titleCase(first.medium);
        const handoff = unpricedLabels.length
          ? copyNoCurrentPricing(unpricedLabels, nextLabel)
          : `Now choosing ${nextLabel}${first.city ? ` in ${first.city}` : ''}.`;
        const result = advanceFunnel(
          {
            ...session,
            medium: canonicalizeServiceName(first.medium),
            browseToken: canonicalizeServiceName(first.browseToken || first.medium),
            mediumType: undefined,
            city: first.city || session.city,
            area: session.area || session.placeHint,
            qty: first.qty,
            candidateServiceIds: first.candidateServiceIds,
            workQueue: [...rest, ...priorQueue],
            pendingCityQueue: undefined,
            collectedRows: seedRows,
            collectedServiceIds: seedIds,
            needsContinueConfirm: false,
            typesResolved: undefined,
          },
          services,
        );
        if (unpricedLabels.length) {
          return { ...result, botText: handoff };
        }
        return rest.length || priorQueue.length
          ? withBatchStepPrompt(result, handoff)
          : result;
      }
    }

    const nextMedium = canonicalizeServiceName(primaryMedium);
    const previousMedium = canonicalizeServiceName(
      session.medium || session.browseToken || '',
    );
    // RULE 8: type lock on same medium keeps place.
    // Place-first (OMR/ECR): picking a service MUST keep area/placeHint → city = that metro only.
    // Only clear place when switching medium with no locked place (stale city from earlier turn).
    const mediumChanged = !previousMedium || previousMedium !== nextMedium;
    const lockingType = !!primary?.mediumType;
    const prevType = canonicalizeServiceName(session.mediumType || '');
    const nextType = lockingType
      ? canonicalizeServiceName(primary!.mediumType!)
      : '';
    const typeChanged = lockingType && !!nextType && nextType !== prevType;
    const keepPlace = !!(session.placeHint || session.area) && !typeChanged;
    // Keep typed/batch city across type picks ("auto in chennai" → Auto Back Sticker).
    // Never clear city on medium change — that reopened Rotn / other metros.
    // Type change clears direction (+ area-dependent site pool) per final rule.

    const nextSession: ProgressiveSession = {
      ...session,
      medium: nextMedium,
      browseToken: nextMedium,
      needsContinueConfirm: keepPlace
        ? true
        : mediumChanged || typeChanged
          ? false
          : session.needsContinueConfirm,
      area: mediumChanged && !keepPlace
        ? undefined
        : typeChanged
          ? session.area || session.placeHint
          : (session.area || session.placeHint),
      placeHint: mediumChanged && !keepPlace
        ? undefined
        : typeChanged
          ? session.placeHint || session.area
          : (session.placeHint || session.area),
      city: session.city,
      // Re-scope candidates for the new medium/type; funnel filters by city again
      candidateServiceIds: mediumChanged || typeChanged ? undefined : session.candidateServiceIds,
      directionHint: typeChanged ? undefined : session.directionHint,
      pendingCityQueue: mediumChanged && !session.city ? undefined : session.pendingCityQueue,
      // Place-locked single type: never carry stale type leftovers into the site ask.
      // Still keep a true batch queue (another service / another city).
      workQueue: keepPlace && !workQueueMustContinue(session)
        ? undefined
        : session.workQueue,
      batchServiceLabels: keepPlace ? undefined : session.batchServiceLabels,
      mediumType: lockingType
        ? canonicalizeServiceName(primary!.mediumType!)
        : mediumChanged
          ? undefined
          : session.mediumType,
      typesResolved: lockingType
        ? true
        : mediumChanged
          ? undefined
          : session.typesResolved,
      pendingMedia: pending.filter(
        (m) => !allChips.some((c) => canonicalizeServiceName(c.medium) === canonicalizeServiceName(m)),
      ),
    };

    // Continue strict funnel: Type → City → Area → Direction
    return advanceFunnel(nextSession, services);
  }

  // Product chip without serviceId — resolve by label against candidates (multi-select ok)
  if (actionId.startsWith('product:') || (selectedIds?.length && selectedIds.every((id) => id.startsWith('product:')))) {
    const keys = (selectedIds?.length ? selectedIds : [actionId])
      .filter((id) => id.startsWith('product:'))
      .map((id) => id.slice(8));
    const pool = session.candidateServiceIds?.length
      ? services.filter((s) => session.candidateServiceIds!.includes(s.service_id))
      : services;
    const hits = pool.filter((s) => {
      const label = canonicalizeServiceName((s.service_name || '').split('·')[0] || '');
      return keys.some((key) => label === key || label.includes(key) || key.includes(label));
    });
    if (hits.length === 0) {
      return softPickTypes(
        services,
        session,
        session.city,
        copyAskType(session.browseToken || session.medium || 'that'),
      );
    }
    if (keys.length > 1) {
      // One rep per product key
      const reps: DbService[] = [];
      const seen = new Set<string>();
      for (const key of keys) {
        const match = hits.find((s) => {
          const label = canonicalizeServiceName((s.service_name || '').split('·')[0] || '');
          return label === key || label.includes(key) || key.includes(label);
        });
        if (match && !seen.has(match.service_id)) {
          seen.add(match.service_id);
          reps.push(match);
        }
      }
      if (reps.length) return finalizeSelection(reps, session, services);
    }
    // Need city?
    if (!session.city) {
      const cities = new Set(
        hits.map((s) => extractRealCityFromDbService(s)).filter(Boolean) as string[],
      );
      if (cities.size >= 1) {
        const medium = getMediumKey(hits[0]);
        const family = (medium || '').split(/\s+/)[0] || medium;
        return {
          step: 'pick_city',
          botText: copyAskCities(family || medium),
          options: [...cities].sort().map((c) => ({
            id: `city:${c.toLowerCase()}`,
            label: c,
            city: c,
            medium: family || medium,
          })),
          allowMulti: true,
          session: { ...session, medium: family || medium, candidateServiceIds: hits.map((s) => s.service_id) },
        };
      }
    }
    const city = session.city;
    const cityHits = city
      ? hits.filter((s) => (extractRealCityFromDbService(s) || '').toLowerCase() === city.toLowerCase())
      : hits;
    const use = cityHits.length ? cityHits : hits;
    const withAreas = use.filter((s) => {
      const a = getAreaLabel(s);
      return !!a && !isNumericOnlyLabel(a);
    });
    if (withAreas.length > 1) {
      return {
        step: 'pick_area',
        botText: copyAskArea(
          city || extractRealCityFromDbService(use[0]) || undefined,
          getMediumKey(use[0]),
        ),
        options: uniqueServiceOptions(withAreas),
        allowMulti: true,
        session: { ...session, medium: getMediumKey(use[0]), candidateServiceIds: withAreas.map((s) => s.service_id) },
      };
    }
    const withDir = use.filter((s) => !!getDirectionLabel(s));
    if (withDir.length > 1 && withAreas.length <= 1) {
      return buildDirectionPicker(withDir, session, city || session.area || '');
    }
    if (use.length > 1) {
      return {
        step: 'related_services',
        botText: 'Here are some related options that may fit your brief:',
        options: uniqueServiceOptions(use),
        allowMulti: true,
        session: { ...session, medium: getMediumKey(use[0]), candidateServiceIds: use.map((s) => s.service_id) },
      };
    }
    return finalizeSelection(use, session, services);
  }

  // Direction pick — single or multi confirm
  if (
    actionId.startsWith('direction:')
    || (selectedIds?.length && selectedIds.every((id) => id.startsWith('direction:')))
  ) {
    const ids = selectedIds?.length
      ? selectedIds.flatMap((id) => (id.startsWith('direction:') ? id.slice(10).split(',') : [id]))
      : actionId.slice(10).split(',');
    const selected = services.filter((s) => ids.includes(s.service_id));
    if (selected.length) return finalizeSelection(selected, session, services);
  }

  // Batch-group confirm: compact id `batch-group:seg|place|idx` → look up session.batchGroupMap
  // Legacy ids still encode uuid lists: `batch-group:id1,id2,...`
  const hasBatchGroup = (selectedIds || [actionId]).some((id) => id.startsWith('batch-group:'));
  if (hasBatchGroup) {
    const selectedChips = (selectedIds || [actionId]).filter((id) => id.startsWith('batch-group:'));

    type WorkItem = {
      medium: string;
      browseToken?: string;
      qty: number | null;
      city?: string;
      candidateServiceIds: string[];
    };
    const workItems: WorkItem[] = [];

    for (const chipId of selectedChips) {
      const mapped = session.batchGroupMap?.[chipId];
      const ids = mapped?.length
        ? mapped
        : chipId.slice(12).split(',').filter((x) => x.length > 8 && !x.includes('|'));
      let candidates = services.filter((s) => ids.includes(s.service_id));
      if (!candidates.length && chipId.includes('|')) {
        // Compact id without map (e.g. restored history) — recover by seg/place label
        const parts = chipId.slice(12).split('|');
        const segKey = parts[0] || '';
        const placeKey = parts[1] || '';
        candidates = services.filter((s) => {
          const med = canonicalizeServiceName(getMediumKey(s));
          if (segKey && !med.includes(segKey) && !canonicalizeServiceName(s.service_name || '').includes(segKey)) {
            return false;
          }
          if (!placeKey) return true;
          const city = extractRealCityFromDbService(s);
          const loc = getLocalityFromMetaCity(s);
          return (
            (city && canonicalizeServiceName(city) === placeKey)
            || (loc && canonicalizeServiceName(loc) === placeKey)
          );
        });
      }
      if (!candidates.length) continue;
      const rep = candidates[0];
      const city =
        extractRealCityFromDbService(rep)
        || (rep && matchKnownCityLabel(getMetaCityRaw(rep) || '') ? matchKnownCityLabel(getMetaCityRaw(rep) || '') : null)
        || undefined;
      // Never lock work-item city to a locality (Anna Nagar) — only known metros
      const cityLock =
        city
        || (ids
          .map((id) => services.find((s) => s.service_id === id))
          .map((s) => (s ? extractRealCityFromDbService(s) : null))
          .find(Boolean) || undefined);
      const medium = getMediumKey(rep) || session.browseToken || session.medium || 'service';
      const family = canonicalizeServiceName(medium).split(/\s+/).filter(Boolean)[0] || medium;

      // Expand to ALL family rows in this real city so Metro shows Elevated/Underground/Wrap/Train Inside
      if (cityLock && family.length >= 3) {
        const broader = filterForBrowseOrFamily(services, family).filter((s) => {
          const real = extractRealCityFromDbService(s);
          if (real && canonicalizeServiceName(real) === canonicalizeServiceName(cityLock)) {
            return true;
          }
          // Locality-only rows promoted when sole city of this chip group
          return !real && ids.includes(s.service_id);
        });
        if (broader.length > candidates.length) candidates = broader;
      }

      let qty: number | null = session.qty;
      for (const id of ids) {
        if (session.qtyByServiceId?.[id] != null) {
          qty = session.qtyByServiceId[id];
          break;
        }
      }
      workItems.push({
        // Lock family token ("metro") so pool includes Station / Wrap / Train Inside
        medium: canonicalizeServiceName(family),
        browseToken: canonicalizeServiceName(family),
        qty,
        city: cityLock || undefined,
        candidateServiceIds: candidates.map((s) => s.service_id),
      });
    }

    // Autos already in collectedRows — keep them
    const autoRows = session.collectedRows || [];
    const autoIds = session.collectedServiceIds || [];

    if (!workItems.length) {
      if (autoIds.length) {
        const autoSvcs = services.filter((s) => autoIds.includes(s.service_id));
        const autoRepMap = new Map<string, DbService>();
        for (const svc of autoSvcs) {
          const gk = batchGroupKey(svc);
          if (!autoRepMap.has(gk)) autoRepMap.set(gk, svc);
        }
        if (autoRepMap.size) {
          const continuation = continuePendingWork(
            {
              ...session,
              collectedRows: autoRows,
              collectedServiceIds: autoIds,
              workQueue: session.workQueue,
              pendingCityQueue: session.pendingCityQueue,
            },
            autoRows,
            autoIds,
            services,
          );
          if (continuation) return continuation;
          return finalizeSelection([...autoRepMap.values()], {
            ...session,
            collectedRows: autoRows,
            collectedServiceIds: [],
            segments: undefined,
            // Do not finalize while another requested service is queued.
            workQueue: session.workQueue,
            pendingCityQueue: session.pendingCityQueue,
          }, services);
        }
      }
      return {
        step: 'no_match',
        botText: copyWhichService(),
        options: [],
        session,
      };
    }

    // Deduplicate work by medium+city
    const uniqWork: WorkItem[] = [];
    const seenW = new Set<string>();
    for (const w of workItems) {
      const key = `${canonicalizeServiceName(w.medium)}|${(w.city || '').toLowerCase()}`;
      if (seenW.has(key)) continue;
      seenW.add(key);
      uniqWork.push(w);
    }

    const [first, ...rest] = uniqWork;
    return advanceFunnel(
      {
        ...session,
        medium: canonicalizeServiceName(first.medium),
        browseToken: canonicalizeServiceName(first.browseToken || first.medium),
        mediumType: undefined,
        city: first.city,
        area: session.placeHint || undefined,
        qty: first.qty,
        candidateServiceIds: first.candidateServiceIds,
        workQueue: rest,
        pendingCityQueue: undefined,
        collectedRows: autoRows,
        collectedServiceIds: autoIds,
        segments: session.segments,
        typesResolved: undefined,
      },
      services,
      rest.length
        ? `Starting ${titleCase(first.medium)}${first.city ? ` in ${first.city}` : ''}.`
        : undefined,
    );
  }

  // Direct service_id selection (area chips) — multi
  if (selectedIds && selectedIds.length > 0) {
    const selected = services.filter((s) => selectedIds.includes(s.service_id));
    if (selected.length) return finalizeSelection(selected, session, services);
  }

  const byId = services.find((s) => s.service_id === actionId);
  if (byId) return finalizeSelection([byId], session, services);

  return {
    step: 'no_match',
        botText: copyWhichService(),
    options: [],
    session,
  };
}

/** Phase 4 — batch entry (shared / mixed / sequential city). */

export function continueProgressiveActionLegacy(
  actionId: string,
  session: ProgressiveSession,
  services: DbService[],
  selectedIds?: string[],
): ProgressiveTurnResult {
  return continueProgressiveActionInner(actionId, session, services, selectedIds);
}


/** Golden rule: 0 → not available; 1 → auto-lock; 2+ → chips. */
