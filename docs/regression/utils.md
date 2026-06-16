# Utilities Module — Test Documentation (CONCISE)

11 utility files, **~240 test cases**. These are pure-function helpers — small, fast, mostly real implementations (no mocks). Concise table form below: every row is one test case with its protected behavior, intentional code break, and regression impact.

| ID range prefix | File |
|---|---|
| TC_UTIL_BULLET_* | tests/utils/bulletNormalization.test.ts (29) |
| TC_UTIL_CACHEVER_* | tests/utils/cacheVersion.test.ts (11) |
| TC_UTIL_FILE_* | tests/utils/fileUtils.test.ts (22) |
| TC_UTIL_IMGSTORE_* | tests/utils/imageStorage.test.ts (21) |
| TC_UTIL_LOCAL_* | tests/utils/localStorage.test.ts (22) |
| TC_UTIL_LOGGER_* | tests/utils/logger.test.ts (14) |
| TC_UTIL_PDF_* | tests/utils/pdfUtils.test.ts (47) |
| TC_UTIL_PROMPT_* | tests/utils/promptTemplates.test.ts (19) |
| TC_UTIL_PROPSTORE_* | tests/utils/proposalStorage.test.ts (17) |
| TC_UTIL_PWA_* | tests/utils/pwa.test.ts (14) |
| TC_UTIL_GRP_* | tests/utils/quoteGrouping.test.ts (24) |

---

## tests/utils/bulletNormalization.test.ts (29 tests)

**Production file:** [src/utils/bulletNormalization.ts](../../src/utils/bulletNormalization.ts)
**Protects:** parsing AI-generated bulleted lists into clean line items (terms & conditions, line item descriptions).

| ID | Test | Protects | Intentional break | Regression impact |
|---|---|---|---|---|
| TC_UTIL_BULLET_001 | stripBulletPrefix strips • glyph | Removes Unicode bullet glyph + trailing space | Skip Unicode replace | T&C lines show "• " prefix in PDFs |
| TC_UTIL_BULLET_002 | strips hyphen `-` bullet | ASCII bullets handled | Skip hyphen rule | Hyphenated terms not normalized |
| TC_UTIL_BULLET_003 | strips asterisk `*` bullet | Markdown bullets handled | Skip asterisk rule | AI markdown bullets visible to customers |
| TC_UTIL_BULLET_004 | does NOT strip numbered prefixes | `1. text` is intentionally not in stripBulletPrefix scope | Strip numbered too | `1. ` lost from numbered T&Cs (use stripListPrefix instead) |
| TC_UTIL_BULLET_005 | returns unchanged when no bullet | Idempotent on plain text | Always strip first 2 chars | Plain text mangled |
| TC_UTIL_BULLET_006 | returns empty for empty input | Null-safe | Throw on empty | Crash on empty AI reply |
| TC_UTIL_BULLET_007 | handles multiple spaces after bullet | Whitespace normalized | Strip only one space | Indented lines in PDF |
| TC_UTIL_BULLET_008 | stripListPrefix strips `1.` | Numbered list normalization | Skip numbered regex | Numbered T&Cs shown raw |
| TC_UTIL_BULLET_009 | strips `1)` | Alternate numbered form | Only match `N.` | `1)` lists not normalized |
| TC_UTIL_BULLET_010 | stripListPrefix strips • | Unifies bullet handling | Drop branch | Inconsistent normalization between code paths |
| TC_UTIL_BULLET_011 | strips hyphen via stripListPrefix | Same as 010 | Same | Same |
| TC_UTIL_BULLET_012 | strips asterisk via stripListPrefix | Same | Same | Same |
| TC_UTIL_BULLET_013 | returns unchanged for plain text | No-op safety | Always strip | Plain text mangled |
| TC_UTIL_BULLET_014 | isBulletedLine returns true for • | Bullet detector positive | Always false | Bulleted vs flat-text grouping wrong |
| TC_UTIL_BULLET_015 | isBulletedLine returns true for `-` | Same | Same | Same |
| TC_UTIL_BULLET_016 | isBulletedLine returns true for `*` | Same | Same | Same |
| TC_UTIL_BULLET_017 | isBulletedLine returns true for numbered `1.` | Numbered detected | Drop numbered case | Numbered T&Cs treated as paragraphs |
| TC_UTIL_BULLET_018 | isBulletedLine returns true for `1)` | Alternate numbered | Same | Same |
| TC_UTIL_BULLET_019 | returns false for plain text | Avoid false-positives | Always true | Every paragraph treated as bullet |
| TC_UTIL_BULLET_020 | returns false for empty string | Null-safe | Throw | Crash |
| TC_UTIL_BULLET_021 | returns false when bullet mid-string | Only line-start counts | Match anywhere | Sentences with `*` inside misclassified |
| TC_UTIL_BULLET_022 | normalizeTermsBlob splits multi-line and strips | Composite of split + strip | Skip strip | Bulleted output still has prefixes |
| TC_UTIL_BULLET_023 | filters out empty lines | Removes blank rows | Keep empties | PDFs have blank bullets |
| TC_UTIL_BULLET_024 | returns [] for null | Null-safe | Throw | T&C section crashes whole PDF |
| TC_UTIL_BULLET_025 | returns [] for undefined | Same | Same | Same |
| TC_UTIL_BULLET_026 | returns [] for empty string | Same | Same | Same |
| TC_UTIL_BULLET_027 | returns [] for whitespace-only | Same | Trim missing | Whitespace bullets shown |
| TC_UTIL_BULLET_028 | handles mix of bullets + plain lines | Mixed input correct | Strip everything | Plain lines mangled |
| TC_UTIL_BULLET_029 | trims whitespace from each line | Each output trimmed | Skip trim | Trailing spaces in PDFs |

