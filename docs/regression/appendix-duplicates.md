# Appendix — Duplicate Test Files

## The duplication

Seven test files live under `src/__tests__/` and **duplicate** tests that already exist under `tests/`. This adds ~80 redundant test cases that Vitest runs on every PR, inflating both CI time and the headline test count.

| Duplicate location | Canonical location | Duplicate count (≈) |
|---|---|---|
| `src/store/__tests__/authStore.test.ts` | [tests/store/authStore.test.ts](../../tests/store/authStore.test.ts) | 33 |
| `src/utils/__tests__/bulletPointParser.test.ts` | tests/utils/bulletPointParser.test.ts | 29 |
| `src/utils/__tests__/cacheVersion.test.ts` | tests/utils/cacheVersion.test.ts | 11 |
| `src/utils/__tests__/fileUtils.test.ts` | tests/utils/fileUtils.test.ts | 22 |
| `src/utils/__tests__/localStorage.test.ts` | tests/utils/localStorage.test.ts | 22 |
| `src/utils/__tests__/pdfUtils.test.ts` | tests/utils/pdfUtils.test.ts | 47 |
| `src/utils/__tests__/quoteGrouping.test.ts` | tests/utils/quoteGrouping.test.ts | 24 |

> Counts approximate; depends on whether the duplicates have drifted. Run `npm test -- --reporter=verbose` to compare.

## Why this is a problem

1. **Inflated test count** — the headline "717 tests" includes the ~188 duplicate runs. Real unique-test count is closer to **530**.
2. **Drift risk** — when one copy is updated, the other rots. Hidden inconsistency makes regressions ambiguous.
3. **CI cost** — duplicates roughly double the wall-clock time of the slowest-suite modules (pdfUtils alone).
4. **Discoverability noise** — a developer searching for "authStore tests" finds two files and doesn't know which is authoritative.

## Recommended cleanup

```powershell
# From repo root, after confirming the canonical copies pass
git rm src/store/__tests__/authStore.test.ts
git rm src/utils/__tests__/bulletPointParser.test.ts
git rm src/utils/__tests__/cacheVersion.test.ts
git rm src/utils/__tests__/fileUtils.test.ts
git rm src/utils/__tests__/localStorage.test.ts
git rm src/utils/__tests__/pdfUtils.test.ts
git rm src/utils/__tests__/quoteGrouping.test.ts

# Also remove the now-empty __tests__ folders if any
git status
git commit -m "chore(tests): remove duplicated test files under src/__tests__"
```

After deletion, run:

```powershell
npm test
```

…and confirm:
- Pass count drops by the duplicate count (and **all suites still pass**).
- No coverage drops on the production files (the canonical `tests/` files cover them).
- CI wall-clock drops.

## How to prevent recurrence

Add a guard in CI: a small script that fails the build if any `*.test.ts(x)` file appears under `src/`.

```powershell
# scripts/check-no-test-in-src.ps1
$found = Get-ChildItem -Path src -Recurse -Include *.test.ts, *.test.tsx
if ($found) {
  Write-Error "Test files must live under tests/, not src/:`n$($found -join "`n")"
  exit 1
}
```

Wire into `.github/workflows/pr-checks.yml` (see [claude.md PART 11](../../claude.md)):

```yaml
- name: No tests under src
  run: pwsh scripts/check-no-test-in-src.ps1
```

## Until cleanup is done

For purposes of this documentation set, **only the canonical `tests/` files have been catalogued**. The duplicate `src/__tests__/` copies are intentionally excluded from:

- [services.md](./services.md)
- [store.md](./store.md)
- [utils.md](./utils.md)

If the duplicates have drifted, those drift differences are *not* documented anywhere — another reason to delete them.
