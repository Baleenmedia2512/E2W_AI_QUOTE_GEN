# Pages Module — Test Documentation (CONCISE)

3 page tests covering 19 cases. Pages are thin orchestrators — they wire components to the Zustand stores and react to routing.

| ID prefix | File | Tests |
|---|---|---|
| TC_PAGE_DOCS_* | tests/pages/DocumentsPage.test.tsx | 7 |
| TC_PAGE_QUOTE_* | tests/pages/QuotePage.test.tsx | 8 |
| TC_PAGE_QPREVIEW_* | tests/pages/QuotePreviewPage.test.tsx | 4 |

---

## DocumentsPage (7 tests)

**Production file:** [src/pages/DocumentsPage.tsx](../../src/pages/DocumentsPage.tsx)
**Protects:** Composing ProposalUpload + MultiProposalViewer + nav buttons.

| ID | Test | Break | Impact |
|---|---|---|---|
| TC_PAGE_DOCS_001 | renders without crashing | Throw on mount | Documents page broken |
| TC_PAGE_DOCS_002 | renders page heading | Drop | UX |
| TC_PAGE_DOCS_003 | renders secondary heading/description | Drop | UX |
| TC_PAGE_DOCS_004 | renders ProposalUpload | Skip | Cannot upload from this page |
| TC_PAGE_DOCS_005 | renders MultiProposalViewer | Skip | Cannot see active proposals |
| TC_PAGE_DOCS_006 | navigates to /quote on action click | Wrong route | Breaks main user flow |
| TC_PAGE_DOCS_007 | navigates to /chat (or similar) on action click | Wrong route | Breaks secondary flow |

**Strength:** Strong for a page (covers composition + nav). **Why it matters:** This is the landing page after login.

---

## QuotePage (8 tests)

**Production file:** [src/pages/QuotePage.tsx](../../src/pages/QuotePage.tsx)
**Protects:** Stepper logic (company → client → preview), conditional rendering based on store state, update wiring.

| ID | Test | Break | Impact |
|---|---|---|---|
| TC_PAGE_QUOTE_001 | renders without crashing | Throw | **Whole quote-creation flow dead** |
| TC_PAGE_QUOTE_002 | shows CompanyInfoForm on company step (default) | Show other step | Wrong step shown to new users |
| TC_PAGE_QUOTE_003 | renders QuoteNavBar | Drop | No navigation |
| TC_PAGE_QUOTE_004 | renders QuoteStepper | Drop | No progress indicator |
| TC_PAGE_QUOTE_005 | shows ClientInfoForm when companyInfo exists | Wrong condition | Stuck on company step |
| TC_PAGE_QUOTE_006 | shows QuotePreview when company+client+quote present | Wrong condition | Cannot review/finalize quote |
| TC_PAGE_QUOTE_007 | calls updateQuote when QuotePreview onUpdate fires | Drop handler | Edits in preview never persist |
| TC_PAGE_QUOTE_008 | Back button disabled on company step | Always enabled | Confusing nav |

**Strength:** **Strong** — covers all 3 step states. TC_PAGE_QUOTE_005/006/007 are the most regression-critical (drive the stepper).

---

## QuotePreviewPage (4 tests)

**Production file:** [src/pages/QuotePreviewPage.tsx](../../src/pages/QuotePreviewPage.tsx)
**Protects:** Final pre-export preview, template rendering, missing-data error UI.

| ID | Test | Break | Impact |
|---|---|---|---|
| TC_PAGE_QPREVIEW_001 | renders when all required store data is present | Throw | Cannot reach final preview |
| TC_PAGE_QPREVIEW_002 | renders the selected template component | Wrong template | PDF preview wrong |
| TC_PAGE_QPREVIEW_003 | shows error UI when required store data missing | Throw / render template anyway | **Crash on direct URL access** |
| TC_PAGE_QPREVIEW_004 | "Go Back" button navigates to /quote | Wrong route | User trapped on error screen |

**Strength:** Strong. TC_PAGE_QPREVIEW_003 is the most important — prevents crashes when users bookmark `/preview` and visit later.

---

## Regression Table — Pages

| Test | Page | Impact |
|---|---|---|
| TC_PAGE_QUOTE_001 | Quote | Quote-creation flow dead |
| TC_PAGE_QUOTE_007 | Quote | Edits in preview lost |
| TC_PAGE_QPREVIEW_003 | Preview | Crash on direct URL visit |
| TC_PAGE_DOCS_006 | Documents | Main user-flow link broken |

## Known gaps

1. No tests for **LoginPage**, **HomePage**, **CheckoutPage**, **ChatPage**, etc. (verify by checking `src/pages/`). Add to backlog.
2. QuotePage doesn't test forward navigation (Next button).
3. No test asserting browser-back integration.
