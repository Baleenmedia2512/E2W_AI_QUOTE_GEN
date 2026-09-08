/**
 * Shared progressive-chat test catalog.
 * Fixture rows (buildProgressiveChatFixtures) pin Bus Semi / Gemini / Navallur / ECR.
 * Live vendor_rate_chunks are merged when available; labels still come from row fields only.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

/** Node has no localStorage; chatbot import chain needs a stub. */
const memoryStore: Record<string, string> = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (k in memoryStore ? memoryStore[k] : null),
  setItem: (k: string, v: string) => {
    memoryStore[k] = String(v);
  },
  removeItem: (k: string) => {
    delete memoryStore[k];
  },
  clear: () => {
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  },
  key: (i: number) => Object.keys(memoryStore)[i] ?? null,
  get length() {
    return Object.keys(memoryStore).length;
  },
} as Storage;

function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const envText = readFileSync(envPath, 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"'))
      || (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]] == null || process.env[m[1]] === '') {
      process.env[m[1]] = v;
    }
  }
}

loadDotEnv();

const { loadAllServicesFromCloud } = await import('../services/supabaseProposalService');
const {
  getMediumKey,
  getAreaLabel,
  getDirectionLabel,
  getDbCityLabel,
  getMediumTypeFromDb,
  getCatalogTypeKeys,
  getCatalogCities,
  getCatalogLocalities,
  detectCitiesInText,
} = await import('../chat/index');
const { canonicalizeServiceName } = await import('./serviceNameUtils');
type DbService = import('./serviceResolver').DbService;

export type CatalogLabels = {
  /** Exact DB medium / type / city / area / direction values — null when absent in catalog. */
  hoarding: string;
  frontlit: string;
  nonlit: string;
  busSemi: string;
  /** First token of busSemi medium (from DB), e.g. "bus". */
  busFamily: string;
  policeBooth: string;
  apartmentLift: string;
  apartmentLobby: string;
  auto: string;
  cab: string;
  chennai: string;
  madurai: string;
  coimbatore: string | null;
  tirupathi: string | null;
  chittoor: string | null;
  hosur: string | null;
  /** Catalog cities where a medium has zero rows (for skip-dead-city cases). */
  boothMissingCity: string | null;
  cabMissingCity: string | null;
  omr: string;
  ecrRoad: string;
  locOmrA: string;
  locOmrB: string | null;
  locOmrC: string | null;
  locEcr: string;
  locEcrB: string | null;
  locPoliceOmr: string | null;
  locBusChennai: string | null;
  locTirupathi: string | null;
  locChittoor: string | null;
  multiSiteArea: string | null;
  geminiLabel: string | null;
  geminiIsArea: boolean;
  busFull: string | null;
  metroElevated: string | null;
  metroUnderground: string | null;
};

function titleFromDb(raw: string): string {
  return raw.trim();
}

function requireDb(value: string | null | undefined, what: string): string {
  const v = (value || '').trim();
  if (!v) {
    throw new Error(`progressiveChat tests: required label missing in real DB: ${what}`);
  }
  return v;
}

function findMedium(services: DbService[], ...needles: string[]): string | null {
  const keys = getCatalogTypeKeys(services);
  for (const needle of needles) {
    const n = canonicalizeServiceName(needle);
    const exact = keys.find((k) => canonicalizeServiceName(k) === n);
    if (exact) {
      const row = services.find(
        (s) => canonicalizeServiceName(getMediumKey(s)) === canonicalizeServiceName(exact),
      );
      return row ? titleFromDb(getMediumKey(row)) : titleFromDb(exact);
    }
  }
  for (const needle of needles) {
    const n = canonicalizeServiceName(needle);
    const partial = keys.find((k) => canonicalizeServiceName(k).includes(n));
    if (partial) {
      const row = services.find(
        (s) => canonicalizeServiceName(getMediumKey(s)) === canonicalizeServiceName(partial),
      );
      return row ? titleFromDb(getMediumKey(row)) : titleFromDb(partial);
    }
  }
  return null;
}

