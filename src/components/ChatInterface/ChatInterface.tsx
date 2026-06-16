import React, { useState, useRef, useEffect } from 'react';
import {
  Box,
  Input,
  VStack,
  HStack,
  Stack,
  Text,
  IconButton,
  Button,
  Spinner,
  Flex,
  Icon,
  Checkbox,
} from '@chakra-ui/react';
import { FiSend, FiCheck, FiMic, FiChevronUp, FiChevronDown, FiX, FiEdit2 } from 'react-icons/fi';
import { useHistory } from 'react-router-dom';
import { useAppStore } from '../../store';
import { useAuthStore } from '../../store/authStore';
import { sendMessageToGemini } from '../../services/geminiService';
import { Message } from '../../types/chat';
import { Quote, QuoteItem } from '../../types/quote';
import { saveChatHistory, loadChatHistory } from '../../utils/localStorage';
import { loadAllProposalsFromCloud } from '../../services/supabaseProposalService';
import { DEFAULT_GENERAL_TERMS } from '../../utils/quoteGrouping';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { Capacitor } from '@capacitor/core';
import {
  getCityServiceRegistry,
  KNOWN_CITY_LIST,
  type ServiceQuantity,
} from '../../hooks/useCityServiceRegistry';
import { searchServices } from '../../services/pdfEmbeddingService';
import { extractCityHint, resolveServiceIdFromCatalog } from '../../utils/serviceResolver';
import { durationMultiplier, enrichQuoteItemsDurationFromDb, resolveQuoteLineDuration } from '../../utils/durationUtils';
import {
  buildCityServiceListFromDb,
  buildCloudSegmentCityPlan,
  buildGroupedServicesFromDb,
  collectCitiesFromDbServices,
  dedupeConfirmationRows,
  detectCityInTextList,
  detectCityOnlyInList,
  getCitiesForServiceQuery,
  isVagueCategoryQuery,
  mergeCityLists,
  runCloudPreGeminiValidation,
  validateConfirmationRowsMinQty,
  validateQuoteItemsAgainstDbMinQty,
  VEHICLE_CATEGORY_PATTERN,
} from '../../utils/cloudQuoteValidation';
import {
  buildGeminiContextFromDbServices,
  filterDbServicesForConfirmedRows,
  labelsToConfirmRows,
  rowsFromCloudBelowMin,
} from '../../utils/confirmedQuotePipeline';
import type { DbService } from '../../utils/serviceResolver';

// ═══════════════════════════════════════════════════════════════════════
// 🔀 DATA SOURCE TOGGLE
// false = OLD: Full PDF text sent to Gemini (local IndexedDB flow)
// true  = NEW: DB service chunks sent to Gemini (RAG cloud flow, faster + cheaper)
// ═══════════════════════════════════════════════════════════════════════
const USE_CLOUD_DATA = true;

const SUGGESTION_PROMPTS = [
  'Generate quote for 100 auto full branding',
  'Create quote for banner printing 10x5 feet, qty 50',
  'Quote for vehicle branding – 20 tempos',
  'Generate quote for shop signage',
  'Create quote for the services in proposal',
];

// ── Command History Helpers (module-level, no component dependency) ────────
const HISTORY_MAX = 50;
const HISTORY_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface HistoryEntry { text: string; ts: number; }

const getHistoryKey = (userId: string) => `chat_history_${userId}`;

