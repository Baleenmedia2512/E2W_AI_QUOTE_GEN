# Chat Refactor Plan

**Branch:** `refactor/chat-golden-rule-engine`

---

## Requirements

1. **Better, consistent chat** — same tone every reply
2. **Same AI model** — `gemini-3.1-flash-lite` (no upgrade)
3. **Less code / less logic** than today
4. **AI parses → DB decides → user sees DB** (not AI prose)
5. **Keep queue** for multi-service (`bus and auto`, mixed cities)
6. **Don't break what works today** — all `progressiveChat*.test.ts` must pass each phase
7. **Cities & services from DB** — no hardcoded `KNOWN_CITY_LIST` / `CLOUD_CITY_KEYS` in chat path (typos/plurals OK)

### Golden rule

```
Filter DB → count options:
  0  → not available
  1  → auto-lock, next field
  2+ → show chips
```



### Queue rule

```
Parse → queue [{service, city, qty, place}, ...]
→ finish active → "Now choosing {next}…" → one quote at end
```



### Product rules (never change)


| Rule              | Example                                     |
| ----------------- | ------------------------------------------- |
| Funnel order      | Type → City → Area → Direction → Quote      |
| Chips from DB     | OMR, Frontlit, real `direction_remarks`     |
| Place ≠ direction | `near omr` ≠ match from `direction_remarks` |
| Type before city  | Never city → type → city again              |
| Mixed city batch  | `cab madurai and auto chennai`              |
| Shared city batch | `bus and auto in chennai`                   |




### Test gate (after every phase)

```bash
npx vite-node src/utils/progressiveChat.funnelState.test.ts
npx vite-node src/utils/progressiveChat.multiServiceCity.test.ts
npx vite-node src/utils/progressiveChat.busShelterAdyar.test.ts
npx vite-node src/utils/progressiveChat.avinashiPlace.test.ts
npx vite-node src/utils/progressiveChat.exactSegmentBatch.test.ts
npx vite-node src/utils/progressiveChat.chennaiStatewideBatch.test.ts
npx vite-node src/utils/progressiveChat.mobileVanBatch.test.ts
npx vite-node src/utils/progressiveChat.areaClearsDirection.test.ts
```



### Flag

`VITE_USE_NEW_CHAT_ENGINE` — emergency kill-switch, default **on**. Set `false` only to disable golden-rule routing.

---



## Roadmap (start → end)

```
START
  │
  ├─ Create branch: refactor/chat-golden-rule-engine
  ├─ Run all 8 tests once (baseline must pass)
  │
  ▼
PHASE 1 — Consistent replies
  │  Old engine only. No AI text in chat bubbles.
  │  Tests must pass.
  ▼
PHASE 2 — Parse module (AI JSON + DB validate)
  │  src/chat/parseIntent.ts. Catalog from DB only.
  │  Old engine still handles turns. Tests must pass.
  ▼
PHASE 3 — Golden rule engine (single service)
  │  filterCatalog + resolveNextStep + handleChatTurn
  │  Flag on for single-service only; batch → old engine fallback.
  │  Tests must pass.
  ▼
PHASE 4 — Queue (multi-service batch)
  │  queue.ts replaces multiple startBatch* paths
  │  Flag on for batch too. All batch tests must pass.
  ▼
PHASE 5 — Thin ChatInterface
  │  UI calls handleChatTurn / continueChatAction only
  │  All 8 tests pass with USE_NEW_CHAT_ENGINE=true
  ▼
PHASE 6 — Cutover
  │  Flag default true. Delete progressiveChatEngine.ts
  │  Remove hardcoded city lists from chat. All tests pass.
  ▼
PHASE 7.1 — Funnel modules; active paths stop importing engine.ts
  ▼
PHASE 7.2 — Delete engine.ts; fixtures un-skip 13 cases; public API
  ▼
END — Merge branch
```



### Target folder (end state)

```
src/chat/
  types.ts
  parseIntent.ts
  filterCatalog.ts
  resolveNextStep.ts
  queue.ts
  copy.ts
  handleChatTurn.ts
  continueChatAction.ts
  index.ts
```

---



## Phase 1 — Consistent replies

**Requirement:** Consistent chat · user sees templates, not AI prose

**Done when:**

- [ ] No AI `shortReply` in visible chat
- [ ] All 8 tests pass
- [ ] Funnel unchanged



### Implementation prompt

