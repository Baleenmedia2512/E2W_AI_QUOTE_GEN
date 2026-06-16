# BUSINESS RULES REGISTRY

**Quote Buddy** — Central registry of all business rules and domain logic.

Every business rule must be documented here with:
- Name (unique identifier)
- Description (what it does)
- Implementation location
- Test coverage
- Change history

---

## QUOTE DOMAIN RULES

### Rule: QUOTE_TOTAL_CALCULATION

| Attribute | Value |
|-----------|-------|
| **ID** | QUOTE_TOTAL_CALCULATION |
| **Description** | Quote total = Sum(LineItem.price × LineItem.quantity) + GST |
| **Domain** | Quotation |
| **Severity** | CRITICAL |
| **Status** | ACTIVE |
| **Implementation** | `src/services/quoteService.ts` → `calculateQuoteTotal()` |
| **Tests** | `tests/services/quoteService.test.ts` → L42-67 |
| **Last Modified** | 2026-05-15 |
| **Modified By** | @alice |
| **Change Reason** | No longer rounding to nearest dollar (now 2 decimals) |
| **Previous Rule** | Total rounded to nearest dollar |
| **Deprecation** | No |

**Rule Details:**
```typescript
function calculateQuoteTotal(quote: Quote): QuoteTotal {
  const subtotal = quote.lineItems.reduce(
    (sum, item) => sum + (item.price * item.quantity),
    0
  );
  const gst = quote.settings.enableGST ? subtotal * 0.10 : 0;
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    gst: Math.round(gst * 100) / 100,
    total: Math.round((subtotal + gst) * 100) / 100,
  };
}
```

**When This Rule Changed:**
- Date: May 15, 2026
- Reason: Accounting requirement for precision in quotes
- Migration: All existing quotes automatically calculated to 2 decimals
- Backward Compatible: YES (old quotes recalculated)

---

### Rule: GST_CALCULATION_RATE

| Attribute | Value |
|-----------|-------|
| **ID** | GST_CALCULATION_RATE |
| **Description** | GST is always 10% of subtotal when enabled |
| **Domain** | Quotation |
| **Severity** | CRITICAL |
| **Status** | ACTIVE |
| **Implementation** | `src/services/quoteService.ts` → `calculateGST()` |
| **Tests** | `tests/services/quoteService.test.ts` → L70-90 |
| **Last Modified** | 2026-05-10 |
| **Modified By** | @alice |
| **Change Reason** | Initial implementation |
| **Deprecation** | No |

**Rule Details:**
- GST Rate: 10% (0.10)
- Only applied if `quote.settings.enableGST === true`
- Not cumulative with other taxes
- Configurable per quote

---

### Rule: QUOTE_STATUS_TRANSITIONS

| Attribute | Value |
|-----------|-------|
| **ID** | QUOTE_STATUS_TRANSITIONS |
| **Description** | Valid state transitions for quote status |
| **Domain** | Quotation |
| **Severity** | HIGH |
| **Status** | ACTIVE |
| **Implementation** | `src/services/quoteService.ts` → `validateStatusTransition()` |
| **Tests** | `tests/services/quoteService.test.ts` → L200-250 |
| **Last Modified** | 2026-05-12 |
| **Modified By** | @bob |
| **Change Reason** | Added "PO Received" state for post-acceptance tracking |
| **Deprecation** | No |

**Valid State Machine:**
```
Draft
  ├─→ Sent (requires: clientInfo + lineItems)
  └─→ Deleted

Sent
  ├─→ Accepted (client action)
  ├─→ Rejected (client action)
  ├─→ Draft (user edited, unsent)
  └─→ Deleted

Accepted
  ├─→ POReceived (awaiting PO from client)
  ├─→ Rejected (client changed mind)
  └─→ Deleted (user cleanup)

Rejected
  ├─→ Draft (reopen quote)
  └─→ Deleted

POReceived
  └─→ Completed (project finished, archive)
```

---

## CLIENT DOMAIN RULES

### Rule: CLIENT_EMAIL_VALIDATION

