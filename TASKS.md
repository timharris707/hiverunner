# TASKS.md — How Mission Control Tasks Work

_The single source of truth for task lifecycle, rules, and conventions._

---

## Task Statuses

Every task moves through a linear pipeline. No skipping steps.

```
backlog → on-deck → in-progress → review → done
                         ↕
                      blocked
```

### Status Definitions

| Status | Meaning |
|--------|---------|
| **backlog** | Acknowledged but not scheduled. Parking lot. |
| **on-deck** | Queued for the next available agent. Ready to go. |
| **in-progress** | An agent is actively building this right now. |
| **review** | Build complete — Gater (QA Lead) must review and approve. |
| **blocked** | Something external is preventing progress. Must state what. |
| **done** | Shipped. Gater approved. Terminal state — nothing leaves done. |

### Valid Transitions (Enforced in Code)

| From | Can go to |
|------|-----------|
| backlog | on-deck |
| on-deck | in-progress |
| in-progress | review, blocked |
| review | done (approved), in-progress (rejected), blocked |
| blocked | in-progress |
| done | _(nowhere — terminal)_ |

Any other transition is **rejected** by the state machine. No exceptions.

---

## Required Fields

### To create a task
- **title** — clear, specific. What is being built or fixed.
- **status** — where it starts (usually `backlog` or `on-deck`).
- **project** — which project this belongs to.

### To enter in-progress
- **acceptance_criteria** — at least one. A task cannot enter `in-progress` without defining what "done" looks like. This is enforced in code. No criteria = no work starts.

### To move review → done
- **reviewAssignedTo** — Gater must be assigned as reviewer. The system auto-assigns her when a task enters `review`, but the field must exist. No Gater = no approval = no done.

---

## Task Fields Reference

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Auto-generated: `TASK-{timestamp}` |
| `title` | string | Short, clear description |
| `description` | string | Full details, requirements, context |
| `status` | string | Current lifecycle stage |
| `priority` | string | `P0` (critical) / `P1` (high) / `P2` (medium) / `P3` (low) |
| `project` | string | Project ID (e.g. `weather-trading`, `mission-control`) |
| `acceptance_criteria` | string[] | What "done" means — required before work starts |
| `assignee` | string | Agent name (e.g. "Pixel", "Forge") |
| `assignedAgent` | string | Agent ID for build routing |
| `reviewAssignedTo` | string | Gater's agent ID — set automatically on review entry |
| `created` | ISO string | When the task was created |
| `updated` | ISO string | Last modification timestamp |
| `completedAt` | ISO string | When the task reached done |
| `comments` | array | Threaded comment history with author + timestamp |

---

## Automation (The Pipeline)

Mission Control has a built-in Software Factory pipeline that automates parts of the lifecycle:

1. **Auto-assign builder** — When a task enters `in-progress`, the system routes it to the best available agent (Pixel for UI, Forge for backend, etc.) and spawns a build session.
2. **Auto-assign Gater** — When a task enters `review`, Gater 🚧 is automatically assigned as reviewer.
3. **On-deck promotion** — When agent capacity opens, the highest-priority `on-deck` task auto-promotes to `in-progress`.
4. **Blocker detection** — If a build fails or an agent reports being stuck, the task moves to `blocked` with a reason.

### Build Executors
Tasks are routed to one of three build executors based on the agent assignment:
- **Claude Code** — for Claude-based agents (Gater, Vigil, etc.)
- **Codex** — for GPT-based agents (Pixel, Forge, etc.)
- **Gemini CLI** — for Gemini-based agents

---

## Projects

Tasks must belong to a project. Current project IDs:

| Project ID | What |
|-----------|------|
| `mission-control` | Mission Control app itself |
| `advisory-board` | BoardRunner / Advisory Board features |
| `weather-trading` | Weather prediction trading system |
| `crypto-trading` | Crypto trading bot |
| `stock-trading` | Stock & options trading |
| `snapaudit` | SnapAudit product |
| `idea-intake` | Ideas pipeline |
| `infrastructure` | Cross-cutting infra work |

---

## Roles

| Who | Role | What they do |
|-----|------|-------------|
| **Tim** | Owner | Creates tasks, sets priorities, approves direction |
| **Henry** | Orchestrator | Routes tasks, manages agents, unblocks work. Does NOT code. |
| **Pixel 💻** | Frontend/Full-Stack | UI, design, full-stack features |
| **Forge 🔧** | Backend | APIs, infrastructure, data |
| **Gater 🚧** | QA Lead | Reviews all work. Nothing ships without her approval. |
| **Vigil 🛡️** | Automated QA | Automated checks, visual regression. Reports to Gater. |
| **Quant 📊** | Strategy | Trading strategies, backtests, analysis |
| **Nimbus 🌤️** | Weather Ops | Weather trading operations |
| **Scout 🔭** | Research | Market intel, tech research, deep dives |
| **Quill ✍️** | Content | Marketing, copy, blog posts |

---

## Rules

1. **Every task needs acceptance criteria before work starts.** No vague "fix the thing" tasks. Define what done looks like.
2. **Nothing ships without Gater.** The review → done transition requires Gater's approval. This is enforced in code.
3. **Blocked means blocked.** If a task is blocked, the blocker must be stated. "Blocked" with no reason is not acceptable.
4. **Done is forever.** Once a task is done, it's done. If follow-up work is needed, create a new task.
5. **Named agents only.** Every task is assigned to a specific team member. No anonymous builds.
6. **Henry orchestrates, never codes.** Henry routes tasks and manages the team. Building is delegated.
7. **Status transitions are enforced.** You can't skip steps. The state machine rejects invalid moves.

---

## Creating a Good Task

### Template
```
Title: [Clear, specific action]
Project: [project-id]
Priority: P0/P1/P2/P3
Description: [Full context — what, why, where in the codebase]
Acceptance Criteria:
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3
```

### Examples

**Good:**
> Title: Fix Ideas takeaway timestamp buttons — link to exact video moment
> Priority: P1
> Acceptance Criteria:
> - Every takeaway timestamp button links to the correct moment in the video
> - New ideas processed going forward always have timestamps
> - Tim can click any 📹 button and land at the right spot

**Bad:**
> Title: Fix timestamps
> (no description, no criteria, no project)

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tasks` | List all tasks |
| `POST` | `/api/tasks` | Create a new task |
| `PATCH` | `/api/tasks` | Update a task (pass `id` + fields) |
| `POST` | `/api/tasks/archive` | Archive completed tasks |
| `POST` | `/api/tasks/build` | Trigger a build for a task |

---

_Last updated: 2026-04-01. This is a living document — update it as the system evolves._
