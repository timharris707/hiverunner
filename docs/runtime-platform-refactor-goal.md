# Runtime Platform Refactor Goal

Status: revised draft for operator review
Created: 2026-06-07
Updated: 2026-06-07 after independent QA review
Primary source: `docs/runtime-refactor-operational-brief.md`
Audit source: `scratch/runtime-efficiency-audit-2026-06-07/report.md` and `scratch/runtime-efficiency-audit-2026-06-07/refactor-plan.md`

## Goal statement

Refactor HiveRunner's runtime platform so CLI-backed agent work is transparent within seconds, preflighted before execution, circuit-broken on deterministic failures, durable across attempts/resumes, cancelable with clear semantics, measured with trustworthy cost and reliability metrics, action-ledgered, and benchmarked against a controlled `INS-G006`-class fixture.

This is a runtime platform blocker, not normal agent slowness or UI polish. The system must stop making operators wait multiple minutes to learn whether a CLI run is alive, stuck, blocked, failing at startup, silently wasting time, or actually making progress.

## Execution rule

Run this refactor through Codex, using sub-agents as needed for parallel implementation, review, and verification. Do not use HiveRunner orchestration to manage this work. HiveRunner is the product under repair, not the control plane for this refactor.

Here, "through Codex" means the Codex working environment coordinates the project. It does not mean every implementation, review, or verification sub-agent must use the Codex runtime provider if another available runtime is safer, cheaper, or better suited for review.

Continuity rule: if the Codex-backed CLI lane is itself the failure surface during this refactor, pause the affected slice, preserve evidence, and use another available runtime for review, verification, or narrowly scoped implementation work rather than forcing a broken runtime to repair itself blindly.

## Lane rule

Do not use `3010` for replay benchmarks or active execution. The `3010` lane is observer-only by design: `MC_ENGINE_TICK=off`, role `observer`, UI/build validation only.

Use:

- `3010` for UI truth, browser inspection, and observer validation.
- A dedicated execution-dev lane, such as `3011` or `3020`, for replay benchmarks. It must use an isolated `MC_DATA_DIR`, isolated `MC_WORKSPACE_ROOT`, distinct logs/PIDs, and explicit `MC_ENGINE_TICK=on`.
- `3001` only as stable/operator lane. Do not mutate the stable baseline DB for experimental replay benchmarks. Promote to `3001` only after the benchmark and promotion gate pass.

## Baseline and measurement corrections

The independent `3001` audit of `INS-G006` found:

- 75 completed tasks.
- 257 execution runs.
- 90 non-completed runs, or 35.0 percent.
- 26 tasks with at least one breakdown, or 34.7 percent.
- 67 tasks with multiple runs, or 89.3 percent.
- 3.43 average runs per task.
- 22.99 recorded execution hours.
- 380.4M recorded input tokens.
- 360.0M cache-read input tokens.
- Roughly 20.4M fresh input tokens in `execution_runs` after separating cache-read input from total input.
- The baseline above excludes Overseer monitoring turns. The local DB currently shows 35 `overseer_turns` with about 97.7M `inputTokens`, including about 90.0M `cacheReadInputTokens`, so final cost and monitoring metrics must include that table.
- `INS-205` repeated the same `env: node: No such file or directory` failure 31 times.
- `execution_runs` lacks explicit durable fields such as `attempt_number`, `resume_of`, `retry_policy`, and `retry_allowed`.
- Structured actions are still free-text `mc-action` blocks parsed from assistant output rather than durable pending action records.

Those numbers are useful as a pain baseline, but the refactor must not use the weak headline metrics as the final proof.

Corrected measurement rules:

- Report fresh input tokens separately from cache-read tokens. Do not treat total input tokens as cost.
- Include `overseer_turns` usage in runtime cost and monitoring metrics. Overseer cost is not fully represented in `execution_runs`.
- Track billable cost or normalized token cost by token class where available.
- Split non-completed runs into named buckets:
  - deterministic environment/preflight failures,
  - intentional operator/governance cancellations,
  - genuine runtime-quality failures.
- Reliability targets apply to genuine runtime-quality failures, not deliberate cancellations.
- Gemini or other provider runs must record non-null usage before they can be counted in token-reduction claims.
- Treat the audit CSVs as derived artifacts; the SQLite DB is the source of truth for final benchmark calculations.

## Product rule

HiveRunner must show what is happening inside a CLI-backed run quickly enough for the operator to trust the system.

Every run should emit visible runtime evidence within 10 seconds. If it cannot show meaningful progress within 60 to 120 seconds, HiveRunner should mark the run suspicious and explain what it knows.

Suspicious does not mean automatic cancellation. Automatic intervention requires a separate explicit policy, because silent-but-healthy work such as compile/install phases must not be killed incorrectly.

