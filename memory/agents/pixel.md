# Agent Memory — Pixel 💻

**Agent ID:** `fullstack`
**Role:** Senior Full-Stack Engineer
**Division:** Engineering
**Reports To:** Henry ⚡

---

## Standing Knowledge

### Codebase Architecture
- **Stack:** Next.js 14 App Router, React 19, TypeScript, Tailwind CSS
- **Layout:** App Router at `src/app/` — dashboard pages under `src/app/(dashboard)/`
- **Components:** `src/components/` — shared UI components
- **Styling:** Tailwind CSS — dark theme by default, `bg-gray-950`, `bg-gray-900`, `bg-gray-800` palette
- **No ShadCN** — custom components. Reuse existing patterns from nearby files.

### Page Structure
- Dashboard shell in `src/app/(dashboard)/layout.tsx`
- Key pages: `/`, `/agents`, `/tasks`, `/memory`, `/office`, `/advisory`
- Route params for agent detail: `/agents/[id]/page.tsx`
- API routes in `src/app/api/` — all `route.ts` files

### Data Fetching Pattern
- Client components use `fetch("/api/...")` or `useEffect` + `useState`
- Server components can read data files directly
- Most dashboard widgets poll at intervals (tasks, activities, notifications)
- `export const dynamic = "force-dynamic"` on routes that read live data

### UI Conventions
- Activity feed items use `bg-gray-800 border border-gray-700 rounded-lg p-3`
- Status badges: green=active, yellow=warning, red=error, blue=info
- Cards with `bg-gray-900 border border-gray-800 rounded-xl p-4`
- Avatars from `/public/avatars/{agentId}.jpg`
- Screenshots from `/public/screenshots/{taskId}/`

### Key Shared Data
- Agent configs: `src/config/agents.ts` — use `getAgentByAnyId()` for lookup
- Task types: `src/types/` — import from here, don't redefine
- Projects list: `data/projects.json`

### Build
- `npm run build` — must pass before shipping
- TypeScript strict mode, eslint-disable needed for `any` types
- Check for `"use client"` directive when using hooks/events

---

## Task Log

### 2026-03-30 — Trading Desk — fix columns, add settlement countdown, sortable, user-friendly dates
**Project:** weather-trading
**Summary:** test_dashboard_kalshi_portfolio.py tests/test_api/test_dashboard_server_resting.py` returned `5 skipped` because the FastAPI test runtime is not installed in this shell. Commit and push both failed for environment reasons above.  Known caveats / lessons learned: live browser confirmation is still needed against `uvicorn src.dashboard.server:app --port 8050`, especially to verify the real Kalshi ba

---

### 2026-03-30 — Trading Desk — fix columns, add settlement countdown, sortable, user-friendly dates
**Project:** weather-trading
**Summary:** rtfolio.py#L39), and [tests/test_api/test_dashboard_server_resting.py](/Users/timharris/.openclaw/workspace/projects/weather-trading/tests/test_api/test_dashboard_server_resting.py#L74), but several endpoint tests were skipped because the FastAPI test runtime is not available in this shell. - Live browser confirmation is still needed against `uvicorn src.dashboard.server:app --port 8050`, especial
**Lessons:**
- This repository is a Python/FastAPI dashboard, not a Next.js app, so the requested `npm run build` step is not available here.
- The added coverage for settlement fallback and Kalshi portfolio behavior exists in [tests/test_api/test_dashboard_trade_history.py](/Users/timharris/.openclaw/workspace/projects/weather-trading/tests/test_api/test_dashboard_trade_history.py#L74), [tests/test_api/test_dashboard_kalshi_portfolio.py](/Users/timharris/.openclaw/workspace/projects/weather-trading/tests/test_api/test_dashboard_kalshi_portfolio.py#L39), and [tests/test_api/test_dashboard_server_resting.py](/Users/timharris/.openclaw/workspace/projects/weather-trading/tests/test_api/test_dashboard_server_resting.py#L74), but several endpoint tests were skipped because the FastAPI test runtime is not available in this shell.
- Live browser confirmation is still needed against `uvicorn src.dashboard.server:app --port 8050`, especially for real Kalshi bankroll, real-time open-position count, and the settlement countdown rendering.

---

### 2026-03-30 — Trading Desk — fix columns, add settlement countdown, sortable, user-friendly dates
**Project:** weather-trading
**Summary:** d (`9 passed, 3 skipped`), and `python3 -m py_compile src/dashboard/server.py` passed.  Known caveats / lessons learned: the repo is a FastAPI app, not a Next.js app, so the requested `npm run build` step is not available here; live browser verification of real Kalshi bankroll and open-position count still needs a human run against `uvicorn src.dashboard.server:app --port 8050`; older local DB sch

---

### 2026-03-30 — Trading Desk — fix columns, add settlement countdown, sortable, user-friendly dates
**Project:** weather-trading
**Summary:** _api/test_dashboard_kalshi_portfolio.py tests/test_api/test_api.py` `python3 -m py_compile src/dashboard/server.py`  Known caveats / lessons learned: - The repo is a Python/FastAPI dashboard, not a Next.js app, so the requested `npm run build` step is not applicable here. - Commit/push remain blocked by sandboxed git permissions, not by code state. - I could not visually confirm the live bankroll 
**Lessons:**
- The repo is a Python/FastAPI dashboard, not a Next.js app, so the requested `npm run build` step is not applicable here.
- Commit/push remain blocked by sandboxed git permissions, not by code state.
- I could not visually confirm the live bankroll card, Kalshi position count, or settlement countdown behavior in the browser from this environment.

