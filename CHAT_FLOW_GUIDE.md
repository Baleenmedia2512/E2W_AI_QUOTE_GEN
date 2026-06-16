# Chat Interface — All Conditions & Scenarios (Simple Guide)

> **How to read this:** User types → Why it triggers → What they see → What Gemini gets/returns

---

## Decision Order (Every Message Goes Through This)

```
User types message
        ↓
1. Flag Stripping       (remove internal tokens like [QTY_OVERRIDE])
        ↓
2. RAG Search Gate      (no number + no "generate" = search, not quote)
        ↓
3. City-Only Gate       (user typed only a city name)
        ↓
4. City Picker Gate     (multi-city PDFs + missing city in request)
        ↓
5. Registry Validation  (check service exists + quantity limits)
        ↓
6. Send to Gemini       (everything above passed)
        ↓
7. Gemini Response      (4 possible outputs)
```

The **first gate that matches stops everything** and shows its UI. Only if nothing matches does the message reach Gemini.

---

---

## GATE 1 — Flag Stripping

### What it does
Removes hidden system tokens before any check runs. The user never sees these.

| Flag | Who sets it | What it tells the system |
|---|---|---|
| `[QTY_OVERRIDE]` | System (after user clicks "Continue" on qty warning) | Skip min-qty check this time |
| `[User has already specified complete service names from checkboxes]` | System (after checkbox confirm) | Don't show checkboxes again |

### Example
```
User clicked "Continue with 5" on a Bus Branding warning.
System internally sends:
  "5 bus full branding Chennai [QTY_OVERRIDE]"

After stripping:
  cleanedText   = "5 bus full branding Chennai"   ← shown in chat bubble
  isQtyOverride = true                             ← min-qty check skipped
```

---

---

## GATE 2 — RAG Search Gate

### Why it exists
When the user is **browsing** (no quantity, not asking to generate a quote), a fast vector database search is faster and cheaper than Gemini.

### Trigger rule
All of these must be true:
- No digit in the message
- None of these words: `generate / create / quote / price / cost / for`
- Not a retry/override message
- At least 2 words

### Examples

| User types | Triggers? | Reason |
|---|---|---|
| `bus branding` | ✅ Yes | No number, no quote keyword |
| `auto advertising options` | ✅ Yes | Pure search |
| `50 bus branding` | ❌ No | Has digit "50" |
| `generate quote for bus` | ❌ No | Has "generate" + "quote" |

### What user sees
```
📚 Found 3 matching services:

1. Bus Full Branding  (92.3% match)
   Full bus wrap branding on TNSTC buses. Minimum 10 units...
   [Generate Quote]

2. Bus Semi Branding  (87.1% match)
   ...
```

### Gemini involvement
**Zero.** Database query only. No API call.

---

---

## GATE 3 — City-Only Query Gate

### Why it exists
When the user types just a city name, they want to **see what's available**, not generate a quote. Show them every service in that city as clickable chips.

### Trigger rule
- No digits
- After removing filler words (`show / me / all / list / services / in / for / available / what / tell / give`), only known city names remain

### Examples

| User types | Triggers? | Reason |
|---|---|---|
| `chennai` | ✅ Yes | Only a city name |
| `show services in madurai` | ✅ Yes | After removing fillers → only "madurai" |
| `what's available in coimbatore` | ✅ Yes | Same |
| `madurai, trichy` | ✅ Yes | Two cities |
| `50 auto chennai` | ❌ No | Has digit |
| `bus in madurai` | ❌ No | "bus" is not a filler — disqualifies |

### What user sees
```
Here are all services available in Chennai. Tap any to start a quote:

📍 CHENNAI  (12 services)
[✓ Bus Full Branding (min 10)]  [Auto Full Branding]  [Newspaper Insertion]
[Bus Semi Branding]  [Auto Semi Branding]  [Lamp Post Branding] ...

2 services selected  [Generate Quote →]
```

Each chip has a quantity input (+/−) when selected.