Meaningful progress must be an enumerated event set. Examples:

- command started,
- stdout/stderr bytes emitted,
- tool call started or ended,
- file write detected,
- test run started or finished,
- browser proof captured,
- provider/model stream event received,
- child process exited,
- task action parsed or executed.

Thinking-only or assistant-text-only deltas are useful context, but they are not sufficient by themselves to prove meaningful runtime progress.

## Scope

In scope:

- Stable executor runtime harness and provider adapters.
- Symphony/HiveRunner execution wrapper behavior.
- CLI process lifecycle, stdout/stderr capture, command lifecycle, provider stream activity, and tool-event telemetry.
- Live runtime transport and Run Trace persistence.
- `execution_runs`, `overseer_turns`, heartbeat/run events, and any companion tables needed for attempts, actions, budgets, and preflight.
- Task board cards, task detail, Run Trace, and Overseer watch mode.
- Provider/model preflight, runtime fingerprints, circuit breakers, and provider quarantine.
- Token/context budget ledger and context-reduction rules.
- Structured action ledger and replay.
- First-class screenshot/browser-proof helper, with security constraints.
- Controlled replay benchmark using an `INS-G006`-class 10-task fixture.

Out of scope:

- Adding new model providers.
- Broad visual redesign unrelated to runtime truth.
- Hosted/cloud architecture changes.
- Refactoring unrelated product areas.
- Running active execution in the observer-only `3010` lane.
- Using HiveRunner orchestration to manage this refactor.

## Sprint 0 - Measurement And Execution Lane Correction

Objective: make the goal measurable and runnable before implementing runtime changes.

Build:

- Dedicated execution-dev lane script/config for a port such as `3011` or `3020`, with isolated `MC_DATA_DIR`, `MC_WORKSPACE_ROOT`, PID/log paths, and `MC_ENGINE_TICK=on`.
- Seed/copy protocol for benchmark data that does not mutate stable `3001`.
- Baseline calculator that reads from the DB, not just CSVs, and uses the actual persisted token key contract such as `inputTokens`, `cacheReadInputTokens`, `outputTokens`, and `totalTokens`.
- Metric buckets for deterministic preflight failures, intentional cancellations, and genuine runtime-quality failures.
- Usage rollup that includes both `execution_runs` and `overseer_turns`.
- Fresh-input, cache-read, output, total, and cost-class reporting.
- Time metrics: time-to-first-evidence, time-to-meaningful-progress, time-to-detect-unhealthy, process duration, and board lifecycle.
- Runtime identity audit that catches provider/model mismatches, such as a provider column disagreeing with the runtime model label or usage blob.
- UI-truth oracle that defines a single canonical run-identity/progress record used by board cards, task detail, Run Trace, active crew counts, and engine icons.

Acceptance:

- `3010` is documented and verified as observer-only.
- A dedicated execution-dev lane can run with `MC_ENGINE_TICK=on` against isolated data.
- A benchmark report can distinguish fresh tokens from cache reads and include Overseer turns.
- Reliability reports separate intentional cancellations from runtime-quality failures.
- The old baseline can be recomputed from the copied DB without mutating stable.

## Sprint 1 - Live Runtime Transparency

Objective: make active CLI runs observable while they are running.

Build:

- Extend the existing live stream/SSE path rather than writing every runtime pulse into SQLite.
- Unify the existing live transports so CLI-backed adapters feed the same stream as gateway-backed activity instead of relying only on delayed DB polling.
- Define a per-run write budget. High-frequency stdout/stderr/tool/model telemetry should stream through memory/SSE; persist low-frequency summaries and terminal evidence.
- A normalized live runtime event model for command lifecycle, stdout tail, stderr tail, provider/model stream activity, tool calls, child-process state, and phase markers.
- A persisted `last_meaningful_progress_at` concept separate from generic heartbeat.
- Reuse and recalibrate the existing liveness layers rather than adding a disconnected watchdog path.
- Card and task-detail UI that shows the latest meaningful runtime event while the run is active.
- Run Trace integration so active-run events and terminal events share one trace story.
- Low-token Overseer watch mode that reads state deltas instead of re-reasoning over huge context.
- Retention/ring-buffer policy for live events, transcript events, Overseer turns, action-ledger rows, and context manifests, plus checkpoint/VACUUM guidance for the large local DB.
- SQLite busy-timeout policy for low-frequency persisted runtime writes. High-frequency telemetry must stay in memory/SSE; durable writes that hit the busy timeout must either retry through a bounded queue or fail the specific ledger/progress write visibly, not block the runner indefinitely.

Acceptance:

- Every CLI-backed run shows a harness lifecycle event, such as preflight passed or process spawned, within 10 seconds of admission.
- Provider-output visibility has its own SLO: p50 at or below 10 seconds and p95 at or below 30 seconds for warmed runs, with cold-start exemptions recorded explicitly.
- Task cards expose last meaningful progress while running.
- Task detail can show live stdout/stderr tail and last tool/model event.
- Overseer can answer "is this run alive?" from telemetry without a multi-million-token turn, with a configured watch-mode token ceiling.
- If no meaningful event arrives within 90 seconds, the run is visibly suspicious, not auto-cancelled.
- Live telemetry does not spam the shared synchronous SQLite connection.
- SQLite busy-timeout behavior is covered by tests for runtime progress writes and action-ledger writes.

## Sprint 2 - Preflight And Fingerprint Circuit Breakers

Objective: prevent deterministic environment failures from becoming repeated execution runs.

Build:

- Wire the existing `scripts/lib/ensure-hiverunner-node.mjs` resolver into production runner paths, not only dev/test wrappers.
- Runtime preflight before admitting a run: `node`, runner script, import graph, `.stable` integrity where relevant, `cwd`, writable directories, provider auth, selected model availability, lane health, and browser-proof capability when needed.
- Preflight result persistence by lane/provider/runtime fingerprint.
- Provider-auth preflight must be non-billable or bounded to a cheap local/CLI status check where possible. It must classify auth, network, and rate-limit failures as transient unless a deterministic local configuration problem is proven.
- Persisted preflight rows must not contain tokens, API keys, raw auth output, local secret paths beyond allowed fingerprints, or other secret-adjacent data.
- Per-task/runtime-fingerprint admission circuit breaker for deterministic failures. This must catch fan-out across many agents on the same broken runtime, not just per-agent repeated no-op loops.
- Deterministic-vs-transient failure classifier with a reset path.
- Operator-visible blocker state with reset/retry action.
- Provider quarantine rules for repeated silent-timeout or startup failures. Quarantine must be provider+model+runtime-fingerprint scoped, use verified runtime identity rather than corrupted display columns, and define both trigger and exit criteria. A recommended starting trigger is at least 3 genuine runtime-quality failures across at least 2 tasks within a bounded window, or repeated silent timeouts on the same verified provider/model. Exit requires a passing wrapper health check or operator reset.

Acceptance:

- A missing `node`, runner script, or required runtime import creates exactly one failed/circuit-open record per fingerprint.
- The queue stops before a second identical deterministic environment failure.
- `INS-205`-class repeated failure churn cannot happen.
- Transient auth/network failures do not permanently wedge the queue without operator reset.
- Provider/model selection uses verified runtime availability, not stale hard-coded labels.
- Persisted preflight results pass a secret-leak test.

## Sprint 3 - Durable Attempts, Retry, And Cancellation

Objective: make every run attempt explainable and stop duplicate or ambiguous retries.

Build:

- Prefer cheap nullable columns and/or companion tables over rebuilding large hot tables where practical.
- Durable attempt fields or companion table: `attempt_number`, `resume_of`, `failure_reason`, `retry_policy`, `retry_allowed`, `retry_decision_reason`, `preflight_result_id`, and `terminalized_by`.
- Run status state machine that mirrors the existing task status discipline instead of inventing a disconnected pattern.
- Canonicalize the existing populated `failure_class` taxonomy instead of building a parallel taxonomy. Dedupe overlapping values such as timeout, adapter timeout, and silent timeout, then enforce the canonical set with validation or a CHECK only after legacy values are migrated.
- Explicit timeout classes: queue start timeout, no-output timeout, adapter timeout, operator cancellation, task-transition cancellation, stale-process-missing, provider exit, and circuit-blocked.
- Process truth: PID, process group, child liveness, exit code, signal, cancellation actor, cancellation reason, and cancellation result.
- Startup stale-running reaper/reconciliation so migrations or restarts do not preserve orphaned running rows.
- Feature flags and kill switches for new runtime behavior.
- Deploy ordering must widen or migrate accepted status/failure values before any code path emits the new values, so mixed lanes do not reject each other's writes.

Acceptance:

- Re-running a task without explicit resume is blocked unless retry policy allows it.
- Task detail can show all attempts and why each exists.
- SIGTERM records who/what requested it and why.
- Cancellation and timeout are not inferred from the same ambiguous signal.
- Missing adapter cancellation support is fixed or exposed as a hard blocker.
- Stale PID repair does not create duplicate work without a retry decision.

## Sprint 4 - Token Budget, Cost Ledger, And Context Reduction

Objective: make HiveRunner materially more efficient using metrics that reflect real cost and work.

Build:

