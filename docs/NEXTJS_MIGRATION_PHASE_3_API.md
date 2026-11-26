# Next.js migration — Phase 3-API (remaining Express APIs)

**Branch:** `quotebuddy_nextjs_migration`  
**Backup (do not modify):** `backup_migration_process`

## Inventory

| Express path | Next path | Auth? | Verified |
|--------------|-----------|-------|----------|
| `GET /api/health` | `app/api/health` | no | Phase 0 |
| `POST /api/auth/session` | `app/api/auth/session` | n/a | Phase 1 |
| `GET /api/vendors` | `app/api/vendors` | Bearer | Phase 2 |
| `GET /api/vendors/rates` | `app/api/vendors/rates` | no | Phase 2 |
| `GET/PUT /api/company` | `app/api/company` | PUT Bearer | Phase 2 |
| `GET /api/quotes/numbers/max` | `app/api/quotes/numbers/max` | no | Phase 3 |
| `GET /api/quotes/numbers/issued` | `app/api/quotes/numbers/issued` | no | Phase 3 |
| `POST /api/quotes/downloads` | `app/api/quotes/downloads` | no | validation parity; skip create smoke |
| `POST /api/quotes/push-baleen` | `app/api/quotes/push-baleen` | Bearer | 401 + config/payload parity |
| `POST /api/quotes/email` | `app/api/quotes/email` | Bearer | 401 (+ 400 no attachments) |
| `GET /api/leads` | `app/api/leads` | no | Phase 3 |
| `GET /api/leads/search` | `app/api/leads/search` | no | Phase 3 |
| `GET /api/leads/:id` | `app/api/leads/[id]` | no | Phase 3 |
| `POST /api/leads/prepared-for` | `app/api/leads/prepared-for` | optional | 400 validation; skip create |
| `GET /api/proposals` | `app/api/proposals` | no | Phase 3 |
| `POST /api/proposals` | `app/api/proposals` | optional Bearer | deferred write smoke |
| `DELETE /api/proposals/:id` | `app/api/proposals/[id]` | no | 404 unknown id |
| `GET/POST /api/proposals/chunks` | `app/api/proposals/chunks` | no | GET + POST 400 empty |
| `POST /api/proposals/images` | `app/api/proposals/images` | no | 400 no file |
| `GET/PUT /api/profile/me` | `app/api/profile/me` | Bearer | GET parity; PUT 401 |
| `POST /api/profile/me/image` | `app/api/profile/me/image` | Bearer | 401 |

### Explicitly deferred

| Path | Reason |
|------|--------|
| `/api/auth/password-reset/*` | Phase 1b (SMTP/OTP) |
| `/api/media-proxy` | PDF / media phase |
| `GET /uploads/*` static | MilesWeb/local uploads serve — PDF/uploads phase |

## Shared libs added

- `lib/uploads.ts` — mirror of `server/lib/uploads.ts`
- `lib/quoteNumbers.ts` — QT- seq helpers

## curl examples (Next :3000)

```bash
curl -s http://localhost:3000/api/quotes/numbers/max
curl -s "http://localhost:3000/api/quotes/numbers/issued?quoteNumber=QT-10001"
curl -s http://localhost:3000/api/leads?limit=5
curl -s "http://localhost:3000/api/leads/search?q=te"
curl -s http://localhost:3000/api/proposals?limit=5
curl -s http://localhost:3000/api/proposals/chunks
curl -s http://localhost:3000/api/profile/me -H "Authorization: Bearer TOKEN"
curl -s -X POST http://localhost:3000/api/quotes/push-baleen \
  -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d "{}"
curl -s -X POST http://localhost:3000/api/quotes/email \
  -H "Content-Type: application/json" -d "{}"
```

## Next phase options

1. **PDF / media-proxy** — port `media-proxy` + static `/uploads` story for Vercel  
2. **Phase 1b password-reset**  
3. **Client cutover** — Vite proxy / `VITE_API_BASE_URL` → Next (do not until asked)