### Gemini involvement
**Zero.** Data from local `cityServiceRegistry`.

---

---

## GATE 4 — City Picker Gate

### Why it exists
When **multiple city PDFs are loaded** (e.g., Chennai + Madurai rate cards simultaneously) and the user doesn't specify which city, the system asks them to choose.

### Trigger rule
```
activeProposals.length > 1
AND multiple cities detected in loaded files
AND at least one segment in the message has no city
AND that service exists in 2+ cities
```

### Auto-assign rule (no picker shown)
If the service only exists in **one** city's registry, the city is silently assigned. The picker only appears when the service exists in **two or more** cities.

### Examples

**Scenario A — City given, no picker:**
```
User: "50 auto full branding Chennai"
City "Chennai" is in the text → picker skipped → goes to Gemini directly
```

**Scenario B — Service only in one city, auto-assigned:**
```
User: "50 newspaper insertion"
Registry: newspaper insertion exists ONLY in Chennai, not Madurai
→ Auto-assigned to Chennai (no picker)
→ Message proceeds to Gate 5
```

**Scenario C — Service in both cities, picker appears:**
```
User: "50 auto branding"
Registry: auto branding exists in Chennai AND Madurai
→ City picker UI shown
```

**Scenario D — Two segments, one has city, one doesn't:**
```
User: "50 auto Chennai and 30 bus"
Segment 1: "50 auto Chennai"   → city found ✓
Segment 2: "30 bus"            → no city, exists in both → picker for bus
```

### What user sees
```
🏙️ Multiple city rate cards are loaded. Please select the city for each service below:

┌─ BUS ──────────────────────────────────┐
│  ☐ Chennai                   min 10   │
│  ☐ Madurai                   min 5    │
└────────────────────────────────────────┘

[✓ Confirm Cities & Continue]
```

### Gemini involvement
**Not yet.** After user confirms cities, the flow continues to Gate 5 or goes directly to Gemini.

---

---

## GATE 5 — Registry Validation (5 States)

### Why it exists
Before spending API tokens, validate locally:
1. Does the service exist in this city's rate card?
2. Is the quantity acceptable?

The function `classifySegmentByRegistry()` strips the segment down to keywords and matches against the registry's service list. It returns one of 5 states:

---

### State A — `registry_unavailable`
**Meaning:** Registry not yet built for this city (still loading).

**What happens:** Falls back to a raw text scan of the PDF. If that also fails, the segment passes to Gemini.

**Example:**
```
User: "50 bus Chennai"
Registry for Chennai: still loading...
→ Tries raw text scan of Chennai PDF
→ If a match is found: sends to Gemini
→ If not found: sends to Gemini anyway (let AI decide)
```

---

### State B — `empty`
**Meaning:** After stripping city, numbers, and filler words, nothing meaningful remains.

**What happens:** Treated as "not found" → shows alert.

**Example:**
```
User: "in Chennai for"
After cleanup: "" (empty string)
→ Alert: "Service is currently not offered in Chennai"
```

---

### State C — `not_found`
**Meaning:** The service keywords don't match any entry in this city's registry.

**What happens:** Shows "Service Not Available" alert modal.

**Example:**
```
User: "50 metro branding Chennai"
Registry: Chennai has bus, auto, newspaper... but NOT metro
→ Alert modal:
  ⚠️ Service Not Available
  ┌──────────────────────────────────────┐
  │ Metro Branding is currently not     │
  │ offered in Chennai.                 │
  └──────────────────────────────────────┘

  [Close]
```

If other segments in the message ARE valid, those still proceed to Gemini. The alert and the quote generation happen simultaneously.

---

### State D — `vague`
**Meaning:** 2+ services match the user's words — ambiguous request.

**What happens:** Shows a checkbox group so the user picks exactly which service(s) they want.

**Example:**
```
User: "50 bus Chennai"
Registry: Chennai has:
  - bus full branding
  - bus semi branding
  - bus back panel
→ State: vague (3 matches)

UI shown:
  Bus Services  📍 Chennai
  ☐ Bus Full Branding
  ☐ Bus Semi Branding
  ☐ Bus Back Panel

  [Select all]  [Clear all]

After user checks some:
  [✓ Review & Confirm (2 services selected)]
```

