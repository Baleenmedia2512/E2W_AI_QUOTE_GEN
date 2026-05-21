# Auth & Routing Module — Test Documentation (FULL depth)

The single most important UI test file in the suite. `PrivateRoute` is the **only** gate between unauthenticated users and the entire application.

- **Test file:** [tests/components/PrivateRoute.test.tsx](../../tests/components/PrivateRoute.test.tsx)
- **Production file:** [src/components/PrivateRoute/PrivateRoute.tsx](../../src/components/PrivateRoute/PrivateRoute.tsx)
- **Module:** Authentication & Routing
- **Business logic protected:** Authentication-gated routing, role-based access, permission-based access, redirect targets (`/login` vs `/unauthorized`).

> ⚠ **Every test here is CRITICAL-severity.** A broken `PrivateRoute` = either the whole app is unreachable OR the whole app is publicly accessible. There is no middle ground.

---

### TC_ROUTE_001 — renders the protected component when user is authenticated

- **Purpose:** Logged-in users can reach guarded routes.
- **Business logic:** `isAuthenticated === true` ⇒ render `<Route component={Component} />`.
- **Scenario:** `useAuthStore` mocked with `isAuthenticated: true`.
- **Input:** `<PrivateRoute path="/protected" component={ProtectedPage} />` inside `<MemoryRouter initialEntries={['/protected']}>`.
- **Expected result:** "Protected Content" text appears in the DOM.
- **Current assertion:** `expect(screen.getByText('Protected Content')).toBeDefined()`.
- **Intentional code break:** In `PrivateRoute.tsx`, hard-code `if (true)` for the redirect branch (always redirect).
- **Expected failed test:** `PrivateRoute › renders the protected component when user is authenticated`.
- **Failure message:** `TestingLibraryElementError: Unable to find an element with the text: Protected Content`.
- **Why failure matters:** Authenticated users **cannot reach any page** — total app outage even for paying customers.
- **CI/CD impact:** Pipeline red, PR blocked, deploy stopped. This is a Sev-1 production incident if it slipped through.
- **Manual validation steps:** (1) open `PrivateRoute.tsx` (2) force the redirect branch (3) `npm run test PrivateRoute` (4) confirm TC_ROUTE_001 red (5) `git restore`.
- **Edge cases:** authenticated + required role missing (TC_ROUTE_004), authenticated + permission missing (TC_ROUTE_006).
- **Strength:** **Strong** — verifies real DOM rendering through `MemoryRouter`, not just a function call.
- **Improvement suggestions:** Add an assertion that `Redirect` was NOT rendered (currently only positive assertion).

### TC_ROUTE_002 — redirects to /login when user is not authenticated

- **Purpose:** Unauthenticated users are pushed to login.
- **Business logic:** `!isAuthenticated` ⇒ `<Redirect to="/login" />`.
- **Assertion:** `expect(screen.queryByText('Protected Content')).toBeNull()`.
- **Intentional break:** Comment out the `!isAuthenticated` check (i.e. always allow).
- **Failure:** TC_ROUTE_002 — `expected null not to be 'Protected Content' div`.
- **Why it matters:** **CRITICAL — every page becomes public.** Anyone can view quotes, edit company info, see leads. Total auth bypass.
- **CI/CD:** **MUST BLOCK.** Security incident if shipped.
- **Manual steps:** delete the `!isAuthenticated` guard → run → red → restore.
- **Edge cases:** stale session / expired token (not covered — gap).
- **Strength:** **Strong** — assertion is negative-existence which catches the "always render" bug.
- **Improvements:** Add a positive assertion that the `<Redirect to="/login">` was actually rendered (e.g. via `MemoryRouter` location inspection). Right now nothing proves the redirect TARGET — only that the protected page didn't show.

### TC_ROUTE_003 — renders component when required role is matched

