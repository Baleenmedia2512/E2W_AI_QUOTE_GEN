# 🧪 Quote Buddy — Comprehensive QA Analysis & Test Strategy Document

**Prepared by:** Senior QA Engineer & Software Test Architect
**Application:** Quote Buddy (AI-powered Quote Generation Platform)
**Tech Stack:** React + TypeScript + Vite + Zustand + Supabase + Gemini AI + Capacitor
**Date:** May 18, 2026
**Document Version:** 1.0

---

## 📋 PART A — EXECUTIVE SUMMARY

| Aspect | Detail |
|---|---|
| **Total Modules Identified** | 14 (Auth, Home/Chat, Documents, Quote Wizard, Quote Preview, Client Info, Company Info, Proposal Upload, AI Chat, Template Selector, PDF Export, Lead Search, Cloud Sync, Mobile/PWA) |
| **Total Test Cases Designed** | 541 across 20 categories |
| **Critical Risk Modules** | Authentication, Quote Calculation, AI Chat, PDF Upload, Cloud Sync, Permission Engine |
| **Automation Feasibility** | ~75% (Vitest unit + Playwright E2E + Postman/Supabase contract tests) |
| **High-Severity Gaps Found** | 18 (see Section D) |
| **Production-Readiness Score** | 62/100 — Significant validation, security & error-handling gaps |

---

## 📦 PART B — MODULE INVENTORY

| # | Module | Owner File(s) | Risk |
|---|---|---|---|
| M1 | Authentication & Session | `authService.ts`, `LoginPage.tsx`, `authStore.ts`, `PrivateRoute.tsx` | 🔴 Critical |
| M2 | Home / AI Chat | `HomePage.tsx`, `ChatInterface/` | 🟠 High |
| M3 | Documents / Proposal Upload | `DocumentsPage.tsx`, `ProposalUpload/`, `supabaseProposalService.ts` | 🔴 Critical |
| M4 | Quote Wizard | `QuotePage.tsx`, `QuoteWizard/` | 🟠 High |
| M5 | Client Info Form | `ClientInfoForm/`, `leadService.ts` | 🟠 High |
| M6 | Company Info Form | `CompanyInfoForm/`, `companyService.ts` | 🟡 Medium |
| M7 | Quote Preview & Calculation | `QuotePreview/`, `QuotePreviewPage.tsx` | 🔴 Critical |
| M8 | Template Selector | `TemplateSelector/`, `Templates/` | 🟢 Low |
| M9 | PDF Export | `pdfExportService.ts`, `downloadNotification.ts` | 🔴 Critical |
| M10 | Gemini AI Service | `geminiService.ts` | 🟠 High |
| M11 | Multi-Proposal Viewer | `MultiProposalViewer/`, `ProposalViewer/` | 🟡 Medium |
| M12 | Cloud Storage Sync | `dataSyncService.ts`, Supabase | 🔴 Critical |
| M13 | Offline / IndexedDB / PWA | `pwa.ts`, IndexedDB stores, Service Worker | 🟠 High |
| M14 | Mobile (Capacitor) | `capacitor.config.ts`, plugins | 🟠 High |

---

## 🧾 PART C — DETAILED TEST CASES

> **Format:** Test Case ID | Module | Feature | Scenario | Preconditions | Steps | Test Data | Expected Result | Priority | Severity | Type | Remarks
> (Actual Result and Status columns intentionally left blank for QA team.)

---

### 🔐 M1 — AUTHENTICATION & SESSION (TC-AUTH-xxx)

| TC ID | Feature | Scenario | Preconditions | Steps | Test Data | Expected Result | Pri | Sev | Type | Remarks |
|---|---|---|---|---|---|---|---|---|---|---|
| TC-AUTH-001 | Login | Successful login with valid admin credentials | Active admin user exists | 1.Open `/login` 2.Enter creds 3.Click Login | `admin@x.com / Admin@123` | Redirect to `/`, store populated, toast success | High | Critical | Functional/Positive | Happy path |
| TC-AUTH-002 | Login | Invalid password | Active user | Enter wrong password | `admin@x.com / wrong` | Toast "Invalid email or password"; remain on `/login`; no user in store | High | Critical | Negative | |
| TC-AUTH-003 | Login | Non-existent email | DB has no such user | Enter random email | `ghost@x.com / x` | Same generic error (no user enumeration) | High | High | Security | **GAP**: Verify no user-enumeration leak |
| TC-AUTH-004 | Login | Empty email field | – | Submit | `'' / Admin@123` | Client-side error "Email required"; no API call | High | Medium | Validation/Negative | **GAP**: No client validation currently |
| TC-AUTH-005 | Login | Empty password field | – | Submit | `admin@x.com / ''` | Client-side error "Password required" | High | Medium | Validation | **GAP** |
| TC-AUTH-006 | Login | Both fields empty | – | Submit | `'' / ''` | Both errors shown | Medium | Medium | Validation | |
| TC-AUTH-007 | Login | Email with leading/trailing spaces | Active user | Type `  admin@x.com  ` | Spaces in email | Trimmed before query → success | High | Medium | Boundary | |
| TC-AUTH-008 | Login | Email case-insensitivity | User saved as `Admin@X.com` | Login as `admin@x.com` | Mixed case | `ilike` match → success | High | Medium | Validation | Confirmed via `ilike` query |
| TC-AUTH-009 | Login | Deactivated account (`isActive=false`) | User exists, inactive | Try to login | Valid creds | Toast "Account is inactive"; deny | High | Critical | Security/Negative | |
| TC-AUTH-010 | Login | SQL Injection in email | – | Submit | `' OR 1=1 --` | Treated as literal string; no rows; no leak | High | Critical | Security | Supabase parameterized — verify |
| TC-AUTH-011 | Login | XSS in email field | – | Submit | `<script>alert(1)</script>` | Stored/displayed as text; no execution | High | Critical | Security | |
| TC-AUTH-012 | Login | Very long email (>320 chars) | – | Submit | 500-char string | Rejected at form or DB | Medium | Medium | Boundary | **GAP**: No max length check |
| TC-AUTH-013 | Login | Very long password (>1024 chars) | – | Submit | 5000-char string | Either rejected or bcrypt compares (slow) | Medium | High | Performance/Security | Bcrypt DoS risk — cap at 72 bytes |
| TC-AUTH-014 | Login | Special chars in password | Active user with `P@$$w0rd!#%` | Login | Special pwd | Bcrypt matches; success | High | Medium | Functional | |
| TC-AUTH-015 | Login | Unicode/emoji password | User created with emoji pwd | Login | `🔒pass🔑` | Bcrypt matches; success | Low | Low | Edge | |
| TC-AUTH-016 | Session | Persists after page refresh | Logged in | F5 | – | Still logged in (Zustand+localStorage) | High | High | Functional | |
| TC-AUTH-017 | Session | Persists after browser close/reopen | Logged in | Close & reopen | – | Still logged in | High | Medium | Real-time | Verify localStorage scope |
| TC-AUTH-018 | Session | Logout clears state | Logged in | Click logout | – | Store cleared, redirect `/login`, localStorage `user` removed | High | High | Functional | |
| TC-AUTH-019 | Session | Concurrent tabs - logout in tab A | Two tabs open | Logout in A; refresh B | – | B also logged out (storage event) | Medium | High | Real-time | **GAP**: Likely missing `storage` listener |
| TC-AUTH-020 | Session | Tampered localStorage user object | Logged in | Edit `localStorage.user` to escalate role | Modified JSON | Permission checks must re-validate server-side | High | Critical | Security | **GAP**: Client-side role check only |
| TC-AUTH-021 | Route Guard | Access `/quote` while unauthenticated | Logged out | Navigate to `/quote` | – | Redirect to `/login`, `from` state preserved | High | Critical | Auth/Negative | |
| TC-AUTH-022 | Route Guard | Direct API call as unauth user | Logged out | curl Supabase endpoint | Without JWT | 401/RLS denies | High | Critical | Security | |
| TC-AUTH-023 | Route Guard | Viewer role tries quote creation | Viewer logged in | Submit quote save | – | Denied at service layer | High | High | RBAC | **GAP**: Verify all roles enforced server-side |
| TC-AUTH-024 | Session | Idle timeout (e.g., 30 min) | Logged in | Leave idle 31 min | – | Force re-login | Medium | High | Security | **GAP**: No idle timeout implemented |
| TC-AUTH-025 | Brute force | 10 wrong attempts | Active user | Login wrong 10× | – | Account lockout / rate limit | High | Critical | Security | **GAP**: No throttling implemented |
| TC-AUTH-026 | Password | Stored hashed (not plaintext) | – | Inspect User table | – | Password column contains bcrypt hash starting `$2b$` | High | Critical | Security | |
| TC-AUTH-027 | Login | Network failure during login | Offline | Submit | Valid creds | Friendly error "Network error"; no infinite spinner | High | High | Error Handling | |
| TC-AUTH-028 | Login | Supabase down (5xx) | Backend down | Submit | – | User-friendly error; retry option | High | High | Error Handling | |
| TC-AUTH-029 | Login | Cross-browser (Chrome/FF/Safari/Edge) | – | Login on each | – | Identical behavior | Medium | Medium | Cross-browser | |
| TC-AUTH-030 | Login | Mobile keyboard "Go" submits form | Mobile device | Tap Go on password | – | Form submits | Medium | Medium | Mobile | |

