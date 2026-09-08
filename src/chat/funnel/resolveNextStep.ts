/**
 * Funnel resolveNextStep — split from body.ts (Phase 8).
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

import { finalizeSelection } from './finalize';

export function advanceFunnel(
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
  opts?: { allowAutoFinalize?: boolean },
): ProgressiveTurnResult {
  syncCatalogMetroKeys(services);
  const allowAutoFinalize = opts?.allowAutoFinalize !== false;
  // Re-apply an exact service/type lock whenever the funnel is re-entered.
  // This protects typed requests and chip-confirm paths from reopening the
  // family list after another state transition.
  const exactSelection =
    (session.originalText || '').trim() && !session.typesResolved
      ? detectExactCatalogSelection(session.originalText || '', services)
      : null;
  const currentMedium = canonicalizeServiceName(
    session.medium || session.browseToken || '',
  );
  const exactMedium = canonicalizeServiceName(exactSelection?.medium || '');
  const exactCompatible =
    !!exactSelection
    && (
      !currentMedium
      || currentMedium === exactMedium
      || isSameMediumFamily(currentMedium, exactMedium)
      || isSameMediumFamily(exactMedium, currentMedium)
    );
  // browseToken alone = family browse (e.g. "bus") — do NOT promote to locked medium
  let sess: ProgressiveSession = {
    ...session,
    medium: session.medium,
    browseToken: session.browseToken || session.medium,
    // Confirmed place hint acts as area when area not set
    area: session.area || session.placeHint,
  };
  if (exactCompatible) {
    sess = {
      ...sess,
      medium: exactSelection!.medium,
      browseToken: exactSelection!.medium,
      mediumType: exactSelection!.mediumType
        ? canonicalizeServiceName(exactSelection!.mediumType)
        : sess.mediumType,
      typesResolved: exactSelection!.mediumType ? true : sess.typesResolved,
    };
  }

  for (let guard = 0; guard < 10; guard++) {
    const pool = filterPoolBySession(services, sess);
    if (!pool.length) {
      const where = [sess.city, sess.area].filter(Boolean).join(' · ');
      const svcLabel = sess.medium || sess.browseToken;
      const fallback = sess.city && svcLabel
        ? copyNotOfferedInCity(svcLabel, sess.city, sess)
        : sess.area && svcLabel
          ? copyUnknownArea(sess.area, sess)
          : sess.city
            ? copyUnknownCity(sess.city, sess)
            : copyUnknownService(sess);
      return {
        step: 'no_match',
        // Never keep "which type?" when options are empty — that looks like a freeze
        botText:
          reply && !isAskStepReplyWithoutOptions(reply) ? reply : fallback,
        options: [],
        session: sess,
      };
    }

    if (
      sess.medium
      && isExactCatalogMedium(sess.medium, services)
      && !pool.some((row) => hasQuotablePricing(row))
    ) {
      const raw = uniqueMediumOnlyOptions(pool)[0]?.label
        || String(sess.medium).trim();
      return continueAfterNoPricing(sess, services, [raw]);
    }

    sess = {
      ...sess,
      candidateServiceIds: pool.map((s) => s.service_id),
    };

    // 1) Service (medium)
    if (!sess.medium) {
      const mediums = uniqueMediumOnlyOptions(pool);
      if (mediums.length > 1) {
        const where = [sess.city, sess.area].filter(Boolean).join(' · ');
        const typeAsk = sess.directionHint
          ? compactFunnelReply(
            `Sites matching “${sess.directionHint}”.`,
            'Which service do you need?',
          )
          : where
            ? copyPlaceServices(where, sess)
            : sess.browseToken
              ? copyAskType(sess.browseToken, sess)
              : copyWhichService(sess);
        return {
          step: 'pick_type',
          botText: typeStepBotText(
            reply && !sess.directionHint ? reply : typeAsk,
            sess.browseToken || sess.medium,
            sess.area || sess.placeHint || sess.city,
            sess,
          ) || typeAsk,
          options: mediums,
          allowMulti: true,
          session: sess,
        };
      }
      if (mediums.length === 1) {
        sess = {
          ...sess,
          medium: mediums[0].medium,
          browseToken: mediums[0].medium,
        };
        continue;
      }
    }

    // 2) Type — ALWAYS before City (RULE 1)
    // Family browse (token is NOT an exact catalog medium) → distinct mediums from DB.
    // Exact medium locked (e.g. Metro Station) → only that medium's medium_type from DB.
    // Never remount the family medium list once an exact medium is locked.
    if (sess.medium && !sess.mediumType && !sess.typesResolved) {
      const exactMedium = isExactCatalogMedium(sess.medium, services);
      if (!exactMedium) {
        const familyTok = canonicalizeServiceName(sess.browseToken || sess.medium);
        // Bare family tokens (metro / bus): merge sibling catalog rows from DB only
        const typePool = isMetroSegmentToken(familyTok)
          ? mergeMetroFamilyServices(services, pool)
          : pool;
        const familyOpts = uniqueMediumLabelsWithExamples(typePool);
        if (familyOpts.length > 1) {
          const place = sess.area || sess.placeHint || sess.city;
          return {
            step: 'pick_type',
            botText: typeStepBotText(reply, sess.browseToken || sess.medium, place, sess),
            // Thumbs via unique-next only (1 city, ≤1 type, ≤1 direction)
            options: familyOpts,
            allowMulti: true,
            session: {
              ...sess,
              candidateServiceIds: typePool.map((s) => s.service_id),
            },
          };
        }
        if (familyOpts.length === 1) {
          sess = {
            ...sess,
            medium: canonicalizeServiceName(familyOpts[0].medium || sess.medium),
            mediumType: familyOpts[0].mediumType
              ? canonicalizeServiceName(familyOpts[0].mediumType)
              : sess.mediumType,
            browseToken: familyOpts[0].medium || sess.browseToken,
            typesResolved: true,
          };
          continue;
        }
      }

      const types = sortTypeOptionsForBatch(
        uniqueTypeOnlyOptions(pool, sess.medium),
        pool,
        sess,
      );
      if (types.length > 1) {
        const place = sess.area || sess.placeHint || sess.city;
        return {
          step: 'pick_type',
          botText: typeStepBotText(reply, sess.medium, place, sess),
          // Elevated/Underground etc. — thumb when that type is unique-next
          options: types,
          allowMulti: true, // Same as city/service chips — multi type → one quote / workQueue
          session: sess,
        };
      }
      if (types.length === 1) {
        // Don't auto-lock the single type when the pool also contains untyped services
        // for the same medium (e.g. plain "Police Booth" alongside "Police Booth Inside").
        // Auto-locking would silently narrow city options to only the typed variant's cities.
        const wantedMedium = canonicalizeServiceName(sess.medium || '');
        const hasUntypedSiblings = pool.some(
          (s) =>
            canonicalizeServiceName(getMediumKey(s)) === wantedMedium
            && !getMediumTypeFromDb(s),
        );
        if (!hasUntypedSiblings) {
          sess = {
            ...sess,
            mediumType: canonicalizeServiceName(types[0].mediumType || types[0].label),
            typesResolved: true,
          };
          continue;
        }
        // Untyped siblings exist — skip type auto-lock; city step will include all variants
      }
      // 0 types — skip
    }

    // 3) City — raw DB city values (OMR/Padur/Chennai as stored). No metro invent.
    if (!sess.city) {
      const cityPool = poolForCityOptions(services, sess, pool);
      const cities = uniqueCityOptionsFromPool(cityPool, sess.medium);
      if (cities.length > 1) {
        // Place locked (near OMR): confirm with DB city labels in this pool — never invent Chennai
        if (sess.area || sess.placeHint) {
          const place = sess.area || sess.placeHint || '';
          const placeKey = canonicalizeServiceName(place);
          const placeAsCity = cities.find(
            (c) => canonicalizeServiceName(c.city || c.label) === placeKey,
          );
          if (placeAsCity) {
            sess = lockOneCity(
              sess,
              cityPool,
              placeAsCity.city || placeAsCity.label,
            );
            continue;
          }
          // Multiple distinct DB cities under this place scope → ask those labels
          return {
            step: 'pick_city',
            botText: reply || copyAskCities(sess.medium, sess),
            options: cities,
            allowMulti: true,
            session: {
              ...sess,
              candidateServiceIds: cityPool.map((s) => s.service_id),
              needsContinueConfirm: false,
            },
          };
        }
        return {
          step: 'pick_city',
          botText:
            reply
            || copyAskCities(sess.medium, sess),
          options: cities,
          allowMulti: true, // RULE 2: city/place chips = checkboxes
          session: {
            ...sess,
            candidateServiceIds: cityPool.map((s) => s.service_id),
            needsContinueConfirm: false,
          },
        };
      }
      if (cities.length === 1) {
        // User named an unavailable place — show where we offer instead of silent lock→quote
        if (sess.unresolvedPlaceOffer) {
          return {
            step: 'pick_city',
            botText: reply || copyAskCities(sess.medium, sess),
            options: cities,
            allowMulti: true,
            session: {
              ...sess,
              candidateServiceIds: cityPool.map((s) => s.service_id),
              needsContinueConfirm: false,
            },
          };
        }
        const onlyCity = cities[0].city || cities[0].label;
        sess = lockOneCity(sess, cityPool, onlyCity);
        continue;
      }
      // 0 cities (all NA) — if place locked, lock place label and continue
      if ((sess.area || sess.placeHint) && cityPool.length > 0) {
        sess = lockOneCity(
          sess,
          cityPool,
          sess.area || sess.placeHint || 'this place',
        );
        continue;
      }
      // 0 cities (all NA) — skip city step
    }

    // 4) Area — actual area_name values. A typed direction already narrowed
    // the pool to direction_remarks rows, so do not route it back through the
    // Area step (for example, "vadapalani" must not ask for Arumbakkam or
    // Koyambedu before showing the matching full directions).
    if (!sess.area && !sess.directionHint) {
      const areas = uniqueAreaOptionsFromPool(pool, sess.city, sess.medium);
      if (areas.length > 1) {
        return {
          step: 'pick_area',
          botText:
            reply
            || copyAskArea(sess.city, sess.medium, sess),
          options: areas,
          allowMulti: true,
          session: sess,
        };
      }
      if (areas.length === 1) {
        sess = { ...sess, area: areas[0].label };
        continue;
      }
    }

    const finalPool = filterPoolBySession(services, sess);
    if (!finalPool.length) {
      return {
        step: 'no_match',
        botText: preferEngineCopy(reply, compactFunnelReply(
          "Couldn't find a match for that selection.",
          'Please choose another option.',
        )),
        options: [],
        session: sess,
      };
    }

    // 5) Direction — ask when 2+ before any finalize
    const withDir = finalPool.filter((s) => !!getDirectionLabel(s));
    const dirKeys = [
      ...new Set(
        withDir
          .map((s) => canonicalizeServiceName(getDirectionLabel(s) || ''))
          .filter(Boolean),
      ),
    ];
    const where = [sess.city, sess.area].filter(Boolean).join(' · ') || sess.directionHint || '';

    // Place/area path with no city in metadata — auto-lock place and continue
    if (sess.needsContinueConfirm && !sess.city) {
      sess = lockOneCity(
        { ...sess, medium: sess.medium || getMediumKey(finalPool[0]) },
        finalPool,
        sess.area || where || 'this city',
      );
      continue;
    }

    if (dirKeys.length > 1) {
      return buildDirectionPicker(withDir, {
        ...sess,
        needsContinueConfirm: false,
        candidateServiceIds: finalPool.map((s) => s.service_id),
      }, where);
    }

    // Place-only collapse — auto-clear continue flag (no OK tap)
    if (sess.needsContinueConfirm) {
      sess = { ...sess, needsContinueConfirm: false };
      if (!sess.city) {
        const onlyCity =
          uniqueCityOptionsFromPool(finalPool, sess.medium)[0]?.city
          || sess.area
          || where
          || 'this city';
        sess = lockOneCity(
          { ...sess, medium: sess.medium || getMediumKey(finalPool[0]) },
          finalPool,
          onlyCity,
        );
      }
      continue;
    }

    if (dirKeys.length === 1 && withDir.length >= 1) {
      // Same-service echo must not auto-quote — show the site for confirm
      if (!allowAutoFinalize) {
        return buildDirectionPicker(withDir, {
          ...sess,
          directionHint: undefined,
          needsContinueConfirm: false,
          candidateServiceIds: finalPool.map((s) => s.service_id),
        }, where);
      }
      const reps = new Map<string, DbService>();
      for (const s of withDir) {
        const key = canonicalizeServiceName(getDirectionLabel(s) || s.service_id);
        if (!reps.has(key)) reps.set(key, s);
      }
      return finalizeSelection([...reps.values()], {
        ...sess,
        candidateServiceIds: finalPool.map((s) => s.service_id),
      }, services);
    }

    // Multiple DB rows can represent one logical product across vendors,
    // pricing records, or optional row qualifiers. With no real direction
    // values, do not expose those rows as a fake site/product picker —
    // and never finalize every vendor duplicate into the quote.
    // Multi-type Confirm (Elevated+Underground / Frontlit+Nonlit) must keep
    // one preferred row PER medium_type before any single-vendor collapse.
    const logicalProducts = uniqueProductOptions(finalPool);
    if (allowAutoFinalize && dirKeys.length === 0 && logicalProducts.length === 1) {
      if (sess.typesResolved) {
        const byType = new Map<string, DbService[]>();
        for (const s of finalPool) {
          const t = canonicalizeServiceName(getMediumTypeFromDb(s) || '_none');
          const list = byType.get(t);
          if (list) list.push(s);
          else byType.set(t, [s]);
        }
        if (byType.size > 1) {
          const reps = [...byType.values()]
            .map((rows) => pickPreferredDbService(rows) || rows[0])
            .filter((s): s is DbService => !!s);
          return finalizeSelection(reps, {
            ...sess,
            candidateServiceIds: finalPool.map((s) => s.service_id),
          }, services);
        }
      }
      const preferred = pickPreferredDbService(finalPool) || finalPool[0];
      return finalizeSelection(preferred ? [preferred] : [], sess, services);
    }

    if (finalPool.length === 1) {
      const one = finalPool[0]!;
      // Same-service echo: confirm only when there is a real site/direction to pick.
      // Sole catalog row with no direction_remarks (e.g. Bus Semi · Chennai) must
      // quote — never a fake "few sites" ask with a medium-name chip.
      if (!allowAutoFinalize && getDirectionLabel(one)) {
        return buildDirectionPicker([one], {
          ...sess,
          directionHint: undefined,
          needsContinueConfirm: false,
          candidateServiceIds: [one.service_id],
        }, where);
      }
      return finalizeSelection(finalPool, sess, services);
    }

    // Type already confirmed (Elevated / Underground / multi Confirm) — do not re-ask the
    // same split as "Metro Station — Elevated" product chips. One rep per medium_type.
    if (sess.typesResolved && dirKeys.length <= 1) {
      if (!allowAutoFinalize) {
        if (withDir.length >= 1) {
          return buildDirectionPicker(withDir, {
            ...sess,
            directionHint: undefined,
            needsContinueConfirm: false,
            candidateServiceIds: finalPool.map((s) => s.service_id),
          }, where);
        }
        // No direction labels left — if pool already collapsed, quote (do not invent
        // a medium-name "location" chip).
        if (finalPool.length <= 1) {
          return finalizeSelection(finalPool, sess, services);
        }
        const mediumName = titleCase(sess.medium || sess.browseToken || 'service');
        return {
          step: 'pick_direction',
          botText:
            reply
            || compactFunnelReply(
              `Continuing ${mediumName}${where ? ` in ${where}` : ''}.`,
              'Which location do you need?',
            ),
          options: finalPool.filter(hasQuotablePricing).slice(0, 24).map((s) => ({
            id: `svc:${s.service_id}`,
            label: getDirectionLabel(s) || formatServiceDisplayName(s) || getMediumKey(s) || s.service_id,
            serviceId: s.service_id,
            medium: getMediumKey(s) || undefined,
          })),
          allowMulti: true,
          session: {
            ...sess,
            directionHint: undefined,
            candidateServiceIds: finalPool.map((s) => s.service_id),
            needsContinueConfirm: false,
          },
        };
      }
      const byType = new Map<string, DbService>();
      for (const s of finalPool) {
        const t = canonicalizeServiceName(getMediumTypeFromDb(s) || '_none');
        const prev = byType.get(t);
        if (!prev) {
          byType.set(t, s);
          continue;
        }
        // Prefer the stronger-priced vendor when several rows share a type.
        const preferred = pickPreferredDbService([prev, s]);
        if (preferred) byType.set(t, preferred);
      }
      if (byType.size >= 1) {
        return finalizeSelection([...byType.values()], {
          ...sess,
          candidateServiceIds: finalPool.map((s) => s.service_id),
        }, services);
      }
    }

    const products = logicalProducts;
    if (products.length > 1) {
      return {
        step: 'related_services',
        botText: reply || copyAskDirection(where || '', titleCase(sess.medium || 'service'), sess),
        options: products,
        allowMulti: true,
        session: {
          ...sess,
          candidateServiceIds: finalPool.map((s) => s.service_id),
        },
      };
    }

    return {
      step: 'related_services',
      botText: reply || copyAskDirection(where || '', titleCase(sess.medium || 'service'), sess),
      options: uniqueServiceOptions(finalPool),
      allowMulti: true,
      session: {
        ...sess,
        candidateServiceIds: finalPool.map((s) => s.service_id),
      },
    };
  }

  return {
    step: 'no_match',
    botText: copyWhichService(),
    options: [],
    session: sess,
  };
}

/** Short / unclear free text → candidate for Did you mean? */


// Re-export helpers used by textTurn / batchResolve / index
export {
  buildRowsForServices,
  finalizeSelection,
  resolveMinQtyEdits,
  softPickTypes,
  pickExampleServiceLabels,
  priorHasFunnelLocks,
  sameBatchServiceToken,
  priorBatchServiceTokens,
  isSameBatchEcho,
  isNewServiceSwitch,
  matchFreeTextToProgressiveOption,
} from './finalize';

export { stripQtyCityDuration } from './shared';

export function resolveNextStep(
  session: ProgressiveSession,
  services: DbService[],
  opts?: { allowAutoFinalize?: boolean },
): ProgressiveTurnResult {
  return advanceFunnel(session, services, null, opts);
}

