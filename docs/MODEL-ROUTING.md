# Model Routing Policy

_Last updated: 2026-03-27_

## Why this exists

We do not want a monoculture where every task gets shoved through the same provider/model.
HiveRunner should route work based on the kind of job being done, not habit.

## Routing policy

### Opus 4.6
Use for:
- high-stakes architecture decisions
- P0 / security / auth / payments
- nuanced synthesis and final judgment
- critical strategy where quality matters more than speed

### GPT 5.4
Use for:
- default coding work in the factory
- implementation sprints
- refactors
- test-fix loops
- UI polish and build/reconcile/retry plumbing

This is the **coding workhorse** lane.

### Sonnet 4.6
Use for:
- fast product thinking
- orchestration chatter
- routine non-critical execution
- planning / workflow / persona / session tasks where speed matters

### Haiku 3.5
Use for:
- simple mechanical chores
- boilerplate
- docs / cleanup / low-risk maintenance

### Gemini Flash / Pro
Use for:
- research-heavy tasks
- search / compare / summarize flows
- broad repo or large-context analysis

## Current HiveRunner wiring

### Smart router
The policy brain for factory tasks lives in:
- `src/lib/llm-router.ts`

### Factory spawn path
The actual build agent selection lives in:
- `src/lib/build-queue.ts`

## Factory behavior

When a task enters the build queue:
1. `llm-router` scores complexity and task type
2. standard coding work routes to **GPT 5.4**
3. high-stakes work routes to **Opus 4.6**
4. low-complexity chores route to **Haiku 3.5**
5. non-coding/product-thinking tasks route to **Sonnet 4.6**
6. research / large-context tasks route to **Gemini** lanes

## Executor note

HiveRunner currently prefers:
- **Codex** for GPT 5.4 coding jobs
- **Claude Code** for Anthropic lanes

If the local Codex CLI is unavailable or not authenticated, the factory falls back to **Claude Code / Sonnet 4.6** instead of silently failing.

That keeps the factory moving while preserving the preferred routing policy.