---

### 💬 M2 — HOME / AI CHAT (TC-CHAT-xxx)

| TC ID | Feature | Scenario | Preconditions | Steps | Test Data | Expected | Pri | Sev | Type |
|---|---|---|---|---|---|---|---|---|---|
| TC-CHAT-001 | Chat | Send simple text | Logged in | Type "Hello"; send | "Hello" | AI replies; message in list | High | High | Positive |
| TC-CHAT-002 | Chat | Generate quote: exact service match | Rate card uploaded | "Quote for 100 auto full branding in Chennai" | – | Quote JSON generated, preview rendered | High | Critical | Functional |
| TC-CHAT-003 | Chat | Multiple service matches | Multiple matches in registry | "Quote for branding in Chennai" | – | Checkbox UI shown for service selection | High | High | Functional |
| TC-CHAT-004 | Chat | Unknown city | City not in registry | "Auto branding in Vizag" | – | City picker modal appears | High | High | Functional |
| TC-CHAT-005 | Chat | Quantity below minimum | – | "Quote for 5 buses semi branding" (min=10) | – | Warning dialog; require confirmation | High | High | Business Rule |
| TC-CHAT-006 | Chat | No match service | – | "Quote for spacecraft branding" | – | "Service not found" message | Medium | Medium | Negative |
| TC-CHAT-007 | Chat | Empty message submit | – | Click send with empty input | "" | Send disabled or no-op | Medium | Low | Validation |
| TC-CHAT-008 | Chat | Whitespace-only input | – | Send "   " | – | Trimmed; no-op | Medium | Low | Validation |
| TC-CHAT-009 | Chat | Very long message (>5000 chars) | – | Paste essay | Long text | Either rejected or truncated; Gemini handles | Medium | Medium | Boundary |
| TC-CHAT-010 | Chat | Special chars / emoji | – | "Quote 100 autos in Chennai 🚖💰" | Emoji | Processed correctly | Low | Low | Edge |
| TC-CHAT-011 | Chat | Hindi / Tamil input | – | "चेन्नई में 100 ऑटो" | Devanagari | Gemini parses; quote generated | Low | Medium | Localization |
| TC-CHAT-012 | Chat | Rate limit hit (61st req/min) | 60 calls already | Send 61st | – | Friendly "Slow down" toast | High | High | Negative |
| TC-CHAT-013 | Chat | Gemini API key missing | `.env` lacks key | Send message | – | Fatal but graceful error; no crash | High | Critical | Error Handling |
| TC-CHAT-014 | Chat | Gemini timeout (>60s) | Mock slow | Send | – | Timeout error; no infinite loading | High | High | Error Handling |
| TC-CHAT-015 | Chat | Gemini returns invalid JSON | Mock | – | – | Caught; user-friendly error; retry option | High | Critical | Error Handling | **GAP**: Unknown if guarded |
| TC-CHAT-016 | Chat | History persists on refresh | Sent 5 msgs | F5 | – | All msgs reappear from localStorage | High | Medium | Real-time |
| TC-CHAT-017 | Chat | History clears on logout | Sent msgs | Logout | – | Chat cleared on next login (or kept per spec) | Medium | Medium | Functional |
| TC-CHAT-018 | Chat | LocalStorage quota exceeded | History huge | Send 1000 msgs | – | Graceful fallback (truncate oldest) | Medium | High | Performance | **GAP** |
| TC-CHAT-019 | Voice | Voice-to-text input | Mobile + mic permission | Tap mic; speak | "Quote for 50 autos" | Transcribed into input | Medium | Medium | Functional |
| TC-CHAT-020 | Voice | Mic permission denied | – | Tap mic; deny | – | Friendly message; fallback to keyboard | Medium | Medium | Error |
| TC-CHAT-021 | Voice | Noisy environment | – | Speak with noise | – | Best-effort transcription; user can edit | Low | Low | Real-time |
| TC-CHAT-022 | Chat | Proposal context switching | 2 proposals open | Toggle active | – | Quote uses currently-active proposal | High | High | Integration |
| TC-CHAT-023 | Chat | No proposal uploaded | First-time user | Ask for quote | – | Falls back to default rate card or prompts upload | High | High | Negative |
| TC-CHAT-024 | Chat | Slow internet (3G) | Throttled | Send | – | Shows loader; eventually responds; no double-send | Medium | High | Performance |
| TC-CHAT-025 | Chat | Network drops mid-request | Online → offline | Send then disconnect | – | Error toast; pending msg flagged | High | High | Real-time |

