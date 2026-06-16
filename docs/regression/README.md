# Regression Validation — Test Suite Documentation

**Project:** Quote Buddy (E2W AI Quote Generator)
**Date:** May 21, 2026
**Owner:** QA + DevOps
**Suite size:** 46 test files · ~717 test cases · all green on `npm run test`

---

## 1. What this document is

This folder is the **single source of truth** for everything in `tests/` and `src/**/__tests__/`.
It tells you, for every test:

- **What real production code it protects**
- **How to deliberately break that code to see the test fail**
- **What failure looks like in CI/CD**
- **Whether the test actually defends regression — or is fake coverage**

Use this when you:

- Onboard to QA / DevOps on this repo
- Audit which production logic is *actually* guarded
- Verify that the CI pipeline truly blocks bad deploys (failure-injection drills)
- Review PRs that touch services, stores, or business logic

---

## 2. How to read it (for beginner DevOps engineers)

Every test case in the FULL-depth modules has a **Test Case ID** (e.g. `TC_AUTH_001`) and follows the same structure:

| Section | What it tells you |
|---|---|
| **Module** | Which business area (Auth / Quote / Storage / API / UI) |
| **Test File / Production File** | Where the test lives and what file it guards |
| **Purpose** | One-line summary of the functionality protected |
| **Business Logic Protected** | The real production behavior this enforces |
| **Scenario / Input / Expected Result** | What the test does |
| **Current Assertion** | What `expect(...)` checks |
| **Intentional Code Break** | Exact line in production code to change to make the test fail |
| **Expected Failed Test / Failure Message** | What CI will print |
| **Why Failure Matters** | The production bug this prevents |
| **CI/CD Impact** | Whether pipeline / PR / deploy should stop |
| **Manual Validation Steps** | 5-step drill to prove the test still bites |
| **Edge Cases** | null / undefined / async failure / API failure |
| **Test Strength Analysis** | strong · weak · fake coverage · over-mocked |
| **Improvement Suggestions** | What's missing |

Concise modules (utils, components, pages, hooks) use a compact table form with the same regression-critical fields, because their tests are mostly small pure-function checks.

---

## 3. Document layout

| File | Module(s) | Depth | Test count |
|---|---|---|---|
| [services.md](services.md) | authService, companyService, dataSyncService, geminiService, leadService, pdfExportService, supabaseProposalService | **FULL** | 132 |
| [store.md](store.md) | useAppStore, useAuthStore | **FULL** | 71 |
| [auth-and-routing.md](auth-and-routing.md) | PrivateRoute | **FULL** | 7 |
| [utils.md](utils.md) | 11 utility files | CONCISE | ~228 |
| [components.md](components.md) | 13 component files | CONCISE | ~133 |
| [pages.md](pages.md) | DocumentsPage, QuotePage, QuotePreviewPage | CONCISE | 19 |
| [hooks.md](hooks.md) | useCityServiceRegistry, useCompanySync | CONCISE | 18 |
| [constants.md](constants.md) | defaultCompany | CONCISE | 4 |
| [failure-injection-guide.md](failure-injection-guide.md) | All modules | Drill book | — |
| [test-effectiveness-analysis.md](test-effectiveness-analysis.md) | All modules | Audit | — |
| [appendix-duplicates.md](appendix-duplicates.md) | Duplicate test files in `src/__tests__/` | Cleanup | 80 |

---

## 4. Test Case ID convention

```
TC_<MODULE>_<NNN>

Examples:
  TC_AUTH_001     authService login
  TC_STORE_017    appStore quote state
  TC_GEMINI_004   geminiService JSON parser
  TC_UTIL_PDF_023 pdfUtils helpers
```

Per-module ID ranges:

