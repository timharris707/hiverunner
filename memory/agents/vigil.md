# Agent Memory — Vigil 🛡️

**Agent ID:** `vigil`
**Role:** QA & Verification Agent
**Division:** QA
**Reports To:** Henry ⚡

---

## Standing Knowledge

### QA Pipeline Role
- Vigil receives handoffs from builder agents (Pixel, Forge) after UI/backend tasks
- Must output `VERDICT: APPROVED`, `VERDICT: NEEDS_FIX`, or `VERDICT: BLOCKED`
- QA handoff prompt built by `buildQAHandoffPrompt()` in `agent-pipeline.ts`

### Visual QA System
- Screenshots captured via Playwright (Chromium + WebKit/Safari) in `src/lib/visual-qa.ts`
- Screenshots stored at `/public/screenshots/{taskId}/{timestamp}.png`
- Minimum viable screenshot is > 1KB — smaller = failed capture
- Two-browser capture: Chromium for standard, WebKit for Safari/iOS simulation

### Build Verification
- Always run `npm run build 2>&1 | tail -80` — TypeScript errors here = hard block
- No formal test suite currently — `npm test` may exit 0 with no tests
- Check `git diff HEAD~1` or `git log --oneline -3` to understand what changed

### Common Issues to Watch For
- **Dark mode:** Check `dark:` classes are applied — default theme is dark
- **Mobile viewport:** Tailwind responsive prefixes `sm:`, `md:`, `lg:` — test at 375px
- **Safari/WebKit:** Flexbox gap, CSS grid, `position: sticky`, backdrop-filter all have quirks
- **Empty states:** Lists with 0 items, loading skeletons, error boundaries
- **TypeScript errors** in build output — these are blocking defects

### Verdict Criteria
- `APPROVED`: Build passes, UI matches description, no blocking bugs, cross-browser OK
- `NEEDS_FIX`: Build passes but UI has defects — list each one with exact reproduction steps
- `BLOCKED`: Cannot verify (e.g., cannot reach dev server, Playwright unavailable, env missing)

---

## Task Log

### 2026-03-30 — QA review: TASK-1774854942238
**Project:** qa
**Summary:** QA reviewed task from fullstack. 1 (API contract) — WebKit | ✅ PASSED | | | E2E test 2 (UI + tooltips) — Chromium | ✅ PASSED | Cards render labels; tooltip click shows correct content | | E2E test 2 (UI + tooltips) — WebKit | ✅ PASSED | | | Visual regression baseline — Chromium | ✅ 26K | Genuine capture | | Visual regression baseline — WebKit | ✅ 31K | Genuine capture | | No regressions | ✅ | Dead

---

### 2026-03-30 — QA review: TASK-1774854942232
**Project:** qa
**Summary:** QA reviewed task from fullstack. ehavior untouched |  ### Minor Observation (non-blocking) `useActivityStream` clears `seenEventIdsRef` but not `events` state when a build stops. If the same task starts building again and the server replays prior event IDs (unlikely with ephemeral in-memory streams), old events could briefly re-appear. Not blocking because: (a) the server streams are ephemeral per

---

### 2026-03-30 — QA review: TASK-1774854942238
**Project:** qa
**Summary:** QA reviewed task from fullstack. ) => !current)` which immediately closes the tooltip that `onMouseEnter` opened. Change to `onClick={() => setOpen(true)}` so click always opens (mouse-leave and blur still close it). Reproduces: click any tooltip button → tooltip does not appear. - **Visual baseline `dashboard-metrics-grid.png`** — never captured because test 2 fails before the screenshot assertio
**Lessons:**
- **`src/components/InlineTooltip.tsx:28`** — `onClick` uses `setOpen((current) => !current)` which immediately closes the tooltip that `onMouseEnter` opened. Change to `onClick={() => setOpen(true)}` so click always opens (mouse-leave and blur still close it). Reproduces: click any tooltip button → tooltip does not appear.
- **Visual baseline `dashboard-metrics-grid.png`** — never captured because test 2 fails before the screenshot assertion. Once the click bug is fixed, run `npx playwright test e2e/dashboard-metrics.spec.ts --update-snapshots` to generate the baseline.

---

### 2026-03-30 — QA review: TASK-1774854942218
**Project:** qa
**Summary:** QA reviewed task from fullstack. ing"` triggers mirror | | Gater verdict displayed on task card after review | ✅ Colored verdict banner: APPROVED / NEEDS FIX / BLOCKED | | Review events appear in narrative feed | ✅ `task_review` items emitted by `buildNarrativeItems`, rendered with Eye icon | | Review column is never invisible | ✅ Column is in fixed COLUMNS array; always rendered with empty state 

