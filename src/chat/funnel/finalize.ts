/**
 * Funnel finalize — quote rows, min-qty, selection finalization.
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
import { areasForMediumCity, buildDirectionPicker, buildMultiAreaSitePicker, filterByExactMedium, filterByLocality, filterForBrowseOrFamily, filterHitsBySessionLocation, filterPoolBySession, isAskStepReplyWithoutOptions, isMetroSegmentToken, isSameMediumFamily, lockOneCity, MEDIUM_STYLE_TOKENS, mediumLabelsForCity, mergeMetroFamilyServices, poolForCityOptions, softClarifyNeed, sortTypeOptionsForBatch, startMediumFlow, uniqueAreaOptionsFromPool, uniqueCityOptionsFromPool, uniqueMediumLabelsWithExamples, uniqueMediumOnlyOptions, uniqueProductOptions, uniqueServiceOptions, uniqueTypeOnlyOptions } from './filterCatalog';
import { batchGroupKey, beginMultiCityMediumFlow, continueAfterNoPricing, continuePendingWork, startBatchMultiSelect, startBatchWithCityLock, workQueueHasOtherCities, workQueueMustContinue } from './batchResolve';


export function buildRowsForServices(
  selected: DbService[],
  qty: number | null,
  durationText: string | null | undefined,
  originalText: string,
  qtyByServiceId?: Record<string, number>,
): { rows: ConfirmationRow[]; belowMin: Array<{ svc: DbService; requested: number; minimum: number }> } {
  const belowMin: Array<{ svc: DbService; requested: number; minimum: number }> = [];
  const rows: ConfirmationRow[] = [];

  for (const svc of selected) {
    if (!svc?.service_id && !svc?.service_name) continue;
    const minQty = getMinQuantityFromDbService(svc);
    const metro =
      extractRealCityFromDbService(svc)
      || getLocalityFromMetaCity(svc)
      || extractCityFromDbService(svc)
      || '—';
    // City field = metro only (area · direction belong in PDF service heading, not city)
    const city = metro;
    const serviceName = (svc.service_name || '').split('·')[0].trim() || friendlyServiceLabel(svc);
    const scopedDurationText = getServiceScopedUserMessage(originalText, serviceName);
    const parsedDuration = parseDurationFromUserText(scopedDurationText);
    const parsedDurationDays = parsedDuration
      ? toCampaignDays(parsedDuration.value, parsedDuration.unit)
      : null;
    const durationDays = parsedDurationDays != null ? parsedDurationDays : undefined;
    const perSvcQty =
      qtyByServiceId && qtyByServiceId[svc.service_id] != null
        ? qtyByServiceId[svc.service_id]
        : qty;
    let useQty: number;
    if (perSvcQty == null) {
      useQty = minQty && minQty > 1 ? minQty : 1;
    } else if (minQty && minQty > 1 && perSvcQty < minQty) {
      belowMin.push({ svc, requested: perSvcQty, minimum: minQty });
      useQty = perSvcQty; // pending until user confirms
    } else {
      useQty = perSvcQty;
    }
    rows.push({
      service: serviceName,
      qty: useQty,
      city,
      serviceId: svc.service_id,
      durationDays,
    });
  }

  void durationText;
  return { rows, belowMin };
}


export function softPickTypes(
  services: DbService[],
  session: ProgressiveSession,
  city: string | undefined,
  botText: string,
): ProgressiveTurnResult {
  const types = city
    ? mediumLabelsForCity(services, city)
    : uniqueMediumOnlyOptions(services);
  return {
    step: 'pick_type',
    botText,
    options: types,
    allowMulti: types.length > 1,
    session: { ...session, city, pendingMedia: [] },
  };
}

/** Prefer common BTL media for help examples when present in catalog. */

export function pickExampleServiceLabels(services: DbService[], n = 3): string[] {
  const all = uniqueMediumLabelsWithExamples(services);
  if (!all.length) return ['Bus Semi', 'Metro Station', 'Apartment Lift'];
  const prefer = [
    'bus semi',
    'metro station',
    'apartment lift',
    'auto semi',
    'cab',
    'hoarding',
    'lamp post',
    'bus shelter',
  ];
  const picked: string[] = [];
  const used = new Set<string>();
  for (const p of prefer) {
    const hit = all.find((o) => {
      const hay = canonicalizeServiceName(`${o.label} ${o.medium || ''}`);
      return hay.includes(p) || hay.startsWith(p.split(/\s+/)[0] || p);
    });
    if (hit && !used.has(hit.id)) {
      used.add(hit.id);
      picked.push(hit.label);
      if (picked.length >= n) return picked;
    }
  }
  for (const o of all) {
    if (used.has(o.id)) continue;
    picked.push(o.label);
    if (picked.length >= n) break;
  }
  return picked;
}