---

### 2026-03-30 — Trading Desk — fix columns, add settlement countdown, sortable, user-friendly dates
**Project:** weather-trading
**Summary:** ate '.git/index.lock': Operation not permitted`  Known caveats / lessons learned: - The settlement blanks were likely being amplified by repeated per-contract Kalshi fetches on every auto-refresh; the new in-memory cache should reduce that. - The client fallback settlement timestamp was off by a day before this patch; it now correctly falls back to next-day `03:00 UTC`. - I could not visually conf
**Lessons:**
- The settlement blanks were likely being amplified by repeated per-contract Kalshi fetches on every auto-refresh; the new in-memory cache should reduce that.
- The client fallback settlement timestamp was off by a day before this patch; it now correctly falls back to next-day `03:00 UTC`.
- I could not visually confirm the live bankroll/open-position cards or countdown behavior in a browser from this environment.

---

### 2026-03-30 — Unified WebSocket with reconnect and stale-data banner
**Project:** mission-control
**Summary:** wn caveats / lessons learned: - This realtime transport depends on the custom `server.js` entrypoint, so live WebSocket updates only exist when the app is launched through the updated `dev` / `start` scripts in [package.json](/Users/timharris/.openclaw/workspace/projects/mission-control-app/package.json#L5). - I could not visually verify reconnect behavior or the stale banner in a browser from thi
**Lessons:**
- This realtime transport depends on the custom `server.js` entrypoint, so live WebSocket updates only exist when the app is launched through the updated `dev` / `start` scripts in [package.json](/Users/timharris/.openclaw/workspace/projects/mission-control-app/package.json#L5).
- I could not visually verify reconnect behavior or the stale banner in a browser from this environment.
- Commit and push remain blocked by sandboxed git writes and lack of network access.

---

### 2026-03-30 — Unified WebSocket with reconnect and stale-data banner
**Project:** mission-control
**Summary:** rocess - binding to a port - Operation not permitted (os error 1)`. I also could not stage/commit because git writes are blocked: `fatal: Unable to create '.git/index.lock': Operation not permitted`.  Known caveats / lessons learned: this transport now depends on the custom `server.js` entrypoint, so the WebSocket only exists when the app is launched through the updated `dev`/`start` scripts. I co

---

