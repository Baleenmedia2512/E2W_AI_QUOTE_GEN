/**
 * Funnel filterCatalog — split from body.ts (Phase 8).
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
import { STOP_WORDS, logFunnelDebug, stampReplyMeta, stripQtyCityDuration, titleCase } from './shared';
import { areaDisplayKey, bestCatalogMediumForPhrase, chipImageIfUniqueNext, exactDbValueKey, extractRealCityFromDbService, friendlyServiceLabel, funnelCityFromDb, getAreaLabel, getCatalogLocalities, getCatalogTypeKeys, getChipImageUrl, getDbCityLabel, getDirectionLabel, getFunnelAreaLabel, getLocalityFromMetaCity, getMediumKey, getMediumTypeFromDb, getMetaAreaRaw, getMetaCityRaw, isExactCatalogMedium, matchKnownCityLabel, resolveDisplayPlace } from './catalog';
import { buildPlaceOfferTurn, copyAskDirection, copyAskType, copyAskTypeAtPlace, copyNotOfferedInCity, copyNotOfferedInCityAskCities, copyUnavailableUserAsk, copyUnknownService, extractUserAskDetails, isStatewideFunnelCityLabel, withBatchUnavailableNote } from './copy';
import { detectCitiesInText, detectCityInText, detectLocalityInText, isAmbiguousPlaceQuery } from './location';
import { advanceFunnel } from './resolveNextStep';

export const SKIP_MEDIA_FUZZY = new Set([
  ...STOP_WORDS,
  'both', 'with', 'this', 'that', 'then', 'when', 'from', 'have', 'been', 'will',
  'near', 'only', 'just', 'also', 'more', 'less', 'next', 'last', 'good', 'best',
  'full', 'semi', 'site', 'area', 'city', 'place', 'road', 'street', 'gate',
  'inside', 'outside', 'court', 'stand', 'stop', 'home', 'unit', 'units',
]);

/** Catalog tokens safe for silent typo fix (full keys + first words, len ≥ 3). */
export function getCatalogMediaCorrectTokens(services: DbService[]): string[] {
  const set = new Set<string>();
  for (const m of getCatalogTypeKeys(services)) {
    const key = canonicalizeServiceName(m);
    if (!key || key.length < 3) continue;
    set.add(key);
    const first = key.split(/\s+/).filter(Boolean)[0];
    if (first && first.length >= 3) set.add(first);
  }
  return [...set];
}

export const CATALOG_MEDIA_PREFIX_MIN = 4;

/**
 * Join adjacent user words when the compacted form is a catalog medium token.
 * Example: "news paper" → "newspaper" when catalog has "newspaper insertion …".
 */
export function compactAdjacentMediaAgainstCatalog(query: string, catalogTokens: string[]): string {
  const words = canonicalizeServiceName(query).split(/\s+/).filter(Boolean);
  if (words.length < 2) return words.join(' ');
  const tokenSet = new Set(catalogTokens);
  const compactSet = new Set(catalogTokens.map((c) => c.replace(/\s+/g, '')));
  const out: string[] = [];
  for (let i = 0; i < words.length; ) {
    let used = 1;
    let best = words[i];
    for (let j = words.length; j >= i + 2; j--) {
      const glued = words.slice(i, j).join('');
      const spaced = words.slice(i, j).join(' ');
      if (tokenSet.has(spaced) || tokenSet.has(glued) || compactSet.has(glued)) {
        best = tokenSet.has(spaced) ? spaced : glued;
        used = j - i;
        break;
      }
    }
    out.push(best);
    i += used;
  }
  return out.join(' ');
}

export const GENERIC_MEDIUM_TAILS = new Set([
  'branding', 'advertising', 'panel', 'sticker', 'demo', 'pack', 'board',
  'lit', 'nonlit', 'full', 'semi', 'inside', 'wrap', 'screen', 'lobby', 'lift',
  'station', 'train', 'insertion', 'printing', 'only',
]);

/** True when word is a catalog medium / family token (metro, bus, hoarding, booth…). */
export function isCatalogMediumToken(word: string, services: DbService[]): boolean {
  const w = canonicalizeServiceName(word);
  if (!w || w.length < 2) return false;
  if (GENERIC_MEDIUM_TAILS.has(w)) return false;
  const compact = w.replace(/\s+/g, '');
  return getCatalogTypeKeys(services).some((m) => {
    const key = canonicalizeServiceName(m);
    const parts = key.split(/\s+/).filter(Boolean);
    const first = parts[0] || key;
    // "booth" → Police Booth; "hoarding" → LED Hoarding; first-token families stay
    // "news" / "news paper" → newspaper insertion mediums via prefix or compact
    return (
      key === w
      || key.startsWith(`${w} `)
      || first === w
      || first === compact
      || (w.length >= CATALOG_MEDIA_PREFIX_MIN && first.startsWith(w))
      || (compact.length >= CATALOG_MEDIA_PREFIX_MIN && first.startsWith(compact))
      || (w.length >= 4 && parts.includes(w))
    );
  });
}

export function filterByLocality(services: DbService[], locality: string): DbService[] {
  const a = canonicalizeServiceName(locality);
  if (!a) return [];
  const aRe = new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return services.filter((s) => {
    const label = canonicalizeServiceName(getAreaLabel(s) || '');
    const loc = canonicalizeServiceName(getLocalityFromMetaCity(s) || '');
    const meta = canonicalizeServiceName(getMetaCityRaw(s) || '');
    const area = canonicalizeServiceName(getMetaAreaRaw(s) || '');
    // Place match = area / locality / city only — NEVER direction_remarks
    // ("…TOWARDS VADAPALANI" ≠ service in Vadapalani)
    return label === a || loc === a || meta === a || area === a
      || aRe.test(label) || aRe.test(loc) || aRe.test(meta) || aRe.test(area);
  });
}

/** Medium (or full catalog) rows that match a place/locality label. */

export function isAskStepReplyWithoutOptions(reply?: string | null): boolean {
  if (!reply) return false;
  return (
    /which type should I quote/i.test(reply)
    || /has more than one option/i.test(reply)
    || /which of these types fits/i.test(reply)
    || /happy to quote/i.test(reply)
    || /fits your brief/i.test(reply)
    || /which (?:area|city|service)/i.test(reply)
    || /pick the site/i.test(reply)
    || /which site\(s\) fit/i.test(reply)
    || /which option would you like/i.test(reply)
    || /looking at .+\. happy to quote/i.test(reply)
  );
}

/** Locality-only (or metro-only) → funnel asks City (if many) → Service → Type → … */

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n];
}


export function similarity(a: string, b: string): number {
  const ca = canonicalizeServiceName(a);
  const cb = canonicalizeServiceName(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;
  if (ca.includes(cb) || cb.includes(ca)) return 0.92;
  const dist = levenshtein(ca, cb);
  const maxLen = Math.max(ca.length, cb.length);
  return maxLen === 0 ? 0 : 1 - dist / maxLen;
}

/** English / filler words — never fuzzy-correct into a catalog medium. */


/** Min length before a user token may expand to a longer catalog first-token (news → newspaper). */


/**
 * Expand a short user token to a unique catalog first-token it prefixes.
 * Ambiguous prefixes (two different first tokens) are left unchanged.
 */

export function expandMediaPrefixAgainstCatalog(token: string, catalogTokens: string[]): string {
  const t = canonicalizeServiceName(token);
  if (!t || t.length < CATALOG_MEDIA_PREFIX_MIN) return t;
  if (catalogTokens.includes(t)) return t;
  const firsts = [...new Set(
    catalogTokens
      .map((c) => c.split(/\s+/).filter(Boolean)[0] || c)
      .filter((first) => first.startsWith(t) && first.length >= t.length),
  )];
  return firsts.length === 1 ? firsts[0] : t;
}

/** Compact split words and unique-prefix-expand against DB medium tokens. */

export function rewriteQueryMediaAgainstCatalog(text: string, services: DbService[]): string {
  const catalogTokens = getCatalogMediaCorrectTokens(services);
  if (!catalogTokens.length) return canonicalizeServiceName(text);
  const compacted = compactAdjacentMediaAgainstCatalog(text, catalogTokens);
  return compacted
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => expandMediaPrefixAgainstCatalog(word, catalogTokens))
    .join(' ');
}

