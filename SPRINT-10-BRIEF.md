# Sprint 10 — Mission Control Orchestration Overhaul

## Context
Mission Control has ~100K lines of code with real backend functionality (build queue, agent pipeline, QA loop, execution engine, state machine) but the UI doesn't match our reference product (Paperclip) and the execution engine isn't wired to the orchestration database.

**Design philosophy: UI first, then wire it up.** Get the layout and navigation right so we can SEE the intended flow, then connect the backend to make it real. Design IS the spec.

**Reference product: Paperclip.** We're rebuilding Paperclip's orchestration experience natively on OpenClaw. Study Paperclip's actual UI when building — it shows exactly what the nav, pages, and flow should look like.

**Key constraint: short sprints (3-5 tasks each) so we can checkpoint and verify before continuing.**

---

## Sprint 10A — Navigation & Layout (Design First)

**Goal:** Rebuild the UI to match Paperclip's orchestration hierarchy. Get the design right. The foundational flow is: Company → Project → Pick Team → Pick CEO → Give CEO objectives → CEO distributes work. The UI must reflect this hierarchy.

### Reference: Paperclip's Sidebar Structure
```
[Company Logo/Avatar — far left rail or top]

COMPANY NAME (NeverIdle Core)
├── + New Issue (action button)
├── Dashboard (company-scoped — agent activity, task stats, live counts)
├── Inbox (assigned to me / notifications)
├── WORK
│   ├── Issues (all tasks/issues — filterable, searchable)
│   ├── Routines
│   └── Goals
├── PROJECTS
│   ├── Project 1 (links to project-specific board)
│   ├── Project 2
│   └── ...
├── AGENTS (each agent listed individually with live status dot)
│   ├── Dash (● 2 live)
│   ├── Forge (● 7 live)
│   ├── Gater
│   ├── Pixel (● 1 live)
│   └── Vigil (● 3 live)
└── COMPANY
    ├── Org
    ├── Skills
    ├── Costs
    ├── Activity
    └── Settings
```

### Non-orchestration sections remain separate:
Trading Desk, Advisory Board, Calendar, Memory, Files, Search, Ideas — these stay as their own sidebar section below the orchestration nav, or in a separate nav area. They are NOT part of the company/orchestration hierarchy.

### Tasks

**NEVA-200: Rebuild Dock.tsx to match Paperclip's sidebar hierarchy**
- Replace the current flat nav with a structured sidebar matching the reference above
- Company name prominently at top of the orchestration section  
- Sections: New Issue button, Dashboard (company-scoped), Inbox, WORK, PROJECTS (dynamically list real projects from orchestration DB), AGENTS (dynamically list real agents with live status indicators), COMPANY section
- Non-orchestration items (Trading, Advisory, Ideas, Calendar, Memory, Files, Search) in a separate section below
- System items (Sessions, Logs, Costs, Reliability) in a collapsible section
- File: `src/components/TenacitOS/Dock.tsx`
- Acceptance: sidebar matches Paperclip's hierarchy, agents show individually with status dots, projects listed by name

**NEVA-201: Company-scoped Dashboard page**
- Current Dashboard (`/`) is a generic Mission Control overview — it needs to become (or link to) a company-scoped dashboard showing orchestration activity
- Show: active agent count with live status, tasks in progress, tasks in review, recent activity feed, live execution sessions
- Like Paperclip's dashboard: live indicator counts, task distribution, agent activity stream
- Route: `/companies/[slug]/dashboard` or make `/` auto-scope to active company
- Acceptance: dashboard shows real-time company-scoped orchestration data

