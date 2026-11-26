# Next.js migration — Phase 1b (password reset)

**Branch:** `quotebuddy_nextjs_migration`  
**Backup (do not modify):** `backup_migration_process`

## What shipped

| Next | Express (unchanged) |
|------|---------------------|
| `POST app/api/auth/password-reset/route.ts` | `server/routes/passwordReset.ts` mounted at `/api/auth/password-reset` |

Single endpoint, body `action`:

- `request_otp`
- `verify_otp`
- `reset_password`

Env (same as Express): `AUTH_SECRET` / `AUTH_SESSION_SECRET` / optional `PASSWORD_RESET_TOKEN_SECRET`, `SMTP_*`.

## curl

```bash
# Invalid email
curl -s -X POST http://localhost:3000/api/auth/password-reset \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"request_otp\",\"email\":\"not-an-email\"}"

# Unknown action
curl -s -X POST http://localhost:3000/api/auth/password-reset \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"nope\",\"email\":\"nobody@example.com\"}"

# Non-existent email (no reveal)
curl -s -X POST http://localhost:3000/api/auth/password-reset \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"request_otp\",\"email\":\"nobody-phase1b@example.com\"}"

# Via Vite proxy (cutover)
curl -s -X POST http://localhost:5173/api/auth/password-reset \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"verify_otp\",\"email\":\"a@b.co\",\"otp\":\"12\"}"
```

Compare same bodies against `http://localhost:8787/api/auth/password-reset`.

**Do not** smoke `reset_password` against real accounts in shared DB unless intentional.

## Smoke notes

- Vite → Next should **not** 404 on `/api/auth/password-reset`
- Validation / unknown-action / non-existent request_otp parity with Express
- Live OTP send requires SMTP; missing SMTP → `500` with `SMTP is not configured.` (same as Express) for real active users

## Ready — Vercel deploy checklist

- [x] Auth session on Next
- [x] Vendors / company / quotes / leads / proposals / profile / email / push-baleen
- [x] Media-proxy
- [x] Password-reset on Next
- [x] Local Vite `/api` → Next cutover
- [ ] Set Vercel env: `DATABASE_URL`, `AUTH_SECRET`, `NEXT_PUBLIC_UPLOADS_BASE_URL`, `MILESWEB_*`, `BALEEN_*`, `QUOTE_BUDDY_API_KEY`, `SMTP_*`
- [ ] Deploy Next (UI + API); MilesWeb = MySQL + files only
- [ ] Smoke login, rates, PDF images, password-reset request on preview/prod
- [ ] Keep `backup_migration_process` until production cutover is confirmed
- [ ] Optional: retire Express local process once Vercel is stable
