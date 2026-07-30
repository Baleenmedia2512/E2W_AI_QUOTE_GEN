# Plan: Unique Hoarding Sites via DB `service_id`

**Status:** Implemented (re-apply this doc if the change is reverted)  
**Goal:** Show every preferred-vendor (rank=1) hoarding site with its own pricing — different areas / towards / locations must not collapse into one catalog entry.

---

## 1. Problem

DB has many rank=1 hoarding rows, each with:

- Unique `service_id`
- Separate `pricing` (display + printing/mounting)
- Site fields: `direction_remarks`, `area_name`, lat/lng, etc.

But the app rebuilt catalog identity from a **cleaned `rate_key`**, e.g.:

```
hoarding|…|coimbatore|…|100 feet road towards power house|…|frontlit|…
  →  hoarding-frontlit-coimbatore
```

All Coimbatore Frontlit sites shared one id → only **one** survived in the map → wrong site/price (or “price not coming” for other sites).

---

## 2. Idea (product)

| Layer | Rule |
|--------|------|
| Identity | Always use DB **`service_id`** (unique per site) |
| Pricing | Keep that row’s `pricing.*` only — never merge sites |
| Label | Show medium + type + **location** so lists are readable |
| Matching | Resolve quote pricing by exact `service_id` first |
| Chat | Vague “hoarding Coimbatore” → list many sites; user picks |

Do **not** use cleaned `rate_key` / `hoarding-frontlit-{city}` as the primary catalog key.

---

## 3. Preconditions (DB)

Already true if data is correct:

- Each site has a unique `vendor_rate_chunks.service_id` (or `metadata.service_id`)
- Each site has its own `metadata.pricing` (`display_price`, printing/mounting, etc.)
- `preferred_vendor_rank = 1` for rows that should quote
- Prefer top-level `min_duration` + `duration_measurement_unit` (not only inside `pricing`)
- Prefer `direction_remarks` (or `area_name`) for UI labels

No DB migration required for this feature if the above is already in place.

---

## 4. Files to change

1. `src/types/vendorRate.ts` — extend `VendorRateRow`
2. `src/services/vendorRateService.ts` — normalize, match, display name, catalog build

---

## 5. Implementation steps (re-apply after revert)

### Step A — Types (`vendorRate.ts`)

Add to `VendorRateRow`:

```ts
service_id?: string;           // unique site id from DB
direction_remarks?: string;    // e.g. "100 feet Road towards Power house"
area_name?: string;            // fallback location label
```

### Step B — Normalize (`normalizeVendorRateRow`)

Preserve from row / metadata:

```ts
service_id: pickString(row.service_id, meta.service_id) || undefined
direction_remarks: pickString(meta.direction_remarks, row.direction_remarks) || undefined
area_name: pickString(meta.area_name, row.area_name) || undefined
```

Keep existing pricing / terms / images / review / top-level duration rules unchanged.

### Step C — Match (`resolveVendorRateRow`)

When `serviceId` is passed:

1. **Exact** match on `r.service_id === serviceId` → return that row (stop)
2. Only then fall back to legacy `rate_key` fuzzy match

Never pick “cheapest among collapsed city matches” when an exact `service_id` exists.

### Step D — Display name (`displayNameFromVendor`)

Build label roughly:

```
{Medium} — {MediumType} · {direction_remarks || area_name}
```

Example:

`Hoarding — Frontlit · 100 feet Road towards Power house`

So MULTIPLE_MATCH / checkboxes are distinguishable.

### Step E — Catalog (`vendorRatesToDbServices`)

**Before (bug):**

```ts
serviceId = cleaned rate_key || `${mediumSlug}-${citySlug}`
// Map key collapses all Frontlit Coimbatore sites → one entry
```

**After (correct):**

```ts
serviceId =
  cleaned.service_id          // preferred — unique per site
  || non-pipe rate_key
  || `${mediumSlug}-${citySlug}-${idx}`  // last-resort unique fallback
```

- Map / dedupe key = `serviceId.toLowerCase()`
- Put `direction_remarks` / `area_name` on `metadata` for preview/PDF
- Log sample rows with `service_id` + `direction`

---

## 6. Expected runtime flow

```
vendor_rate_chunks (rank=1)
        ↓
normalizeVendorRateRow  → keeps service_id + pricing + direction
        ↓
vendorRatesToDbServices → one DbService per service_id
        ↓
Chat: "hoarding Coimbatore"
        ↓
MULTIPLE_MATCH list (each site labeled with location)
        ↓
User selects site(s)
        ↓
buildQuoteFromConfirmedRows → resolve by service_id → that site's pricing only
```

---

## 7. Out of scope (do not mix into this fix)

- Changing day-multiplier logic (`display_price × min_duration` when unit is DAYS)
- Using `*_cost` fields for quotes (quotes use `pricing.*` only)
- Rebuilding identity from pipe `rate_key` location segments (DB `service_id` is enough)

---

## 8. How to verify

1. Reload app / reload cloud vendor rates
2. Console: `vendorRatesToDbServices` count ≈ number of rank=1 usable sites (not ~1 per city+medium)
3. Prompt: `1 hoarding Coimbatore 15 days`
4. Expect multiple options with different towards / areas
5. Pick “Power house” site → quote shows that row’s `display_price` / P&F (not another site’s)
6. Pick “Mettupalayam” → different price/location

---

## 9. Quick “am I reverted?” checklist

If any of these reappear, re-apply this plan:

- [ ] Catalog id is only `hoarding-frontlit-coimbatore` (no DB `service_id`)
- [ ] Only one Coimbatore Frontlit shows in chat despite many DB rows
- [ ] Quote location/price doesn’t match the selected site
- [ ] `VendorRateRow` has no `service_id` / `direction_remarks`

---

## 10. One-line summary

**Key every rank=1 vendor site by unique DB `service_id`, label with `direction_remarks`, match pricing by that id — never collapse sites on cleaned rate_key.**