- Normalized usage ledger by run, Overseer turn, task, sprint, goal, provider, model, cache class, and context source.
- Per-provider token capture repair, including providers that currently record zero tokens.
- Context manifest per run with hashes, source names, byte estimates, token estimates, and source category.
- Default compact context for task execution.
- Reference handles or retrieval pointers instead of repeated full-context injection.
- Hard caps for memory/source injection with explicit opt-in for full expansion.
- Budget threshold policy: continue, ask operator, or stop queue.

Acceptance:

- Task, sprint, goal, and Overseer pages can show fresh tokens, cache-read tokens, output tokens, estimated cost, and top consumers.
- Budget threshold can block or ask before the next run starts.
- Every completed benchmark run records non-null usage for its provider.
- Replay benchmark reduces fresh/billable input per completed task by at least 50 percent versus controlled baseline.
- Large context sections are individually attributable.

## Sprint 5 - Structured Action Ledger

Objective: make agent actions durable, replayable, idempotent, and inspectable.

Build:

- Durable action ledger for parsed actions with raw text span, parsed JSON, action type, validation status, execution status, idempotency key, replay count, and terminal state.
- Compatibility parser for fenced `mc-action` blocks, but every parsed action must become a row before execution.
- Transactional/outbox semantics so parse, validation, execution, and replay states are not lost.
- SQLite busy-timeout handling for pre-execution action-ledger writes: bounded retry for recoverable contention, visible failed-ingestion state for exhausted retries, and no silent action execution without a ledger row.
- Replay endpoint/tool for pending or recoverable failed actions.
- Integration with existing idempotency/coalescing behavior.
- Explicit `parse_failed` ledger state so invalid or unparseable upstream action text is visible rather than indistinguishable from a dropped action.

Acceptance:

- No action disappears without a row and terminal ingestion state.
- Invalid JSON or validation errors are visible per run.
- Pending or recoverable actions can be replayed without replaying the whole agent run.
- Durable action ingestion adds no duplicate task mutations in replay tests.
- Unparseable action text creates a `parse_failed` row with source run and text span where available.

## Sprint 6 - Proof Tools, Benchmark, UI Truth, And Promotion Gate

Objective: make proof capture safe and prove the runtime refactor works before broad promotion.

Build:

- First-class governed screenshot/browser-proof helper that agents can invoke from tasks.
- Security guardrails for proof helper execution: scrubbed child environment, URL/path containment, allowlisted commands, audit row per invocation, and no provider secrets exposed to generated test code.
- Proof artifacts attached to tasks and Run Trace.
- Frozen representative 10-task replay fixture based on `INS-G006`: planning, route/view model, API/persistence, UI, docs, focused verification, browser proof, provider fallback, action ingestion, and timeout/cancel cases.
- Control-arm protocol: run old and new systems against the same fixture in the dedicated execution-dev lane.
- Repeat protocol: at least 3 replays per arm; report median and p95.
- Side-by-side benchmark report against the controlled baseline.
- Active crew, board card, task detail, engine icon, and Run Trace consistency checks.
- Single-source UI-truth test that diffs board cards, task detail, Run Trace, active crew counts, and engine icons against the canonical run-identity/progress record.
- Promotion gate wired into the promotion path, before stable deploy, so passing the benchmark is mechanical rather than procedural.

Acceptance:

- Simple screenshot proof can be captured and attached in under 30 seconds.
- Fewer than 15 total runs for the 10-task replay.
- Less than 1.5 runs per task.
- Genuine runtime-quality failures below 5 percent, excluding intentional governance/operator cancellations.
- At least 50 percent lower fresh/billable input per completed task versus controlled baseline.
- Improved p50/p95 time-to-first-evidence and time-to-detect-unhealthy versus controlled baseline.
- Zero repeated identical deterministic environment failures.
- Zero untracked or non-terminal parsed actions.
- Active crew counts, visible cards, task details, engine icons, Run Trace, and execution records agree.
- Execution-engine labels and icons are accurate: HiveRunner, Symphony, or manual.
- Promotion fails if any required metric is worse than the old-on-fixture median beyond measured inter-replay noise.

## Recommended sequencing

Start with Sprint 0 and Sprint 1. The first job is to make the benchmark runnable and make active runtime behavior visible. Without those, the rest of the refactor cannot be proven.

Then run Sprint 2. The `INS-205` class is high-value and likely smaller than the rest: wire the existing Node resolver into production runners, add runtime fingerprint preflight, and circuit-break deterministic admission failures.

Run Sprint 3 before broad token/context optimization so retries, resumes, and cancellations have durable semantics. Run Sprint 4 after the ledger can measure both execution runs and Overseer turns honestly. Run Sprint 5 separately from browser proof because action durability and proof capture have different risk profiles. Finish with Sprint 6 only after the execution-dev lane, metric calculators, and telemetry are stable.
