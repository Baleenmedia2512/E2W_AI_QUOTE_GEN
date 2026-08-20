import React, { useState, useRef, useEffect } from 'react';
import {
  Box,
  Image,
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
  SimpleGrid,
} from '@chakra-ui/react';
import { FiSend, FiCheck, FiMic, FiChevronUp, FiChevronDown, FiX, FiEdit2 } from 'react-icons/fi';
import { useHistory } from 'react-router-dom';
import { useAppStore } from '../../store';
import { useAuthStore } from '../../store/authStore';
import { Message } from '../../types/chat';
import { Quote } from '../../types/quote';
import { saveChatHistory, loadChatHistory, clearChatHistory } from '../../utils/localStorage';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { Capacitor } from '@capacitor/core';
import { canonicalizeServiceName, KNOWN_CITY_LIST, type ServiceQuantity } from '../../utils/serviceNameUtils';
import { resolveServiceIdFromCatalog } from '../../utils/serviceResolver';
import {
  computeQuoteItemTotal,
  parseDurationFromUserText,
  toCampaignDays,
} from '../../utils/durationUtils';
import { ChatChipThumb } from './ChatChipThumb';
import ChatProfilePanel from './ChatProfilePanel';
import { ChipImageLightbox, closeChipImagePreview, openChipImagePreview } from './ChipImageLightbox';
import {
  buildCityServiceListFromDb,
  buildCloudSegmentCityPlan,
  buildGroupedServicesFromDb,
  collectCitiesFromDbServices,
  dedupeConfirmationRows,
  detectCityInTextList,
  detectCityOnlyInList,
  getCitiesForServiceQuery,
  getCityDetectionList,
  isMultiSegmentQuoteRequest,
  isVagueCategoryQuery,
  mergeCityLists,
  mergeGroupedServicesByCategory,
  MULTI_SVC_DEBUG,
  runCloudPreGeminiValidation,
  validateQuoteItemsAgainstDbMinQty,
  validateConfirmationRowsMinQty,
  type MinQtyViolation,
  VEHICLE_CATEGORY_PATTERN,
} from '../../utils/cloudQuoteValidation';
import {
  gateMinQtyBeforeConfirm,
  labelsToConfirmRows,
  mergeDirectPartsIntoGroupedServices,
  parseMessageToConfirmRows,
  rowsFromCloudBelowMin,
  type MinDurationViolation,
  validateConfirmationRowsMinDuration,
} from '../../utils/confirmedQuotePipeline';
import type { DbService } from '../../utils/serviceResolver';
import {
  continueProgressiveAction,
  detectLocalityInText,
  detectMediaLocal,
  isNewServiceSwitch,
  matchFreeTextToProgressiveOption,
  parseQtyFromText,
  resolveMinQtyEdits,
  resolveProgressiveText,
  type ProgressiveOption,
  type ProgressiveSession,
  type ProgressiveTurnResult,
} from '../../utils/progressiveChatEngine';

// ═══════════════════════════════════════════════════════════════════════
// Progressive DB chat (short friendly replies). Gemini optional for intent only.
// Legacy multi-match / city-wizard path disabled while USE_PROGRESSIVE_CHAT is on.
// ═══════════════════════════════════════════════════════════════════════
const USE_CLOUD_DATA = true;
const USE_PROGRESSIVE_CHAT = true;

/**
 * Drop chip thumbnail URLs from prior turns so decoded images don't linger
 * when the user continues chatting (keeps labels / checkboxes, frees memory).
 */
function stripChipImagesFromMessages(
  messages: Message[],
  keepMessageId?: string | null,
): Message[] {
  let changed = false;
  const next = messages.map((m) => {
    if (keepMessageId && m.id === keepMessageId) return m;
    const opts = m.progressiveOptions;
    if (!opts?.length || !opts.some((o) => o.imageUrl)) return m;
    changed = true;
    return {
      ...m,
      progressiveOptions: opts.map(({ imageUrl: _drop, ...rest }) => rest),
    };
  });
  return changed ? next : messages;
}

const SUGGESTION_PROMPTS = [
  'Give quote for bus branding',
  'Give quote for hoarding in Chennai',
  'Give quote for auto full branding',
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
  matchedCities?: string[];       // Cities where service is available (from DB catalog)
}

