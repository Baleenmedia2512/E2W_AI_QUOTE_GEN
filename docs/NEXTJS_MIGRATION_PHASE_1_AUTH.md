# Next.js migration — Phase 1 (Auth)

**Branch:** `quotebuddy_nextjs_migration`  
**Backup (do not modify):** `backup_migration_process`

## What shipped

Additive Next Route Handler with **identical** contract to Express `POST /api/auth/session`.

| Next | Express (unchanged) |
|------|---------------------|
| `lib/session.ts` | `server/lib/session.ts` |
| `lib/authUser.ts` | `server/lib/authUser.ts` |
| `lib/prisma.ts` | `server/lib/prisma.ts` |
| `app/api/auth/session/route.ts` | `server/routes/auth.ts` |

Express mounts in `server/index.ts` are **not** removed. Client `authService` / `authStore` still hit Vite → Express (`:8787`) via proxy.

Libs are carefully duplicated (same logic) so Express cannot regress. Later cutover can re-export Express from `lib/*`.

## Env

```bash
DATABASE_URL=mysql://...
AUTH_SECRET=...          # or AUTH_SESSION_SECRET
```

## Verify

```bash
npm run dev          # Express :8787 + Vite :5173
npm run dev:next     # Next :3000
```

### Invalid password (both must return 401 + same message)

```bash
curl -s -X POST http://localhost:8787/api/auth/session \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"nobody@example.com\",\"password\":\"wrong\"}"

curl -s -X POST http://localhost:3000/api/auth/session \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"nobody@example.com\",\"password\":\"wrong\"}"
```

Expected: `{"error":"Invalid email or password"}` status 401.

### Login (valid credentials)

```bash
curl -s -X POST http://localhost:3000/api/auth/session \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"YOUR_EMAIL\",\"password\":\"YOUR_PASSWORD\"}"
```

Expected: `200` `{ "user": { ... }, "token": "..." }`

### Refresh

```bash
curl -s -X POST http://localhost:3000/api/auth/session \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d "{\"action\":\"refresh\"}"
```

Expected: `200` `{ "user": { ... }, "token": "..." }`

### Missing AUTH_SECRET

Same class as Express: outer `catch` → `401` `{ "error": "Invalid email or password" }` when token create throws after a successful credential check. `authSecret()` still throws `AUTH_SECRET is not configured.` internally (logged as Auth session error).

## Phase 1b — password reset (deferred)

`server/routes/passwordReset.ts` is **not** thin (OTP, SMTP, rate limits, reset tokens). Port in Phase 1b:

- `server/routes/passwordReset.ts` → `app/api/auth/password-reset/...`
- Env: `SMTP_*`, optional `PASSWORD_RESET_TOKEN_SECRET`, `AUTH_SECRET`

## Client cutover later (do not switch yet)

When ready to point the SPA at Next auth (or Vercel):

1. Keep JSON contract (`user` + `token`, refresh `{ action: "refresh" }` + Bearer).
2. Options:
   - Dev: Vite proxy `/api` → `:3000` instead of `:8787`, **or**
   - `VITE_API_BASE_URL=http://localhost:3000` for Capacitor/remote.
3. Files to touch then (not now): `src/services/authService.ts`, `src/services/apiClient.ts`, optionally `vite.config.ts` proxy.
4. Express auth can remain as fallback until production cutover.

## Phase 2 ready checklist (vendor rates / company)

- [ ] Phase 1 auth parity verified (login + refresh + 401)
- [ ] Decide: keep dual Express/Next APIs or proxy SPA → Next only for `/api/auth`
- [ ] Port `server/routes/vendors.ts` → `app/api/vendors/...`
- [ ] Port `server/routes/company.ts` → `app/api/company/...`
- [ ] Reuse `lib/prisma.ts` + session Bearer checks where Express uses them
- [ ] Do not touch progressive chat / quote math / PDF / Baleen in Phase 2
- [ ] Leave `backup_migration_process` untouched
