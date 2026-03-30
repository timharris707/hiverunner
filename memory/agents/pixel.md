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