After confirm, the system internally sends to Gemini:
```
"Generate quote for 50 Bus Full Branding Chennai and 50 Bus Semi Branding Chennai
 [User has already specified complete service names from checkboxes]"
```

---

### State E — `specific`
**Meaning:** Exactly one service matches (or TF-IDF scoring picks a clear winner).

**What happens:** Quantity is checked against min/max before going to Gemini.

**Sub-case 1 — Below minimum:**
```
User: "5 bus full branding Chennai"
Registry: bus full branding, min=10, max=500
5 < 10 → Warning modal:

  ⚠️ Below Minimum Quantity
  ┌─────────────────────────────────────────┐
  │ Bus Full Branding - Chennai             │
  │ Minimum: 10 units | You requested: 5   │  [✏️ edit]
  └─────────────────────────────────────────┘

  Would you like to continue or update to minimum?
  [Continue with 5]  [Use Minimum (10)]
```

- **Continue with 5** → sends with `[QTY_OVERRIDE]` → Gemini generates quote for 5 units
- **Use Minimum (10)** → rewrites "5" to "10" in the message → sends to Gemini

**Sub-case 2 — Above maximum:**
```
User: "500 bus full branding Chennai"
Registry: bus full branding, max=200
500 > 200 → Alert:

  ⚠️ Service Not Available
  Bus Full Branding (max 200 units — you requested 500)
```

**Sub-case 3 — Valid quantity:**
```
User: "50 bus full branding Chennai"
Registry: min=10, max=500, 50 is valid
→ Passes to Gemini ✓
```

---

---

## GATE 6 — Message Enhancement Before Gemini

Just before calling Gemini, the message is enhanced with context hints:

### Enhancement 1 — EXACT_MATCH hint
Added when `isFullySpecifiedRequest()` detects full service names in the request.

```
Detected: "bus full branding" in the message
→ Prepends: "[EXACT_MATCH_HINT: This request contains full service names]"

Gemini receives:
  "[EXACT_MATCH_HINT: This request contains full service names] 50 bus full branding Chennai"
```

This tells Gemini to skip asking for clarification and generate the quote directly.

### Enhancement 2 — City-PDF mapping hint
Added when multiple PDFs are loaded.

```
Loaded: Chennai_Rates.pdf + Madurai_Rates.pdf
→ Prepends: "[CITY_PDF_MAP: "Chennai_Rates.pdf" → Chennai pricing; "Madurai_Rates.pdf" → Madurai pricing]"

Gemini receives:
  "[CITY_PDF_MAP: ...] 50 bus full branding Chennai"
```

This tells Gemini which PDF to draw prices from for each city.

### Service context sent to Gemini (RAG path)
Instead of sending full 131-page PDFs, only the relevant service data is sent:

```
SERVICE: Bus Full Branding
CITY: Chennai
PRICING STRUCTURE: separate
DISPLAY PRICE: ₹45000 per month
PRINTING & FIXING PRICE: ₹3500 per unit
MINIMUM: 10
SIZE: Full Bus (20ft x 5ft)
TERMS: Advance payment, 30-day cancellation notice
DESCRIPTION: Full wrap branding on government buses...
```

This is ~200 tokens vs 50,000 tokens for the full PDF.

---

---

## GATE 7 — Gemini's 4-Tier Response System

---

### TIER 1 — EXACT_MATCH (Quote Generated)

**When:** Gemini recognized a complete, valid quote request.

**Example inputs:**
```
"50 bus full branding Chennai"
"Generate quote for 100 auto full branding"
"30 lamp post branding Madurai for 3 months"
"Chennai 50 bus full branding, Madurai 30 auto semi branding"
```

