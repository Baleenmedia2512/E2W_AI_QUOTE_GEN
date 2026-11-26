# Next.js migration — Phase 7 (full UI on Next)

**Branch:** `quotebuddy_nextjs_migration`  
**Backup (do not modify):** `backup_migration_process`

## Strategy

Host the **existing Vite SPA** (`src/App.tsx` + react-router) inside Next via an optional catch-all, so progressive chat / quote / PDF code paths are unchanged.

| Vite react-router path | Next |
|------------------------|------|
| `/` (chat) | `app/page.tsx` → `SpaHost` → `QuoteBuddyApp` → `App` |
| `/login`, `/unauthorized`, `/documents`, `/quote`, `/review`, `/preview` | `app/[...slug]/page.tsx` → same SPA host |
| `/api/*` | Existing App Router handlers (unchanged) |

**Not rewritten:** `progressiveChatEngine`, quote math, PDF algorithms, Baleen payload builders.  
**Auth:** existing `authStore` + `PrivateRoute` + `/api/auth/session`.

## How to run (UI on :3000 — no Vite required)

```bash
npm run prisma:generate   # if needed
npm run dev:next          # http://localhost:3000
# Optional rollback APIs: npm run dev:api (:8787) — not needed if Next APIs used
```

Open **http://localhost:3000/login** (or `/`). Relative `/api/*` hits the same Next origin.

Vite `:5173` remains available for rollback (`npm run dev:web`) until you retire it.

## Key files

| File | Role |
|------|------|
| `app/page.tsx` + `app/[...slug]/page.tsx` | SPA host routes |
| `app/SpaHost.tsx` | `dynamic(..., { ssr: false })` → `QuoteBuddyApp` |
| `app/providers.tsx` | ChakraProvider |
| `src/QuoteBuddyApp.tsx` | SPA bootstrap (AI monitor + `App`) |
| `next.config.ts` | `import.meta.env` DefinePlugin + `?url` assets |
| `pages/` | Empty stub so Next ignores Vite `src/pages` |

## Smoke checklist (:3000)

| Step | Expected |
|------|----------|
| `GET /api/health` | `{ ok: true, runtime: "next" }` |
| `/login` → valid credentials | Lands on chat `/` |
| Chat: rates / simple service (e.g. bus) | Funnel chips / quote path as before |
| Quote wizard → review → preview → PDF | Download works; ref images via `/api/media-proxy` |
| `POST /api/auth/password-reset` unknown action | `400` not `404` |
| Hard refresh `/documents`, `/quote` | SPA remounts correct route |

```bash
npm run build:next
npm run start:next   # optional production-mode local check
```

## Rollback

- UI: use Vite again (`npm run dev:web` + proxy to Next or Express)
- APIs: `VITE_DEV_API_PROXY=http://localhost:8787`
- Git: `backup_migration_process` untouched

## Next after Phase 7

- Preview/prod Vercel deploy with UI+API same-origin
- Optional later: true App Router pages (drop react-router) — not required for Cost Manager deploy
- Capacitor still uses Vite `npm run build` until mobile cutover