| Attribute | Value |
|-----------|-------|
| **ID** | CLIENT_EMAIL_VALIDATION |
| **Description** | Email must be valid RFC 5322 format |
| **Domain** | Client Relationship |
| **Severity** | HIGH |
| **Status** | ACTIVE |
| **Implementation** | `src/services/clientService.ts` → `validateEmail()` |
| **Tests** | `tests/services/clientService.test.ts` → L100-130 |
| **Last Modified** | 2026-05-10 |
| **Modified By** | @charlie |
| **Change Reason** | Added international domain support (TLDs >4 chars) |
| **Previous Rule** | Only standard .com/.au domains |
| **Deprecation** | No |

**Validation Pattern:**
```regex
^[^\s@]+@[^\s@]+\.[^\s@]+$
```

**Rules:**
- At least one character before @
- @ must be present
- At least one character after @ and before .
- . must be present
- At least one character after .
- No spaces allowed
- Case-insensitive

---

### Rule: CLIENT_PHONE_VALIDATION

| Attribute | Value |
|-----------|-------|
| **ID** | CLIENT_PHONE_VALIDATION |
| **Description** | Phone must be valid for Australian locale (business clients) |
| **Domain** | Client Relationship |
| **Severity** | MEDIUM |
| **Status** | ACTIVE |
| **Implementation** | `src/services/clientService.ts` → `validatePhone()` |
| **Tests** | `tests/services/clientService.test.ts` → L150-180 |
| **Last Modified** | 2026-05-08 |
| **Modified By** | @diana |
| **Change Reason** | Initial implementation for Australia region |
| **Deprecation** | No (will expand to international) |

**Valid Formats:**
- +61 2 1234 5678
- 0212345678
- (02) 1234 5678
- 02-1234-5678

**Rejection:**
- Less than 10 digits
- No area code
- Invalid for Australia

---

### Rule: CLIENT_GST_REQUIREMENT

| Attribute | Value |
|-----------|-------|
| **ID** | CLIENT_GST_REQUIREMENT |
| **Description** | GST number required for business clients, optional for individuals |
| **Domain** | Client Relationship |
| **Severity** | MEDIUM |
| **Status** | ACTIVE |
| **Implementation** | `src/services/clientService.ts` → `validateGSTNumber()` |
| **Tests** | `tests/services/clientService.test.ts` → L185-210 |
| **Last Modified** | 2026-05-09 |
| **Modified By** | @eve |
| **Change Reason** | Business accounting requirement |
| **Deprecation** | No |

**Rules:**
- If `client.type === 'business'`: GST required
- If `client.type === 'individual'`: GST optional
- Format: 11 digits, starting with 1 or 5
- Format: XX XXX XXX XXX (with spaces)
- Validation via ABN lookup (optional)

---

## DOCUMENT DOMAIN RULES

### Rule: PDF_FILE_VALIDATION

| Attribute | Value |
|-----------|-------|
| **ID** | PDF_FILE_VALIDATION |
| **Description** | Only PDF files allowed, max 50MB |
| **Domain** | Document Management |
| **Severity** | HIGH |
| **Status** | ACTIVE |
| **Implementation** | `src/services/documentService.ts` → `validatePDFFile()` |
| **Tests** | `tests/services/documentService.test.ts` → L50-100 |
| **Last Modified** | 2026-05-14 |
| **Modified By** | @frank |
| **Change Reason** | Increased size limit from 20MB to 50MB |
| **Previous Rule** | Max 20MB |
| **Deprecation** | No |

**Validation Rules:**
- MIME type: `application/pdf`
- File extension: `.pdf` (case-insensitive)
- Max file size: 50 MB
- Min file size: 1 KB
- Reject if corrupted
- Reject if password-protected

---

## PERMISSION DOMAIN RULES

### Rule: QUOTE_OWNERSHIP_ENFORCEMENT

| Attribute | Value |
|-----------|-------|
| **ID** | QUOTE_OWNERSHIP_ENFORCEMENT |
| **Description** | Users can only view/edit their own quotes (enforced at DB + service layer) |
| **Domain** | Authorization |
| **Severity** | CRITICAL |
| **Status** | ACTIVE |
| **Implementation** | `src/services/authService.ts` → `canUserViewQuote()` |
| **Tests** | `tests/services/authService.test.ts` → L300-350 |
| **Last Modified** | 2026-05-11 |
| **Modified By** | @alice |
| **Change Reason** | Initial security implementation |
| **Deprecation** | No |