### 2026-03-30 — Bug: Task board UI shows tasks in wrong columns — 32 phantom review items
**Project:** mission-control
**Summary:** -board-review-lane.test.ts` - Failed: `npm run build`   Error: `creating new process - binding to a port - Operation not permitted (os error 1)`  Known caveats / lessons learned: - The phantom `32` Review items were caused by client-side review-lane mirroring, not the tasks API. - Hard refresh should now resolve stale board state because task fetches use `cache: "no-store"`. - I did not commit or 
**Lessons:**
- The phantom `32` Review items were caused by client-side review-lane mirroring, not the tasks API.
- Hard refresh should now resolve stale board state because task fetches use `cache: "no-store"`.
- I did not commit or push because the required build is blocked by the environment, and remote push is unavailable here.

---

### 2026-03-30 — Bug: Ideas badge shows 2 unprocessed when all ideas are processed
**Project:** mission-control
**Summary:** mmary || !review.assessment || takeaways.length === 0) { +    return false; +  } + +  return takeaways.every((takeaway) => { +    const status = String(takeaway.status || "").toLowerCase(); +    return status === "rejected" || takeawayHasTask(takeaway); +  }); +} + +export function getUnprocessedReviewIds(reviews: ReviewLike[]) { +  return reviews +    .filter((review) => String(review.status || "

---

### 2026-03-30 — Task board column sorting — priority order + active items float to top
**Project:** mission-control
**Summary:** ries pre-existing lint errors, the production build is blocked by the sandboxed Turbopack process-port failure, and I could not commit/push or visually verify the board in a browser here.  Lessons learned / caveats: the sort now persists on refresh because it is derived entirely from persisted task fields; the blocked lane is now visible again on the board, which changes the desktop layout from fi

---

### 2026-03-30 — Label and verify every dashboard metric
**Project:** mission-control
**Summary:** us is clean for this task; the only remaining modification is unrelated runtime data in `data/tasks.db-wal`.  Lessons learned / caveats: - The spend metric is correctly defined as quota-ledger approved spend for the UTC quota day, not provider-billed actuals. - The tooltip interaction fix is present: click now opens the tooltip instead of toggling it shut. - I cannot honestly mark this done becaus
**Known Issues:**
- The spend metric is correctly defined as quota-ledger approved spend for the UTC quota day, not provider-billed actuals.
- The tooltip interaction fix is present: click now opens the tooltip instead of toggling it shut.
- I cannot honestly mark this done because the required clean build, browser verification, and push cannot be completed in this environment.

---

### 2026-03-30 — Label and verify every dashboard metric
**Project:** mission-control
**Summary:** n pass before this can be honestly marked done.  Known caveats / lessons learned: - The spend card is defined correctly as quota-ledger approved spend for the UTC quota day, not provider-billed actuals. - The environment still blocks both the production build path and local Playwright server startup, so visual verification must be completed in a less restricted environment. - There are unrelated p
**Lessons:**
- The spend card is defined correctly as quota-ledger approved spend for the UTC quota day, not provider-billed actuals.
- The environment still blocks both the production build path and local Playwright server startup, so visual verification must be completed in a less restricted environment.
- There are unrelated pre-existing modifications in the worktree; I limited my code change to the tooltip interaction fix.

---

### 2026-03-30 — Show live build activity on task cards
**Project:** mission-control
**Summary:** eate `.git/index.lock`. - `git push` failed because network access is blocked and `github.com` could not be resolved.  Lessons learned / caveats: - The live card feed plumbing was already present; this change mainly makes it match the acceptance criteria more closely and avoids duplicate SSE lines after reconnects. - I could not visually verify the board in a browser here. - I could not satisfy th
**Known Issues:**
- The live card feed plumbing was already present; this change mainly makes it match the acceptance criteria more closely and avoids duplicate SSE lines after reconnects.
- I could not visually verify the board in a browser here.
- I could not satisfy the required clean build, commit, or push because of environment restrictions outside the task logic.

---

### 2026-03-30 — Label and verify every dashboard metric
**Project:** mission-control
**Summary:** commit or push because the required build and visual verification could not be completed.  Lessons learned / caveats: - The spend card is correctly defined as quota-ledger approved spend for the UTC quota day, not provider-billed actuals. - The visual baseline file for `dashboard-metrics-grid.png` still needs to be generated in an environment that allows the app server to start. - There are unrela
**Known Issues:**
- The spend card is correctly defined as quota-ledger approved spend for the UTC quota day, not provider-billed actuals.
- The visual baseline file for `dashboard-metrics-grid.png` still needs to be generated in an environment that allows the app server to start.
- There are unrelated pre-existing TypeScript failures in the repo that also prevent a clean global verification run.

---

### 2026-03-30 — Make review step visible — show task in review column with Gater verdict
**Project:** mission-control
**Summary:** ing implementation was fixed. - Focused `tsx` test execution could not be completed here because `tsx` is not installed locally and `npx` could not be relied on in this restricted environment.  Known caveats: - I could not visually verify the board in a browser. - I could not commit or push because `.git/index.lock` creation is blocked in this sandbox. - The Review column now mirrors recent verdic
**Known Issues:**
- I could not visually verify the board in a browser.
- I could not commit or push because `.git/index.lock` creation is blocked in this sandbox.
- The Review column now mirrors recent verdicts for 24 hours to keep the review step visible without permanently duplicating old completed work.

---

### 2026-03-30 — Label and verify every dashboard metric
**Project:** mission-control
**Summary:** sandbox also denied starting the local dev server.  I did not commit or push because the required build/visual verification could not be completed here.  Caveats: - The spend card is now explicitly labeled as quota-ledger spend for the UTC quota day; it is not provider-billed actuals. - The new screenshot baseline file was not generated because browser/server startup is blocked in this sandbox. - 
**Known Issues:**
- The spend card is now explicitly labeled as quota-ledger spend for the UTC quota day; it is not provider-billed actuals.
- The new screenshot baseline file was not generated because browser/server startup is blocked in this sandbox.
- The repo currently has unrelated modified files and unrelated TypeScript errors outside this scope.

---

### 2026-03-30 — Live build activity stream on task cards — show what the agent is doing in real-time
**Project:** mission-control
**Summary:** SK-123", "action": "WRITE", "description": "src/components/Button.tsx", "status": "completed", "agent": "Forge" } ```  **Caveats:** - Cannot verify visually in browser — need Tim to confirm the feed renders on an active build card - Events are in-memory only — they don't survive server restarts. This is by design (ephemeral build telemetry, not persistent history) - Agents need to be instrumented 