**Overall strength:** **Strong** — real implementation, no mocks, table-driven test cases.

---

## tests/utils/cacheVersion.test.ts (11 tests)

**Production file:** [src/utils/cacheVersion.ts](../../src/utils/cacheVersion.ts)
**Protects:** PWA build-version tracking → triggers "new version available" banner.

| ID | Test | Protects | Intentional break | Regression impact |
|---|---|---|---|---|
| TC_UTIL_CACHEVER_001 | getStoredVersion returns null when empty | First-run safety | Throw on null | Crash on app start |
| TC_UTIL_CACHEVER_002 | returns parsed AppVersion after saveVersion | Round-trip | Return raw string | Version compare broken |
| TC_UTIL_CACHEVER_003 | returns null on invalid JSON | Corruption safety | Throw | Crash on cache corruption |
| TC_UTIL_CACHEVER_004 | saveVersion persists | Write works | No-op write | Update banner never shown |
| TC_UTIL_CACHEVER_005 | overwrites previous version | Updates work | Append instead | Banner stuck forever |
| TC_UTIL_CACHEVER_006 | does not throw when localStorage unavailable | Safari private mode | Re-throw | App crash in privacy modes |
| TC_UTIL_CACHEVER_007 | checkForUpdates returns false when no SW | No-SW environment | Return true | Phantom update banner |
| TC_UTIL_CACHEVER_008 | returns false when no stored version (first run) | First-install UX | Return true | "New version" shown to first-time users |
| TC_UTIL_CACHEVER_009 | returns true when buildTimestamp is newer | Update detection works | Always false | Updates never offered |
| TC_UTIL_CACHEVER_010 | returns false when equal | No false alarms | Always true | Constant banner spam |
| TC_UTIL_CACHEVER_011 | stores retrieved version (first run scenario) | Seeds the cache | Skip seed | Every refresh triggers "first run" |

**Strength:** Strong. **Improvement:** Add test for stored-newer-than-current edge.

---

## tests/utils/fileUtils.test.ts (22 tests)

**Production file:** [src/utils/fileUtils.ts](../../src/utils/fileUtils.ts)
**Protects:** Upload validators (MIME + extension + size) and file-type router.