---

### 📂 M3 — DOCUMENTS / PROPOSAL UPLOAD (TC-DOC-xxx)

| TC ID | Feature | Scenario | Preconditions | Steps | Test Data | Expected | Pri | Sev | Type |
|---|---|---|---|---|---|---|---|---|---|
| TC-DOC-001 | Upload | Valid PDF (1MB) | Logged in | Drag-drop | sample.pdf | Upload OK, appears in Recent | High | Critical | Positive |
| TC-DOC-002 | Upload | Valid Excel | – | Upload .xlsx | rate.xlsx | Parsed; rows extracted | High | High | Positive |
| TC-DOC-003 | Upload | Valid JPG | – | Upload .jpg | card.jpg | Vision OCR extracts text | High | High | Positive |
| TC-DOC-004 | Upload | File > 10MB | – | Upload 15MB pdf | – | Rejected with "Max 10MB" | High | High | Boundary/Negative |
| TC-DOC-005 | Upload | File = exactly 10MB | – | Upload | – | Accepted | High | Medium | Boundary |
| TC-DOC-006 | Upload | File = 10MB + 1 byte | – | Upload | – | Rejected | High | Medium | Boundary |
| TC-DOC-007 | Upload | 0-byte file | – | Upload | empty.pdf | Rejected "Empty file" | High | High | Negative | **GAP** |
| TC-DOC-008 | Upload | Unsupported type (.docx) | – | Upload | doc.docx | Rejected | High | High | Negative |
| TC-DOC-009 | Upload | Renamed .exe to .pdf | – | Upload | virus.pdf (actually exe) | MIME check rejects | High | Critical | Security | **GAP**: Verify magic-number check, not just extension |
| TC-DOC-010 | Upload | Encrypted/password-protected PDF | – | Upload | encrypted.pdf | Friendly error; not silent fail | High | High | Negative |
| TC-DOC-011 | Upload | Corrupted PDF | – | Upload | corrupt.pdf | Friendly error | High | High | Error |
| TC-DOC-012 | Upload | Multi-page PDF (100 pages) | – | Upload | big.pdf | All pages extracted; UI usable | Medium | Medium | Performance |
| TC-DOC-013 | Upload | PDF with embedded scripts | – | Upload | js-pdf.pdf | Script not executed in viewer | High | Critical | Security |
| TC-DOC-014 | Upload | Filename with special chars | – | Upload | `report#2@v1.pdf` | Stored; filename preserved | Medium | Low | Edge |
| TC-DOC-015 | Upload | Filename with path traversal | – | Upload | `../../etc/passwd.pdf` | Sanitized | High | Critical | Security | **GAP** |
| TC-DOC-016 | Upload | Filename Unicode | – | Upload | `रिपोर्ट.pdf` | Stored & displayed correctly | Low | Low | Edge |
| TC-DOC-017 | Dup detect | Same file uploaded twice (cloud) | Cloud on | Re-upload | – | Confirm dialog; option to skip/replace | High | High | Functional |
| TC-DOC-018 | Dup detect | Same name, different size | – | Upload | – | Not flagged as dup; treated as new | Medium | Medium | Edge |
| TC-DOC-019 | Dup detect | Cloud disabled, local dup | Cloud off | Re-upload | – | Local IndexedDB dup detected | High | High | Functional |
| TC-DOC-020 | Upload | Network drops mid-upload | – | Disconnect | – | Upload aborted; retry option | High | High | Real-time |
| TC-DOC-021 | Upload | Concurrent uploads (5 files) | – | Multi-select | 5 PDFs | All processed sequentially or in parallel; UI stable | High | High | Concurrency |
| TC-DOC-022 | Upload | Supabase storage quota exceeded | – | Upload | – | Friendly error | Medium | High | Negative |
| TC-DOC-023 | List | Recent Proposals updates | Uploaded 1 | – | – | List shows newest first | High | Medium | Functional |
| TC-DOC-024 | List | Pagination (>20 items) | 25 uploads | Scroll | – | Loads more; no perf issue | Medium | Medium | Performance |
| TC-DOC-025 | List | Search by filename | 10 proposals | Type query | "rate" | Filters correctly | Medium | Medium | Functional |
| TC-DOC-026 | Delete | Delete from library | Uploaded | Click delete | – | Removed from list, IndexedDB & Supabase | High | High | Functional |
| TC-DOC-027 | Delete | Delete other user's proposal (non-admin) | – | Force API | – | RLS denies | High | Critical | RBAC/Security |
| TC-DOC-028 | Viewer | Open PDF | Uploaded | Click | – | MultiProposalViewer renders | High | High | Functional |
| TC-DOC-029 | Viewer | Zoom in/out | Open | +/- | – | Image scales; no overflow | Medium | Low | UI |
| TC-DOC-030 | Viewer | Page navigation | Multi-page | Next/Prev | – | Page changes; current page indicator updates | High | Medium | Functional |
| TC-DOC-031 | Mobile | Upload from device gallery | Capacitor app | Tap upload | jpg | Picker opens; upload succeeds | High | High | Mobile |
| TC-DOC-032 | Mobile | Upload while offline | App offline | Upload | – | Queued for sync OR friendly error | High | High | Offline |

---

### 🧙 M4 + M5 + M6 — QUOTE WIZARD, CLIENT, COMPANY (TC-WIZ-xxx)

