# READY-FOR-USE-CHECKLIST.md — Mission Control Cleanup Before Human Use

_This is the punch list NeverIdle Core must clear before saying Mission Control is ready for real human use._

## Reality Check

We completed the orchestration sprints, but that does **not** mean the product is ready for Tim to use cleanly day-to-day.

Current state:
- Core task engine works
- State machine works
- Task board can move work through the pipeline
- But the **human-facing product is still messy / confusing / not production-clean**

This checklist is the standard.

---

## P0 — Must Fix Before We Call It Ready

### 1) Obvious current company context
**Problem:** It is not obvious what company the user is currently operating inside.

**Required fix:**
- Show the active company prominently in the main shell/header
- Include company name + prefix (example: `NeverIdle Core · NEVA`)
- Make company context visible on every page where company-scoped data appears
- If switching companies is possible, make the active selection explicit

**Why this matters:**
The system feels disorienting without a clear tenant / workspace identity.

---

### 2) Companies page cleanup
**Problem:** Companies page shows junk / tests / archived noise instead of a clean, trustworthy list.

**Required fix:**
- Hide archived companies by default
- Hide test/demo/shell companies by default
- Add explicit filters/toggles if archived companies need to be viewable
- Make the page readable to a human who didn’t build the backend
- Reduce the list to legitimate companies only unless user asks for more

**Known bad examples observed:**
- `TestCo`
- dead shell company / earlier NeverIdle setup (`NEV`)

---

### 3) First-run product clarity
**Problem:** A human can land in the app and not immediately understand where they are, what is real, and what to click.

**Required fix:**
- Clear default landing experience
- Remove ambiguity between test/demo/dev data and real operational data
- Make the app feel intentionally initialized, not like a dev sandbox
- Add empty states that explain what to do next

---

### 4) No stale or misleading status states
**Problem:** We already saw a sprint parent remain `in_progress` after all subtasks were done. That creates false operational signals.

**Required fix:**
- Parent tasks/goals should close when all child tasks are done
- No lingering `todo` / `in_progress` / `review` states after work is complete
- Eliminate stale workflow states that make Henry or Tim think work is still active
- Add reliable rollup behavior or explicit closure workflow

---

### 5) No test junk visible in live surfaces
**Problem:** Test tickets, contract tests, smoke tests, chaos tasks, debug junk, etc. polluted the board and damaged trust immediately.

**Required fix:**
- Test/dev tasks must never appear in the live operational board by default
- Create a separate test/dev namespace, project, environment, or hidden mode
- Human-facing board must only show real work unless explicitly toggled
- Add guardrails so future test runs can’t dirty the real board again

---

### 6) Clear definition of what counts as “ready”
**Problem:** We treated “feature-complete enough for a sprint demo” as “ready for Tim to use.” Those are not the same thing.

**Required fix:**
- Add a release checklist / readiness gate
- Require human-UX validation before declaring ready
- Require cleanup of seeded/test/demo data before handoff
- Require explicit signoff on first-run experience

---

## P1 — Strongly Needed for Trustworthy Use

### 7) Better empty states and guidance
When the board is empty or a page has no real data, the UI should explain:
- what this page is for
- whether this is expected
- what the next action should be

---

### 8) Distinguish real data from archived/historical/dev data
Need visible labels or filters for:
- active vs archived
- production vs test/dev
- live task board vs historical artifacts

---

### 9) Better company switching model
If Mission Control is multi-company, the UX needs to make that obvious:
- what company is active
- whether views are global or company-scoped
- what changes when you switch companies

---

### 10) Human usability pass, not just engineering completion
We need a dedicated pass for:
- clarity
- naming
- defaults
- information hierarchy
- trustworthiness
- “could Tim use this cold without asking questions?”

---

## Proposed Acceptance Standard

Mission Control is only “ready for real use” when:

- Tim can open it and instantly know what company he is in
- Companies page contains only meaningful entries by default
- No visible test junk exists on live surfaces
- Task statuses reflect reality without stale leftovers
- Empty states and defaults are understandable
- The app feels like a product, not a dev environment

---

## Suggested Next Move

Run **one more cleanup / production-readiness sprint** in NeverIdle Core focused on:
1. company context clarity
2. company page cleanup
3. dev/test data segregation
4. stale workflow state cleanup
5. first-run UX polish
6. readiness gate definition

This should be framed as:
**“Production Readiness / Human Trust Sprint”**
not another feature sprint.

---

_Last updated: 2026-04-01_
