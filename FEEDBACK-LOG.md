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
- [x] Mission Control "M" logo needs left padding — butted against sidebar
- [ ] Card description text centering is off — should center within each card, not whole section
- [ ] "Human Input" → rename to something better (not "CEO Directives" either — workshop this)
- [ ] Add floating agent cards with avatars + specialties as visual showcase for new users
- [ ] Overall empty state could be more inviting/engaging

## PDF Export
- [x] **White background for print** — dark theme is unusable for printing (runs out of ink)
- [ ] Strip all markdown artifacts (`=`, `>`, `#` rendering as weird symbols)
- [ ] Fix `¡` characters appearing before headings (encoding issue from markdown stripping)
- [ ] Clean typography, professional report look
- [ ] Should be something you'd actually hand to a client

## Modal/Wizard Bugs
- [ ] Drag-selecting text in textarea can close the modal (fixed partially — needs verification)
- [ ] Double-click in wizard textarea causes navigation back (reported but may still exist)

## Session Header (Active Sessions)
- [ ] Too many buttons crammed together (Resume, End, Copy, Export, PDF)
- [ ] **PDF/Export/Copy should be DISABLED during active sessions** — gray them out until session completes
- [ ] New sessions shouldn't start paused — shouldn't need to hit Resume immediately after launch
- [ ] Simplify header: only show Resume/Pause + End during active sessions, show export buttons after completion

## Right Sidebar
- [ ] **Remove the Legend section** — wastes space, not useful
- [ ] Keep Participants and Session Info, trim everything else
- [ ] "Mark Complete" and "Archive to Memory" buttons are fine

## Templates
- [ ] Consider hiding behind a "Browse templates" link or removing entirely
- [ ] They take up too much prime real estate in the wizard
- [ ] Example prompts in textarea placeholder may be more useful than template cards

## Per-Agent Model Selection
- [ ] Allow overriding the session model on a per-agent basis
- [ ] Default shows "Using session default" badge on each agent card
- [ ] Click to override: small dropdown right on the agent card

## Overlay/Persona Selection UX
- [ ] Clicking agent should show FULL overlay catalog (all 20-30+ available)
- [ ] Each overlay needs a one-sentence description, not just title
- [ ] Allow up to 2 overlays per agent max
- [ ] Should be additive (adding expertise), not subtractive
- [ ] Source from Agency Agents library (118 personas available)

## Roundtable Mode — Critical Feedback from Live Testing
- [x] **Don't label agents as "WORKER" in roundtable mode** — that's only for review mode. In roundtable they're just participants/advisors
- [ ] **Manual pacing should show ONE agent at a time, not a whole round** — click Next → one agent responds → you read it → click Next → next agent responds. Currently it fires all agents in a round at once, skipping past the human
- [ ] **Auto-advance toggle matters here too** — if they want all agents to fire at once per round, that's the auto-continue toggle. Manual = one at a time
- [ ] **Human needs a chance to participate between each agent** — currently the round just blasts through without letting the user jump in
- [ ] **The conversation content was actually great** — Tim said "absolutely fascinating" and the agents were debating properly (Scout referencing Quant's points, etc.)
- [ ] **Three agents went without user getting a chance to hit Next** — inconsistent behavior, sometimes one-at-a-time, sometimes batch

## End Session UX
- [ ] When user hits End, immediately hide the "Agents deliberating..." indicator
- [x] Show clear state: "Session ending — Henry is writing final synthesis..."
- [x] Disable the End button after first click (no double-tap confusion)
- [ ] Once synthesis is complete, show "Session Complete" banner clearly
- [ ] Export/Copy/PDF buttons should only become active AFTER session completes

## Round Tracking
- [ ] Show "Round 2 of 3" indicator somewhere visible (header or between rounds as divider)
- [ ] Without this, users lose track of where they are in the conversation

## Waiting/Loading States
- [ ] When waiting for API response after hitting Next Turn, show "Connecting to AI..." or "Waiting for response..." immediately
- [ ] Current delay of 15-20 seconds with no feedback feels broken

## General UI
- [ ] Dashboard: old cached versions keep showing (port conflicts, zombie processes)
- [ ] Consider hiding right sidebar entirely in Review Loop mode
- [ ] Breadcrumbs and header standardization (partially done)

---
*This list should be used as the task input for a Review Loop session to fix everything.*