```
Implement Phase 1 of CHAT_REFACTOR_PLAN.md only.

Rules:
- Do NOT create src/chat/ yet
- Do NOT delete progressiveChatEngine.ts
- Do NOT change funnel logic or queue behavior
- Do NOT upgrade AI model

Tasks:
1. chatIntentAiService.ts: keep parseChatIntentWithAi JSON; never show shortReply to user.
2. progressiveChatEngine.ts: preferEngineCopy / compactFunnelReply always wins for botText; audit intent.shortReply and aiReply paths.
3. ChatInterface.tsx: do not pass shortReply into visible message content.
4. Optional: small formatReply(avail, ask) helper — minimal diff only.

Verify: all 8 progressiveChat*.test.ts pass.
Do not start Phase 2.
```

---



## Phase 2 — AI parse + DB catalog validate

**Requirement:** Same AI model · AI parses JSON · cities/services from DB only

**Done when:**

- [ ] `src/chat/parseIntent.ts` exists
- [ ] Segments validated against `getCatalogTypeKeys` + `getCatalogCities`
- [ ] `cab madurai and auto in chennai` → 2 validated segments
- [ ] All 8 tests pass (old engine still handles turns)



### Implementation prompt

```
Implement Phase 2 of CHAT_REFACTOR_PLAN.md only.

Rules:
- Do NOT wire handleChatTurn yet
- Do NOT delete progressiveChatEngine.ts
- Model: gemini-3.1-flash-lite only
- NO KNOWN_CITY_LIST / CLOUD_CITY_KEYS in new parse module

Tasks:
1. Create src/chat/types.ts — ParsedSegment, ParseResult types.
2. Create src/chat/parseIntent.ts:
   - parseMessage(text, session, dbServices) → ParseResult
   - AI when not skippable; local fallback for hi, browse, simple media
   - Catalog from getCatalogTypeKeys + getCatalogCities (DB only)
   - Validate service/city per segment; invalid → null
   - Batch split: delegate to parseServiceSegments for now
3. chatIntentAiService.ts: session context in prompt; segments[] schema; ignore shortReply in callers.
4. Add USE_NEW_CHAT_ENGINE=false (unused until Phase 3).

Verify: all 8 progressiveChat*.test.ts pass. resolveProgressiveText unchanged.
Do not start Phase 3.
```

---



## Phase 3 — Golden rule (single service)

**Requirement:** Less code · DB decides · single-service cases work on new engine

**Done when:**

- [ ] `bus in chennai`, `hoarding near omr`, `led`, unknown place, not-in-city work with flag on
- [ ] Batch still uses old engine fallback
- [ ] funnelState, busShelterAdyar, avinashiPlace, areaClearsDirection tests pass



### Implementation prompt

```
Implement Phase 3 of CHAT_REFACTOR_PLAN.md only.

Rules:
- USE_NEW_CHAT_ENGINE default false; true = single-service only
- Batch (parseServiceSegments >= 2) MUST fallback to resolveProgressiveText
- Funnel: Type → City → Area → Direction → Quote
- Chips = DB values only; place from area_name/city, NOT direction_remarks
- Do NOT delete progressiveChatEngine.ts

Tasks:
1. filterCatalog.ts — filter by session (medium, mediumType, city, area, directionHint).
2. resolveNextStep.ts — golden rule 0/1/2+ per funnel field in order.
3. copy.ts — formatReply(avail, ask), max 2 lines.
4. handleChatTurn.ts — parse → single segment → filter → resolveNextStep → ProgressiveTurnResult shape.
5. index.ts — public exports.
6. ChatInterface: USE_NEW_CHAT_ENGINE && single segment → handleChatTurn; else old path.

Verify: funnelState, busShelterAdyar, avinashiPlace, areaClearsDirection pass with flag true.
Do not start Phase 4.
```

---



## Phase 4 — Queue (multi-service)

**Requirement:** Keep queue · mixed + shared city batch

**Done when:**

- [ ] `queue.ts` — one module, no new startBatch*
- [ ] multiServiceCity, exactSegmentBatch, chennaiStatewideBatch, mobileVanBatch pass with flag on
- [ ] One quote at end



### Implementation prompt

