# Run Intelligence Slice 1: Run Trace v1 Implementation Plan

> Status: Draft for approval
> Last updated: 2026-06-06

This plan turns the Run Intelligence strategy into the first implementable slice:
Run Trace v1.

The goal is to make one execution run inspectable from the task context before
building evals, templates, Improve, MCP, or experiments.

## Operating Rule

Stable `3001` is the control lane for operator oversight, Overseer review,
board monitoring, and approvals.

Implementation and verification must run on `3010` or another isolated dev
lane. Implementation tasks must explicitly say:

> Do not edit `.stable`. Do not run implementation verification against the
> stable `3001` lane.

## Current Code Findings

The existing code already has the core raw material for Run Trace v1.

Useful existing surfaces:

- `src/app/api/orchestration/engine/runs/[runId]/events/route.ts`
  - Returns run metadata, task context, timeline, transcript entries, provider
    presentation, invocation provenance, metrics, resolved execution context,
    workspace run visibility, skill effectiveness, and memory evidence.
- `src/app/(dashboard)/companies/[slug]/agents/[agentId]/runs/[runId]/page.tsx`
  - Already renders a rich run detail page from the run events API.
- `src/app/(dashboard)/companies/[slug]/tasks/[taskKey]/page.tsx`
  - Activity tab already fetches linked execution run IDs and renders an inline
    `ExecutionHistoryPanel`.
- `src/lib/orchestration/route-paths.ts`
  - Has canonical company and agent-run path helpers, but no task-contextual run
    trace helper yet.
- `src/lib/orchestration/db.ts`
  - `execution_runs`, `execution_run_transcript_events`, and `cost_events`
    already exist.
- `src/lib/__tests__/orchestration-engine-run-events-route.test.ts`
  - Covers part of the run events API, especially memory diagnostics behavior.

Important implication:

Run Trace v1 should reuse and extract the existing agent run detail work instead
of rebuilding a separate trace viewer.

## Product Scope

Slice 1 should deliver:

- task-contextual run trace route
- shared `RunTraceView`
- compact task Activity execution history with Open Trace actions
- capture-quality labels
- evidence-gap labels
- deterministic redacted trace export basics
- lightweight trace annotations
- reuse or replacement path for agent run detail
- focused route/API/UI tests
- runner contract docs update for optional trace fields

Slice 1 should not deliver:

- eval cases
- scorecards
- workflow graph visualization
- cross-run comparison
- Improvement recommendations
- MCP server
- experiment loops
- full diff/code-review UI
- a new distributed tracing database

## Recommended Architecture

Use the existing run events API as the initial source of truth, but introduce a
shared Run Trace composition layer so UI behavior is not scattered across task
detail and agent run pages.

Recommended implementation shape:

- `src/lib/orchestration/run-trace.ts`
  - shared trace view-model types and derivation helpers
  - capture-quality derivation
  - evidence-gap derivation
  - normalized event taxonomy mapping
  - redaction summary helpers
- `src/components/run-trace/RunTraceView.tsx`
  - shared view used by task-contextual route and agent run detail route
- `src/components/run-trace/TraceExportControls.tsx`
  - copy trace summary, copy run ID, download redacted JSON
- `src/components/run-trace/TraceAnnotations.tsx`
  - lightweight evidence notes and marked timeline moments
- `src/lib/orchestration/route-paths.ts`
  - add task-contextual and run-global trace path helpers

The exact module names can change if the implementation lead finds a stronger
local pattern, but the key rule is:

> One shared trace view, not another duplicate run detail surface.

## Likely Data And API Changes

The first pass should avoid a new `traces` table.

Small schema/API additions are likely acceptable for:

- trace annotations, because there is no clear existing trace annotation model
- stable export metadata if needed
- capture-quality or evidence-gap fields if they are easier to compute server
  side

Suggested annotation persistence:

- `execution_run_annotations`
  - id
  - execution_run_id
  - company_id
  - task_id nullable
  - timeline_event_id nullable
  - body
  - marker_type: note, important
  - created_by
  - created_at
  - updated_at

The implementation lead should confirm whether this table is necessary during
the Slice 1 plan review. If annotations can reuse an existing compact evidence
marker system cleanly, prefer that.

Recommended API behavior:

- keep `/api/orchestration/engine/runs/:runId/events` as the base evidence
  endpoint
- extend it only with fields needed by `RunTraceView`
- add a redacted export endpoint only if client-side export would duplicate too
  much redaction logic
- keep full raw export behind a later explicit confirmation flow

## Route Plan

Canonical task-contextual route:

```text
/:companyCode/tasks/:taskKey/runs/:runId
```

Run-global fallback:

```text
/:companyCode/runs/:runId
```

Legacy/dashboard implementation routes can redirect or render the same shared
view:

```text
/companies/:slug/tasks/:taskKey/runs/:runId
/companies/:slug/runs/:runId
/companies/:slug/agents/:agentId/runs/:runId
```

Agent run pages should link to the canonical trace route when task context is
known. When task context is missing or archived, they can link to the run-global
fallback.

## UI Plan

`RunTraceView` should lead with chronology and keep summaries supportive.

Recommended layout:

- header
  - task, run ID, status, agent, runner, provider, model, timing
  - capture-quality label
  - copy run ID and copy summary actions
- timeline
  - normalized events in chronological order
  - expandable raw/source metadata where available
  - evidence-gap labels where data is missing
- supporting panels
  - result summary
  - usage and cost
  - workspace visibility
  - artifacts and evidence
  - memory evidence
  - skill effectiveness
  - review state
  - provenance and redaction summary
- annotation controls
  - add note to trace
  - mark timeline event as important

Task Activity should keep compact run summaries and show an Open Trace action.
It should not keep expanding into a full run-inspection surface after the trace
route exists.

## Redaction Plan

Redaction should be deterministic and structure-preserving.

Minimum redaction categories:

- bearer tokens
- common API-key-shaped values
- env-var-shaped fields containing key, token, secret, or password
- obvious private credential values in raw payloads

Exports should include:

- trace summary
- run identity
- task identity
- normalized timeline
- usage/cost summary
- evidence gaps
- capture quality
- annotations
- redaction summary with counts by category

Export should exclude or redact:

- raw secrets
- unredacted environment values
- unredacted provider payloads
- full raw payload download unless explicitly added later

## Capture Quality And Evidence Gap Plan

Capture quality describes evidence capture, not agent quality.

Initial capture-quality derivation:

- `complete`: expected categories for the runner capability set are present
- `partial`: useful evidence exists but expected categories are missing
- `minimal`: only run status/result metadata is available
- `failed`: trace capture failed or is unusable

Initial evidence-gap labels:

- `not_captured`
- `not_available`
- `capture_failed`

The API or view-model layer should produce explicit labels for missing cost,
missing transcript, missing raw payload, missing memory evidence, missing
workspace visibility, and manual/minimal runner cases.

## Task Breakdown Draft

These are planning task groups, not implementation tasks yet.

1. Run Trace impact review
   - inspect call sites for run events API, agent run detail, task Activity,
     route helpers, and tests
   - decide exact schema/API additions
2. Trace view model
   - create shared trace types and derivation helpers
   - normalize timeline event categories
   - derive capture-quality and evidence-gap labels
3. Shared trace UI
   - extract/rebuild the existing agent run detail page into `RunTraceView`
   - preserve current provider, metrics, transcript, memory, workspace, and
     skill-effectiveness information
4. Canonical routes
   - add task-contextual trace route
   - add run-global fallback route
   - add route path helpers
   - redirect or reuse existing agent run detail route
5. Task Activity integration
   - add Open Trace actions to execution history
   - collapse inline execution history toward compact summaries
6. Export and redaction
   - add redacted JSON export or client-side redacted download
   - add copy summary and copy run ID
   - add redaction tests
7. Trace annotations
   - add persistence if needed
   - add UI for trace note and important timeline marker
   - include annotations in redacted export
8. Verification and docs
   - update runner contract docs
   - test completed, failed, cancelled, running, minimal/manual traces
   - browser-check task-contextual route on `3010`

## Focused Verification

Recommended automated checks:

- existing run events route test
- new run trace view-model tests
- new route helper tests
- redaction unit tests
- annotation persistence tests if a table is added
- task detail focused tests if route links are covered there

Recommended browser checks on the dev lane:

- open a task with a completed run and click Open Trace
- open a task with a failed or returned run and inspect evidence gaps
- open an agent run and confirm it reuses or links to the canonical trace
- verify redacted export does not expose obvious secret patterns
- verify trace annotations persist after refresh

## Exit Criteria

Slice 1 is done when:

- every execution run reachable from task Activity can open Run Trace
- the trace route is task-contextual when possible
- agent run detail no longer owns a separate canonical inspection surface
- capture quality and evidence gaps are visible
- redacted export basics work
- trace annotations work or are explicitly deferred with a reason
- old inline execution history is compact and points to Run Trace
- focused tests pass
- browser smoke verification passes on `3010`
- stable `3001` can monitor the work without being edited by the work

## Approval Question

Before implementation tasks are created, the operator should approve or revise:

- whether annotations require the proposed `execution_run_annotations` table
- whether redacted export should be server-side or client-side in v1
- whether the agent run detail route should redirect to the task-contextual
  trace when task context exists, or render the shared view in place

Recommended answers:

- Add a small annotation table if no existing evidence marker system fits.
- Prefer server-side redacted export if raw provider payloads are included.
- Render the shared view in both routes first, then redirect agent run detail
  later if that proves cleaner.