| Range | Module |
|---|---|
| TC_AUTH_001…031 | authService |
| TC_COMP_001…012 | companyService |
| TC_SYNC_001…014 | dataSyncService |
| TC_GEMINI_001…025 | geminiService |
| TC_LEAD_001…014 | leadService |
| TC_PDFEXP_001…014 | pdfExportService |
| TC_SBP_001…022 | supabaseProposalService |
| TC_APPSTORE_001…038 | useAppStore |
| TC_AUTHSTORE_001…033 | useAuthStore |
| TC_ROUTE_001…007 | PrivateRoute |
| TC_UTIL_*_NNN | utilities (see utils.md) |
| TC_UI_*_NNN | components (see components.md) |
| TC_PAGE_*_NNN | pages (see pages.md) |
| TC_HOOK_*_NNN | hooks (see hooks.md) |

---

## 5. CI/CD regression flow

```
            ┌───────────────────────────┐
            │  Developer changes code   │
            └─────────────┬─────────────┘
                          │  git push / open PR
                          ▼
            ┌───────────────────────────┐
            │   GitHub Actions starts   │
            │   (pr-checks.yml)         │
            └─────────────┬─────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   ┌──────────┐    ┌──────────┐      ┌──────────┐
   │ tsc      │    │ eslint   │      │ vitest   │
   │ build    │    │ no-any   │      │ 717 tests│
   └────┬─────┘    └────┬─────┘      └────┬─────┘
        │               │                 │
        └───────┬───────┴────────┬────────┘
                │                │
                ▼                ▼
        ┌───────────────────────────┐
        │ ANY check fails?          │
        └─────────────┬─────────────┘
                  yes │  no
                      ▼
        ┌───────────────────────────┐    ┌────────────────────────┐
        │ Pipeline fails (red ❌)   │    │ Coverage > 80%?        │
        │ PR blocked from merge     │    └───────────┬────────────┘
        │ Deploy prevented          │           yes  │
        │ Slack alert to author     │                ▼
        └───────────────────────────┘    ┌────────────────────────┐
                                          │ Merge → staging        │
                                          │ E2E + smoke tests      │
                                          │ Manual QA              │
                                          │ Tag → production deploy│
                                          └────────────────────────┘
```

**Hard rule:** every one of the 717 tests in this document must remain green for the pipeline to pass. A single red test blocks merge and deploy. There is no "skip flaky test" escape hatch.

---

## 6. Failure-injection contract (read this first)

For every FULL-depth test you will see a section called **Intentional Code Break**. It names the exact production file and line, the change, and the expected console output. Use these as **CI fire-drills**:

1. Apply the break locally.
2. Run `npm run test` → confirm the named test fails with the named message.
3. Restore the code.
4. If a different test fails, or no test fails → the test is **weak** and the “Improvement Suggestions” section tells you what to add.

See [failure-injection-guide.md](failure-injection-guide.md) for the consolidated drill book.

---

## 7. Quick health summary

| Module | Tests | Strength | Risk |
|---|---|---|---|
| authService | 31 | **Strong** — covers happy path, network errors, JSON edge cases, storage failure | LOW |
| authStore | 33 | **Strong** — every action + every helper + persistence | LOW |
| appStore | 38 | **Strong** but **heavy mocking** of services and storage | MEDIUM |
| geminiService | 25 | **Strong** for parser, **medium** for live API path | MEDIUM |
| supabaseProposalService | 22 | **Medium** — happy paths covered, error branches partial | MEDIUM |
| pdfExportService | 14 | **Medium** — jsPDF/html2canvas mocked, real visual output unverified | **HIGH** |
| dataSyncService | 14 | **Weak** — only localStorage path tested, cloud sync unmocked | **HIGH** |
| companyService | 12 | Strong for read, weak for realtime subscription | MEDIUM |
| leadService | 14 | Strong | LOW |
| utils/* | ~228 | Mostly **strong** — pure functions, real behavior | LOW |
| components/* | ~133 | **Mixed** — many render-only smoke tests (fake coverage risk) | MEDIUM |
| pages/* | 19 | **Weak** — orchestration only, integration gaps | **HIGH** |
| hooks/* | 18 | Strong for `useCompanySync`, medium for registry | LOW |

Detailed audit in [test-effectiveness-analysis.md](test-effectiveness-analysis.md).
