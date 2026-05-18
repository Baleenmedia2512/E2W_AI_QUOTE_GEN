# QUOTE BUDDY — ENGINEERING GOVERNANCE CONSTITUTION

**Effective Date:** May 18, 2026  
**Last Updated:** May 18, 2026  
**Governance Level:** ENTERPRISE PRODUCTION  
**Audience:** All developers, AI assistants (Claude, Copilot), Code Reviewers, DevOps, QA

---

## 📋 TABLE OF CONTENTS

1. [PART 1: Engineering Constitution](#part-1--engineering-constitution)
2. [PART 2: Architecture Governance](#part-2--architecture-governance)
3. [PART 3: Business Logic Governance](#part-3--business-logic-governance)
4. [PART 4: Code Editing Governance](#part-4--code-editing-governance)
5. [PART 5: AI Coding Governance](#part-5--ai-coding-governance)
6. [PART 6: Pull Request Governance](#part-6--pull-request-governance)
7. [PART 7: Branching Strategy](#part-7--branching-strategy)
8. [PART 8: Security Governance](#part-8--security-governance)
9. [PART 9: Testing Governance](#part-9--testing-governance)
10. [PART 10: Pre-Production Governance](#part-10--pre-production-governance)
11. [PART 11: CI/CD Governance](#part-11--cicd-governance)
12. [PART 12: Developer Accountability](#part-12--developer-accountability)
13. [PART 13: Prompt Templates](#part-13--prompt-templates)
14. [PART 14: Implementation Roadmap](#part-14--implementation-roadmap)

---

# PART 1: ENGINEERING CONSTITUTION

## 1.1 Product Vision & Non-Negotiable Rules

**Quote Buddy** is an enterprise-grade AI-powered quotation generation platform serving professional service firms.

### Core Product Principles

- **Accuracy First:** Every quote must be mathematically correct and business-logic sound.
- **Trust Over Features:** We prioritize reliability over rapid feature deployment.
- **No Shortcuts:** Technical debt is an architectural crime.
- **Auditability:** Every business logic change must be traceable.
- **Security by Design:** Not bolted on.
- **Mobile-First Reliability:** Works offline, syncs when available.

### Forbidden Practices (PERMANENT BAN)

❌ **NEVER DO THESE:**

1. **Rewrite existing working logic** without documented reason and approval
2. **Duplicate business logic** across modules (e.g., discount calculation in 3 places)
3. **Hardcode business rules** in UI components or services without domain layer
4. **Hide state mutations** in side effects or untracked changes
5. **Commit commented-out code** — delete or explain in git commit
6. **Deploy without tests** — every feature needs test coverage
7. **Skip error handling** — every API call, calculation, and user action needs error path
8. **Create orphaned code** — unused imports, dead functions, unreachable branches
9. **Bypass authentication/authorization** — no "TODO: add auth later"
10. **Use any AI generated code without verification** — AI hallucination is real
11. **Merge PR without full green checks** — no manual overrides
12. **Add dependencies without architecture review** — dependency bloat kills products
13. **Change database schema without migration plan** — breaking changes destroy data
14. **Deploy to production Friday afternoon** — no exceptions
15. **Skip pre-production validation** — we have layers for a reason

### Engineering Commandments

✅ **ALWAYS DO THESE:**

1. **Analyze before coding** — understand the domain, existing patterns, dependencies
2. **Reuse before writing** — search the codebase for existing solutions
3. **Test before pushing** — no excuses, no exceptions
4. **Document before shipping** — code is communication
5. **Review before merging** — peer review catches issues AI misses
6. **Validate before releasing** — pre-prod testing is your safety net
7. **Monitor after shipping** — production tells you the truth
8. **Trace all business logic** — know where it lives, who owns it, what it impacts
9. **Own your code** — you break it, you fix it
10. **Question everything** — if it doesn't make sense, it probably doesn't

---

## 1.2 Coding Ethics

### Integrity Standards

- **Code is contract.** Your code makes promises to users. Keep them.
- **Clarity > Cleverness.** Readable code is better than smart code. Maintainability wins.
- **Explicit > Implicit.** Type signatures, error handling, business logic should be obvious.
- **Consistent patterns.** Use existing patterns in the codebase. Don't invent new ones.
- **Default to secure.** Never assume user input is valid. Validate everything.
- **Fail loudly.** Errors should be visible, logged, traced. Hidden errors destroy trust.

### Developer Responsibility

Every developer is accountable for:

1. Understanding what their code does
2. Writing tests that prove it works
3. Reviewing others' code fairly
4. Catching regressions early
5. Owning production issues their code causes

**No blame-shifting to "AI wrote it."** If you commit it, you own it.

---

# PART 2: ARCHITECTURE GOVERNANCE

## 2.1 Allowed Architecture Style

**Quote Buddy** follows a **Layered Modular Architecture** with strict separation of concerns:

```
┌─────────────────────────────────────────┐
│   PRESENTATION LAYER (Pages/Components)  │ ← Only UI, no business logic
├─────────────────────────────────────────┤
│   STATE MANAGEMENT LAYER (Zustand Store) │ ← App state, UI state
├─────────────────────────────────────────┤
│   SERVICE LAYER (Business Logic)         │ ← Domain rules, calculations
├─────────────────────────────────────────┤
│   DATA LAYER (API, Database, Cache)     │ ← External systems
├─────────────────────────────────────────┤
│   INFRASTRUCTURE LAYER (Utils, Config)   │ ← Cross-cutting concerns
└─────────────────────────────────────────┘
```

### Layer Responsibilities (STRICT)

**PRESENTATION LAYER** (`/src/pages`, `/src/components`)
- React components for UI rendering
- Form handling and user interaction
- Loading/error states
- NO business logic, NO calculations
- Call services for domain operations

**STATE MANAGEMENT LAYER** (`/src/store`)
- Zustand stores for app state
- User authentication state
- UI state (modals, tabs, etc.)
- Proposal/quote management state
- NO API calls (async handled in services)
- Subscribe to changes, drive re-renders

**SERVICE LAYER** (`/src/services`)
- Business logic implementation
- Domain entity validation
- Calculations (pricing, GST, totals)
- Business rule enforcement
- Orchestration of domain operations
- API communication
- Error translation to domain terms

**DATA LAYER** (`/src/services` - Supabase, Cache, Storage)
- Supabase client
- IndexedDB for offline support
- localStorage for session data
- API response/request formatting
- Data transformation for external systems

**INFRASTRUCTURE LAYER** (`/src/utils`, `/src/types`, `/src/constants`)
- Type definitions
- Utility functions (string, date, file handling)
- Configuration values
- Constants and enums
- Logging and monitoring
- Cache management

---

## 2.2 Folder Structure Standards (MANDATORY)

```
src/
├── components/                    # React Components (UI only)
│   ├── ClientInfoForm/           # Feature-scoped component folder
│   │   ├── ClientInfoForm.tsx    # Component with types inline
│   │   ├── ClientInfoForm.css    # Scoped styles
│   │   └── index.ts              # Barrel export
│   ├── QuoteWizard/
│   │   ├── QuoteWizard.tsx
│   │   ├── QuoteWizard.css
│   │   ├── steps/                # Sub-components for steps
│   │   │   ├── BasicInfoStep.tsx
│   │   │   └── ReviewStep.tsx
│   │   └── index.ts
│   └── ...
├── pages/                         # Route pages (compose services + components)
│   ├── QuotePage.tsx             # Page = orchestration only
│   ├── DocumentsPage.tsx
│   └── ...
├── services/                      # Business Logic & API Integration
│   ├── quoteService.ts           # Quote domain operations
│   ├── geminiService.ts          # AI operations
│   ├── authService.ts            # Authentication domain
│   ├── companyService.ts         # Company data domain
│   ├── supabaseClient.ts         # Supabase config (ONE file)
│   └── ...
├── store/                         # State Management (Zustand)
│   ├── quoteStore.ts             # Quote state
│   ├── authStore.ts              # Auth state
│   ├── index.ts                  # Combine stores
│   └── ...
├── hooks/                         # Custom React Hooks
│   ├── useCompanySync.ts         # Business logic hooks
│   ├── useCityServiceRegistry.ts
│   └── ...
├── types/                         # Type Definitions (MANDATORY)
│   ├── quote.ts                  # Quote domain types
│   ├── company.ts
│   ├── client.ts
│   ├── auth.ts
│   ├── chat.ts
│   └── index.ts                  # Export all types
├── utils/                         # Utility Functions
│   ├── pdfUtils.ts               # PDF specific
│   ├── dateUtils.ts              # Date formatting
│   ├── fileUtils.ts              # File operations
│   ├── localStorage.ts           # Storage helpers
│   ├── cacheVersion.ts           # Cache management
│   └── ...
├── constants/                     # Constants & Configuration
│   ├── defaultCompany.ts         # Default values
│   └── ...
├── theme/                         # Design System
│   └── index.ts                  # Chakra overrides, spacing, colors
├── styles/                        # Global styles
│   ├── global.css
│   └── pdfExport.css
├── App.tsx                        # Root component (minimal, routing only)
└── main.tsx                       # Entry point
```

---

## 2.3 Module Boundary Rules (CRITICAL)

### Allowed Dependencies

```
Presentation → State + Services + Hooks
State → Services + Types + Utils
Services → Data + Types + Utils + Constants
Data → Types + Utils + Constants
Utils → Types + Constants
```

### FORBIDDEN Dependencies

❌ Components → Direct API calls  
❌ Components → Supabase client  
❌ Services → Components  
❌ Services → Pages  
❌ Data → Services  
❌ Circular imports anywhere  
❌ Global mutable state (no globals, use Zustand)  

### Validation Rule

Every import must answer: **"Why does this module need this dependency?"**

If you can't articulate it, it's wrong.

---

## 2.4 Shared Component Policy

### Component Reusability Hierarchy

**Level 1: Domain Components** (Prop-driven, reusable)
- `<QuoteLineItemInput />` — Used in quote wizard, preview, editor
- `<ClientInfoForm />` — Used in checkout, profile
- `<CompanyLogoUploader />` — Used wherever company info is set

**Level 2: Feature Components** (Feature-specific)
- `<QuoteWizard />` — Only used in `/quote` page
- `<ProposalUpload />` — Only used in `/documents` page
- `<ChatInterface />` — Only used in chat section

**Level 3: Atomic Components** (Chakra + custom primitives)
- `<Button>`, `<Input>`, `<Card>`
- Custom styled components with Chakra

### Component Creation Rules

Before creating a component:

1. **Search for existing components** — reuse if possible
2. **Check component library** — is it in Chakra already?
3. **Plan for reusability** — make it prop-driven, not data-coupled
4. **Document prop interface** — TypeScript types are not enough
5. **Include story** — show how to use it

### Component Testing Requirement

Every domain component (`/components/*/`) must have:
- Unit test covering all props
- Integration test in context
- Edge case tests (empty state, error state, loading)

---

## 2.5 State Management Rules (Zustand)

### State Partition Strategy

```typescript
// Store is partitioned by domain
// Each domain has ONE store file with ONE store instance

// ✅ CORRECT:
const useQuoteStore = create(...)      // Quote state
const useAuthStore = create(...)       // Auth state
const useUIStore = create(...)         // UI/modal state

// ❌ WRONG:
const useGlobalStore = create(...)     // Everything mixed
const store1, store2, store3            // Multiple stores per domain
```

### State Shape Rules

1. **Keep state shape minimal** — derive data, don't store derived data
2. **Immutable updates** — use immer plugin in Zustand
3. **Type your state** — no `any` in store
4. **Document state purpose** — comments above store explaining its role
5. **No side effects in state** — call services, don't make API calls

```typescript
// ✅ CORRECT State Design
interface QuoteStore {
  quotes: Quote[];              // Single source of truth
  selectedQuoteId: string | null;
  isLoading: boolean;
  error: string | null;
  
  // Derived (not stored)
  selectedQuote: () => Quote | null;
  hasUnsavedChanges: () => boolean;
}

// ❌ WRONG State Design
interface QuoteStore {
  quotes: Quote[];
  selectedQuote: Quote | null;   // DUPLICATION of data
  quotesCount: number;           // Derived, don't store
  allFieldsTouched: Record<string, boolean>;  // Too granular
}
```

---

## 2.6 API Design Governance

### Service Function Signature Standard

```typescript
// ✅ CORRECT - Type-safe, clear intent, proper error handling
async function generateQuoteFromProposal(
  proposalText: string,
  clientInfo: ClientInfo,
  companyInfo: CompanyInfo,
): Promise<Result<Quote, QuoteGenerationError>> {
  // Implementation with error handling
}

// ❌ WRONG - Vague typing, unclear error handling
function generateQuote(data: any): any {
  // What can go wrong? How do I use this?
}
```

### API Contract Rules

1. **Explicit return types** — no `any`, use `Result<T, E>` pattern
2. **Clear error handling** — return errors, don't throw in services
3. **Pure functions** — same input = same output
4. **Side effects isolated** — mutations explicit
5. **Domain-aligned naming** — function names reflect business operations

### Rate Limiting & Timeout Rules

- Gemini API calls: **60s timeout**, rate limited to 60 calls/min per user
- Supabase API calls: **30s timeout**, retry 3x with exponential backoff
- PDF processing: **120s timeout**, max 50MB file
- All timeouts configurable via environment

---

## 2.7 Database Governance

### Schema Management

1. **No direct SQL in services** — use Supabase client library
2. **Migration required for any schema change** — document in git
3. **Backward compatible migrations** — support old + new schema during rollout
4. **Type safety** — generate types from Supabase schema
5. **Audit trail** — created_at, updated_at, updated_by on every table

### Data Integrity Rules

- **Foreign key constraints required** — database enforces integrity
- **NOT NULL constraints** — default values, never null unless necessary
- **Row-level security (RLS)** — every table needs RLS policies
- **No PII in logs** — sanitize before logging
- **Encryption at rest** — Supabase default
- **HTTPS only** — no unencrypted transmission

---

## 2.8 Service Boundaries & Naming

### Service Naming Convention

- **Domain-scoped** — `quoteService`, `authService`, not `quoteManager` or `handleQuote`
- **Function names are operations** — `generateQuote()`, `validateClientInfo()`
- **Consistency** — if one service does `create*()`, all do
- **Searchability** — grep should find all related functions

### Service Organization

```typescript
// quoteService.ts - Single responsibility: Quote domain

// Creation
export async function createQuote(input: CreateQuoteInput): Promise<Result<Quote>>
export async function createQuoteFromProposal(pdf: File): Promise<Result<Quote>>

// Reading
export async function getQuote(id: string): Promise<Result<Quote>>
export async function listUserQuotes(): Promise<Result<Quote[]>>

// Updating
export async function updateQuote(id: string, update: Partial<Quote>): Promise<Result<Quote>>
export async function applyLineItem(quoteId: string, item: LineItem): Promise<Result<Quote>>

// Deleting
export async function deleteQuote(id: string): Promise<Result<void>>

// Business Operations
export async function calculateTotal(quote: Quote): Promise<Result<QuoteTotal>>
export async function applyDiscount(quoteId: string, discount: Discount): Promise<Result<Quote>>
export async function validateQuoteBeforeExport(quote: Quote): Promise<Result<ValidationError[]>>

// Domain queries
export function getQuoteStatus(quote: Quote): QuoteStatus
export function isQuoteEditable(quote: Quote): boolean
```

---

## 2.9 Anti-Patterns (BANNED)

These will be flagged in code review. Second violation = pair programming.

| Pattern | Why It's Wrong | Correct Approach |
|---------|---|---|
| Business logic in components | Can't test, hard to reuse | Move to service, call from component |
| Direct Supabase calls in components | Couples UI to data layer | Use service layer abstraction |
| Props drilling 3+ levels | Unmaintainable, tightly coupled | Lift state, use context if needed |
| Shared mutable state outside Zustand | Causes bugs, unpredictable | Everything in store |
| Async/await in useEffect without cleanup | Race conditions, memory leaks | Use AbortController, proper cleanup |
| Any type anywhere | Defeats TypeScript, catches errors at runtime | Use proper types, never `any` |
| Catch without re-throw | Hides errors | Log, re-throw, or handle explicitly |
| Feature flags hardcoded | Can't control behavior | Use service, queryable at runtime |
| Duplicate validation logic | Bugs compound, inconsistency | Single source of truth for rules |
| setTimeout > 100ms in tests | Tests flaky, slow CI | Use fake timers, test behavior |

---

# PART 3: BUSINESS LOGIC GOVERNANCE

## 3.1 Domain Model & Bounded Contexts

**Quote Buddy** has 3 core bounded contexts:

### Context 1: QUOTATION (Pricing & Terms)
- Quote creation from proposals
- Line item management
- Discount calculations
- GST calculation
- Total computation
- Quote status (draft, sent, accepted, rejected)
- Version control (for amendments)

### Context 2: CLIENT RELATIONSHIP
- Client information (name, email, phone, GST number)
- Company information (logo, address, terms)
- Client history & quotations
- Client preferences

### Context 3: DOCUMENT MANAGEMENT
- PDF upload & validation
- Text extraction
- Storage & versioning
- PDF export of quotes
- Proposal-to-quote traceability

### Isolation Rules

1. **Quote logic never touches Client logic** — pass data in, get quote back
2. **Document logic independent** — PDF is input to quote, not coupled to it
3. **Each context has own service** — `quoteService`, `clientService`, `documentService`
4. **Communication through domain types** — `Quote`, `Client`, `Document` entities

---

## 3.2 Business Rule Protection

### Critical Business Rules (IMMUTABLE)

These rules CANNOT change without:
1. Board-level decision (not engineering)
2. Database migration (if stored)
3. Full regression testing
4. Customer communication

**PROTECTED RULES:**

1. **Quote Calculation**
   - Total = Sum(LineItems.price × quantity) + GST
   - GST = Total × 0.10 (if enabled)
   - No alternative calculation methods allowed
   - Rule lives in `quoteService.ts`
   - TESTED in `tests/quoteService.test.ts`

2. **Client Validation**
   - Email must be valid format
   - Phone must be valid for locale
   - GST required for business clients
   - Rule lives in `clientService.ts`

3. **Quote Status Transitions**
   - Draft → Sent (require client info + line items)
   - Sent → Accepted/Rejected (client decision)
   - Accepted → PO (awaiting PO)
   - No backward transitions without approval
   - State machine in `quoteService.ts`

4. **Permission Rules**
   - User can only view/edit their own quotes
   - Admin can view all quotes
   - Client can only view quotes sent to them
   - Enforced at service + database (RLS)

### Business Rule Registry

Every business rule must be:

1. **Documented** — in `BUSINESS_RULES.md` (in `.governance` folder)
2. **Located** — which service, which function
3. **Tested** — unit test covering rule
4. **Versioned** — tracked in git
5. **Traceable** — search codebase, find implementation

```typescript
// In BUSINESS_RULES.md:
// Rule: QUOTE_TOTAL_CALCULATION
// Description: Total = Sum(LineItems) + GST
// Implemented: src/services/quoteService.ts - calculateQuoteTotal()
// Tests: tests/services/quoteService.test.ts - line 42-67
// Last Changed: 2026-05-15, by Alice@company.com, reason: "No longer rounding to nearest dollar"
```

---

## 3.3 Validation Layer Architecture

### Validation Scope

```
Input Validation (API boundary)
  ↓
Domain Validation (business rules)
  ↓
State Validation (consistency)
  ↓
Output Validation (data integrity)
```

### Validation Rules

1. **Input Validation** — Happens at API boundary, before business logic
   ```typescript
   // In service, first thing
   if (!proposalText?.trim()) {
     return Err(new ValidationError('Proposal text required'));
   }
   ```

2. **Domain Validation** — Business rules checked before state change
   ```typescript
   // Check quote has required fields before "sending"
   function validateQuoteReadyToSend(quote: Quote): ValidationError[] {
     const errors: ValidationError[] = [];
     if (quote.lineItems.length === 0) {
       errors.push(new ValidationError('At least one line item required'));
     }
     if (!quote.clientInfo?.email) {
       errors.push(new ValidationError('Client email required'));
     }
     return errors;
   }
   ```

3. **State Validation** — Zustand store integrity
   ```typescript
   // Never allow contradictory state
   if (quote.status === 'accepted' && quote.acceptedAt === null) {
     // ERROR: inconsistent state
   }
   ```

### Where Validation Happens

| Validation | Where | Example |
|---|---|---|
| Format/Type | Components + TypeScript | Email is `string` matching RFC 5322 |
| Business Logic | Services | Quote total = sum(items) + gst |
| Database Constraints | Supabase RLS + Constraints | Foreign key integrity |
| State Consistency | Zustand store | Quote accepted implies acceptedAt set |

---

## 3.4 Duplicate Logic Prevention

### Registry of Core Business Logic

**This is THE definitive list. If you're implementing business logic and it's not here, ASK before coding.**

| Business Logic | Service | Function | Tests |
|---|---|---|---|
| Calculate Quote Total | quoteService | calculateQuoteTotal() | ✅ |
| Calculate GST | quoteService | calculateGST() | ✅ |
| Validate Client Email | clientService | validateEmail() | ✅ |
| Extract PDF Text | documentService | extractPDFText() | ✅ |
| Generate AI Quote | geminiService | generateQuoteFromProposal() | ✅ |
| Permission Check | authService | canUserViewQuote() | ✅ |
| Store Quote to DB | quoteService | persistQuote() | ✅ |

**Rule:** Every business operation has ONE and only ONE implementation.

**If you need logic that looks like one of these:** 
1. Search for existing function
2. If exists, call it
3. If doesn't exist, add to registry and create
4. Never duplicate, never rewrite

---

## 3.5 Scatter Prevention

### No Scattered Business Logic

❌ **WRONG - Business logic scattered:**
```typescript
// In QuotePage.tsx
const total = lineItems.reduce((sum, item) => sum + item.price * item.qty, 0);
const withGst = total * 1.1;

// In QuotePreview.tsx (DUPLICATE!)
const total = items.reduce((s, i) => s + i.price * i.qty, 0);

// In PDF export function (DUPLICATE AGAIN!)
const sum = items.map(i => i.price * i.qty).reduce((a, b) => a + b, 0);
const finalTotal = sum + sum * 0.1;
```

✅ **CORRECT - Centralized business logic:**
```typescript
// In quoteService.ts (SINGLE SOURCE OF TRUTH)
export function calculateLineItemTotal(item: LineItem): number {
  return item.price * item.quantity;
}

export function calculateQuoteSubtotal(quote: Quote): number {
  return quote.lineItems.reduce((sum, item) => sum + calculateLineItemTotal(item), 0);
}

export function calculateGST(subtotal: number, enableGST: boolean): number {
  return enableGST ? subtotal * 0.10 : 0;
}

export function calculateQuoteTotal(quote: Quote): QuoteTotal {
  const subtotal = calculateQuoteSubtotal(quote);
  const gst = calculateGST(subtotal, quote.settings.enableGST);
  return {
    subtotal,
    gst,
    total: subtotal + gst,
  };
}

// In QuotePage.tsx - just call service
const quoteTotal = calculateQuoteTotal(currentQuote);
console.log(quoteTotal.total);

// In QuotePreview.tsx - same service
const totals = calculateQuoteTotal(quote);
display(totals);

// In PDF export - same service
const totals = calculateQuoteTotal(quoteData);
addToDocument(totals);
```

---

## 3.6 Hardcoded Rules Prevention

### Rule Configuration Pattern

```typescript
// ❌ WRONG - Hardcoded magic numbers
export const GST_RATE = 0.10;  // Hardcoded everywhere

// ✅ CORRECT - Centralized configuration with versioning
// In src/constants/businessRules.ts
export const BUSINESS_RULES = {
  QUOTE: {
    GST_RATE: 0.10,           // Can be per-country later
    MIN_LINE_ITEMS: 1,
    MAX_LINE_ITEMS: 100,
    MAX_DESCRIPTION_LENGTH: 500,
  },
  CLIENT: {
    EMAIL_REQUIRED: true,
    PHONE_REQUIRED_FOR_BUSINESS: true,
  },
  PERMISSIONS: {
    ADMIN_CAN_VIEW_ALL: true,
    CLIENTS_CAN_AMEND_QUOTES: false,
  },
};

// Use like:
function calculateGST(subtotal: number): number {
  return subtotal * BUSINESS_RULES.QUOTE.GST_RATE;
}

// For future: Can be made dynamic
// export async function getBusinessRules(): Promise<BusinessRules> {
//   // Fetch from database, versioned config service
// }
```

---

## 3.7 AI Workflow Governance

### Gemini Integration Business Logic

**Allowed AI Operations:**
1. Generate quote structure from proposal text
2. Extract line items from document
3. Suggest pricing based on historical quotes
4. Generate quote description from proposal

**NOT Allowed:**
- Change client billing information without user confirmation
- Modify existing quotes without user action
- Bypass price validation
- Ignore business rule constraints

### AI Integration Rules

1. **User Confirmation Always** — AI suggestions are drafts, user accepts/rejects
2. **Validation After AI** — Always validate AI output with business rules
3. **Fallback Required** — If AI fails, provide manual option
4. **Audit Trail** — Log what AI generated vs what user changed
5. **Error Transparency** — Tell user when AI couldn't help

```typescript
// ✅ CORRECT AI Integration
async function generateQuoteFromProposal(
  proposalText: string,
  userContext: UserContext,
): Promise<Result<Quote>> {
  // 1. Call AI
  const aiSuggestion = await callGeminiAPI(proposalText);
  
  // 2. Validate output against business rules
  const validation = validateQuoteAgainstRules(aiSuggestion);
  if (validation.errors.length > 0) {
    return Err(new ValidationError(`AI generated invalid quote: ${validation.errors}`));
  }
  
  // 3. User confirms
  // (This happens in component, not service)
  
  // 4. Persist
  const savedQuote = await persistQuote(aiSuggestion, userContext);
  
  return Ok(savedQuote);
}
```

---

# PART 4: CODE EDITING GOVERNANCE

## 4.1 Mandatory Pre-Edit Analysis Workflow

**EVERY edit must follow this workflow. No exceptions. AI assistants must force this.**

### Step 1: Understand the Domain (15 min)
```
□ What business domain am I changing?
□ What does the current code do?
□ Who depends on this code?
□ Are there existing tests?
□ Is there domain documentation?
```

**RULE:** If you can't answer these, stop. Read more before coding.

### Step 2: Inspect Existing Implementation (15 min)
```
□ Does this feature already exist?
□ Is there duplicate logic elsewhere?
□ What patterns are used in this module?
□ How do other services solve similar problems?
□ Are there recent changes I should know about?
```

**SEARCH FIRST:** 
```bash
# Search for related functions
grep -r "calculateQuote" src/

# Search for patterns
grep -r "useEffect.*subscribe" src/

# Search for similar business rules
grep -r "GST\|gst\|VAT" src/
```

### Step 3: Analyze Dependencies (15 min)
```
□ What modules depend on this code?
□ What modules does this code depend on?
□ Are there circular dependencies?
□ Will my change break anything?
□ What tests need to pass?
```

### Step 4: Check for Reusability (15 min)
```
□ Can I call an existing function instead of writing new?
□ Can I extend an existing function?
□ Should I refactor to make code reusable?
□ Am I duplicating logic? (FORBIDDEN)
□ Is this helper used elsewhere?
```

### Step 5: Preserve Patterns (10 min)
```
□ Does my code follow existing patterns?
□ Am I using consistent naming?
□ Does my error handling match the codebase?
□ Am I following the folder structure?
□ Are types properly defined?
```

### Step 6: Validate Design (10 min)
```
□ Does my code follow architecture rules?
□ Am I respecting module boundaries?
□ Is business logic in the right layer?
□ Can this be tested?
□ Is this maintainable long-term?
```

### Step 7: Plan Tests (10 min)
```
□ What tests must pass?
□ What edge cases exist?
□ What could go wrong?
□ Do I need integration tests?
□ What's the test coverage target?
```

**TOTAL: ~90 minutes of analysis before ANY code change.**

This is not negotiable. For small changes, ~30 min. For major changes, full 90 min.

---

## 4.2 Change Classification & Approval Matrix

### Change Severity Levels

| Level | Example | Analysis | Tests Required | Approval |
|---|---|---|---|---|
| TRIVIAL | Fix typo, update comment | 5 min | None | Self-review only |
| MINOR | Add util function, fix small bug | 30 min | Unit test | 1 other developer |
| STANDARD | New feature, modify service | 60 min | Unit + integration | 2 reviewers, 1 architect |
| MAJOR | Architecture change, breaking API | 90 min | Full suite + smoke | 3 reviewers, architect, product |
| CRITICAL | Database schema, auth, payment | 120 min | Full suite + pre-prod validation | CTO, architect, product, security |

### Approval Checklist

Before ANY merge:

- [ ] Analysis documented (link to PR comment showing research)
- [ ] Tests green (all automated checks pass)
- [ ] Code review approved (by required number of reviewers)
- [ ] Architecture approved (if required)
- [ ] No forbidden patterns detected
- [ ] Backward compatibility confirmed
- [ ] Migration plan documented (if DB change)
- [ ] Rollback plan documented

---

## 4.3 No-Rewrite Rule

### When You're Tempted to Rewrite

**STOP.** Ask these questions:

1. **Does the current code work?**
   - YES → Why rewrite? Document the reason.
   - NO → What's broken? Fix it.

2. **Is the current code wrong?**
   - YES → What's wrong? Write a test that fails. Fix the test.
   - NO → Then it's not wrong.

3. **Is the current code hard to maintain?**
   - YES → Refactor incrementally, with tests.
   - NO → Then leave it alone.

4. **Do I understand the current code's intent?**
   - NO → Read more, talk to author, understand first.
   - YES → Proceed cautiously.

**ALLOWED rewrites:**
- Complete rewrite with strong technical reason (documented)
- Consensus from architecture team
- Zero production impact (new code path)
- Comprehensive test coverage before + after
- Backward compatibility guaranteed
- Clear rollback plan

**FORBIDDEN rewrites:**
- "I would have written it differently"
- "My version is cleaner"
- "I found a better library"
- Without tests
- Without architectural approval
- Without backward compatibility

---

## 4.4 Dependency Management

### Adding Dependencies (STRICT PROCESS)

Before adding any npm package:

1. **Ask: Is this needed?**
   - Can we use what we have?
   - Can we build it ourselves?

2. **Evaluate the package**
   - Is it maintained?
   - How many open issues?
   - Any security vulnerabilities?
   - Is it actively used (npm downloads)?
   - Does it fit our architecture?

3. **Risk Assessment**
   - Will this increase bundle size?
   - Does it have native dependencies?
   - Can we vendor it if needed?
   - What's the maintenance burden?

4. **Approval Process**
   - Add to PR description: Why this dependency?
   - Link to package stats
   - Link to security scan
   - Await architect review

5. **Never add:**
   - Packages for "might need someday"
   - Multiple packages for same purpose
   - Packages with GPL license (check others first)
   - Unmaintained packages
   - Packages with known vulnerabilities

---

## 4.5 Code Review Accountability

### Reviewer Responsibilities

As a code reviewer, you are accountable for:

1. **Understanding the change** — if confused, request clarification
2. **Checking business logic** — is it correct per business rules?
3. **Validating tests** — are tests sufficient, do they test the right things?
4. **Catching architecture violations** — does it follow our rules?
5. **Looking for forgotten edge cases** — what could go wrong?
6. **Ensuring backward compatibility** — will this break users?

### Reviewer Checklist

```
FUNCTIONALITY:
  [ ] Feature works as described
  [ ] Tests prove it works
  [ ] Edge cases handled
  [ ] Error cases handled
  
ARCHITECTURE:
  [ ] Follows module boundaries
  [ ] No forbidden dependencies
  [ ] Business logic in right layer
  [ ] Patterns consistent with codebase
  
CODE QUALITY:
  [ ] Types are correct (no any)
  [ ] Naming is clear
  [ ] Comments where needed
  [ ] No dead code
  [ ] No commented-out code blocks
  
BUSINESS RULES:
  [ ] Business logic unchanged (unless intentional)
  [ ] No duplicate logic
  [ ] Validations in place
  [ ] Security implications understood
  
TESTING:
  [ ] Unit tests cover all paths
  [ ] Integration tests for dependencies
  [ ] Edge cases tested
  [ ] Coverage requirement met (>80%)
  
BACKWARD COMPATIBILITY:
  [ ] Existing functionality preserved
  [ ] No breaking API changes
  [ ] Migration plan if needed
  [ ] Rollback plan clear
  
DOCUMENTATION:
  [ ] Change is documented
  [ ] Business impact explained
  [ ] Technical decisions explained
  [ ] Migration steps clear (if needed)
```

If ANY checkbox is unchecked, REQUEST CHANGES. Don't approve.

---

# PART 5: AI CODING GOVERNANCE

## 5.1 AI Assistant Obligations

**ALL AI-generated code must conform to these rules. No exceptions.**

### Before Generation

AI MUST:
1. Analyze the codebase
2. Identify existing patterns
3. Search for duplicates
4. Understand business rules
5. Plan the implementation
6. Document assumptions

### During Generation

AI MUST:
1. Follow TypeScript typing rules (NO `any`)
2. Use existing patterns
3. Respect module boundaries
4. Include error handling
5. Add test cases
6. Write clear comments

### After Generation

AI MUST:
1. Verify code compiles
2. Verify tests pass
3. Verify no linting errors
4. Verify no type errors
5. Explain what was generated
6. Highlight any assumptions
7. Identify high-risk sections

---

## 5.2 AI Hallucination Prevention

### High-Risk AI Behaviors

These indicate likely hallucination:

| Behavior | Risk | What To Do |
|---|---|---|
| Creates function not in codebase | MEDIUM | Verify it doesn't already exist (search harder) |
| Uses unknown external library | HIGH | Check if it's imported, if not, needs approval |
| Generates complex logic without tests | HIGH | Require tests, simplify if possible |
| Rewrites existing function | CRITICAL | Ask why, verify no regression risk |
| Uses undocumented API | MEDIUM | Check API docs, verify it works |
| Ignores error handling | HIGH | Add error handling before use |
| Makes assumptions about types | HIGH | Verify types are correct |
| Suggests deleting code | CRITICAL | Human must verify before deletion |

---

## 5.3 AI Code Verification Checklist

**For every piece of AI-generated code, verify:**

```
CORRECTNESS:
  [ ] Logic is sound (trace through example inputs)
  [ ] No off-by-one errors
  [ ] Edge cases handled
  [ ] Error cases handled
  [ ] No infinite loops
  
ARCHITECTURE:
  [ ] Follows codebase patterns
  [ ] Respects module boundaries
  [ ] No circular dependencies
  [ ] Types are correct (no any)
  
PERFORMANCE:
  [ ] No obvious inefficiencies
  [ ] No N+1 queries
  [ ] No memory leaks
  [ ] Reasonable timeout handling
  
SECURITY:
  [ ] Input validation present
  [ ] No hardcoded secrets
  [ ] No SQL injection risk
  [ ] No XSS risk
  [ ] Proper auth checks
  
TESTING:
  [ ] Has unit tests
  [ ] Has integration tests
  [ ] Tests are meaningful (not just passing)
  [ ] Edge cases tested
  
DOCUMENTATION:
  [ ] Comments explain why, not what
  [ ] Type signatures clear
  [ ] Error handling documented
  [ ] Business rules explained
  
COMPLETENESS:
  [ ] No TODOs left behind
  [ ] No dead code
  [ ] Imports are used
  [ ] All paths tested
```

**If any check fails, send back for revision.**

---

## 5.4 AI Confidence Scoring

When AI generates code, it should provide a confidence score:

```typescript
interface GeneratedCode {
  code: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  riskFactors: string[];
  verificationSteps: string[];
}

// Example:
{
  code: "function calculateTotal(...) { ... }",
  confidence: 'HIGH',
  riskFactors: [],
  verificationSteps: ['Run calculateQuoteTotal tests', 'Verify no regression in QuotePage']
}

// vs.

{
  code: "const complexAlgorithm = ...",
  confidence: 'LOW',
  riskFactors: [
    'Logic not previously in codebase',
    'No existing tests to reference',
    'Complex control flow',
    'Assumptions about state shape'
  ],
  verificationSteps: [
    'Trace through 3 examples by hand',
    'Add unit tests covering all paths',
    'Have human expert review logic',
    'Test in staging with real data'
  ]
}
```

**Rule:** LOW confidence code needs human expert review before merge.

---

## 5.5 Unsafe Edit Detection

AI must flag these as HIGH RISK:

| Edit | Risk | Reason |
|---|---|---|
| Modifying business rule calculation | CRITICAL | Changes business logic, must be intentional |
| Removing existing test | CRITICAL | Indicates regression risk |
| Changing database query | CRITICAL | Could break data integrity |
| Modifying auth/permission logic | CRITICAL | Security implications |
| Deleting function used elsewhere | HIGH | Need to verify no breakage |
| Adding exception to validation | HIGH | Business rule bypass |
| Changing error handling | MEDIUM | Could hide bugs |
| Modifying component API (props) | MEDIUM | Could break consumers |
| Changing state shape | MEDIUM | Could break serialization |

**For any HIGH or CRITICAL flagged edit: STOP and require human decision.**

---

## 5.6 Mandatory Human Review Points

These require human approval before implementation:

1. ✅ **Architecture decisions** — Can AI decide if code should be in service vs. component?
   - NO. Human architect decides.

2. ✅ **Business rule interpretation** — Can AI decide what "calculate total" means?
   - NO. Human product owner clarifies.

3. ✅ **Security implications** — Can AI ensure auth is correct?
   - NO. Human security reviewer approves.

4. ✅ **Performance tradeoffs** — Can AI decide cache vs. fresh data?
   - NO. Human PM decides based on requirements.

5. ✅ **Breaking changes** — Can AI decide to change an API?
   - NO. Human architect and PM decide.

6. ✅ **Rewriting existing code** — Can AI decide to rewrite?
   - NO. Human architect and author decide.

7. ✅ **Skipping tests** — Can AI decide tests aren't needed?
   - NO. 100% required.

---

# PART 6: PULL REQUEST GOVERNANCE

## 6.1 PR Template (Mandatory)

Every PR must include this information. PRs missing required sections are auto-rejected.

```markdown
## Change Description

**What is the business change?**
[Describe the user-facing change]

**What is the technical change?**
[Describe the code-level change]

**Why is this change needed?**
[Link to issue, business requirement, or bug report]

---

## Business Impact

**Which user workflows are affected?**
- [ ] Quote creation
- [ ] Quote editing
- [ ] Client management
- [ ] PDF export
- [ ] Authentication
- [ ] Other: ___

**Is this a breaking change?** YES / NO
- If YES, what breaks? How do we migrate?

**Backward compatibility?** MAINTAINED / COMPROMISED
- Explain

---

## Architecture Impact

**Architecture changes?** YES / NO
- If YES, describe changes to modules/layers

**Module boundaries changed?** YES / NO
- If YES, which boundaries?

**New dependencies added?** YES / NO
- If YES, why? Security scan? NPM stats?

**Database schema changed?** YES / NO
- If YES, migration strategy? Backward compatible?

---

## Code Changes

**What files changed?**
- List impacted files

**Existing code reused?** YES / NO
- If NO, why not?

**Duplicate logic detected?** YES / NO
- If YES, where? Plan to consolidate?

**Patterns consistent?** YES / NO
- If NO, explain deviation and justification

---

## Testing

**Unit tests added?** YES / NO
- Coverage % ___

**Integration tests added?** YES / NO

**E2E tests added?** YES / NO

**Tests passing?** YES / NO

**Coverage requirement met (>80%)?** YES / NO

**Edge cases covered?**
- [ ] Empty input
- [ ] Null/undefined values
- [ ] Error cases
- [ ] Boundary conditions
- [ ] Concurrent operations

---

## Pre-Deployment Checklist

- [ ] Code compiles (tsc passes)
- [ ] Linting passes (eslint clean)
- [ ] Type checking passes (TypeScript strict mode)
- [ ] Tests pass (100% green)
- [ ] No console.log debug statements
- [ ] No commented-out code blocks
- [ ] Error handling complete
- [ ] TypeScript types complete (no `any`)
- [ ] Documentation updated
- [ ] Migration scripts created (if DB change)
- [ ] Rollback plan documented (if needed)
- [ ] Security review completed (if needed)
- [ ] Performance impact assessed

---

## Risk Assessment

**Regression risk: LOW / MEDIUM / HIGH**
- Justify

**Security risk: LOW / MEDIUM / HIGH**
- Justify

**Performance impact: NONE / LOW / MEDIUM / HIGH**
- Justify

**Data integrity risk: LOW / MEDIUM / HIGH**
- Justify

---

## Review Checklist

- [ ] Code review approved (2 reviewers minimum)
- [ ] Architecture review approved (for STANDARD+ changes)
- [ ] Security review approved (for auth/permission changes)
- [ ] Product sign-off approved (for MAJOR+ changes)
- [ ] No breaking changes to public APIs
- [ ] All TODOs addressed
- [ ] Metrics/monitoring added

---

## Deployment Plan

**Deployment environment:** Dev / Staging / Production

**Deployment strategy:**
- [ ] Direct deploy
- [ ] Blue-green deploy
- [ ] Canary deploy (% of users)
- [ ] Feature flag behind flag

**Monitoring:** 
- What metrics will you watch?

**Rollback trigger:**
- If X happens, rollback

---
```

## 6.2 PR Review Process

### Automatic Checks (Must Pass)

Every PR runs:
1. TypeScript compilation
2. ESLint checks
3. Unit tests
4. Integration tests
5. Coverage analysis (>80% required)
6. Security scanning
7. Dependency audit
8. Code duplication check

**No approval without GREEN lights.**

### Human Review (Required)

1. **First reviewer** — Code quality, architecture
2. **Second reviewer** — Business logic, testing
3. **Architect** (for STANDARD+ changes) — Architecture consistency
4. **Security** (for auth/permission/data) — Security implications

### Merge Requirements

Before merge:

- ✅ All automated checks green
- ✅ Required reviewers approved
- ✅ Zero requested changes
- ✅ Commits squashed (one commit per logical change)
- ✅ Commit message follows convention
- ✅ Branch protections enabled

### No Force Push to Protected Branches

This is permanent. Even if you made a mistake, we revert and create new PR.

**Why?** Maintains audit trail.

---

# PART 7: BRANCHING STRATEGY

## 7.1 Git Flow (Production-Grade)

```
main
  ├── stable production code
  ├── tagged with version (v1.0.0)
  └── requires PR with 2 approvals

staging
  ├── pre-production environment
  ├── tests all features before prod
  └── requires PR with 1 approval

develop
  ├── integration branch
  ├── merges all feature branches
  └── requires PR with 1 approval

feature/description
  ├── One feature per branch
  ├── From: develop
  ├── To: develop (PR)
  └── Format: feature/user-login-ssophp

bugfix/description
  ├── One bug per branch
  ├── From: develop
  ├── To: develop (PR)
  └── Format: bugfix/quote-calculation-gst

hotfix/description
  ├── Critical production fixes
  ├── From: main
  ├── To: main (PR) AND merge to develop
  └── Format: hotfix/security-auth-bypass
```

## 7.2 Branching Rules

### Creating a Branch

```bash
# Always from latest develop
git fetch origin
git checkout -b feature/user-story-description origin/develop

# Branch naming convention
feature/pdf-upload              ✅ Descriptive, lowercase, hyphens
feature/add-gst-calculation     ✅ Specific feature

feature/stuff                   ❌ Too vague
feature/TODO                    ❌ Not specific
FEATURE/PDF-UPLOAD              ❌ Wrong case
feature_pdf_upload              ❌ Wrong separator
```

### Keeping Branch Updated

```bash
# Before PR: rebase on latest develop
git fetch origin
git rebase origin/develop
git push origin feature/description -f  # Force push OK on feature branches
```

### PR Workflow

```bash
# Create PR from feature → develop
# Include full PR template
# Wait for approvals

# After approval: merge (with squash)
# This creates ONE clean commit in develop
```

### Release Workflow

```bash
# Create release branch
git checkout -b release/v1.2.0 origin/develop

# Fix any release issues, update version
# Create PR: release/v1.2.0 → main + develop

# After approval: merge to main
git checkout main
git merge release/v1.2.0

# Tag for release
git tag -a v1.2.0 -m "Release v1.2.0"
git push origin v1.2.0

# Merge back to develop
git checkout develop
git merge main
```

### Hotfix Workflow

```bash
# Critical production bug found
git checkout -b hotfix/security-vulnerability origin/main

# Fix and test
# Create PR: hotfix/... → main

# After approval: merge to main AND develop
git checkout main
git merge hotfix/security-vulnerability
git tag -a v1.2.1 -m "Hotfix v1.2.1"

# Also merge to develop
git checkout develop
git merge main
```

---

## 7.3 Branch Protection Rules

### main branch (Production)

```
✅ Require pull request reviews before merging
   ├─ Required number of reviews: 2
   ├─ Dismiss stale review approvals: Yes
   ├─ Require review from code owners: Yes
   
✅ Require status checks to pass before merging
   ├─ TypeScript compilation: Yes
   ├─ Linting: Yes
   ├─ All tests: Yes
   ├─ Coverage >80%: Yes
   ├─ Security scan: Yes

✅ Require branches to be up to date: Yes
✅ Require conversation resolution: Yes
✅ Require signed commits: Yes
✅ Dismiss pull requests when a new commit is pushed: Yes
✅ Restrict who can push to matching branches: Admins only
```

### staging branch

```
✅ Require pull request reviews: 1
✅ Require status checks: All
✅ Dismiss stale reviews: Yes
✅ Require branches up to date: Yes
```

### develop branch

```
✅ Require pull request reviews: 1
✅ Require status checks: All
✅ Dismiss stale reviews: Yes
```

### feature/* branches

- No protection (developers can force push)
- Local only, never pushed unless PR is opened

---

# PART 8: SECURITY GOVERNANCE

## 8.1 Authentication & Authorization

### Authentication Rules

1. **Supabase Auth Only** — No custom authentication
   - Email + password
   - Supports future: OAuth, SAML, MFA
   - Password hashing: bcrypt (Supabase default)

2. **Token Management**
   - Sessions stored securely
   - Tokens in HTTP-only cookies
   - No tokens in localStorage
   - Token refresh automatic
   - Logout clears everything

3. **Protected Routes**
   - All non-public routes require authentication
   - `<PrivateRoute>` component enforces this
   - Unauthorized → `/unauthorized` page
   - Expired session → `/login` redirect

### Authorization Rules

1. **Row-Level Security (RLS) at Database**
   - Every query enforces user_id filter
   - Database enforces, not application
   - Users cannot access other users' data

2. **Application-Level Checks**
   - Service layer validates permissions
   - `canUserViewQuote(userId, quoteId)` checks
   - Never trust client-side permission checks
   - Always validate on server

3. **Permission Matrix**
   ```
   | Resource | Owner | Admin | Guest |
   |----------|-------|-------|-------|
   | Own Quote | RW | R | - |
   | All Quotes | - | RW | - |
   | Company Info | Owner | RW | R |
   | Client Info | Owner | RW | - |
   ```

---

## 8.2 Secrets Management

### NEVER commit:

❌ API keys  
❌ Database passwords  
❌ Auth tokens  
❌ Private keys  
❌ Gemini API keys  
❌ Supabase keys  

### Store secrets in:

✅ `.env` file (local, not committed)  
✅ GitHub Secrets (for CI/CD)  
✅ Environment variables (production)  
✅ Secrets manager (future)  

### Environment Variables

```env
# .env (NEVER commit)
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyxxx
VITE_GEMINI_API_KEY=AIzaSyxxx

# Public (safe to commit)
VITE_APP_NAME=Quote Buddy
VITE_APP_VERSION=1.0.0
VITE_LOG_LEVEL=info
```

### Secrets in Code

```typescript
// ❌ WRONG
const API_KEY = 'AIzaSyxxx';
const PASSWORD = 'admin123';

// ✅ CORRECT
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const PASSWORD = process.env.ADMIN_PASSWORD;

// Type-safe secrets
declare global {
  namespace ImportMeta {
    readonly env: {
      readonly VITE_SUPABASE_URL: string;
      readonly VITE_SUPABASE_ANON_KEY: string;
      // ... etc
    }
  }
}
```

---

## 8.3 Input Validation

### Validate Everything

```typescript
// ❌ WRONG - No validation
async function createQuote(input: any) {
  // What if input.lineItems is null?
  // What if input.total is negative?
  // What if input.clientEmail is "' OR '1'='1"?
}

// ✅ CORRECT - Explicit validation
async function createQuote(input: CreateQuoteInput): Promise<Result<Quote>> {
  // 1. Type check
  if (!input || typeof input !== 'object') {
    return Err(new ValidationError('Invalid input'));
  }
  
  // 2. Required fields
  if (!input.clientEmail?.trim()) {
    return Err(new ValidationError('Client email required'));
  }
  
  // 3. Format validation
  if (!isValidEmail(input.clientEmail)) {
    return Err(new ValidationError('Invalid email format'));
  }
  
  // 4. Business rule validation
  if (input.lineItems.length === 0) {
    return Err(new ValidationError('At least one line item required'));
  }
  
  // 5. Safe to use
  return Ok(createQuoteInternal(input));
}
```

### Sanitization

```typescript
// Sanitize user input
function sanitizeClientName(name: string): string {
  return name
    .trim()
    .substring(0, 100)  // Length limit
    .replace(/[<>]/g, '');  // Remove HTML characters
}

// Sanitize file uploads
async function validateUploadedFile(file: File): Promise<Result<File>> {
  // Check MIME type
  if (!file.type.startsWith('application/pdf')) {
    return Err(new ValidationError('Only PDF files allowed'));
  }
  
  // Check file size
  const MAX_SIZE = 50 * 1024 * 1024;  // 50MB
  if (file.size > MAX_SIZE) {
    return Err(new ValidationError('File too large'));
  }
  
  return Ok(file);
}
```

---

## 8.4 Data Protection

### PII Handling

**Never log:**
- Email addresses
- Phone numbers
- Client names
- Company names
- GST numbers
- Pricing information

**If logging needed:**
```typescript
// Sanitize before logging
function sanitizeForLogging(data: Quote): object {
  return {
    id: data.id,
    status: data.status,
    lineItemCount: data.lineItems.length,
    totalAmount: '***REDACTED***',  // Never log actual amounts
  };
}

// Log safely
logger.info('Quote created', sanitizeForLogging(quote));
```

### Database Encryption

- All connections use HTTPS
- Supabase provides encryption at rest
- Passwords hashed with bcrypt
- No PII in query parameters

---

## 8.5 Rate Limiting

### API Rate Limits

```typescript
// Gemini API
const GEMINI_RATE_LIMIT = {
  CALLS_PER_MINUTE: 60,
  CALLS_PER_DAY: 1000,
  TIMEOUT_MS: 60000,
};

// Supabase API
const SUPABASE_RATE_LIMIT = {
  CALLS_PER_MINUTE: 300,
  TIMEOUT_MS: 30000,
  RETRY_COUNT: 3,
  RETRY_DELAY_MS: 1000,
};

// Implementation
async function callGeminiWithRateLimit(
  input: string,
): Promise<Result<string>> {
  const allowed = await rateLimiter.checkLimit('gemini', userId);
  if (!allowed) {
    return Err(new RateLimitError('API rate limit exceeded'));
  }
  
  try {
    const result = await callGemini(input);
    rateLimiter.recordCall('gemini', userId);
    return Ok(result);
  } catch (err) {
    return Err(translateError(err));
  }
}
```

---

## 8.6 Dependency Security

### Automatic Checks

```yaml
# GitHub Actions runs:
- npm audit              # Security vulnerabilities
- Snyk scan              # Known vulnerabilities
- OWASP dependency check # Common weaknesses
```

### Manual Review

Before adding dependency:

1. Run `npm audit` locally
2. Check vulnerabilities at npm.im/package-name
3. Review package maintainer
4. Check GitHub issues (quality signal)
5. Get approval from architect

### Outdated Packages

- Run `npm outdated` monthly
- Update patch versions regularly
- Review major version updates
- Security updates immediate

---

# PART 9: TESTING GOVERNANCE

## 9.1 Testing Strategy (COMPREHENSIVE)

### Test Pyramid (BY COVERAGE %)

```
          /\
         /  \  Manual Testing (5%)
        /    \
       /──────\
      /        \  E2E Tests (15%)
     /          \
    /────────────\
   /              \  Integration Tests (30%)
  /                \
 /──────────────────\
/                    \  Unit Tests (50%)
 ───────────────────
```

**Total Target: >80% code coverage**

### Test Categories

| Test Type | Coverage | Speed | Cost | Purpose |
|---|---|---|---|---|
| Unit | High | Fast (ms) | Low | Function correctness |
| Integration | Medium | Medium (s) | Medium | Module interaction |
| E2E | Low | Slow (min) | High | User workflow |
| Contract | Medium | Fast | Low | API compliance |
| Regression | High | Medium | Low | No backwards breaks |
| Smoke | Medium | Medium | Medium | Core functionality |
| Performance | Low | Medium | Medium | Speed/memory |
| Security | High | Medium | High | Security issues |
| Visual | Low | Medium | High | UI consistency |

---

## 9.2 Unit Testing (MANDATORY)

### Coverage Requirements

- **Services**: 90% coverage
- **Utils**: 85% coverage
- **Hooks**: 80% coverage
- **Components**: 75% coverage

### Unit Test Template

```typescript
// src/services/__tests__/quoteService.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  calculateQuoteTotal,
  validateQuoteBeforeSending,
  createQuote,
} from '../quoteService';

describe('quoteService', () => {
  describe('calculateQuoteTotal', () => {
    it('should calculate total without GST', () => {
      const quote = {
        lineItems: [
          { price: 100, quantity: 2 },
          { price: 50, quantity: 1 },
        ],
        settings: { enableGST: false },
      };
      
      const result = calculateQuoteTotal(quote);
      
      expect(result.subtotal).toBe(250);
      expect(result.gst).toBe(0);
      expect(result.total).toBe(250);
    });
    
    it('should calculate total with GST', () => {
      const quote = {
        lineItems: [{ price: 100, quantity: 1 }],
        settings: { enableGST: true },
      };
      
      const result = calculateQuoteTotal(quote);
      
      expect(result.subtotal).toBe(100);
      expect(result.gst).toBe(10);  // 100 * 0.10
      expect(result.total).toBe(110);
    });
    
    it('should handle empty line items', () => {
      const quote = {
        lineItems: [],
        settings: { enableGST: true },
      };
      
      const result = calculateQuoteTotal(quote);
      
      expect(result.subtotal).toBe(0);
      expect(result.gst).toBe(0);
      expect(result.total).toBe(0);
    });
    
    it('should handle decimal rounding correctly', () => {
      const quote = {
        lineItems: [{ price: 33.33, quantity: 3 }],
        settings: { enableGST: true },
      };
      
      const result = calculateQuoteTotal(quote);
      
      // 33.33 * 3 = 99.99, GST = 9.999 → rounds to 10.00
      expect(result.subtotal).toBeCloseTo(99.99, 2);
      expect(result.total).toBeCloseTo(109.99, 2);
    });
  });
  
  describe('validateQuoteBeforeSending', () => {
    it('should reject quote without client info', () => {
      const quote = {
        lineItems: [{ price: 100, quantity: 1 }],
        clientInfo: null,
      };
      
      const errors = validateQuoteBeforeSending(quote);
      
      expect(errors).toContainEqual(
        expect.objectContaining({
          field: 'clientInfo',
          message: 'Client information required',
        })
      );
    });
    
    it('should reject quote with invalid client email', () => {
      const quote = {
        lineItems: [{ price: 100, quantity: 1 }],
        clientInfo: { email: 'not-an-email' },
      };
      
      const errors = validateQuoteBeforeSending(quote);
      
      expect(errors).toContainEqual(
        expect.objectContaining({
          field: 'clientInfo.email',
          message: 'Invalid email format',
        })
      );
    });
  });
});
```

---

## 9.3 Integration Testing

### Integration Test Example

```typescript
// src/services/__tests__/quoteService.integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createQuote, persistQuote, retrieveQuote } from '../quoteService';
import { createMockSupabaseClient } from '../__mocks__/supabaseClient';

describe('quoteService (Integration)', () => {
  let supabase: any;
  
  beforeEach(() => {
    supabase = createMockSupabaseClient();
  });
  
  afterEach(async () => {
    await supabase.cleanup();
  });
  
  it('should persist and retrieve quote', async () => {
    // 1. Create quote
    const newQuote = await createQuote({
      clientInfo: { email: 'test@example.com' },
      lineItems: [{ price: 100, quantity: 1 }],
    });
    expect(newQuote.ok).toBe(true);
    
    // 2. Verify persisted
    const retrieved = await retrieveQuote(newQuote.value.id);
    expect(retrieved.ok).toBe(true);
    expect(retrieved.value.id).toBe(newQuote.value.id);
    expect(retrieved.value.clientInfo.email).toBe('test@example.com');
  });
  
  it('should fail if Supabase is unavailable', async () => {
    supabase.setDown(true);
    
    const result = await createQuote({
      clientInfo: { email: 'test@example.com' },
      lineItems: [{ price: 100, quantity: 1 }],
    });
    
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      type: 'ServiceUnavailable',
    });
  });
});
```

---

## 9.4 E2E Testing (Critical Paths)

### Feature-Based E2E Tests

```typescript
// e2e/quote-creation.e2e.ts
import { test, expect } from '@playwright/test';

test.describe('Quote Creation Workflow', () => {
  test('user can create quote from proposal', async ({ page }) => {
    // 1. Login
    await page.goto('http://localhost:5173/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'password123');
    await page.click('button:has-text("Login")');
    
    // 2. Wait for redirect
    await page.waitForURL('/');
    
    // 3. Navigate to documents
    await page.click('a:has-text("Documents")');
    await page.waitForURL('/documents');
    
    // 4. Upload PDF
    const fileInput = await page.$('input[type="file"]');
    await fileInput.setInputFiles('test-proposal.pdf');
    
    // 5. Wait for upload complete
    await page.waitForSelector('[data-testid="upload-success"]');
    
    // 6. Navigate to quote creation
    await page.click('button:has-text("Generate Quote")');
    await page.waitForURL('/quote');
    
    // 7. Verify AI generated quote
    await page.waitForSelector('[data-testid="quote-preview"]');
    const lineItemCount = await page.locator('[data-testid="line-item"]').count();
    expect(lineItemCount).toBeGreaterThan(0);
    
    // 8. Verify total calculation
    const total = await page.locator('[data-testid="quote-total"]').textContent();
    expect(total).toMatch(/\$\d+\.\d{2}/);
    
    // 9. Add client info
    await page.fill('input[name="clientEmail"]', 'client@example.com');
    await page.fill('input[name="clientName"]', 'Acme Corp');
    
    // 10. Submit quote
    await page.click('button:has-text("Send Quote")');
    
    // 11. Verify success
    await page.waitForSelector('[data-testid="quote-sent-notification"]');
  });
});
```

---

## 9.5 Regression Testing

### Regression Test Matrix

Every critical feature must have regression tests:

```typescript
// Features requiring regression tests
const REGRESSION_TEST_REQUIRED = {
  'Quote Calculation': {
    fixtures: ['simple-quote', 'complex-quote-with-gst'],
    shouldNotChange: ['total', 'subtotal', 'gst'],
  },
  'PDF Upload': {
    fixtures: ['single-page-pdf', 'multi-page-pdf'],
    shouldNotChange: ['extractedText', 'pageCount'],
  },
  'Authentication': {
    fixtures: ['valid-credentials', 'invalid-credentials'],
    shouldNotChange: ['tokenGeneration', 'sessionExpiry'],
  },
  'Permission Checks': {
    fixtures: ['own-quote', 'other-user-quote'],
    shouldNotChange: ['accessControl', 'dataIsolation'],
  },
};
```

### Running Regression Tests

```bash
# Before every release
npm run test:regression

# Test results must show ZERO regressions
# If regression found, bug fix required before release
```

---

## 9.6 Test Data & Fixtures

### Fixture Strategy

```typescript
// tests/fixtures/quotes.ts
export const QUOTE_FIXTURES = {
  simpleQuote: {
    lineItems: [{ description: 'Service', price: 100, quantity: 1 }],
    clientInfo: { email: 'client@example.com', name: 'Client' },
    settings: { enableGST: false },
  },
  
  complexQuote: {
    lineItems: [
      { description: 'Item 1', price: 100, quantity: 2 },
      { description: 'Item 2', price: 50, quantity: 1 },
      { description: 'Item 3', price: 75.50, quantity: 3 },
    ],
    clientInfo: { email: 'corp@example.com', name: 'Corporation' },
    settings: { enableGST: true, discount: 0.1 },
  },
  
  edgeCaseQuote: {
    lineItems: [{ description: 'Free item', price: 0, quantity: 1 }],
    clientInfo: { email: 'edge@example.com', name: 'Edge' },
    settings: { enableGST: true },
  },
};

// Usage
it('should calculate complex quote', () => {
  const result = calculateQuoteTotal(QUOTE_FIXTURES.complexQuote);
  expect(result.total).toBe(expectedTotal);
});
```

---

## 9.7 Performance Testing

### Performance Benchmarks

```typescript
// tests/performance/quote-generation.perf.ts
import { bench, describe } from 'vitest';

describe('Performance Benchmarks', () => {
  bench('calculateQuoteTotal with 100 line items', () => {
    const quote = {
      lineItems: Array(100).fill({ price: 100, quantity: 1 }),
      settings: { enableGST: true },
    };
    
    calculateQuoteTotal(quote);
  }, { time: 100 });  // Must complete in <100ms
  
  bench('PDF text extraction - 50 page document', async () => {
    const largeFile = createFile('large-proposal.pdf', 50);
    await extractPDFText(largeFile);
  }, { time: 5000 });  // Must complete in <5s
});
```

---

# PART 10: PRE-PRODUCTION GOVERNANCE

## 10.1 Staging Environment

### Staging ≠ Production

Staging is where we test BEFORE users see it.

```
Dev (Local)     → Broken is OK, fast iteration
    ↓
Staging         → Works like production, test everything
    ↓
Production      → Users see this, must be perfect
```

### Staging Validation Checklist

Before merging to main (production):

```
FUNCTIONALITY:
  [ ] All features work as designed
  [ ] No known bugs
  [ ] Performance acceptable
  [ ] Mobile works (iOS + Android)
  
REGRESSION:
  [ ] Previous features still work
  [ ] No new bugs introduced
  [ ] E2E tests all pass
  [ ] Regression suite green
  
DATA INTEGRITY:
  [ ] Quotes calculate correctly
  [ ] Client data saves correctly
  [ ] No data loss
  [ ] Database migrations successful
  
PERFORMANCE:
  [ ] Page load times acceptable
  [ ] No memory leaks
  [ ] API responses fast
  [ ] Offline sync works
  
SECURITY:
  [ ] Authentication works
  [ ] Permission checks work
  [ ] No secrets exposed
  [ ] HTTPS only
  
MOBILE:
  [ ] Works on iOS
  [ ] Works on Android
  [ ] Offline functionality works
  [ ] Sync when back online works
```

---

## 10.2 Pre-Production Test Suite (Automated)

### Automated Pre-Prod Validation

```yaml
# .github/workflows/pre-prod-validation.yml
name: Pre-Production Validation

on:
  pull_request:
    branches: [main]

jobs:
  validation:
    runs-on: ubuntu-latest
    steps:
      # 1. COMPILE
      - name: TypeScript Compilation
        run: npm run build
        
      # 2. LINT
      - name: ESLint Checks
        run: npm run lint
        
      # 3. TYPE CHECK
      - name: Type Safety
        run: npm run type-check
        
      # 4. UNIT TESTS
      - name: Unit Tests
        run: npm run test:unit
        
      # 5. INTEGRATION TESTS
      - name: Integration Tests
        run: npm run test:integration
        
      # 6. E2E TESTS (Critical paths only)
      - name: E2E Tests
        run: npm run test:e2e:critical
        
      # 7. COVERAGE ANALYSIS
      - name: Coverage Check
        run: npm run test:coverage
        
      # 8. SECURITY SCAN
      - name: Security Audit
        run: npm audit --audit-level=moderate
        
      # 9. DEPENDENCY SCAN
      - name: Dependency Vulnerabilities
        run: npm run security:scan
        
      # 10. PERFORMANCE TEST
      - name: Performance Check
        run: npm run test:performance
        
      # 11. REGRESSION TEST
      - name: Regression Test Suite
        run: npm run test:regression
        
      # 12. BUILD ARTIFACT
      - name: Production Build
        run: npm run build
        
      # 13. BUILD SIZE CHECK
      - name: Bundle Size Check
        run: npm run analyze:bundle
```

---

## 10.3 Manual QA Checklist

**Before every production release, manual QA must verify:**

### Functional Testing

```
☐ Quote Creation
  ☐ Upload PDF successfully
  ☐ AI generates quote correctly
  ☐ Can edit line items
  ☐ Can add/remove line items
  ☐ Total calculates correctly
  ☐ GST calculates correctly
  
☐ Client Management
  ☐ Can add client info
  ☐ Email validation works
  ☐ Phone validation works
  ☐ Can save client
  ☐ Can retrieve client
  
☐ Quote Sending
  ☐ Can send quote to client
  ☐ Client receives email
  ☐ Client can view quote
  ☐ Status updates to "Sent"
  
☐ PDF Export
  ☐ Quote exports to PDF
  ☐ PDF looks correct
  ☐ All data present in PDF
  ☐ PDF opens in reader
  
☐ Authentication
  ☐ Login works
  ☐ Logout works
  ☐ Session persists
  ☐ Unauthorized access blocked
```

### Cross-Browser Testing

```
☐ Chrome (latest)
☐ Firefox (latest)
☐ Safari (latest)
☐ Edge (latest)
☐ iOS Safari
☐ Android Chrome
```

### Edge Case Testing

```
☐ Empty inputs (no line items, no client)
☐ Large inputs (100+ line items, 10MB PDF)
☐ Special characters in client name
☐ Concurrent quote creation
☐ Network interruption during upload
☐ Browser storage full
☐ Very old PDF format
☐ Password-protected PDF (should fail gracefully)
```

---

## 10.4 Performance Validation

Before production:

```typescript
// Metrics that must be acceptable
const PERFORMANCE_REQUIREMENTS = {
  pageLoadTime: 3000,           // Max 3s
  quoteCalculation: 100,        // Max 100ms
  pdfExtraction: 5000,          // Max 5s
  aiGeneration: 30000,          // Max 30s
  bundleSize: 500000,           // Max 500KB gzip
  memorySafeMode: 100000000,   // Max 100MB
};

// Monitor in production
const PRODUCTION_METRICS = {
  pageLoadTime: 'tracked via monitoring',
  errorRate: '<0.1%',
  quoteSuccess: '>99.9%',
};
```

---

## 10.5 Data Integrity Validation

Before production:

```
☐ Database migrations executed successfully
☐ No data loss from schema changes
☐ Backward compatible with old data
☐ RLS policies correctly enforced
☐ Audit trail accurate
☐ No orphaned records
☐ All foreign keys valid
☐ No NULL where NOT NULL required
```

---

## 10.6 Security Validation

Before production:

```
☐ No hardcoded secrets
☐ No credentials in logs
☐ PII not stored unnecessarily
☐ Password hashing correct
☐ HTTPS only (no HTTP)
☐ CORS correctly configured
☐ API rate limiting works
☐ Input validation complete
☐ SQL injection prevention
☐ XSS prevention
```

---

# PART 11: CI/CD GOVERNANCE

## 11.1 GitHub Actions Pipeline

### Pipeline Architecture

```
┌─────────────────┐
│ Developer Push  │
└────────┬────────┘
         ↓
┌─────────────────────────────────┐
│ PULL REQUEST CI (Auto)          │
│ ✓ TypeScript compile            │
│ ✓ Lint & format                 │
│ ✓ Unit tests                    │
│ ✓ Integration tests             │
│ ✓ Coverage check                │
│ ✓ Security scan                 │
│ ✓ Dependency audit              │
└────────┬────────────────────────┘
         ↓
┌─────────────────────────────────┐
│ CODE REVIEW                     │
│ (Human reviewers)               │
└────────┬────────────────────────┘
         ↓
┌─────────────────────────────────┐
│ APPROVED → MERGE                │
└────────┬────────────────────────┘
         ↓
┌─────────────────────────────────┐
│ MERGE COMMIT CI                 │
│ ✓ Full test suite               │
│ ✓ Build production artifact     │
│ ✓ Deploy to staging             │
└────────┬────────────────────────┘
         ↓
┌─────────────────────────────────┐
│ STAGING VALIDATION              │
│ ✓ E2E tests                     │
│ ✓ Smoke tests                   │
│ ✓ Performance tests             │
│ ✓ Manual QA                     │
└────────┬────────────────────────┘
         ↓
┌─────────────────────────────────┐
│ RELEASE TAG (Manual)            │
│ npm version patch/minor/major   │
└────────┬────────────────────────┘
         ↓
┌─────────────────────────────────┐
│ PRODUCTION DEPLOYMENT CI        │
│ ✓ Blue-green setup              │
│ ✓ Health checks                 │
│ ✓ Monitoring enabled            │
└────────┬────────────────────────┘
         ↓
┌─────────────────────────────────┐
│ PRODUCTION LIVE                 │
│ Users accessing v1.x.x          │
└─────────────────────────────────┘
```

---

## 11.2 GitHub Actions Configuration Files

### File: `.github/workflows/pr-checks.yml`

```yaml
name: PR Validation

on:
  pull_request:
    branches: [develop, staging, main]

jobs:
  check:
    runs-on: ubuntu-latest
    
    strategy:
      matrix:
        node-version: [20.x]
    
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history for better analysis
      
      # 1. Setup
      - name: Setup Node ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
      
      - name: Install Dependencies
        run: npm ci
      
      # 2. TypeScript Compilation
      - name: TypeScript Build Check
        run: npm run build:check
      
      # 3. Linting
      - name: Run ESLint
        run: npm run lint
        continue-on-error: false
      
      # 4. Format Check
      - name: Check Code Format
        run: npm run format:check
      
      # 5. Type Safety
      - name: Type Check
        run: npm run type-check
      
      # 6. Unit Tests
      - name: Run Unit Tests
        run: npm run test:unit
        env:
          NODE_ENV: test
      
      # 7. Integration Tests
      - name: Run Integration Tests
        run: npm run test:integration
        env:
          NODE_ENV: test
      
      # 8. Coverage Report
      - name: Coverage Report
        run: npm run test:coverage
        continue-on-error: true
      
      # 9. Upload Coverage
      - name: Upload Coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json
          fail_ci_if_error: true
      
      # 10. Security Audit
      - name: NPM Audit
        run: npm audit --audit-level=moderate
        continue-on-error: true
      
      # 11. Dependency Vulnerabilities
      - name: Run Security Scan (Snyk)
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        continue-on-error: true
      
      # 12. Duplicate Code Check
      - name: Check for Code Duplication
        run: npm run check:duplicates
        continue-on-error: true
      
      # 13. Production Build
      - name: Production Build
        run: npm run build
      
      # 14. Bundle Size Check
      - name: Bundle Size Analysis
        run: npm run analyze:bundle
        continue-on-error: true
      
      # 15. Artifact for Review
      - name: Upload Build Artifact
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: build-artifact
          path: dist/
          retention-days: 5
```

### File: `.github/workflows/staging-deploy.yml`

```yaml
name: Deploy to Staging

on:
  push:
    branches: [staging]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20.x'
          cache: 'npm'
      
      - name: Install Dependencies
        run: npm ci
      
      - name: Full Test Suite
        run: npm run test:all
        env:
          NODE_ENV: test
      
      - name: Production Build
        run: npm run build
        env:
          VITE_APP_ENV: staging
          VITE_API_URL: ${{ secrets.STAGING_API_URL }}
      
      - name: Deploy to Staging Server
        env:
          STAGING_HOST: ${{ secrets.STAGING_HOST }}
          STAGING_USER: ${{ secrets.STAGING_USER }}
          STAGING_KEY: ${{ secrets.STAGING_KEY }}
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.STAGING_KEY }}" > ~/.ssh/key
          chmod 600 ~/.ssh/key
          rsync -avz --delete -e "ssh -i ~/.ssh/key -o StrictHostKeyChecking=no" dist/ $STAGING_USER@$STAGING_HOST:/app/
      
      - name: E2E Tests Against Staging
        env:
          STAGING_URL: ${{ secrets.STAGING_URL }}
        run: npm run test:e2e
        continue-on-error: true
      
      - name: Smoke Tests
        env:
          STAGING_URL: ${{ secrets.STAGING_URL }}
        run: npm run test:smoke
      
      - name: Notify Slack
        uses: slackapi/slack-github-action@v1
        with:
          payload: |
            {
              "text": "✅ Deployed to Staging",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "Staging deployment successful\n${{ github.server_url }}/${{ github.repository }}/commit/${{ github.sha }}"
                  }
                }
              ]
            }
```

### File: `.github/workflows/production-deploy.yml`

```yaml
name: Production Release

on:
  push:
    tags:
      - 'v*'  # Only on version tags

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20.x'
          cache: 'npm'
      
      - name: Install Dependencies
        run: npm ci
      
      - name: Full Test Suite
        run: npm run test:all
      
      - name: Production Build
        run: npm run build:prod
        env:
          VITE_APP_ENV: production
          VITE_API_URL: ${{ secrets.PROD_API_URL }}
      
      - name: Blue-Green Deployment
        env:
          PROD_HOST: ${{ secrets.PROD_HOST }}
          PROD_USER: ${{ secrets.PROD_USER }}
          PROD_KEY: ${{ secrets.PROD_KEY }}
        run: |
          # Deploy to blue environment (not live)
          # Validate
          # Switch traffic to blue
          # Blue becomes new green for next release
          bash scripts/blue-green-deploy.sh
      
      - name: Health Checks
        run: |
          bash scripts/health-check.sh
      
      - name: Create Release
        uses: actions/create-release@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tag_name: ${{ github.ref }}
          release_name: Release ${{ github.ref }}
          body: |
            See `CHANGELOG.md` for details
          draft: false
          prerelease: false
      
      - name: Notify Slack
        uses: slackapi/slack-github-action@v1
        with:
          payload: |
            {
              "text": "🚀 Production Release ${{ github.ref }}",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "Production deployment complete\n*Version:* ${{ github.ref }}\n*Commit:* ${{ github.sha }}"
                  }
                }
              ]
            }
```

---

## 11.3 Required Status Checks

Every branch must have these checks enabled:

```yaml
# Branch protection settings (main branch)
Required Status Checks:
  - TypeScript Build Check
  - ESLint
  - Unit Tests
  - Integration Tests
  - Coverage (>80%)
  - Security Scan
  - Dependency Audit

Requires:
  - PR reviews: 2
  - Code owners review: Yes
  - Signed commits: Yes
  - Branches up to date: Yes
```

---

# PART 12: DEVELOPER ACCOUNTABILITY

## 12.1 Ownership Model

Every piece of code has an owner.

```
Code Location              → Owned By
src/services/quoteService  → @alice (primary), @bob (backup)
src/pages/QuotePage        → @charlie
src/components/ChatUI      → @diana
```

### Ownership Responsibilities

1. **Code Quality** — Responsible for bugs in your code
2. **Reviews** — Approve changes to your module
3. **Documentation** — Keep technical docs updated
4. **Refactoring** — Proactively improve code health
5. **Testing** — Ensure test coverage maintained
6. **Debugging** — First responder for production issues

### Finding Ownership

```bash
# Who owns this file?
git log --oneline -n 20 src/services/quoteService.ts
# Recent commits show primary author

# Who can approve?
# Check CODEOWNERS file in repo root
```

---

## 12.2 Blame Analysis & Accountability

### Production Issue Investigation

When production bug occurs:

1. **Identify Commit** — Which commit broke it?
   ```bash
   git bisect run npm run test:prod-scenario
   ```

2. **Identify Author** — Who made the change?
   ```bash
   git show <commit-hash>  # See author
   git log --follow -p <file>  # Full history
   ```

3. **Accountability Action**
   - **Honest Mistake** → Learn together, improve process
   - **Negligence** (no tests, ignored review) → Retraining
   - **Repeated Pattern** → Pair programming required
   - **Critical Security** → Escalate to CTO

### No Blame Shifting to AI

If AI generated code that broke production:

1. **Human approved it** → Human is accountable
2. **Human didn't test it** → Human failed
3. **Human didn't review it carefully** → Human failed

AI is a tool. Humans are accountable.

---

## 12.3 Architecture Violation Tracking

Every violation is tracked:

```
Violation              Severity  Developer    Date      Action
No tests on PR         MEDIUM    @alice       2026-05-10  Warning
Used `any` type        MEDIUM    @bob         2026-05-11  Warning
Hardcoded rule         HIGH      @charlie     2026-05-12  Code review req.
Rewrote working code   CRITICAL  @diana       2026-05-13  Revert + meeting
Bypassed security      CRITICAL  @eve         2026-05-14  Escalate to CTO
```

**Three violations in 90 days → Mandatory governance training**

---

## 12.4 Performance Accountability

Measured monthly:

| Metric | Target | Accountability |
|---|---|---|
| Code Review Response Time | <24 hours | Team lead if >48h |
| Test Coverage | >80% | Dev if <70% |
| Bug Fix Time | <7 days | Dev if >14 days |
| Regression Rate | <1% | Dev if >3% |
| Production Incidents | <1/month | Team lead if >2 |

---

# PART 13: PROMPT TEMPLATES

## 13.1 FEATURE DEVELOPMENT PROMPT (For AI Assistants)

**Use this prompt when developing a new feature or modification.**

```
You are a Principal Staff Engineer developing a production-grade SaaS quote generation application.

MISSION: Implement [FEATURE_NAME] following strict enterprise governance.

CONSTRAINTS YOU MUST FOLLOW:
1. Architecture Integrity: Respect module boundaries. Code must follow: Components → State → Services → Data
2. Business Logic Protection: Never duplicate logic. Search codebase first for existing implementations.
3. Type Safety: NO 'any' types. Use proper TypeScript. All functions have type signatures.
4. Testing: Every feature needs unit + integration tests. Target >80% coverage.
5. No Rewrites: Don't rewrite existing working code. Extend or refactor instead.
6. Code Review: Document reasoning for future reviewers.

STEP-BY-STEP PROCESS (MANDATORY):

STEP 1: ANALYZE EXISTING CODE (20 minutes)
---
Analyze:
1. Find existing similar functionality
2. Identify related services (search: "quote", "client", "validation")
3. Understand data flow: Component → Store → Service → API
4. Check for duplicate business logic

Report findings:
- Existing functions you'll reuse:
- Patterns you'll follow:
- Edge cases you found:

STEP 2: UNDERSTAND BUSINESS DOMAIN (15 minutes)
---
Answer:
1. What is the business requirement?
2. What domain rules apply?
3. What validations are needed?
4. What could go wrong?
5. How does this affect other features?

STEP 3: ARCHITECTURE DECISION (10 minutes)
---
Decide:
1. Which layer owns this logic? (Component/Hook/Service)
2. Does it need a new service or extend existing?
3. What state is needed? (Zustand store)
4. What API endpoints are needed?
5. Should this be a utility function or domain logic?

STEP 4: CHECK FOR DUPLICATION (10 minutes)
---
Search codebase:
grep -r "calculateQuoteTotal" src/  # Search similar logic
grep -r "validateClient" src/
grep -r "persistData" src/

If similar logic exists:
- Call existing function instead of rewriting
- If needs extension: extend in SERVICE layer
- NEVER duplicate

STEP 5: DESIGN WITH TYPES (10 minutes)
---
Define TypeScript interfaces:
1. Input type: interface FeatureInput { ... }
2. Output type: interface FeatureOutput { ... }
3. Error type: type FeatureError = ...
4. Use Result<T, E> pattern for error handling

Example:
interface QuoteCalculationInput {
  lineItems: LineItem[];
  enableGST: boolean;
  discount?: number;
}

type QuoteCalculationError = ValidationError | CalculationError | SystemError;

async function calculateQuote(
  input: QuoteCalculationInput
): Promise<Result<QuoteTotal, QuoteCalculationError>> {
  // Implementation
}

STEP 6: IMPLEMENT WITH TESTS (30 minutes)
---
Write test FIRST, then implementation:

1. Create test file: src/services/__tests__/featureService.test.ts
2. Write test cases covering:
   - Happy path (normal case)
   - Edge cases (empty, null, zero)
   - Error cases (validation failure, API error)
   - Boundary conditions
3. Implement service function to pass tests
4. Add integration test
5. Verify >80% coverage

STEP 7: ERROR HANDLING (10 minutes)
---
Every function must handle:
1. Invalid input (return Err)
2. API failures (retry logic)
3. Business rule violation (return Err with reason)
4. Unexpected state (log + fallback)

Never throw in services. Return Result<T, E>.

STEP 8: BACKWARD COMPATIBILITY (5 minutes)
---
Verify:
1. No breaking API changes
2. Old data still works
3. Migration plan if schema changed
4. Rollback strategy

STEP 9: DOCUMENTATION (10 minutes)
---
Document:
1. Function purpose (what, not how)
2. Parameters and return types
3. Possible errors
4. Example usage
5. Business rule this implements

STEP 10: VERIFY BEFORE SUBMISSION
---
Checklist:
- [ ] Code compiles (npm run build)
- [ ] Tests pass (npm run test)
- [ ] Linting passes (npm run lint)
- [ ] Type checking passes (npm run type-check)
- [ ] No console.log statements
- [ ] No hardcoded values
- [ ] Error handling complete
- [ ] Tests cover happy + edge + error paths
- [ ] No duplicate logic detected
- [ ] Follows existing patterns
- [ ] Module boundaries respected

CONFIDENCE SCORE:
Rate your confidence:
- HIGH (>90%): Ready to commit
- MEDIUM (70-90%): Needs human review
- LOW (<70%): Needs expert review + testing

HIGH CONFIDENCE means:
- Tests comprehensive and passing
- No architectural concerns
- Patterns clear and consistent
- No assumptions about external behavior

MEDIUM CONFIDENCE means:
- Some edge cases uncertain
- New pattern or approach
- Complex business logic
- Needs human verification

LOW CONFIDENCE means:
- Major uncertainty about correctness
- Haven't seen this pattern before
- Complex interactions with other systems
- STOP - get human expert before proceeding

OUTPUT FORMAT:
1. Summary of changes
2. Architecture decisions & reasoning
3. Business logic implemented
4. Test coverage summary
5. Confidence score + justification
6. Any blockers or questions for human

WHEN STUCK:
1. Stop and ask human
2. Don't guess about architecture
3. Don't assume business rules
4. Don't skip tests
5. Don't proceed low-confidence changes

Remember: Your job is to create code that works correctly, is maintainable, and respects the product's architectural integrity. Better to ask for help than introduce bugs.
```

---

## 13.2 BUG FIXING PROMPT (For AI Assistants)

```
You are a Principal Staff Engineer fixing a production bug.

BUG REPORT: [ISSUE_DESCRIPTION]

CONSTRAINTS:
1. Minimal change: Fix only the bug, nothing else
2. No rewrites: Don't refactor while fixing
3. Backward compatible: Old data/behavior preserved
4. Tests required: Prove the bug is fixed
5. Regression safe: Verify no new breaks

MANDATORY PROCESS:

STEP 1: REPRODUCE THE BUG (15 minutes)
---
1. Understand the symptom: What goes wrong?
2. Gather reproduction steps
3. Identify affected features
4. Test in different scenarios:
   - Normal case
   - Edge cases
   - Concurrent operations
   - With/without data

Output:
- Exact reproduction steps
- When does it fail?
- When does it work?
- Affected users/scenarios

STEP 2: ROOT CAUSE ANALYSIS (20 minutes)
---
1. Find the buggy code (git blame → who wrote it → why)
2. Understand the intent (read comments, commit history)
3. Find the failure point (debug + add logging)
4. Identify root cause (data flow, logic error, race condition?)
5. Check for similar bugs (is this pattern elsewhere?)

Output:
- Root cause identified
- Location of bug
- Why it happens
- Similar patterns in codebase?

STEP 3: IMPACT ANALYSIS (10 minutes)
---
1. What data could be corrupted?
2. How many users affected?
3. What's the business impact?
4. Are there downstream effects?
5. Does this cause cascading failures?

Output:
- Severity: Critical / High / Medium / Low
- Affected modules
- Downstream impact
- Rollback impact if we fix it

STEP 4: DESIGN THE FIX (15 minutes)
---
1. Minimal fix: What's the smallest change?
2. Preserve behavior: What mustn't change?
3. Type safety: Fix the types too
4. Error handling: What about failure cases?
5. Backward compat: Old data still works?

Output:
- Proposed fix (pseudocode)
- Why this fixes it
- What it doesn't break
- Alternative approaches considered

STEP 5: VERIFY NO REGRESSIONS (10 minutes)
---
1. What tests currently pass?
2. What tests should still pass?
3. Run test suite before fix
4. Run test suite after fix
5. Any new failures?

Output:
- Tests passing before fix
- Tests passing after fix
- No new test failures

STEP 6: WRITE REGRESSION TEST (15 minutes)
---
1. Create test that FAILS with the bug
2. Verify test fails without fix
3. Apply fix
4. Verify test passes with fix
5. Future: This test prevents regression

Test must cover:
- The exact bug scenario
- Edge cases around the bug
- Related functionality that must still work

STEP 7: VERIFY BACKWARD COMPATIBILITY (5 minutes)
---
1. Can old data still be used?
2. Do old API calls still work?
3. Will users' saved quotes still work?
4. Any schema migrations needed?
5. Rollback procedure if needed?

Output:
- Backward compatible: YES / NO
- If NO: Migration plan required
- If rollback needed: Plan documented

STEP 8: FINAL VERIFICATION (10 minutes)
---
Checklist:
- [ ] Bug is reproducible
- [ ] Root cause identified
- [ ] Fix is minimal (one change)
- [ ] Tests pass
- [ ] No new failures
- [ ] Backward compatible
- [ ] Regression test added
- [ ] Rollback plan ready
- [ ] No console.log left behind
- [ ] Types correct
- [ ] Error handling works

OUTPUT FORMAT:
1. Bug description & reproduction
2. Root cause analysis
3. Impact assessment
4. Proposed fix (with reasoning)
5. Test results (before & after)
6. Regression test added
7. Backward compatibility status
8. Rollback plan

WHEN TO STOP AND ASK HUMAN:
1. Root cause unclear
2. Fix requires architecture change
3. Business logic unclear
4. Data integrity at risk
5. Fix would break other features
6. Can't write regression test
```

---

## 13.3 TESTING & VALIDATION PROMPT (For AI Assistants)

```
You are QA Lead testing a feature for production release.

FEATURE: [FEATURE_NAME]
VERSION: [VERSION]
ENVIRONMENT: Staging

MISSION: Validate this feature is production-ready through human-like testing.

TESTING LAYERS:

LAYER 1: UNIT TEST VALIDATION
---
Verify:
1. All functions have unit tests
2. Tests cover happy path
3. Tests cover error cases
4. Tests cover edge cases
5. Coverage >80%

For each function:
- What are valid inputs?
- What are invalid inputs?
- What errors can occur?
- What boundary conditions exist?

Write tests if missing.

LAYER 2: INTEGRATION TESTING
---
Verify:
1. Modules interact correctly
2. Data flows properly
3. State updates correctly
4. API calls work
5. Database persistence works

Test scenarios:
- Create → Read → Update → Delete
- Concurrent operations
- Rollback on failure
- Error recovery

LAYER 3: WORKFLOW TESTING (HUMAN-LIKE)
---
As a user, test complete workflows:

Quote Creation Workflow:
1. User logs in ✓
2. Uploads PDF ✓
3. AI generates quote ✓
4. User edits quote ✓
5. User adds client info ✓
6. User sends quote ✓
7. Quote appears in history ✓
8. User can export to PDF ✓
9. All data saved correctly ✓

Client Management Workflow:
1. Add new client ✓
2. Save client ✓
3. Select saved client ✓
4. Update client info ✓
5. Delete client ✓
6. Client list updates ✓

For each workflow:
- Does it succeed end-to-end?
- Are error messages clear?
- Does the UI guide the user?
- Are edge cases handled gracefully?

LAYER 4: EDGE CASE TESTING
---
Test abnormal scenarios:

Data Edge Cases:
- [ ] Empty inputs (no line items)
- [ ] Null values (missing client email)
- [ ] Very large values (100+ line items)
- [ ] Very small values (0.01 price)
- [ ] Decimal precision (100 items × $33.33)
- [ ] Special characters (client name with quotes)
- [ ] Very long strings (1000+ char description)
- [ ] Unicode characters (€, ¥, §)

User Behavior Edge Cases:
- [ ] User clicks Submit twice
- [ ] User navigates away mid-form
- [ ] User browser refresh
- [ ] User network disconnect
- [ ] User closes app mid-operation
- [ ] User tries to edit after sending
- [ ] User uploads corrupted PDF
- [ ] User uploads huge PDF (50MB)
- [ ] User has poor internet connection
- [ ] User on very old device

Permission Edge Cases:
- [ ] User tries to view other's quote
- [ ] User tries to edit other's quote
- [ ] User logs out while editing
- [ ] User session expires
- [ ] Admin tries operations
- [ ] Guest tries operations

LAYER 5: CROSS-MODULE INTERACTION
---
Verify modules work together:

Quote Module + Auth Module:
- Login required to create quote ✓
- Logout clears quote context ✓
- Permission checks work ✓

Quote Module + PDF Module:
- PDF upload triggers quote generation ✓
- Text extraction is accurate ✓
- Large PDFs don't crash ✓

Quote Module + Client Module:
- Client data loads with quote ✓
- Saving client while creating quote works ✓
- Client updates reflect in quote ✓

LAYER 6: PERMISSION VALIDATION
---
As different user types, verify:

As Quote Owner:
- [ ] Can view own quotes
- [ ] Can edit own quotes
- [ ] Cannot view other's quotes
- [ ] Cannot delete other's quotes
- [ ] Can send quote to client
- [ ] Can accept client response

As Admin:
- [ ] Can view all quotes
- [ ] Can edit any quote
- [ ] Can delete any quote
- [ ] Can see all clients
- [ ] Can see reporting

As Unauthenticated User:
- [ ] Cannot view any quotes
- [ ] Cannot edit anything
- [ ] Redirected to login
- [ ] Cannot access API directly

LAYER 7: API VALIDATION
---
For each API endpoint used:

Endpoint: POST /api/quotes
- [ ] Valid request succeeds
- [ ] Invalid request fails with error
- [ ] Missing fields returns 400
- [ ] Unauthorized request returns 401
- [ ] Invalid data returns 422
- [ ] Rate limiting works
- [ ] Response time <1s

For each endpoint:
- Document request/response
- Test error cases
- Verify status codes
- Check error messages

LAYER 8: DATABASE VALIDATION
---
Verify:
1. Data persists (create quote, refresh page, quote still there)
2. Data updates (edit quote, verify changes saved)
3. Data deletes (delete quote, verify gone)
4. Relationships work (quote ← client)
5. No orphaned data
6. Audit trail accurate (created_at, updated_by)
7. RLS prevents unauthorized access
8. Transaction integrity (all or nothing)

LAYER 9: PERFORMANCE VALIDATION
---
Measure:

Page Load: <3s
Quote Calculation: <100ms
PDF Upload: <30s for 50MB
PDF Text Extraction: <5s
AI Quote Generation: <30s
Query Response: <500ms
Bundle Size: <500KB gzip

If any exceeds target:
- Identify bottleneck
- Propose optimization
- Verify acceptable for users

LAYER 10: VISUAL & UX VALIDATION
---
Check:
1. All text readable
2. Buttons responsive
3. Forms make sense
4. Error messages helpful
5. Success messages clear
6. Loading indicators present
7. Consistent styling
8. Mobile responsive
9. Keyboard navigation works
10. Accessibility (WCAG AA)

LAYER 11: REGRESSION VALIDATION
---
Verify existing features still work:

Old Feature: Quote Calculation
- [ ] Still calculates correctly
- [ ] GST still applies
- [ ] Discount still works

Old Feature: PDF Export
- [ ] Still exports to PDF
- [ ] PDF looks correct
- [ ] All data included

Old Feature: Authentication
- [ ] Login still works
- [ ] Logout still works
- [ ] Sessions persist

Old Feature: Data Sync
- [ ] Offline works
- [ ] Syncs when online
- [ ] No data loss

LAYER 12: PRODUCTION READINESS SCORE
---
Rate feature on each dimension:

Functionality: [ ] Works correctly
Edge Cases: [ ] Handled gracefully
Performance: [ ] Meets targets
Security: [ ] Validated and secure
Testing: [ ] >80% coverage
Documentation: [ ] Clear and complete
Accessibility: [ ] WCAG AA compliant
Mobile: [ ] Works on iOS + Android
Offline: [ ] Functions offline
Error Handling: [ ] All paths handled

Score: (Checkmarks / 10) × 100%
- 90-100%: Ready for production ✓
- 70-89%: Needs fixes before production ⚠
- <70%: Not ready, major work needed ✗

FINAL VALIDATION REPORT:
1. Features validated
2. Edge cases tested
3. Workflows successful
4. No regressions
5. Performance acceptable
6. Confidence score: __/100
7. Ready for production: YES / NO
8. Recommended fixes (if any)
9. Risk assessment
10. Post-release monitoring plan

WHEN TO REJECT:
- Edge cases unhandled
- Performance unacceptable
- Regressions found
- Security issues
- Data loss possible
- User experience poor
- Test coverage <70%

MUST HAVE BEFORE PRODUCTION:
- 100% of UI workflows tested
- All edge cases handled
- Zero known bugs
- Regression tests green
- Performance validated
- Security reviewed
- Mobile tested (iOS + Android)
- Offline functionality verified
- Accessibility checked
- Error messages clear
```

---

# PART 14: IMPLEMENTATION ROADMAP

## 14.1 Phase-Based Rollout (8 Weeks)

### PHASE 1: Foundation (Week 1-2) — QUICK WINS

**Goal:** Establish governance infrastructure

**Week 1:**
- [ ] Create `.governance` folder structure
- [ ] Deploy this `claude.md` file
- [ ] Create CODEOWNERS file (ownership model)
- [ ] Setup GitHub branch protection rules
- [ ] Create PR template
- [ ] Document business rules (BUSINESS_RULES.md)

**Week 2:**
- [ ] Add TypeScript strict mode to tsconfig.json
- [ ] Add ESLint rules (no `any`, no console.log)
- [ ] Add code duplication detection
- [ ] Create GitHub Actions for PR checks
- [ ] Add pre-commit hooks (lint on commit)
- [ ] Create test fixtures and mocks

**Success Metrics:**
- ✅ Branch protection enforced
- ✅ PR template used on all PRs
- ✅ Zero `any` types in new code
- ✅ GitHub Actions running

---

### PHASE 2: Testing Infrastructure (Week 3)

**Goal:** Establish testing governance

**Week 3:**
- [ ] Setup Vitest (unit testing framework)
- [ ] Create test template files
- [ ] Add integration test examples
- [ ] Add E2E test framework (Playwright)
- [ ] Configure coverage reporting
- [ ] Create test data factories
- [ ] Add pre-commit test hooks
- [ ] Document testing strategy

**Success Metrics:**
- ✅ >50% test coverage across services
- ✅ All critical paths have tests
- ✅ Coverage reports automated
- ✅ Tests run in CI/CD pipeline

---

### PHASE 3: CI/CD Pipeline (Week 4)

**Goal:** Automated validation

**Week 4:**
- [ ] Create `.github/workflows/` directory
- [ ] Deploy pr-checks.yml workflow
- [ ] Deploy staging-deploy.yml workflow
- [ ] Deploy production-deploy.yml workflow
- [ ] Setup Slack notifications
- [ ] Add security scanning (Snyk)
- [ ] Add bundle size analysis
- [ ] Create health check scripts

**Success Metrics:**
- ✅ Every PR automatically validated
- ✅ No manual merge to main
- ✅ Staging deploys automatically on merge to staging
- ✅ Security vulnerabilities detected

---

### PHASE 4: Architecture Enforcement (Week 5)

**Goal:** Prevent architecture drift

**Week 5:**
- [ ] Create folder structure validation script
- [ ] Add dependency rule enforcement
- [ ] Document module boundaries
- [ ] Create anti-pattern detection script
- [ ] Add architecture decision templates
- [ ] Review existing code for violations
- [ ] Fix architectural debt (estimate)

**Success Metrics:**
- ✅ No circular dependencies
- ✅ Module boundaries respected
- ✅ Business logic in services (not components)
- ✅ API design consistent

---

### PHASE 5: Business Logic Governance (Week 6)

**Goal:** Protect business rules

**Week 6:**
- [ ] Document all business rules (BUSINESS_RULES.md)
- [ ] Create business rule registry
- [ ] Identify scattered business logic
- [ ] Consolidate duplicate calculations
- [ ] Create business logic tests
- [ ] Audit existing quote calculations
- [ ] Document pricing rules
- [ ] Create validation layer tests

**Success Metrics:**
- ✅ All business rules documented
- ✅ No duplicate logic in codebase
- ✅ 100% of business rules tested
- ✅ Business rule changes require approval

---

### PHASE 6: AI Governance (Week 7)

**Goal:** Control AI-assisted development

**Week 7:**
- [ ] Create AI governance rules (PART 5)
- [ ] Document AI verification checklist
- [ ] Create confidence scoring system
- [ ] Setup unsafe edit detection
- [ ] Train developers on AI governance
- [ ] Create AI code review guidelines
- [ ] Document hallucination prevention
- [ ] Create AI testing requirements

**Success Metrics:**
- ✅ All AI code requires verification
- ✅ No AI code merged without tests
- ✅ Unsafe edits flagged automatically
- ✅ Developers trained on AI governance

---

### PHASE 7: Pre-Production Validation (Week 8)

**Goal:** Production readiness

**Week 8:**
- [ ] Create pre-prod validation checklist
- [ ] Setup staging environment
- [ ] Create E2E test suite
- [ ] Create smoke test suite
- [ ] Create regression test suite
- [ ] Setup monitoring/alerting
- [ ] Create runbooks for common issues
- [ ] Document release procedure

**Success Metrics:**
- ✅ Staging validates all features
- ✅ Zero production bugs from staged features
- ✅ Release procedure documented
- ✅ Rollback procedure tested

---

### PHASE 8: Continuous Improvement (Week 9+)

**Goal:** Mature governance

**Ongoing:**
- Monitor metrics (coverage, incidents, velocity)
- Update governance based on learnings
- Team retrospectives on governance
- Quarterly architecture reviews
- Annual security audit
- Dependency updates
- Performance optimization

---

## 14.2 Quick Wins (Implement This Week)

### 1. Create TypeScript Strict Mode ⚡

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true
  }
}
```

### 2. Add CODEOWNERS File ⚡

```
# .github/CODEOWNERS

# Services
src/services/quoteService.ts          @alice @bob
src/services/authService.ts           @charlie
src/services/geminiService.ts         @diana
src/services/companyService.ts        @eve

# Pages
src/pages/QuotePage.tsx               @alice
src/pages/DocumentsPage.tsx           @bob
src/pages/LoginPage.tsx               @charlie

# Store
src/store/                            @alice

# Tests
tests/                                @bob

# Governance
.governance/                          @alice @charlie
```

### 3. Create PR Template ⚡

```
# .github/pull_request_template.md
[See PART 6 above - Copy the full PR template]
```

### 4. Create ESLint Rules ⚡

```javascript
// .eslintrc.cjs
module.exports = {
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-debugger': 'error',
    '@typescript-eslint/no-unused-vars': 'error',
    'no-var': 'error',
    'prefer-const': 'error',
    '@typescript-eslint/explicit-function-return-types': [
      'error',
      {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
        allowHigherOrderFunctions: true,
      },
    ],
  },
};
```

### 5. Create Business Rules Registry ⚡

```markdown
# .governance/BUSINESS_RULES.md

## Quote Calculation Rule
- **Name:** QUOTE_TOTAL_CALCULATION
- **Description:** Total = Sum(LineItems × Quantity) + GST
- **Implementation:** src/services/quoteService.ts:calculateQuoteTotal()
- **Tests:** tests/services/quoteService.test.ts:L42-67
- **Last Modified:** 2026-05-15
- **Modified By:** alice@company.com
- **Reason:** No longer rounding to nearest dollar

## Client Email Validation
- **Name:** CLIENT_EMAIL_VALIDATION
- **Description:** Email must match RFC 5322 format
- **Implementation:** src/services/clientService.ts:validateEmail()
- **Tests:** tests/services/clientService.test.ts:L100-130
- **Last Modified:** 2026-05-10
- **Modified By:** bob@company.com
- **Reason:** Added international domain support
```

### 6. Add Pre-Commit Hook ⚡

```bash
#!/bin/sh
# .git/hooks/pre-commit

npm run lint --fix
npm run type-check
npm run test:unit

if [ $? -ne 0 ]; then
  echo "❌ Pre-commit checks failed"
  exit 1
fi
```

---

## 14.3 High-Priority Enforcement (Weeks 1-4)

| Priority | Item | Week | Owner | Status |
|----------|------|------|-------|--------|
| CRITICAL | TypeScript strict mode | 1 | @alice | 🔴 |
| CRITICAL | PR template enforced | 1 | @alice | 🔴 |
| CRITICAL | Branch protection | 1 | @alice | 🔴 |
| CRITICAL | GitHub Actions CI/CD | 2 | @bob | 🔴 |
| HIGH | No `any` types rule | 2 | @alice | 🔴 |
| HIGH | Test coverage requirement | 3 | @bob | 🔴 |
| HIGH | Business rules documented | 3 | @charlie | 🔴 |
| HIGH | ESLint rules | 2 | @alice | 🔴 |
| MEDIUM | CODEOWNERS file | 1 | @alice | 🔴 |
| MEDIUM | Pre-commit hooks | 2 | @bob | 🔴 |

---

## 14.4 Success Metrics (Month 1)

```
GOVERNANCE ADOPTION:
✅ 100% of PRs use template
✅ 0% bypass branch protection
✅ 100% of code reviewed before merge
✅ 0 violations of "no any" type rule

CODE QUALITY:
✅ >80% test coverage (was 45%)
✅ 0 duplicate business logic violations
✅ 0 architectural boundary violations
✅ All TypeScript strict checks passing

VELOCITY:
✅ No increase in PR review time
✅ CI/CD time <10 minutes (was 20)
✅ Zero merge conflicts from governance rules
✅ Developer satisfaction maintained

PRODUCTION STABILITY:
✅ <1 production bug per week (was 3-4)
✅ 100% production uptime (was 99.2%)
✅ 0 data integrity incidents
✅ Rollback required <1% of releases
```

---

## 14.5 Common Implementation Mistakes (AVOID)

❌ **DON'T:** Force governance overnight - phased rollout
❌ **DON'T:** Make rules more strict than necessary - reasonable standards
❌ **DON'T:** Blame developers - help them succeed
❌ **DON'T:** Skip testing governance - most important part
❌ **DON'T:** Overautomation - humans make final decisions
❌ **DON'T:** Document without implementing - governance is action
❌ **DON'T:** Forget about mobile - included in all testing
❌ **DON'T:** Assume AI follows rules - verify every time
❌ **DON'T:** Deploy Friday - have patience
❌ **DON'T:** Ignore team feedback - governance is collaborative

---

## 14.6 Governance Maintenance

### Quarterly Reviews
- Audit new violations
- Update governance based on lessons learned
- Adjust thresholds if too strict/loose
- Review team feedback
- Update documentation

### Annual Audit
- Full security review
- Performance audit
- Architecture review
- Dependency audit
- Team retrospective

### When Governance Breaks
1. Investigate root cause
2. Don't blame people, fix systems
3. Update governance to prevent
4. Learn and improve
5. Update this document

---

# CONCLUSION

This governance document is:

✅ **Complete** — Covers all aspects of production software development  
✅ **Practical** — Implementation-ready, not theoretical  
✅ **Enforceable** — Automated checks + human review  
✅ **Evolvable** — Update based on learnings  
✅ **Fair** — Reasonable standards, help developers succeed  

**This is the Constitution for Quote Buddy development.**

Every developer, AI assistant, code reviewer, and leader must know and follow this document.

**Non-negotiable rules:**
1. No hardcoded business rules
2. No duplicate logic
3. No skipped tests
4. No architectural violations
5. No shortcuts to production

**Our promise:**
- Build a product we're proud of
- Maintain code quality long-term
- Prevent regressions and bugs
- Enable team to move fast with confidence
- Deliver reliability to users

---

**Document Version:** 1.0.0  
**Last Updated:** May 18, 2026  
**Next Review:** August 18, 2026  
**Governance Lead:** Principal Staff Engineer + CTO  
**Questions?** Escalate to governance team via GitHub Issues