/**
 * Silent typo fix against catalog media tokens only (not cities / places / directions).
 * Returns corrected token or null if already exact / ambiguous / unsafe.
 */

export function correctMediaTokenSilent(token: string, catalogTokens: string[]): string | null {
  const t = canonicalizeServiceName(token);
  if (!t || t.length < 4) return null;
  if (SKIP_MEDIA_FUZZY.has(t)) return null;
  if (catalogTokens.includes(t)) return null; // already good — no rewrite needed

  const maxD = t.length >= 7 ? 2 : 1;
  let best: string | null = null;
  let bestDist = Infinity;
  let ties = 0;
  for (const c of catalogTokens) {
    if (c.length < 3) continue;
    if (Math.abs(c.length - t.length) > maxD) continue;
    if (SKIP_MEDIA_FUZZY.has(c)) continue;
    const d = levenshtein(t, c);
    if (d === 0) return null;
    if (d > maxD) continue;
    if (d < bestDist) {
      bestDist = d;
      best = c;
      ties = 1;
    } else if (d === bestDist) {
      ties += 1;
    }
  }
  if (ties !== 1 || !best) return null;
  return best;
}

/**
 * Rewrite user text: fix media-word typos / plurals against catalog (silent).
 * Never touches city / locality / direction tokens (those aren't in catalogTokens).
 */

export function softCorrectMediaWordsInText(text: string, services: DbService[]): string {
  if (!text.trim() || !services.length) return text;
  // Skip on long multi-service lists — levenshtein × every word freezes the tab
  const andCount = (text.match(/\band\b/gi) || []).length;
  if (andCount >= 3 || text.length > 180) return text;
  const catalogTokens = getCatalogMediaCorrectTokens(services);
  if (!catalogTokens.length) return text;

  return text.replace(/[A-Za-z][A-Za-z']+/g, (raw) => {
    if (raw.length < 4) return raw;
    const lower = raw.toLowerCase();
    if (SKIP_MEDIA_FUZZY.has(canonicalizeServiceName(lower))) return raw;
    // Already matches catalog (with plural/synonym normalize)
    const canon = canonicalizeServiceName(lower);
    if (catalogTokens.includes(canon)) {
      // If canonicalize changed spelling (hording→hoarding), rewrite to catalog form
      if (canon !== lower && canon.indexOf(' ') < 0) {
        return raw[0] === raw[0].toUpperCase()
          ? canon.charAt(0).toUpperCase() + canon.slice(1)
          : canon;
      }
      return raw;
    }
    const fixed = correctMediaTokenSilent(lower, catalogTokens);
    if (!fixed || fixed === canon) return raw;
    // Keep simple lower/Title casing
    if (raw === raw.toUpperCase() && raw.length > 1) return fixed.toUpperCase();
    if (raw[0] === raw[0].toUpperCase()) {
      return fixed.charAt(0).toUpperCase() + fixed.slice(1);
    }
    return fixed;
  });
}

/** True when service belongs to the given city label (DB city or area_name). */

export function statewideSiblingCoversCity(
  svc: DbService,
  requestedCity: string,
  catalog: DbService[],
): boolean {
  const dbCity = getMetaCityRaw(svc);
  if (!dbCity || !isStatewideFunnelCityLabel(dbCity)) return false;
  if (!matchKnownCityLabel(requestedCity)) return false;

  const mediumKey = canonicalizeServiceName(getMediumKey(svc));
  const siblings = catalog.filter(
    (s) => canonicalizeServiceName(getMediumKey(s)) === mediumKey,
  );

  for (const s of siblings) {
    const c = getMetaCityRaw(s);
    if (!c || isStatewideFunnelCityLabel(c)) continue;
    if (canonicalizeServiceName(c) === canonicalizeServiceName(requestedCity)) return true;
    if (geoNamesLooselyMatch(c, requestedCity)) return true;
  }

  // Non-metro catalog city (e.g. Rotn) + statewide row → Chennai in live DB.
  const nonMetroSiblings = siblings
    .map((s) => getMetaCityRaw(s))
    .filter(
      (c): c is string =>
        !!c && !isStatewideFunnelCityLabel(c) && !matchKnownCityLabel(c),
    );
  return (
    nonMetroSiblings.length > 0
    && canonicalizeServiceName(requestedCity) === 'chennai'
  );
}


export function serviceMatchesCityLabel(
  svc: DbService,
  city: string,
  resolvedLocation?: ResolvedLocation | null,
  catalog?: DbService[],
): boolean {
  const requested = canonicalizeServiceName(city);
  if (!requested) return false;

  // City matching is catalog-driven and exact after normalization. A blank
  // metadata.city may use area_name because that is the value exposed as the
  // city/place chip. Do not consult hardcoded city lists, locations, documents,
  // direction text, or substring/regex fallbacks here.
  const dbCity = getMetaCityRaw(svc);
  const dbArea = getMetaAreaRaw(svc);
  const dbValue = dbCity || dbArea;
  if (dbValue && canonicalizeServiceName(dbValue) === requested) return true;

  if (catalog && statewideSiblingCoversCity(svc, city, catalog)) {
    return true;
  }

  // Nominatim hierarchy: statewide DB rows (e.g. Any City In Tamilnadu) cover
  // a resolved TN town such as Puliyangudi / Chennai — no hardcoded place lists.
  if (resolvedLocation && serviceCoversResolvedLocation(svc, resolvedLocation)) {
    return true;
  }
  return false;
}

/** City match using session.resolvedLocation when present. */

export function serviceMatchesSessionCity(
  svc: DbService,
  city: string,
  session?: ProgressiveSession | null,
  catalog?: DbService[],
): boolean {
  return serviceMatchesCityLabel(svc, city, session?.resolvedLocation, catalog);
}

/**
 * Strict area validation for an explicitly requested place.
 * Unlike the general location matcher, this intentionally does not use the
 * parent city or service_id/direction text as an area fallback.
 */

export function serviceMatchesExplicitArea(svc: DbService, area: string): boolean {
  const wanted = area.trim();
  if (!wanted) return false;
  return [getMetaAreaRaw(svc), getLocalityFromMetaCity(svc)]
    .filter(Boolean)
    .some((value) => areaDisplayKey(value as string) === areaDisplayKey(wanted));
}


export function filterByCity(
  services: DbService[],
  city: string | null,
  resolvedLocation?: ResolvedLocation | null,
): DbService[] {
  if (!city) return services;
  return services.filter((s) =>
    serviceMatchesCityLabel(s, city, resolvedLocation, services),
  );
}


export function matchServices(services: DbService[], words: string[], city: string | null): DbService[] {
  const scoped = filterByCity(services, city);
  if (words.length === 0) return [];
  const matched = scoped.filter((s) => serviceMatchesQuery(s, words));
  return matched;
}

/**
 * Browse match for user tokens like "bus" / "shelter" / "apartment".
 * Matches word boundary in medium + product name (includes Bus Shelter when asking "bus").
 * Also tolerates spelling variants (apartment ↔ appartment).
 */

export function browseTokenVariants(token: string, services?: DbService[]): string[] {
  const t = canonicalizeServiceName(token);
  if (!t) return [];
  const out = new Set<string>([t]);
  if (t === 'apartment') out.add('appartment');
  if (t === 'appartment') out.add('apartment');
  // Silent typo → catalog token (hoardin → hoarding, buss already synonym)
  if (services?.length) {
    const catalogTokens = getCatalogMediaCorrectTokens(services);
    const compacted = compactAdjacentMediaAgainstCatalog(t, catalogTokens) || t;
    if (compacted) out.add(compacted);
    // Multi-word products ("bus shelter") must NOT add bare family parts ("bus") —
    // that pulled Bus Semi into shelter-only asks.
    if (!t.includes(' ')) {
      for (const part of compacted.split(/\s+/).filter(Boolean)) {
        out.add(expandMediaPrefixAgainstCatalog(part, catalogTokens));
      }
    } else {
      out.add(expandMediaPrefixAgainstCatalog(compacted, catalogTokens));
    }
    const fixed = correctMediaTokenSilent(t, catalogTokens);
    if (fixed) out.add(fixed);
  }
  // Plural form of each variant for regex without relying only on s?
  for (const v of [...out]) {
    if (!v.endsWith('s')) out.add(`${v}s`);
  }
  return [...out];
}