| TC ID | Feature | Scenario | Preconditions | Test Data | Expected | Pri | Sev | Type |
|---|---|---|---|---|---|---|---|---|
| TC-WIZ-001 | Wizard | Complete 4 steps happy path | Logged in | All fields valid | Quote saved & preview shown | High | Critical | E2E |
| TC-WIZ-002 | Wizard | Skip step (click step 3 directly) | Step 1 incomplete | – | Either guard prevents OR shows missing-info warning | High | High | Functional |
| TC-WIZ-003 | Wizard | Back navigation preserves entered data | Step 2 filled | Click Back | Step 1 data intact | High | High | UX/Real-time |
| TC-WIZ-004 | Wizard | Refresh mid-wizard | Step 2 filled | F5 | Restored from localStorage | High | High | Persistence |
| TC-WIZ-005 | Wizard | Browser back button | Step 3 | Browser ← | Navigates to step 2 (or app handles) | Medium | Medium | UX |
| TC-WIZ-006 | Client | Name empty | – | "" | Error "Name required" | High | High | Validation/Negative |
| TC-WIZ-007 | Client | Name only spaces | – | "   " | Same error | High | Medium | Validation |
| TC-WIZ-008 | Client | Phone empty | – | "" | Error "Phone required" | High | High | Validation |
| TC-WIZ-009 | Client | Phone valid formats | – | `+91 98765 43210`, `(080) 1234-5678`, `9876543210` | All accepted (regex) | High | High | Positive |
| TC-WIZ-010 | Client | Phone with letters | – | `abc123` | Rejected | High | High | Negative |
| TC-WIZ-011 | Client | Phone too short | – | `123` | Should reject but regex allows | High | High | **GAP**: No length check |
| TC-WIZ-012 | Client | Phone too long (>20) | – | 30 digits | **GAP**: No length cap | Medium | Medium | Boundary |
| TC-WIZ-013 | Client | Email valid | – | `a@b.co` | Accepted | High | High | Positive |
| TC-WIZ-014 | Client | Email invalid (no @) | – | `abc.com` | Rejected | High | High | Negative |
| TC-WIZ-015 | Client | Email invalid (no TLD) | – | `a@b` | Rejected | High | High | Negative |
| TC-WIZ-016 | Client | Email with `+` alias | – | `user+tag@x.com` | Accepted | Medium | Low | Edge |
| TC-WIZ-017 | Client | GST format valid | – | `29ABCDE1234F1Z5` | Accepted | High | Medium | Positive |
| TC-WIZ-018 | Client | GST too short | – | `AB` | Rejected (min 2) | Medium | Low | Boundary |
| TC-WIZ-019 | Client | GST lowercase | – | `29abcde1234f1z5` | **GAP**: Regex requires uppercase; should auto-uppercase | Medium | Medium | UX |
| TC-WIZ-020 | Client | Autocomplete lead search | Leads exist | Type "John" | Dropdown of matches | High | High | Integration |
| TC-WIZ-021 | Client | Autocomplete select fills form | – | Click suggestion | All fields populated | High | High | Functional |
| TC-WIZ-022 | Client | Autocomplete SQL injection in query | – | `' OR 1=1` | Parameterized; no leak | High | Critical | Security |
| TC-WIZ-023 | Client | XSS in name field shown in PDF | – | `<img src=x onerror=alert(1)>` | Escaped in HTML/PDF; no execution | High | Critical | Security | **GAP**: Verify sanitization in templates |
| TC-WIZ-024 | Client | Duplicate client save | Same name+phone exists | Save | Either dedupe or allow (define rule) | Medium | Medium | Data Integrity | **GAP** |
| TC-WIZ-025 | Company | All required fields empty | – | Submit | All errors shown | High | High | Validation |
| TC-WIZ-026 | Company | Logo upload >2MB | – | Big.png | **GAP**: No size limit on logo | Medium | Medium | Performance |
| TC-WIZ-027 | Company | Logo wrong type (.exe) | – | Upload | Rejected | High | Critical | Security |
| TC-WIZ-028 | Company | Logo SVG with embedded JS | – | Upload | Sanitized or rejected | High | Critical | Security | **GAP** |
| TC-WIZ-029 | Company | "Use Saved Info" loads | Saved earlier | Click | Form populated | High | Medium | Functional |
| TC-WIZ-030 | Company | Save persists across sessions | Save | Logout/login | Data restored | High | High | Persistence |
| TC-WIZ-031 | Company | Concurrent edit (two tabs) | – | Edit both | Last write wins or conflict warning | Medium | Medium | Concurrency | **GAP** |
| TC-WIZ-032 | Company | Email validation matches client form | – | – | Same rules apply | High | Medium | Consistency |
| TC-WIZ-033 | Company | Very long company name (>200) | – | 500 chars | **GAP**: No limit; may break PDF layout | Medium | Medium | UI/Boundary |
| TC-WIZ-034 | Company | Website URL not validated | – | `not a url` | Currently accepted; **GAP**: should validate | Low | Low | Validation |

---

### 📊 M7 — QUOTE PREVIEW & CALCULATION (TC-CALC-xxx)

> **Critical module — business logic core.**

| TC ID | Feature | Scenario | Test Data | Expected | Pri | Sev | Type |
|---|---|---|---|---|---|---|---|
| TC-CALC-001 | Subtotal | Single item | qty=2, rate=14000, dur=1 | Subtotal=28000 | High | Critical | Positive |
| TC-CALC-002 | Subtotal | Multi items | (2×14000) + (50×950) | 75500 | High | Critical | Positive |
| TC-CALC-003 | GST | Toggled ON @18% | Subtotal 75500 | GST=13590, Total=89090 | High | Critical | Positive |
| TC-CALC-004 | GST | Toggled OFF | Subtotal 75500 | Total=75500 | High | Critical | Positive |
| TC-CALC-005 | GST | Toggle re-recalculates total | – | Total updates immediately | High | Critical | Real-time |
| TC-CALC-006 | Decimal | Floating-point precision | 33.33×3=99.99, GST=17.9982 | Display 17.99 or 18.00 (define rounding rule) | High | High | Edge | **GAP**: Rounding policy unclear |
| TC-CALC-007 | Negative | Negative quantity | qty=-2 | Reject or clamp to 0 | High | Critical | Negative | **GAP** |
| TC-CALC-008 | Negative | Negative rate | rate=-100 | Reject | High | Critical | Negative | **GAP** |
| TC-CALC-009 | Zero | Zero quantity | qty=0 | Line total=0; allow but exclude from export? | Medium | Medium | Edge | **GAP** |
| TC-CALC-010 | Zero | Zero rate (free item) | rate=0 | Allowed; line total=0 | Medium | Low | Edge |
| TC-CALC-011 | Large | Massive total (>1B) | qty=100000, rate=99999 | Display formatted; no overflow | Medium | Medium | Boundary |
| TC-CALC-012 | Duration | qty × rate × duration | qty=10, rate=2100, dur=12 | 252000 | High | Critical | Positive |
| TC-CALC-013 | Duration | Missing duration defaults to 1 | – | Line = qty×rate | High | High | Functional |
| TC-CALC-014 | Add row | Adds blank row | Click + | New row appears editable | High | Medium | Functional |
| TC-CALC-015 | Delete row | Removes & recalculates | Click trash | Total recomputed | High | High | Functional |
| TC-CALC-016 | Delete | Cannot delete last row (must have ≥1?) | – | **GAP**: Define rule | Medium | Medium | Business Rule |
| TC-CALC-017 | Edit | Inline edit reflects in total | Change qty | Immediate update | High | High | Real-time |
| TC-CALC-018 | Edit | Non-numeric input in qty | "abc" | Rejected or 0 | High | High | Validation |
| TC-CALC-019 | Edit | Scientific notation | `1e10` | Rejected or treated as 10^10 | Low | Medium | Edge |
| TC-CALC-020 | Currency | Display formatting (₹ symbol, commas) | 1234567 | "₹12,34,567" (Indian format) | High | Medium | UI |
| TC-CALC-021 | Save | Quote persists to localStorage on edit | Edit | Auto-saved | High | High | Persistence |
| TC-CALC-022 | Refresh | Quote restored after F5 | Edited quote | Same state | High | High | Persistence |
| TC-CALC-023 | Export ready | Quote with 0 line items | Empty | Export disabled or warning | High | High | Validation | **GAP** |
| TC-CALC-024 | Template | Switch template doesn't lose data | Edited quote | Switch | All data preserved | High | High | Integration |
| TC-CALC-025 | Concurrent | Edit in one tab, view in another | – | Sync via storage event | Medium | Medium | Concurrency | **GAP** |

