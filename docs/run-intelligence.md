# Run Intelligence

> Status: Draft strategy
> Last updated: 2026-06-06

Run Intelligence is HiveRunner's product pillar for making agent work inspectable,
reviewable, comparable, and improvable across runs, tasks, sprints, and runners.

The strategic boundary is explicit: HiveRunner should not become a general agent
application framework. HiveRunner should operate, observe, review, and improve
agent work that happens through local-first execution lanes and runner
contracts.

## Product Rule

HiveRunner does not build agents for users; HiveRunner operates agent work.

The canonical loop remains:

```text
goal -> sprint -> task -> run -> evidence -> review -> memory/eval
```

## First Slice: Run Trace

Run Trace is the first Run Intelligence slice.

Run Trace is the chronological record of one agent run, used to inspect what the
runner received, what happened during execution, what evidence was produced, and
how the work was reviewed.

The first version should be an inspection surface over existing HiveRunner
execution data, not a new tracing substrate.

## Run Trace v1 Scope

Run Trace v1 includes:

- run identity: task, agent, runner, provider, model, status, and timestamps
- runner input: task prompt and handoff payload summary
- transcript events: assistant, tool, stdout, stderr, and status events already captured
- result summary: final assistant output and run result
- usage: duration, token totals, token breakdown, cost, cost source, and
  confidence when available
- workspace change evidence when already captured
- artifacts, evidence, and comments created by the run
- review state: whether the task moved to review, was accepted, was returned, or needs operator action

Run Trace v1 covers every execution run status:

- `pending`: claimed or queued state and handoff readiness where available
- `running`: partial transcript and in-progress events where available, labeled
  as partial trace evidence
- `completed`: result, evidence, review state, usage, and cost
- `failed`: error class, error message, stderr, tool output, and transcript before failure
- `cancelled`: cancellation reason, timing, and any partial output

Run Trace v1 excludes:

- distributed tracing architecture
- OpenTelemetry adoption
- ClickHouse or a separate trace database
- automatic scorer or eval engine
- cross-run comparison UI
- generic workflow graph
- optimization analytics
- full code-review or diff UI

The v1 product promise is:

> For any run, an operator can reconstruct what happened well enough to review it,
> debug it, or decide the next action.

Run Trace should explain one run's usage. Improvement Experiments should compare
efficiency across alternatives.

Run Trace should show workspace change evidence when available, including dirty
state before and after the run, files changed during the run, read-only intent
warnings, and links to paths where available. It should not become a full diff
viewer, code-review UI, patch application surface, or automatic revert tool.

Run Trace should be available while a run is still running when events exist.
Live updates can be best-effort and may use polling before richer streaming.
Export/download actions should be disabled or clearly labeled partial until the
run reaches a terminal state.

The product rule is:

> Running traces are partial evidence; terminal traces are review evidence.

## Run Trace v1 Source Of Truth

`execution_runs` remains the canonical source of truth for a run in v1. Run Trace
assembles an operator-facing view from existing HiveRunner records instead of
introducing a competing trace identity.

Attached evidence should be read from the records HiveRunner already owns:

- `execution_runs` for run identity, lifecycle, runner/provider/model fields, duration, and token metadata
- `execution_run_transcript_events` for chronological execution narrative
- `cost_events` for billing and usage evidence linked to a run
- task comments and task events for user-visible work activity
- task review state for acceptance, return, and operator action status
- memory receipts for context supplied to or used by the run
- artifacts and goal-contract evidence where available

Run Trace v1 should not add a new `traces` table. If a normalized span model is
needed later, add it after the inspection UI proves which operator questions the
existing records cannot answer.

Run Trace v1 should use the existing run events API before introducing a
parallel trace API:

```text
/api/orchestration/engine/runs/:runId/events
```

That endpoint already supports heartbeat and execution runs and returns run
metadata, task context, timeline, transcript, provider information, skill
effectiveness, memory evidence, workspace visibility, and provenance.

Missing fields should be added only where v1 needs them. If the response shape
becomes overloaded later, HiveRunner can add a dedicated trace endpoint or
service wrapper.

Slice 1 schema decisions should be left to the implementation lead during build
planning. The default posture is to compose existing run evidence first, but
focused schema or API additions are acceptable when the implementation review
finds they are necessary for capture quality, export metadata, evidence gaps, or
stable trace routing.

The product rule is:

> Run Trace v1 should compose existing run events data before introducing a
> parallel trace API.

> Schema changes are allowed when implementation review proves they are needed;
> avoid creating a separate trace persistence system by default.

## Run Trace v1 Product Placement

Run Trace v1 belongs in Task Detail first, not in a standalone global
observability section.

The operator starts from the task being reviewed:

- Task Detail continues to own the review and activity surface.
- Activity remains the task-level timeline and entry point.
- Execution history in Activity shows compact run summaries.
- Each execution run listed on a task exposes an Open Trace action.
- The Trace view shows one run's timeline and evidence on a dedicated run-level surface.
- If a task has multiple runs, the operator can switch between those runs.

Run Trace should become the canonical replacement for fragmented run-inspection
UI. It should absorb or share implementation with today's expanded execution
history details, agent run detail UI, transcript snippets, memory evidence,
route attempts, usage panels, and other run-level inspection fragments.

Run Trace should not replace Comments, Subtasks, or the task-level Activity
timeline.

Task Activity should record Run Intelligence events from that task, including
"saved run as eval case" and "Improvement recommendation created, applied, or
dismissed." Activity entries should stay compact and link to the Run Trace, eval
case, recommendation, or approval detail instead of duplicating the specialized
surface.

The canonical Run Trace route should be task-contextual when possible:

```text
/:companyCode/tasks/:taskKey/runs/:runId
```

Example:

```text
/INS/tasks/INS-185/runs/<runId>
```

Agent run pages should link to or reuse the same Run Trace surface instead of
owning a separate canonical run-inspection route. A run-global fallback route can
exist for runs without task context or with archived task context:

```text
/:companyCode/runs/:runId
```

A later Run Intelligence area can aggregate across runs, agents, runners, and
sprints after the task-level inspection flow is useful.

Goal and sprint pages should roll up Run Intelligence without becoming the full
queue or library. They should show counts and notable items such as saved eval
cases, unresolved high or critical Improvement recommendations, applied
improvements, and recurring patterns. Full management remains in the Eval Library
and Improvement Queue.

The product rule is:

> Run Trace replaces fragmented run-inspection UI; Activity remains the
> task-level timeline and launch point.

> Task Activity records what happened; detail lives in the specialized surface.

> Goals and sprints summarize Run Intelligence; queues manage it.

> Run Trace is task-contextual when possible; run-global only when necessary.

Run Trace implementation should create the canonical surface before pruning old
run-inspection UI.

Implementation sequence:

1. Add the canonical task-contextual run trace route.
2. Build a shared `RunTraceView` from the existing run events API.
3. Add Open Trace links from Activity execution history.
4. Add capture-quality labels and evidence-gap labels.
5. Add redacted export basics.
6. Reduce inline execution history details to compact summaries.
7. Reuse or replace the agent run detail UI with `RunTraceView`.
8. Expand trace schema and runner capability reporting over time.

The product rule is:

> Create the canonical trace surface before pruning old run-inspection UI.

> Trace first, eval capture second, library third.

Run Trace v1 should present chronology first, with summaries supporting review.

Recommended layout:

- header: run identity, status, agent, runner, model, and timing
- primary timeline: normalized events in order
- supporting summaries: result, usage/cost, artifacts/evidence, memory touched,
  review outcome, and redacted raw data
- action: save as eval case when the run has a review outcome or enough review
  context

The product rule is:

> Chronology is primary; summaries support review.

> Trace review should flow directly into eval capture.

## Run Trace v1 Timeline Model

Run Trace v1 should present a normalized HiveRunner timeline, not raw provider
event names as the primary UI model. Provider-specific event names and payloads
can remain available in metadata or an expandable raw view.

The v1 timeline event taxonomy is:

- `handoff`: HiveRunner prepared or sent work to a runner
- `runner_status`: queued, started, heartbeat, completed, failed, or cancelled
- `message`: assistant or model output
- `tool`: tool call or tool result
- `process_io`: stdout, stderr, or process output
- `action`: parsed `mc-action` or runner-requested HiveRunner mutation
- `artifact`: file, evidence, or output attachment
- `usage`: token, duration, or cost update
- `memory`: context supplied, cited, or saved
- `review`: review handoff, acceptance, return, or notes

This taxonomy is the operator-facing vocabulary for traces across Codex, Claude
Code, Gemini, HERMES, OpenClaw, and future external runners.

## Run Trace v1 Detail Disclosure

Run Trace is transparent by default and raw by request.

The default view should show the operator-facing prompt, runner identity, model,
status, normalized timeline, result, artifacts, cost, and review state.

Raw internals should sit behind explicit expansion:

- raw stdin payload
- raw transcript metadata
- provider event payloads
- provider-specific response details

Copy and export controls should be explicit. Missing raw data should be labeled
as not captured instead of treated as a run failure.

Basic redaction is required before raw payload expansion ships. Raw views should
redact common secret patterns, bearer tokens, API keys, and env-var-shaped
values whose names include key, token, secret, or password. Redaction should
preserve payload structure for debugging and stay local to the operator's
machine.

Run Trace v1 should include evidence export actions:

- copy trace summary
- copy run ID
- download redacted trace JSON

A full raw trace download can come later behind explicit confirmation. Exports
and MCP-exposed trace resources should include provenance and evidence-gap
labels so missing data remains clear.

The internal UI can show richer local detail to the operator, but any downloaded
trace JSON, copied shareable summary, or MCP-exposed trace must pass through a
redaction layer and clearly label redacted fields.

Trace redaction should be deterministic and auditable. Redacted payloads should
preserve JSON shape and replace sensitive values with stable field-level markers
such as `[REDACTED:api_key]`, `[REDACTED:bearer_token]`, or
`[REDACTED:secret]`. Exports should include a redaction summary with counts by
category so reviewers can tell what was removed without seeing the secret value.

The product rule is:

> Exports are evidence packages, redacted by default.

> Traces are inspectable by default, shareable only after redaction.

> Redaction should preserve structure and explain what was removed.

## Run Trace v1 Annotations

Run Trace should support lightweight operator annotations. In v1, operators
should be able to add a note to a trace or mark a timeline moment as important
during review. These annotations should be evidence markers that can later inform
eval cases and Improvement recommendations.

Run Trace v1 should not become a full comment thread. Task comments remain the
place for discussion.

The product rule is:

> Trace annotations mark evidence; task comments hold discussion.

## Run Trace v1 Evidence Gaps

Missing or incomplete trace data should be explicit evidence gaps, not generic UI
errors.

Run Trace should distinguish:

- `not_captured`: HiveRunner did not store this data
- `not_available`: the runner or provider does not expose this data
- `capture_failed`: HiveRunner attempted capture and failed

Examples:

- no cost event: Cost not captured for this runner.
- no transcript events: No transcript events were recorded.
- no raw payload: Raw handoff payload was not stored.
- provider error: Capture failed with a safe error message.
- manual runner: Manual run has no automated transcript.

## Runner Trace Capability

Run Trace v1 should not make rich tracing mandatory for every runner. Existing
custom runners that only return text or the current minimal JSON result remain
valid.

The runner contract should instead define optional trace capabilities:

- `transcriptEvents`
- `rawProviderEvents`
- `usage`
- `artifacts`
- `handoffSummary`
- `cancellationReason`
- `failureClass`
- `memoryReceipts`

Bundled runners should progressively emit richer trace data. The UI should make
capture quality visible per run, and runner readiness can later report whether a
runner is trace capable.

Each Run Trace should include a capture-quality summary:

- `complete`: expected trace data was captured for the runner capabilities
- `partial`: useful evidence was captured but some expected categories are
  missing
- `minimal`: only basic result/status evidence is available
- `failed`: trace capture itself failed or is unusable

Capture quality is derived from runner capabilities and evidence actually
captured. It must not be treated as a judgment of the agent's work quality.

Run Trace work should include the runner contract documentation updates needed
to feed the trace surface. This is not a separate SDK slice for the first pass.

Runner contract docs should include:

- optional trace fields
- example transcript events
- capture-quality labels
- missing-data semantics
- sample custom runner output
- artifact, usage, failure, and memory receipt reporting guidance

The product rule is:

> Trace quality describes evidence capture, not work quality.

The product rule is:

> Run Trace includes the runner contract updates needed to feed it.

## Run Trace v1 Memory Boundary

Run Trace v1 includes memory as evidence, not as evaluation.

The trace should show:

- memory or context injected into the run when available
- memory receipts or retrieval metadata when available
- memory candidates produced by the run if already captured
- links back to memory records
- explicit evidence gaps when memory data was not captured or not available

Run Trace v1 should not score memory quality, run memory regression tests, or
provide cross-run memory analytics.

The product rule is:

> Run Trace answers what memory touched this run, not how good the memory system is.

## Run Trace v1 Evidence Boundary

Run Trace v1 includes artifacts and goal-contract evidence as linked evidence,
not as scored success criteria.

The trace should show:

- artifacts created or referenced by the run
- task comments and actions produced by the run
- linked goal-contract evidence if already attached
- whether evidence exists for relevant task or goal criteria
- navigation to the artifact or evidence source

Run Trace v1 should not automatically score goal-contract pass/fail, grade
evidence quality, promote dataset cases, or create eval cases.

The product rule is:

> Run Trace shows the evidence trail; evals judge the evidence.

## Delivery Order

Run Intelligence should be delivered in ordered slices:

1. Run Trace v1
2. Save reviewed run as eval case and Evals library
3. Starter Sprint Templates and Active Crew
4. Improvement Queue and Improvement Review
5. HiveRunner MCP Server
6. Improvement Experiments

Each implementation slice should start with a reviewed implementation plan before
tasks are created. Oracle or the delegated team lead should inspect the current
code, identify whether schema, API, route, UI, or test changes are needed, draft
the plan, and only then create implementation tasks after approval.

Implementation should use separate operator and build lanes. The stable
HiveRunner install on port `3001` should be treated as the operator/control
plane for oversight, plan review, board progress, approvals, and Overseer
monitoring. Actual implementation and verification should run on a separate dev
lane such as port `3010` or another isolated lane so HiveRunner is not editing
the live code directory that is serving the operator UI.

Before starting implementation work, the stable `3001` lane should be promoted
or restarted to the latest approved build so the operator and Overseer are using
the expected UI. If stable is stale, reconcile the current release state before
creating implementation tasks. Dirty working-tree changes must be reviewed and
either committed, intentionally promoted, or deferred before promotion.

The product rule is:

> Each slice starts as a reviewed implementation plan, not immediate task
> generation.

> Use stable 3001 for oversight; use a separate dev lane for implementation.

> Make run evidence inspectable before making it reusable or improvable.

> Evals preserve reviewed evidence; experiments create new comparison evidence.

## Implementation Sequencing

Implementation should proceed from the smallest useful evidence surface to the
more autonomous improvement loops. Each slice should create durable value on its
own and leave the next slice easier to build.

The implementation-plan draft for the first slice lives in
`docs/run-intelligence-slice-1-plan.md`.

Every slice should use the same planning protocol:

1. Draft an implementation plan before creating tasks.
2. Review the plan with the operator and, when delegated, Overseer.
3. Identify data, API, route, UI, runner-contract, and test changes.
4. Create implementation tasks only after the plan is approved.
5. Execute implementation in a dev lane such as `3010`, not in stable `3001`.
6. Promote to stable only after focused verification and operator approval.

For high-blast-radius slices, the implementation lead should run the existing
impact checks before editing. This includes CodeGraph/Fallow where applicable,
direct file reads, import and route searches, and focused tests selected from
the actual touched surfaces.

The product rule is:

> Sequence by evidence maturity: inspect first, save reviewed evidence second,
> recommend changes third, automate comparison last.

> Stable `3001` supervises the work; implementation runs elsewhere.

### Slice 0: Implementation Readiness

Slice 0 is the preflight before Run Intelligence work begins. It does not create
product features; it makes the work lane safe.

Required outcomes:

- stable `3001` is promoted to the latest approved build
- implementation uses `3010` or another isolated dev lane
- tasks explicitly forbid editing `.stable`
- the current worktree is clean or intentionally checkpointed
- the implementation lead knows which project, goal, and board will track the
  work
- the first implementation-plan draft exists before task generation

Exit criteria:

- the operator can use `3001` to monitor the Run Intelligence work
- the dev lane can run the app independently
- the board tasks identify the implementation lane and verification commands

### Slice 1: Run Trace v1

Run Trace v1 is the foundation slice. It should ship before evals, templates,
Improve, MCP, or experiments.

Recommended task groups:

1. Discovery and contract review
   - inspect existing run events endpoint, execution run tables, Activity UI,
     agent run detail UI, task detail surfaces, and usage/cost sources
   - decide whether small schema/API additions are needed for capture quality,
     evidence gaps, annotations, or export metadata
2. Shared trace assembly
   - compose the Run Trace view model from existing run evidence
   - normalize timeline events into the v1 event taxonomy
   - derive capture-quality and evidence-gap labels
3. Canonical route and UI
   - add `/:companyCode/tasks/:taskKey/runs/:runId`
   - add `/:companyCode/runs/:runId` fallback where needed
   - build shared `RunTraceView`
   - add run switching when a task has multiple runs
4. Entry points and consolidation
   - add Open Trace actions from task Activity execution history
   - link agent run pages to the shared trace surface
   - reduce fragmented inline run detail UI after the canonical trace exists
5. Evidence controls
   - add deterministic redacted summary/export basics
   - add copy trace summary and copy run ID
   - add lightweight trace annotations
6. Verification and docs
   - cover completed, failed, cancelled, running, and minimal/manual runs
   - cover redaction, missing-data labels, and route behavior
   - update runner contract docs for optional trace fields

Exit criteria:

- every execution run reachable from a task can open a trace
- traces show chronology, result, usage/cost when available, artifacts,
  review state, memory evidence, capture quality, and evidence gaps
- exports are redacted by default
- old run-inspection fragments either link to or reuse the trace surface
- the implementation lead can show one accepted run, one returned or failed run,
  and one minimal/manual run in the trace UI

### Slice 2: Review-Backed Evals v1

Evals should start only after Run Trace v1 exists because eval cases should
reference trace links, capture quality, redaction, annotations, and evidence
gaps.

Recommended task groups:

1. Eval case data model
   - store immutable reviewed snapshots
   - include source task, source run, trace link, review outcome, reviewer
     rationale, runner/provider/model/agent, template context, capture quality,
     annotations, and redacted snapshot JSON
2. Save as eval case
   - add action from reviewed Run Trace
   - require outcome-specific rationale
   - support accepted, returned, rejected, and blocked cases
3. Evals library
   - add Company navigation item `Evals`
   - list company-wide eval cases
   - add filters for project, task type, template, agent, runner, model, review
     outcome, tag, and date
4. Activity and evidence links
   - record compact Task Activity events when a run is saved as an eval case
   - link eval cases back to source task, trace, sprint, goal, reviewer, and
     artifacts
5. Early suggestions
   - suggest saving useful accepted or returned runs
   - keep operator confirmation required

Exit criteria:

- an operator can save a reviewed trace as an eval case
- saved cases are immutable, redacted, and linked back to source evidence
- Evals can filter cases without implying premature scorecards
- no eval case can be created without review rationale

### Slice 3: Starter Sprint Templates, Team, Active Crew, And Bench

Templates and crew routing should follow early eval capture so new work produces
useful traces and can feed evals from the beginning.

Recommended task groups:

1. Team page and roster states
   - add Company navigation item `Team`
   - show Active, Bench, Paused, and Archived roster filters
   - keep contextual work views focused on Active Crew
2. Template catalog foundation
   - model built-in immutable templates and company-local draft/published/
     archived template versions
   - preserve template version and intake answers on created work
3. Work-creation entry points
   - first-run onboarding chooses a template before agents
   - Goals, Projects, and project/goal detail flows can create work from
     templates
4. Build Something template
   - offer constrained build types
   - ask two to three questions
   - create a draft goal, sprint, tasks, validation checklist, review criteria,
     and Active Crew recommendation
5. Draft plan review
   - generate a draft before board tasks are created
   - make Review with Overseer prominent and context-loaded
   - support Delegated Signoff for a reviewed unchanged draft
6. Crew recommendation and governance
   - recommend required, useful, and useful-later agents
   - map to Active Crew or Bench where possible
   - route new hires through existing `autoApproveNewHires` governance
   - create full durable agent packages only through approved or auto-approved
     provisioning paths

Exit criteria:

- first-run onboarding can launch from a Starter Sprint Template instead of
  starter agents
- work creation can generate a reviewed draft plan before creating board tasks
- Active Crew is contextual and Bench does not clutter task navigation
- Team owns the full roster
- Overseer can review and, when explicitly delegated, approve a specific
  unchanged draft plan

### Slice 4: Improve v1 And Improvement Review

Improve should ship after eval cases exist. The first version should recommend
low-risk changes and route durable mutations through governance.

Recommended task groups:

1. Recommendation model
   - store status, trigger class, severity, confidence, evidence set, affected
     surfaces, rationale, proposed change, original generated text, editable
     operator version, and rollback or correction notes
2. Improve queue
   - add Company navigation item `Improve`
   - list suggested, needs-more-evidence, accepted-for-approval, dismissed,
     superseded, and applied recommendations
   - support grouping, editing, dismissal categories, and suppression
3. Built-in trigger controls
   - show named trigger classes and recent trigger firings
   - allow company pause and simple trigger enable/disable controls
   - keep custom trigger builders deferred
4. Approval package bridge
   - convert accepted recommendations into draft approval packages
   - include evidence, preview/diff when applicable, risk, and rollback notes
   - link Approvals/Inbox records back to Improve
5. Low-risk recommendation types
   - missing skill
   - missing tool or runtime setup
   - suggested new agent role
   - bench or exclude agent for a template/task type
   - template capability-slot change
   - reviewer notes for eval cases or templates

Exit criteria:

- Improve can explain why each recommendation exists
- recommendations do not apply durable changes by default
- accepted recommendations flow through existing approvals
- critical recommendations become visible without bypassing governance
- dismissed recommendations suppress repeats until new evidence appears

### Slice 5: HiveRunner MCP Server

MCP should follow traces and evals. The first version should expose HiveRunner as
an agent-work control plane; it should not make HiveRunner consume arbitrary MCP
tools yet.

Recommended task groups:

1. Read resources
   - list goals, sprints, tasks, task details, traces, eval cases, Active Crew,
     Bench, and improvement recommendations
2. Governed tools
   - save reviewed run as eval case
   - attach evidence
   - create improvement recommendation
   - request approval
3. Governance integration
   - enforce existing approval and permission rules for state-changing tools
   - redact trace and eval payloads by default
4. Runner reporting
   - allow runners to report MCP tool usage into Run Trace events later

Exit criteria:

- external agents can inspect HiveRunner work state and reviewed evidence
- state-changing MCP calls obey the same governance as the UI
- MCP exports use the same redaction and evidence-gap semantics as Run Trace

### Slice 6: Improvement Experiments

Improvement Experiments should wait until Run Trace, eval cases, and Improve are
real. They should generate comparison evidence, not silently replace production
work.

Recommended task groups:

1. Experiment source
   - launch from a Run Trace or Eval Case, with Eval Case preferred
   - preserve source links, reviewed evidence, capture quality, and redaction
     labels from the originating trace or eval case
2. Objective and mode selection
   - ask what the operator wants to improve
   - choose snapshot, branch, or live workspace mode
   - recommend snapshot or branch by default
   - label live workspace mode as governed, higher-risk execution
3. Variant planning
   - propose one to three variants
   - require operator approval of variants, cost, time, and iteration limits
   - reject open-ended loops and unbounded "try until better" requests
4. Execution and evidence
   - run attempts with fresh isolated context
   - capture a trace and comparison record per attempt
   - use external verification where possible
   - record hard-limit outcomes, cancellations, failures, and skipped variants
5. Report and recommendation handoff
   - save a comparison report as evidence
   - create an Improvement recommendation only when accepted or when configured
     trigger thresholds are met
   - never mutate agent defaults, templates, tasks, branches, or production
     workspace state solely because a report preferred a variant