export function priorHasFunnelLocks(prior?: ProgressiveSession | null): boolean {
  if (!prior) return false;
  return !!(
    prior.medium
    || prior.browseToken
    || prior.city
    || prior.area
    || prior.placeHint
    || prior.mediumType
    || prior.candidateServiceIds?.length
    || prior.workQueue?.length
    || prior.collectedRows?.length
    || prior.pendingRows?.length
  );
}

/**
 * Same catalog product for batch-echo compare.
 * Allows family refine (bus ↔ bus semi, bus shelter ↔ bus shelter double panel).
 * Never treats different products as the same (bus ↛ bus shelter).
 */

export function sameBatchServiceToken(a: string, b: string): boolean {
  const left = canonicalizeServiceName(a);
  const right = canonicalizeServiceName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftShelter = left.includes('shelter');
  const rightShelter = right.includes('shelter');
  const leftBareBus = left === 'bus' || (left.startsWith('bus ') && !leftShelter);
  const rightBareBus = right === 'bus' || (right.startsWith('bus ') && !rightShelter);
  if (
    left.includes('bus')
    && right.includes('bus')
    && leftShelter !== rightShelter
    && (leftBareBus || rightBareBus)
  ) {
    return false;
  }
  if (isSameMediumFamily(left, right) || isSameMediumFamily(right, left)) return true;

  const lw = left.split(/\s+/).filter(Boolean);
  const rw = right.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < lw.length && i < rw.length && lw[i] === rw[i]) i += 1;
  if (i === 0) return false;
  const isStyleWord = (w: string) =>
    MEDIUM_STYLE_TOKENS.has(w) || w === 'double' || w === 'single';
  return lw.slice(i).every(isStyleWord) && rw.slice(i).every(isStyleWord);
}

/** Ordered service tokens from the active batch (prefer original segments). */

export function priorBatchServiceTokens(prior: ProgressiveSession): string[] {
  const fromSegs = (prior.segments || [])
    .map((s) => canonicalizeServiceName(s.token))
    .filter(Boolean);
  if (fromSegs.length >= 2) return fromSegs;

  const out: string[] = [];
  const cur = canonicalizeServiceName(prior.browseToken || prior.medium || '');
  if (cur) out.push(cur);
  for (const w of prior.workQueue || []) {
    const t = canonicalizeServiceName(w.browseToken || w.medium || '');
    if (t) out.push(t);
  }
  if (out.length >= 2) return out;

  return (prior.batchServiceLabels || [])
    .map((label) => canonicalizeServiceName(label))
    .filter(Boolean);
}

/**
 * Same multi-service list as the active batch (e.g. "bus and auto" after "bus and auto in chennai").
 * Service-name change (bus shelter → bus) is NOT an echo — restart that batch.
 */

export function isSameBatchEcho(
  prior: ProgressiveSession | null | undefined,
  segs: Array<{ token: string }>,
): boolean {
  if (!prior || segs.length < 2) return false;
  const incoming = segs
    .map((s) => canonicalizeServiceName(s.token))
    .filter(Boolean);
  if (incoming.length < 2) return false;
  const priorToks = priorBatchServiceTokens(prior);
  if (priorToks.length < 2) return false;
  // Added / removed a service → new list
  if (priorToks.length !== incoming.length) return false;
  // Pair by order: same products only (not first-word family glue)
  return priorToks.every((token, index) =>
    sameBatchServiceToken(token, incoming[index] || ''),
  );
}

/** True when media names a *different* catalog service than the active funnel. */

export function isNewServiceSwitch(
  prior: ProgressiveSession | null | undefined,
  media: string[],
): boolean {
  if (!media.length) return false;
  const newMedia = canonicalizeServiceName(media[0] || '');
  if (!newMedia) return false;
  const priorMed = canonicalizeServiceName(
    prior?.medium || prior?.browseToken || '',
  );
  // No active service → any named service starts fresh
  if (!priorMed) return true;
  // Family → more specific ("bus" → "bus semi") counts as a switch / upgrade
  if (newMedia !== priorMed && newMedia.startsWith(`${priorMed} `)) {
    return true;
  }
  // Same service (or same family token) → continue, do not treat as switch
  if (
    priorMed === newMedia
    || isSameMediumFamily(priorMed, newMedia)
    || isSameMediumFamily(newMedia, priorMed)
  ) {
    return false;
  }
  return true;
}

