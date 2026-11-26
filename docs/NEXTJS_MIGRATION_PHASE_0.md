# Next.js migration — Phase 0 (foundation only)

**Branch:** `quotebuddy_nextjs_migration`  
**Backup (do not modify):** `backup_migration_process`

## Goal

Additive scaffolding for a Cost Manager–style deploy later:

- **Vercel** → UI + API (Next.js App Router)
- **MilesWeb** → MySQL + file uploads only
- **Prisma + `DATABASE_URL`** remain the source of truth

Phase 0 does **not** change product behavior. Vite + Express stay the active runtime.

## Dual structure (safe / additive)

| Path | Role |
|------|------|
| `src/`, `index.html`, `vite.config.ts` | Current Vite SPA (unchanged) |
| `server/` | Current Express API (unchanged) |
| `app/` | Next.js App Router (Phase 0 scaffold) |
| `lib/prisma.ts` | Next Prisma client (mirrors `server/lib/prisma.ts`) |
| `prisma/schema.prisma` | Shared schema |

No Vite/Express deletion until an explicit cutover decision.

## Required env

Copy `.env.example` → `.env`. Minimum for Phase 0:

```bash
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/DATABASE
AUTH_SECRET=change-me
```

Other names kept for later phases: `NEXT_PUBLIC_UPLOADS_BASE_URL`, `MILESWEB_UPLOAD_*`, `BALEEN_MEDIA_URL`, `QUOTE_BUDDY_API_KEY`, `SMTP_*`.

## How to run Phase 0

```bash
npm install
npm run prisma:generate
npm run dev:next
```

- App: http://localhost:3000  
- Health: http://localhost:3000/api/health → `{ "ok": true, ... }`

Existing product (unchanged):

```bash
npm run dev          # Vite :5173 + Express :8787
npm run prisma:generate
```

## Verify

```bash
npm run prisma:generate
npm run dev:next
# then:
curl http://localhost:3000/api/health
```

Acceptance:

- [x] `next dev` starts
- [x] `GET /api/health` returns 200 with `ok: true`
- [x] `prisma generate` works with `DATABASE_URL`
- [x] `progressiveChatEngine` / funnel logic untouched
- [x] `backup_migration_process` unchanged

## Phase 1 — Auth files / routes to port

Port these **without** changing login semantics. Prefer Next Route Handlers under `app/api/auth/`.

### Express routes

| Current | Next target (planned) |
|---------|------------------------|
| `server/routes/auth.ts` → `POST /api/auth/session` (login + refresh) | `app/api/auth/session/route.ts` |
| `server/routes/passwordReset.ts` → `/api/auth/password-reset/*` | `app/api/auth/password-reset/...` (Phase 1 or 1b) |

Mounted today in `server/index.ts`:

- `app.use('/api/auth', authRoutes)`
- `app.use('/api/auth/password-reset', passwordResetRoutes)`

### Session / user libs

| File | Responsibility |
|------|----------------|
| `server/lib/session.ts` | HMAC session token create/verify, Bearer parse (`AUTH_SECRET` / `AUTH_SESSION_SECRET`) |
| `server/lib/authUser.ts` | `buildAuthUser(userId)` via Prisma `user` + `role` |
| `server/lib/prisma.ts` | Express Prisma singleton — reuse `lib/prisma.ts` on Next or re-export |

### Client (wire later; do not rewrite behavior in Phase 1 server port)

| File | Notes |
|------|-------|
| `src/services/authService.ts` | Calls `POST /api/auth/session` |
| `src/store/authStore.ts` | Session state |
| `src/types/auth.ts` | Auth types |
| Login UI under `src/pages/` / components | Out of scope until UI cutover |

### Env used by auth

- `AUTH_SECRET` / `AUTH_SESSION_SECRET`
- `DATABASE_URL`
- Password reset also: `PASSWORD_RESET_TOKEN_SECRET` (optional), `SMTP_*`, `INTERNAL_QUOTE_EMAIL_*`

## Out of scope until later phases

Auth UI wiring, vendor rates, progressive chat, quote wizard, PDF / media-proxy, Baleen push, SMTP product flows, Capacitor/mobile.