| ID | Test | Protects | Break | Regression impact |
|---|---|---|---|---|
| TC_UTIL_FILE_001 | validateImageFile accepts valid JPEG | Happy path | Always reject | Cannot upload any image |
| TC_UTIL_FILE_002 | accepts image/jpg MIME | Browser variant | Only accept image/jpeg | Some browsers' uploads rejected |
| TC_UTIL_FILE_003 | rejects PNG (not JPEG) | Format gate | Accept all | Wrong format → PDF generation breaks |
| TC_UTIL_FILE_004 | rejects PDF | Wrong type rejected | Accept | Confusing UI flow |
| TC_UTIL_FILE_005 | rejects file > 10MB | Size limit | Skip size check | Memory blow-up + storage cost |
| TC_UTIL_FILE_006 | accepts file exactly at 10MB | Boundary | Use `<` instead of `<=` | Off-by-one rejects valid files |
| TC_UTIL_FILE_007 | validateExcelFile accepts .xlsx by MIME | Excel upload works | Reject | Lead-import broken |
| TC_UTIL_FILE_008 | accepts .xls by MIME | Legacy Excel | Reject | Old files rejected |
| TC_UTIL_FILE_009 | accepts .xlsx by extension when MIME generic | Browser quirk | MIME-only check | Many real uploads rejected |
| TC_UTIL_FILE_010 | accepts .xls by extension | Same | Same | Same |
| TC_UTIL_FILE_011 | rejects plain text | Format gate | Accept | Wrong-format crash later |
| TC_UTIL_FILE_012 | rejects Excel > 10MB | Size limit | Skip | Same as 005 |
| TC_UTIL_FILE_013 | detectFileType PDF by MIME | Router correct | Return 'unknown' | Wrong code path |
| TC_UTIL_FILE_014 | PDF by .pdf extension | Filename fallback | Skip | Some uploads misrouted |
| TC_UTIL_FILE_015 | image/jpeg as image | Router | Wrong return | Image not opened in viewer |
| TC_UTIL_FILE_016 | image/jpg as image | Same | Same | Same |
| TC_UTIL_FILE_017 | .jpg extension as image | Same | Same | Same |
| TC_UTIL_FILE_018 | xlsx MIME as excel | Same | Same | Same |
| TC_UTIL_FILE_019 | .xlsx extension as excel | Same | Same | Same |
| TC_UTIL_FILE_020 | .xls extension as excel | Same | Same | Same |
| TC_UTIL_FILE_021 | returns unknown for unsupported type | Safe fallback | Throw | Crash on weird MIME |
| TC_UTIL_FILE_022 | returns unknown for text file | Same | Same | Same |

**Strength:** **Strong** — real implementation with both MIME and extension paths.

---

## tests/utils/imageStorage.test.ts (21 tests)

**Production file:** [src/utils/imageStorage.ts](../../src/utils/imageStorage.ts)
**Protects:** IndexedDB / sessionStorage cache of extracted PDF page images, active-proposal id list, lightweight metadata.

| ID | Test | Protects | Break | Impact |
|---|---|---|---|---|
| TC_UTIL_IMGSTORE_001 | savePageImages saves valid array | Persistence works | No-op | Page images lost on refresh |
| TC_UTIL_IMGSTORE_002 | saves empty array | Reset case | Throw | Crash on empty proposal |
| TC_UTIL_IMGSTORE_003 | loadPageImages returns [] when empty | Empty default | Return null | `.map` crash |
| TC_UTIL_IMGSTORE_004 | returns saved pages | Round-trip | Return [] | Pages never shown after refresh |
| TC_UTIL_IMGSTORE_005 | overwrites previous pages | Replace semantics | Append | Memory grows unboundedly |
| TC_UTIL_IMGSTORE_006 | clearPageImages empties storage | Reset works | No-op | Storage never frees |
| TC_UTIL_IMGSTORE_007 | clearPageImages no-throw on empty | Idempotent | Throw | Crash on second clear |
| TC_UTIL_IMGSTORE_008 | savePageImagesById saves per-proposal | Scoped persistence | Use global key | Cross-proposal contamination |
| TC_UTIL_IMGSTORE_009 | loadPageImagesById returns [] for missing | Scoped read default | Return all | Show wrong proposal's pages |
| TC_UTIL_IMGSTORE_010 | loadPageImagesById returns correct pages | Scoped read | Return wrong scope | Show wrong proposal |
| TC_UTIL_IMGSTORE_011 | isolates pages between proposal IDs | Multi-tab safety | Single bucket | Cross-tab leakage |
| TC_UTIL_IMGSTORE_012 | clearPageImagesById clears only that ID | Targeted clear | Clear all | Deleting one proposal wipes all images |
| TC_UTIL_IMGSTORE_013 | no-throw on non-existent ID | Idempotent | Throw | Crash on delete twice |
| TC_UTIL_IMGSTORE_014 | activeProposalIds: [] when empty | Default | null | Crash |
| TC_UTIL_IMGSTORE_015 | saves + loads IDs | Round-trip | No-op | Active selection lost on refresh |
| TC_UTIL_IMGSTORE_016 | overwrites previous IDs | Replace | Append | Stale active list |
| TC_UTIL_IMGSTORE_017 | empty after clearActiveProposalIds | Reset | No-op | Active selection sticky |
| TC_UTIL_IMGSTORE_018 | activeProposalMeta: [] when empty | Default | null | Crash |
| TC_UTIL_IMGSTORE_019 | saves + loads metadata | Round-trip | No-op | Active proposal names lost |
| TC_UTIL_IMGSTORE_020 | strips fileUrl from saved meta (lightweight) | Quota guard | Persist fileUrl | sessionStorage quota exceeded → app breaks |
| TC_UTIL_IMGSTORE_021 | [] after clearActiveProposalMeta | Reset | No-op | Stale meta in UI |

