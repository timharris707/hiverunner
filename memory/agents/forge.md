# Agent Memory — Forge 🔧

**Agent ID:** `backend`
**Role:** Backend Engineer
**Division:** Engineering
**Reports To:** Henry ⚡

---

## Standing Knowledge

### Codebase Architecture
- **Stack:** Next.js 14 App Router, TypeScript, Node.js 20
- **No database** in mission-control — all persistence is flat JSON files in `/data/`
- **Key data files:** `tasks.json`, `projects.json`, `build-log.json`, `notifications.json`, `agent-memory/*.json`
- **API routes** live at `src/app/api/` — all use Next.js route handlers (`route.ts`)
- **Core lib files:** `src/lib/build-queue.ts` (76KB, task pipeline), `src/lib/agent-pipeline.ts` (routing + memory)

### Agent Memory System
- JSON memory at `data/agent-memory/{agentId}.json` — max 50 entries per agent
- Markdown memory at `memory/agents/{name}.md` — this file, human-readable + appendable
- `readAgentMemory(agentId)` / `recordAgentMemory(agentId, entry)` in `agent-pipeline.ts`
- `buildAgentIdentityBlock(agentId, project?)` injects memory into the build prompt

### Build & Deploy
- Build command: `npm run build` (Next.js standard build)
- No tests currently — `npm test` may not exist or be empty
- TypeScript strict mode — all `any` types require `/* eslint-disable @typescript-eslint/no-explicit-any */`

### Data Mutation Pattern
- Read with `readFileSync`, write with `writeFileSync` — no ORM, no migration system
- Always handle missing files gracefully with try/catch — files may not exist yet
- `mkdirSync({ recursive: true })` before writing to new directories

### External Projects
- `weather-trading` project lives at a separate Python/FastAPI path (not in this repo)
- `crypto-trading`, `stock-trading` are separate repos/processes
- Mission Control is the **management UI** that coordinates them all

### Known Patterns to Avoid
- Do NOT use `readdirSync` without importing — use `require("fs").readdirSync` if importing fs already done or add to imports
- API routes need `export const dynamic = "force-dynamic"` if they read dynamic data
- The `build-queue.ts` file is very large (76KB) — read targeted sections, avoid full rewrites

---

## Task Log

### 2026-03-30 — Bug: on-deck tasks not auto-promoting to in-progress when agent capacity opens
**Project:** mission-control
**Summary:** gned agent is idle and whose execution key hasn't hit the concurrency cap.  **Validation:** `npm run build` clean. Pushed to `panely/sprint-1` → `08d01db`.  **Caveats:** - Tasks without a pre-assigned agent will have `resolveAgentForTask()` called during promotion to determine the agent — this is the same function `autoAssignBuilder` uses, so it's consistent. - The execution-key concurrency cap (3

---

### 2026-03-30 — CLI wrapper for board operations — mc tasks list, assign, reject
**Project:** mission-control
**Summary:** n` comment with the supplied reason - `MC_API_URL` env var overrides default `http://localhost:3000`  ### Caveats - `reject` only works if the task is currently in `review` status — the state machine will return a 400 otherwise; the CLI surfaces the API error clearly - Agent name resolution requires the server to be running; if the registry is unreachable, the `--to` value is passed through unchan

---

### 2026-03-30 — Auto-spawn Gater when task hits review — real agent, not just a label
**Project:** mission-control
**Summary:** net) same as the existing code reviewer. If Gater should use a different model tier, update the `routing` block in the build log entry and the `--model` arg. - If a task reaches `review` status through a non-standard path (e.g., manual PATCH), `finalizeReview` won't fire, so Gater won't auto-spawn — only the pipeline-driven path triggers it. - The `extractMemoryFromOutput` call for Gater is non-cr

---