---

### 2026-03-30 — Real-time narrative activity feed — make MC legible to humans
**Project:** mission-control
**Summary:** ints to `/activity` for drill-in  **Validation:** `npm run build` — clean, `✓ Compiled successfully`  ---  **Caveat:** Cannot verify visually in browser. The quality of the narrative depends on how recent tasks are populated in `data/tasks.json` — if most tasks have no `assignedAgent`, sentences will use the generic form (`"[title] is in progress"`) rather than the named form. The agent detection 

---

### 2026-03-30 — Fix Agents page — stuck on Polling agent sessions, never renders cards
**Project:** mission-control
**Summary:** ately from `AGENT_CONFIGS` with `NOT DEPLOYED` status on first paint. 2. Replaced the gateway icon with an inline spinner while `loading` is true, so users get non-blocking feedback that live status is being fetched.  **Validation:** `npm run build` clean, pushed to `panely/sprint-1`.  **Caveat:** Cannot verify visually in browser. Need Tim to confirm all 12 agent cards appear on page load and tha

---

### 2026-03-30 — CHAOS.md failure matrix — expected recovery for every break scenario
**Project:** mission-control
**Summary:** (§6) use raw `fetch()` — if the dev server isn't running when the suite starts, Playwright's `webServer` config will start it automatically. - Concurrency tests (§5) are best-effort: same-millisecond ID collision is documented in CHAOS.md §9.8 as a known low-risk gap; the test logs a warning but doesn't fail. - The 8 unmitigated risks in CHAOS.md §9 require code changes (quota lock, agent memory l