**Strength:** Strong. TC_UTIL_IMGSTORE_020 is the most important — quota overflow is a real crash risk.

---

## tests/utils/localStorage.test.ts (22 tests)

**Production file:** [src/utils/localStorage.ts](../../src/utils/localStorage.ts)
**Protects:** Company-info persistence + chat-history sessionStorage, all wrapped in `try/catch` with `logger.error`.

| ID | Test | Protects | Break | Impact |
|---|---|---|---|---|
| TC_UTIL_LOCAL_001 | saveCompanyInfo persists | Write works | No-op | Company info lost on refresh |
| TC_UTIL_LOCAL_002 | overwrites existing | Replace semantics | Append | Storage grows; load returns stale |
| TC_UTIL_LOCAL_003 | logger.error + no-throw when setItem throws | Quota safety | Re-throw | Crash on save when storage full |
| TC_UTIL_LOCAL_004 | round-trips special characters | UTF-8 / quotes safe | Manual escaping wrong | Garbled GST/company names |
| TC_UTIL_LOCAL_005 | loadCompanyInfo returns parsed object | Read works | Return raw string | Forms get string, crash |
| TC_UTIL_LOCAL_006 | returns null when missing | Safe default | Return {} | "Empty company" forms |
| TC_UTIL_LOCAL_007 | returns null on corrupted JSON | Corruption safety | Throw | Crash on any storage corruption |
| TC_UTIL_LOCAL_008 | logger.error + null when getItem throws | Sandboxed iframes | Throw | Embedded mode crashes |
| TC_UTIL_LOCAL_009 | clearCompanyInfo removes key | Reset works | No-op | "Reset" button does nothing |
| TC_UTIL_LOCAL_010 | no-throw on missing key | Idempotent | Throw | Crash if clearing twice |
| TC_UTIL_LOCAL_011 | logger.error + no-throw when removeItem throws | Quota | Throw | Crash on reset |
| TC_UTIL_LOCAL_012 | saveChatHistory persists | Chat persistence | No-op | Chat lost on refresh |
| TC_UTIL_LOCAL_013 | persists empty array | Reset case | Throw | Cannot clear chat |
| TC_UTIL_LOCAL_014 | preserves nested object structure | Deep clone | Shallow stringify | Quote objects in chat corrupted |
| TC_UTIL_LOCAL_015 | logger.error + no-throw when setItem throws | Quota | Throw | Chat send button crashes when storage full |
| TC_UTIL_LOCAL_016 | loadChatHistory returns parsed array | Read | Return raw | Crash on render |
| TC_UTIL_LOCAL_017 | returns null when missing | Default | Return [] | Lose distinction "never chatted" |
| TC_UTIL_LOCAL_018 | returns null on corrupted JSON | Corruption safety | Throw | Crash |
| TC_UTIL_LOCAL_019 | logger.error + null when getItem throws | Sandboxed | Throw | Crash |
| TC_UTIL_LOCAL_020 | clearChatHistory removes key | Reset | No-op | "Clear chat" button does nothing |
| TC_UTIL_LOCAL_021 | no-throw on missing | Idempotent | Throw | Crash on second clear |
| TC_UTIL_LOCAL_022 | logger.error + no-throw when removeItem throws | Quota | Throw | Crash on chat clear |

**Strength:** Strong — every method has a write/read/clear/error variant.

---

## tests/utils/logger.test.ts (14 tests)

**Production file:** [src/utils/logger.ts](../../src/utils/logger.ts)
**Protects:** Routing wrapper around `console.*` + PII redaction (email, phone, GSTIN).