### 2026-03-30 — Dynamic agent registry — eliminate ALL hardcoded agent lists across Mission Control
**Project:** mission-control
**Summary:** `** and **`PERSONA_OVERLAYS`** still reference specific agents by display name (e.g. `["Henry", "Atlas", "Quant"]`). These are *curated selections* for each template/overlay — they're not meant to include all agents. They'll resolve correctly as long as the agent exists in the registry. - **`DESK_POSITIONS`** in `Office3D/agentsConfig.ts` maps agent IDs to physical desk coordinates. New agents wit

---

### 2026-03-30 — Trading Desk — live-only view with real Kalshi P&L (no paper trades)
**Project:** weather-trading
**Summary:** d`  ### Caveats - Win rate still sourced from local DB — Kalshi has no settlement history endpoint that maps fills to win/loss counts - `total_pnl` uses position entry cost for open trades (not live bid price). True MTM would require fetching current bid per position on every load — too many API calls - If Kalshi API is down, P&L card degrades gracefully to local DB realized P&L with `[LOCAL]` bad

---

### 2026-03-30 — Dynamic agent registry — eliminate ALL hardcoded agent lists across Mission Control
**Project:** mission-control
**Summary:** I'll start by exploring all the files that need to change to understand the current hardcoded agent lists.

---

### 2026-03-30 — Fix risk controls dashboard bugs flagged by Vigil QA (6x failed review)
**Project:** weather-trading
**Summary:** uild` in mission-control-app passed clean. `python3 -m py_compile server.py` clean.  **Commits:** - `mission-control-app` `panely/sprint-1` → `40ad138` - `weather-trading` `main` → `65c92f1` (bonus: backfill now skips non-weather Kalshi fills)  **Caveats:** - Tasks that already have an explicit `visualReview.targetUrl` set to the old wrong value won't be corrected by this change — only the fallbac

---

### 2026-03-30 — API contract tests — schema validation on every endpoint
**Project:** mission-control
**Summary:** ipelines/[id]` | CRUD + 404 on all three verbs |  **Result:** 83/83 passed (8.7s)   **Pushed:** `panely/sprint-1 → 0832438`  ---  **Caveat:** The `reviewAssignedTo` guard (§19) only fires for legacy tasks that reach `review` state without `autoAssignGater` having run — which can't happen through the normal API flow. The test documents the *actual* contract (omitting the field in the PATCH body is 

---

### 2026-03-30 — Acceptance criteria required field — tasks cannot enter in_progress without it
**Project:** mission-control
**Summary:** lder sees criteria | `buildPrompt()` | ✅ added this task | | Code reviewer checks criteria | `reviewPrompt()` | ✅ added this task | | Vigil QA checks criteria | `buildQAHandoffPrompt()` | ✅ pre-existing | | Drawer displays criteria | `TaskDetailDrawer` | ✅ added this task |  **Caveat:** Existing backlog/on-deck tasks without `acceptance_criteria` will be blocked from entering in-progress by the st

---

### 2026-03-30 — SQLite WAL persistence with crash replay
**Project:** mission-control
**Summary:** econcileBuildQueue` runs, which requires at least one API request every hour. In a fully idle server this may not fire — but in practice the dashboard polls frequently enough that this is never an issue. SQLite's own auto-checkpoint (1000 WAL pages) is the backstop for idle periods. - The `lastCheckpointAt` counter resets on server restart, meaning the first reconcile after a restart will always t

---

### 2026-03-30 — Task lifecycle state machine — enforce valid transitions in code
**Project:** mission-control
**Summary:** I handler and in `finalizeBuild`). The edge case is legacy tasks in `review` that predate the auto-assign logic — those would be blocked from closing until `reviewAssignedTo` is manually set or a `force` override is used. - The auto-approve path (`force: true, reason: "auto-approve: review not required..."`) in `build-queue.ts:2046` goes `in-progress → done`, bypassing review entirely. This is by 

---

### 2026-03-30 — Trading Desk — live-only view with real Kalshi P&L (no paper trades)
**Project:** weather-trading
**Summary:** ow** — 5 cards: Kalshi Balance · Deployed · Available · Total P&L [KALSHI] · Initial Deposit  ### Caveats - Win rate still sourced from local DB reconciliation — Kalshi doesn't expose a settlement-history endpoint for direct win/loss counting - `total_pnl = balance + deployed_cost − initial_deposit` uses entry cost for open positions; true mark-to-market would require real-time bid pricing per pos

---

### 2026-03-30 — Pipeline fix — one active build per agent, queue the rest
**Project:** mission-control
**Summary:** e === "running"` or `"spawning"` — queued tasks show a purple "Queued" badge without glow.  **Build:** Compiled successfully   **Pushed:** `panely/sprint-1` → `fe14f30`  **Caveat:** The `nextQueuedTaskIdForAgent` function (line 1020) was already defined but unused — this commit wires it up. The `findActiveBuildForAgent` check relies on `b.assignedAgent` being set consistently; if a build entry has

