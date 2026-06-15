# Chat Interface — All Conditions Applied (Local Registry Flow)

**File:** `src/components/ChatInterface/ChatInterface.tsx`  
**Service:** `src/services/geminiService.ts`  
**Registry Hook:** `src/hooks/useCityServiceRegistry.ts`  
**Prompt:** `src/utils/promptTemplates.ts`  

---

## Total Condition Layers: 8 Layers + 25+ Individual Conditions

---

## LAYER 0 — Internal Bypass Flags (Stripped Before Any Gate)

These flags are added by the app internally and stripped from the displayed message and from what is sent to Gemini.

| # | Flag | Added When | Effect |
|---|---|---|---|
| C1 | `[QTY_OVERRIDE]` | User clicks "Continue" or "Use Minimum" in qty warning modal | Skips all min/max quantity checks in pre-Gemini loop |
| C2 | `[User has already specified complete service names from checkboxes]` | After confirmation table → Generate Quote | Skips vague checkbox UI, sends direct to Gemini |
| C3 | `[EXACT_MATCH_HINT: ...]` | When `isFullySpecifiedRequest()` returns `true` | Tells Gemini to treat request as EXACT_MATCH, skip checkbox flow |
| C4 | `[CITY_PDF_MAP: ...]` | When `activeProposals.length > 1` | Tells Gemini which PDF file corresponds to which city's pricing |

---

## LAYER 1 — `isFullySpecifiedRequest()` — Client-Side Bypass

Runs **before all gates**. Returns `true` → adds `[EXACT_MATCH_HINT]` to the message sent to Gemini.

| # | Condition | Example | Result |
|---|---|---|---|
| C5 | All comma-separated parts **start with a known city name** (`KNOWN_CITY_LIST`) | `"Chennai 50 auto, Madurai 100 bus"` | `true` → EXACT_MATCH hint added |
| C6 | Text matches **hardcoded full service regex patterns**: `bus full branding`, `bus semi branding`, `bus back panel`, `auto full branding`, `auto back stickers`, `metro interior`, `cab full/back/interior`, `tempo full/back`, `apartment lift`, `traffic awareness/signal` | `"50 auto full branding"` | `true` → EXACT_MATCH hint added |

> ⚠️ **Gap**: `"auto semi branding"` is **NOT** in the regex list → goes through all gates.

---

## LAYER 2 — RAG Search Gate

| # | Condition to SKIP (normal path) | Condition to TRIGGER |
|---|---|---|
| C7 | `isQuoteRequest = true` when text contains `generate\|create\|quote\|price\|cost\|for` **OR** any digit `\d+` → gate skipped | Text has NO digits AND NO quote keywords AND NOT a bypass flag → RAG vector search runs |

**If RAG triggers and returns results:** Shows purple service cards with similarity %, stops processing. Does not go to Gemini.

---

## LAYER 3 — City-Only Query Gate

| # | Condition to TRIGGER | Effect |
|---|---|---|
| C8 | No digits in text + text contains ONLY known city names + allowed filler words (`show/me/all/list/services/in/for/the/a/an/please/what/whats/which/available/need/want`) | Shows full service catalogue for that city as clickable chips with quantity stepper. Stops here. |
| C9 | Any non-city token found in cleaned text | Returns `[]` → gate skipped, continues to next layer |

---

## LAYER 4 — City Gate

**Entry condition:** `activeProposals.length > 1` AND `availCities.length > 1`

> If only 1 proposal is loaded → **entire gate bypassed** → goes straight to Gemini.

### 4a. Segment Parsing

| # | Condition | Action |
|---|---|---|
| C10 | Segment contains `"i need"` / `"i want"` / `"also need"` mid-sentence | Treated as `"and"` boundary, split into new segment |
| C11 | A segment is **only a city name** with no service words (e.g. `"madurai"` after `"100 bus semi branding Chennai and madurai"`) | Inherits service words from previous segment |
| C12 | Duplicate segment detected (same `city\|serviceKey`) | **Dropped** (dedup logic) |

### 4b. Per-Segment City Auto-Assignment

For each segment with no detected city:

| # | `citiesWithService` count | Condition | Action |
|---|---|---|---|
| C13 | 0 cities | Service not found in any registry | `matchedCities = []` — NOT shown in picker, falls through to next layer |
| C14 | 1 city | AND `forceCityPickerForSingleCityless = false` | **Auto-assigned silently** — `cityNeeded = false`, `detectedCity = that city` |
| C15 | 2+ cities | Service found in multiple cities | City picker shown for this segment |

### 4c. `forceCityPickerForSingleCityless`

| # | Condition | Effect |
|---|---|---|
| C16 | Exactly 1 segment + no city detected + no city in text (e.g. user types just `"auto"`) | Forces city picker even if only 1 city matches the service — prevents silent auto-assignment |

### 4d. `hasServiceRequest` Check

| # | Condition | Action |
|---|---|---|
| C17 | At least 1 segment has `matchedCities.length >= 2` OR `forceCityPickerForSingleCityless = true` | City picker UI shown, **processing stops here** |
| C18 | All segments have `matchedCities.length = 0` | Skip city picker, send to Gemini directly |

---

## LAYER 5 — Pre-Gemini Registry Availability Check

**Entry condition:** `activeProposals.length > 1` AND city gate did not intercept.

Loops through each segment. Uses `classifySegmentByRegistry()` as the single decision point.

### 5a. No City Detected in Segment

| # | Condition | Action |
|---|---|---|
| C19 | Segment mentions a **known city name** that is in `KNOWN_CITY_LIST` but NO PDF is loaded for it | `preAlerts` → "Service Not Available" modal |
| C20 | No city at all in segment | `validSegmentRaws` → sent to Gemini as-is |

### 5b. City Detected → `classifySegmentByRegistry(cityKey, segText)` states

| # | Classifier State | Condition | Action |
|---|---|---|---|
| C21 | `registry_unavailable` | Registry not built yet / empty for this city | → Text-scan fallback (see 5c) |
| C22 | `empty` | User typed only filler words, no service keywords remain after cleaning | → `preAlerts` |
| C23 | `not_found` | Service genuinely absent in this city's registry | → `preAlerts` |
| C24 | `specific` | Exactly 1 match, or TF-IDF clear winner (top score ≥ 1.0 AND ≥ 25% margin over runner-up) | → Qty validation (see 5d) |
| C25 | `vague` | 2+ matches, no clear TF-IDF winner | → `vagueSegments` (see 5e) |

### 5c. `registry_unavailable` → Text-Scan Fallback

Scans the raw PDF text for lines containing ALL user keywords + a price/qty hint (`₹|rs.|per|month|day|sec|spot|\d{2,}`):

| # | Found count | Action |
|---|---|---|
| C26 | 0 matches | Send to Gemini as-is |
| C27 | 1 match | Auto-confirm → `validSegmentRaws` |
| C28 | 2+ matches AND `[checkboxes confirmed]` flag present | Bypass checkbox UI → `validSegmentRaws` |
| C29 | 2+ matches AND no checkbox flag | → `vagueSegments` |

### 5d. `specific` → Qty Validation

| # | Condition | Action |
|---|---|---|
| C30 | `requestedQty < min` AND **no** `[QTY_OVERRIDE]` flag | → `belowMinSegments` (warning modal, but still queued for Gemini) |
| C31 | `requestedQty > max` (max is non-null) | → `preAlerts` (hard block, not sent to Gemini) |
| C32 | No qty in segment text | Defaults to `cls.qty.min` from registry |
| C33 | Valid qty | → `validSegmentRaws` |

### 5e. `vague` Handling

| # | Condition | Action |
|---|---|---|
| C34 | `[User has already specified complete service names from checkboxes]` flag present | Bypass checkbox UI → `validSegmentRaws` |
| C35 | No bypass flag | → `vagueSegments` → checkbox group shown |

### 5f. Final Decision After Loop (in priority order)

| # | Condition | UI Shown |
|---|---|---|
| C36 | `belowMinSegments.length > 0` | **Min qty warning modal** — all segments still queued, user chooses Continue / Use Minimum / Edit |
| C37 | `vagueSegments.length > 0` | **Checkbox group** (`isMultipleMatch` UI) with all vague groups shown |
| C38 | `preAlerts.length > 0` + `validSegmentRaws.length === 0` | **Unavailable service modal** only, processing stops |
| C39 | `preAlerts.length > 0` + `validSegmentRaws.length > 0` | **Unavailable service modal** + `pendingValidMessage` set (sends valid ones after user dismisses) |
| C40 | All segments valid, no alerts, no vague | Falls through to Gemini immediately |

