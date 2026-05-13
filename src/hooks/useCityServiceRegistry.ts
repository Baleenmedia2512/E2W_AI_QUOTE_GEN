/**
 * useCityServiceRegistry
 * ──────────────────────
 * Builds and persists a city→services registry by calling Gemini once per
 * city PDF. Lives at App level so it runs regardless of which page is open.
 *
 * Registry is stored in:
 *   • module-level singleton Map  → survives HMR without sessionStorage reads
 *   • sessionStorage              → survives full page refresh in the same tab
 *
 * ChatInterface reads from this singleton directly via getCityServiceRegistry().
 */

import { useEffect } from 'react';
import { useAppStore } from '../store';

// ── Shared types ─────────────────────────────────────────────────────────────
export interface ServiceQuantity { min: number; max: number | null; }
export interface CityRegistry {
  services: string[];
  quantities: Record<string, ServiceQuantity>;
  status: 'building' | 'ready' | 'failed';
}

// ── Module-level singleton: survives HMR without re-parsing ──────────────────
const _registry = new Map<string, CityRegistry>();
const SESSION_KEY = 'e2w_city_service_registry';

export const getCityServiceRegistry = () => _registry;

// ── City list (single source of truth) ───────────────────────────────────────
export const KNOWN_CITY_LIST = [
  'chennai', 'madurai', 'coimbatore', 'salem', 'trichy', 'tirupur',
  'erode', 'vellore', 'tirunelveli', 'bangalore', 'hyderabad', 'mumbai', 'delhi', 'kochi',
];

// ── Helper: normalize a service name (strip dashes, parens, extra spaces) ────
function normalizeSvc(s: string): string {
  return s.toLowerCase().trim().replace(/[-–—]/g, ' ').replace(/[()[\]{}]/g, '').replace(/\s+/g, ' ').trim();
}

// ── Helper to save current map snapshot to sessionStorage ────────────────────
function persistToSession() {
  try {
    const snapshot: Record<string, CityRegistry> = {};
    _registry.forEach((val, key) => { snapshot[key] = val; });
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(snapshot));
  } catch { /* quota exceeded — silently skip */ }
}

// ── Restore from sessionStorage on first import ──────────────────────────────
// Runs once at module load time so the data is available before any component mounts.
try {
  const stored = sessionStorage.getItem(SESSION_KEY);
  if (stored) {
    const parsed: Record<string, CityRegistry> = JSON.parse(stored);
    Object.entries(parsed).forEach(([key, val]) => {
      if (val.status === 'ready') {
        // Normalize service names on restore so stale cached data is cleaned up
        const normalizedServices = val.services.map(normalizeSvc);
        const normalizedQuantities: Record<string, ServiceQuantity> = {};
        val.services.forEach((raw, i) => {
          normalizedQuantities[normalizedServices[i]] = val.quantities[raw] || val.quantities[normalizeSvc(raw)];
        });
        _registry.set(key, { ...val, services: normalizedServices, quantities: normalizedQuantities });
      }
    });
    if (_registry.size > 0) {
      console.log('♻️ [Registry] Restored from sessionStorage:', [..._registry.keys()].join(', '));
      console.log('📋 FULL CITY SERVICE REGISTRY (restored):', JSON.stringify(parsed, null, 2));
    }
  }
} catch { /* ignore corrupt storage */ }