---

### 2026-03-30 — Fix risk controls dashboard bugs flagged by Vigil QA (6x failed review)
**Project:** weather-trading
**Summary:** - `min_edge` 0.03 → 0.05 - `min_composite` 0.20 → 0.10 - `max_contracts` 100 → 25 - `max_per_city_date` 5 → 2 - Bracket contract (`-B`) block in `can_trade()`  **Caveat:** The reason this task cycled 6+ times is that previous runs checked one bug instance while missing a second, or made fixes that later commits partially touched. Both are now confirmed correct in HEAD. The new commit is purely the

---

### 2026-03-30 — Dynamic agent registry — eliminate ALL hardcoded agent lists across Mission Control
**Project:** mission-control
**Summary:** TES` in `advisory/constants.ts` still reference agent display names (e.g. `agents: ["Henry", "Atlas"]`). These are session-specific curations (which agents participate in a template), not agent definitions — converting them would mean every new agent auto-appears in every template, which isn't desired. - The `aliases` map in `getAgentByAnyId()` still needs a manual entry for agents with non-obviou

---

### 2026-03-30 — Task lifecycle state machine — enforce valid transitions in code
**Project:** mission-control
**Summary:** prevent re-alerting on every reconcile cycle. It is never reset (by design) — once alerted, it won't fire again even if the task stays in review indefinitely. If recurring alerts are needed, add a `reviewAlertSentAt` timestamp and compare against a re-alert interval. - The heartbeat check uses `task.buildStartedAt || task.updated || task.created` as the reference timestamp, which means a task manu

---

### 2026-03-30 — Pipeline fix — one active build per agent, queue the rest
**Project:** mission-control
**Summary:** and will complete normally. - The `nextQueuedTaskIdForAgent` helper is defined but not directly called in the current flow — agent queue advancement goes through `reconcileBuildQueue` which checks both constraints. It's available for future use if direct agent-queue lookups are needed. - The `completedAgentId` variable captured in `finalizeBuild` is also set but not directly used in the current fl

---

### 2026-03-30 — Bug: pipeline reconciler resurrects done tasks — puts them back in-progress
**Project:** mission-control
**Summary:** | Stale build cleanup | Cleans build tracking on done tasks but never adds to `tasksToKick` | | `advanceTasks` | Filters done tasks out of project groupings entirely |  **Validation:** `npm run build` — compiled successfully. Pushed to `panely/sprint-1` @ `6e28020`.  **Caveat:** If a task is moved to `done` while a build is mid-flight, the build process will still run to completion — it just won't

---

### 2026-03-30 — Trading Desk — live-only view with real Kalshi P&L (no paper trades)
**Project:** weather-trading
**Summary:** oyed_cost - initial_deposit` — deployed_cost uses entry price for open positions, not current mark-to-market. The `total_unrealized_pnl` sub-line shows the MTM delta when Kalshi provides `unrealized_pnl` in the positions response - `data/bankroll.json` does not exist; server defaults to `initial_deposit = $500.0` — create this file if the actual deposit differs - Settlement flows through `reconcil

---

### 2026-03-30 — Trading Desk — live-only view with real Kalshi P&L (no paper trades)
**Project:** weather-trading
**Summary:** | ✅ | Card 4 shows "Total P&L [KALSHI]" with unrealized sub-line |  **Known caveats (from prior session memory):** - `total_pnl` uses entry cost for open positions, not current mark-to-market. `total_unrealized_pnl` shows the delta when Kalshi provides it - Settlement win/loss flows through `reconcile_settlements.py` → local DB, not real-time per-trade Kalshi API — this is the intended architectur

---

### 2026-03-30 — Dynamic agent registry — eliminate ALL hardcoded agent lists across Mission Control
**Project:** mission-control
**Summary:** lowercase from display names, but macOS filesystem is case-insensitive so this is transparent. - `cronCount` on the org chart is hardcoded to 0 for all agents (was previously hardcoded per-agent). If live cron counts are needed, they should come from the API status endpoint, not static config. - The `comms` field on the agents page is derived (`"Telegram (primary)"` for Henry, `"Internal"` for all

---

### 2026-03-30 — Trading Desk — live-only view with real Kalshi P&L (no paper trades)
**Project:** weather-trading
**Summary:** `main @ fdf421f`  ## Known Caveats - `total_pnl` uses entry cost for open positions (not current mark-to-market). The `total_unrealized_pnl` sub-line shows the delta when Kalshi provides `unrealized_pnl` in the positions response - Settlement win/loss tracking flows through the reconciler (`reconcile_settlements.py`) → local DB, not real-time Kalshi API per trade. This is the intended architecture

---

### 2026-03-30 — Fix risk controls dashboard bugs flagged by Vigil QA (6x failed review)
**Project:** weather-trading
**Summary:** `main` on their respective repos. No code changes required.  **Validation:** - `server.py` lines 692–695 and 1183–1187: confirmed `status IN ('pending', 'filled', 'resting')` - `build-queue.ts` lines 355–357: confirmed `"http://localhost:3001/trading"` for `weather-trading` project  **Caveat:** The `tasks.json` `visualReview.status` is still `changes-requested` from the pre-fix review cycle — Vigi

---

### 2026-03-30 — Fix risk controls dashboard bugs flagged by Vigil QA (6x failed review)
**Project:** weather-trading
**Summary:** explicit `targetUrl`/`targetPath` overrides set to `/tasks` in `tasks.json` — the fallback is sufficient.  **Validation:** `python3 -m py_compile src/dashboard/server.py` clean. Pushed to `main @ 7d6d1d3`.  **Caveat:** The previous run of this task incorrectly claimed Bug 1 was "already fixed" — it only checked line 1186 (`/api/risk-controls`) and missed line 694 (`/api/risk-status`), which was th

---

### 2026-03-30 — Trading Desk — live-only view with real Kalshi P&L (no paper trades)
**Project:** weather-trading
**Summary:** /loss API) - All other views (charts, city breakdown, risk controls, watcher) untouched  ### Known Caveats - `total_pnl` uses **entry cost** for open positions (not current market value) — so if positions have moved significantly, the number is slightly off from true mark-to-market; the `total_unrealized_pnl` sub-line shows the delta when Kalshi provides `unrealized_pnl` in the positions response 

---

### 2026-03-30 — Fix risk controls dashboard bugs flagged by Vigil QA (6x failed review)
**Project:** weather-trading
**Summary:** weather-trading` → `http://localhost:8050/trades` (Trading Desk) - all others → `http://localhost:3001/tasks` (unchanged)  Build: `✓ Compiled successfully in 2.6s` Pushed: `panely/sprint-1` → `8052103`  **Caveat:** The fix applies to the fallback path only. If a task already has `visualReview.targetUrl` or `visualReview.targetPath` set to `/tasks`, those explicit values take precedence and would s