function findCityLabel(services: DbService[], needle: string): string | null {
  const n = canonicalizeServiceName(needle);
  const cities = getCatalogCities(services);
  const hit = cities.find((c) => canonicalizeServiceName(c) === n)
    || cities.find((c) => canonicalizeServiceName(c).includes(n));
  return hit ? titleFromDb(hit) : null;
}

function rowsForMedium(services: DbService[], medium: string): DbService[] {
  const m = canonicalizeServiceName(medium);
  return services.filter((s) => canonicalizeServiceName(getMediumKey(s)) === m);
}

function citiesForMedium(services: DbService[], medium: string): string[] {
  return [
    ...new Set(
      rowsForMedium(services, medium)
        .map((s) => getDbCityLabel(s))
        .filter((c): c is string => !!c),
    ),
  ];
}

function typesForMedium(services: DbService[], medium: string): string[] {
  return [
    ...new Set(
      rowsForMedium(services, medium)
        .map((s) => getMediumTypeFromDb(s))
        .filter((t): t is string => !!t),
    ),
  ];
}

function areasForMediumCity(
  services: DbService[],
  medium: string,
  city: string,
): string[] {
  const c = canonicalizeServiceName(city);
  return [
    ...new Set(
      rowsForMedium(services, medium)
        .filter((s) => canonicalizeServiceName(getDbCityLabel(s) || '') === c)
        .map((s) => getAreaLabel(s))
        .filter((a): a is string => !!a),
    ),
  ];
}

function dirsForMediumCityArea(
  services: DbService[],
  medium: string,
  city: string,
  area: string,
): string[] {
  const c = canonicalizeServiceName(city);
  const a = canonicalizeServiceName(area);
  return [
    ...new Set(
      rowsForMedium(services, medium)
        .filter((s) => canonicalizeServiceName(getDbCityLabel(s) || '') === c)
        .filter((s) => canonicalizeServiceName(getAreaLabel(s) || '') === a)
        .map((s) => getDirectionLabel(s))
        .filter((d): d is string => !!d),
    ),
  ];
}

function pickAreaMatching(
  areas: string[],
  ...needles: string[]
): string | null {
  for (const needle of needles) {
    const n = canonicalizeServiceName(needle);
    const hit = areas.find((a) => canonicalizeServiceName(a) === n)
      || areas.find((a) => canonicalizeServiceName(a).startsWith(n))
      || areas.find((a) => canonicalizeServiceName(a).includes(n));
    if (hit) return hit;
  }
  return null;
}

function pickTypeMatching(types: string[], ...needles: string[]): string | null {
  for (const needle of needles) {
    const n = canonicalizeServiceName(needle);
    const hit = types.find((t) => canonicalizeServiceName(t) === n)
      || types.find((t) => canonicalizeServiceName(t).includes(n));
    if (hit) return hit;
  }
  return null;
}

function priced(meta: Record<string, unknown>): Record<string, unknown> {
  return {
    min_quantity: 1,
    ...meta,
    pricing: {
      display_price: 1000,
      display_unit_price_per_day: 1000,
      ...(typeof meta.pricing === 'object' && meta.pricing
        ? (meta.pricing as Record<string, unknown>)
        : {}),
    },
  };
}

function fx(id: string, name: string, meta: Record<string, unknown>): DbService {
  return {
    service_id: `fx-${id}`,
    service_name: name,
    metadata: priced(meta),
  };
}

/**
 * Deterministic vendor rows for the 13 previously skipped cases.
 * Live catalog is merged on top, except Bus Semi Branding which is fixture-only
 * (Chennai, one site, no direction_remarks) so sole-site quote is stable.
 */