**Rules:**
- Service layer: Check `quote.userId === currentUser.id`
- Database layer: RLS policy filters by `user_id`
- Admin: Can view all quotes
- Client: Can only view quotes sent to them (by email)
- Owner: Full access to edit, delete, resend

---

### Rule: ADMIN_SUPER_ACCESS

| Attribute | Value |
|-----------|-------|
| **ID** | ADMIN_SUPER_ACCESS |
| **Description** | Admins can view and edit all quotes (no ownership restriction) |
| **Domain** | Authorization |
| **Severity** | HIGH |
| **Status** | ACTIVE |
| **Implementation** | `src/services/authService.ts` → `isAdmin()` |
| **Tests** | `tests/services/authService.test.ts` → L370-400 |
| **Last Modified** | 2026-05-11 |
| **Modified By** | @alice |
| **Change Reason** | Support team requirements |
| **Deprecation** | No |

**Admin Capabilities:**
- View any quote
- Edit any quote (with audit trail)
- Export any quote
- Delete any quote (with confirmation)
- View all clients
- See reporting dashboard

---

## AUDIT & COMPLIANCE RULES

### Rule: AUDIT_TRAIL_REQUIREMENT

| Attribute | Value |
|-----------|-------|
| **ID** | AUDIT_TRAIL_REQUIREMENT |
| **Description** | All mutations must be logged with user_id, timestamp, action, data_before, data_after |
| **Domain** | Audit & Compliance |
| **Severity** | CRITICAL |
| **Status** | ACTIVE |
| **Implementation** | `src/services/auditService.ts` → `logAction()` |
| **Tests** | `tests/services/auditService.test.ts` → L1-50 |
| **Last Modified** | 2026-05-13 |
| **Modified By** | @security-team |
| **Change Reason** | Compliance requirement |
| **Deprecation** | No |

**Logged Actions:**
- Quote created
- Quote updated (all fields)
- Quote deleted
- Quote sent
- Quote client response
- Client info updated
- Company info updated
- User login/logout
- Permission changed

---

## VALIDATION LAYER RULES

### Rule: INPUT_VALIDATION_SEQUENCE

| Attribute | Value |
|-----------|-------|
| **ID** | INPUT_VALIDATION_SEQUENCE |
| **Description** | All external input validated: format → business rule → state consistency |
| **Domain** | Validation |
| **Severity** | HIGH |
| **Status** | ACTIVE |
| **Implementation** | Every service function |
| **Tests** | All service tests |
| **Last Modified** | 2026-05-12 |
| **Modified By** | @alice |

**Validation Order:**
1. **Format Validation** — Is it the right shape?
2. **Business Rule Validation** — Does it follow business logic?
3. **State Validation** — Is existing state consistent?
4. **Permission Validation** — Is user allowed?

---

## CHANGE REQUEST PROCESS

To change a business rule:

1. **Document change** — Fill out form below
2. **Impact analysis** — Which systems affected?
3. **Test coverage** — What tests needed?
4. **Code review** — 2+ reviewers + architect
5. **Migration plan** — How do old quotes work?
6. **Backward compatibility** — Can we run both?
7. **Rollback plan** — How to undo if needed?
8. **Update this registry** — Never forget documentation

### Change Request Template

```
## Business Rule Change

**Rule ID:** QUOTE_TOTAL_CALCULATION

**Current Rule:**
Total = Sum(LineItems) + GST

**Proposed Rule:**
Total = Sum(LineItems × quantity) + GST + delivery_fee

**Why:**
Delivery fees need to be calculated per quote

**Impact Analysis:**
- Affects: All quotes with delivery (25% of quotes)
- Database: No schema change
- API: New field `deliveryFee` in QuoteInput
- Tests: 20+ new tests needed

**Backward Compatibility:**
Old quotes: deliveryFee defaults to $0
Migration: None needed

**Rollback Plan:**
Set `deliveryFee = 0` and redeploy

**Migration Timeline:**
- Week 1: Code & tests
- Week 2: Staging validation
- Week 3: Production deploy
```

---