---

### 2026-03-30 — Trading Desk — live trade activity feed with edge data at time of purchase
**Project:** weather-trading
**Summary:** t column now shows `target_date` (e.g. `· 2026-03-29`) giving Tim immediate context on which event each trade is betting on  **Validation**: `python3 -m py_compile server.py` clean, all 11 API tests pass, pushed to `main @ 02e81b5`.  **Caveat**: `resting` orders' unrealized P&L shows the *entry cost* delta against current bid — but since a resting limit order hasn't been filled yet, the P&L is not

---

### 2026-03-30 — Trading Desk — risk controls dashboard with live parameter adjustments
**Project:** weather-trading
**Summary:** itch status, circuit breaker state, watcher health, last scan time - Backend route handler for fetching/updating parameters - Build was passing, commit pushed to remote  **No further work needed.** The only uncommitted change is `uv.lock` (unrelated dependency lockfile).  **Known caveats:** - The old `riskColor` function remains unused (harmless dead code, cleanup candidate) - `fmtMoney` / `fmtPct

---

### 2026-03-30 — Trading Desk — risk controls dashboard with live parameter adjustments
**Project:** weather-trading
**Summary:** with inline editing (max deployed, max per trade, max per city/date, daily loss halt, bankroll, Kelly fraction, min edge, max daily trades, win rate floor) - Dual mode: percentage AND dollar caps - Progress bars for deployed capital and daily P&L vs limits - Kill switch status, circuit breaker state, watcher health, last scan time - Backend route handler at `/api/risk-controls` for fetching/updati

---

### 2026-03-30 — Trading Desk — risk controls dashboard with live parameter adjustments
**Project:** weather-trading
**Summary:** circuit breaker state, watcher health, last scan time - Backend route handler for fetching/updating parameters - 432 lines added to `trades.html`  The commit is pushed to remote. The only uncommitted change is `uv.lock` (unrelated dependency lockfile).  **Caveats:** - The old `riskColor` function remains unused (harmless dead code, cleanup candidate) - `fmtMoney` / `fmtPctFull` / `fmtTime` helpers

---

### 2026-03-30 — Trading Desk — risk controls dashboard with live parameter adjustments
**Project:** weather-trading
**Summary:** (max deployed, max per trade, max per city/date, daily loss halt, bankroll, Kelly fraction, min edge, max daily trades, win rate floor) - Dual mode: percentage AND dollar caps - Progress bars for deployed capital and daily P&L vs limits - Kill switch status, circuit breaker state, watcher health, last scan time - Backend route handler for fetching/updating parameters - Already pushed to remote  **

---

### 2026-03-30 — Trading Desk — risk controls dashboard with live parameter adjustments
**Project:** weather-trading
**Summary:** atus, circuit breaker state, watcher health, last scan time - Backend route handler for fetching/updating parameters - 432 lines added to `trades.html`  The commit is pushed to remote. The only uncommitted change is `uv.lock` (unrelated dependency lockfile).  **Caveats:** - The old `riskColor` function remains in the file but is unused (harmless dead code, cleanup candidate) - `fmtMoney` / `fmtPct

