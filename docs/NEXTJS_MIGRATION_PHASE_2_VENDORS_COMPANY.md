# Next.js migration — Phase 2 (Vendors + Company)

**Branch:** `quotebuddy_nextjs_migration`  
**Backup (do not modify):** `backup_migration_process`

## What shipped

| Next | Express (unchanged) |
|------|---------------------|
| `app/api/vendors/route.ts` `GET` | `server/routes/vendors.ts` `GET /` |
| `app/api/vendors/rates/route.ts` `GET` | `server/routes/vendors.ts` `GET /rates` |
| `app/api/company/route.ts` `GET` + `PUT` | `server/routes/company.ts` |
| `lib/httpAuth.ts` | thin Next Bearer helper |

Express mounts in `server/index.ts` remain. Client still uses Vite → Express.

## Auth parity

| Endpoint | Auth |
|----------|------|
| `GET /api/vendors` | Bearer required → `401 { error: "Unauthorized" }` |
| `GET /api/vendors/rates` | **No auth** (same as Express) |
| `GET /api/company` | **No auth** |
| `PUT /api/company` | Bearer required → `401 { error: "Unauthorized" }` |

## Rates `preferred`

- Default / `preferred=1` → `preferred_vendor_rank: 1`; if empty, fallback to all rows
- `preferred=0` → all `vendor_rate_chunks`

## Deferred / not in these Express files

- No other vendor sub-routes existed (no POST/PUT vendors)
- Phase 1b password-reset still deferred
- Leads, quotes, proposals, profile, media-proxy, Baleen — later phases

## curl (Next :3000)

```bash
# Rates (no auth)
curl -s "http://localhost:3000/api/vendors/rates?preferred=1" | head
curl -s "http://localhost:3000/api/vendors/rates?preferred=0" | head

# Vendors list (auth)
curl -s http://localhost:3000/api/vendors \
  -H "Authorization: Bearer YOUR_TOKEN"

# Company get (no auth)
curl -s http://localhost:3000/api/company

# Company put (auth) — avoid in prod smoke unless intentional
curl -s -X PUT http://localhost:3000/api/company \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Test Co\"}"
```

Compare to Express on `:8787` with the same paths.

## Phase 3 ready (Progressive chat) — or Phase 1b

**Prefer Phase 3 only when product asks** — progressive chat is client-heavy (`src/utils/progressiveChatEngine.ts` + chat modules); API surface may be thinner. Checklist:

- [ ] Decide whether chat stays client-only vs needs Next API routes
- [ ] Do **not** change funnel rules (`progressive-chat-funnel.mdc`) unless product asks
- [ ] Keep Express/Vite chat path until cutover
- [ ] Leave `backup_migration_process` alone

**Phase 1b password-reset** (if preferred next): port `server/routes/passwordReset.ts` + SMTP env — still out of scope until asked.