**Gemini returns:**
```json
{
  "isQuoteGeneration": true,
  "quoteData": {
    "items": [
      {
        "title": "Bus Full Branding",
        "lineItems": [
          {
            "description": "Bus Full Branding - Display Rental",
            "quantity": 50,
            "unitPrice": 45000,
            "duration": 1,
            "durationUnit": "months",
            "minimumQuantity": 10
          },
          {
            "description": "Bus Full Branding - Printing & Fixing",
            "quantity": 50,
            "unitPrice": 3500
          }
        ],
        "termsAndConditions": "Advance payment required. 30 day notice for cancellation."
      }
    ],
    "termsAndConditions": "All prices subject to GST. Payment within 7 days.",
    "deliveryTimeline": "7 working days after payment",
    "gstPercentage": 18
  }
}
```

**What user sees:**
```
✓ Your Quote generated successfully!
→ Auto-redirects to /quote page in 1.5 seconds
```

**Quote built from Gemini's response:**
```
┌───────────────────────────────────────────────────────┐
│ Description                    Qty    Rate    Amount  │
├───────────────────────────────────────────────────────┤
│ Bus Full Branding - Display     50  ₹45,000  ₹22,50,000│
│ Bus Full Branding - Printing    50   ₹3,500  ₹1,75,000 │
├───────────────────────────────────────────────────────┤
│                          Subtotal:          ₹24,25,000 │
│                            GST 18%:          ₹4,36,500 │
│                               Total:        ₹28,61,500 │
└───────────────────────────────────────────────────────┘
```

---

### TIER 2 — MULTIPLE_MATCH (Checkbox Selection from Gemini)