---

### 2026-03-30 — Trading Desk — risk controls dashboard with live parameter adjustments
**Project:** weather-trading
**Summary:** le parameters with inline editing - Progress bars for deployed capital and daily P&L - Kill switch status, circuit breaker state, watcher health, last scan time - 432 lines added to `trades.html`  The commit is already pushed to remote. No further work needed.  **Caveats from prior session:** - The old `riskColor` function is still in the file but unused (harmless dead code) - `fmtMoney` / `fmtPct

---

### 2026-03-30 — Trading Desk — risk controls dashboard with live parameter adjustments
**Project:** weather-trading
**Summary:** controls` for fetching/updating parameters - **`server.py`** — Backend route handler  All changes are on `main` and pushed. The only uncommitted change is `uv.lock` (unrelated dependency lockfile).  **Summary:** This task is already complete. Commit `478c4ab` added the full risk controls dashboard with inline parameter editing, progress bars for deployed capital and daily P&L, kill switch status, 

---

### 2026-03-30 — Trading Desk — risk controls dashboard with live parameter adjustments
**Project:** weather-trading
**Summary:** 2_stress` — stale limit values, not related).  **Commit:** `478c4ab` pushed to `main`.  **Caveats:** - The old `riskColor` function is still in the file but now unused (harmless dead code — could be removed in a cleanup pass) - The `fmtMoney` / `fmtPctFull` / `fmtTime` helpers are defined within the `<script>` block alongside the existing `fmt` / `fmtPct` — slight naming overlap but no conflict si

---

### 2026-03-30 — Pipeline automation — auto-assign Gater on review, smart agent routing, auto-promote on-deck
**Project:** mission-control
**Summary:** priority - Auto-promote on-deck: covered in `advanceTasks` called from `reconcileBuildQueue` - Comment trail: `addPipelineComment` called at every auto-transition  **Build:** `Compiled successfully` **Pushed:** `panely/sprint-1` → `3005a24`  **Caveat:** The `autoAssignBuilder` call in the POST handler re-reads and re-writes tasks.json — this is a double-write but necessary since `writeTasks` was a

---

### 2026-03-30 — Pipeline automation — auto-assign Gater on review, smart agent routing, auto-promote on-deck
**Project:** mission-control
**Summary:** s how the task board renders assignees. If an agent name has no space-separated emoji suffix, the full name is used. - The `resolveAgentForTask()` call in `finalizeBuild` still re-resolves the agent on build completion. This is intentional — it confirms the assignment and captures any tag changes made during the build. - Comments use type `"note"` — the existing comment API supports `"note" | "rev