---

## LAYER 6 — `classifySegmentByRegistry()` Internal Logic

### Cleaning Input

Strips from segment text before matching:
- City key name (`\b${cityKey}\b`)
- Standalone numbers (`\b\d+\b`) — preserves alphanumeric tokens like `a4`, `a5`
- Filler words: `need, for, the, a, an, in, at, of, and, months, days, weeks, years, i, want, please, generate, quote, services, ads, advertising, outdoor, campaign, some, any`

### Matching Algorithm (3 passes)

| # | Pass | Logic |
|---|---|---|
| C41 | **Forward match** | Every user word (singular/plural via `\b${baseWord}s?\b`) appears in service name |
| C42 | **Joined-pair tolerance** | Adjacent user words merged (`"lamp"+"post"` → tries `"lamppost"`) to handle spacing variants |
| C43 | **TF-IDF tie-break** | If 2+ candidates remain: score by IDF weights. Rare tokens (`"underground"`, `"lobby"`, `"lit"`) outweigh common ones (`"branding"`). Clear winner = top score ≥ 1.0 AND ≥ 25% margin → `specific`. Otherwise → `vague`. |

---

## LAYER 7 — Gemini Prompt Conditions (`CHAT_SYSTEM_PROMPT`)

The prompt enforces the 4-tier system on the AI side:

| # | Rule | Description |
|---|---|---|
| C44 | **Context Isolation** | AI must analyze ONLY current request, never use chat history to infer intent or skip checkboxes |
| C45 | `[EXACT_MATCH_HINT]` recognition | If present → treat as EXACT_MATCH immediately, skip all checkbox logic |
| C46 | **Strict keyword matching** | NO fuzzy matching. `"buss full"` ≠ `"bus full"` → PARTIAL_MATCH. Must be exact (case-insensitive only) |
| C47 | **Word order matters** | `"full bus"` ≠ `"bus full"` → PARTIAL_MATCH |
| C48 | **All services must be listed** | When showing MULTIPLE_MATCH, AI must include EVERY service containing the keyword, not just some |
| C49 | **Chat history restriction** | History used ONLY for Q&A follow-ups, remembering client details. NEVER to bypass 4-tier system |

### JSON Response Decision Order (in code)

| # | Parsed key | Tier | UI |
|---|---|---|---|
| C50 | `quoteGenerated: true` + `items[]` | EXACT_MATCH | Auto-navigate to `/quote` |
| C51 | `multipleMatch: true` + `groupedServices[]` | MULTIPLE_MATCH | Checkbox groups from Gemini |
| C52 | `partialMatch: true` + `closestServices[]` | PARTIAL_MATCH | Green "closest match" buttons |
| C53 | `noMatch: true` + `allServicesGrouped[]` | NO_MATCH | Full service catalogue by category |
| C54 | `serviceNotFound: true` + `availableServices[]` | DEPRECATED | Blue suggestion buttons (backward compat) |
| C55 | No JSON found / parse failed | Conversational | Plain text message shown |

### JSON Extraction Robustness

| # | Condition | Fix Applied |
|---|---|---|
| C56 | Gemini wraps JSON in markdown code fence ` ```json ``` ` | Extracted via regex first pass |
| C57 | No code fence, raw JSON in text | Balanced brace scan from first found key position |
| C58 | Literal newlines inside JSON string values | Escaped `\n → \\n`, `\t → \\t` before `JSON.parse()` |
| C59 | Invalid escape sequences (`\x`, `\s`, etc.) | Replaced with `\\\\` before parsing |

---

## LAYER 8 — Post-Gemini Quote Processing Conditions

Applied ONLY when `quoteGenerated: true`:

