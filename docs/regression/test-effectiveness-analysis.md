# Test Effectiveness Analysis

An honest audit: which tests in this suite look green but **wouldn't catch a real regression**? Each entry includes the symptom, why the test is weak, and what to add.

> Use this list to drive the next quarter of test-improvement work. Each "weak" finding is a latent CI/CD blind spot.

---

## Tier 1 — Weak / Tautological (fix soon)

### TC_SYNC_004 — `dataSyncService`: persists active proposals
**Symptom:** Test only asserts the function is called, not that the *correct shape* is persisted.
**Fix:** Assert the saved object matches a snapshot of the active-proposal envelope.

### TC_SYNC_010, TC_SYNC_011, TC_SYNC_012 — `dataSyncService`: realtime channel
**Symptom:** Mocked Supabase channel returns trivially; no test that an actual `INSERT` payload causes the store to update.
**Fix:** Drive the mocked channel's `on('INSERT', cb)` callback and assert store mutation.

### TC_PDFEXP_005, TC_PDFEXP_006 — `pdfExportService`: paginates and adds page breaks
**Symptom:** Tests only count `jsPDF.addPage()` calls. Doesn't verify content actually splits at the page break.
**Fix:** Assert canvas-slice y-offsets / element positions per page.

### TC_PDFEXP_014 — `pdfExportService`: writes to Capacitor filesystem on mobile
**Symptom:** Asserts `Filesystem.writeFile` called once; doesn't check `directory: 'Documents'` (could be `Cache` and tests would still pass).
**Fix:** Assert the full args object including `directory` and `recursive`.

### TC_UI_HEADER_001/002/004 — `Header` snapshot-like tests
**Symptom:** Re-renders branding text; would fail only if literal string changed.
**Fix:** Acceptable to leave, but flag low value. Real bug area is auth/profile mount (`TC_UI_HEADER_003` is the keeper).

### TC_UI_TMPL_001..012 — Template smoke tests
**Symptom:** Tests check "renders without crashing" + one or two fields per template. **Do not assert financial totals, GST row, or T&Cs appear in the PDF templates.**
**Fix (HIGH PRIORITY):** Add per-template tests for:
- Subtotal cell value
- GST cell when `gstEnabled=true`
- Grand-total cell value
- T&C paragraph text

This is the single biggest gap in the suite. Templates are the literal PDF that customers receive — they deserve full assertions, not smoke tests.

### TC_UI_PROPUP_001..005 — `ProposalUpload`
**Symptom:** No test fires a real `change` event on the hidden file input. Upload-pipeline regressions wouldn't be caught here (they'd only surface in pdfUtils tests).
**Fix:** Add a test that dispatches `fireEvent.change(input, { target: { files: [file] } })` and asserts the upload service is called.

### TC_UI_PROPVIEW_003/004 — `ProposalViewer`
**Symptom:** Only verifies zoom and page buttons *exist*; doesn't test interaction.
**Fix:** Click zoom-in twice, assert the scale state increased. Click next-page, assert the rendered page index changed.

---

## Tier 2 — Coverage gaps (no test exists)

### Components with **zero tests**
- `BottomNav`
- `Layout`
- `LoadingSpinner`
- `UpdateNotification`
- `UserProfile` (highest risk — wired to logout)
- `QuoteWizard` (HIGHEST risk — the orchestrator of the entire quote-creation flow)

### Pages with **zero tests** (verify against `src/pages/`)
- `LoginPage`
- `HomePage`
- `CheckoutPage`
- `ChatPage`
- Any others not in `pages.md`

### Hooks
Any hooks in `src/hooks/` other than `useCityServiceRegistry` and `useCompanySync` (verify via `Get-ChildItem src/hooks/*.ts`).

### Services
Verify against `src/services/` directory listing. Any service file without a matching `tests/services/<name>.test.ts` is uncovered.

---

## Tier 3 — Architectural blind spots

### No integration tests
Every test mocks Supabase, Gemini, Capacitor. **There is zero end-to-end coverage**, e.g.:
- "User uploads PDF → AI generates quote → user edits → PDF saves."

**Recommendation:** Add at minimum a Playwright smoke suite for the 3 happy paths:
1. Login → upload PDF → preview generated quote.
2. Create company info → create client → finalize quote → export PDF.
3. Login → logout → cannot access `/quote` without re-auth.

### No performance budgets
None of the tests assert "PDF export completes in <5s for a 50-page doc."

**Recommendation:** Add Vitest `bench` blocks for `extractPDFContent`, `generateQuote`, `exportPDF`.

### No accessibility tests
**Recommendation:** Add `@axe-core/react` in one or two component tests as a baseline.

### No visual regression
Templates render but no screenshot diff exists. **Recommendation:** Add Playwright `expect(page).toHaveScreenshot()` per template.

### No mutation testing
We catch broken assertions but not unreachable code or weak assertions.
**Recommendation:** Run [Stryker](https://stryker-mutator.io/) quarterly against `src/services/` and `src/utils/`. Mutation score <60% = inadequate.

---

## Tier 4 — Test code quality

### Duplicate test files
See [appendix-duplicates.md](./appendix-duplicates.md). Seven files in `src/__tests__/` duplicate tests in `tests/`. Delete them.

### Mock drift risk
Several tests build their own `Quote`/`CompanyInfo` fixtures inline. **Recommendation:** Consolidate into `tests/fixtures/` (already exists) and import everywhere.

### Setup file scope
`tests/setup.ts` should be audited — any global mock there silently hides regressions in every test that depends on the mocked surface.

---

## Quarterly Test Health Report Template

Copy this for each quarter into `docs/regression/test-health-<YYYY-QN>.md`.

```
Quarter: <YYYY-QN>
Total tests: 717
Pass rate: __%
Coverage (statements/branches): __% / __%
Mutation score (services + utils): __%

Drills run: <list drill IDs from failure-injection-guide.md>
Drills that did NOT cause failure (= test gaps): <list>

Tier-1 weaknesses closed this quarter: <list>
New weaknesses introduced: <list>

Components/Pages with 0% coverage: <count down from last quarter>
Integration test count: <count>

Action items next quarter:
1.
2.
3.
```
