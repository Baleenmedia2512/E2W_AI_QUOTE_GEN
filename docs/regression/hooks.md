# Hooks Module — Test Documentation (CONCISE)

2 hook test files, 18 tests.

| ID prefix | File | Tests |
|---|---|---|
| TC_HOOK_REG_* | tests/hooks/useCityServiceRegistry.test.ts | 13 |
| TC_HOOK_SYNC_* | tests/hooks/useCompanySync.test.ts | 5 |

---

## useCityServiceRegistry (13 tests)

**Production file:** [src/hooks/useCityServiceRegistry.ts](../../src/hooks/useCityServiceRegistry.ts)
**Protects:** Module-singleton `Map<city, ServiceRegistryStatus>`, list of known cities, hook that scans active proposals and populates the registry, sessionStorage persistence.

| ID | Test | Break | Impact |
|---|---|---|---|
| TC_HOOK_REG_001 | getCityServiceRegistry returns empty Map initially | Return non-Map | Crash on `.get` |
| TC_HOOK_REG_002 | returns same Map reference on successive calls (singleton) | New Map each call | State lost between subscribers |
| TC_HOOK_REG_003 | KNOWN_CITY_LIST is non-empty array of lowercase names | Empty / mixed case | Detection fails for every city |
| TC_HOOK_REG_004 | contains expected cities | Remove city | Quotes for that city not classified |
| TC_HOOK_REG_005 | all entries are lowercase strings | Capitalize | Case-mismatched comparisons miss |
| TC_HOOK_REG_006 | hook does not throw when activeProposals empty | Throw | Pages with no proposals crash |
| TC_HOOK_REG_007 | does not modify registry when no proposals | Mutate anyway | Cross-test contamination + stale UI |
| TC_HOOK_REG_008 | skips proposal whose textContent <50 chars | Process anyway | Tiny PDFs trigger expensive Gemini call |
| TC_HOOK_REG_009 | sets registry status to "pending" when scanning starts | Set wrong status | Wrong UI state |
| TC_HOOK_REG_010 | does NOT overwrite existing "complete" entry | Overwrite | Loses completed scan, re-runs |
| TC_HOOK_REG_011 | does NOT overwrite entry that is "pending" | Overwrite | Double-scan same city |
| TC_HOOK_REG_012 | registry starts empty after sessionStorage cleared | Persist anyway | Stale data across sessions |
| TC_HOOK_REG_013 | persists to sessionStorage after manual populate | Skip persistence | Loses progress on page refresh |

**Strength:** Strong — covers singleton, immutability against stale data, persistence. **Why it matters:** Without TC_HOOK_REG_010/011, the system would re-run Gemini Vision against the same city repeatedly, wasting API quota.

---

## useCompanySync (5 tests)

**Production file:** [src/hooks/useCompanySync.ts](../../src/hooks/useCompanySync.ts)
**Protects:** On-mount sync from Supabase, optional realtime subscription, unsubscribe on unmount.

| ID | Test | Break | Impact |
|---|---|---|---|
| TC_HOOK_SYNC_001 | calls syncCompanyFromDatabase on mount | Drop call | Company data never loads from Supabase |
| TC_HOOK_SYNC_002 | does NOT call enableCompanySync when enableRealtime=false (default) | Always subscribe | Unnecessary websocket + cost |
| TC_HOOK_SYNC_003 | calls enableCompanySync when enableRealtime=true | Drop | Realtime never enabled |
| TC_HOOK_SYNC_004 | calls unsubscribe on unmount when realtime was enabled | Drop | **Memory leak / orphaned websockets** |
| TC_HOOK_SYNC_005 | does NOT call unsubscribe when realtime was NOT enabled | Always call | Crash on undefined unsubscribe |

**Strength:** Strong. TC_HOOK_SYNC_004 prevents the most common memory leak in subscription hooks.

---

## Regression Table — Hooks

| Test | Why it matters |
|---|---|
| TC_HOOK_SYNC_001 | Company data not loaded |
| TC_HOOK_SYNC_004 | Websocket leak on every page-change |
| TC_HOOK_REG_010/011 | Wasted Gemini Vision API spend |
| TC_HOOK_REG_013 | Progress lost across page refreshes |
