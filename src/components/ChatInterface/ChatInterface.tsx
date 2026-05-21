import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import {
  Box,
  Input,
  VStack,
  HStack,
  Text,
  IconButton,
  Button,
  Spinner,
  Flex,
  Icon,
  Checkbox,
} from '@chakra-ui/react';
import React, { useState, useRef, useEffect } from 'react';
import { FiSend, FiCheck, FiMic } from 'react-icons/fi';
import { useHistory } from 'react-router-dom';

import {
  getCityServiceRegistry,
  KNOWN_CITY_LIST,
  type ServiceQuantity,
} from '../../hooks/useCityServiceRegistry';
import { sendMessageToGemini } from '../../services/geminiService';
import { loadAllProposalsFromCloud } from '../../services/supabaseProposalService';
import { useAppStore } from '../../store';
import { Message } from '../../types/chat';
import { Quote, QuoteItem } from '../../types/quote';
import { saveChatHistory, loadChatHistory } from '../../utils/localStorage';
import { DEFAULT_GENERAL_TERMS } from '../../utils/quoteGrouping';
import { logger } from '../../utils/logger';

const SUGGESTION_PROMPTS = [
  'Generate quote for 100 auto full branding',
  'Create quote for banner printing 10x5 feet, qty 50',
  'Quote for vehicle branding – 20 tempos',
  'Generate quote for shop signage',
  'Create quote for the services in proposal',
];

interface CityPickerSegment {
  raw: string; // Original segment text (e.g. "100 bus")
  cityNeeded: boolean; // true if no city was detected in this segment
  detectedCity: string | null; // City found in segment text (if any)
  selectedCities: string[]; // Cities chosen by user (multi-select)
  matchedCities?: string[]; // Cities where service is confirmed available (from registry)
}