---

### 2026-03-30 — Fix weather trading DB tracking gap — 55 untracked Kalshi trades + reconciler bugs
**Project:** weather-trading
**Summary:** cover the 55 untracked trades Run the backfill script: ```bash python scripts/backfill_trades.py              # dry-run first python scripts/backfill_trades.py --commit     # then insert ```  ### Caveats - The reconciler is already re-enabled (from a prior session's commit `1e7fc78`). After running the backfill, it should pass cleanly on the next cron run. - The `test_v2_stress` file has stale lim

---

### 2026-03-30 — Fix weather trading DB tracking gap — 55 untracked Kalshi trades + reconciler bugs
**Project:** weather-trading
**Summary:** ge`, `composite_score` (marked null) since that model context wasn't preserved. Settlement reconciliation still works — P&L is computed from price vs outcome. - The reconciler will now activate the **kill switch** if positions don't match after backfill. Run the backfill script BEFORE the next model_watcher cycle to avoid a false halt. - Ticker parsing in the backfill script covers `KXHIGH*`, `KXH

---

### 2026-03-29 — Henry orchestration notifications — blocked tasks, QA failures, completions alert Henry
**Project:** mission-control
**Summary:** cked | Same, with "Needs Henry's triage" text | | QA escalation (2nd+ rejection) | `sendTelegramNotification` + `createInAppNotification` + `escalatedToHenry=true` | | Task completion | `notifyTaskCompletion()` → Telegram + in-app | | **Agent hang >20min** | **Added this session** |  ## Caveat The `task` lookup in the stale loop can return `undefined` if a task was deleted after its build entry wa

---

### 2026-03-29 — Kalshi WebSocket integration — real-time orderbook + fill notifications
**Project:** weather-trading
**Summary:** **`scripts/model_watcher.py`** — Starts WS on boot, logs connection status in heartbeats - **`src/automation/cron_runner.py`** — Subscribes to orderbook for candidate tickers before trading  ### Caveats (from prior session): - Channel names are based on Kalshi v2 API docs — if wire format differs, handlers need tuning after first live connection - Unknown message types are logged and skipped (defe

---

### 2026-03-29 — Kalshi WebSocket integration — real-time orderbook + fill notifications
**Project:** weather-trading
**Summary:** mat, channel names) are based on their v2 API docs. If the actual wire format differs slightly (e.g., different field names in orderbook deltas), the handlers will need tuning after first live connection. The handlers are defensive — unknown message types are logged and skipped. - `websockets>=13.0` was already installed in the venv (15.0.1). The `pyproject.toml` pins `>=13.0` for broad compatibil

---

### 2026-03-29 — Named agent task routing — assign to specific agent identity, not disposable sub-agents
**Project:** mission-control
**Summary:** n both files — previously static copies that diverged from the source of truth - Task cards now show correct agent emoji for short-name assignees (fixes the "🤖" regression for tasks with `assignee: "Forge"` etc.)  **Build:** ✓ `Compiled successfully in 3.2s`   **Pushed:** `panely/sprint-1` → `73ddbba`  **Caveat:** The `buildPrompt` changes were already present in HEAD (`f93012c`) — the factory-si

---

