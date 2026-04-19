# Mission Control Cleanup Sprint — March 28, 2026

## Goal
Make Mission Control the single pane of glass. Clean up the mess, integrate Paperclip visibility, and make the task board something Tim actually wants to look at.

## Priority 1 — Task Board Visual Overhaul
**Problem:** Cards are cramped, ugly, and information-dense in a bad way. The Done column is a graveyard.

### TASK: Card redesign
- [ ] More breathing room — increase card padding, line spacing
- [ ] Clean typography hierarchy — title bold, metadata subtle
- [ ] Better badge layout — priority, project, model badges should flow, not stack awkwardly
- [ ] Build status indicators need to be cleaner (the red BUILD FAILED and REVIEW NEEDED badges are chunky)
- [ ] Agent avatar + model badge should be a single clean footer row
- [ ] Tags should be subtle pills, not competing with the title
- [ ] Hover state with quick actions (archive, move, open)

### TASK: Done column management
- [ ] Auto-collapse Done column by default (show count only, expandable)
- [ ] Or: archive Done tasks after 48h — move to a searchable archive, off the board
- [ ] Remove duplicate YouTube processing card (VwHjR0xxJ1M appears 2x)
- [ ] Add "Clear Done" or "Archive All Done" button

### TASK: Empty state + board density
- [ ] Backlog and To-Do both show "No tasks" — use that space better or collapse empty columns
- [ ] Column headers need task counts that update live

## Priority 2 — Data Cleanup
**Problem:** 34 tasks have no/bad project tags, 15 have no description, stale build states.

### TASK: Task data hygiene
- [ ] Fix 34 tasks with bad project tags (none, "4", "MEMORY.md", "ORG.md", "org-structure")
- [ ] Map orphan tasks to real projects or create a "general" catch-all
- [ ] Clear the SnapAudit BUILD FAILED state (claude not on PATH — fix the spawn or kill the task)
- [ ] Close the org chart review task (it's been in Review since Mar 27)

## Priority 3 — Issue/Error Cleanup (The "22 Issues" Badge)
**Problem:** 26 cron errors accumulated, circuit breaker open, creating a persistent red badge.

### TASK: Reliability page cleanup
- [ ] Audit all 18 cron jobs — which are still valid? Kill dead ones.
- [ ] Clear error counts for resolved issues
- [ ] Reset circuit breaker state
- [ ] The weather-related crons we disabled today should be removed or marked inactive
- [ ] Session errors (5 total) — investigate and clear

## Priority 4 — Paperclip Integration (Single Pane of Glass)
**Problem:** Tim has to bounce between MC and Paperclip UI to see what's happening.

### TASK: Paperclip status widget on Projects page
- [ ] New API route: `/api/paperclip/status` — polls localhost:3100 for both companies
- [ ] Projects page shows Paperclip companies with: agent count, active/idle/paused status, recent issue activity
- [ ] Click-through to see issues list without leaving MC
- [ ] Agent status summary: "Weather Edge: 3 active, 6 idle | Panely: 3 active, 3 paused"

### TASK: Paperclip activity feed
- [ ] Pull recent issue updates from Paperclip API
- [ ] Show in MC activity feed or dashboard
- [ ] Key metrics: issues completed today, agents working, sprint progress

## Priority 5 — Project Filter Tags Cleanup
**Problem:** The filter bar at the top of the task board shows stale/ugly project tags.

### TASK: Project tag cleanup
- [ ] Remove orphan project filters (4, MEMORY.md, ORG.md, org-structure)
- [ ] Consolidate similar projects (advisory-board + advisory-board-product → advisory-board)
- [ ] Add project colors/emojis consistently
- [ ] Sort by relevance/activity, not alphabetically

## Agent Assignments
- **Pixel** — Card redesign + board visual overhaul (Priority 1)
- **Forge** — Paperclip API integration (Priority 4)
- **Vigil** — Data cleanup + reliability audit (Priority 2 + 3)
- **Henry** — Orchestration, verification, task creation on MC board

## Success Criteria
- [ ] Task board looks clean and professional when Tim opens it
- [ ] Done column doesn't dominate the view
- [ ] No orphan/broken project tags
- [ ] "22 Issues" badge is cleared
- [ ] Paperclip company status visible from MC without switching apps
- [ ] SnapAudit build error resolved