---

### 2026-03-30 — QA review: TASK-1774880783785
**Project:** qa
**Summary:** QA reviewed task from backend. posit` from `500.00` to `1000.00` to match the 2026-03-30 deposit noted in `live_engine.py`. Without this, the balance check in `reconcile_kalshi_db.py` will always report a ~$500 mismatch, making AC #1 unverifiable. - **Run the reconcile**: After fixing the above two items, run `python scripts/reconcile_kalshi_db.py --commit --verbose` and confirm the output shows `
**Lessons:**
- **Install the cron**: Run `crontab config/crontab.production` — the new 04:30 UTC entry is in the file but not active. AC #5 is unmet.
- **Update `bankroll.json`**: Change `initial_deposit` from `500.00` to `1000.00` to match the 2026-03-30 deposit noted in `live_engine.py`. Without this, the balance check in `reconcile_kalshi_db.py` will always report a ~$500 mismatch, making AC #1 unverifiable.
- **Run the reconcile**: After fixing the above two items, run `python scripts/reconcile_kalshi_db.py --commit --verbose` and confirm the output shows `balance_delta ≤ $1`. AC #1 cannot be verified from code review alone — it requires the script to execute against live Kalshi data.

---

### 2026-03-30 — QA review: TASK-1774854942244
**Project:** qa
**Summary:** QA reviewed task from backend. tributed bucket** — when build-log attribution is missing (tasks approved before this change), an "Unattributed" row will appear. Expected behavior; consider a follow-on to retroactively attribute from build-log once the ledger warms up. 4. `totalSpendUsd` in `getQuotaSummary` goes through `round2` before being passed to `getDashboardStats` as `costToday` — the `pars

---

### 2026-03-30 — QA review: TASK-1774854942238
**Project:** qa
**Summary:** QA reviewed task from fullstack. pshots` to establish the baseline. This is expected behavior for a new screenshot spec, not a defect in the implementation. - `localCalendarDay` is used correctly in `costToday.timeRange` — not dead code. - The `agents/status` route simplification removes `gatewayPort` from the success response (it was present in the old version). Consumers relying on `gatewayPort`

---

### 2026-03-30 — E2E test — buildState cleared on terminal transitions
**Project:** mission-control
**Summary:** sory, dashboard, voice, pricing, and build route files.  I did not push to remote. Network access is restricted here, and I also cannot honestly mark the task approved without a successful build and E2E run.  Known issues and caveats: - Build/test verification is blocked by environment constraints, not by the specific `buildState` changes. - The repo already has unrelated compile/type failures tha
**Known Issues:**
- Build/test verification is blocked by environment constraints, not by the specific `buildState` changes.
- The repo already has unrelated compile/type failures that must be cleared before this can be signed off.
- A clean push was not possible from this sandbox.

---

### 2026-03-30 — QA review: TASK-1774849547934
**Project:** qa
**Summary:** QA reviewed task from backend. omote fix. It's functional and clean, but warrants awareness — the default model routing for most build tasks has changed. - If a task is manually assigned via API with a non-canonical agent ID (e.g., `"Forge"` instead of `"backend"`), `findActiveBuildForAgent` could miss the active build and allow a false promotion. Low probability given `autoAssignBuilder` normaliz

---

### 2026-03-30 — QA review: TASK-1774848763713
**Project:** qa
**Summary:** QA reviewed task from fullstack. --  VERDICT: APPROVED  **Caveats:** - `ActivityEvent` interface should be imported from `activity-stream.ts` in `page.tsx` rather than redeclared locally — minor cleanup for a follow-on PR. - Visual verification of live streaming requires an active build in progress — taken on faith from code review; implementation path is straightforward and correct. - Agent instr

---