/** Trailing words that appear on many mediums — never treat as a family token alone. */



export function filterByBrowseToken(services: DbService[], token: string): DbService[] {
  const variants = browseTokenVariants(token, services);
  if (!variants.length) return [];
  const res = variants.map(
    (v) => new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i'),
  );
  // Short family tokens (metro, bus) — ONLY match medium / id / short name head.
  // Never scan long service_name lines that embed "Metro Station" in a bus-shelter title.
  const tok = canonicalizeServiceName(token);
  const shortFamily = tok.split(/\s+/).length === 1 && tok.length <= 8;
  return services.filter((s) => {
    const med = canonicalizeServiceName(getMediumKey(s));
    if (res.some((re) => re.test(med))) return true;
    const sid = canonicalizeServiceName(s.service_id || '');
    if (res.some((re) => re.test(sid))) return true;
    const nameRaw = (s.service_name || '').split(/[·—–|]/)[0] || '';
    const name = canonicalizeServiceName(nameRaw);
    if (shortFamily) {
      // First 3 tokens only ("metro station elevated", not full direction-in-name)
      const head = name.split(/\s+/).slice(0, 3).join(' ');
      return res.some((re) => re.test(head));
    }
    return res.some((re) => re.test(name));
  });
}

/** Prefer browse hits; fall back to strict family for exact medium chips. */

export function filterForBrowseOrFamily(services: DbService[], token: string): DbService[] {
  const browse = filterByBrowseToken(services, token);
  const family = filterByMediumFamily(services, token);
  let hits = browse.length ? browse : family;
  const t = canonicalizeServiceName(token);
  // Multi-word product prefix ("bus shelter", "no parking"): keep only mediums
  // that are that product (or longer), never siblings ("bus semi").
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const prefixed = hits.filter((s) =>
      getCatalogMediumAliases(s).some(
        (alias) => alias === t || alias.startsWith(`${t} `),
      ),
    );
    if (prefixed.length) hits = prefixed;
  }
  // "metro" also covers Train Inside / Train Wrap (may not contain the word metro)
  if (t === 'metro' || t.startsWith('metro ')) {
    hits = mergeMetroFamilyServices(services, hits);
  }
  return hits;
}

/** Train Inside / Train Wrap + Metro Station variants under the metro family. */

export function isMetroFamilyHay(hay: string): boolean {
  const h = canonicalizeServiceName(hay);
  if (/\bmetro\b/.test(h)) return true;
  if (/\btrain\s+inside\b/.test(h) || /\btrain\s+wrap\b/.test(h)) return true;
  if (/\btrain\b/.test(h) && /\b(inside|wrap)\b/.test(h)) return true;
  return false;
}


export function mergeMetroFamilyServices(services: DbService[], base: DbService[]): DbService[] {
  const map = new Map(base.map((s) => [s.service_id, s]));
  for (const s of services) {
    if (map.has(s.service_id)) continue;
    const hay = `${getMediumKey(s)} ${(s.service_name || '').split(/[·—–|/]/)[0] || ''} ${s.service_id || ''}`;
    if (isMetroFamilyHay(hay)) map.set(s.service_id, s);
  }
  return [...map.values()];
}


export function isMetroSegmentToken(token: string): boolean {
  const t = canonicalizeServiceName(token);
  return t === 'metro' || t.startsWith('metro ') || t === 'train' || t.startsWith('train ');
}

/** Soft ceiling — kept high enough for real multi-service quotes; chip caps prevent freezes. */

export function filterByMediumFamily(services: DbService[], medium: string): DbService[] {
  const m = canonicalizeServiceName(medium);
  if (!m) return [];
  const byMedium = filterByExactMedium(services, m);
  if (byMedium.length) return byMedium;
  return services.filter((s) => {
    return getCatalogMediumAliases(s).some((alias) => isSameMediumFamily(alias, m));
  });
}


export function uniqueMediumLabels(services: DbService[]): ProgressiveOption[] {
  return uniqueMediumLabelsWithExamples(services);
}

/**
 * Medium options for an unresolved/partial service request.
 * Keep the DB medium label intact here. medium_type is resolved only after
 * the user selects an exact medium in the funnel.
 */

