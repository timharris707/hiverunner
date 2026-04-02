# Navigation Restructure Spec

## Problem
The sidebar treats Companies, Projects, Tasks, and Team as flat sibling tabs. But the data model is hierarchical:

```
Company (NeverIdle Core)
├── Team (all agents owned by the company)
├── Projects
│   ├── Project team (subset of company agents assigned to this project)
│   └── Tasks
```

The current flat nav makes it impossible to know what you're looking at. "Whose projects? Whose team? Whose tasks?"

## Goal
Make navigation reflect the data hierarchy. Company is the context. Everything inside is scoped to it.

## New Sidebar Structure

### Top section (global)
- **Dashboard** `/` — overview, system health, live stats

### Company section (scoped)
Since we currently only have one company (NeverIdle Core), auto-select it. But design for multiple companies in the future.

The sidebar should show the active company name prominently (e.g., "NeverIdle Core" with the company theme color), then nested under it:

- **Company Home** `/companies/[slug]` — company overview (agent count, project count, active tasks, health)
- **Team** `/companies/[slug]/team` — the company's full agent roster with org structure, roles, departments, who reports to whom. This replaces the current flat "Team" and "Org Chart" — merge them into one cohesive view.
- **Projects** `/companies/[slug]/projects` — list of projects belonging to this company
- **Board** `/companies/[slug]/board` — kanban task board showing all company tasks (filterable by project)

When you click into a project, it shows:
- Project detail page with its assigned team (subset of company agents) and project-specific tasks

### Standalone sections (not company-scoped)
These stay as top-level sidebar items:
- **Trading Desk** `/trading`
- **Ideas** `/ideas`
- **Advisory** `/advisory`
- **Calendar** `/calendar`
- **Memory** `/memory`
- **Files** `/files`
- **Search** `/search`

### System section (collapsed by default)
- Sessions, Logs, System, Costs, Reliability, Cron Jobs

### Remove from sidebar
- **Companies** as a top-level flat list (replaced by company selector/auto-select)
- **3D Office** (novelty, not operational)
- **Factory Floor** (novelty, not operational)
- **Org Chart** (merged into Team)
- **Paperclip** (we're replacing Paperclip with native orchestration)
- **Marketing** (not built yet)
- **Voice Henry** (accessible via search/command palette, not sidebar)
- **Workflows** (not built yet, add back when real)
- **Reports** (not built yet, add back when real)

## Implementation Details

### Dock.tsx changes
Replace the flat DOCK_ITEMS array with a structured layout:
1. Dashboard (always first)
2. Divider or section label: active company name
3. Company Home, Team, Projects, Board (all route to /companies/neveridle-core/...)
4. Divider
5. Trading Desk, Ideas, Advisory, Calendar
6. Divider  
7. Memory, Files, Search
8. Collapsible: System section

### Auto-select company
If only one company exists, auto-redirect `/companies` to `/companies/neveridle-core`. Show a company switcher dropdown in the sidebar when multiple companies exist.

### Route changes needed
- `/agents` → redirect to `/companies/[slug]/team`
- `/projects` → redirect to `/companies/[slug]/projects`
- `/tasks` → redirect to `/companies/[slug]/board`
- Keep old routes working as redirects for bookmarks

### Visual
- Match the existing dark theme (browns/charcoals from the TenacitOS wrapper)
- Active company section should feel "inside" the company — slightly indented, company accent color on the left border
- Keep the same icon style (Lucide icons)

## What NOT to change
- Don't touch the actual page content/components yet — just reorganize where they live in nav
- Don't delete any page files — just change routing
- Keep all API endpoints the same
- Don't modify the database
