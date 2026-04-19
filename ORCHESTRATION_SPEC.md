# Mission Control Orchestration Layer — Product Spec
## The Vision

Replace Paperclip as our agent orchestration platform. Build it into Mission Control so we own the full stack. Once hardened, all future projects run here — no third-party dependency.

**Bridge strategy:** Keep Weather Edge, Panely, and this build project on Paperclip during construction. Once MC Orchestration ships, migrate everything here and sunset Paperclip.

---

## Core Concepts

| MC Term | Paperclip Equivalent | Notes |
|---------|---------------------|-------|
| Project | Company | A team + goals + tasks |
| Task | Issue | Work item on the board |
| Agent | Agent | Named AI worker with identity |
| Sprint | Goal | Time-boxed objective |
| Board | Issue list | Kanban in ours, list in Paperclip |

---

## V1 Feature Set (Sprint 1 — Ship This)

### 1. Projects
- Create / archive projects
- Each project has: name, description, color, avatar theme, team roster, goals, task board
- Project dashboard: active agents, task velocity, current sprint progress
- Projects page in MC nav — cards with live status

### 2. Kanban Task Board
- Columns: **Backlog → To-Do → In Progress → Review → Done**
- Drag and drop between columns
- Task cards show: title, assignee avatar, priority badge, label tags
- Click card → task detail drawer (description, comments, subtasks, history)
- Filter by: assignee, priority, label, sprint
- This is the #1 differentiator vs Paperclip — they're list-only, we go visual

### 3. Tasks
- Full CRUD — create, edit, archive
- Fields: title, description, status, priority, assignee, sprint, labels, parent task
- Subtasks (nested, collapsible)
- Comment thread per task
- Activity log (who changed what, when)
- Rich markdown editor for descriptions + comments

### 4. Agents Page
- Roster view — cards per agent with avatar, name, role, status badge
- Status: Idle / Working / Paused / Error
- Click agent → profile: current task, recent activity, skills, run history
- Org chart view — reporting structure visualization
- Each agent has: name, role, avatar (generated per company theme), personality brief

### 5. Avatar System — Company Themes ⭐
- When creating a project/company, pick an **avatar theme** (e.g. "Cyberpunk", "Fantasy", "Sci-Fi Crew", "Corporate", "Anime")
- All agents hired into that project get an AI-generated avatar in that theme
- Avatar generation: use image_generate with a consistent style prompt per theme
- Avatars stored in Supabase storage, displayed throughout: agent cards, task assignees, comments, org chart
- Theme is locked per project for visual consistency
- Predefined themes ship with v1; custom themes later

### 6. Dashboard (Cross-Project)
- Active projects overview
- Tasks in flight across all projects
- Agent activity feed — who's doing what right now
- Quick-add task button

---

## V2 (After V1 Ships — Don't Build Now)
- Agent heartbeat engine (OpenClaw integration — the actual execution layer)
- Approvals workflow
- Goals / OKR tracking
- Sprint planning + velocity charts
- Notifications (Telegram/email on task updates)
- Public project pages
- Billing / seat management

---

## Tech Stack
- **Frontend:** Next.js 15 (already in MC) — add new pages/routes
- **Backend:** Existing MC API routes + new ones
- **Database:** Supabase (new `projects`, `tasks`, `agents`, `comments`, `sprints` tables)
- **Auth:** Already implemented in MC (Supabase Auth)
- **Avatar storage:** Supabase Storage bucket
- **Drag and drop:** `@dnd-kit/core` (lightweight, accessible)

---

## Database Schema (Supabase)

### projects
```sql
id, name, description, color, avatar_theme, status, owner_id, created_at
```

### sprints
```sql
id, project_id, title, goal, status (planned/active/done), start_date, end_date
```

### tasks
```sql
id, project_id, sprint_id, parent_id, title, description, status, priority, 
assignee_agent_id, created_by, labels, created_at, updated_at
```

### agents
```sql
id, project_id, name, role, avatar_url, avatar_theme, status, personality, 
reporting_to, skills, created_at
```

### comments
```sql
id, task_id, author_agent_id, author_user_id, body, created_at
```

### activity_log
```sql
id, task_id, agent_id, user_id, action, metadata, created_at
```

---

## Paperclip Company Setup

**Company name:** NeverIdle Platform  
**Mission:** Build the Mission Control orchestration layer that replaces Paperclip as our agent management system.

### Agent Roster
- **Nova** (CEO) — leads the build, delegates sprints, reviews PRs
- **Pixel** — frontend: Kanban board, agent cards, project UI, avatar system
- **Forge** — backend: Supabase schema, API routes, data layer
- **Vigil** — QA: tests every feature before it ships, visual regression
- **Blaze** — full-stack stretch: overflow work, complex features

### Sprint 1 Goals (Tonight / This Week)
1. Supabase schema + migrations (Forge)
2. Projects page — list + create project (Pixel + Forge)
3. Kanban board — columns, drag/drop, task cards (Pixel)
4. Task detail drawer — full CRUD (Pixel + Forge)
5. Agents page — roster cards with avatars (Pixel)
6. Avatar theme system — theme picker + image generation on agent create (Pixel)

### Definition of Done
- All features working in production on neveridle.ai
- Vigil has tested each feature in Chromium + WebKit
- No regressions to existing MC features

---

## Avatar Themes (V1 Starter Set)
1. **Cyberpunk** — neon, dark, augmented (our current vibe)
2. **Sci-Fi Crew** — space, federation, alien worlds
3. **Fantasy Guild** — medieval, magic, RPG characters
4. **Corporate Elite** — sharp suits, minimal, professional
5. **Anime Studio** — anime art style, expressive
6. **Retro Pixel** — 16-bit pixel art portraits

Each theme has a master prompt used for all avatar generation within that project. Agents get unique variations within the theme based on their role/name.