export function uniqueMediumLabelsWithExamples(services: DbService[]): ProgressiveOption[] {
  const groups = new Map<string, { opt: ProgressiveOption; rows: DbService[] }>();
  for (const s of services.filter(hasQuotablePricing)) {
    const raw = String((s.metadata as { medium?: string } | undefined)?.medium || '').trim();
    const medium = raw && raw.toUpperCase() !== 'NA'
      ? raw
      : getMediumKey(s);
    if (!medium) continue;
    // Same canonicalize dedupe as uniqueMediumOnlyOptions (dash/case variants)
    const key = canonicalizeServiceName(medium);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(s);
      if (/[–—]/.test(existing.opt.label) && !/[–—]/.test(medium)) {
        existing.opt = { ...existing.opt, label: medium, medium };
      }
      continue;
    }
    groups.set(key, {
      rows: [s],
      opt: {
        id: `medium:${medium}`,
        label: medium,
        medium,
      },
    });
  }
  return [...groups.values()]
    .map(({ opt, rows }) => ({
      ...opt,
      imageUrl: chipImageIfUniqueNext(rows, 'city'),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Catalog type keys only — never a hardcoded bus/hoarding list. */

export function detectMediaLocal(text: string, services: DbService[]): string[] {
  if (isAmbiguousPlaceQuery(text)) return [];
  // Feature words that span multiple mediums (led, …) → clarify, not one family
  if (detectFeatureClarifyHint(text, services, detectCityInText(text, services))) {
    return [];
  }
  const lower = rewriteQueryMediaAgainstCatalog(
    text.toLowerCase().replace(/&/g, ' and ').replace(/\+/g, ' and '),
    services,
  );
  const catalog = getCatalogTypeKeys(services)
    .map((m) => ({ raw: m, key: canonicalizeServiceName(m) }))
    .filter((m) => m.key.length >= 2)
    .sort((a, b) => b.key.length - a.key.length);

  const found = new Set<string>();
  for (const m of catalog) {
    const words = m.key.split(/\s+/).filter(Boolean);
    const first = words[0] || m.key;
    const fullRe = new RegExp(
      `\\b${m.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`,
      'i',
    );
    const firstRe = new RegExp(
      `\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`,
      'i',
    );

    if (fullRe.test(lower)) {
      // Full catalog key matches → use it directly
      found.add(m.key);
    } else if (firstRe.test(lower)) {
      // First word matches → find longest prefix (2+ words) that also matches in text
      let longestMatch = first;
      for (let i = words.length; i >= 2; i--) {
        const prefix = words.slice(0, i).join(' ');
        const prefRe = new RegExp(
          `\\b${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`,
          'i',
        );
        if (prefRe.test(lower)) {
          longestMatch = prefix;
          break;
        }
      }
      // Prefer longest prefix that appears in the user text (e.g. "no parking"
      // → "no parking", not catalog sibling "no parking printing only").
      // Only fall back to full catalog key when nothing longer matched.
      if (longestMatch !== first || first.length >= 3) {
        found.add(longestMatch);
      } else if (fullRe.test(lower)) {
        found.add(m.key);
      }
    }
  }

  // Prefer specific mediums ("bus shelter") over short family ("bus") when both matched
  const ranked = [...found].sort((a, b) => b.length - a.length || a.localeCompare(b));
  const pruned: string[] = [];
  for (const f of ranked) {
    if (pruned.some((p) => p.startsWith(`${f} `))) continue;
    for (let i = pruned.length - 1; i >= 0; i--) {
      if (f.startsWith(`${pruned[i]} `)) pruned.splice(i, 1);
    }
    pruned.push(f);
  }
  return pruned;
}

/** Ambiguous place/context — prefer AI; local fallback for common multi-type feature phrases. */

export function detectFeatureClarifyHint(
  text: string,
  services: DbService[],
  city: string | null,
): string | null {
  if (/\b(and|&|\+)\b/i.test(text)) return null;
  if (isAmbiguousPlaceQuery(text)) {
    if (/\bbus\s*stands?\b/i.test(text)) return 'bus stand';
    return 'that';
  }
  const cityDetected = city || detectCityInText(text, services);
  const stripped = stripQtyCityDuration(text, cityDetected);
  const words = extractQueryWords(stripped).filter((w) => !STOP_WORDS.has(w));
  if (words.length !== 1) return null;
  const hint = words[0];
  // Locality name (saidapet, padur) — not a feature; place-browse handles it
  if (detectLocalityInText(hint, services) || detectLocalityInText(text, services)) {
    return null;
  }
  const familyRows = filterByMediumFamily(services, hint);
  const familyScoped = cityDetected ? filterByCity(familyRows, cityDetected) : familyRows;
  // Clear product family in DB ("bus", "auto") → let medium flow ask city / areas
  if (familyScoped.length > 0) return null;

  // Browse family from catalog medium names ("apartment" → Lift / Lobby) is NOT a
  // feature/LED clarify — startMediumFlow must own it so browseToken stays locked.
  const browseFamily = filterForBrowseOrFamily(services, hint);
  const browseScoped = cityDetected ? filterByCity(browseFamily, cityDetected) : browseFamily;
  if (browseScoped.length > 0) return null;

  const featureTypes = typesForClarify(services, cityDetected, hint);
  // Feature/feature word only (e.g. led) spanning multiple catalog types
  if (featureTypes.length > 1) return hint;
  return null;
}

/** Types related to a feature/hint — search medium + product name only (not area text). */

export function typesForClarify(
  services: DbService[],
  city: string | null,
  hint: string | null,
): ProgressiveOption[] {
  const scoped = city ? filterByCity(services, city) : services;
  if (!hint || !hint.trim()) {
    return uniqueMediumLabelsWithExamples(scoped);
  }
  const h = canonicalizeServiceName(hint);
  const words = h.split(/\s+/).filter((w) => w.length >= 2);

  const nameHeadOf = (s: DbService): string => {
    const name = canonicalizeServiceName((s.service_name || '').split(/[·—–|/]/)[0] || '');
    return name.split(/\s+/).slice(0, 4).join(' ');
  };

  /** Strip led / non led so "mobile van led" and "mobile van non led" share a base. */
  const ledProductBase = (medium: string): string =>
    canonicalizeServiceName(medium)
      .replace(/\bnon\s*led\b/g, ' ')
      .replace(/\bled\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  let matchedSvcs = scoped.filter((s) => {
    const med = canonicalizeServiceName(getMediumKey(s));
    const nameHead = nameHeadOf(s);
    const hay = `${med} ${nameHead}`;
    if (words.length > 1) {
      return words.every((w) => hay.includes(w));
    }
    // Primary pass: "led" must not match "non led"
    if (h === 'led' && /\bnon\s*led\b/.test(hay)) return false;
    const mType = canonicalizeServiceName(getMediumTypeFromDb(s) || '');
    const hayFull = `${hay} ${mType}`;
    return new RegExp(`\\b${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(hayFull);
  });

  // "led" clarify: also offer Non LED siblings of the same product (Mobile Van Non LED)
  if (h === 'led' && matchedSvcs.length > 0) {
    const bases = new Set(
      matchedSvcs
        .map((s) =>
          ledProductBase(
            `${getMediumKey(s)} ${getMediumTypeFromDb(s) || ''}`,
          ),
        )
        .filter((b) => b.length >= 3),
    );
    const seen = new Set(matchedSvcs.map((s) => s.service_id));
    for (const s of scoped) {
      if (seen.has(s.service_id)) continue;
      const med = canonicalizeServiceName(getMediumKey(s));
      const mType = canonicalizeServiceName(getMediumTypeFromDb(s) || '');
      const hay = `${med} ${nameHeadOf(s)} ${mType}`;
      if (!/\bnon\s*led\b/.test(hay)) continue;
      const base = ledProductBase(`${getMediumKey(s)} ${mType}`);
      if (!base) continue;
      const ok =
        bases.has(base)
        || [...bases].some(
          (b) =>
            base === b
            || base.startsWith(`${b} `)
            || b.startsWith(`${base} `)
            || isSameMediumFamily(base, b)
            || isSameMediumFamily(b, base),
        );
      if (!ok) continue;
      seen.add(s.service_id);
      matchedSvcs = [...matchedSvcs, s];
    }
  }

  const fromHint = uniqueMediumLabelsWithExamples(matchedSvcs);
  // Never fall back to the full catalog — empty means "not a feature clarify"
  return fromHint;
}



export function mediumLabelsForCity(services: DbService[], city: string): ProgressiveOption[] {
  return uniqueMediumOnlyOptions(filterByCity(services, city));
}

/** Size/finish style tokens — same family as "bus full", not different products like "bus stand". */
export const MEDIUM_STYLE_TOKENS = new Set([
  'full', 'semi', 'branding', 'wrap', 'wrapping', 'panel', 'back', 'front',
  'interior', 'exterior', 'non', 'led', 'lcd', 'digital', 'static', 'premium',
  'standard', 'basic', 'partial', 'complete', 'side', 'rear', 'top', 'outside',
  'elevated', 'underground', 'train', 'inside', 'platform',
]);


export function isSameMediumFamily(mediumKey: string, familyToken: string): boolean {
  const mk = canonicalizeServiceName(mediumKey);
  const m = canonicalizeServiceName(familyToken);
  if (!m || !mk) return false;
  if (mk === m) return true;
  // Catalog mediums can be multi-word families (for example, a base medium
  // followed by a DB-defined variant). Treat either complete key as the
  // family prefix without relying on a service-specific name list.
  if (mk.startsWith(`${m} `) || m.startsWith(`${mk} `)) return true;
  const parts = mk.split(/\s+/).filter(Boolean);
  if (parts[0] !== m) return false;
  if (parts.length === 1) return true;
  // Remaining tokens must all be style words (not "stand", "booth", "shelter", …)
  return parts.slice(1).every((p) => MEDIUM_STYLE_TOKENS.has(p));
}

/** Search aliases from both DB identity fields without creating duplicate options. */

export function getCatalogMediumAliases(svc: DbService): string[] {
  const aliases = new Set<string>();
  const medium = canonicalizeServiceName(getMediumKey(svc));
  const serviceName = canonicalizeServiceName(
    (svc.service_name || '').split(/[·|]/)[0] || '',
  );
  if (medium) aliases.add(medium);
  if (serviceName) aliases.add(serviceName);
  return [...aliases];
}

/** Strict family filter: "auto" → auto full / auto semi. Not "bus stand" when asking "bus". */

export function filterByExactMedium(services: DbService[], medium: string): DbService[] {
  const m = canonicalizeServiceName(medium);
  if (!m) return [];
  const exact = services.filter((s) => getCatalogMediumAliases(s).includes(m));
  if (exact.length) return exact;
  // Resolve unique catalog phrases ("bus semi wrap", "lamp post … reeper")
  // before any family widening — never let wrap fall through to branding.
  const phrase = bestCatalogMediumForPhrase(m, services);
  if (phrase) {
    const pk = canonicalizeServiceName(phrase);
    return services.filter((s) => getCatalogMediumAliases(s).includes(pk));
  }
  // Qualified multi-word miss → empty (do not widen to siblings)
  if (m.split(/\s+/).filter(Boolean).length >= 3) return [];
  return services.filter((s) =>
    getCatalogMediumAliases(s).some((alias) => isSameMediumFamily(alias, m)),
  );
}


export function uniqueServiceOptions(services: DbService[], limit = Number.POSITIVE_INFINITY): ProgressiveOption[] {
  const seen = new Set<string>();
  const out: ProgressiveOption[] = [];
  for (const s of services.filter(hasQuotablePricing)) {
    const id = s.service_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: friendlyServiceLabel(s),
      serviceId: id,
      city: getDbCityLabel(s) || extractRealCityFromDbService(s) || undefined,
      medium: getMediumKey(s),
      imageUrl: getChipImageUrl(s),
    });
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}


export function uniqueProductOptions(services: DbService[]): ProgressiveOption[] {
  // Group vendor/rate rows by the catalog medium. medium_type is resolved by
  // the funnel before this product stage; merging it here creates duplicate
  // products when one row has a qualifier and sibling rows have NA.
  const groups = new Map<string, { opt: ProgressiveOption; rows: DbService[] }>();
  for (const s of services.filter(hasQuotablePricing)) {
    const medium = getMediumKey(s);
    const label = titleCase(
      medium
      || formatServiceDisplayName(s)
      || (s.service_name || '').split('·')[0]
      || friendlyServiceLabel(s),
    ).trim();
    const key = canonicalizeServiceName(medium || label);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(s);
      continue;
    }
    groups.set(key, {
      rows: [s],
      opt: {
        id: `product:${key}`,
        label: label.length > 60 ? label.slice(0, 57) + '…' : label,
        medium: medium || getMediumKey(s),
        serviceId: getAreaLabel(s) ? undefined : s.service_id,
        city: extractRealCityFromDbService(s) || undefined,
      },
    });
  }
  return [...groups.values()]
    .map(({ opt, rows }) => ({
      ...opt,
      imageUrl: chipImageIfUniqueNext(rows, 'city'),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, 40);
}


export function citiesForMedium(services: DbService[], medium: string): ProgressiveOption[] {
  const scoped = filterForBrowseOrFamily(services, medium);
  const groups = new Map<string, { opt: ProgressiveOption; rows: DbService[] }>();
  for (const s of scoped) {
    const c = funnelCityFromDb(s);
    if (!c) continue;
    const key = canonicalizeServiceName(c);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(s);
      continue;
    }
    groups.set(key, {
      rows: [s],
      opt: {
        id: `city:${key}`,
        label: c,
        city: c,
        medium,
      },
    });
  }
  return [...groups.values()]
    .map(({ opt, rows }) => ({
      ...opt,
      imageUrl: chipImageIfUniqueNext(rows, 'area'),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}


export function areasForMediumCity(services: DbService[], medium: string, city: string): DbService[] {
  return filterForBrowseOrFamily(services, medium).filter((s) =>
    serviceMatchesCityLabel(s, city),
  );
}

/** Unique place chips: localities as-is; metro+area as "City · Area". */

export function uniquePlaceOptions(services: DbService[], token: string): ProgressiveOption[] {
  const hits = filterForBrowseOrFamily(services, token).filter(hasQuotablePricing);
  const groups = new Map<string, { opt: ProgressiveOption; rows: DbService[] }>();

  for (const s of hits) {
    const place = resolveDisplayPlace(s, token);
    if (!place) continue;
    const existing = groups.get(place.id);
    if (existing) {
      existing.rows.push(s);
      continue;
    }
    // Strip any pre-set image; unique-next applied below
    const { imageUrl: _drop, ...base } = place;
    groups.set(place.id, { opt: base, rows: [s] });
  }

  if (groups.size === 0) {
    return citiesForMedium(services, token);
  }

  return [...groups.values()]
    .map(({ opt, rows }) => ({
      ...opt,
      // Place → next is area sites' directions (1 direction = unique site image)
      imageUrl: chipImageIfUniqueNext(rows, 'direction'),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Distinct area chips within a city for a browse token.
 *
 * Deduplication is intentionally limited to area_name values. An identical
 * direction_remarks value is still allowed to appear later in the Direction
 * step because the two chips represent separate DB fields.
 */

export function uniqueAreaOptions(services: DbService[], token: string, city: string): ProgressiveOption[] {
  const hits = areasForMediumCity(services, token, city).filter(hasQuotablePricing);
  const groups = new Map<string, { opt: ProgressiveOption; rows: DbService[] }>();
  for (const s of hits) {
    const area = getFunnelAreaLabel(s);
    if (!area) continue;
    const key = areaDisplayKey(area);
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(s);
      continue;
    }
    groups.set(key, {
      rows: [s],
      opt: {
        id: `area:${key}`,
        label: area,
        city,
        medium: token,
        serviceId: undefined,
      },
    });
  }
  return [...groups.values()]
    .map(({ opt, rows }) => ({
      ...opt,
      imageUrl: chipImageIfUniqueNext(rows, 'direction'),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** After location narrowed: continue strict funnel Service → Type → City → Area → Direction. */

export function buildDirectionPicker(
  hits: DbService[],
  session: ProgressiveSession,
  locationLabel: string,
): ProgressiveTurnResult {
  const typeKeys = [
    ...new Set(
      hits
        .map((s) => {
          const t = getMediumTypeFromDb(s);
          return t ? canonicalizeServiceName(t) : '';
        })
        .filter(Boolean),
    ),
  ];
  const annotateType = typeKeys.length > 1;

  const groups = new Map<string, { opt: ProgressiveOption; rows: DbService[] }>();
  for (const s of hits) {
    const dir = getDirectionLabel(s);
    if (!dir) continue;
    const mType = getMediumTypeFromDb(s);
    const typeKey = mType ? canonicalizeServiceName(mType) : '';
    // Multi-type union (Frontlit + Nonlit): keep both lines even if direction text matches
    const key = annotateType && typeKey
      ? `${exactDbValueKey(dir)}|${typeKey}`
      : exactDbValueKey(dir);
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(s);
      continue;
    }
    const label =
      annotateType && mType
        ? `${dir} (${titleCase(mType)})`
        : dir;
    groups.set(key, {
      rows: [s],
      opt: {
        id: `direction:${s.service_id}`,
        label,
        serviceId: s.service_id,
        city: extractRealCityFromDbService(s) || undefined,
        medium: getMediumKey(s),
        mediumType: mType || undefined,
      },
    });
  }
  const options = [...groups.values()]
    .map(({ opt, rows }) => ({
      ...opt,
      id: `direction:${rows.map((row) => row.service_id).join(',')}`,
      // Direction chip → show image only for a single site
      imageUrl: chipImageIfUniqueNext(rows, 'site'),
      serviceId: rows.length === 1 ? rows[0].service_id : opt.serviceId,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const mediumName = titleCase(getMediumKey(hits[0]) || session.medium || 'service');
  const ask = copyAskDirection(locationLabel || 'that area', mediumName, session);
  const noted = withBatchUnavailableNote(ask, {
    ...session,
    medium: getMediumKey(hits[0]) || session.medium,
    candidateServiceIds: hits.map((s) => s.service_id),
  });
  const keepQueue =
    workQueueMustContinue(session)
    || !!(session.segments && session.segments.length >= 2);
  // Keep remaining batch services (Hoarding → No Parking, same city) and
  // remaining cities (Police Booth Chennai → Madurai). Clear only same-medium
  // type leftovers so we never "Now choosing Hoarding" after Frontlit+Nonlit.
  return {
    step: 'pick_direction',
    botText: noted.botText,
    options,
    allowMulti: true,
    session: {
      ...noted.session,
      workQueue: keepQueue ? session.workQueue : undefined,
      pendingCityQueue: keepQueue ? session.pendingCityQueue : undefined,
      batchServiceLabels: keepQueue ? session.batchServiceLabels : undefined,
      area: session.area || session.placeHint || noted.session.area,
      placeHint: session.placeHint || session.area || noted.session.placeHint,
    },
  };
}

/**
 * After multi-area Confirm: checkbox list of every site (Area · direction).
 * Includes sites with no direction_remarks (label = area / service name).
 */

export function buildMultiAreaSitePicker(
  hits: DbService[],
  session: ProgressiveSession,
  areaLabels: string[],
): ProgressiveTurnResult {
  hits = hits.filter(hasQuotablePricing);
  const groups = new Map<string, { first: DbService; rows: DbService[] }>();
  for (const s of hits) {
    const area = getFunnelAreaLabel(s) || getAreaLabel(s) || '';
    const dir = getDirectionLabel(s);
    const siteKey = `${areaDisplayKey(area)}|${exactDbValueKey(dir || '')}`;
    const existing = groups.get(siteKey);
    if (existing) {
      existing.rows.push(s);
      continue;
    }
    groups.set(siteKey, { first: s, rows: [s] });
  }

  const options: ProgressiveOption[] = [];
  for (const { first: s, rows } of groups.values()) {
    const area = getFunnelAreaLabel(s) || getAreaLabel(s) || '';
    const dir = getDirectionLabel(s);
    let label: string;
    if (area && dir) {
      label = `${area} · ${dir}`;
    } else {
      label = dir || area || friendlyServiceLabel(s);
    }
    options.push({
      id: `direction:${rows.map((row) => row.service_id).join(',')}`,
      label,
      serviceId: s.service_id,
      city: extractRealCityFromDbService(s) || undefined,
      medium: getMediumKey(s),
      imageUrl: getChipImageUrl(s),
      group: area || undefined,
    });
  }
  options.sort((a, b) => {
    const byGroup = (a.group || '').localeCompare(b.group || '', undefined, {
      sensitivity: 'base',
    });
    if (byGroup !== 0) return byGroup;
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });
  const loc =
    areaLabels.length === 0
      ? session.city || 'those areas'
      : areaLabels.length <= 3
        ? areaLabels.join(', ')
        : `${areaLabels.slice(0, 2).join(', ')} +${areaLabels.length - 2} more`;
  const mediumName = titleCase(getMediumKey(hits[0]) || session.medium || 'service');
  return {
    step: 'pick_direction',
    botText: copyAskDirection(loc, mediumName, session),
    options,
    allowMulti: true,
    session: {
      ...session,
      medium: getMediumKey(hits[0]) || session.medium,
      area: undefined,
      needsContinueConfirm: false,
      candidateServiceIds: hits.map((s) => s.service_id),
      // Preserve every pending batch item. The current service may have
      // multiple areas while another requested service is still waiting.
      workQueue: session.workQueue,
      pendingCityQueue: session.pendingCityQueue,
    },
  };
}

/** Service chips only (medium) — Type is a separate funnel step. */

export function uniqueMediumOnlyOptions(services: DbService[]): ProgressiveOption[] {
  const groups = new Map<string, { opt: ProgressiveOption; rows: DbService[] }>();
  for (const s of services.filter(hasQuotablePricing)) {
    const raw = String((s.metadata as { medium?: string } | undefined)?.medium || '').trim();
    const medium = raw && raw.toUpperCase() !== 'NA'
      ? raw
      : getMediumKey(s);
    if (!medium) continue;
    // Collapse dash/case variants ("Mobile Van - LED" vs "Mobile Van – LED")
    const key = canonicalizeServiceName(medium);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(s);
      // Prefer ASCII hyphen label when merging en-dash catalog duplicates
      if (/[–—]/.test(existing.opt.label) && !/[–—]/.test(medium)) {
        existing.opt = { ...existing.opt, label: medium, medium };
      }
      continue;
    }
    groups.set(key, {
      rows: [s],
      opt: {
        id: `medium:${medium}`,
        label: medium,
        medium,
      },
    });
  }
  return [...groups.values()]
    .map(({ opt, rows }) => ({
      ...opt,
      imageUrl: chipImageIfUniqueNext(rows, 'city'),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** medium_type chips for a selected service (Nonlit / Lit / Elevated …). */

export function uniqueTypeOnlyOptions(services: DbService[], medium: string): ProgressiveOption[] {
  const want = canonicalizeServiceName(medium);
  const family = want.split(/\s+/).filter(Boolean)[0] || want;
  // Bare family token ("metro") may include Station / Train Inside / Wrap types.
  // Exact medium ("metro station") must only show that medium's medium_type values.
  const bareFamily = want === family;
  const groups = new Map<string, { opt: ProgressiveOption; rows: DbService[] }>();
  for (const s of services.filter(hasQuotablePricing)) {
    const mk = canonicalizeServiceName(getMediumKey(s));
    if (!mk) continue;
    const mediumOk =
      mk === want
      || isSameMediumFamily(mk, want)
      || (
        bareFamily
        && family.length >= 3
        && (isSameMediumFamily(mk, family) || mk.startsWith(`${family} `))
      );
    if (!mediumOk) continue;
    const mType = getMediumTypeFromDb(s);
    if (!mType) continue;
    const key = canonicalizeServiceName(mType);
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(s);
      continue;
    }
    groups.set(key, {
      rows: [s],
      opt: {
        id: `medium:${medium}|${key}`,
        label: titleCase(mType),
        medium,
        mediumType: mType,
      },
    });
  }
  return [...groups.values()]
    .map(({ opt, rows }) => ({
      ...opt,
      imageUrl: chipImageIfUniqueNext(rows, 'city'),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Batch queue: prefer types with 2+ areas in the locked city (opts[0] must reach area Confirm). */

export function sortTypeOptionsForBatch(
  types: ProgressiveOption[],
  pool: DbService[],
  sess: ProgressiveSession,
): ProgressiveOption[] {
  const isBatch =
    workQueueMustContinue(sess)
    || !!(sess.segments && sess.segments.length >= 2);
  if (!isBatch || types.length < 2) return types;

  const areaCount = (opt: ProgressiveOption): number => {
    const mt = opt.mediumType ? canonicalizeServiceName(opt.mediumType) : '';
    let hits = pool;
    if (mt) {
      hits = hits.filter((s) => {
        const got = getMediumTypeFromDb(s);
        return !!got && canonicalizeServiceName(got) === mt;
      });
    }
    if (sess.city) {
      hits = hits.filter((s) => serviceMatchesCityLabel(s, sess.city!));
    }
    return new Set(
      hits
        .map((s) => getFunnelAreaLabel(s))
        .filter(Boolean)
        .map((a) => areaDisplayKey(a!)),
    ).size;
  };

  return [...types].sort((a, b) => areaCount(b) - areaCount(a) || a.label.localeCompare(b.label));
}


export function uniqueCityOptionsFromPool(services: DbService[], medium?: string): ProgressiveOption[] {
  const groups = new Map<string, { opt: ProgressiveOption; rows: DbService[] }>();
  for (const s of services) {
    // Raw DB city; if blank → area_name. Never invent Chennai / metro preference.
    const city = funnelCityFromDb(s);
    if (!city) continue;
    const key = canonicalizeServiceName(city);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(s);
      continue;
    }
    groups.set(key, {
      rows: [s],
      opt: {
        id: `city:${key}`,
        label: city,
        city,
        medium,
      },
    });
  }
  return [...groups.values()]
    .filter(({ rows }) => rows.some((row) => hasQuotablePricing(row)))
    .map(({ opt, rows }) => ({
      ...opt,
      imageUrl: chipImageIfUniqueNext(rows, 'area'),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Area chips — raw area_name from DB (long site lines OK; duplicates with direction OK). */

export function uniqueAreaOptionsFromPool(
  services: DbService[],
  city: string | undefined,
  medium?: string,
): ProgressiveOption[] {
  const scoped = city
    ? services.filter((s) => serviceMatchesCityLabel(s, city))
    : services;
  const groups = new Map<string, { opt: ProgressiveOption; rows: DbService[] }>();
  for (const s of scoped) {
    const area = getFunnelAreaLabel(s);
    if (!area) continue;
    const key = areaDisplayKey(area);
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(s);
      continue;
    }
    groups.set(key, {
      rows: [s],
      opt: {
        id: `area:${key}`,
        label: area,
        city,
        medium,
      },
    });
  }
  return [...groups.values()]
    .map(({ opt, rows }) => ({
      ...opt,
      imageUrl: chipImageIfUniqueNext(rows, 'direction'),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Match free text against direction_remarks (multi-word sites like "Gemini Flyover").
 * Prefers longest / strongest phrase match.
 */

export function poolForCityOptions(
  services: DbService[],
  session: ProgressiveSession,
  scopedPool: DbService[],
): DbService[] {
  // Place/area already locked → stay scoped
  if (session.area || session.placeHint) return scopedPool;

  const token = session.medium || session.browseToken || '';
  if (!token) return scopedPool;

  let hits: DbService[] = [];
  if (session.medium && isExactCatalogMedium(session.medium, services)) {
    // Preserve candidateServiceIds (for example, a direction/site match).
    // Rebuilding from the full catalogue would reintroduce unrelated cities.
    hits = filterByExactMedium(scopedPool, session.medium);
  }
  if (!hits.length) {
    hits = filterForBrowseOrFamily(scopedPool, token);
  }
  if (!hits.length) return scopedPool;

  // MUST apply mediumType so chips match what filterPoolBySession will keep.
  // Never fall back to an untyped pool — that showed Tirupathi/Chittoor cities for
  // Frontlit, then same-service echo auto-locked the only real Frontlit city (Chennai).
  if (session.mediumType) {
    const mt = canonicalizeServiceName(session.mediumType);
    hits = hits.filter((s) => {
      const got = getMediumTypeFromDb(s);
      return !!got && canonicalizeServiceName(got) === mt;
    });
    return hits;
  }
  return hits.length ? hits : scopedPool;
}

/**
 * Prefix bot text once with batch "not offered in city" note (Cab in Madurai, etc.).
 */

export function lockOneCity(
  sess: ProgressiveSession,
  pool: DbService[],
  onlyCity: string,
): ProgressiveSession {
  return {
    ...sess,
    city: onlyCity,
    needsContinueConfirm: false,
    unresolvedPlaceOffer: false,
    candidateServiceIds: pool.map((s) => s.service_id),
    pendingRows: undefined,
  };
}

/** Scope catalog rows by active session locks (exported for src/chat/filterCatalog). */

export function filterPoolBySession(services: DbService[], session: ProgressiveSession): DbService[] {
  let pool = session.candidateServiceIds?.length
    ? services.filter((s) => session.candidateServiceIds!.includes(s.service_id))
    : [...services];

  if (session.medium || session.browseToken) {
    const token = session.browseToken || session.medium || '';
    // Exact catalog medium ("bus semi", "apartment demo") → exact filter
    // Family token ("bus") → browse so bus shelter / other cities are included
    if (session.medium && isExactCatalogMedium(session.medium, services)) {
      const exactMed = filterByExactMedium(pool, session.medium);
      if (exactMed.length) pool = exactMed;
      else {
        const byBrowse = filterForBrowseOrFamily(pool, token);
        if (byBrowse.length) pool = byBrowse;
      }
    } else {
      const byBrowse = filterForBrowseOrFamily(pool, token);
      if (byBrowse.length) {
        pool = byBrowse;
      } else if (session.medium) {
        const exactMed = filterByExactMedium(pool, session.medium);
        if (exactMed.length) pool = exactMed;
      }
    }
  }

  if (session.mediumType) {
    const mt = canonicalizeServiceName(session.mediumType);
    pool = pool.filter((s) => {
      const got = getMediumTypeFromDb(s);
      return !!got && canonicalizeServiceName(got) === mt;
    });
  }

  if (session.directionHint) {
    const dirHits = pool.filter((s) => {
      const dir = getDirectionLabel(s);
      if (!dir) return false;
      return isStrongDirectionMatch(scoreDirectionMatch(session.directionHint!, dir));
    });
    if (dirHits.length) pool = dirHits;
  }

  return filterHitsBySessionLocation(pool, session, services);
}

/**
 * Strict funnel: Service → Type → City → Area → Direction → Quote.
 * Skip empty/NA steps; auto-select when only one option; ask when many.
 *
 * @param opts.allowAutoFinalize When false (same-service name echo), never jump to
 *   quote_ready / min_qty — re-ask location/direction instead.
 */

export function isShortAmbiguousQuery(text: string): boolean {
  const words = extractQueryWords(text).filter((w) => !STOP_WORDS.has(w) && !/^\d+$/.test(w));
  const t = text.trim();
  return words.length >= 1 && words.length <= 2 && t.length <= 28 && !/\band\b/i.test(t);
}

/** Exact catalog medium match (full key), not a partial "booth"→"police booth". */

export function isExactMediaQuery(text: string, services: DbService[]): boolean {
  const q = canonicalizeServiceName(text);
  if (!q) return false;
  return getCatalogTypeKeys(services).some((m) => canonicalizeServiceName(m) === q);
}

/** Exact full locality/area name in DB. */

export function isExactLocalityQuery(text: string, services: DbService[]): boolean {
  const q = canonicalizeServiceName(text);
  if (!q) return false;
  return getCatalogLocalities(services).some((l) => canonicalizeServiceName(l) === q);
}


export function filterHitsBySessionLocation(
  hits: DbService[],
  session: ProgressiveSession,
  catalog?: DbService[],
): DbService[] {
  let out = hits;
  if (session.area) {
      const areaWanted = areaDisplayKey(session.area);
    out = hits.filter((s) => {
      const label = areaDisplayKey(getAreaLabel(s) || '');
      const locality = areaDisplayKey(getLocalityFromMetaCity(s) || '');
      const metaCity = areaDisplayKey(getMetaCityRaw(s) || '');
      const metaArea = areaDisplayKey(getMetaAreaRaw(s) || '');
      // Area/place selection is an exact normalized DB-field match. Do not
      // widen "Anna Nagar" to "Anna Nagar Chintamani" or other child labels.
      // Place = city metadata OR area_name only — NEVER direction_remarks.
      return label === areaWanted
        || locality === areaWanted
        || metaCity === areaWanted
        || metaArea === areaWanted;
    });
    if (session.city && out.length > 0) {
      const narrowed = out.filter((s) =>
        serviceMatchesSessionCity(s, session.city!, session, catalog),
      );
      // Incompatible city+area (e.g. Chittoor + OMR): keep place hits only — never
      // glue foreign city inventory under the wrong city (merge should clear city).
      if (narrowed.length > 0) out = narrowed;
    }
    return out;
  }
  if (session.city) {
    out = out.filter((s) =>
      serviceMatchesSessionCity(s, session.city!, session, catalog),
    );
  }
  return out;
}


export function bestFuzzyGuess(
  services: DbService[],
  query: string,
  city: string | null,
): { svc: DbService; score: number } | null {
  const scoped = filterByCity(services, city);
  const q = canonicalizeServiceName(query);
  if (!q || q.length < 3) return null;

  let best: { svc: DbService; score: number } | null = null;
  const seen = new Set<string>();

  for (const s of scoped) {
    const labels = [
      s.service_name || '',
      (s.service_name || '').split('·')[0],
      getMediumKey(s),
      friendlyServiceLabel(s),
    ];
    for (const label of labels) {
      const score = similarity(q, label);
      if (score < 0.72) continue;
      const id = s.service_id;
      if (seen.has(id) && best && best.svc.service_id === id) continue;
      if (!best || score > best.score) {
        best = { svc: s, score };
        seen.add(id);
      }
    }
  }
  return best && best.score < 0.98 ? best : null;
}


export function softClarifyNeed(
  services: DbService[],
  session: ProgressiveSession,
  reply?: string | null,
): ProgressiveTurnResult {
  const options = uniqueMediumOnlyOptions(services).slice(0, 24);
  const details = extractUserAskDetails(session.originalText || '', services, {
    media: [
      ...(session.medium ? [session.medium] : []),
      ...(session.browseToken ? [session.browseToken] : []),
      ...(session.pendingMedia || []),
    ],
    directionHint: session.directionHint,
    city: session.city,
  });
  const hasUserDetails = !!(details.service || details.site || details.city);
  const detailReply = hasUserDetails
    ? copyUnavailableUserAsk(details, session)
    : null;
  // Prefer naming what the user asked over a generic "couldn't match" / empty AI reply.
  // Keep an explicit city-only "not providing in X" reply when no service/site was named.
  const replyTrim = (reply || '').trim();
  const cityOnlyCallerReply =
    !!replyTrim
    && !details.service
    && !details.site
    && /not providing|not offering|still no services/i.test(replyTrim);
  const botText = cityOnlyCallerReply
    ? replyTrim
    : (detailReply || replyTrim || copyUnknownService(session));

  logFunnelDebug('softClarifyNeed', {
    originalText: session.originalText,
    optionCount: options.length,
    sampleOptions: options.slice(0, 12).map((o) => o.label),
    hasHoardingChip: options.some((o) => /hoarding/i.test(o.label)),
    details,
    usedDetailReply: !!detailReply && botText === detailReply,
  });
  return {
    step: options.length ? 'pick_type' : 'no_match',
    botText,
    options,
    allowMulti: options.length > 0,
    session: stampReplyMeta({ ...session, pendingMedia: [] }, ''),
  };
}


export function startMediumFlow(
  medium: string,
  session: ProgressiveSession,
  services: DbService[],
  reply?: string | null,
  opts?: { allowAutoFinalize?: boolean },
): ProgressiveTurnResult {
  const medKey = canonicalizeServiceName(medium);
  const browseToken = canonicalizeServiceName(session.browseToken || medium);
  const place = session.area || session.placeHint;

  // Family token ("bus") covering Bus Semi + Bus Shelter + … → ask which service first
  // Exact catalog medium ("bus semi", "apartment demo") → lock and continue funnel
  if (!isExactCatalogMedium(medKey, services)) {
    let browseHits = filterForBrowseOrFamily(services, browseToken);
    // Honor city lock / batch candidates so type chips are only what's offered there
    if (session.candidateServiceIds?.length) {
      const set = new Set(session.candidateServiceIds);
      browseHits = browseHits.filter((s) => set.has(s.service_id));
    } else if (session.city) {
      browseHits = browseHits.filter((s) =>
        serviceMatchesSessionCity(s, session.city!, session, services),
      );
    }
    // Place/corridor must scope BEFORE counting types — else we ask "which type?"
    // with a reply, then empty the pool → text and no chips (looks frozen).
    if (place) {
      browseHits = filterByLocality(browseHits, place);
      if (!browseHits.length) {
        // Named place exists in catalog elsewhere, but not for this service
        return buildPlaceOfferTurn(
          browseToken,
          place,
          { ...session, area: undefined, placeHint: undefined },
          services,
          'in',
        );
      }
    }
    const mediums = uniqueMediumOnlyOptions(browseHits);
    // Keep candidates when city/area already scoped (batch city lock)
    const clearCands = !(session.area || session.placeHint || session.city);
    if (mediums.length > 1) {
      return advanceFunnel(
        {
          ...session,
          medium: undefined,
          browseToken,
          area: place || session.area,
          placeHint: session.placeHint || place,
          needsContinueConfirm: !!(place && !session.city),
          candidateServiceIds: clearCands
            ? undefined
            : (session.candidateServiceIds?.length
              ? session.candidateServiceIds
              : browseHits.map((s) => s.service_id)),
        },
        services,
        reply || (place
          ? copyAskTypeAtPlace(browseToken, place, session)
          : session.city
            ? copyAskTypeAtPlace(browseToken, session.city, session)
            : copyAskType(browseToken, session)),
        opts,
      );
    }
    if (mediums.length === 1) {
      return advanceFunnel(
        {
          ...session,
          medium: canonicalizeServiceName(mediums[0].medium || medKey),
          browseToken: canonicalizeServiceName(mediums[0].medium || browseToken),
          area: place || session.area,
          placeHint: session.placeHint || place,
          needsContinueConfirm: !!(place && !session.city),
          candidateServiceIds: clearCands
            ? undefined
            : (session.candidateServiceIds?.length
              ? session.candidateServiceIds
              : browseHits.map((s) => s.service_id)),
        },
        services,
        reply,
        opts,
      );
    }
    // No hits in this city for this family
    if (session.city && !browseHits.length) {
      // User named multiple cities ("bus semi madurai and chennai") but first city
      // had no inventory — skip dead cities and continue usable ones (never Madurai-only list).
      const namedCities = detectCitiesInText(session.originalText || '', services);
      if (namedCities.length >= 2) {
        return startBatchWithCityCandidates(
          [{
            raw: session.originalText || browseToken,
            token: browseToken,
            qty: session.qty ?? null,
            city: null,
          }],
          namedCities,
          {
            ...session,
            city: undefined,
            area: undefined,
            placeHint: undefined,
            directionHint: undefined,
            medium: canonicalizeServiceName(browseToken),
            browseToken: canonicalizeServiceName(browseToken),
          },
          services,
          reply,
        );
      }
      const deadCityKey = canonicalizeServiceName(session.city!);
      const cityOpts = citiesForMedium(services, browseToken).filter(
        (o) => canonicalizeServiceName(o.city || o.label) !== deadCityKey,
      );
      // Named city has no inventory — never silently quote another city.
      if (cityOpts.length >= 1) {
        return {
          step: 'pick_city',
          botText:
            reply && !isAskStepReplyWithoutOptions(reply)
              ? reply
              : copyNotOfferedInCityAskCities(browseToken, session.city!, session),
          options: cityOpts,
          allowMulti: true,
          session: {
            ...session,
            city: undefined,
            area: undefined,
            placeHint: undefined,
            directionHint: undefined,
            medium: isExactCatalogMedium(browseToken, services)
              ? canonicalizeServiceName(browseToken)
              : session.medium,
            browseToken: canonicalizeServiceName(browseToken),
            pendingMedia: [],
            needsContinueConfirm: false,
            candidateServiceIds: undefined,
          },
        };
      }
      return {
        step: 'no_match',
        botText:
          reply && !isAskStepReplyWithoutOptions(reply)
            ? reply
            : copyNotOfferedInCity(browseToken, session.city!, session),
        options: [],
        session: {
          ...session,
          pendingMedia: [],
          city: undefined,
          // Keep the service context so a follow-up such as
          // "where is this available?" remains scoped to the requested
          // service. Only the unavailable city is cleared.
          medium: session.medium || canonicalizeServiceName(browseToken),
          browseToken: canonicalizeServiceName(browseToken),
          area: undefined,
          placeHint: undefined,
          directionHint: undefined,
        },
      };
    }
  }

  const nextSession: ProgressiveSession = {
    ...session,
    medium: medKey,
    browseToken,
    // Keep city/batch-scoped candidates; clear only on a fresh unscoped browse
    candidateServiceIds:
      session.area || session.placeHint || session.city
        ? session.candidateServiceIds
        : undefined,
  };

  // Pull locality from text if not already on session
  if (!nextSession.city && !nextSession.area) {
    const locFromText = detectLocalityInText(session.originalText || '', services);
    if (locFromText) {
      nextSession.area = locFromText;
      nextSession.placeHint = nextSession.placeHint || locFromText;
    }
  }
  if (!nextSession.city && nextSession.area) {
    const pool = filterForBrowseOrFamily(services, browseToken);
    const atPlace = filterByLocality(pool, nextSession.area);
    if (atPlace.length > 0) {
      // Keep city unset so funnel confirms city; require Continue before quote
      return advanceFunnel(
        {
          ...nextSession,
          city: undefined,
          candidateServiceIds: atPlace.map((s) => s.service_id),
          needsContinueConfirm: true,
          pendingCityQueue: nextSession.pendingCityQueue,
          workQueue: nextSession.workQueue,
        },
        services,
        reply,
        opts,
      );
    }
    return buildPlaceOfferTurn(
      browseToken,
      nextSession.area!,
      { ...nextSession, area: undefined, placeHint: undefined },
      services,
      'in',
    );
  }

  return advanceFunnel(nextSession, services, reply, opts);
}

/**
 * True when local heuristics are enough — skip Gemini intent (faster send).
 * Keep AI for ambiguous free text / feature words (led, outdoor alone).
 */