export function buildProgressiveChatFixtures(): DbService[] {
  return [
    fx('hoarding-fl-omr-sholinganallur', 'Hoarding · Chennai OMR', {
      medium: 'Hoarding',
      medium_type: 'Frontlit',
      city: 'Chennai',
      area_name: 'OMR',
      direction_remarks: 'Sholinganallur towards Siruseri',
    }),
    fx('hoarding-fl-omr-padur', 'Hoarding · Chennai OMR', {
      medium: 'Hoarding',
      medium_type: 'Frontlit',
      city: 'Chennai',
      area_name: 'OMR',
      direction_remarks: 'Padur towards Kelambakkam',
    }),
    fx('hoarding-fl-omr-navallur', 'Hoarding · Chennai OMR', {
      medium: 'Hoarding',
      medium_type: 'Frontlit',
      city: 'Chennai',
      area_name: 'OMR',
      direction_remarks: 'Navallur towards SIPCOT',
    }),
    fx('hoarding-fl-omr-gemini', 'Hoarding · Chennai OMR', {
      medium: 'Hoarding',
      medium_type: 'Frontlit',
      city: 'Chennai',
      area_name: 'OMR',
      direction_remarks: 'Gemini Fly Over towards Airport',
    }),
    fx('hoarding-nl-omr', 'Hoarding · Chennai OMR Nonlit', {
      medium: 'Hoarding',
      medium_type: 'Nonlit',
      city: 'Chennai',
      area_name: 'OMR',
      direction_remarks: 'Perungudi towards Taramani',
    }),
    fx('hoarding-fl-ecr-injambakkam', 'Hoarding · Chennai ECR Road', {
      medium: 'Hoarding',
      medium_type: 'Frontlit',
      city: 'Chennai',
      area_name: 'ECR Road',
      direction_remarks: 'Injambakkam towards Mahabalipuram',
    }),
    fx('hoarding-fl-ecr-thiruvanmiyur', 'Hoarding · Chennai ECR Road', {
      medium: 'Hoarding',
      medium_type: 'Frontlit',
      city: 'Chennai',
      area_name: 'ECR Road',
      direction_remarks: 'Thiruvanmiyur towards Besant Nagar',
    }),
    fx('hoarding-fl-tirupathi', 'Hoarding · Tirupathi', {
      medium: 'Hoarding',
      medium_type: 'Frontlit',
      city: 'Tirupathi',
      area_name: 'Tirupathi',
      direction_remarks: 'Alipiri towards Temple',
    }),
    fx('hoarding-fl-chittoor', 'Hoarding · Chittoor', {
      medium: 'Hoarding',
      medium_type: 'Frontlit',
      city: 'Chittoor',
      area_name: 'Chittoor',
      direction_remarks: 'Chittoor bus stand towards Bangalore',
    }),
    // TEST 27 / MSC 1,1b,8,21 — Chennai only, no direction, no extra cities
    fx('bus-semi-chennai-sole', 'Bus Semi Branding · Chennai', {
      medium: 'Bus Semi Branding',
      city: 'Chennai',
    }),
    fx('bus-full-chennai', 'Bus Full Branding · Chennai', {
      medium: 'Bus Full Branding',
      city: 'Chennai',
    }),
    fx('bus-shelter-chennai-adyar', 'Bus Shelter · Chennai Adyar', {
      medium: 'Bus Shelter',
      city: 'Chennai',
      area_name: 'Adyar',
      direction_remarks: 'Towards Besant Nagar',
    }),
    fx('bus-shelter-chennai-t-nagar', 'Bus Shelter · Chennai T Nagar', {
      medium: 'Bus Shelter',
      city: 'Chennai',
      area_name: 'T Nagar',
      direction_remarks: 'Towards Pondy Bazaar',
    }),
    fx('auto-chennai-adyar', 'Auto Semi Branding · Chennai Adyar', {
      medium: 'Auto Semi Branding',
      city: 'Chennai',
      area_name: 'Adyar',
    }),
    fx('auto-chennai-anna-nagar', 'Auto Semi Branding · Chennai Anna Nagar', {
      medium: 'Auto Semi Branding',
      city: 'Chennai',
      area_name: 'Anna Nagar',
    }),
    fx('auto-madurai', 'Auto Semi Branding · Madurai', {
      medium: 'Auto Semi Branding',
      city: 'Madurai',
      area_name: 'Goripalayam',
    }),
    fx('cab-chennai', 'Cab Branding · Chennai', {
      medium: 'Cab Branding',
      city: 'Chennai',
    }),
    fx('booth-madurai', 'Police Booth · Madurai', {
      medium: 'Police Booth',
      city: 'Madurai',
      area_name: 'Goripalayam',
    }),
    fx('booth-chennai-omr', 'Police Booth · Chennai OMR', {
      medium: 'Police Booth',
      city: 'Chennai',
      area_name: 'OMR',
      direction_remarks: 'Towards Siruseri',
    }),
    fx('apt-lift-chennai', 'Apartment Lift Branding · Chennai', {
      medium: 'Apartment Lift Branding',
      city: 'Chennai',
    }),
    fx('apt-lobby-chennai', 'Apartment Lobby Screen Branding · Chennai', {
      medium: 'Apartment Lobby Screen Branding',
      city: 'Chennai',
    }),
    fx('metro-elevated-chennai', 'Metro Station Elevated · Chennai', {
      medium: 'Metro Station Elevated',
      city: 'Chennai',
    }),
    fx('metro-underground-chennai', 'Metro Station Underground · Chennai', {
      medium: 'Metro Station Underground',
      city: 'Chennai',
    }),
    fx('auto-bangalore', 'Auto Full Branding · Bangalore', {
      medium: 'Auto Full Branding',
      city: 'Bangalore',
    }),
  ];
}