Exit criteria:

- experiments have explicit objectives, workspace modes, and limits
- every attempt leaves trace/eval evidence
- reports are saved as evidence attachments
- recommendations remain governed and optional
- snapshot and branch modes remain the default recommendation
- live workspace mode requires explicit governed operator choice

### Sequencing Backlog

Defer these items until the core Run Intelligence loop is working:

- Workspace Path Simplification and removal of the internal `companies`
  filesystem segment
- named eval datasets and dataset versioning
- full scorecards and scorer engines
- eval-case reruns outside Improvement Experiments
- custom improvement trigger builders
- automatic durable mutation
- consuming arbitrary MCP tools inside HiveRunner runners
- Mastra runner integration
- hosted observability or general agent-app framework features

The product rule is:

> Defer infrastructure cleanup and broad integrations until the inspect-review-
> evaluate-improve loop is useful.

## Second Slice: Review-Backed Evals

Review-Backed Evals should follow Run Trace.

Review-Backed Evals is a Run Intelligence capability that turns human review
outcomes, goal-contract evidence, task metadata, and run traces into reusable
quality signals, datasets, and runner comparisons.

The first version should include:

- promoting accepted or returned runs into eval cases
- capturing reviewer outcome and reason
- grouping cases by task type, sprint template, runner, provider, and agent
- comparing runners and models on similar reviewed work
- simple grouped summaries based on human review outcomes

Runner, model, and agent comparison belongs in `Evals` first because comparison
is evidence. `Improve` can later use those comparisons to recommend changing
defaults, template capability slots, or runner selection rules.

Initial comparison should use saved eval cases only. Ordinary reviewed runs can
be suggested for saving as eval cases, but comparison should rely on stable
snapshots with reviewer rationale, capture quality, redaction, and source links.

Full scorecards should wait until there are enough saved cases and clear scoring
semantics. V1 should show counts, filters, and simple grouped summaries without
implying a precise ranking.

Eval-case reruns should be deferred until the eval library is stable. Reruns
require runner selection, workspace isolation, cost controls, and result
comparison, and overlap with future Improvement Experiments.

Controlled reruns and comparison variants should belong to Improvement
Experiments, not Evals v1. Evals stores and summarizes reviewed evidence;
Improvement Experiments later generate new comparison runs under explicit
workspace modes, cost limits, and user-selected optimization goals.

The first version should not include:

- a generic scorer marketplace
- complex automatic LLM judge pipelines
- CI enforcement
- a hosted eval dashboard
- rerunning eval cases

### First Eval Primitive

The first Review-Backed Evals primitive should be Save as eval case from a
reviewed run.

An eval case should store:

- task metadata
- runner identity
- prompt or handoff summary
- result summary
- trace link
- review outcome
- reviewer reason
- goal or task criteria references

Minimum eval case fields:

- eval case id
- company id
- source task id, key, and title
- source run id
- source trace link
- source sprint, goal, and template when available
- task type or category
- prompt or handoff summary
- expected outcome or criteria snapshot
- actual result summary
- review outcome: accepted, returned, rejected, or blocked
- reviewer reason and notes
- runner, provider, model, and agent
- created and version metadata
- immutable snapshot JSON

Accepted runs and returned runs are both valuable. Accepted runs define desired
behavior; returned runs define failure modes.

Eval cases should be immutable snapshots with links back to the source run.
Snapshot fields preserve what was actually reviewed at the time, while source
links keep navigation back to the task, run, trace, sprint, goal, reviewer, and
artifacts. Updating an eval case should create a new version instead of silently
mutating the historical case.

Eval case snapshots should be redacted by default and should inherit Run Trace
redaction rules. The eval case stores portable reviewed evidence, while links
back to the source run, trace, review, and artifacts can expose richer local data
when the operator has permission.

Eval cases should retain the source Run Trace capture-quality label and evidence
gaps. `complete`, `partial`, and `minimal` traces can be saved as eval cases by
default. `failed` trace capture should require explicit confirmation because the
case may be less reusable.

Eval-case snapshots should include reviewed Run Trace annotations. Operator notes
and marked timeline moments should be copied into the immutable eval-case
snapshot and linked back to the source trace.

Eval cases should start in a company-wide eval case library. Named datasets can
come later as saved views or collections after enough cases exist.

The company-wide eval case library should be surfaced under Company navigation
with the one-word label `Evals`. The underlying concept can still be Eval
Library, but the navigation should stay consistent with the rest of the dock.

The first `Evals` page should be a library list with filters, not a dataset
builder. Named datasets should come later after the company has enough saved
cases to make collections meaningful.

Initial library behavior:

- store all saved eval cases for the company
- filter by project
- filter by task type, template, agent, runner, model, review outcome, and date
- allow operator tags

Later dataset behavior:

- create named datasets from filtered or tagged cases
- pin dataset versions for experiments
- compare future runs against a selected dataset

The product rule is:

> The eval dataset starts at review, not from synthetic benchmark prompts.

> An eval case must be stable enough to rerun and rich enough to explain why the
> original was accepted or returned.

> Eval cases are portable review evidence, so they inherit trace redaction rules.

> Low capture quality warns the evaluator; it does not erase the review.

> Eval cases preserve reviewed annotations as evidence.

> Eval cases belong to the company library; projects provide filters.

> Company-wide eval evidence starts under Company navigation as Evals.

> Evals compares performance; Improve recommends changes.

> Comparison uses stable eval cases, not transient run history.

> Summarize early; score after enough reviewed evidence exists.

> v1 captures eval cases; later versions rerun them.

> Evals stores evidence; Improvement Experiments generate new comparison runs.

> Capture cases first; organize datasets after there is signal.

> Filters first; named datasets after enough cases exist.

Eval case capture should be manual first, with auto-suggestions soon after.

Initial behavior:

- The operator saves a reviewed run or trace as an eval case.
- Saving requires a reviewer rationale or selected reason category.
- Accepted cases require why the work passed and can optionally mark exemplary
  behavior.
- Returned, rejected, and blocked cases require a failure category and what
  would have made the result acceptable.
- HiveRunner stores an immutable snapshot.

Next behavior:

- After a returned or accepted task, HiveRunner can suggest that the run looks
  like a useful eval case.
- The operator confirms before the case is saved.

HiveRunner should not automatically save every reviewed run, create noisy
datasets, or create eval cases without reviewer rationale.

The product rule is:

> No eval case without a review reason.

> The review outcome determines the minimum explanation needed.

> Eval cases start with explicit operator selection; automation suggests, not
> floods.

### Eval-Driven Improvement

Review-Backed Evals should eventually produce improvement recommendations.

Evaluations may recommend:

- adding or removing a skill from an agent
- adding a required tool or runtime
- updating `SOUL.md`, `AGENTS.md`, `HEARTBEAT.md`, or `TOOLS.md`
- changing role instructions or authority boundaries
- adjusting template capability slots
- suggesting a new agent
- retiring, benching, or excluding an agent for certain work
- changing runner or model defaults

These recommendations are durable changes to behavior, identity, tool access, or
workspace files. They should not be applied silently.

The product rule is:

> Evaluations may produce improvement recommendations; applying them is governed,
> reviewable, and reversible.

Improvement recommendations should appear at the point of evidence and roll up
into a governance queue.

Recommended placement:

- Run Trace: recommendations from a failed, returned, or notable run
- Task Detail: suggested improvements from review
- Agent Profile: recurring recommendations for that agent
- Starter Sprint Template: recommended capability-slot changes
- Company navigation item `Improve`: all pending recommendations across agents,
  templates, tools, runners, configuration, and automation triggers

Settings should expose governance toggles, not be the only place where operators
discover improvement recommendations.

The Company navigation can surface `Evals` and `Improve` as main items for this
round. If the Company section becomes too large, a later navigation compaction
pass can group lower-frequency company surfaces into submenus without changing
the product ownership of those surfaces.

`Evals` and `Improve` should be separate implementation slices. `Evals` ships
first with save reviewed run as eval case and the company-level eval case
library. `Improve` ships after eval cases and recommendation evidence are real.

The product rule is:

> Show improvement recommendations at the point of evidence; collect them in a
> queue for governance.

> Contextual surfaces show recommendations; Improve owns the company queue.

> Capture eval evidence before building the improvement queue.

The Improvement Queue should be a separate product surface that shares approval
mechanics.

The first `Improve` page should include automated trigger visibility and controls
alongside the recommendation queue. Operators should be able to see which
automation triggers are active, why they fired, what evidence they inspected, and
which recommendations they created or suppressed.

`Improve` v1 should expose built-in trigger controls, not a full custom trigger
builder. Operators can enable or disable named triggers, see why they fired, tune
simple thresholds where appropriate, and view suppressions. Arbitrary custom
trigger logic should wait until there is real usage data.

`Improve` and Settings should both expose improvement automation, with different
responsibilities. `Improve` owns operational trigger controls, trigger history,
suppression visibility, and the recommendation queue. Settings owns global
governance defaults such as whether improvement automation is enabled, which
categories are allowed, and whether high-risk recommendations require approval.

Improvement automation should generate suggestions by default, but should not
apply durable changes by default. Durable mutations remain governed unless the
operator later configures a specific category for automatic application.

Operators should be able to pause Improvement automation at the company level
and suppress it for narrower scopes such as project, template, or task type.
Company-level pause should be v1. Scoped suppressions can follow in v1 or v1.5
as the trigger model matures.

`Improve` should expose suppressed recommendations and trigger firings in a
secondary view or filter. Operators should be able to inspect what automation
skipped, suppressed, or declined to recommend, but those records should not
clutter the main recommendation queue.

Recommendations are not approvals. An improvement recommendation may need
discussion, batching, editing, dismissal, or more evidence before it is ready to
apply. When the operator chooses to apply a recommendation, HiveRunner should
create or use a governed approval path for the durable mutation.

Accepted Improvement recommendations should use the existing Approvals and Inbox
system for durable changes. `Improve` owns recommendation review and evidence;
Approvals governs whether the proposed mutation is allowed. Approval records
should link back to the recommendation and its evidence set.

`Improve` should be able to prepare a draft approval package before submitting
it. Operators can assemble one or more recommendations, inspect the proposed
change, preview or diff, evidence set, risk notes, and rollback notes, then
submit the package into Approvals when ready.

Every durable Improvement approval package should include rollback or correction
notes before approval. If rollback is straightforward, the package should say how
to reverse the change. If rollback is not straightforward, it should explain why
and identify the corrective work path.

Applying an Improvement should create compact Activity or audit events on every
affected surface, such as agent, template, task, goal, runner setting, or
workspace asset. Each event should link to the recommendation, approval, evidence
set, applied change, and rollback or correction notes.

Overseer may review, refine, and submit draft Improvement approval packages when
the operator explicitly delegates that work. This follows the same scoped,
auditable pattern as Overseer Delegated Signoff. Applying the durable mutation
still follows approval and governance rules.

Overseer may also approve the actual Improvement approval package when the
operator delegates that specific approval and governance allows it. The package
must be loaded, reviewed, unchanged after review, and explicitly delegated.
High-risk categories can still require direct operator confirmation when company
governance requires it.

Improvement recommendation status should be separate from approval status.
Recommended statuses are:

- `suggested`
- `needs_more_evidence`
- `accepted_for_approval`
- `dismissed`
- `superseded`
- `applied`

Approval status starts only when a recommendation is accepted for a governed
change.

Operators should be able to edit an Improvement recommendation before sending it
to approval. Editable fields should include proposed change summary, scope,
affected agents, templates, tools, runners, rationale, and batching/grouping.
HiveRunner should preserve the original generated recommendation for audit and
comparison.

Related Improvement recommendations should be groupable into one approval when a
single governed change resolves the pattern. The grouped approval should show
each included recommendation, each evidence set, and the combined proposed
change.

Dismissing an Improvement recommendation should require lightweight feedback.
The operator should be able to choose quick categories such as `not_now`,
`wrong_diagnosis`, `too_risky`, `already_fixed`, or `not_worth_it`, with optional
notes. Dismissal feedback should help future automation avoid repeating weak
suggestions.

Dismissed recommendations should remain suppressed unless new substantial
evidence appears. When new evidence changes the case, HiveRunner can reopen or
supersede the recommendation with a clear "new evidence since dismissal" note
instead of creating a noisy duplicate.

Improvement recommendations should include severity and confidence. Severity
should use `low`, `medium`, `high`, and `critical` to describe the impact if the
issue is ignored. Confidence should use `low`, `medium`, and `high` to describe
the strength of the supporting evidence.

Critical Improvement recommendations should surface immediately in the relevant
context and remain in the queue. They can appear as a banner or prominent callout
on the affected Run Trace, task, agent, template, or review surface, and may
notify the operator. Critical recommendations should not open blocking modals
unless the operator is already in the relevant approval or review flow, and they
must still follow governance before applying changes.

The Improvement Queue should store the recommendation, rationale, evidence
links, affected agents/templates/runners/tools, and proposed change summary.
Approval execution should handle durable mutations such as agent file changes,
skill/tool assignment, runtime configuration, or template definition updates.
Audit events should link the recommendation, approval, and resulting changes.

Improvement recommendations should support evidence sets. A recommendation can
cite one severe run, one eval case, multiple runs, multiple eval cases, or a
pattern across cases. The queue should make the evidence strength visible so the
operator can distinguish an urgent single failure from a durable repeated
pattern.

The product rule is:

> Recommendations are not approvals; approved recommendations become governed
> changes.

> Improve decides what to change; Approvals governs whether it mutates.

> Prepare the approval package before requesting permission to mutate.

> Every durable improvement needs rollback or correction notes.

> Durable improvements leave visible evidence where they changed behavior.

> Delegated Overseer can prepare and submit; governance still applies.

> Overseer approval is scoped to a reviewed, unchanged package.

> Improve owns both the recommendation queue and its automation triggers.

> v1 exposes and controls built-in triggers; custom trigger building comes later.

> Improve operates triggers; Settings defines governance defaults.

> Automation may suggest by default; mutation is governed by default.

> Improvement automation is company-owned but scope-suppressible.

> Suppression is visible on demand, not noisy by default.

> Improvements should cite their evidence, not just assert a fix.

> Recommendation status tracks product judgment; approval status tracks
> permission to mutate.

> Operators can refine recommendations; HiveRunner preserves the original
> suggestion.

> Group related recommendations when one governed change resolves the pattern.

> Dismissals are feedback, not just cleanup.

> Dismissal suppresses repeats until new evidence changes the case.

> Severity ranks impact; confidence ranks evidence strength.

> Critical means visible now, not applied automatically.

### Improvement Review Automation

Eval-driven automation should run through a distinct Improvement Review loop.

The existing lead-supervisor tick is a visibility/status mechanism and should
not be overloaded as the durable improvement engine.

Improvement Review should work as follows:

1. Deterministic triggers create improvement checks after events such as returned
   runs, saved eval cases, repeated failure patterns, sprint completion,
   repeated template use, or runner/model underperformance.
2. An improvement evaluator inspects traces, review outcomes, eval cases, agent
   configuration, skills, tools, and runner metadata.
3. The CEO or current lead agent synthesizes the recommendation, including what
   failed or improved, the proposed change, why it matters, affected files or
   settings, risk, and rollback notes.
4. The recommendation is stored in the Improvement Queue and surfaced at the
   evidence point.
5. Applying the recommendation follows governance and audit rules.

The product rule is:

> Improvement Review detects and explains changes; governance applies them.

Improvement Review should start with lower-risk recommendations before applying
durable identity or authority changes.

v1 recommendation types:

- add a missing skill to an agent
- suggest missing tool or runtime setup
- suggest a new agent role
- bench or exclude an agent for a template or task type
- change a template capability slot
- add reviewer notes to an eval case or template

Deferred until v2:

- editing `SOUL.md`, `AGENTS.md`, `HEARTBEAT.md`, or `TOOLS.md`
- changing model or runner defaults
- changing authority boundaries
- automatic application
- deleting or archiving agents
- mutating shared memory

The product rule is:

> Prove the improvement loop with low-risk recommendations before editing
> durable identity, authority, or memory.