---

### 2026-03-30 — Playwright E2E smoke suite — 10 critical path tests in Chromium+WebKit
**Project:** mission-control
**Summary:** nedTo` guard** — PATCH `review → done` returns 400 unless `reviewAssignedTo` is set (the Gater gate). The `review → done` lifecycle test was missing this. 3. **Legacy task IDs** — `GET /api/tasks` returned 55 tasks with non-standard IDs (`TASK-W001`, `TASK-C001`, `task-new-*`) that predate the `TASK-{timestamp}` format. The schema test now skips those and only validates modern-format tasks.  **Fil

---

### 2026-03-30 — Preview deploy gate — Vercel preview URL tested before merge
**Project:** mission-control
**Summary:** lready linked  **Remaining caveat:** The `VERCEL_TOKEN` secret must be set in GitHub repository settings (`Settings → Secrets → Actions`) for the workflow to deploy. This is a one-time manual step in the GitHub UI that can't be done in code.  **BLOCKED (partial):** Cannot verify the workflow actually runs end-to-end — that requires a real PR against `main` with `VERCEL_TOKEN` configured. The code 

---

### 2026-03-30 — Task card redesign v2 — prioritize agent name visibility, reduce clutter
**Project:** mission-control
**Summary:** links/attachments** pushed to a compact micro-metadata cluster at `0.65rem` — still there, just visually demoted so they don't compete  **What was already correct** (no changes needed): - Description preview — was never on cards - Tags — were never on cards - Model badge — was never on cards  **Validation:** `npm run build` clean, zero errors or warnings.  **BLOCKED:** Cannot verify visually in br

---

### 2026-03-30 — Fix task drawer comments — show threaded history with author, emoji, timestamp per entry
**Project:** mission-control
**Summary:** lean, no errors or warnings.  **Caveats:** - BLOCKED: Cannot verify visually — browser validation needed by Tim - The `lastReviewNotes` field still exists on the task type and is still written by the pipeline for backward compatibility — it's just no longer displayed as a separate UI block - The `/tasks` page still has its own duplicate `CommentThread` implementation (identical to the shared one i

---

### 2026-03-30 — Task board glow effects — breathing pulse on active builds and reviews
**Project:** mission-control
**Summary:** ully, no errors or warnings.  **Caveats:** - BLOCKED: Cannot verify visually — browser validation needed by Tim. With no tasks currently in `running`/`spawning` or `codeReviewState=running`, you may want to temporarily set a task's `buildState` to `"running"` in `data/tasks.json` to see the green glow, and `codeReviewState` to `"running"` for the purple glow. - The `transition-all` class on the ca

---

### 2026-03-30 — Fix task comment system — submit button, timestamped history, author tracking not working in UI
**Project:** mission-control
**Summary:** X validation needed by a human - Two separate `CommentThread` implementations exist: `src/components/TaskDetailDrawer.tsx` (shared, used by main dashboard) and `src/app/(dashboard)/tasks/page.tsx` (inline, used by `/tasks` page). The tasks page version already had correct Tim handling. Future improvements need to be applied in both places, or the duplication should be resolved. - The `notes` field

---

### 2026-03-29 — Trading Desk — live trade activity feed with edge data at time of purchase
**Project:** weather-trading
**Summary:** an (`py_compile`). Pushed to `origin/main`.  **BLOCKED:** Cannot verify in browser — server must be running (`uvicorn src.dashboard.server:app --port 8050`). Human validation needed at `http://127.0.0.1:8050/trades`.  **Known caveat:** Live price enrichment only fires for open (`pending`/`filled`) positions. Settled trades show `--` for current price (Kalshi markets may be expired/resolved). If Ka

---

