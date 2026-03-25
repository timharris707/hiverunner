# Advisory Board — Feedback Log (Day 2 Testing)
*Collected 2026-03-25 from Tim's first testing session*

## Review Loop UI (Critical — Redesign Needed)
- [ ] **Layout overhaul**: Move task list to left sidebar area (where session list is), give chat the FULL middle area. No split panels in the center.
- [ ] Right sidebar stays but trimmed — remove legend, keep compact session info only
- [ ] Task list should be in left column, expandable/collapsible
- [ ] Clear "what's happening now" indicator at all times
- [ ] Obvious action buttons: Start Loop, Pause, Resume, Skip Task
- [ ] End/Stop/Confirm flow was confusing — simplify
- [ ] The loop needs to actually execute LLM calls for each task (worker → reviewer → next)
- [ ] Auto-Continue should visibly advance through tasks without user clicking

## Review Loop Wizard
- [ ] Templates should change based on mode — Review mode should show "Code Build Sprint", "Refactor & Cleanup", "Bug Fix Checklist", "Feature Implementation" instead of trading/product templates
- [ ] Default topic for Review Loop should auto-fill: "Work through the task list below" — topic is secondary to the task list
- [ ] Persona overlay step should be skipped for Review Loop mode — agents already have roles (worker/reviewer/supervisor)
- [ ] Agent role dropdowns: replace emoji with actual avatars (needs custom dropdown component, not native `<select>`)

## Advisory Board Landing Page
- [ ] Mission Control "M" logo needs left padding — butted against sidebar
- [ ] Card description text centering is off — should center within each card, not whole section
- [ ] "Human Input" → rename to something better (not "CEO Directives" either — workshop this)
- [ ] Add floating agent cards with avatars + specialties as visual showcase for new users
- [ ] Overall empty state could be more inviting/engaging

## PDF Export
- [ ] **White background for print** — dark theme is unusable for printing (runs out of ink)
- [ ] Strip all markdown artifacts (`=`, `>`, `#` rendering as weird symbols)
- [ ] Fix `¡` characters appearing before headings (encoding issue from markdown stripping)
- [ ] Clean typography, professional report look
- [ ] Should be something you'd actually hand to a client

## Modal/Wizard Bugs
- [ ] Drag-selecting text in textarea can close the modal (fixed partially — needs verification)
- [ ] Double-click in wizard textarea causes navigation back (reported but may still exist)

## General UI
- [ ] Dashboard: old cached versions keep showing (port conflicts, zombie processes)
- [ ] Consider hiding right sidebar entirely in Review Loop mode
- [ ] Breadcrumbs and header standardization (partially done)

---
*This list should be used as the task input for a Review Loop session to fix everything.*