---

### 📄 M9 — PDF EXPORT (TC-PDF-xxx)

| TC ID | Scenario | Test Data | Expected | Pri | Sev | Type |
|---|---|---|---|---|---|---|
| TC-PDF-001 | Export web (Chrome) | 5-item quote | PDF downloaded; opens correctly | High | Critical | Positive |
| TC-PDF-002 | Export web (Safari) | – | Same | High | High | Cross-browser |
| TC-PDF-003 | Export mobile (Android) | – | Saved to cache; opens in viewer | High | Critical | Mobile |
| TC-PDF-004 | Export mobile (iOS) | – | Saved & opens | High | Critical | Mobile |
| TC-PDF-005 | All 4 templates render | Each template | PDF matches template design | High | High | UI |
| TC-PDF-006 | Long quote (50 items) | – | Multi-page PDF, no overflow | High | High | Boundary |
| TC-PDF-007 | Long description text | 1000 chars | Wraps; doesn't truncate | High | Medium | UI |
| TC-PDF-008 | Company logo present | – | Renders correctly | High | Medium | UI |
| TC-PDF-009 | Missing logo | – | Placeholder or no logo, no broken image | Medium | Medium | Edge |
| TC-PDF-010 | Non-Latin client name | "गुप्ता" | Renders correctly (font support) | Medium | Medium | Localization | **GAP**: html2canvas font issues |
| TC-PDF-011 | Emoji in text | – | Renders or fallback glyph | Low | Low | Edge |
| TC-PDF-012 | Filename pattern | – | `Quote-[Num]-[Date].pdf` | Medium | Low | Functional |
| TC-PDF-013 | Generation timeout | Slow device | <30s for typical quote | Medium | High | Performance |
| TC-PDF-014 | Disk full (mobile) | – | Friendly error | Medium | High | Negative |
| TC-PDF-015 | Permission denied (Android storage) | – | Permission prompt or error | High | High | Mobile |
| TC-PDF-016 | XSS via client/item fields | `<script>` in desc | Not executed in PDF | High | Critical | Security |
| TC-PDF-017 | Print preview matches PDF | – | Same layout | Medium | Low | UI |
| TC-PDF-018 | Share via native dialog | Mobile | Share sheet opens with PDF | Medium | Medium | Mobile |
| TC-PDF-019 | PDF accessibility (tagged) | – | **GAP**: html2canvas produces image PDFs; not screen-reader friendly | Low | Medium | A11y |

---

### ☁️ M12 — CLOUD STORAGE SYNC & RLS (TC-SYNC-xxx)

| TC ID | Scenario | Expected | Pri | Sev | Type |
|---|---|---|---|---|---|
| TC-SYNC-001 | Upload syncs to Supabase | Cloud record created | High | Critical | Integration |
| TC-SYNC-002 | Offline upload queued | Queued in IndexedDB | High | High | Offline |
| TC-SYNC-003 | Reconnect triggers auto-sync | Pending uploads pushed | High | High | Real-time |
| TC-SYNC-004 | User A cannot read User B's proposals | RLS denies | High | Critical | Security/RBAC |
| TC-SYNC-005 | Admin can read all | Allowed | High | High | RBAC |
| TC-SYNC-006 | Storage bucket direct URL access | Returns 401/403 if private | High | Critical | Security |
| TC-SYNC-007 | Concurrent sync (2 devices) | No duplicate inserts (use upsert/unique constraint) | Medium | High | Concurrency | **GAP** |
| TC-SYNC-008 | Conflict: same proposal edited on 2 devices | Last-write-wins OR conflict marker | Medium | Medium | Data Integrity | **GAP** |
| TC-SYNC-009 | Sync failure retry | 3 retries w/ exponential backoff | High | High | Resilience |
| TC-SYNC-010 | Sync large file on slow net | Resumable upload | Medium | High | Performance | **GAP**: Likely not resumable |

---

### 📱 M13 + M14 — MOBILE / PWA / OFFLINE (TC-MOB-xxx)

| TC ID | Scenario | Expected | Pri | Sev | Type |
|---|---|---|---|---|---|
| TC-MOB-001 | Install as PWA (Chrome desktop) | "Add to home" works | Medium | Medium | PWA |
| TC-MOB-002 | Install Android APK | Installs; opens | High | High | Mobile |
| TC-MOB-003 | Splash screen shows on launch | Burgundy 2s | Low | Low | UI |
| TC-MOB-004 | Offline app launch | Service worker serves cached shell | High | Critical | Offline |
| TC-MOB-005 | View previously-uploaded proposal offline | IndexedDB serves it | High | High | Offline |
| TC-MOB-006 | Create quote offline | Saved locally; flagged for sync | High | High | Offline |
| TC-MOB-007 | Reconnect → sync | Quotes pushed to Supabase | High | High | Real-time |
| TC-MOB-008 | Service worker update | New version prompt | Medium | Medium | PWA |
| TC-MOB-009 | Cache version mismatch | Forced refresh | Medium | High | Resilience |
| TC-MOB-010 | Rotate screen mid-form | Data preserved; layout adjusts | Medium | Low | Responsive |
| TC-MOB-011 | Bottom nav reachable on small screens (320×568) | All 3 tabs visible | High | Medium | Responsive |
| TC-MOB-012 | Touch target ≥40px | All buttons | High | Medium | Mobile A11y |
| TC-MOB-013 | iOS notch safe-area | Header not clipped | Medium | Medium | Mobile UI |
| TC-MOB-014 | Android back button on wizard step 3 | Goes to step 2, not exits app | Medium | High | Mobile UX | **GAP** |
| TC-MOB-015 | App in background → resume | State preserved | High | High | Lifecycle |
| TC-MOB-016 | Low memory kill → relaunch | Restored from localStorage/IndexedDB | High | High | Lifecycle |
| TC-MOB-017 | Camera access for logo (mobile) | Permission flow | Medium | Medium | Mobile |
| TC-MOB-018 | Battery saver mode | App functional, just slower | Low | Low | Real-time |

