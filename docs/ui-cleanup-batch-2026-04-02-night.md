# Mission Control UI Cleanup Batch — 2026-04-02 Night

## Goal
Batch a coherent Mission Control UI + architecture cleanup pass to reduce context thrash and review changes as one unit.

## Working Method
- Collect multiple UI edits first
- Implement in one consolidated pass
- Use sub-agent/coding session for code-heavy work
- Return with a single review checklist instead of piecemeal updates

## Architecture Context
- Company file browser bug was fixed by resolving `workspace_root` from the orchestration DB
- Company agents now register to personal workspaces at `~/.openclaw/workspaces/<company>/agents/<agent-slug>/`
- Mission Control core and Panely boundaries were recently clarified and should stay clean
- Repo cleanup should happen alongside visible UI work, not as a separate forgotten task

## Batch Scope

### 1) Company settings / company management
- Make company profile fields editable where appropriate (at minimum display name; likely description/mission too)
- Do **not** casually auto-mutate slug when display name changes
- Treat slug changes as a separate guarded/advanced action if implemented at all
- Protect the core company from destructive deletion in the UI
- Ensure protections prevent accidental deletion of the main company/workspace/Henry context

### 2) Projects page / orchestration surface
- Hide zero-count badges in the project list by default
- Rename the right-side page/surface from its current wording to either `Orchestration` or `Project Orchestration`
- Normalize colors to the brown/amber Mission Control theme
- Treat the cramped lower kanban area as provisional; simplify or de-emphasize if needed

### 3) Inbox page
- Normalize entire surface to brown/amber theme
- Simplify/reframe the page so it does not awkwardly pretend to be Paperclip’s inbox if it is not
- Stabilize first; deeper product-direction decision can come later

### 4) Team + Org pages
- Normalize colors to brown/amber theme
- Stabilize visual quality now
- Do not overbuild full Paperclip parity yet; likely deeper rework later

### 5) Custom icons
- Add customizable icon support for agents
- Add customizable icon support for projects
- Prefer company-scoped configuration
- Goal is better differentiation instead of every item using the same default icon

### 6) Left rail / layout polish
- Eliminate the dead dark space at the bottom-left of the nav area
- Either extend the left rail cleanly to the bottom or make the bottom row span fully across to the left
- Remove the visually awkward “wasted corner” effect

### 7) Repo cleanup / boundary cleanup
- Clean up touched files while implementing this batch
- Keep MC/Panely boundaries clean
- Avoid random unrelated churn, but do pay down mess directly adjacent to the edits

## Expected Review Checklist
- [ ] Company settings: editable profile + protected core company
- [ ] Projects page: hidden zero badges + renamed/rethemed orchestration panel
- [ ] Inbox: brown/amber theme cleanup
- [ ] Team page: color cleanup / stabilization
- [ ] Org page: color cleanup / stabilization
- [ ] Custom icons: agents + projects
- [ ] Left-rail bottom-gap fix
- [ ] Repo cleanup / boundary cleanup tied to touched files

## Review URLs
- `/companies/neveridle-core/settings`
- `/companies/neveridle-core/team`
- `/companies/neveridle-core/org`
- Projects surface in main nav
- Inbox surface in main nav

## Notes
- This document is the implementation contract for tonight’s batch.
- Follow-up tweaks should be collected into a second batch after Tim reviews the first pass.
