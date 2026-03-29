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

### 2026-03-29 — Trading Desk — risk controls dashboard with live parameter adjustments
**Project:** weather-trading
**Summary:** eats:** - The live engine (`live_engine.py`) currently reads defaults from hardcoded constants, not from `data/risk_config.json`. For runtime parameter adjustments to take full effect, the engine would need to be updated to check `risk_config.json` on each scan cycle. The dashboard and API are ready for that integration. - `BLOCKED: Cannot test in browser` — I can't open the dashboard to visually 

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