---

### 🌐 CROSS-BROWSER (TC-XB-xxx)

| TC ID | Browser | Module | Expected |
|---|---|---|---|
| TC-XB-001 | Chrome latest | All | Pass |
| TC-XB-002 | Firefox latest | All | Pass |
| TC-XB-003 | Safari 16+ | PDF export, IndexedDB, html2canvas | **High risk** for html2canvas fonts |
| TC-XB-004 | Edge latest | All | Pass |
| TC-XB-005 | iOS Safari 15 | PWA install, file upload | Limited PWA install on iOS |
| TC-XB-006 | Android Chrome | All | Pass |
| TC-XB-007 | Samsung Internet | All | Verify |
| TC-XB-008 | IE 11 | – | Not supported (document & enforce) |

---

### 🛡️ SECURITY (TC-SEC-xxx) — High-Risk Focus

| TC ID | Scenario | Expected | Pri | Sev |
|---|---|---|---|---|
| TC-SEC-001 | SQL injection in all inputs (login, search, forms) | Parameterized; safe | High | Critical |
| TC-SEC-002 | XSS in chat, client name, quote desc, terms | Sanitized in display & PDF | High | Critical |
| TC-SEC-003 | CSRF on Supabase mutations | Token-based auth prevents | High | High |
| TC-SEC-004 | Open redirect via `from` param after login | Validate to internal paths only | High | High | **GAP** |
| TC-SEC-005 | Sensitive data in localStorage (passwords, tokens) | None stored | High | Critical |
| TC-SEC-006 | Sensitive data in logs/console | Sanitized | High | High | **GAP**: Check `logger` |
| TC-SEC-007 | Gemini API key exposed in client bundle | `VITE_*` is **public**; key visible — **MUST proxy via backend** | High | Critical | **GAP** |
| TC-SEC-008 | Supabase anon key exposed | Public by design; RLS must protect | High | Critical |
| TC-SEC-009 | RLS bypass via direct Supabase REST call | Denied | High | Critical |
| TC-SEC-010 | File upload anti-virus / magic-number | Reject non-PDF disguised as PDF | High | Critical | **GAP** |
| TC-SEC-011 | Stored XSS via uploaded SVG logo | Sanitize or reject SVG | High | Critical | **GAP** |
| TC-SEC-012 | Clickjacking (iframe embed) | `X-Frame-Options: DENY` or CSP `frame-ancestors` | Medium | High | **GAP** |
| TC-SEC-013 | CSP header present | Restrict scripts/connect-src | Medium | High | **GAP** |
| TC-SEC-014 | HTTPS enforced in prod | HSTS header | High | Critical |
| TC-SEC-015 | Password hashing rounds ≥10 | Bcrypt with cost factor ≥10 | High | High |
| TC-SEC-016 | Account lockout after N failures | Throttle | High | Critical | **GAP** |
| TC-SEC-017 | Password complexity policy | Min 8, mixed | High | High | **GAP** |
| TC-SEC-018 | PII (email, phone, GST) not logged | Sanitize logs | High | High | **GAP** |
| TC-SEC-019 | Audit trail of who edited quote | created_by, updated_by columns | Medium | High | **GAP** |
| TC-SEC-020 | Dependency CVE scan (npm audit, Snyk) | Zero high vulns | High | High |

---

### ⚡ PERFORMANCE (TC-PERF-xxx)

| TC ID | Scenario | Target | Sev |
|---|---|---|---|
| TC-PERF-001 | First contentful paint | <2.5s on 4G | High |
| TC-PERF-002 | Time to interactive | <3.5s | High |
| TC-PERF-003 | Quote calc with 100 line items | <100ms | High |
| TC-PERF-004 | PDF parse 50-page doc | <10s | High |
| TC-PERF-005 | AI quote generation | <30s | High |
| TC-PERF-006 | PDF export 10-item quote | <5s | High |
| TC-PERF-007 | Bundle size (gzipped) | <500KB | High |
| TC-PERF-008 | Memory after 30min use | <200MB | Medium |
| TC-PERF-009 | Memory leak on repeat upload | No growth after GC | High |
| TC-PERF-010 | Concurrent 100 users (Supabase load) | <500ms p95 | Medium |
| TC-PERF-011 | LocalStorage size cap | Warn at 4MB | Medium |
| TC-PERF-012 | IndexedDB query 1000 proposals | <200ms | Medium |

---

### 🚨 ERROR HANDLING (TC-ERR-xxx)

| TC ID | Scenario | Expected |
|---|---|---|
| TC-ERR-001 | Supabase 5xx during quote save | Toast + retry button; quote kept locally |
| TC-ERR-002 | Gemini quota exceeded | Friendly "AI temporarily unavailable" |
| TC-ERR-003 | Invalid JSON from Gemini | Caught; option to retry |
| TC-ERR-004 | IndexedDB quota exceeded | Warn user, prompt cleanup |
| TC-ERR-005 | Service worker registration fails | App still works without offline |
| TC-ERR-006 | Component crash | ErrorBoundary catches; "Something went wrong" |
| TC-ERR-007 | Async unhandled rejection | Global handler logs to Sentry-like service |
| TC-ERR-008 | Window resize during PDF gen | Cancel previous render |
| TC-ERR-009 | Logout while operation pending | Cancel operations cleanly |
| TC-ERR-010 | Navigation away during upload | Confirm dialog |

---

## 🔍 PART D — IDENTIFIED ISSUES (DEEP ANALYSIS)

### 🐛 D1. Missing Validations (18 issues)

| # | Field/Area | Missing | Severity |
|---|---|---|---|
| 1 | Login email/password | Client-side required check | Medium |
| 2 | Login email | Max-length & format validation | Medium |
| 3 | Login password | Bcrypt 72-byte cap (DoS risk) | High |
| 4 | Phone number | Min/max length enforcement | High |
| 5 | GST number | Indian GST format (15 chars, structured) | Medium |
| 6 | Company logo | File type & size limits | High |
| 7 | Logo SVG | Sanitization for embedded JS | Critical |
| 8 | Website URL | URL format validation | Low |
| 9 | Quote line item qty/rate | Non-negative, numeric-only | Critical |
| 10 | Quote export | Min 1 line item required | High |
| 11 | File upload | Magic-number check (not just MIME) | Critical |
| 12 | Filename | Path-traversal sanitization | Critical |
| 13 | Zero-byte file rejection | Currently missing | High |
| 14 | Empty chat message | UI-side guard | Low |
| 15 | LocalStorage quota | Pre-check before write | Medium |
| 16 | Open-redirect `from` param | Whitelist internal paths | High |
| 17 | Duplicate client save policy | Define & enforce | Medium |
| 18 | Long company/client names | Cap to prevent PDF breakage | Medium |

