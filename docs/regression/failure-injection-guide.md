# Failure Injection Drill Book

A consolidated, copy-paste-ready playbook for DevOps to **deliberately break** production code, prove that CI/CD catches it, then restore. The goal: build confidence that the green pipeline is meaningful.

> **Run drills in a throwaway branch only.** Never push the broken commit. Always finish with `git restore .` or `git checkout -- .`.

## How to run a drill

```powershell
# 0. Start on a clean working tree
git status                          # should be clean
git checkout -b drill/<module>-<date>

# 1. Edit one production file per drill (see recipes below)
# 2. Run tests locally — verify the EXPECTED tests go red
npm test -- <test-file-pattern>

# 3. (Optional) push the branch and open a draft PR to confirm CI also goes red
git push origin HEAD

# 4. CLEAN UP — mandatory
git checkout main
git branch -D drill/<module>-<date>
```

---

## Drill 1 — Auth bypass (CRITICAL)

**Target:** `src/components/PrivateRoute/PrivateRoute.tsx`
**Break:** Comment out the `if (!isAuthenticated)` redirect branch.
**Run:** `npm test -- PrivateRoute`
**Must fail:** TC_ROUTE_002 (and TC_ROUTE_004, TC_ROUTE_006 if the role/permission guards share the bypass).
**Why this drill matters:** A bypass here means every page is public.
**Restore:** `git restore src/components/PrivateRoute/PrivateRoute.tsx`

## Drill 2 — Hash compare flipped (CRITICAL)

**Target:** `src/services/authService.ts` → `verifyPassword()`
**Break:** Change `bcrypt.compare` invocation to always return `true`.
**Run:** `npm test -- authService`
**Must fail:** TC_AUTH_005, TC_AUTH_006 (login wrong-password tests).
**Why:** Any password would unlock any account.

## Drill 3 — Quote total math broken

**Target:** `src/utils/quoteGrouping.ts` → `groupItemsByServiceType()`
**Break:** Change `subtotal += item.total` to `subtotal += item.unitPrice`.
**Run:** `npm test -- quoteGrouping`
**Must fail:** TC_UTIL_GRP_018, TC_UTIL_GRP_019.
**Why:** Every PDF would have wrong totals (ignores discount/quantity).

## Drill 4 — GST disclosure removed

**Target:** `src/utils/quoteGrouping.ts` → `DEFAULT_GENERAL_TERMS`
**Break:** Remove the first array entry (GST term).
**Run:** `npm test -- quoteGrouping`
**Must fail:** TC_UTIL_GRP_001, TC_UTIL_GRP_002.
**Why:** Tax-compliance regression on every generated quote.

## Drill 5 — PII leak in logs

**Target:** `src/utils/logger.ts` → `redactString()`
**Break:** Replace function body with `return s;` (no-op).
**Run:** `npm test -- logger`
**Must fail:** TC_UTIL_LOGGER_007 (email), TC_UTIL_LOGGER_008 (phone), TC_UTIL_LOGGER_009 (GSTIN), TC_UTIL_LOGGER_011 (multiple emails).
**Why:** Customer PII in plaintext logs ⇒ GDPR violation.

## Drill 6 — Secret leak guard

**Target:** `src/utils/promptTemplates.ts`
**Break:** Insert the literal string `API_KEY=sk-test-12345` anywhere in `QUOTE_GENERATION_PROMPT`.
**Run:** `npm test -- promptTemplates`
**Must fail:** TC_UTIL_PROMPT_019.
**Why:** Hardcoded secrets are the top OWASP risk.

## Drill 7 — Memory-leak websocket

**Target:** `src/hooks/useCompanySync.ts`
**Break:** Delete the `return () => unsubscribe()` from the realtime `useEffect`.
**Run:** `npm test -- useCompanySync`
**Must fail:** TC_HOOK_SYNC_004.
**Why:** Subscription leak per route change.

## Drill 8 — Store state corruption

