# Next.js migration — Phase 6 (Vercel deploy checklist)

**Branch:** `quotebuddy_nextjs_migration`  
**Backup (do not modify):** `backup_migration_process`

## Architecture (Cost Manager style)

| Host | Role |
|------|------|
| **Vercel** | Next.js App Router — **API** (+ UI when UI is on Next) |
| **MilesWeb** | MySQL (`DATABASE_URL`) + public file CDN / upload bridge |
| **Express** | Local rollback only — not required on Vercel |

Local today: Vite `:5173` UI → Next `:3000` API (Phase 5). Express `:8787` remains for rollback.

### Important: UI status

- **Next APIs are ready** (auth, vendors, company, quotes, leads, proposals, profile, email, push-baleen, media-proxy, password-reset).
- **Full Quote Buddy UI still lives under Vite** (`src/`). `app/page.tsx` is a Phase 0 scaffold, not the Ionic/chat app.
- **Preferred prod:** same-origin Next UI+API on Vercel (requires a later **UI port** into `app/` — out of Phase 6).
- **Not preferred:** Vite on one host + Next API on another (`VITE_API_BASE_URL=https://…`).
- **Phase 6** prepares Vercel **Next** project settings so `/api/*` works; do not expect full product UI from Next until UI cutover.

## Build scripts (do not confuse)

| Script | Purpose |
|--------|---------|
| `npm run build` | **Vite** SPA (`tsc && vite build`) — Capacitor / Android / legacy static |
| `npm run build:next` | Next only |
| `npm run build:vercel` | `prisma generate && next build` — same as Vercel |

**Default `build` was left as Vite** so Capacitor/mobile is not broken.  
Vercel must **not** use `npm run build`; it must use Next (see below).

Legacy SPA rewrite config archived at [`docs/vercel.spa.legacy.json`](./vercel.spa.legacy.json).  
Root [`vercel.json`](../vercel.json) now targets Next (no `/(.*)` → `index.html`).

## Vercel project settings

Dashboard → Project **quotebuddy** (existing `.vercel/project.json`) → Settings:

| Setting | Value |
|---------|--------|
| Framework Preset | **Next.js** |
| Root Directory | `.` (repo root) |
| Build Command | `npx prisma generate && npm run build:next` *(or leave to `vercel.json`)* |
| Install Command | `npm install` |
| Output Directory | *(leave empty — Next handles it)* |
| Node.js | 20.x recommended |

```bash
# CLI (from repo root, branch quotebuddy_nextjs_migration)
npx vercel          # preview
npx vercel --prod   # production (only when ready)
```

Local build check (Express may lock Prisma DLL on Windows — stop `npm run dev:api` first):

```bash
npm run build:vercel
# or: npm run build:next
```

**Verified locally:** `npm run build:next` succeeds and lists all `/api/*` routes.

### Next vs Vite `src/pages` conflict

Vite UI components live in `src/pages/`. Next would treat that as the Pages Router and break the build.  
Root empty [`pages/`](../pages/README.md) makes Next ignore `src/pages` and use root `app/` only (no Vite rename).

## Environment variables

Set the **same** keys on **Production** and **Preview** (unless you intentionally use a staging DB).  
**Never commit real secrets.**