**NEVA-202: Issues page (replaces flat Tasks page)**
- Create a proper Issues list view (like Paperclip's Issues page)
- Filterable by: status, assignee, project, priority, type
- Searchable, sortable by: created, updated, priority
- Shows task title, status badge, assignee avatar, project tag, priority
- Route: `/companies/[slug]/issues`
- Acceptance: all orchestration tasks visible in a clean filterable list

**NEVA-203: Agent detail pages with individual sidebar entries**
- Each agent gets its own sidebar entry with live status dot (not just a flat "Team" page)
- Clicking an agent → agent detail page: avatar, role, current tasks, recent activity, execution history, live session status
- Live status dot: green = actively executing, gray = idle
- Route: `/companies/[slug]/agents/[agentId]`
- Acceptance: agents listed individually in sidebar with live dots, detail page shows real data from orchestration DB

**NEVA-204: Projects listed individually in sidebar + project board**
- PROJECTS section dynamically lists real projects from orchestration DB
- Clicking a project → project-specific board (kanban) showing only that project's tasks
- Task count badge next to project name
- Route: `/companies/[slug]/projects/[projectSlug]`
- Acceptance: real projects in sidebar, clicking goes to scoped kanban board

---

## Sprint 10B — Execution Engine Wiring (5 tasks)

**Goal:** Wire the backend so the CEO flow actually works: task → CEO routes → agent builds → QA reviews → done. The UI from 10A shows the intended flow; now make it real.

**NEVA-205: Map openclaw_agent_id for all agents**
- Every agent in orchestration.db needs `openclaw_agent_id` mapped to an OpenClaw agent config
- Use agent IDs from `src/config/agents.ts` (henry, t1/atlas, t2/nimbus, t3/cipher, quant, backend/forge, fullstack/pixel, scout, quill, counsel, gater, vigil)
- Add Dash as a new agent config if not present
- Acceptance: `SELECT name, openclaw_agent_id FROM agents` returns non-null for all agents

**NEVA-206: Task assignment triggers agent execution**
- When a task moves to `in-progress` with an assignee, spawn an OpenClaw agent session
- Connect `moveTask()` in orchestration service → `execution.ts` spawn logic
- Use the agent's configured model (Codex for Pixel/Forge builders, Sonnet for Dash/Gater/Vigil)
- Acceptance: assigning + starting a task spawns a real agent session

**NEVA-207: CEO routing — Dash distributes tasks**
- When a new issue/task is created and assigned to CEO (Dash):
  1. Dash wakes up via heartbeat
  2. Reads the task/objective
  3. Determines the right team member based on task type and agent roles
  4. Re-assigns the task to that agent
  5. Moves to in-progress (triggers NEVA-206)
- Dash is a ROUTER, not a builder. He reads, decides, delegates.
- Acceptance: create task → assign to Dash → Dash auto-reassigns to correct agent → agent starts work

**NEVA-208: Agent output flows back to task board**
- When an agent session completes:
  1. Output written as comment on the task
  2. Task moves to `review` status
  3. QA agent (Gater) gets assigned
- Acceptance: agent finishes → task auto-moves to review → output visible as task comment

**NEVA-209: QA loop — Gater reviews before done**
- Task enters `review`:
  1. Gater spawns to review
  2. Approve → done | Reject → back to in-progress with feedback comment
  3. Rejection re-triggers the original agent with the feedback
  4. Max 3 cycles before human escalation
- Use existing `buildGaterReviewPrompt` and `buildQAHandoffPrompt` from agent-pipeline.ts
- Acceptance: no task reaches `done` without Gater approval

---

## Sprint 10C — Integration Test & Cleanup (3 tasks)

**NEVA-210: End-to-end integration test**
- Create task via UI → assign to Dash → Dash routes to Pixel → Pixel executes → output appears → review → Gater reviews → done
- Full loop, no manual intervention
- Acceptance: documented successful end-to-end run

**NEVA-211: Error handling and recovery**
- Spawn failure → error comment + retry after 60s
- Agent timeout (>20 min) → stalled status + alert
- QA rejection cap (3 failures → escalate)
- Session crash → task blocked with error details
- Acceptance: all failure modes handled gracefully

**NEVA-212: Remove legacy/dead code**
- Archive: projects.json fallback, dead nav items (3D Office, Factory Floor, Voice Henry, Marketing, Paperclip link)
- Clean duplicate routes (old flat vs new company-scoped)
- Remove test data seeding
- Acceptance: no dead nav items, no ghost data, clean codebase

---

## Sprint Execution Rules

1. **Short sprints** — 10A first, checkpoint with Tim/Henry, then 10B, then 10C
2. **Codex for all coding** — builders (Pixel, Forge) use Codex/GPT models
3. **Nothing ships without Gater** — every task goes through QA review before done
4. **No self-closing** — agents cannot mark their own tasks done
5. **Paperclip is the reference** — when in doubt about how something should look or work, study Paperclip's actual UI
6. **Test with real data** — use real NeverIdle Core company, real agents, real projects. No mock data.
7. **Design first, wire second** — UI layout comes before backend wiring. Get the design right, then make it functional.
