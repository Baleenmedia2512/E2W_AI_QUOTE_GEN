# MODULE-WISE REGRESSION VALIDATION GUIDE
### Quote Buddy — Enterprise AI Quote Generator
**Role:** Senior SDET · QA Automation Architect · DevOps Engineer  
**Purpose:** Intentionally break production code → verify tests catch failures → validate CI/CD blocks bad merges  
**Date:** May 20, 2026

---

## TABLE OF CONTENTS

1. [What Is Regression Validation?](#what-is-regression-validation)
2. [Project Module Map](#project-module-map)
3. [MODULE 1 — authService](#module-1--authservice)
4. [MODULE 2 — authStore](#module-2--authstore)
5. [MODULE 3 — companyService](#module-3--companyservice)
6. [MODULE 4 — geminiService](#module-4--geminiservice)
7. [MODULE 5 — dataSyncService](#module-5--datasyncservice)
8. [MODULE 6 — localStorage Utils](#module-6--localstorage-utils)
9. [MODULE 7 — bulletNormalization](#module-7--bulletnormalization)
10. [MODULE 8 — quoteGrouping](#module-8--quotegrouping)
11. [MODULE 9 — cacheVersion](#module-9--cacheversion)
12. [MODULE 10 — logger (PII Safety)](#module-10--logger-pii-safety)
13. [MODULE 11 — pwa (Service Worker)](#module-11--pwa-service-worker)
14. [MODULE 12 — fileUtils (Validation)](#module-12--fileutils-validation)
15. [MODULE 13 — PrivateRoute (Auth Guard)](#module-13--privateroute-auth-guard)
16. [MODULE 14 — useCompanySync (Hook)](#module-14--usecompanysync-hook)
17. [Master Failure Validation Table](#master-failure-validation-table)
18. [Regression Protection Matrix](#regression-protection-matrix)
19. [Test Strength Analysis](#test-strength-analysis)
20. [Edge Case Breaking Scenarios](#edge-case-breaking-scenarios)
21. [CI/CD Protection Flow](#cicd-protection-flow)
22. [DevOps Validation Flow Diagram](#devops-validation-flow-diagram)
23. [Weak Test Identification](#weak-test-identification)
24. [Post-Break Restoration Checklist](#post-break-restoration-checklist)

---

## What Is Regression Validation?

**Regression validation** means deliberately breaking production code to prove your tests are real guards — not fake coverage.

**Analogy:** A smoke alarm you installed in your house. You want to know: does it actually beep when there is smoke? The only way to be sure is to light a match near it and listen. If it beeps → your alarm works. If it stays silent → you have fake safety.

In software:
- **Production code** = your house
- **Tests** = the smoke alarm
- **Intentionally breaking code** = lighting the match
- **Tests failing** = alarm beeping (GOOD — it means tests are real)
- **Tests still passing after break** = alarm is broken (BAD — fake safety)

**What we DO in this guide:**
1. Open a production file
2. Change one specific line (break something intentionally)
3. Run `npm run test`
4. Observe which tests fail
5. Verify the failure message is meaningful
6. Restore the code
7. If NO test failed after a break → that is a **WEAK TEST** that needs improvement

---

## Project Module Map

| # | Module | Production File | Test File | Layer |
|---|--------|----------------|-----------|-------|
| 1 | Authentication | `src/services/authService.ts` | `tests/services/authService.test.ts` | Service |
| 2 | Auth State | `src/store/authStore.ts` | `tests/store/authStore.test.ts` | Store |
| 3 | Company Settings | `src/services/companyService.ts` | `tests/services/companyService.test.ts` | Service |
| 4 | AI Quote Generation | `src/services/geminiService.ts` | `tests/services/geminiService.test.ts` | Service |
| 5 | Data Sync | `src/services/dataSyncService.ts` | `tests/services/dataSyncService.test.ts` | Service |
| 6 | Local Storage | `src/utils/localStorage.ts` | `tests/utils/localStorage.test.ts` | Utils |
| 7 | Bullet Normalization | `src/utils/bulletNormalization.ts` | `tests/utils/bulletNormalization.test.ts` | Utils |
| 8 | Quote Grouping | `src/utils/quoteGrouping.ts` | `tests/utils/quoteGrouping.test.ts` | Utils |
| 9 | Cache Version | `src/utils/cacheVersion.ts` | `tests/utils/cacheVersion.test.ts` | Utils |
| 10 | Logger (PII) | `src/utils/logger.ts` | `tests/utils/logger.test.ts` | Utils |
| 11 | PWA / Service Worker | `src/utils/pwa.ts` | `tests/utils/pwa.test.ts` | Utils |
| 12 | File Validation | `src/utils/fileUtils.ts` | `tests/utils/fileUtils.test.ts` | Utils |
| 13 | Route Guard | `src/components/PrivateRoute/PrivateRoute.tsx` | `tests/components/PrivateRoute.test.tsx` | Component |
| 14 | Company Sync Hook | `src/hooks/useCompanySync.ts` | `tests/hooks/useCompanySync.test.ts` | Hook |

---

## MODULE 1 — authService

```
Production File : src/services/authService.ts
Test File       : tests/services/authService.test.ts
Protected Logic : Password verification, account active check, role/permission parsing, bcrypt comparison
```

### What this module does (Plain English)

When a user types their email and password and clicks "Login", this service:
1. Looks up the user in the database
2. Checks if the account is active (`isActive: true`)
3. Compares the entered password against the bcrypt hash stored in the database
4. Fetches the user's role and permissions
5. Returns a fully formed `AuthUser` object

If any step fails, it throws an error. This is the **gatekeeper** of the entire application.

---

### INTENTIONAL BREAK #1 — Remove Password Verification

**What to change:**

Open `src/services/authService.ts` and find this block (around line 47):

```typescript
// ORIGINAL — DO NOT COMMIT THIS BREAK
const isValidPassword = await bcrypt.compare(password, user.password);

if (!isValidPassword) {
  throw new Error('Invalid email or password');
}
```

**Change it to:**

```typescript
// BROKEN VERSION — skips password check entirely
const isValidPassword = true; // BUG: always allows login
```

**Step-by-step guide:**

```
STEP 1: Open src/services/authService.ts
STEP 2: Find the line: const isValidPassword = await bcrypt.compare(...)
STEP 3: Replace it with: const isValidPassword = true;
STEP 4: Run: npm run test -- tests/services/authService.test.ts
STEP 5: Watch for the failure below
STEP 6: Restore original code after validation
```

**Expected failing test:**
```
FAIL  tests/services/authService.test.ts
  authService > login
    ✗ throws on wrong password
      Expected function to throw
      AssertionError: expected promise to reject but it resolved
```

**Why this failure MATTERS:**

This break simulates the worst security bug possible: **anyone can log in with any password**. The test `throws on wrong password` is the only guard stopping this from reaching production. If this test did not exist, a developer could accidentally bypass bcrypt and all user accounts become compromised.

**Production Risk:** CRITICAL — Full authentication bypass. Any user can access any account.

**CI/CD Impact:** Pipeline blocks merge. PR is rejected. Production is protected.

---

### INTENTIONAL BREAK #2 — Remove Account Active Check

**What to change:**

Find this block in `src/services/authService.ts` (around line 38):

```typescript
// ORIGINAL
if (!user.isActive) {
  throw new Error('Your account has been deactivated. Please contact administrator.');
}
```

**Change it to:**

```typescript
// BROKEN VERSION — deactivated accounts can still login
// if (!user.isActive) {
//   throw new Error('Your account has been deactivated...');
// }
```

**Step-by-step guide:**

```
STEP 1: Open src/services/authService.ts
STEP 2: Find: if (!user.isActive) { throw new Error('...deactivated...') }
STEP 3: Comment out the entire if block
STEP 4: Run: npm run test -- tests/services/authService.test.ts
STEP 5: Observe the test failure
STEP 6: Restore the original code
```

**Expected failing test:**
```
FAIL  tests/services/authService.test.ts
  authService > login
    ✗ throws when account is inactive
      AssertionError: expected promise to reject with error including 'deactivated'
      but it resolved instead
```

**Why this failure MATTERS:**

When an administrator deactivates a user account (fired employee, suspended user), that action must immediately prevent login. If this check is bypassed, terminated users retain full system access — a serious security and compliance violation.

**Production Risk:** HIGH — Access control failure. Terminated users remain in system.

---

### INTENTIONAL BREAK #3 — Break Permission Parsing

**What to change:**

Find this block (around line 65):

```typescript
// ORIGINAL
permissions =
  typeof roleData.permissions === 'string'
    ? JSON.parse(roleData.permissions)
    : roleData.permissions;
```

**Change it to:**

```typescript
// BROKEN VERSION — permissions are always empty
permissions = {};
```

**Expected failing test:**
```
FAIL  tests/services/authService.test.ts
  authService > login
    ✗ returns AuthUser with parsed permissions
      Expected: { canEditQuotes: true }
      Received: {}
```

**Why this failure MATTERS:**

Role-based access control (RBAC) depends entirely on permissions being correctly parsed. If permissions are empty, every permission check returns `false` — users lose access to features they should have, OR if the logic is inverted, gain access to things they shouldn't.

---

## MODULE 2 — authStore

```
Production File : src/store/authStore.ts
Test File       : tests/store/authStore.test.ts
Protected Logic : Login state management, isAuthenticated flag, error state, logout clearing
```

### What this module does (Plain English)

The `authStore` is the **brain that remembers who is logged in** across the whole application. It calls `authService` and then saves the result in global app memory (Zustand). Every component that shows "Welcome, Alice" or checks "can this user edit quotes?" reads from this store.

---

### INTENTIONAL BREAK #1 — Wrong isAuthenticated After Login

**What to change:**

In `src/store/authStore.ts`, find the `login` action (around line 42):

```typescript
// ORIGINAL
set({
  user,
  isAuthenticated: true,
  isLoading: false,
  error: null,
});
```

**Change it to:**

```typescript
// BROKEN VERSION — user is set but isAuthenticated stays false
set({
  user,
  isAuthenticated: false,  // BUG: never marks user as authenticated
  isLoading: false,
  error: null,
});
```

**Step-by-step guide:**

```
STEP 1: Open src/store/authStore.ts
STEP 2: Find the login action's success set() call
STEP 3: Change isAuthenticated: true → isAuthenticated: false
STEP 4: Run: npm run test -- tests/store/authStore.test.ts
STEP 5: Observe failures
STEP 6: Restore
```

**Expected failing tests:**
```
FAIL  tests/store/authStore.test.ts
  authStore > login action
    ✗ sets isAuthenticated to true after successful login
      Expected: true
      Received: false

    ✗ stores user object in state
      AssertionError: expected { isAuthenticated: false } to have property isAuthenticated = true
```

**Why this failure MATTERS:**

`isAuthenticated: false` while a user IS logged in means `PrivateRoute` would redirect every authenticated user back to the login page — the entire app becomes unusable for everyone after they log in. The test acts as the safety net.

---

### INTENTIONAL BREAK #2 — Logout Does Not Clear User

**What to change:**

Find the `logout` action in `src/store/authStore.ts`:

```typescript
// ORIGINAL
logout: () => {
  authService.logout();
  set({
    user: null,
    isAuthenticated: false,
    error: null,
  });
},
```

**Change it to:**

```typescript
// BROKEN VERSION — logout doesn't clear user from memory
logout: () => {
  authService.logout();
  set({
    // user: null,  ← MISSING — user stays in memory
    isAuthenticated: false,
    error: null,
  });
},
```

**Expected failing tests:**
```
FAIL  tests/store/authStore.test.ts
  authStore > logout action
    ✗ clears user on logout
      Expected: null
      Received: { id: 'user-001', email: 'alice@...' }

    ✗ isAuthenticated is false after logout
      Passed ✓ (isAuthenticated IS false — partial break)
```

**Why this failure MATTERS:**

If the user object persists after logout, the next person who opens the browser tab can still see the previous user's data. On a shared computer (office/reception desk), this is a serious privacy and data leakage problem.

**Weakness Found:** Note that `isAuthenticated: false` test still passes — it is testing only one field. This reveals the test is partially weak. Improvement: always test BOTH `isAuthenticated` AND `user === null` together in logout tests.

---

## MODULE 3 — companyService

```
Production File : src/services/companyService.ts
Test File       : tests/services/companyService.test.ts
Protected Logic : Database field mapping, null handling on DB error, graceful degradation
```

### What this module does (Plain English)

`companyService` fetches and saves the company's profile (name, logo, GST, phone, etc.) from the Supabase database. It has a graceful fallback — if the database is unavailable, it returns `null` instead of crashing the app. The app then uses `localStorage` as a backup.

---

### INTENTIONAL BREAK #1 — Wrong Field Mapping

**What to change:**

In `src/services/companyService.ts`, find the field mapping inside `getCompanySettings()`:

```typescript
// ORIGINAL
return {
  name: data.name || '',
  email: data.email || '',
  gst: data.gst || '',
  ...
};
```

**Change it to:**

```typescript
// BROKEN VERSION — email field mapped to wrong source
return {
  name: data.name || '',
  email: data.phone || '',  // BUG: email gets phone value
  gst: data.gst || '',
  ...
};
```

**Step-by-step guide:**

```
STEP 1: Open src/services/companyService.ts
STEP 2: Find: email: data.email || ''
STEP 3: Change to: email: data.phone || ''
STEP 4: Run: npm run test -- tests/services/companyService.test.ts
STEP 5: Observe failure
STEP 6: Restore
```

**Expected failing test:**
```
FAIL  tests/services/companyService.test.ts
  companyService > getCompanySettings
    ✗ returns mapped CompanyInfo on success
      Expected: "admin@baleenmedia.com"
      Received: "+61-2-1234-5678"
```

**Why this failure MATTERS:**

A wrong field mapping sends the wrong value wherever email is used — outgoing quote emails go to the wrong address, PDF headers show wrong contact info. Quote Buddy's entire communication layer breaks silently because the wrong data type is returned (phone number in email field).

---

### INTENTIONAL BREAK #2 — Remove Null Safety on DB Error

**What to change:**

In `src/services/companyService.ts`, find:

```typescript
// ORIGINAL
if (error) {
  logger.warn('⚠️ Database fetch failed, using localStorage fallback:', error.message);
  return null;
}
```

**Change it to:**

```typescript
// BROKEN VERSION — throws instead of graceful null return
if (error) {
  throw new Error(error.message); // BUG: crashes caller instead of graceful fallback
}
```

**Expected failing test:**
```
FAIL  tests/services/companyService.test.ts
  companyService > getCompanySettings
    ✗ returns null when Supabase returns an error
      Expected: null
      Received: [Error: Connection failed]
      (function threw unexpectedly)
```

**Why this failure MATTERS:**

The whole point of the `null` return is graceful degradation — if the database is down, the app still works using `localStorage`. By throwing instead, a temporary network blip crashes the entire company settings feature and potentially the whole app startup.

---

## MODULE 4 — geminiService

```
Production File : src/services/geminiService.ts
Test File       : tests/services/geminiService.test.ts
Protected Logic : JSON extraction from AI response, null for non-JSON responses, malformed JSON handling
```

### What this module does (Plain English)

When the AI (Gemini) responds to a quote request, it sends back a mixture of text AND a JSON structure. `parseQuoteFromResponse()` must find and extract ONLY the JSON part. If the AI sends back plain English instead of JSON, the function must return `null` — not crash. This is critical because Gemini sometimes gives unexpected responses.

---

### INTENTIONAL BREAK #1 — Return Empty Object Instead of Null

**What to change:**

Find `parseQuoteFromResponse` in `src/services/geminiService.ts`. Look for the catch or null-return paths.

```typescript
// ORIGINAL (somewhere in parseQuoteFromResponse)
return null; // when no JSON found or JSON is malformed
```

**Change it to:**

```typescript
// BROKEN VERSION — returns empty object instead of null
return {}; // BUG: caller checks `if (result)` which is truthy for {}
```

**Expected failing tests:**
```
FAIL  tests/services/geminiService.test.ts
  geminiService > parseQuoteFromResponse
    ✗ returns null for plain text with no JSON
      Expected: null
      Received: {}

    ✗ returns null for empty string
      Expected: null
      Received: {}

    ✗ returns null for malformed JSON
      Expected: null
      Received: {}
```

**Why this failure MATTERS:**

The calling code checks `if (parseQuoteFromResponse(response))` — an empty object `{}` is truthy in JavaScript! So the caller proceeds as if it received a valid quote, then renders an empty quote preview to the user. The user sees a blank quote and thinks the AI failed — but the real bug is that `{}` should have been `null`.

---When the AI sends back a response that has no valid JSON (plain text, empty string, or broken JSON), parseQuoteFromResponse returns null.

The caller then does:

null is falsy → condition fails → no quote shown → user gets a proper "AI couldn't generate a quote" message. ✅

After (Broken Code)
The same bad responses now return {} (empty object) instead of null.

The caller does the same check:

{} is truthy in JavaScript → condition passes → app tries to render a quote from an empty object → user sees a blank/empty quote preview. ❌

### INTENTIONAL BREAK #2 — Strip JSON Extraction Logic

**What to change:**

Find the JSON extraction in `parseQuoteFromResponse`. Change it to always parse the entire string without finding the JSON boundaries:

```typescript
// BROKEN VERSION — tries to JSON.parse the full raw response (including text)
try {
  return JSON.parse(response); // BUG: fails for "Here is your quote: {...}" wrapped responses
} catch {
  return null;
}
```
Before (Original Code)
The function searches for where the JSON starts and ends inside the full response string, extracts just that portion, then parses it.

After (Broken Code)
The function tries to JSON.parse() the entire raw string — including the surrounding English text.


**Expected failing test:**
```
FAIL  tests/services/geminiService.test.ts
  geminiService > parseQuoteFromResponse
    ✗ extracts JSON embedded in surrounding text
      Expected: { quoteGenerated: true, items: [] }
      Received: null
      (JSON.parse failed because of surrounding text)
```

**Why this failure MATTERS:**

Gemini frequently wraps JSON in conversational text like `"Here is your quote: {...} Hope this helps!"`. If the parser cannot handle embedded JSON, 40-60% of AI responses will fail to generate quotes — the AI feature becomes mostly broken.

---

## MODULE 5 — dataSyncService

```
Production File : src/services/dataSyncService.ts
Test File       : tests/services/dataSyncService.test.ts
Protected Logic : localStorage save with metadata wrapper, timestamp injection, graceful quota error handling
```

### What this module does (Plain English)

`dataSyncService` is the **unified save layer** — whenever anything (company data, proposals, client info) is saved, it wraps the data with `{ data, timestamp, source, synced }` metadata before persisting. This enables conflict resolution: if the same record exists in both `localStorage` and cloud, the one with the newer timestamp wins.

---

### INTENTIONAL BREAK #1 — Remove Timestamp From Wrapper

**What to change:**

In `src/services/dataSyncService.ts`, find `saveDataUnified`:

```typescript
// ORIGINAL
const wrappedData: DataWithTimestamp<T> = {
  data,
  timestamp,
  source: 'localStorage',
  synced: false,
};
```

**Change it to:**

```typescript
// BROKEN VERSION — no timestamp saved
const wrappedData: DataWithTimestamp<T> = {
  data,
  timestamp: 0,  // BUG: always zero — conflict resolution broken
  source: 'localStorage',
  synced: false,
};
```
Break #1 (timestamp: 0): Every save gets a fake "year 1970" timestamp, so cloud always looks newer and silently overwrites the user's local work on every sync.

**Expected failing test:**
```
FAIL  tests/services/dataSyncService.test.ts
  dataSyncService > saveDataUnified
    ✗ wraps data with timestamp and source metadata
      Expected: timestamp to be >= 1716000000000 (current time)
      Received: 0
```

**Why this failure MATTERS:**

Conflict resolution (which version is newer?) is entirely based on timestamps. A timestamp of `0` means cloud data will **always win** even if local changes are newer — users lose unsaved work every sync. Alternatively, local data always wins — cloud sync becomes meaningless.

---

### INTENTIONAL BREAK #2 — Return success: true Even When Save Fails

**What to change:**

```typescript
// ORIGINAL
return { success: sources.length > 0, source: sources };

// BROKEN VERSION — lies about success
return { success: true, source: sources }; // BUG: always reports success even on failure
```

**Expected failing test:**
```
FAIL  tests/services/dataSyncService.test.ts
  dataSyncService > saveDataUnified
    ✗ returns success: false when localStorage is disabled and cloud fails
      Expected: { success: false }
      Received: { success: true }
```

**Why this failure MATTERS:**

Callers use `result.success` to decide if they need to show a "save failed, retry?" message. If this always returns `true`, data loss happens silently — the user thinks their quote was saved, but it wasn't.

---

## MODULE 6 — localStorage Utils

```
Production File : src/utils/localStorage.ts
Test File       : tests/utils/localStorage.test.ts
Protected Logic : Persist/load/clear company info, persist/load/clear chat history, QuotaExceeded error handling
```

### What this module does (Plain English)

This module is the simple read/write layer for the browser's localStorage. It saves company settings (name, logo, GST, etc.) and chat history. The critical business rule: **it must never crash the app even if localStorage is full** (`QuotaExceededError`). On error, it silently logs and continues.

---

### INTENTIONAL BREAK #1 — Use Wrong Storage Key

**What to change:**

In `src/utils/localStorage.ts`:

```typescript
// ORIGINAL
const COMPANY_INFO_KEY = 'ai_quote_gen_company_info';

// BROKEN VERSION — wrong key name
const COMPANY_INFO_KEY = 'ai_quote_gen_company'; // BUG: missing '_info' suffix
```

**Expected failing tests:**
```
FAIL  tests/utils/localStorage.test.ts
  localStorage utils > saveCompanyInfo
    ✗ persists company info to localStorage
      Expected: raw to not be null
      Received: null
      (key 'ai_quote_gen_company_info' was never written)

    ✗ loadCompanyInfo returns saved company
      Expected: { name: 'Baleen Media' }
      Received: null
```

**Why this failure MATTERS:**

Company info (logo, GST number, address) is shown on every PDF quote. If the storage key changes, all previously saved company settings are invisible to the app. Every user who upgrades to the broken version loses their company profile — they must re-enter all company details.

---

### INTENTIONAL BREAK #2 — Remove Error Handling (Let Errors Propagate)

**What to change:**

```typescript
// ORIGINAL
export const saveCompanyInfo = (companyInfo: CompanyInfo): void => {
  try {
    localStorage.setItem(COMPANY_INFO_KEY, JSON.stringify(companyInfo));
  } catch (error) {
    logger.error('Failed to save company info:', error);  // ← safe
  }
};

// BROKEN VERSION — removes try/catch
export const saveCompanyInfo = (companyInfo: CompanyInfo): void => {
  localStorage.setItem(COMPANY_INFO_KEY, JSON.stringify(companyInfo)); // BUG: can throw
};
```

**Expected failing tests:**
```
FAIL  tests/utils/localStorage.test.ts
  localStorage utils > saveCompanyInfo
    ✗ calls logger.error and does not throw when localStorage.setItem throws
      AssertionError: expected function to not throw
      Received: Error: QuotaExceededError
```

**Why this failure MATTERS:**

On iOS Safari in private mode, `localStorage.setItem` always throws. On any device with full storage, same thing. Without the try/catch, the entire quote saving workflow crashes with an unhandled exception — the user loses their work and sees a white error screen.

---

## MODULE 7 — bulletNormalization

```
Production File : src/utils/bulletNormalization.ts
Test File       : tests/utils/bulletNormalization.test.ts
Protected Logic : Strip bullet prefixes (•, -, *), detect bulleted lines, normalize terms blobs
```

### What this module does (Plain English)

Quote terms and conditions come from the AI with different bullet formats: `• Term`, `- Term`, `* Term`, `1. Term`. Before displaying them in a PDF or the UI, all these different formats must be stripped to clean text. This utility does exactly that — it provides a single source of truth for all bullet stripping so no template does it differently.

---

### INTENTIONAL BREAK #1 — Incomplete Bullet Pattern

**What to change:**

In `src/utils/bulletNormalization.ts`:

```typescript
// ORIGINAL
const BULLET_PREFIX_RE = /^[•\-*]\s*/;

// BROKEN VERSION — only strips • but not - or *
const BULLET_PREFIX_RE = /^[•]\s*/; // BUG: hyphen and asterisk bullets not stripped
```

**Expected failing tests:**
```
FAIL  tests/utils/bulletNormalization.test.ts
  bulletNormalization > stripBulletPrefix
    ✗ strips hyphen bullet -
      Expected: "Item two"
      Received: "- Item two"

    ✗ strips asterisk bullet *
      Expected: "Item three"
      Received: "* Item three"
```

**Why this failure MATTERS:**

The AI regularly generates terms with `- ` or `* ` prefixes. If these are not stripped, every quote PDF shows raw markdown characters (`- Payment upfront required`) instead of clean terms. Multiple quote templates depend on this function — all are affected.

---

### INTENTIONAL BREAK #2 — `isBulletedLine` Always Returns False

**What to change:**

```typescript
// ORIGINAL
export function isBulletedLine(line: string): boolean {
  return BULLET_START_RE.test(line) || NUMBERED_START_RE.test(line);
}

// BROKEN VERSION
export function isBulletedLine(_line: string): boolean {
  return false; // BUG: never detects bulleted lines
}
```

**Expected failing tests:**
```
FAIL  tests/utils/bulletNormalization.test.ts
  bulletNormalization > isBulletedLine
    ✗ returns true for • bullet
      Expected: true
      Received: false

    ✗ returns true for - hyphen
      Expected: true
      Received: false

    ✗ returns true for numbered "1." prefix
      Expected: true
      Received: false
```

**Why this failure MATTERS:**

`isBulletedLine()` is called by `geminiService` to decide whether the AI response contains structured terms. If it always returns `false`, all structured terms from the AI are treated as plain text — the quote preview shows a single blob of text instead of a clean bulleted terms list.

---

## MODULE 8 — quoteGrouping

```
Production File : src/utils/quoteGrouping.ts
Test File       : tests/utils/quoteGrouping.test.ts
Protected Logic : extractServiceType, groupItemsByServiceType, isMultiServiceQuote, DEFAULT_GENERAL_TERMS
```

### What this module does (Plain English)

When a quote has multiple services (Bus Branding + Auto Branding + Banner Printing), this module **groups them by service type** for display. It also extracts the clean service name from verbose descriptions like `"Bus Semi Branding - Rental Price (per Bus month)"` → `"Bus Semi Branding"`. The 6-item `DEFAULT_GENERAL_TERMS` appears on every multi-service quote.

---

### INTENTIONAL BREAK #1 — Break Service Type Extraction

**What to change:**

In `src/utils/quoteGrouping.ts`:

```typescript
// ORIGINAL
const priceSuffixPattern =
  /\s*[-–—]\s*(Display|Rental|Printing|Fixing|Installation|...|Price|Rate|Cost|Charge)\b.*/i;

// BROKEN VERSION — strip everything after the first dash (too aggressive)
const priceSuffixPattern = /\s*[-–—].*/; // BUG: strips too much
```

**Expected failing tests:**
```
FAIL  tests/utils/quoteGrouping.test.ts
  quoteGrouping > extractServiceType
    ✗ strips "Display Price (for 30 days)" from panel description
      Expected: "Bus Shelter Panel - Lit"
      Received: "Bus Shelter Panel"
      (the "- Lit" part was stripped along with the price)
```

**Why this failure MATTERS:**

`"Bus Shelter Panel - Lit"` and `"Bus Shelter Panel - Non Lit"` are different products with different prices. If both get grouped as just `"Bus Shelter Panel"`, the quote shows wrong groupings and mixed pricing — potentially a wrong invoice amount.

---

### INTENTIONAL BREAK #2 — Change DEFAULT_GENERAL_TERMS Count

**What to change:**

```typescript
// ORIGINAL — 6 terms
export const DEFAULT_GENERAL_TERMS = [
  'Prices are exclusive of GST',
  'Ad. Material shall be shared...',
  '100% Upfront payment required...',
  'Printed colors may look different...',
  'Client must approved the final design...',
  'If the client stops the campaign...',
];

// BROKEN VERSION — remove the last term (now only 5)
export const DEFAULT_GENERAL_TERMS = [
  'Prices are exclusive of GST',
  'Ad. Material shall be shared...',
  '100% Upfront payment required...',
  'Printed colors may look different...',
  'Client must approved the final design...',
  // Last term removed — now 5 items
];
```

**Expected failing test:**
```
FAIL  tests/utils/quoteGrouping.test.ts
  quoteGrouping > DEFAULT_GENERAL_TERMS
    ✗ is an array with exactly 6 items
      Expected: 6
      Received: 5
```

**Why this failure MATTERS:**

The "no refund during campaign" term is a **legal protection clause** for Baleen Media. Its accidental removal from every multi-service quote removes a contractual obligation the client agreed to. The test with exactly 6 items ensures this legal clause is never silently deleted.

---

## MODULE 9 — cacheVersion

```
Production File : src/utils/cacheVersion.ts
Test File       : tests/utils/cacheVersion.test.ts
Protected Logic : Store/retrieve version from localStorage, checkForUpdates comparison logic
```

### What this module does (Plain English)

When a new version of the app is deployed, the browser might still run the old cached version. `cacheVersion` stores the current version in `localStorage` and periodically checks if a new version is available. If a mismatch is found, it tells the app to refresh. This prevents users from running outdated code for hours without knowing.

---

### INTENTIONAL BREAK #1 — Save Under Wrong Key

**What to change:**

In `src/utils/cacheVersion.ts`:

```typescript
// ORIGINAL
const VERSION_KEY = '__app_version__';

// BROKEN VERSION
const VERSION_KEY = '__app_ver__'; // BUG: different key — old stored version never found
```

**Expected failing tests:**
```
FAIL  tests/utils/cacheVersion.test.ts
  cacheVersion – getStoredVersion
    ✗ returns parsed AppVersion after saveVersion was called
      Expected: { version: '1.2.3' }
      Received: null
      (saveVersion wrote to '__app_ver__', getStoredVersion reads from '__app_version__')
```

**Why this failure MATTERS:**

If the read key and write key do not match, `checkForUpdates` can never find the stored version — it always returns a "no stored version" state. The update notification system permanently breaks: either users are always told to refresh (annoying) or never told (stuck on old version).

---

### INTENTIONAL BREAK #2 — Corrupt JSON Handling

**What to change:**

```typescript
// ORIGINAL — handles malformed JSON gracefully
export function getStoredVersion(): AppVersion | null {
  try {
    const stored = localStorage.getItem(VERSION_KEY);
    if (stored) {
      return JSON.parse(stored); // may throw if corrupt
    }
  } catch (error) {
    logger.error('Failed to get stored version:', error);
  }
  return null;
}

// BROKEN VERSION — removes try/catch
export function getStoredVersion(): AppVersion | null {
  const stored = localStorage.getItem(VERSION_KEY);
  if (stored) {
    return JSON.parse(stored); // BUG: throws on corrupt data
  }
  return null;
}
```

**Expected failing test:**
```
FAIL  tests/utils/cacheVersion.test.ts
  cacheVersion – getStoredVersion
    ✗ returns null when localStorage contains invalid JSON
      AssertionError: expected function to not throw
      Received: SyntaxError: Unexpected token 'o' in JSON at position 0
```

**Why this failure MATTERS:**

localStorage can contain corrupt data (truncated by browser crash, written by another tab, or manually tampered with). Without try/catch, one corrupt version entry crashes the entire app on startup — the user sees a white blank screen.

---

## MODULE 10 — logger (PII Safety)

```
Production File : src/utils/logger.ts
Test File       : tests/utils/logger.test.ts
Protected Logic : Console routing per level, PII redaction (email, phone, GSTIN), level filtering
```

### What this module does (Plain English)

This is not a simple `console.log` wrapper. It does two important things:
1. **Routing**: `logger.debug()` calls `console.debug`, `logger.error()` calls `console.error`, etc.
2. **PII Redaction**: In production mode, any email address, phone number, or GSTIN (Indian tax ID) in log messages is automatically replaced with `[REDACTED_EMAIL]`, `[REDACTED_PHONE]`, `[REDACTED_GSTIN]`. This is a **compliance requirement** under data protection laws.

---

### INTENTIONAL BREAK #1 — Route Error to Wrong Console Method

**What to change:**

In `src/utils/logger.ts`, find the `emit` function:

```typescript
// ORIGINAL
case 'error':
  console.error(...sanitized);
  break;

// BROKEN VERSION — error goes to console.warn
case 'error':
  console.warn(...sanitized); // BUG: errors silently downgraded
  break;
```

**Expected failing tests:**
```
FAIL  tests/utils/logger.test.ts
  logger > routing to correct console method
    ✗ logger.error routes to console.error
      Expected: console.error to have been called
      Received: console.error was not called (console.warn was called instead)
```

**Why this failure MATTERS:**

Monitoring tools (Datadog, Sentry, etc.) are configured to watch `console.error` for critical alerts. If errors are downgraded to `console.warn`, production failures become invisible — no alert is fired, no engineer is paged, the system fails silently.

---

### INTENTIONAL BREAK #2 — Remove Email Redaction

**What to change:**

In `src/utils/logger.ts`, find `redactString`:

```typescript
// ORIGINAL
function redactString(value: string): string {
  return value
    .replace(EMAIL_RE, '[REDACTED_EMAIL]')
    .replace(GSTIN_RE, '[REDACTED_GSTIN]')
    .replace(PHONE_RE, '[REDACTED_PHONE]');
}

// BROKEN VERSION — email not redacted
function redactString(value: string): string {
  return value
    // .replace(EMAIL_RE, '[REDACTED_EMAIL]')  ← REMOVED
    .replace(GSTIN_RE, '[REDACTED_GSTIN]')
    .replace(PHONE_RE, '[REDACTED_PHONE]');
}
```

**Expected failing test:**
```
FAIL  tests/utils/logger.test.ts
  logger > __internal.redactString (PII redaction)
    ✗ redacts email addresses
      Expected: result to not contain 'admin@baleenmedia.com'
      Received: 'User email: admin@baleenmedia.com logged in'
      (email was NOT redacted)
```

**Why this failure MATTERS:**

GDPR, Australian Privacy Act, and most enterprise security policies prohibit logging PII (personally identifiable information) to server logs. If email addresses appear in logs, a log file breach exposes all user emails — a reportable data breach with significant legal and financial penalties.

---

## MODULE 11 — pwa (Service Worker)

```
Production File : src/utils/pwa.ts
Test File       : tests/utils/pwa.test.ts
Protected Logic : registerServiceWorker resolves on success, rejects on registration failure, rejects when SW not supported
```

### What this module does (Plain English)

`registerServiceWorker` registers the browser's service worker — the background process that enables offline functionality (the app works without internet). It must:
- Resolve the promise on successful registration
- Reject with a meaningful error if registration fails
- Reject if the browser doesn't support service workers

---

### INTENTIONAL BREAK #1 — Always Resolve (Even on Failure)

**What to change:**

In `src/utils/pwa.ts`, find the catch block:

```typescript
// ORIGINAL
} catch (error) {
  logger.error('❌ Service Worker registration failed:', error);
  return Promise.reject(error); // ← correctly rejects
}

// BROKEN VERSION — swallows the error
} catch (error) {
  logger.error('❌ Service Worker registration failed:', error);
  return Promise.resolve(); // BUG: pretends success even on failure
}
```

**Expected failing test:**
```
FAIL  tests/utils/pwa.test.ts
  registerServiceWorker
    ✗ rejects when navigator.serviceWorker.register throws
      Expected: promise to reject
      Received: promise resolved with undefined
```

**Why this failure MATTERS:**

If registration failure is silently swallowed, the app never knows offline mode is unavailable. Users go offline and find the app completely broken — no data loaded, no functionality. The proper behavior is to reject so the caller can show "offline mode unavailable, please ensure you have network access."

---

### INTENTIONAL BREAK #2 — Remove Logger.info on Success

**What to change:**

```typescript
// ORIGINAL
logger.info('✅ Service Worker registered successfully:', registration);

// BROKEN VERSION
// logger.info(...)  ← removed
```

**Expected failing test:**
```
FAIL  tests/utils/pwa.test.ts
  registerServiceWorker
    ✗ logs success message on successful registration
      Expected: logger.info to have been called with '✅ Service Worker registered successfully:'
      Received: logger.info was not called
```

**Why this failure MATTERS:**

This is a **WEAK test** — removing a log line does not break any user-facing functionality. This test tests implementation (a specific log call) rather than behavior (the promise resolves). **Improvement:** This test should instead verify `promise resolves with undefined` — that is the real behavior contract.

---

## MODULE 12 — fileUtils (Validation)

```
Production File : src/utils/fileUtils.ts
Test File       : tests/utils/fileUtils.test.ts
Protected Logic : validateImageFile (JPEG-only, 10MB limit), validateExcelFile (xlsx/xls only, 10MB limit)
```

### What this module does (Plain English)

Before any file is uploaded to the server or sent to the AI, it goes through validation:
- Only JPEG/JPG images are accepted (not PNG, BMP, etc.)
- Only Excel files (.xlsx, .xls) are accepted for rate cards
- Maximum file size is 10MB by default
- These rules prevent malicious file uploads, server overload, and processing errors

---

### INTENTIONAL BREAK #1 — Accept All File Types (Remove MIME Check)

**What to change:**

In `src/utils/fileUtils.ts`:

```typescript
// ORIGINAL
const validTypes = ['image/jpeg', 'image/jpg'];
if (!validTypes.includes(file.type.toLowerCase())) {
  return { valid: false, error: 'Only JPEG/JPG image files are allowed' };
}

// BROKEN VERSION — removes type restriction
// const validTypes = ['image/jpeg', 'image/jpg'];
// if (!validTypes.includes(file.type.toLowerCase())) {
//   return { valid: false, error: 'Only JPEG/JPG image files are allowed' };
// }
```

**Expected failing tests:**
```
FAIL  tests/utils/fileUtils.test.ts
  fileUtils > validateImageFile
    ✗ rejects PNG file — not JPEG
      Expected: { valid: false }
      Received: { valid: true }

    ✗ rejects PDF file
      Expected: { valid: false }
      Received: { valid: true }
```

**Why this failure MATTERS:**

Accepting all file types opens severe security vulnerabilities: malicious SVG files can contain XSS scripts, executable files can be disguised as images, and very large files can exhaust server memory. This validation is the **first security layer** — removing it exposes the entire file upload pipeline.

**Production Risk:** CRITICAL — Security vulnerability (file upload attack vector).

---

### INTENTIONAL BREAK #2 — Flip Size Check Direction

**What to change:**

```typescript
// ORIGINAL
if (file.size > maxSizeBytes) {
  return { valid: false, error: `File size must be less than ${maxSizeMB}MB` };
}

// BROKEN VERSION — flipped comparison (rejects SMALL files, accepts HUGE files)
if (file.size < maxSizeBytes) {  // BUG: < instead of >
  return { valid: false, error: `File size must be less than ${maxSizeMB}MB` };
}
```

**Expected failing tests:**
```
FAIL  tests/utils/fileUtils.test.ts
  fileUtils > validateImageFile
    ✗ accepts valid JPEG file (500KB)
      Expected: { valid: true }
      Received: { valid: false }

    ✗ rejects file over 10MB
      Expected: { valid: false }
      Received: { valid: true }

    ✗ accepts file exactly at 10MB limit
      Expected: { valid: true }
      Received: { valid: false }
```

**Why this failure MATTERS:**

A flipped condition means 100MB files pass validation (DDoS / server crash risk) while normal 500KB files are rejected (complete feature failure). This is the kind of bug that is invisible in casual testing but catastrophic in production — 5 tests catch it immediately.

---

## MODULE 13 — PrivateRoute (Auth Guard)

```
Production File : src/components/PrivateRoute/PrivateRoute.tsx
Test File       : tests/components/PrivateRoute.test.tsx
Protected Logic : Redirect to /login when not authenticated, redirect to /unauthorized when role not matched
```

### What this module does (Plain English)

`PrivateRoute` is the **security door** of the front-end. Every page that requires login is wrapped in `<PrivateRoute>`. If the user is not authenticated, they are sent to `/login`. If they are authenticated but lack the required role (e.g., a normal user trying to access admin panel), they are sent to `/unauthorized`. Without this, any user who types `/admin` in the URL bar gets full admin access.

---

### INTENTIONAL BREAK #1 — Always Render (Remove Auth Check)

**What to change:**

In `src/components/PrivateRoute/PrivateRoute.tsx`, find the auth check:

```typescript
// ORIGINAL
if (!isAuthenticated) {
  return <Navigate to="/login" replace />;
}

// BROKEN VERSION — always shows content
// if (!isAuthenticated) {
//   return <Navigate to="/login" replace />;
// }
```

**Expected failing tests:**
```
FAIL  tests/components/PrivateRoute.test.tsx
  PrivateRoute
    ✗ redirects to /login when user is not authenticated
      Expected: "Protected Content" not to be in document
      Received: "Protected Content" IS in document (rendered for unauthenticated user)
```

**Why this failure MATTERS:**

This is the **most critical test in the entire test suite**. With this break, any unauthenticated visitor can access any page just by typing the URL. Every quote, client record, and company secret is publicly accessible. If this test does not exist or is weak, the entire app's security is a facade.

**Production Risk:** CRITICAL — Full authentication bypass at the routing layer.

---

### INTENTIONAL BREAK #2 — Wrong Redirect Path on Role Failure

**What to change:**

```typescript
// ORIGINAL
if (requiredRole && !hasRole(requiredRole)) {
  return <Navigate to="/unauthorized" replace />;
}

// BROKEN VERSION — redirects to home instead of unauthorized
if (requiredRole && !hasRole(requiredRole)) {
  return <Navigate to="/" replace />; // BUG: user stays in app, just sent to home
}
```

**Expected failing test:**
```
FAIL  tests/components/PrivateRoute.test.tsx
  PrivateRoute
    ✗ redirects to /unauthorized when required role is NOT matched
      Expected: path to be '/unauthorized'
      Received: path is '/' (home page)
```

**Why this failure MATTERS:**

Redirecting to `/` instead of `/unauthorized` means the user gets no feedback that they lack permissions. They just see the home page, which can confuse users ("why can't I get to the admin panel?"). More importantly, some tests verify the `/unauthorized` route — if the redirect is wrong, those user flows break silently.

---

## MODULE 14 — useCompanySync (Hook)

```
Production File : src/hooks/useCompanySync.ts
Test File       : tests/hooks/useCompanySync.test.ts
Protected Logic : syncCompanyFromDatabase called on mount, unsubscribe called on unmount, conditional realtime setup
```

### What this module does (Plain English)

This React hook runs when a component using company data first mounts. It:
1. Immediately fetches fresh company settings from the database (sync on mount)
2. Optionally subscribes to real-time database changes (if `enableRealtime=true`)
3. Unsubscribes (cleans up) when the component unmounts to prevent memory leaks

---

### INTENTIONAL BREAK #1 — Remove Mount Sync Call

**What to change:**

In `src/hooks/useCompanySync.ts`:

```typescript
// ORIGINAL
useEffect(() => {
  syncCompanyFromDatabase(); // ← triggers on mount
  ...
}, []);

// BROKEN VERSION — sync never called
useEffect(() => {
  // syncCompanyFromDatabase();  ← REMOVED
  ...
}, []);
```

**Expected failing test:**
```
FAIL  tests/hooks/useCompanySync.test.ts
  useCompanySync
    ✗ calls syncCompanyFromDatabase on mount
      Expected: mockSyncCompanyFromDatabase to have been called once
      Received: mockSyncCompanyFromDatabase was never called
```

**Why this failure MATTERS:**

If sync is not called on mount, the company profile (name, logo, GST, address) never loads from the database on first visit. Users see empty company info on all quotes. Every PDF exported will have a blank company header until the user manually triggers a refresh.

---

### INTENTIONAL BREAK #2 — Don't Call unsubscribe on Unmount

**What to change:**

```typescript
// ORIGINAL
useEffect(() => {
  if (enableRealtime) {
    const subscription = enableCompanySync();
    return () => subscription.unsubscribe(); // ← cleanup
  }
}, [enableRealtime]);

// BROKEN VERSION — no cleanup
useEffect(() => {
  if (enableRealtime) {
    enableCompanySync();
    // return () => subscription.unsubscribe();  ← REMOVED
  }
}, [enableRealtime]);
```

**Expected failing test:**
```
FAIL  tests/hooks/useCompanySync.test.ts
  useCompanySync
    ✗ calls unsubscribe on unmount when realtime was enabled
      Expected: unsubscribeMock to have been called once
      Received: unsubscribeMock was never called
```

**Why this failure MATTERS:**

Without cleanup, the Supabase real-time subscription continues running in memory even after the component unmounts. Over time (navigating between pages), hundreds of orphaned subscriptions accumulate — this is a **memory leak** that gradually slows and crashes the browser tab.

---

## Master Failure Validation Table

> **How to read this:** For each intentional code break, this table shows which test fails and whether CI/CD would block the merge.

| Module | Intentional Change | Expected Failed Test | Expected CI Result |
|--------|-------------------|----------------------|-------------------|
| authService | Remove bcrypt check | `throws on wrong password` | ❌ BLOCKED |
| authService | Remove isActive check | `throws when account is inactive` | ❌ BLOCKED |
| authService | Empty permissions | `returns AuthUser with parsed permissions` | ❌ BLOCKED |
| authStore | isAuthenticated: false after login | `sets isAuthenticated to true` | ❌ BLOCKED |
| authStore | User not cleared on logout | `clears user on logout` | ❌ BLOCKED |
| companyService | Wrong email field mapping | `returns mapped CompanyInfo on success` | ❌ BLOCKED |
| companyService | Throw instead of null on DB error | `returns null when Supabase returns error` | ❌ BLOCKED |
| geminiService | Return `{}` instead of `null` | `returns null for plain text` | ❌ BLOCKED |
| geminiService | Break embedded JSON extraction | `extracts JSON embedded in surrounding text` | ❌ BLOCKED |
| dataSyncService | timestamp: 0 | `wraps data with timestamp metadata` | ❌ BLOCKED |
| dataSyncService | Always return success: true | `returns success: false when both fail` | ❌ BLOCKED |
| localStorage | Wrong storage key | `persists company info to localStorage` | ❌ BLOCKED |
| localStorage | Remove try/catch | `does not throw on QuotaExceededError` | ❌ BLOCKED |
| bulletNormalization | Strip only • | `strips hyphen bullet -` | ❌ BLOCKED |
| bulletNormalization | isBulletedLine always false | `returns true for • bullet` | ❌ BLOCKED |
| quoteGrouping | Aggressive suffix stripping | `strips Display Price from panel description` | ❌ BLOCKED |
| quoteGrouping | Remove last general term | `is an array with exactly 6 items` | ❌ BLOCKED |
| cacheVersion | Wrong VERSION_KEY | `returns parsed AppVersion after saveVersion` | ❌ BLOCKED |
| cacheVersion | Remove try/catch JSON parse | `returns null when localStorage has invalid JSON` | ❌ BLOCKED |
| logger | Route error to warn | `logger.error routes to console.error` | ❌ BLOCKED |
| logger | Remove email redaction | `redacts email addresses` | ❌ BLOCKED |
| pwa | Resolve on failure | `rejects when register throws` | ❌ BLOCKED |
| pwa | Remove success log | `logs success message` | ⚠️ PASSES (weak test) |
| fileUtils | Remove MIME check | `rejects PNG file — not JPEG` | ❌ BLOCKED |
| fileUtils | Flip size comparison | `rejects file over 10MB` | ❌ BLOCKED |
| PrivateRoute | Remove auth check | `redirects to /login when not authenticated` | ❌ BLOCKED |
| PrivateRoute | Wrong redirect path | `redirects to /unauthorized on role failure` | ❌ BLOCKED |
| useCompanySync | Remove mount sync | `calls syncCompanyFromDatabase on mount` | ❌ BLOCKED |
| useCompanySync | Remove unsubscribe | `calls unsubscribe on unmount` | ❌ BLOCKED |

---

## Regression Protection Matrix

> **How to read this:** "Strong" means the test truly verifies the business contract. "Weak" means the test passes even after the logic is partially broken.

| Business Logic | Test Protecting It | Strength | Risk Level |
|----------------|-------------------|----------|------------|
| User cannot login with wrong password | `throws on wrong password` | **STRONG** | CRITICAL |
| Deactivated accounts blocked | `throws when account is inactive` | **STRONG** | CRITICAL |
| Permissions correctly parsed | `returns AuthUser with parsed permissions` | **STRONG** | HIGH |
| isAuthenticated set after login | `sets isAuthenticated to true` | **STRONG** | CRITICAL |
| User cleared on logout | `clears user on logout` | **STRONG** | HIGH |
| Company email field correctly mapped | `returns mapped CompanyInfo on success` | **STRONG** | HIGH |
| Graceful null on DB error | `returns null when Supabase returns error` | **STRONG** | MEDIUM |
| AI non-JSON returns null | `returns null for plain text` | **STRONG** | HIGH |
| AI embedded JSON extracted | `extracts JSON embedded in surrounding text` | **STRONG** | HIGH |
| Timestamp stamped on save | `wraps data with timestamp metadata` | **STRONG** | HIGH |
| Save failure reported correctly | `returns success: false when both fail` | **STRONG** | MEDIUM |
| Company info key consistency | `persists company info to localStorage` | **STRONG** | HIGH |
| QuotaExceedError handled | `does not throw on QuotaExceededError` | **STRONG** | MEDIUM |
| All bullet types stripped | `strips hyphen bullet -` | **STRONG** | MEDIUM |
| Bulleted lines detected correctly | `returns true for • bullet` | **STRONG** | MEDIUM |
| Service type extracted correctly | `strips Display Price from panel` | **STRONG** | HIGH |
| Legal terms count enforced | `is an array with exactly 6 items` | **MEDIUM** (exact count, not content) | MEDIUM |
| Version key consistency | `returns parsed AppVersion after saveVersion` | **STRONG** | MEDIUM |
| Corrupt localStorage handled | `returns null for invalid JSON` | **STRONG** | MEDIUM |
| Error level routing | `logger.error routes to console.error` | **STRONG** | HIGH |
| PII not logged in production | `redacts email addresses` | **STRONG** | CRITICAL |
| SW registration failure propagated | `rejects when register throws` | **STRONG** | MEDIUM |
| SW success logged | `logs success message` | **WEAK** (tests impl, not behavior) | LOW |
| Only JPEG files accepted | `rejects PNG file — not JPEG` | **STRONG** | CRITICAL |
| File size limit enforced | `rejects file over 10MB` | **STRONG** | HIGH |
| Unauthenticated users blocked | `redirects to /login` | **STRONG** | CRITICAL |
| Wrong role redirects correctly | `redirects to /unauthorized` | **STRONG** | HIGH |
| Company sync on mount | `calls syncCompanyFromDatabase on mount` | **STRONG** | HIGH |
| Real-time unsubscribe on unmount | `calls unsubscribe on unmount` | **STRONG** | MEDIUM |

---

## Test Strength Analysis

### STRONG Tests — These Truly Protect Production

**What makes a test STRONG:**
- It tests the **behavior** (what the function does to the outside world)
- If the production behavior changes, the test FAILS
- The assertion is on the **return value or real effect**, not on internal mocks

**Examples of STRONG tests in this project:**

```typescript
// STRONG — tests real behavior
it('throws on wrong password', async () => {
  vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
  await expect(authService.login(credentials)).rejects.toThrow('Invalid email or password');
});
// WHY STRONG: if you remove the password check, the promise resolves instead of rejecting → test fails

// STRONG — tests real storage
it('persists company info to localStorage', () => {
  saveCompanyInfo(sampleCompany);
  const raw = localStorage.getItem('ai_quote_gen_company_info');
  expect(raw).not.toBeNull();
  expect(JSON.parse(raw!)).toEqual(sampleCompany);
});
// WHY STRONG: reads from REAL localStorage, not a mock — if key changes, test fails
```

---

### WEAK Tests — These Give False Confidence

**What makes a test WEAK:**
- It tests only that a mock was called (not the real outcome)
- The assertion is too loose (`toBeDefined` instead of `toBe(specificValue)`)
- It tests implementation details that can change without breaking behavior
- Breaking the logic still makes the test pass

**Example of a WEAK test in this project:**

```typescript
// WEAK — only checks a log call, not actual behavior
it('logs success message on successful registration', async () => {
  // ...setup...
  await registerServiceWorker();
  expect(logger.info).toHaveBeenCalledWith('✅ Service Worker registered successfully:', ...);
});
// WHY WEAK: removing the logger.info line makes this test fail, but
//           the actual business behavior (promise resolves) is NOT broken.
//           A developer could add a different success log and this test fails
//           even though the function still works perfectly.
```

**Improvement for weak test:**
```typescript
// BETTER — test the actual contract (promise resolves)
it('resolves when registration succeeds', async () => {
  const restore = patchServiceWorker({
    register: vi.fn().mockResolvedValue(makeFakeRegistration()),
  });
  await expect(registerServiceWorker()).resolves.toBeUndefined();
  restore();
});
```

---

### Tests That Check Mocks Instead of Reality

**Pattern to watch for:**

```typescript
// SUSPICIOUS — what does this actually test?
it('calls getCompanySettings', async () => {
  const spy = vi.spyOn(companyService, 'getCompanySettings');
  await someComponent.mount();
  expect(spy).toHaveBeenCalled();
});
// PROBLEM: This only tests that the function was called, not that
//          the result was used correctly. You could mock it to return
//          anything (even undefined) and this test still passes.
```

---

## Edge Case Breaking Scenarios

For every module, here are the edge cases you should test by intentionally providing bad input:

### authService Edge Cases

| Edge Input | What to Pass | Expected Behavior | Test Should |
|-----------|-------------|------------------|-------------|
| Null email | `{ email: null, password: 'x' }` | Throw validation error | FAIL if no throw |
| Empty password | `{ email: 'a@b.com', password: '' }` | Throw 'Invalid credentials' | FAIL if login succeeds |
| Very long email | 5000-char email | Graceful rejection | FAIL if it crashes |
| SQL injection in email | `' OR '1'='1` | No match in DB (Supabase handles) | FAIL if user returned |
| No internet (Supabase down) | Mock `supabase.from` to throw | Throw 'Invalid email or password' | FAIL if silent |

### localStorage Edge Cases

| Edge Input | Scenario | Expected Behavior |
|-----------|---------|------------------|
| `null` company info | `saveCompanyInfo(null as any)` | Either saves null or throws caught error |
| Corrupt stored JSON | Manually set `'ai_quote_gen_company_info'` to `'{broken'` | `loadCompanyInfo` returns `null` |
| Very large object | Company info with 10MB logo string | Either saves or fails gracefully |
| Browser in private mode | `localStorage` throws on setItem | Caught, `logger.error` called, no crash |

### fileUtils Edge Cases

| Edge Input | File | Expected Result |
|-----------|------|----------------|
| Zero-byte file | `new File([], 'empty.jpg', {type: 'image/jpeg'})` | Valid (no size restriction on minimum) |
| Exactly 10MB | 10 * 1024 * 1024 bytes | Valid (at limit, not over) |
| 10MB + 1 byte | 10485761 bytes | Invalid |
| Wrong extension but right MIME | `file.xlsx` with `type: 'image/jpeg'` | Valid (MIME wins for images) |
| Empty file name | `''` as name | Validated normally (name not checked) |

### geminiService Edge Cases

| Edge Input | Response | Expected |
|-----------|---------|---------|
| Empty string | `''` | `null` |
| Only whitespace | `'   \n\t  '` | `null` |
| Nested JSON | `'{"a":{"b":{"c":1}}}'` | Parsed correctly |
| Multiple JSON objects | `'{} {}'` | First one parsed (or null) |
| JSON with newlines | `'{\n"a": 1\n}'` | Parsed correctly |
| Extremely long response | 1MB text | Parsed without stack overflow |

---

## CI/CD Protection Flow

### Which Test Failures Block What

```
┌─────────────────────────────────────────────────────────┐
│  CRITICAL — Blocks immediate merge AND deployment        │
├─────────────────────────────────────────────────────────┤
│  • authService: wrong password accepted                  │
│  • authService: inactive account allowed                 │
│  • PrivateRoute: unauthenticated access allowed          │
│  • fileUtils: all file types accepted                    │
│  • logger: PII not redacted in production                │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  HIGH — Blocks merge to main/staging                     │
├─────────────────────────────────────────────────────────┤
│  • authStore: isAuthenticated wrong after login          │
│  • authStore: user not cleared on logout                 │
│  • companyService: wrong field mapping                   │
│  • geminiService: embedded JSON not extracted            │
│  • localStorage: wrong storage key                       │
│  • quoteGrouping: wrong service type extraction          │
│  • fileUtils: size limit not enforced                    │
│  • logger: error downgraded to warn                      │
│  • useCompanySync: no sync on mount                      │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  MEDIUM — Blocks merge to develop, warning on PR         │
├─────────────────────────────────────────────────────────┤
│  • companyService: throws instead of null on error       │
│  • dataSyncService: wrong timestamp                      │
│  • dataSyncService: wrong success reporting              │
│  • localStorage: QuotaExceeded not handled               │
│  • bulletNormalization: incomplete bullet stripping      │
│  • cacheVersion: wrong key or corrupt JSON handling      │
│  • useCompanySync: no unsubscribe on unmount             │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  LOW — PR comment only, not blocked                      │
├─────────────────────────────────────────────────────────┤
│  • pwa: success log removed                              │
│  • quoteGrouping: exact terms count changed              │
└─────────────────────────────────────────────────────────┘
```

---

## DevOps Validation Flow Diagram

```
Developer Makes a Code Change
          │
          ▼
   git add . && git commit -m "feat: ..."
          │
          ▼
   git push origin feature/branch-name
          │
          ▼
┌─────────────────────────────────────┐
│  GitHub Actions CI Pipeline Starts  │
│  (Triggered automatically on push)  │
└────────────────┬────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────┐
│  STEP 1: Install Dependencies (npm ci)                 │
└────────────────┬───────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────┐
│  STEP 2: TypeScript Compilation (npm run build:check)  │
│  → Catches type errors BEFORE tests run                │
└────────────────┬───────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────┐
│  STEP 3: Linting (npm run lint)                        │
│  → Catches code quality issues                         │
└────────────────┬───────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────┐
│  STEP 4: Run All Tests (npm run test)                  │
│                                                        │
│  MODULE TESTS EXECUTE:                                 │
│  ✓ tests/services/authService.test.ts                  │
│  ✓ tests/store/authStore.test.ts                       │
│  ✓ tests/services/companyService.test.ts               │
│  ✓ tests/services/geminiService.test.ts                │
│  ✓ tests/services/dataSyncService.test.ts              │
│  ✓ tests/utils/localStorage.test.ts                    │
│  ✓ tests/utils/bulletNormalization.test.ts             │
│  ✓ tests/utils/quoteGrouping.test.ts                   │
│  ✓ tests/utils/cacheVersion.test.ts                    │
│  ✓ tests/utils/logger.test.ts                          │
│  ✓ tests/utils/pwa.test.ts                             │
│  ✓ tests/utils/fileUtils.test.ts                       │
│  ✓ tests/components/PrivateRoute.test.tsx              │
│  ✓ tests/hooks/useCompanySync.test.ts                  │
│  + all other component/page tests                      │
└────────────────┬───────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        │  All Tests Pass  │  Any Test Fails
        │       ?          │       ?
        └────────┬─────────┘
                 │
        ┌────────┴────────┐
    YES ▼                 ▼ NO
┌─────────────┐   ┌──────────────────────────────────┐
│ STEP 5:     │   │  CI PIPELINE FAILS               │
│ Coverage    │   │                                  │
│ Check       │   │  ✗ FAIL: authService.test.ts     │
│ (>80%)      │   │    Expected: reject              │
└──────┬──────┘   │    Received: resolve             │
       │          │                                  │
       ▼          │  🔴 PR CANNOT BE MERGED          │
┌─────────────┐   │  🔴 DEPLOYMENT IS BLOCKED        │
│ STEP 6:     │   │  🔴 Developer gets notified      │
│ Security    │   └──────────────────────────────────┘
│ Audit       │
│ (npm audit) │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────┐
│  ALL CHECKS PASS                │
│  PR can be reviewed by humans   │
│  Humans approve                 │
│  Merge to staging               │
│  Deploy to staging              │
│  Run E2E smoke tests            │
│  Manual QA sign-off             │
│  Merge to main → Production     │
└─────────────────────────────────┘
```

---

## Weak Test Identification

These are the tests in this project that provide **less-than-ideal protection**. They pass even when logic is broken in certain ways.

### WEAK TEST #1 — PWA Logger Call Test

**File:** `tests/utils/pwa.test.ts`

```
Test: logs success message on successful registration
Weakness: Tests internal logging call, not the user-facing contract
Problem: Removing the logger.info line breaks the test but does NOT 
         indicate any broken functionality
Fix: Replace with "promise resolves to undefined on success"
```

### WEAK TEST #2 — quoteGrouping Terms Length Check

**File:** `tests/utils/quoteGrouping.test.ts`

```
Test: is an array with exactly 6 items
Weakness: Tests count only, not specific content of each item
Problem: You could swap "100% Upfront payment required" for 
         "Upfront payment optional" and the test still passes 
         (still 6 items, but legal terms changed)
Fix: Also assert specific critical terms like the refund clause
     expect(DEFAULT_GENERAL_TERMS[2]).toContain('100% Upfront')
     expect(DEFAULT_GENERAL_TERMS[5]).toContain('no refund')
```

### WEAK TEST #3 — Component Mount-Side-Effect Tests (hooks)

**File:** `tests/hooks/useCompanySync.test.ts`

```
Tests: calls syncCompanyFromDatabase on mount
Weakness: Only verifies the mock was called — not that it 
          was called with the right arguments or that the 
          returned data was applied to the store
Problem: If syncCompanyFromDatabase is called but its result
         is ignored, the test passes but company data never loads
Fix: Add assertion that store's companyInfo is updated 
     after sync completes
```

### WEAK TEST #4 — Empty Object vs Null in Gemini

**File:** `tests/services/geminiService.test.ts`

```
Current gap: Tests check for null return on bad input,
             but don't verify that a {} empty object is 
             treated the same as null by the caller
Weakness: A bug returning {} instead of null would pass 
          all current geminiService tests, but break the 
          calling component (which checks `if (result)`)
Fix: Add: expect(parseQuoteFromResponse(badInput)).toBeNull()
     AND: ensure caller test checks for null specifically
```

---

## Post-Break Restoration Checklist

After every intentional break and validation session, use this checklist to confirm you have fully restored all code:

```
□ authService.ts — bcrypt comparison restored
□ authService.ts — isActive check restored
□ authService.ts — permissions parsing restored
□ authStore.ts — isAuthenticated: true restored in login success
□ authStore.ts — user: null restored in logout
□ companyService.ts — email: data.email restored (not data.phone)
□ companyService.ts — return null restored (not throw)
□ geminiService.ts — null return paths restored
□ geminiService.ts — embedded JSON extraction logic restored
□ dataSyncService.ts — timestamp: Date.now() restored
□ dataSyncService.ts — success: sources.length > 0 restored
□ localStorage.ts — COMPANY_INFO_KEY = 'ai_quote_gen_company_info' restored
□ localStorage.ts — try/catch blocks restored in all functions
□ bulletNormalization.ts — BULLET_PREFIX_RE = /^[•\-*]\s*/ restored
□ bulletNormalization.ts — isBulletedLine real logic restored
□ quoteGrouping.ts — priceSuffixPattern restored to specific words
□ quoteGrouping.ts — all 6 DEFAULT_GENERAL_TERMS restored
□ cacheVersion.ts — VERSION_KEY = '__app_version__' restored
□ cacheVersion.ts — try/catch around JSON.parse restored
□ logger.ts — case 'error': console.error restored
□ logger.ts — EMAIL_RE replace in redactString restored
□ pwa.ts — return Promise.reject(error) in catch restored
□ fileUtils.ts — validTypes MIME check restored
□ fileUtils.ts — file.size > maxSizeBytes restored (not <)
□ PrivateRoute.tsx — if (!isAuthenticated) redirect restored
□ PrivateRoute.tsx — Navigate to="/unauthorized" restored
□ useCompanySync.ts — syncCompanyFromDatabase() call on mount restored
□ useCompanySync.ts — return () => subscription.unsubscribe() restored

FINAL VERIFICATION:
□ Run: npm run test — ALL TESTS PASS (green)
□ Run: npm run build — COMPILES CLEAN
□ Run: npm run lint — NO LINT ERRORS
□ Commit with message: "fix: restore intentional break validation"
```

---

## Summary — Why This Matters

```
Without regression validation:        With regression validation:
┌──────────────────────────┐          ┌──────────────────────────┐
│ Developer removes         │          │ Developer removes         │
│ password check            │          │ password check            │
│         ↓                 │          │         ↓                 │
│ No test catches it        │          │ Test FAILS immediately    │
│         ↓                 │          │         ↓                 │
│ Passes code review        │          │ CI/CD pipeline BLOCKED    │
│         ↓                 │          │         ↓                 │
│ Merges to main            │          │ PR REJECTED               │
│         ↓                 │          │         ↓                 │
│ Deploys to production     │          │ Developer NOTIFIED        │
│         ↓                 │          │         ↓                 │
│ All user accounts         │          │ Fix before merge          │
│ COMPROMISED               │          │ Production PROTECTED      │
│ DATA BREACH               │          │                          │
└──────────────────────────┘          └──────────────────────────┘
     FAKE COVERAGE                         REAL PROTECTION
```

**The only way to know if your tests are real guards is to try to defeat them.**  
Every break in this guide that caused a test to fail = **one production bug that will never reach users.**  
Every break that did NOT cause a test to fail = **a coverage gap that needs a new test.**

---

*Generated by: Senior SDET & QA Automation Architect*  
*Project: Quote Buddy — Enterprise AI Quote Generator*  
*Date: May 20, 2026*  
*Test Framework: Vitest + Testing Library*  
*Version: 1.0.0*