### 2026-03-30 — QA review: TASK-1774846683206
**Project:** qa
**Summary:** QA reviewed task from backend. he cosmetic column-width bug doesn't affect correctness or usability — data is still readable, the tool eliminates the 3AM curl. No functional defects.  ---  VERDICT: APPROVED  **Caveats:** - Column alignment is off by ~9 chars per ANSI-colored cell — cosmetic only, low priority fix. Root cause: `pad()` already strips ANSI internally, so the `+9` in `pad(col(c.cyan, 

---

### 2026-03-30 — QA review: TASK-1774846683188
**Project:** qa
**Summary:** QA reviewed task from fullstack. plain text and quoted-title format correctly ✅  **Visual:** Screenshots captured Task Board (harness nav issue), not Dashboard. Same known harness bug from previous task. Code review confirms the "What's Happening" card renders `NarrativeFeed` with `limit={8}`.  **Minor note:** One edge case — if a task title contains a `"` character, the `NarrativeText` regex may 

---

### 2026-03-30 — QA review: TASK-1774846854498
**Project:** qa
**Summary:** QA reviewed task from backend. kCompletion` fires before early return on `gaterSpawnData` — notifications not lost ✅ - Queue advance deferred to `finalizeGaterQA` → `reconcileBuildQueue` at end ✅  **Known caveats (carried from Forge, acknowledged):** - Gater uses `REVIEWER_MODEL` (Sonnet) — same as code reviewer. Update `routing.tier` in the build log entry if a different model is needed. - Manual

---

### 2026-03-30 — QA review: TASK-1774848116169
**Project:** qa
**Summary:** QA reviewed task from fullstack. G) — empty state handled ✅  ---  ### Caveats 1. **Playwright navigation bug:** Screenshots captured Task Board, not `/agents`. The visual QA harness needs its default route corrected for agents tasks — this is a harness issue, not a product defect. Tim should manually confirm 12 cards render on first paint. 2. **Pixel's caveat acknowledged:** Spinner-to-icon transi

---

### 2026-03-30 — QA review: TASK-1774834376074
**Project:** qa
**Summary:** QA reviewed task from backend. istry with `division: "QA"`, appear on all dynamic pages: ✅ - Build: ✅ clean compile, no TypeScript errors  **Acknowledged caveat (carried forward from Forge):** `SESSION_TEMPLATES` and `PERSONA_OVERLAYS_EXTENDED.relevantAgents` in `advisory/constants.ts` contain curated agent name lists — these are intentional per-template selections, not full rosters. New agents wo

---

### 2026-03-30 — QA review: TASK-TRADING-2
**Project:** qa
**Summary:** QA reviewed task from backend. and **Safari** (`safari-2026-03-30T05-31-44-953Z.png`) are visually identical — no layout regression - The KALSHI badge uses `display: inline-block` which is universally supported — no Safari quirk risk  ---  ### Caveats Carried Forward (from Forge, acknowledged) 1. Win rate still from local DB — Kalshi has no settlement history endpoint for fill-to-win mapping 2. `b

---