```
Implement Phase 4 of CHAT_REFACTOR_PLAN.md only.

Rules:
- ONE queue.ts — no startBatch* functions
- One active job at a time; never clear queue early
- Handoff: "Now choosing …" not "Next — …"
- Shared city: bus and auto in chennai → same city both segments
- Mixed city: cab madurai and auto chennai → per-segment city
- Not in city: skip segment + message, continue queue
- Do NOT delete progressiveChatEngine.ts yet

Tasks:
1. queue.ts — buildQueue, getActive, advanceQueue, skipActive.
2. handleChatTurn — multi-segment → queue → resolveNextStep per active → advance on complete.
3. collectedRows / collectedServiceIds — match existing quote merge.
4. USE_NEW_CHAT_ENGINE=true routes batch through new engine.

Verify: multiServiceCity, exactSegmentBatch, chennaiStatewideBatch, mobileVanBatch pass.
Do not start Phase 5.
```

---



## Phase 5 — Thin ChatInterface

**Requirement:** Less code in UI · one entry point

**Done when:**

- [ ] ChatInterface calls handleChatTurn / continueChatAction only (progressive path)
- [ ] All 8 tests pass with USE_NEW_CHAT_ENGINE=true
- [ ] Manual smoke passes (see below)



### Implementation prompt

```
Implement Phase 5 of CHAT_REFACTOR_PLAN.md only.

Rules:
- ChatInterface = UI + service calls only (progressive path)
- Move parse, geocode, intent merge into handleChatTurn layer
- Keep appendProgressiveResult for rendering
- Do NOT delete progressiveChatEngine.ts yet
- Do NOT delete legacy cloud path yet
- USE_NEW_CHAT_ENGINE=true handles all progressive cases

Tasks:
1. continueChatAction.ts — chip/confirm via resolveNextStep + queue.
2. ChatInterface progressive block: load dbServices → handleChatTurn or continueChatAction.
3. Remove inline parseChatIntentWithAi / intent assembly from ChatInterface.

Verify: all 8 progressiveChat*.test.ts pass with USE_NEW_CHAT_ENGINE=true.

Manual smoke:
- hi → service chips
- 50 bus in chennai → quote path
- led → clarify chips
- near vadaplani → not found, session cleared
- cab madurai and auto in chennai → queue handoff
- bus and auto in chennai → shared city
- multi-type Confirm → one quote
- min qty warning works

Do not start Phase 6.
```

---



## Phase 6 — Cutover + delete old code

**Requirement:** Less code final · dynamic catalog · tests prove parity

**Done when:**

- [ ] USE_NEW_CHAT_ENGINE=true default
- [ ] progressiveChatEngine.ts deleted
- [ ] No chat imports of KNOWN_CITY_LIST / CLOUD_CITY_KEYS / REAL_CITY_KEYS
- [ ] All 8 tests pass on new engine only



### Implementation prompt

```
Implement Phase 6 of CHAT_REFACTOR_PLAN.md only.

Rules:
- All 8 progressiveChat*.test.ts must pass before delete
- USE_NEW_CHAT_ENGINE=true by default
- Delete progressiveChatEngine.ts only when zero imports remain
- Migrate test imports to src/chat/index.ts
- Remove hardcoded city lists from chat path
- Keep min qty / duration confirm
- Do NOT upgrade AI model

Tasks:
1. Grep progressiveChatEngine imports → migrate to src/chat/.
2. Fix regressions; run full test gate.
3. Delete progressiveChatEngine.ts.
4. Remove dead legacy ChatInterface send path if safe.
5. Update .env.example: USE_NEW_CHAT_ENGINE=true.

Verify: full test gate + manual smoke from Phase 5.
```

---

## Phase 7 — Funnel modules + delete engine (complete)

**7.1 done:** `src/chat/funnel/*` owns types, copy, location, filter, resolve, batch. Active paths do not import `engine.ts`.

**7.2 done:**

- [x] `src/chat/engine.ts` deleted
- [x] Tests / ChatInterface / smoke import `src/chat/index.ts` only
- [x] No `KNOWN_CITY_LIST` / `CLOUD_CITY_KEYS` / `REAL_CITY_KEYS` in `src/chat/`
- [x] 13 previously skipped cases run on fixture rows in `progressiveChat.testCatalog.ts` (Bus Semi pinned to Chennai sole-site; Gemini / Navallur / ECR Road fixture directions)
- [x] `VITE_USE_NEW_CHAT_ENGINE` kill-switch default on
- [x] Public API documented in `src/chat/index.ts`

Implementation still lives in `funnel/body.ts` (product logic was not deleted). **`src/chat/` ≈ 13.5k lines excl. tests** (`body.ts` ~11.4k). The 4–6k rewrite ceiling was not met without dropping funnel/batch rules.

---

*Phases 1–7 complete.*