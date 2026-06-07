# Stable Runtime Efficiency Refactor Plan

## Objective

Refactor the stable executor lane so one task maps to one durable run unless explicitly resumed, deterministic preflight failures circuit-break immediately, token/context budgets are visible and enforceable, structured actions are replayable, and INS-G006-class replay shows materially lower retries and token load.

## Baseline Artifacts

Use these audit artifacts as the before snapshot:

- `summary.csv`
- `sprint_summary.csv`
- `task_summary.csv`
- `failure_classes.csv`
- `repeated_failures.csv`
- `provider_summary.csv`
- `action_ingestion.csv`
- `report.md`

Baseline metrics:

- 75 tasks, 257 runs, 3.43 runs/task.
- 90 non-completed runs, 35.0 percent.
- 26 tasks with breakdowns, 34.7 percent.
- 380.4M input tokens.
- 360.0M cache-read input tokens.
- P50 task input: 3.48M tokens.
- P95 task input: 14.80M tokens.

## Phase 1 - Preflight And Circuit Breaker

Implement stable-lane preflight before the engine admits a run:

- `node` executable resolves and can run `--version`.
- Runner script exists and is readable.
- `cwd` exists and is readable.
- writable dirs exist or can be created.
- provider auth is available for the selected provider.
- lane health is green.

Persist preflight results per lane/provider/runtime fingerprint. Identical environment failures should stop queue execution immediately and create a single operator-visible blocker instead of creating repeated execution runs.

Acceptance:

- A missing `node`/runner script produces exactly one failed/circuit-open record.
- Queue stops before a second identical environment failure.
- Operator UI shows the failing check and reset/retry action.

## Phase 2 - Durable Run Attempt Model

Add explicit attempt/resume metadata to `execution_runs` or a companion table:

- `attempt_number`
- `resume_of`
- `failure_reason`
- `retry_policy`
- `retry_allowed`
- `retry_decision_reason`
- `preflight_result_id`
- `terminalized_by`

Define a state machine for pending, running, completed, failed, cancelled, timed_out, circuit_blocked, and resumed. Remove inference from timestamps/status alone.

Acceptance:

- Re-running a task without explicit resume is blocked unless retry policy allows it.
- Resumes link to a prior run.
- Task detail can show all attempts and why each exists.

## Phase 3 - Token Budget Ledger

Persist normalized usage deltas by run, task, sprint, goal, provider, model, and cache class. Do not rely only on JSON blobs in `token_usage_json`.

Expose:

- per-task total, p50, p95
- per-sprint and per-goal totals
- top consumers
- budget remaining
- budget exceeded action: stop queue or ask operator

Acceptance:

- Dashboard can show Goal INS-G006 baseline and new replay totals side by side.
- Budget threshold blocks or asks before the next run starts.

## Phase 4 - Context Reduction

Reduce repeated injection:

- task-specific compact context by default.
- references and retrieval handles instead of full repeated source/context injection.
- hard caps for memory/source injection.
- run-level context manifest persisted with hashes and byte/token estimates.
- require a deliberate opt-in for full-context expansion.

Acceptance:

- P50 task input drops by at least 50 percent on benchmark replay.
- Every run shows context sources and token estimates.
- Large context sections are individually attributable.

## Phase 5 - Structured Action Ledger

Replace free-text-only ingestion with a durable action ledger:

- `parsed_actions` or `execution_run_actions` table.
- raw text span, parsed JSON, action type, validation status.
- execution status: pending, executed, skipped_duplicate, failed_validation, failed_execution.
- idempotency key and replay count.
- replay endpoint/tool for pending or failed-recoverable actions.

Keep fenced `mc-action` parsing as compatibility input, but record every parsed block before execution.

Acceptance:

- No action disappears without a row and terminal status.
- Invalid JSON/validation errors are visible per run.
- Replay executes pending actions without replaying the whole agent run.

## Phase 6 - Timeout And Cancellation Semantics

Separate timeout types:

- queue_start_timeout
- no_output_timeout
- adapter_timeout
- operator_cancelled
- task_transition_cancelled
- stale_process_missing
- provider_exit

Each terminal state should define whether retry is allowed and whether the task status changes.

Acceptance:

- Cancellation and timeout cannot both be inferred from the same signal without a recorded cause.
- SIGTERM records the actor/reason that requested it.
- Stale process recovery does not generate duplicate work without an explicit retry decision.

## Phase 7 - Replay Benchmark

Create a representative 10-task sprint fixture based on INS-G006 classes:

- planning task
- route/view-model task
- API/persistence task
- UI task
- docs task
- focused automated verification
- browser proof/promotion package
- provider fallback case
- action ingestion case
- timeout/cancel case

Run on stable executor lane after the refactor.

Acceptance:

- Less than 15 total runs for 10 tasks.
- Less than 10 percent non-completed runs.
- At least 50 percent lower input tokens against the INS-G006 baseline task mix.
- Zero repeated identical environment failures.
- Zero untracked/pending actions after replay.