const ChatInterfaceContent: React.FC = () => {
  const history = useHistory();
  const { proposal, setCurrentQuote, activeProposals, loadCloudServices } = useAppStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [_error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  // Cache: service key (lowercase) -> minimum quantity, persists across messages in the same session
  const minQtyCacheRef = useRef<Map<string, number>>(new Map());
  // The catalog is immutable for the lifetime of this chat. Reusing it avoids
  // downloading and rebuilding the same service list on every user message.
  const catalogCacheRef = useRef<DbService[] | null>(null);
  const catalogLoadRef = useRef<Promise<DbService[]> | null>(null);

  const getCachedDbServices = async (): Promise<DbService[]> => {
    if (catalogCacheRef.current) return catalogCacheRef.current;
    if (!catalogLoadRef.current) {
      const { loadAllServicesFromCloud } = await import('../../services/supabaseProposalService');
      catalogLoadRef.current = loadAllServicesFromCloud()
        .then((services) => services || [])
        .finally(() => {
          catalogLoadRef.current = null;
        });
    }
    catalogCacheRef.current = await catalogLoadRef.current;
    return catalogCacheRef.current;
  };

  /** Locked confirm rows for the current generate request (scoped Gemini context). */
  const confirmedRowsRef = useRef<Array<{ service: string; qty: number | string; city: string }> | null>(null);

  // ── Command History ────────────────────────────────────────────────────────
  const { user } = useAuthStore();
  const [inputHistory, setInputHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draftInput, setDraftInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * Keep the draft out of ChatInterface state. The previous controlled input
   * updated this 5k-line component on every keystroke, including the message
   * history and all of its interactive chips.
   */
  const getInputValue = () => inputRef.current?.value ?? '';
  const setInputValue = (next: string | ((previous: string) => string)) => {
    const current = inputRef.current?.value ?? '';
    const value = typeof next === 'function' ? next(current) : next;
    if (inputRef.current) {
      inputRef.current.value = value;
    }
  };
  const prevUserIdRef = useRef<string | undefined>(undefined);
  // ──────────────────────────────────────────────────────────────────────────

  // Multi-select state for MULTIPLE_MATCH scenarios
  // Map: messageId -> { groupKey (vehicleType|city) -> string[] of selected service names }
  const [selectedServices, setSelectedServices] = useState<Record<string, Record<string, string[]>>>({});
  /** How many services are visible per multi-match group (paginated for large catalogs). */
  const [multiMatchVisibleCount, setMultiMatchVisibleCount] = useState<
    Record<string, Record<string, number>>
  >({});
  const MULTI_MATCH_PAGE_SIZE = 35;

  /**
   * Fold "Already confirmed" labels into checkbox groups and pre-check them.
   * Also pre-checks preferred option in each vague group.
   * Returns the message ready to append (directParts cleared after merge).
   */
  const prepareMultipleMatchMessage = (msg: Message): Message => {
    const { groups, preSelected } = mergeDirectPartsIntoGroupedServices(
      msg.groupedServices || [],
      msg.directParts || [],
    );
    if (MULTI_SVC_DEBUG) {
      console.log('[MultiSvcDebug] prepareMultipleMatchMessage merge', {
        id: msg.id,
        directPartsIn: msg.directParts,
        groupsBefore: msg.groupedServices?.length ?? 0,
        groupsAfter: groups.length,
        preSelected,
        preCheckedCount: Object.values(preSelected).flat().length,
      });
    }
    if (Object.keys(preSelected).length > 0) {
      setSelectedServices((prev) => ({ ...prev, [msg.id]: preSelected }));
    }
    return {
      ...msg,
      groupedServices: groups,
      directParts: undefined,
    };
  };

  // Confirmation table state: shown after service selection, before final Gemini call
  const [confirmationTable, setConfirmationTable] = useState<{
    messageId: string;
    rows: Array<{ service: string; qty: number | string; city: string; durationDays?: number }>;
    originalUserInput: string;
    /** When set, Edit returns to the min-qty modal instead of closing the flow. */
    minQtySnapshot?: {
      items: Array<{ description: string; requested: number; originalRequested: number; minimum: number }>;
      aboveMinItems?: Array<{ description: string; requested: number; minimum: number }>;
      pendingRows: Array<{ service: string; qty: number | string; city: string; durationDays?: number }>;
      messageId: string;
      originalUserInput: string;
    };
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
    rows: Array<{ service: string; qty: number | string; city: string; durationDays?: number }>;
    originalUserInput: string;
    messageId: string;
  } | null>(null);

  // Multi-select for the city-only "all services" list.
  // Map: messageId -> set of "City|Service" keys → quantity (defaults to minQty).
  const [cityServiceSelection, setCityServiceSelection] = useState<Record<string, Record<string, number>>>({});

  // Minimum quantity warning dialog state
  const [minQtyWarning, setMinQtyWarning] = useState<{
    items: Array<{ description: string; requested: number; originalRequested: number; minimum: number }>;
    /** Display-only above-minimum rows shown as green in the popup. NOT used by any handler. */
    aboveMinItems?: Array<{ description: string; requested: number; minimum: number }>;
    pendingQuote: Quote | null;
  } | null>(null);

  const [minDurationWarning, setMinDurationWarning] = useState<{
    items: MinDurationViolation[];
  } | null>(null);
  const [pendingDurationInput, setPendingDurationInput] = useState<{
    rows: Array<{ service: string; qty: number | string; city: string; durationDays?: number }>;
    originalUserInput: string;
    messageId: string;
    violations: MinDurationViolation[];
  } | null>(null);
  const [editingDurationIndex, setEditingDurationIndex] = useState<number | null>(null);
  const [editedDuration, setEditedDuration] = useState<string>('');

  // State to track which item is being edited in the min qty warning modal
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
  const [editedQuantity, setEditedQuantity] = useState<string>('');


  // Unavailable service alert state: shown when a service doesn't exist in a city's rate card
  const [unavailableServices, setUnavailableServices] = useState<Array<{ city: string; service: string }>>([]);
  // Pending valid rows after unavailable-service modal → confirm table → DB quote
  const [pendingValidConfirm, setPendingValidConfirm] = useState<{
    rows: Array<{ service: string; qty: number | string; city: string }>;
    originalUserInput: string;
    messageId: string;
  } | null>(null);
  // Legacy string fallback for partial-valid paths
  const [pendingValidMessage, setPendingValidMessage] = useState<string | null>(null);
  // Alternate message used when user clicks "Use Minimum" on a multi-segment below-min warning.
  // Holds the original message rewritten with each below-min segment's qty bumped to its registry minimum.
  const [pendingMinReplacedMessage, setPendingMinReplacedMessage] = useState<string | null>(null);

  // Progressive chat session (city → area → min-qty → quote)
  const [progressiveSession, setProgressiveSession] = useState<ProgressiveSession | null>(null);
  const [progressiveMultiSelect, setProgressiveMultiSelect] = useState<Record<string, string[]>>({});
  /** Progressive checklist page size — rendering 90+ chips freezes the main thread. */
  const [progressiveChipVisible, setProgressiveChipVisible] = useState<Record<string, number>>({});
  const PROGRESSIVE_CHIP_PAGE = 24;
  /** messageId → serviceKey currently being edited on min-qty card */
  const [minQtyEditingKey, setMinQtyEditingKey] = useState<Record<string, string | null>>({});
  /** messageId → serviceKey → draft string while typing */
  const [minQtyDrafts, setMinQtyDrafts] = useState<Record<string, Record<string, string>>>({});
  const minQtyApplyLock = useRef(false);
  const [minDurationDrafts, setMinDurationDrafts] = useState<Record<string, Record<string, string>>>({});
  const [minDurationEditingKey, setMinDurationEditingKey] = useState<Record<string, string | null>>({});
  const minDurationApplyLock = useRef(false);
  /** Gemini EXACT_MATCH hint only — cloud gate handles validation first. */
  const isFullySpecifiedRequest = (userRequest: string): boolean => {
    if (isMultiSegmentQuoteRequest(userRequest)) {
      return false;
    }

    const request = userRequest.toLowerCase();
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

    return fullServicePatterns.some((pattern) => pattern.test(request));
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
  // (No service-name aliases here — spelling variants handled by DB catalog matching.)
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
    if (!history || history.length === 0) return;

    // Drop turns that still carry legacy mega batch-group UUID dumps (freeze on paint)
    const safe = history.filter((msg) => {
      const opts = msg?.progressiveOptions;
      if (!Array.isArray(opts)) return true;
      if (opts.length > 48) return false;
      return !opts.some((o: { id?: string }) => String(o?.id || '').length > 200);
    });

    if (safe.length === 0) {
      clearChatHistory();
      return;
    }
    if (safe.length < history.length) {
      saveChatHistory(safe);
    }
    setMessages(
      stripChipImagesFromMessages(
        safe.map((msg) => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
        })),
        // Keep thumbs only on the latest progressive chip message (if any)
        [...safe].reverse().find((m) =>
          m.progressiveOptions?.some((o: { imageUrl?: string }) => !!o.imageUrl),
        )?.id,
      ),
    );
  }, []);

  // Save chat history when messages change
  useEffect(() => {
    if (messages.length === 0) return;
    // Avoid serializing the complete conversation synchronously on every
    // keystroke/turn. The latest state is still persisted after the user
    // pauses briefly.
    const timer = window.setTimeout(() => saveChatHistory(messages), 400);
    return () => window.clearTimeout(timer);
  }, [messages]);

  // Scroll to bottom when messages change — avoid scrollIntoView (it can scroll
  // ancestors / fight the fixed composer and leave the input unfocusable).
  useEffect(() => {
    let firstFrame = 0;
    let secondFrame = 0;
    const scrollLatest = () => {
      const end = messagesEndRef.current;
      const scroller = end?.closest?.('.qb-chat-scroll') as HTMLElement | null;
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight;
        return;
      }
      end?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    // Progressive cards can grow after their images/grid finish layout.
    firstFrame = window.requestAnimationFrame(() => {
      scrollLatest();
      secondFrame = window.requestAnimationFrame(scrollLatest);
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [messages, isLoading]);

  const scrollChatToLatest = () => {
    const end = messagesEndRef.current;
    const scroller = end?.closest?.('.qb-chat-scroll') as HTMLElement | null;
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
      return;
    }
    end?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // After a plain text reply (no chips), put caret back in the composer
  useEffect(() => {
    if (isLoading) return;
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (last.progressiveOptions && last.progressiveOptions.length > 0) return;
    if (last.progressiveBelowMin && last.progressiveBelowMin.length > 0) return;
    if (last.progressiveBelowMinDuration && last.progressiveBelowMinDuration.length > 0) return;
    if (document.querySelector('[aria-label="Close image preview"]')) return;

    const t = window.setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
    }, 50);
    return () => window.clearTimeout(t);
  }, [isLoading, messages]);

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

  // Hydrate legacy multiple-match messages that still use locked directParts
  useEffect(() => {
    const pending = messages.filter(
      (m) => m.isMultipleMatch && m.directParts && m.directParts.length > 0,
    );
    if (pending.length === 0) return;

    const preSelectUpdates: Record<string, Record<string, string[]>> = {};
    setMessages((prev) =>
      prev.map((m) => {
        if (!m.isMultipleMatch || !m.directParts?.length) return m;
        const { groups, preSelected } = mergeDirectPartsIntoGroupedServices(
          m.groupedServices || [],
          m.directParts,
        );
        if (Object.keys(preSelected).length > 0) {
          preSelectUpdates[m.id] = preSelected;
        }
        return { ...m, groupedServices: groups, directParts: undefined };
      }),
    );
    if (Object.keys(preSelectUpdates).length > 0) {
      setSelectedServices((prev) => ({ ...prev, ...preSelectUpdates }));
    }
  }, [messages]);

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

  // Thin wrapper: reads the isolated draft and delegates to sendMessageWithContent
  const handleSendMessage = () => {
    const text = getInputValue();
    if (!text.trim() || isLoading) return;
    // Don't save pure city-only queries (e.g. "chennai", "madurai") — they just open
    // the service list and are not useful to recall via arrow-up history.
    if (detectCityOnlyQuery(text).length === 0) {
      pushToHistory(text);
    }
    setInputValue('');
    // Ensure image lightbox never traps the composer after send
    closeChipImagePreview();
    sendMessageWithContent(text);
  };

  // ── Command History: keyboard Up/Down navigation ───────────────────────────
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (inputHistory.length === 0) return;

    const el = inputRef.current;
    const cursorPos = el?.selectionStart ?? 0;
    const valueLen = getInputValue().length;

    if (e.key === 'ArrowUp' && cursorPos === 0) {
      e.preventDefault();
      const newIdx = historyIndex === -1
        ? inputHistory.length - 1
        : Math.max(0, historyIndex - 1);
      if (historyIndex === -1) setDraftInput(getInputValue());
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

  /** Quantity and duration gates, then confirm table. */
  const applyMinQtyGateOrConfirmTable = async (
    messageId: string,
    rows: Array<{ service: string; qty: number | string; city: string; durationDays?: number }>,
    originalUserInput: string,
  ) => {
    let dbServices: DbService[] = [];
    if (USE_CLOUD_DATA) {
      try {
        const { loadAllServicesFromCloud } = await import('../../services/supabaseProposalService');
        dbServices = (await loadAllServicesFromCloud()) || [];
      } catch {
        console.warn('⚠️ Min-qty gate skipped — could not load cloud catalog');
      }
    }
    const gate = gateMinQtyBeforeConfirm(rows, dbServices, originalUserInput);
    console.log('[DurationDebug] pre-confirm gate', {
      originalUserInput,
      gateType: gate.type,
      rows,
    });
    if (gate.type === 'min_qty') {
      // Compute above-min rows for display (green rows) — display-only, not used by handlers
      const violationDescs = new Set(gate.violations.map(v => v.description.toLowerCase()));
      const aboveMinItems = gate.rows
        .filter(row => !violationDescs.has(`${row.service} - ${row.city}`.toLowerCase()))
        .map(row => {
          const qty = typeof row.qty === 'number' ? row.qty : parseInt(String(row.qty), 10) || 1;
          const cityHint = row.city && row.city !== '—' ? row.city.toLowerCase() : undefined;
          const resolved = dbServices.length ? resolveServiceIdFromCatalog(row.service, dbServices, cityHint) : null;
          const svc = resolved ? dbServices.find(s => s.service_id === resolved.serviceId) : null;
          const rawMin = svc?.metadata?.min_quantity ?? (svc as any)?.min_quantity;
          const minimum = Number.isFinite(Number(rawMin)) && Number(rawMin) > 1 ? Number(rawMin) : 1;
          return { description: `${row.service} - ${row.city}`, requested: qty, minimum };
        });
      setPendingConfirmGeneration({ rows: gate.rows, originalUserInput, messageId });
      setMinQtyWarning({ items: gate.violations, aboveMinItems, pendingQuote: null as any });
    } else if (gate.type === 'min_duration') {
      showDurationWarningInChat(gate.rows, originalUserInput, gate.violations);
    } else {
      await executeConfirmedGeneration(gate.rows, originalUserInput, messageId);
    }
  };

  /** Unavailable modal → proceed with valid services via DB confirm pipeline (not Gemini). */
  const handleUnavailableProceed = async () => {
    setUnavailableServices([]);

    if (pendingValidConfirm) {
      const pending = pendingValidConfirm;
      setPendingValidConfirm(null);
      setPendingValidMessage(null);
      await applyMinQtyGateOrConfirmTable(
        pending.messageId || Date.now().toString(),
        pending.rows,
        pending.originalUserInput,
      );
      return;
    }

    if (pendingValidMessage) {
      const msg = pendingValidMessage;
      setPendingValidMessage(null);
      const rows = parseMessageToConfirmRows(msg);
      const displayText = msg
        .replace(/^generate\s+quote\s+for\s+/i, '')
        .replace(/\s*\[User has already specified complete service names from checkboxes\]/g, '')
        .replace(/\s*\[QTY_OVERRIDE\]/g, '')
        .trim();
      pushToHistory(displayText);
      if (rows.length > 0) {
        await applyMinQtyGateOrConfirmTable(Date.now().toString(), rows, displayText);
      }
    }
  };

  const appendProgressiveResult = async (
    userMessage: Message | null,
    result: ProgressiveTurnResult,
  ) => {
    setProgressiveSession(result.session);
    // Never quote while Continue (OK) is showing — wait for yes_generate
    if (
      result.quoteRows
      && result.quoteRows.length > 0
      && result.step !== 'did_you_mean'
      && !result.session.needsContinueConfirm
    ) {
      // Skip "Creating your quote..." interim message — go straight to quote
      if (userMessage) {
        setMessages((prev) => [...stripChipImagesFromMessages(prev), userMessage]);
      }
      await generateQuoteFromProgressiveRows(result.quoteRows, result.session.originalText);
      return;
    }

    const sess = result.session;
    const isBatch =
      (sess.batchServiceLabels?.length ?? 0) >= 2
      || (sess.segments?.length ?? 0) >= 2
      || (sess.workQueue?.length ?? 0) > 0;
    const tokenRaw = (sess.browseToken || sess.medium || '').trim();
    const currentService = isBatch && tokenRaw
      ? (
        (sess.batchServiceLabels || []).find(
          (l) => l.toLowerCase() === tokenRaw.toLowerCase(),
        )
        || tokenRaw.replace(/\b\w/g, (c) => c.toUpperCase())
      )
      : undefined;
    const quotedServices = isBatch
      ? [
          ...new Set(
            (sess.collectedRows || [])
              .map((r) => (r.service || '').split('·')[0].trim())
              .filter(Boolean),
          ),
        ]
      : undefined;

    const assistantMsg: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: result.botText,
      timestamp: new Date(),
      isProgressiveChat: true,
      progressiveStep: result.step,
      progressiveOptions: result.options,
      progressiveAllowMulti: result.allowMulti,
      progressiveSession: result.session,
      progressiveAutoConfirmed: isBatch
        ? undefined
        : (result.autoConfirmedList?.length
          ? result.autoConfirmedList
          : result.session.batchServiceLabels),
      progressiveCurrentService: currentService,
      progressiveQuotedServices: quotedServices,
      progressiveBatchRemaining: isBatch ? (sess.workQueue?.length ?? 0) : undefined,
      progressiveUnavailable: result.session.batchUnavailableLabels,
      progressiveUnavailableCity: result.session.city,
      progressiveBelowMin: result.belowMinDetails,
    };
    setMessages((prev) => {
      const stripped = stripChipImagesFromMessages(prev);
      return userMessage
        ? [...stripped, userMessage, assistantMsg]
        : [...stripped, assistantMsg];
    });
  };

  const durationWarningDetails = (violations: MinDurationViolation[]) =>
    violations.map((item) => {
      const dashIdx = item.description.lastIndexOf(' - ');
      return {
        service: dashIdx !== -1 ? item.description.slice(0, dashIdx) : item.description,
        requested: item.requested,
        minimum: item.minimum,
        serviceId: item.serviceId,
      };
    });

  const qtyWarningDetails = (
    violations: MinQtyViolation[],
    rows: Array<{ service: string; serviceId?: string }>,
  ) =>
    violations.map((item) => {
      const dashIdx = item.description.lastIndexOf(' - ');
      const service = dashIdx !== -1 ? item.description.slice(0, dashIdx) : item.description;
      const row = rows.find((r) =>
        (r.serviceId && item.description.toLowerCase().includes(r.service.toLowerCase()))
        || r.service.toLowerCase() === service.toLowerCase()
        || item.description.toLowerCase().includes(r.service.toLowerCase()),
      );
      return {
        service,
        requested: item.requested,
        minimum: item.minimum,
        serviceId: row?.serviceId,
      };
    });

  const showQtyWarningInChat = (
    rows: Array<{ service: string; qty: number | string; city: string; serviceId?: string; durationDays?: number }>,
    originalUserInput: string,
    violations: MinQtyViolation[],
  ) => {
    const details = qtyWarningDetails(violations, rows);
    const last = messages[messages.length - 1];
    const reuseId = last?.progressiveStep === 'min_qty_confirm'
      ? last.id
      : Date.now().toString();
    const nextDrafts: Record<string, string> = {};
    for (const item of details) {
      nextDrafts[item.serviceId || item.service] = String(item.requested);
    }
    const session = {
      ...(progressiveSession || { originalText: originalUserInput, qty: null }),
      originalText: originalUserInput,
      pendingRows: rows,
    };
    setPendingConfirmGeneration({ rows, originalUserInput, messageId: reuseId });
    setPendingDurationInput(null);
    setProgressiveSession(session as ProgressiveSession);
    setMinQtyDrafts((drafts) => ({ ...drafts, [reuseId]: nextDrafts }));
    setMinQtyEditingKey((keys) => ({ ...keys, [reuseId]: null }));
    const assistantMsg: Message = {
      id: reuseId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isProgressiveChat: true,
      progressiveStep: 'min_qty_confirm',
      progressiveAllowMulti: false,
      progressiveBelowMin: details,
      progressiveOptions: [
        { id: 'yes_min', label: 'Yes, use minimums' },
        { id: 'no_min', label: "No, I'll adjust" },
      ],
      progressiveSession: session,
    };
    setMessages((prev) => {
      const prevLast = prev[prev.length - 1];
      if (prevLast?.progressiveStep === 'min_qty_confirm') {
        return prev.map((message, index) => (index === prev.length - 1 ? assistantMsg : message));
      }
      return [...prev, assistantMsg];
    });
  };

  const showDurationWarningInChat = (
    rows: Array<{ service: string; qty: number | string; city: string; serviceId?: string; durationDays?: number }>,
    originalUserInput: string,
    violations: MinDurationViolation[],
  ) => {
    const details = durationWarningDetails(violations);
    const last = messages[messages.length - 1];
    const reuseId = last?.progressiveStep === 'min_duration_confirm'
      ? last.id
      : Date.now().toString();
    const nextDrafts: Record<string, string> = {};
    for (const item of details) {
      nextDrafts[item.serviceId || item.service] = String(item.requested);
    }
    const session = {
      ...(progressiveSession || { originalText: originalUserInput, qty: null }),
      originalText: originalUserInput,
      pendingRows: rows,
    };
    setPendingConfirmGeneration({ rows, originalUserInput, messageId: reuseId });
    setPendingDurationInput(null);
    setMinDurationWarning(null);
    setProgressiveSession(session as ProgressiveSession);
    setMinDurationDrafts((drafts) => ({ ...drafts, [reuseId]: nextDrafts }));
    setMinDurationEditingKey((keys) => ({ ...keys, [reuseId]: null }));
    const assistantMsg: Message = {
      id: reuseId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isProgressiveChat: true,
      progressiveStep: 'min_duration_confirm',
      progressiveAllowMulti: false,
      progressiveBelowMinDuration: details,
      progressiveOptions: [
        { id: 'yes_min_duration', label: 'Yes, use minimums' },
        { id: 'no_min_duration', label: "No, I'll adjust" },
      ],
      progressiveSession: session,
    };
    setMessages((prev) => {
      const prevLast = prev[prev.length - 1];
      if (prevLast?.progressiveStep === 'min_duration_confirm') {
        return prev.map((message, index) => (index === prev.length - 1 ? assistantMsg : message));
      }
      return [...prev, assistantMsg];
    });
  };

  const rowMatchesAdjustDetail = (
    row: { service: string; serviceId?: string },
    item: { service: string; serviceId?: string },
  ) =>
    (item.serviceId && row.serviceId && item.serviceId === row.serviceId)
    || item.service.toLowerCase() === row.service.toLowerCase()
    || row.service.toLowerCase().includes(item.service.toLowerCase())
    || item.service.toLowerCase().includes(row.service.toLowerCase());

  const applyDurationToWarnedRows = (
    rows: Array<{ service: string; qty: number | string; city: string; serviceId?: string; durationDays?: number }>,
    details: Array<{ service: string; requested: number; minimum: number; serviceId?: string }>,
    days: number,
  ) => {
    if (!details.length) return rows.map((row) => ({ ...row, durationDays: days }));
    return rows.map((row) => (
      details.some((item) => rowMatchesAdjustDetail(row, item))
        ? { ...row, durationDays: days }
        : row
    ));
  };

  const applyQtyToWarnedRows = (
    rows: Array<{ service: string; qty: number | string; city: string; serviceId?: string; durationDays?: number }>,
    details: Array<{ service: string; requested: number; minimum: number; serviceId?: string }>,
    qty: number,
  ) => {
    if (!details.length) return rows.map((row) => ({ ...row, qty }));
    return rows.map((row) => (
      details.some((item) => rowMatchesAdjustDetail(row, item))
        ? { ...row, qty }
        : row
    ));
  };

  const generateQuoteFromProgressiveRows = async (
    rows: Array<{ service: string; qty: number | string; city: string; serviceId?: string; durationDays?: number }>,
    originalUserInput: string,
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      const { loadAllServicesFromCloud } = await import('../../services/supabaseProposalService');
      const { buildQuoteFromConfirmedRows } = await import('../../utils/buildQuoteFromConfirmedRows');
      const dbServices = (await loadAllServicesFromCloud()) || [];
      const uniqueRows = dedupeConfirmationRows(rows);
      const qtyViolations = validateConfirmationRowsMinQty(uniqueRows, dbServices);
      if (qtyViolations.length > 0) {
        showQtyWarningInChat(uniqueRows, originalUserInput, qtyViolations);
        setIsLoading(false);
        return;
      }
      const durationViolations = validateConfirmationRowsMinDuration(
        uniqueRows,
        dbServices,
        originalUserInput,
      );
      console.log('[DurationDebug] progressive gate', {
        originalUserInput,
        rows: uniqueRows,
        violationCount: durationViolations.length,
        durationViolations,
      });
      if (durationViolations.length > 0) {
        showDurationWarningInChat(uniqueRows, originalUserInput, durationViolations);
        setIsLoading(false);
        return;
      }
      const result = buildQuoteFromConfirmedRows(
        uniqueRows,
        dbServices,
        originalUserInput,
      );
      if (!result.success) {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'assistant',
            content: `I couldn't build that quote: ${result.message}. Happy to try again if you'd like.`,
            timestamp: new Date(),
            isError: true,
          },
        ]);
        return;
      }
      setCurrentQuote(result.quote);
      loadCloudServices().catch(() => undefined);
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Your quotation is ready.\nOpening quotation preview.',
          timestamp: new Date(),
        },
      ]);
      setProgressiveSession(null);
      setTimeout(() => {
        history.push('/preview');
      }, 1000);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: err instanceof Error ? err.message : 'Quote failed.',
          timestamp: new Date(),
          isError: true,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  type AdjustPendingRow = {
    service: string;
    qty: number | string;
    city: string;
    serviceId?: string;
    durationDays?: number;
  };

  const getAdjustRows = (source?: Message | null): AdjustPendingRow[] =>
    (source?.progressiveSession?.pendingRows
      || progressiveSession?.pendingRows
      || pendingConfirmGeneration?.rows
      || pendingDurationInput?.rows
      || []) as AdjustPendingRow[];

  const getAdjustOriginalText = (source?: Message | null): string =>
    source?.progressiveSession?.originalText
    || progressiveSession?.originalText
    || pendingConfirmGeneration?.originalUserInput
    || pendingDurationInput?.originalUserInput
    || '';

  const applyTypedQtyAndContinue = async (qty: number, source?: Message | null) => {
    const rows = getAdjustRows(source);
    const details = source?.progressiveBelowMin || [];
    const updated = applyQtyToWarnedRows(rows, details, qty);
    setPendingDurationInput(null);
    await generateQuoteFromProgressiveRows(updated, getAdjustOriginalText(source));
  };

  const applyTypedDurationAndContinue = async (days: number, source?: Message | null) => {
    const rows = getAdjustRows(source);
    const details = source?.progressiveBelowMinDuration
      || pendingDurationInput?.violations.map((item) => ({
        service: item.description,
        requested: item.requested,
        minimum: item.minimum,
        serviceId: item.serviceId,
      }))
      || [];
    const updated = applyDurationToWarnedRows(rows, details, days);
    setPendingDurationInput(null);
    setMinDurationWarning(null);
    await generateQuoteFromProgressiveRows(updated, getAdjustOriginalText(source));
  };

  const askQtyOrDaysClarify = (value: number, source?: Message | null) => {
    const session = {
      ...(source?.progressiveSession || progressiveSession || { originalText: getAdjustOriginalText(source), qty: null }),
      pendingRows: getAdjustRows(source),
    };
    const assistantMsg: Message = {
      id: Date.now().toString(),
      role: 'assistant',
      content: `Did you mean ${value} qty or ${value} days?`,
      timestamp: new Date(),
      isProgressiveChat: true,
      progressiveStep: 'qty_or_duration_clarify',
      progressiveAllowMulti: false,
      progressiveOptions: [
        { id: `adjust_as_qty:${value}`, label: `${value} qty` },
        { id: `adjust_as_days:${value}`, label: `${value} days` },
      ],
      progressiveBelowMin: source?.progressiveBelowMin,
      progressiveBelowMinDuration: source?.progressiveBelowMinDuration,
      progressiveSession: session,
    };
    setProgressiveSession(session as ProgressiveSession);
    setMessages((prev) => [...prev, assistantMsg]);
  };

  const parseQtyOrDurationAdjust = (
    text: string,
  ):
    | { kind: 'qty'; value: number }
    | { kind: 'duration'; days: number }
    | { kind: 'ambiguous'; value: number }
    | { kind: 'none' } => {
    const t = text.trim();
    const qtyExplicit = t.match(
      /^(?:use|set|change\s+to|make\s+it|give)?\s*(?:(\d+)\s*(?:qty|quantity|units?|pcs|nos?\.?)|(?:qty|quantity|units?)\s*[:=]?\s*(\d+))\s*$/i,
    );
    if (qtyExplicit) {
      const n = parseInt(qtyExplicit[1] || qtyExplicit[2], 10);
      if (Number.isFinite(n) && n > 0) return { kind: 'qty', value: n };
    }
    const parsed = parseDurationFromUserText(t);
    const days = toCampaignDays(parsed?.value, parsed?.unit);
    if (days != null && days > 0 && /\d+\s*(days?|months?|mos?\.?)/i.test(t)) {
      return { kind: 'duration', days };
    }
    const bare = t.match(/^(?:use|set|change\s+to|make\s+it|give|for)?\s*(\d+)\s*$/i);
    if (bare) {
      const n = parseInt(bare[1], 10);
      if (Number.isFinite(n) && n > 0) return { kind: 'ambiguous', value: n };
    }
    return { kind: 'none' };
  };

  const handleProgressiveOptionClick = async (
    message: Message,
    optionId: string,
  ) => {
    if (isLoading) return;
    const session = message.progressiveSession || progressiveSession;
    if (!session) return;

    const qtyChip = optionId.match(/^adjust_as_qty:(\d+)$/);
    if (qtyChip) {
      await applyTypedQtyAndContinue(parseInt(qtyChip[1], 10), message);
      return;
    }
    const daysChip = optionId.match(/^adjust_as_days:(\d+)$/);
    if (daysChip) {
      await applyTypedDurationAndContinue(parseInt(daysChip[1], 10), message);
      return;
    }

    if (optionId === 'no_min') {
      window.setTimeout(() => {
        inputRef.current?.focus({ preventScroll: true });
      }, 50);
      return;
    }

    if (optionId === 'yes_min_duration') {
      const details = message.progressiveBelowMinDuration || [];
      const rows = (session.pendingRows || pendingConfirmGeneration?.rows || []) as Array<{
        service: string;
        qty: number | string;
        city: string;
        serviceId?: string;
        durationDays?: number;
      }>;
      const updatedRows = rows.map((row) => {
        const match = details.find((item) =>
          (item.serviceId && row.serviceId && item.serviceId === row.serviceId)
          || item.service.toLowerCase() === row.service.toLowerCase()
          || row.service.toLowerCase().includes(item.service.toLowerCase())
          || item.service.toLowerCase().includes(row.service.toLowerCase()),
        );
        return match ? { ...row, durationDays: match.minimum } : row;
      });
      setPendingDurationInput(null);
      setMinDurationWarning(null);
      setPendingConfirmGeneration(null);
      await generateQuoteFromProgressiveRows(updatedRows, session.originalText);
      return;
    }

    if (optionId === 'no_min_duration') {
      const details = message.progressiveBelowMinDuration || [];
      const rows = (session.pendingRows || pendingConfirmGeneration?.rows || []) as Array<{
        service: string;
        qty: number | string;
        city: string;
        serviceId?: string;
        durationDays?: number;
      }>;
      setPendingDurationInput({
        rows,
        originalUserInput: session.originalText,
        messageId: message.id,
        violations: details.map((item) => ({
          description: item.service,
          requested: item.requested,
          minimum: item.minimum,
          serviceId: item.serviceId,
        })),
      });
      window.setTimeout(() => {
        inputRef.current?.focus({ preventScroll: true });
      }, 50);
      return;
    }

    if (message.progressiveAllowMulti) {
      // Toggle handled in chip UI — do not navigate yet
      return;
    }

    setIsLoading(true);
    try {
      const dbServices = await getCachedDbServices();
      const result = continueProgressiveAction(optionId, session, dbServices);
      // No echo bubble for chip selections — bot's reply conveys what was chosen
      await appendProgressiveResult(null, result);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleProgressiveMultiConfirm = async (message: Message) => {
    if (isLoading) return;
    const session = message.progressiveSession || progressiveSession;
    if (!session) return;
    const selected = progressiveMultiSelect[message.id] || [];
    if (selected.length === 0) return;

    setIsLoading(true);
    try {
      const dbServices = await getCachedDbServices();
      const result = continueProgressiveAction(
        selected[0],
        session,
        dbServices,
        selected,
      );
      // Keep the selection snapshot so the completed checklist remains
      // visibly selected after the funnel advances. The card is made
      // read-only by the render layer once a newer progressive message exists.
      // No echo bubble for confirm — bot's reply confirms the selection
      await appendProgressiveResult(null, result);
    } finally {
      setIsLoading(false);
    }
  };

  const minQtyItemKey = (item: { service: string; serviceId?: string }) =>
    item.serviceId || item.service;

  /** Apply pencil qty edits — re-ask same card if still below min, else quote. */
  const applyMinQtyPencilEdits = async (message: Message) => {
    if (isLoading || minQtyApplyLock.current) return;
    const session = message.progressiveSession || progressiveSession;
    const details = message.progressiveBelowMin;
    if (!session || !details?.length) return;

    const drafts = minQtyDrafts[message.id] || {};
    const edits: Record<string, number> = {};
    for (const item of details) {
      const key = minQtyItemKey(item);
      const raw = drafts[key];
      if (raw == null || String(raw).trim() === '') continue;
      const n = parseInt(String(raw).replace(/,/g, ''), 10);
      if (Number.isFinite(n) && n > 0) edits[key] = n;
    }
    if (Object.keys(edits).length === 0) {
      setMinQtyEditingKey((prev) => ({ ...prev, [message.id]: null }));
      return;
    }

    minQtyApplyLock.current = true;
    setIsLoading(true);
    setMinQtyEditingKey((prev) => ({ ...prev, [message.id]: null }));
    try {
      const result = resolveMinQtyEdits(session, edits, details);
      setProgressiveSession(result.session);

      if (result.quoteRows && result.quoteRows.length > 0) {
        setMinQtyDrafts((prev) => {
          const next = { ...prev };
          delete next[message.id];
          return next;
        });
        await generateQuoteFromProgressiveRows(result.quoteRows, result.session.originalText);
        return;
      }

      // Same-card re-ask — patch this message in place
      setMessages((prev) =>
        prev.map((m) =>
          m.id === message.id
            ? {
                ...m,
                content: result.botText,
                progressiveBelowMin: result.belowMinDetails,
                progressiveOptions: result.options,
                progressiveSession: result.session,
                progressiveStep: result.step,
                timestamp: new Date(),
              }
            : m,
        ),
      );
      // Seed drafts with new requested values
      const nextDrafts: Record<string, string> = {};
      for (const d of result.belowMinDetails || []) {
        nextDrafts[minQtyItemKey(d)] = String(d.requested);
      }
      setMinQtyDrafts((prev) => ({ ...prev, [message.id]: nextDrafts }));
    } finally {
      setIsLoading(false);
      minQtyApplyLock.current = false;
    }
  };

  const applyMinDurationPencilEdits = async (message: Message) => {
    if (isLoading || minDurationApplyLock.current) return;
    const session = message.progressiveSession || progressiveSession;
    const details = message.progressiveBelowMinDuration;
    if (!session || !details?.length) return;

    const drafts = minDurationDrafts[message.id] || {};
    const rows = (session.pendingRows || pendingConfirmGeneration?.rows || []) as Array<{
      service: string;
      qty: number | string;
      city: string;
      serviceId?: string;
      durationDays?: number;
    }>;
    const stillBelow: Array<{ service: string; requested: number; minimum: number; serviceId?: string }> = [];
    let changed = false;
    const updatedRows = rows.map((row) => {
      const item = details.find((detail) =>
        (detail.serviceId && row.serviceId && detail.serviceId === row.serviceId)
        || detail.service.toLowerCase() === row.service.toLowerCase()
        || row.service.toLowerCase().includes(detail.service.toLowerCase())
        || detail.service.toLowerCase().includes(row.service.toLowerCase()),
      );
      if (!item) return row;
      const key = minQtyItemKey(item);
      const raw = drafts[key];
      if (raw == null || String(raw).trim() === '') {
        return { ...row, durationDays: item.requested };
      }
      const n = parseInt(String(raw).replace(/,/g, ''), 10);
      if (!Number.isFinite(n) || n <= 0) return row;
      changed = true;
      if (n < item.minimum) {
        stillBelow.push({ ...item, requested: n });
      }
      return { ...row, durationDays: n };
    });

    if (!changed) {
      setMinDurationEditingKey((prev) => ({ ...prev, [message.id]: null }));
      return;
    }

    minDurationApplyLock.current = true;
    setIsLoading(true);
    setMinDurationEditingKey((prev) => ({ ...prev, [message.id]: null }));
    try {
      setProgressiveSession({ ...session, pendingRows: updatedRows });
      if (stillBelow.length > 0) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === message.id
              ? {
                  ...m,
                  progressiveBelowMinDuration: stillBelow,
                  progressiveOptions: [
                    { id: 'yes_min_duration', label: 'Yes, use minimums' },
                    { id: 'no_min_duration', label: "No, I'll adjust" },
                  ],
                  progressiveSession: { ...session, pendingRows: updatedRows },
                  timestamp: new Date(),
                }
              : m,
          ),
        );
        const nextDrafts: Record<string, string> = {};
        for (const item of stillBelow) {
          nextDrafts[minQtyItemKey(item)] = String(item.requested);
        }
        setMinDurationDrafts((prev) => ({ ...prev, [message.id]: nextDrafts }));
        return;
      }
      setPendingDurationInput(null);
      setMinDurationWarning(null);
      await generateQuoteFromProgressiveRows(updatedRows, session.originalText);
    } finally {
      setIsLoading(false);
      minDurationApplyLock.current = false;
    }
  };

  // Core send logic — accepts text directly, no reliance on inputValue state
  const sendMessageWithContent = async (text: string) => {
    if (!text.trim() || isLoading) return;

    // Qty / duration adjust: "5 qty" → quantity, "5 days" → duration,
    // bare "5" → ask which. Then re-run min qty then min duration gates.
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    const inMinAdjust =
      !!pendingDurationInput
      || lastAssistant?.progressiveStep === 'min_qty_confirm'
      || lastAssistant?.progressiveStep === 'min_duration_confirm'
      || lastAssistant?.progressiveStep === 'qty_or_duration_clarify'
      || (lastAssistant?.progressiveBelowMin?.length ?? 0) > 0
      || (lastAssistant?.progressiveBelowMinDuration?.length ?? 0) > 0;
    if (inMinAdjust && lastAssistant) {
      const parsedAdjust = parseQtyOrDurationAdjust(text.trim());
      if (parsedAdjust.kind !== 'none') {
        setInputValue('');
        pushToHistory(text.trim());
        const adjustUserMsg: Message = {
          id: Date.now().toString(),
          role: 'user',
          content: text.trim(),
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, adjustUserMsg]);
        if (parsedAdjust.kind === 'ambiguous') {
          askQtyOrDaysClarify(parsedAdjust.value, lastAssistant);
          return;
        }
        if (parsedAdjust.kind === 'qty') {
          await applyTypedQtyAndContinue(parsedAdjust.value, lastAssistant);
          return;
        }
        await applyTypedDurationAndContinue(parsedAdjust.days, lastAssistant);
        return;
      }
    }

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

    // ─── PROGRESSIVE CHAT (primary) ──────────────────────────────────────────
    if (USE_PROGRESSIVE_CHAT && USE_CLOUD_DATA && !isQtyOverride && !isCheckboxConfirmedFlag) {
      setInputValue('');
      pushToHistory(cleanedText);
      setIsLoading(true);
      setError(null);
      closeChipImagePreview();
      // Clear prior chip thumbs immediately so the UI stays responsive
      setMessages((prev) => [...stripChipImagesFromMessages(prev), userMessage]);
      try {
        const { loadAllServicesFromCloud } = await import('../../services/supabaseProposalService');
        const {
          getCatalogTypeKeys,
          getCatalogCities,
          canSkipChatIntentAi,
        } = await import('../../utils/progressiveChatEngine');
        if (!catalogCacheRef.current) {
          catalogLoadRef.current ??= loadAllServicesFromCloud()
            .then((services) => services || [])
            .finally(() => {
              catalogLoadRef.current = null;
            });
          catalogCacheRef.current = await catalogLoadRef.current;
        }
        const dbServices = catalogCacheRef.current;
        const catalogTypes = getCatalogTypeKeys(dbServices);
        const catalogCities = getCatalogCities(dbServices);

        // Let the typing indicator paint before heavy sync matching (prevents "Page Unresponsive")
        await new Promise<void>((r) => {
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => requestAnimationFrame(() => r()));
          } else {
            setTimeout(r, 0);
          }
        });

        let intent = null as Awaited<
          ReturnType<typeof import('../../services/chatIntentAiService').parseChatIntentWithAi>
        >;
        // Skip Gemini for clear city / media / multi-service — was blocking every send ~3.5s
        const skipAi = canSkipChatIntentAi(cleanedText, dbServices);
        console.log('[funnel-debug] chatIntentGate', {
          text: cleanedText,
          skipAi,
          catalogTypeCount: catalogTypes.length,
          catalogCityCount: catalogCities.length,
          serviceCount: dbServices.length,
          sampleMediums: catalogTypes.slice(0, 20),
        });
        if (!skipAi) {
          try {
            const { parseChatIntentWithAi } = await import('../../services/chatIntentAiService');
            intent = await parseChatIntentWithAi(
              cleanedText,
              { types: catalogTypes, cities: catalogCities },
              10000,
            );
          } catch (err) {
            console.log('[funnel-debug] chatIntentError', err);
            intent = null;
          }
        }
        console.log('[funnel-debug] chatIntentResult', {
          skipped: skipAi,
          intent: intent
            ? {
                kind: intent.kind,
                media: intent.media,
                medium: intent.medium,
                city: intent.city,
                areaHint: intent.areaHint,
                directionHint: intent.directionHint,
                ambiguous: intent.ambiguous,
                clarifyHint: intent.clarifyHint,
                shortReply: intent.shortReply,
              }
            : null,
        });

        // Yield again before sync resolve (mega multi-service lists)
        await new Promise<void>((r) => setTimeout(r, 0));

        // Stateful funnel: keep prior locks unless this message switches service.
        // Prefer session from last progressive bot turn (survives remount / history).
        const lastProgMsg = [...messages].reverse().find(
          (m) => m.role === 'assistant' && m.progressiveSession,
        );
        const priorSession: ProgressiveSession | null =
          progressiveSession
          || (lastProgMsg?.progressiveSession as ProgressiveSession | undefined)
          || null;

        // ── Typed chip / yes-no / min-qty reply → same as tapping ──
        // Skip when message names a *different* catalog service (fresh switch).
        // Also skip chip match on bare same-service echo ("hoarding" while in Hoarding)
        // so area chips that carry medium=hoarding are not mistaken for a pick.
        const localMedia = detectMediaLocal(cleanedText, dbServices);
        const namesCatalogService = isNewServiceSwitch(priorSession, localMedia);
        const mediaKey = canonicalizeServiceName(localMedia[0] || '');
        const textKey = canonicalizeServiceName(cleanedText);
        const priorMedKey = canonicalizeServiceName(
          priorSession?.medium || priorSession?.browseToken || '',
        );
        // Bare echo of the *active* family/medium ("hoarding", "auto") — skip chip
        // match so area chips carrying medium=hoarding are not stolen.
        // More-specific picks ("auto full" while browseToken=auto) must still match chips.
        const sameServiceBareEcho =
          !!priorSession
          && !!mediaKey
          && !!priorMedKey
          && !namesCatalogService
          && !detectLocalityInText(cleanedText, dbServices)
          && (
            textKey === priorMedKey
            || mediaKey === priorMedKey
          )
          && !(
            textKey.length > priorMedKey.length
            && (
              textKey.startsWith(`${priorMedKey} `)
              || mediaKey.startsWith(`${priorMedKey} `)
            )
          );
        if (
          priorSession
          && lastProgMsg?.progressiveOptions?.length
          && !namesCatalogService
          && !sameServiceBareEcho
        ) {
          // Area/place answers (omr, near ecr) must refine the funnel — never
          // mistype-match a long direction chip that merely starts with "OMR".
          const localityAnswer = detectLocalityInText(cleanedText, dbServices);
          const matched = localityAnswer
            ? null
            : matchFreeTextToProgressiveOption(
              cleanedText,
              lastProgMsg.progressiveOptions as ProgressiveOption[],
            );
          if (matched) {
            const result = continueProgressiveAction(
              matched.id,
              priorSession,
              dbServices,
            );
            await appendProgressiveResult(null, result);
            return;
          }
        }

        const result = resolveProgressiveText(
          cleanedText,
          dbServices,
          priorSession,
          intent
            ? {
                kind: intent.kind,
                media: intent.media,
                medium: intent.medium,
                city: intent.city,
                areaHint: intent.areaHint,
                directionHint: intent.directionHint,
                ambiguous: intent.ambiguous,
                clarifyHint: intent.clarifyHint,
                qty: intent.qty,
                duration: intent.duration,
                shortReply: intent.shortReply,
              }
            : null,
        );
        await appendProgressiveResult(null, result);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: err instanceof Error ? err.message : 'Something went wrong.',
            timestamp: new Date(),
            isError: true,
            failedInput: cleanedText,
          },
        ]);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Needed by CLOUD CITY GATE (legacy path)
    const isQuoteRequest = /\b(generate|create|quote|price|cost|for)\b/i.test(cleanedText)
      || /\b\d+\b/.test(cleanedText)
      || /\b(branding|advertising|signage|hoarding|banner|sticker|shelter|panel|board|printing|display|wrapping)\b/i.test(cleanedText)
      || VEHICLE_CATEGORY_PATTERN.test(cleanedText)
      || isVagueCategoryQuery(cleanedText);

    // ─── CITY-ONLY QUERY GATE ────────────────────────────────────────────────
    if (!isQtyOverride && !isCheckboxConfirmedFlag) {
      let cityOnlyDbServices: DbService[] = [];
      if (USE_CLOUD_DATA) {
        try {
          const { loadAllServicesFromCloud } = await import('../../services/supabaseProposalService');
          cityOnlyDbServices = (await loadAllServicesFromCloud()) || [];
        } catch {
          // DB unavailable — no city list
        }
      }
      const cityOnlyMatches = detectCityOnlyQuery(cleanedText, cityOnlyDbServices);
      if (cityOnlyMatches.length > 0) {
        let lists: Array<{ city: string; services: Array<{ name: string; minQty: number }> }> = [];

        if (USE_CLOUD_DATA && cityOnlyDbServices.length > 0) {
          lists = cityOnlyMatches
            .map(cityKey => buildCityServiceListFromDb(cityKey, cityOnlyDbServices))
            .filter((x): x is { city: string; services: Array<{ name: string; minQty: number }> } => !!x);
        }

        console.log('🔍 [CityList] source=VENDOR_DB', {
          cities: cityOnlyMatches,
          vendorDbCount: cityOnlyDbServices.length,
          listCount: lists.reduce((n, l) => n + l.services.length, 0),
        });

        if (lists.length > 0) {
          const assistantMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: lists.length === 1
              ? `I understand you're looking in ${lists[0].city}. Here's everything we offer — tap any to start a quote:`
              : `I understand — here's what we offer in ${lists.map(l => l.city).join(', ')}. Tap any to start a quote:`,
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

    // ─── CLOUD CITY GATE (DB-backed — all quote requests when catalog loaded) ──
    if (
      USE_CLOUD_DATA &&
      !isQtyOverride &&
      !isCheckboxConfirmedFlag &&
      isQuoteRequest
    ) {
      try {
        const { loadAllServicesFromCloud } = await import('../../services/supabaseProposalService');
        prefetchedDbServices = await loadAllServicesFromCloud();
        const dbList = (prefetchedDbServices || []) as DbService[];

        if (dbList.length > 0) {
          const dynamicCities = getMergedDynamicCities(dbList);
          const cityDetectionList = getCityDetectionList(dbList);
          const isMultiSegment = isMultiSegmentQuoteRequest(cleanedText);
          const isVagueWhole = isVagueCategoryQuery(cleanedText);
          const knownCityWhole = detectKnownCityInText(cleanedText, dbList);

          // ── Single-segment vague with no city (e.g. "bus") → always city picker ──
          if (!isMultiSegment && isVagueWhole && !knownCityWhole) {
            const cloudCities = getCitiesForServiceQuery(cleanedText, dbList);

            if (cloudCities.length >= 1) {
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
                content: cloudCities.length >= 2
                  ? 'I understand — this service is available in multiple cities. Which city should I prepare for?'
                  : 'I understand — please select your city and I’ll show what’s available:',
                timestamp: new Date(),
                isCityPicker: true,
              };
              setMessages(prev => [...prev, userMessage, pickerMsg]);
              setInputValue('');
              setCityPickerState({
                messageId: pickerMsgId,
                originalMessage: cleanedText,
                segments,
                availableCities: cloudCities.length >= 2 ? cloudCities : dynamicCities,
                dbServices: dbList,
                requireServiceSelection: true,
              });
              return;
            }
          }

          // ── Multi-segment OR single segment with city in text ──
          const rawSegments = parseSegmentsForCity(cleanedText, cityDetectionList);
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
              content: 'I understand — please select the city for each service below so I can prepare your quote:',
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

          if (MULTI_SVC_DEBUG) {
            console.log('[MultiSvcDebug] ── ChatInterface parse ──', {
              cleanedText,
              rawSegmentCount: rawSegments.length,
              plannedSegmentCount: segments.length,
              resolvedRowCount: resolvedRows.length,
              citylessDropped: segments.filter((s) => !s.detectedCity).map((s) => s.raw),
              resolvedRows,
            });
          }

          if (resolvedRows.length > 0) {
            const cloudResult = runCloudPreGeminiValidation(resolvedRows, dbList);

            if (MULTI_SVC_DEBUG) {
              console.log('[MultiSvcDebug] ── ChatInterface branch decision ──', {
                inputSegments: resolvedRows.length,
                specific: cloudResult.validSegmentLabels.length,
                vagueGroups: cloudResult.vagueGroups.length,
                notFound: cloudResult.preAlerts.length,
                belowMin: cloudResult.belowMinSegments.length,
                willShowUnavailableOnly:
                  cloudResult.preAlerts.length > 0 && cloudResult.vagueGroups.length === 0,
                willShowMinQtyGate:
                  cloudResult.belowMinSegments.length > 0 && !isQtyOverride,
                willShowCheckboxUI: cloudResult.vagueGroups.length > 0,
                willGoStraightToConfirm:
                  cloudResult.validSegmentLabels.length > 0 &&
                  cloudResult.vagueGroups.length === 0 &&
                  cloudResult.belowMinSegments.length === 0,
              });
            }

            // ── Vague checkboxes FIRST (never skip them for min-qty) ──
            // Min-qty still runs later in applyMinQtyGateOrConfirmTable after Review & Confirm.
            if (cloudResult.vagueGroups.length > 0) {
              if (MULTI_SVC_DEBUG) {
                console.log('[MultiSvcDebug] BRANCH → checkbox UI (vague before min-qty)', {
                  directParts: cloudResult.validSegmentLabels,
                  vagueGroups: cloudResult.vagueGroups.map((g) => ({
                    group: g.vehicleType,
                    services: g.services.map((s) => s.name),
                  })),
                  notFoundAlso: cloudResult.preAlerts,
                  belowMinDeferred: cloudResult.belowMinSegments.length,
                });
              }
              if (cloudResult.preAlerts.length > 0) {
                setUnavailableServices(cloudResult.preAlerts);
              }
              const assistantId = Date.now().toString();
              const assistantMsg = prepareMultipleMatchMessage({
                id: assistantId,
                role: 'assistant',
                content: 'I understand — a few matching services came up. Select all you need for the quote:',
                timestamp: new Date(),
                isMultipleMatch: true,
                groupedServices: mergeGroupedServicesByCategory(cloudResult.vagueGroups),
                originalUserInput: cleanedText,
                directParts: cloudResult.validSegmentLabels.length > 0
                  ? cloudResult.validSegmentLabels
                  : undefined,
              });
              if (MULTI_SVC_DEBUG) {
                const checkboxCount = (assistantMsg.groupedServices || []).reduce(
                  (n, g) => n + g.services.length,
                  0,
                );
                console.log('[MultiSvcDebug] checkbox message prepared', {
                  messageId: assistantMsg.id,
                  groupCount: assistantMsg.groupedServices?.length ?? 0,
                  checkboxOptionCount: checkboxCount,
                  directPartsCleared: !assistantMsg.directParts,
                });
              }
              setMessages(prev => [...prev, userMessage, assistantMsg]);
              setInputValue('');
              return;
            }

            // ── Partial invalid (no vague left) ──
            if (
              cloudResult.preAlerts.length > 0 &&
              cloudResult.vagueGroups.length === 0
            ) {
              if (MULTI_SVC_DEBUG) {
                console.log('[MultiSvcDebug] BRANCH → unavailable/partial (no checkboxes)', {
                  alerts: cloudResult.preAlerts,
                  kept: cloudResult.validSegmentLabels,
                });
              }
              setMessages(prev => [...stripChipImagesFromMessages(prev), userMessage]);
              setInputValue('');
              setUnavailableServices(cloudResult.preAlerts);
              if (cloudResult.validSegmentLabels.length === 0) {
                return;
              }
              const partialRows = labelsToConfirmRows(cloudResult.validSegmentLabels);
              if (partialRows.length > 0) {
                setPendingValidConfirm({
                  rows: partialRows,
                  originalUserInput: cleanedText,
                  messageId: userMessage.id,
                });
                setPendingValidMessage(null);
              } else {
                setPendingValidMessage(cloudResult.validSegmentRaws.join(' and '));
              }
              return;
            }

            if (cloudResult.belowMinSegments.length > 0 && !isQtyOverride) {
              if (MULTI_SVC_DEBUG) {
                console.log('[MultiSvcDebug] BRANCH → min-qty gate', {
                  belowMin: cloudResult.belowMinSegments,
                  specificLabels: cloudResult.validSegmentLabels,
                });
              }
              if (cloudResult.preAlerts.length > 0) {
                setUnavailableServices(cloudResult.preAlerts);
              }
              setMessages(prev => [...stripChipImagesFromMessages(prev), userMessage]);
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
              return;
            }

            if (
              cloudResult.validSegmentLabels.length > 0 &&
              cloudResult.vagueGroups.length === 0 &&
              cloudResult.belowMinSegments.length === 0
            ) {
              setMessages(prev => [...stripChipImagesFromMessages(prev), userMessage]);
              setInputValue('');
              const confirmRows = labelsToConfirmRows(cloudResult.validSegmentLabels);
              if (confirmRows.length > 0) {
                await applyMinQtyGateOrConfirmTable(userMessage.id, confirmRows, cleanedText);
                return;
              }
            }
          }
        }
      } catch (cloudGateErr) {
        console.warn('⚠️ [CloudCityGate] Prefetch failed, continuing:', cloudGateErr);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    closeChipImagePreview();
    setMessages(prev => [...stripChipImagesFromMessages(prev), userMessage]);
    setIsLoading(true);
    setError(null);


    try {
      // Cloud / vendor catalog mode: never call Gemini for chat.
      // Quotes are built from DB confirmations; Gemini is only used for qty-unit labels on Preview.
      console.warn('🚫 [Chat] Gemini disabled for chat. Qty-unit AI is preview-only.');
      const noGeminiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content:
          'Chat AI is disabled. Use city/service selection from the catalog.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, noGeminiMsg]);
      setIsLoading(false);
      return;
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

  const getMultiMatchVisibleLimit = (messageId: string, groupKey: string): number =>
    multiMatchVisibleCount[messageId]?.[groupKey] ?? MULTI_MATCH_PAGE_SIZE;

  const handleShowMoreMultiMatch = (messageId: string, groupKey: string, total: number) => {
    setMultiMatchVisibleCount((prev) => {
      const msgMap = { ...(prev[messageId] || {}) };
      const current = msgMap[groupKey] ?? MULTI_MATCH_PAGE_SIZE;
      msgMap[groupKey] = Math.min(current + MULTI_MATCH_PAGE_SIZE, total);
      return { ...prev, [messageId]: msgMap };
    });
  };

  // Select-all / Clear-all toggle for a service group (operates on currently loaded / shown names)
  const handleServiceSelectAll = (messageId: string, groupKey: string, serviceNames: string[]) => {
    setSelectedServices(prev => {
      const messageMap = { ...(prev[messageId] || {}) };
      const current = messageMap[groupKey] || [];
      const allSelected = serviceNames.length > 0 && serviceNames.every(n => current.includes(n));
      if (allSelected) {
        // Clear only the shown names; keep selections outside the loaded page
        const remaining = current.filter((n) => !serviceNames.includes(n));
        const next = { ...messageMap };
        if (remaining.length === 0) delete next[groupKey];
        else next[groupKey] = remaining;
        return { ...prev, [messageId]: next };
      }
      const merged = Array.from(new Set([...current, ...serviceNames]));
      messageMap[groupKey] = merged;
      return { ...prev, [messageId]: messageMap };
    });
  };

  /** Select / clear currently loaded services across all multi-match groups. */
  const handleServiceSelectAllGlobal = (
    messageId: string,
    groups: Array<{ vehicleType: string; services: Array<{ name: string }> }>,
  ) => {
    const shownByGroup = groups.map((g) => {
      const limit = getMultiMatchVisibleLimit(messageId, g.vehicleType);
      return {
        key: g.vehicleType,
        names: g.services.slice(0, limit).map((s) => s.name),
      };
    });
    const shownNames = shownByGroup.flatMap((g) => g.names);
    setSelectedServices((prev) => {
      const messageMap = { ...(prev[messageId] || {}) };
      const currentlySelected = Object.values(messageMap).flat();
      const allShownSelected =
        shownNames.length > 0 && shownNames.every((n) => currentlySelected.includes(n));
      if (allShownSelected) {
        const next: Record<string, string[]> = {};
        for (const [key, names] of Object.entries(messageMap)) {
          const shownSet = new Set(
            shownByGroup.find((g) => g.key === key)?.names || [],
          );
          const remaining = names.filter((n) => !shownSet.has(n));
          if (remaining.length > 0) next[key] = remaining;
        }
        return { ...prev, [messageId]: next };
      }
      const next = { ...messageMap };
      for (const g of shownByGroup) {
        next[g.key] = Array.from(new Set([...(next[g.key] || []), ...g.names]));
      }
      return { ...prev, [messageId]: next };
    });
  };

  // Confirm city selections → show city-scoped service checkboxes → confirm → min qty → DB quote
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

      // No registry fallback — unavailable when DB has no match
      const svcWord = pair.raw.replace(/\d+/g, '').trim() || pair.raw;
      missingServiceAlerts.push({ city: cityLabel, service: svcWord });
    }
    if (missingServiceAlerts.length > 0) {
      setUnavailableServices(missingServiceAlerts);
      if (directParts.length === 0 && groupedServices.length === 0) {
        setCityPickerState(null);
        setInputValue('');
        return;
      }
      if (directParts.length > 0) {
        const confirmRows = labelsToConfirmRows(directParts as string[]);
        if (confirmRows.length > 0) {
          setPendingValidConfirm({
            rows: confirmRows,
            originalUserInput: pickerSnapshot.originalMessage,
            messageId: '',
          });
          setPendingValidMessage(null);
        }
      }
    }

    setCityPickerState(null);
    setInputValue('');

    const mergedGroups = mergeGroupedServicesByCategory(groupedServices);

    const cityPickerSnapshot = {
      originalMessage: pickerSnapshot.originalMessage,
      segments: pickerSnapshot.segments,
      availableCities: pickerSnapshot.availableCities,
    };

    if (isVagueFlow && mergedGroups.length > 0) {
      const msgId = (Date.now() + 1).toString();
      const assistantMsg = prepareMultipleMatchMessage({
        id: msgId,
        role: 'assistant',
        content: mergedGroups.length === 1
          ? `I understand — a few matching services in ${mergedGroups[0].vehicleType.split('|')[1] || 'your city'}. Select all you need for the quote:`
          : `I understand — matching services across ${mergedGroups.length} groups. Select all you need for the quote:`,
        timestamp: new Date(),
        isMultipleMatch: true,
        groupedServices: mergedGroups,
        originalUserInput: pickerSnapshot.originalMessage,
        directParts,
        cityPickerSnapshot,
      });
      setMessages(prev => [...prev, assistantMsg]);
      return;
    }

    if (directParts.length > 0 && mergedGroups.length === 0) {
      const confirmRows = labelsToConfirmRows(directParts as string[]);
      if (confirmRows.length > 0) {
        const msgId = (Date.now() + 1).toString();
        await runMinQtyGateBeforeConfirm(msgId, confirmRows, pickerSnapshot.originalMessage);
        return;
      }
      const durationMatch = pickerSnapshot.originalMessage.match(/(\d+)\s*(days?|months?)/i);
      const durationSuffix = durationMatch ? ` for ${durationMatch[0]}` : '';
      const combined = `Generate quote for ${directParts.join(' and ')}${durationSuffix} [User has already specified complete service names from checkboxes]`;
      pushToHistory(`Generate quote for ${directParts.join(' and ')}${durationSuffix}`);
      sendMessageWithContent(combined);
      return;
    }

    if (mergedGroups.length === 0) return;

    const msgId = (Date.now() + 1).toString();
    const assistantMsg = prepareMultipleMatchMessage({
      id: msgId,
      role: 'assistant',
      content: `I understand — matching services across ${mergedGroups.length} group${mergedGroups.length !== 1 ? 's' : ''}. Select all you need for the quote:`,
      timestamp: new Date(),
      isMultipleMatch: true,
      groupedServices: mergedGroups,
      originalUserInput: pickerSnapshot.originalMessage,
      directParts,
      cityPickerSnapshot,
    });
    setMessages(prev => [...prev, assistantMsg]);
  };

  const handleSuggestionClick = async (suggestion: string) => {
    setHistoryIndex(-1);
    setDraftInput('');
    await sendMessageWithContent(suggestion);
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
      content: 'I understand — multiple city rate cards are loaded. Please select the city for each service below:',
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

  const handleMinDurationEdit = (index: number) => {
    if (!minDurationWarning) return;
    setEditingDurationIndex(index);
    setEditedDuration(String(minDurationWarning.items[index].requested));
  };

  const handleMinDurationSave = (index: number) => {
    if (!minDurationWarning || editingDurationIndex !== index) return;
    const newDuration = parseInt(editedDuration, 10);
    if (!Number.isFinite(newDuration) || newDuration <= 0) return;
    setMinDurationWarning({
      items: minDurationWarning.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, requested: newDuration } : item,
      ),
    });
    setEditingDurationIndex(null);
    setEditedDuration('');
  };

  const handleMinDurationCancelEdit = () => {
    setEditingDurationIndex(null);
    setEditedDuration('');
  };

  const handleMinDurationClose = () => {
    setMinDurationWarning(null);
    setEditingDurationIndex(null);
    setEditedDuration('');
    setPendingDurationInput(null);
    setPendingConfirmGeneration(null);
  };

  // "No, I'll adjust" keeps the user in chat so they can type a new duration.
  const handleMinDurationContinue = () => {
    if (!minDurationWarning || !pendingConfirmGeneration) return;
    const pending = pendingConfirmGeneration;
    setPendingDurationInput({
      rows: pending.rows,
      originalUserInput: pending.originalUserInput,
      messageId: pending.messageId,
      violations: minDurationWarning.items,
    });
    setMinDurationWarning(null);
    setEditingDurationIndex(null);
    setEditedDuration('');
    setInputValue('');
  };

  const handleMinDurationUseMinimum = async () => {
    if (!minDurationWarning || !pendingConfirmGeneration) return;
    const pending = pendingConfirmGeneration;
    const updatedRows = pending.rows.map((row) => {
      const violation = minDurationWarning.items.find(
        (item) =>
          item.description.toLowerCase().includes(row.service.toLowerCase())
          && (row.city === '—' || item.description.toLowerCase().includes(row.city.toLowerCase())),
      );
      return violation ? { ...row, durationDays: violation.minimum } : row;
    });
    setMinDurationWarning(null);
    setEditingDurationIndex(null);
    setEditedDuration('');
    setPendingDurationInput(null);
    setPendingConfirmGeneration(null);
    await generateQuoteFromProgressiveRows(updatedRows, pending.originalUserInput);
  };

  // Handle min qty warning: user chooses to continue with requested qty
  const handleMinQtyContinue = async () => {
    if (!minQtyWarning) return;
    const pending = pendingValidMessage;
    const currentItems = minQtyWarning.items;
    const aboveMinItems = minQtyWarning.aboveMinItems;
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
        await applyMinQtyGateOrConfirmTable(
          gen.messageId,
          updatedRows,
          gen.originalUserInput,
        );
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
          const displayText = pending
            .replace(/^generate\s+quote\s+for\s+/i, '')
            .replace(/\s*\[User has already specified complete service names from checkboxes\]/g, '')
            .replace(/\s*\[QTY_OVERRIDE\]/g, '')
            .trim();
          const messageId = Date.now().toString();
          await applyMinQtyGateOrConfirmTable(messageId, updatedRows, displayText);
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
        const next = { ...qItem, quantity: warningItem.requested };
        return { ...next, total: computeQuoteItemTotal(next) };
      }
      return qItem;
    });
    const newSubtotal = updatedQuote.items.reduce((sum, i) => sum + i.total, 0);
    const newGst = newSubtotal * (updatedQuote.gstPercentage / 100);
    updatedQuote.subtotal = newSubtotal;
    updatedQuote.gstAmount = newGst;
    updatedQuote.total = newSubtotal + newGst;
    setCurrentQuote(updatedQuote);
    setTimeout(() => { history.push('/preview'); }, 1500);
  };

  // Handle min qty warning: user chooses to use minimum quantities
  const handleMinQtyUseMinimum = async () => {
    if (!minQtyWarning) return;
    const pending = pendingValidMessage;
    const currentItems = minQtyWarning.items;
    const aboveMinItems = minQtyWarning.aboveMinItems;
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
        await applyMinQtyGateOrConfirmTable(
          gen.messageId,
          updatedRows,
          gen.originalUserInput,
        );
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
          const displayText = pending
            .replace(/^generate\s+quote\s+for\s+/i, '')
            .replace(/\s*\[User has already specified complete service names from checkboxes\]/g, '')
            .replace(/\s*\[QTY_OVERRIDE\]/g, '')
            .trim();
          const messageId = Date.now().toString();
          await applyMinQtyGateOrConfirmTable(messageId, updatedRows, displayText);
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
        const next = { ...qItem, quantity: useQty };
        return { ...next, total: computeQuoteItemTotal(next) };
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
      content: '✓ Quote ready with catalogue minimums — taking you to the preview.',
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, quoteReadyMessage]);
    setTimeout(() => { history.push('/preview'); }, 1500);
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
  ): { rows: Array<{ service: string; qty: number | string; city: string; serviceId?: string }>; originalUserInput: string } | null => {
    const selected = selectedServices[messageId];
    const assistantMsg = messages.find(m => m.id === messageId);
    const hasSelected = selected && Object.keys(selected).length > 0;
    if (!hasSelected) {
      if (MULTI_SVC_DEBUG) {
        console.log('[MultiSvcDebug] buildConfirmationRows: no selection', { messageId });
      }
      return null;
    }

    const originalUserMsg = assistantMsg?.originalUserInput || '';
    const rows: Array<{ service: string; qty: number | string; city: string; serviceId?: string }> = [];

    groupedServices.forEach((group: {
      vehicleType: string;
      requestedQuantity: number;
      services?: Array<{ name: string; serviceId?: string; requestedQuantity?: number }>;
    }) => {
      const services = (selected && selected[group.vehicleType]) || [];
      services.forEach((svcName: string) => {
        const [, city] = group.vehicleType.includes('|')
          ? group.vehicleType.split('|')
          : [group.vehicleType, ''];
        const svcMeta = group.services?.find(
          (s) => s.name.toLowerCase() === svcName.toLowerCase(),
        );
        const qty = svcMeta?.requestedQuantity ?? group.requestedQuantity ?? '—';
        rows.push({
          service: svcName,
          qty,
          city: city || '—',
          serviceId: svcMeta?.serviceId,
        });
      });
    });

    if (rows.length === 0) return null;
    const deduped = dedupeConfirmationRows(rows);
    if (MULTI_SVC_DEBUG) {
      console.log('[MultiSvcDebug] buildConfirmationRows', {
        messageId,
        selected,
        rowCountBeforeDedupe: rows.length,
        rowCountAfterDedupe: deduped.length,
        rows: deduped,
        originalUserInput: originalUserMsg,
      });
    }
    return { rows: deduped, originalUserInput: originalUserMsg };
  };

  const openConfirmationTable = (
    messageId: string,
    rows: Array<{ service: string; qty: number | string; city: string }>,
    originalUserInput: string,
    _minQtySnapshot?: {
      items: Array<{ description: string; requested: number; originalRequested: number; minimum: number }>;
      aboveMinItems?: Array<{ description: string; requested: number; minimum: number }>;
      pendingRows: Array<{ service: string; qty: number | string; city: string }>;
      messageId: string;
      originalUserInput: string;
    },
  ) => {
    void executeConfirmedGeneration(dedupeConfirmationRows(rows), originalUserInput, messageId);
  };

  const syncMinQtyItemsFromConfirmRows = (
    items: Array<{ description: string; requested: number; originalRequested: number; minimum: number }>,
    confirmRows: Array<{ service: string; qty: number | string; city: string }>,
  ) => items.map((item) => {
    const row = confirmRows.find(
      (r) =>
        item.description.toLowerCase().includes(r.service.toLowerCase()) &&
        (r.city === '—' || item.description.toLowerCase().includes(String(r.city).toLowerCase())),
    );
    if (!row) return item;
    const qty = typeof row.qty === 'number' ? row.qty : parseInt(String(row.qty), 10) || item.requested;
    return { ...item, requested: qty };
  });

  const handleConfirmTableEdit = () => {
    if (!confirmationTable) return;
    const snap = confirmationTable.minQtySnapshot;
    if (snap) {
      setPendingConfirmGeneration({
        rows: snap.pendingRows,
        originalUserInput: snap.originalUserInput,
        messageId: snap.messageId,
      });
      setMinQtyWarning({
        items: syncMinQtyItemsFromConfirmRows(snap.items, confirmationTable.rows),
        aboveMinItems: snap.aboveMinItems,
        pendingQuote: null as any,
      });
      setEditingItemIndex(null);
      setEditedQuantity('');
      setConfirmationTable(null);
      return;
    }
    setConfirmationTable(null);
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
    await applyMinQtyGateOrConfirmTable(messageId, rows, originalUserInput);
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
    closeChipImagePreview();
    setMessages(prev => [...stripChipImagesFromMessages(prev), userMessage]);
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
              content: 'Your quotation is ready.\nOpening quotation preview.',
              timestamp: new Date(),
            };
            setMessages(prev => [...prev, quoteReadyMessage]);
            setTimeout(() => { history.push('/preview'); }, 1500);
            setIsLoading(false);
            return;
          }

          const failMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `I couldn't build the quote from the rate card: ${result.message}. Please check the service exists in your uploaded proposals, and I'll try again.`,
            timestamp: new Date(),
          };
          setMessages(prev => [...prev, failMsg]);
          setIsLoading(false);
          return;
        }
      }

      // Fallback when cloud catalog unavailable
      if (USE_CLOUD_DATA) {
        const failMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content:
            'I couldn’t load rate-card services from the cloud catalog just now. Please retry once they load, or check your connection — happy to pick up from there.',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, failMsg]);
        setIsLoading(false);
        return;
      }

      // Legacy path only when USE_CLOUD_DATA is false
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
        content: `Sorry — quote generation didn't go through (${errText}). Happy to try again whenever you're ready.`,
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
              content: `Voice input ran into an issue: ${err.message || 'Could not access the microphone'}. You're welcome to type instead.`,
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
            content: 'Voice input isn’t supported in this browser — you’re welcome to type your brief instead.',
            timestamp: new Date(),
            isError: true,
          };
          setMessages(prev => [...prev, errorMessage]);
        }
      }
    }
  };

  const latestProgressiveId = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.isProgressiveChat)
    ?.id;

  return (
    <Box
      className="qb-chat-root"
      display="flex"
      flexDirection="column"
      h="100%"
      w="100%"
      borderRadius={0}
      border="none"
      bg="white"
    >
      {/* Content — full-width after chat; mobile input edge-to-edge */}
      <VStack
        className={`qb-chat-stack${messages.length === 0 ? ' qb-chat-stack--empty' : ''}`}
        align="stretch"
        spacing={0}
        flex={1}
        minH={0}
        justify={messages.length === 0 ? { base: 'center', md: 'center' } : 'flex-start'}
        w="100%"
      >
        {messages.length === 0 && (
          <>
            <Text
              className="qb-empty-title"
              fontSize={{ base: 'xl', md: '2xl' }}
              fontWeight="600"
              color="gray.700"
              textAlign="center"
              letterSpacing="-0.01em"
              px={{ base: 3, md: 4 }}
              mb={{ base: 1, md: 5 }}
              mt={{ base: 0, md: 0 }}
              flexShrink={0}
              w="100%"
              maxW={{ base: '100%', md: '720px' }}
              alignSelf={{ base: 'stretch', md: 'center' }}
              order={{ base: 1, md: 0 }}
            >
              Try asking...
            </Text>
            <Text
              className="qb-empty-sub"
              display={{ base: 'block', md: 'none' }}
              order={{ base: 1, md: 0 }}
            >
              Describe a service, city, quantity, or duration — we&apos;ll build a quote for you.
            </Text>
          </>
        )}

        {messages.length > 0 && (
        <Box
          className="qb-chat-scroll"
          flex={1}
          bg="white"
          px={{ base: 2, md: 4 }}
          py={{ base: 2, md: 4 }}
          overflowY="auto"
          minH="0"
          w="100%"
          position="relative"
          zIndex={0}
          sx={{ 
            '::-webkit-scrollbar': { 
              width: '16px',
              height: '16px',
            },
            '::-webkit-scrollbar-track': {
              background: 'transparent',
            },
            '::-webkit-scrollbar-thumb': {
              background: '#b8c0cc',
              border: '3px solid transparent',
              backgroundClip: 'padding-box',
              borderRadius: '8px',
            },
          }}
        >
            <VStack align="stretch" spacing={{ base: 4, md: 5 }} w="100%" maxW="100%">
              {messages.map(message => {
                return (
                  <Box
                    key={message.id}
                    className={`qb-msg-row${message.role === 'assistant' ? ' qb-msg-row--assistant' : ''}`}
                    sx={{
                      // Let the browser skip layout/paint work for rows far
                      // outside the viewport while retaining their height and
                      // all existing interaction/state behavior.
                      contentVisibility: 'auto',
                      contain: 'layout paint style',
                      containIntrinsicSize: '0 120px',
                    }}
                    alignSelf={message.role === 'user' ? 'flex-end' : 'flex-start'}
                    maxW={{
                      base: message.role === 'user' ? '80%' : '92%',
                      md: message.role === 'user' ? '70%' : '85%',
                    }}
                    w={message.role === 'user' ? 'auto' : { base: '100%', md: 'auto' }}
                  >
                    <Box>
                        {!message.isCityPicker && !message.isMultipleMatch && <Box>
                          {message.content && <Box
                            bgGradient={message.role === 'user' 
                              ? 'linear(135deg, #dc2626 0%, #be123c 50%, #9f1239 100%)' 
                              : undefined
                            }
                            bg={
                              message.role === 'user'
                                ? undefined
                                : (message.isError ? 'red.50' : 'white')
                            }
                            border={message.role === 'user' ? 'none' : '1px solid'}
                            borderColor={
                              message.role === 'user'
                                ? undefined
                                : (message.isError ? 'red.300' : 'brand.100')
                            }
                            borderLeftWidth={
                              message.role !== 'user' && !message.isError ? '4px' : undefined
                            }
                            borderLeftColor={
                              message.role !== 'user' && !message.isError ? 'brand.500' : undefined
                            }
                            color={
                              message.role === 'user'
                                ? 'white'
                                : (message.isError ? 'red.700' : 'gray.900')
                            }
                            px={{ base: 4, md: 5 }}
                            py={{ base: 3.5, md: 4 }}
                            borderRadius={message.role === 'user' ? '20px 20px 4px 20px' : '4px 16px 16px 16px'}
                            boxShadow={message.role === 'user' 
                              ? '0 8px 16px rgba(220, 38, 38, 0.25), 0 2px 4px rgba(220, 38, 38, 0.1)' 
                              : (message.isError
                                  ? '0 4px 12px rgba(239, 68, 68, 0.15)'
                                  : '0 6px 18px rgba(117, 9, 38, 0.08), 0 1px 3px rgba(0, 0, 0, 0.06)')
                            }
                          >
                            <HStack spacing={2} mb={message.isError ? 1 : 0} align="flex-start">
                              {message.isError && <Text fontSize="16px">❌</Text>}
                              <Text 
                                fontSize="13.2px"
                                whiteSpace="pre-wrap"
                                lineHeight="1.55"
                                fontWeight={
                                  message.role === 'user'
                                    ? '500'
                                    : (message.isError ? '630' : '555')
                                }
                                letterSpacing="normal"
                                flex={1}
                                color={
                                  message.role === 'user'
                                    ? 'white'
                                    : (message.isError ? 'red.700' : 'gray.800')
                                }
                                className={
                                  message.role === 'assistant'
                                    ? 'qb-assistant-text'
                                    : undefined
                                }
                              >
                                {message.content}
                              </Text>
                            </HStack>
                            <Text
                              fontSize="11px"
                              mt={2.5}
                              opacity={message.role === 'user' ? 0.75 : 0.55}
                              fontWeight="600"
                              letterSpacing="tight"
                              color={message.role === 'user' ? undefined : 'gray.500'}
                            >
                              {message.timestamp.toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </Text>
                          </Box>}

                          {/* Soft note for single-city services is already in message.content */}

                          {/* Min qty details card */}
                          {message.progressiveBelowMin && message.progressiveBelowMin.length > 0 && (
                            <Box mt={3} p={3} bg="orange.50" border="1px solid" borderColor="orange.200" borderRadius="lg">
                              <HStack mb={2} spacing={1} justify="space-between" align="flex-start">
                                <Text fontSize="12px" fontWeight="700" color="orange.700">
                                  ⚠ Minimum Quantity Required
                                </Text>
                                <Text fontSize="10px" color="orange.600" fontWeight="500" maxW="55%" textAlign="right">
                                  Tap pencil to edit qty
                                </Text>
                              </HStack>
                              {message.progressiveBelowMin.map((item, i) => {
                                const itemKey = item.serviceId || item.service;
                                const isEditing = minQtyEditingKey[message.id] === itemKey;
                                const draft =
                                  minQtyDrafts[message.id]?.[itemKey]
                                  ?? String(item.requested);
                                return (
                                  <Box key={itemKey} mb={i < message.progressiveBelowMin!.length - 1 ? 2 : 0}>
                                    <Text fontSize="12px" fontWeight="600" color="gray.700">{item.service}</Text>
                                    <HStack mt={0.5} spacing={3} align="flex-end">
                                      <Box>
                                  <Text fontSize="10px" color="gray.500" fontWeight="500">Requested Qty</Text>
                                        <HStack spacing={1} align="center">
                                          {isEditing ? (
                                            <Input
                                              size="xs"
                                              type="number"
                                              min={1}
                                              w="72px"
                                              value={draft}
                                              autoFocus
                                              bg="white"
                                              borderColor="orange.300"
                                              fontWeight="600"
                                              onChange={(e) => {
                                                const v = e.target.value;
                                                setMinQtyDrafts((prev) => ({
                                                  ...prev,
                                                  [message.id]: {
                                                    ...(prev[message.id] || {}),
                                                    [itemKey]: v,
                                                  },
                                                }));
                                              }}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                  e.preventDefault();
                                                  void applyMinQtyPencilEdits(message);
                                                }
                                                if (e.key === 'Escape') {
                                                  setMinQtyEditingKey((prev) => ({ ...prev, [message.id]: null }));
                                                }
                                              }}
                                              onBlur={() => void applyMinQtyPencilEdits(message)}
                                            />
                                          ) : (
                                            <Text fontSize="13px" fontWeight="700" color="red.500">
                                              {item.requested.toLocaleString()}
                                            </Text>
                                          )}
                                          <IconButton
                                            aria-label="Edit quantity"
                                            icon={<FiEdit2 />}
                                            size="xs"
                                            variant="ghost"
                                            color="brand.600"
                                            isDisabled={isLoading}
                                            onClick={() => {
                                              setMinQtyDrafts((prev) => ({
                                                ...prev,
                                                [message.id]: {
                                                  ...(prev[message.id] || {}),
                                                  [itemKey]: String(
                                                    prev[message.id]?.[itemKey] ?? item.requested,
                                                  ),
                                                },
                                              }));
                                              setMinQtyEditingKey((prev) => ({
                                                ...prev,
                                                [message.id]: itemKey,
                                              }));
                                            }}
                                            _hover={{ bg: 'orange.100' }}
                                            fontSize="11px"
                                            w="22px"
                                            h="22px"
                                            minW="22px"
                                          />
                                        </HStack>
                                      </Box>
                                      <Text fontSize="16px" color="gray.300" pb="2px">→</Text>
                                      <Box>
                                  <Text fontSize="10px" color="gray.500" fontWeight="500">Minimum Qty</Text>
                                        <Text fontSize="13px" fontWeight="700" color="green.600">
                                          {item.minimum.toLocaleString()}
                                        </Text>
                                      </Box>
                                    </HStack>
                                  </Box>
                                );
                              })}
                            </Box>
                          )}

                          {/* Min duration details card — same layout as min qty */}
                          {message.progressiveBelowMinDuration && message.progressiveBelowMinDuration.length > 0 && (
                            <Box mt={3} p={3} bg="orange.50" border="1px solid" borderColor="orange.200" borderRadius="lg">
                              <HStack mb={2} spacing={1} justify="space-between" align="flex-start">
                                <Text fontSize="12px" fontWeight="700" color="orange.700">
                                  ⚠ Minimum Duration Required
                                </Text>
                                <Text fontSize="10px" color="orange.600" fontWeight="500" maxW="55%" textAlign="right">
                                  Tap pencil to edit duration
                                </Text>
                              </HStack>
                              {message.progressiveBelowMinDuration.map((item, i) => {
                                const itemKey = item.serviceId || item.service;
                                const isEditing = minDurationEditingKey[message.id] === itemKey;
                                const draft =
                                  minDurationDrafts[message.id]?.[itemKey]
                                  ?? String(item.requested);
                                return (
                                  <Box key={itemKey} mb={i < message.progressiveBelowMinDuration!.length - 1 ? 2 : 0}>
                                    <Text fontSize="12px" fontWeight="600" color="gray.700">{item.service}</Text>
                                    <HStack mt={0.5} spacing={3} align="flex-end">
                                      <Box>
                                        <Text fontSize="10px" color="gray.500" fontWeight="500">Requested Duration</Text>
                                        <HStack spacing={1} align="center">
                                          {isEditing ? (
                                            <Input
                                              size="xs"
                                              type="number"
                                              min={1}
                                              w="72px"
                                              value={draft}
                                              autoFocus
                                              bg="white"
                                              borderColor="orange.300"
                                              fontWeight="600"
                                              onChange={(e) => {
                                                const v = e.target.value;
                                                setMinDurationDrafts((prev) => ({
                                                  ...prev,
                                                  [message.id]: {
                                                    ...(prev[message.id] || {}),
                                                    [itemKey]: v,
                                                  },
                                                }));
                                              }}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                  e.preventDefault();
                                                  void applyMinDurationPencilEdits(message);
                                                }
                                                if (e.key === 'Escape') {
                                                  setMinDurationEditingKey((prev) => ({ ...prev, [message.id]: null }));
                                                }
                                              }}
                                              onBlur={() => void applyMinDurationPencilEdits(message)}
                                            />
                                          ) : (
                                            <Text fontSize="13px" fontWeight="700" color="red.500">
                                              {item.requested.toLocaleString()} days
                                            </Text>
                                          )}
                                          <IconButton
                                            aria-label="Edit duration"
                                            icon={<FiEdit2 />}
                                            size="xs"
                                            variant="ghost"
                                            color="brand.600"
                                            isDisabled={isLoading}
                                            onClick={() => {
                                              setMinDurationDrafts((prev) => ({
                                                ...prev,
                                                [message.id]: {
                                                  ...(prev[message.id] || {}),
                                                  [itemKey]: String(
                                                    prev[message.id]?.[itemKey] ?? item.requested,
                                                  ),
                                                },
                                              }));
                                              setMinDurationEditingKey((prev) => ({
                                                ...prev,
                                                [message.id]: itemKey,
                                              }));
                                            }}
                                            _hover={{ bg: 'orange.100' }}
                                            fontSize="11px"
                                            w="22px"
                                            h="22px"
                                            minW="22px"
                                          />
                                        </HStack>
                                      </Box>
                                      <Text fontSize="16px" color="gray.300" pb="2px">→</Text>
                                      <Box>
                                        <Text fontSize="10px" color="gray.500" fontWeight="500">Minimum Duration</Text>
                                        <Text fontSize="13px" fontWeight="700" color="green.600">
                                          {item.minimum.toLocaleString()} days
                                        </Text>
                                      </Box>
                                    </HStack>
                                  </Box>
                                );
                              })}
                            </Box>
                          )}

                          {/* Batch: skipped services only (no “Now choosing” banner) */}
                          {message.isProgressiveChat
                            && message.progressiveUnavailable
                            && message.progressiveUnavailable.length > 0 && (
                            <Box
                              mt={3}
                              mb={message.progressiveOptions?.length ? 0 : 1}
                              px={3}
                              py={2.5}
                              borderRadius="xl"
                              border="1px solid"
                              borderColor="gray.200"
                              bg="gray.50"
                            >
                              <Text
                                fontSize="10px"
                                fontWeight="700"
                                color="gray.500"
                                textTransform="uppercase"
                                letterSpacing="0.06em"
                                mb={1.5}
                              >
                                Skipped
                                {message.progressiveUnavailableCity
                                  ? ` — not in ${message.progressiveUnavailableCity}`
                                  : ''}
                              </Text>
                              <Flex flexWrap="wrap" gap={1.5}>
                                {message.progressiveUnavailable.map((name) => (
                                  <Text
                                    key={`miss-${name}`}
                                    as="span"
                                    px={2.5}
                                    py={1}
                                    fontSize="12px"
                                    fontWeight="500"
                                    color="gray.500"
                                    bg="white"
                                    border="1px dashed"
                                    borderColor="gray.300"
                                    borderRadius="full"
                                    lineHeight="1.2"
                                  >
                                    {name}
                                  </Text>
                                ))}
                              </Flex>
                            </Box>
                          )}

                          {/* Progressive chat option chips — only the latest turn stays interactive */}
                          {message.isProgressiveChat && message.id === latestProgressiveId && message.progressiveOptions && message.progressiveOptions.length > 0 && (
                            <Box mt={3}>
                              {message.progressiveAllowMulti ? (
                                /* Scrollable checklist — fixed ~10 rows visible */
                                <Box
                                  sx={{
                                    // Once the funnel advances, preserve the
                                    // old checklist visually but prevent it
                                    // from mutating state again.
                                    pointerEvents:
                                      message.id === latestProgressiveId ? 'auto' : 'none',
                                    opacity:
                                      message.id === latestProgressiveId ? 1 : 0.62,
                                  }}
                                  border="1px solid"
                                  borderColor="brand.100"
                                  borderRadius="xl"
                                  overflow="hidden"
                                  bg="white"
                                  boxShadow="0 4px 14px rgba(117, 9, 38, 0.06), 0 1px 3px rgba(0, 0, 0, 0.04)"
                                >
                                  {/* Header row: Select all / Clear */}
                                  <HStack
                                    px={3}
                                    py={2}
                                    bg="brand.50"
                                    borderBottom="1px solid"
                                    borderColor="brand.100"
                                    spacing={2}
                                  >
                                    <Button
                                      size="xs"
                                      variant="link"
                                      color="brand.600"
                                      fontWeight="600"
                                      fontSize="12px"
                                      _hover={{ color: 'brand.700', textDecoration: 'underline' }}
                                      onClick={() =>
                                        setProgressiveMultiSelect((prev) => ({
                                          ...prev,
                                          [message.id]: message.progressiveOptions!.map((o) => o.id),
                                        }))
                                      }
                                    >
                                      Select all
                                    </Button>
                                    <Text color="brand.200" fontSize="xs" lineHeight="1">|</Text>
                                    <Button
                                      size="xs"
                                      variant="link"
                                      color="gray.500"
                                      fontWeight="500"
                                      fontSize="12px"
                                      _hover={{ color: 'gray.700', textDecoration: 'underline' }}
                                      onClick={() =>
                                        setProgressiveMultiSelect((prev) => ({
                                          ...prev,
                                          [message.id]: [],
                                        }))
                                      }
                                    >
                                      Clear
                                    </Button>
                                    <Text
                                      ml="auto"
                                      fontSize="11px"
                                      color="gray.500"
                                      fontWeight="500"
                                      bg="white"
                                      px={2}
                                      py={0.5}
                                      borderRadius="full"
                                      border="1px solid"
                                      borderColor="gray.200"
                                    >
                                      {progressiveMultiSelect[message.id]?.length
                                        ? `${progressiveMultiSelect[message.id].length} selected`
                                        : `${message.progressiveOptions.length} options`}
                                    </Text>
                                  </HStack>

                                  {/* Compact square-thumb checklist (groups as section headers) */}
                                  <Box
                                    overflowY="auto"
                                    maxH="320px"
                                    px={2.5}
                                    py={2.5}
                                    bg="gray.50"
                                    css={{
                                      '&::-webkit-scrollbar': { width: '4px' },
                                      '&::-webkit-scrollbar-track': { background: 'transparent' },
                                      '&::-webkit-scrollbar-thumb': { background: '#CBD5E0', borderRadius: '4px' },
                                    }}
                                  >
                                    {(() => {
                                      const opts = message.progressiveOptions!;
                                      const visibleN = progressiveChipVisible[message.id] || PROGRESSIVE_CHIP_PAGE;
                                      const hasGroups = opts.some((o) => o.group);
                                      const sections: Array<{ group: string | null; items: typeof opts }> = [];
                                      if (!hasGroups) {
                                        sections.push({ group: null, items: opts });
                                      } else {
                                        const map = new Map<string, typeof opts>();
                                        for (const o of opts) {
                                          const g = o.group || 'Other';
                                          if (!map.has(g)) map.set(g, []);
                                          map.get(g)!.push(o);
                                        }
                                        for (const [g, items] of map) sections.push({ group: g, items });
                                      }
                                      let shown = 0;
                                      const limited = sections.map((sec) => {
                                        if (shown >= visibleN) return { ...sec, items: [] as typeof opts };
                                        const room = visibleN - shown;
                                        const items = sec.items.slice(0, room);
                                        shown += items.length;
                                        return { ...sec, items };
                                      }).filter((sec) => sec.items.length > 0);
                                      const hasMore = opts.length > visibleN;
                                      const THUMB = 56;
                                      return (
                                        <>
                                          {limited.map((sec) => (
                                        <Box key={sec.group || '_all'} mb={sec.group ? 2.5 : 0}>
                                          {sec.group && (
                                            <Text
                                              px={1}
                                              mb={1.5}
                                              fontSize="10px"
                                              fontWeight="600"
                                              color="gray.500"
                                              textTransform="uppercase"
                                              letterSpacing="0.06em"
                                            >
                                              {sec.group}
                                            </Text>
                                          )}
                                          <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={2}>
                                            {sec.items.map((opt) => {
                                              const isSelected = (progressiveMultiSelect[message.id] || []).includes(opt.id);
                                              const showThumb = !!opt.imageUrl;
                                              return (
                                                <Box
                                                  key={opt.id}
                                                  as="button"
                                                  type="button"
                                                  display="flex"
                                                  alignItems="center"
                                                  gap={2}
                                                  textAlign="left"
                                                  px={2}
                                                  py={1.5}
                                                  borderRadius="12px"
                                                  border="1.5px solid"
                                                  borderColor={isSelected ? 'brand.500' : 'gray.200'}
                                                  bg={isSelected ? 'brand.50' : 'white'}
                                                  boxShadow={
                                                    isSelected
                                                      ? '0 1px 4px rgba(201, 31, 61, 0.15)'
                                                      : '0 1px 2px rgba(0, 0, 0, 0.04)'
                                                  }
                                                  cursor={isLoading ? 'not-allowed' : 'pointer'}
                                                  _hover={{
                                                    borderColor: 'brand.400',
                                                    bg: isSelected ? 'brand.50' : 'white',
                                                    boxShadow: '0 2px 6px rgba(201, 31, 61, 0.12)',
                                                  }}
                                                  transition="all 0.15s ease"
                                                  disabled={isLoading}
                                                  onClick={() => {
                                                    if (isLoading) return;
                                                    setProgressiveMultiSelect((prev) => {
                                                      const cur = prev[message.id] || [];
                                                      const next = cur.includes(opt.id)
                                                        ? cur.filter((x) => x !== opt.id)
                                                        : [...cur, opt.id];
                                                      return { ...prev, [message.id]: next };
                                                    });
                                                  }}
                                                >
                                                  <Box
                                                    flexShrink={0}
                                                    w="15px"
                                                    h="15px"
                                                    borderRadius="4px"
                                                    border="2px solid"
                                                    borderColor={isSelected ? 'brand.500' : 'gray.300'}
                                                    bg={isSelected ? 'brand.500' : 'white'}
                                                    display="flex"
                                                    alignItems="center"
                                                    justifyContent="center"
                                                  >
                                                    {isSelected && (
                                                      <Text fontSize="9px" color="white" fontWeight="700" lineHeight="1">✓</Text>
                                                    )}
                                                  </Box>
                                                  {showThumb ? (
                                                    <Box
                                                      flexShrink={0}
                                                      w={`${THUMB}px`}
                                                      h={`${THUMB}px`}
                                                      borderRadius="8px"
                                                      bg="gray.100"
                                                      overflow="hidden"
                                                      onClick={(e: React.MouseEvent) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        openChipImagePreview(opt.imageUrl!, opt.label);
                                                      }}
                                                      cursor="zoom-in"
                                                      title="View image"
                                                    >
                                                      <Image
                                                        src={opt.imageUrl}
                                                        alt={opt.label}
                                                        w="100%"
                                                        h="100%"
                                                        objectFit="cover"
                                                        loading="lazy"
                                                        fallback={
                                                          <Box w="100%" h="100%" bg="gray.100" />
                                                        }
                                                      />
                                                    </Box>
                                                  ) : null}
                                                  <Text
                                                    flex="1"
                                                    fontSize="13px"
                                                    fontWeight="600"
                                                    color={isSelected ? 'brand.700' : 'gray.700'}
                                                    noOfLines={2}
                                                    textAlign="left"
                                                    lineHeight="1.35"
                                                  >
                                                    {opt.label}
                                                  </Text>
                                                </Box>
                                              );
                                            })}
                                          </SimpleGrid>
                                        </Box>
                                          ))}
                                          {hasMore && (
                                            <Button
                                              mt={2}
                                              size="xs"
                                              variant="ghost"
                                              color="brand.600"
                                              fontWeight="600"
                                              onClick={() =>
                                                setProgressiveChipVisible((prev) => ({
                                                  ...prev,
                                                  [message.id]: (prev[message.id] || PROGRESSIVE_CHIP_PAGE) + PROGRESSIVE_CHIP_PAGE,
                                                }))
                                              }
                                            >
                                              Show more ({opts.length - visibleN} left)
                                            </Button>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </Box>

                                  {/* Confirm button */}
                                  <Box
                                    p={2.5}
                                    bg="white"
                                    borderTop="1px solid"
                                    borderColor="brand.100"
                                  >
                                    <Button
                                      w="100%"
                                      size="md"
                                      bg="brand.500"
                                      color="white"
                                      borderRadius="lg"
                                      fontWeight="600"
                                      fontSize="14px"
                                      h="40px"
                                      boxShadow="0 2px 8px rgba(201, 31, 61, 0.25)"
                                      _hover={{ bg: 'brand.600', color: 'white' }}
                                      _active={{ bg: 'brand.700', color: 'white' }}
                                      _disabled={{
                                        bg: 'gray.200',
                                        color: 'gray.500',
                                        opacity: 1,
                                        cursor: 'not-allowed',
                                        boxShadow: 'none',
                                      }}
                                      isDisabled={isLoading || !(progressiveMultiSelect[message.id]?.length)}
                                      onClick={() => void handleProgressiveMultiConfirm(message)}
                                    >
                                      Confirm
                                      {progressiveMultiSelect[message.id]?.length
                                        ? ` (${progressiveMultiSelect[message.id].length})`
                                        : ''}
                                    </Button>
                                  </Box>
                                </Box>
                              ) : (
                                <Box>
                                  {(() => {
                                    const opts = message.progressiveOptions!;
                                    const isYesNo = opts.every(
                                      (o) =>
                                        o.id === 'yes_generate'
                                        || o.id === 'no_generate'
                                        || o.id === 'yes'
                                        || o.id === 'no'
                                        || o.id === 'yes_min'
                                        || o.id === 'no_min'
                                        || o.id === 'yes_min_duration'
                                        || o.id === 'no_min_duration',
                                    );
                                    const previewUrl = isYesNo
                                      ? opts.find((o) => o.imageUrl)?.imageUrl
                                      : undefined;
                                    const previewLabel =
                                      opts.find((o) => o.imageUrl)?.medium
                                      || opts.find((o) => o.imageUrl)?.label
                                      || 'Reference';
                                    const useImageCards = !isYesNo && opts.some((o) => !!o.imageUrl);
                                    return (
                                      <>
                                        {previewUrl ? (
                                          <Box
                                            mb={2.5}
                                            display="flex"
                                            justifyContent="flex-start"
                                          >
                                            <ChatChipThumb
                                              url={previewUrl}
                                              label={previewLabel}
                                              size={96}
                                              radius="md"
                                            />
                                          </Box>
                                        ) : null}
                                        {useImageCards ? (
                                          <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={2}>
                                            {opts.map((opt) => (
                                              <Box
                                                key={opt.id}
                                                as="button"
                                                type="button"
                                                display="flex"
                                                alignItems="center"
                                                gap={2}
                                                textAlign="left"
                                                px={2}
                                                py={1.5}
                                                borderRadius="12px"
                                                border="1.5px solid"
                                                borderColor="gray.200"
                                                bg="white"
                                                boxShadow="0 1px 2px rgba(0, 0, 0, 0.04)"
                                                cursor={isLoading ? 'not-allowed' : 'pointer'}
                                                _hover={{
                                                  borderColor: 'brand.400',
                                                  bg: 'brand.50',
                                                  boxShadow: '0 2px 6px rgba(201, 31, 61, 0.12)',
                                                }}
                                                transition="all 0.15s ease"
                                                disabled={isLoading}
                                                onClick={() =>
                                                  void handleProgressiveOptionClick(message, opt.id)
                                                }
                                              >
                                                {opt.imageUrl ? (
                                                  <Box
                                                    flexShrink={0}
                                                    w="56px"
                                                    h="56px"
                                                    borderRadius="8px"
                                                    bg="gray.100"
                                                    overflow="hidden"
                                                    cursor="zoom-in"
                                                    title="View image"
                                                    onClick={(e: React.MouseEvent) => {
                                                      e.preventDefault();
                                                      e.stopPropagation();
                                                      openChipImagePreview(opt.imageUrl!, opt.label);
                                                    }}
                                                  >
                                                    <Image
                                                      src={opt.imageUrl}
                                                      alt={opt.label}
                                                      w="100%"
                                                      h="100%"
                                                      objectFit="cover"
                                                      loading="lazy"
                                                      fallback={<Box w="100%" h="100%" bg="gray.100" />}
                                                    />
                                                  </Box>
                                                ) : null}
                                                <Text
                                                  flex="1"
                                                  fontSize="13px"
                                                  fontWeight="600"
                                                  color="gray.700"
                                                  noOfLines={2}
                                                  lineHeight="1.35"
                                                >
                                                  {opt.label}
                                                </Text>
                                              </Box>
                                            ))}
                                          </SimpleGrid>
                                        ) : (
                                          <Box display="flex" flexWrap="wrap" gap={2}>
                                            {opts.map((opt) => (
                                              <Button
                                                key={opt.id}
                                                size="sm"
                                                variant="outline"
                                                borderColor="gray.200"
                                                color="gray.700"
                                                bg="white"
                                                borderRadius="full"
                                                fontWeight="500"
                                                fontSize="13px"
                                                px={3}
                                                h="34px"
                                                boxShadow="0 1px 2px rgba(0, 0, 0, 0.04)"
                                                _hover={{
                                                  borderColor: 'brand.400',
                                                  color: 'brand.700',
                                                  bg: 'brand.50',
                                                }}
                                                isDisabled={isLoading}
                                                onClick={() =>
                                                  void handleProgressiveOptionClick(message, opt.id)
                                                }
                                              >
                                                <Text as="span">{opt.label}</Text>
                                              </Button>
                                            ))}
                                          </Box>
                                        )}
                                      </>
                                    );
                                  })()}
                                </Box>
                              )}
                            </Box>
                          )}
                          
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

                            <VStack align="stretch" spacing={4}>
                              {(() => {
                                const groups = message.groupedServices || [];
                                const shownNames = groups.flatMap((g) => {
                                  const limit = getMultiMatchVisibleLimit(message.id, g.vehicleType);
                                  return g.services.slice(0, limit).map((s) => s.name);
                                });
                                const selectedFlat = Object.values(selectedServices[message.id] || {}).flat();
                                const allShownSelected =
                                  shownNames.length > 0 &&
                                  shownNames.every((n) => selectedFlat.includes(n));
                                const totalCount = groups.reduce((n, g) => n + g.services.length, 0);
                                return (
                                  <HStack justify="space-between" px={1}>
                                    <Text fontSize="11px" color="gray.500">
                                      Showing loaded items · {totalCount} total
                                    </Text>
                                    <Button
                                      size="xs"
                                      variant="ghost"
                                      colorScheme="blue"
                                      onClick={() =>
                                        handleServiceSelectAllGlobal(message.id, groups)
                                      }
                                    >
                                      {allShownSelected ? 'Clear shown' : 'Select shown'}
                                    </Button>
                                  </HStack>
                                );
                              })()}
                              {message.groupedServices.map((group, gIdx) => {
                                const selectedForGroup = selectedServices[message.id]?.[group.vehicleType] || [];
                                const [vehiclePart, cityPart] = group.vehicleType.includes('|')
                                  ? group.vehicleType.split('|')
                                  : [group.vehicleType, null];
                                const visibleLimit = getMultiMatchVisibleLimit(message.id, group.vehicleType);
                                const visibleServices = group.services.slice(0, visibleLimit);
                                const shownNames = visibleServices.map((s) => s.name);
                                const remaining = group.services.length - visibleServices.length;
                                const allShownSelected =
                                  shownNames.length > 0 &&
                                  shownNames.every((n) => selectedForGroup.includes(n));
                                return (
                                  <Box key={`${group.vehicleType}-${gIdx}`}>
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
                                        <Text fontSize="11px" color="gray.500">
                                          {Math.min(visibleLimit, group.services.length)}/{group.services.length}
                                        </Text>
                                      </HStack>
                                      <Button
                                        size="xs"
                                        variant="ghost"
                                        colorScheme="blue"
                                        onClick={() =>
                                          handleServiceSelectAll(
                                            message.id,
                                            group.vehicleType,
                                            shownNames,
                                          )
                                        }
                                      >
                                        {allShownSelected ? 'Clear shown' : 'Select shown'}
                                      </Button>
                                    </HStack>
                                    <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={2}>
                                      {visibleServices.map((svc, sIdx) => {
                                        const isChecked = selectedForGroup.includes(svc.name);
                                        return (
                                          <Box
                                            key={`${svc.name}-${sIdx}`}
                                            display="flex"
                                            alignItems="center"
                                            gap={2}
                                            px={2}
                                            py={1.5}
                                            borderRadius="12px"
                                            border="2px solid"
                                            borderColor={isChecked ? 'blue.400' : 'gray.200'}
                                            bg={isChecked ? 'blue.50' : 'white'}
                                            transition="all 0.15s ease"
                                            _hover={{ borderColor: isChecked ? 'blue.500' : 'blue.300', boxShadow: 'sm' }}
                                          >
                                            {svc.imageUrl ? (
                                              <Box
                                                flexShrink={0}
                                                w="56px"
                                                h="56px"
                                                borderRadius="8px"
                                                bg="gray.100"
                                                overflow="hidden"
                                                cursor="zoom-in"
                                                title="View image"
                                                onClick={(e: React.MouseEvent) => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  openChipImagePreview(svc.imageUrl!, svc.name);
                                                }}
                                              >
                                                <Image
                                                  src={svc.imageUrl}
                                                  alt={svc.name}
                                                  w="100%"
                                                  h="100%"
                                                  objectFit="cover"
                                                  loading="lazy"
                                                  fallback={<Box w="100%" h="100%" bg="gray.100" />}
                                                />
                                              </Box>
                                            ) : null}
                                            <Checkbox
                                              flex="1"
                                              isChecked={isChecked}
                                              onChange={(e) => handleServiceCheckbox(message.id, group.vehicleType, svc.name, e.target.checked)}
                                              colorScheme="blue"
                                              size="md"
                                              spacing={2}
                                              cursor="pointer"
                                              alignItems="flex-start"
                                            >
                                              <Text fontSize="13px" fontWeight="600" color={isChecked ? 'blue.700' : 'gray.700'} noOfLines={2}>
                                                {svc.name}
                                                {svc.requestedQuantity != null && svc.requestedQuantity > 0
                                                  ? ` (qty ${svc.requestedQuantity})`
                                                  : ''}
                                              </Text>
                                            </Checkbox>
                                          </Box>
                                        );
                                      })}
                                    </SimpleGrid>
                                    {remaining > 0 && (
                                      <Button
                                        mt={2}
                                        size="sm"
                                        variant="outline"
                                        colorScheme="blue"
                                        w="full"
                                        onClick={() =>
                                          handleShowMoreMultiMatch(
                                            message.id,
                                            group.vehicleType,
                                            group.services.length,
                                          )
                                        }
                                      >
                                        Show {Math.min(MULTI_MATCH_PAGE_SIZE, remaining)} more
                                        {remaining > MULTI_MATCH_PAGE_SIZE
                                          ? ` (${remaining} left)`
                                          : ''}
                                      </Button>
                                    )}
                                  </Box>
                                );
                              })}
                            </VStack>

                            {/* Review button — show when ≥1 service selected */}
                            {selectedServices[message.id] && Object.values(selectedServices[message.id]).flat().length > 0 ? (
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
                                  Object.values(selectedServices[message.id] || {}).flat().length
                                } service{Object.values(selectedServices[message.id] || {}).flat().length !== 1 ? 's' : ''} selected)
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
                                                loading="lazy"
                                                decoding="async"
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

                                // Prefer matchedCities from DB city gate; otherwise show all available cities.
                                const citiesWithService = seg.matchedCities?.length
                                  ? seg.matchedCities
                                  : cityPickerState.availableCities;
                                const citiesWithoutService = cityPickerState.availableCities.filter(
                                  city => !citiesWithService.includes(city),
                                );

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
                                        {/* Cities where the service is available (from DB matchedCities) */}
                                        {citiesWithService.map((city, cIdx) => {
                                          const isSelected = seg.selectedCities.includes(city);
                                          // Min qty from DB catalog (default 1 when unknown).
                                          const cityKey = KNOWN_CITY_LIST.find(c => city.toLowerCase().includes(c)) || city.toLowerCase();
                                          const dbList = cityPickerState.dbServices || [];
                                          const groupHint = dbList.length
                                            ? buildGroupedServicesFromDb(seg.raw, cityKey, 1, dbList)
                                            : null;
                                          const minQty = groupHint?.services?.length
                                            ? (() => {
                                                const mins = groupHint.services
                                                  .map(svc => {
                                                    const resolved = resolveServiceIdFromCatalog(svc.name, dbList, cityKey);
                                                    if (!resolved) return 1;
                                                    const row = dbList.find(s => s.service_id === resolved.serviceId);
                                                    const rawMin = row?.metadata?.min_quantity ?? (row as { min_quantity?: number } | undefined)?.min_quantity;
                                                    const n = Number(rawMin);
                                                    const qty: ServiceQuantity = {
                                                      min: Number.isFinite(n) && n > 0 ? n : 1,
                                                      max: null,
                                                    };
                                                    return qty.min > 1 ? qty.min : 1;
                                                  })
                                                  .filter(n => n > 1)
                                                  .sort((a, b) => a - b);
                                                return mins[0] ?? null;
                                              })()
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
        </Box>
        )}

        {/* Chat input — centered when empty; full width after chat starts */}
        <Box
          className="qb-composer"
          w="100%"
          maxW={messages.length === 0 ? { base: '100%', md: '720px' } : '100%'}
          alignSelf={messages.length === 0 ? { base: 'stretch', md: 'center' } : 'stretch'}
          mx={messages.length === 0 ? { base: 0, md: 'auto' } : 0}
          flexShrink={0}
          position="relative"
          zIndex={20}
          isolation="isolate"
          pointerEvents="auto"
          px={{ base: 2, md: messages.length === 0 ? 4 : 4 }}
          pt={messages.length === 0 ? { base: 2, md: 4 } : { base: 2, md: 3 }}
          pb={
            messages.length === 0
              ? { base: 2, md: 2 }
              : { base: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))', md: 4 }
          }
          mb={messages.length === 0 ? 0 : { base: 0, md: 0 }}
          bg={{ base: 'transparent', md: 'white' }}
          order={{ base: 3, md: 0 }}
        >
          <Flex
            className="qb-composer__bar"
            align="center"
            w="100%"
            gap={1}
            pl={{ base: 3, md: 5 }}
            pr={{ base: 1.5, md: 2 }}
            py={{ base: 1, md: 1.5 }}
            bg="white"
            border="2px solid"
            borderColor="brand.500"
            borderRadius={{ base: '28px', md: 'full' }}
            position="relative"
            zIndex={1}
            transition="box-shadow 0.2s ease, border-color 0.2s ease"
            _hover={{ borderColor: 'brand.600' }}
            _focusWithin={{
              borderColor: 'brand.500',
              boxShadow: '0 0 0 3px rgba(201, 31, 61, 0.15)',
            }}
          >
            <Input
              className="qb-composer__input"
              ref={inputRef}
              defaultValue=""
              onChange={(e) => {
                if (historyIndex !== -1) {
                  setHistoryIndex(-1);
                  setDraftInput('');
                }
                // Keep the most recent assistant response visible while the
                // user types, especially when the mobile keyboard is open.
                scrollChatToLatest();
              }}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              onKeyDown={handleInputKeyDown}
              onFocus={(e) => {
                // Mobile keyboard: keep field visible — don't select-all (that hides the caret)
                if (Capacitor.isNativePlatform() || window.innerWidth <= 768) {
                  setTimeout(() => {
                    e.target.scrollIntoView({
                      behavior: 'smooth',
                      block: 'center',
                      inline: 'nearest',
                    });
                  }, 300);
                }
              }}
              placeholder="Give me a quote for…"
              aria-label="Message input"
              // Never disable — a stuck loading flag used to leave the field dead
              variant="unstyled"
              flex={1}
              minW={0}
              color="gray.900"
              fontSize={{ base: '14px', md: '16px' }}
              h={{ base: '44px', md: '44px' }}
              fontWeight="400"
              _placeholder={{
                color: 'gray.500',
                fontSize: { base: '13px', md: '15px' },
                fontWeight: '400',
              }}
              sx={{
                '&::placeholder': {
                  textOverflow: 'ellipsis',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                },
              }}
            />

            <Box position="relative" display="inline-flex" flexShrink={0}>
              {isRecording && (
                <Text
                  position="absolute"
                  top="-28px"
                  right="0"
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
                >
                  Listening...
                </Text>
              )}

              {/* Mobile history shortcuts */}
              {inputHistory.length > 0 && (
                <VStack
                  className="qb-history-rail"
                  display={{ base: 'flex', md: 'none' }}
                  position="absolute"
                  bottom="calc(100% + 6px)"
                  right="0"
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
                      const newIdx =
                        historyIndex === -1
                          ? inputHistory.length - 1
                          : Math.max(0, historyIndex - 1);
                      if (historyIndex === -1) setDraftInput(getInputValue());
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
                className="qb-composer__icon"
                aria-label={isRecording ? 'Stop recording' : 'Voice input'}
                icon={<FiMic size={24} />}
                onClick={toggleVoiceInput}
                isDisabled={isLoading}
                variant="ghost"
                color={isRecording ? 'red.500' : 'blue.500'}
                h={{ base: '44px', md: '40px' }}
                w={{ base: '44px', md: '40px' }}
                minW={{ base: '44px', md: '40px' }}
                borderRadius="full"
                fontSize={{ base: '20px', md: '18px' }}
                _hover={{ bg: isRecording ? 'red.50' : 'blue.50' }}
                _focusVisible={{
                  outline: '2px solid',
                  outlineColor: 'brand.500',
                  outlineOffset: '2px',
                }}
                _disabled={{ color: 'gray.300', cursor: 'not-allowed' }}
              />
            </Box>

            <IconButton
              className="qb-composer__icon"
              aria-label="Send message"
              data-send-btn
              icon={isLoading ? <Spinner size="sm" color="white" thickness="3px" /> : <FiSend size={20} />}
              onClick={handleSendMessage}
              // Draft text is intentionally uncontrolled so typing does not
              // rerender the full chat. handleSendMessage still guards empty
              // drafts; keep the button clickable so its state never becomes
              // stale between parent renders.
              isDisabled={isLoading}
              bg={!isLoading ? 'brand.500' : 'gray.200'}
              color={!isLoading ? 'white' : 'gray.500'}
              h={{ base: '44px', md: '40px' }}
              w={{ base: '44px', md: '40px' }}
              minW={{ base: '44px', md: '40px' }}
              borderRadius="full"
              flexShrink={0}
              fontSize={{ base: '16px', md: '16px' }}
              _hover={{
                bg: !isLoading ? 'brand.600' : 'gray.300',
              }}
              _focusVisible={{
                outline: '2px solid',
                outlineColor: 'brand.500',
                outlineOffset: '2px',
              }}
              _disabled={{
                bg: 'gray.200',
                color: 'gray.400',
                cursor: 'not-allowed',
                opacity: 1,
              }}
            />
          </Flex>
        </Box>

        {messages.length === 0 && (
          <Flex
            className="qb-suggestions"
            w="100%"
            maxW={{ base: '100%', md: '720px' }}
            alignSelf={{ base: 'stretch', md: 'center' }}
            px={{ base: 2, md: 4 }}
            pt={{ base: 3, md: 5 }}
            pb={{ base: 0, md: 8 }}
            flexShrink={0}
            justify={{ base: 'stretch', md: 'center' }}
            direction={{ base: 'column', md: 'row' }}
            wrap="wrap"
            gap={{ base: 3, md: 2 }}
            order={{ base: 2, md: 0 }}
          >
            {SUGGESTION_PROMPTS.map((prompt, index) => (
              <Button
                key={index}
                className="qb-suggestion-card"
                variant="outline"
                borderWidth="1.5px"
                borderColor="gray.200"
                bg="white"
                color="gray.700"
                size="md"
                fontWeight="500"
                fontSize={{ base: '15px', md: 'sm' }}
                h={{ base: '54px', md: 'auto' }}
                minH={{ base: '52px', md: 'auto' }}
                w={{ base: '100%', md: 'auto' }}
                py={2.5}
                px={5}
                borderRadius={{ base: '18px', md: 'full' }}
                justifyContent={{ base: 'flex-start', md: 'center' }}
                boxShadow="0 1px 2px rgba(0,0,0,0.04)"
                transition="transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease"
                onClick={() => { void handleSuggestionClick(prompt); }}
                _hover={{
                  bg: 'brand.50',
                  borderColor: 'brand.400',
                  color: 'brand.700',
                  boxShadow: '0 2px 8px rgba(201, 31, 61, 0.12)',
                  transform: 'translateY(-1px)',
                }}
                _focusVisible={{
                  outline: '2px solid',
                  outlineColor: 'brand.500',
                  outlineOffset: '2px',
                }}
                _active={{
                  transform: 'scale(0.98)',
                }}
              >
                {prompt}
              </Button>
            ))}
          </Flex>
        )}
      </VStack>

      <ChipImageLightbox />

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
            {pendingValidMessage || pendingValidConfirm ? (
              <Box mt={3} mb={4} p={3} bg="#f0fdf4" borderRadius="8px" borderLeft="3px solid #16a34a">
                <Text fontSize="12.5px" color="#15803d" fontWeight="600">
                  ✓ Don't worry — we'll still generate the quote for your other available service
                  {(pendingValidConfirm?.rows.length ?? 0) > 1 ||
                  (pendingValidMessage?.toLowerCase().includes(' and ') ?? false)
                    ? 's'
                    : ''}.
                </Text>
                <Text fontSize="12px" color="#166534" mt={1}>
                  Click <b>Close &amp; Generate Quote</b> to review and confirm the available service(s).
                </Text>
              </Box>
            ) : (
              <Text fontSize="12px" color="gray.500" mt={3} mb={4}>
                Please try a different service for{' '}
                {unavailableServices.map(s => s.city).join(', ')}.
              </Text>
            )}

            <HStack spacing={3} justify="flex-end">
              {(pendingValidMessage || pendingValidConfirm) && (
                <Button
                  size="sm"
                  variant="outline"
                  borderColor="gray.300"
                  color="gray.600"
                  borderRadius="8px"
                  onClick={() => {
                    setUnavailableServices([]);
                    setPendingValidMessage(null);
                    setPendingValidConfirm(null);
                  }}
                  _hover={{ bg: 'gray.50' }}
                >
                  Cancel
                </Button>
              )}
              <Button
                size="sm"
                bg={pendingValidMessage || pendingValidConfirm ? '#16a34a' : '#1a3a5c'}
                color="white"
                borderRadius="8px"
                onClick={() => {
                  if (pendingValidMessage || pendingValidConfirm) {
                    void handleUnavailableProceed();
                  } else {
                    setUnavailableServices([]);
                  }
                }}
                _hover={{ bg: pendingValidMessage || pendingValidConfirm ? '#15803d' : '#1e4d78' }}
              >
                {pendingValidMessage || pendingValidConfirm ? 'Close & Generate Quote' : 'Close'}
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

            {/* Scrollable Items Body — Table Layout */}
            <Box flex={1} overflowY="auto" pb={2}>
              {/* Table Header */}
              <Box
                display="grid"
                gridTemplateColumns="1fr 72px 56px 90px"
                px={{ base: 3, md: 6 }}
                py={2}
                bg="#1a3a5c"
              >
                {['SERVICE', 'QTY', 'MIN', 'CITY'].map((col) => (
                  <Text key={col} fontSize="11px" fontWeight="700" color="white" letterSpacing="0.05em">
                    {col}
                  </Text>
                ))}
              </Box>

              {/* Table Rows — RED (below min) first, then GREEN (at/above min) */}

              {/* RED rows: items from minQtyWarning.items where requested < minimum */}
              {minQtyWarning.items.map((item, i) => {
                if (item.requested >= item.minimum) return null; // skip — will render in green section
                const dashIdx = item.description.lastIndexOf(' - ');
                const servicePart = dashIdx !== -1 ? item.description.slice(0, dashIdx) : item.description;
                const cityPart = dashIdx !== -1 ? item.description.slice(dashIdx + 3) : '';
                return (
                  <Box
                    key={`red-${i}`}
                    display="grid"
                    gridTemplateColumns="1fr 72px 56px 90px"
                    px={{ base: 3, md: 6 }}
                    py={{ base: 2, md: 2 }}
                    bg="#fff5f5"
                    borderBottom="1px solid"
                    borderColor="#fecaca"
                    borderLeft="3px solid #c0392b"
                    alignItems="center"
                  >
                    <Text fontSize={{ base: "11px", md: "12px" }} fontWeight="600" color="#2d3436" pr={2} lineHeight="1.4">
                      {servicePart}
                    </Text>
                    <Box>
                      {editingItemIndex === i ? (
                        <HStack spacing={1} align="center">
                          <input
                            type="number"
                            value={editedQuantity}
                            onChange={(e) => setEditedQuantity(e.target.value)}
                            placeholder="Qty"
                            autoFocus
                            style={{ color: '#2d3436', WebkitTextFillColor: '#2d3436', backgroundColor: 'white', fontSize: '13px', height: '26px', width: '64px', border: '1.5px solid #c0392b', borderRadius: '6px', textAlign: 'center', outline: 'none', padding: '0 4px' }}
                          />
                          <Button size="xs" bg="#1a3a5c" color="white" onClick={() => handleSaveEditedQuantity(i)} fontSize="10px" h="26px" minW="32px" px={1.5} borderRadius="6px" _hover={{ bg: '#1e4d78' }}>✓</Button>
                          <Button size="xs" variant="ghost" color="gray.500" onClick={handleCancelEdit} fontSize="10px" h="26px" minW="24px" px={1} borderRadius="6px">✕</Button>
                        </HStack>
                      ) : (
                        <HStack spacing={1} align="center">
                          <Text fontSize={{ base: "12px", md: "13px" }} fontWeight="700" color="#c0392b">{item.requested}</Text>
                          <IconButton aria-label="Edit quantity" icon={<FiEdit2 />} size="xs" variant="ghost" color="#1a3a5c" onClick={() => handleEditItemQuantity(i)} _hover={{ bg: 'gray.100' }} fontSize="11px" w="20px" h="20px" minW="20px" />
                        </HStack>
                      )}
                    </Box>
                    <Text fontSize={{ base: "12px", md: "13px" }} fontWeight="600" color="#c0392b">{item.minimum}</Text>
                    <Text fontSize={{ base: "11px", md: "12px" }} fontWeight="600" color="#2980b9">{cityPart || '—'}</Text>
                  </Box>
                );
              })}

              {/* GREEN rows: items from minQtyWarning.items that were edited to >= minimum */}
              {minQtyWarning.items.map((item, i) => {
                if (item.requested < item.minimum) return null; // skip — already shown in red section
                const dashIdx = item.description.lastIndexOf(' - ');
                const servicePart = dashIdx !== -1 ? item.description.slice(0, dashIdx) : item.description;
                const cityPart = dashIdx !== -1 ? item.description.slice(dashIdx + 3) : '';
                return (
                  <Box
                    key={`green-edited-${i}`}
                    display="grid"
                    gridTemplateColumns="1fr 72px 56px 90px"
                    px={{ base: 3, md: 6 }}
                    py={{ base: 2, md: 2 }}
                    bg="#f0fff4"
                    borderBottom="1px solid"
                    borderColor="#bbf7d0"
                    borderLeft="3px solid #27ae60"
                    alignItems="center"
                  >
                    <Text fontSize={{ base: "11px", md: "12px" }} fontWeight="600" color="#2d3436" pr={2} lineHeight="1.4">{servicePart}</Text>
                    <Box>
                      {editingItemIndex === i ? (
                        <HStack spacing={1} align="center">
                          <input
                            type="number"
                            value={editedQuantity}
                            onChange={(e) => setEditedQuantity(e.target.value)}
                            placeholder="Qty"
                            autoFocus
                            style={{ color: '#2d3436', WebkitTextFillColor: '#2d3436', backgroundColor: 'white', fontSize: '13px', height: '26px', width: '64px', border: '1.5px solid #27ae60', borderRadius: '6px', textAlign: 'center', outline: 'none', padding: '0 4px' }}
                          />
                          <Button size="xs" bg="#1a3a5c" color="white" onClick={() => handleSaveEditedQuantity(i)} fontSize="10px" h="26px" minW="32px" px={1.5} borderRadius="6px" _hover={{ bg: '#1e4d78' }}>✓</Button>
                          <Button size="xs" variant="ghost" color="gray.500" onClick={handleCancelEdit} fontSize="10px" h="26px" minW="24px" px={1} borderRadius="6px">✕</Button>
                        </HStack>
                      ) : (
                        <HStack spacing={1} align="center">
                          <Text fontSize={{ base: "12px", md: "13px" }} fontWeight="700" color="#27ae60">{item.requested}</Text>
                          <IconButton aria-label="Edit quantity" icon={<FiEdit2 />} size="xs" variant="ghost" color="#1a3a5c" onClick={() => handleEditItemQuantity(i)} _hover={{ bg: 'gray.100' }} fontSize="11px" w="20px" h="20px" minW="20px" />
                        </HStack>
                      )}
                    </Box>
                    <Text fontSize={{ base: "12px", md: "13px" }} fontWeight="600" color="#27ae60">{item.minimum}</Text>
                    <Text fontSize={{ base: "11px", md: "12px" }} fontWeight="600" color="#2980b9">{cityPart || '—'}</Text>
                  </Box>
                );
              })}

              {/* GREEN rows: original above-min items — display only, no edit icons */}
              {(minQtyWarning.aboveMinItems || []).map((item, i) => {
                const dashIdx = item.description.lastIndexOf(' - ');
                const servicePart = dashIdx !== -1 ? item.description.slice(0, dashIdx) : item.description;
                const cityPart = dashIdx !== -1 ? item.description.slice(dashIdx + 3) : '';
                return (
                  <Box
                    key={`green-above-${i}`}
                    display="grid"
                    gridTemplateColumns="1fr 72px 56px 90px"
                    px={{ base: 3, md: 6 }}
                    py={{ base: 2, md: 2 }}
                    bg="#f0fff4"
                    borderBottom="1px solid"
                    borderColor="#bbf7d0"
                    borderLeft="3px solid #27ae60"
                    alignItems="center"
                  >
                    <Text fontSize={{ base: "11px", md: "12px" }} fontWeight="600" color="#2d3436" pr={2} lineHeight="1.4">{servicePart}</Text>
                    <Text fontSize={{ base: "12px", md: "13px" }} fontWeight="700" color="#27ae60">{item.requested}</Text>
                    <Text fontSize={{ base: "12px", md: "13px" }} fontWeight="600" color="#27ae60">{item.minimum}</Text>
                    <Text fontSize={{ base: "11px", md: "12px" }} fontWeight="600" color="#2980b9">{cityPart || '—'}</Text>
                  </Box>
                );
              })}
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
                Min quantity applies. Can I use the minimum?
              </Text>
              <Stack 
                direction={{ base: "column", sm: "row" }} 
                spacing={{ base: 2, sm: 3 }} 
                justify={{ base: "stretch", sm: "flex-end" }}
              >
                <Button
                  size="sm"
                  variant="outline"
                  borderColor="gray.300"
                  color="gray.600"
                  onClick={handleMinQtyClose}
                  _hover={{ bg: 'gray.50' }}
                  w={{ base: "100%", sm: "auto" }}
                  h={{ base: "40px", sm: "36px" }}
                  fontSize={{ base: "13px", md: "14px" }}
                  borderRadius="10px"
                  order={{ base: 2, sm: 1 }}
                >
                  No
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
                    ? `Yes — use ${minQtyWarning.items[0].minimum}`
                    : `Yes — use minimums`}
                </Button>
              </Stack>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const ChatInterface: React.FC = () => {
  const chatProfileOpen = useAppStore((state) => state.chatProfileOpen);

  return chatProfileOpen ? (
    <Box
      className="qb-chat-root"
      display="flex"
      flexDirection="column"
      h="100%"
      w="100%"
      borderRadius={0}
      border="none"
      bg="white"
      overflow="auto"
    >
      <ChatProfilePanel />
    </Box>
  ) : (
    <ChatInterfaceContent />
  );
};

export default ChatInterface;