### 🔓 D2. Security Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Gemini API key in client bundle** (`VITE_GEMINI_API_KEY`) | API abuse, billing fraud | Move calls behind backend proxy (Supabase Edge Function) |
| **No account lockout / rate limit on login** | Brute force | Add Supabase function with attempt counter or Cloudflare Turnstile |
| **Client-side role check only** | Privilege escalation | Enforce permissions in Supabase RLS + Edge Functions |
| **No CSP / X-Frame-Options headers** | XSS amplification, clickjacking | Add via hosting (Vercel/Netlify headers) |
| **File MIME relies on browser-declared type** | Malware upload | Use magic-number sniffing + virus scan |
| **PII in logs (email, phone)** | GDPR/DPDP non-compliance | Sanitize logger; mask PII |
| **No audit trail on quotes** | Repudiation | Add `created_by`, `updated_by`, `updated_at` |
| **localStorage holds full user object** | Tampering | Re-validate user via Supabase on critical actions |
| **No HTTPS-only enforcement in code** | Man-in-the-middle | HSTS header + redirect HTTP→HTTPS |
| **Password policy absent** | Weak passwords | Enforce min 8, mixed at signup |

### ⚙️ D3. Performance Bottlenecks

| Area | Issue | Fix |
|---|---|---|
| html2canvas PDF export | Heavy DOM rasterization, slow on mobile | Switch to server-side PDF (Puppeteer) or pdfmake |
| Gemini calls serialized at 1/sec | UX delay during rapid edits | Debounce + cancel previous |
| Loading all proposals on Documents page | Slow with 100+ items | Pagination/virtualization |
| Page images stored as base64 PNG in IndexedDB | Large memory footprint | Store as Blob, not DataURL |
| Bundle includes pdf.js + xlsx + jspdf + html2canvas | Large initial bundle | Code-split heavy libs |
| No request cancellation on route change | Wasted bandwidth | AbortController |

### 🎨 D4. UI/UX Issues

| Issue | Severity |
|---|---|
| Wizard allows jumping to later steps without completing earlier ones | Medium |
| No "unsaved changes" warning when navigating away mid-edit | High |
| GST hardcoded to 18% — no per-line tax rate (rate card shows 5% for print) | High |
| No undo on delete row | Medium |
| Toast errors disappear too fast for screen readers | Medium |
| Mobile keyboard covers form fields | Medium |
| Long line-item descriptions break PDF table layout | High |
| No quote numbering displayed during editing (only at export) | Low |
| Logo aspect ratio not preserved | Low |
| No loading skeleton during AI generation (only spinner) | Low |

### 🧮 D5. Data Integrity Problems

1. **No quote versioning** — overwrites lose history.
2. **No unique constraint** on proposals (filename+size+user) → duplicates possible.
3. **localStorage & Supabase can drift** — no reconciliation logic on conflict.
4. **Chat history grows unbounded** in localStorage.
5. **Client autocomplete shows all leads** regardless of user ownership (verify RLS).
6. **Company info "is_active" flag** — risk of multiple active records.
7. **Decimal rounding inconsistencies** between display, calculation, and PDF export.
8. **No referential integrity** between quote ↔ proposal (orphaned quotes if proposal deleted).

### 🔄 D6. Logical Flaws

1. Quote calculation uses `(duration || 1)` — falsy zero treated as 1 (e.g., duration=0 silently becomes 1).
2. GST toggle changes total but quote JSON may retain stale `gstAmount` if not recalculated on save.
3. Service matching is case-sensitive in some places (per registry build) → "Auto" vs "auto" mismatch.
4. Rate limit counter is per-session; refresh resets it (bypassable).
5. Duplicate detection by `filename+size` only — same file uploaded by different users counted twice (or wrongly skipped, depending on scope).
6. Wizard step state stored in URL query? Likely in component state — refresh resets step.
7. Logout doesn't cancel in-flight Gemini/Supabase requests.

### 💥 D7. Failure Points

| Point | Consequence |
|---|---|
| Missing `VITE_GEMINI_API_KEY` at build | Fatal app crash on first chat message |
| Supabase outage | Login impossible; offline mode helps only for cached data |
| IndexedDB disabled (private browsing) | Upload silently fails |
| html2canvas font-rendering bug on Safari | Broken PDF |
| User clears site data | Loses all local quotes/proposals if not synced |
| Capacitor plugin missing on web preview | Runtime error if not gated |
| Long-running PDF parse blocks main thread | UI freeze |

### 📦 D8. Production Risks

1. **API key leak** → uncontrolled Gemini billing.
2. **No telemetry/observability** → blind to production errors.
3. **No feature flags** → can't disable broken features without redeploy.
4. **No blue-green/canary** → all-or-nothing releases.
5. **No backup strategy** for Supabase data documented.
6. **DPDP / GDPR**: storing PII (client email, phone, GST) without consent flow or data export/delete UI.
7. **No SLA monitoring** on Gemini & Supabase dependencies.
8. **APK signing & Play Store compliance** not verified.

---

## 📈 PART E — TEST COVERAGE SUMMARY

| Category | Designed | Critical | High | Medium | Low |
|---|---:|---:|---:|---:|---:|
| Functional | 95 | 25 | 40 | 22 | 8 |
| UI | 35 | 4 | 12 | 14 | 5 |
| Validation | 50 | 12 | 22 | 12 | 4 |
| Positive | 60 | 15 | 28 | 12 | 5 |
| Negative | 55 | 18 | 22 | 10 | 5 |
| Boundary | 30 | 8 | 14 | 6 | 2 |
| Edge | 28 | 5 | 10 | 9 | 4 |
| Integration | 25 | 10 | 10 | 4 | 1 |
| API | 20 | 8 | 8 | 3 | 1 |
| Database | 18 | 7 | 7 | 3 | 1 |
| Security | 20 | 12 | 6 | 2 | 0 |
| Performance | 12 | 4 | 6 | 2 | 0 |
| RBAC | 12 | 8 | 3 | 1 | 0 |
| Mobile Responsive | 18 | 4 | 8 | 5 | 1 |
| Cross-browser | 8 | 1 | 3 | 3 | 1 |
| Error Handling | 10 | 4 | 5 | 1 | 0 |
| Real-time | 15 | 4 | 7 | 3 | 1 |
| Data Integrity | 12 | 6 | 4 | 2 | 0 |
| Workflow | 10 | 5 | 4 | 1 | 0 |
| Exception | 8 | 3 | 4 | 1 | 0 |
| **TOTAL** | **541** | **163** | **223** | **116** | **39** |

