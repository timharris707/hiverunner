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

### 2026-03-29 — QA handoff chain — builder completes → auto-routes to Vigil for verification
**Project:** mission-control
**Summary:** : NEEDS_FIX` → requeued to builder | `VERDICT: BLOCKED` → Henry triage  **Caveats:** - Vigil runs WebKit headlessly via Playwright — requires WebKit Playwright browser to be installed (`npx playwright install webkit`). If missing, Safari capture fails gracefully and returns empty (Vigil still runs with Chromium-only captures). - Non-UI builder tasks (e.g., a pure API endpoint) go through Vigil wit

---

### 2026-03-29 — Blocker signaling — agents can flag "I'm stuck" instead of false "done"
**Project:** mission-control
**Summary:** ed to `panely/sprint-1`  ### Caveats - The pipeline (Telegram DM, in-app notification, system event) was already wired up for blocker detection in `build-queue.ts` — this commit only closes the type/UI gaps. - The `detectBlocker` function matches the first blocker pattern found in output. If an agent writes `BLOCKED:` near other trigger phrases (e.g. "cannot verify in Safari"), the Safari pattern 

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