### 2026-03-29 — Watcher status widget in Trading Desk — is it running, last scan, next window
**Project:** weather-trading
**Summary:** t be running (`uvicorn src.dashboard.server:app --port 8050`) for visual confirmation - Log timestamps are parsed as **local time** (not UTC) since the `model_watcher.log` uses local timestamps. The heartbeat age calculation uses `datetime.now()` (local) for comparison — this is correct but worth noting if the server runs in a different timezone than the machine writing the logs - The "trades plac

---

### 2026-03-29 — Task comment history — threaded notes with author, timestamp, and full history
**Project:** mission-control
**Summary:** # Validation - `npm run build` passes clean - Comments API route confirmed in build output  ### Caveats - BLOCKED: Cannot verify in browser — visual/UX validation needed by a human - The old `notes` field still exists on tasks in `tasks.json` for backward compatibility; existing notes are not auto-migrated to comments - Agent integration (auto-adding rejection/resolution comments from Gater pipeli

---

### 2026-03-29 — Trading Desk — live-only view with real Kalshi P&L (no paper trades)
**Project:** weather-trading
**Summary:** balance requires `KALSHI_API_KEY` + `kalshi_private_key.pem` to be configured in `.env`. If not configured, the balance card shows `N/A` gracefully - `data/bankroll.json` with `{"initial_deposit": 500}` should be created manually to track deposits — defaults to $500 if missing - BLOCKED: Cannot verify in a live browser — the dashboard requires the FastAPI server to be running. Visual/UX validation

---

### 2026-03-29 — Trading Desk — risk controls dashboard with live parameter adjustments
**Project:** weather-trading
**Summary:** eats:** - The live engine (`live_engine.py`) currently reads defaults from hardcoded constants, not from `data/risk_config.json`. For runtime parameter adjustments to take full effect, the engine would need to be updated to check `risk_config.json` on each scan cycle. The dashboard and API are ready for that integration. - `BLOCKED: Cannot test in browser` — I can't open the dashboard to visually 

---

### 2026-03-29 — Fix task comment system — submit button, timestamps, author tracking
**Project:** mission-control
**Summary:** The tasks page (`src/app/(dashboard)/tasks/page.tsx`) had its own inline `TaskDetailDrawer` that still used the old plain-text notes textarea instead of the `CommentThread` component from `src/components/TaskDetailDrawer.tsx`. Added the full `CommentThread` component inline to the tasks page with author dropdown, type selector, submit button, color-coded comment display, and persistence via `POST /api/tasks/[id]/comments`. Build passes clean.
**Lessons:**
- The tasks page duplicates the drawer component inline rather than importing from `src/components/TaskDetailDrawer.tsx` — this means features added to the shared component don't automatically appear on the tasks page
**Known Issues:**
- BLOCKED: Cannot verify in browser — visual/UX validation needed by a human
- The tasks page drawer and the shared component drawer are separate codepaths; future comment improvements need to be applied in both places (or the duplication should be resolved)

---

### 2026-03-29 — Fix CommentThread Tim author handling in shared drawer
**Project:** mission-control
**Summary:** Fixed the shared `TaskDetailDrawer.tsx` CommentThread that defaulted to first agent ("Henry") instead of "Tim" and didn't handle the "tim" value — comments were posted as lowercase "tim" with robot emoji. Aligned with the tasks/page.tsx version: default to "tim", capitalize to "Tim" on submit, use 👤 emoji, correct display in placeholder. Build passes clean.
**Lessons:**
- `getAgentByAnyId("tim")` returns `undefined` — Tim is not an agent, so any component using this function for author resolution needs explicit Tim handling
- Two separate CommentThread implementations exist (shared component + tasks page inline) — changes must be applied to both
**Known Issues:**
- BLOCKED: Cannot verify in browser — visual/UX validation needed by a human

---

<!-- Pixel appends new entries here after completing tasks. Format:

### YYYY-MM-DD — Task Title
**Project:** project-name
**Summary:** brief description of what was built
**Lessons:**
- lesson 1
**Known Issues:**
- issue 1 (if any)

---
-->