| ID | Test | Protects | Break | Impact |
|---|---|---|---|---|
| TC_UTIL_LOGGER_001 | debug → console.debug | Correct route | Route to log | Logs lost in prod filters |
| TC_UTIL_LOGGER_002 | info → console.info | Same | Same | Same |
| TC_UTIL_LOGGER_003 | warn → console.warn | Same | Same | Warnings invisible |
| TC_UTIL_LOGGER_004 | error → console.error | Same | Same | Errors not flagged in monitoring |
| TC_UTIL_LOGGER_005 | passes multiple args | Argument forwarding | Drop tail args | Lose context in logs |
| TC_UTIL_LOGGER_006 | handles Error objects | Stack traces preserved | Stringify | Lose stack info |
| TC_UTIL_LOGGER_007 | redactString redacts emails | **PII compliance** | Skip redact | Emails leak to logs → GDPR |
| TC_UTIL_LOGGER_008 | redacts phone numbers | **PII compliance** | Skip | Phone leaks |
| TC_UTIL_LOGGER_009 | redacts GSTIN | **PII compliance** | Skip | GSTIN leaks |
| TC_UTIL_LOGGER_010 | unchanged when no PII | Performance | Always replace | Slows logs |
| TC_UTIL_LOGGER_011 | redacts multiple emails in one string | Global regex | Only first | Partial leak |
| TC_UTIL_LOGGER_012 | exports isProd boolean | Internal contract | Wrong type | Wrong env detection |
| TC_UTIL_LOGGER_013 | exports envLevel string | Internal contract | Wrong type | Log level misset |
| TC_UTIL_LOGGER_014 | exports redactString function | Internal contract | Missing | Cannot use redactor directly |

**Strength:** **Strong** — TC_UTIL_LOGGER_007/008/009 are compliance-critical.

---

## tests/utils/pdfUtils.test.ts (47 tests)

**Production file:** [src/utils/pdfUtils.ts](../../src/utils/pdfUtils.ts)
**Protects:** **The PDF ingestion brain** — keyword/page-pattern triggers, IoU dedup of bounding boxes, text extraction, vision auto-crop, file validation.

| ID | Test | Protects | Break | Impact |
|---|---|---|---|---|
| TC_UTIL_PDF_001 | keyword triggers (×7 tests) | Auto-detect coverage page | Drop keyword | Wrong page-count → wrong quote |
| TC_UTIL_PDF_008 | case-insensitive keyword match | Robustness | Case-sensitive | Misses "COVERAGE" |
| TC_UTIL_PDF_009 | `page 2 of N` returns true | Cover-page detection | Skip regex | Treats summary as cover |
| TC_UTIL_PDF_010 | `page 3 of N` returns true | Same | Same | Same |
| TC_UTIL_PDF_011 | `page 1` returns false | First page not a cover | Match all | Cover page treated wrong |
| TC_UTIL_PDF_012 | short-text trigger <150 chars | Heuristic | Lower threshold | Misclassifies real pages |
| TC_UTIL_PDF_013 | true for empty string | Edge | Throw | Crash on empty page |
| TC_UTIL_PDF_014 | true exactly at 149 chars trimmed | Boundary | `<` vs `<=` | Off-by-one |
| TC_UTIL_PDF_015 | false ≥150 chars | Upper boundary | Wrong inequality | Misclass full content as cover |
| TC_UTIL_PDF_016 | keeps single box unchanged | IoU dedup correctness | Always dedupe | Real bounding boxes deleted |
| TC_UTIL_PDF_017 | removes duplicate boxes >40% IoU | Dedup threshold | Lower threshold | Keep duplicates → 2× image extraction |
| TC_UTIL_PDF_018 | keeps two non-overlapping boxes | Don't over-dedupe | High threshold | Drop unrelated boxes |
| TC_UTIL_PDF_019 | prefers larger box | Quality heuristic | Pick smaller | Smaller crop = info loss |
| TC_UTIL_PDF_020 | returns [] for empty | Edge | Throw | Crash on text-only PDFs |
| TC_UTIL_PDF_021 | extractPDFContent: textContent extracted single-page | Happy path | Return empty | Text-extraction broken |
| TC_UTIL_PDF_022 | correct pageCount | Page-aware logic | Always 1 | Multi-page PDFs treated as 1 page |
| TC_UTIL_PDF_023 | empty images array | Contract | Undefined | Crash downstream |
| TC_UTIL_PDF_024 | concatenates multi-page text | Multi-page support | Only first page | 99% of real PDFs broken |
| TC_UTIL_PDF_025 | handles pages with no text | Graceful | Throw | Crash on image-only pages |
| TC_UTIL_PDF_026 | newline between Y-diff >5 | Layout reconstruction | Skip newline | All text on one line |
| TC_UTIL_PDF_027 | tab when X gap >50 same row | Layout reconstruction | Skip tab | Columns merged |
| TC_UTIL_PDF_028 | throws "No file provided" | Input validation | Don't throw | Silent failures |
| TC_UTIL_PDF_029 | propagates "Invalid PDF" | Error contract | Swallow | User confused |
| TC_UTIL_PDF_030 | wraps unexpected errors | Error contract | Don't wrap | Inconsistent error UI |
| TC_UTIL_PDF_031 | pageImages: one entry per page | Output structure | Skip pages | Pages missing in preview |
| TC_UTIL_PDF_032 | entry contains pageNumber, text, imageDataUrl | Output contract | Drop field | Crash in viewer |
| TC_UTIL_PDF_033 | page render failure non-fatal | Resilience | Throw on first failure | One bad page kills whole extraction |
| TC_UTIL_PDF_034 | Gemini Vision skipped if key empty | Config respected | Always call | Crash without API key in staging |
| TC_UTIL_PDF_035 | croppedImages unset when Gemini returns [] | No-op | Add empty | Empty crops shown |
| TC_UTIL_PDF_036 | croppedImages populated when Gemini returns boxes | Vision integration | Ignore Gemini | Auto-crop feature dead |
| TC_UTIL_PDF_037 | auto-crop failure non-fatal | Resilience | Throw | Whole extraction lost when Gemini errors |
| TC_UTIL_PDF_038 | returns all required top-level fields | API contract | Drop field | Downstream crashes |
| TC_UTIL_PDF_039 | validatePDFFile true within 10MB | Size limit | Always true | Allows huge uploads |
| TC_UTIL_PDF_040 | false for non-PDF type | MIME gate | Always true | Wrong file type uploaded |
| TC_UTIL_PDF_041 | error message in result | UX | Empty error | User has no clue why upload failed |
| TC_UTIL_PDF_042 | false when >10MB | Size limit | Use bytes vs MB | Off-by-1024 |
| TC_UTIL_PDF_043 | respects VITE_MAX_FILE_SIZE_MB env | Configurable | Hardcoded | Cannot raise limit per env |
| TC_UTIL_PDF_044 | (duplicate validatePDFFile suite) true within limit | Same as 039 | Same | Same |
| TC_UTIL_PDF_045 | false for non-PDF | Same as 040 | Same | Same |
| TC_UTIL_PDF_046 | false when >10MB | Same as 042 | Same | Same |
| TC_UTIL_PDF_047 | true exactly at limit | Boundary | Off-by-one | Reject valid files |