/**
 * Stateful funnel merge (typed messages):
 * - DIFFERENT catalog SERVICE → full funnel reset; keep only entities in this message
 * - SAME service name echo → continue; keep type/city/area/direction; overlay new entities
 * - No service → refine current funnel (city / area / direction updates)
 * - AREA change → clear direction + site candidates (dependents)
 * - Same area again → keep direction
 * - DIRECTION change → update direction only
 */

export function matchFreeTextToProgressiveOption(
  text: string,
  options: ProgressiveOption[],
): ProgressiveOption | null {
  const raw = (text || '').trim();
  if (!raw || !options?.length) return null;
  const key = canonicalizeServiceName(raw);
  if (!key) return null;

  // Affirmative for min-qty / yes-continue style chips
  if (/^(yes|y|ok|okay|sure)([\s,.-]*(use\s+)?minimums?)?$/i.test(raw)) {
    const yes = options.find((o) =>
      /^(yes_min|yes_generate|yes)$/i.test(o.id)
      || /yes.*minimum/i.test(o.label),
    );
    if (yes) return yes;
  }
  if (/^(no|nope|adjust|i'?ll\s+adjust)$/i.test(raw)) {
    const no = options.find((o) =>
      /^(no_min|no)$/i.test(o.id) || /adjust/i.test(o.label),
    );
    if (no) return no;
  }

  // Exact label match
  const byLabel = options.find(
    (o) => canonicalizeServiceName(o.label) === key,
  );
  if (byLabel) return byLabel;

  // Short chips (city / area / type / medium): allow prefix match.
  // Direction/site options (serviceId / svc:*) must NOT match a short area token
  // ("omr" must not select "OMR towards Sholinganallur").
  const byPartial = options.find((o) => {
    const lab = canonicalizeServiceName(o.label);
    if (key.startsWith(lab) && lab.length >= 3) return true;
    if (lab === key) return true;
    // Site/direction picks — exact label only (handled above)
    if (o.serviceId || /^svc:/i.test(o.id)) return false;
    if (!(lab.startsWith(`${key} `) || lab.startsWith(key))) return false;
    return (
      /^(city|area|medium):/i.test(o.id)
      || !!o.city
      || !!o.mediumType
      || lab.split(/\s+/).filter(Boolean).length <= 2
    );
  });
  if (byPartial) return byPartial;

  // id payloads: city:chennai, medium:bus, area:omr
  const byId = options.find((o) => {
    const idKey = canonicalizeServiceName(o.id.replace(/^[^:]+:/, ''));
    return idKey === key;
  });
  if (byId) return byId;

  // Only match city/medium metadata on real city:/medium: chips —
  // area chips also carry medium=hoarding; typing "hoarding" must NOT pick Arumbakkam.
  if (options.some((o) => o.city && /^city:/i.test(o.id))) {
    const byCity = options.find(
      (o) =>
        /^city:/i.test(o.id)
        && o.city
        && canonicalizeServiceName(o.city) === key,
    );
    if (byCity) return byCity;
  }
  if (options.some((o) => o.medium && /^medium:/i.test(o.id))) {
    const byMed = options.find(
      (o) =>
        /^medium:/i.test(o.id)
        && o.medium
        && canonicalizeServiceName(o.medium) === key,
    );
    if (byMed) return byMed;
  }
  if (options.some((o) => o.mediumType)) {
    const byType = options.find(
      (o) => o.mediumType && canonicalizeServiceName(o.mediumType) === key,
    );
    if (byType) return byType;
  }

  return null;
}


export function resolveMinQtyEdits(
  session: ProgressiveSession,
  edits: Record<string, number>,
  currentDetails: Array<{ service: string; requested: number; minimum: number; serviceId?: string }>,
): ProgressiveTurnResult {
  const pending = [...(session.pendingRows || [])];
  const stillBelow: Array<{ service: string; requested: number; minimum: number; serviceId?: string }> = [];

  for (const d of currentDetails) {
    const key = d.serviceId || d.service;
    const edited = edits[key];
    const requested = edited != null && Number.isFinite(edited) && edited > 0
      ? Math.floor(edited)
      : d.requested;

    if (requested < d.minimum) {
      stillBelow.push({
        service: d.service,
        requested,
        minimum: d.minimum,
        serviceId: d.serviceId,
      });
      continue;
    }

    // Valid qty (≥ min) — write onto matching pending row
    const idx = pending.findIndex((r) =>
      (d.serviceId && r.serviceId === d.serviceId)
      || (!d.serviceId && r.service === d.service),
    );
    if (idx >= 0) {
      pending[idx] = { ...pending[idx], qty: requested };
    }
  }

  if (stillBelow.length > 0) {
    return {
      step: 'min_qty_confirm',
      botText: minQtyConfirmBotText(stillBelow, true),
      belowMinDetails: stillBelow,
      options: minQtyConfirmOptions(),
      session: {
        ...session,
        pendingRows: pending,
        collectedRows: pending,
      },
    };
  }

  return {
    step: 'quote_ready',
    botText: copyQuoteReady({ ...session, pendingRows: pending }, pending),
    options: [],
    session: {
      ...session,
      pendingRows: pending,
      collectedRows: pending,
      pendingMedia: [],
      segments: undefined,
    },
    quoteRows: pending,
  };
}


export function finalizeSelection(
  selected: DbService[],
  session: ProgressiveSession,
  services?: DbService[],
): ProgressiveTurnResult {
  const quotable = selected.filter((s) => hasQuotablePricing(s));
  const unpriced = selected.filter((s) => !hasQuotablePricing(s));
  const unpricedLabels = unpriced.map((s) => {
    const medium = getMediumKey(s) || s.service_name || 'service';
    const city = funnelCityFromDb(s) || session.city || '—';
    return `${medium} (${city})`;
  });
  if (unpricedLabels.length && services && !quotable.length) {
    return continueAfterNoPricing(session, services, unpricedLabels);
  }
  const useSelected = quotable.length ? quotable : selected;
  const { rows, belowMin } = buildRowsForServices(
    useSelected,
    session.qty,
    session.durationText,
    session.originalText,
    session.qtyByServiceId,
  );

  const collectedRows = [...(session.collectedRows || []), ...rows];
  const collectedServiceIds = [
    ...(session.collectedServiceIds || []),
    ...useSelected.map((s) => s.service_id),
  ];

  // Place-locked (OMR / locality): one site Confirm → quote.
  // Same-medium type leftovers on workQueue (Frontlit → Nonlit): never "Next up: Hoarding".
  // Same-medium DIFFERENT cities on workQueue must continue (multi-city Confirm).
  const isMultiServiceBatch = !!(session.segments && session.segments.length >= 2);
  const currentMedEarly = canonicalizeServiceName(
    session.medium
    || (selected[0] ? getMediumKey(selected[0]) : '')
    || '',
  );
  const multiCityQueue = workQueueHasOtherCities(session);
  const queuedMustContinue = workQueueMustContinue(session);
  const placeLockedQuote =
    !!(session.placeHint || session.area)
    && !isMultiServiceBatch
    && !multiCityQueue
    && !queuedMustContinue;
  const sameMediumTypeQueue =
    !isMultiServiceBatch
    && !!(session.workQueue?.length)
    && !!currentMedEarly
    && session.workQueue.every(
      (w) => canonicalizeServiceName(w.medium) === currentMedEarly,
    )
    && !multiCityQueue
    && !queuedMustContinue;

  // Sequential multi-city / true multi-service queue — continue before quote
  if (services && !placeLockedQuote && !sameMediumTypeQueue) {
    const pending = continuePendingWork(
      { ...session, pendingRows: undefined },
      collectedRows,
      collectedServiceIds,
      services,
    );
    if (pending) {
      if (unpricedLabels.length) {
        return {
          ...pending,
          botText: joinNoteAndAsk(
            copyNoCurrentPricing(unpricedLabels),
            pending.botText,
          ),
        };
      }
      return pending;
    }
  }

  // Batch multi-select already finished — never sequential "Next — pick"
  const isBatch = isMultiServiceBatch;

  const currentMed = currentMedEarly;
  const restMedia = isBatch
    ? []
    : (session.pendingMedia || []).filter(
        (m) => canonicalizeServiceName(m) !== currentMed,
      );

  // More media types left (legacy single-path multi only)
  if (restMedia.length > 0 && services) {
    return startMediumFlow(
      restMedia[0],
      {
        ...session,
        pendingMedia: restMedia.slice(1),
        collectedRows,
        collectedServiceIds,
        medium: canonicalizeServiceName(restMedia[0]),
        browseToken: canonicalizeServiceName(restMedia[0]),
        area: undefined,
        candidateServiceIds: undefined,
        pendingRows: undefined,
      },
      services,
      compactFunnelReply(
        `Now choosing ${titleCase(restMedia[0])}${session.city ? ` in ${session.city}` : ''}.`,
      ),
    );
  }

  // Ask min-qty when user typed qty and any collected row is below DB minimum
  const anyExplicitQty =
    session.qty != null
    || Object.keys(session.qtyByServiceId || {}).length > 0;
  if (anyExplicitQty && restMedia.length === 0 && services) {
    const mergedRows = [...(session.collectedRows || []), ...rows];
    // Dedupe by serviceId keeping last
    const byId = new Map<string, ConfirmationRow>();
    for (const r of mergedRows) {
      if (r.serviceId) byId.set(r.serviceId, r);
      else byId.set(`${r.service}|${r.city}|${r.qty}`, r);
    }
    const allRows = [...byId.values()];
    const belowAll: Array<{ service: string; requested: number; minimum: number; serviceId?: string }> = [];
    const fixedRows = allRows.map((r) => {
      if (!r.serviceId) return r;
      const svc = services.find((s) => s.service_id === r.serviceId);
      if (!svc) return r;
      const minQty = getMinQuantityFromDbService(svc);
      const requested = typeof r.qty === 'number' ? r.qty : parseInt(String(r.qty), 10) || 0;
      const hasExplicit =
        session.qtyByServiceId?.[r.serviceId] != null
        || session.qty != null;
      if (hasExplicit && minQty && minQty > 1 && requested < minQty) {
        belowAll.push({
          service: (svc.service_name || '').split('·')[0].trim() || friendlyServiceLabel(svc),
          requested,
          minimum: minQty,
          serviceId: r.serviceId,
        });
        return { ...r, qty: minQty };
      }
      return r;
    });

    if (belowAll.length > 0) {
      const raw = {
        step: 'min_qty_confirm' as const,
        botText: minQtyConfirmBotText(belowAll),
        belowMinDetails: belowAll.map((b) => ({
          service: b.service,
          requested: b.requested,
          minimum: b.minimum,
          serviceId: b.serviceId,
        })),
        options: minQtyConfirmOptions(),
        session: {
          ...session,
          pendingRows: fixedRows,
          collectedRows: fixedRows,
          collectedServiceIds,
          candidateServiceIds: selected.map((s) => s.service_id),
        },
      };
      const noted = withBatchUnavailableNote(raw.botText, raw.session);
      return { ...raw, botText: noted.botText, session: noted.session };
    }

    {
      const raw = {
        step: 'quote_ready' as const,
        botText: copyQuoteReady(
          { ...session, pendingRows: allRows, collectedRows: allRows },
          allRows,
        ),
        options: [] as ProgressiveOption[],
        session: {
          ...session,
          pendingRows: allRows,
          collectedRows: allRows,
          collectedServiceIds,
          pendingMedia: [],
          segments: undefined,
        },
        quoteRows: allRows,
      };
      const noted = withBatchUnavailableNote(raw.botText, raw.session);
      return { ...raw, botText: noted.botText, session: noted.session };
    }
  }

  if (anyExplicitQty && belowMin.length > 0 && restMedia.length === 0) {
    const fixedBatch = rows.map((r) => {
      const hit = belowMin.find((b) => b.svc.service_id === r.serviceId);
      return hit ? { ...r, qty: hit.minimum } : r;
    });
    const pendingRows = [
      ...(session.collectedRows || []),
      ...fixedBatch,
    ];
    const svcName = (svc: DbService) =>
      ((svc.service_name || '').split('·')[0] || friendlyServiceLabel(svc)).trim();
    return {
      step: 'min_qty_confirm',
      botText: minQtyConfirmBotText(
        belowMin.map((b) => ({
          service: svcName(b.svc),
          requested: b.requested,
          minimum: b.minimum,
        })),
      ),
      belowMinDetails: belowMin.map((b) => ({
        service: svcName(b.svc),
        requested: b.requested,
        minimum: b.minimum,
        serviceId: b.svc.service_id,
      })),
      options: minQtyConfirmOptions(),
      session: {
        ...session,
        pendingRows,
        collectedRows: pendingRows,
        collectedServiceIds,
        candidateServiceIds: selected.map((s) => s.service_id),
      },
    };
  }

  {
    const raw = {
      step: 'quote_ready' as const,
      botText: copyQuoteReady(
        { ...session, pendingRows: collectedRows, collectedRows },
        collectedRows,
      ),
      options: [] as ProgressiveOption[],
      session: {
        ...session,
        pendingRows: collectedRows,
        collectedRows,
        collectedServiceIds,
        pendingMedia: [],
        segments: undefined,
      },
      quoteRows: collectedRows,
    };
    const noted = withBatchUnavailableNote(raw.botText, raw.session);
    return { ...raw, botText: noted.botText, session: noted.session };
  }
}

/**
 * Continue after chip / Yes-No selection.
 * @deprecated Phase 6 — routed entry lives in ./progressiveApi.
 */