| # | Condition | Fix Applied |
|---|---|---|
| C60 | Line item description does NOT start with service type name | `validateAndFixQuoteDescriptions()` prepends `"ServiceName - "` |
| C61 | Description already contains service name anywhere (not just start) | Skip prepend (prevents double prefix) |
| C62 | Description starts with `"ServiceName - "` AND remainder already contains service name | Strip redundant prefix (dedup) |
| C63 | T&C line has no bullet (`•`, `-`, `*`, `1.`) | `cleanupTermsAndConditions()` merges orphan line into previous bullet |
| C64 | Orphan line at very start of T&C (no previous bullet to merge into) | Adds `• ` prefix |
| C65 | Duplicate line items (Gemini extracted same service from both summary table + detail page) | Deduplication by `description.toLowerCase().trim()` — keeps first occurrence |
| C66 | T&C contains Tamil text (`மூக்க்கம்`) or rate card artifacts (`rate card`, `srilanka edition`, `no explicit general terms`) | Replaced with `DEFAULT_GENERAL_TERMS` |
| C67 | T&C is empty string (common in multi-city responses) | Replaced with `DEFAULT_GENERAL_TERMS` |
| C68 | All proposal docs are image files (jpg/jpeg/png/webp) | Per-service T&C cleared, `DEFAULT_GENERAL_TERMS` used |
| C69 | Qty below minimum (detected post-Gemini from AI's `minimumQuantity` field) | `minQtyWarning` modal shown with Edit/Continue/Use Minimum options |
| C70 | GST | Hardcoded 18%, always enabled |
| C71 | `minimumQuantity` present in AI response | Cached in `minQtyCacheRef` (session-scoped) for future request validation |

---

## Registry Cache Conditions (`useCityServiceRegistry.ts`)

| # | Condition | Action |
|---|---|---|
| C72 | `localStorage` hit: same `pdfHash` + within TTL (7 days) + status `ready` + entries > 0 | Use cached registry, **no Gemini API call** |
| C73 | `sessionStorage` hit: status `ready` + entries > 0 | Use cached registry |
| C74 | Cache hit but status `failed` or `entries = 0` | **Reject cache**, rebuild from source |
| C75 | `##Inner Header content Service Name list` section found in PDF text | Fast-path: parse service names directly, only send to Gemini for pricing metadata |
| C76 | `(1/N)` page markers found in PDF text (service detail pages) | Fast-path: extract headings from page markers, only send to Gemini for pricing metadata |
| C77 | Neither fast-path works | Full Gemini extraction prompt sent (up to 50,000 chars of PDF text) |
| C78 | PDF text < 50 chars | Skip building registry, mark as `failed` |
| C79 | Proposal unloaded from `activeProposals` | Evict registry entry from module map + delete from localStorage |
| C80 | `pdfHash` mismatch (file changed) | Invalidate localStorage cache, rebuild |

---

## Known Gaps / Edge Cases

| # | Issue | Current Behavior |
|---|---|---|
| G1 | `tenkasi` not in `KNOWN_CITY_LIST` | Treated as service word, `not_found` in all cities, shown as "⚠ Not available" in city picker |
| G2 | `"auto semi branding"` not in `isFullySpecifiedRequest()` regex | Goes through all gates instead of fast-path |
| G3 | Chat history intentionally stripped before Gemini | Follow-up context lost (trade-off for consistent quote behavior) |
| G4 | `[QTY_OVERRIDE]` flag does NOT bypass max-quantity check | Only bypasses min-quantity check |
| G5 | Radio rate card hardcoded in `geminiService.ts` | Must be removed when Radio PDF is uploaded |
| G6 | `handleCityConfirm()` uses `checkServiceInRegistry()` (old function) not `classifySegmentByRegistry()` | Different matching logic between city gate and city confirm step |

---

## Summary Count

| Layer | Conditions Count |
|---|---|
| Layer 0 — Bypass flags | 4 |
| Layer 1 — Client-side bypass | 2 |
| Layer 2 — RAG gate | 1 |
| Layer 3 — City-only gate | 2 |
| Layer 4 — City picker gate | 9 |
| Layer 5 — Pre-Gemini registry check | 21 |
| Layer 6 — Classifier internal logic | 3 |
| Layer 7 — Gemini prompt + response | 12 |
| Layer 8 — Post-Gemini processing | 12 |
| Registry cache conditions | 9 |
| **TOTAL** | **75 conditions** |

---

*Last updated: 2026-06-15*  
*Analysed from: `ChatInterface.tsx`, `geminiService.ts`, `useCityServiceRegistry.ts`, `promptTemplates.ts`*