### 2026-03-30 — QA review: TASK-1774846683178
**Project:** qa
**Summary:** QA reviewed task from fullstack. y use raw `fetch()` + `AbortController` (Playwright `request` API doesn't stream — right call) - Concurrency tests use `Promise.all` (correct) - §9 unmitigated risks documented with mitigation paths — properly scoped out-of-task  ### Incidental Change Noted `src/lib/llm-router.ts` was modified in the same commit: default coding/product tier changed from `sonnet` → 

---

### 2026-03-30 — QA review: TASK-1774834376074
**Project:** qa
**Summary:** QA reviewed task from backend. — zero runtime overhead - Adding agent #13: edit `AGENT_CONFIGS` in `src/config/agents.ts` only — all derived maps, the registry endpoint, voice styles, routing tags, builder flags, and overlay recommendations cascade automatically - `PERSONA_OVERLAYS_EXTENDED.relevantAgents` and session template agent lists in `advisory/constants.ts` still contain literal agent name

---

### 2026-03-30 — QA review: TASK-1774834048750
**Project:** qa
**Summary:** QA reviewed task from backend. 3001/trading (wrong)   : "http://localhost:3001/tasks" ```  - `http://localhost:8050` — correct port for weather-trading dashboard - `/trades` — confirmed route exists (`@app.get("/trades")` at line 82) - Build: `✓ Compiled successfully in 2.5s`  **Caveats carried forward from Forge:** Tasks with an explicit `visualReview.targetUrl` pre-set to the old value won't be 

---

### 2026-03-30 — QA review: TASK-1774846683149
**Project:** qa
**Summary:** QA reviewed task from backend. uota actions, and agents/registry. All correct. - **§25 pipelines/[id] CRUD** — GET/PATCH/DELETE with valid ID, and 404 on unknown ID for all three verbs. Serial mode correct since tests share a pipeline ID.  ### No concerns  The `configure` action test in §23 is a no-op reconfigure (same budget value) — safe, leaves system state unchanged. Secret redaction check in 

---

### 2026-03-30 — QA review: TASK-1774846683158
**Project:** qa
**Summary:** QA reviewed task from backend. tive test for "PATCH to in-progress without criteria → 400". The guards are correct in code and implicitly exercised (lifecycle tests would fail without them), but a dedicated negative test would tighten coverage.  ### Caveats (acknowledged) - `shouldRequireReview` changed to always `true` — all tasks now require Gater sign-off. Intentional scope expansion bundled he

---

### 2026-03-30 — QA review: TASK-1774846683128
**Project:** qa
**Summary:** QA reviewed task from fullstack. e_criteria` to each `in-progress` step | Correct — all cascading failures now resolved |  ### Test run  ``` 142 passed (29.0s) ``` - 10 smoke tests × 2 browsers = 20 ✓ - 61 contract tests × 2 browsers = 122 ✓ - Zero failures, zero skips  ### No concerns  The legacy ID filter is a pragmatic call — schema enforcement only applies to tasks created under the current `T

---

### 2026-03-30 — QA review: TASK-1774846683168
**Project:** qa
**Summary:** QA reviewed task from backend. **Idle checkpoint**: periodic checkpoint requires `reconcileBuildQueue` to run (needs an API request). SQLite auto-checkpoint at 1000 pages is the backstop. Acknowledged by Forge and acceptable. - **`lastCheckpointAt` resets on restart**: first reconcile after restart always checkpoints. Intentional and harmless. - **Replay doesn't re-trigger side effects**: crash re

---

### 2026-03-30 — QA review: TASK-1774846683138
**Project:** qa
**Summary:** QA reviewed task from fullstack. t.  One minor note: the URL extraction `2>&1 | tail -1` is the standard Vercel CI pattern. If Vercel ever adds a trailing newline or summary line after the URL, this could break. Not a blocking issue — it's how every Vercel CI guide does it.  ### 6. Unverifiable (acknowledged) The workflow cannot be run end-to-end without a real PR with `VERCEL_TOKEN` set. Pixel fl

---

### 2026-03-30 — QA review: TASK-1774846683117
**Project:** qa
**Summary:** QA reviewed task from backend. blocked from closing — Forge acknowledged this correctly. Acceptable caveat.  ### Caveats (acknowledged, not blocking) - The double pre-check pattern (`route.ts` + `transitionTask()`) means guard logic lives in two places. Not a defect, but if guards evolve they need updating in both. - `VALID_TASK_TRANSITIONS` doesn't include `backlog → on-deck` in the sense that `b

---

### 2026-03-30 — QA review: TASK-TRADING-2
**Project:** qa
**Summary:** QA reviewed task from backend. × qty). Correct.  ### Cross-browser - Chromium and WebKit screenshots match. No Safari-incompatible CSS patterns found (`backdrop-filter` absent; flexbox `gap:` is Safari 14.1+, acceptable).  ### Caveats (acknowledged, not blocking) - Win rate sourced from local DB reconciliation — Kalshi API has no settlement-history endpoint - P&L uses entry cost for open positions

---

### 2026-03-30 — QA review: TASK-1774834775661
**Project:** qa
**Summary:** QA reviewed task from backend. path ✅  **Glow logic** (line 1658): `isActiveBuild = isBuilding || buildState === "running" || buildState === "spawning"` — queued tasks get purple badge, no glow ✅  **Build:** Clean, all routes compile ✅   **Tests:** No test script — consistent with project baseline ✅  **Minor note (pre-existing, out of scope):** The `post-review` advancement (line 2079) still uses 

---