Improvement Review should use a hybrid trigger model.

Returned runs, accepted runs, saved eval cases, and sprint completion can enqueue
lightweight improvement checks. HiveRunner should not create a recommendation
for every single event.

Recommendations should be created when there is enough signal, such as:

- a repeated pattern
- a severe failure
- an explicit reviewer request
- a template-level gap
- a missing required capability, tool, or runtime

CEO or lead synthesis should operate on batches when possible so the operator
receives fewer, better recommendations.

The product rule is:

> Check continuously; recommend selectively.

Initial named trigger classes:

- `severe_single_failure`: a failed run caused data-loss risk, unsafe command
  attempt, broken release gate, or impossible review.
- `repeated_review_return`: the same agent, runner, or task type was returned
  for a similar reason multiple times.
- `missing_capability`: a template or plan requires a capability that no Active
  Crew or Bench agent covers.
- `missing_tool_runtime`: a task requires a tool, CLI, or runtime that is not
  configured.
- `template_drift`: operators repeatedly add the same role, task, or check to a
  template-generated sprint.
- `runner_mismatch`: a runner or model repeatedly performs poorly for a task
  category.
- `reviewer_request`: a reviewer explicitly asks HiveRunner to create an
  improvement recommendation.

The product rule is:

> Improvement recommendations need a named trigger and linked evidence.

### Future Loop: Improvement Experiments

Improvement Experiments should be a later Run Intelligence loop after eval cases
exist.

An Improvement Experiment is a controlled comparison loop that takes a reviewed
run or eval case and asks whether HiveRunner could have completed the work better
under a different strategy.

Improvement Experiments can later launch from both Run Trace and Eval Case
surfaces. A Run Trace can offer "experiment from this run" after review, while an
Eval Case can offer "experiment from this stable case." Eval cases should be the
preferred source for repeatable experiments.

Source selection rules:

- An Eval Case is the default source because it is immutable, reviewed, redacted,
  and already has reviewer rationale.
- A Run Trace can be a source only after review context exists or the operator
  explicitly accepts the lower-repeatability source.
- The experiment copies source task metadata, source trace or eval links, review
  outcome, evidence gaps, capture quality, and redaction summary into the
  experiment record.
- Experiments compare against the original source behavior. They do not edit the
  source task, source trace, or source eval case.

Improvement Experiments may compare:

- different runner or model
- different agent
- different prompt or handoff
- different tool setup
- different task decomposition
- different template capability slots
- different memory or context package

Before running an Improvement Experiment, HiveRunner should ask what the operator
wants to improve:

- lower token cost
- shorter runtime
- fewer failed or returned tasks
- better reviewer acceptance
- better evidence quality
- fewer tool or runtime errors
- faster sprint completion
- less operator intervention

The objective is singular for v1. If the operator wants both lower cost and
better acceptance, HiveRunner should ask which one is primary and treat the other
as secondary context in the report. The report should judge variants against the
operator-selected definition of better rather than inventing a score after the
attempts finish.

Improvement Experiments should run in an isolated comparison context and should
not mutate the real task or workspace by default.

This is Ralph Loop-inspired, meaning it should use bounded repeated attempts,
fresh context between attempts, external verification, progress/state files, and
guardrails. It does not imply ownership by the HiveRunner agent named Ralph.

Required safety rails:

- fresh isolated context per attempt
- explicit improvement objective before the loop starts
- external verification instead of self-assessment
- hard iteration, cost, and time limits
- snapshot or branch isolation recommended by default
- live production workspace execution allowed only as an explicit operator choice
- trace and eval records for every attempt
- operator-selected definition of better before execution
- no automatic promotion, template mutation, runner default change, or durable
  task/workspace mutation from experiment output alone

Improvement Experiment workspace mode should be operator-selectable:

- `snapshot`: run against a copied workspace state
- `branch`: run against an isolated branch or worktree
- `live`: run against the active workspace

HiveRunner should recommend `snapshot` or `branch` and clearly label `live` as
higher risk. Live execution should require explicit operator selection and should
be treated as governed execution. Live mode is not the default, is not implied by
choosing a runner, and should never be selected automatically by an experiment
trigger.

Workspace mode semantics:

- `snapshot` uses a copied source state and is the safest default for
  comparison, rerun, and report generation.
- `branch` uses an isolated branch or worktree so file changes can be inspected
  without touching the source branch.
- `live` runs against the active workspace only after the operator approves the
  exact risk, lane, limits, and rollback posture.

Improvement Experiments should support multiple variants, but cap them tightly.
The operator chooses one improvement objective, HiveRunner proposes one to three
variants, and the operator approves which variants run. Each variant should have
hard limits and should be compared against the original run and the other
variants.

Hard limits are part of the experiment contract, not runner hints. V1 should
store approved limits for variants, attempts per variant, max wall-clock time,
max token or cost budget, allowed verification commands, and cancellation rules.
If a limit is reached, HiveRunner records a bounded outcome and moves on to the
report instead of extending the loop.

The output is a recommendation, not an automatic replacement.

Improvement Experiments should always produce a comparison report. They should
create an Improvement recommendation only when the operator accepts the
conclusion or the evidence meets a configured trigger threshold. This prevents
speculative experiment output from flooding `Improve`.

Experiment comparison reports should be saved as linked evidence attachments on
the source eval case or run trace. They can surface in `Evals` and `Improve`
when relevant, but they should not create a separate top-level navigation
surface unless experiments become frequent enough to justify one.

Comparison reports should include:

- source trace or eval case
- objective and secondary context
- workspace mode and isolation path
- variant definitions and approved hard limits
- attempt traces, statuses, costs, durations, and verification evidence
- evidence gaps, redaction summary, and failed or cancelled attempts
- conclusion, confidence, risk, and why the original was or was not improved
- explicit handoff state: report-only, accepted for Improve, or trigger-created
  Improve recommendation

Improve handoff stays governed. An accepted report may create an Improvement
recommendation or draft approval package, but the report itself does not apply a
change. Durable changes continue through existing approvals, review, promotion,
and rollback paths.

MCP boundary:

- The HiveRunner MCP Server may expose redacted experiment reports later as
  Run Intelligence resources and may accept governed evidence or recommendation
  requests if those tools are explicitly added.
- Improvement Experiments v1 does not make runners discover, consume, or proxy
  arbitrary external MCP tools.
- If a future runner consumes an approved MCP tool, it reports safe tool-usage
  evidence through Run Trace; the HiveRunner MCP Server is still not treated as
  the executor, approver, or relay for that call.

Promotion caveat:

- `snapshot` and `branch` results are comparison evidence until a human accepts
  the conclusion and routes any durable change through Improve, task review, or
  the normal git/promotion process.
- `live` mode can create real workspace effects, so it requires an explicit
  operator decision before execution and a report that distinguishes observed
  comparison evidence from mutations already made.
- Stable `3001` remains the operator/control lane. Implementation and browser
  verification of experiment features run on `3010` or another isolated lane;
  stable promotion remains a separate operator-approved step.

The product rule is:

> Improvement Experiments use Ralph Loop-style iteration to generate comparison
> evidence, not to silently replace reviewed work.

> Experiments can start from a trace, but stable experiments start from eval
> cases.

> Experiments produce reports; recommendations require acceptance or trigger
> evidence.

> Experiment reports are evidence attachments, not a new navigation surface.

> Few variants, hard limits, evidence-first comparison.

> Snapshot and branch by default; live mode is explicit, governed, and rare.

> MCP exposure is not MCP consumption by runners.

## Third Slice: Starter Sprint Templates

Starter Sprint Templates should follow Run Trace and the first Review-Backed
Evals primitive.

A Starter Sprint Template is a launchable goal, sprint, and task package that
creates concrete reviewable work and serves as the primary first-run choice
before agent selection.

Starter Sprint Templates should declare the work, tasks, dependencies, review
gates, validation criteria, runner posture, and required capabilities. HiveRunner
then recommends a run crew for the selected template.

Starter Agent Packs become reusable role presets for template recommendations,
not the primary first-run decision.

Initial templates should focus on practical operator workflows:

- build something sprint
- PR review sprint
- bug triage sprint
- release readiness sprint
- repo cleanup sprint
- local app smoke-test sprint
- competitor research sprint

