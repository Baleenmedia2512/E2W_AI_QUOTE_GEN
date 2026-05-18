# TESTING ARCHITECTURE & STRATEGY

**Quote Buddy** — Enterprise-grade testing governance

---

## TEST PYRAMID SUMMARY

```
          /\
         /  \  Manual Testing (5%)
        /    \ - Human QA
       /──────\ - Exploratory testing
      /        \
     /          \  E2E Tests (15%)
    /            \ - Playwright
   /──────────────\ - Critical workflows
  /                \
 /  Integration     \  Integration Tests (30%)
/     Tests         \ - Module interactions
 ───────────────────  - API mocking
 ─────────────────────
   Unit Tests       - Service layer (50%)
   Coverage: >80%   - Util functions
                    - Domain logic
```

**Total Target: >80% code coverage**

---

## TESTING STRUCTURE

```
tests/
├── unit/
│   ├── services/
│   │   ├── quoteService.test.ts          (90%+ coverage)
│   │   ├── clientService.test.ts         (90%+ coverage)
│   │   ├── authService.test.ts           (90%+ coverage)
│   │   └── __mocks__/
│   │       ├── supabaseClient.ts
│   │       ├── geminiService.ts
│   │       └── ...
│   ├── utils/
│   │   ├── pdfUtils.test.ts              (85%+ coverage)
│   │   ├── dateUtils.test.ts
│   │   └── ...
│   └── hooks/
│       ├── useCompanySync.test.ts        (80%+ coverage)
│       └── ...
│
├── integration/
│   ├── quote-creation.integration.test.ts
│   ├── client-management.integration.test.ts
│   └── auth-flow.integration.test.ts
│
├── e2e/
│   ├── quote-workflow.e2e.ts             (Playwright)
│   ├── pdf-upload.e2e.ts
│   └── authentication.e2e.ts
│
├── fixtures/
│   ├── quotes.ts                         (Quote test data)
│   ├── clients.ts
│   ├── users.ts
│   └── ...
│
└── utils/
    ├── testHelpers.ts
    ├── mockFactory.ts
    └── waitHelpers.ts
```

---

## UNIT TEST REQUIREMENTS

Every service must have unit tests.

### Coverage Requirements by Module

| Module Type | Coverage Target | Examples |
|---|---|---|
| Services | 90%+ | quoteService, clientService |
| Utilities | 85%+ | dateUtils, pdfUtils |
| Hooks | 80%+ | useCompanySync |
| Components | 75%+ | QuoteForm, ClientInfo |
| Stores | 85%+ | Zustand stores |

### Test Template (Vitest)

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  calculateQuoteTotal,
  validateQuote,
  createQuote,
} from '../quoteService';
import { QUOTE_FIXTURES } from '../../fixtures/quotes';

describe('quoteService', () => {
  // HAPPY PATH
  describe('calculateQuoteTotal', () => {
    it('should calculate total correctly with GST', () => {
      const result = calculateQuoteTotal(QUOTE_FIXTURES.simpleQuote);
      
      expect(result.subtotal).toBe(100);
      expect(result.gst).toBe(10);
      expect(result.total).toBe(110);
    });
  });

  // EDGE CASES
  describe('Edge cases', () => {
    it('should handle empty line items', () => {
      const quote = { ...QUOTE_FIXTURES.emptyQuote };
      const result = calculateQuoteTotal(quote);
      
      expect(result.total).toBe(0);
    });

    it('should handle decimal precision', () => {
      const quote = {
        ...QUOTE_FIXTURES.simpleQuote,
        lineItems: [{ price: 33.33, quantity: 3 }],
      };
      
      const result = calculateQuoteTotal(quote);
      expect(result.total).toBeCloseTo(109.99, 2);
    });
  });

  // ERROR CASES
  describe('Error handling', () => {
    it('should return error for invalid input', () => {
      const result = validateQuote(null);
      
      expect(result.ok).toBe(false);
      expect(result.error).toMatchObject({
        type: 'ValidationError',
      });
    });
  });
});
```

---

## INTEGRATION TEST REQUIREMENTS

### When to Write Integration Tests

- Module interaction (Service A calls Service B)
- Store updates affect UI
- Supabase calls with real schema
- Multi-step workflows

### Integration Test Example

```typescript
describe('Quote Creation (Integration)', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    mockSupabase = createMockSupabaseClient();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await mockSupabase.cleanup();
  });

  it('should create quote and update store', async () => {
    // 1. Create quote
    const newQuote = await createQuote({
      clientInfo: { email: 'test@example.com' },
      lineItems: [{ description: 'Service', price: 100, quantity: 1 }],
    });

    expect(newQuote.ok).toBe(true);

    // 2. Verify stored
    const retrieved = await retrieveQuote(newQuote.value.id);
    expect(retrieved.ok).toBe(true);
    expect(retrieved.value.clientInfo.email).toBe('test@example.com');

    // 3. Verify store updated
    const store = useQuoteStore.getState();
    expect(store.quotes).toContainEqual(expect.objectContaining({
      id: newQuote.value.id,
    }));
  });
});
```

---

## E2E TEST REQUIREMENTS (Playwright)

### Critical Path Testing

Test complete user workflows end-to-end.

### E2E Test Example

```typescript
import { test, expect } from '@playwright/test';

