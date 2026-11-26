# Next.js migration — Phase 4 (media-proxy + uploads story)

**Branch:** `quotebuddy_nextjs_migration`  
**Backup (do not modify):** `backup_migration_process`

## What shipped

| Path | Role |
|------|------|
| `app/api/media-proxy/route.ts` | 1:1 port of `server/routes/mediaProxy.ts` |
| Express `server/routes/mediaProxy.ts` | **unchanged** (still mounted) |
| Express `GET /uploads` static | **unchanged** (`uploadsRoot()`) |

`pdfExportService` was **not** rewritten. It already calls same-origin:

```ts
`/api/media-proxy?url=${encodeURIComponent(url)}`
```

Today Vite proxies `/api` → Express `:8787`. After client cutover (proxy → Next `:3000` / Vercel), the **same relative URL** hits Next media-proxy — no client change required for the proxy path.

## Allowlist (identical)

`rms.baleenmedia.com`, `baleenmedia.com`, `baleenmedia.in`, `wellnessvalley.in` (+ www), `wkwrrdcjknvupwsfdjtd.supabase.co`

## Uploads story (product intent)

| Environment | How files are served |
|-------------|----------------------|
| **Production (Cost Manager style)** | MilesWeb public CDN via `NEXT_PUBLIC_UPLOADS_BASE_URL` (e.g. `https://rms.baleenmedia.com` or `https://baleenmedia.in/costmanager`). Uploads go through `MILESWEB_UPLOAD_*` bridge (`lib/uploads.ts` / `server/lib/uploads.ts`). |
| **Local Express fallback** | `GET /uploads/*` from `public_html/uploads` when MilesWeb bridge is unset (`UPLOAD_ROOT` optional). |
| **Next / Vercel** | **Do not rely on local disk `/uploads` on the serverless host.** Production quote/PDF images should already be absolute MilesWeb/RMS URLs (see `resolveMediaUrl.ts`). Relative `/uploads/...` strings are rewritten client-side onto `NEXT_PUBLIC_UPLOADS_BASE_URL`. |

**Vercel implication:** Next does **not** need to mount Express-style static `/uploads` for production PDF. Media-proxy covers CORS for allowlisted remote hosts; public CDN covers asset URLs.

## pdfExportService after cutover

1. Keep `viaMediaProxy` as `/api/media-proxy?url=…` (same-origin to whatever hosts the SPA).
2. Point Vite proxy or deploy so `/api/*` is Next (Vercel).
3. Prefetch: direct fetch → on CORS failure → media-proxy (unchanged logic).
4. Ensure `NEXT_PUBLIC_UPLOADS_BASE_URL` is set in Vercel (same value as today).

## curl verify

```bash
# Missing url → 400
curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/media-proxy"
curl -s -o /dev/null -w "%{http_code}" "http://localhost:8787/api/media-proxy"

# Disallowed host → 403
curl -s "http://localhost:3000/api/media-proxy?url=https://example.com/a.png"
curl -s "http://localhost:8787/api/media-proxy?url=https://example.com/a.png"

# Allowed host (replace with a real rms image URL)
curl -s -D - -o /tmp/nx.bin "http://localhost:3000/api/media-proxy?url=ENCODED_URL"
curl -s -D - -o /tmp/ex.bin "http://localhost:8787/api/media-proxy?url=ENCODED_URL"
# Compare status, Content-Type, and byte length / hashes
```

## Deferred still

- Phase 1b password-reset
- Client cutover (Vite proxy / `VITE_API_BASE_URL`)
- Mounting Next static `/uploads` (not required for prod MilesWeb intent)

## Ready checklist — next

**Phase 1b password-reset** or **client cutover**:

- [x] Next media-proxy parity
- [ ] Decide: password-reset API next, or point SPA `/api` at Next
- [ ] Cutover: update Vite proxy target / env; smoke login + PDF export + rates
- [ ] Leave `backup_migration_process` alone until cutover is explicit