function isPinnedBusSemi(svc: DbService): boolean {
  const medium = canonicalizeServiceName(String(
    (svc.metadata as { medium?: string } | undefined)?.medium || '',
  ));
  return medium === 'bus semi branding' || medium === 'bus semi';
}

function mergeFixtureCatalog(live: DbService[]): DbService[] {
  const fixtures = buildProgressiveChatFixtures();
  const liveRest = live.filter((s) => !isPinnedBusSemi(s) && !String(s.service_id || '').startsWith('fx-'));
  return [...fixtures, ...liveRest];
}

export type ProgressiveTestCatalog = {
  services: DbService[];
  labels: CatalogLabels;
  mediums: string[];
  cities: string[];
  localities: string[];
  /** Mediums that exist in 2+ catalog cities. */
  multiCityMediums: Array<{ medium: string; cities: string[] }>;
  citiesForMedium: (medium: string) => string[];
  areasForMediumCity: (medium: string, city: string) => string[];
  dirsForMediumCityArea: (medium: string, city: string, area: string) => string[];
  typesForMedium: (medium: string) => string[];
  rowsForMedium: (medium: string) => DbService[];
};

let cached: ProgressiveTestCatalog | null = null;

/**
 * Load catalog once: fixtures first, then live vendor_rate_chunks (Bus Semi pinned to fixtures).
 */