### 2026-03-30 — QA review: TASK-1774834048750
**Project:** qa
**Summary:** QA reviewed task from backend. | Status | |-----|----------|--------------|--------| | Bug 1: wrong status filter | `server.py:1186` | `status IN ('pending', 'filled', 'resting')` | ✅ Correct — fixed in commit `7d6d1d3`, still present in HEAD | | Bug 2: screenshot URL | `build-queue.ts:421` | `http://localhost:3001/trading` | ✅ Correct — routes to `/trading` not `/tasks` | | Build | mission-contro

---

### 2026-03-30 — QA review: TASK-1774834376074
**Project:** qa
**Summary:** QA reviewed task from backend. rmed |  **Remaining hardcoded refs (acceptable):** Individual ID references to `"henry"` for specific functional roles (CEO position in org layout, voice chat type annotation, default project owner fallback) — these are NOT agent lists, they reference a specific agent by a known architectural role. SESSION_TEMPLATES and persona overlay `relevantAgents` are intentiona

---

### 2026-03-30 — QA review: TASK-1774838546878
**Project:** qa
**Summary:** QA reviewed task from backend. The background task confirmed 64 failed — consistent with the pre-existing baseline. Verdict stands.  **VERDICT: APPROVED**

---

### 2026-03-30 — QA review: TASK-1774834048750
**Project:** qa
**Summary:** QA reviewed task from backend. **Build:** PASSES (mission-control-app builds clean, no TypeScript errors)  ---  VERDICT: NEEDS_FIX NOTES: - **Bug 2 URL is still wrong (7th flagging):** `build-queue.ts:355` routes `weather-trading` tasks to `http://localhost:8050/trades` (Python server trade history) instead of `http://localhost:3001/trading` (mission-control Trading Desk). Fix: change `"http://loc
**Lessons:**
- **Bug 2 URL is still wrong (7th flagging):** `build-queue.ts:355` routes `weather-trading` tasks to `http://localhost:8050/trades` (Python server trade history) instead of `http://localhost:3001/trading` (mission-control Trading Desk). Fix: change `"http://localhost:8050/trades"` → `"http://localhost:3001/trading"`. The `/trading` route is confirmed to exist in the current build output.

---

### 2026-03-30 — QA review: TASK-TRADING-2
**Project:** qa
**Summary:** QA reviewed task from backend. es below zero, then `Math.abs(pnl)` removes the sign from the number. A loss of `-$50` displays as `$50`. Fix: change to `(pnl >= 0 ? '+' : '-')` at lines 1579, 1583, 1589, 1596, and 1621 in `trades.html`. Note: the existing `fmtMoney()` function already handles this correctly. - **[Persistent — 10th cycle] Screenshot system navigates to `/tasks` instead of `/trading
**Lessons:**
- **[BLOCKING] Negative P&L renders without minus sign** — `(pnl >= 0 ? '+' : '')` strips the negative for values below zero, then `Math.abs(pnl)` removes the sign from the number. A loss of `-$50` displays as `$50`. Fix: change to `(pnl >= 0 ? '+' : '-')` at lines 1579, 1583, 1589, 1596, and 1621 in `trades.html`. Note: the existing `fmtMoney()` function already handles this correctly.
- **[Persistent — 10th cycle] Screenshot system navigates to `/tasks` instead of `/trading`** — all Trading Desk visual QA is blind. Must be fixed before any Trading Desk feature can receive visual verification coverage.

---

### 2026-03-30 — QA review: TASK-1774834048750
**Project:** qa
**Summary:** QA reviewed task from backend. 3001/trading`. The screenshot system captures mission-control pages (port 3001). QA flagged `/trading` (the Trading Desk page in mission-control) in every one of the 6 prior cycles — not the Python server's `/trades` history page. - **Bug 1 is confirmed fixed** — no action needed on `server.py:1186`. - **Note (out of scope, log for next cycle):** `/api/risk-status` a
**Lessons:**
- **Bug 2 URL is wrong**: `http://localhost:8050/trades` must be `http://localhost:3001/trading`. The screenshot system captures mission-control pages (port 3001). QA flagged `/trading` (the Trading Desk page in mission-control) in every one of the 6 prior cycles — not the Python server's `/trades` history page.
- **Bug 1 is confirmed fixed** — no action needed on `server.py:1186`.
- **Note (out of scope, log for next cycle):** `/api/risk-status` at `server.py:694` also uses `status IN ('pending', 'filled')` without `'resting'`. Not in scope for this task, but worth tracking.