// ── Hook ─────────────────────────────────────────────────────────────────────
export const useCityServiceRegistry = () => {
  const activeProposals = useAppStore(state => state.activeProposals);

  useEffect(() => {
    console.log(`🔍 [Registry] useEffect fired — ${activeProposals.length} active proposals`);
    activeProposals.forEach(proposal => {
      const cityKey = KNOWN_CITY_LIST.find(c =>
        proposal.fileName.toLowerCase().includes(c)
      ) || proposal.fileName.replace(/\.(pdf|xlsx?)$/i, '').toLowerCase().replace(/[^a-z]/g, '');

      if (!cityKey) return;

      const existing = _registry.get(cityKey);
      if (existing && (existing.status === 'ready' || existing.status === 'building')) return;

      if (!proposal.textContent || proposal.textContent.trim().length < 50) {
        console.warn(`⚠️ [Registry] Skipping "${cityKey}" — textContent too short (${proposal.textContent?.trim().length ?? 0} chars)`);
        _registry.set(cityKey, { services: [], quantities: {}, status: 'failed' });
        return;
      }

      _registry.set(cityKey, { services: [], quantities: {}, status: 'building' });
      console.log(`🏗️ [Registry] Building for "${cityKey}"...`);

      (async () => {
        try {
          const apiKey = (import.meta.env.VITE_GEMINI_API_KEY || '').trim();
          if (!apiKey) throw new Error('No API key');

          const { GoogleGenerativeAI } = await import('@google/generative-ai');
          const genAI = new GoogleGenerativeAI(apiKey);
          const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash-lite',
            generationConfig: { temperature: 0, responseMimeType: 'application/json' },
          });

          const prompt = `You are reading an outdoor advertising rate card.
Extract every distinct advertising service / variant that is ACTUALLY LISTED in this specific document, along with minimum and maximum quantity constraints if mentioned.

CRITICAL — anti-hallucination rules:
- ONLY extract services that literally appear (with the same words) in the rate card content below.
- DO NOT invent, complete, or carry-over services from any prior knowledge or examples.
- If the document does not list a category at all, do NOT include it.

What counts as a service (BE THOROUGH — do not skip rows that are present):
- Any row that names an advertising medium (vehicle, board, screen, banner, paper, radio slot, etc.) IS a service. Include it.
- Any qualifier on the same row (e.g. "semi", "full", "back", "front", "panel", "interior", "lit", "non-lit", a material name, a size code, a paper size) becomes part of the service name. Each such combination is its OWN entry.
- If a heading lists multiple variants underneath it, output ONE entry per variant (heading + variant), not one entry for the heading alone.
- When in doubt about a clearly-listed row, INCLUDE it rather than drop it. Only omit pure pricing sub-rows (see below).

Format rules:
- Return ONLY valid JSON — no markdown, no explanation, no commentary.
- Each service name must be lowercase.
- Skip rows that are pricing sub-components: rows whose text consists only of words like rental, printing, fixing, design, charges, installation, lamination, material, labour, artwork, gst, tax (these are sub-rows of a service, not services themselves).
- Do NOT include prices, sizes (in numbers), durations, city names, or company names in the service strings.
- If no minimum quantity is given for a service, use 1.
- If no maximum quantity is given, use null.

Output schema (use this STRUCTURE only — never copy the placeholder strings, never output a service that is not present in the document):
{
  "services": ["<service 1>", "<service 2>", "<service 3>"],
  "quantities": {
    "<service 1>": { "min": <number>, "max": <number|null> },
    "<service 2>": { "min": <number>, "max": <number|null> },
    "<service 3>": { "min": <number>, "max": <number|null> }
  }
}

Replace every <…> placeholder with a value taken DIRECTLY from the rate card content below.

Rate card content:
${proposal.textContent.slice(0, 12000)}`;

          const result = await model.generateContent(prompt);
          const raw = result.response.text().trim();
          const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
          const parsed = JSON.parse(jsonStr);

          const services: string[] = (parsed.services || []).map((s: string) => normalizeSvc(s));
          const quantities: Record<string, ServiceQuantity> = {};

          services.forEach(svc => {
            const rawKey = Object.keys(parsed.quantities || {}).find(k => normalizeSvc(k) === svc) || svc;
            const q = parsed.quantities?.[rawKey];
            quantities[svc] = {
              min: typeof q?.min === 'number' ? q.min : 1,
              max: typeof q?.max === 'number' ? q.max : null,
            };
          });

          _registry.set(cityKey, { services, quantities, status: 'ready' });
          persistToSession();

          console.log(`✅ [Registry] Ready for "${cityKey}": ${services.length} services`);
          const snapshot: Record<string, object> = {};
          _registry.forEach((val, key) => { snapshot[key] = val; });
          console.log('📋 FULL CITY SERVICE REGISTRY:', JSON.stringify(snapshot, null, 2));
        } catch (err) {
          console.warn(`⚠️ [Registry] Build failed for "${cityKey}":`, err);
          _registry.set(cityKey, { services: [], quantities: {}, status: 'failed' });
        }
      })();
    });
  }, [activeProposals]);
};
