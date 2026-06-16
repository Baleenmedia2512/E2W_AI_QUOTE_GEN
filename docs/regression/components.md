# UI Components Module — Test Documentation (CONCISE)

12 component test files, **~126 tests** (PrivateRoute's 7 tests are documented separately in [auth-and-routing.md](./auth-and-routing.md)).

| ID prefix | File | Tests |
|---|---|---|
| TC_UI_AUTOCOMP_* | tests/components/AutocompleteInput/AutocompleteInput.test.tsx | 17 |
| TC_UI_CHAT_* | tests/components/ChatInterface.test.tsx | 19 |
| TC_UI_CLIENTFORM_* | tests/components/ClientInfoForm.test.tsx | 17 |
| TC_UI_COMPFORM_* | tests/components/CompanyInfoForm.test.tsx | 19 |
| TC_UI_ERRBND_* | tests/components/ErrorBoundary.test.tsx | 6 |
| TC_UI_HEADER_* | tests/components/Header.test.tsx | 4 |
| TC_UI_MULTIPRO_* | tests/components/MultiProposalViewer.test.tsx | 5 |
| TC_UI_PROPUP_* | tests/components/ProposalUpload.test.tsx | 5 |
| TC_UI_PROPVIEW_* | tests/components/ProposalViewer.test.tsx | 4 |
| TC_UI_QPREVIEW_* | tests/components/QuotePreview.test.tsx | 15 |
| TC_UI_TMPL_* | tests/components/Templates.test.tsx | 12 |
| TC_UI_TMPLSEL_* | tests/components/TemplateSelector.test.tsx | 3 |

> Mocking notes: Chakra UI is real; React Router uses `MemoryRouter`; Zustand stores mocked per-test; `pdf.js` / Gemini fully mocked.

---

## AutocompleteInput (17 tests)

**Production file:** [src/components/AutocompleteInput/AutocompleteInput.tsx](../../src/components/AutocompleteInput/AutocompleteInput.tsx)
**Protects:** Debounced search (≥2 chars), suggestion dropdown, keyboard nav (Arrow/Enter/Esc/Tab), outside-click close.

| ID | Test | Break | Impact |
|---|---|---|---|
| TC_UI_AUTOCOMP_001 | renders input with placeholder | Drop placeholder prop | UX regression |
| TC_UI_AUTOCOMP_002 | disabled when isDisabled prop true | Ignore prop | User can edit when shouldn't |
| TC_UI_AUTOCOMP_003 | onChange called when typing | Drop handler | Form value never updates |
| TC_UI_AUTOCOMP_004 | does NOT search when <2 chars | Search every keystroke | API hammered, debounce defeated |
| TC_UI_AUTOCOMP_005 | searches after debounce when ≥2 chars | Skip debounce | Same |
| TC_UI_AUTOCOMP_006 | dropdown hidden when <2 chars | Show always | Empty dropdown flashes |
| TC_UI_AUTOCOMP_007 | shows suggestions when results | Hide results | Search useless |
| TC_UI_AUTOCOMP_008 | hides dropdown when results empty | Show empty | Empty dropdown UX |
| TC_UI_AUTOCOMP_009 | shows spinner while loading | Skip spinner | No loading feedback |
| TC_UI_AUTOCOMP_010 | onSelect called on click | Drop handler | Selection broken |
| TC_UI_AUTOCOMP_011 | closes dropdown after click | Stay open | Dropdown obscures form |
| TC_UI_AUTOCOMP_012 | closes on Escape | Ignore Esc | Modal trap |
| TC_UI_AUTOCOMP_013 | closes on Tab | Ignore Tab | Keyboard nav broken |
| TC_UI_AUTOCOMP_014 | Enter selects highlighted | Always select first | Wrong lead selected |
| TC_UI_AUTOCOMP_015 | Enter no-ops when nothing highlighted | Always select first | Selects wrong/empty |
| TC_UI_AUTOCOMP_016 | ArrowDown navigates two items | Skip increment | Stuck on first |
| TC_UI_AUTOCOMP_017 | outside click closes | Stay open | Dropdown sticky |

**Strength:** Strong — covers debounce timing, keyboard, mouse, outside-click. **Why it matters:** This is the lead-picker in checkout. A broken AutocompleteInput = users can't select existing leads → duplicates created.

---

## ChatInterface (19 tests)

**Production file:** [src/components/ChatInterface/ChatInterface.tsx](../../src/components/ChatInterface/ChatInterface.tsx)
**Protects:** Chat input, send button gating, Gemini call, AI response display, error recovery, quote-generation result handling.

| ID | Test | Break | Impact |
|---|---|---|---|
| TC_UI_CHAT_001 | renders without crashing | Throw on mount | Chat page broken |
| TC_UI_CHAT_002 | renders message input | Hide input | Cannot chat |
| TC_UI_CHAT_003 | renders Send button | Hide | Cannot submit |
| TC_UI_CHAT_004 | renders Mic button | Hide | Voice input dead |
| TC_UI_CHAT_005 | input starts empty | Pre-fill | Stale data |
| TC_UI_CHAT_006 | suggestion prompts when history empty | Hide | Worse onboarding |
| TC_UI_CHAT_007 | renders existing messages from history | Skip | Lose chat on refresh |
| TC_UI_CHAT_008 | input updates on type | Drop handler | Input frozen |
| TC_UI_CHAT_009 | input clears after Send | Keep value | Double-send risk |
| TC_UI_CHAT_010 | does NOT send whitespace-only | Send anyway | Wasted API call |
| TC_UI_CHAT_011 | calls sendMessageToGemini on Send | No call | Chat dead |
| TC_UI_CHAT_012 | Enter key submits | Ignore Enter | UX broken |
| TC_UI_CHAT_013 | adds user message on send | Skip | UI doesn't echo input |
| TC_UI_CHAT_014 | displays AI response | Skip | AI invisible |
| TC_UI_CHAT_015 | disables Send during request (no double-send) | Always enabled | Double-send risk |
| TC_UI_CHAT_016 | disables Send while in flight | Same | Same |
| TC_UI_CHAT_017 | does not crash on Gemini error | Throw | Whole page crashes on AI failure |
| TC_UI_CHAT_018 | re-enables Send after error (retry) | Stay disabled | User cannot retry |
| TC_UI_CHAT_019 | calls setCurrentQuote when isQuoteGeneration=true | Drop | AI-generated quote never persists |

**Strength:** Strong. TC_UI_CHAT_015/016/018 prevent real-world double-charge bugs. TC_UI_CHAT_019 is critical AI-to-store integration.

---

## ClientInfoForm (17 tests)

**Production file:** [src/components/ClientInfoForm/ClientInfoForm.tsx](../../src/components/ClientInfoForm/ClientInfoForm.tsx)
**Protects:** Required-field validation (name, phone), optional email validation, error clearing, Clear button, Back button conditional render.

| ID | Test | Break | Impact |
|---|---|---|---|
| TC_UI_CLIENTFORM_001 | renders all required fields | Hide field | Cannot enter client |
| TC_UI_CLIENTFORM_002 | onSubmit NOT called when name empty | Submit anyway | Empty client created |
| TC_UI_CLIENTFORM_003 | shows name-required error | Hide error | Silent rejection, user confused |
| TC_UI_CLIENTFORM_004 | onSubmit NOT called when phone empty | Submit anyway | Empty phone client |
| TC_UI_CLIENTFORM_005 | shows phone-required error | Hide | Silent |
| TC_UI_CLIENTFORM_006 | shows error for invalid email format | Accept invalid | Bad email in DB |
| TC_UI_CLIENTFORM_007 | shows error for malformed phone | Accept | Bad phone in DB |
| TC_UI_CLIENTFORM_008 | shows error for too-short name | Accept | 1-char client names |
| TC_UI_CLIENTFORM_009 | calls onSubmit with correct data when valid | Wrong payload | Wrong client saved |
| TC_UI_CLIENTFORM_010 | accepts valid optional email | Always require | Cannot omit email |
| TC_UI_CLIENTFORM_011 | clears name error when typing | Sticky error | Confusing UX |
| TC_UI_CLIENTFORM_012 | clears phone error when typing | Same | Same |
| TC_UI_CLIENTFORM_013 | Clear button resets all fields | Skip reset | Form sticky |
| TC_UI_CLIENTFORM_014 | pre-fills from initialData | Ignore prop | Edit flow broken |
| TC_UI_CLIENTFORM_015 | renders Back when onBack prop given | Always show | Wrong stepper UI |
| TC_UI_CLIENTFORM_016 | does NOT render Back when no prop | Always show | Same |
| TC_UI_CLIENTFORM_017 | calls onBack on click | Drop handler | Cannot go back |

**Strength:** **Strong** — every validation path + edit-mode pre-fill covered.

---

## CompanyInfoForm (19 tests)

**Production file:** [src/components/CompanyInfoForm/CompanyInfoForm.tsx](../../src/components/CompanyInfoForm/CompanyInfoForm.tsx)
**Protects:** Mandatory company fields, GST optional, save-to-storage trigger, clear-form behavior.

| ID | Test | Break | Impact |
|---|---|---|---|
| TC_UI_COMPFORM_001 | renders without crashing | Throw | Onboarding flow dead |
| TC_UI_COMPFORM_002 | renders all fields | Hide | Missing field data |
| TC_UI_COMPFORM_003 | pre-fills from initialData | Ignore | Edit flow broken |
| TC_UI_COMPFORM_004 | shows error when name empty | Hide | Silent reject |
| TC_UI_COMPFORM_005 | shows error when phone empty | Hide | Same |
| TC_UI_COMPFORM_006 | shows error when email empty | Hide | Same |
| TC_UI_COMPFORM_007 | shows error when website empty | Hide | Same |
| TC_UI_COMPFORM_008 | shows email-format error | Accept invalid | Bad email |
| TC_UI_COMPFORM_009 | shows phone-format error | Accept | Bad phone |
| TC_UI_COMPFORM_010 | shows website-format error | Accept | Bad URL on PDFs |
| TC_UI_COMPFORM_011 | does NOT show GST error when empty (optional) | Make required | Cannot save company without GST |
| TC_UI_COMPFORM_012 | calls onSubmit when all valid | Drop call | Onboarding broken |
| TC_UI_COMPFORM_013 | **calls saveCompanyInfo on successful submit** | Drop call | Company info lost on refresh |
| TC_UI_COMPFORM_014 | does NOT call onSubmit when invalid | Always submit | Bad data through |
| TC_UI_COMPFORM_015 | shows GST format error when filled-but-invalid | Accept | Bad GST on every invoice |
| TC_UI_COMPFORM_016 | does NOT show GST error when valid GST | Always error | Cannot save valid GST |
| TC_UI_COMPFORM_017 | "Use Saved" fills form with localStorage data | Skip | Returning users re-type everything |
| TC_UI_COMPFORM_018 | clears name validation error when typing | Sticky | Confusing UX |
| TC_UI_COMPFORM_019 | "Clear Form" empties all fields | Skip | Form sticky |

**Strength:** Strong. TC_UI_COMPFORM_013 is the highest-impact: the form's reason for being.

---

## ErrorBoundary (6 tests)

**Production file:** [src/components/ErrorBoundary/ErrorBoundary.tsx](../../src/components/ErrorBoundary/ErrorBoundary.tsx)
**Protects:** Catches uncaught render errors and replaces with fallback UI.

| ID | Test | Break | Impact |
|---|---|---|---|
| TC_UI_ERRBND_001 | renders children when no error | Always show fallback | App always shows error UI |
| TC_UI_ERRBND_002 | renders custom fallback prop on throw | Ignore prop | Wrong UI on crash |
| TC_UI_ERRBND_003 | built-in error UI when no fallback | No UI | White screen on crash |
| TC_UI_ERRBND_004 | logger.error called on throw | Skip logging | **Crashes never surface in monitoring** |
| TC_UI_ERRBND_005 | does NOT display error UI on normal render | Always show | App always broken-looking |
| TC_UI_ERRBND_006 | can wrap multiple children | Only first child | Layouts break |

**Strength:** Strong. **TC_UI_ERRBND_004 is the most important** — without logging, we'd never know about silent crashes in prod.

---

## Header (4 tests)

**Production file:** [src/components/Header/Header.tsx](../../src/components/Header/Header.tsx)
**Protects:** Branding + UserProfile mount.

| ID | Test | Break | Impact |
|---|---|---|---|
| TC_UI_HEADER_001 | renders Quote Buddy branding | Remove text | Brand lost |
| TC_UI_HEADER_002 | renders a heading element | Use `<div>` | A11y regression |
| TC_UI_HEADER_003 | renders UserProfile | Drop | No logout UI |
| TC_UI_HEADER_004 | heading text matches | Wrong text | Branding wrong |

**Strength:** Weak (mostly snapshot-like). Real value: only TC_UI_HEADER_003.

---

## MultiProposalViewer (5 tests)

**Production file:** [src/components/MultiProposalViewer/MultiProposalViewer.tsx](../../src/components/MultiProposalViewer/MultiProposalViewer.tsx)
**Protects:** Renders active-proposal chips, count badge, removal handler.

| ID | Test | Break | Impact |
|---|---|---|---|
| TC_UI_MULTIPRO_001 | renders when no active proposals | Throw | Document page crash when empty |
| TC_UI_MULTIPRO_002 | shows "no active" message | Hide | Confusing empty state |
| TC_UI_MULTIPRO_003 | renders file names per proposal | Skip | User can't tell which proposals are active |
| TC_UI_MULTIPRO_004 | shows correct count text | Wrong count | Misleading badge |
| TC_UI_MULTIPRO_005 | calls removeActiveProposal on remove click | Drop handler | Cannot deactivate proposals |

**Strength:** Strong (small component, full coverage).

---

## ProposalUpload (5 tests)

**Production file:** [src/components/ProposalUpload/ProposalUpload.tsx](../../src/components/ProposalUpload/ProposalUpload.tsx)
**Protects:** Upload button, file input, guidance text.

| ID | Test | Break | Impact |
|---|---|---|---|
| TC_UI_PROPUP_001 | renders without crashing | Throw | Upload flow dead |
| TC_UI_PROPUP_002 | renders main upload button | Hide | Cannot trigger upload |
| TC_UI_PROPUP_003 | renders secondary action | Hide | UX regression |
| TC_UI_PROPUP_004 | renders file type guidance | Hide | Users upload wrong types |
| TC_UI_PROPUP_005 | hidden file input accepts PDF + images | Wrong accept attr | Browsers reject valid types |

**Strength:** Medium — **does not** test actual upload flow (mocked file picker not exercised). Improvement: add a test that drives a real `File` change event.

---

## ProposalViewer (4 tests)

**Production file:** [src/components/ProposalViewer/ProposalViewer.tsx](../../src/components/ProposalViewer/ProposalViewer.tsx)
**Protects:** Empty-state, zoom controls, page navigation.

| ID | Test | Break | Impact |
|---|---|---|---|
| TC_UI_PROPVIEW_001 | renders without crashing when no file | Throw | Page crash when no proposal |
| TC_UI_PROPVIEW_002 | shows "no document" message | Hide | Blank panel confuses users |
| TC_UI_PROPVIEW_003 | zoom in/out buttons when PDF loaded | Hide | Cannot read fine print |
| TC_UI_PROPVIEW_004 | prev/next page buttons when PDF loaded | Hide | Stuck on page 1 |

**Strength:** Medium — surface-level (no zoom interaction tested, no page-change actually verified).

---

## QuotePreview (15 tests)

**Production file:** [src/components/QuotePreview/QuotePreview.tsx](../../src/components/QuotePreview/QuotePreview.tsx)
**Protects:** **The pre-PDF preview** — line items render, GST row, totals, save button, edit handlers (GST checkbox, T&C textarea, delete section).

| ID | Test | Break | Impact |
|---|---|---|---|
| TC_UI_QPREVIEW_001 | shows empty-state when quote null | Throw | Crash before quote generated |
| TC_UI_QPREVIEW_002 | renders line item descriptions | Skip | PDF preview empty |
| TC_UI_QPREVIEW_003 | renders single-item quote | Throw | Single-item PDFs broken |
| TC_UI_QPREVIEW_004 | shows GST row when gstEnabled | Hide | **GST hidden on PDFs — tax compliance** |
| TC_UI_QPREVIEW_005 | does not crash when gstEnabled=false | Throw | Cannot disable GST |
| TC_UI_QPREVIEW_006 | renders total on screen | Hide | **Preview without total — user has no clue what they're sending** |
| TC_UI_QPREVIEW_007 | renders multiple line items | Skip | Multi-item PDFs broken |
| TC_UI_QPREVIEW_008 | renders save/download button when onSave given | Hide | Cannot save |
| TC_UI_QPREVIEW_009 | onUpdate called when GST toggled | Drop | GST changes don't persist |
| TC_UI_QPREVIEW_010 | onUpdate has gstEnabled flipped | Wrong payload | GST state inverted |
| TC_UI_QPREVIEW_011 | onUpdate called when T&C changed | Drop | T&C edits don't persist |
| TC_UI_QPREVIEW_012 | onUpdate has new terms value | Wrong payload | T&Cs corrupted |
| TC_UI_QPREVIEW_013 | onUpdate called when Delete clicked | Drop | Cannot delete line items |
| TC_UI_QPREVIEW_014 | onUpdate has item removed | Wrong array | Wrong item deleted |
| TC_UI_QPREVIEW_015 | onUpdate receives valid Quote object | Wrong shape | Downstream crashes |

**Strength:** **Strong**. TC_UI_QPREVIEW_004, TC_UI_QPREVIEW_006, TC_UI_QPREVIEW_010, TC_UI_QPREVIEW_014 are high-stakes financial-correctness tests.

---

## Templates (12 tests across 4 templates)

**Production files:** [src/components/Templates/](../../src/components/Templates/) — ClassicBusiness, CorporateMinimal, ModernSales, PremiumAgency.
**Protects:** Each PDF template renders without crashing + shows core data (company name, client info, line items).

| ID | Template | Test | Break | Impact |
|---|---|---|---|---|
| TC_UI_TMPL_001 | ClassicBusiness | renders without crashing | Throw | "Classic" PDFs broken |
| TC_UI_TMPL_002 | ClassicBusiness | renders company name | Skip | Branding missing |
| TC_UI_TMPL_003 | ClassicBusiness | renders client company name | Skip | "To: ___" empty |
| TC_UI_TMPL_004 | CorporateMinimal | renders without crashing | Throw | Template dead |
| TC_UI_TMPL_005 | CorporateMinimal | renders email | Skip | Contact info missing |
| TC_UI_TMPL_006 | CorporateMinimal | renders client name | Skip | Client missing |
| TC_UI_TMPL_007 | ModernSales | renders without crashing | Throw | Template dead |
| TC_UI_TMPL_008 | ModernSales | renders company name | Skip | Branding missing |
| TC_UI_TMPL_009 | ModernSales | renders line items | Skip | **Quote items missing from PDF** |
| TC_UI_TMPL_010 | PremiumAgency | renders without crashing | Throw | Template dead |
| TC_UI_TMPL_011 | PremiumAgency | renders company name | Skip | Branding missing |
| TC_UI_TMPL_012 | PremiumAgency | renders client name | Skip | Client missing |

**Strength:** Medium — only smoke tests + a few key fields. **Improvement:** Add tests asserting line-item totals, T&Cs, GST row appear in each template. Critical given these directly become PDFs.

---

## TemplateSelector (3 tests)

**Production file:** [src/components/TemplateSelector/TemplateSelector.tsx](../../src/components/TemplateSelector/TemplateSelector.tsx)

| ID | Test | Break | Impact |
|---|---|---|---|
| TC_UI_TMPLSEL_001 | renders without crashing | Throw | Cannot pick template |
| TC_UI_TMPLSEL_002 | renders all 4 template options | Drop one | User cannot choose missing template |
| TC_UI_TMPLSEL_003 | onSelectTemplate called with correct id | Wrong id | Wrong template applied to PDF |

**Strength:** Strong for size.

---

## Regression Table — Components (HIGHEST impact only)

| Test | Component | Why it matters |
|---|---|---|
| TC_UI_ERRBND_004 | ErrorBoundary | Crashes invisible without this logging |
| TC_UI_CHAT_015/016/018 | Chat | Double-send guard / retry path |
| TC_UI_CHAT_019 | Chat | AI-generated quote persists to store |
| TC_UI_COMPFORM_013 | Company form | Save-to-storage trigger |
| TC_UI_QPREVIEW_004 | Quote preview | GST disclosure compliance |
| TC_UI_QPREVIEW_006 | Quote preview | User can see total before sending |
| TC_UI_QPREVIEW_014 | Quote preview | Wrong item could be deleted |
| TC_UI_TMPL_009 | ModernSales template | Line items appear in PDF |
| TC_UI_AUTOCOMP_014 | Autocomplete | Wrong lead selected when picking |

## Known gaps

1. No tests for `BottomNav`, `Layout`, `LoadingSpinner`, `UpdateNotification`, `UserProfile`, `QuoteWizard` — these components have **zero test coverage**. Add to backlog.
2. Template tests don't verify financial fields (totals, taxes) — high-value gap.
3. ProposalUpload doesn't drive a real upload event.