const loadPersistedHistory = (userId: string): HistoryEntry[] => {
  try {
    const raw = localStorage.getItem(getHistoryKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - HISTORY_TTL_MS;
    return (parsed as HistoryEntry[]).filter(
      e => e && typeof e.text === 'string' && typeof e.ts === 'number' && e.ts > cutoff
    );
  } catch {
    return [];
  }
};

const savePersistedHistory = (userId: string, entries: HistoryEntry[]) => {
  try {
    localStorage.setItem(getHistoryKey(userId), JSON.stringify(entries));
  } catch {
    // Incognito / storage full — silently skip
  }
};
// ──────────────────────────────────────────────────────────────────────────

interface CityPickerSegment {
  raw: string;                    // Original segment text (e.g. "100 bus")
  cityNeeded: boolean;            // true if no city was detected in this segment
  detectedCity: string | null;    // City found in segment text (if any)
  selectedCities: string[];       // Cities chosen by user (multi-select)
  matchedCities?: string[];       // Cities where service is confirmed available (from registry)
}

const ChatInterface: React.FC = () => {
  const history = useHistory();
  const { proposal, setCurrentQuote, activeProposals, loadCloudServices } = useAppStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [_error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  // Cache: service key (lowercase) -> minimum quantity, persists across messages in the same session
  const minQtyCacheRef = useRef<Map<string, number>>(new Map());
  /** Locked confirm rows for the current generate request (scoped Gemini context). */
  const confirmedRowsRef = useRef<Array<{ service: string; qty: number | string; city: string }> | null>(null);

  // ── Command History ────────────────────────────────────────────────────────
  const { user } = useAuthStore();
  const [inputHistory, setInputHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draftInput, setDraftInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const prevUserIdRef = useRef<string | undefined>(undefined);
  // ──────────────────────────────────────────────────────────────────────────

  // ── City Service Registry ─────────────────────────────────────────────────
  // Built by useCityServiceRegistry() in App.tsx (runs on every page).
  // Read here via the module-level singleton — no local useEffect needed.
  const cityServiceRegistry = { current: getCityServiceRegistry() };
  // ─────────────────────────────────────────────────────────────────────────

  // Multi-select state for MULTIPLE_MATCH scenarios
  // Map: messageId -> { groupKey (vehicleType|city) -> string[] of selected service names }
  const [selectedServices, setSelectedServices] = useState<Record<string, Record<string, string[]>>>({});

  // Confirmation table state: shown after service selection, before final Gemini call
  const [confirmationTable, setConfirmationTable] = useState<{
    messageId: string;
    rows: Array<{ service: string; qty: number | string; city: string }>;
    originalUserInput: string;
  } | null>(null);

  // City picker state: holds segments awaiting city selection when multiple city PDFs are loaded
  const [cityPickerState, setCityPickerState] = useState<{
    messageId: string;
    originalMessage: string;
    segments: CityPickerSegment[];
    availableCities: string[];
    dbServices?: DbService[];
    requireServiceSelection?: boolean;
  } | null>(null);

  // Pending rows after min-qty modal → opens confirm table (not direct Gemini)
  const [pendingConfirmGeneration, setPendingConfirmGeneration] = useState<{
    rows: Array<{ service: string; qty: number | string; city: string }>;
    originalUserInput: string;
    messageId: string;
  } | null>(null);

  // Multi-select for the city-only "all services" list.
  // Map: messageId -> set of "City|Service" keys → quantity (defaults to minQty).
  const [cityServiceSelection, setCityServiceSelection] = useState<Record<string, Record<string, number>>>({});

  // Minimum quantity warning dialog state
  const [minQtyWarning, setMinQtyWarning] = useState<{
    items: Array<{ description: string; requested: number; originalRequested: number; minimum: number }>;
    pendingQuote: Quote | null;
  } | null>(null);

  // State to track which item is being edited in the min qty warning modal
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
  const [editedQuantity, setEditedQuantity] = useState<string>('');


  // Unavailable service alert state: shown when a service doesn't exist in a city's rate card
  const [unavailableServices, setUnavailableServices] = useState<Array<{ city: string; service: string }>>([]);
  // Pending valid message to send to Gemini after user dismisses the unavailable-service alert
  const [pendingValidMessage, setPendingValidMessage] = useState<string | null>(null);
  // Alternate message used when user clicks "Use Minimum" on a multi-segment below-min warning.
  // Holds the original message rewritten with each below-min segment's qty bumped to its registry minimum.
  const [pendingMinReplacedMessage, setPendingMinReplacedMessage] = useState<string | null>(null);
  const isFullySpecifiedRequest = (userRequest: string): boolean => {
    const request = userRequest.toLowerCase();
    
    // Check for multi-city pattern: "CityName qty service, CityName qty service"
    // e.g. "Chennai 50 auto full branding, Madurai 100 auto semi branding"
    // Uses KNOWN_CITY_LIST to stay in sync with the rest of the app
    const commaParts = request.split(',').map(p => p.trim()).filter(p => p.length > 0);
    if (commaParts.length > 1) {
      const allPartsHaveCity = commaParts.every(part =>
        KNOWN_CITY_LIST.some(city => part.startsWith(city))
      );
      if (allPartsHaveCity) {
        console.log('✅ Client-side detection: Multi-city request detected, treating as EXACT_MATCH');
        return true;
      }
    }
    
    // Check if request contains complete service specifications
    // These patterns indicate the user has already specified the full service name
    const fullServicePatterns = [
      /bus full branding/i,
      /bus semi branding/i,
      /bus back panel/i,
      /auto full branding/i,
      /auto semi branding/i,
      /auto back stickers/i,
      /metro interior/i,
      /cab\s+(?:full|back|interior)/i,
      /tempo\s+(?:full|back)/i,
      /apartment\s+lift/i,
      /traffic\s+(?:awareness|signal)/i,
    ];
    
    // If request matches any full service pattern, it's fully specified
    const hasFullServiceName = fullServicePatterns.some(pattern => pattern.test(request));
    
    if (hasFullServiceName) {
      console.log('✅ Client-side detection: Request contains full service names, will skip MULTIPLE_MATCH');
      return true;
    }
    
    return false;
  };

  // Extract city names from activeProposals file names (matched against KNOWN_CITY_LIST)
  const getAvailableCities = (): string[] => {
    const cities: string[] = [];
    activeProposals.forEach(p => {
      const nameLower = p.fileName.toLowerCase();
      KNOWN_CITY_LIST.forEach(city => {
        if (nameLower.includes(city) && !cities.find(c => c.toLowerCase() === city)) {
          cities.push(city.charAt(0).toUpperCase() + city.slice(1));
        }
      });
    });
    // Fallback: if no known city matched, use cleaned file names as city labels
    if (cities.length === 0) {
      activeProposals.forEach(p => {
        const name = p.fileName.replace(/\.(pdf|xlsx?)$/i, '').replace(/[_\-]+/g, ' ').trim();
        if (!cities.includes(name)) cities.push(name);
      });
    }
    return cities;
  };

  const getMergedDynamicCities = (dbServices: DbService[] = []): string[] =>
    mergeCityLists(getAvailableCities(), collectCitiesFromDbServices(dbServices));

  /**
   * Detect a city keyword in free text (PDF + DB cities when available).
   * Returns lowercase city key, or null.
   */
  const detectKnownCityInText = (text: string, dbServices?: DbService[]): string | null => {
    const dynamic = dbServices?.length ? getMergedDynamicCities(dbServices) : mergeCityLists(getAvailableCities(), []);
    const fromDynamic = detectCityInTextList(text, dynamic);
    if (fromDynamic) return fromDynamic.toLowerCase();
    const lower = text.toLowerCase();
    return KNOWN_CITY_LIST.find(c => new RegExp(`\\b${c}\\b`).test(lower)) || null;
  };

  // Return first city from the list that appears in the text segment (whole-word match)
  const detectCityInText = (text: string, cities: string[]): string | null =>
    detectCityInTextList(text, cities);

  // Detect "city-only" queries — the user typed one or more known city names
  // with no service / quantity. Returns lowercase city keys (matches registry keys),
  // or [] if the query is anything more than just city names + filler words.
  // Examples that match: "madurai" · "coimbatore" · "show services in chennai"
  //                      "madurai, trichy" · "what's available in chennai"
  // Examples that DO NOT match: "50 auto chennai" · "bus in madurai" · "chennai vs madurai"
  const detectCityOnlyQuery = (text: string, dbServices?: DbService[]): string[] => {
    const merged = dbServices?.length
      ? getMergedDynamicCities(dbServices)
      : getAvailableCities();
    const availCities = merged.map(c => c.toLowerCase());
    return detectCityOnlyInList(text, availCities);
  };

  // Split message by "and" or ",", then check each segment for a city keyword.
  // Pre-processing also handles Bug 1 — repeated clauses like " i need "/" i want "/
  // " also need " treated as new " and " boundaries.
  // (No service-name aliases here — spelling/spacing variants are handled generically
  // inside classifySegmentByRegistry by joining adjacent words.)
  const parseSegmentsForCity = (message: string, cities: string[]): CityPickerSegment[] => {
    const normalized = message
      // Bug 1: treat repeated "i need"/"i want"/"also need" mid-sentence as new clauses.
      .replace(/(\S\s+)i\s+(need|want)\s+/gi, '$1and ')
      .replace(/(\S\s+)also\s+(need|want)\s+/gi, '$1and ');

    const parts = normalized.split(/\band\b|,/i).map(p => p.trim()).filter(p => p.length > 0);
    const segments = parts.map(raw => {
      const detectedCity = detectCityInText(raw, cities);
      return {
        raw,
        cityNeeded: !detectedCity,
        detectedCity,
        selectedCities: detectedCity ? [detectedCity] : [],
      };
    });

    // If a segment is ONLY a city name (no service words), inherit service from previous segment
    // e.g. "100 bus semi branding Chennai and madurai" → madurai inherits "100 bus semi branding"
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      const strippedRaw = seg.raw
        .replace(new RegExp(cities.join('|'), 'gi'), '')
        .replace(/\d+/g, '')
        .replace(/\s+/g, ' ').trim();
      if (strippedRaw.length === 0 && seg.detectedCity) {
        // Only a city — inherit previous segment's service
        const prev = segments[i - 1];
        const prevService = prev.raw
          .replace(new RegExp(cities.join('|'), 'gi'), '')
          .trim();
        segments[i] = {
          ...seg,
          raw: `${prevService} ${seg.detectedCity}`.trim(),
        };
      }
    }

    // NOTE: Do not auto-inherit a single detected city to other city-missing
    // segments. Example: "30 bus madurai and auto" should keep "auto" without a
    // city so the city picker can ask the user explicitly.

    // Bug 2: dedupe by `${city}|${normalizedServiceText}` so repeated clauses
    // ("cab and cab", "auto and auto") collapse into a single entry.
    const seen = new Set<string>();
    const deduped: typeof segments = [];
    for (const s of segments) {
      const svcKey = s.raw
        .toLowerCase()
        .replace(new RegExp(cities.join('|'), 'gi'), '')
        .replace(/\d+/g, '')
        .replace(/\b(i|need|want|the|a|an|for|in|at|of|and|please)\b/gi, '')
        .replace(/\s+/g, ' ').trim();
      const dupKey = `${(s.detectedCity || '').toLowerCase()}|${svcKey}`;
      if (svcKey.length > 0 && seen.has(dupKey)) {
        console.log(`🧹 [Dedup] dropping duplicate segment: "${s.raw}"`);
        continue;
      }
      seen.add(dupKey);
      deduped.push(s);
    }

    return deduped;
  };

  // Load chat history on mount
  useEffect(() => {
    const history = loadChatHistory();
    if (history && history.length > 0) {
      setMessages(history.map(msg => ({
        ...msg,
        timestamp: new Date(msg.timestamp),
      })));
    }
  }, []);

  // Save chat history when messages change
  useEffect(() => {
    if (messages.length > 0) {
      saveChatHistory(messages);
    }
  }, [messages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Sync minQtyCacheRef from the global registry on mount (registry may already
  // be populated by useCityServiceRegistry in App.tsx before this component mounts)
  useEffect(() => {
    getCityServiceRegistry().forEach(entry => {
      if (entry.status === 'ready') {
        Object.entries(entry.quantities).forEach(([svc, q]) => {
          if (q.min > 1) minQtyCacheRef.current.set(svc, q.min);
        });
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Helper: check if a user query segment matches any service in a city's registry.
  // Returns 'found' | 'not_found' | 'registry_unavailable'
  const checkServiceInRegistry = (
    cityKey: string,
    querySegment: string
  ): { result: 'found' | 'not_found' | 'registry_unavailable'; matchedService?: string; qty?: ServiceQuantity } => {
    const entry = cityServiceRegistry.current.get(cityKey);
    if (!entry || entry.status !== 'ready' || entry.services.length === 0) {
      console.log(`📋 [Registry] "${cityKey}" — not ready or empty`);
      return { result: 'registry_unavailable' };
    }

    console.log(`📋 [Registry] "${cityKey}" services (${entry.services.length}):`, entry.services);

    // Clean query: strip city name, standalone numbers, filler words
    // Use \b\d+\b (not \d+) so alphanumeric tokens like "a4"/"a5" are preserved
    const cleaned = querySegment
      .replace(new RegExp(`\\b${cityKey}\\b`, 'gi'), '')
      .replace(/\b\d+\b/g, '')
      .replace(/\b(need|for|the|a|an|in|at|of|and|months?|days?|weeks?|years?|i|want|please|generate|quote|services?|ads?|advertising|outdoor|campaign|some|any)\b/gi, '')
      .toLowerCase()
      .trim();

    const userWords = cleaned.split(/\s+/).filter(w => w.length >= 2);
    if (userWords.length === 0) return { result: 'registry_unavailable' };

    // Normalize a word to its base (strip trailing 's') for singular/plural matching
    // e.g. "hoardings" → "hoarding" → regex \bhoardings?\b matches both "hoarding" and "hoardings"
    const baseWord = (w: string) => w.replace(/s$/, '');

    // Forward match: ALL user words appear in registry service name
    const forwardMatches = entry.services.filter(svc =>
      userWords.every(word => new RegExp(`\\b${baseWord(word)}s?\\b`, 'i').test(svc))
    );

    // Reverse match: ALL registry service words appear in user query (user typed more than needed)
    // e.g. "newspaper insertion paper size" → registry "newspaper insertion" → reverse match ✓
    const reverseMatches = forwardMatches.length === 0
      ? entry.services.filter(svc => {
          const svcWords = svc.split(/\s+/).filter(w => w.length >= 2);
          return svcWords.every(sw =>
            userWords.some(uw => new RegExp(`\\b${baseWord(sw)}s?\\b`, 'i').test(uw))
          );
        })
      : [];

    const matches = forwardMatches.length > 0 ? forwardMatches : reverseMatches;

    console.log(`🔍 [Registry] query="${querySegment}" → cleaned words: [${userWords.join(', ')}]`);
    console.log(`🔍 [Registry] forwardMatches: [${forwardMatches.join(', ')}] | reverseMatches: [${reverseMatches.join(', ')}]`);

    if (matches.length === 0) return { result: 'not_found' };

    // Return the first/best match with its quantity constraints
    const best = matches[0];
    return { result: 'found', matchedService: best, qty: entry.quantities[best] };
  };
  // ─────────────────────────────────────────────────────────────────────────

  // ─── GENERIC SEGMENT CLASSIFIER (registry-driven, category-agnostic) ────
  // Replaces hardcoded keyword logic. For ANY service category (bus, auto,
  // newspaper, lamp post, hoarding, radio, …) decides:
  //   • registry_unavailable → caller falls back to text scan / Gemini
  //   • empty                → user typed only fillers
  //   • not_found            → service genuinely absent in this city
  //   • specific             → exactly one service matches (auto-confirm)
  //   • vague                → 2+ services match (show checkbox group)
  type SegmentClassification =
    | { state: 'registry_unavailable' }
    | { state: 'empty' }
    | { state: 'not_found' }
    | { state: 'specific'; matches: string[]; qty?: ServiceQuantity }
    | { state: 'vague'; matches: string[] };

  const classifySegmentByRegistry = (cityKey: string, segText: string): SegmentClassification => {
    const entry = cityServiceRegistry.current.get(cityKey);
    if (!entry || entry.status !== 'ready' || entry.services.length === 0) {
      return { state: 'registry_unavailable' };
    }
    // Use \b\d+\b (not \d+) so alphanumeric tokens like "a4"/"a5" are preserved
    const cleaned = segText
      .replace(new RegExp(`\\b${cityKey}\\b`, 'gi'), '')
      .replace(/\b\d+\b/g, '')
      .replace(/\b(need|for|the|a|an|in|at|of|and|months?|days?|weeks?|years?|i|want|please|generate|quote|services?|ads?|advertising|outdoor|campaign|some|any)\b/gi, '')
      .toLowerCase().trim();
    const userWords = cleaned.split(/\s+/).filter(w => w.length >= 2);
    if (userWords.length === 0) return { state: 'empty' };

    // Generic spelling-variant tolerance (NO hardcoded service names):
    //   • strip trailing "s" for singular/plural (\bword s?\b regex)
    //   • generate joined-pair tokens for adjacent user words
    //     (e.g. "news","paper" → also try "newspaper";
    //           "lamp","post"  → also try "lamppost")
    //     so the user's spacing doesn't have to match the registry's spelling.
    const baseWord = (w: string) => w.replace(/s$/, '');
    const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const joinedPairs: string[] = [];
    for (let i = 0; i < userWords.length - 1; i++) {
      joinedPairs.push(baseWord(userWords[i]) + baseWord(userWords[i + 1]));
    }
    const wordMatchesService = (word: string, svc: string) =>
      new RegExp(`\\b${escapeRx(baseWord(word))}s?\\b`, 'i').test(svc);

    const matches = entry.services.filter(svc => {
      // Forward match: every user word appears (singular/plural) in service name.
      if (userWords.every(w => wordMatchesService(w, svc))) return true;
      // Joined-pair tolerance: walk userWords, allowing adjacent pairs to merge.
      let i = 0;
      while (i < userWords.length) {
        const single = wordMatchesService(userWords[i], svc);
        const pair = i < userWords.length - 1 && new RegExp(`\\b${escapeRx(joinedPairs[i])}s?\\b`, 'i').test(svc);
        if (single) { i += 1; continue; }
        if (pair) { i += 2; continue; }
        return false;
      }
      return true;
    });
    console.log(`🧮 [Classify] city="${cityKey}" userWords=[${userWords.join(',')}] joined=[${joinedPairs.join(',')}] → ${matches.length} match(es): [${matches.join(' | ')}]`);
    if (matches.length === 0) return { state: 'not_found' };
    if (matches.length === 1) return { state: 'specific', matches, qty: entry.quantities[matches[0]] };

    // ── TF-IDF tie-break ──────────────────────────────────────────────────
    // Multiple candidates matched — score each by IDF-weighted token overlap.
    // Rare disambiguating words ("underground", "lobby", "lit") outweigh
    // common ones ("branding", "board"). If the top score clearly beats the
    // runner-up (>= 25% margin AND >= 1.0 absolute), classify as specific.
    const idf = entry.idf || {};
    const userTokens = [...userWords.map(baseWord), ...joinedPairs];
    const scoreOf = (svc: string): number => {
      const svcTokens = new Set(svc.split(/\s+/).map(baseWord));
      let s = 0;
      for (const t of userTokens) if (svcTokens.has(t)) s += idf[t] ?? 1;
      return s;
    };
    const scored = matches
      .map(svc => ({ svc, score: scoreOf(svc) }))
      .sort((a, b) => b.score - a.score);
    console.log(`🧮 [Classify] TF-IDF scores:`, scored.slice(0, 5).map(s => `${s.svc}=${s.score.toFixed(2)}`).join(' | '));

    const [top, second] = scored;
    const clearWinner = top.score >= 1.0 && top.score >= second.score * 1.25;
    if (clearWinner) {
      return { state: 'specific', matches: [top.svc], qty: entry.quantities[top.svc] };
    }
    return { state: 'vague', matches };
  };
  // ─────────────────────────────────────────────────────────────────────────

  // Handle keyboard appearance on mobile - adjust viewport
  useEffect(() => {
    if (typeof window !== 'undefined' && window.visualViewport) {
      const viewport = window.visualViewport;
      const handleViewportResize = () => {
        const viewportHeight = viewport.height;
        document.documentElement.style.setProperty(
          '--visual-viewport-height',
          `${viewportHeight}px`
        );
      };

      viewport.addEventListener('resize', handleViewportResize);
      viewport.addEventListener('scroll', handleViewportResize);
      handleViewportResize(); // Initial call

      return () => {
        viewport.removeEventListener('resize', handleViewportResize);
        viewport.removeEventListener('scroll', handleViewportResize);
      };
    }
  }, []);

  // ── Command History: load on login, clear on logout ────────────────────────
  useEffect(() => {
    if (user?.id) {
      prevUserIdRef.current = user.id;
      setInputHistory(loadPersistedHistory(user.id));
    } else {
      // User logged out — scrub their history from localStorage and clear memory
      if (prevUserIdRef.current) {
        try { localStorage.removeItem(getHistoryKey(prevUserIdRef.current)); } catch {}
        prevUserIdRef.current = undefined;
      }
      setInputHistory([]);
    }
    setHistoryIndex(-1);
    setDraftInput('');
  }, [user?.id]);

  // ── Command History: multi-tab sync via storage event ─────────────────────
  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id;
    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === getHistoryKey(userId)) {
        setInputHistory(loadPersistedHistory(userId));
      }
    };
    window.addEventListener('storage', handleStorageEvent);
    return () => window.removeEventListener('storage', handleStorageEvent);
  }, [user?.id]);
  // ──────────────────────────────────────────────────────────────────────────

  // ── Shared helper: push any prompt text into the persistent command history ─
  const pushToHistory = (text: string) => {
    if (!user?.id) return;
    setInputHistory(prev => {
      const deduped = prev.filter(e => e.text !== text);
      const next = [...deduped, { text, ts: Date.now() }].slice(-HISTORY_MAX);
      savePersistedHistory(user.id!, next);
      return next;
    });
    setHistoryIndex(-1);
    setDraftInput('');
  };
  // ──────────────────────────────────────────────────────────────────────────

  // Thin wrapper: reads inputValue from state and delegates to sendMessageWithContent
  const handleSendMessage = () => {
    if (!inputValue.trim() || isLoading) return;
    const text = inputValue;
    // Don't save pure city-only queries (e.g. "chennai", "madurai") — they just open
    // the service list and are not useful to recall via arrow-up history.
    if (detectCityOnlyQuery(text).length === 0) {
      pushToHistory(text);
    }
    setInputValue('');
    sendMessageWithContent(text);
  };

  // ── Command History: keyboard Up/Down navigation ───────────────────────────
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (inputHistory.length === 0) return;

    const el = inputRef.current;
    const cursorPos = el?.selectionStart ?? 0;
    const valueLen = inputValue.length;

    if (e.key === 'ArrowUp' && cursorPos === 0) {
      e.preventDefault();
      const newIdx = historyIndex === -1
        ? inputHistory.length - 1
        : Math.max(0, historyIndex - 1);
      if (historyIndex === -1) setDraftInput(inputValue);
      setHistoryIndex(newIdx);
      setInputValue(inputHistory[newIdx].text);
      setTimeout(() => {
        if (el) el.selectionStart = el.selectionEnd = inputHistory[newIdx].text.length;
      }, 0);
      return;
    }

    if (e.key === 'ArrowDown' && cursorPos === valueLen) {
      e.preventDefault();
      if (historyIndex === -1) return;
      const newIdx = historyIndex + 1;
      if (newIdx >= inputHistory.length) {
        setHistoryIndex(-1);
        setInputValue(draftInput);
        setTimeout(() => {
          if (el) el.selectionStart = el.selectionEnd = draftInput.length;
        }, 0);
      } else {
        setHistoryIndex(newIdx);
        setInputValue(inputHistory[newIdx].text);
        setTimeout(() => {
          if (el) el.selectionStart = el.selectionEnd = inputHistory[newIdx].text.length;
        }, 0);
      }
      return;
    }
  };
  // ──────────────────────────────────────────────────────────────────────────

  // Core send logic — accepts text directly, no reliance on inputValue state
  const sendMessageWithContent = async (text: string) => {
    if (!text.trim() || isLoading) return;

    // Strip internal bypass flags (never shown to user or sent to Gemini)
    const isQtyOverride = text.includes('[QTY_OVERRIDE]');
    const isCheckboxConfirmedFlag = text.includes('[User has already specified complete service names from checkboxes]');
    const cleanedText = text
      .replace(/\s*\[QTY_OVERRIDE\]/g, '')
      .replace(/\s*\[User has already specified complete service names from checkboxes\]/g, '')
      .trim();

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: cleanedText,
      timestamp: new Date(),
    };

    // ─── RAG SEARCH GATE ──────────────────────────────────────────────────────
    // If query looks like a simple search (not quote generation), check RAG database first
    const isQuoteRequest = /\b(generate|create|quote|price|cost|for)\b/i.test(cleanedText)
      || /\b\d+\b/.test(cleanedText) // Any number = quantity → quote intent, not search
      || /\b(branding|advertising|signage|hoarding|banner|sticker|shelter|panel|board|printing|display|wrapping)\b/i.test(cleanedText) // Full service names → quote intent
      || VEHICLE_CATEGORY_PATTERN.test(cleanedText) // Single-word categories: "bus", "auto", etc.
      || isVagueCategoryQuery(cleanedText);
    const isSimpleSearch = !isQuoteRequest && !isQtyOverride && !isCheckboxConfirmedFlag;
    
    if (isSimpleSearch && cleanedText.split(' ').length >= 2) {
      try {
        console.log('🔍 Searching RAG database for:', cleanedText);
        const ragResults = await searchServices(cleanedText, 5);
        
        if (ragResults && ragResults.length > 0) {
          console.log(`✅ Found ${ragResults.length} RAG results`);
          
          // Format results as assistant message
          let ragContent = `📚 **Found ${ragResults.length} matching services:**\n\n`;
          ragResults.forEach((result: any, idx: number) => {
            const similarity = (result.similarity * 100).toFixed(1);
            ragContent += `**${idx + 1}. ${result.service_name}** (${similarity}% match)\n`;
            ragContent += `${result.content.substring(0, 200)}...\n\n`;
            ragContent += `_Click below to generate a quote for this service_\n\n`;
          });
          
          const assistantMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: ragContent,
            timestamp: new Date(),
            isRagSearchResult: true,
            ragResults: ragResults,
          };
          
          setMessages(prev => [...prev, userMessage, assistantMsg]);
          return;
        }
      } catch (error) {
        console.warn('RAG search failed, falling back to Gemini:', error);
        // Continue to normal Gemini flow
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

    // ─── CITY-ONLY QUERY GATE ────────────────────────────────────────────────
    if (!isQtyOverride && !isCheckboxConfirmedFlag) {
      let cityOnlyDbServices: DbService[] = [];
      if (USE_CLOUD_DATA) {
        try {
          const { loadAllServicesFromCloud } = await import('../../services/supabaseProposalService');
          cityOnlyDbServices = (await loadAllServicesFromCloud()) || [];
        } catch {
          // Registry path still available
        }
      }
      const cityOnlyMatches = detectCityOnlyQuery(cleanedText, cityOnlyDbServices);
      if (cityOnlyMatches.length > 0) {
        let lists = cityOnlyMatches
          .map(cityKey => {
            const entry = cityServiceRegistry.current.get(cityKey);
            if (!entry || entry.status !== 'ready' || entry.services.length === 0) return null;
            const services = entry.services.map(svc => ({
              name: svc.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
              minQty: entry.quantities[svc]?.min ?? 1,
            }));
            return {
              city: cityKey.charAt(0).toUpperCase() + cityKey.slice(1),
              services,
            };
          })
          .filter((x): x is { city: string; services: Array<{ name: string; minQty: number }> } => !!x);

        if (lists.length === 0 && USE_CLOUD_DATA && cityOnlyDbServices.length > 0) {
          lists = cityOnlyMatches
            .map(cityKey => buildCityServiceListFromDb(cityKey, cityOnlyDbServices))
            .filter((x): x is { city: string; services: Array<{ name: string; minQty: number }> } => !!x);
        }

        if (lists.length > 0) {
          const assistantMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: lists.length === 1
              ? `Here are all services available in ${lists[0].city}. Tap any to start a quote:`
              : `Here are services available in: ${lists.map(l => l.city).join(', ')}. Tap any to start:`,
            timestamp: new Date(),
            isCityServiceList: true,
            cityServiceList: lists,
          };
          setMessages(prev => [...prev, userMessage, assistantMsg]);
          setInputValue('');
          return;
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    let prefetchedDbServices: any[] | null = null;

    // ─── CLOUD CITY GATE (DB-backed — works without local PDFs) ─────────────
    if (
      USE_CLOUD_DATA &&
      !isQtyOverride &&
      !isCheckboxConfirmedFlag &&
      isQuoteRequest &&
      !isFullySpecifiedRequest(cleanedText)
    ) {
      try {
        const { loadAllServicesFromCloud } = await import('../../services/supabaseProposalService');
        prefetchedDbServices = await loadAllServicesFromCloud();
        const dbList = (prefetchedDbServices || []) as DbService[];

        if (dbList.length > 0) {
          const dynamicCities = getMergedDynamicCities(dbList);
          const isMultiSegment = /,|\band\b/i.test(cleanedText);
          const isVagueWhole = isVagueCategoryQuery(cleanedText);
          const knownCityWhole = detectKnownCityInText(cleanedText, dbList);

          // ── Single-segment vague with no city (e.g. "bus") ──
          if (!isMultiSegment && isVagueWhole && !knownCityWhole) {
            const cloudCities = getCitiesForServiceQuery(cleanedText, dbList);

            if (cloudCities.length >= 2) {
              const segments: CityPickerSegment[] = [{
                raw: cleanedText,
                cityNeeded: true,
                detectedCity: null,
                selectedCities: [],
                matchedCities: cloudCities,
              }];
              const pickerMsgId = (Date.now() + 1).toString();
              const pickerMsg: Message = {
                id: pickerMsgId,
                role: 'assistant',
                content: '🏙️ This service is available in multiple cities. Please select your city:',
                timestamp: new Date(),
                isCityPicker: true,
              };
              setMessages(prev => [...prev, userMessage, pickerMsg]);
              setInputValue('');
              setCityPickerState({
                messageId: pickerMsgId,
                originalMessage: cleanedText,
                segments,
                availableCities: cloudCities,
                dbServices: dbList,
                requireServiceSelection: true,
              });
              return;
            }

            if (cloudCities.length === 1) {
              const qtyMatch = cleanedText.match(/(\d+)/);
              const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
              const group = buildGroupedServicesFromDb(cleanedText, cloudCities[0], qty, dbList);
              if (group && group.services.length > 0) {
                const msgId = (Date.now() + 1).toString();
                const assistantMsg: Message = {
                  id: msgId,
                  role: 'assistant',
                  content: `🔀 Multiple services found in ${cloudCities[0]}. Select all you need:`,
                  timestamp: new Date(),
                  isMultipleMatch: true,
                  groupedServices: [group],
                  originalUserInput: cleanedText,
                };
                setMessages(prev => [...prev, userMessage, assistantMsg]);
                setInputValue('');
                return;
              }
            }
          }

          // ── Multi-segment OR single segment with city in text ──
          const rawSegments = parseSegmentsForCity(cleanedText, dynamicCities);
          const forceCityPickerForSingleCityless =
            rawSegments.length === 1 &&
            rawSegments[0].cityNeeded &&
            !rawSegments[0].detectedCity;

          const segments = buildCloudSegmentCityPlan(
            rawSegments,
            dbList,
            forceCityPickerForSingleCityless,
          ) as CityPickerSegment[];

          const hasServiceRequest = segments.some(
            (s) => s.cityNeeded && (s.matchedCities?.length ?? 0) >= 2,
          ) || forceCityPickerForSingleCityless;

          if (hasServiceRequest) {
            const pickerMsgId = (Date.now() + 1).toString();
            const pickerMsg: Message = {
              id: pickerMsgId,
              role: 'assistant',
              content: '🏙️ Please select the city for each service below:',
              timestamp: new Date(),
              isCityPicker: true,
            };
            setMessages(prev => [...prev, userMessage, pickerMsg]);
            setInputValue('');
            setCityPickerState({
              messageId: pickerMsgId,
              originalMessage: cleanedText,
              segments,
              availableCities: dynamicCities,
              dbServices: dbList,
              requireServiceSelection:
                forceCityPickerForSingleCityless || isVagueWhole || isMultiSegment,
            });
            return;
          }

          // All segments have cities — DB pre-Gemini validation
          const resolvedRows = segments
            .filter((seg) => seg.detectedCity)
            .map((seg) => {
              const qtyMatch = seg.raw.match(/(\d+)/);
              const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
              return { raw: seg.raw, city: seg.detectedCity!, qty };
            });

          if (resolvedRows.length > 0) {
            const cloudResult = runCloudPreGeminiValidation(resolvedRows, dbList);

            if (cloudResult.belowMinSegments.length > 0 && !isQtyOverride) {
              setMessages(prev => [...prev, userMessage]);
              const confirmRows = rowsFromCloudBelowMin(
                cloudResult.validSegmentLabels,
                cloudResult.belowMinSegments.map((bm) => ({
                  svcLabel: bm.svcLabel,
                  cityLabel: bm.cityLabel,
                  requestedQty: bm.requestedQty,
                })),
              );
              setMinQtyWarning({
                items: cloudResult.belowMinSegments.map(bm => ({
                  description: `${bm.svcLabel} - ${bm.cityLabel}`,
                  requested: bm.requestedQty,
                  originalRequested: bm.requestedQty,
                  minimum: bm.minQty,
                })),
                pendingQuote: null as any,
              });
              setPendingConfirmGeneration({
                rows: confirmRows,
                originalUserInput: cleanedText,
                messageId: userMessage.id,
              });
              setPendingValidMessage(null);
              setPendingMinReplacedMessage(null);
              if (cloudResult.preAlerts.length > 0) setUnavailableServices(cloudResult.preAlerts);
              return;
            }

            if (cloudResult.vagueGroups.length > 0) {
              if (cloudResult.preAlerts.length > 0) setUnavailableServices(cloudResult.preAlerts);
              const assistantId = Date.now().toString();
              const assistantMsg: Message = {
                id: assistantId,
                role: 'assistant',
                content: '🔀 Multiple services found. Select all you need:',
                timestamp: new Date(),
                isMultipleMatch: true,
                groupedServices: cloudResult.vagueGroups,
                originalUserInput: cleanedText,
                directParts: cloudResult.validSegmentLabels.length > 0
                  ? cloudResult.validSegmentLabels
                  : undefined,
              };
              setMessages(prev => [...prev, userMessage, assistantMsg]);
              setInputValue('');
              return;
            }

            if (cloudResult.preAlerts.length > 0) {
              setUnavailableServices(cloudResult.preAlerts);
              if (cloudResult.validSegmentRaws.length === 0) {
                setMessages(prev => [...prev, userMessage]);
                return;
              }
              setMessages(prev => [...prev, userMessage]);
              setPendingValidMessage(cloudResult.validSegmentRaws.join(' and '));
              return;
            }
          }
        }
      } catch (cloudGateErr) {
        console.warn('⚠️ [CloudCityGate] Prefetch failed, continuing:', cloudGateErr);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ─── CITY GATE (local PDF registry — skipped when cloud DB handles routing) ─
    if (activeProposals.length > 1 && !(USE_CLOUD_DATA && prefetchedDbServices && prefetchedDbServices.length > 0)) {
      const availCities = getAvailableCities();
      if (availCities.length > 1) {
        const rawSegments = parseSegmentsForCity(userMessage.content, availCities);
        // For pure one-segment, city-missing queries like "auto", force explicit
        // city choice instead of silently auto-assigning a single matched city.
        const forceCityPickerForSingleCityless =
          rawSegments.length === 1 &&
          rawSegments[0].cityNeeded &&
          !rawSegments[0].detectedCity;

        // Auto-assign city for segments whose service exists in exactly ONE city's registry.
        // Falls back to raw PDF text scan if registry not yet built for a city.
        // Only segments present in 2+ cities remain cityNeeded=true and appear in the picker.
        const segments: CityPickerSegment[] = rawSegments.map(seg => {
          if (!seg.cityNeeded) return seg; // already has city in the text

          // Bug 4 (strict): ONLY list cities whose registry actually contains the service.
          // No text-scan fallback — if a registry isn't ready yet, that city is excluded
          // rather than guessed in (which previously let Madurai leak under "lamp post").
          const citiesWithService = availCities.filter(city => {
            const cityKey = KNOWN_CITY_LIST.find(c => city.toLowerCase().includes(c)) || city.toLowerCase();
            const cls = classifySegmentByRegistry(cityKey, seg.raw);
            return cls.state === 'specific' || cls.state === 'vague';
          });

          if (citiesWithService.length === 1 && !forceCityPickerForSingleCityless) {
            console.log(`🏙️ Registry auto-assigned "${seg.raw}" → ${citiesWithService[0]}`);
            return {
              ...seg,
              cityNeeded: false,
              detectedCity: citiesWithService[0],
              selectedCities: [citiesWithService[0]],
              matchedCities: citiesWithService,
            };
          }

          // 0 cities (service not found anywhere) or 2+ cities (need picker)
          return { ...seg, matchedCities: citiesWithService };
        });

        // Show city picker only when a segment needs a city AND the service was found in 2+ cities.
        // If service is found in 0 cities (unknown query) let Gemini handle it directly.
        const hasServiceRequest = segments.some(s =>
          s.cityNeeded && s.matchedCities !== undefined && s.matchedCities.length >= 2
        );
        if (hasServiceRequest || forceCityPickerForSingleCityless) {
          let localDbServices: DbService[] = (prefetchedDbServices || []) as DbService[];
          if (USE_CLOUD_DATA && localDbServices.length === 0) {
            try {
              const { loadAllServicesFromCloud } = await import('../../services/supabaseProposalService');
              localDbServices = (await loadAllServicesFromCloud()) || [];
              prefetchedDbServices = localDbServices;
            } catch {
              // Registry path still works when DB unavailable
            }
          }
          const pickerMsgId = (Date.now() + 1).toString();
          const pickerMsg: Message = {
            id: pickerMsgId,
            role: 'assistant',
            content: '🏙️ Multiple city rate cards are loaded. Please select the city for each service below:',
            timestamp: new Date(),
            isCityPicker: true,
          };
          setMessages(prev => [...prev, userMessage, pickerMsg]);
          setInputValue('');
          setCityPickerState({
            messageId: pickerMsgId,
            originalMessage: userMessage.content,
            segments,
            availableCities: availCities,
            dbServices: localDbServices,
            requireServiceSelection: forceCityPickerForSingleCityless || isVagueCategoryQuery(userMessage.content),
          });
          return; // Stop here — do NOT send to Gemini yet
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ─── PRE-GEMINI CITY-SERVICE AVAILABILITY CHECK (Registry-based) ────────
    if (activeProposals.length > 1 && !(USE_CLOUD_DATA && prefetchedDbServices && prefetchedDbServices.length > 0)) {
      const availCitiesPre = getAvailableCities();
      if (availCitiesPre.length > 1) {
        const preSegments = parseSegmentsForCity(userMessage.content, availCitiesPre);
        const preAlerts: Array<{ city: string; service: string }> = [];
        const validSegmentRaws: string[] = [];
        // Parallel display labels (friendly: `{qty} {Service} ({City})`) — shown in the
        // "Already confirmed" panel. Falls back to the raw segment when service is unknown.
        const validSegmentLabels: string[] = [];
        const titleCaseSvc = (s: string) => s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        // vague segment now carries the FULL matches list straight from the classifier,
        // so the checkbox group is built from real registry data (works for any category).
        const vagueSegments: Array<{ seg: typeof preSegments[0]; cityKey: string; matches: string[]; qty: number }> = [];
        // Collected below-minimum segments — surfaced AFTER the loop in a single combined warning
        // so other valid segments aren't dropped (previously a `return` bailed out on the first).
        const belowMinSegments: Array<{
          rawSegment: string;
          requestedQty: number;
          minQty: number;
          svcLabel: string;
          cityLabel: string;
        }> = [];

        for (const seg of preSegments) {
          const segLower = seg.raw.toLowerCase();

          if (!seg.detectedCity) {
            // No city in this segment — check if it names a known-but-unloaded city
            const unloadedCity = KNOWN_CITY_LIST.find(city =>
              new RegExp(`\\b${city}\\b`).test(segLower) &&
              !activeProposals.some(p => p.fileName.toLowerCase().includes(city))
            );
            if (unloadedCity) {
              const cityLabel = unloadedCity.charAt(0).toUpperCase() + unloadedCity.slice(1);
              const svcLabel = seg.raw
                .replace(new RegExp(unloadedCity, 'gi'), '')
                .replace(/\d+/g, '')
                .replace(/\b(need|for|the|a|an|in|at|of|months?|days?|weeks?|years?)\b/gi, '')
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ')
                .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                .join(' ') || cityLabel;
              preAlerts.push({ city: cityLabel, service: svcLabel });
              continue;
            }
            // No city at all → let Gemini handle it
            validSegmentRaws.push(seg.raw);
            validSegmentLabels.push(seg.raw);
            continue;
          }

          // City detected — classify via registry (single decision point)
          const cityKey = KNOWN_CITY_LIST.find(c => seg.detectedCity!.toLowerCase().includes(c)) || seg.detectedCity.toLowerCase();
          const cls = classifySegmentByRegistry(cityKey, seg.raw);
          const cityLabel = seg.detectedCity.charAt(0).toUpperCase() + seg.detectedCity.slice(1);

          // — registry not built yet: try a generic price-line text scan as a stop-gap —
          if (cls.state === 'registry_unavailable') {
            const cityProposal = activeProposals.find(p => p.fileName.toLowerCase().includes(cityKey));
            const userWords = seg.raw
              .replace(/\d+/g, '')
              .replace(new RegExp(`\\b${cityKey}\\b`, 'gi'), '')
              .replace(/\b(i|need|a|an|the|for|in|at|of|and|want|please|generate|quote|services?|ads?|advertising|outdoor|some|any)\b/gi, '')
              .toLowerCase().replace(/\s+/g, ' ').trim()
              .split(/\s+/).filter(w => w.length >= 2);

            if (cityProposal?.textContent && userWords.length > 0) {
              // Generic heuristic: short line containing all user words AND a price/qty hint nearby
              const textLines = cityProposal.textContent.split(/\r?\n/);
              const found: string[] = [];
              for (const line of textLines) {
                const t = line.trim();
                if (t.length < 4 || t.length > 100) continue;
                const tLower = t.toLowerCase();
                const hasAllUserWords = userWords.every(w => tLower.includes(w));
                const looksLikeServiceLine = /(rs\.?|₹|\/-|\bsq\.?cm\b|\bsec\b|\bspot\b|\bday\b|\bmonth\b|\bper\b|\d{2,})/i.test(t);
                if (hasAllUserWords && looksLikeServiceLine) {
                  const cleaned = t
                    .replace(/[:\-–—]\s*[\d₹,. ]+.*$/, '')
                    .replace(/\s+/g, ' ').trim();
                  if (cleaned.length > 3 && !found.includes(cleaned)) found.push(cleaned);
                }
              }
              if (found.length >= 1) {
                const qtyMatch = seg.raw.match(/(\d+)/);
                const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
                if (found.length === 1) {
                  // single match → specific (auto-confirm)
                  validSegmentRaws.push(seg.raw);
                  validSegmentLabels.push(`${qty} ${titleCaseSvc(found[0])} (${cityLabel})`);
                } else if (isCheckboxConfirmedFlag) {
                  // Already confirmed via checkboxes — bypass checkbox UI, send to Gemini
                  validSegmentRaws.push(seg.raw);
                  validSegmentLabels.push(seg.raw);
                } else {
                  vagueSegments.push({ seg, cityKey, matches: found, qty });
                }
                continue;
              }
            }
            // No text-based services found → let Gemini handle it
            validSegmentRaws.push(seg.raw);
            validSegmentLabels.push(seg.raw);
            continue;
          }

          // — empty or not_found → alert —
          if (cls.state === 'empty' || cls.state === 'not_found') {
            const svcLabel = seg.raw
              .replace(new RegExp(seg.detectedCity, 'gi'), '')
              .replace(/\d+/g, '')
              .replace(/\b(need|for|the|a|an|in|at|of|months?|days?|weeks?|years?)\b/gi, '')
              .replace(/\s+/g, ' ')
              .trim()
              .split(' ')
              .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
              .join(' ') || cityLabel;
            preAlerts.push({ city: cityLabel, service: svcLabel });
            continue;
          }

          // — vague → checkbox group (bypass when already confirmed via checkboxes) —
          if (cls.state === 'vague') {
            if (isCheckboxConfirmedFlag) {
              // User already confirmed these services via checkboxes — skip checkbox UI
              validSegmentRaws.push(seg.raw);
              validSegmentLabels.push(seg.raw);
              continue;
            }
            const qtyMatch = seg.raw.match(/(\d+)/);
            const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
            vagueSegments.push({ seg, cityKey, matches: cls.matches, qty });
            continue;
          }

          // — specific → validate qty against registry min/max, then send to Gemini —
          {
            const matchedSvc = cls.matches[0];
            const qtyMatch = seg.raw.match(/(\d+)/);
            // Default qty falls back to registry min so users who don't type a number
            // (e.g. "newspaper insertion in chennai") get the rate-card minimum.
            const requestedQty = qtyMatch ? parseInt(qtyMatch[1]) : (cls.qty?.min ?? null);

            if (cls.qty && requestedQty !== null) {
              const { min, max } = cls.qty;
              if (!isQtyOverride && requestedQty < min) {
                const svcLabel = matchedSvc.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                // Collect — DO NOT return. We still want every other segment processed
                // so the user gets a single combined warning and the full batch is sent
                // to Gemini after they choose Continue / Use Minimum.
                belowMinSegments.push({
                  rawSegment: seg.raw,
                  requestedQty,
                  minQty: min,
                  svcLabel,
                  cityLabel,
                });
                validSegmentRaws.push(seg.raw);
                validSegmentLabels.push(`${requestedQty} ${titleCaseSvc(matchedSvc)} (${cityLabel}) ⚠️ below min ${min}`);
                continue;
              }
              if (max !== null && requestedQty > max) {
                const svcLabel = matchedSvc.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                preAlerts.push({ city: cityLabel, service: `${svcLabel} (max ${max} units — you requested ${requestedQty})` });
                continue;
              }
            }
            validSegmentRaws.push(seg.raw);
            const labelQty = requestedQty ?? 1;
            validSegmentLabels.push(`${labelQty} ${titleCaseSvc(matchedSvc)} (${cityLabel})`);
          }
        }

        // ── If any below-min segments were collected, surface a single combined warning ──
        // pendingValidMessage carries the FULL message (all segments) so Continue keeps
        // every service. pendingMinReplacedMessage carries the same message with each
        // below-min segment's first number rewritten to its registry minimum.
        if (belowMinSegments.length > 0) {
          setMessages(prev => [...prev, userMessage]);
          const fullMessage = validSegmentRaws.join(' and ');
          let rewritten = fullMessage;
          for (const bm of belowMinSegments) {
            // Replace the original below-min segment with the same segment whose first
            // number has been bumped to its minimum. We replace the exact raw substring
            // to avoid colliding with other segments that share keywords.
            const rewrittenSeg = bm.rawSegment.replace(/\b\d+\b/, String(bm.minQty));
            rewritten = rewritten.replace(bm.rawSegment, rewrittenSeg);
          }
          setMinQtyWarning({
            items: belowMinSegments.map(bm => ({
              description: `${bm.svcLabel} - ${bm.cityLabel}`,
              requested: bm.requestedQty,
              originalRequested: bm.requestedQty,
              minimum: bm.minQty,
            })),
            pendingQuote: null as any,
          });
          setPendingValidMessage(fullMessage);
          setPendingMinReplacedMessage(rewritten);
          // Surface availability alerts (if any) at the same time so the user sees the full picture.
          if (preAlerts.length > 0) setUnavailableServices(preAlerts);
          return;
        }

        // Handle vague segments with city → show checkboxes built from registry matches
        if (vagueSegments.length > 0) {
          const groupedServices: Array<{
            vehicleType: string;
            requestedQuantity: number;
            services: Array<{ name: string; category: string }>;
          }> = [];

          vagueSegments.forEach(({ seg, matches, qty }) => {
            const cityLabel = seg.detectedCity!.charAt(0).toUpperCase() + seg.detectedCity!.slice(1);
            // Use the FIRST matched service's leading word as the group label
            // (e.g. "Lamp Post Branding" → "Lamp Post"; "Newspaper Insertion - RE" → "Newspaper")
            const groupLabel = matches[0]
              .split(/[-–—]/)[0]
              .split(' ').slice(0, 2)
              .map(w => w.charAt(0).toUpperCase() + w.slice(1))
              .join(' ').trim();
            const relatedServices = matches.map(s => ({
              name: s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
              category: groupLabel,
            }));

            groupedServices.push({
              vehicleType: `${groupLabel}|${cityLabel}`,
              requestedQuantity: qty,
              services: relatedServices,
            });
          });

          if (groupedServices.length > 0) {
            if (preAlerts.length > 0) setUnavailableServices(preAlerts);
            const assistantId = Date.now().toString();
            const assistantMsg: Message = {
              id: assistantId,
              role: 'assistant',
              content: `🔀 Multiple services found. Select all you need:`,
              timestamp: new Date(),
              isMultipleMatch: true,
              groupedServices,
              directParts: validSegmentLabels.length > 0 ? validSegmentLabels : undefined,
            };
            setMessages(prev => [...prev, userMessage, assistantMsg]);
            setInputValue('');
            return;
          }
        }

        if (preAlerts.length > 0) {
          setUnavailableServices(preAlerts);
          if (validSegmentRaws.length === 0) {
            setMessages(prev => [...prev, userMessage]);
            return;
          }
          setMessages(prev => [...prev, userMessage]);
          setPendingValidMessage(validSegmentRaws.join(' and '));
          return;
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);


    try {
      // Prepare proposal contexts for AI
      let proposalContexts: Array<{fileName: string, content: string}> | undefined;
      let dbServicesForResolution: any[] = [];

      if (USE_CLOUD_DATA) {
        // ── NEW: RAG / DB path — send only matched service chunks (500 tokens vs 50,000) ──
        try {
          const { loadAllServicesFromCloud } = await import('../../services/supabaseProposalService');
          const dbServices = prefetchedDbServices ?? await loadAllServicesFromCloud();
          dbServicesForResolution = dbServices || [];

          if (dbServices && dbServices.length > 0) {
            let servicesToSend = dbServices as DbService[];

            // Post-confirm: send ONLY the services the user locked in the confirm table
            if (isCheckboxConfirmedFlag && confirmedRowsRef.current?.length) {
              servicesToSend = filterDbServicesForConfirmedRows(
                confirmedRowsRef.current,
                servicesToSend,
              );
              console.log(`🔒 [ConfirmedPipeline] Scoped Gemini context to ${servicesToSend.length} confirmed service(s)`);
            } else {
              const detectedCity = detectKnownCityInText(cleanedText, dbServicesForResolution);
              if (detectedCity) {
                const cityFiltered = dbServices.filter((svc: any) => {
                  const locs: string[] = svc.metadata?.locations || [];
                  const docName = (svc.document_name || '').toLowerCase();
                  return locs.some((l: string) => l.toLowerCase().includes(detectedCity))
                      || docName.includes(detectedCity);
                });
                if (cityFiltered.length > 0) {
                  servicesToSend = cityFiltered;
                  console.log(`🏙️ [CityFilter] Filtered to "${detectedCity}": ${cityFiltered.length} services`);
                }
              }
            }

            proposalContexts = buildGeminiContextFromDbServices(servicesToSend);
            console.log(`☁️ [USE_CLOUD_DATA] Using ${proposalContexts.length} DB services as context (~${proposalContexts.reduce((s, p) => s + p.content.length, 0)} chars)`);
            // DEBUG: Show exact context for first 3 services so we can verify pricing format
            console.log('📋 [DB-CONTEXT-DEBUG] Sample service contexts sent to Gemini:');
            proposalContexts.slice(0, 3).forEach((ctx, i) => {
              console.log(`\n  Service ${i + 1} (${ctx.fileName}):\n${ctx.content}\n  ---`);
            });
            // Also show context for auto full branding specifically if present
            const autoCtx = proposalContexts.find(ctx => ctx.content.toLowerCase().includes('auto full branding'));
            if (autoCtx) {
              console.log('\n🚗 [DB-CONTEXT-DEBUG] Auto Full Branding context:\n' + autoCtx.content);
            }
          } else {
            console.warn('⚠️ [USE_CLOUD_DATA] No DB services found, falling back to PDF text');
          }
        } catch (cloudErr) {
          console.warn('⚠️ [USE_CLOUD_DATA] DB load failed, falling back to PDF text:', cloudErr);
        }
      }

      // ── OLD / FALLBACK: Full PDF text path ────────────────────────────────
      if (!proposalContexts) {
      if (activeProposals.length > 0) {
        // Multi-location mode: use only user-selected active proposals
        proposalContexts = activeProposals
          .filter(p => p.textContent && p.textContent.trim().length > 50)
          .map(p => ({ fileName: p.fileName, content: p.textContent }));
        console.log(`🎯 Multi-location mode: using ${proposalContexts.length} user-selected proposals`);
      } else {
        // Default: Load all proposals from cloud for multi-document search
        let allProposals: any[] = [];
        try {
          allProposals = await loadAllProposalsFromCloud(100);
        } catch (err) {
          console.warn('Could not load proposals from cloud, using current proposal only:', err);
        }

        if (allProposals && allProposals.length > 0) {
          // Multi-document mode: Send ALL uploaded proposals to AI
          proposalContexts = allProposals
            .filter(p => p.text_content && p.text_content.trim().length > 50)
            .map(p => ({
              fileName: p.file_name,
              content: p.text_content
            }));
          console.log(`📚 Multi-document search enabled: ${proposalContexts.length} documents available`);
        }
      }
      }
      // ── END FALLBACK ──────────────────────────────────────────────────────

      // 🔧 CLIENT-SIDE VALIDATION: Check if request is fully specified (prevents checkbox loops)
      let enhancedUserMessage = userMessage.content;

      if (isCheckboxConfirmedFlag) {
        enhancedUserMessage =
          `[EXACT_MATCH_HINT: User already confirmed exact service names via checkboxes — generate quote immediately, DO NOT return multipleMatch] ${enhancedUserMessage}`;
        console.log('🔧 Added post-checkbox EXACT_MATCH hint');
      } else if (isFullySpecifiedRequest(userMessage.content)) {
        enhancedUserMessage = `[EXACT_MATCH_HINT: This request contains full service names] ${enhancedUserMessage}`;
        console.log('🔧 Added EXACT_MATCH hint to prevent re-analysis');
      }

      const isFullySpecified = isCheckboxConfirmedFlag || isFullySpecifiedRequest(userMessage.content);

      // Add city→PDF mapping hint when multiple PDFs are loaded so AI knows which
      // document to draw prices from for each city section
      if (activeProposals.length > 1) {
        const cityMappingHint = activeProposals
          .map(p => {
            const name = p.fileName.replace(/\.(pdf|xlsx?)$/i, '').replace(/[_-]+/g, ' ').trim();
            return `"${p.fileName}" → ${name} pricing`;
          })
          .join('; ');
        enhancedUserMessage = `[CITY_PDF_MAP: ${cityMappingHint}] ${enhancedUserMessage}`;
        console.log('🗺️ Added city→PDF mapping hint:', cityMappingHint);
      }

      let response = await sendMessageToGemini({
        userMessage: enhancedUserMessage,
        proposalText: proposal.textContent, // Backward compatibility fallback
        proposalTexts: proposalContexts, // NEW: Multi-document support
        chatHistory: messages,
      });

      // Post-checkbox: Gemini must not re-open service pickers — retry once as EXACT_MATCH
      if (
        isCheckboxConfirmedFlag &&
        response.isMultipleMatch &&
        response.groupedServices &&
        !response.isQuoteGeneration
      ) {
        console.log('🔁 [Post-Confirm] MULTIPLE_MATCH after checkbox confirm — retrying as EXACT_MATCH');
        const stripped = cleanedText.replace(/^generate\s+quote\s+for\s+/i, '').trim();
        const retryMessage =
          `[EXACT_MATCH_HINT: User ALREADY confirmed these exact services via checkboxes. ` +
          `Return quoteGenerated JSON only — never multipleMatch.] Generate quote for ${stripped}`;
        try {
          const retryResponse = await sendMessageToGemini({
            userMessage: retryMessage,
            proposalText: proposal.textContent,
            proposalTexts: proposalContexts,
            chatHistory: [],
          });
          if (retryResponse.isQuoteGeneration && retryResponse.quoteData) {
            response = retryResponse;
          } else {
            console.warn('⚠️ [Post-Confirm] Retry did not produce quote:', retryResponse.matchType);
          }
        } catch (retryErr) {
          console.warn('⚠️ [Post-Confirm] EXACT_MATCH retry failed:', retryErr);
        }
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.message,
        timestamp: new Date(),
        matchType: response.matchType,
        
        // MULTIPLE_MATCH
        isMultipleMatch: response.isMultipleMatch,
        groupedServices: response.groupedServices,
        originalUserInput: userMessage.content, // Preserve original input to carry forward duration/days
        
        // PARTIAL_MATCH
        isPartialMatch: response.isPartialMatch,
        requestedService: response.requestedService,
        requestedQuantity: response.requestedQuantity,
        closestServices: response.closestServices,
        alternativeServices: response.alternativeServices,
        
        // NO_MATCH
        isNoMatch: response.isNoMatch,
        allServicesGrouped: response.allServicesGrouped,
        
        // DEPRECATED (backward compatibility)
        isServiceNotFound: response.isServiceNotFound,
        availableServices: response.availableServices,
        validServices: response.validServices,
        missingServices: response.missingServices,
      };

      // Handle 4-tier matching system responses
      
      // MULTIPLE_MATCH - Ask user to clarify (or redirect vague queries to city-first flow)
      if (response.isMultipleMatch && response.groupedServices) {
        const quoteReadyAfterConfirm =
          isCheckboxConfirmedFlag && response.isQuoteGeneration && response.quoteData;

        if (isCheckboxConfirmedFlag && !quoteReadyAfterConfirm) {
          console.log('🚫 [Post-Confirm] Blocking duplicate checkbox UI after user confirmation');
          const failMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content:
              'Your services were confirmed, but quote generation did not complete. Please tap Generate again or simplify to one service per message.',
            timestamp: new Date(),
          };
          setMessages(prev => [...prev, failMsg]);
          setIsLoading(false);
          return;
        }

        if (!quoteReadyAfterConfirm) {
        if (
          USE_CLOUD_DATA &&
          !isCheckboxConfirmedFlag &&
          isVagueCategoryQuery(cleanedText)
        ) {
          try {
            const dbList = (dbServicesForResolution.length > 0
              ? dbServicesForResolution
              : (await (await import('../../services/supabaseProposalService')).loadAllServicesFromCloud())) as DbService[];
            if (!detectKnownCityInText(cleanedText, dbList)) {
            const cloudCities = getCitiesForServiceQuery(cleanedText, dbList);

            if (cloudCities.length >= 2) {
              const segments: CityPickerSegment[] = [{
                raw: cleanedText,
                cityNeeded: true,
                detectedCity: null,
                selectedCities: [],
                matchedCities: cloudCities,
              }];
              const pickerMsgId = (Date.now() + 1).toString();
              const pickerMsg: Message = {
                id: pickerMsgId,
                role: 'assistant',
                content: '🏙️ This service is available in multiple cities. Please select your city:',
                timestamp: new Date(),
                isCityPicker: true,
              };
              setMessages(prev => [...prev, pickerMsg]);
              setCityPickerState({
                messageId: pickerMsgId,
                originalMessage: cleanedText,
                segments,
                availableCities: cloudCities,
                dbServices: dbList,
                requireServiceSelection: true,
              });
              setIsLoading(false);
              return;
            }

            if (cloudCities.length === 1 && dbList.length > 0) {
              const qtyMatch = cleanedText.match(/(\d+)/);
              const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
              const group = buildGroupedServicesFromDb(cleanedText, cloudCities[0], qty, dbList);
              if (group && group.services.length > 0) {
                assistantMessage.content = `🔀 Multiple services found in ${cloudCities[0]}. Select all you need:`;
                assistantMessage.groupedServices = [group];
                assistantMessage.originalUserInput = cleanedText;
                setMessages(prev => [...prev, assistantMessage]);
                setIsLoading(false);
                return;
              }
            }
            }
          } catch (redirectErr) {
            console.warn('⚠️ [MULTIPLE_MATCH] City-first redirect failed:', redirectErr);
          }
        }

        console.log('🔀 MULTIPLE_MATCH detected - Showing service options');
        response.groupedServices.forEach(group => {
          console.log(`  - ${group.vehicleType}: ${group.services.length} services found`);
        });
        setMessages(prev => [...prev, assistantMessage]);
        setIsLoading(false);
        return;
        }
      }
      
      // PARTIAL_MATCH - Suggest alternatives
      if (response.isPartialMatch && response.closestServices) {
        setMessages(prev => [...prev, assistantMessage]);
        setIsLoading(false);
        return;
      }
      
      // NO_MATCH - Show all services
      if (response.isNoMatch && response.allServicesGrouped) {
        setMessages(prev => [...prev, assistantMessage]);
        setIsLoading(false);
        return;
      }
      
      // DEPRECATED: Handle old serviceNotFound format
      if (response.isServiceNotFound && response.availableServices) {
        assistantMessage.content = response.serviceNotFoundMessage || 
          `The requested service is not available in the proposal. Please select from the available services below:`;
        setMessages(prev => [...prev, assistantMessage]);
        setIsLoading(false);
        return;
      }

      // EXACT_MATCH - Quote generated, process and navigate
      if (response.isQuoteGeneration && response.quoteData) {
        // Don't show the raw Gemini response message for quote generation
        // Check the actual documents that were sent to Gemini (multi-doc or single doc)
        let isRateCardImage = false;
        if (proposalContexts && proposalContexts.length > 0) {
          // Multi-document mode: check if ALL documents are images
          isRateCardImage = proposalContexts.every(p => {
            const ext = p.fileName.toLowerCase().split('.').pop() || '';
            return ['jpg', 'jpeg', 'png', 'webp'].includes(ext);
          });
        } else {
          // Single document mode: check current proposal
          const fileExtension = proposal.fileName.toLowerCase().split('.').pop() || '';
          isRateCardImage = ['jpg', 'jpeg', 'png', 'webp'].includes(fileExtension);
        }
        
        console.log('🔍 Rate card detection:', { isRateCardImage, fileName: proposal.fileName, multiDoc: !!proposalContexts });
        
        // Flatten lineItems into individual QuoteItems
        const quoteItems: QuoteItem[] = response.quoteData.items.flatMap((section: any, sectionIndex: number) => {
          const sectionTitle = section.title || '';
          // Resolve service_id once per section from Gemini's title (e.g. "Bus Semi Branding")
          let sectionServiceId: string | undefined;
          let sectionServiceName: string | undefined;
          if (sectionTitle && dbServicesForResolution.length > 0) {
            const rowMatch = confirmedRowsRef.current?.find((r) =>
              sectionTitle.toLowerCase().includes(r.service.toLowerCase()) ||
              r.service.toLowerCase().includes(sectionTitle.toLowerCase()),
            );
            const cityHintEarly = rowMatch?.city && rowMatch.city !== '—'
              ? rowMatch.city.toLowerCase()
              : extractCityHint(cleanedText);
            const resolved = resolveServiceIdFromCatalog(sectionTitle, dbServicesForResolution, cityHintEarly);
            if (resolved) {
              sectionServiceId = resolved.serviceId;
              sectionServiceName = resolved.serviceName;
              console.log(`🔗 [ServiceId] Section "${sectionTitle}" → ${sectionServiceId}`);
            }
          }
          return section.lineItems.map((item: any, lineIndex: number) => {
            // Use original description from AI - don't prepend generic section title
            // The AI already provides specific service names (e.g., "BUS SEMI BRANDING - Rental Price")
            let description = item.description;
            
            // Check if description is too generic (missing specific service details)
            // Only prepend section title if description doesn't contain specific service keywords
            const hasSpecificService = /\b(BUS|AUTO|CAB|TAXI|TEMPO|TRUCK|VAN|VEHICLE|SHOP|BANNER|SIGNAGE|BOARD|HOARDING|DISPLAY|PRINTING|FIXING|RENTAL|BRANDING|FULL|SEMI|BACK|FRONT|SIDE)\b/i.test(description);
            const containsSectionTitle = description.toLowerCase().includes(sectionTitle.toLowerCase());
            
            // Only prepend if description is generic AND doesn't already have section title
            if (sectionTitle && !containsSectionTitle && !hasSpecificService) {
              description = `${sectionTitle} - ${description}`;
            }
            
            // Extract specific service title from description for display in T&C section
            // This ensures we show "Bus Full Branding" instead of generic "Vehicle Branding"
            let specificTitle = '';
            const descParts = description.split(' - ');
            if (descParts.length >= 2 && sectionTitle && 
                descParts[0].toLowerCase().trim() === sectionTitle.toLowerCase().trim()) {
              // First part is generic section title, use second part as specific title
              specificTitle = descParts[1].trim();
            } else {
              // Use first part as title
              specificTitle = descParts[0].trim();
            }
            // Clean up extra details (e.g., "(per bus month)") to get just the service name
            specificTitle = specificTitle
              .replace(/\s*\(.*?\)\s*/g, '') // Remove parenthetical notes
              .replace(/\s*-\s*(Display|Rental|Printing|Fixing|Price).*$/i, '') // Remove price type suffixes
              .trim();
            
            const svcMeta = sectionServiceId
              ? dbServicesForResolution.find((s: { service_id: string }) => s.service_id === sectionServiceId)?.metadata
              : undefined;

            const resolved = resolveQuoteLineDuration(
              { duration: item.duration, durationUnit: item.durationUnit, description },
              cleanedText,
              svcMeta,
            );
            return {
              id: `${sectionIndex}-${lineIndex}`,
              title: specificTitle, // Store specific service title for T&C display
              description: description,
              serviceId: sectionServiceId,
              serviceName: sectionServiceName || sectionTitle || undefined,
              quantity: item.quantity || 1,
              rate: item.unitPrice || 0,
              duration: resolved.duration,
              durationUnit: resolved.durationUnit,
              durationIsAuto: resolved.isAutoFromDb,
              total: (item.quantity || 1) * (item.unitPrice || 0) * resolved.multiplier,
              minimumQuantity: item.minimumQuantity || undefined,
              // Only store terms on the first line item of each section to avoid duplicate textareas
              // For rate card images, clear per-item terms; for proposals, keep them
              termsAndConditions: lineIndex === 0 ? (isRateCardImage ? undefined : (section.termsAndConditions || undefined)) : undefined
            };
          });
        });

        // Deduplicate: Gemini sometimes extracts the same service section twice when the
        // PDF mentions it in both a pricing summary table AND a detailed section.
        // Keep only the first occurrence of each unique description (case-insensitive).
        const _seenDescriptions = new Set<string>();
        const uniqueQuoteItems = quoteItems.filter(item => {
          const key = item.description.toLowerCase().trim();
          if (_seenDescriptions.has(key)) {
            console.log(`⚠️ Duplicate item removed: "${item.description}"`);
            return false;
          }
          _seenDescriptions.add(key);
          return true;
        });
        if (uniqueQuoteItems.length < quoteItems.length) {
          console.log(`🧹 Deduplication: ${quoteItems.length} → ${uniqueQuoteItems.length} items`);
          // Replace reference so all downstream code uses deduplicated list
          quoteItems.length = 0;
          quoteItems.push(...uniqueQuoteItems);
        }

        // Resolve proposal_chunks.service_id for each item (direct image lookup in preview)
        if (dbServicesForResolution.length === 0) {
          try {
            const { loadAllServicesFromCloud } = await import('../../services/supabaseProposalService');
            dbServicesForResolution = await loadAllServicesFromCloud();
          } catch (err) {
            console.warn('⚠️ Could not load services for serviceId resolution:', err);
          }
        }
        if (dbServicesForResolution.length > 0) {
          const { attachServiceIdsToQuoteItems, extractCityHint } = await import('../../utils/serviceResolver');
          const cityHint = extractCityHint(cleanedText)
            || extractCityHint(quoteItems.map(i => i.description).join(' '));
          const resolvedItems = attachServiceIdsToQuoteItems(
            quoteItems,
            dbServicesForResolution,
            cityHint,
          );
          quoteItems.length = 0;
          quoteItems.push(...resolvedItems);
          const enriched = enrichQuoteItemsDurationFromDb(
            quoteItems,
            cleanedText,
            dbServicesForResolution,
          );
          quoteItems.length = 0;
          quoteItems.push(...enriched);
        }

        // Populate minimum-quantity cache from AI response so that future requests in the
        // same session can validate against known minimums even if the AI omits minimumQuantity.
        quoteItems.forEach(item => {
          if (item.minimumQuantity) {
            const serviceKey = item.description.split(' - ')[0].toLowerCase().trim();
            minQtyCacheRef.current.set(serviceKey, item.minimumQuantity);
            console.log(`📦 Cached min qty: "${serviceKey}" → ${item.minimumQuantity}`);
          }
        });

        const subtotal = quoteItems.reduce((sum, item) => sum + item.total, 0);
        const gstPercentage = 18;
        const gstAmount = subtotal * (gstPercentage / 100);
        
        // Hydrate T&C from proposal_chunks.metadata.terms (DB source of truth)
        let topLevelTerms = response.quoteData.termsAndConditions || '';
        let hydratedFromDb = false;

        if (!isRateCardImage && dbServicesForResolution.length > 0) {
          const { hydrateQuoteTermsFromCatalog } = await import('../../utils/termsHydration');
          console.log('🔍 [T&C-Debug] quoteItems serviceIds:', quoteItems.map(i => ({ desc: i.description, sid: i.serviceId })));
          const hydrated = hydrateQuoteTermsFromCatalog(
            quoteItems,
            topLevelTerms,
            dbServicesForResolution,
          );
          quoteItems.length = 0;
          quoteItems.push(...hydrated.items);
          topLevelTerms = hydrated.termsAndConditions;
          hydratedFromDb = hydrated.hydratedFromDb;
          console.log('🔍 [T&C-Debug] hydratedFromDb:', hydratedFromDb, '| topLevelTerms preview:', topLevelTerms.slice(0, 120));
        }

        const hasItemTerms = quoteItems.some((i) => i.termsAndConditions?.trim());
        const hasAnyTerms = !!(topLevelTerms.trim() || hasItemTerms);

        // Use standard business terms for rate card images; DB terms for proposals
        let finalTermsAndConditions: string;

        if (isRateCardImage) {
          finalTermsAndConditions = DEFAULT_GENERAL_TERMS.join('\n');
          console.log('✅ Using DEFAULT_GENERAL_TERMS for image rate card');
        } else if (hydratedFromDb) {
          finalTermsAndConditions = topLevelTerms;
          console.log(
            hasItemTerms
              ? '📋 Using DB metadata terms (per-service on items + general on quote)'
              : `📋 Using DB metadata terms (${topLevelTerms.split('\n').length} lines on quote)`,
          );
        } else {
          const { isRateCardFootnoteText } = await import('../../utils/termsHydration');
          if (isRateCardFootnoteText(topLevelTerms)) {
            finalTermsAndConditions = DEFAULT_GENERAL_TERMS.join('\n');
            console.log('⚠️ Detected rate card footnotes in T&C, using DEFAULT_GENERAL_TERMS instead');
          } else if (topLevelTerms.trim()) {
            finalTermsAndConditions = topLevelTerms;
            console.log('✅ Using Gemini-extracted T&C (no DB metadata match)');
          } else if (hasAnyTerms) {
            finalTermsAndConditions = '';
          } else {
            finalTermsAndConditions = DEFAULT_GENERAL_TERMS.join('\n');
            console.log('✅ Using DEFAULT_GENERAL_TERMS (no T&C from DB or AI)');
          }
        }
        
        const quote: Quote = {
          id: Date.now().toString(),
          quoteNumber: `QT-${Date.now().toString().slice(-6)}`,
          date: new Date().toISOString(),
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          items: quoteItems,
          subtotal,
          gstEnabled: true,
          gstPercentage,
          gstAmount,
          total: subtotal + gstAmount,
          deliveryTimeline: response.quoteData.deliveryTimeline || '7 working days after payment',
          termsAndConditions: finalTermsAndConditions,
          notes: response.quoteData.notes,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        // Post-Gemini min-qty check against DB metadata (cloud source of truth).
        if (!isQtyOverride && dbServicesForResolution.length > 0) {
          const minViolations = validateQuoteItemsAgainstDbMinQty(quoteItems, dbServicesForResolution);
          if (minViolations.length > 0) {
            console.log('⚠️ [MinQty-DB] Below minimum:', minViolations);
            setMinQtyWarning({ items: minViolations, pendingQuote: quote });
            setIsLoading(false);
            return;
          }
        }

        setCurrentQuote(quote);

        // Refresh cloud page cache so preview direct-lookup has latest images + review metadata
        loadCloudServices().catch((err) => {
          console.warn('⚠️ Could not refresh cloud services after quote:', err);
        });
        
        // Show success message before navigating
        const quoteReadyMessage: Message = {
          id: (Date.now() + 2).toString(),
          role: 'assistant',
          content: '✓ Your Quote generated successfully!',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, quoteReadyMessage]);

        // Auto-navigate to quote page after a brief delay
        setTimeout(() => {
          history.push('/quote');
        }, 1500);
      } else {
        // Regular (non-quote) assistant response — show in chat
        setMessages(prev => [...prev, assistantMessage]);
      }
    } catch (err: any) {
      console.error('Chat error:', err);
      setError(err.message || 'Failed to send message');
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: err.message || 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
        isError: true,
        failedInput: text, // Store the original input for retry
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // Retry handler: resend a failed message
  const handleRetry = (messageId: string) => {
    const message = messages.find(m => m.id === messageId);
    if (!message || !message.failedInput) return;
    
    // Set the input value and send
    sendMessageWithContent(message.failedInput);
  };

  // Find the activeProposal whose fileName contains the given city name
  // Toggle a city on/off for a segment (multi-select)
  const handleCitySelection = (segmentIdx: number, city: string) => {
    setCityPickerState(prev => {
      if (!prev) return prev;
      const newSegments = [...prev.segments];
      const seg = newSegments[segmentIdx];
      const alreadySelected = seg.selectedCities.includes(city);
      newSegments[segmentIdx] = {
        ...seg,
        selectedCities: alreadySelected
          ? seg.selectedCities.filter(c => c !== city)
          : [...seg.selectedCities, city],
      };
      return { ...prev, segments: newSegments };
    });
  };

  // Select-all / Clear-all toggle for a city-picker segment
  const handleCitySelectAll = (segmentIdx: number, cities: string[]) => {
    setCityPickerState(prev => {
      if (!prev) return prev;
      const newSegments = [...prev.segments];
      const seg = newSegments[segmentIdx];
      const allSelected = cities.length > 0 && cities.every(c => seg.selectedCities.includes(c));
      newSegments[segmentIdx] = {
        ...seg,
        selectedCities: allSelected ? [] : [...cities],
      };
      return { ...prev, segments: newSegments };
    });
  };

  // Select-all / Clear-all toggle for a service group inside the multi-match UI
  const handleServiceSelectAll = (messageId: string, groupKey: string, serviceNames: string[]) => {
    setSelectedServices(prev => {
      const messageMap = { ...(prev[messageId] || {}) };
      const current = messageMap[groupKey] || [];
      const allSelected = serviceNames.length > 0 && serviceNames.every(n => current.includes(n));
      if (allSelected) {
        // Clear all in this group
        const next = { ...messageMap };
        delete next[groupKey];
        return { ...prev, [messageId]: next };
      }
      messageMap[groupKey] = [...serviceNames];
      return { ...prev, [messageId]: messageMap };
    });
  };

  // Confirm city selections → show city-scoped service checkboxes → confirm → min qty → Gemini
  const handleCityConfirm = async () => {
    if (!cityPickerState) return;
    const pickerSnapshot = cityPickerState;

    const pairs: Array<{ raw: string; city: string; qty: number }> = [];
    pickerSnapshot.segments.forEach(seg => {
      if (seg.cityNeeded && seg.selectedCities.length === 0) return;
      const cities = seg.cityNeeded
        ? seg.selectedCities
        : (seg.detectedCity ? [seg.detectedCity] : [pickerSnapshot.availableCities[0]]);
      const qtyMatch = seg.raw.match(/(\d+)/);
      const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
      cities.forEach(city => pairs.push({ raw: seg.raw, city, qty }));
    });

    const groupedServices: Array<{
      vehicleType: string;
      requestedQuantity: number;
      services: Array<{ name: string; category: string }>;
    }> = [];
    const directParts: string[] = [];
    const missingServiceAlerts: Array<{ city: string; service: string }> = [];
    let needsGemini = false;

    const isVagueFlow =
      pickerSnapshot.requireServiceSelection ||
      isVagueCategoryQuery(pickerSnapshot.originalMessage);

    let dbServices: DbService[] = pickerSnapshot.dbServices || [];
    if (USE_CLOUD_DATA && dbServices.length === 0) {
      try {
        const { loadAllServicesFromCloud } = await import('../../services/supabaseProposalService');
        dbServices = (await loadAllServicesFromCloud()) || [];
      } catch (err) {
        console.warn('⚠️ handleCityConfirm: DB load failed', err);
      }
    }

    for (const pair of pairs) {
      const cityKey = KNOWN_CITY_LIST.find(c => pair.city.toLowerCase().includes(c)) || pair.city.toLowerCase();
      const cityLabel = pair.city.charAt(0).toUpperCase() + pair.city.slice(1);

      // Cloud / DB-first path — validate service exists in selected city
      if (USE_CLOUD_DATA && dbServices.length > 0) {
        const group = buildGroupedServicesFromDb(pair.raw, pair.city, pair.qty, dbServices);
        if (group) {
          if (isVagueFlow || group.services.length > 1) {
            groupedServices.push(group);
            continue;
          }
          directParts.push(`${pair.qty} ${group.services[0].name} ${cityLabel}`);
          continue;
        }
        const svcWord = pair.raw.replace(/\d+/g, '').trim() || pair.raw;
        missingServiceAlerts.push({ city: cityLabel, service: svcWord });
        continue;
      }

      // DB path for vague flows without USE_CLOUD_DATA flag
      if (isVagueFlow && dbServices.length > 0) {
        const group = buildGroupedServicesFromDb(pair.raw, pair.city, pair.qty, dbServices);
        if (group) {
          groupedServices.push(group);
          continue;
        }
        const svcWord = pair.raw.replace(/\d+/g, '').trim() || pair.raw;
        missingServiceAlerts.push({ city: cityLabel, service: svcWord });
        continue;
      }

      const regCheck = checkServiceInRegistry(cityKey, pair.raw);

      if (regCheck.result === 'not_found') {
        const svcLabel = pair.raw
          .replace(/\d+/g, '')
          .replace(/\b(need|for|the|a|an|in|at|of)\b/gi, '')
          .replace(/\s+/g, ' ').trim()
          .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        missingServiceAlerts.push({ city: cityLabel, service: svcLabel });
        continue;
      }

      if (regCheck.result === 'registry_unavailable') {
        if (dbServices.length > 0) {
          const group = buildGroupedServicesFromDb(pair.raw, pair.city, pair.qty, dbServices);
          if (group) {
            if (isVagueFlow || group.services.length > 1) {
              groupedServices.push(group);
            } else {
              directParts.push(`${pair.qty} ${group.services[0].name} ${cityLabel}`);
            }
            continue;
          }
        }
        if (isVagueFlow) {
          missingServiceAlerts.push({ city: cityLabel, service: pair.raw.trim() });
          continue;
        }
        needsGemini = true;
        continue;
      }

      const matchedSvc = regCheck.matchedService!;
      const registryEntry = cityServiceRegistry.current.get(cityKey);
      const baseWord = matchedSvc.toLowerCase().split(' ')[0];
      const relatedServices = registryEntry
        ? registryEntry.services
            .filter(s => new RegExp(`\\b${baseWord}\\b`, 'i').test(s))
            .map(s => ({
              name: s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
              category: matchedSvc.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
            }))
        : [{ name: matchedSvc.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '), category: matchedSvc }];

      const matchedWords = matchedSvc.toLowerCase().split(/\s+/);
      const userServiceWords = pair.raw
        .toLowerCase()
        .replace(new RegExp(`\\b${cityKey}\\b`, 'gi'), '')
        .replace(/\d+/g, '')
        .replace(/\b(need|for|the|a|an|in|at|of|and|i|want|please|services?|ads?|advertising|outdoor|some|any)\b/gi, '')
        .replace(/\s+/g, ' ').trim()
        .split(/\s+/).filter(w => w.length >= 2);

      const isUnique = relatedServices.length === 1;
      const isWordSpecific = userServiceWords.length >= matchedWords.length &&
        userServiceWords.every(w => matchedWords.some(mw => mw.startsWith(w) || w.startsWith(mw)));
      const isSpecific = !isVagueFlow && (isUnique || isWordSpecific);

      if (isSpecific) {
        const svcTitleCase = matchedSvc.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        directParts.push(`${pair.qty} ${svcTitleCase} ${cityLabel}`);
        continue;
      }

      const vehicleLabel = matchedSvc.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      groupedServices.push({
        vehicleType: `${vehicleLabel}|${cityLabel}`,
        requestedQuantity: pair.qty,
        services: relatedServices,
      });
    }

    if (missingServiceAlerts.length > 0) {
      setUnavailableServices(missingServiceAlerts);
      if (directParts.length === 0 && groupedServices.length === 0) {
        setCityPickerState(null);
        setInputValue('');
        return;
      }
      if (directParts.length > 0) {
        const durationMatch = pickerSnapshot.originalMessage.match(/(\d+)\s*(days?|months?)/i);
        const durationSuffix = durationMatch ? ` for ${durationMatch[0]}` : '';
        setPendingValidMessage(`Generate quote for ${directParts.join(' and ')}${durationSuffix} [User has already specified complete service names from checkboxes]`);
      }
    }

    setCityPickerState(null);
    setInputValue('');

    const cityPickerSnapshot = {
      originalMessage: pickerSnapshot.originalMessage,
      segments: pickerSnapshot.segments,
      availableCities: pickerSnapshot.availableCities,
    };

    if (isVagueFlow && groupedServices.length > 0) {
      const msgId = (Date.now() + 1).toString();
      const assistantMsg: Message = {
        id: msgId,
        role: 'assistant',
        content: groupedServices.length === 1
          ? `🔀 Multiple services found in ${groupedServices[0].vehicleType.split('|')[1] || 'your city'}. Select all you need:`
          : `🔀 Multiple services found across ${groupedServices.length} groups. Select all you need:`,
        timestamp: new Date(),
        isMultipleMatch: true,
        groupedServices,
        originalUserInput: pickerSnapshot.originalMessage,
        directParts,
        cityPickerSnapshot,
      };
      setMessages(prev => [...prev, assistantMsg]);
      return;
    }

    if (directParts.length > 0 && groupedServices.length === 0 && !needsGemini) {
      const confirmRows = labelsToConfirmRows(directParts as string[]);
      if (confirmRows.length > 0) {
        void executeConfirmedGeneration(confirmRows, pickerSnapshot.originalMessage, '');
        return;
      }
      const durationMatch = pickerSnapshot.originalMessage.match(/(\d+)\s*(days?|months?)/i);
      const durationSuffix = durationMatch ? ` for ${durationMatch[0]}` : '';
      const combined = `Generate quote for ${directParts.join(' and ')}${durationSuffix} [User has already specified complete service names from checkboxes]`;
      pushToHistory(`Generate quote for ${directParts.join(' and ')}${durationSuffix}`);
      sendMessageWithContent(combined);
      return;
    }

    if (needsGemini || (groupedServices.length === 0 && missingServiceAlerts.length === 0 && !isVagueFlow)) {
      if (USE_CLOUD_DATA && dbServices.length > 0 && pairs.length > 0) {
        const fallbackRows = dedupeConfirmationRows(
          pairs.map((p) => ({
            service: p.raw.replace(/\d+/g, '').trim(),
            qty: p.qty,
            city: p.city,
          })),
        );
          void executeConfirmedGeneration(fallbackRows, pickerSnapshot.originalMessage, '');
        return;
      }
      const reconstructed = pairs.map(p => `${p.city} ${p.qty > 1 ? p.qty + ' ' : ''}${p.raw.replace(/\d+/g, '').trim()}`).join(' and ');
      sendMessageWithContent(reconstructed);
      return;
    }

    if (groupedServices.length === 0) return;

    const msgId = (Date.now() + 1).toString();
    const assistantMsg: Message = {
      id: msgId,
      role: 'assistant',
      content: `🔀 Multiple services found across ${groupedServices.length} group${groupedServices.length !== 1 ? 's' : ''}. Select all you need:`,
      timestamp: new Date(),
      isMultipleMatch: true,
      groupedServices,
      originalUserInput: pickerSnapshot.originalMessage,
      directParts,
      cityPickerSnapshot,
    };
    setMessages(prev => [...prev, assistantMsg]);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInputValue(suggestion);
  };

  // Back button on the multi-match checkbox UI: re-open the city picker
  // using the snapshot saved on the message, and remove the checkbox message.
  const handleBackToCityPicker = (messageId: string) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg?.cityPickerSnapshot) return;
    // Remove the multiple-match message and any prior assistant city-picker
    // message that triggered it (we'll show a fresh picker)
    setMessages(prev => prev.filter(m => m.id !== messageId && !m.isCityPicker));
    setSelectedServices(prev => {
      const next = { ...prev };
      delete next[messageId];
      return next;
    });
    const pickerMsgId = (Date.now() + 1).toString();
    const pickerMsg: Message = {
      id: pickerMsgId,
      role: 'assistant',
      content: '🏙️ Multiple city rate cards are loaded. Please select the city for each service below:',
      timestamp: new Date(),
      isCityPicker: true,
    };
    setMessages(prev => [...prev, pickerMsg]);
    setCityPickerState({
      messageId: pickerMsgId,
      originalMessage: msg.cityPickerSnapshot.originalMessage,
      segments: msg.cityPickerSnapshot.segments,
      availableCities: msg.cityPickerSnapshot.availableCities,
    });
  };

  // Handle closing the min qty warning modal
  const handleMinQtyClose = () => {
    setMinQtyWarning(null);
    setEditingItemIndex(null);
    setEditedQuantity('');
    setPendingConfirmGeneration(null);
  };

  // Handle edit icon click for a specific item
  const handleEditItemQuantity = (index: number) => {
    if (!minQtyWarning) return;
    setEditingItemIndex(index);
    setEditedQuantity(String(minQtyWarning.items[index].requested));
  };

  // Handle saving edited quantity
  const handleSaveEditedQuantity = (index: number) => {
    if (!minQtyWarning || editingItemIndex !== index) return;
    
    const newQty = parseInt(editedQuantity, 10);

    if (isNaN(newQty) || newQty <= 0) {
      return;
    }

    // Update the item's requested quantity in the list — keep modal open so user can see all items
    const updatedItems = minQtyWarning.items.map((item, i) =>
      i === index ? { ...item, requested: newQty } : item
    );

    setMinQtyWarning({ ...minQtyWarning, items: updatedItems });
    setEditingItemIndex(null);
    setEditedQuantity('');
  };

  // Handle canceling edit
  const handleCancelEdit = () => {
    setEditingItemIndex(null);
    setEditedQuantity('');
  };

  // Handle min qty warning: user chooses to continue with requested qty
  const handleMinQtyContinue = () => {
    if (!minQtyWarning) return;
    const pending = pendingValidMessage;
    const currentItems = minQtyWarning.items;
    const pendingQuote = minQtyWarning.pendingQuote;
    setMinQtyWarning(null);
    setEditingItemIndex(null);
    setEditedQuantity('');

    // Pre-Gemini path: pendingQuote is null — send pending FULL message to Gemini.
    if (!pendingQuote) {
      if (pendingConfirmGeneration) {
        const gen = pendingConfirmGeneration;
        const updatedRows = applyMinQtyToConfirmRows(gen.rows, currentItems, 'continue');
        setPendingConfirmGeneration(null);
        openConfirmationTable(gen.messageId, updatedRows, gen.originalUserInput);
        return;
      }
      if (pending) {
        const parsedRows = labelsToConfirmRows(
          pending.split(/\s+and\s+/i).map((s) => s.trim()).filter(Boolean),
        );
        if (parsedRows.length > 0) {
          const updatedRows = parsedRows.map((row) => {
            const match = currentItems.find(
              (it) =>
                it.description.toLowerCase().includes(row.service.toLowerCase()) &&
                (row.city === '—' || it.description.toLowerCase().includes(String(row.city).toLowerCase())),
            );
            return match ? { ...row, qty: match.requested } : row;
          });
          setPendingValidMessage(null);
          setPendingMinReplacedMessage(null);
          void executeConfirmedGeneration(updatedRows, '', '');
          return;
        }
        let rewrittenMsg = pending;
        currentItems.forEach((item) => {
          if (item.originalRequested !== item.requested) {
            rewrittenMsg = rewrittenMsg.replace(
              new RegExp(`\\b${item.originalRequested}\\b`),
              String(item.requested),
            );
          }
        });
        setPendingValidMessage(null);
        setPendingMinReplacedMessage(null);
        pushToHistory(rewrittenMsg.replace(/\s*\[User has already specified complete service names from checkboxes\]/g, '').replace(/\s*\[QTY_OVERRIDE\]/g, '').trim());
        sendMessageWithContent(`${rewrittenMsg} [User has already specified complete service names from checkboxes] [QTY_OVERRIDE]`);
      }
      return;
    }

    // Post-Gemini path: quote already generated by Gemini, update edited quantities then navigate
    const updatedQuote = { ...pendingQuote! };
    updatedQuote.items = updatedQuote.items.map(qItem => {
      const warningItem = currentItems.find(w =>
        qItem.description === w.description ||
        qItem.description.toLowerCase().includes(w.description.toLowerCase().split(' - ')[0]),
      );
      if (warningItem) {
        const duration = durationMultiplier(qItem);
        return { ...qItem, quantity: warningItem.requested, total: warningItem.requested * qItem.rate * duration };
      }
      return qItem;
    });
    const newSubtotal = updatedQuote.items.reduce((sum, i) => sum + i.total, 0);
    const newGst = newSubtotal * (updatedQuote.gstPercentage / 100);
    updatedQuote.subtotal = newSubtotal;
    updatedQuote.gstAmount = newGst;
    updatedQuote.total = newSubtotal + newGst;
    setCurrentQuote(updatedQuote);
    setTimeout(() => { history.push('/quote'); }, 1500);
  };

  // Handle min qty warning: user chooses to use minimum quantities
  const handleMinQtyUseMinimum = () => {
    if (!minQtyWarning) return;
    const pending = pendingValidMessage;
    const currentItems = minQtyWarning.items;
    const pendingQuote = minQtyWarning.pendingQuote;

    // Pre-Gemini path: pendingQuote is null — rewrite the pending message
    if (!pendingQuote) {
      setMinQtyWarning(null);
      setEditingItemIndex(null);
      setEditedQuantity('');
      if (pendingConfirmGeneration) {
        const gen = pendingConfirmGeneration;
        const updatedRows = applyMinQtyToConfirmRows(gen.rows, currentItems, 'minimum');
        setPendingConfirmGeneration(null);
        openConfirmationTable(gen.messageId, updatedRows, gen.originalUserInput);
        return;
      }
      if (pending) {
        const parsedRows = labelsToConfirmRows(
          pending.replace(/^generate\s+quote\s+for\s+/i, '').split(/\s+and\s+/i).map((s) => s.trim()).filter(Boolean),
        );
        if (parsedRows.length > 0) {
          const updatedRows = parsedRows.map((row) => {
            const match = currentItems.find(
              (it) =>
                it.description.toLowerCase().includes(row.service.toLowerCase()) &&
                (row.city === '—' || it.description.toLowerCase().includes(String(row.city).toLowerCase())),
            );
            return match ? { ...row, qty: match.minimum } : row;
          });
          setPendingValidMessage(null);
          setPendingMinReplacedMessage(null);
          void executeConfirmedGeneration(updatedRows, '', '');
          return;
        }
        let newMsg = pending;
        currentItems.forEach((item) => {
          const origQty = item.originalRequested;
          const useQty = item.requested !== item.originalRequested ? item.requested : item.minimum;
          newMsg = newMsg.replace(new RegExp(`\\b${origQty}\\b`), String(useQty));
        });
        setPendingValidMessage(null);
        setPendingMinReplacedMessage(null);
        pushToHistory(newMsg.replace(/\s*\[User has already specified complete service names from checkboxes\]/g, '').replace(/\s*\[QTY_OVERRIDE\]/g, '').trim());
        sendMessageWithContent(`${newMsg} [User has already specified complete service names from checkboxes] [QTY_OVERRIDE]`);
      }
      return;
    }

    // Post-Gemini path: update quote item quantities — use edited qty or minimum
    const updatedQuote = { ...pendingQuote };
    updatedQuote.items = updatedQuote.items.map(qItem => {
      const warningItem = currentItems.find(w =>
        qItem.description === w.description ||
        qItem.description.toLowerCase().includes(w.description.toLowerCase().split(' - ')[0]),
      );
      if (warningItem) {
        const useQty = warningItem.requested !== warningItem.originalRequested
          ? warningItem.requested
          : (warningItem.minimum);
        const duration = durationMultiplier(qItem);
        return { ...qItem, quantity: useQty, total: useQty * qItem.rate * duration };
      }
      return qItem;
    });
    const newSubtotal = updatedQuote.items.reduce((sum, i) => sum + i.total, 0);
    const newGst = newSubtotal * (updatedQuote.gstPercentage / 100);
    updatedQuote.subtotal = newSubtotal;
    updatedQuote.gstAmount = newGst;
    updatedQuote.total = newSubtotal + newGst;
    setCurrentQuote(updatedQuote);
    setMinQtyWarning(null);
    setEditingItemIndex(null);
    setEditedQuantity('');
    const quoteReadyMessage: Message = {
      id: (Date.now() + 2).toString(),
      role: 'assistant',
      content: '✓ Quote generated with minimum quantities! Redirecting to quote preview...',
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, quoteReadyMessage]);
    setTimeout(() => { history.push('/quote'); }, 1500);
  };

  // Handle clicking a service suggestion button (auto-sends as new message)
  const handleServiceSuggestionClick = (serviceName: string, isPartialMatch?: boolean, validServices?: string[]) => {
    // Extract the original quantity from the last user message if possible
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    let quantity = '';
    if (lastUserMsg) {
      const qtyMatch = lastUserMsg.content.match(/(\d+)\s/);
      if (qtyMatch) quantity = qtyMatch[1] + ' ';
    }
    
    // For partial match: combine valid services + replacement
    if (isPartialMatch && validServices && validServices.length > 0 && lastUserMsg) {
      // Extract ALL quantities from the original user message
      const allQtys = [...lastUserMsg.content.matchAll(/(\d+)/g)].map(m => m[1]);
      // Build combined quote: valid services from original + replacement for missing
      const validParts = validServices.map((svc, idx) => {
        const qty = allQtys[idx] || allQtys[0] || '';
        return `${qty} ${svc}`.trim();
      });
      // Use second quantity for replacement if available, otherwise first
      const replacementQty = allQtys.length > 1 ? allQtys[allQtys.length - 1] : (allQtys[0] || '');
      validParts.push(`${replacementQty} ${serviceName}`.trim());
      setInputValue(`Generate quote for ${validParts.join(' and ')}`);
    } else {
      setInputValue(`Generate quote for ${quantity}${serviceName}`);
    }
    
    // Auto-send after a brief tick so the input updates
    setTimeout(() => {
      const sendBtn = document.querySelector('[data-send-btn]') as HTMLButtonElement;
      if (sendBtn) sendBtn.click();
    }, 100);
  };

  // Handle checkbox selection for MULTIPLE_MATCH multi-select (now supports multiple per group)
  const handleServiceCheckbox = (messageId: string, groupKey: string, serviceName: string, isChecked: boolean) => {
    setSelectedServices(prev => {
      const newState = { ...prev };
      if (!newState[messageId]) newState[messageId] = {};
      const current = newState[messageId][groupKey] || [];
      if (isChecked) {
        newState[messageId][groupKey] = [...current, serviceName];
      } else {
        const updated = current.filter(s => s !== serviceName);
        if (updated.length === 0) {
          delete newState[messageId][groupKey];
        } else {
          newState[messageId][groupKey] = updated;
        }
      }
      if (Object.keys(newState[messageId]).length === 0) delete newState[messageId];
      return newState;
    });
  };

  // Build confirmation table rows from selected services (shared helper)
  const buildConfirmationRows = (
    messageId: string,
    groupedServices: any[],
  ): { rows: Array<{ service: string; qty: number | string; city: string }>; originalUserInput: string } | null => {
    const selected = selectedServices[messageId];
    const assistantMsg = messages.find(m => m.id === messageId);
    const hasSelected = selected && Object.keys(selected).length > 0;
    const hasDirectParts = !!assistantMsg?.directParts?.length;
    if (!hasSelected && !hasDirectParts) return null;

    const originalUserMsg = assistantMsg?.originalUserInput || '';
    const rows: Array<{ service: string; qty: number | string; city: string }> = [];

    groupedServices.forEach((group: { vehicleType: string; requestedQuantity: number }) => {
      const services = (selected && selected[group.vehicleType]) || [];
      services.forEach((svcName: string) => {
        const [, city] = group.vehicleType.includes('|')
          ? group.vehicleType.split('|')
          : [group.vehicleType, ''];
        rows.push({ service: svcName, qty: group.requestedQuantity || '—', city: city || '—' });
      });
    });

    if (assistantMsg?.directParts?.length) {
      (assistantMsg.directParts as string[]).forEach(part => {
        const cleaned = part.replace(/\s*⚠️.*$/u, '').trim();
        let m = cleaned.match(/^(\d+)\s+(.+?)\s*\(([^)]+)\)\s*$/);
        if (m) {
          rows.push({ service: m[2].trim(), qty: parseInt(m[1], 10), city: m[3].trim() });
          return;
        }
        m = cleaned.match(/^(\d+)\s+(.+?)\s+(\w+)$/);
        if (m) {
          rows.push({ service: m[2].trim(), qty: parseInt(m[1], 10), city: m[3].trim() });
          return;
        }
        rows.push({ service: cleaned || part, qty: 1, city: '—' });
      });
    }

    if (rows.length === 0) return null;
    return { rows: dedupeConfirmationRows(rows), originalUserInput: originalUserMsg };
  };

  const openConfirmationTable = (
    messageId: string,
    rows: Array<{ service: string; qty: number | string; city: string }>,
    originalUserInput: string,
  ) => {
    setConfirmationTable({
      messageId,
      rows: dedupeConfirmationRows(rows),
      originalUserInput,
    });
  };

  const applyMinQtyToConfirmRows = (
    rows: Array<{ service: string; qty: number | string; city: string }>,
    items: Array<{ description: string; requested: number; originalRequested: number; minimum: number }>,
    mode: 'continue' | 'minimum',
  ) => rows.map((row) => {
    const match = items.find(
      (it) =>
        it.description.toLowerCase().includes(row.service.toLowerCase()) &&
        (row.city === '—' || it.description.toLowerCase().includes(String(row.city).toLowerCase())),
    );
    if (!match) return row;
    const qty =
      mode === 'minimum'
        ? (match.requested !== match.originalRequested ? match.requested : match.minimum)
        : match.requested;
    return { ...row, qty };
  });

  /** Min qty runs BEFORE confirm table: pick services → min → confirm → quote */
  const runMinQtyGateBeforeConfirm = async (
    messageId: string,
    rows: Array<{ service: string; qty: number | string; city: string }>,
    originalUserInput: string,
  ) => {
    const deduped = dedupeConfirmationRows(rows);

    if (USE_CLOUD_DATA) {
      try {
        const { loadAllServicesFromCloud } = await import('../../services/supabaseProposalService');
        const dbServices = (await loadAllServicesFromCloud()) || [];
        const violations = validateConfirmationRowsMinQty(deduped, dbServices);
        if (violations.length > 0) {
          console.log('⚠️ [MinQty-PreConfirm] Below minimum before confirm table:', violations);
          setPendingConfirmGeneration({ rows: deduped, originalUserInput, messageId });
          setMinQtyWarning({ items: violations, pendingQuote: null });
          return;
        }
      } catch (err) {
        console.warn('⚠️ Min-qty pre-confirm check failed, showing confirm table:', err);
      }
    }

    openConfirmationTable(messageId, deduped, originalUserInput);
  };

  const handleShowConfirmation = async (messageId: string, groupedServices: any[]) => {
    const built = buildConfirmationRows(messageId, groupedServices);
    if (!built) return;
    await runMinQtyGateBeforeConfirm(messageId, built.rows, built.originalUserInput);
  };

  /** Build quote from DB after confirm — no Gemini on this path when cloud catalog is loaded. */
  const executeConfirmedGeneration = async (
    rows: Array<{ service: string; qty: number | string; city: string }>,
    originalUserInput: string,
    messageId: string,
  ) => {
    if (isLoading) return;

    const uniqueRows = dedupeConfirmationRows(rows);
    confirmedRowsRef.current = uniqueRows;

    const durationMatch = originalUserInput.match(/(\d+)\s*(days?|months?)/i);
    const durationSuffix = durationMatch ? ` for ${durationMatch[0]}` : '';

    const parts = uniqueRows.map(r =>
      r.city && r.city !== '—'
        ? `${r.qty} ${r.service} ${r.city}`
        : `${r.qty} ${r.service}`
    );

    const displayRequest = `Generate quote for ${parts.join(' and ')}${durationSuffix}`;
    console.log('🔧 [ConfirmedPipeline] Building quote from DB:', displayRequest);

    setSelectedServices(prev => {
      const newState = { ...prev };
      if (messageId) delete newState[messageId];
      return newState;
    });
    setInputValue('');
    pushToHistory(displayRequest);

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: displayRequest,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

    try {
      if (USE_CLOUD_DATA) {
        const { loadAllServicesFromCloud } = await import('../../services/supabaseProposalService');
        const { buildQuoteFromConfirmedRows } = await import('../../utils/buildQuoteFromConfirmedRows');
        const dbServices = (await loadAllServicesFromCloud()) || [];

        if (dbServices.length > 0) {
          const result = buildQuoteFromConfirmedRows(
            uniqueRows,
            dbServices,
            originalUserInput || displayRequest,
          );

          if (result.success) {
            const minViolations = validateQuoteItemsAgainstDbMinQty(result.quote.items, dbServices);
            if (minViolations.length > 0) {
              console.log('⚠️ [MinQty-DB] Below minimum after DB quote build:', minViolations);
              setMinQtyWarning({ items: minViolations, pendingQuote: result.quote });
              setIsLoading(false);
              return;
            }

            setCurrentQuote(result.quote);
            loadCloudServices().catch((err) => {
              console.warn('⚠️ Could not refresh cloud services after quote:', err);
            });

            const quoteReadyMessage: Message = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: '✓ Your Quote generated successfully!',
              timestamp: new Date(),
            };
            setMessages(prev => [...prev, quoteReadyMessage]);
            setTimeout(() => { history.push('/quote'); }, 1500);
            setIsLoading(false);
            return;
          }

          const failMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `Could not build quote from rate card: ${result.message}. Please verify the service exists in your uploaded proposals.`,
            timestamp: new Date(),
          };
          setMessages(prev => [...prev, failMsg]);
          setIsLoading(false);
          return;
        }
      }

      // Fallback when cloud catalog unavailable: legacy Gemini path
      const combinedRequest =
        `${displayRequest} [User has already specified complete service names from checkboxes]`;
      console.log('🔧 Confirmation → Gemini fallback:', combinedRequest);
      setMessages(prev => prev.filter(m => m.id !== userMessage.id));
      await sendMessageWithContent(combinedRequest);
    } catch (err: unknown) {
      console.error('❌ [ConfirmedPipeline] Quote build failed:', err);
      const errText = err instanceof Error ? err.message : 'Failed to generate quote';
      setError(errText);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Sorry, quote generation failed: ${errText}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
      setIsLoading(false);
    }
  };

  // Confirm table → generate quote (min qty already resolved before this step)
  const handleConfirmAndGenerate = () => {
    if (!confirmationTable) return;
    const { rows, originalUserInput, messageId } = confirmationTable;
    setConfirmationTable(null);
    void executeConfirmedGeneration(rows, originalUserInput, messageId);
  };



  // Initialize speech recognition for mobile using Capacitor plugin
  useEffect(() => {
    // Request permission on component mount for mobile
    if (Capacitor.isNativePlatform()) {
      SpeechRecognition.requestPermissions().catch(err => {
        console.warn('Microphone permission denied:', err);
      });
    }

    return () => {
      // Cleanup: stop any ongoing recognition
      if (Capacitor.isNativePlatform() && isRecording) {
        SpeechRecognition.stop().catch(() => {});
      }
    };
  }, []);

  // Toggle voice input - for both mobile (Capacitor) and web (fallback)
  const toggleVoiceInput = async () => {
    if (isRecording) {
      // Stop recording
      setIsRecording(false);
      if (Capacitor.isNativePlatform()) {
        try {
          await SpeechRecognition.stop();
        } catch (err) {
          console.error('Error stopping voice recognition:', err);
        }
      } else if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    } else {
      // Start recording
      setIsRecording(true);
      
      if (Capacitor.isNativePlatform()) {
        // Mobile: Use Capacitor Speech Recognition plugin
        try {
          // Check if speech recognition is available
          const available = await SpeechRecognition.available();
          if (!available.available) {
            throw new Error('Speech recognition not available on this device');
          }

          // Check and request permissions
          const permStatus = await SpeechRecognition.checkPermissions();
          if (permStatus.speechRecognition !== 'granted') {
            const permResult = await SpeechRecognition.requestPermissions();
            if (permResult.speechRecognition !== 'granted') {
              throw new Error('Microphone permission denied');
            }
          }

          // Start listening - Result comes back directly from this call
          const result = await SpeechRecognition.start({
            language: 'en-US',
            maxResults: 5,
            prompt: '🎤 Speak now...',
            partialResults: true,
            popup: true,
          });

          console.log('Speech recognition result:', result);

          // Extract the recognized text from the result
          if (result && result.matches && result.matches.length > 0) {
            const transcript = result.matches[0];
            console.log('Recognized text:', transcript);
            setInputValue(prev => prev + (prev ? ' ' : '') + transcript);
          } else {
            console.warn('No speech recognized');
          }
          
          setIsRecording(false);
        } catch (err: any) {
          console.error('Voice recognition error:', err);
          setIsRecording(false);
          
          // Only show error if it's not a user cancellation
          if (err.message && !err.message.toLowerCase().includes('cancel')) {
            const errorMessage: Message = {
              id: Date.now().toString(),
              role: 'assistant',
              content: `Voice input error: ${err.message || 'Could not access microphone'}`,
              timestamp: new Date(),
              isError: true,
            };
            setMessages(prev => [...prev, errorMessage]);
          }
        }
      } else {
        // Web fallback: Use Web Speech API
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
          const SpeechRecognitionAPI = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
          const recognition = new SpeechRecognitionAPI();
          recognition.continuous = false;
          recognition.interimResults = false;
          recognition.lang = 'en-US';

          recognition.onresult = (event: any) => {
            const transcript = event.results[0][0].transcript;
            setInputValue(prev => prev + (prev ? ' ' : '') + transcript);
            setIsRecording(false);
          };

          recognition.onerror = (event: any) => {
            console.error('Speech recognition error:', event.error);
            setIsRecording(false);
          };

          recognition.onend = () => {
            setIsRecording(false);
          };

          recognitionRef.current = recognition;
          recognition.start();
        } else {
          setIsRecording(false);
          const errorMessage: Message = {
            id: Date.now().toString(),
            role: 'assistant',
            content: 'Voice input is not supported in this browser.',
            timestamp: new Date(),
            isError: true,
          };
          setMessages(prev => [...prev, errorMessage]);
        }
      }
    }
  };

  return (
    <Box
      display="flex"
      flexDirection="column"
      h="100%"
      w="100%"
      borderRadius="14px"
      border="1px solid"
      borderColor="gray.200"
      bg="white"
    >
      {/* Header - AI Assistant with Online Status */}
      <HStack
        justify="space-between"
        align="center"
        px={5}
        py={4}
        bgGradient="linear(90deg, gray.900, #1A1A2E)"
        flexShrink={0}
      >
        <HStack spacing={2}>
          <Box
            bgGradient="linear(135deg, purple.500, red.600)"
            color="white"
            w="32px"
            h="32px"
            borderRadius="8px"
            display="flex"
            alignItems="center"
            justifyContent="center"
            fontSize="sm"
            fontWeight="700"
          >
            G
          </Box>
          <Text fontSize="md" fontWeight="600" color="white">
            Quote Assistant
          </Text>
        </HStack>
        <HStack spacing={1}>
          <Box 
            w="8px" 
            h="8px" 
            borderRadius="full" 
            bg="teal.400"
            sx={{
              animation: 'pulse 2s infinite',
              '@keyframes pulse': {
                '0%,100%': { opacity: 1 },
                '50%': { opacity: 0.4 },
              },
            }}
          />
          <Text fontSize="xs" color="teal.400" fontWeight="500">
            Online
          </Text>
        </HStack>
      </HStack>

      {/* Content Area - Flexible Container */}
      <VStack align="stretch" spacing={4} flex={1} p={4} minH={0}>
        {/* Suggestion Chips */}
        {messages.length === 0 && (
          <Box px={2}>
            <Text fontSize="xs" fontWeight="500" color="gray.500" mb={2}>
              Try asking:
            </Text>
            <VStack align="stretch" spacing={2}>
              {SUGGESTION_PROMPTS.map((prompt, index) => (
                <Button
                  key={index}
                  variant="outline"
                  borderColor="gray.300"
                  color="gray.700"
                  size="sm"
                  justifyContent="flex-start"
                  textAlign="left"
                  whiteSpace="normal"
                  h="auto"
                  py={2}
                  px={3}
                  borderRadius="full"
                  fontWeight="400"
                  fontSize="11px"
                  onClick={() => handleSuggestionClick(prompt)}
                  _hover={{
                    bg: 'red.50',
                    borderColor: 'red.500',
                    color: 'red.600',
                  }}
                >
                  {prompt}
                </Button>
              ))}
            </VStack>
          </Box>
        )}

        {/* AI Response Output Area */}
        <Box
          flex={1}
          bg="gray.50"
          borderRadius="lg"
          p={{ base: 3, md: 3 }}
          overflowY="auto"
          minH="0"
          sx={{ 
            '::-webkit-scrollbar': { 
              width: '6px',
            },
            '::-webkit-scrollbar-track': {
              background: 'transparent',
            },
            '::-webkit-scrollbar-thumb': {
              background: 'gray.300',
              borderRadius: '3px',
            },
          }}
        >
          {messages.length === 0 ? (
            <Flex justify="center" align="center" h="full">
              <Text color="gray.400" fontSize="xs" textAlign="center" px={4}>
                {proposal.textContent
                  ? 'Ask me anything about your uploaded proposals.'
                  : 'Ask general questions or upload documents for custom quotes.'}
              </Text>
            </Flex>
          ) : (
            <VStack align="stretch" spacing={5}>
              {messages.map(message => {
                return (
                  <Box
                    key={message.id}
                    alignSelf={message.role === 'user' ? 'flex-end' : 'flex-start'}
                    maxW={message.role === 'user' ? '80%' : '90%'}
                  >
                    <Box>
                        {!message.isCityPicker && !message.isMultipleMatch && <Box>
                          <Box
                            bgGradient={message.role === 'user' 
                              ? 'linear(135deg, #dc2626 0%, #be123c 50%, #9f1239 100%)' 
                              : undefined
                            }
                            bg={message.role === 'user' ? undefined : (message.isError ? 'red.50' : 'white')}
                            border={message.role === 'user' ? 'none' : '1px solid'}
                            borderColor={message.role === 'user' ? undefined : (message.isError ? 'red.300' : 'gray.200')}
                            color={message.role === 'user' ? 'white' : (message.isError ? 'red.700' : 'gray.800')}
                            px={{ base: 4, md: 5 }}
                            py={{ base: 3.5, md: 4 }}
                            borderRadius={message.role === 'user' ? '20px 20px 4px 20px' : '4px 16px 16px 16px'}
                            boxShadow={message.role === 'user' 
                              ? '0 8px 16px rgba(220, 38, 38, 0.25), 0 2px 4px rgba(220, 38, 38, 0.1)' 
                              : (message.isError ? '0 4px 12px rgba(239, 68, 68, 0.15)' : '0 4px 12px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.08)')
                            }
                          >
                            <HStack spacing={2} mb={message.isError ? 1 : 0}>
                              {message.isError && <Text fontSize="16px">❌</Text>}
                              <Text 
                                fontSize="14px" 
                                whiteSpace="pre-wrap"
                                lineHeight="1.6"
                                fontWeight={message.isError ? "600" : "500"}
                                flex={1}
                              >
                                {message.content}
                              </Text>
                            </HStack>
                            <Text
                              fontSize="11px"
                              mt={2}
                              opacity={message.role === 'user' ? 0.75 : 0.6}
                              fontWeight="500"
                              letterSpacing="tight"
                            >
                              {message.timestamp.toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </Text>
                          </Box>
                          
                          {/* Retry button for error messages */}
                          {message.isError && message.failedInput && (
                            <Button
                              mt={3}
                              size="sm"
                              colorScheme="red"
                              variant="solid"
                              onClick={() => handleRetry(message.id)}
                              isDisabled={isLoading}
                              leftIcon={<Text fontSize="14px">🔄</Text>}
                              _hover={{
                                transform: 'translateY(-1px)',
                                boxShadow: '0 4px 12px rgba(220, 38, 38, 0.3)',
                              }}
                              transition="all 0.2s ease"
                            >
                              Retry
                            </Button>
                          )}
                        </Box>}

                        {/* 2️⃣ MULTIPLE_MATCH - Show grouped services with checkboxes (multi-select per group) */}
                        {message.isMultipleMatch && message.groupedServices && message.groupedServices.length > 0 && (
                          <Box mt={3}>

                            {/* Back button — return to the city picker that produced this list */}
                            {message.cityPickerSnapshot && (
                              <Button
                                size="sm"
                                variant="outline"
                                colorScheme="gray"
                                mb={3}
                                onClick={() => handleBackToCityPicker(message.id)}
                              >
                                ← Back to city selection
                              </Button>
                            )}

                            {/* Already confirmed services (directParts) — shown as locked green items */}
                            {message.directParts && message.directParts.length > 0 && (
                              <Box mb={3} p={3} borderRadius="12px" bg="green.50" border="1px solid" borderColor="green.200">
                                <Text fontSize="12px" fontWeight="700" color="green.700" mb={2}>
                                  ✅ Already confirmed:
                                </Text>
                                <VStack align="stretch" spacing={1}>
                                  {message.directParts.map((part, pIdx) => (
                                    <Text key={pIdx} fontSize="13px" color="green.700" fontWeight="500">
                                      • {part}
                                    </Text>
                                  ))}
                                </VStack>
                              </Box>
                            )}

                            <VStack align="stretch" spacing={4}>
                              {message.groupedServices.map((group, gIdx) => {
                                const selectedForGroup = selectedServices[message.id]?.[group.vehicleType] || [];
                                const [vehiclePart, cityPart] = group.vehicleType.includes('|')
                                  ? group.vehicleType.split('|')
                                  : [group.vehicleType, null];
                                const groupServiceNames = group.services.map(s => s.name);
                                const allInGroupSelected = groupServiceNames.length > 0 && groupServiceNames.every(n => selectedForGroup.includes(n));
                                return (
                                  <Box key={gIdx}>
                                    <HStack mb={2} px={1} spacing={2} align="center" justify="space-between">
                                      <HStack spacing={2} align="center">
                                        <Text fontSize="13px" fontWeight="700" color="gray.700">
                                          {vehiclePart.split(' ')[0]} Services
                                        </Text>
                                        {cityPart && (
                                          <Box
                                            px={2}
                                            py={0.5}
                                            borderRadius="6px"
                                            bg="blue.50"
                                            border="1px solid"
                                            borderColor="blue.200"
                                          >
                                            <Text fontSize="11px" fontWeight="700" color="blue.600">
                                              📍 {cityPart}
                                            </Text>
                                          </Box>
                                        )}
                                      </HStack>
                                      <Button
                                        size="xs"
                                        variant="ghost"
                                        colorScheme="blue"
                                        onClick={() => handleServiceSelectAll(message.id, group.vehicleType, groupServiceNames)}
                                      >
                                        {allInGroupSelected ? 'Clear all' : 'Select all'}
                                      </Button>
                                    </HStack>
                                    <VStack align="stretch" spacing={2}>
                                      {group.services.map((svc, sIdx) => {
                                        const isChecked = selectedForGroup.includes(svc.name);
                                        return (
                                          <Box
                                            key={sIdx}
                                            p={3}
                                            borderRadius="12px"
                                            border="2px solid"
                                            borderColor={isChecked ? 'blue.400' : 'gray.200'}
                                            bg={isChecked ? 'blue.50' : 'white'}
                                            _hover={{
                                              borderColor: isChecked ? 'blue.500' : 'blue.300',
                                              bg: isChecked ? 'blue.100' : 'blue.25',
                                              transform: 'translateX(2px)',
                                            }}
                                            transition="all 0.2s ease"
                                          >
                                            <Checkbox
                                              isChecked={isChecked}
                                              onChange={(e) => handleServiceCheckbox(message.id, group.vehicleType, svc.name, e.target.checked)}
                                              colorScheme="blue"
                                              size="md"
                                              spacing={3}
                                              cursor="pointer"
                                            >
                                              <Text fontSize="13px" fontWeight="500" color={isChecked ? 'blue.700' : 'gray.700'}>
                                                {svc.name}
                                              </Text>
                                            </Checkbox>
                                          </Box>
                                        );
                                      })}
                                    </VStack>
                                  </Box>
                                );
                              })}
                            </VStack>

                            {/* Review button — show when ≥1 service selected OR directParts exist */}
                            {(selectedServices[message.id] && Object.keys(selectedServices[message.id]).length > 0) || (message.directParts && message.directParts.length > 0) ? (
                              <Button
                                mt={4}
                                w="full"
                                size="lg"
                                bgGradient="linear(135deg, #dc2626 0%, #be123c 50%, #9f1239 100%)"
                                color="white"
                                fontWeight="700"
                                fontSize="15px"
                                py={6}
                                borderRadius="14px"
                                onClick={() => { void handleShowConfirmation(message.id, message.groupedServices!); }}
                                isDisabled={isLoading}
                                _hover={{
                                  bgGradient: 'linear(135deg, #b91c1c 0%, #9f1239 50%, #881337 100%)',
                                  transform: 'translateY(-2px)',
                                  boxShadow: '0 12px 24px rgba(220, 38, 38, 0.3)',
                                }}
                                _active={{ transform: 'translateY(0)' }}
                                transition="all 0.2s ease"
                                leftIcon={<Icon as={FiCheck} boxSize="18px" />}
                              >
                                Review & Confirm ({
                                  Object.values(selectedServices[message.id] || {}).flat().length + (message.directParts?.length || 0)
                                } service{Object.values(selectedServices[message.id] || {}).flat().length + (message.directParts?.length || 0) !== 1 ? 's' : ''} selected)
                              </Button>
                            ) : null}
                          </Box>
                        )}

                        {/* 3️⃣ PARTIAL_MATCH - Show closest alternatives */}
                        {message.isPartialMatch && !message.isServiceNotFound && message.closestServices && message.closestServices.length > 0 && (
                          <Box mt={3}>
                            <Box mb={2} px={1}>
                              <Text fontSize="13px" fontWeight="600" color="red.500">
                                ❌ "{message.requestedService}" is not available
                              </Text>
                              <Text fontSize="12px" color="gray.600" mt={1}>
                                Did you mean one of these similar services?
                              </Text>
                            </Box>
                            <VStack align="stretch" spacing={2}>
                              <Box>
                                <Text fontSize="11px" fontWeight="700" color="green.600" textTransform="uppercase" letterSpacing="wider" mb={1} px={1}>
                                  Closest Matches
                                </Text>
                                <VStack align="stretch" spacing={1.5}>
                                  {message.closestServices.map((svc, idx) => (
                                    <Button
                                      key={idx}
                                      variant="outline"
                                      size="sm"
                                      justifyContent="flex-start"
                                      textAlign="left"
                                      whiteSpace="normal"
                                      h="auto"
                                      py={2.5}
                                      px={4}
                                      borderRadius="12px"
                                      fontWeight="500"
                                      fontSize="13px"
                                      borderColor="green.300"
                                      color="green.700"
                                      bg="green.50"
                                      onClick={() => {
                                        const qty = message.requestedQuantity || '';
                                        const text = qty ? `${qty} ${svc.name}` : svc.name;
                                        setInputValue(text);
                                      }}
                                      isDisabled={isLoading}
                                      _hover={{
                                        bg: 'green.100',
                                        borderColor: 'green.500',
                                        transform: 'translateX(4px)',
                                        boxShadow: '0 2px 8px rgba(34, 197, 94, 0.2)',
                                      }}
                                      transition="all 0.2s ease"
                                      leftIcon={<Text fontSize="14px">✓</Text>}
                                      rightIcon={svc.similarity === 'high' ? <Text fontSize="10px" fontWeight="700" color="green.600">HIGH</Text> : undefined}
                                    >
                                      {svc.name}
                                    </Button>
                                  ))}
                                </VStack>
                              </Box>
                              {message.alternativeServices && message.alternativeServices.length > 0 && (
                                <Box>
                                  <Text fontSize="11px" fontWeight="700" color="blue.500" textTransform="uppercase" letterSpacing="wider" mb={1} px={1}>
                                    Other Options
                                  </Text>
                                  <VStack align="stretch" spacing={1.5}>
                                    {message.alternativeServices.map((svc, idx) => (
                                      <Button
                                        key={idx}
                                        variant="outline"
                                        size="sm"
                                        justifyContent="flex-start"
                                        textAlign="left"
                                        whiteSpace="normal"
                                        h="auto"
                                        py={2.5}
                                        px={4}
                                        borderRadius="12px"
                                        fontWeight="500"
                                        fontSize="13px"
                                        borderColor="blue.200"
                                        color="blue.700"
                                        bg="blue.50"
                                        onClick={() => {
                                          const qty = message.requestedQuantity || '';
                                          const text = qty ? `${qty} ${svc.name}` : svc.name;
                                          setInputValue(text);
                                        }}
                                        isDisabled={isLoading}
                                        _hover={{
                                          bg: 'blue.100',
                                          borderColor: 'blue.400',
                                          transform: 'translateX(4px)',
                                          boxShadow: '0 2px 8px rgba(59, 130, 246, 0.2)',
                                        }}
                                        transition="all 0.2s ease"
                                        leftIcon={<Text fontSize="14px">→</Text>}
                                      >
                                        {svc.name}
                                      </Button>
                                    ))}
                                  </VStack>
                                </Box>
                              )}
                            </VStack>
                          </Box>
                        )}

                        {/* 4️⃣ NO_MATCH - Show all services organized by category */}
                        {message.isNoMatch && message.allServicesGrouped && message.allServicesGrouped.length > 0 && (
                          <Box mt={3}>
                            <Box mb={2} px={1}>
                              <Text fontSize="13px" fontWeight="600" color="red.500">
                                ❌ We don't offer {message.requestedService}
                              </Text>
                              <Text fontSize="12px" color="gray.600" mt={1}>
                                Browse all our available services:
                              </Text>
                            </Box>
                            <VStack align="stretch" spacing={3}>
                              {message.allServicesGrouped.map((catGroup, cIdx) => (
                                <Box key={cIdx}>
                                  <Text fontSize="11px" fontWeight="700" color="gray.500" textTransform="uppercase" letterSpacing="wider" mb={1.5} px={1}>
                                    {catGroup.category}
                                  </Text>
                                  <VStack align="stretch" spacing={1.5}>
                                    {catGroup.services.map((svc, sIdx) => (
                                      <Button
                                        key={sIdx}
                                        variant="outline"
                                        size="sm"
                                        justifyContent="flex-start"
                                        textAlign="left"
                                        whiteSpace="normal"
                                        h="auto"
                                        py={2.5}
                                        px={4}
                                        borderRadius="12px"
                                        fontWeight="500"
                                        fontSize="13px"
                                        borderColor="gray.300"
                                        color="gray.700"
                                        bg="gray.50"
                                        onClick={() => setInputValue(svc.name)}
                                        isDisabled={isLoading}
                                        _hover={{
                                          bg: 'gray.100',
                                          borderColor: 'gray.400',
                                          transform: 'translateX(4px)',
                                          boxShadow: '0 2px 8px rgba(107, 114, 128, 0.2)',
                                        }}
                                        transition="all 0.2s ease"
                                        leftIcon={<Text fontSize="14px">→</Text>}
                                      >
                                        {svc.name}
                                      </Button>
                                    ))}
                                  </VStack>
                                </Box>
                              ))}
                            </VStack>
                          </Box>
                        )}

                        {/* 📚 RAG SEARCH RESULTS — show matching services from vector database */}
                        {message.isRagSearchResult && message.ragResults && message.ragResults.length > 0 && (
                          <Box mt={3}>
                            <Text fontSize="13px" fontWeight="600" color="purple.600" mb={3}>
                              📚 Found {message.ragResults.length} matching services:
                            </Text>
                            <VStack align="stretch" spacing={3}>
                              {message.ragResults.map((result, idx) => {
                                const similarity = (result.similarity * 100).toFixed(1);
                                const images = result.metadata?.images || [];
                                
                                return (
                                  <Box
                                    key={idx}
                                    p={4}
                                    bg="purple.50"
                                    borderRadius="12px"
                                    border="1px solid"
                                    borderColor="purple.200"
                                    _hover={{
                                      bg: 'purple.100',
                                      borderColor: 'purple.300',
                                      transform: 'translateX(4px)',
                                      boxShadow: '0 4px 12px rgba(139, 92, 246, 0.2)',
                                    }}
                                    transition="all 0.2s ease"
                                  >
                                    <HStack justify="space-between" mb={2}>
                                      <Text fontSize="15px" fontWeight="600" color="purple.700">
                                        {idx + 1}. {result.service_name}
                                      </Text>
                                      <Text fontSize="12px" fontWeight="600" color="purple.600" bg="purple.100" px={2} py={1} borderRadius="full">
                                        {similarity}% match
                                      </Text>
                                    </HStack>
                                    
                                    {/* Image Gallery - show if images exist */}
                                    {images.length > 0 && (
                                      <Box mb={3} overflowX="auto" css={{ '&::-webkit-scrollbar': { height: '6px' }, '&::-webkit-scrollbar-thumb': { background: '#9333ea', borderRadius: '3px' } }}>
                                        <HStack spacing={2} pb={2}>
                                          {images.map((imgUrl: string, imgIdx: number) => (
                                            <Box
                                              key={imgIdx}
                                              position="relative"
                                              flexShrink={0}
                                              w="120px"
                                              h="120px"
                                              borderRadius="8px"
                                              overflow="hidden"
                                              border="2px solid"
                                              borderColor="purple.300"
                                              bg="white"
                                              cursor="pointer"
                                              _hover={{
                                                borderColor: 'purple.500',
                                                transform: 'scale(1.05)',
                                              }}
                                              transition="all 0.2s ease"
                                              onClick={() => window.open(imgUrl, '_blank')}
                                            >
                                              <img
                                                src={imgUrl}
                                                alt={`${result.service_name} - Image ${imgIdx + 1}`}
                                                style={{
                                                  width: '100%',
                                                  height: '100%',
                                                  objectFit: 'cover',
                                                }}
                                                onError={(e) => {
                                                  (e.target as HTMLImageElement).style.display = 'none';
                                                }}
                                              />
                                            </Box>
                                          ))}
                                        </HStack>
                                      </Box>
                                    )}
                                    
                                    <Text fontSize="13px" color="gray.700" mb={3}>
                                      {result.content.substring(0, 250)}
                                      {result.content.length > 250 ? '...' : ''}
                                    </Text>
                                    <Button
                                      size="sm"
                                      colorScheme="purple"
                                      onClick={() => {
                                        // Include the full service content (with pricing) in the prompt
                                        const promptWithPricing = `Generate quote for ${result.service_name}

Use EXACTLY these pricing details from our rate card:
${result.content}

Generate a detailed quote based on the above information.`;
                                        
                                        setInputValue(promptWithPricing);
                                        setTimeout(() => {
                                          const sendBtn = document.querySelector('[data-send-btn]') as HTMLButtonElement;
                                          sendBtn?.click();
                                        }, 100);
                                      }}
                                      isDisabled={isLoading}
                                    >
                                      Generate Quote
                                    </Button>
                                  </Box>
                                );
                              })}
                            </VStack>
                          </Box>
                        )}

                        {/* 🏙️ CITY-ONLY QUERY — show all services for the typed city, multi-select */}
                        {message.isCityServiceList && message.cityServiceList && message.cityServiceList.length > 0 && (() => {
                          const selection = cityServiceSelection[message.id] || {};
                          const selectedCount = Object.keys(selection).length;
                          const updateSelection = (next: Record<string, number>) => {
                            setCityServiceSelection(prev => ({ ...prev, [message.id]: next }));
                          };
                          const toggle = (key: string, defaultQty: number) => {
                            const next = { ...selection };
                            if (key in next) delete next[key]; else next[key] = defaultQty;
                            updateSelection(next);
                          };
                          const setQty = (key: string, qty: number) => {
                            if (!Number.isFinite(qty) || qty < 1) qty = 1;
                            updateSelection({ ...selection, [key]: qty });
                          };
                          const handleGenerate = () => {
                            const parts: string[] = [];
                            for (const [key, qty] of Object.entries(selection)) {
                              const [city, ...rest] = key.split('|');
                              const svcName = rest.join('|');
                              parts.push(`${qty} ${svcName} in ${city}`);
                            }
                            if (parts.length === 0) return;
                            const prompt = `Generate quote for ${parts.join(' and ')}`;
                            setInputValue(prompt);
                            setCityServiceSelection(prev => {
                              const cp = { ...prev }; delete cp[message.id]; return cp;
                            });
                            setTimeout(() => {
                              const sendBtn = document.querySelector('[data-send-btn]') as HTMLButtonElement;
                              sendBtn?.click();
                            }, 100);
                          };

                          return (
                            <Box mt={3}>
                              <VStack align="stretch" spacing={4}>
                                {message.cityServiceList!.map((cityGroup, cIdx) => {
                                  const allKeys = cityGroup.services.map(s => `${cityGroup.city}|${s.name}`);
                                  const allSelected = allKeys.every(k => k in selection);
                                  const toggleAll = () => {
                                    const next = { ...selection };
                                    if (allSelected) {
                                      allKeys.forEach(k => { delete next[k]; });
                                    } else {
                                      cityGroup.services.forEach(s => {
                                        const k = `${cityGroup.city}|${s.name}`;
                                        if (!(k in next)) next[k] = s.minQty > 1 ? s.minQty : 1;
                                      });
                                    }
                                    updateSelection(next);
                                  };
                                  return (
                                    <Box key={cIdx}>
                                      <HStack mb={2} px={1} spacing={2} justify="space-between">
                                        <HStack spacing={2}>
                                          <Text fontSize="11px" fontWeight="700" color="blue.600" textTransform="uppercase" letterSpacing="wider">
                                            📍 {cityGroup.city}
                                          </Text>
                                          <Text fontSize="11px" color="gray.500">
                                            ({cityGroup.services.length} services)
                                          </Text>
                                        </HStack>
                                        <Button size="xs" variant="link" colorScheme="blue" onClick={toggleAll}>
                                          {allSelected ? 'Clear all' : 'Select all'}
                                        </Button>
                                      </HStack>
                                      <Box display="flex" flexWrap="wrap" gap={2}>
                                        {cityGroup.services.map((svc, sIdx) => {
                                          const key = `${cityGroup.city}|${svc.name}`;
                                          const isSelected = key in selection;
                                          const defaultQty = svc.minQty > 1 ? svc.minQty : 1;
                                          return (
                                            <Box
                                              key={sIdx}
                                              as="button"
                                              type="button"
                                              onClick={() => toggle(key, defaultQty)}
                                              borderWidth="1.5px"
                                              borderColor={isSelected ? 'blue.500' : 'gray.200'}
                                              bg={isSelected ? 'blue.50' : 'white'}
                                              borderRadius="12px"
                                              px={3}
                                              py={2}
                                              fontSize="12px"
                                              fontWeight="500"
                                              color="gray.800"
                                              textAlign="left"
                                              transition="all 0.15s ease"
                                              _hover={{ borderColor: 'blue.400', transform: 'translateY(-1px)' }}
                                            >
                                              <HStack spacing={2} align="center">
                                                <Box
                                                  w="16px"
                                                  h="16px"
                                                  borderRadius="4px"
                                                  borderWidth="1.5px"
                                                  borderColor={isSelected ? 'blue.500' : 'gray.300'}
                                                  bg={isSelected ? 'blue.500' : 'white'}
                                                  display="flex"
                                                  alignItems="center"
                                                  justifyContent="center"
                                                  flexShrink={0}
                                                >
                                                  {isSelected && <Icon as={FiCheck} boxSize="11px" color="white" />}
                                                </Box>
                                                <Text>{svc.name}</Text>
                                                {svc.minQty > 1 && (
                                                  <Text as="span" fontSize="10px" color="gray.500">
                                                    (min {svc.minQty})
                                                  </Text>
                                                )}
                                              </HStack>
                                              {isSelected && (
                                                <HStack mt={2} spacing={1} onClick={(e) => e.stopPropagation()}>
                                                  <Button size="xs" variant="outline" px={2} minW="24px" h="24px"
                                                    onClick={(e) => { e.stopPropagation(); setQty(key, (selection[key] || defaultQty) - 1); }}
                                                  >−</Button>
                                                  <Input
                                                    size="xs"
                                                    w="56px"
                                                    h="24px"
                                                    textAlign="center"
                                                    value={selection[key] ?? defaultQty}
                                                    onChange={(e) => setQty(key, parseInt(e.target.value) || 1)}
                                                    onClick={(e) => e.stopPropagation()}
                                                  />
                                                  <Button size="xs" variant="outline" px={2} minW="24px" h="24px"
                                                    onClick={(e) => { e.stopPropagation(); setQty(key, (selection[key] || defaultQty) + 1); }}
                                                  >+</Button>
                                                </HStack>
                                              )}
                                            </Box>
                                          );
                                        })}
                                      </Box>
                                    </Box>
                                  );
                                })}

                                <HStack spacing={3} justify="space-between" pt={2} borderTopWidth="1px" borderColor="gray.100">
                                  <Text fontSize="12px" color="gray.600" fontWeight="500">
                                    {selectedCount === 0
                                      ? 'Select one or more services to continue.'
                                      : `${selectedCount} service${selectedCount === 1 ? '' : 's'} selected`}
                                  </Text>
                                  <Button
                                    size="sm"
                                    bgGradient="linear(135deg, #dc2626 0%, #be123c 50%, #9f1239 100%)"
                                    color="white"
                                    fontWeight="700"
                                    borderRadius="8px"
                                    px={5}
                                    isDisabled={selectedCount === 0}
                                    leftIcon={<Icon as={FiCheck} boxSize="14px" />}
                                    onClick={handleGenerate}
                                    _hover={{ bgGradient: 'linear(135deg, #b91c1c 0%, #9f1239 100%)' }}
                                  >
                                    Generate Quote
                                  </Button>
                                </HStack>
                              </VStack>
                            </Box>
                          );
                        })()}

                        {/* 🏙️ CITY PICKER — service-first layout */}
                        {message.isCityPicker && cityPickerState && cityPickerState.messageId === message.id && (
                          <Box mt={3}>
                            <VStack align="stretch" spacing={4}>
                              {cityPickerState.segments.map((seg, segIdx) => {
                                // Build service label from the segment
                                const svcLabel = seg.raw
                                  .replace(/\d+/g, '')
                                  .replace(/\b(need|for|the|a|an|in|at|of|and|i|want|please)\b/gi, '')
                                  .replace(/\s+/g, ' ')
                                  .trim()
                                  .split(' ')
                                  .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                                  .join(' ');

                                // Use pre-computed matchedCities from city gate (strict classifier).
                                // Render-time fallback also stays strict — no registry_unavailable leak.
                                const citiesWithService = seg.matchedCities ?? cityPickerState.availableCities.filter(city => {
                                  const cityKey = KNOWN_CITY_LIST.find(c => city.toLowerCase().includes(c)) || city.toLowerCase();
                                  const cls = classifySegmentByRegistry(cityKey, seg.raw);
                                  return cls.state === 'specific' || cls.state === 'vague';
                                });

                                // Cities where registry explicitly says NOT available
                                const citiesWithoutService = cityPickerState.availableCities.filter(city => {
                                  if (citiesWithService.includes(city)) return false;
                                  const cityKey = KNOWN_CITY_LIST.find(c => city.toLowerCase().includes(c)) || city.toLowerCase();
                                  const cls = classifySegmentByRegistry(cityKey, seg.raw);
                                  return cls.state === 'not_found' || cls.state === 'empty';
                                });

                                const allCitiesSelected = citiesWithService.length > 0 && citiesWithService.every(c => seg.selectedCities.includes(c));
                                return (
                                  <Box key={segIdx} p={3} borderRadius="12px" bg="gray.50" border="1px solid" borderColor="gray.200">
                                    {/* Service header */}
                                    <HStack justify="space-between" align="center" mb={2}>
                                      <Text fontSize="13px" fontWeight="700" color="gray.800" textTransform="uppercase" letterSpacing="wider">
                                        {svcLabel}
                                      </Text>
                                      {seg.cityNeeded && citiesWithService.length > 1 && (
                                        <Button
                                          size="xs"
                                          variant="ghost"
                                          colorScheme="blue"
                                          onClick={() => handleCitySelectAll(segIdx, citiesWithService)}
                                          isDisabled={isLoading}
                                        >
                                          {allCitiesSelected ? 'Clear all' : 'Select all'}
                                        </Button>
                                      )}
                                    </HStack>

                                    {seg.detectedCity && !seg.cityNeeded ? (
                                      // Auto-assigned (only available in one city) — show as locked but visible
                                      <Box
                                        p={2.5}
                                        borderRadius="10px"
                                        border="2px solid"
                                        borderColor="green.300"
                                        bg="green.50"
                                      >
                                        <HStack justify="space-between">
                                          <Text fontSize="13px" fontWeight="600" color="green.700">
                                            ✅ Auto-assigned: <b>{seg.detectedCity}</b>
                                          </Text>
                                          <Text fontSize="11px" color="green.500">Only city available</Text>
                                        </HStack>
                                      </Box>
                                    ) : citiesWithService.length === 0 && citiesWithoutService.length > 0 ? (
                                      // All cities explicitly don't have it
                                      <Text fontSize="12px" color="orange.600" fontWeight="500">
                                        ⚠ Not available in any loaded city
                                      </Text>
                                    ) : (
                                      <VStack align="stretch" spacing={2}>
                                        {/* Only show cities where service is available (or registry unavailable = show with fallback) */}
                                        {citiesWithService.map((city, cIdx) => {
                                          const isSelected = seg.selectedCities.includes(city);
                                          // Get min qty hint from registry (strict classifier so "min 10"
                                          // never leaks in from an unrelated reverse-match).
                                          const cityKey = KNOWN_CITY_LIST.find(c => city.toLowerCase().includes(c)) || city.toLowerCase();
                                          const cls = classifySegmentByRegistry(cityKey, seg.raw);
                                          const minQty = (cls.state === 'specific' || cls.state === 'vague')
                                            ? cls.matches.map(m => cityServiceRegistry.current.get(cityKey)?.quantities[m]?.min)
                                                .filter((n): n is number => typeof n === 'number' && n > 0)
                                                .sort((a, b) => a - b)[0] ?? null
                                            : null;

                                          return (
                                            <Box
                                              key={cIdx}
                                              p={2.5}
                                              borderRadius="10px"
                                              border="2px solid"
                                              borderColor={isSelected ? 'blue.400' : 'gray.200'}
                                              bg={isSelected ? 'blue.50' : 'white'}
                                              _hover={{ borderColor: 'blue.300' }}
                                              transition="all 0.15s ease"
                                            >
                                              <HStack justify="space-between" align="center">
                                                <Checkbox
                                                  isChecked={isSelected}
                                                  onChange={() => handleCitySelection(segIdx, city)}
                                                  colorScheme="blue"
                                                  size="md"
                                                  isDisabled={isLoading}
                                                >
                                                  <Text fontSize="13px" fontWeight={isSelected ? '700' : '500'} color={isSelected ? 'blue.700' : 'gray.700'}>
                                                    {city}
                                                  </Text>
                                                </Checkbox>
                                                {minQty && minQty > 1 && (
                                                  <Text fontSize="11px" color="gray.400" fontWeight="500">
                                                    min {minQty}
                                                  </Text>
                                                )}
                                              </HStack>
                                            </Box>
                                          );
                                        })}
                                      </VStack>
                                    )}
                                  </Box>
                                );
                              })}
                            </VStack>

                            {/* Confirm button */}
                            {cityPickerState.segments.some(s => s.cityNeeded && s.selectedCities.length > 0) && (
                              <Button
                                mt={4}
                                w="full"
                                bgGradient="linear(135deg, #dc2626 0%, #be123c 50%, #9f1239 100%)"
                                color="white"
                                fontWeight="700"
                                fontSize="15px"
                                py={6}
                                borderRadius="14px"
                                onClick={() => { void handleCityConfirm(); }}
                                isDisabled={isLoading}
                                leftIcon={<Icon as={FiCheck} boxSize="18px" />}
                                _hover={{
                                  bgGradient: 'linear(135deg, #b91c1c 0%, #9f1239 50%, #881337 100%)',
                                  transform: 'translateY(-2px)',
                                  boxShadow: '0 12px 24px rgba(220, 38, 38, 0.3)',
                                }}
                                _active={{ transform: 'translateY(0)' }}
                                transition="all 0.2s ease"
                              >
                                Confirm Cities & Continue
                              </Button>
                            )}
                          </Box>
                        )}

                        {/* DEPRECATED: Service suggestion buttons when service not found (backward compatibility) */}
                        {message.isServiceNotFound && message.availableServices && message.availableServices.length > 0 && (
                          <Box mt={3}>
                            {/* Show valid services info for partial matches */}
                            {message.isPartialMatch && message.validServices && message.validServices.length > 0 && (
                              <Box mb={2} px={1}>
                                <Text fontSize="12px" fontWeight="600" color="green.600">
                                  ✅ {message.validServices.join(', ')} — available
                                </Text>
                                {message.missingServices && message.missingServices.length > 0 && (
                                  <Text fontSize="12px" fontWeight="600" color="red.500" mt={0.5}>
                                    ❌ {message.missingServices.join(', ')} — not available
                                  </Text>
                                )}
                                <Text fontSize="12px" color="gray.500" mt={1}>
                                  Select a replacement below to generate a combined quote:
                                </Text>
                              </Box>
                            )}
                            {!message.isPartialMatch && (
                              <Text fontSize="12px" fontWeight="600" color="gray.500" mb={2} px={1}>
                                Available services:
                              </Text>
                            )}
                            <VStack align="stretch" spacing={2}>
                              {/* Group by category */}
                              {(() => {
                                const categories = new Map<string, typeof message.availableServices>();
                                message.availableServices!.forEach(svc => {
                                  const cat = svc.category || 'Other';
                                  if (!categories.has(cat)) categories.set(cat, []);
                                  categories.get(cat)!.push(svc);
                                });
                                return Array.from(categories.entries()).map(([category, services]) => (
                                  <Box key={category}>
                                    <Text fontSize="11px" fontWeight="700" color="gray.400" textTransform="uppercase" letterSpacing="wider" mb={1} px={1}>
                                      {category}
                                    </Text>
                                    <VStack align="stretch" spacing={1.5}>
                                      {services!.map((svc, idx) => (
                                        <Button
                                          key={idx}
                                          variant="outline"
                                          size="sm"
                                          justifyContent="flex-start"
                                          textAlign="left"
                                          whiteSpace="normal"
                                          h="auto"
                                          py={2.5}
                                          px={4}
                                          borderRadius="12px"
                                          fontWeight="500"
                                          fontSize="13px"
                                          borderColor="blue.200"
                                          color="blue.700"
                                          bg="blue.50"
                                          onClick={() => handleServiceSuggestionClick(svc.name, message.isPartialMatch, message.validServices)}
                                          isDisabled={isLoading}
                                          _hover={{
                                            bg: 'blue.100',
                                            borderColor: 'blue.400',
                                            transform: 'translateX(4px)',
                                            boxShadow: '0 2px 8px rgba(59, 130, 246, 0.2)',
                                          }}
                                          transition="all 0.2s ease"
                                          leftIcon={<Text fontSize="14px">→</Text>}
                                        >
                                          {svc.name}
                                        </Button>
                                      ))}
                                    </VStack>
                                  </Box>
                                ));
                              })()}
                            </VStack>
                          </Box>
                        )}
                    </Box>
                  </Box>
                );
              })}

              {/* Typing Indicator */}
              {isLoading && (
                <Box alignSelf="flex-start">
                  <HStack
                    spacing={1.5}
                    px={4}
                    py={3}
                    bg="white"
                    border="1px solid"
                    borderColor="gray.200"
                    borderRadius="4px 14px 14px 14px"
                    boxShadow="0 4px 12px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.08)"
                  >
                    {[0, 1, 2].map(i => (
                      <Box
                        key={i}
                        w="7px"
                        h="7px"
                        borderRadius="full"
                        bg="blue.500"
                        sx={{
                          animation: `bounce 1.2s ${i * 0.2}s infinite ease-in-out`,
                          '@keyframes bounce': {
                            '0%,100%': { transform: 'translateY(0)', opacity: 0.5 },
                            '50%': { transform: 'translateY(-8px)', opacity: 1, boxShadow: '0 0 8px rgba(59, 130, 246, 0.5)' },
                          },
                        }}
                      />
                    ))}
                  </HStack>
                </Box>
              )}

              <div ref={messagesEndRef} />
            </VStack>
          )}
        </Box>

        {/* Bottom Chat Input Bar */}
        <HStack 
          spacing={{ base: 1.5, md: 3 }} 
          flexShrink={0} 
          px={{ base: 2, md: 4 }}
          py={{ base: 2.5, md: 4 }}
          pb={{ base: 'calc(0.625rem + env(safe-area-inset-bottom, 0px))', md: 4 }}
          mb={{ base: '64px', md: 0 }}
          borderTop="2px solid"
          borderColor="gray.300"
          bg="white"
          boxShadow="0 -4px 20px rgba(0, 0, 0, 0.08)"
          position="relative"
          zIndex={999}
        >
          <Box position="relative" flex={1}>
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                // If user manually edits while in history-browse mode, exit history mode
                // so the next ↑ press starts fresh from the newest entry.
                if (historyIndex !== -1) {
                  setHistoryIndex(-1);
                  setDraftInput('');
                }
              }}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              onKeyDown={handleInputKeyDown}
              onFocus={(e) => {
                // Select all text on focus so the user can instantly replace it
                e.target.select();
                // Auto-scroll input into view when keyboard appears
                if (Capacitor.isNativePlatform() || window.innerWidth <= 768) {
                  setTimeout(() => {
                    e.target.scrollIntoView({ 
                      behavior: 'smooth', 
                      block: 'center',
                      inline: 'nearest'
                    });
                  }, 300);
                }
              }}
              placeholder={
                proposal.textContent
                  ? '💬 Ask about this proposal...'
                  : '✨ Type your message here - ask anything about quotes...'
              }
              disabled={isLoading}
              size="lg"
              borderRadius="16px"
              bg="gray.50"
              border="2px solid"
              borderColor="gray.300"
              color="gray.900"
              fontSize={{ base: '14px', md: '16px' }}
              h={{ base: '44px', md: '60px' }}
              w="100%"
              pl={{ base: 3, md: 6 }}
              pr={{ base: 3, md: 6 }}
              fontWeight="500"
              transition="all 0.2s ease"
              _placeholder={{ 
                color: 'gray.500', 
                fontSize: { base: '12px', md: '16px' },
                fontWeight: '500',
              }}
              _hover={{ 
                borderColor: 'brand.400',
                bg: 'white',
                boxShadow: '0 0 0 1px rgba(201, 31, 61, 0.2), 0 4px 16px rgba(0, 0, 0, 0.08)',
              }}
              _focus={{
                borderColor: 'brand.500',
                bg: 'white',
                boxShadow: '0 0 0 4px rgba(201, 31, 61, 0.15), 0 8px 24px rgba(201, 31, 61, 0.12)',
                outline: 'none',
              }}
              _disabled={{
                bg: 'gray.100',
                color: 'gray.400',
                cursor: 'not-allowed',
                opacity: 0.7,
                borderColor: 'gray.300',
              }}
              sx={{
                '&::placeholder': {
                  textOverflow: 'ellipsis',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                }
              }}
            />
          </Box>
          <Box position="relative" display="inline-flex" alignItems="center" justifyContent="center">
            {/* Listening indicator text */}
            {isRecording && (
              <Text
                position="absolute"
                top="-28px"
                fontSize="xs"
                fontWeight="600"
                color="red.500"
                bg="white"
                px={3}
                py={1}
                borderRadius="full"
                boxShadow="0 2px 8px rgba(239, 68, 68, 0.2)"
                border="1px solid"
                borderColor="red.200"
                whiteSpace="nowrap"
                sx={{
                  animation: 'fadeIn 0.3s ease-in-out',
                  '@keyframes fadeIn': {
                    from: { opacity: 0, transform: 'translateY(4px)' },
                    to: { opacity: 1, transform: 'translateY(0)' },
                  },
                }}
              >
                🎙️ Listening...
              </Text>
            )}
            
            {/* Animated rings when recording */}
            {isRecording && (
              <>
                <Box
                  position="absolute"
                  w="48px"
                  h="48px"
                  borderRadius="full"
                  border="2px solid"
                  borderColor="red.400"
                  sx={{
                    animation: 'ripple 1.5s ease-out infinite',
                    '@keyframes ripple': {
                      '0%': { 
                        transform: 'scale(1)',
                        opacity: 0.8,
                      },
                      '100%': { 
                        transform: 'scale(1.8)',
                        opacity: 0,
                      },
                    },
                  }}
                />
                <Box
                  position="absolute"
                  w="48px"
                  h="48px"
                  borderRadius="full"
                  border="2px solid"
                  borderColor="red.300"
                  sx={{
                    animation: 'ripple 1.5s ease-out infinite 0.5s',
                    '@keyframes ripple': {
                      '0%': { 
                        transform: 'scale(1)',
                        opacity: 0.8,
                      },
                      '100%': { 
                        transform: 'scale(1.8)',
                        opacity: 0,
                      },
                    },
                  }}
                />
              </>
            )}
            
            {/* Voice input button */}
            <IconButton
              aria-label={isRecording ? "Stop recording" : "Voice input"}
              icon={<FiMic />}
              onClick={toggleVoiceInput}
              isDisabled={isLoading}
              bgGradient={isRecording 
                ? "linear(to-br, red.500, red.600, pink.500)" 
                : "linear(to-br, blue.500, blue.600, cyan.500)"
              }
              color="white"
              size="md"
              h={{ base: '38px', md: '48px' }}
              w={{ base: '38px', md: '48px' }}
              minW={{ base: '38px', md: '48px' }}
              borderRadius="full"
              flexShrink={0}
              fontSize={{ base: '15px', md: '20px' }}
              position="relative"
              zIndex={1}
              border="2px solid"
              borderColor={isRecording ? "red.300" : "blue.300"}
              boxShadow={isRecording 
                ? "0 4px 20px rgba(239, 68, 68, 0.5), 0 0 30px rgba(239, 68, 68, 0.3), inset 0 1px 0 rgba(255,255,255,0.3)" 
                : "0 4px 16px rgba(59, 130, 246, 0.4), 0 0 24px rgba(59, 130, 246, 0.2), inset 0 1px 0 rgba(255,255,255,0.3)"
              }
              _hover={{
                bgGradient: isRecording 
                  ? "linear(to-br, red.600, red.700, pink.600)" 
                  : "linear(to-br, blue.600, blue.700, cyan.600)",
                transform: 'translateY(-2px) scale(1.05)',
                boxShadow: isRecording 
                  ? '0 8px 28px rgba(239, 68, 68, 0.6), 0 0 40px rgba(239, 68, 68, 0.4), inset 0 1px 0 rgba(255,255,255,0.4)' 
                  : '0 8px 24px rgba(59, 130, 246, 0.5), 0 0 32px rgba(59, 130, 246, 0.3), inset 0 1px 0 rgba(255,255,255,0.4)',
                borderColor: isRecording ? "red.200" : "blue.200",
              }}
              _active={{
                transform: 'scale(0.95)',
                boxShadow: isRecording 
                  ? '0 2px 12px rgba(239, 68, 68, 0.4), inset 0 2px 4px rgba(0,0,0,0.2)' 
                  : '0 2px 12px rgba(59, 130, 246, 0.4), inset 0 2px 4px rgba(0,0,0,0.2)',
              }}
              _disabled={{
                bgGradient: 'linear(to-br, gray.300, gray.400)',
                color: 'gray.500',
                cursor: 'not-allowed',
                opacity: 0.6,
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                borderColor: 'gray.300',
              }}
              sx={isRecording ? {
                animation: 'micPulse 1.2s ease-in-out infinite',
                '@keyframes micPulse': {
                  '0%, 100%': { 
                    transform: 'scale(1)',
                    filter: 'brightness(1)',
                  },
                  '50%': { 
                    transform: 'scale(1.08)',
                    filter: 'brightness(1.15)',
                  },
                },
              } : {
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            />
          </Box>
          {/* Mobile-only: floating ▲▼ history pill above the input bar */}
          {inputHistory.length > 0 && (
            <VStack
              display={{ base: 'flex', md: 'none' }}
              position="absolute"
              bottom="calc(100% + 6px)"
              right={{ base: '8px', md: '16px' }}
              spacing={0}
              bg="white"
              border="1.5px solid"
              borderColor="gray.200"
              borderRadius="12px"
              overflow="hidden"
              boxShadow="0 2px 12px rgba(0,0,0,0.15)"
              zIndex={1001}
              w="34px"
            >
              <IconButton
                aria-label="Previous message"
                icon={<FiChevronUp />}
                h="28px"
                w="34px"
                minW="34px"
                fontSize="16px"
                variant="ghost"
                borderRadius="0"
                color={historyIndex === -1 || historyIndex > 0 ? 'brand.500' : 'gray.300'}
                isDisabled={isLoading || inputHistory.length === 0 || historyIndex === 0}
                onClick={() => {
                  if (inputHistory.length === 0) return;
                  const newIdx = historyIndex === -1
                    ? inputHistory.length - 1
                    : Math.max(0, historyIndex - 1);
                  if (historyIndex === -1) setDraftInput(inputValue);
                  setHistoryIndex(newIdx);
                  setInputValue(inputHistory[newIdx].text);
                  setTimeout(() => {
                    const el = inputRef.current;
                    if (el) el.selectionStart = el.selectionEnd = inputHistory[newIdx].text.length;
                  }, 0);
                }}
                _hover={{ bg: 'brand.50' }}
                _disabled={{ color: 'gray.200', cursor: 'not-allowed', opacity: 1 }}
              />
              <Box w="100%" h="1px" bg="gray.200" flexShrink={0} />
              <IconButton
                aria-label="Next message"
                icon={<FiChevronDown />}
                h="28px"
                w="34px"
                minW="34px"
                fontSize="16px"
                variant="ghost"
                borderRadius="0"
                color={historyIndex !== -1 ? 'brand.500' : 'gray.300'}
                isDisabled={isLoading || historyIndex === -1}
                onClick={() => {
                  if (historyIndex === -1) return;
                  const newIdx = historyIndex + 1;
                  if (newIdx >= inputHistory.length) {
                    setHistoryIndex(-1);
                    setInputValue(draftInput);
                    setTimeout(() => {
                      const el = inputRef.current;
                      if (el) el.selectionStart = el.selectionEnd = draftInput.length;
                    }, 0);
                  } else {
                    setHistoryIndex(newIdx);
                    setInputValue(inputHistory[newIdx].text);
                    setTimeout(() => {
                      const el = inputRef.current;
                      if (el) el.selectionStart = el.selectionEnd = inputHistory[newIdx].text.length;
                    }, 0);
                  }
                }}
                _hover={{ bg: 'brand.50' }}
                _disabled={{ color: 'gray.200', cursor: 'not-allowed', opacity: 1 }}
              />
            </VStack>
          )}
          <IconButton
            aria-label="Send message"
            data-send-btn
            icon={isLoading ? <Spinner size="sm" color="white" thickness="3px" /> : <FiSend />}
            onClick={handleSendMessage}
            isDisabled={!inputValue.trim() || isLoading}
            bgGradient="linear(to-br, brand.500, brand.600)"
            color="white"
            size="lg"
            h={{ base: '44px', md: '60px' }}
            w={{ base: '44px', md: '60px' }}
            minW={{ base: '44px', md: '60px' }}
            borderRadius={{ base: '12px', md: '16px' }}
            flexShrink={0}
            fontSize={{ base: '18px', md: '22px' }}
            transition="all 0.2s ease"
            boxShadow="0 4px 20px rgba(201, 31, 61, 0.4), 0 2px 8px rgba(201, 31, 61, 0.25)"
            _hover={{
              bgGradient: "linear(to-br, brand.600, brand.700)",
              transform: 'translateY(-2px) scale(1.05)',
              boxShadow: '0 8px 28px rgba(201, 31, 61, 0.5), 0 4px 12px rgba(201, 31, 61, 0.35)',
            }}
            _active={{
              transform: 'scale(0.95)',
              boxShadow: '0 2px 12px rgba(201, 31, 61, 0.35)',
            }}
            _disabled={{
              bgGradient: 'linear(to-br, gray.300, gray.400)',
              color: 'gray.500',
              cursor: 'not-allowed',
              opacity: 0.6,
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
              filter: 'grayscale(0.3)',
            }}
          />
        </HStack>
      </VStack>

      {/* Confirmation Table Modal — shown after min qty (if any) and before Gemini */}
      {confirmationTable && (
        <Box
          position="fixed"
          top="0" left="0" right="0" bottom="0"
          bg="rgba(0,0,0,0.55)"
          zIndex={9999}
          display="flex"
          alignItems="center"
          justifyContent="center"
          px={4}
        >
          <Box
            bg="white"
            borderRadius="16px"
            maxW="460px"
            w="100%"
            boxShadow="0 8px 32px rgba(0,0,0,0.18)"
            display="flex"
            flexDirection="column"
            maxH="90vh"
            overflow="hidden"
          >
            {/* Sticky Header */}
            <Box px={6} pt={6} pb={3} flexShrink={0}>
              <Text fontSize="16px" fontWeight="700" color="gray.800">
                📋 Confirm Your Services
              </Text>
            </Box>

            {/* Scrollable Table Body */}
            <Box flex={1} overflowY="auto" px={6} pb={2}>
              <Box borderRadius="8px" overflow="hidden" border="1px solid" borderColor="gray.200">
                <HStack bg="gray.800" px={3} py={2} spacing={0}>
                  <Text flex={2} fontSize="11px" fontWeight="700" color="white" textTransform="uppercase" letterSpacing="wider">Service</Text>
                  <Text flex={0.6} fontSize="11px" fontWeight="700" color="white" textTransform="uppercase" letterSpacing="wider" textAlign="center">Qty</Text>
                  <Text flex={1} fontSize="11px" fontWeight="700" color="white" textTransform="uppercase" letterSpacing="wider" textAlign="right">City</Text>
                </HStack>
                {confirmationTable.rows.map((row, idx) => (
                  <HStack
                    key={idx}
                    px={3}
                    py={2.5}
                    spacing={0}
                    bg={idx % 2 === 0 ? 'white' : 'gray.50'}
                    borderTop="1px solid"
                    borderColor="gray.100"
                  >
                    <Text flex={2} fontSize="13px" fontWeight="500" color="gray.800">{row.service}</Text>
                    <Text flex={0.6} fontSize="13px" fontWeight="600" color="gray.700" textAlign="center">{row.qty}</Text>
                    <Text flex={1} fontSize="13px" color="blue.600" fontWeight="600" textAlign="right">{row.city}</Text>
                  </HStack>
                ))}
              </Box>
            </Box>

            {/* Sticky Footer */}
            <Box px={6} pt={3} pb={6} flexShrink={0} borderTop="1px solid" borderColor="gray.100">
              <Text fontSize="12px" color="gray.500" mb={4}>
                {confirmationTable.rows.length} service{confirmationTable.rows.length !== 1 ? 's' : ''} selected. Confirm to generate the quote.
              </Text>
              <HStack spacing={3} justify="flex-end">
                <Button
                  size="sm"
                  variant="outline"
                  borderColor="gray.300"
                  color="gray.600"
                  borderRadius="8px"
                  onClick={() => setConfirmationTable(null)}
                >
                  ← Edit
                </Button>
                <Button
                  size="sm"
                  bgGradient="linear(135deg, #dc2626 0%, #be123c 50%, #9f1239 100%)"
                  color="white"
                  fontWeight="700"
                  borderRadius="8px"
                  px={6}
                  onClick={handleConfirmAndGenerate}
                  leftIcon={<Icon as={FiCheck} boxSize="14px" />}
                  _hover={{ bgGradient: 'linear(135deg, #b91c1c 0%, #9f1239 100%)' }}
                >
                  Generate Quote
                </Button>
              </HStack>
            </Box>
          </Box>
        </Box>
      )}

      {/* Unavailable Service Alert */}
      {unavailableServices.length > 0 && (
        <Box
          position="fixed"
          top="0" left="0" right="0" bottom="0"
          bg="rgba(0,0,0,0.45)"
          zIndex={9998}
          display="flex"
          alignItems="center"
          justifyContent="center"
          px={4}
        >
          <Box
            bg="white"
            borderRadius="14px"
            p={5}
            maxW="420px"
            w="100%"
            boxShadow="0 8px 32px rgba(0,0,0,0.18)"
          >
            {/* Header */}
            <Box mb={3}>
              <Text fontSize="15px" fontWeight="700" color="#b45309">
                ⚠️ Service Not Available
              </Text>
            </Box>

            {/* Missing service rows */}
            {unavailableServices.map((item, i) => (
              <Box
                key={i}
                mb={2}
                p={3}
                bg="#fffbeb"
                borderRadius="8px"
                borderLeft="3px solid #f59e0b"
              >
                <Text fontSize="13px" color="#78350f">
                  <b>{item.service}</b> is currently not offered in{' '}
                  <b>{item.city}</b>.
                </Text>
              </Box>
            ))}

            {/* Context-aware footer message */}
            {pendingValidMessage ? (
              <Box mt={3} mb={4} p={3} bg="#f0fdf4" borderRadius="8px" borderLeft="3px solid #16a34a">
                <Text fontSize="12.5px" color="#15803d" fontWeight="600">
                  ✓ Don't worry — we'll still generate the quote for your other available service{pendingValidMessage.toLowerCase().includes(' and ') ? 's' : ''}.
                </Text>
                <Text fontSize="12px" color="#166534" mt={1}>
                  Click <b>Close</b> to proceed with the available request.
                </Text>
              </Box>
            ) : (
              <Text fontSize="12px" color="gray.500" mt={3} mb={4}>
                Please try a different service for{' '}
                {unavailableServices.map(s => s.city).join(', ')}.
              </Text>
            )}

            <HStack spacing={3} justify="flex-end">
              {pendingValidMessage && (
                <Button
                  size="sm"
                  variant="outline"
                  borderColor="gray.300"
                  color="gray.600"
                  borderRadius="8px"
                  onClick={() => {
                    setUnavailableServices([]);
                    setPendingValidMessage(null);
                  }}
                  _hover={{ bg: 'gray.50' }}
                >
                  Cancel
                </Button>
              )}
              <Button
                size="sm"
                bg={pendingValidMessage ? '#16a34a' : '#1a3a5c'}
                color="white"
                borderRadius="8px"
                onClick={() => {
                  setUnavailableServices([]);
                  if (pendingValidMessage) {
                    const msg = pendingValidMessage;
                    setPendingValidMessage(null);
                    // Save prompt so arrow-up can recall it
                    pushToHistory(msg.replace(/\s*\[User has already specified complete service names from checkboxes\]/g, '').replace(/\s*\[QTY_OVERRIDE\]/g, '').trim());
                    sendMessageWithContent(msg);
                  }
                }}
                _hover={{ bg: pendingValidMessage ? '#15803d' : '#1e4d78' }}
              >
                {pendingValidMessage ? 'Close & Generate Quote' : 'Close'}
              </Button>
            </HStack>
          </Box>
        </Box>
      )}

      {/* Minimum Quantity Warning Dialog */}
      {minQtyWarning && (
        <Box
          position="fixed"
          top="0" left="0" right="0" bottom="0"
          bg="rgba(0,0,0,0.55)"
          zIndex={9999}
          display="flex"
          alignItems="center"
          justifyContent="center"
          px={{ base: 2, md: 4 }}
          py={{ base: 2, md: 4 }}
        >
          <Box
            bg="white"
            borderRadius={{ base: "14px", md: "14px" }}
            maxW={{ base: "100%", sm: "420px" }}
            w="100%"
            boxShadow="0 8px 32px rgba(0,0,0,0.18)"
            display="flex"
            flexDirection="column"
            maxH={{ base: "90vh", md: "90vh" }}
            overflow="hidden"
          >
            {/* Sticky Header */}
            <Box px={{ base: 3, md: 6 }} pt={{ base: 3, md: 6 }} pb={{ base: 2, md: 3 }} flexShrink={0} display="flex" alignItems="center" justifyContent="space-between" gap={2}>
              <Text fontSize={{ base: "14px", md: "15px" }} fontWeight="700" color="#c0392b" lineHeight="1.3">
                ⚠️ Below Minimum Quantity
              </Text>
              <Box flexShrink={0}>
                <IconButton
                  aria-label="Close"
                  icon={<FiX />}
                  size="xs"
                  variant="ghost"
                  onClick={handleMinQtyClose}
                  _hover={{ bg: 'gray.100' }}
                  color="gray.500"
                  w="24px"
                  h="24px"
                  minW="24px"
                  fontSize="14px"
                />
              </Box>
            </Box>

            {/* Scrollable Items Body */}
            <Box flex={1} overflowY="auto" px={{ base: 3, md: 6 }} pb={2}>
              {minQtyWarning.items.map((item, i) => (
                <Box 
                  key={i} 
                  mb={{ base: 2, md: 3 }} 
                  p={{ base: 3, md: 3 }} 
                  bg="#fff5f5" 
                  borderRadius={{ base: "8px", md: "8px" }} 
                  borderLeft="3px solid #c0392b"
                  display="flex"
                  alignItems="center"
                  justifyContent="space-between"
                  gap={2}
                >
                  <Box flex={1} minW={0}>
                    <Text 
                      fontSize={{ base: "12px", md: "13px" }} 
                      fontWeight="600" 
                      color="#2d3436"
                      lineHeight="1.4"
                    >
                      {item.description}
                    </Text>
                      {editingItemIndex === i ? (
                        <Box mt={1.5}>
                          <HStack spacing={1.5} align="center">
                            <Input
                              size="xs"
                              type="number"
                              value={editedQuantity}
                              onChange={(e) => setEditedQuantity(e.target.value)}
                              placeholder="Qty"
                              fontSize={{ base: "12px", md: "12px" }}
                              h={{ base: "32px", md: "30px" }}
                              w={{ base: "90px", md: "100px" }}
                              borderColor="#c0392b"
                              borderWidth="1.5px"
                              borderRadius="8px"
                              _focus={{ borderColor: "#c0392b", boxShadow: "0 0 0 1px #c0392b" }}
                              textAlign="center"
                              autoFocus
                            />
                            <Button
                              size="xs"
                              bg="#1a3a5c"
                              color="white"
                              onClick={() => handleSaveEditedQuantity(i)}
                              fontSize="11px"
                              h={{ base: "32px", md: "30px" }}
                              w="fit-content"
                              minW="44px"
                              px={3}
                              borderRadius="8px"
                              _hover={{ bg: '#1e4d78' }}
                            >
                              Save
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              color="gray.500"
                              onClick={handleCancelEdit}
                              fontSize="11px"
                              h={{ base: "32px", md: "30px" }}
                              w="fit-content"
                              minW="52px"
                              px={2}
                              borderRadius="8px"
                            >
                              Cancel
                            </Button>
                          </HStack>
                        </Box>
                      ) : (
                        <Text 
                          fontSize={{ base: "11px", md: "12px" }} 
                          color="#636e72" 
                          mt={1}
                          lineHeight="1.5"
                        >
                          Minimum: <b>{item.minimum}</b> units | You requested: <b>{item.requested}</b> units
                        </Text>
                      )}
                  </Box>
                  {editingItemIndex !== i && (
                    <IconButton
                      aria-label="Edit quantity"
                      icon={<FiEdit2 />}
                      size="xs"
                      variant="ghost"
                      color="#1a3a5c"
                      onClick={() => handleEditItemQuantity(i)}
                      _hover={{ bg: 'gray.100' }}
                      fontSize={{ base: "14px", md: "13px" }}
                      flexShrink={0}
                      w={{ base: "28px", md: "24px" }}
                      h={{ base: "28px", md: "24px" }}
                      minW={{ base: "28px", md: "24px" }}
                    />
                  )}
                </Box>
              ))}
            </Box>

            {/* Sticky Footer */}
            <Box 
              px={{ base: 3, md: 6 }} 
              pt={{ base: 3, md: 3 }} 
              pb={{ base: 4, md: 6 }} 
              flexShrink={0} 
              borderTop="1px solid" 
              borderColor="gray.100"
            >
              <Text 
                fontSize={{ base: "11px", md: "12.5px" }} 
                color="#636e72" 
                mb={{ base: 3, md: 4 }}
                lineHeight="1.5"
              >
                Would you like to continue with your requested quantity, or update to the minimum?
              </Text>
              <Stack 
                direction={{ base: "column", sm: "row" }} 
                spacing={{ base: 2, sm: 3 }} 
                justify={{ base: "stretch", sm: "flex-end" }}
              >
                <Button
                  size="sm"
                  variant="outline"
                  borderColor="#c0392b"
                  color="#c0392b"
                  onClick={handleMinQtyContinue}
                  _hover={{ bg: '#fff5f5' }}
                  w={{ base: "100%", sm: "auto" }}
                  h={{ base: "40px", sm: "36px" }}
                  fontSize={{ base: "13px", md: "14px" }}
                  borderRadius="10px"
                  order={{ base: 2, sm: 1 }}
                >
                  {(() => {
                    const qtys = minQtyWarning.items.map(it => it.requested);
                    const allSame = qtys.every(q => q === qtys[0]);
                    return minQtyWarning.items.length === 1 || allSame
                      ? `Continue with ${qtys[0]}`
                      : `Generate as Requested`;
                  })()}
                </Button>
                <Button
                  size="sm"
                  bg="#1a3a5c"
                  color="white"
                  onClick={handleMinQtyUseMinimum}
                  _hover={{ bg: '#1e4d78' }}
                  w={{ base: "100%", sm: "auto" }}
                  h={{ base: "40px", sm: "36px" }}
                  fontSize={{ base: "13px", md: "14px" }}
                  borderRadius="10px"
                  order={{ base: 1, sm: 2 }}
                >
                  {minQtyWarning.items.length === 1
                    ? `Use Minimum (${minQtyWarning.items[0].minimum})`
                    : `Use Minimums`}
                </Button>
              </Stack>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default ChatInterface;
