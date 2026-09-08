/**
 * Phase 2 — AI parses JSON, DB validates services/cities, engine decides UI later.
 * Catalog from getCatalogTypeKeys + getCatalogCities only (no hardcoded city lists).
 */

import {
  parseChatIntentWithAi,
  resolveMediaAgainstCatalog,
  resolveCityAgainstCatalog,
  type ChatIntentHint,
} from '../services/chatIntentAiService';
import { canonicalizeServiceName } from '../utils/serviceNameUtils';
import type { DbService } from '../utils/serviceResolver';
import {
  canSkipChatIntentAi,
  detectCatalogueBrowseQuery,
  detectCityInText,
  detectFeatureClarifyHint,
  detectLocalityInText,
  detectMediaLocal,
  getCatalogCities,
  getCatalogTypeKeys,
  parseDurationFromText,
  parseQtyFromText,
} from './funnel';
import { parseServiceSegments } from './funnel/batchResolve';
import type { BatchSegment, ProgressiveSession } from './funnel/types';
import type { ParseKind, ParsedSegment, ParseResult, ParseSession } from './types';

function validateServiceToken(
  token: string | null | undefined,
  catalogTypes: string[],
): string | null {
  const raw = (token || '').trim();
  if (!raw) return null;
  const resolved = resolveMediaAgainstCatalog([raw], catalogTypes);
  if (!resolved.length) return null;
  return canonicalizeServiceName(resolved[0]);
}

function validateCityLabel(
  city: string | null | undefined,
  catalogCities: string[],
): string | null {
  return resolveCityAgainstCatalog(city, catalogCities);
}

function batchSegmentToParsed(
  seg: BatchSegment,
  catalogTypes: string[],
  catalogCities: string[],
): ParsedSegment {
  return {
    raw: seg.raw,
    service: validateServiceToken(seg.token, catalogTypes),
    city: validateCityLabel(seg.city, catalogCities),
    qty: seg.qty,
    place: null,
  };
}

function emptyResult(text: string, kind: ParseKind = 'other'): ParseResult {
  return {
    kind,
    segments: [],
    city: null,
    areaHint: null,
    directionHint: null,
    ambiguous: false,
    clarifyHint: null,
    qty: null,
    duration: null,
    source: 'local',
    originalText: text,
  };
}

function browseKindToParseKind(
  browse: ReturnType<typeof detectCatalogueBrowseQuery>,
): ParseKind {
  if (browse === 'services') return 'services_browse';
  if (browse === 'cities') return 'city_browse';
  return 'quote';
}

/** Local parse for hi, browse, batch lists, and clear media/city (mirrors canSkipChatIntentAi). */
function parseMessageLocal(
  text: string,
  _session: ParseSession,
  services: DbService[],
  catalogTypes: string[],
  catalogCities: string[],
): ParseResult | null {
  const t = text.trim();
  if (!t) return emptyResult(text);

  if (/^(hi|hello|hey|hii|hai|hlo|helo|howdy|yo|hola)[\s!.]*$/i.test(t)
    || /^(good\s+(morning|afternoon|evening))[\s!.]*$/i.test(t)) {
    return { ...emptyResult(t, 'greeting'), source: 'local' };
  }

  if (/^(help|how\s+(does\s+this\s+work|to\s+use)|what\s+can\s+you\s+do)[\s?.!]*$/i.test(t)) {
    return { ...emptyResult(t, 'help'), source: 'local' };
  }

  const browse = detectCatalogueBrowseQuery(t);
  if (browse) {
    const city = validateCityLabel(detectCityInText(t, services), catalogCities);
    return {
      ...emptyResult(t, browseKindToParseKind(browse)),
      city,
      source: 'local',
    };
  }

  const batchSegs = parseServiceSegments(t, services);
  if (batchSegs.length >= 2) {
    return {
      kind: 'quote',
      segments: batchSegs.map((s) => batchSegmentToParsed(s, catalogTypes, catalogCities)),
      city: null,
      areaHint: null,
      directionHint: null,
      ambiguous: false,
      clarifyHint: null,
      qty: null,
      duration: parseDurationFromText(t),
      source: 'local',
      originalText: t,
    };
  }

  const cityInText = detectCityInText(t, services);
  const feature = detectFeatureClarifyHint(t, services, cityInText);
  if (feature) {
    return {
      kind: 'clarify_type',
      segments: [],
      city: validateCityLabel(cityInText, catalogCities),
      areaHint: null,
      directionHint: null,
      ambiguous: true,
      clarifyHint: feature,
      qty: parseQtyFromText(t),
      duration: parseDurationFromText(t),
      source: 'local',
      originalText: t,
    };
  }

  const media = detectMediaLocal(t, services);
  if (media.length >= 1) {
    const service = validateServiceToken(media[0], catalogTypes);
    const locality = detectLocalityInText(t, services);
    return {
      kind: 'quote',
      segments: [{
        raw: t,
        service,
        city: validateCityLabel(cityInText, catalogCities),
        qty: parseQtyFromText(t),
        place: locality,
      }],
      city: validateCityLabel(cityInText, catalogCities),
      areaHint: locality,
      directionHint: null,
      ambiguous: false,
      clarifyHint: null,
      qty: parseQtyFromText(t),
      duration: parseDurationFromText(t),
      source: 'local',
      originalText: t,
    };
  }

  const cityOnly = cityInText && !media.length;
  if (cityOnly) {
    const validated = validateCityLabel(cityInText, catalogCities);
    if (validated) {
      return {
        kind: 'city_browse',
        segments: [],
        city: validated,
        areaHint: null,
        directionHint: null,
        ambiguous: false,
        clarifyHint: null,
        qty: null,
        duration: null,
        source: 'local',
        originalText: t,
      };
    }
  }

  return null;
}