Starter Sprint Templates should instantiate work that can produce useful traces
and eval cases from the beginning.

The build something sprint should give a new operator a satisfying end-to-end
first run while still producing real reviewable work. It can offer selectable
example briefs such as a small arcade-style game, first-person gameplay
prototype, block-building toy, lightweight interactive tool, dashboard/widget,
or small product feature. These examples should be scoped so HiveRunner can show
the full loop: goal, sprint, tasks, Active Crew, run traces, review, and
follow-up improvements.

The product rule is:

> The showcase template should be delightful, but still operate like real work.

Build Something should use guided creative intake.

The operator chooses from a short list of constrained build types, such as:

- arcade mini game
- first-person gameplay prototype
- block-building toy
- interactive tool
- dashboard or widget
- product feature

HiveRunner can then ask a small number of clarifying questions and use AI to
help turn the answers into a scoped goal, sprint, task plan, Active Crew
recommendation, validation checklist, and review gate.

Build Something should ask two to three clarifying questions at most before
creating a draft plan. The questions should cover build type, desired vibe or
constraint, and ambition level. The first output should be a reviewable draft
goal, sprint, task plan, Active Crew recommendation, validation checklist, and
review criteria.

The product rule is:

> Build Something offers constrained creative choices, then AI-assisted
> customization before sprint creation.

> Ask just enough to scope the sprint; let review and iteration handle the rest.

Starter Sprint Templates should include both built-in and company-local
templates.

Built-in templates should remain available whenever an operator creates new
work, including first-run onboarding and later goal, sprint, or project creation.
They teach the first run and provide public-safe defaults.

Company-local templates should be created when an operator customizes a built-in
template or when eval/improvement recommendations justify a durable local
variant. Company-local templates can learn from actual reviewed work without
forking the public built-in defaults.

Customizing a template during work creation should not automatically create a
company-local template. The customization should apply to the current draft plan
only unless the operator explicitly chooses to save it as a reusable template or
accepts an Improvement recommendation to make the pattern durable.

The product rule is:

> Customization changes the current plan; saving creates a reusable local
> pattern.

Starter Sprint Templates should be versioned artifacts. Built-in templates are
immutable public-safe versions. Company-local templates can move through Draft,
Published, and Archived states, with edits creating a draft or new version
instead of mutating a template that already launched work.

New work should launch from a published template version. Goals, sprints, tasks,
run traces, and eval cases should retain the template version that created or
influenced them so later review can distinguish template behavior from operator
changes.

Template intake should be part of the template version. Each version should
define its intake questions, defaults, answer schema, and how those answers map
into the draft goal, sprint, task plan, Active Crew recommendation, validation
checklist, and review criteria. The captured answers should remain linked to the
draft and any work created from it.

The product rule is:

> Templates are versioned operating patterns, not mutable snippets.

> Template intake is part of the template, not loose chat.

Starter Sprint Templates should be available at work-creation entry points, not
only inside a standalone template destination.

Template entry points:

- first-run onboarding: choose the first work template
- Goals page: create goal from template
- Goal detail: generate sprint plan from template
- Projects page: create project from template with starter goals, sprints, and
  tasks
- Project detail: add a template-based sprint to an existing project
- Task creation: later, add smaller task/checklist templates
- Template Catalog: browse, edit, and manage built-in and company-local templates

The catalog is for management. Creation flows should surface relevant templates
in context.

Templates should create a draft plan before creating board tasks.

Template flow:

1. Pick a template.
2. Answer template-specific questions when needed.
3. HiveRunner generates a draft goal, sprint, task plan, dependency plan, Active
   Crew recommendation, validation checklist, and review criteria.
4. The operator reviews the draft.
5. The operator may open Overseer to ask questions about the plan or request an
   additional review.
6. The operator approves board creation.
7. HiveRunner creates goal, sprint, tasks, and any governed agent
   recommendations.

Overseer should act as an optional plan-review companion that helps the operator
understand, challenge, or refine the draft before signoff.

Overseer review should be recommended and always visible after template draft
creation, but not required. First-run onboarding and complex plans should make
the Review with Overseer action especially prominent.

Overseer should advise on the draft plan, sprint structure, board use, review
gates, and Active Crew recommendation. It can help critique, explain, and refine
the plan, but operator approval remains the action that creates the work.

HiveRunner should automatically prepare Overseer for draft-plan review. When a
template draft is created, the UI should load the relevant plan context and show
a prominent Review with Overseer action. First-run onboarding can open Overseer
by default with a short initial critique or checklist. Longer back-and-forth
should happen when the operator engages, and Overseer suggestions should become
draft edits only when applied.

Overseer should support Delegated Signoff for all sprint-plan drafts, not only
template-generated drafts. If the operator asks Overseer to review or approve a
draft plan, HiveRunner should automatically load the relevant draft context into
the Overseer session. If the operator then asks Overseer to approve that specific
draft after review, that explicit instruction should be enough for Overseer to
approve the draft on the operator's behalf. The operator should not need to leave
the Overseer flow and click a separate Approve button.

Delegated Signoff should be scoped and auditable:

- scoped to the currently loaded draft plan or proposal group
- available only after the draft has been shown to Overseer
- bound to the reviewed draft snapshot
- recorded as operator-delegated Overseer signoff
- linked to the Overseer session and draft plan
- blocked if the draft changed after review without refreshing context and
  re-reviewing the updated draft
- not a blanket permission for future plans or unrelated mutations

The product rule is:

> Delegated approval applies to the reviewed draft, not whatever the draft
> becomes later.

Overseer Delegated Signoff can include agent creation when the operator asks
Overseer to approve a plan that contains new recommended agents. This should be
treated as an Operator-Delegated Hire, not an autonomous agent-requested hire.

Delegated Signoff can also include required in-app tools and skills for the
agents in the reviewed plan. This should be treated as an Operator-Delegated
Change.

Operator-Delegated Changes may include:

- creating agents included in the reviewed plan
- assigning or removing agent skills
- configuring required tools or runtimes
- updating agent-managed files such as `SOUL.md`, `AGENTS.md`, `HEARTBEAT.md`,
  or `TOOLS.md`
- updating company-local template capability slots
- creating or updating plan-related workspace assets

Operator-Delegated Changes must not modify HiveRunner's own application source
code. If a plan requires changes to the HiveRunner app codebase, Overseer should
create or recommend ordinary implementation tasks instead of editing the app
itself through Delegated Signoff.

Delegated Signoff should use risk-tiered previews.

Conversation approval is enough for low-risk changes such as creating tasks,
assigning an existing skill, or creating a planned agent that is already visible
in the reviewed draft.

Higher-impact changes should show a preview or diff before application,
including agent file edits, skill removal, runtime or tool configuration changes,
and company-local template updates.

HiveRunner app source-code modification is forbidden in this flow.

Overseer authority should be governed per action category, not granted through a
single blanket power toggle.

Action categories should include:

- task, sprint, and goal creation
- agent creation
- skill and tool assignment
- agent file edits
- runtime and tool configuration
- company-local template updates
- memory changes
- HiveRunner app source-code changes, which are forbidden in this flow

Each category can define whether the action is allowed, requires preview,
requires approval, or is forbidden.

Delegated Signoff and Operator-Delegated Changes must create audit evidence.

Audit records should include:

- who delegated the change
- Overseer session id
- affected draft, goal, sprint, task, agent, template, or runtime
- action category
- preview hash or change summary when available
- applied changes
- timestamp
- rollback or reversal information when available

Visibility:

- task, goal, and sprint Activity should show relevant delegated changes
- the Overseer session should show the signoff and applied changes
- related approval or Improvement Queue records should link to the audit record
- Run Trace should show delegated changes when connected to a run

Delegated changes should support rollback only where rollback is straightforward,
and the UI should clearly show when rollback is unavailable.

Rollback v1 candidates:

- remove a task created by delegated signoff if it has not yet been worked
- remove a staged or created agent if it has no run history
- undo skill assignment
- restore previous agent file contents when a snapshot was captured
- restore previous company-local template version

Changes without simple rollback:

- tasks that have already executed
- agents with run history
- memory mutations
- runtime or tool configuration that changed external state
- live workspace changes

