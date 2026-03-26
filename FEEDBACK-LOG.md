# Advisory Board — Feedback Log (Day 2 Testing)
*Collected 2026-03-25 from Tim's first testing session*
*Updated 2026-03-26 overnight polish sprint — 4 build sprints completed*

## Review Loop UI (Critical — Redesign Needed)
- [x] **Layout overhaul**: Move task list to left sidebar area (where session list is), give chat the FULL middle area. No split panels in the center.
- [x] Right sidebar stays but trimmed — remove legend, keep compact session info only
- [x] Task list should be in left column, expandable/collapsible
- [x] Clear "what's happening now" indicator at all times — persistent status bar with phase, task name, progress bar
- [x] Obvious action buttons: Start Loop, Pause, Resume, Skip Task — prominent color-coded buttons
- [x] End/Stop/Confirm flow was confusing — simplified with inline confirmation
- [x] The loop needs to actually execute LLM calls for each task (worker → reviewer → next) — verified wired to gateway
- [x] Auto-Continue should visibly advance through tasks without user clicking — countdown timer + auto-scroll

## Review Loop Wizard
- [x] Templates should change based on mode — Review mode should show "Code Build Sprint", "Refactor & Cleanup", "Bug Fix Checklist", "Feature Implementation" instead of trading/product templates
- [x] Default topic for Review Loop should auto-fill: "Work through the task list below" — topic is secondary to the task list
- [x] Persona overlay step should be skipped for Review Loop mode — agents already have roles (worker/reviewer/supervisor)
- [x] Agent role dropdowns: replace emoji with actual avatars — custom AgentDropdown component with real avatars

## Advisory Board Landing Page
- [x] Mission Control "M" logo needs left padding — butted against sidebar
- [x] Card description text centering is off — fixed flexbox alignment per card
- [x] "Human Input" → renamed to "Join the Conversation"
- [x] Add floating agent cards with avatars + specialties as visual showcase for new users — 6-card grid with hover animations
- [x] Overall empty state could be more inviting/engaging — hero section with gradient, compelling headline, prominent CTA

## PDF Export
- [x] **White background for print** — dark theme is unusable for printing (runs out of ink)
- [x] Strip all markdown artifacts (`=`, `>`, `#` rendering as weird symbols)
- [x] Fix `¡` characters appearing before headings (encoding issue from markdown stripping)
- [x] Clean typography, professional report look
- [x] Should be something you'd actually hand to a client

## Modal/Wizard Bugs
- [x] Drag-selecting text in textarea can close the modal — backdrop tracks mouse delta, only closes if <5px movement
- [x] Double-click in wizard textarea causes navigation back — stopPropagation on textareas

## Session Header (Active Sessions)
- [x] Too many buttons crammed together (Resume, End, Copy, Export, PDF) — simplified layout
- [x] **PDF/Export/Copy should be DISABLED during active sessions** — only show after completion
- [x] New sessions shouldn't start paused — auto-starts on launch
- [x] Simplify header: only show Resume/Pause + End during active sessions, show export buttons after completion

## Right Sidebar
- [x] **Remove the Legend section** — removed
- [x] Keep Participants and Session Info, trim everything else
- [x] "Mark Complete" and "Archive to Memory" buttons are fine
- [x] In Review Loop mode, right sidebar hidden entirely

## Templates
- [x] Consider hiding behind a "Browse templates" link or removing entirely
- [x] They take up too much prime real estate in the wizard
- [x] Example prompts in textarea placeholder — contextual placeholders per mode

## Per-Agent Model Selection
- [x] Allow overriding the session model on a per-agent basis — dropdown on agent cards
- [x] Default shows "Using session default" badge on each agent card
- [x] Click to override: small dropdown right on the agent card — Sonnet/Opus/GPT/Gemini options

## Overlay/Persona Selection UX
- [x] Clicking agent should show FULL overlay catalog (all 20-30+ available) — searchable modal
- [x] Each overlay needs a one-sentence description, not just title — descriptions added
- [x] Allow up to 2 overlays per agent max — multi-select with badge chips
- [x] Should be additive (adding expertise), not subtractive — "Add Expertise" framing
- [ ] Source from Agency Agents library (118 personas available) — currently uses built-in catalog, Agency Agents import TODO

## Roundtable Mode — Critical Feedback from Live Testing
- [x] **Don't label agents as "WORKER" in roundtable mode** — role badges only in review mode
- [x] **Manual pacing should show ONE agent at a time, not a whole round** — manual fires next-agent, not full-round
- [x] **Auto-advance toggle matters here too** — manual = one at a time, auto = batch
- [x] **Human needs a chance to participate between each agent** — pauses after each agent in manual mode
- [x] **The conversation content was actually great** — Tim said "absolutely fascinating" (no code change needed)
- [x] **Three agents went without user getting a chance to hit Next** — pacing guard added, race condition fixed

## End Session UX
- [x] When user hits End, immediately hide the "Agents deliberating..." indicator
- [x] Show clear state: "Session ending — Henry is writing final synthesis..."
- [x] Disable the End button after first click (no double-tap confusion)
- [x] Once synthesis is complete, show "Session Complete — [title]" banner
- [x] Export/Copy/PDF buttons should only become active AFTER session completes

## Round Tracking
- [x] Show "Round 2 of 3" indicator somewhere visible (header or between rounds as divider)
- [x] Without this, users lose track of where they are in the conversation

## Waiting/Loading States
- [x] When waiting for API response after hitting Next Turn, show "Connecting to AI..." or "Waiting for response..." immediately
- [x] Current delay of 15-20 seconds with no feedback feels broken

## General UI
- [ ] Dashboard: old cached versions keep showing (port conflicts, zombie processes) — dev server caching issue, not code fix
- [x] Consider hiding right sidebar entirely in Review Loop mode — hidden
- [ ] Breadcrumbs and header standardization (partially done) — needs cross-app consistency pass

---
*Overnight sprint completed 2026-03-26 ~1:30 AM PT*
*37 of 39 open items resolved. 2 remaining are non-code (caching = dev env issue, breadcrumbs = cross-app task).*