test.describe('Quote Creation Workflow', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('http://localhost:5173/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'password123');
    await page.click('button:has-text("Login")');
    await page.waitForURL('/');
  });

  test('should create quote from PDF', async ({ page }) => {
    // 1. Navigate to documents
    await page.click('a:has-text("Documents")');
    await page.waitForURL('/documents');

    // 2. Upload PDF
    const fileInput = await page.$('input[type="file"]');
    await fileInput.setInputFiles('test-proposal.pdf');
    await page.waitForSelector('[data-testid="upload-success"]');

    // 3. Generate quote
    await page.click('button:has-text("Generate Quote")');
    await page.waitForURL('/quote');

    // 4. Verify quote
    const lineItems = await page.locator('[data-testid="line-item"]').count();
    expect(lineItems).toBeGreaterThan(0);

    // 5. Add client info
    await page.fill('input[name="clientEmail"]', 'client@example.com');
    await page.fill('input[name="clientName"]', 'Acme Corp');

    // 6. Submit
    await page.click('button:has-text("Send Quote")');
    await page.waitForSelector('[data-testid="quote-sent"]');
  });
});
```

---

## TESTING COMMAND REFERENCE

```bash
# Unit tests only
npm run test:unit

# Unit tests with coverage
npm run test:coverage

# Integration tests only
npm run test:integration

# E2E tests (requires running app)
npm run test:e2e

# All tests
npm run test

# Watch mode (for development)
npm run test:watch

# Specific test file
npm run test -- quoteService.test.ts

# Tests matching pattern
npm run test -- --grep "calculateTotal"
```

---

## COVERAGE REQUIREMENTS

### Minimum Coverage by Type

```
Services:     90% or higher
Utilities:    85% or higher
Hooks:        80% or higher
Components:   75% or higher
Overall:      80% or higher
```

### Checking Coverage

```bash
# Generate coverage report
npm run test:coverage

# Report shows:
# - Line coverage
# - Branch coverage
# - Function coverage
# - Statement coverage

# Coverage files
# - Coverage/coverage-final.json
# - Coverage/lcov-report/index.html (open in browser)
```

---

## TEST FIXTURES (Sample Data)

### Quote Fixtures

```typescript
// tests/fixtures/quotes.ts
export const QUOTE_FIXTURES = {
  // Simple quote, no GST
  simpleQuote: {
    id: 'quote-1',
    clientInfo: { email: 'test@example.com', name: 'Test Client' },
    lineItems: [
      { id: 'item-1', description: 'Service', price: 100, quantity: 1 },
    ],
    settings: { enableGST: false },
  },

  // Complex quote with GST
  complexQuote: {
    id: 'quote-2',
    clientInfo: { email: 'corp@example.com', name: 'Corporation' },
    lineItems: [
      { id: 'item-1', description: 'Service A', price: 100, quantity: 2 },
      { id: 'item-2', description: 'Service B', price: 75.50, quantity: 3 },
    ],
    settings: { enableGST: true, discount: 0.1 },
  },

  // Edge case: empty
  emptyQuote: {
    id: 'quote-3',
    clientInfo: null,
    lineItems: [],
    settings: { enableGST: false },
  },
};
```

---

## MOCKING STRATEGY

### What to Mock

- External APIs (Supabase, Gemini)
- File system operations
- Date/time (use `vi.useFakeTimers()`)
- Network requests (use MSW)

### What NOT to Mock

- Business logic (test actual logic)
- Type definitions
- Constants

### Mock Example

```typescript
import { vi } from 'vitest';

vi.mock('../services/supabaseClient', () => ({
  supabaseClient: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
      insert: vi.fn().mockResolvedValue({ data: {}, error: null }),
      update: vi.fn().mockResolvedValue({ data: {}, error: null }),
    }),
  },
}));
```

---

## CI/CD INTEGRATION

Coverage is checked automatically:

```yaml
# In GitHub Actions
- name: Check Coverage
  run: npm run test:coverage
  env:
    COVERAGE_THRESHOLD: 80
```

PRs fail if coverage drops below 80%.

---

## TESTING BEST PRACTICES

### DO ✅

- Test behavior, not implementation
- Test edge cases
- Test error scenarios
- Use meaningful test descriptions
- Keep tests focused (one assertion per test)
- Use test fixtures for common data
- Mock external dependencies
- Use async/await properly

### DON'T ❌

- Test framework implementation
- Test private methods directly
- Use hardcoded test data (use fixtures)
- Mock internal functions
- Write tests that depend on other tests
- Test multiple things in one test
- Ignore async operations
- Use setTimeout in tests (use fake timers)

---

## REGRESSION TEST MATRIX

Every release must run regression tests:

```
Critical Features:
  ✅ Quote calculation (total = sum + gst)
  ✅ PDF upload (accepts valid PDFs)
  ✅ Client creation (stores data)
  ✅ Quote status (state transitions valid)
  ✅ Permissions (users see only own quotes)
  ✅ Authentication (login works)
```

If regression test fails, release is blocked.

---

## PERFORMANCE TEST BASELINE

Measured before each release:

| Operation | Target | Current |
|---|---|---|
| Quote calculation (1000 items) | <1s | __ |
| PDF text extraction (50 pages) | <5s | __ |
| AI quote generation | <30s | __ |
| Page load time | <3s | __ |
| API response (average) | <500ms | __ |

If performance degrades >10%, investigate before release.

---

## VISUAL REGRESSION TESTING

For critical UI components:

```bash
# Capture baseline screenshots
npm run test:visual:update

# Compare against baseline
npm run test:visual
```

Visual regressions flag in PR review.
