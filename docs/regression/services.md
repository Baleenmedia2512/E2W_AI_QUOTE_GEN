# Services Module — Test Documentation (FULL depth)

Covers the 7 service files that contain all backend integration and business logic:

| File | Tests | ID range |
|---|---|---|
| [authService](#authservice) | 31 | TC_AUTH_001 – TC_AUTH_031 |
| [companyService](#companyservice) | 12 | TC_COMP_001 – TC_COMP_012 |
| [dataSyncService](#datasyncservice) | 14 | TC_SYNC_001 – TC_SYNC_014 |
| [geminiService](#geminiservice) | 25 | TC_GEMINI_001 – TC_GEMINI_025 |
| [leadService](#leadservice) | 14 | TC_LEAD_001 – TC_LEAD_014 |
| [pdfExportService](#pdfexportservice) | 14 | TC_PDFEXP_001 – TC_PDFEXP_014 |
| [supabaseProposalService](#supabaseproposalservice) | 22 | TC_SBP_001 – TC_SBP_022 |

> **Reading tip:** every test entry uses the same 14-section block. Skim **Intentional Code Break** + **Why Failure Matters** if you only want the regression story.

---

## authService

- **Test file:** [tests/services/authService.test.ts](../../tests/services/authService.test.ts)
- **Production file:** [src/services/authService.ts](../../src/services/authService.ts)
- **Module:** Authentication
- **Business logic protected:** Supabase email/password login, bcrypt password verification, role + permission lookup, localStorage session persistence.

### TC_AUTH_001 — login returns AuthUser on successful login

- **Purpose:** Proves the happy path of `authService.login()` returns a fully-mapped `AuthUser` object.
- **Business logic:** Valid email + matching bcrypt hash + role row → user session created.
- **Scenario:** Supabase returns a user row, role row; `bcrypt.compare` returns `true`.
- **Input:** `{ email: 'admin@baleenmedia.com', password: 'correctPassword' }`
- **Expected result:** Returned object has `email`, `full_name`, `role.role_name`.
- **Assertion:** `expect(user.email).toBe(...)`, `expect(user.role.role_name).toBe('Admin')`. Validates the field-mapping contract.
- **Intentional break:** In `src/services/authService.ts`, change `return { ...user, role: { role_name: roleData?.name || 'user', permissions } }` to `return null as any;`.
- **Expected failed test:** `authService > login > returns AuthUser on successful login`.
- **Failure message:** `TypeError: Cannot read properties of null (reading 'email')` or `expected undefined to be 'admin@baleenmedia.com'`.
- **Why failure matters:** A broken happy-path means **nobody can log in**. App is 100 % unusable.
- **CI/CD impact:** Pipeline fails, PR blocked, deploy stopped.
- **Manual steps:** (1) open authService.ts (2) replace the return statement with `null as any` (3) run `npm run test -- authService` (4) confirm `TC_AUTH_001` red (5) `git restore`.
- **Edge cases:** null role, malformed permissions JSON, inactive user — covered by TC_AUTH_004, 007, 008, 009.
- **Strength:** **Strong** — asserts on three independent mapped fields; not just truthiness.
- **Improvements:** Add assertion on `user.id` to lock the primary-key mapping too.

### TC_AUTH_002 — login throws on wrong password

- **Purpose:** Wrong password must not yield a session.
- **Business logic:** `bcrypt.compare(provided, stored) === false` → throw `Invalid email or password`.
- **Scenario:** Valid user found, bcrypt returns `false`.
- **Input:** `password: 'wrongPassword'`.
- **Expected result:** Promise rejects with `Invalid email or password`.
- **Assertion:** `await expect(...).rejects.toThrow('Invalid email or password')`.
- **Intentional break:** Change `if (!isMatch) throw new Error('Invalid email or password');` → delete the `throw`.
- **Expected failure:** `TC_AUTH_002` — `promise resolved instead of rejecting`.
- **Why it matters:** Removing this check means **any password logs in any user** = total auth bypass.
- **CI/CD impact:** **CRITICAL** — pipeline fails, PR blocked. Security incident if shipped.
- **Manual steps:** delete the `if (!isMatch) throw` block → `npm test authService` → see red → restore.
- **Edge cases:** bcrypt rejects (TC_AUTH_010), network rejects (TC_AUTH_011).
- **Strength:** **Strong** — asserts on specific error message, not just any throw.
- **Improvements:** Also assert that `localStorage.currentUser` was **not** written.

### TC_AUTH_003 — login throws when user is not found

- **Purpose:** No matching email in DB ⇒ identical error to "wrong password" (no user enumeration).
- **Business logic:** Same generic error for both unknown-user and wrong-password — prevents attackers learning which emails exist.
- **Scenario:** Supabase `.single()` returns `{ data: null, error: 'No rows found' }`.
- **Expected result:** Rejects with `Invalid email or password`.
- **Assertion:** `rejects.toThrow('Invalid email or password')`.
- **Intentional break:** Change the error string to `User not found`.
- **Failure:** `TC_AUTH_003` red — string mismatch.
- **Why it matters:** Distinct messages = **user enumeration vulnerability** (OWASP A07). Lets attackers list real accounts.
- **CI/CD:** Pipeline fails — security regression blocks deploy.
- **Manual:** open authService.ts → change literal → `npm test` → red → restore.
- **Edge cases:** also covered: case-insensitive email (TC_AUTH_006).
- **Strength:** **Strong** — security-critical assertion on exact wording.
- **Improvements:** Add a sibling test that times login of valid vs invalid user — same-length timing prevents timing attacks.

### TC_AUTH_004 — login throws when account is inactive

- **Purpose:** Soft-deleted / suspended users cannot log in.
- **Business logic:** `user.isActive === false` ⇒ throw `…deactivated…` regardless of password match.
- **Scenario:** Valid credentials but `isActive: false`.
- **Assertion:** `rejects.toThrow('deactivated')`.
- **Intentional break:** Comment out the `if (!user.isActive) throw …` guard in authService.ts.
- **Failure:** `TC_AUTH_004` red — promise resolves.
- **Why it matters:** Removing the guard lets **terminated employees / banned users log back in**. Compliance + security violation.
- **CI/CD:** Block merge.
- **Manual:** comment the guard → run → red → restore.
- **Edge cases:** `isActive: undefined` (treated as truthy — gap, see Improvements).
- **Strength:** **Medium** — only string-match `deactivated`, doesn't lock the early-return behavior.
- **Improvements:** Add test for `isActive: undefined` (should fail-closed but currently passes). Currently a real production gap.

### TC_AUTH_005 — login throws when role cannot be fetched

- **Purpose:** A user without a role row is treated as an error, not silently downgraded.
- **Business logic:** Role lookup failure ⇒ `Unable to fetch user role`.
- **Scenario:** User row OK, role query returns error.
- **Assertion:** `rejects.toThrow('Unable to fetch user role')`.
- **Intentional break:** In authService.ts, change `if (roleError) throw new Error('Unable to fetch user role')` → `roleData = {}`.
- **Failure:** `TC_AUTH_005` red — promise resolves.
- **Why it matters:** Silent downgrade to empty role = **anonymous user with logged-in cookies** = permission bypass.
- **CI/CD:** Block.
- **Edge cases:** TC_AUTH_007 covers `roleData` as array, TC_AUTH_008 covers object-typed permissions.
- **Strength:** **Strong**.
- **Improvements:** Assert that no `currentUser` was persisted to localStorage on this failure.

### TC_AUTH_006 — login trims whitespace from email before querying Supabase

- **Purpose:** `  admin@x.com  ` and `admin@x.com` must hit the same row.
- **Business logic:** `email.trim()` before `.ilike('email', …)`.
- **Scenario:** Spaced email; spy on `.ilike` call.
- **Assertion:** `expect(chain.ilike).toHaveBeenCalledWith('email', 'admin@baleenmedia.com')`.
- **Intentional break:** Remove `.trim()` from the email argument.
- **Failure:** `TC_AUTH_006` — argument mismatch.
- **Why it matters:** Mobile keyboards autocomplete with trailing space. Without trim, **legitimate users lock themselves out** on every login.
- **CI/CD:** Block.
- **Strength:** **Strong** — verifies actual call signature, not just outcome.
- **Improvements:** Also test `.toLowerCase()` if email matching is supposed to be case-insensitive (currently `ilike` handles this but is not asserted).

### TC_AUTH_007 — login extracts first element when user.Role is an array

- **Purpose:** Supabase nested-relation API sometimes returns an array; service must take `[0]`.
- **Business logic:** `Array.isArray(user.Role) ? user.Role[0] : user.Role`.
- **Assertion:** `expect(user.role.role_name).toBe('Admin')` when mock role is `[mockRole]`.
- **Intentional break:** Replace `Array.isArray(...) ? ... [0] : ...` with just `user.Role`.
- **Failure:** `TC_AUTH_007` — `role_name` becomes `undefined`.
- **Why it matters:** Real Supabase queries return arrays for some join patterns. Skipping the branch ⇒ **all users lose their role** even though they appear logged in.
- **CI/CD:** Block.
- **Strength:** **Strong** — narrow branch coverage.
- **Improvements:** None.

### TC_AUTH_008 — login uses permissions directly when they are already an object

- **Purpose:** Permissions field can be object or JSON string; both must work.
- **Business logic:** `typeof perms === 'string' ? JSON.parse(perms) : perms`.
- **Assertion:** `expect(user.role.permissions).toEqual({ canEditQuotes: true })`.
- **Intentional break:** Always run `JSON.parse(perms)`.
- **Failure:** `TC_AUTH_008` — `JSON.parse` throws on object.
- **Why it matters:** Database type drift (jsonb vs text) breaks login app-wide.
- **CI/CD:** Block.
- **Strength:** **Strong**.
- **Improvements:** None.

### TC_AUTH_009 — login falls back to empty permissions when JSON malformed

- **Purpose:** Bad JSON in DB does not crash login — just yields zero permissions.
- **Business logic:** `try { JSON.parse } catch { permissions = {} }`.
- **Assertion:** `expect(user.role.permissions).toEqual({})`.
- **Intentional break:** Remove the `try/catch` around the parse.
- **Failure:** `TC_AUTH_009` — uncaught SyntaxError leaks out.
- **Why it matters:** One malformed row in `Role` table would make **every user with that role unable to log in**.
- **CI/CD:** Block.
- **Strength:** **Strong**.
- **Improvements:** Log a warning when this fallback fires; assert `logger.warn` was called.

### TC_AUTH_010 — login keeps empty permissions when roleData.permissions is null

- **Purpose:** Null permissions ⇒ `{}`, not crash.
- **Assertion:** `expect(user.role.permissions).toEqual({})`.
- **Intentional break:** Remove the `if (roleData?.permissions)` guard, force-parse.
- **Failure:** `JSON.parse(null)` actually returns `null` → assertion mismatch.
- **Why it matters:** Same as TC_AUTH_009 — defensive coding for partial DB data.
- **Strength:** **Medium** — strong assertion but the bug it prevents is rarer.

### TC_AUTH_011 — login falls back to "user" role name when role has no name field

- **Purpose:** Missing role name ⇒ default `'user'` (least privilege).
- **Assertion:** `expect(user.role.role_name).toBe('user')`.
- **Intentional break:** Remove `|| 'user'` fallback.
- **Failure:** `role_name` becomes `undefined` → assertion fails.
- **Why it matters:** Undefined role bypasses every `hasRole(...)` check ⇒ accidental privilege escalation **or** denial-of-service.
- **CI/CD:** Block.
- **Strength:** **Strong**.

### TC_AUTH_012 — login propagates error when bcrypt.compare throws

- **Purpose:** Bcrypt internal errors must surface, not be swallowed.
- **Assertion:** `rejects.toThrow('bcrypt internal error')`.
- **Intentional break:** Wrap `bcrypt.compare` in `try { … } catch { return null; }`.
- **Failure:** `TC_AUTH_012` — promise resolves.
- **Why it matters:** Silent bcrypt error → login appears to "succeed" with `null` user → null-pointer crashes downstream.
- **Strength:** **Strong**.

### TC_AUTH_013 — login propagates error when Supabase query rejects at network level

- **Purpose:** Total network failure surfaces a real error, not "wrong password".
- **Assertion:** `rejects.toThrow('Network error')`.
- **Intentional break:** Wrap the Supabase call in `try { … } catch { throw new Error('Invalid email or password'); }`.
- **Failure:** Different error message, test red.
- **Why it matters:** Misclassifying outages as credential failures triggers **password-reset storms** and hides real incidents from monitoring.
- **Strength:** **Strong**.

### TC_AUTH_014 — logout removes currentUser and authToken from localStorage

- **Purpose:** Logout truly clears the session.
- **Assertion:** `expect(localStorage.getItem('currentUser')).toBeNull()`, same for `authToken`.
- **Intentional break:** Remove the `removeItem('currentUser')` line.
- **Failure:** Test red.
- **Why it matters:** Stale session on shared devices = **account takeover**.
- **CI/CD:** Block. Security-critical.
- **Strength:** **Strong** — asserts both keys.
- **Improvements:** Also assert that any in-memory store (e.g. `useAuthStore.user`) is cleared — currently not covered here (covered in store tests).

### TC_AUTH_015 — getCurrentUser returns AuthUser from localStorage when present

- **Purpose:** Page reload restores session from storage.
- **Assertion:** `toEqual(stored)`.
- **Break:** Make `getCurrentUser` always return `null`.
- **Why it matters:** Users get logged out on every reload — terrible UX.
- **Strength:** Strong.

### TC_AUTH_016 — getCurrentUser returns null when localStorage is empty

- **Purpose:** Fresh browser session ⇒ no user.
- **Break:** Return a hard-coded fake user.
- **Why it matters:** Phantom session = unauthorized access.
- **Strength:** Strong.

### TC_AUTH_017 — getCurrentUser returns null when stored value is corrupted JSON

- **Purpose:** Bad JSON ⇒ null, not crash.
- **Break:** Remove the `try/catch` around `JSON.parse`.
- **Failure message:** Uncaught `SyntaxError`.
- **Why it matters:** A corrupted storage value (rare but real) shouldn't break the app for all users until they manually clear cache.
- **Strength:** Strong.

### TC_AUTH_018 — getCurrentUser returns null when localStorage.getItem throws

- **Purpose:** SecurityError (sandboxed iframe) ⇒ null.
- **Break:** Remove the outer `try/catch`.
- **Why it matters:** App must work in restricted iframes (embedded widget mode).
- **Strength:** Strong — covers DOMException edge.

### TC_AUTH_019 — saveUser saves user to localStorage

- **Purpose:** Persistence after login works.
- **Assertion:** `JSON.parse(localStorage.getItem('currentUser')!)` deeply equals user.
- **Break:** Make `saveUser` a no-op.
- **Why it matters:** Session lost on refresh.
- **Strength:** Strong.

### TC_AUTH_020 — saveUser propagates error when localStorage.setItem throws

- **Purpose:** Documents the contract: caller (store) handles quota errors.
- **Break:** Wrap `setItem` in `try/catch` inside `saveUser`.
- **Failure:** Test now fails because no throw is propagated.
- **Why it matters:** Silent persistence failure ⇒ user "logged in" but next refresh = logged out. Confusing bug.
- **Strength:** **Medium** — contract test; could be brittle if design changes.
- **Improvements:** Pair with a store test that confirms the caller handles it.

### TC_AUTH_021 — isAuthenticated returns true when user is in localStorage

- **Purpose:** Auth-gated routes know the user is signed in.
- **Break:** Always return `false`.
- **Why it matters:** All routes redirect to login forever.
- **Strength:** Strong.

### TC_AUTH_022 — isAuthenticated returns false when localStorage is empty

- **Purpose:** No phantom auth.
- **Break:** Return `true` unconditionally.
- **Why it matters:** **CRITICAL** — anyone can access protected pages.
- **CI/CD:** Block.
- **Strength:** Strong.

### TC_AUTH_023 — hasPermission returns true for a granted permission

- **Purpose:** Per-action authz works.
- **Assertion:** `expect(authService.hasPermission('canEditQuotes')).toBe(true)`.
- **Break:** Always return `false`.
- **Why it matters:** Authorized features become unreachable.
- **Strength:** Strong.

### TC_AUTH_024 — hasPermission returns false for a denied permission

- **Purpose:** Authz really denies.
- **Break:** Always return `true`.
- **Why it matters:** **CRITICAL** — privilege escalation.
- **CI/CD:** Block.
- **Strength:** Strong.

### TC_AUTH_025 — hasPermission returns false when user has no permissions object

- **Purpose:** Unauthenticated user can't claim permissions.
- **Break:** Return `true` when user is null.
- **Why it matters:** Auth bypass.
- **Strength:** Strong.

### TC_AUTH_026 — hasPermission returns false when permission key does not exist

- **Purpose:** Unknown key ⇒ deny (default-deny model).
- **Break:** Default-allow (`return permissions[key] !== false`).
- **Why it matters:** New permissions added to the codebase silently auto-allow until DB seeds catch up.
- **Strength:** Strong — locks the default-deny invariant.

### TC_AUTH_027 — hasRole returns true for matching role (case-insensitive)

- **Purpose:** `admin` and `ADMIN` are the same.
- **Break:** Use `===` instead of `.toLowerCase() ===`.
- **Why it matters:** Role names typed inconsistently in DB lock out users.
- **Strength:** Strong — tests both `admin` and `ADMIN`.

### TC_AUTH_028 — hasRole returns false for non-matching role

- **Purpose:** Roles really differ.
- **Break:** Always true.
- **Why it matters:** Privilege escalation.
- **Strength:** Strong.

### TC_AUTH_029 — hasRole returns false when no user

- **Purpose:** Logged-out users can't claim roles.
- **Strength:** Strong.

### TC_AUTH_030 — getUserRole returns role name when user is logged in

- **Purpose:** Role visible to UI badges, audit logs.
- **Break:** Always return `'guest'`.
- **Strength:** Strong.

### TC_AUTH_031 — getUserRole returns null when not logged in

- **Purpose:** No phantom role.
- **Strength:** Strong.

---

## companyService

- **Test file:** [tests/services/companyService.test.ts](../../tests/services/companyService.test.ts)
- **Production file:** [src/services/companyService.ts](../../src/services/companyService.ts)
- **Business logic protected:** Read/write/realtime sync of the single company-settings row used on every quote and PDF.

### TC_COMP_001 — getCompanySettings returns mapped CompanyInfo on success

- **Purpose:** DB→domain mapping is correct.
- **Assertion:** name, email, gst all map.
- **Break:** Return `data` unmapped (snake_case leaks).
- **Why it matters:** Company name / GST missing on every generated PDF — visible to customers, legal issue on invoices.
- **CI/CD:** Block.
- **Strength:** **Medium** — only 3 fields asserted; 10+ fields exist.
- **Improvements:** Add an `expect(result).toMatchObject(sampleCompany)` to lock the full mapping.

### TC_COMP_002 — returns null when Supabase returns an error

- **Purpose:** Network/DB error ⇒ null, not throw.
- **Break:** Throw instead of return null.
- **Why it matters:** Crash at app boot (companyInfo loaded on mount).
- **Strength:** Strong.

### TC_COMP_003 — returns null when no company record exists

- **Purpose:** Empty table ⇒ null (so caller falls back to defaultCompany).
- **Break:** Return `{}` instead of null.
- **Why it matters:** Empty PDF header on first install.
- **Strength:** Strong.

### TC_COMP_004 — returns null on unexpected exception

- **Purpose:** `supabase.from()` throwing synchronously ⇒ null.
- **Break:** Remove outer `try/catch`.
- **Why it matters:** App crash on boot.
- **Strength:** Strong.

### TC_COMP_005 — maps empty string fields to empty strings (not null)

- **Purpose:** Empty strings preserved (forms expect strings, not null).
- **Break:** Coerce empty strings to undefined.
- **Why it matters:** React form components throw "uncontrolled to controlled" warnings; some fields become `undefined`.
- **Strength:** **Medium** — only asserts 2 of N fields.

### TC_COMP_006 — saveCompanySettings returns true on successful update

- **Purpose:** Update path works.
- **Break:** Always return false.
- **Why it matters:** UI shows save failure even when DB succeeded ⇒ users keep clicking Save ⇒ duplicate writes.
- **Strength:** Strong.

### TC_COMP_007 — returns false when update fails

- **Purpose:** Real failure reported.
- **Break:** Always return true.
- **Why it matters:** Silent data loss — user thinks save succeeded.
- **CI/CD:** Block.
- **Strength:** Strong.

### TC_COMP_008 — returns false on exception

- **Purpose:** Synchronous throw doesn't crash UI.
- **Break:** Remove try/catch.
- **Why it matters:** Crash on Save click.
- **Strength:** Strong.

### TC_COMP_009 — subscribeToChanges wires up channel, on, subscribe

- **Purpose:** Realtime subscription setup is correct.
- **Assertion:** Verifies all three Supabase methods called.
- **Break:** Skip calling `.subscribe()`.
- **Why it matters:** Realtime sync silently broken — users on two devices won't see each other's edits.
- **Strength:** **Medium** — verifies wiring but not actual event delivery.

### TC_COMP_010 — calls callback with mapped CompanyInfo when payload is_active=true

- **Purpose:** Active-record events propagate.
- **Break:** Skip the `if (payload.new.is_active)` guard.
- **Why it matters:** Stale company info ⇒ wrong PDF header.
- **Strength:** Strong.

### TC_COMP_011 — does NOT call callback when payload is_active=false

- **Purpose:** Soft-deleted rows ignored.
- **Break:** Always call callback.
- **Why it matters:** Deactivated company info gets pushed live ⇒ wrong branding.
- **Strength:** Strong.

### TC_COMP_012 — returns the subscription object from subscribe()

- **Purpose:** Caller can `.unsubscribe()` on unmount.
- **Break:** Return `undefined`.
- **Why it matters:** Memory leak / zombie listeners.
- **Strength:** Strong.

---

## dataSyncService

- **Test file:** [tests/services/dataSyncService.test.ts](../../tests/services/dataSyncService.test.ts)
- **Production file:** [src/services/dataSyncService.ts](../../src/services/dataSyncService.ts)
- **Business logic protected:** Unified save/load with optional cloud, sync status, cache clear.

> ⚠ **HIGH RISK module:** cloud sync path is *not* mocked — these tests only prove the local-storage branch. See [test-effectiveness-analysis.md](test-effectiveness-analysis.md).

### TC_SYNC_001 — saveDataUnified saves to localStorage by default

- **Purpose:** Default options write to localStorage.
- **Break:** Default `localStorage: false`.
- **Why it matters:** All settings lost on refresh.
- **Strength:** Strong.

### TC_SYNC_002 — wraps data with timestamp and source metadata

- **Purpose:** Each stored value gets `{ data, timestamp, source }` envelope.
- **Assertion:** `timestamp` between `before` and `after`; `source === 'localStorage'`.
- **Break:** Store raw data without envelope.
- **Why it matters:** Cache age check (TC_SYNC_005) breaks ⇒ stale data shown forever.
- **Strength:** Strong.

### TC_SYNC_003 — returns success: false when localStorage disabled and cloud fails

- **Purpose:** No silent success.
- **Break:** Always return `success: true`.
- **Why it matters:** User edits silently dropped.
- **Strength:** Medium — only one combination tested.

### TC_SYNC_004 — does not throw when localStorage throws quota error

- **Purpose:** QuotaExceededError absorbed.
- **Assertion:** Just `result).toBeDefined()` — very weak.
- **Break:** Hard to break in a way that fails the test.
- **Strength:** **WEAK / fake coverage** — assertion doesn't lock behavior.
- **Improvements:** Assert `result.success === false` and `result.error` matches `/quota/i`.

### TC_SYNC_005 — loadDataUnified returns stored data from localStorage

- **Purpose:** Round-trip works.
- **Break:** Return null always.
- **Strength:** Strong.

### TC_SYNC_006 — returns null when key does not exist

- **Strength:** Strong.

### TC_SYNC_007 — returns null when stored data is older than maxAge

- **Purpose:** Cache TTL is enforced.
- **Break:** Skip maxAge check.
- **Why it matters:** Stale cached company info / quotes shown indefinitely.
- **Strength:** Strong.

### TC_SYNC_008 — returns data within maxAge threshold

- **Strength:** Strong.

### TC_SYNC_009 — getSyncStatus returns SyncStatus object

- **Purpose:** Shape of status object.
- **Assertion:** Asserts on field types only.
- **Strength:** **Medium** — type-shape check, no behavior.

### TC_SYNC_010…012 — pendingChanges non-negative; isSyncing false; lastSync null

- **Strength:** **Weak** — initial-state tautologies. Won't catch sync logic regressions.
- **Improvements:** Add tests that drive a sync and assert `lastSync` populated.

### TC_SYNC_013 — clearAllCache removes non-auth keys but keeps auth-storage

- **Purpose:** Cache reset doesn't log user out.
- **Break:** Remove the `key !== 'auth-storage'` filter.
- **Why it matters:** "Clear cache" button silently logs everyone out on every click ⇒ user complaints.
- **CI/CD:** Block.
- **Strength:** **Strong** — single most important test in this file.

### TC_SYNC_014 — clearAllCache does not throw when localStorage is empty

- **Strength:** Medium (no-op assertion).

---

## geminiService

- **Test file:** [tests/services/geminiService.test.ts](../../tests/services/geminiService.test.ts)
- **Production file:** [src/services/geminiService.ts](../../src/services/geminiService.ts)
- **Business logic protected:** AI quote generation, JSON parsing, match-type classification (exact/multiple/partial/none), description prefix repair.

### TC_GEMINI_001…009 — parseQuoteFromResponse (9 tests)

These all guard the **JSON extractor** that turns AI replies into structured quotes.

| ID | Test | Break | Why it matters |
|---|---|---|---|
| TC_GEMINI_001 | extracts JSON from clean response | Return null always | Quote generation entirely broken |
| TC_GEMINI_002 | extracts JSON embedded in text | Remove regex extraction | AI rarely returns pure JSON; without this 80%+ of responses fail |
| TC_GEMINI_003 | returns null for plain text | Try to parse anyway | Crashes on every chat reply |
| TC_GEMINI_004 | returns null for empty string | Throw on empty | App crash on AI timeout |
| TC_GEMINI_005 | returns null for malformed JSON | Remove try/catch on JSON.parse | App crash when AI returns broken JSON |
| TC_GEMINI_006 | parses multipleMatch | Drop multipleMatch branch | Wrong UI (no service picker shown) |
| TC_GEMINI_007 | parses partialMatch | Drop partialMatch branch | No "did you mean" suggestions |
| TC_GEMINI_008 | parses noMatch | Drop noMatch branch | App shows nothing when service unknown |
| TC_GEMINI_009 | preserves numeric price fields | Stringify numbers | Quote totals become NaN |

All **Strong** — assertions check specific keys + types. Strength of the parser is the strongest part of this module.

### TC_GEMINI_010 — sendMessageToGemini returns isQuoteGeneration=true for valid quote JSON

- **Purpose:** Happy-path classification.
- **Assertion:** `isQuoteGeneration: true`, `matchType: 'exact'`.
- **Break:** Always return `false`.
- **Why it matters:** UI never shows quote — AI replies treated as chat forever.
- **Strength:** Strong.

### TC_GEMINI_011 — returns isQuoteGeneration=false for plain text reply

- **Break:** Always return `true`.
- **Why it matters:** Conversational replies wrongly parsed as quotes → empty quote table shown.
- **Strength:** Strong.

### TC_GEMINI_012 — returns isMultipleMatch=true for multipleMatch JSON

- **Break:** Misclassify as exact.
- **Why it matters:** User shown only first match silently, missing alternative services.
- **Strength:** Strong.

### TC_GEMINI_013 — returns isPartialMatch=true for partialMatch JSON

- **Break:** Classify as noMatch.
- **Why it matters:** No suggested-alternatives UI ⇒ user gives up.
- **Strength:** Strong.

### TC_GEMINI_014 — returns isNoMatch=true for noMatch JSON

- **Break:** Default to exact match.
- **Why it matters:** UI shows fake/empty quote instead of "service not in catalog".
- **Strength:** Strong.

### TC_GEMINI_015 — throws when Gemini API key is not configured

- **Purpose:** Fail loudly on misconfig.
- **Break:** Default to placeholder key.
- **Why it matters:** Silent failures on staging without secret ⇒ engineers debug for hours.
- **Strength:** Strong.

### TC_GEMINI_016 — includes proposalTexts content in context

- **Assertion:** Inspects the actual prompt sent to Gemini.
- **Break:** Drop the `proposalTexts` argument from prompt builder.
- **Why it matters:** Quote-from-PDF feature stops working — AI hallucinates random services.
- **Strength:** **Strong** — verifies real prompt content.

### TC_GEMINI_017 — includes all proposalTexts documents (multi-doc)

- **Break:** Only include first document.
- **Why it matters:** Multi-city quotes silently lose cities.
- **Strength:** Strong.

### TC_GEMINI_018 — includes user message in prompt

- **Break:** Hardcoded prompt with no user input.
- **Why it matters:** AI ignores what user asked for.
- **Strength:** Strong (uses unique sentinel string).

### TC_GEMINI_019 — returns a message string in all response types

- **Strength:** Medium — only checks `typeof string && length > 0`.

### TC_GEMINI_020 — validateAndFixQuoteDescriptions: prepends title when missing

- **Purpose:** PDF descriptions are normalized to start with the service title.
- **Break:** Skip the prepend logic.
- **Why it matters:** Quote PDFs show ambiguous descriptions like "Rental Price" instead of "Bus Semi Branding - Rental Price" — customer confusion.
- **Strength:** Strong.

### TC_GEMINI_021 — does NOT modify description when already correctly prefixed

- **Purpose:** No double-prefixing.
- **Break:** Always prepend.
- **Why it matters:** "Bus Semi Branding - Bus Semi Branding - Rental Price" on PDFs.
- **Strength:** Strong.

### TC_GEMINI_022 — fixes descriptions across multiple items

- **Break:** Only process first item.
- **Why it matters:** Multi-service quotes mis-labeled.
- **Strength:** Strong.

### TC_GEMINI_023 — returns quote unchanged when lineItems empty

- **Purpose:** No crash on empty array.
- **Strength:** Medium.

### TC_GEMINI_024 — preserves unitPrice, quantity, total when fixing description

- **Break:** Mutate price during normalization.
- **Why it matters:** Wrong totals in PDF — financial bug.
- **Strength:** Strong.

### TC_GEMINI_025 — does NOT double-prefix when city already in description

- **Break:** Always prepend title.
- **Why it matters:** "Chennai - Auto Back Stickers - Auto Back Stickers - Display Price".
- **Strength:** Strong.

---

## leadService

- **Test file:** [tests/services/leadService.test.ts](../../tests/services/leadService.test.ts)
- **Production file:** [src/services/leadService.ts](../../src/services/leadService.ts)
- **Business logic protected:** Lead search, lookup, list with default and custom limits.

### TC_LEAD_001 — searchLeads returns matching leads for valid search term

- **Break:** Always return `[]`.
- **Why it matters:** Lead autocomplete dies in the chat UI.
- **Strength:** Strong.

### TC_LEAD_002 — returns empty array when search term < 2 chars

- **Purpose:** Avoid hammering DB on single-char typing.
- **Assertion:** `expect(supabase.from).not.toHaveBeenCalled()` — verifies short-circuit.
- **Break:** Remove the length guard.
- **Why it matters:** DB query per keystroke → 100× more calls → cost + rate-limit.
- **Strength:** **Strong** — asserts on the call-not-made.

### TC_LEAD_003 — returns empty array on Supabase error

- **Strength:** Strong.

### TC_LEAD_004 — returns empty array when no leads match

- **Strength:** Strong.

### TC_LEAD_005 — returns empty array on unexpected exception

- **Break:** Remove try/catch.
- **Why it matters:** Chat UI crashes on any DB hiccup.
- **Strength:** Strong.

### TC_LEAD_006 — uses default limit of 15

- **Break:** Use 100 default.
- **Why it matters:** Autocomplete dropdown becomes unscrollable.
- **Strength:** Strong (asserts on `.limit` call).

### TC_LEAD_007 — accepts custom limit parameter

- **Break:** Ignore the parameter.
- **Strength:** Strong.

### TC_LEAD_008 — getLeadById returns a lead when found

- **Strength:** Strong.

### TC_LEAD_009 — returns null when lead not found (error)

- **Strength:** Strong.

### TC_LEAD_010 — returns null on exception

- **Strength:** Strong.

### TC_LEAD_011 — getAllLeads returns all leads up to default limit (100)

- **Break:** Default 10.
- **Why it matters:** Lead list page silently truncated.
- **Strength:** Strong.

### TC_LEAD_012 — accepts a custom limit

- **Strength:** Strong.

### TC_LEAD_013 — returns empty array on Supabase error

- **Strength:** Strong.

### TC_LEAD_014 — returns empty array on exception

- **Strength:** Strong.

---

## pdfExportService

- **Test file:** [tests/services/pdfExportService.test.ts](../../tests/services/pdfExportService.test.ts)
- **Production file:** [src/services/pdfExportService.ts](../../src/services/pdfExportService.ts)
- **Business logic protected:** PDF export pipeline (validate element → estimate size → html2canvas → jsPDF → save/share).

> ⚠ **HIGH RISK module:** every external library is mocked. Tests prove *call-shapes*, not that the resulting PDF looks correct or is openable.

### TC_PDFEXP_001 — validateElementForExport returns false for null

- **Break:** Return true.
- **Why it matters:** Calling html2canvas on null crashes the export entirely.
- **Strength:** Strong.

### TC_PDFEXP_002 — returns false for element with no dimensions (jsdom default)

- **Break:** Skip the scroll-dimension check.
- **Why it matters:** Hidden / unmounted elements get rendered as blank PDFs.
- **Strength:** Strong.

### TC_PDFEXP_003 — returns true for element with non-zero scroll dimensions

- **Strength:** Strong.

### TC_PDFEXP_004 — returns false for zero scrollHeight even if scrollWidth > 0

- **Purpose:** Both dimensions required.
- **Break:** Use `||` instead of `&&`.
- **Why it matters:** Empty PDF body produced.
- **Strength:** Strong.

### TC_PDFEXP_005 — estimatePDFSize returns a number

- **Strength:** **Weak** — only checks type.

### TC_PDFEXP_006 — returns a non-negative value

- **Strength:** Weak.

### TC_PDFEXP_007 — returns 0 when element has no scroll dimensions

- **Strength:** Medium.

### TC_PDFEXP_008 — returns larger value for bigger dimensions

- **Strength:** Strong — relational assertion catches algorithm reversal.

### TC_PDFEXP_009 — exportToPDFWithOptions calls html2canvas with provided element

- **Assertion:** `expect(html2canvas).toHaveBeenCalledWith(el, ...)`.
- **Break:** Pass `document.body` instead.
- **Why it matters:** PDF captures whole page instead of the quote preview.
- **Strength:** Strong.

### TC_PDFEXP_010 — calls pdf.save on web (non-mobile) platform

- **Break:** Always call mobile path.
- **Why it matters:** Web users see no download.
- **Strength:** Strong.

### TC_PDFEXP_011 — uses custom filename option when provided

- **Break:** Ignore filename option.
- **Why it matters:** Quote files all named `quote.pdf` → user can't find them.
- **Strength:** Strong.

### TC_PDFEXP_012 — calls Filesystem.writeFile on mobile (Capacitor) platform

- **Break:** Always pdf.save.
- **Why it matters:** Mobile users get a broken blob download instead of native file.
- **Strength:** Strong.

### TC_PDFEXP_013 — throws when html2canvas rejects

- **Break:** Swallow the error.
- **Why it matters:** Silent export failure — user thinks PDF was generated when it wasn't.
- **Strength:** Strong.

### TC_PDFEXP_014 — exportToPDF completes without throwing when no PDF sections exist

- **Purpose:** Fallback path works.
- **Assertion:** `resolves.not.toThrow()` — very weak.
- **Strength:** **Weak / fake coverage** — passes even if output is empty PDF.
- **Improvements:** Use a snapshot of the jsPDF instructions called, or assert specific `addImage`/`addPage` counts.

---

## supabaseProposalService

- **Test file:** [tests/services/supabaseProposalService.test.ts](../../tests/services/supabaseProposalService.test.ts)
- **Production file:** [src/services/supabaseProposalService.ts](../../src/services/supabaseProposalService.ts)
- **Business logic protected:** Cloud upload, list, get, delete, dedup, download, availability, DB→domain mapping.

### TC_SBP_001 — uploadProposalToCloud returns success with proposal on valid upload

- **Break:** Always return `success: false`.
- **Why it matters:** Upload always reported as failed even when DB succeeded ⇒ duplicate uploads.
- **Strength:** **Medium** — only checks `success`, not returned proposal data.

### TC_SBP_002 — returns failure when storage upload errors

- **Strength:** Strong.

### TC_SBP_003 — sanitizes file name with special characters

- **Purpose:** Spaces/parens removed from storage path.
- **Assertion:** `storagePath` does not match `/[ ()]/`.
- **Break:** Skip sanitization.
- **Why it matters:** Supabase storage 400 on special chars ⇒ uploads fail silently.
- **Strength:** Strong.

### TC_SBP_004 — loadAllProposalsFromCloud returns array of proposals

- **Strength:** Strong.

### TC_SBP_005 — returns empty array on database error

- **Strength:** Strong.

### TC_SBP_006 — returns empty array when no proposals exist

- **Strength:** Strong.

### TC_SBP_007 — loadProposalFromCloud returns proposal when found by id

- **Strength:** Strong.

### TC_SBP_008 — returns null when proposal not found

- **Strength:** Strong.

### TC_SBP_009 — deleteProposalFromCloud returns true on successful deletion

- **Break:** Skip storage delete or DB delete.
- **Why it matters:** Orphaned files in storage bucket — bill grows.
- **Strength:** **Medium** — doesn't verify that storage `.remove` was actually called.
- **Improvements:** Assert `storageChain.remove` invoked with correct path.

### TC_SBP_010 — returns false when proposal not found

- **Strength:** Strong.

### TC_SBP_011 — findCloudDuplicate returns the CloudProposal when duplicate exists

- **Break:** Always return null.
- **Why it matters:** Same PDF uploaded multiple times = bloated storage costs.
- **Strength:** Strong.

### TC_SBP_012 — returns null when no duplicate found

- **Strength:** Strong.

### TC_SBP_013 — returns null on database error

- **Strength:** Strong.

### TC_SBP_014 — downloadProposalFile returns a Blob on successful download

- **Strength:** Strong.

### TC_SBP_015 — returns null on storage error

- **Strength:** Strong.

### TC_SBP_016 — checkCloudStorageAvailability returns true when accessible

- **Strength:** Strong.

### TC_SBP_017 — returns false when storage returns an error

- **Strength:** Strong.

### TC_SBP_018 — cloudProposalToStored maps all fields correctly

- **Purpose:** snake_case → camelCase pure mapper.
- **Break:** Drop one field mapping.
- **Why it matters:** UI shows missing filename / pageCount / uploadedBy.
- **Strength:** **Strong** — asserts on 10 separate fields.

### TC_SBP_019 — sets isCloudStored to true

- **Break:** Set false.
- **Why it matters:** UI cannot distinguish cloud vs local proposals.
- **Strength:** Strong.

### TC_SBP_020 — sets fileBlob to null (downloaded on-demand)

- **Strength:** Strong.

### TC_SBP_021 — initialises extractedImages and pageImages as empty arrays

- **Break:** Leave undefined.
- **Why it matters:** `.map()`/`.length` crashes downstream.
- **Strength:** Strong.

### TC_SBP_022 — parses uploadedAt as a Date from ISO string

- **Break:** Return raw string.
- **Why it matters:** `.toLocaleDateString()` crashes in UI.
- **Strength:** Strong.

---

## Regression Table — Services

| Test Case | Module | Intentional Break | Expected Failure | CI/CD Impact |
|---|---|---|---|---|
| TC_AUTH_002 | Auth | Remove `if (!isMatch) throw` | Promise resolves on wrong password | **CRITICAL — security**, block deploy |
| TC_AUTH_003 | Auth | Change `Invalid email or password` text | String mismatch | **CRITICAL — user enumeration**, block |
| TC_AUTH_004 | Auth | Remove `isActive` guard | Inactive user logs in | **CRITICAL**, block |
| TC_AUTH_022 | Auth | `isAuthenticated` always true | Routes unprotected | **CRITICAL**, block |
| TC_AUTH_024 | Auth | `hasPermission` always true | Privilege escalation | **CRITICAL**, block |
| TC_COMP_007 | Company | `saveCompanySettings` always true | Silent data loss | High, block |
| TC_SYNC_013 | Sync | Remove `auth-storage` filter in `clearAllCache` | Auth keys deleted | High, block |
| TC_GEMINI_015 | Gemini | Default placeholder API key | App silently fails to call AI | High, block |
| TC_GEMINI_024 | Gemini | Mutate price in normalization | Wrong PDF totals | **CRITICAL — financial**, block |
| TC_PDFEXP_013 | PDFExport | Swallow html2canvas error | Empty PDF, no notice | High, block |
| TC_SBP_003 | Proposals | Skip filename sanitization | Cloud upload 400 | High, block |
| TC_SBP_018 | Proposals | Drop a field in mapping | Missing data in UI | High, block |
