# Constants Module — Test Documentation (CONCISE)

1 test file, 4 tests.

| ID prefix | File | Tests |
|---|---|---|
| TC_CONST_DEFCO_* | tests/constants/defaultCompany.test.ts | 4 |

---

## defaultCompany (4 tests)

**Production file:** [src/constants/defaultCompany.ts](../../src/constants/defaultCompany.ts)
**Protects:** The fallback `CompanyInfo` object used when no company info has been saved yet.

| ID | Test | Break | Impact |
|---|---|---|---|
| TC_CONST_DEFCO_001 | exports a non-null object | Export null | App crash on first load |
| TC_CONST_DEFCO_002 | has all required CompanyInfo fields | Remove field | Form pre-fill misses field |
| TC_CONST_DEFCO_003 | non-empty strings for name, phone, email, website | Empty out | Empty placeholder values shown to user |
| TC_CONST_DEFCO_004 | empty strings for logo and gst (no sensitive defaults) | Add default logo/gst | **Wrong company's branding/GST on every new user's first quote** |

**Strength:** Strong (small contract, every field guarded). **Why it matters:** TC_CONST_DEFCO_004 prevents the worst-case scenario: shipping the default GST of *some other company* in every new user's PDFs.

---

## Regression Table — Constants

| Test | Why it matters |
|---|---|
| TC_CONST_DEFCO_004 | Prevents shipping a real GSTIN as a default value |
| TC_CONST_DEFCO_001 | First-load crash guard |
