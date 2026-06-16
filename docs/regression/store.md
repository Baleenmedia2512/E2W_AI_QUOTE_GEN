# Store Module — Test Documentation (FULL depth)

Covers the two Zustand stores that hold all application state.

| File | Tests | ID range |
|---|---|---|
| [useAppStore](#useappstore) | 38 | TC_APPSTORE_001 – TC_APPSTORE_038 |
| [useAuthStore](#useauthstore) | 33 | TC_AUTHSTORE_001 – TC_AUTHSTORE_033 |

---

## useAppStore

- **Test file:** [tests/store/appStore.test.ts](../../tests/store/appStore.test.ts)
- **Production file:** [src/store/index.ts](../../src/store/index.ts)
- **Business logic protected:** chat history, quote state, company state, client info, template selection, proposal library (load/save/delete), cloud-storage check.

### TC_APPSTORE_001 — adds a single message

- **Purpose:** `addMessage` appends to chat history.
- **Break:** Mutate state in-place without `set()`.
- **Why it matters:** Chat UI never updates — Zustand subscribers don't fire.
- **Strength:** Strong.

### TC_APPSTORE_002 — preserves message order across multiple addMessage calls

- **Break:** Prepend instead of append.
- **Why it matters:** Conversation reads backward → unusable chat.
- **Strength:** Strong.

### TC_APPSTORE_003 — clearMessages resets history to []

- **Break:** Set to `null`.
- **Why it matters:** `messages.map(...)` crashes.
- **Strength:** Strong.

### TC_APPSTORE_004 — setCurrentQuote stores the quote

- **Strength:** Strong.

### TC_APPSTORE_005 — clearCurrentQuote sets it to null

- **Strength:** Strong.

### TC_APPSTORE_006 — setIsGenerating toggles boolean flag

- **Purpose:** Loading spinner shows during AI calls.
- **Break:** Always set false.
- **Why it matters:** UI never shows loading state → user double-submits.
- **Strength:** Strong.

### TC_APPSTORE_007 — setMatchType updates the match-type tag

- **Break:** Ignore the argument.
- **Why it matters:** Quote preview shows wrong banner ("exact" vs "partial").
- **Strength:** Strong.

### TC_APPSTORE_008 — setAlternatives stores suggestions array

- **Break:** Set to empty.
- **Why it matters:** "Did you mean" suggestions never displayed.
- **Strength:** Strong.

### TC_APPSTORE_009 — setCompanyInfo replaces company in state

- **Break:** Merge instead of replace.
- **Why it matters:** Stale fields linger after company edit — wrong header on PDF.
- **Strength:** Strong.

### TC_APPSTORE_010 — updateCompanyInfo merges partial changes

- **Break:** Replace instead of merge.
- **Why it matters:** Single-field edit wipes all other company fields.
- **Strength:** Strong.

### TC_APPSTORE_011 — loadCompanyInfo calls companyService.getCompanySettings

- **Assertion:** Spy on service.
- **Break:** Call a different service.
- **Why it matters:** Company settings load from wrong source.
- **Strength:** Strong.

### TC_APPSTORE_012 — loadCompanyInfo falls back to defaultCompany on null

- **Break:** Leave state undefined.
- **Why it matters:** First-install crash (no companyInfo for forms).
- **Strength:** Strong.

### TC_APPSTORE_013 — saveCompanyInfo persists via companyService

- **Strength:** Strong.

### TC_APPSTORE_014 — loadRecentProposals reads from cloud when available

- **Break:** Always read local.
- **Why it matters:** Cloud-stored proposals never appear in library.
- **Strength:** Strong.

### TC_APPSTORE_015 — loadRecentProposals with local data: returns from localStorage when cloud unavailable

- **Break:** Return empty array.
- **Why it matters:** Offline users see empty library.
- **Strength:** Strong.

### TC_APPSTORE_016 — sorts proposals by `uploadedAt` desc

- **Break:** Sort asc.
- **Why it matters:** Oldest proposals appear first — unusable.
- **Strength:** Strong.

### TC_APPSTORE_017 — handles empty localStorage gracefully

- **Strength:** Strong.

### TC_APPSTORE_018 — setProposal stores a single proposal

- **Strength:** Strong.

### TC_APPSTORE_019 — setProposal appends extractedTexts to history

- **Break:** Overwrite instead of append.
- **Why it matters:** Multi-PDF workflows lose first PDFs from context.
- **Strength:** Strong.

### TC_APPSTORE_020 — setProposal triggers cloud upload when cloudAvailable

- **Break:** Skip upload.
- **Why it matters:** Local-only — cross-device sync broken.
- **Strength:** Strong.

### TC_APPSTORE_021 — setProposal stores locally when cloud unavailable

- **Strength:** Strong.

### TC_APPSTORE_022 — resetProposal clears current proposal

- **Strength:** Strong.

### TC_APPSTORE_023 — resetProposal clears extractedTexts

- **Strength:** Strong.

### TC_APPSTORE_024 — resetProposal preserves chat history (does NOT clear messages)

- **Break:** Also clear messages.
- **Why it matters:** User loses chat context every time they upload a new PDF.
- **Strength:** **Strong** — locks the invariant.

### TC_APPSTORE_025 — setClientInfo stores client object

- **Strength:** Strong.

### TC_APPSTORE_026 — updateClientInfo merges partial fields

- **Strength:** Strong.

### TC_APPSTORE_027 — clearClientInfo resets to null

- **Strength:** Strong.

### TC_APPSTORE_028 — clearClientInfo is no-op when already null

- **Strength:** Medium.

### TC_APPSTORE_029 — setSelectedTemplate persists chosen template

- **Strength:** Strong.

### TC_APPSTORE_030 — setSelectedTemplate accepts null (deselect)

- **Strength:** Strong.

### TC_APPSTORE_031 — default selectedTemplate is null

- **Strength:** Medium (initial-state tautology).

### TC_APPSTORE_032 — selectedTemplate survives setProposal call

- **Break:** Reset template inside setProposal.
- **Why it matters:** User's template choice silently lost when uploading new PDF.
- **Strength:** Strong.

### TC_APPSTORE_033 — checkCloudStorage sets cloudAvailable=true when service returns true

- **Strength:** Strong.

### TC_APPSTORE_034 — checkCloudStorage sets cloudAvailable=false when service returns false

- **Strength:** Strong.

### TC_APPSTORE_035 — checkCloudStorage sets false on exception

- **Strength:** Strong.

### TC_APPSTORE_036 — deleteProposalFromLibrary removes by id from local list

- **Break:** Mutate by reference.
- **Why it matters:** UI doesn't re-render on delete.
- **Strength:** Strong.

### TC_APPSTORE_037 — deleteProposalFromLibrary calls cloud delete when proposal isCloudStored

- **Break:** Skip cloud delete.
- **Why it matters:** Storage bucket bill grows; ghost proposals reappear on next cloud load.
- **Strength:** Strong.

### TC_APPSTORE_038 — deleteProposalFromLibrary tolerates cloud delete failure (still removes local)

- **Purpose:** Resilient delete UX.
- **Strength:** Strong.

---

## useAuthStore

- **Test file:** [tests/store/authStore.test.ts](../../tests/store/authStore.test.ts)
- **Production file:** [src/store/authStore.ts](../../src/store/authStore.ts)
- **Business logic protected:** login flow, logout, in-memory user, role/permission helpers, initAuth from localStorage.

### TC_AUTHSTORE_001 — initial user is null

- **Strength:** Medium (initial state tautology).

### TC_AUTHSTORE_002 — initial isAuthenticated is false

- **Strength:** Medium.

### TC_AUTHSTORE_003 — initial isLoading is false

- **Strength:** Medium.

### TC_AUTHSTORE_004 — initial error is null

- **Strength:** Medium.

### TC_AUTHSTORE_005 — login sets isAuthenticated=true and user on success

- **Break:** Leave state untouched after successful authService.login.
- **Why it matters:** Login looks like it worked, but user redirected back to /login (router checks isAuthenticated).
- **Strength:** Strong.

### TC_AUTHSTORE_006 — login calls authService.saveUser after success

- **Break:** Skip the call.
- **Why it matters:** Session not persisted ⇒ logged out on refresh.
- **Strength:** Strong.

### TC_AUTHSTORE_007 — login sets error and rethrows on wrong password

- **Break:** Swallow the error.
- **Why it matters:** Form never shows error message ⇒ user keeps clicking.
- **Strength:** Strong (asserts on `state.error` value).

### TC_AUTHSTORE_008 — login sets fallback "Login failed" when error has no message

- **Strength:** Strong.

### TC_AUTHSTORE_009 — login resets error to null before each attempt

- **Break:** Keep stale error.
- **Why it matters:** User sees ghost error from previous attempt while next attempt is in flight.
- **Strength:** Strong.

### TC_AUTHSTORE_010 — logout sets user=null

- **Strength:** Strong.

### TC_AUTHSTORE_011 — logout sets isAuthenticated=false

- **Strength:** Strong.

### TC_AUTHSTORE_012 — logout clears error

- **Strength:** Strong.

### TC_AUTHSTORE_013 — logout calls authService.logout

- **Break:** Skip the call.
- **Why it matters:** localStorage not cleared ⇒ next visitor on shared device is logged in as previous user.
- **Strength:** **CRITICAL** — block deploy.

### TC_AUTHSTORE_014 — setUser(user) sets isAuthenticated=true

- **Strength:** Strong.

### TC_AUTHSTORE_015 — setUser(null) sets isAuthenticated=false

- **Strength:** Strong.

### TC_AUTHSTORE_016 — setUser(user) calls authService.saveUser

- **Strength:** Strong.

### TC_AUTHSTORE_017 — setUser(null) does NOT call authService.saveUser

- **Purpose:** Prevent persisting `null` into localStorage.
- **Strength:** Strong.

### TC_AUTHSTORE_018 — clearError sets error to null

- **Strength:** Strong.

### TC_AUTHSTORE_019 — clearError is no-op when error already null

- **Strength:** Medium.

### TC_AUTHSTORE_020 — checkAuth returns false when not authenticated

- **Strength:** Strong.

### TC_AUTHSTORE_021 — checkAuth returns true after successful login

- **Strength:** Strong.

### TC_AUTHSTORE_022 — hasRole returns true when user has the role

- **Strength:** Strong.

### TC_AUTHSTORE_023 — hasRole is case-insensitive

- **Break:** Use `===` comparison.
- **Why it matters:** `admin`/`Admin` divergence between DB and code locks out users.
- **Strength:** Strong.

### TC_AUTHSTORE_024 — hasRole returns false when role differs

- **Strength:** Strong.

### TC_AUTHSTORE_025 — hasRole returns false when no user

- **Strength:** Strong.

### TC_AUTHSTORE_026 — hasPermission returns true when permission=true

- **Strength:** Strong.

### TC_AUTHSTORE_027 — hasPermission returns false when permission=false

- **Break:** Return true for any defined key.
- **Why it matters:** Privilege escalation.
- **Strength:** **CRITICAL**.

### TC_AUTHSTORE_028 — hasPermission returns false for unknown key

- **Purpose:** Default-deny.
- **Strength:** Strong.

### TC_AUTHSTORE_029 — hasPermission returns false when no user

- **Strength:** Strong.

### TC_AUTHSTORE_030 — getUserRole returns null when not logged in

- **Strength:** Strong.

### TC_AUTHSTORE_031 — getUserRole returns role name when logged in

- **Strength:** Strong.

### TC_AUTHSTORE_032 — initAuth hydrates state from localStorage when user present

- **Break:** Skip the hydration.
- **Why it matters:** Logged-in users see /login on every page reload.
- **Strength:** Strong.

### TC_AUTHSTORE_033 — initAuth leaves state unchanged when no user in localStorage

- **Strength:** Strong.

---

## Regression Table — Stores

| Test Case | Intentional Break | Failure | CI/CD Impact |
|---|---|---|---|
| TC_APPSTORE_010 | replace instead of merge in `updateCompanyInfo` | TC_APPSTORE_010 red | High — silent data loss |
| TC_APPSTORE_024 | clear messages inside `resetProposal` | TC_APPSTORE_024 red | Medium — UX regression |
| TC_APPSTORE_037 | skip cloud delete in `deleteProposalFromLibrary` | TC_APPSTORE_037 red | High — orphaned cloud files |
| TC_AUTHSTORE_013 | skip authService.logout in store logout | TC_AUTHSTORE_013 red | **CRITICAL — session not cleared**, block |
| TC_AUTHSTORE_023 | use `===` in role check | TC_AUTHSTORE_023 red | High — users locked out |
| TC_AUTHSTORE_027 | return true for any defined permission | TC_AUTHSTORE_027 red | **CRITICAL — privilege escalation**, block |
| TC_AUTHSTORE_028 | default-allow unknown key | TC_AUTHSTORE_028 red | **CRITICAL**, block |
| TC_AUTHSTORE_032 | skip initAuth hydration | TC_AUTHSTORE_032 red | High — UX broken, looks like auth is broken |
