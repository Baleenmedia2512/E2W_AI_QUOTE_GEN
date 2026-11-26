# Next.js migration — Phase 5 (client cutover → Next API)

**Branch:** `quotebuddy_nextjs_migration`  
**Backup (do not modify):** `backup_migration_process`

## What changed

| File | Change |
|------|--------|
| `vite.config.ts` | Dev proxy `/api` → `http://localhost:3000` (Next) by default |
| `/uploads` proxy | Still → Express `:8787` (local disk fallback; prod uses MilesWeb CDN) |

**Not changed:** `authService`, `pdfExportService`, `progressiveChatEngine`, Express mounts.

## How to run (cutover)

```bash
# Terminal A — Next APIs
npm run dev:next          # :3000

# Terminal B — Vite SPA (+ optional Express for /uploads rollback)
npm run dev:web           # :5173  (or full npm run dev if you still want Express)
# Optional: keep Express for /uploads + instant rollback
npm run dev:api           # :8787
```

Restart Vite after changing `vite.config.ts` so the proxy reloads.

Open **http://localhost:5173** — browser `/api/*` calls go to Next.

### Optional absolute base (Capacitor / remote)

```env
VITE_API_BASE_URL=http://localhost:3000
```

Prefer the Vite proxy for local web; use `VITE_API_BASE_URL` when the SPA is not same-origin with the API.

## Rollback (Express)

1. Stop Vite (or set env and restart):
   ```bash
   # PowerShell
   $env:VITE_DEV_API_PROXY="http://localhost:8787"
   npm run dev:web
   ```
2. Or edit `vite.config.ts` default back to `http://localhost:8787`.
3. Ensure Express is up: `npm run dev:api`.
4. Clear `VITE_API_BASE_URL` if set.
5. Hard-refresh the browser.

Express route files were never removed — rollback is proxy-only.

## Env knobs

| Env | Default | Purpose |
|-----|---------|---------|
| `VITE_DEV_API_PROXY` | `http://localhost:3000` | Vite `/api` proxy target |
| `VITE_DEV_UPLOADS_PROXY` | `http://localhost:8787` | Vite `/uploads` proxy (local disk) |
| `VITE_API_BASE_URL` | (empty) | Absolute API base; bypasses Vite proxy when set |

## Smoke checklist

| Check | How | Expected |
|-------|-----|----------|
| Proxy hits Next | `GET http://localhost:5173/api/health` | `{ ok: true, runtime: "next", ... }` |
| Login | `POST /api/auth/session` via :5173 | `200` `{ user, token }` |
| Refresh | `POST` + Bearer `{ action: "refresh" }` | `200` `{ user, token }` |
| Rates | `GET /api/vendors/rates?preferred=1` | `200` `{ data: [...] }` |
| Company | `GET /api/company` | `200` `{ data: {...} }` |
| Media-proxy | `GET /api/media-proxy?url=<rms>` | `200` image bytes |
| PDF export | UI export with ref images | Prefetch via `/api/media-proxy` succeeds |

## Known deferred / broken on Next-only `/api`

| Endpoint | Status |
|----------|--------|
| `/api/auth/password-reset` | **Ported in Phase 1b** — see `NEXTJS_MIGRATION_PHASE_1B_PASSWORD_RESET.md` |
| Express-only static quirks | `/uploads` still on Express via separate proxy |

## Ready next

- [ ] **Phase 1b** — password-reset on Next
- [ ] **Vercel deploy** — Next hosts UI+API; MilesWeb = MySQL + files; set `DATABASE_URL`, `AUTH_SECRET`, `NEXT_PUBLIC_UPLOADS_BASE_URL`, Baleen/SMTP as needed
- [ ] Optional: stop running Express in local day-to-day once 1b + confidence