Agent creation through Delegated Signoff should:

- be scoped to the agents listed in the reviewed draft plan
- show the job title, expertise, reason, reporting path, and runtime posture
- create the full durable agent package when signoff is applied
- record which agents were created as part of the signoff
- remain auditable from the Overseer session, draft plan, and agent record

Autonomous agent-requested hires outside explicit operator-delegated signoff
still follow Agent Provisioning Governance and the `autoApproveNewHires` setting.

The product rule is:

> Starter Sprint Templates are the primary first-run choice; Starter Agent Packs
> become reusable role presets recommended by templates.

> Built-ins teach the first run; company-local templates learn from actual work.

> Templates live in the catalog, but launch from the place where work is created.

> Templates propose work; operators approve board creation.

> Overseer helps review template plans before signoff; it does not replace
> operator approval.

> Overseer plan review is recommended and always visible, not a required gate.

> Overseer advises on draft plans; operator approval creates the work.

> Overseer is automatically prepared for draft review; deeper review is
> operator-invoked.

> Overseer can sign off on a specific draft plan when the operator explicitly
> delegates that signoff in context.

> Delegated plan signoff may create the agents included in that reviewed plan
> when the operator asks Overseer to approve it.

> Overseer may apply scoped in-app plan changes delegated by the operator, but it
> must not modify HiveRunner's application source code through Delegated Signoff.

> Low-risk delegated changes can apply from conversation approval; higher-impact
> delegated changes need a preview.

> Overseer power is scoped by action category, not granted as a blanket
> permission.

> Delegated authority must leave evidence.

> Rollback when reversible; otherwise record the change and create corrective
> work.

The first-run flow should be:

1. Complete local readiness and setup.
2. Enter workspace or company basics.
3. Choose the first Starter Sprint Template.
4. Review the generated sprint and task plan.
5. Review the recommended agents for that template.
6. Choose whether to create the minimum crew, create an expanded reusable crew,
   map to existing agents, or customize.
7. Launch into the task board and review loop.

Agent recommendations should be grouped by operator relevance:

- required for this run
- useful for this run
- useful later

Starter templates should create reviewable work, not demo content.

Template-led onboarding should replace the current starter-team-first flow for
first-run onboarding. A manual/custom workspace path should remain available for
operators who want to create a workspace with blank or hand-picked agents.

## Active Crew And Bench

HiveRunner should use a scope-aware crew model.

Active Crew is the set of agents assigned or recommended for the current goal,
sprint, task, or template. Bench is the set of available agents that exist in the
workspace but are not currently needed for the selected work.

Goal, sprint, and task views should default to showing Active Crew. Bench agents
should stay reachable through Team, Bench, search, or an Add agent to this work
flow, but they should not consume contextual navigation space by default.

Team should be the company-level full roster surface. It should be explicitly
surfaced under Company navigation and own the complete roster across Active
Crew, Bench, Paused, and Archived agents.

Team can later show compact quality signals from `Evals` and `Improve`, such as
recent accepted or returned eval cases, unresolved recommendations, and
template/task-type strengths. Team should not introduce agent leaderboards before
there is enough reviewed evidence.

Agent profiles should receive agent-specific Run Intelligence evidence before
Team rollups. Agent profiles should show eval cases involving that agent,
accepted and returned patterns, active recommendations, and applied improvements.
Team can summarize the roster after those details exist.

Navigation rules:

- goal, sprint, project, and task views show Active Crew for that scope
- Bench agents stay out of contextual navigation by default
- Team owns the full roster
- Team is an explicit Company navigation item
- Team filters include Active, Bench, Paused, and Archived
- Add to this work can pull from Bench or propose a new agent
- Search can always find Bench agents
- Agent profiles show where an agent is Active Crew versus Bench

When selected work needs a capability that is not present in Active Crew,
HiveRunner should recommend an appropriate Bench agent or propose creating a new
agent.

Active Crew recommendations should come from layered evidence:

1. Starter Sprint Templates declare baseline required, useful, and later
   capability slots.
2. Goal, sprint, or task plan evaluation checks whether the baseline crew is
   sufficient and adjusts recommendations with rationale.
3. CEO or team lead agents can propose missing agents when the work exposes a
   capability gap.

Any new hire recommended through this model follows Agent Provisioning
Governance.

The product rule is:

> Templates define the baseline crew; plan evaluation and lead agents refine it;
> hiring governance controls materialization.

> Work views show scoped crew; Team owns the full roster.

> Team is the company-level full roster surface; contextual work views show
> scoped crew.

> Team can surface quality signals after eval evidence exists; no premature
> leaderboard.

> Agent profiles own agent-specific evidence; Team summarizes the roster.

## Route And Workspace Path Boundary

Run Intelligence should not depend on changing HiveRunner's company route or
workspace filesystem layout.

User-facing canonical URLs can continue to use short company-code paths such as
`/INS/tasks` and `/INS/team`, with internal compatibility routes such as
`/companies/<slug>/...` remaining implementation details.

The on-disk workspace folder shape, including the current `companies` segment
under `MC_WORKSPACE_ROOT`, should be handled as a separate infrastructure
cleanup and migration. Existing persisted `workspace_root` values must remain
backward-compatible until a dedicated Workspace Path Simplification project
handles migration, safety checks, and rollback.

The product rule is:

> Run Intelligence uses existing route and workspace roots; workspace path
> simplification is a separate infrastructure cleanup.

## Agent Provisioning Governance

HiveRunner already has a company-level hiring governance setting:
`autoApproveNewHires`.

That setting should govern template-, goal-, sprint-, and task-driven agent
recommendations. Run Intelligence should not introduce a parallel approval
switch for recommended agents.

The default is approval-required. When `autoApproveNewHires` is false,
agent-requested hires should create a pending `hire_agent` approval that appears
through the existing approvals and inbox surfaces. When `autoApproveNewHires` is
true, the recommended hire may materialize immediately.

Human-created agents can still be created directly through the explicit manual
agent creation flow.

When a new agent is approved or auto-approved, HiveRunner's existing agent
provisioning path should create the durable agent package, including:

- the agent record and runtime state
- the agent workspace directory
- `IDENTITY.md`
- `SOUL.md`
- `AGENTS.md`
- `HEARTBEAT.md`
- `TOOLS.md`
- runtime defaults and default skills
- optional provider-specific scaffold when explicitly enabled

Approval-required hires may be staged as paused agents so the approval has a
concrete target, but they should not join Active Crew as runnable participants
until approved.

The product rule is:

> Template and planning intelligence may recommend agents; durable agent
> provisioning follows the company's hiring governance setting.

## Later Slice: HiveRunner MCP Server

HiveRunner should expose Run Intelligence through an MCP server after Run Trace
and eval-case capture exist.

The HiveRunner MCP Server should expose the agent-work control plane, not a
general AI application framework.

Initial resources and tools can include:

- list goals, sprints, and tasks
- inspect task detail
- inspect Run Trace
- list eval cases
- save a reviewed run as an eval case
- list improvement recommendations
- create an improvement recommendation
- request approval or attach evidence
- list Active Crew and Bench for a goal or sprint

State-changing MCP tools should follow existing approval and governance rules.

HiveRunner should expose MCP first and consume MCP tools later. Consuming
arbitrary MCP tools introduces tool approval, credential, filesystem, and
runner-lane questions that should wait until governance is more mature.

Recommended order:

1. HiveRunner MCP Server exposes goals, tasks, runs, reviews, and evals.
2. Runner contracts can report MCP tool usage in traces.
3. Later, companies or runners can attach MCP tool providers.
4. MCP tool execution follows runtime governance and approval rules.

The product rule is:

> HiveRunner MCP exposes the agent-work control plane; it does not turn
> HiveRunner into a general agent framework.

> Expose first; consume after governance is mature.

## Opportunistic Integrations

Mastra integration is not a Run Intelligence roadmap slice.

Mastra may become a future external runner adapter if users ask for it, but it
should not define HiveRunner's core architecture or delivery order. The current
value from Mastra is product and architecture inspiration for traces, evals,
templates, and MCP.

The product rule is:

> Integrate with Mastra only if user demand justifies it; do not build Mastra
> parity into HiveRunner.