**Target:** `src/store/index.ts` → `updateQuote` or similar setter
**Break:** Replace `set({ currentQuote: quote })` with `set({ currentQuote: null })`.
**Run:** `npm test -- appStore`
**Must fail:** All `updateQuote` / `setCurrentQuote` related tests (≈5).
**Why:** Users would lose work.

## Drill 9 — Permission grant bypass

**Target:** `src/store/authStore.ts` → `hasPermission()` or `hasRole()`
**Break:** Change function body to `return true;`.
**Run:** `npm test -- authStore`
**Must fail:** Permission/role tests in TC_AUTHSTORE_* (see store.md), plus TC_ROUTE_004 / TC_ROUTE_006.
**Why:** Privilege escalation across the entire app.

## Drill 10 — PDF text extraction broken

**Target:** `src/utils/pdfUtils.ts` → `extractPDFContent()`
**Break:** Return only the first page's text (skip the for-loop over `pdf.numPages`).
**Run:** `npm test -- pdfUtils`
**Must fail:** TC_UTIL_PDF_024 (multi-page concat).
**Why:** 99% of real PDFs would be processed wrong.

## Drill 11 — Upload size limit removed

**Target:** `src/utils/fileUtils.ts` → `validateImageFile()` or `validateExcelFile()`
**Break:** Remove the `file.size > MAX_BYTES` check.
**Run:** `npm test -- fileUtils`
**Must fail:** TC_UTIL_FILE_005 (image), TC_UTIL_FILE_012 (Excel), and TC_UTIL_PDF_042 if PDF check changed.
**Why:** Memory blow-up; storage cost.

## Drill 12 — Lead duplicate dedup removed

**Target:** `src/services/leadService.ts` → dedup logic
**Break:** Always return null from the duplicate-finder.
**Run:** `npm test -- leadService`
**Must fail:** Lead-dedup test (see services.md).
**Why:** Duplicate leads pollute CRM.

## Drill 13 — Default company GST poisoned

**Target:** `src/constants/defaultCompany.ts`
**Break:** Change `gst: ''` to `gst: '29ABCDE1234F1Z5'` (real-looking GST).
**Run:** `npm test -- defaultCompany`
**Must fail:** TC_CONST_DEFCO_004.
**Why:** Real GSTIN shown as default to every new user.

## Drill 14 — Active-proposal meta bloat

**Target:** `src/utils/imageStorage.ts` → `saveActiveProposalMeta()`
**Break:** Remove the `fileUrl` strip line before persisting.
**Run:** `npm test -- imageStorage`
**Must fail:** TC_UTIL_IMGSTORE_020.
**Why:** sessionStorage fills, app dies.

## Drill 15 — Service-worker registers to wrong scope

**Target:** `src/utils/pwa.ts`
**Break:** Change `scope: '/'` to `scope: '/admin'`.
**Run:** `npm test -- pwa`
**Must fail:** TC_UTIL_PWA_005, TC_UTIL_PWA_009.
**Why:** Offline mode intercepts wrong paths.

---

## Quarterly drill schedule (recommended)

| Month | Drills to run | Owner |
|---|---|---|
| Jan, Apr, Jul, Oct | 1, 2, 9 (auth/perms) | Security lead |
| Feb, May, Aug, Nov | 3, 4, 13 (financial / compliance) | Product lead |
| Mar, Jun, Sep, Dec | 5, 6, 14 (PII / quotas) | DevOps lead |

After each drill, file a one-paragraph report in `docs/regression/drill-log.md` (create if missing): date, drill ID, expected failures observed, anything that surprisingly stayed green (= test gap to fix).

---

## When a drill FAILS to break the build

This is a **test-gap finding**, not a success. Do this:

1. Document the gap in `docs/regression/test-effectiveness-analysis.md`.
2. Open a ticket: `[GAP] <module>: drill #N did not turn any test red`.
3. Add a failing test that *would* catch the break.
4. Restore the production code, then merge the new test.

A drill catching no failure = a regression catastrophe waiting to happen.
