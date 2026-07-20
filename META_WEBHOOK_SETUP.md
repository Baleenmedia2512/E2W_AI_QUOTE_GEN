# Meta Business Messaging — Webhook Setup Guide

This document covers everything needed to connect Instagram DM, Facebook Messenger,
and WhatsApp Business Cloud API to the Quote Buddy app.

---

## Prerequisites

| Requirement | Details |
|---|---|
| Supabase project | Your existing project (URL + anon key already in `.env`) |
| Supabase CLI | [Install guide](https://supabase.com/docs/guides/cli) |
| Meta Developer Account | [developers.facebook.com](https://developers.facebook.com) |
| Meta Business App | Type: **Business** (not Consumer) |
| Public HTTPS URL | Provided by the deployed Edge Function |

---

## Step 1 — Install & Link the Supabase CLI

```bash
# Install (Windows — PowerShell)
winget install Supabase.CLI

# Authenticate
supabase login

# Link to your existing project (find the project ref in your Supabase dashboard URL)
supabase link --project-ref <your-project-ref>
```

---

## Step 2 — Set Edge Function Secrets

These secrets are stored server-side only — never in `.env` or version control.

```bash
# A random string you invent (must match what you enter in Meta Developer Console)
supabase secrets set META_WEBHOOK_VERIFY_TOKEN=<your-random-verify-token>

# From Meta App Dashboard → Settings → Basic → App Secret
supabase secrets set META_APP_SECRET=<your-meta-app-secret>

# Optional: restrict which platforms trigger notifications (default: all)
# supabase secrets set META_ENABLED_PLATFORMS="instagram,whatsapp"
```

---

## Step 3 — Deploy the Edge Function

```bash
# From the project root
supabase functions deploy meta-webhook --no-verify-jwt
```

> `--no-verify-jwt` is required because Meta's webhook calls arrive without a
> Supabase JWT. Security is provided by the `X-Hub-Signature-256` HMAC check instead.

Your public webhook URL is:
```
https://<your-project-ref>.supabase.co/functions/v1/meta-webhook
```

---

## Step 4 — Register Webhooks in Meta Developer Console

Go to [developers.facebook.com](https://developers.facebook.com) → Your App.

### WhatsApp Business Cloud

1. **WhatsApp** → **Configuration** → **Webhook**
2. Callback URL: `https://<project-ref>.supabase.co/functions/v1/meta-webhook`
3. Verify Token: (the value you set for `META_WEBHOOK_VERIFY_TOKEN`)
4. Click **Verify and Save**
5. Subscribe to the **messages** field

### Instagram Direct Messages

1. **Instagram** → **Settings** → **Webhooks**
2. Same Callback URL and Verify Token
3. Subscribe to the **messages** field

### Facebook Messenger

1. **Messenger** → **Settings** → **Webhooks**
2. Same Callback URL and Verify Token
3. Subscribe to the **messages** and **messaging_postbacks** fields

> Meta sends a `GET` request with `hub.challenge` to verify the URL. The Edge Function
> handles this automatically and responds with the challenge value.

---

## Step 5 — Configure the Frontend

Add to your `.env` file (already documented in `.env.example`):

```env
# The Realtime channel name — must match the Edge Function default or
# the META_REALTIME_CHANNEL secret if you customized it
VITE_META_REALTIME_CHANNEL=meta:notifications:v1
```

---

## Local Development with ngrok

During development you need a public URL to receive Meta's webhooks.

### Option A — ngrok (recommended)

```bash
# Install ngrok from https://ngrok.com/download
# Then expose your local Supabase Edge Function port:

# Start the Edge Function locally
supabase functions serve meta-webhook --no-verify-jwt --env-file .env.local

# In another terminal, tunnel to port 54321 (Supabase local default)
ngrok http 54321

# Your local webhook URL looks like:
# https://a1b2-203-0-113-42.ngrok-free.app/functions/v1/meta-webhook
```

1. Enter the ngrok URL as the webhook callback in Meta Developer Console
2. Set Verify Token to the same value as your local env
3. Messages sent to your test phone/page will now arrive in your local app

### Option B — Supabase local dev with `.env.local`

Create `.env.local` for local Edge Function secrets:

```env
META_WEBHOOK_VERIFY_TOKEN=local-test-token
META_APP_SECRET=                          # leave blank to skip sig validation locally
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key>
```

```bash
supabase functions serve meta-webhook --no-verify-jwt --env-file .env.local
```

---

## Verifying the Integration End-to-End

### 1. Test webhook verification

```bash
curl "https://<project-ref>.supabase.co/functions/v1/meta-webhook?\
hub.mode=subscribe&\
hub.verify_token=<YOUR_VERIFY_TOKEN>&\
hub.challenge=test_challenge_123"
# Expected response: test_challenge_123
```

### 2. Send a test webhook event

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/meta-webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "123456789",
      "changes": [{
        "field": "messages",
        "value": {
          "messaging_product": "whatsapp",
          "metadata": { "display_phone_number": "+911234567890", "phone_number_id": "99" },
          "contacts": [{ "profile": { "name": "Test User" }, "wa_id": "919876543210" }],
          "messages": [{
            "from": "919876543210",
            "id": "wamid.test001",
            "timestamp": "'$(date +%s)'",
            "text": { "body": "Hello, I need a quote!" },
            "type": "text"
          }]
        }
      }]
    }]
  }'
# Expected response: OK
# Expected result:  Chakra toast + notification sound in the running React app
```

> **Note:** The test above skips signature validation because `META_APP_SECRET`
> is not provided. In production, always configure the app secret.

---

## Security Summary

| Threat | Mitigation |
|---|---|
| Unauthorized POST to webhook | `X-Hub-Signature-256` HMAC-SHA256 validation |
| Replay attacks | Timestamp check — payloads older than 5 minutes are rejected |
| Duplicate delivery | In-memory deduplication by `message.id` (per Edge Function instance) |
| Secret exposure | Verify token and App Secret stored as Supabase secrets, never in frontend `.env` |
| Platform abuse | `META_ENABLED_PLATFORMS` allow-list to restrict active platforms |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Meta verification returns 403 | `META_WEBHOOK_VERIFY_TOKEN` mismatch | Re-check the token in Supabase secrets and Meta Console |
| Webhook POST returns 401 | `META_APP_SECRET` wrong or missing | Update the secret: `supabase secrets set META_APP_SECRET=…` |
| No toast in the app | Realtime channel name mismatch | Ensure `VITE_META_REALTIME_CHANNEL` matches the Edge Function channel |
| Toast shows but no sound | Browser autoplay policy | Click anywhere on the page first — sound requires prior user interaction |
| Edge Function logs show "broadcast failed" | `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` missing | These are auto-injected on Supabase Cloud; check local env for local dev |

---

## File Reference

| File | Purpose |
|---|---|
| `supabase/functions/meta-webhook/index.ts` | Edge Function — webhook receiver, validator, broadcaster |
| `src/types/meta.ts` | TypeScript interfaces for Meta payloads |
| `src/services/metaMessagingService.ts` | Frontend Realtime Broadcast subscriber |
| `src/hooks/useMetaNotifications.ts` | React hook — sound + Chakra UI toast |
| `src/App.tsx` | Mounts `useMetaNotifications()` globally |
| `public/sounds/notification.mp3` | Optional custom chime (synthesized fallback used if absent) |
| `.env.example` | Documents all required environment variables |