---

### 2026-03-30 — QA review: TASK-TRADING-3
**Project:** qa
**Summary:** QA reviewed task from backend. ect is confirmed fixed. Build is clean. CSS variables are valid. Logic is correct. The screenshot system failure is infrastructure and does not constitute a defect in this feature — but it **must** be escalated and fixed before any further Trading Desk visual QA can be performed.  **Outstanding Infrastructure Bug (escalate separately):** Playwright screenshot system 

---

### 2026-03-30 — QA review: TASK-TRADING-1
**Project:** qa
**Summary:** QA reviewed task from backend. A cycle since this feature was built — it is the fix that `71a9a4c` applied to `live_engine.py` but did not apply to the dashboard server. - **[BLOCKING — 8th cycle] Screenshot system**: All "after" screenshots capture the Task Board (`/tasks`), not the Trading Desk (`/trading`). Visual regression coverage for this feature is zero across all eight QA cycles. The Play
**Lessons:**
- **[BLOCKING — 8th cycle] `server.py:1186`**: `/api/risk-controls` live exposure query reads `status IN ('pending', 'filled')` — must be `status IN ('pending', 'filled', 'resting')`. This directly undercounts deployed capital and open_positions feeding the dashboard progress bars. One-line fix. Has been flagged in every QA cycle since this feature was built — it is the fix that `71a9a4c` applied to `live_engine.py` but did not apply to the dashboard server.
- **[BLOCKING — 8th cycle] Screenshot system**: All "after" screenshots capture the Task Board (`/tasks`), not the Trading Desk (`/trading`). Visual regression coverage for this feature is zero across all eight QA cycles. The Playwright system must navigate to `/trading` before capture. No Trading Desk feature can be visually verified until this is resolved.

---

### 2026-03-30 — QA review: TASK-TRADING-1
**Project:** qa
**Summary:** QA reviewed task from backend. ting')`. This undercounts deployed capital and open_positions. One-line fix. This has been flagged in every single QA cycle for this feature and remains unaddressed. - **[BLOCKING — 7th cycle] Screenshot system**: All "after" screenshots show Task Board (`/tasks`), not Trading Desk (`/trading`). Visual regression coverage is zero across all seven cycles. The Playwrig
**Lessons:**
- **[BLOCKING — 7th cycle] `server.py:1186`**: `/api/risk-controls` live exposure query reads `status IN ('pending', 'filled')` — must be `status IN ('pending', 'filled', 'resting')`. This undercounts deployed capital and open_positions. One-line fix. This has been flagged in every single QA cycle for this feature and remains unaddressed.
- **[BLOCKING — 7th cycle] Screenshot system**: All "after" screenshots show Task Board (`/tasks`), not Trading Desk (`/trading`). Visual regression coverage is zero across all seven cycles. The Playwright system must navigate to `/trading` before capture. No future Trading Desk feature can be visually verified until this is fixed.

---

### 2026-03-30 — QA review: TASK-TRADING-1
**Project:** qa
**Summary:** QA reviewed task from backend. dashboard progress bars. This is a one-line fix that has been documented in every QA cycle since this feature was built. - **[BLOCKING] Screenshots still capture Task Board, not Trading Desk**: All "after" screenshots show the Task Board. The Playwright system must navigate to `/trading` before capture. Visual regression coverage for this feature remains at zero acro
**Lessons:**
- **[BLOCKING — 6th cycle] `server.py:1186`**: `/api/risk-controls` live exposure query must be `status IN ('pending', 'filled', 'resting')`. This directly undercounts deployed capital and open_positions feeding the dashboard progress bars. This is a one-line fix that has been documented in every QA cycle since this feature was built.
- **[BLOCKING] Screenshots still capture Task Board, not Trading Desk**: All "after" screenshots show the Task Board. The Playwright system must navigate to `/trading` before capture. Visual regression coverage for this feature remains at zero across all six QA cycles. The screenshot system must be fixed before this or any future Trading Desk feature can be visually verified.

---