export async function loadProgressiveTestCatalog(): Promise<ProgressiveTestCatalog> {
  if (cached) return cached;

  let live: DbService[] = [];
  try {
    live = (await loadAllServicesFromCloud()) as DbService[];
  } catch {
    live = [];
  }
  const services = mergeFixtureCatalog(live);
  if (!services.length) {
    throw new Error(
      'progressiveChat tests: fixture catalog empty.',
    );
  }
  detectCitiesInText('chennai madurai tirupathi chittoor bangalore', services);

  const hoarding = findMedium(services, 'hoarding');
  if (!hoarding) {
    throw new Error('progressiveChat tests: no Hoarding medium in real DB');
  }

  const chennai = findCityLabel(services, 'chennai');
  if (!chennai) {
    throw new Error('progressiveChat tests: no Chennai city in real DB');
  }

  const hTypes = typesForMedium(services, hoarding);
  const frontlit = pickTypeMatching(hTypes, 'frontlit', 'front lit');
  const nonlit = pickTypeMatching(hTypes, 'nonlit', 'non lit');
  if (!frontlit || !nonlit) {
    throw new Error(
      `progressiveChat tests: Hoarding needs Frontlit+Nonlit types in DB; got ${hTypes.join('|')}`,
    );
  }

  const chennaiAreas = areasForMediumCity(services, hoarding, chennai);
  const omr = pickAreaMatching(chennaiAreas, 'omr');
  const ecrRoad = pickAreaMatching(chennaiAreas, 'ecr road', 'ecr');
  if (!omr || !ecrRoad) {
    throw new Error(
      `progressiveChat tests: need OMR + ECR Road areas for Hoarding·Chennai; got ${chennaiAreas.slice(0, 12).join('|')}`,
    );
  }

  const omrDirs = dirsForMediumCityArea(services, hoarding, chennai, omr);
  const ecrDirs = dirsForMediumCityArea(services, hoarding, chennai, ecrRoad);
  if (!omrDirs.length || !ecrDirs.length) {
    throw new Error('progressiveChat tests: need direction_remarks under OMR and ECR Road');
  }

  // Prefer a Chennai area with 2+ sites that is not OMR/ECR (area-step echo tests)
  let multiSiteArea: string | null = null;
  for (const area of chennaiAreas) {
    if (
      canonicalizeServiceName(area) === canonicalizeServiceName(omr)
      || canonicalizeServiceName(area) === canonicalizeServiceName(ecrRoad)
    ) {
      continue;
    }
    const dirs = dirsForMediumCityArea(services, hoarding, chennai, area);
    if (dirs.length >= 2) {
      multiSiteArea = area;
      break;
    }
  }

  const geminiArea = pickAreaMatching(chennaiAreas, 'gemini');
  const geminiDir = omrDirs.concat(ecrDirs).find((d) => /gemini/i.test(d)) || null;

  const booth = requireDb(findMedium(services, 'police booth'), 'medium matching police booth');
  const busSemi = requireDb(
    findMedium(services, 'bus semi branding', 'bus semi'),
    'medium matching bus semi',
  );
  const busFamily = requireDb(
    canonicalizeServiceName(busSemi).split(/\s+/).filter(Boolean)[0] || null,
    `family token from medium ${busSemi}`,
  );
  const apartmentLift = requireDb(
    findMedium(services, 'apartment lift branding', 'apartment lift'),
    'medium matching apartment lift',
  );
  const apartmentLobby = requireDb(
    findMedium(services, 'apartment lobby screen branding', 'apartment lobby'),
    'medium matching apartment lobby',
  );
  const auto = requireDb(
    findMedium(services, 'auto semi', 'auto full', 'auto branding', 'auto'),
    'medium matching auto',
  );
  const cab = requireDb(
    findMedium(services, 'cab branding', 'cab'),
    'medium matching cab',
  );
  const madurai = requireDb(findCityLabel(services, 'madurai'), 'city Madurai');

  const boothAreasChennai = areasForMediumCity(services, booth, chennai);
  const boothAreaForDir =
    pickAreaMatching(boothAreasChennai, 'omr') || boothAreasChennai[0] || null;
  const boothChennaiDirs = boothAreaForDir
    ? dirsForMediumCityArea(services, booth, chennai, boothAreaForDir)
    : [];
  const busSemiDirs = rowsForMedium(services, busSemi)
    .filter((s) => canonicalizeServiceName(getDbCityLabel(s) || '') === canonicalizeServiceName(chennai))
    .map((s) => getDirectionLabel(s))
    .filter((d): d is string => !!d);

  const tirupathi = findCityLabel(services, 'tirupathi') || findCityLabel(services, 'tirupati');
  const chittoor = findCityLabel(services, 'chittoor');
  const tirupathiDirs = tirupathi
    ? rowsForMedium(services, hoarding)
      .filter((s) => canonicalizeServiceName(getDbCityLabel(s) || '') === canonicalizeServiceName(tirupathi))
      .map((s) => getDirectionLabel(s))
      .filter((d): d is string => !!d)
    : [];
  const chittoorDirs = chittoor
    ? rowsForMedium(services, hoarding)
      .filter((s) => canonicalizeServiceName(getDbCityLabel(s) || '') === canonicalizeServiceName(chittoor))
      .map((s) => getDirectionLabel(s))
      .filter((d): d is string => !!d)
    : [];

  const boothCities = new Set(
    citiesForMedium(services, booth).map((c) => canonicalizeServiceName(c)),
  );
  const cabCities = new Set(
    citiesForMedium(services, cab).map((c) => canonicalizeServiceName(c)),
  );
  const allCities = getCatalogCities(services);
  /** Prefer a catalog city the engine can parse as a metro (so free-text tests work). */
  const pickMissingMetro = (have: Set<string>): string | null => {
    const candidates = allCities.filter((c) => !have.has(canonicalizeServiceName(c)));
    // Prefer clean metro labels (avoid "Bangalore(inside City)"-style city/area collisions).
    const preferredOrder = [
      'tirupathi',
      'tirupati',
      'chittoor',
      'hosur',
      'madurai',
      'chennai',
      'coimbatore',
      'bangalore',
    ];
    for (const needle of preferredOrder) {
      const hit = candidates.find((c) => {
        const k = canonicalizeServiceName(c);
        if (k !== needle && !k.startsWith(needle)) return false;
        // Skip parenthetical / compound city labels that also act as directions/areas.
        if (/[()]/.test(c) || k.includes('inside')) return false;
        return detectCitiesInText(`in ${c}`, services).length > 0;
      });
      if (hit) return hit;
    }
    return candidates.find((c) => {
      if (/[()]/.test(c) || canonicalizeServiceName(c).includes('inside')) return false;
      return detectCitiesInText(`in ${c}`, services).length > 0;
    }) || null;
  };
  const boothMissingCity = pickMissingMetro(boothCities);
  const cabMissingCity = pickMissingMetro(cabCities);

  const labels: CatalogLabels = {
    hoarding,
    frontlit,
    nonlit,
    busSemi,
    busFamily,
    policeBooth: booth,
    apartmentLift,
    apartmentLobby,
    auto,
    cab,
    chennai,
    madurai,
    coimbatore: findCityLabel(services, 'coimbatore'),
    tirupathi,
    chittoor,
    hosur: findCityLabel(services, 'hosur'),
    boothMissingCity,
    cabMissingCity,
    omr,
    ecrRoad,
    locOmrA: omrDirs[0]!,
    locOmrB: omrDirs[1] || null,
    locOmrC: omrDirs[2] || null,
    locEcr: ecrDirs[0]!,
    locEcrB: ecrDirs[1] || null,
    locPoliceOmr: boothChennaiDirs[0] || null,
    locBusChennai: busSemiDirs[0] || null,
    locTirupathi: tirupathiDirs[0] || null,
    locChittoor: chittoorDirs[0] || null,
    multiSiteArea,
    geminiLabel: geminiArea || geminiDir,
    geminiIsArea: !!geminiArea,
    busFull: findMedium(services, 'bus full branding', 'bus full'),
    metroElevated: findMedium(services, 'metro station elevated', 'metro station'),
    metroUnderground: findMedium(services, 'metro station underground'),
  };

  const mediumCityMap = new Map<string, Set<string>>();
  for (const s of services) {
    const m = getMediumKey(s);
    const c = getDbCityLabel(s);
    if (!m || !c) continue;
    const key = canonicalizeServiceName(m);
    if (!mediumCityMap.has(key)) mediumCityMap.set(key, new Set());
    mediumCityMap.get(key)!.add(c);
  }
  const multiCityMediums = [...mediumCityMap.entries()]
    .filter(([, set]) => set.size >= 2)
    .map(([key, set]) => {
      const row = services.find(
        (s) => canonicalizeServiceName(getMediumKey(s)) === key,
      );
      return {
        medium: row ? getMediumKey(row) : key,
        cities: [...set],
      };
    });

  cached = {
    services,
    labels,
    mediums: getCatalogTypeKeys(services),
    cities: getCatalogCities(services),
    localities: getCatalogLocalities(services),
    multiCityMediums,
    citiesForMedium: (medium) => citiesForMedium(services, medium),
    areasForMediumCity: (medium, city) => areasForMediumCity(services, medium, city),
    dirsForMediumCityArea: (medium, city, area) =>
      dirsForMediumCityArea(services, medium, city, area),
    typesForMedium: (medium) => typesForMedium(services, medium),
    rowsForMedium: (medium) => rowsForMedium(services, medium),
  };

  console.log(
    `[progressiveChat.testCatalog] loaded ${services.length} services; `
    + `hoarding=${labels.hoarding}; cities=${labels.chennai}`
    + (labels.madurai ? `/${labels.madurai}` : '')
    + `; omr=${labels.omr}; ecr=${labels.ecrRoad}`,
  );

  return cached;
}