**When:** Gemini received a vague request that matches multiple services (and the local registry didn't already catch this with its own checkbox UI).

**Example inputs:**
```
"50 bus"        (which bus service? full / semi / back panel?)
"auto branding" (multiple auto options)
"hoardings"     (many types: backlit, unlit, digital)
```

**Gemini returns:**
```json
{
  "isMultipleMatch": true,
  "groupedServices": [
    {
      "vehicleType": "Bus",
      "requestedQuantity": 50,
      "services": [
        { "name": "Bus Full Branding", "category": "Bus" },
        { "name": "Bus Semi Branding", "category": "Bus" },
        { "name": "Bus Back Panel", "category": "Bus" }
      ]
    }
  ]
}
```

**What user sees:**
```
🔀 Multiple services found. Select all you need:

Bus Services
☐ Bus Full Branding
☐ Bus Semi Branding
☐ Bus Back Panel

[Select all]  [Clear all]

[✓ Review & Confirm (0 services selected)]
```

**After user selects and confirms → system sends to Gemini:**
```
"Generate quote for 50 Bus Full Branding and 50 Bus Semi Branding
 [User has already specified complete service names from checkboxes]"
```

---

### TIER 3 — PARTIAL_MATCH (Alternatives Shown)

**When:** The requested service doesn't exist, but there are similar ones.

**Example inputs:**
```
"50 bus digital branding"   (digital not in rate card)
"auto roof branding"        (roof variant not offered)
"LED hoarding Chennai"      (LED type unavailable)
```

**Gemini returns:**
```json
{
  "isPartialMatch": true,
  "requestedService": "Bus Digital Branding",
  "requestedQuantity": 50,
  "closestServices": [
    { "name": "Bus Full Branding", "similarity": "high" },
    { "name": "Bus Semi Branding", "similarity": "medium" }
  ],
  "alternativeServices": [
    { "name": "Digital Billboard" }
  ]
}
```

**What user sees:**
```
❌ "Bus Digital Branding" is not available
Did you mean one of these similar services?

CLOSEST MATCHES
[✓ Bus Full Branding]  HIGH
[✓ Bus Semi Branding]

OTHER OPTIONS
[→ Digital Billboard]
```

Clicking any button **fills the chat input** with:
```
"50 Bus Full Branding"
```
...ready to send.

---

### TIER 4 — NO_MATCH (All Services Shown)

**When:** The requested service is completely unrecognized — nothing close to suggest.

**Example inputs:**
```
"drone advertising"
"TV commercial"
"social media campaign"
"YouTube ads"
```

**Gemini returns:**
```json
{
  "isNoMatch": true,
  "requestedService": "Drone Advertising",
  "allServicesGrouped": [
    {
      "category": "Bus Branding",
      "services": [
        { "name": "Bus Full Branding" },
        { "name": "Bus Semi Branding" }
      ]
    },
    {
      "category": "Auto Branding",
      "services": [
        { "name": "Auto Full Branding" },
        { "name": "Auto Semi Branding" }
      ]
    }
  ]
}
```

**What user sees:**
```
❌ We don't offer Drone Advertising
Browse all our available services:

BUS BRANDING
[→ Bus Full Branding]
[→ Bus Semi Branding]

AUTO BRANDING
[→ Auto Full Branding]
[→ Auto Semi Branding]
```

Clicking any button fills the input with that service name.

---

---

## SPECIAL: Multi-Segment Requests

When the user requests multiple services in one message, each comma/and-separated part is processed as a separate segment.

### Example: Both segments valid
```
Input: "50 bus full branding Chennai and 30 auto semi branding Madurai"

Segment 1: "50 bus full branding Chennai"
  → specific, qty=50 valid ✓

Segment 2: "30 auto semi branding Madurai"
  → specific, qty=30 valid ✓

Both valid → combined into one Gemini call:
  Quote has two sections:
    Bus Full Branding (Chennai) — 50 units
    Auto Semi Branding (Madurai) — 30 units
```

### Example: One valid, one not found
```
Input: "50 bus full branding Chennai and 30 metro Madurai"

Segment 1: valid → queued for Gemini
Segment 2: not_found

Result shown simultaneously:
  ⚠️ "Metro" is not available in Madurai
  ✓ Quote will be generated for Bus Full Branding Chennai
  [Close & Generate Quote]
```

### Example: One valid, one below minimum
```
Input: "50 bus full branding Chennai and 5 newspaper Madurai"

Segment 1: valid ✓
Segment 2: specific match found, but 5 < min(10)

Result:
  ⚠️ Below Minimum Quantity
  Newspaper Insertion - Madurai
  Minimum: 10 | You requested: 5

  [Continue with 5]  [Use Minimums]

Both segments stay in pendingValidMessage.
After user chooses, BOTH are sent to Gemini together.
```

---

---

## SPECIAL: Terms & Conditions Source Logic

After Gemini returns a quote, T&C are selected based on document type:

| Document type | T&C used |
|---|---|
| Image rate card (JPEG/PNG/WEBP) | Standard default terms |
| PDF/Excel proposal | Gemini-extracted T&C from document |
| Gemini returns Tamil characters | Fallback to standard defaults |
| Gemini returns "no explicit terms" | Fallback to standard defaults |
| Gemini returns empty string | Fallback to standard defaults |

---

---

## Quick Reference Table

| User types | Gate triggered | Output |
|---|---|---|
| `bus branding` | RAG Search | Purple search result cards |
| `chennai` | City-Only | Service chips for Chennai |
| `show services in madurai` | City-Only | Service chips for Madurai |
| `50 auto` (multi-city loaded) | City Picker | Pick Chennai or Madurai |
| `50 metro Chennai` | Registry: not_found | ⚠️ Not Available modal |
| `50 bus Chennai` (3 bus types) | Registry: vague | Checkbox group |
| `5 bus full branding Chennai` (min 10) | Registry: specific+below-min | ⚠️ Min Qty Warning modal |
| `500 bus Chennai` (max 200) | Registry: specific+over-max | ⚠️ Not Available modal |
| `50 bus full branding Chennai` | Gemini: EXACT_MATCH | ✓ Quote page redirect |
| `50 bus` (Gemini decides) | Gemini: MULTIPLE_MATCH | Checkbox group from AI |
| `bus digital branding` | Gemini: PARTIAL_MATCH | Closest alternatives |
| `drone advertising` | Gemini: NO_MATCH | All services catalogue |