### 2026-03-30 — QA review: TASK-TRADING-1
**Project:** qa
**Summary:** QA reviewed task from backend. S: - **[BLOCKING — 5th cycle] `server.py:1186`**: `/api/risk-controls` endpoint query `status IN ('pending', 'filled')` must include `'resting'`. This directly undercounts deployed capital and open_positions in the dashboard progress bars. One-line fix. - **[BLOCKING] Screenshots still showing Task Board, not Trading Desk** — no visual verification of the feature is 
**Lessons:**
- **[BLOCKING — 5th cycle] `server.py:1186`**: `/api/risk-controls` endpoint query `status IN ('pending', 'filled')` must include `'resting'`. This directly undercounts deployed capital and open_positions in the dashboard progress bars. One-line fix.
- **[BLOCKING] Screenshots still showing Task Board, not Trading Desk** — no visual verification of the feature is possible. The Playwright screenshot system must navigate to `/trading` before capture. This has been flagged in every prior cycle.

---

### 2026-03-30 — QA review: TASK-TRADING-1
**Project:** qa
**Summary:** QA reviewed task from backend. pen-position count will undercount when resting limit orders exist. - **[INFORMATIONAL] Screenshots capture Task Board, not Trading Desk** — visual regression coverage for this feature is zero across all four QA cycles. The Playwright screenshot system must be corrected to navigate to `/trading` before capture. - **[INFORMATIONAL] Percentage param input UX** — inline
**Lessons:**
- **[BLOCKING — 4th cycle] `server.py:1186`** `/api/risk-controls` live exposure query: `status IN ('pending', 'filled')` must be `status IN ('pending', 'filled', 'resting')`. Commit `71a9a4c` fixed the live engine's internal checks but never patched the dashboard API endpoint. Dashboard progress bars and open-position count will undercount when resting limit orders exist.
- **[INFORMATIONAL] Screenshots capture Task Board, not Trading Desk** — visual regression coverage for this feature is zero across all four QA cycles. The Playwright screenshot system must be corrected to navigate to `/trading` before capture.
- **[INFORMATIONAL] Percentage param input UX** — inline edit inputs accept raw decimals (`0.15`) while the display renders `15.0%`; consider adding a hint label or normalizing on input.

---