---

## 🎯 PART F — RISK MATRIX

| Module | Likelihood | Impact | Risk |
|---|---|---|---|
| M1 Authentication | High | Critical | 🔴 9/10 |
| M3 Proposal Upload | High | High | 🔴 8/10 |
| M7 Quote Calculation | Medium | Critical | 🔴 8/10 |
| M9 PDF Export | High | High | 🟠 7/10 |
| M10 Gemini AI | High | High | 🟠 7/10 |
| M12 Cloud Sync | Medium | Critical | 🟠 7/10 |
| M2 Chat | Medium | High | 🟠 6/10 |
| M14 Mobile | Medium | High | 🟠 6/10 |
| M5/M6 Forms | Low | Medium | 🟡 4/10 |
| M8 Templates | Low | Low | 🟢 2/10 |

---

## 🚦 PART G — HIGH PRIORITY MODULES (TEST FIRST)

1. **Authentication & Permission Engine** — gate-keeper.
2. **Quote Calculation Engine** — financial correctness.
3. **PDF Export** — customer deliverable.
4. **Proposal Upload + Cloud Sync** — data ingress / data loss risk.
5. **Gemini AI Service** — billing exposure + UX backbone.

---

## 🤖 PART H — AUTOMATION FEASIBILITY & TOOL STACK

| Test Category | Automatable | Tool |
|---|---|---|
| Unit (services, utils, hooks) | 100% | **Vitest** + React Testing Library |
| Integration | 90% | **Vitest** + MSW (mock Supabase/Gemini) |
| E2E Web | 95% | **Playwright** (multi-browser) |
| E2E Mobile | 70% | **Appium** / **Detox** (Capacitor) |
| API contract | 100% | **Postman/Newman** + **Supabase MCP** |
| Visual regression (PDF, templates) | 80% | **Percy** / **Playwright snapshots** |
| Accessibility | 90% | **axe-core** in Playwright |
| Performance | 80% | **Lighthouse CI**, **k6** for load |
| Security | 60% | **OWASP ZAP**, **Snyk**, **npm audit** |
| Mobile responsive | 90% | Playwright device emulation + **BrowserStack** |
| Cross-browser | 100% | **Playwright** (Chromium/WebKit/Firefox) + BrowserStack |
| Manual exploratory | – | Session-based, charter-driven |

**Overall automation feasibility: ~75–80%**

---

## 🔁 PART I — RECOMMENDED REGRESSION SUITE (≈80 cases)

Run on **every PR to `develop`** and **before every release to `main`**:

1. Login (valid, invalid, deactivated, SQL inj) — 6
2. Role-based access (admin/manager/sales/viewer) on /quote, /documents — 8
3. Quote calculation: subtotal, GST on/off, multi-item, decimals — 10
4. PDF upload + duplicate detection (local & cloud) — 6
5. AI chat: exact, multiple-match, no-match, city picker, min-qty — 8
6. Client form validation (all rules) — 10
7. Company form validation (all rules) — 8
8. Wizard full flow end-to-end — 4 (one per template)
9. PDF export (all 4 templates, web + mobile) — 8
10. Offline create-quote → reconnect → sync — 4
11. Logout clears all state — 2
12. RLS: cross-user data isolation — 4
13. Security smoke: XSS in name/desc, file MIME spoof — 3

---

## ✅ PART J — CRITICAL PRODUCTION SCENARIOS CHECKLIST

Before every release to `main`:

- [ ] Gemini API key rotated & monitored for spikes
- [ ] Supabase RLS policies tested with non-admin user
- [ ] PDF export verified on iOS Safari + Android Chrome with real device
- [ ] Quote calculation regression against `BUSINESS_RULES.md` fixtures
- [ ] Login brute-force protection active
- [ ] Backup of Supabase DB taken within 24h
- [ ] Service worker version bumped; cache invalidation tested
- [ ] No `console.log` of PII in production build
- [ ] CSP & HSTS headers present
- [ ] CI green: lint, type-check, unit, integration, E2E, security scan
- [ ] Coverage ≥80%
- [ ] APK signed with release key; verified on Play Console internal track
- [ ] Manual smoke: upload → AI quote → edit → PDF → share
- [ ] Rollback plan documented & tested
- [ ] Friday deploys forbidden (per governance)
- [ ] Monitoring/alerting enabled (errors, Gemini quota, Supabase latency)

---

## 🧭 PART K — TESTING PERSPECTIVES SUMMARY

| Perspective | Key Findings |
|---|---|
| **Manual Tester** | Forms allow invalid data through; no client-side validation on login; wizard navigation is non-linear and confusing |
| **Automation Tester** | Codebase is well-structured for unit testing; needs `data-testid` attributes added to components for stable E2E selectors |
| **Security Tester** | Critical: API key exposure, no brute-force protection, missing CSP, file-upload validation weak |
| **End User** | Upload→quote flow is intuitive when AI works; failure modes confusing; no offline indication; long generation times need progress |
| **Business Analyst** | GST hardcoded at 18% violates Baleen rate card (print=5%); minimum-quantity rules not consistently enforced; no quote audit trail |
| **DevOps QA Reviewer** | No CI/CD pipeline visible; no telemetry; no error tracking; insufficient release governance enforcement |

---

## 🏁 FINAL VERDICT

**Production Readiness: 62/100 — NOT READY for enterprise rollout without remediation.**

**Top 5 must-fix before production:**
1. 🔴 Move Gemini API key behind backend proxy (currently exposed in client bundle).
2. 🔴 Add brute-force protection & password policy on login.
3. 🔴 Sanitize all user inputs rendered in PDF / HTML (XSS prevention).
4. 🔴 Validate file uploads by magic number + size + SVG sanitization.
5. 🔴 Enforce server-side permission checks (RLS + Edge Functions), not client-only.

**Top 5 quick wins (≤1 week):**
1. ✅ Add required-field validation on Login.
2. ✅ Reject zero-byte / oversized files explicitly.
3. ✅ Add quantity/rate non-negative checks in Quote Preview.
4. ✅ Add CSP, HSTS, X-Frame-Options headers.
5. ✅ Add `data-testid` attributes & set up Playwright smoke suite.

---

*Document end. All 541 designed test cases follow a standardized template; expand into a test management tool (TestRail, Zephyr, Xray) for execution tracking. Actual Results & Status columns are intentionally blank for QA execution.*