| Variable | Required | Pattern / notes |
|----------|----------|-----------------|
| `DATABASE_URL` | **Yes** | `mysql://USER:PASSWORD@HOST:3306/DATABASE` (MilesWeb MySQL) |
| `AUTH_SECRET` | **Yes** | Long random string (session HMAC) |
| `AUTH_SESSION_SECRET` | Optional | Fallback if `AUTH_SECRET` unset; prefer setting `AUTH_SECRET` |
| `PASSWORD_RESET_TOKEN_SECRET` | Optional | Falls back to `AUTH_SECRET` |
| `NEXT_PUBLIC_UPLOADS_BASE_URL` | **Yes** | Prefer `https://rms.baleenmedia.com` (or Cost Manager CDN base you use in prod) |
| `MILESWEB_UPLOAD_URL` | **Yes** (uploads) | e.g. `https://…/upload.php` |
| `MILESWEB_UPLOAD_SECRET` | **Yes** (uploads) | Shared with Cost Manager upload.php |
| `BALEEN_MEDIA_URL` | If Baleen push | Origin **without** trailing slash; **no** `/.app` — e.g. `https://host` not `https://host/.app` |
| `QUOTE_BUDDY_API_KEY` | If Baleen push | Bearer to Baleen inbox |
| `SMTP_HOST` | If email / password-reset OTP | |
| `SMTP_PORT` | Optional | Default `587` |
| `SMTP_USER` | If SMTP | |
| `SMTP_PASSWORD` | If SMTP | |
| `SMTP_FROM` | Optional | Defaults to `SMTP_USER` |
| `SMTP_SECURE` | Optional | `true` / `false` |
| `INTERNAL_QUOTE_EMAIL_1` | Optional | Quote email allowlist + `canSendQuoteEmail` |
| `INTERNAL_QUOTE_EMAIL_2` | Optional | |
| `INTERNAL_QUOTE_EMAIL_3` | Optional | |
| `INTERNAL_QUOTE_CC_EMAIL` | Optional | CC on quote email |
| `VITE_API_BASE_URL` | **No** on same-origin Next UI | Only if SPA is hosted separately |
| `VITE_GEMINI_API_KEY` | Client AI | Needed when Vite UI (or Next public env later) calls Gemini from browser |
| `API_PORT` / `UPLOAD_ROOT` | No on Vercel | Express/local only |

### Same-origin note

Once UI is served by the same Next deployment as `/api`:

- Browser uses relative `/api/...` (already how `apiClient` / `pdfExportService` work with empty `VITE_API_BASE_URL`).
- Do **not** set `VITE_API_BASE_URL` on Vercel for that setup.

## Deploy steps

1. Merge/push `quotebuddy_nextjs_migration` (or deploy from that branch).
2. Confirm `vercel.json` is Next (no SPA catch-all).
3. Set all **Required** env vars in Vercel → Environment Variables (Production + Preview).
4. Deploy Preview: `npx vercel` or Git integration on the branch.
5. Run smoke checklist below on the preview URL.
6. Only then promote Production (`npx vercel --prod` or promote in dashboard).

## Smoke checklist (Preview URL = `https://<preview>.vercel.app`)

| Check | Command / action | Expected |
|-------|------------------|----------|
| Health | `GET /api/health` | `200` `{ "ok": true, "runtime": "next", ... }` |
| Login | `POST /api/auth/session` `{ email, password }` | `200` `{ user, token }` |
| Rates | `GET /api/vendors/rates?preferred=1` | `200` `{ data: [...] }` |
| Media-proxy | `GET /api/media-proxy?url=<encoded rms https url>` | `200` image bytes |
| Password-reset | `POST /api/auth/password-reset` `{ "action":"nope","email":"a@b.co" }` | `400` `{ success:false, message:"Unknown action." }` **not 404** |
| UI (until UI port) | Open `/` | Scaffold page OK; full chat UI still local Vite |

```bash
# Replace PREVIEW with your deployment URL
PREVIEW=https://your-preview.vercel.app

curl -s "$PREVIEW/api/health"
curl -s -X POST "$PREVIEW/api/auth/session" -H "Content-Type: application/json" \
  -d "{\"email\":\"YOUR_EMAIL\",\"password\":\"YOUR_PASSWORD\"}"
curl -s "$PREVIEW/api/vendors/rates?preferred=1" | head -c 200
curl -s -X POST "$PREVIEW/api/auth/password-reset" -H "Content-Type: application/json" \
  -d "{\"action\":\"nope\",\"email\":\"a@b.co\"}"
```

## Rollback

| Layer | Action |
|-------|--------|
| **Git** | Stay on / redeploy from `backup_migration_process` if needed; do not modify that branch casually |
| **Vercel** | Dashboard → Deployments → Promote previous successful deployment |
| **Local** | `VITE_DEV_API_PROXY=http://localhost:8787` + `npm run dev:api` (Phase 5) |
| **vercel.json** | Emergency SPA static only: restore contents from `docs/vercel.spa.legacy.json` (breaks Next `/api`) |

## Ready after Phase 6

- [ ] Preview smoke green
- [ ] Prod env vars set
- [ ] Decide UI port timeline (Vite `src/` → Next `app/`) for true same-origin product
- [ ] Capacitor: keep using `npm run build` (Vite) until mobile targets Next
- [ ] Keep Express for local rollback until prod stable