**Strength:** **Mostly strong**, but heavy reliance on pdf.js mocks means real-world parsing bugs may slip through. `pdfUtils` is the highest-risk pure-function module in the suite (covers ~40% of business value).

---

## tests/utils/promptTemplates.test.ts (19 tests)

**Production file:** [src/utils/promptTemplates.ts](../../src/utils/promptTemplates.ts)
**Protects:** Static prompt strings sent to Gemini — every assertion is a string-contains check.

| ID | Test | Protects | Break | Impact |
|---|---|---|---|---|
| TC_UTIL_PROMPT_001 | QUOTE_GENERATION_PROMPT non-empty | Prompt exists | Empty string | AI has no instructions → garbage output |
| TC_UTIL_PROMPT_002 | instructs AI to return JSON | Output format | Remove "JSON" | AI returns prose, parser fails |
| TC_UTIL_PROMPT_003-007 | various keyword checks | Keep prompt coverage | Remove keyword | AI loses instruction → degraded output |
| TC_UTIL_PROMPT_008 | mentions city | Geo-routing instruction | Remove | AI ignores city context |
| TC_UTIL_PROMPT_009 | mentions service | Service context | Remove | AI generic quotes |
| TC_UTIL_PROMPT_010 | explains `Total = qty × unitPrice × duration` | **Financial formula** | Remove | **Wrong totals in every quote** |
| TC_UTIL_PROMPT_011 | CHAT_SYSTEM_PROMPT non-empty | Chat prompt exists | Empty | Chat broken |
| TC_UTIL_PROMPT_012-015 | EXACT/MULTIPLE/PARTIAL/NO_MATCH tier instructions | Match-type classification works | Remove tier | Whole match-type system fails |
| TC_UTIL_PROMPT_016 | instructs to search proposals | Doc-grounding | Remove | AI hallucinates non-existent services |
| TC_UTIL_PROMPT_017 | lists ALL services when searching | Completeness | Remove | AI picks first match |
| TC_UTIL_PROMPT_018 | asks for clarification on ambiguity | UX | Remove | AI guesses, wrong quote |
| TC_UTIL_PROMPT_019 | does NOT leak API keys/secrets | **Security regression guard** | Insert secret | API key exposed to anyone reading source |

**Strength:** **Strong for contract**, but it's a *string-match* test — the prompt could be reworded validly and tests pass. TC_UTIL_PROMPT_010 and TC_UTIL_PROMPT_019 are the most regression-valuable.