function segmentsFromAiHint(
  hint: ChatIntentHint,
  text: string,
  catalogTypes: string[],
  catalogCities: string[],
): ParsedSegment[] {
  if (Array.isArray(hint.segments) && hint.segments.length > 0) {
    return hint.segments.map((seg) => ({
      raw: String(seg.service || seg.raw || text).trim(),
      service: validateServiceToken(seg.service, catalogTypes),
      city: validateCityLabel(seg.city, catalogCities),
      qty: seg.qty != null && Number.isFinite(Number(seg.qty)) ? Number(seg.qty) : null,
      place: seg.place ? String(seg.place).trim() : null,
    }));
  }

  const media = hint.media || [];
  if (!media.length && !hint.city && !hint.qty) return [];

  const service = media.length
    ? validateServiceToken(media[0], catalogTypes)
    : null;
  return [{
    raw: text,
    service,
    city: validateCityLabel(hint.city, catalogCities),
    qty: hint.qty ?? null,
    place: hint.areaHint ? String(hint.areaHint).trim() : null,
  }];
}

function aiHintToParseResult(
  hint: ChatIntentHint,
  text: string,
  catalogTypes: string[],
  catalogCities: string[],
): ParseResult {
  const kind = (hint.kind || 'quote') as ParseKind;
  const segments = segmentsFromAiHint(hint, text, catalogTypes, catalogCities);

  return {
    kind: hint.ambiguous ? 'clarify_type' : kind,
    segments,
    city: validateCityLabel(hint.city, catalogCities),
    areaHint: hint.areaHint ? String(hint.areaHint).trim() : null,
    directionHint: hint.directionHint ? String(hint.directionHint).trim().slice(0, 160) : null,
    ambiguous: hint.ambiguous === true,
    clarifyHint: hint.clarifyHint ? String(hint.clarifyHint).trim() : null,
    qty: hint.qty ?? null,
    duration: hint.duration ? String(hint.duration) : null,
    source: 'ai',
    originalText: text,
  };
}

/**
 * Synchronous local parse only (tests + handleChatTurnSync). Never calls Gemini.
 */
export function parseMessageSync(
  text: string,
  session: ParseSession,
  dbServices: DbService[],
): ParseResult {
  const trimmed = (text || '').trim();
  const catalogTypes = getCatalogTypeKeys(dbServices);
  const catalogCities = getCatalogCities(dbServices);
  return (
    parseMessageLocal(trimmed, session, dbServices, catalogTypes, catalogCities)
    || emptyResult(trimmed)
  );
}

/**
 * Parse user text → validated segments. AI when not skippable; local for hi / browse / batch / clear media.
 */
export async function parseMessage(
  text: string,
  session: ParseSession,
  dbServices: DbService[],
  opts?: { skipAi?: boolean; aiTimeoutMs?: number },
): Promise<ParseResult> {
  const trimmed = (text || '').trim();
  const catalogTypes = getCatalogTypeKeys(dbServices);
  const catalogCities = getCatalogCities(dbServices);

  const skipAi = opts?.skipAi ?? canSkipChatIntentAi(trimmed, dbServices);

  if (skipAi) {
    const local = parseMessageLocal(trimmed, session, dbServices, catalogTypes, catalogCities);
    if (local) return local;
  }

  if (!opts?.skipAi) {
    const ai = await parseChatIntentWithAi(
      trimmed,
      { types: catalogTypes, cities: catalogCities },
      opts?.aiTimeoutMs ?? 10000,
      session as ProgressiveSession | null | undefined,
    );
    if (ai) {
      return aiHintToParseResult(ai, trimmed, catalogTypes, catalogCities);
    }
  }

  const fallback = parseMessageLocal(trimmed, session, dbServices, catalogTypes, catalogCities);
  return fallback || emptyResult(trimmed);
}