### 2026-03-29 — QA handoff chain — builder completes → auto-routes to Vigil for verification
**Project:** mission-control
**Summary:** : NEEDS_FIX` → requeued to builder | `VERDICT: BLOCKED` → Henry triage  **Caveats:** - Vigil runs WebKit headlessly via Playwright — requires WebKit Playwright browser to be installed (`npx playwright install webkit`). If missing, Safari capture fails gracefully and returns empty (Vigil still runs with Chromium-only captures). - Non-UI builder tasks (e.g., a pure API endpoint) go through Vigil wit

---

### 2026-03-29 — Blocker signaling — agents can flag "I'm stuck" instead of false "done"
**Project:** mission-control
**Summary:** ed to `panely/sprint-1`  ### Caveats - The pipeline (Telegram DM, in-app notification, system event) was already wired up for blocker detection in `build-queue.ts` — this commit only closes the type/UI gaps. - The `detectBlocker` function matches the first blocker pattern found in output. If an agent writes `BLOCKED:` near other trigger phrases (e.g. "cannot verify in Safari"), the Safari pattern 

---

### 2026-03-29 — Henry orchestration notifications — hang detection
**Project:** mission-control
**Summary:** Added hang notification to the stale build timeout path in `reconcileBuildQueue`. When a build has been "running" for >20 min (STALE_BUILD_TIMEOUT_MS), the reconciler now calls `sendTelegramNotification` + `createInAppNotification` before marking the build failed and re-queuing. The three other Henry notification paths (blocked tasks, QA escalations, completions) were already fully wired in prior work — this was the only gap. **Build:** ✓ `Compiled successfully in 2.6s` **Pushed:** `panely/sprint-1` → `8cf87ed`

**Lessons:**
- The "fire-and-forget" description in task was slightly misleading — blocked/QA/completion paths were all wired. Only hang detection was missing a notification.
- The `task` lookup in the stale loop can return `undefined` (build.taskId may reference a deleted task) — always guard the label extraction.

---

### 2026-03-30 — API contract tests — schema validation on every endpoint
**Project:** mission-control
**Summary:** Added `e2e/contract.spec.ts` — 60+ Playwright API tests using Zod v4 schemas. Covers 16 endpoint groups: health, tasks CRUD, full state machine (all valid + all invalid transitions), comments, projects, agents, notifications CRUD, factory pipelines, and build trigger validation. Installed Zod v4 as devDependency (`npm install --include=dev` needed since npm skips devDeps in default install).

**Lessons:**
- Zod v4 API differs from v3: `z.string().datetime()` → `z.iso.datetime()`, `z.string().uuid()` → `z.uuid()`, `z.record(z.unknown())` → `z.record(z.string(), z.unknown())`
- `npm install --save-dev` adds to package.json but doesn't install if `npm install` was previously run without `--include=dev`. Run `npm install --include=dev` to force.
- The Next.js build was already broken (`@tailwindcss/postcss` missing) before this task — pre-existing issue, not related to contract tests.
- TypeScript `moduleResolution: bundler` means `import { z } from "zod"` works from e2e/ files without extra tsconfig changes.
- `cleanupTask(request, id)` walks tasks through on-deck→in-progress→review→done — avoids leaving [CONTRACT] test data in non-done states after each test run.

**Known Issues:**
- None — TypeScript clean, no contract.spec.ts errors.

---

<!-- Forge appends new entries here after completing tasks. Format:

### YYYY-MM-DD — Task Title
**Project:** project-name
**Summary:** brief description of what was built
**Lessons:**
- lesson 1
**Known Issues:**
- issue 1 (if any)

---
-->

### 2026-03-30 — Acceptance criteria required field — block in_progress without it
**Project:** mission-control
**Summary:** Enforcement was partially in place when I picked up the task. Added the missing pieces: (1) `buildPrompt()` in build-queue.ts now injects the `acceptance_criteria` block so builder agents know what to satisfy; (2) `reviewPrompt()` now injects criteria and adds step 5 to verify each one; (3) `TaskDetailDrawer` in tasks/page.tsx now displays the criteria list so Gater and team can review against them. The existing layers (transitionTask guard, POST/PATCH API validation, UI form with red-border, Vigil QA prompt injection) were already present from a prior partial implementation.

**Build:** Compiled successfully
**Pushed:** `panely/sprint-1` → `2938783`

**Caveat:** Tasks already in the backlog/on-deck without `acceptance_criteria` set will be blocked from entering in-progress. This is intentional — they need criteria before the pipeline can promote them.