const ChatInterface: React.FC = () => {
  const history = useHistory();
  const { proposal, setCurrentQuote, activeProposals } = useAppStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [_error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  // Cache: service key (lowercase) -> minimum quantity, persists across messages in the same session
  const minQtyCacheRef = useRef<Map<string, number>>(new Map());

  // ── City Service Registry ─────────────────────────────────────────────────
  // Built by useCityServiceRegistry() in App.tsx (runs on every page).
  // Read here via the module-level singleton — no local useEffect needed.
  const cityServiceRegistry = { current: getCityServiceRegistry() };
  // ─────────────────────────────────────────────────────────────────────────

  // Multi-select state for MULTIPLE_MATCH scenarios
  // Map: messageId -> { groupKey (vehicleType|city) -> string[] of selected service names }
  const [selectedServices, setSelectedServices] = useState<
    Record<string, Record<string, string[]>>
  >({});

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
  } | null>(null);

  // Multi-select for the city-only "all services" list.
  // Map: messageId -> set of "City|Service" keys → quantity (defaults to minQty).
  const [cityServiceSelection, setCityServiceSelection] = useState<Record<string, Record<string, number>>>({});

  // Minimum quantity warning dialog state
  const [minQtyWarning, setMinQtyWarning] = useState<{
    items: Array<{ description: string; requested: number; minimum: number }>;
    pendingQuote: Quote;
  } | null>(null);

  // Unavailable service alert state: shown when a service doesn't exist in a city's rate card
  const [unavailableServices, setUnavailableServices] = useState<
    Array<{ city: string; service: string }>
  >([]);
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
    const commaParts = request
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (commaParts.length > 1) {
      const allPartsHaveCity = commaParts.every((part) =>
        KNOWN_CITY_LIST.some((city) => part.startsWith(city)),
      );
      if (allPartsHaveCity) {
        logger.info(
          '✅ Client-side detection: Multi-city request detected, treating as EXACT_MATCH',
        );
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
      /auto back stickers/i,
      /metro interior/i,
      /cab\s+(?:full|back|interior)/i,
      /tempo\s+(?:full|back)/i,
      /apartment\s+lift/i,
      /traffic\s+(?:awareness|signal)/i,
    ];

    // If request matches any full service pattern, it's fully specified
    const hasFullServiceName = fullServicePatterns.some((pattern) => pattern.test(request));

    if (hasFullServiceName) {
      logger.info(
        '✅ Client-side detection: Request contains full service names, will skip MULTIPLE_MATCH',
      );
      return true;
    }

    return false;
  };

  // Extract city names from activeProposals file names (matched against KNOWN_CITY_LIST)
  const getAvailableCities = (): string[] => {
    const cities: string[] = [];
    activeProposals.forEach((p) => {
      const nameLower = p.fileName.toLowerCase();
      KNOWN_CITY_LIST.forEach((city) => {
        if (nameLower.includes(city) && !cities.find((c) => c.toLowerCase() === city)) {
          cities.push(city.charAt(0).toUpperCase() + city.slice(1));
        }
      });
    });
    // Fallback: if no known city matched, use cleaned file names as city labels
    if (cities.length === 0) {
      activeProposals.forEach((p) => {
        const name = p.fileName
          .replace(/\.(pdf|xlsx?)$/i, '')
          .replace(/[_-]+/g, ' ')
          .trim();
        if (!cities.includes(name)) cities.push(name);
      });
    }
    return cities;
  };

  // Return first city from the list that appears in the text segment (case-insensitive)
  const detectCityInText = (text: string, cities: string[]): string | null => {
    const lower = text.toLowerCase();
    return cities.find(c => lower.includes(c.toLowerCase())) || null;
  };

  // Detect "city-only" queries — the user typed one or more known city names
  // with no service / quantity. Returns lowercase city keys (matches registry keys),
  // or [] if the query is anything more than just city names + filler words.
  // Examples that match: "madurai" · "coimbatore" · "show services in chennai"
  //                      "madurai, trichy" · "what's available in chennai"
  // Examples that DO NOT match: "50 auto chennai" · "bus in madurai" · "chennai vs madurai"
  const detectCityOnlyQuery = (text: string): string[] => {
    const availCities = getAvailableCities().map(c => c.toLowerCase());
    if (availCities.length === 0) return [];
    if (/\d/.test(text)) return []; // any digit → not a city-only query

    const cleaned = text
      .toLowerCase()
      .replace(/[?!.,;:]/g, ' ')
      .replace(/\b(show|me|all|list|services?|in|for|of|the|a|an|please|what|whats|which|available|need|want|want|i|about|tell|give)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return [];

    const tokens = cleaned.split(/\s+/).filter(Boolean);
    const cities: string[] = [];
    for (const t of tokens) {
      const match = availCities.find(c => c === t);
      if (!match) return []; // any non-city token disqualifies the query
      if (!cities.includes(match)) cities.push(match);
    }
    return cities;
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

    const parts = normalized
      .split(/\band\b|,/i)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const segments = parts.map((raw) => {
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
        .replace(/\s+/g, ' ')
        .trim();
      if (strippedRaw.length === 0 && seg.detectedCity) {
        // Only a city — inherit previous segment's service
        const prev = segments[i - 1];
        const prevService = prev.raw.replace(new RegExp(cities.join('|'), 'gi'), '').trim();
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
        .replace(/\s+/g, ' ')
        .trim();
      const dupKey = `${(s.detectedCity || '').toLowerCase()}|${svcKey}`;
      if (svcKey.length > 0 && seen.has(dupKey)) {
        logger.info(`🧹 [Dedup] dropping duplicate segment: "${s.raw}"`);
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
      setMessages(
        history.map((msg) => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
        })),
      );
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
    getCityServiceRegistry().forEach((entry) => {
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
    querySegment: string,
  ): {
    result: 'found' | 'not_found' | 'registry_unavailable';
    matchedService?: string;
    qty?: ServiceQuantity;
  } => {
    const entry = cityServiceRegistry.current.get(cityKey);
    if (!entry || entry.status !== 'ready' || entry.services.length === 0) {
      logger.info(`📋 [Registry] "${cityKey}" — not ready or empty`);
      return { result: 'registry_unavailable' };
    }

    logger.info(`📋 [Registry] "${cityKey}" services (${entry.services.length}):`, entry.services);

    // Clean query: strip city name, numbers, filler words
    const cleaned = querySegment
      .replace(new RegExp(`\\b${cityKey}\\b`, 'gi'), '')
      .replace(/\d+/g, '')
      .replace(
        /\b(need|for|the|a|an|in|at|of|and|months?|days?|weeks?|years?|i|want|please|generate|quote|services?|ads?|advertising|outdoor|campaign|some|any)\b/gi,
        '',
      )
      .toLowerCase()
      .trim();

    const userWords = cleaned.split(/\s+/).filter((w) => w.length >= 2);
    if (userWords.length === 0) return { result: 'registry_unavailable' };

    // Normalize a word to its base (strip trailing 's') for singular/plural matching
    // e.g. "hoardings" → "hoarding" → regex \bhoardings?\b matches both "hoarding" and "hoardings"
    const baseWord = (w: string) => w.replace(/s$/, '');

    // Forward match: ALL user words appear in registry service name
    const forwardMatches = entry.services.filter((svc) =>
      userWords.every((word) => new RegExp(`\\b${baseWord(word)}s?\\b`, 'i').test(svc)),
    );

    // Reverse match: ALL registry service words appear in user query (user typed more than needed)
    // e.g. "newspaper insertion paper size" → registry "newspaper insertion" → reverse match ✓
    const reverseMatches =
      forwardMatches.length === 0
        ? entry.services.filter((svc) => {
            const svcWords = svc.split(/\s+/).filter((w) => w.length >= 2);
            return svcWords.every((sw) =>
              userWords.some((uw) => new RegExp(`\\b${baseWord(sw)}s?\\b`, 'i').test(uw)),
            );
          })
        : [];

    const matches = forwardMatches.length > 0 ? forwardMatches : reverseMatches;

    logger.info(`🔍 [Registry] query="${querySegment}" → cleaned words: [${userWords.join(', ')}]`);
    logger.info(
      `🔍 [Registry] forwardMatches: [${forwardMatches.join(', ')}] | reverseMatches: [${reverseMatches.join(', ')}]`,
    );

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
    const cleaned = segText
      .replace(new RegExp(`\\b${cityKey}\\b`, 'gi'), '')
      .replace(/\d+/g, '')
      .replace(
        /\b(need|for|the|a|an|in|at|of|and|months?|days?|weeks?|years?|i|want|please|generate|quote|services?|ads?|advertising|outdoor|campaign|some|any)\b/gi,
        '',
      )
      .toLowerCase()
      .trim();
    const userWords = cleaned.split(/\s+/).filter((w) => w.length >= 2);
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

    const matches = entry.services.filter((svc) => {
      // Forward match: every user word appears (singular/plural) in service name.
      if (userWords.every((w) => wordMatchesService(w, svc))) return true;
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
    logger.info(
      `🧮 [Classify] city="${cityKey}" userWords=[${userWords.join(',')}] joined=[${joinedPairs.join(',')}] → ${matches.length} match(es): [${matches.join(' | ')}]`,
    );
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
          `${viewportHeight}px`,
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

  // Thin wrapper: reads inputValue from state and delegates to sendMessageWithContent
  const handleSendMessage = () => {
    if (!inputValue.trim() || isLoading) return;
    const text = inputValue;
    setInputValue('');
    sendMessageWithContent(text);
  };

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

    // ─── CITY-ONLY QUERY GATE ────────────────────────────────────────────────
    // If the user types just a city name (or a few cities) with no service / qty,
    // surface every service available in that city as clickable chips so they can
    // pick one without having to remember the catalogue. Examples that trigger:
    //   "madurai"  · "coimbatore"  · "show services in chennai"  · "madurai, trichy"
    if (!isQtyOverride && !isCheckboxConfirmedFlag) {
      const cityOnlyMatches = detectCityOnlyQuery(cleanedText);
      if (cityOnlyMatches.length > 0) {
        const lists = cityOnlyMatches
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


    // ─── CITY GATE ────────────────────────────────────────────────────────────
    // When multiple city PDFs are loaded, every "and"-segment must have a city.
    // If any segment is missing a city, intercept and show a city picker UI
    // instead of sending to Gemini with an ambiguous city context.
    // Skip the gate entirely for fully-specified requests (e.g. "50 auto full branding")
    // — those go straight to Gemini as EXACT_MATCH.
    if (activeProposals.length > 1) {
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
        const segments: CityPickerSegment[] = rawSegments.map((seg) => {
          if (!seg.cityNeeded) return seg; // already has city in the text

          // Bug 4 (strict): ONLY list cities whose registry actually contains the service.
          // No text-scan fallback — if a registry isn't ready yet, that city is excluded
          // rather than guessed in (which previously let Madurai leak under "lamp post").
          const citiesWithService = availCities.filter((city) => {
            const cityKey =
              KNOWN_CITY_LIST.find((c) => city.toLowerCase().includes(c)) || city.toLowerCase();
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
        const hasServiceRequest = segments.some(
          (s) => s.cityNeeded && s.matchedCities !== undefined && s.matchedCities.length >= 2,
        );
        if (hasServiceRequest || forceCityPickerForSingleCityless) {
          const pickerMsgId = (Date.now() + 1).toString();
          const pickerMsg: Message = {
            id: pickerMsgId,
            role: 'assistant',
            content:
              '🏙️ Multiple city rate cards are loaded. Please select the city for each service below:',
            timestamp: new Date(),
            isCityPicker: true,
          };
          setMessages((prev) => [...prev, userMessage, pickerMsg]);
          setInputValue('');
          setCityPickerState({
            messageId: pickerMsgId,
            originalMessage: userMessage.content,
            segments,
            availableCities: availCities,
          });
          return; // Stop here — do NOT send to Gemini yet
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ─── PRE-GEMINI CITY-SERVICE AVAILABILITY CHECK (Registry-based) ────────
    // Replaces the old strict-parser check. Uses cityServiceRegistry built from
    // Gemini's one-time PDF read to verify service availability + quantity constraints.
    // NOTE: Do not skip checkbox-confirmed messages here; they still need
    // min/max quantity validation for consistent warning behavior.
    if (activeProposals.length > 1) {
      const availCitiesPre = getAvailableCities();
      if (availCitiesPre.length > 1) {
        const preSegments = parseSegmentsForCity(userMessage.content, availCitiesPre);
        const preAlerts: Array<{ city: string; service: string }> = [];
        const validSegmentRaws: string[] = [];
        // Parallel display labels (friendly: `{qty} {Service} ({City})`) — shown in the
        // "Already confirmed" panel. Falls back to the raw segment when service is unknown.
        const validSegmentLabels: string[] = [];
        const titleCaseSvc = (s: string) =>
          s
            .split(' ')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ');
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
            const unloadedCity = KNOWN_CITY_LIST.find(
              (city) =>
                new RegExp(`\\b${city}\\b`).test(segLower) &&
                !activeProposals.some((p) => p.fileName.toLowerCase().includes(city)),
            );
            if (unloadedCity) {
              const cityLabel = unloadedCity.charAt(0).toUpperCase() + unloadedCity.slice(1);
              const svcLabel =
                seg.raw
                  .replace(new RegExp(unloadedCity, 'gi'), '')
                  .replace(/\d+/g, '')
                  .replace(/\b(need|for|the|a|an|in|at|of|months?|days?|weeks?|years?)\b/gi, '')
                  .replace(/\s+/g, ' ')
                  .trim()
                  .split(' ')
                  .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
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
          const cityKey =
            KNOWN_CITY_LIST.find((c) => seg.detectedCity!.toLowerCase().includes(c)) ||
            seg.detectedCity.toLowerCase();
          const cls = classifySegmentByRegistry(cityKey, seg.raw);
          const cityLabel = seg.detectedCity.charAt(0).toUpperCase() + seg.detectedCity.slice(1);

          // — registry not built yet: try a generic price-line text scan as a stop-gap —
          if (cls.state === 'registry_unavailable') {
            const cityProposal = activeProposals.find((p) =>
              p.fileName.toLowerCase().includes(cityKey),
            );
            const userWords = seg.raw
              .replace(/\d+/g, '')
              .replace(new RegExp(`\\b${cityKey}\\b`, 'gi'), '')
              .replace(
                /\b(i|need|a|an|the|for|in|at|of|and|want|please|generate|quote|services?|ads?|advertising|outdoor|some|any)\b/gi,
                '',
              )
              .toLowerCase()
              .replace(/\s+/g, ' ')
              .trim()
              .split(/\s+/)
              .filter((w) => w.length >= 2);

            if (cityProposal?.textContent && userWords.length > 0) {
              // Generic heuristic: short line containing all user words AND a price/qty hint nearby
              const textLines = cityProposal.textContent.split(/\r?\n/);
              const found: string[] = [];
              for (const line of textLines) {
                const t = line.trim();
                if (t.length < 4 || t.length > 100) continue;
                const tLower = t.toLowerCase();
                const hasAllUserWords = userWords.every((w) => tLower.includes(w));
                const looksLikeServiceLine =
                  /(rs\.?|₹|\/-|\bsq\.?cm\b|\bsec\b|\bspot\b|\bday\b|\bmonth\b|\bper\b|\d{2,})/i.test(
                    t,
                  );
                if (hasAllUserWords && looksLikeServiceLine) {
                  const cleaned = t
                    .replace(/[:\-–—]\s*[\d₹,. ]+.*$/, '')
                    .replace(/\s+/g, ' ')
                    .trim();
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
            const svcLabel =
              seg.raw
                .replace(new RegExp(seg.detectedCity, 'gi'), '')
                .replace(/\d+/g, '')
                .replace(/\b(need|for|the|a|an|in|at|of|months?|days?|weeks?|years?)\b/gi, '')
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ')
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                .join(' ') || cityLabel;
            preAlerts.push({ city: cityLabel, service: svcLabel });
            continue;
          }

          // — vague → checkbox group —
          if (cls.state === 'vague') {
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
                const svcLabel = matchedSvc
                  .split(' ')
                  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                  .join(' ');
                preAlerts.push({
                  city: cityLabel,
                  service: `${svcLabel} (max ${max} units — you requested ${requestedQty})`,
                });
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
            const cityLabel =
              seg.detectedCity!.charAt(0).toUpperCase() + seg.detectedCity!.slice(1);
            // Use the FIRST matched service's leading word as the group label
            // (e.g. "Lamp Post Branding" → "Lamp Post"; "Newspaper Insertion - RE" → "Newspaper")
            const groupLabel = matches[0]
              .split(/[-–—]/)[0]
              .split(' ')
              .slice(0, 2)
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(' ')
              .trim();
            const relatedServices = matches.map((s) => ({
              name: s
                .split(' ')
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' '),
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
            setMessages((prev) => [...prev, userMessage, assistantMsg]);
            setInputValue('');
            return;
          }
        }

        if (preAlerts.length > 0) {
          setUnavailableServices(preAlerts);
          if (validSegmentRaws.length === 0) {
            setMessages((prev) => [...prev, userMessage]);
            return;
          }
          setMessages((prev) => [...prev, userMessage]);
          setPendingValidMessage(validSegmentRaws.join(' and '));
          return;
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

    try {
      // Prepare proposal contexts for AI
      let proposalContexts: Array<{ fileName: string; content: string }> | undefined;

      if (activeProposals.length > 0) {
        // Multi-location mode: use only user-selected active proposals
        proposalContexts = activeProposals
          .filter((p) => p.textContent && p.textContent.trim().length > 50)
          .map((p) => ({ fileName: p.fileName, content: p.textContent }));
        logger.info(
          `🎯 Multi-location mode: using ${proposalContexts.length} user-selected proposals`,
        );
      } else {
        // Default: Load all proposals from cloud for multi-document search
        let allProposals: any[] = [];
        try {
          allProposals = await loadAllProposalsFromCloud(100);
        } catch (err) {
          logger.warn('Could not load proposals from cloud, using current proposal only:', err);
        }

        if (allProposals && allProposals.length > 0) {
          // Multi-document mode: Send ALL uploaded proposals to AI
          proposalContexts = allProposals
            .filter((p) => p.text_content && p.text_content.trim().length > 50)
            .map((p) => ({
              fileName: p.file_name,
              content: p.text_content,
            }));
          logger.info(
            `📚 Multi-document search enabled: ${proposalContexts.length} documents available`,
          );
        }
      }

      // 🔧 CLIENT-SIDE VALIDATION: Check if request is fully specified (prevents checkbox loops)
      let enhancedUserMessage = userMessage.content;
      const isFullySpecified = isFullySpecifiedRequest(userMessage.content);

      if (isFullySpecified) {
        // Add instruction to AI to treat this as EXACT_MATCH
        enhancedUserMessage = `[EXACT_MATCH_HINT: This request contains full service names] ${enhancedUserMessage}`;
        logger.info('🔧 Added EXACT_MATCH hint to prevent re-analysis');
      }

      // Add city→PDF mapping hint when multiple PDFs are loaded so AI knows which
      // document to draw prices from for each city section
      if (activeProposals.length > 1) {
        const cityMappingHint = activeProposals
          .map((p) => {
            const name = p.fileName
              .replace(/\.(pdf|xlsx?)$/i, '')
              .replace(/[_-]+/g, ' ')
              .trim();
            return `"${p.fileName}" → ${name} pricing`;
          })
          .join('; ');
        enhancedUserMessage = `[CITY_PDF_MAP: ${cityMappingHint}] ${enhancedUserMessage}`;
        logger.info('🗺️ Added city→PDF mapping hint:', cityMappingHint);
      }

      const response = await sendMessageToGemini({
        userMessage: enhancedUserMessage,
        proposalText: proposal.textContent, // Backward compatibility fallback
        proposalTexts: proposalContexts, // NEW: Multi-document support
        chatHistory: messages,
      });

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

      // MULTIPLE_MATCH - Ask user to clarify
      if (response.isMultipleMatch && response.groupedServices) {
        logger.info('🔀 MULTIPLE_MATCH detected - Showing service options');
        logger.info('📋 Services by vehicle type:');
        response.groupedServices.forEach((group) => {
          logger.info(`  - ${group.vehicleType}: ${group.services.length} services found`);
          group.services.forEach((svc) => logger.info(`    • ${svc.name}`));
        });
        setMessages((prev) => [...prev, assistantMessage]);
        setIsLoading(false);
        return;
      }

      // PARTIAL_MATCH - Suggest alternatives
      if (response.isPartialMatch && response.closestServices) {
        setMessages((prev) => [...prev, assistantMessage]);
        setIsLoading(false);
        return;
      }

      // NO_MATCH - Show all services
      if (response.isNoMatch && response.allServicesGrouped) {
        setMessages((prev) => [...prev, assistantMessage]);
        setIsLoading(false);
        return;
      }

      // DEPRECATED: Handle old serviceNotFound format
      if (response.isServiceNotFound && response.availableServices) {
        assistantMessage.content =
          response.serviceNotFoundMessage ||
          `The requested service is not available in the proposal. Please select from the available services below:`;
        setMessages((prev) => [...prev, assistantMessage]);
        setIsLoading(false);
        return;
      }

      setMessages((prev) => [...prev, assistantMessage]);

      // EXACT_MATCH - Quote generated, process and navigate
      if (response.isQuoteGeneration && response.quoteData) {
        // Detect if source is a JPEG/image rate card (use standard terms) vs Excel/PDF proposal (use extracted terms)
        // Check the actual documents that were sent to Gemini (multi-doc or single doc)
        let isRateCardImage = false;
        if (proposalContexts && proposalContexts.length > 0) {
          // Multi-document mode: check if ALL documents are images
          isRateCardImage = proposalContexts.every((p) => {
            const ext = p.fileName.toLowerCase().split('.').pop() || '';
            return ['jpg', 'jpeg', 'png', 'webp'].includes(ext);
          });
        } else {
          // Single document mode: check current proposal
          const fileExtension = proposal.fileName.toLowerCase().split('.').pop() || '';
          isRateCardImage = ['jpg', 'jpeg', 'png', 'webp'].includes(fileExtension);
        }

        logger.info('🔍 Rate card detection:', {
          isRateCardImage,
          fileName: proposal.fileName,
          multiDoc: !!proposalContexts,
        });

        // Flatten lineItems into individual QuoteItems
        const quoteItems: QuoteItem[] = response.quoteData.items.flatMap(
          (section: any, sectionIndex: number) => {
            const sectionTitle = section.title || '';
            return section.lineItems.map((item: any, lineIndex: number) => {
              // Use original description from AI - don't prepend generic section title
              // The AI already provides specific service names (e.g., "BUS SEMI BRANDING - Rental Price")
              let description = item.description;

              // Check if description is too generic (missing specific service details)
              // Only prepend section title if description doesn't contain specific service keywords
              const hasSpecificService =
                /\b(BUS|AUTO|CAB|TAXI|TEMPO|TRUCK|VAN|VEHICLE|SHOP|BANNER|SIGNAGE|BOARD|HOARDING|DISPLAY|PRINTING|FIXING|RENTAL|BRANDING|FULL|SEMI|BACK|FRONT|SIDE)\b/i.test(
                  description,
                );
              const containsSectionTitle = description
                .toLowerCase()
                .includes(sectionTitle.toLowerCase());

              // Only prepend if description is generic AND doesn't already have section title
              if (sectionTitle && !containsSectionTitle && !hasSpecificService) {
                description = `${sectionTitle} - ${description}`;
              }

              // Extract specific service title from description for display in T&C section
              // This ensures we show "Bus Full Branding" instead of generic "Vehicle Branding"
              let specificTitle = '';
              const descParts = description.split(' - ');
              if (
                descParts.length >= 2 &&
                sectionTitle &&
                descParts[0].toLowerCase().trim() === sectionTitle.toLowerCase().trim()
              ) {
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

              const duration = item.duration && item.duration > 1 ? item.duration : undefined;
              const durationUnit: 'months' | 'days' | undefined =
                item.durationUnit || (duration ? 'months' : undefined);
              return {
                id: `${sectionIndex}-${lineIndex}`,
                title: specificTitle, // Store specific service title for T&C display
                description: description,
                quantity: item.quantity || 1,
                rate: item.unitPrice || 0,
                duration: duration,
                durationUnit: durationUnit,
                total: (item.quantity || 1) * (item.unitPrice || 0) * (duration || 1),
                minimumQuantity: item.minimumQuantity || undefined,
                // Only store terms on the first line item of each section to avoid duplicate textareas
                // For rate card images, clear per-item terms; for proposals, keep them
                termsAndConditions:
                  lineIndex === 0
                    ? isRateCardImage
                      ? undefined
                      : section.termsAndConditions || undefined
                    : undefined,
              };
            });
          },
        );

        // Deduplicate: Gemini sometimes extracts the same service section twice when the
        // PDF mentions it in both a pricing summary table AND a detailed section.
        // Keep only the first occurrence of each unique description (case-insensitive).
        const _seenDescriptions = new Set<string>();
        const uniqueQuoteItems = quoteItems.filter((item) => {
          const key = item.description.toLowerCase().trim();
          if (_seenDescriptions.has(key)) {
            logger.info(`⚠️ Duplicate item removed: "${item.description}"`);
            return false;
          }
          _seenDescriptions.add(key);
          return true;
        });
        if (uniqueQuoteItems.length < quoteItems.length) {
          logger.info(`🧹 Deduplication: ${quoteItems.length} → ${uniqueQuoteItems.length} items`);
          // Replace reference so all downstream code uses deduplicated list
          quoteItems.length = 0;
          quoteItems.push(...uniqueQuoteItems);
        }

        // Populate minimum-quantity cache from AI response so that future requests in the
        // same session can validate against known minimums even if the AI omits minimumQuantity.
        quoteItems.forEach((item) => {
          if (item.minimumQuantity) {
            const serviceKey = item.description.split(' - ')[0].toLowerCase().trim();
            minQtyCacheRef.current.set(serviceKey, item.minimumQuantity);
            logger.info(`📦 Cached min qty: "${serviceKey}" → ${item.minimumQuantity}`);
          }
        });

        const subtotal = quoteItems.reduce((sum, item) => sum + item.total, 0);
        const gstPercentage = 18;
        const gstAmount = subtotal * (gstPercentage / 100);

        // Use standard business terms for rate card images, extracted terms for Excel/PDF proposals
        let finalTermsAndConditions: string;

        if (isRateCardImage) {
          // Detected JPEG/image rate card - use standard terms
          finalTermsAndConditions = DEFAULT_GENERAL_TERMS.join('\n');
          logger.info('✅ Using DEFAULT_GENERAL_TERMS for image rate card');
        } else {
          // For Excel/PDF proposals, use extracted terms but filter out rate card artifacts
          const geminiTerms = response.quoteData.termsAndConditions || '';

          // Additional safety check: detect if Gemini extracted rate card footnotes instead of real T&C
          const isRateCardFootnote =
            geminiTerms.includes('மூக்க்கம்கககம்க்') || // Tamil text
            geminiTerms.includes('சர்வீஸ்') || // Tamil text
            geminiTerms.toLowerCase().includes('no explicit general terms') ||
            geminiTerms.toLowerCase().includes('no classified display ad') ||
            geminiTerms.toLowerCase().includes('srilanka edition') ||
            geminiTerms.toLowerCase().includes('rate card');

          if (isRateCardFootnote) {
            // Gemini extracted rate card notes, not real T&C - use defaults
            finalTermsAndConditions = DEFAULT_GENERAL_TERMS.join('\n');
            logger.info(
              '⚠️ Detected rate card footnotes in T&C, using DEFAULT_GENERAL_TERMS instead',
            );
          } else {
            // Looks like legitimate T&C from a proposal
            // If empty (common in multi-city responses), fall back to defaults
            finalTermsAndConditions = geminiTerms || DEFAULT_GENERAL_TERMS.join('\n');
            logger.info(
              geminiTerms
                ? '✅ Using extracted T&C from proposal document'
                : '✅ Using DEFAULT_GENERAL_TERMS (AI returned empty T&C)',
            );
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
          updatedAt: new Date(),
        };
        
        setCurrentQuote(quote);

        // Show success message before navigating
        const quoteReadyMessage: Message = {
          id: (Date.now() + 2).toString(),
          role: 'assistant',
          content: '✓ Quote generated successfully! Redirecting to quote preview...',
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, quoteReadyMessage]);

        // Auto-navigate to quote page after a brief delay
        setTimeout(() => {
          history.push('/quote');
        }, 1500);
      }
    } catch (err: any) {
      logger.error('Chat error:', err);
      setError(err.message || 'Failed to send message');
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: err.message || 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
        isError: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // Find the activeProposal whose fileName contains the given city name
  // Toggle a city on/off for a segment (multi-select)
  const handleCitySelection = (segmentIdx: number, city: string) => {
    setCityPickerState((prev) => {
      if (!prev) return prev;
      const newSegments = [...prev.segments];
      const seg = newSegments[segmentIdx];
      const alreadySelected = seg.selectedCities.includes(city);
      newSegments[segmentIdx] = {
        ...seg,
        selectedCities: alreadySelected
          ? seg.selectedCities.filter((c) => c !== city)
          : [...seg.selectedCities, city],
      };
      return { ...prev, segments: newSegments };
    });
  };

  // Select-all / Clear-all toggle for a city-picker segment
  const handleCitySelectAll = (segmentIdx: number, cities: string[]) => {
    setCityPickerState((prev) => {
      if (!prev) return prev;
      const newSegments = [...prev.segments];
      const seg = newSegments[segmentIdx];
      const allSelected = cities.length > 0 && cities.every((c) => seg.selectedCities.includes(c));
      newSegments[segmentIdx] = {
        ...seg,
        selectedCities: allSelected ? [] : [...cities],
      };
      return { ...prev, segments: newSegments };
    });
  };

  // Select-all / Clear-all toggle for a service group inside the multi-match UI
  const handleServiceSelectAll = (messageId: string, groupKey: string, serviceNames: string[]) => {
    setSelectedServices((prev) => {
      const messageMap = { ...(prev[messageId] || {}) };
      const current = messageMap[groupKey] || [];
      const allSelected = serviceNames.length > 0 && serviceNames.every((n) => current.includes(n));
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

  // Confirm city selections → extract services client-side per city → show checkboxes directly
  // Falls back to Gemini only if extraction fails
  const handleCityConfirm = () => {
    if (!cityPickerState) return;

    // Build one pair per { segment, city } combination
    const pairs: Array<{ raw: string; city: string; qty: number }> = [];
    cityPickerState.segments.forEach((seg) => {
      if (seg.cityNeeded && seg.selectedCities.length === 0) return;
      const cities = seg.cityNeeded
        ? seg.selectedCities
        : seg.detectedCity
          ? [seg.detectedCity]
          : [cityPickerState.availableCities[0]];
      const qtyMatch = seg.raw.match(/(\d+)/);
      const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
      cities.forEach((city) => pairs.push({ raw: seg.raw, city, qty }));
    });

    const groupedServices: Array<{
      vehicleType: string;
      requestedQuantity: number;
      services: Array<{ name: string; category: string }>;
    }> = [];
    // Pairs where user was specific enough → send straight to Gemini, skip checkboxes
    const directParts: string[] = [];
    const missingServiceAlerts: Array<{ city: string; service: string }> = [];
    let needsGemini = false;

    for (const pair of pairs) {
      const cityKey =
        KNOWN_CITY_LIST.find((c) => pair.city.toLowerCase().includes(c)) || pair.city.toLowerCase();
      const regCheck = checkServiceInRegistry(cityKey, pair.raw);
      const cityLabel = pair.city.charAt(0).toUpperCase() + pair.city.slice(1);

      if (regCheck.result === 'not_found') {
        const svcLabel = pair.raw
          .replace(/\d+/g, '')
          .replace(/\b(need|for|the|a|an|in|at|of)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim()
          .split(' ')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');
        missingServiceAlerts.push({ city: cityLabel, service: svcLabel });
        continue;
      }

      if (regCheck.result === 'registry_unavailable') {
        needsGemini = true;
        continue;
      }

      // 'found' — determine if user's query is specific or vague
      const matchedSvc = regCheck.matchedService!;

      // Count how many services in this city match the user's query (by base word)
      const registryEntry = cityServiceRegistry.current.get(cityKey);
      const baseWord = matchedSvc.toLowerCase().split(' ')[0];
      const relatedServices = registryEntry
        ? registryEntry.services
            .filter((s) => new RegExp(`\\b${baseWord}\\b`, 'i').test(s))
            .map((s) => ({
              name: s
                .split(' ')
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' '),
              category: matchedSvc
                .split(' ')
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' '),
            }))
        : [
            {
              name: matchedSvc
                .split(' ')
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' '),
              category: matchedSvc,
            },
          ];

      // Specific if: only ONE service matches in this city (unambiguous) OR user typed enough words
      const matchedWords = matchedSvc.toLowerCase().split(/\s+/);
      const userServiceWords = pair.raw
        .toLowerCase()
        .replace(new RegExp(`\\b${cityKey}\\b`, 'gi'), '')
        .replace(/\d+/g, '')
        .replace(
          /\b(need|for|the|a|an|in|at|of|and|i|want|please|services?|ads?|advertising|outdoor|some|any)\b/gi,
          '',
        )
        .replace(/\s+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((w) => w.length >= 2);

      const isUnique = relatedServices.length === 1; // only one service with this base word in the city
      const isWordSpecific =
        userServiceWords.length >= matchedWords.length &&
        userServiceWords.every((w) =>
          matchedWords.some((mw) => mw.startsWith(w) || w.startsWith(mw)),
        );
      const isSpecific = isUnique || isWordSpecific;

      if (isSpecific) {
        // User was precise OR only one option exists — skip checkboxes, send directly
        const svcTitleCase = matchedSvc
          .split(' ')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
        directParts.push(`${pair.qty} ${svcTitleCase} ${cityLabel}`);
        logger.info(
          `⚡ ${isUnique ? 'Unique' : 'Specific'} match: "${pair.raw}" → "${matchedSvc}" (${cityLabel}) — skipping checkboxes`,
        );
        continue;
      }

      // Vague — multiple services match, show checkboxes
      const vehicleLabel = matchedSvc
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      groupedServices.push({
        vehicleType: `${vehicleLabel}|${cityLabel}`,
        requestedQuantity: pair.qty,
        services: relatedServices,
      });
    }

    if (missingServiceAlerts.length > 0) {
      setUnavailableServices(missingServiceAlerts);
    }

    setCityPickerState(null);
    setInputValue('');

    // If ALL pairs were specific → send everything straight to Gemini
    if (directParts.length > 0 && groupedServices.length === 0 && !needsGemini) {
      const durationMatch = cityPickerState.originalMessage.match(/(\d+)\s*(days?|months?)/i);
      const durationSuffix = durationMatch ? ` for ${durationMatch[0]}` : '';
      const combined = `Generate quote for ${directParts.join(' and ')}${durationSuffix} [User has already specified complete service names from checkboxes]`;
      logger.info('⚡ All specific — sending direct to Gemini:', combined);
      sendMessageWithContent(combined);
      return;
    }

    // Mix of specific + vague OR registry unavailable → send specific ones as Gemini parts too
    if (needsGemini || (groupedServices.length === 0 && missingServiceAlerts.length === 0)) {
      const reconstructed = pairs
        .map((p) => `${p.city} ${p.qty > 1 ? p.qty + ' ' : ''}${p.raw.replace(/\d+/g, '').trim()}`)
        .join(' and ');
      sendMessageWithContent(reconstructed);
      return;
    }

    if (groupedServices.length === 0) return; // All unavailable or all direct

    // Some vague → show checkboxes (direct ones will be appended at confirm step via originalUserInput)
    const msgId = (Date.now() + 1).toString();
    const assistantMsg: Message = {
      id: msgId,
      role: 'assistant',
      content: `🔀 Multiple services found across ${groupedServices.length} group${groupedServices.length !== 1 ? 's' : ''}. Select all you need:`,
      timestamp: new Date(),
      isMultipleMatch: true,
      groupedServices,
      originalUserInput: cityPickerState.originalMessage,
      // Carry direct parts so handleConfirmAndGenerate can append them
      directParts,
      // Snapshot picker state so user can press "Back" to re-open the city picker
      cityPickerSnapshot: {
        originalMessage: cityPickerState.originalMessage,
        segments: cityPickerState.segments,
        availableCities: cityPickerState.availableCities,
      },
    };
    setMessages((prev) => [...prev, assistantMsg]);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInputValue(suggestion);
  };

  // Back button on the multi-match checkbox UI: re-open the city picker
  // using the snapshot saved on the message, and remove the checkbox message.
  const handleBackToCityPicker = (messageId: string) => {
    const msg = messages.find((m) => m.id === messageId);
    if (!msg?.cityPickerSnapshot) return;
    // Remove the multiple-match message and any prior assistant city-picker
    // message that triggered it (we'll show a fresh picker)
    setMessages((prev) => prev.filter((m) => m.id !== messageId && !m.isCityPicker));
    setSelectedServices((prev) => {
      const next = { ...prev };
      delete next[messageId];
      return next;
    });
    const pickerMsgId = (Date.now() + 1).toString();
    const pickerMsg: Message = {
      id: pickerMsgId,
      role: 'assistant',
      content:
        '🏙️ Multiple city rate cards are loaded. Please select the city for each service below:',
      timestamp: new Date(),
      isCityPicker: true,
    };
    setMessages((prev) => [...prev, pickerMsg]);
    setCityPickerState({
      messageId: pickerMsgId,
      originalMessage: msg.cityPickerSnapshot.originalMessage,
      segments: msg.cityPickerSnapshot.segments,
      availableCities: msg.cityPickerSnapshot.availableCities,
    });
  };

  // Handle min qty warning: user chooses to continue with requested qty
  const handleMinQtyContinue = () => {
    if (!minQtyWarning) return;
    const pending = pendingValidMessage;
    setMinQtyWarning(null);

    // Pre-Gemini path: pendingQuote is null — send pending FULL message (all segments) to Gemini.
    // Append [QTY_OVERRIDE] so the pre-Gemini qty check is skipped (user confirmed the qty).
    if (!minQtyWarning.pendingQuote) {
      if (pending) {
        setPendingValidMessage(null);
        setPendingMinReplacedMessage(null);
        sendMessageWithContent(pending + ' [QTY_OVERRIDE]');
      }
      return;
    }

    // Post-Gemini path: quote already generated by Gemini, just navigate
    const quoteReadyMessage: Message = {
      id: (Date.now() + 2).toString(),
      role: 'assistant',
      content: '✓ Quote generated successfully! Redirecting to quote preview...',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, quoteReadyMessage]);
    setTimeout(() => {
      history.push('/quote');
    }, 1500);
  };

  // Handle min qty warning: user chooses to use minimum quantities
  const handleMinQtyUseMinimum = () => {
    if (!minQtyWarning) return;
    const pending = pendingValidMessage;
    const minReplaced = pendingMinReplacedMessage;

    // Pre-Gemini path: pendingQuote is null — send the pre-rewritten FULL message that
    // already has each below-min segment's qty bumped to its registry minimum.
    if (!minQtyWarning.pendingQuote) {
      setMinQtyWarning(null);
      // Prefer the pre-rewritten multi-segment message; fall back to legacy single-segment behavior.
      const newMsg = minReplaced
        ?? (pending ? pending.replace(/\b\d+\b/, String(minQtyWarning.items[0]?.minimum ?? 1)) : null);
      if (newMsg) {
        setPendingValidMessage(null);
        setPendingMinReplacedMessage(null);
        sendMessageWithContent(newMsg);
      }
      return;
    }

    // Post-Gemini path: update quote item quantities to their minimums
    const updatedQuote = { ...minQtyWarning.pendingQuote };
    updatedQuote.items = updatedQuote.items.map((item) => {
      if (item.minimumQuantity && item.quantity < item.minimumQuantity) {
        const newQty = item.minimumQuantity;
        const duration = item.duration || 1;
        return { ...item, quantity: newQty, total: newQty * item.rate * duration };
      }
      return item;
    });
    const newSubtotal = updatedQuote.items.reduce((sum, i) => sum + i.total, 0);
    const newGst = newSubtotal * (updatedQuote.gstPercentage / 100);
    updatedQuote.subtotal = newSubtotal;
    updatedQuote.gstAmount = newGst;
    updatedQuote.total = newSubtotal + newGst;
    setCurrentQuote(updatedQuote);
    setMinQtyWarning(null);
    const quoteReadyMessage: Message = {
      id: (Date.now() + 2).toString(),
      role: 'assistant',
      content: '✓ Quote generated with minimum quantities! Redirecting to quote preview...',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, quoteReadyMessage]);
    setTimeout(() => {
      history.push('/quote');
    }, 1500);
  };

  // Handle clicking a service suggestion button (auto-sends as new message)
  const handleServiceSuggestionClick = (
    serviceName: string,
    isPartialMatch?: boolean,
    validServices?: string[],
  ) => {
    // Extract the original quantity from the last user message if possible
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    let quantity = '';
    if (lastUserMsg) {
      const qtyMatch = lastUserMsg.content.match(/(\d+)\s/);
      if (qtyMatch) quantity = qtyMatch[1] + ' ';
    }

    // For partial match: combine valid services + replacement
    if (isPartialMatch && validServices && validServices.length > 0 && lastUserMsg) {
      // Extract ALL quantities from the original user message
      const allQtys = [...lastUserMsg.content.matchAll(/(\d+)/g)].map((m) => m[1]);
      // Build combined quote: valid services from original + replacement for missing
      const validParts = validServices.map((svc, idx) => {
        const qty = allQtys[idx] || allQtys[0] || '';
        return `${qty} ${svc}`.trim();
      });
      // Use second quantity for replacement if available, otherwise first
      const replacementQty = allQtys.length > 1 ? allQtys[allQtys.length - 1] : allQtys[0] || '';
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
  const handleServiceCheckbox = (
    messageId: string,
    groupKey: string,
    serviceName: string,
    isChecked: boolean,
  ) => {
    setSelectedServices((prev) => {
      const newState = { ...prev };
      if (!newState[messageId]) newState[messageId] = {};
      const current = newState[messageId][groupKey] || [];
      if (isChecked) {
        newState[messageId][groupKey] = [...current, serviceName];
      } else {
        const updated = current.filter((s) => s !== serviceName);
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

  // Build confirmation table rows from selected services, then show table (don't send yet)
  const handleShowConfirmation = (messageId: string, groupedServices: any[]) => {
    const selected = selectedServices[messageId];
    const assistantMsg = messages.find((m) => m.id === messageId);
    const hasSelected = selected && Object.keys(selected).length > 0;
    const hasDirectParts = !!assistantMsg?.directParts?.length;
    // Allow confirmation when EITHER checkboxes are ticked OR directParts (auto-confirmed
    // services) exist. Previously bailed out when no checkbox was ticked, which made the
    // "Review & Confirm" button silently do nothing for users who only had auto-confirmed
    // services and didn't want any of the optional checkbox groups.
    if (!hasSelected && !hasDirectParts) return;

    const originalUserMsg = assistantMsg?.originalUserInput || '';
    const rows: Array<{ service: string; qty: number | string; city: string }> = [];

    groupedServices.forEach((group) => {
      const services = (selected && selected[group.vehicleType]) || [];
      services.forEach((svcName) => {
        // Extract city from vehicleType key if present (format: "Bus|Chennai")
        const [, city] = group.vehicleType.includes('|')
          ? group.vehicleType.split('|')
          : [group.vehicleType, ''];
        rows.push({ service: svcName, qty: group.requestedQuantity || '—', city: city || '—' });
      });
    });

    // Also add directParts (auto-confirmed services) to the confirmation table.
    // Accepted formats produced upstream:
    //   "100 Cab Branding (Chennai)"
    //   "100 Cab Branding (Chennai) ⚠️ below min 100"
    //   "100 Cab Branding Chennai"   (legacy, no parens)
    if (assistantMsg?.directParts?.length) {
      (assistantMsg.directParts as string[]).forEach(part => {
        // Strip any trailing warning marker (e.g. "⚠️ below min 100") before parsing.
        const cleaned = part.replace(/\s*⚠️.*$/u, '').trim();

        // Try "(City)" parenthesised form first.
        let m = cleaned.match(/^(\d+)\s+(.+?)\s*\(([^)]+)\)\s*$/);
        if (m) {
          rows.push({ service: m[2].trim(), qty: parseInt(m[1]), city: m[3].trim() });
          return;
        }
        // Fallback to legacy space-separated trailing-word city.
        m = cleaned.match(/^(\d+)\s+(.+?)\s+(\w+)$/);
        if (m) {
          rows.push({ service: m[2].trim(), qty: parseInt(m[1]), city: m[3].trim() });
          return;
        }
        rows.push({ service: cleaned || part, qty: 1, city: '—' });
      });
    }

    if (rows.length === 0) return;
    setConfirmationTable({ messageId, rows, originalUserInput: originalUserMsg });
  };

  // Final confirm: send selected services to Gemini
  const handleConfirmAndGenerate = () => {
    if (!confirmationTable) return;
    const { rows, originalUserInput } = confirmationTable;

    const durationMatch = originalUserInput.match(/(\d+)\s*(days?|months?)/i);
    const durationSuffix = durationMatch ? ` for ${durationMatch[0]}` : '';

    const parts = rows.map((r) =>
      r.city && r.city !== '—' ? `${r.qty} ${r.service} ${r.city}` : `${r.qty} ${r.service}`,
    );

    // directParts are already included in rows (added by handleShowConfirmation)
    const combinedRequest = `Generate quote for ${parts.join(' and ')}${durationSuffix} [User has already specified complete service names from checkboxes]`;
    logger.info('🔧 Confirmation → Gemini request:', combinedRequest);

    const clearedMsgId = confirmationTable.messageId;
    setConfirmationTable(null);
    setSelectedServices((prev) => {
      const newState = { ...prev };
      delete newState[clearedMsgId];
      return newState;
    });
    setInputValue('');
    sendMessageWithContent(combinedRequest);
  };

  // Initialize speech recognition for mobile using Capacitor plugin
  useEffect(() => {
    // Request permission on component mount for mobile
    if (Capacitor.isNativePlatform()) {
      SpeechRecognition.requestPermissions().catch((err) => {
        logger.warn('Microphone permission denied:', err);
      });
    }

    return () => {
      // Cleanup: stop any ongoing recognition
      if (Capacitor.isNativePlatform() && isRecording) {
        SpeechRecognition.stop().catch(() => undefined);
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
          logger.error('Error stopping voice recognition:', err);
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

          logger.info('Speech recognition result:', result);

          // Extract the recognized text from the result
          if (result && result.matches && result.matches.length > 0) {
            const transcript = result.matches[0];
            logger.info('Recognized text:', transcript);
            setInputValue((prev) => prev + (prev ? ' ' : '') + transcript);
          } else {
            logger.warn('No speech recognized');
          }

          setIsRecording(false);
        } catch (err: any) {
          logger.error('Voice recognition error:', err);
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
            setMessages((prev) => [...prev, errorMessage]);
          }
        }
      } else {
        // Web fallback: Use Web Speech API
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
          const SpeechRecognitionAPI =
            (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
          const recognition = new SpeechRecognitionAPI();
          recognition.continuous = false;
          recognition.interimResults = false;
          recognition.lang = 'en-US';

          recognition.onresult = (event: any) => {
            const transcript = event.results[0][0].transcript;
            setInputValue((prev) => prev + (prev ? ' ' : '') + transcript);
            setIsRecording(false);
          };

          recognition.onerror = (event: any) => {
            logger.error('Speech recognition error:', event.error);
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
          setMessages((prev) => [...prev, errorMessage]);
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
              {messages.map((message) => {
                // Parse message content for special formatting
                const lines = message.content.split('\n');
                const hasQuoteHeader = lines[0]?.toLowerCase().includes('quote generated');

                // Helper: bold key summary values
                function boldSummary(line: string) {
                  // Bold numbers and key phrases (e.g., 5 Mobile LED Vans, 3 months)
                  return line.replace(
                    /(\d+\s+Mobile LED Vans|\d+\s+months?|\d+\s+LED vans?|\d+\s+vans?)/gi,
                    '<b>$1</b>',
                  );
                }

                return (
                  <Box
                    key={message.id}
                    alignSelf={message.role === 'user' ? 'flex-end' : 'flex-start'}
                    maxW={message.role === 'user' ? '80%' : '90%'}
                  >
                    {message.role === 'assistant' && hasQuoteHeader ? (
                      // Special format for quote generation messages
                      <Box>
                        {/* Quote Header Badge */}
                        <HStack
                          spacing={2}
                          mb={3}
                          align="center"
                          bg="linear-gradient(135deg, #e6f7ff 0%, #e0f2fe 100%)"
                          px={4}
                          py={2.5}
                          borderRadius="12px"
                          border="1px solid"
                          borderColor="blue.200"
                          boxShadow="0 2px 6px rgba(14, 165, 233, 0.15)"
                        >
                          <Icon as={FiCheck} color="blue.600" boxSize="16px" fontWeight="bold" />
                          <Text
                            fontSize="13px"
                            fontWeight="700"
                            color="blue.700"
                            letterSpacing="tight"
                          >
                            {lines[0]}
                          </Text>
                        </HStack>

                        {/* Response Card */}
                        <Box
                          bg="white"
                          border="1px solid"
                          borderColor="gray.200"
                          px={{ base: 4, md: 5 }}
                          py={{ base: 4, md: 5 }}
                          borderRadius="14px"
                          boxShadow="0 4px 12px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.08)"
                        >
                          <VStack align="stretch" spacing={2.5}>
                            {(() => {
                              // Filter out all lines inside ```json ... ``` code blocks
                              let inCodeBlock = false;
                              return lines.slice(1).map((line, idx) => {
                                if (line.trim().startsWith('```json')) {
                                  inCodeBlock = true;
                                  return null;
                                }
                                if (inCodeBlock && line.trim() === '```') {
                                  inCodeBlock = false;
                                  return null;
                                }
                                if (inCodeBlock) return null;
                                if (!line.trim()) return null;
                                return (
                                  <Text
                                    key={idx}
                                    fontSize="14px"
                                    color="gray.700"
                                    lineHeight="1.7"
                                    fontWeight="500"
                                    dangerouslySetInnerHTML={{ __html: boldSummary(line) }}
                                  />
                                );
                              });
                            })()}
                          </VStack>

                          {/* Code Block - if message contains JSON */}
                          {message.content.includes('```json') &&
                            (() => {
                              const raw =
                                message.content.match(/```json\n([\s\S]*?)```/)?.[1] || '';
                              // Enhanced syntax highlighting
                              const highlighted = raw.replace(
                                /("(?:[^"\\]|\\.)*")\s*(:)|("(?:[^"\\]|\\.)*")|(true|false|null)|(\d+(?:\.\d+)?)/g,
                                (
                                  match: string,
                                  key: string,
                                  colon: string,
                                  str: string,
                                  bool: string,
                                  num: string,
                                ) => {
                                  if (key && colon)
                                    return `<span style="color:#fbbf24; font-weight:600">${key}</span><span style="color:#9ca3af">${colon}</span>`;
                                  if (str) return `<span style="color:#34d399">${str}</span>`;
                                  if (bool)
                                    return `<span style="color:#60a5fa; font-weight:600">${bool}</span>`;
                                  if (num)
                                    return `<span style="color:#a78bfa; font-weight:600">${num}</span>`;
                                  return match;
                                },
                              );
                              return (
                                <Box
                                  bg="linear-gradient(135deg, #1e293b 0%, #0f172a 100%)"
                                  p={4}
                                  borderRadius="12px"
                                  fontSize="12px"
                                  fontFamily="'Consolas', 'Monaco', monospace"
                                  overflowX="auto"
                                  mt={4}
                                  maxW={{ base: '100%', md: '380px' }}
                                  border="1px solid"
                                  borderColor="gray.700"
                                  boxShadow="inset 0 2px 4px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.15)"
                                  sx={{
                                    '::-webkit-scrollbar': { height: '6px' },
                                    '::-webkit-scrollbar-track': {
                                      bg: 'whiteAlpha.100',
                                      borderRadius: '3px',
                                    },
                                    '::-webkit-scrollbar-thumb': {
                                      bg: 'whiteAlpha.300',
                                      borderRadius: '3px',
                                    },
                                  }}
                                >
                                  <Box
                                    as="pre"
                                    whiteSpace="pre"
                                    fontSize="12px"
                                    fontFamily="'Consolas', 'Monaco', monospace"
                                    color="#e5e7eb"
                                    lineHeight="1.6"
                                    m={0}
                                    dangerouslySetInnerHTML={{ __html: highlighted }}
                                  />
                                </Box>
                              );
                            })()}
                        </Box>
                      </Box>
                    ) : (
                      // Regular message format
                      <Box>
                        <Box
                          bgGradient={
                            message.role === 'user'
                              ? 'linear(135deg, #dc2626 0%, #be123c 50%, #9f1239 100%)'
                              : undefined
                          }
                          bg={message.role === 'user' ? undefined : 'white'}
                          border={message.role === 'user' ? 'none' : '1px solid'}
                          borderColor={message.role === 'user' ? undefined : 'gray.200'}
                          color={message.role === 'user' ? 'white' : 'gray.800'}
                          px={{ base: 4, md: 5 }}
                          py={{ base: 3.5, md: 4 }}
                          borderRadius={
                            message.role === 'user' ? '20px 20px 4px 20px' : '4px 16px 16px 16px'
                          }
                          boxShadow={
                            message.role === 'user'
                              ? '0 8px 16px rgba(220, 38, 38, 0.25), 0 2px 4px rgba(220, 38, 38, 0.1)'
                              : '0 4px 12px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.08)'
                          }
                        >
                          <Text
                            fontSize="14px"
                            whiteSpace="pre-wrap"
                            lineHeight="1.6"
                            fontWeight="500"
                          >
                            {message.content}
                          </Text>
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

                        {/* 2️⃣ MULTIPLE_MATCH - Show grouped services with checkboxes (multi-select per group) */}
                        {message.isMultipleMatch &&
                          message.groupedServices &&
                          message.groupedServices.length > 0 && (
                            <Box mt={3}>
                              <Text
                                fontSize="12px"
                                fontWeight="600"
                                color="orange.600"
                                mb={3}
                                px={1}
                              >
                                🔀 Multiple services found. Select all you need:
                              </Text>

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
                                <Box
                                  mb={3}
                                  p={3}
                                  borderRadius="12px"
                                  bg="green.50"
                                  border="1px solid"
                                  borderColor="green.200"
                                >
                                  <Text fontSize="12px" fontWeight="700" color="green.700" mb={2}>
                                    ✅ Already confirmed:
                                  </Text>
                                  <VStack align="stretch" spacing={1}>
                                    {message.directParts.map((part, pIdx) => (
                                      <Text
                                        key={pIdx}
                                        fontSize="13px"
                                        color="green.700"
                                        fontWeight="500"
                                      >
                                        • {part}
                                      </Text>
                                    ))}
                                  </VStack>
                                </Box>
                              )}

                              <VStack align="stretch" spacing={4}>
                                {message.groupedServices.map((group, gIdx) => {
                                  const selectedForGroup =
                                    selectedServices[message.id]?.[group.vehicleType] || [];
                                  const [vehiclePart, cityPart] = group.vehicleType.includes('|')
                                    ? group.vehicleType.split('|')
                                    : [group.vehicleType, null];
                                  const groupServiceNames = group.services.map((s) => s.name);
                                  const allInGroupSelected =
                                    groupServiceNames.length > 0 &&
                                    groupServiceNames.every((n) => selectedForGroup.includes(n));
                                  return (
                                    <Box key={gIdx}>
                                      <HStack
                                        mb={2}
                                        px={1}
                                        spacing={2}
                                        align="center"
                                        justify="space-between"
                                      >
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
                                              <Text
                                                fontSize="11px"
                                                fontWeight="700"
                                                color="blue.600"
                                              >
                                                📍 {cityPart}
                                              </Text>
                                            </Box>
                                          )}
                                        </HStack>
                                        <Button
                                          size="xs"
                                          variant="ghost"
                                          colorScheme="blue"
                                          onClick={() =>
                                            handleServiceSelectAll(
                                              message.id,
                                              group.vehicleType,
                                              groupServiceNames,
                                            )
                                          }
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
                                                onChange={(e) =>
                                                  handleServiceCheckbox(
                                                    message.id,
                                                    group.vehicleType,
                                                    svc.name,
                                                    e.target.checked,
                                                  )
                                                }
                                                colorScheme="blue"
                                                size="md"
                                                spacing={3}
                                                cursor="pointer"
                                              >
                                                <Text
                                                  fontSize="13px"
                                                  fontWeight="500"
                                                  color={isChecked ? 'blue.700' : 'gray.700'}
                                                >
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
                              {(selectedServices[message.id] &&
                                Object.keys(selectedServices[message.id]).length > 0) ||
                              (message.directParts && message.directParts.length > 0) ? (
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
                                  onClick={() =>
                                    handleShowConfirmation(message.id, message.groupedServices!)
                                  }
                                  isDisabled={isLoading}
                                  _hover={{
                                    bgGradient:
                                      'linear(135deg, #b91c1c 0%, #9f1239 50%, #881337 100%)',
                                    transform: 'translateY(-2px)',
                                    boxShadow: '0 12px 24px rgba(220, 38, 38, 0.3)',
                                  }}
                                  _active={{ transform: 'translateY(0)' }}
                                  transition="all 0.2s ease"
                                  leftIcon={<Icon as={FiCheck} boxSize="18px" />}
                                >
                                  Review & Confirm (
                                  {Object.values(selectedServices[message.id] || {}).flat().length +
                                    (message.directParts?.length || 0)}{' '}
                                  service
                                  {Object.values(selectedServices[message.id] || {}).flat().length +
                                    (message.directParts?.length || 0) !==
                                  1
                                    ? 's'
                                    : ''}{' '}
                                  selected)
                                </Button>
                              ) : null}
                            </Box>
                          )}

                        {/* 3️⃣ PARTIAL_MATCH - Show closest alternatives */}
                        {message.isPartialMatch &&
                          !message.isServiceNotFound &&
                          message.closestServices &&
                          message.closestServices.length > 0 && (
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
                                  <Text
                                    fontSize="11px"
                                    fontWeight="700"
                                    color="green.600"
                                    textTransform="uppercase"
                                    letterSpacing="wider"
                                    mb={1}
                                    px={1}
                                  >
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
                                        rightIcon={
                                          svc.similarity === 'high' ? (
                                            <Text
                                              fontSize="10px"
                                              fontWeight="700"
                                              color="green.600"
                                            >
                                              HIGH
                                            </Text>
                                          ) : undefined
                                        }
                                      >
                                        {svc.name}
                                      </Button>
                                    ))}
                                  </VStack>
                                </Box>
                                {message.alternativeServices &&
                                  message.alternativeServices.length > 0 && (
                                    <Box>
                                      <Text
                                        fontSize="11px"
                                        fontWeight="700"
                                        color="blue.500"
                                        textTransform="uppercase"
                                        letterSpacing="wider"
                                        mb={1}
                                        px={1}
                                      >
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
                        {message.isCityPicker &&
                          cityPickerState &&
                          cityPickerState.messageId === message.id && (
                            <Box mt={3}>
                              <VStack align="stretch" spacing={4}>
                                {cityPickerState.segments.map((seg, segIdx) => {
                                  // Build service label from the segment
                                  const svcLabel = seg.raw
                                    .replace(/\d+/g, '')
                                    .replace(
                                      /\b(need|for|the|a|an|in|at|of|and|i|want|please)\b/gi,
                                      '',
                                    )
                                    .replace(/\s+/g, ' ')
                                    .trim()
                                    .split(' ')
                                    .map(
                                      (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
                                    )
                                    .join(' ');

                                  // Use pre-computed matchedCities from city gate (strict classifier).
                                  // Render-time fallback also stays strict — no registry_unavailable leak.
                                  const citiesWithService =
                                    seg.matchedCities ??
                                    cityPickerState.availableCities.filter((city) => {
                                      const cityKey =
                                        KNOWN_CITY_LIST.find((c) =>
                                          city.toLowerCase().includes(c),
                                        ) || city.toLowerCase();
                                      const cls = classifySegmentByRegistry(cityKey, seg.raw);
                                      return cls.state === 'specific' || cls.state === 'vague';
                                    });

                                  // Cities where registry explicitly says NOT available
                                  const citiesWithoutService =
                                    cityPickerState.availableCities.filter((city) => {
                                      if (citiesWithService.includes(city)) return false;
                                      const cityKey =
                                        KNOWN_CITY_LIST.find((c) =>
                                          city.toLowerCase().includes(c),
                                        ) || city.toLowerCase();
                                      const cls = classifySegmentByRegistry(cityKey, seg.raw);
                                      return cls.state === 'not_found' || cls.state === 'empty';
                                    });

                                  const allCitiesSelected =
                                    citiesWithService.length > 0 &&
                                    citiesWithService.every((c) => seg.selectedCities.includes(c));
                                  return (
                                    <Box
                                      key={segIdx}
                                      p={3}
                                      borderRadius="12px"
                                      bg="gray.50"
                                      border="1px solid"
                                      borderColor="gray.200"
                                    >
                                      {/* Service header */}
                                      <HStack justify="space-between" align="center" mb={2}>
                                        <Text
                                          fontSize="13px"
                                          fontWeight="700"
                                          color="gray.800"
                                          textTransform="uppercase"
                                          letterSpacing="wider"
                                        >
                                          {svcLabel}
                                        </Text>
                                        {seg.cityNeeded && citiesWithService.length > 1 && (
                                          <Button
                                            size="xs"
                                            variant="ghost"
                                            colorScheme="blue"
                                            onClick={() =>
                                              handleCitySelectAll(segIdx, citiesWithService)
                                            }
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
                                            <Text
                                              fontSize="13px"
                                              fontWeight="600"
                                              color="green.700"
                                            >
                                              ✅ Auto-assigned: <b>{seg.detectedCity}</b>
                                            </Text>
                                            <Text fontSize="11px" color="green.500">
                                              Only city available
                                            </Text>
                                          </HStack>
                                        </Box>
                                      ) : citiesWithService.length === 0 &&
                                        citiesWithoutService.length > 0 ? (
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
                                            const cityKey =
                                              KNOWN_CITY_LIST.find((c) =>
                                                city.toLowerCase().includes(c),
                                              ) || city.toLowerCase();
                                            const cls = classifySegmentByRegistry(cityKey, seg.raw);
                                            const minQty =
                                              cls.state === 'specific' || cls.state === 'vague'
                                                ? (cls.matches
                                                    .map(
                                                      (m) =>
                                                        cityServiceRegistry.current.get(cityKey)
                                                          ?.quantities[m]?.min,
                                                    )
                                                    .filter(
                                                      (n): n is number =>
                                                        typeof n === 'number' && n > 0,
                                                    )
                                                    .sort((a, b) => a - b)[0] ?? null)
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
                                                    onChange={() =>
                                                      handleCitySelection(segIdx, city)
                                                    }
                                                    colorScheme="blue"
                                                    size="md"
                                                    isDisabled={isLoading}
                                                  >
                                                    <Text
                                                      fontSize="13px"
                                                      fontWeight={isSelected ? '700' : '500'}
                                                      color={isSelected ? 'blue.700' : 'gray.700'}
                                                    >
                                                      {city}
                                                    </Text>
                                                  </Checkbox>
                                                  {minQty && minQty > 1 && (
                                                    <Text
                                                      fontSize="11px"
                                                      color="gray.400"
                                                      fontWeight="500"
                                                    >
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
                              {cityPickerState.segments.some(
                                (s) => s.cityNeeded && s.selectedCities.length > 0,
                              ) && (
                                <Button
                                  mt={4}
                                  w="full"
                                  bgGradient="linear(135deg, #dc2626 0%, #be123c 50%, #9f1239 100%)"
                                  color="white"
                                  fontWeight="700"
                                  fontSize="15px"
                                  py={6}
                                  borderRadius="14px"
                                  onClick={handleCityConfirm}
                                  isDisabled={isLoading}
                                  leftIcon={<Icon as={FiCheck} boxSize="18px" />}
                                  _hover={{
                                    bgGradient:
                                      'linear(135deg, #b91c1c 0%, #9f1239 50%, #881337 100%)',
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
                        {message.isServiceNotFound &&
                          message.availableServices &&
                          message.availableServices.length > 0 && (
                            <Box mt={3}>
                              {/* Show valid services info for partial matches */}
                              {message.isPartialMatch &&
                                message.validServices &&
                                message.validServices.length > 0 && (
                                  <Box mb={2} px={1}>
                                    <Text fontSize="12px" fontWeight="600" color="green.600">
                                      ✅ {message.validServices.join(', ')} — available
                                    </Text>
                                    {message.missingServices &&
                                      message.missingServices.length > 0 && (
                                        <Text
                                          fontSize="12px"
                                          fontWeight="600"
                                          color="red.500"
                                          mt={0.5}
                                        >
                                          ❌ {message.missingServices.join(', ')} — not available
                                        </Text>
                                      )}
                                    <Text fontSize="12px" color="gray.500" mt={1}>
                                      Select a replacement below to generate a combined quote:
                                    </Text>
                                  </Box>
                                )}
                              {!message.isPartialMatch && (
                                <Text
                                  fontSize="12px"
                                  fontWeight="600"
                                  color="gray.500"
                                  mb={2}
                                  px={1}
                                >
                                  Available services:
                                </Text>
                              )}
                              <VStack align="stretch" spacing={2}>
                                {/* Group by category */}
                                {(() => {
                                  const categories = new Map<
                                    string,
                                    typeof message.availableServices
                                  >();
                                  message.availableServices!.forEach((svc) => {
                                    const cat = svc.category || 'Other';
                                    if (!categories.has(cat)) categories.set(cat, []);
                                    categories.get(cat)!.push(svc);
                                  });
                                  return Array.from(categories.entries()).map(
                                    ([category, services]) => (
                                      <Box key={category}>
                                        <Text
                                          fontSize="11px"
                                          fontWeight="700"
                                          color="gray.400"
                                          textTransform="uppercase"
                                          letterSpacing="wider"
                                          mb={1}
                                          px={1}
                                        >
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
                                              onClick={() =>
                                                handleServiceSuggestionClick(
                                                  svc.name,
                                                  message.isPartialMatch,
                                                  message.validServices,
                                                )
                                              }
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
                                    ),
                                  );
                                })()}
                              </VStack>
                            </Box>
                          )}
                      </Box>
                    )}
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
                    {[0, 1, 2].map((i) => (
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
                            '50%': {
                              transform: 'translateY(-8px)',
                              opacity: 1,
                              boxShadow: '0 0 8px rgba(59, 130, 246, 0.5)',
                            },
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
          spacing={3}
          flexShrink={0}
          px={{ base: 3, md: 4 }}
          py={{ base: 4, md: 4 }}
          pb={{ base: 'calc(1rem + env(safe-area-inset-bottom, 0px))', md: 4 }}
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
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              onFocus={(e) => {
                // Auto-scroll input into view when keyboard appears
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
              fontSize={{ base: '16px', md: '16px' }}
              h={{ base: '56px', md: '60px' }}
              w="100%"
              px={{ base: 5, md: 6 }}
              fontWeight="500"
              transition="all 0.2s ease"
              _placeholder={{
                color: 'gray.500',
                fontSize: { base: '15px', md: '16px' },
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
                },
              }}
            />
          </Box>
          <Box
            position="relative"
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
          >
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
              aria-label={isRecording ? 'Stop recording' : 'Voice input'}
              icon={<FiMic />}
              onClick={toggleVoiceInput}
              isDisabled={isLoading}
              bgGradient={
                isRecording
                  ? 'linear(to-br, red.500, red.600, pink.500)'
                  : 'linear(to-br, blue.500, blue.600, cyan.500)'
              }
              color="white"
              size="md"
              h="48px"
              w="48px"
              minW="48px"
              borderRadius="full"
              flexShrink={0}
              fontSize="20px"
              position="relative"
              zIndex={1}
              border="2px solid"
              borderColor={isRecording ? 'red.300' : 'blue.300'}
              boxShadow={
                isRecording
                  ? '0 4px 20px rgba(239, 68, 68, 0.5), 0 0 30px rgba(239, 68, 68, 0.3), inset 0 1px 0 rgba(255,255,255,0.3)'
                  : '0 4px 16px rgba(59, 130, 246, 0.4), 0 0 24px rgba(59, 130, 246, 0.2), inset 0 1px 0 rgba(255,255,255,0.3)'
              }
              _hover={{
                bgGradient: isRecording
                  ? 'linear(to-br, red.600, red.700, pink.600)'
                  : 'linear(to-br, blue.600, blue.700, cyan.600)',
                transform: 'translateY(-2px) scale(1.05)',
                boxShadow: isRecording
                  ? '0 8px 28px rgba(239, 68, 68, 0.6), 0 0 40px rgba(239, 68, 68, 0.4), inset 0 1px 0 rgba(255,255,255,0.4)'
                  : '0 8px 24px rgba(59, 130, 246, 0.5), 0 0 32px rgba(59, 130, 246, 0.3), inset 0 1px 0 rgba(255,255,255,0.4)',
                borderColor: isRecording ? 'red.200' : 'blue.200',
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
              sx={
                isRecording
                  ? {
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
                    }
                  : {
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    }
              }
            />
          </Box>
          <IconButton
            aria-label="Send message"
            data-send-btn
            icon={isLoading ? <Spinner size="sm" color="white" thickness="3px" /> : <FiSend />}
            onClick={handleSendMessage}
            isDisabled={!inputValue.trim() || isLoading}
            bgGradient="linear(to-br, brand.500, brand.600)"
            color="white"
            size="lg"
            h={{ base: '56px', md: '60px' }}
            w={{ base: '56px', md: '60px' }}
            minW={{ base: '56px', md: '60px' }}
            borderRadius="16px"
            flexShrink={0}
            fontSize="22px"
            transition="all 0.2s ease"
            boxShadow="0 4px 20px rgba(201, 31, 61, 0.4), 0 2px 8px rgba(201, 31, 61, 0.25)"
            _hover={{
              bgGradient: 'linear(to-br, brand.600, brand.700)',
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

      {/* Confirmation Table Modal — shown after service selection, before Gemini call */}
      {confirmationTable && (
        <Box
          position="fixed"
          top="0"
          left="0"
          right="0"
          bottom="0"
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
            p={6}
            maxW="460px"
            w="100%"
            boxShadow="0 8px 32px rgba(0,0,0,0.18)"
          >
            <Text fontSize="16px" fontWeight="700" color="gray.800" mb={4}>
              📋 Confirm Your Services
            </Text>

            {/* Table Header */}
            <Box
              borderRadius="8px"
              overflow="hidden"
              border="1px solid"
              borderColor="gray.200"
              mb={4}
            >
              <HStack bg="gray.800" px={3} py={2} spacing={0}>
                <Text
                  flex={2}
                  fontSize="11px"
                  fontWeight="700"
                  color="white"
                  textTransform="uppercase"
                  letterSpacing="wider"
                >
                  Service
                </Text>
                <Text
                  flex={1}
                  fontSize="11px"
                  fontWeight="700"
                  color="white"
                  textTransform="uppercase"
                  letterSpacing="wider"
                  textAlign="right"
                >
                  City
                </Text>
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
                  <Text flex={2} fontSize="13px" fontWeight="500" color="gray.800">
                    {row.service}
                  </Text>
                  <Text
                    flex={1}
                    fontSize="13px"
                    color="blue.600"
                    fontWeight="600"
                    textAlign="right"
                  >
                    {row.city}
                  </Text>
                </HStack>
              ))}
            </Box>

            <Text fontSize="12px" color="gray.500" mb={5}>
              {confirmationTable.rows.length} service
              {confirmationTable.rows.length !== 1 ? 's' : ''} selected. Confirm to generate the
              quote.
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
      )}

      {/* Unavailable Service Alert */}
      {unavailableServices.length > 0 && (
        <Box
          position="fixed"
          top="0"
          left="0"
          right="0"
          bottom="0"
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
                  <b>{item.service}</b> is currently not offered in <b>{item.city}</b>.
                </Text>
              </Box>
            ))}

            {/* Context-aware footer message */}
            {pendingValidMessage ? (
              <Box
                mt={3}
                mb={4}
                p={3}
                bg="#f0fdf4"
                borderRadius="8px"
                borderLeft="3px solid #16a34a"
              >
                <Text fontSize="12.5px" color="#15803d" fontWeight="600">
                  ✓ Don't worry — we'll still generate the quote for your other available service
                  {pendingValidMessage.toLowerCase().includes(' and ') ? 's' : ''}.
                </Text>
                <Text fontSize="12px" color="#166534" mt={1}>
                  Click <b>Close</b> to proceed with the available request.
                </Text>
              </Box>
            ) : (
              <Text fontSize="12px" color="gray.500" mt={3} mb={4}>
                Please try a different service for{' '}
                {unavailableServices.map((s) => s.city).join(', ')}.
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
          top="0"
          left="0"
          right="0"
          bottom="0"
          bg="rgba(0,0,0,0.55)"
          zIndex={9999}
          display="flex"
          alignItems="center"
          justifyContent="center"
          px={4}
        >
          <Box
            bg="white"
            borderRadius="14px"
            p={6}
            maxW="420px"
            w="100%"
            boxShadow="0 8px 32px rgba(0,0,0,0.18)"
          >
            <Text fontSize="16px" fontWeight="700" color="#c0392b" mb={3}>
              ⚠️ Below Minimum Quantity
            </Text>
            {minQtyWarning.items.map((item, i) => (
              <Box
                key={i}
                mb={3}
                p={3}
                bg="#fff5f5"
                borderRadius="8px"
                borderLeft="3px solid #c0392b"
              >
                <Text fontSize="13px" fontWeight="600" color="#2d3436">
                  {item.description}
                </Text>
                <Text fontSize="12px" color="#636e72" mt={1}>
                  Minimum: <b>{item.minimum}</b> units &nbsp;|&nbsp; You requested:{' '}
                  <b>{item.requested}</b> units
                </Text>
              </Box>
            ))}
            <Text fontSize="12.5px" color="#636e72" mb={5}>
              Would you like to continue with your requested quantity, or update to the minimum?
            </Text>
            <HStack spacing={3} justify="flex-end">
              <Button
                size="sm"
                variant="outline"
                borderColor="#c0392b"
                color="#c0392b"
                onClick={handleMinQtyContinue}
                _hover={{ bg: '#fff5f5' }}
              >
                {minQtyWarning.items.length > 1
                  ? `Continue with requested (${minQtyWarning.items.length})`
                  : `Continue with ${minQtyWarning.items[0].requested}`}
              </Button>
              <Button
                size="sm"
                bg="#1a3a5c"
                color="white"
                onClick={handleMinQtyUseMinimum}
                _hover={{ bg: '#1e4d78' }}
              >
                {minQtyWarning.items.length > 1
                  ? `Use Minimums (${minQtyWarning.items.length})`
                  : `Use Minimum (${minQtyWarning.items[0].minimum})`}
              </Button>
            </HStack>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default ChatInterface;