---

## tests/utils/proposalStorage.test.ts (17 tests)

**Production file:** [src/utils/proposalStorage.ts](../../src/utils/proposalStorage.ts)
**Protects:** Local proposal library (CRUD, dedup, cap at 10).

| ID | Test | Protects | Break | Impact |
|---|---|---|---|---|
| TC_UTIL_PROPSTORE_001 | saveProposalToLibrary returns ID with prefix | ID convention | Different prefix | URLs/keys inconsistent |
| TC_UTIL_PROPSTORE_002 | unique IDs across calls | No collision | Use Date.now only | Race-condition duplicate IDs |
| TC_UTIL_PROPSTORE_003 | stores fileName | Field persisted | Skip | Lost filename in library |
| TC_UTIL_PROPSTORE_004 | stores extractedText | Field persisted | Skip | Search broken |
| TC_UTIL_PROPSTORE_005 | loadRecentProposals returns array | Always-array contract | Return null | Crash on `.map` |
| TC_UTIL_PROPSTORE_006 | returns proposals after save | Round-trip | Return [] | Saved proposals never shown |
| TC_UTIL_PROPSTORE_007 | **caps at 10 proposals** | Storage quota guard | Drop cap | LocalStorage fills → crash |
| TC_UTIL_PROPSTORE_008 | loadProposalById returns null for missing | Safe default | Throw | Crash on bad URL |
| TC_UTIL_PROPSTORE_009 | returns correct proposal | Read by id | Return wrong | Open wrong proposal |
| TC_UTIL_PROPSTORE_010 | findDuplicateProposal: null when empty | Default | Always match | "Already exists" shown to first-time user |
| TC_UTIL_PROPSTORE_011 | finds dup by name+type+size | **Dedup logic** | Drop dedup | Same PDF saved 100 times |
| TC_UTIL_PROPSTORE_012 | not duplicate when size differs | Avoid false-positive | Match name only | Different versions wrongly merged |
| TC_UTIL_PROPSTORE_013 | deleteProposalFromLibrary removes (load returns null) | Delete works | No-op | "Delete" button does nothing |
| TC_UTIL_PROPSTORE_014 | no-throw on non-existent ID | Idempotent | Throw | Crash on double delete |
| TC_UTIL_PROPSTORE_015 | deleted proposal removed from recent list | Cache consistency | Stale list | UI shows ghost entries |
| TC_UTIL_PROPSTORE_016 | clearProposalLibrary empties | Reset works | No-op | Settings → Clear does nothing |
| TC_UTIL_PROPSTORE_017 | no-throw on empty clear | Idempotent | Throw | Crash |

**Strength:** **Strong** — TC_UTIL_PROPSTORE_007 (10-item cap) and TC_UTIL_PROPSTORE_011 (dedup) prevent two real production incidents.

---

## tests/utils/pwa.test.ts (14 tests)

**Production file:** [src/utils/pwa.ts](../../src/utils/pwa.ts)
**Protects:** Service-worker registration for offline + push update flow.

| ID | Test | Protects | Break | Impact |
|---|---|---|---|---|
| TC_UTIL_PWA_001 | rejects when serviceWorker missing | Browser-compat | Resolve silently | "Install offline" silent failure |
| TC_UTIL_PWA_002 | logger.error on missing SW | Visibility | Skip log | Cannot debug why offline broken |
| TC_UTIL_PWA_003 | does NOT call logger.info on missing SW | Avoid misleading log | Always log info | False "registered" log in monitoring |
| TC_UTIL_PWA_004 | resolves without throwing on success | Happy path | Throw | App crash on startup |
| TC_UTIL_PWA_005 | calls register with correct path and scope | Wiring | Wrong path | SW serves wrong scope, intercepts nothing |
| TC_UTIL_PWA_006 | logger.info on success | Monitoring | Skip | No "PWA installed" tracking |
| TC_UTIL_PWA_007 | does NOT call logger.error on success | No noise | Always error | Real errors hidden in spam |
| TC_UTIL_PWA_008 | does NOT call logger.warn on success | Same | Same | Same |
| TC_UTIL_PWA_009 | registers with exact scope `/` | Scope correctness | Subpath scope | SW doesn't catch root |
| TC_UTIL_PWA_010 | rejects with original error | Error propagation | Swallow | Caller cannot retry |
| TC_UTIL_PWA_011 | logger.error with error | Visibility | Skip | Silent failure |
| TC_UTIL_PWA_012 | does NOT call logger.warn on reject | Routing | Use warn | Wrong severity in monitoring |
| TC_UTIL_PWA_013 | propagates EXACT same error object | Reference equality | Wrap | Loses stack trace |
| TC_UTIL_PWA_014 | registers each time called | Idempotent caller | Cache result | Re-registration broken |

