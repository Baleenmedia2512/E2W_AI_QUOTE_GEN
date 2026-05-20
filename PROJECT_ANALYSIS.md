# QUOTE BUDDY — COMPLETE PROJECT ANALYSIS

> **Audience:** Beginner Developer  
> **Analyzed By:** Senior Software Architect + Senior QA Engineer + Senior DevOps Engineer  
> **Date:** May 20, 2026  

---

# TABLE OF CONTENTS

1. [Project Overview](#1-project-overview)
2. [All Modules](#2-all-modules-identified)
3. [Modules with Real Examples](#3-each-module-with-real-examples)
4. [ASCII Architecture Diagrams](#4-ascii-architecture-diagrams)
5. [Frontend Modules](#5-frontend-modules-explained)
6. [Backend Modules](#6-backend-modules-explained)
7. [Authentication](#7-authentication--complete-explanation)
8. [Database Flow](#8-database-flow)
9. [Local Storage / Session Storage](#9-local-storage--session-storage)
10. [API Flow](#10-api-flow)
11. [Testing Modules](#11-testing-modules-explained)
12. [CI/CD Pipeline](#12-cicd-pipeline)
13. [Potential Issues Found](#13-potential-issues-found)
14. [Improvements Suggested](#14-improvements-suggested)
15. [Learning Roadmap](#15-learning-roadmap)
16. [Full Module Reference Cards](#16-full-module-reference-cards)

---

# 1. PROJECT OVERVIEW

## What type of application is this?

Quote Buddy is a **full-stack web + mobile application** built for a real media company called **Baleen Media**. It is a **Progressive Web App (PWA)** — meaning it works in a browser AND can be installed on Android/iOS devices like a native app.

**Technology Stack:**

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React + TypeScript | The UI you see |
| UI Library | Chakra UI | Ready-made buttons, forms, etc. |
| State Management | Zustand | Remembers data while you use the app |
| Backend Database | Supabase | Cloud database + file storage |
| AI Brain | Google Gemini AI | Generates quotes from documents |
| PDF Reading | PDF.js | Reads uploaded PDF files |
| PDF Export | jsPDF + html2canvas | Creates downloadable PDFs |
| Mobile | Capacitor | Wraps the web app as Android/iOS |
| Build Tool | Vite | Fast development builds |
| Testing | Vitest + React Testing Library | Automated code testing |

---

## What problem does it solve?

**Without this app** — a sales person at Baleen Media receives a Request For Quote (RFQ) from a client. They have to manually read the requirement document (PDF), manually calculate prices, then manually type a quote in Word/Excel. This takes 1-2 hours and is full of human error.

**With Quote Buddy** — the sales person uploads the PDF, types what they need in a chat box, and the AI instantly generates a perfectly formatted, price-calculated quote in under 30 seconds.

---

## Who are the users?

| User | Role | What they do |
|---|---|---|
| Sales Person | Creates quotes | Uploads proposals, chats with AI, sends quotes |
| Admin | Manages system | Can view all quotes, manage users |
| Manager | Oversees | Monitors activity |

---

## Complete Workflow

```
STEP 1:  User opens app → must log in
STEP 2:  Login page → enters email + password
STEP 3:  System checks database → verifies password
STEP 4:  If correct → goes to Dashboard (Home Page)
STEP 5:  User goes to Documents page → uploads client PDF
STEP 6:  App reads the PDF text + images automatically
STEP 7:  User opens chat → types "Give me a quote for Bus Branding in Chennai"
STEP 8:  AI reads PDF content → generates detailed quote with prices
STEP 9:  User reviews the quote → edits if needed
STEP 10: User fills in client details (name, email, company)
STEP 11: User selects a quote template (design style)
STEP 12: Quote is previewed on screen → User exports as PDF
STEP 13: PDF is downloaded → sent to client
```

---

## Architecture in Simple Words

Think of a restaurant:

- **Frontend (React)** = The dining hall. What customers see. Menus, tables, waiters.
- **Zustand Store** = The order notepad. Remembers what everyone ordered.
- **Service Layer** = The kitchen. Does the actual cooking (business logic).
- **Supabase** = The pantry + refrigerator. Stores all ingredients (data).
- **Gemini AI** = A master chef consultant you call on the phone. Describes what the customer wants and the chef tells you how to make it.
- **PDF.js** = A menu reader. Reads the raw ingredient list (PDF) for the chef.
- **Capacitor** = A food delivery bag. Takes the restaurant and delivers it as a mobile app.

---

# 2. ALL MODULES IDENTIFIED

---

## MODULE 1: Authentication Module

| Attribute | Detail |
|---|---|
| **Purpose** | Controls who can log in and what they can do |
| **Why it exists** | Without this, anyone could access quotes and client data |
| **If it breaks** | Nobody can log in. App is completely unusable. |
| **Input** | Email + Password |
| **Output** | Logged-in user session, role, permissions |

**Files:**
- `src/services/authService.ts` — Login/logout logic
- `src/store/authStore.ts` — Remembers who is logged in
- `src/types/auth.ts` — Defines what a User looks like
- `src/pages/LoginPage.tsx` — The login form UI
- `src/components/PrivateRoute/` — Blocks non-logged-in users from pages
- `src/pages/UnauthorizedPage.tsx` — Page shown when access is denied

**Modules that depend on it:** Every other module.

---

## MODULE 2: AI Quote Generation Module

| Attribute | Detail |
|---|---|
| **Purpose** | Converts a client's PDF into a detailed price quote using AI |
| **Why it exists** | This is the #1 value of the whole app |
| **If it breaks** | Users can't generate quotes. Core feature is dead. |
| **Input** | PDF text content + user's chat message |
| **Output** | Structured JSON quote with items, prices, GST, terms |

**Files:**
- `src/services/geminiService.ts` — Talks to Google Gemini AI
- `src/components/ChatInterface/` — The chat box UI
- `src/utils/promptTemplates.ts` — Instructions sent to the AI
- `src/utils/bulletNormalization.ts` — Cleans up AI response formatting
- `src/hooks/useCityServiceRegistry.ts` — Pre-builds city → services map

**Modules that depend on it:** Quote Preview, PDF Export, Store

---

## MODULE 3: Document/Proposal Module

| Attribute | Detail |
|---|---|
| **Purpose** | Handles PDF upload, reading, storage, and display |
| **Why it exists** | The AI needs raw text from client PDFs to generate quotes |
| **If it breaks** | Users can't upload PDFs → AI has no input → No quotes |
| **Input** | PDF file uploaded by user |
| **Output** | Extracted text, page images, stored proposal record |

**Files:**
- `src/pages/DocumentsPage.tsx` — Documents management UI
- `src/components/ProposalUpload/` — Drag-and-drop upload widget
- `src/components/ProposalViewer/` — Shows a single PDF
- `src/components/MultiProposalViewer/` — Shows multiple PDFs
- `src/utils/pdfUtils.ts` — PDF.js logic to extract text + screenshots
- `src/utils/proposalStorage.ts` — Saves proposals to IndexedDB
- `src/utils/imageStorage.ts` — Saves PDF page images to IndexedDB
- `src/services/supabaseProposalService.ts` — Cloud proposal sync

---

## MODULE 4: Quote Preview & Export Module

| Attribute | Detail |
|---|---|
| **Purpose** | Shows the formatted quote and exports it as a PDF |
| **Why it exists** | A quote needs to look professional to send to clients |
| **If it breaks** | User can't see or export the final quote |
| **Input** | Quote data + company info + client info + template |
| **Output** | Visual quote preview + downloadable PDF |

**Files:**
- `src/pages/QuotePreviewPage.tsx` — Full-screen preview page
- `src/components/QuotePreview/` — Visual quote card component
- `src/components/Templates/` — Different visual designs
- `src/components/TemplateSelector/` — Lets user pick a design
- `src/services/pdfExportService.ts` — HTML → PDF conversion
- `src/pages/QuotePage.tsx` — Quote creation/editing page

---

## MODULE 5: Company Info Module

| Attribute | Detail |
|---|---|
| **Purpose** | Manages Baleen Media's details shown on every quote |
| **Why it exists** | Every quote needs company branding and legal details |
| **If it breaks** | Quotes show wrong/empty company info |
| **Input** | Company name, address, logo, GST, website, signature |
| **Output** | Company info saved to database, shown on all quotes |

**Files:**
- `src/services/companyService.ts` — Load/save to Supabase
- `src/components/CompanyInfoForm/` — Form UI for editing
- `src/hooks/useCompanySync.ts` — Keeps company info synced
- `src/utils/localStorage.ts` — Fallback storage
- `src/constants/defaultCompany.ts` — Default values

---

## MODULE 6: Client Info Module

| Attribute | Detail |
|---|---|
| **Purpose** | Captures details of who the quote is being sent to |
| **Why it exists** | Quotes need to show the client's name and contact details |
| **If it breaks** | Quotes have no recipient information |
| **Input** | Client name, email, phone, company name, address |
| **Output** | Client info saved, appears on the quote |

**Files:**
- `src/components/ClientInfoForm/` — Client details form
- `src/services/leadService.ts` — Searches client database
- `src/components/AutocompleteInput/` — Suggests names as you type
- `src/types/client.ts` — Client type definition

---

## MODULE 7: State Management Module (Zustand)

| Attribute | Detail |
|---|---|
| **Purpose** | Acts as the app's memory — keeps all data in one central place |
| **Why it exists** | Components need to share data without passing through 10 levels |
| **If it breaks** | App forgets everything on every click. Unusable. |
| **Input** | Actions from any component |
| **Output** | Current state available to any component instantly |

**Files:**
- `src/store/index.ts` — Main app store
- `src/store/authStore.ts` — Authentication state

---

## MODULE 8: Data Sync Module

| Attribute | Detail |
|---|---|
| **Purpose** | Saves data in multiple places and keeps them in sync |
| **Why it exists** | App must work offline. Data must survive page refreshes. |
| **If it breaks** | Data may be lost or out of sync between devices |
| **Input** | Any data to be saved |
| **Output** | Data saved in 2-3 places with timestamps |

**Files:**
- `src/services/dataSyncService.ts` — Core sync logic
- `src/utils/localStorage.ts` — Browser localStorage operations
- `src/utils/imageStorage.ts` — IndexedDB for large images
- `src/utils/proposalStorage.ts` — IndexedDB for proposals

---

## MODULE 9: PWA / Mobile Module

| Attribute | Detail |
|---|---|
| **Purpose** | Makes the app installable and functional as a mobile app |
| **Why it exists** | Sales people need this on phones |
| **If it breaks** | Mobile app stops working or can't export PDFs |

**Files:**
- `capacitor.config.ts` — Mobile app configuration
- `public/service-worker.js` — PWA offline caching rules
- `public/manifest.json` — PWA install metadata
- `src/utils/pwa.ts` — Service worker registration
- `src/plugins/downloadNotification.ts` — Android download notification
- `android/` — Android build files
- `build-apk.ps1` — Script to build Android APK

---

## MODULE 10: UI Components Module

| Component | What it does |
|---|---|
| `Header/` | Top navigation bar |
| `BottomNav/` | Bottom tab bar on mobile |
| `Layout/` | Page wrapper with consistent margins |
| `LoadingSpinner/` | Spinning circle shown while loading |
| `ErrorBoundary/` | Catches crashes and shows friendly error |
| `UserProfile/` | Shows the logged-in user's info |
| `UpdateNotification/` | "New version available" popup (disabled) |

---

## MODULE 11: Testing Module

| Attribute | Detail |
|---|---|
| **Purpose** | Automatically checks that all code still works correctly |
| **Why it exists** | When you change code, tests catch if you broke something else |

**Files:**
- `tests/services/` — Tests for all service files
- `tests/components/` — Tests for UI components
- `tests/store/` — Tests for Zustand state
- `tests/hooks/` — Tests for React hooks
- `tests/utils/` — Tests for utility functions
- `tests/fixtures/` — Fake test data
- `tests/mocks/` — Fake versions of external services
- `tests/setup.ts` — Global test setup
- `vitest.config.ts` — Test runner configuration

---

## MODULE 12: Type Definitions Module

| File | What it defines |
|---|---|
| `src/types/auth.ts` | User, Role, AuthUser |
| `src/types/quote.ts` | Quote, LineItem, QuoteItem |
| `src/types/company.ts` | CompanyInfo |
| `src/types/client.ts` | Client |
| `src/types/lead.ts` | Lead, LeadSearchResult |
| `src/types/chat.ts` | Message |
| `src/types/template.ts` | TemplateType |
| `src/types/index.ts` | Re-exports everything |

---

# 3. EACH MODULE WITH REAL EXAMPLES

---

## Auth Module — Real Example

**Real-world analogy:** A security guard at a company gate with an ID card scanner.

**Step-by-step execution flow:**

```
1. User types email: "john@baleenmedia.com" + password: "abc123"
2. LoginPage.tsx calls: login({ email, password }) from authStore
3. authStore calls: authService.login(credentials)
4. authService sends query to Supabase:
   SELECT * FROM "User" WHERE email ILIKE 'john@baleenmedia.com'
5. Supabase returns the user row (with hashed password)
6. authService fetches Role:
   SELECT * FROM "Role" WHERE id = user.roleId
7. bcrypt.compare("abc123", "$2b$10$hashedpassword") → true / false
8. If TRUE:
   → Builds AuthUser object (id, email, full_name, role, permissions)
   → Saves to localStorage: currentUser = {...}
   → authStore.user = AuthUser
   → authStore.isAuthenticated = true
   → React redirects user to "/" (Home)
9. If FALSE:
   → Throws error "Invalid email or password"
   → authStore.error = message
   → LoginPage shows error in toast notification
```

---

## AI Quote Generation — Real Example

**Real-world analogy:** Calling a smart pricing consultant on the phone. You read the customer's requirements, and the consultant gives you the exact quote.

**Example:** User uploads a PDF about "Outdoor Advertising Services in Chennai". User types: *"Give me a quote for Bus Semi Branding for 3 months"*

```
1. ChatInterface sends message to geminiService.sendMessage()
2. geminiService collects:
   - All PDF text content from uploaded proposals
   - City→service registry (from useCityServiceRegistry hook)
   - User's message
   - Chat history
3. Builds prompt + sends to Gemini API
4. Gemini returns JSON response:
   {
     "quoteGenerated": true,
     "items": [{
       "title": "Bus Semi Branding",
       "lineItems": [{
         "description": "Bus Semi Branding - Rental Price",
         "quantity": 10,
         "unitPrice": 5000,
         "total": 50000
       }]
     }],
     "gstEnabled": true,
     "gstPercentage": 18,
     "termsAndConditions": "..."
   }
5. parseQuoteFromResponse() extracts JSON from AI text
6. validateAndFixQuoteDescriptions() fixes any missing prefixes
7. Quote saved into Zustand store
8. QuotePreview component shows formatted quote
```

---

## PDF Export — Real Example

**Real-world analogy:** Taking a photograph of a beautifully arranged cake and printing it.

```
1. User clicks "Export PDF"
2. pdfExportService.exportQuoteToPDF() is called
3. Finds HTML elements with IDs: "quote-section-0", "quote-section-1"
4. For each section:
   → Creates off-screen invisible clone of the HTML
   → Sets it to exactly 794px wide (A4 paper width)
   → html2canvas takes a screenshot of it
5. jsPDF creates a new PDF document
6. Each canvas screenshot is placed on a PDF page
7. On mobile (Capacitor): saves file to phone storage
8. On web: triggers browser download
```

---

# 4. ASCII ARCHITECTURE DIAGRAMS

---

## Overall Architecture

```
┌─────────────────────────────────────────────────┐
│                  BROWSER / MOBILE APP            │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │   PRESENTATION LAYER (React Pages/UI)   │    │
│  │  LoginPage  HomePage  DocumentsPage     │    │
│  │  QuotePage  QuotePreviewPage            │    │
│  └──────────────┬──────────────────────────┘    │
│                 │ calls                          │
│  ┌──────────────▼──────────────────────────┐    │
│  │   STATE LAYER (Zustand Stores)          │    │
│  │   authStore         mainAppStore        │    │
│  └──────────────┬──────────────────────────┘    │
│                 │ calls                          │
│  ┌──────────────▼──────────────────────────┐    │
│  │   SERVICE LAYER (Business Logic)        │    │
│  │   authService    geminiService          │    │
│  │   companyService pdfExportService       │    │
│  │   leadService    dataSyncService        │    │
│  └──────────┬──────────────┬───────────────┘    │
│             │              │                     │
│  ┌──────────▼────┐  ┌──────▼────────────────┐  │
│  │  LOCAL STORAGE│  │  SUPABASE (Cloud DB)   │  │
│  │  IndexedDB    │  │  PostgreSQL Database   │  │
│  │  SessionStorage│  │  File Storage          │  │
│  └───────────────┘  └───────────┬────────────┘  │
│                                 │                │
│                    ┌────────────▼───────────┐   │
│                    │  GOOGLE GEMINI AI API  │   │
│                    └────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## Authentication Flow

```
User Opens App
      │
      ▼
  Is user logged in?
  (check localStorage for "currentUser")
      │
   ┌──┴──┐
  YES    NO
   │      │
   ▼      ▼
 Home   Login Page
 Page      │
           │  User types email + password
           ▼
      LoginPage.tsx → handleSubmit()
           │
           ▼
      authStore.login()
           │
           ▼
      authService.login()
           │
           ▼
      Supabase: SELECT * FROM "User"
      WHERE email ILIKE 'user@email.com'
           │
      ┌────┴────┐
    Found    Not Found
      │           │
      ▼           ▼
  Fetch Role   Throw Error
  from "Role"  "Invalid email"
  table
      │
      ▼
  bcrypt.compare(password, hashedPassword)
      │
   ┌──┴──┐
  TRUE   FALSE
   │       │
   ▼       ▼
Build    Throw Error
AuthUser "Invalid email
Object   or password"
   │
   ▼
Save to localStorage → authStore.isAuthenticated = true
   │
   ▼
Redirect to "/" (Home Page)
```

---

## Quote Generation Flow

```
User on Documents Page
         │
         ▼
  Upload PDF file
         │
         ▼
  pdfUtils.extractPDFContent()
  ┌──────────────────────────┐
  │ PDF.js reads each page   │
  │ Extracts text per page   │
  │ Takes screenshot of page │
  └──────────────────────────┘
         │
         ▼
  Save to IndexedDB + Store
         │
         ▼
  useCityServiceRegistry hook
  ┌──────────────────────────┐
  │ Scans all PDF text       │
  │ Calls Gemini per city    │
  │ Saves in sessionStorage  │
  └──────────────────────────┘
         │
         ▼
  User opens Chat Interface
  User types: "Quote for Bus Branding Chennai"
         │
         ▼
  geminiService.sendMessage()
  ┌──────────────────────────────────────────────┐
  │ Builds prompt with:                          │
  │  - System instructions (CHAT_SYSTEM_PROMPT)  │
  │  - All PDF text content                      │
  │  - City service registry                     │
  │  - Chat history                              │
  │  - User's message                            │
  └──────────────────────────────────────────────┘
         │
         ▼
  Google Gemini API → generates JSON quote
         │
         ▼
  parseQuoteFromResponse() → extracts JSON
         │
         ▼
  validateAndFixQuoteDescriptions() → ensures format
         │
         ▼
  Quote saved to Zustand Store
         │
         ▼
  QuotePreview shows the quote → User edits if needed
         │
         ▼
  User clicks "Export PDF"
         │
         ▼
  pdfExportService.exportQuoteToPDF()
         │
         ▼
  PDF downloaded / saved to phone
```

---

## Local Storage Flow

```
App Starts
    │
    ▼
useCompanySync hook runs
    │
    ├─ Try: Fetch from Supabase database
    │       │
    │    Success?
    │  ┌────┴────┐
    │ YES        NO
    │  │          │
    │  ▼          ▼
    │ Save to   Load from
    │ localStorage  localStorage
    └──┴─────────┘
         │
         ▼
   Company Info available in Store

User Uploads PDF
    │
    ▼
Save to IndexedDB (large binary data)
Save metadata to localStorage
Attempt upload to Supabase Storage
    │
 ┌──┴──┐
OK    FAIL
 │       │
 │    Stays in IndexedDB (offline mode)
 ▼
Synced to cloud
```

---

## Testing Flow

```
Developer writes/changes code
           │
           ▼
     npm run test
           │
           ▼
  vitest.config.ts loads
           │
    ┌──────┴───────────────────────────────┐
    │          TEST SUITES DISCOVERED       │
    │  tests/services/authService.test.ts  │
    │  tests/services/geminiService.test.ts│
    │  tests/components/Header.test.tsx    │
    │  tests/store/__tests__/*.test.ts     │
    └──────┬───────────────────────────────┘
           │
           ▼
    tests/setup.ts runs first
    (sets up jsdom browser simulation)
           │
           ▼
    For each test file:
    ┌──────────────────────────────────────┐
    │  Mocks applied (fake Supabase, etc.) │
    │  Test cases run one by one           │
    │  DOM cleaned up after each test      │
    └──────────────────────────────────────┘
           │
           ▼
    Coverage report generated
    (Must be ≥80% lines/functions)
           │
        ┌──┴──┐
       PASS   FAIL
        │       │
        ▼       ▼
   "All tests  Shows which test failed
    passed"    and why
```

---

## CI/CD Flow (Intended — Not Yet Implemented)

```
Developer Branch
       │
       ▼  git push
GITHUB PULL REQUEST OPENED
       │
       ▼
AUTOMATIC CI CHECKS RUN
  ├── TypeScript compilation check
  ├── ESLint (code quality)
  ├── Prettier (code formatting)
  ├── Unit tests (all must pass)
  ├── Coverage check (≥80%)
  └── Security audit (npm audit)
       │
    ┌──┴──┐
   PASS   FAIL
    │       │
    ▼       ▼
CODE REVIEW  PR blocked,
(2 humans     developer
 approve)     must fix
    │
    ▼
MERGE TO develop
    │
    ▼
STAGING DEPLOY (automatic)
    │
    ▼
MANUAL QA TESTING
    │
    ▼
RELEASE TAG CREATED (git tag v1.0.1)
    │
    ▼
PRODUCTION DEPLOY (automatic on tag)
    │
    ▼
HEALTH CHECKS RUN
    │
    ▼
USERS SEE NEW VERSION
```

---

# 5. FRONTEND MODULES EXPLAINED

---

## Components

Components are like **LEGO bricks**. You build small pieces and combine them to make pages.

### `ErrorBoundary`
- **What it does:** Wraps the entire app. If any part crashes, shows a friendly error instead of a blank screen.
- **Common bug:** If `ErrorBoundary` itself has a bug, the whole app breaks silently.

### `PrivateRoute`
- **What it does:** Checks if you're logged in before letting you see a page.
```
User visits "/quote"
       │
PrivateRoute checks authStore.isAuthenticated
       │
    ┌──┴──┐
   TRUE   FALSE
    │       │
    ▼       ▼
 Show     Redirect to /login
 QuotePage (with "from" state to return after login)
```

### `ChatInterface`
- **What it does:** The AI chat box. User types messages, AI responds with quotes.
- **Data flow:**
```
User types message → handleSendMessage()
→ geminiService.sendMessage()
→ Gemini API responds
→ Response parsed into Quote JSON
→ Zustand store updated
→ QuotePreview re-renders with new quote
```

---

## Pages

| Page | Route | Purpose |
|---|---|---|
| `LoginPage` | `/login` | Login form |
| `HomePage` | `/` | Dashboard / landing page |
| `DocumentsPage` | `/documents` | Upload + manage PDFs |
| `QuotePage` | `/quote` | Create/edit quote + chat |
| `QuotePreviewPage` | `/preview` | Full-screen quote preview |
| `UnauthorizedPage` | `/unauthorized` | Access denied page |

---

## Routing

```
App.tsx
  └── <Router>
        └── <Switch>
              ├── /login          → <LoginPage>         (public)
              ├── /unauthorized   → <UnauthorizedPage>  (public)
              ├── /               → <PrivateRoute> → <HomePage>
              ├── /documents      → <PrivateRoute> → <DocumentsPage>
              ├── /quote          → <PrivateRoute> → <QuotePage>
              └── /preview        → <PrivateRoute> → <QuotePreviewPage>
```

---

## State Management (Zustand)

**Think of Zustand like a whiteboard in the office.** Anyone can read from it. Anyone can write on it. And everyone sees the same thing.

**authStore holds:**
```json
{
  "user": { "id": "...", "email": "...", "full_name": "...", "role": { "role_name": "Admin", "permissions": {} } },
  "isAuthenticated": true,
  "isLoading": false,
  "error": null
}
```

**Main appStore holds:**
```json
{
  "companyInfo": { "name": "Baleen Media", "address": "...", "gst": "..." },
  "activeProposals": [],
  "recentProposals": [],
  "currentQuote": { "items": [], "total": 0, "gst": 0, "terms": "..." },
  "messages": [],
  "isLoading": false,
  "selectedTemplate": "corporate-minimal"
}
```

---

## Forms and Validation

Forms use React's `useState`. Validation is manual in `handleSubmit`.

**Example from LoginPage:**
```typescript
// STEP 1: Local state
const [email, setEmail] = useState('');
const [password, setPassword] = useState('');

// STEP 2: Validate on submit
if (!email || !password) {
  toast({ title: 'Missing fields' });
  return; // stop here
}

// STEP 3: Call store action
await login({ email, password });
```

> **Gap:** No form library (like React Hook Form + Zod). Validation is manual and inconsistent.

---

# 6. BACKEND MODULES EXPLAINED

---

## No Traditional Backend Server

This app does **NOT** have a Node.js/Express backend. The "backend" is **Supabase** — a cloud service that provides a database and APIs directly accessible from the browser.

```
Traditional Apps:         This App:
Browser → Express.js    Browser → Supabase SDK
         → PostgreSQL              → PostgreSQL (cloud)
```

---

## Supabase Database Tables

| Table | Purpose | Key Fields |
|---|---|---|
| `User` | App users (employees) | id, email, name, password (hashed), roleId, isActive |
| `Role` | User roles and permissions | id, name, permissions (JSON) |
| `company_settings` | Baleen Media's company info | name, address, gst, logo, is_active |
| `Lead` | Client/customer database | id, name, phone, email, company, city |
| `proposals` | Uploaded proposal metadata | id, file_name, storage_path, text_content, page_count |

---

## Request → Response Flow

```
Service function called
        │
        ▼
supabase.from('TableName').select('*').eq('id', userId).single()
        │
        ▼
Supabase SDK sends HTTPS request to:
  https://xxxx.supabase.co/rest/v1/TableName
        │
        ▼
Supabase Cloud (PostgreSQL) runs the query
        │
        ▼
Returns { data: {...}, error: null }
  OR    { data: null, error: {...} }
        │
        ▼
Service checks error
  → if error: throw or return null
  → if data: return mapped object
```

---

# 7. AUTHENTICATION — COMPLETE EXPLANATION

---

## How Login Works

```
USER: types email + password → clicks Login

BROWSER (LoginPage.tsx):
  → validates: are fields empty?
  → calls authStore.login({ email, password })

AUTHSTORE (authStore.ts):
  → sets isLoading = true
  → calls authService.login()

AUTHSERVICE (authService.ts):
  Step 1: Query User table (case-insensitive email match)
  Step 2: If not found → throw "Invalid email or password"
  Step 3: Check isActive → if false → throw "Account deactivated"
  Step 4: Fetch user's Role from Role table
  Step 5: bcrypt.compare(rawPassword, hashedPassword)
  Step 6: Build AuthUser object (WITHOUT password field)
  Step 7: Return AuthUser

AUTHSTORE:
  → saves to localStorage["currentUser"]
  → sets isAuthenticated = true

LOGINPAGE:
  → shows success toast
  → redirects to "/"
```

---

## How Logout Works

```
User clicks Logout
     │
     ▼
authStore.logout()
     │
     ▼
authService.logout()
  → localStorage.removeItem('currentUser')
  → localStorage.removeItem('authToken')
     │
     ▼
authStore → user = null, isAuthenticated = false
     │
     ▼
PrivateRoute detects → redirects to /login
```

---

## Password Security

```
Storing password:
  rawPassword = "MyPassword123"
  hashedPassword = bcrypt.hash(rawPassword, 10)
  Stored in DB as: "$2b$10$xyzabc..."   ← can't be reversed!

Checking password on login:
  bcrypt.compare("MyPassword123", "$2b$10$xyzabc...") → true
  The actual password NEVER leaves the database
  Even if DB is hacked, passwords are safe
```

---

## Security Risks in Current Auth

| Risk | Description | Fix |
|---|---|---|
| No session expiry | localStorage never expires | Add loginAt timestamp, expire after 8 hours |
| Plain text in localStorage | Anyone with DevTools can see user data | Encrypt or use HttpOnly cookies |
| No JWT | No proper token rotation or invalidation | Migrate to Supabase Auth |
| XSS risk | If attacker injects JS, they steal localStorage | Use Content Security Policy headers |

---

# 8. DATABASE FLOW

---

## Table Schemas

### `User` Table
```
User
├── id           (UUID, Primary Key)
├── email        (TEXT, unique)
├── name         (TEXT)
├── password     (TEXT — bcrypt hash, e.g. "$2b$10$...")
├── roleId       (UUID, Foreign Key → Role.id)
└── isActive     (BOOLEAN)
```

### `Role` Table
```
Role
├── id           (UUID, Primary Key)
├── name         (TEXT — "Admin", "Manager", "SalesPerson")
└── permissions  (JSONB — { "canEditQuotes": true, ... })
```

### `company_settings` Table
```
company_settings
├── id           (UUID)
├── name         (TEXT)
├── address      (TEXT)
├── gst          (TEXT)
├── phone        (TEXT)
├── email        (TEXT)
├── logo         (TEXT — base64 or URL)
├── website      (TEXT)
├── signature    (TEXT — base64 image)
├── is_active    (BOOLEAN)
└── created_at   (TIMESTAMP)
```

### `Lead` Table
```
Lead
├── id           (UUID)
├── name         (TEXT)
├── phone        (TEXT)
├── email        (TEXT)
├── address      (TEXT)
├── city         (TEXT)
├── campaign     (TEXT)
└── source       (TEXT)
```

---

## CRUD Examples

```typescript
// CREATE
await supabase.from('company_settings')
  .insert({ name: 'Baleen Media', is_active: true })

// READ
await supabase.from('company_settings')
  .select('*').eq('is_active', true).single()

// UPDATE
await supabase.from('company_settings')
  .update({ name: 'New Name' }).eq('id', existingId)

// DELETE
await supabase.from('proposals')
  .delete().eq('id', proposalId)
```

---

## ⚠️ Gap Identified

There is **no Supabase table for saving generated quotes**. Quotes live only in Zustand memory and localStorage. If the user clears browser data, all quotes are permanently lost.

**Fix:** Create a `Quote` table in Supabase and save every generated quote.

---

# 9. LOCAL STORAGE / SESSION STORAGE

---

## What is Stored and Where

| Key | Storage | Data | Why |
|---|---|---|---|
| `currentUser` | localStorage | AuthUser JSON | Keeps you logged in across sessions |
| `authToken` | localStorage | Token | Auth token |
| `ai_quote_gen_company_info` | localStorage | CompanyInfo JSON | Fast offline access |
| `selectedTemplate` | localStorage | Template name | Remembers last template choice |
| `currentQuote` | localStorage | Quote JSON | Survives page refresh |
| `e2w_city_service_registry` | sessionStorage | City→Services map | Cached per browser tab |
| `ai_quote_gen_chat_history` | sessionStorage | Chat messages | Chat history per tab |
| PDF page screenshots | IndexedDB | PNG images | Too large for localStorage |

---

## Security Risks

```
RISK 1: XSS Attack
  → Attacker injects JS → reads localStorage → steals user data
  → Fix: Use HttpOnly cookies + Content Security Policy

RISK 2: No expiry
  → localStorage never expires automatically
  → Shared computer risk: next person still logged in as admin
  → Fix: Add loginAt timestamp, expire after 8 hours

RISK 3: Plain text
  → User data readable in DevTools
  → Fix: Encrypt sensitive fields before storing
```

---

# 10. API FLOW

---

## External APIs Used

### Google Gemini AI

| Attribute | Detail |
|---|---|
| **Method** | SDK call (`model.generateContent()`) |
| **Purpose** | Generate quotes from PDF text |
| **Rate Limit** | 1 second minimum between requests |
| **Timeout** | ~60s per request |
| **⚠️ Security Risk** | `VITE_GEMINI_API_KEY` is bundled into JavaScript — visible in browser! |

---

### Supabase REST API

| Attribute | Detail |
|---|---|
| **Base URL** | `https://[project-id].supabase.co/rest/v1/` |
| **Auth** | ANON KEY in request headers |
| **Example** | `GET /User?email=ilike.john@example.com` |

---

### Supabase Storage

```typescript
// Upload file
supabase.storage.from('proposals').upload('path/file.pdf', fileBlob)

// Download file
supabase.storage.from('proposals').download('path/file.pdf')

// Get public URL
supabase.storage.from('proposals').getPublicUrl('path/file.pdf')
```

---

# 11. TESTING MODULES EXPLAINED

---

## Test Inventory

| Test File | What it tests |
|---|---|
| `authService.test.ts` | Login, logout, permissions, localStorage |
| `geminiService.test.ts` | AI response parsing, edge cases |
| `companyService.test.ts` | Company CRUD operations |
| `dataSyncService.test.ts` | Multi-storage sync logic |
| `leadService.test.ts` | Client search, database queries |
| `pdfExportService.test.ts` | PDF generation logic |
| `supabaseProposalService.test.ts` | Cloud proposal upload/download |
| `Header.test.tsx` | Header component renders |
| `ClientInfoForm.test.tsx` | Client form validation |
| `ErrorBoundary.test.tsx` | Error catching |
| `PrivateRoute.test.tsx` | Auth redirect |
| `QuotePreview.test.tsx` | Quote display |

---

## What is Mocking?

**Real-world analogy:** A pilot training in a flight simulator. The simulator **pretends** to be a real plane. No actual plane is used.

In tests:
```typescript
// Without mock: calls real Supabase database (slow, needs internet)
// With mock: fake Supabase always returns what we tell it to

vi.mock('../../src/services/supabaseClient', () => ({
  supabase: { from: vi.fn() }
}));

// Now we control the response:
vi.mocked(supabase.from).mockReturnValue(makeMockChain(fakeUserData));
```

---

## Types of Testing

| Type | What it tests | Speed | Used in project? |
|---|---|---|---|
| **Unit** | One function in isolation | Milliseconds | ✅ Yes |
| **Integration** | Multiple functions together | Seconds | ✅ Partially |
| **E2E** | Full user journey in real browser | Minutes | ❌ Not present |
| **Snapshot** | UI component output matches saved snapshot | Fast | ❌ Not present |

---

## Coverage Requirements (from `vitest.config.ts`)

| Metric | Minimum Required |
|---|---|
| Lines | ≥ 80% |
| Functions | ≥ 80% |
| Branches | ≥ 75% |
| Statements | ≥ 80% |

---

# 12. CI/CD PIPELINE

---

## Current State: Manual

There is **no `.github/workflows/` folder**. There is **no automated CI/CD pipeline** currently active.

**What developers do manually:**
```bash
npm run check:all
# = npm run lint + npm run type-check + npm run test:unit

npm run build
# Builds the dist/ folder

# Then manually deploy dist/ to hosting
```

---

## What SHOULD Exist (Per Governance)

The `claude.md` governance document specifies a full pipeline that hasn't been implemented yet.

**Priority:** Setting up GitHub Actions CI/CD should be a **high priority task**.

```yaml
# Example: .github/workflows/pr-checks.yml (to be created)
name: PR Validation
on:
  pull_request:
    branches: [develop, main]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run lint
      - run: npm run type-check
      - run: npm run test:coverage
      - run: npm audit --audit-level=moderate
      - run: npm run build
```

---

# 13. POTENTIAL ISSUES FOUND

---

## 🔴 Security Issues (HIGH PRIORITY)

### Issue 1: Gemini API Key Exposed in Browser
```
PROBLEM: VITE_GEMINI_API_KEY → bundled into JS → visible in DevTools
IMPACT:  Attacker uses your API key → your billing gets charged
FIX:     Move Gemini calls to a Supabase Edge Function (serverless proxy)
```

### Issue 2: Auth Data in Plain-text localStorage
```
PROBLEM: { "email": "admin@...", "role": "Admin" } stored as readable JSON
ATTACK:  XSS attack steals this → attacker impersonates admin
FIX:     Use HttpOnly cookies OR encrypt the stored value
```

### Issue 3: No Session Expiry
```
PROBLEM: localStorage never expires automatically
RISK:    Shared computer → next person still logged in as admin
FIX:     Add loginAt timestamp. Expire session after 8 hours.
```

### Issue 4: Custom Authentication (No JWT)
```
PROBLEM: App builds its own auth instead of using Supabase Auth
IMPACT:  No token rotation, no refresh tokens, no server-side invalidation
FIX:     Migrate to supabase.auth.signInWithPassword()
```

### Issue 5: Hardcoded Business Data in Code
```
PROBLEM: geminiService.ts contains hardcoded Radio Rate Card pricing data
RISK:    If repo is public, competitors see your pricing
FIX:     Store in database. Load at runtime. Remove from code.
```

---

## 🟡 Code Quality Issues

### Issue 6: `any` Type Usage
```typescript
// Found in codebase:
let subscription: any = null;
const validateAndFixQuoteDescriptions = (quoteData: any): any

// FIX: Define proper TypeScript interfaces
```

### Issue 7: Quotes Not Saved to Database
```
PROBLEM: Generated quotes only in Zustand store + localStorage
RISK:    User clears browser data → ALL quotes lost forever
FIX:     Create Supabase "Quote" table. Save every generated quote.
```

### Issue 8: Commented-Out Code Blocks
```
Large sections of commented-out code exist in:
  - pwa.ts (service worker update handling)
  - authService.ts (lastLogin update)

FIX: Remove commented code, or explain why it's disabled in a comment.
```

---

## 🟡 Performance Issues

### Issue 9: Large PDF Images in Memory
```
PROBLEM: 50-page PDF → 50 large PNG screenshots in RAM
IMPACT:  100MB+ memory usage on mobile → crashes
FIX:     Lazy load page images only when user scrolls to that page
```

### Issue 10: No React Memoization
```
PROBLEM: Components re-render on every parent state change
IMPACT:  Slow UI when quote has many line items
FIX:     Use React.memo() and useMemo() on expensive components
```

---

## ❌ Missing Tests

```
No tests for:
  - LoginPage component (form submission)
  - QuotePage (main quote creation flow)
  - DocumentsPage (PDF upload flow)
  - useCityServiceRegistry hook (complex logic, untested)
  - Most Zustand store actions
  - E2E tests (entire user journeys)
  - Mobile-specific behavior
```

---

## 🟡 Race Conditions

### Issue 11: Concurrent Proposal Syncs
```
PROBLEM: User uploads 2 PDFs quickly → both trigger cloud sync
         → second sync may overwrite first sync's state
FIX:     Use a sync queue. Process uploads sequentially.
```

---

# 14. IMPROVEMENTS SUGGESTED

---

## 1. Security Improvements (Do These First)

```
HIGH PRIORITY:
  ① Move Gemini API calls to Supabase Edge Function
  ② Switch to Supabase Auth (proper JWT sessions)
  ③ Add session expiry (8 hours)
  ④ Remove hardcoded rate card → store in database
  ⑤ Enable Supabase RLS policies on ALL tables

MEDIUM PRIORITY:
  ⑥ Encrypt localStorage user data
  ⑦ Add login attempt rate limiting (max 5 tries, then lock)
  ⑧ Add Content Security Policy headers
```

---

## 2. Architecture Improvements

```
① Save Quotes to Database
   Create Supabase table: Quote
   Save every generated quote for history + audit trail

② Backend Proxy for AI
   Browser → Supabase Edge Function → Gemini API
   API key stays server-side, never in browser bundle

③ Remove all `any` types
   Replace with proper TypeScript interfaces

④ Upgrade React Router v5 → v6
   v5 is outdated, v6 has better TypeScript support

⑤ Split large store/index.ts
   Create: quoteStore.ts, companyStore.ts, proposalStore.ts
```

---

## 3. Testing Improvements

```
① Add E2E Tests with Playwright
   - Complete login flow
   - PDF upload → quote generation → export
   - Test on mobile viewport

② Add missing component tests:
   - LoginPage (form submission, validation)
   - QuotePage (quote creation)
   - DocumentsPage (upload flow)

③ Add form validation tests:
   - Empty fields
   - Invalid email format
   - File too large

④ Add store action tests for all store functions
```

---

## 4. CI/CD Improvements

```
① Create .github/workflows/pr-checks.yml
   Auto-run: lint + type-check + tests + coverage on every PR

② Create .github/workflows/deploy.yml
   Auto-deploy to staging on merge to develop
   Auto-deploy to production on git tag

③ Add Dependabot for automatic security package updates

④ Enable GitHub branch protection rules:
   - Require PR reviews before merge
   - Require all checks to pass
   - Prevent force push to main
```

---

## 5. Performance Improvements

```
① Lazy load PDF page images (only load when visible)
② Add React.memo() to QuotePreview, Templates
③ Add React Query for Supabase data caching
④ Split Gemini prompt (don't send all pages every request)
⑤ Bundle size analysis: run npm run build then analyze chunks
```

---

# 15. LEARNING ROADMAP

---

## What You Already Know ✅

```
✅ React functional components
✅ React hooks (useState, useEffect)
✅ TypeScript basic types
✅ React Router (navigation between pages)
✅ Async/await for API calls
✅ Chakra UI components
✅ Zustand state management
✅ Supabase basics (select, insert, update)
✅ Unit testing concepts (Vitest)
✅ PDF handling (PDF.js, jsPDF)
✅ Mobile app with Capacitor
✅ Environment variables
✅ Git version control
✅ Offline support (localStorage, IndexedDB)
✅ AI API integration (Gemini)
```

---

## What You Are Missing ❌

```
❌ Proper JWT authentication (Supabase Auth)
❌ Serverless backend functions (Edge Functions)
❌ React Query / SWR (server state management)
❌ E2E testing (Playwright)
❌ Automated CI/CD (GitHub Actions)
❌ Performance optimization (useMemo, lazy loading)
❌ Security best practices (OWASP Top 10)
❌ Form libraries (React Hook Form + Zod validation)
❌ Error monitoring (Sentry)
❌ React Router v6
❌ Docker / containerization
```

---

## BEGINNER → INTERMEDIATE → ADVANCED ROADMAP

### BEGINNER (Months 1-4) — Strengthen Foundations

```
Month 1-2: Solidify React
  ├── useState, useEffect deep dive
  ├── Custom hooks (you already have some!)
  ├── React Router v6 (upgrade from v5)
  └── TypeScript: strict mode, no any, generics

Month 3: Auth done right
  ├── Supabase Auth (replace custom auth)
  ├── JWT tokens explained
  ├── HttpOnly cookies
  └── Role-based access control (RBAC)

Month 4: Better Forms + Validation
  ├── React Hook Form
  ├── Zod schema validation
  └── Form error display patterns
```

---

### INTERMEDIATE (Months 5-12) — Build Real Skills

```
Month 5-6: Backend & APIs
  ├── Supabase Edge Functions (serverless)
  ├── REST API design
  ├── Error handling patterns (Result<T,E>)
  └── Input validation (Zod)

Month 7-8: Performance
  ├── React.memo, useMemo, useCallback
  ├── Code splitting (lazy loading pages)
  ├── Lighthouse performance audits
  └── IndexedDB optimization

Month 9-10: DevOps & CI/CD
  ├── GitHub Actions (automate tests on every push)
  ├── Dev/Staging/Production environments
  ├── Deployment strategies
  └── Monitoring (Sentry, LogRocket)

Month 11-12: E2E Testing
  ├── Playwright setup
  ├── Writing user journey tests
  └── Visual regression testing
```

---

### ADVANCED (Year 2+) — Expert Level

```
Year 2:
  ├── System design (scale to 10,000 users)
  ├── WebSockets (real-time collaboration)
  ├── Advanced security (OWASP Top 10 fixes)
  ├── Mobile performance optimization
  └── AI/LLM engineering (better prompts, fine-tuning)

Year 3+:
  ├── Architecture patterns (CQRS, Event sourcing)
  ├── Database optimization (indexes, query plans)
  ├── Advanced TypeScript (conditional types, decorators)
  ├── Team leadership (code reviews, mentoring)
  └── Product thinking (feature prioritization)
```

---

# 16. FULL MODULE REFERENCE CARDS

---

```
══════════════════════════════════════════════════════
MODULE NAME:    Authentication
Purpose:        Control user login, session, permissions
Files:          authService.ts, authStore.ts, LoginPage.tsx,
                PrivateRoute/, UnauthorizedPage.tsx, types/auth.ts
Flow:           User → LoginPage → authStore → authService →
                Supabase DB → bcrypt verify → localStorage session
Example:        Admin logs in → gets Admin role + permissions
Common Bugs:    - Not awaiting bcrypt → always returns false
                - Not checking isActive → deactivated users log in
Security Risk:  - Sessions in plain localStorage (XSS, no expiry)
                - No proper JWT
Test Cases:     - Successful login returns AuthUser ✅
                - Wrong password throws error ✅
                - Inactive user throws error ✅
                - logout() clears localStorage ✅
Improvement:    Migrate to Supabase Auth

══════════════════════════════════════════════════════
MODULE NAME:    AI Quote Generation
Purpose:        Convert PDF proposal text → structured quote via AI
Files:          geminiService.ts, ChatInterface/, promptTemplates.ts,
                bulletNormalization.ts, useCityServiceRegistry.ts
Flow:           Upload PDF → extract text → user types request →
                build prompt → call Gemini → parse JSON →
                validate → save to store → show in preview
Example:        "Quote for Bus Semi Branding Chennai 3 months"
                → AI returns: { items: [...], gstEnabled: true }
Common Bugs:    - API key missing → no response
                - AI returns text not JSON → parse fails
                - AI ignores prefix → validateAndFix catches it
Security Risk:  - VITE_GEMINI_API_KEY exposed in browser bundle!
Test Cases:     - parseQuoteFromResponse with valid JSON ✅
                - parseQuoteFromResponse with no JSON → null ✅
                - Handles AI wrapping JSON in extra text ✅
Improvement:    Proxy API calls through Supabase Edge Function

══════════════════════════════════════════════════════
MODULE NAME:    Document Management
Purpose:        Upload, read, store, and display PDF proposals
Files:          DocumentsPage.tsx, ProposalUpload/, ProposalViewer/,
                MultiProposalViewer/, pdfUtils.ts, proposalStorage.ts,
                imageStorage.ts, supabaseProposalService.ts
Flow:           Drag PDF → PDF.js reads pages → extract text →
                screenshots taken → save to IndexedDB → sync to cloud
Example:        Upload "Chennai_Rate_Card.pdf" → extracts text from
                5 pages, screenshots each page, saves for offline use
Common Bugs:    - PDF.js CDN fails → PDF doesn't load
                - Large PDF runs out of browser memory
Security Risk:  - Files can be uploaded anonymously (no auth check)
Test Cases:     - Upload valid PDF → extracts text ✅
                - Upload corrupt PDF → graceful error (missing)
Improvement:    Add file type + size validation before processing

══════════════════════════════════════════════════════
MODULE NAME:    State Management (Zustand)
Purpose:        Central app memory. Shares data between components.
Files:          store/index.ts, store/authStore.ts
Flow:           Component calls action → action updates state →
                all subscribed components re-render
Example:        authStore.login() → sets user + isAuthenticated →
                Header shows user name, PrivateRoute allows access
Common Bugs:    - Mutating state directly (without set()) → no re-render
                - Storing derived data that gets stale
Security Risk:  - Auth state persisted to localStorage (Zustand persist)
Test Cases:     - Login action updates isAuthenticated (partial)
Improvement:    Split large store/index.ts into domain-specific stores

══════════════════════════════════════════════════════
MODULE NAME:    PDF Export
Purpose:        Convert HTML quote preview → downloadable PDF
Files:          pdfExportService.ts, QuotePreviewPage.tsx,
                QuotePreview/, Templates/
Flow:           User clicks Export → find HTML sections by ID →
                clone each at A4 width → html2canvas screenshot →
                jsPDF adds each as PDF page → download
Example:        Quote with 3 service items → 2 PDF pages
Common Bugs:    - Images not loaded when screenshot taken → blank
                - Fonts not loaded → wrong font in PDF
                - Table rows cut at page boundary
Security Risk:  - Low risk (local file generation)
Test Cases:     - captureSectionAtA4 finds correct element (partial)
Improvement:    Use PDFMake library instead of screenshot approach

══════════════════════════════════════════════════════
MODULE NAME:    Company Info
Purpose:        Manage Baleen Media's details shown on every quote
Files:          companyService.ts, CompanyInfoForm/, useCompanySync.ts,
                utils/localStorage.ts, constants/defaultCompany.ts
Flow:           App starts → useCompanySync → try Supabase →
                fallback to localStorage → Company info in Store
Example:        Logo, address, GST number appear on every quote
Common Bugs:    - DB unavailable → stale localStorage data shown
                - Logo too large (base64) → causes storage quota error
Security Risk:  - Company logo stored as base64 in DB (large, slow)
Test Cases:     - getCompanySettings returns data from DB ✅
                - Falls back to localStorage on DB failure ✅
Improvement:    Store logo as file in Supabase Storage, not base64

══════════════════════════════════════════════════════
MODULE NAME:    Data Sync
Purpose:        Save data in multiple places, keep them in sync
Files:          dataSyncService.ts, localStorage.ts,
                imageStorage.ts, proposalStorage.ts
Flow:           Save to localStorage FIRST (fast) →
                then save to IndexedDB (large files) →
                then queue cloud upload
Example:        Company settings save: localStorage (instant) +
                Supabase (async, cloud backup)
Common Bugs:    - Offline queue fills up and is lost on page close
                - Timestamp conflicts when two devices edit same data
Security Risk:  - No encryption on stored data
Test Cases:     - saveDataUnified saves to localStorage ✅
Improvement:    Add proper conflict resolution with timestamps

══════════════════════════════════════════════════════
MODULE NAME:    Testing
Purpose:        Automatically verify all code works correctly
Files:          tests/services/*, tests/components/*, tests/store/*,
                tests/hooks/*, tests/utils/*, vitest.config.ts
Coverage:       Lines ≥80%, Functions ≥80%, Branches ≥75%
Missing Tests:  - LoginPage, QuotePage, DocumentsPage (components)
                - useCityServiceRegistry (complex hook)
                - Store actions (most untested)
                - E2E tests (none exist)
Improvement:    Add Playwright E2E + missing component tests
```

---

# FINAL SUMMARY

> **Quote Buddy is an AI-powered quotation platform for Baleen Media that reads outdoor advertising rate card PDFs, understands client requirements through a Gemini-powered chat interface, and generates professional PDF quotes — all secured behind role-based authentication and backed by Supabase cloud storage.**

## Strongest Parts ✅
1. Clean layered folder structure
2. Working PDF upload + text extraction
3. AI quote generation with post-processing validation
4. Proper bcrypt password hashing
5. TypeScript usage (mostly correct)
6. Unit tests with 80% coverage requirement
7. Offline support via IndexedDB + localStorage fallback
8. Mobile-ready via Capacitor

## Most Important Fixes (In Priority Order) ⚠️
1. **Gemini API key exposure** — move to Edge Function immediately
2. **localStorage auth** — migrate to Supabase Auth
3. **No quote persistence** — add Supabase Quote table
4. **No CI/CD** — set up GitHub Actions
5. **No E2E tests** — add Playwright for critical flows
6. **Hardcoded rate card** — move to database

---

*Document generated: May 20, 2026*  
*Project: Quote Buddy v1.0.0*  
*Company: Baleen Media*