## Compliance & Governance

All business rules must be:
- ✅ Documented here
- ✅ Implemented in code (single location)
- ✅ Tested (unit + integration)
- ✅ Reviewed (architect approved)
- ✅ Monitored (metrics tracked)

**No untracked business rules allowed.**

**No business logic outside service layer.**

**No rule changes without governance approval.**

---

# PART 2 — VERIFIED RULES (Code Audit, May 18 2026)

Rules below are **observed in the current codebase** (not planned). Each entry cites the file and line where the rule lives. Add tests to lock these down before they regress.

## File Upload Rules

### Rule: FILE_UPLOAD_MAX_SIZE
| Attribute | Value |
|-----------|-------|
| **Implementation** | [src/utils/fileUtils.ts](../src/utils/fileUtils.ts) L15, L34 |
| **Rule** | `maxSizeMB = Number(import.meta.env.VITE_MAX_FILE_SIZE_MB) \|\| 10` |
| **Default** | 10 MB if env var unset |
| **Applies To** | Image uploads (logo, signature) and Excel uploads |
| **Tests** | [src/utils/__tests__/fileUtils.test.ts](../src/utils/__tests__/fileUtils.test.ts) ✅ |

### Rule: IMAGE_MIME_WHITELIST
| Attribute | Value |
|-----------|-------|
| **Implementation** | [src/utils/fileUtils.ts](../src/utils/fileUtils.ts) `validateImageFile()` |
| **Rule** | Only `image/jpeg` and `image/jpg` MIME types accepted |
| **Error** | "Only JPEG/JPG image files are allowed" |
| **Tests** | ✅ Covered (PNG, GIF, SVG rejected) |

### Rule: EXCEL_MIME_WHITELIST
| Attribute | Value |
|-----------|-------|
| **Implementation** | [src/utils/fileUtils.ts](../src/utils/fileUtils.ts) `validateExcelFile()` |
| **Rule** | Accepts `.xlsx` / `.xls` MIME types, with extension fallback |
| **Error** | "Only Excel files (.xlsx, .xls) are allowed" |
| **Tests** | ✅ Covered |

## Authentication & Authorization Rules

### Rule: ROLE_NAME_CASE_INSENSITIVE
| Attribute | Value |
|-----------|-------|
| **Implementation** | [src/services/authService.ts](../src/services/authService.ts) L140-144 `hasRole()` |
| **Rule** | Role match is case-insensitive (`'Admin'` == `'admin'`) |
| **Default Role** | `'user'` when role lookup returns null (L81) |
| **Tests** | [src/store/__tests__/authStore.test.ts](../src/store/__tests__/authStore.test.ts) ✅ |

### Rule: PERMISSION_BOOLEAN_STRICT
| Attribute | Value |
|-----------|-------|
| **Implementation** | [src/services/authService.ts](../src/services/authService.ts) L131-135 `hasPermission()` |
| **Rule** | Permission granted only when `permissions[name] === true` (strict boolean) |
| **Falsy values** | Treated as denied (undefined, null, 0, 'true' string all → deny) |
| **Tests** | ✅ Covered |

## Cache & Storage Rules

### Rule: CACHE_CLEAR_PRESERVES_AUTH
| Attribute | Value |
|-----------|-------|
| **Implementation** | [src/utils/cacheVersion.ts](../src/utils/cacheVersion.ts) `clearCacheAndReload()` |
| **Rule** | When clearing cache, `auth-storage` and `supabase.auth.token` keys MUST survive |
| **Why** | User stays logged in across cache-bust reloads |
| **Tests** | ⚠️ Not yet covered — high-priority gap |

### Rule: APP_VERSION_DETECTION
| Attribute | Value |
|-----------|-------|
| **Implementation** | [src/utils/cacheVersion.ts](../src/utils/cacheVersion.ts) `checkForUpdates()` |
| **Rule** | Update detected when `currentVersion.buildTimestamp > storedVersion.buildTimestamp` |
| **First Run** | No update reported, current version stored |
| **Tests** | [src/utils/__tests__/cacheVersion.test.ts](../src/utils/__tests__/cacheVersion.test.ts) ✅ (storage helpers) |