- **Purpose:** Role-gated routes admit role-matching users.
- **Business logic:** `requiredRole` prop ⇒ `useAuthStore.hasRole(requiredRole)` must be true to render.
- **Assertion:** `getByText('Protected Content')`.
- **Intentional break:** Always treat role check as failed (`hasRole` ignored).
- **Failure:** TC_ROUTE_003.
- **Why it matters:** Admin pages unreachable by admins ⇒ no one can manage the system.
- **CI/CD:** Block.
- **Strength:** Strong.

### TC_ROUTE_004 — redirects to /unauthorized when required role NOT matched

- **Purpose:** Non-matching roles get a *different* destination than `/login`.
- **Business logic:** Authenticated but wrong role ⇒ `<Redirect to="/unauthorized" />`, NOT `/login` (don't re-prompt).
- **Assertion:** `queryByText('Protected Content')` is null.
- **Intentional break:** Skip the role check entirely (always render).
- **Failure:** TC_ROUTE_004.
- **Why it matters:** **CRITICAL — privilege escalation.** A standard "user" reaches admin-only screens (delete leads, change company settings, etc.).
- **CI/CD:** **MUST BLOCK.**
- **Strength:** **Medium** — only asserts that protected page didn't render, doesn't verify `/unauthorized` is the actual destination (could be redirecting to `/login` or anywhere).
- **Improvements:** Inspect `MemoryRouter`'s history to assert `location.pathname === '/unauthorized'`.

### TC_ROUTE_005 — renders component when required permission is matched

- **Purpose:** Permission-gated routes admit users with the permission.
- **Business logic:** `requiredPermission` prop ⇒ `hasPermission(...)` must be true.
- **Intentional break:** Ignore `requiredPermission`.
- **Why it matters:** Either denies legitimate access (UX) or grants improper access (security) depending on direction of bug.
- **Strength:** Strong.

### TC_ROUTE_006 — redirects to /unauthorized when required permission NOT matched

- **Purpose:** Insufficient permissions ⇒ blocked.
- **Intentional break:** Default-allow (`hasPermission` ignored).
- **Failure:** TC_ROUTE_006.
- **Why it matters:** **CRITICAL — feature-level privilege escalation.** Users without `delete_quotes` could delete quotes; users without `edit_company` could overwrite branding on PDFs.
- **CI/CD:** **MUST BLOCK.**
- **Strength:** Medium (same redirect-target gap as TC_ROUTE_004).

### TC_ROUTE_007 — renders component when no role or permission requirement is specified

- **Purpose:** Authenticated user reaches a generic protected page (no role/permission gates).
- **Business logic:** When neither `requiredRole` nor `requiredPermission` is passed, only `isAuthenticated` is checked.
- **Intentional break:** Always require a role.
- **Failure:** TC_ROUTE_007.
- **Why it matters:** Generic protected pages (home, profile) become unreachable.
- **Strength:** Strong.

---

## Regression Table — Auth & Routing

| Test | Intentional Break | Impact |
|---|---|---|
| TC_ROUTE_001 | Always redirect | Total app outage for logged-in users |
| TC_ROUTE_002 | Skip `isAuthenticated` check | **All pages publicly accessible** — Sev-1 |
| TC_ROUTE_004 | Skip role check | Privilege escalation |
| TC_ROUTE_006 | Skip permission check | Feature-level privilege escalation |

## Known gaps in this file

1. **No assertion on redirect TARGET** — tests prove "didn't render protected page" but not "redirected to the correct page". A bug that redirects everyone to `/login` instead of `/unauthorized` would still pass TC_ROUTE_004 and TC_ROUTE_006.
2. **No test for expired session** — there is no scenario where `isAuthenticated=true` but the underlying token is stale.
3. **No test for race condition** — `useAuthStore` loading state isn't exercised; UI could flash protected content before redirect.
4. **No combined role+permission test** — both props together is untested.

These are documented for the next sprint; do not block merge but add to backlog.