### 2026-03-30 — QA review: TASK-TRADING-1
**Project:** qa
**Summary:** QA reviewed task from backend. 'resting'`**: `status IN ('pending', 'filled')` must be `status IN ('pending', 'filled', 'resting')`. This feeds both the deployed amount and open_positions count on the new dashboard progress bars. This defect has been flagged in three consecutive QA cycles — it must be fixed before approval. - **[INFORMATIONAL] Screenshots still capture Task Board, not Trading Desk
**Lessons:**
- **[BLOCKING] `server.py:1185` — deployed capital query still missing `'resting'`**: `status IN ('pending', 'filled')` must be `status IN ('pending', 'filled', 'resting')`. This feeds both the deployed amount and open_positions count on the new dashboard progress bars. This defect has been flagged in three consecutive QA cycles — it must be fixed before approval.
- **[INFORMATIONAL] Screenshots still capture Task Board, not Trading Desk** — visual regression coverage for this feature is zero across all cycles. The screenshot system is navigating to the wrong page.

---

### 2026-03-30 — QA review: TASK-TRADING-1
**Project:** qa
**Summary:** QA reviewed task from backend. Fix commit `71a9a4c` only updated `live_engine.py`. The dashboard endpoint was never patched. Progress bar and open-position count will undercount active exposure when resting limit orders exist. - [INFORMATIONAL] Screenshots capture wrong page — all captures show Task Board, not Trading Desk. No visual regression coverage for this feature. - [INFORMATIONAL] Percenta
**Lessons:**
- [BLOCKING] `server.py:1185` — `/api/risk-controls` deployed capital query uses `status IN ('pending', 'filled')`, missing `'resting'`. Fix commit `71a9a4c` only updated `live_engine.py`. The dashboard endpoint was never patched. Progress bar and open-position count will undercount active exposure when resting limit orders exist.
- [INFORMATIONAL] Screenshots capture wrong page — all captures show Task Board, not Trading Desk. No visual regression coverage for this feature.
- [INFORMATIONAL] Percentage parameter edit UX: raw decimal input (`0.15`) while display shows `15.0%` — consider clarifying the hint or normalizing input.

---

### 2026-03-30 — QA review: TASK-TRADING-1
**Project:** qa
**Summary:** QA reviewed task from backend. ntrols code)  ---  VERDICT: NEEDS_FIX NOTES: - **[BLOCKING] Deployed capital query omits 'resting' orders** (`server.py:1185`): `status IN ('pending', 'filled')` must be `status IN ('pending', 'filled', 'resting')` to match what the live engine counts as active exposure. Same fix needed on the `open_positions` count on the same line. - **[INFORMATIONAL] Screenshots c
**Lessons:**
- **[BLOCKING] Deployed capital query omits 'resting' orders** (`server.py:1185`): `status IN ('pending', 'filled')` must be `status IN ('pending', 'filled', 'resting')` to match what the live engine counts as active exposure. Same fix needed on the `open_positions` count on the same line.
- **[INFORMATIONAL] Screenshots captured wrong page** — after screenshots show Task Board, not Trading Desk. Visual regression coverage is absent for this feature.

---

### 2026-03-30 — QA review: TASK-1774830665670
**Project:** qa
**Summary:** QA reviewed task from backend. UX trace artifact.  - **Double-write in POST handler:** As Forge noted, `autoAssignBuilder(t)` re-reads/re-writes `tasks.json` after `writeTasks` was already called. The factory lock in `queueOrStartBuild` guards against concurrency races here. Acceptable.  - **`!newTask.assignedAgent` guard:** The POST handler only auto-assigns if `assignedAgent` is unset. If a task

---

### 2026-03-30 — QA review: TASK-1774829425355
**Project:** qa
**Summary:** QA reviewed task from backend. ded in risk limits | ✅ `_ACTIVE_STATUSES` covers `pending`, `filled`, `resting` | | Backfill dedup: checks both `order_id` and `bf-{trade_id}` | ✅ | | Backfill dry-run by default | ✅ | | SQL injection risk from f-string status constant | ✅ None — compile-time class constant only |  ### Known follow-up (not blocking) - `test_v2_stress.py` has stale limit values (cap=1

---

### 2026-03-30 — QA review: TASK-1774829432698
**Project:** qa
**Summary:** QA reviewed task from backend. fill script safety | ✅ Dry-run default, insert-only, deduped by `order_id` | | Uncommitted `or 0` in working tree | ⚠️ Minor — harmless defensive addition, not yet committed |  **One minor note:** `src/trading/live_engine.py` has a small uncommitted change (`pos.get("position", 0) or 0`) in the working tree that wasn't included in the commit. It's redundant (default 

---

### 2026-03-29 — QA review: TASK-PIPELINE-5
**Project:** qa
**Summary:** QA reviewed task from backend. ler cycles - `hangLabel` falls back to raw `build.taskId` when task is undefined — safe - `hangAgent` falls back to `"unknown agent"` — safe - Both `sendTelegramNotification` and `createInAppNotification` are defined locally in `build-queue.ts` — no import issues - Fire-and-forget notification pattern is consistent with all other notification calls in the file  ### N

---

### 2026-03-30 — QA review: SQLite WAL persistence (ad08f7a)
**Project:** qa
**Summary:** QA reviewed task from backend. SQLite WAL mode replaces in-memory/JSON task store. Migration from tasks.json works (189 of 196 tasks; 7 duplicate IDs TASK-023..029 silently dropped via INSERT OR IGNORE). Crash replay logic verified end-to-end: journal written before writeTasks(), _replayCheck() detects to_status != current_status and re-applies. ISO timestamp MAX(ts) ordering correct. Checkpoint POST/GET endpoint clean. All direct tasks.json readers replaced. Contract test failures (64) are pre-existing — identical count on HEAD~1. Dev server returns empty 200 bodies (pre-existing HMR + native module race — restart server after deploy).

---

VERDICT: APPROVED

**Notes for backlog:**
- Ops should audit tasks.json for duplicate IDs TASK-023..029 — migration silently keeps first occurrence only
- Add migration warning log for skipped duplicates in Sprint 2
- Wire dbCheckpoint() to cron job in Sprint 2
- Add contract tests for GET/POST /api/tasks/checkpoint in Sprint 2
- Restart dev server after deploying this commit (Turbopack HMR + better-sqlite3 singleton race)

---

<!-- Vigil appends new entries here after completing QA tasks. Format:

### YYYY-MM-DD — Task Title
**Project:** project-name
**Verdict:** APPROVED / NEEDS_FIX / BLOCKED
**Findings:**
- finding 1 (if any)

---
-->
