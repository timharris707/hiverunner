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

<!-- Vigil appends new entries here after completing QA tasks. Format:

### YYYY-MM-DD — Task Title
**Project:** project-name
**Verdict:** APPROVED / NEEDS_FIX / BLOCKED
**Findings:**
- finding 1 (if any)

---
-->