**Strength:** Strong — every branch + every logger call covered.

---

## tests/utils/quoteGrouping.test.ts (24 tests)

**Production file:** [src/utils/quoteGrouping.ts](../../src/utils/quoteGrouping.ts)
**Protects:** Default T&Cs, service-type extraction from descriptions, grouping items by service type, multi-service detection.

| ID | Test | Protects | Break | Impact |
|---|---|---|---|---|
| TC_UTIL_GRP_001 | DEFAULT_GENERAL_TERMS has exactly 6 items | Contract | Add/remove | T&C section wrong |
| TC_UTIL_GRP_002 | first term mentions GST | GST disclosure | Remove | **Legal/tax-compliance bug on every PDF** |
| TC_UTIL_GRP_003 | contains upfront payment term | Standard term | Remove | Missing payment terms |
| TC_UTIL_GRP_004-007 | strips "Rental Price", "Display Price", "Subscription Cost", "Service Charge" suffixes | Service-type extraction | Drop suffix | Items group incorrectly |
| TC_UTIL_GRP_008 | returns unchanged when no price suffix | Idempotent | Always strip | Plain descriptions mangled |
| TC_UTIL_GRP_009 | falls back to keyword "Branding" | Single-word fallback | Skip | Service-type detection fails |
| TC_UTIL_GRP_010 | falls back to keyword "Stickers" | Same | Same | Same |
| TC_UTIL_GRP_011 | falls back to "Misc" when no keyword | Safe default | Throw | Crash on unknown service |
| TC_UTIL_GRP_012 | multi-word stripped description | Multi-word handling | First word only | Wrong grouping key |
| TC_UTIL_GRP_013 | handles em-dash | Unicode separator | Only ASCII `-` | Em-dash separated items split wrong |
| TC_UTIL_GRP_014 | handles en-dash | Same | Same | Same |
| TC_UTIL_GRP_015 | groupItemsByServiceType returns [] for empty | Edge | Throw | Crash on empty quote |
| TC_UTIL_GRP_016 | groups same-type items together | Core grouping | Each item alone | PDF shows N rows instead of N grouped |
| TC_UTIL_GRP_017 | separates different types | Multi-group support | All in one | Wrong grouping |
| TC_UTIL_GRP_018 | subtotal = sum of item totals | **Math** | Wrong sum | **Wrong PDF totals — financial bug** |
| TC_UTIL_GRP_019 | subtotal uses item.total field | Field source | Use unitPrice | Doesn't account for discounts |
| TC_UTIL_GRP_020 | carries termsAndConditions from first item | Field propagation | Drop terms | Group T&Cs missing in PDF |
| TC_UTIL_GRP_021 | isMultiServiceQuote false for empty | Edge | Throw | Crash |
| TC_UTIL_GRP_022 | false when all same type | Detection | Always true | Wrong UI banner |
| TC_UTIL_GRP_023 | true when multiple types | Detection | Always false | Multi-service flow never triggered |
| TC_UTIL_GRP_024 | false for single item | Edge | Always true | Single-item quote flagged as multi |

**Strength:** **Strong**. TC_UTIL_GRP_002 and TC_UTIL_GRP_018 are the financial/legal high-stakes tests.

---

## Regression Table — Utilities (HIGHEST impact only)

| Test | Module | Why it matters |
|---|---|---|
| TC_UTIL_LOGGER_007/008/009 | Logger | **PII compliance / GDPR** |
| TC_UTIL_PROMPT_010 | Prompts | Wrong financial formula in AI |
| TC_UTIL_PROMPT_019 | Prompts | **Prevents secret leakage in prompts** |
| TC_UTIL_GRP_002 | Grouping | GST disclosure on every PDF (legal) |
| TC_UTIL_GRP_018 | Grouping | **Wrong PDF totals — financial bug** |
| TC_UTIL_PROPSTORE_007 | Proposals | localStorage quota crash |
| TC_UTIL_PROPSTORE_011 | Proposals | Duplicate dedup — prevents storage cost explosion |
| TC_UTIL_FILE_005/006/012 | Files | Memory blow-up from huge uploads |
| TC_UTIL_PDF_024 | PDF | Multi-page PDF support |
| TC_UTIL_PDF_034 | PDF | Crash without Gemini key in staging |