### Rule: PROPOSAL_LIBRARY_CAP
| Attribute | Value |
|-----------|-------|
| **Implementation** | [src/utils/proposalStorage.ts](../src/utils/proposalStorage.ts) `MAX_PROPOSALS = 10` |
| **Rule** | IndexedDB proposal library retains only the 10 most-recently-uploaded proposals |
| **Cleanup Trigger** | After each save (`cleanupOldProposals()`) |
| **Tests** | ⚠️ Not yet covered |

### Rule: PROPOSAL_DUPLICATE_DETECTION
| Attribute | Value |
|-----------|-------|
| **Implementation** | [src/utils/proposalStorage.ts](../src/utils/proposalStorage.ts) `findDuplicateProposal()` |
| **Rule** | Duplicate = same `fileName` + `fileType` + `fileSize` (exact match) |
| **Tests** | ⚠️ Not yet covered |

## Quote Domain Rules

### Rule: BULLET_PREFIX_NORMALIZATION
| Attribute | Value |
|-----------|-------|
| **Implementation** | [src/utils/quoteGrouping.ts](../src/utils/quoteGrouping.ts) L138, L206, L237 |
| **Rule** | Term lines stripped of leading `•`, `-`, or `*` (and surrounding whitespace) before display |
| **Regex** | `/^[•\-*]\s*/` |
| **Also Applied In** | All 4 quote templates ([ClassicBusiness.tsx](../src/components/Templates/ClassicBusiness.tsx), [CorporateMinimal.tsx](../src/components/Templates/CorporateMinimal.tsx), [ModernSales.tsx](../src/components/Templates/ModernSales.tsx), [PremiumAgency.tsx](../src/components/Templates/PremiumAgency.tsx)) |
| **Risk** | Pattern duplicated 7 times across codebase — candidate for extraction to shared util |

### Rule: SERVICE_GROUPING_BY_TYPE
| Attribute | Value |
|-----------|-------|
| **Implementation** | [src/utils/quoteGrouping.ts](../src/utils/quoteGrouping.ts) `groupItemsByServiceType()` L89 |
| **Rule** | Quote items grouped by `serviceType` field (Bus, Auto, Tempo, etc.) |
| **Multi-Service Detection** | `isMultiServiceQuote()` L112 — true if >1 distinct service type |
| **General Terms Heuristic** | Term considered "general" if its number-stripped pattern appears only once (L206-237) |
| **Tests** | ⚠️ Not yet covered — complex grouping logic, high regression risk |

### Rule: TERMS_AND_CONDITIONS_SINGLE_SERVICE
| Attribute | Value |
|-----------|-------|
| **Implementation** | [src/utils/promptTemplates.ts](../src/utils/promptTemplates.ts) L508 (Gemini prompt) |
| **Rule** | For single-service quotes (1 item), per-item `termsAndConditions` MUST be empty string |
| **Enforcement** | AI prompt instruction (not code-enforced) |
| **Risk** | AI may not always comply — needs post-generation validation |

## AI / Gemini Rules

### Rule: BULLET_DETECTION_REGEX
| Attribute | Value |
|-----------|-------|
| **Implementation** | [src/services/geminiService.ts](../src/services/geminiService.ts) L152 |
| **Rule** | Line is bulleted if matches `/^[•\-*]/` OR `/^\d+\./` |
| **Used For** | Parsing Gemini's bulleted output back into structured terms |

## Known Rule Gaps (Untested Critical Logic)

These rules exist in code but have **NO test coverage**. Adding tests is the highest priority:

1. ❌ `groupItemsByServiceType()` — complex, no tests
2. ❌ `getGeneralTerms()` — pattern-based heuristic, no tests
3. ❌ `filterTermsByServiceType()` — no tests
4. ❌ `clearCacheAndReload()` — preserves auth, no tests
5. ❌ `findDuplicateProposal()` — exact-match logic, no tests
6. ❌ `cleanupOldProposals()` — retention policy, no tests
7. ❌ Gemini prompt → JSON parsing pipeline — no tests
8. ❌ PDF export rendering — no tests

---

**Audit Date:** May 18, 2026  
**Auditor:** Automated code scan + verification  
**Next Audit:** When new business rule added OR quarterly

