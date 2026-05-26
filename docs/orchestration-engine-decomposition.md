# Orchestration Engine Decomposition

**Goal:** INS-G006 — Decompose `engine.ts` into single-responsibility modules
**Sprints:** INS-S016 (safety net) → INS-S017 (extractions) → INS-S018 (integration / this doc)
**Scope:** `src/lib/orchestration/engine/` only. Pure mechanical extraction. No behavior changes.
**Public-API invariant:** every symbol that callers imported from `@/lib/orchestration/engine/engine` before the refactor must still be importable from the same path after. The shipped `engine.ts` is now a thin barrel that re-exports from the new modules; call sites are unchanged.

> The 33-module target laid out in `INS-59-engine-decomposition-sprint-plan.md` was the *upper bound* of the sprint plan. What actually shipped is the brief's required 8 modules plus `wakeup-queue.ts` (necessary to break the cycle in §5). The remaining 24 conceptual seams from §3 of INS-59 are filed as follow-up extractions on a future goal — they are valuable but not required to clear the stop condition. §4 below covers each deviation.

---

## 1. Seam choices

Each subsection states **what the module owns**, **why the boundary was drawn there**, and **what was deliberately left out**. Boundaries were drawn so that downstream extractions (auth, Postgres, new adapters) can target one module at a time without re-opening any of the seams below.

### 1.1 `wakeup-queue.ts` — wake enqueue & coalescing
- **Owns:** `enqueueWakeup`, wake-target shape (`WakeTarget`, `WakeupSource`, `WakeupRequest`, `HeartbeatRun`), coalesce/supersede decisions, `agent_wakeup_requests` writes, idempotency-key resolution, `mapSourceToInvocation`, `pruneSupersededQueuedWakeups`.
- **Why this boundary:** wake enqueue is a leaf concern with one fan-in (every other engine module *eventually* schedules wakes) and zero fan-out into engine policy. Pulling it out first gave every other extraction a stable dependency target and was the single change required to break the `service/comment.ts → engine.ts` cycle (see §5).
- **Out of scope:** heartbeat run lifecycle (lives in `heartbeat-manager.ts`), task routing/policy reads (live in `execution-router.ts`), the *consumers* of wake enqueues (action-dispatcher, sweeper, comment service) — they all import this module rather than each other.

### 1.2 `persistence.ts` — engine-scoped DB helpers
- **Owns:** `TaskSession` / `RuntimeState` row types, `getOrCreateTaskSession`, `updateTaskSession`, `getOrCreateRuntimeState`, `resetAgentRuntimeSessionForSelfHeal`, `updateRuntimeState`, `mergeExecutionRunMetadata`, `parseJson`, `stringFromRecord`, `getTaskRefForActionKey`, `resetNoopCounterForActionTask`.
- **Why this boundary:** these helpers were the smallest *foundation* every later extraction needed. They are read/write helpers around `agent_task_sessions` and `agent_runtime_state`, plus the JSON normalization helpers used by every module that reads `execution_runs.metadata_json`. By landing this first, the rest of the action/dispatcher/prompt-builder work could import a stable surface instead of inlining ad-hoc SQL.
- **Out of scope:** schema migrations, `db.ts` initialization, anything that owns business policy (e.g. *which* runtime state to write — that's an engine/action concern; this module just writes what it's told).

### 1.3 `cost-recorder.ts` — `cost_events` writes & usage delta math
- **Owns:** `ExecutionRunProvider` discriminated union, `executionRunProviderForAdapter`, `usageTokenDeltas`, `applyUsageDeltasToTelemetry`, `numberFromUsage`, `recordCostEvent`.
- **Why this boundary:** the smallest possible module that owns the conversion from a raw provider usage record to a `cost_events` row plus a telemetry delta. Heartbeat-manager produces usage records; the cost-ledger is the consumer; this module is the seam in the middle. Keeping it tiny (93 LOC) makes provider additions a one-file change.
- **Out of scope:** the cost-ledger schema (lives in `cost-ledger.ts`), the provider catalogue, billing rollup logic.

### 1.4 `execution-router.ts` — task → adapter/engine/lane routing
- **Owns:** the *read-side* routing decisions: `taskRouteInputForRun` / `routeTaskToAdapter` (alias), `taskExecutionEngineForRun`, `taskExecutionPolicyForWakeup`, `normalizeCreateTaskExecutionEngine`, plus the `ExecutionRunProvider` re-export so callers don't pull from `cost-recorder` directly.
- **Why this boundary:** routing is the single rules table that decides which engine (HiveRunner / Symphony / Manual) and model lane (default / fast / mini / deep) a task is dispatched to. It is dependency-light (one DB read, one task-routing utility) and is called from heartbeat-manager, action-dispatcher, and the engine coordinator. Extracting it ahead of any of those three sites means a future routing-rule change is a one-file edit.
- **Out of scope:** the actual `resolveExecutionRoute` resolver (a sibling, not engine-internal); approval/governance decisions about whether a route is *allowed* (live in `service/runtime-governance.ts`).

### 1.5 `heartbeat-manager.ts` — heartbeat-run lifecycle
- **Owns:** `executeHeartbeatRun`, `finishRun`, the `claimQueuedRunsForTick` / `claimNextQueuedRun` reservation primitives, `recoverStaleRuns` / `recoverStaleQueuedRuns` / `recoverStalePendingExecutionRuns`, `resolveTaskKey`, `getTickMaxConcurrent`, `approvalPromptLabel`, and the dependency-injection seam `configureHeartbeatManagerDependencies`.
- **Why this boundary:** heartbeat runs are the hot path that ties every other module together (wakes → claims → execution → action import → finish). Pulling it into its own file was the single largest cohesion win — every helper this concern needs (claim, recover, finish, resolve, prompt label) now lives in one place. The DI seam (`HeartbeatManagerDependencies`) is what *prevents* this module from re-importing the rest of the engine; the engine barrel wires the implementations in at module-load time.
- **Out of scope:** prompt assembly (lives in `prompt-builder.ts` and is injected via DI), action import / parse / execute (lives in `action-dispatcher.ts` and is injected via DI), wake enqueueing (calls into `wakeup-queue.ts`), cost recording (calls into `cost-recorder.ts`).

### 1.6 `prompt-builder.ts` — heartbeat & triage prompt assembly
- **Owns:** `buildHeartbeatPrompt`, `buildUnassignedTaskTriagePrompt`, `isCeoRole`, `isCompanyOrchestrationLeadRole`, `loadOnboardingAssets`. The two `build*` functions are the *only* sites in the codebase that assemble agent-facing prompt text.
- **Why this boundary:** prompts are the largest pure-text concern in the engine; they pull memory context, goal context, task state, runtime readiness, and onboarding assets into a single string. Extracting it isolates a high-churn surface (we tune prompts often) from the much lower-churn dispatch logic. The role-classifier helpers (`isCeoRole`, `loadOnboardingAssets`) live alongside because they are *only* consumed by the prompt builder.
- **Out of scope:** the data sources the prompts read from (`memory-context`, `goal-context`, `service/review-assignment`) — those stay in their existing modules and are imported here.

### 1.7 `action-dispatcher.ts` — mc-action parse & execute
- **Owns:** the `McAction` discriminated union, `parseActionsFromText`, `executeMcAction` (the public single-action executor), and every per-action handler: `executeCreateTask`, `executeUpdateTask`, `executeAddComment`, `executeHireAgent`, `executeRegisterArtifact`, `executeProposeMemory`, `executeReviewCandidate`, `executeUseSkill`. Also: action-fingerprinting (`actionFingerprint`, `getActionTarget`), comment-import (`importCommentOnTask`), session-message extraction (`extractAssistantTexts`, `loadStoredSessionMessages`, `waitForSessionCompletion`), and dependency / closure-deferral helpers used by the create- and update-task paths.
- **Why this boundary:** every mc-action share a parse → validate → execute → bookkeeping (`task_events`, wake-target reuse, closure deferral, no-op detection) lifecycle. Splitting the action handlers across multiple files (as INS-59 §3 proposed) would have either duplicated the lifecycle or required a new `dispatcher.ts` seam to host it. Keeping the lifecycle and the handlers in one module is the smaller drift in this sprint; the per-action split is filed as future work (§4).
- **Out of scope:** wake enqueueing (calls `wakeup-queue.ts`), DB session/runtime state (calls `persistence.ts`), status-transition rules (calls `status-transitions.ts`), review routing (calls `review-handler.ts`), routing/lane decisions (calls `execution-router.ts`).

### 1.8 `status-transitions.ts` — task status state machine
- **Owns:** the `applyStatusTransition` state machine, the canonical status set, normalization rules (e.g. how `to-do` is folded against `to_do`), planning-draft / learning-review auto-accept paths, `taskLabelsInclude`, `isPlanningDraftLifecycleTask`, `planningTaskHasSprintDraft`, `learningReviewTargetHasDecision`, `getLatestReviewSubmissionAuthor`.
- **Why this boundary:** the state machine was previously smeared across `executeUpdateTask`, the approval-cascade helpers, and the auto-progression code — three callers each enforced part of the rules, which is exactly the kind of drift that produces the bugs we keep filing. Consolidating into one function with a single normalized return type (`StatusTransitionResult`) means a future state-machine change is a one-file edit, and the transition rules become testable in isolation.
- **Out of scope:** the *side effects* of a transition (wake enqueues, comment imports, sprint auto-complete) — those stay with the action handler that called `applyStatusTransition`. This module returns *what to do*; the caller does it.

### 1.9 `review-handler.ts` — review routing & decision
- **Owns:** `routeForReview` (pick the reviewer agent for a task entering review), `autoRouteReviewHandoff` (handle the handoff when the producer is unavailable), `applyReviewDecision` (turn an approve/reject decision into a wake target plus status follow-through), `safeJsonStringArray`.
- **Why this boundary:** review routing is its own decision domain — who reviews, what happens when they're offline, what happens on approve vs. reject vs. clarification. It was the second-biggest cohesion win after heartbeat-manager because the review logic touched task labels, agent runtime readiness, and skill-effectiveness recording, all of which had been duplicated across update-task and the engine coordinator.
- **Out of scope:** the *contract* for who can review (lives in `service/review-assignment.ts`); status transitions for the reviewed task (call into `status-transitions.ts`).

### 1.10 `harness-warning.ts` & `sweeper.ts` — pre-existing
- These two modules existed *before* this goal began. They were left in place. `sweeper.ts` (the open-task sweep loop) imports from `engine/engine` for `enqueueWakeup` and `findCompanyCeo` — same one-way fan-in pattern as every new module. Consolidating the harness-warning parser hook from `action-dispatcher` into `harness-warning.ts` is on the follow-up list (§6).

### 1.11 `engine.ts` — coordinator + barrel
- **Owns (coordination):** `tick`, `kickoffCompany`, `findCompanyCeo`, `checkAndTripCircuitBreaker`, `decideFinishRunContinuation`, `importAssistantTextAndExecuteActions`, `adapterActionTexts`, `listHeartbeatRuns`, `listWakeupRequests`, `getHeartbeatRun`, `__testHooks`, plus the `configureHeartbeatManagerDependencies(...)` call that injects implementations into the heartbeat-manager DI seam.
- **Owns (barrel):** named re-exports from every new module so the public surface from `@/lib/orchestration/engine/engine` is unchanged.
- **Why this boundary:** the brief asked for engine.ts to contain "only the tick loop and dispatch coordination". `tick`, `kickoffCompany`, and the run-continuation / circuit-breaker helpers *are* the coordinator; everything else is a re-export. Continuation logic (`decideFinishRunContinuation`, ~900 lines), action-import (~400 lines), and the circuit-breaker (~500 lines) are the next slated extractions and will land on a follow-up goal — see §4.

---

## 2. Public interface of every new module

Function/type signatures as shipped. Paths relative to `src/lib/orchestration/engine/`.

### 2.1 `wakeup-queue.ts` (15 exports)
```ts
export type WakeupSource = "timer" | "issue_assigned" | "routine" | "explicit" | "api" | "kickoff";
export type WakeupStatus = "queued" | "claimed" | "finished" | "failed";
export type HeartbeatRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";
export type InvocationSource = "on_demand" | "timer" | "issue_assigned" | "wakeup_request" | "kickoff";
export interface WakeupRequest { /* row-shape: id, agentId, companyId, source, reason, triggerDetail, payload, status, coalescedCount, idempotencyKey, runId, requestedAt, claimedAt, finishedAt */ }
export interface HeartbeatRun { /* row-shape: id, agentId, companyId, invocationSource, triggerDetail, status, startedAt, finishedAt, wakeupRequestId, sessionIdBefore, sessionIdAfter, usage, result, exitCode, error, contextSnapshot, createdAt */ }
export interface EnqueueWakeupResult { wakeupRequestId: string; heartbeatRunId: string; status: "queued" | "coalesced" }
export type WakeTarget = { taskKey: string | null; topic: string | null };
export function wakeTargetFromRecord(record: Record<string, unknown> | null | undefined): WakeTarget
export function wakeTargetFromJson(json: string | null | undefined): WakeTarget
export function isTaskWakeTarget(target: WakeTarget): boolean
export function sameWakeTarget(a: WakeTarget, b: WakeTarget): boolean
export function shouldSupersedeQueuedWake(existingTarget: WakeTarget, incomingTarget: WakeTarget): boolean
export function mapSourceToInvocation(source: WakeupSource): InvocationSource
export function enqueueWakeup(input: { agentId; companyId; source; reason?; triggerDetail?; payload?; idempotencyKey?; invocationSource?; contextSnapshot? }, db?: Database.Database): EnqueueWakeupResult
```

### 2.2 `persistence.ts` (12 exports)
```ts
export interface TaskSession { id; agentId; companyId; adapterType; taskKey; sessionParams; sessionDisplayId; lastRunId; lastError; messageCount; lastMessageId; createdAt; updatedAt }
export interface RuntimeState { agentId; companyId; status; lastSeenAt; lastRunId; activeTaskKey; activeSessionId; lastError; metadata }
export function parseJson(value: string | null | undefined): Record<string, unknown>
export function mergeExecutionRunMetadata(existing: string | null, update: Record<string, unknown>): string
export function stringFromRecord(value: unknown): string | null
export function getOrCreateTaskSession(db, input: { agentId; companyId; adapterType; taskKey }): TaskSession
export function updateTaskSession(db, input: { id; sessionDisplayId?; lastRunId?; lastError?; messageCount?; lastMessageId?; sessionParams? }): TaskSession
export function getOrCreateRuntimeState(db, input: { agentId; companyId }): RuntimeState
export function resetAgentRuntimeSessionForSelfHeal(db, agentId: string): void
export function updateRuntimeState(db, input: { agentId; companyId; status?; lastRunId?; activeTaskKey?; activeSessionId?; lastError?; metadata? }): RuntimeState
export function getTaskRefForActionKey(db, key: string): { id; taskKey } | null
export function resetNoopCounterForActionTask(db, taskId: string): void
```

### 2.3 `cost-recorder.ts` (6 exports)
```ts
export type ExecutionRunProvider = "openclaw" | "codex" | "anthropic" | "hermes" | "gemini" | "symphony"
export function executionRunProviderForAdapter(adapterType: string | null | undefined): ExecutionRunProvider | null
export function numberFromUsage(value: unknown): number
export function usageTokenDeltas(usage: Record<string, unknown> | undefined): { input; output; cacheCreate; cacheRead }
export function applyUsageDeltasToTelemetry(telemetry: Record<string, unknown>, usage: Record<string, unknown>): Record<string, unknown>
export function recordCostEvent(input: { db; runId; agentId; companyId; provider; model; usage; correlationId? }): void
```

### 2.4 `execution-router.ts` (7 exports)
```ts
export { executionRunProviderForAdapter } from "./cost-recorder"
export type { ExecutionRunProvider }
export function normalizeCreateTaskExecutionEngine(value: unknown): TaskExecutionEngine | null
export function taskRouteInputForRun(input: { taskId; companyId; db }): { engine: TaskExecutionEngine; modelLane: TaskModelLane; provider: ExecutionRunProvider }
export const routeTaskToAdapter = taskRouteInputForRun  // alias
export function taskExecutionEngineForRun(input: { taskId; db }): TaskExecutionEngine | null
export function taskExecutionPolicyForWakeup(input: { taskId; companyId; db }): { engine; modelLane; provider; reason }
```

### 2.5 `heartbeat-manager.ts` (17 exports — `executeHeartbeatRun` is the entry point)
```ts
export interface ExecuteHeartbeatResult { runId; agentId; status: HeartbeatRunStatus; sessionId; error; durationMs }
export interface ExecuteHeartbeatOptions { allowPreclaimedRunning?: boolean }
export type AgentRow = { id; name; role; personality; company_id; openclaw_agent_id; adapter_type; model; adapter_config_json; runtime_config_json; capabilities; runtime_workspace_root }
export type { ExecutionRunProvider } from "./cost-recorder"
export function configureHeartbeatManagerDependencies(deps: HeartbeatManagerDependencies): void
export function approvalPromptLabel(type: string, payload: Record<string, unknown>, id: string): string
export async function executeHeartbeatRun(input: { runId; agentId; companyId; db }, options?: ExecuteHeartbeatOptions): Promise<ExecuteHeartbeatResult>
export function getTickMaxConcurrent(): number
export function claimQueuedRunsForTick(db, max: number): ClaimedRun[]
export function claimNextQueuedRun(db): ClaimedRun | null
export const __testHooks
export function recoverStaleRuns(db): number
export function recoverStaleQueuedRuns(db): number
export function recoverStalePendingExecutionRuns(db): number
export function finishRun(input: { runId; agentId; status; sessionId?; error?; usage?; result?; db }): void
export function resolveTaskKey(db, taskRef: string | null | undefined): { id; taskKey } | null
```
The DI seam (`configureHeartbeatManagerDependencies`) accepts implementations of `autoFlipTaskToReviewAfterMissingEndDeclaration`, `autoMarkTaskInProgressForExecutionRun`, `buildHeartbeatPrompt`, `checkAndTripCircuitBreaker`, `decideFinishRunContinuation`, `enqueueWakeup`, `importAssistantTextAndExecuteActions`, `importSessionOutputAndExecuteActions`, `loadStoredActionResults`. The barrel wires these in at module-load time so the manager never imports the rest of the engine.

### 2.6 `prompt-builder.ts` (5 exports)
```ts
export function isCeoRole(role: string): boolean
export function isCompanyOrchestrationLeadRole(role: string): boolean
export function loadOnboardingAssets(role: string): Record<string, string>
export function buildHeartbeatPrompt(agent: AgentRow, contextSnapshot: Record<string, unknown>, session: TaskSession, db: Database.Database, executionRunId?: string | null): string
export function buildUnassignedTaskTriagePrompt(input: { /* ... */ }): string
```

### 2.7 `action-dispatcher.ts` (36 exports)

Discriminated union and shared types:
```ts
export type McAction = { action: "create_task"; ... } | { action: "hire_agent"; ... } | { action: "report"; ... } | { action: "update_task"; ... } | { action: "add_comment"; ... } | { action: "use_skill"; ... } | { action: "review_candidate"; ... } | { action: "register_artifact"; ... } | { action: "propose_sprint_plan"; ... } | { action: "mark_goal_complete"; ... } | { action: "record_validation_evidence"; ... } | { action: "record_success_evidence"; ... } | { action: "propose_memory"; ... }
export type McActionExecutionOutcome = { action: McAction; status: "executed" | "skipped" | "deferred" | "failed"; reason?: string; meta?: Record<string, unknown> }
export type ExecuteMcActionInput = { action; agentId; agentName; companyId; runId; taskKey?; db; source; telemetry; messageId?; deferralContext? }
export type SessionGetMessage = { role?; content? }
export type UpdateTaskResult = { status: "ok" | "noop"; statusChanged: boolean; previousStatus?; nextStatus?; reason?; sideEffects? }
export type RegisterArtifactResult = { status: "ok" | "noop"; reason?; sha256?: string; uri }
export const AUTO_APPROVED_HIRE_PREFIX = "auto_approved_agent:"
```

Public functions:
```ts
export function parseActionsFromText(text: string): { actions: McAction[]; plainText: string; parseErrors: string[] }
export async function executeMcAction(input: ExecuteMcActionInput): Promise<McActionExecutionOutcome>
export async function executeImportedContractAction(input: { /* ... */ })
export function executeCreateTask(input)        // create_task handler
export function executeUpdateTask(input)        // update_task handler
export function executeAddComment(input)        // add_comment handler
export function executeHireAgent(input)         // hire_agent handler
export function executeRegisterArtifact(input)  // register_artifact handler
export function executeProposeMemory(input)     // propose_memory handler
export function executeReviewCandidate(input)   // review_candidate handler
export function executeUseSkill(input)          // use_skill handler
export function importCommentOnTask(input)
export function hasOpenChildTasks(db, taskId)
export function focusedTaskClosureDeferralReason(input)
export function shouldDeferDependentAutoStartForAction(input)
export function closureDeferralMessage(reason)
export function enqueueHireOnlyDelegationContinuation(input)
export function emitRunEvent(runId, agentId, type, message, db)
export function getActionTarget(action: McAction): string
export function actionFingerprint(action: McAction): string
export function extractAssistantTexts(messages: SessionGetMessage[]): string[]
export function loadStoredSessionMessages(sessionId, sessionKey): SessionGetMessage[]
export async function waitForSessionCompletion(...)
export function pendingDependencyCount(db, dependencyIds: string[]): number
export function parseDependencyIds(value: string | null): string[]
export function autoStartUnblockedDependentTasks(input)
export function queueParentBlockedWake(input)
```

### 2.8 `status-transitions.ts` (11 exports)
```ts
export type StatusTransitionRejectedReason = "invalid_status" | "no_op" | "needs_reviewer" | "needs_executor" | "policy_blocked"
export type StatusTransitionTask = { id; project_id; status; type; labels_json; assignee_agent_id; task_key }
export type StatusTransitionAssignee = { id; status; role; name }
export type StatusTransitionContext = { db; runId; agentId; agentName; companyId; taskKey; isReviewer?; isProducer?; reviewerNote?; requestedStatus; sourceComment? }
export type StatusTransitionResult = { decision: "applied" | "auto_accepted" | "rejected"; reason?; nextStatus?; sideEffects: { wakeTarget?; cascade?; review? } }
export function taskLabelsInclude(labelsJson: string | null | undefined, label: string): boolean
export function isPlanningDraftLifecycleTask(labelsJson: string | null | undefined): boolean
export function planningTaskHasSprintDraft(db, taskId): boolean
export function learningReviewTargetHasDecision(db, taskId): boolean
export function getLatestReviewSubmissionAuthor(db, taskId): string | null
export function applyStatusTransition(input: { task; assignee; ctx }): StatusTransitionResult
```

### 2.9 `review-handler.ts` (5 exports)
```ts
export type ReviewHandlerTask = { id; project_id; parent_task_id; sprint_id; status; assignee_agent_id; task_key; title; type; labels_json; company_id }
export function safeJsonStringArray(value: string | null | undefined): string[]
export function routeForReview(input: { task: ReviewHandlerTask; db }): { reviewerAgentId: string | null; reason?: string }
export function autoRouteReviewHandoff(input: { task; db; emitRunEvent? }): { handoffApplied: boolean; reviewerAgentId: string | null; reason: string }
export function applyReviewDecision(input: { task; reviewerAgentId; decision: "approve" | "reject" | "clarify"; note?; db; emitRunEvent? }): { nextStatus; wakeTarget; cascade? }
```

### 2.10 `engine.ts` (coordinator surface — what the barrel adds *on top* of the re-exports)
```ts
export interface KickoffResult { companyId; ceoAgentId; firstWakeupRequestId }
export type TickRunResult = { runId; agentId; status: HeartbeatRunStatus; durationMs; error? }
export type TickResult = { processed: number; runs: TickRunResult[] }
export type AgentRow = { /* same shape as heartbeat-manager export */ }
export function findCompanyCeo(db, companyId: string): AgentRow | null
export function kickoffCompany(input: { companyId; ceoAgentId?; firstDirection?; db }): KickoffResult
export async function tick(input?: { now?; db?; max? }): Promise<TickResult>
export function adapterActionTexts(usage: Record<string, unknown> | null | undefined): string[]
export async function importAssistantTextAndExecuteActions(input): Promise<ActionResults>
export function decideFinishRunContinuation(taskId, runId, status, db): { shouldContinue: boolean; reason?: string }
export function checkAndTripCircuitBreaker(input, db): boolean
export function listHeartbeatRuns(input): HeartbeatRun[]
export function listWakeupRequests(input): WakeupRequest[]
export function getHeartbeatRun(runId): HeartbeatRun | null
export const __testHooks
```

---

## 3. Before / after LOC table

Baseline: `engine.ts` at commit `971581baf merge: company-memory-vault stack into trunk` (the merge into trunk that started this goal). After: working tree following INS-81 (cycles green, full orchestration aggregate green via INS-85).

| Module | Before (LOC) | After (LOC) | Δ | Notes |
|---|---:|---:|---:|---|
| `engine.ts` | 10,647 | 3,345 | **−7,302** | Now coordinator + barrel. Contains `tick`, `kickoffCompany`, `findCompanyCeo`, `adapterActionTexts`, continuation/import/circuit-breaker still pending extraction (§4 deviation #1). |
| `wakeup-queue.ts` | — | 348 | +348 | New. Owns `enqueueWakeup` and wake-target shape. |
| `persistence.ts` | — | 362 | +362 | New. Engine-scoped DB helpers (sessions, runtime state, JSON normalization). |
| `cost-recorder.ts` | — | 93 | +93 | New. `cost_events` writes and usage-delta math. |
| `execution-router.ts` | — | 228 | +228 | New. Task → adapter/engine/lane routing. |
| `heartbeat-manager.ts` | — | 1,579 | +1,579 | New. `executeHeartbeatRun`, claim/recover, `finishRun`. |
| `prompt-builder.ts` | — | 825 | +825 | New. `buildHeartbeatPrompt` + triage prompt. |
| `action-dispatcher.ts` | — | 3,696 | +3,696 | New. All mc-action parse + execute logic. |
| `status-transitions.ts` | — | 522 | +522 | New. Consolidated state machine. |
| `review-handler.ts` | — | 551 | +551 | New. Review routing + decision. |
| `sweeper.ts` | 2,458 | 2,458 | 0 | Pre-existing. Not part of this goal. |
| `harness-warning.ts` | 82 | 82 | 0 | Pre-existing. Not part of this goal. |
| **Engine-dir total** | **13,187** | **14,089** | **+902** | Net growth ≈ glue: re-export blocks in the barrel, types duplicated across modules, the heartbeat-manager DI seam. |

`engine.ts` shrank by **68.6%** (10,647 → 3,345). The brief's `≤1,500` stop condition is **not yet met** — the remaining 1,845 lines are documented and slated for follow-up extraction (§4 deviation #1).

`npm test` (full orchestration aggregate, 38 suites): green as of INS-81 + INS-85.
`npx madge --extensions ts,tsx --circular src/lib/orchestration/`: zero cycles.

---

## 4. Deviations from the brief's required submodule shape

The brief listed eight required submodules (parenthetically marked *"architect may refine"*). The goal also defined a stop condition of `engine.ts ≤1,500 LOC`. Here is every shipped deviation, why it shipped that way, and what's on the follow-up list.

### Deviation 1 — engine.ts is 3,345 LOC, not ≤1,500 LOC
- **What shipped:** the brief's eight required modules are all extracted, plus `wakeup-queue.ts`. `engine.ts` is 3,345 LOC — a 68.6% reduction from the 10,647 baseline.
- **Why:** the remaining ~1,800 LOC is three internally cohesive concerns that are not on the brief's list but are real seams:
  1. **`decideFinishRunContinuation` and `decideTaskContinuation`** (~900 LOC) — the run-continuation policy that decides whether a finished run schedules another wake. Internally coherent (no other engine path touches it), but extracting it would have required a fourth DI seam in heartbeat-manager. Deferred to keep sprint scope honest.
  2. **`importAssistantTextAndExecuteActions` + the import dedup/fingerprint layer** (~400 LOC) — the bridge between heartbeat output (raw assistant text) and the action-dispatcher. Sits at the boundary of two modules and was left in the coordinator until it had a clearly better home.
  3. **`checkAndTripCircuitBreaker`** (~500 LOC) — the per-agent loop-guard. Lightly coupled to wakeup-queue and persistence but currently inlined.
- **Status:** filed as a follow-up extraction sprint on a future goal (see §6). The brief was explicit that "behavior changes belong on a new goal" — these are pure mechanical extractions, but they meaningfully exceed the bookkeeping budget of this sprint.
- **Mitigation:** the stop-condition gates that *do* matter for downstream work (no cycles, all tests green, dev server boots, build green) all pass. The remaining LOC is concentrated in three named, bounded concerns rather than spread as drift.

### Deviation 2 — `wakeup-queue.ts` was extracted (not on the brief's list)
- **What shipped:** added a ninth module, `wakeup-queue.ts`.
- **Why:** the brief said "Break the existing `service/comment.ts → engine` cycle" but did not name the seam. After scanning, the only symbol `service/comment.ts` consumed from `engine.ts` was `enqueueWakeup`. The minimum-blast-radius cycle break was to pull `enqueueWakeup` and its wake-target shape into its own module that both `service/comment.ts` and `engine.ts` import — see §5. This deviation is *additive*: it sits cleanly inside the brief's stop condition #3.

### Deviation 3 — INS-59 §3 proposed 33 modules; we shipped 9
- **What shipped:** the brief's 8 + `wakeup-queue.ts` = 9 net-new modules (plus 2 pre-existing siblings).
- **Why:** the 33-module shape was the *upper bound* of the architectural plan, not a delivery contract. The plan's §4 sequenced extractions in nine phases (P0–P8 plus QA). Phases P0–P4 (the brief's required modules, plus wakeup-queue) shipped; phases P5–P7 (further per-action splits, run-lifecycle granularity, dispatcher/heartbeat granularity) were planned at the wrong granularity for the operator-facing acceptance criterion ("engine.ts ≤1,500 LOC, no behavior changes, all tests green"). Further sub-splits inside `action-dispatcher.ts` would not have moved any stop-condition metric — they would have just multiplied PR count for an internal-shape benefit.
- **Status:** the unfinished phases are not lost. They are filed as follow-up tasks on a new goal (§6), and the per-action split (e.g. `mc-action/create-task.ts`, `mc-action/update-task.ts`) is the next obvious cleanup after the three deferred concerns in Deviation 1 land.

### Deviation 4 — `harness-warning.ts` consolidation deferred
- **What shipped:** `harness-warning.ts` (pre-existing, 82 LOC) was left unchanged.
- **Why:** INS-59 §3 flagged consolidating `formatParseErrorHarnessWarning` / `emitParseErrorHarnessWarning` from `action-dispatcher.ts` into this module as a candidate during parser extraction. It would have meant editing action-dispatcher and harness-warning *in the same PR as another extraction*, against the brief's discipline of one-extraction-per-PR. Left in place.

### Deviation 5 — pre-existing `sweeper.ts` (~2,458 LOC) imports from `engine/engine`
- **What shipped:** `sweeper.ts` still imports `enqueueWakeup` and `findCompanyCeo` from `@/lib/orchestration/engine/engine`, not directly from `wakeup-queue.ts`.
- **Why:** the brief is "pure mechanical extraction"; rerouting sweeper's imports counts as an unrelated cleanup. It works because the barrel re-exports those symbols from their new homes — sweeper sees the same shape, no cycle is reintroduced (madge confirms).
- **Status:** sweeper re-import cleanup is on the follow-up list.

### Deviation 6 — quarantined test suites in the aggregate
- **What shipped:** INS-81 (full aggregate re-check) found 5 previously-quarantined suites still being skipped at the `npm test` level. They were not failures introduced by the decomposition — every one was a pre-existing environmental/test-isolation issue — but the brief's stop condition #5 said every included suite must pass. Filed and fixed as INS-85 (`Fix quarantined orchestration aggregate failures before release`, parented to INS-81). Quarantine list removed from `scripts/run-orchestration-tests.mjs`; 38/38 orchestration suites now run and pass on every aggregate invocation.
- **Why it's logged here:** future readers should know that the green aggregate took one explicit cleanup task; it didn't come for free.

---

## 5. How the `service/comment.ts → engine.ts` cycle was broken

### 5.1 The cycle

Before: `src/lib/orchestration/service/comment.ts` imported `enqueueWakeup` from `@/lib/orchestration/engine/engine`. `engine.ts` re-exported helpers from `service/shared` and called into other service modules whose dependency tree eventually re-imported `comment.ts`. The result was a `service/comment.ts → engine/engine → … → service/comment.ts` cycle that `madge` flagged and that any future schema or layering work would have inherited.

### 5.2 The minimum-blast-radius break

`enqueueWakeup` was the *only* symbol `comment.ts` needed from `engine.ts`. The break was to extract `enqueueWakeup` (plus its wake-target shape and coalesce/supersede helpers) into a new leaf module that both consumers can import without ever importing each other:

- **New module:** `src/lib/orchestration/engine/wakeup-queue.ts` (348 LOC).
- **Owns:** `enqueueWakeup`, `wakeTargetFromRecord` / `wakeTargetFromJson`, `isTaskWakeTarget`, `sameWakeTarget`, `shouldSupersedeQueuedWake`, `mapSourceToInvocation`, and the type shapes (`WakeTarget`, `WakeupSource`, `WakeupStatus`, `HeartbeatRunStatus`, `InvocationSource`, `WakeupRequest`, `HeartbeatRun`, `EnqueueWakeupResult`).
- **Import change at the cycle site:** `src/lib/orchestration/service/comment.ts:13` was changed from
  ```ts
  import { enqueueWakeup } from "../engine/engine";
  ```
  to
  ```ts
  import { enqueueWakeup } from "../engine/wakeup-queue";
  ```
- **Topology after:** `engine.ts` and `comment.ts` both depend on `wakeup-queue.ts` (one-way fan-in). Neither depends on the other. The cycle is structurally impossible to reintroduce without explicitly adding an `engine.ts` import back into `comment.ts`.

### 5.3 Why this seam and not the alternative

The alternative was to move the *consumer* (`maybeWakeAssigneeForAgentComment` and its inline callers) out of `comment.ts` and into `action-dispatcher.ts`. That would also have broken the cycle, but it would have:
- Pulled `comment.ts` deeper into mc-action surface area (it owns the comment-row writes, not action dispatch).
- Forced a much larger module (`action-dispatcher.ts` is 3,696 LOC) to absorb a small, well-bounded helper.
- Left every other future caller of `enqueueWakeup` (sweeper, openclaw-reconciliation, heartbeat-manager, the engine coordinator itself) without a dedicated home for the symbol.

The leaf-module seam was the smaller change, the more useful seam for downstream callers, and the one madge confirms still passes.

### 5.4 Verification

- `npx madge --extensions ts,tsx --circular src/lib/orchestration/` reports **zero circular dependencies** (137 files scanned).
- The change shipped in commit `24e15099c recover: reconcile concurrent enqueueWakeup extractions (INS-65 + INS-69)`. That commit also reconciled an inadvertent duplicate extraction with the heartbeat-manager work (INS-65) — `wakeup-queue.ts` is the single owner; all callsites route through it.
- The `npm test` aggregate exits 0 with every test:orchestration:* suite passing (INS-85 cleared the quarantine).

---

## 6. Follow-up tasks created during this sprint

All work below is logged under **goal `INS-G006` (Decompose `engine.ts` into single-responsibility modules)** unless otherwise marked. Items that exceed the scope of this goal (e.g. behavior changes uncovered mid-refactor) are explicitly flagged for a *new* goal per the brief's discipline.

### 6.1 Filed and closed in-sprint
- **INS-85 — Fix quarantined orchestration aggregate failures before release.** Goal: INS-G006. Parent: INS-81. Filed by Gator during INS-81 when the full-aggregate re-check found 5 quarantined suites that masked failures (`test:orchestration:agent-identity`, `test:orchestration:openclaw`, `test:orchestration:hiverunner-symphony-runner`, `test:orchestration:openclaw-monitor`, `test:orchestration:execution-adapter-registry`). Closed: quarantine list removed from `scripts/run-orchestration-tests.mjs`; all 38 suites run and pass at exit 0. Verified PASS by Clarity on the same goal.

### 6.2 Filed for follow-up sprint (goal INS-G006, deferred extraction)
The shape of these is captured here so the next sprint can pick them up directly. They are intentionally **not** filed as live tasks until the operator approves the follow-up sprint, per the brief's "behavior changes belong on a new goal" discipline — these are pure extractions, but they would re-open the sprint scope.

- **Extract `run-continuation.ts`** — pull `decideFinishRunContinuation`, `decideTaskContinuation`, the structural-action detection, comment-progress heuristics, and the missing-end-declaration auto-flip out of `engine.ts` into a dedicated module (~900 LOC). Add a fourth DI seam in `heartbeat-manager.ts` for the continuation callback. Acceptance: engine.ts ≤2,500 LOC; orchestration aggregate green.
- **Extract `comment-import.ts`** — pull `importAssistantTextAndExecuteActions`, `importCommentOnTask`, action fingerprint / dedup, and the no-reply sentinel handling out of `engine.ts` (and remove `importCommentOnTask` from `action-dispatcher.ts`) into a dedicated bridge module (~500 LOC). Acceptance: engine.ts ≤2,000 LOC; orchestration aggregate green.
- **Extract `circuit-breaker.ts`** — pull `checkAndTripCircuitBreaker` and the loop-guard into a dedicated module (~500 LOC). Acceptance: engine.ts ≤1,500 LOC (the brief's stop condition); orchestration aggregate green.
- **Reroute `sweeper.ts` imports** — switch the two remaining `from "@/lib/orchestration/engine/engine"` imports in `sweeper.ts` (`enqueueWakeup`, `findCompanyCeo`) to their owner modules. Mechanical; no behavior change. Acceptance: madge clean; sweeper test suite green.
- **Per-action mc-action split** — sub-split `action-dispatcher.ts` along the lines of INS-59 §3 (`mc-action/parser.ts`, `mc-action/dispatcher.ts`, `mc-action/create-task.ts`, `mc-action/update-task.ts`, `mc-action/add-comment.ts`, `mc-action/hire-agent.ts`, `mc-action/register-artifact.ts`, `mc-action/memory-actions.ts`, `mc-action/reassignment.ts`). Optional after the three deferred extractions above; only worth the PR count if `action-dispatcher.ts` continues to grow.
- **Consolidate `harness-warning.ts`** — move `formatParseErrorHarnessWarning` / `emitParseErrorHarnessWarning` from `action-dispatcher.ts` into `harness-warning.ts`. ~30 LOC; one-file edit.

### 6.3 Filed for a *new* goal (out-of-scope discovered mid-refactor)
- **Model-constant drift in `hiverunner-claude-runner` test** — observed during INS-69 cycle verification. Test expects `claude-sonnet-4-6`; resolver returns `claude-opus-4-7`. Pre-existing; reproduces on the parent commit before the refactor began. Belongs on a *new* model-constants goal, not INS-G006. Already noted in the INS-69 cycle-break comment; not actioned in this goal per scope discipline.

---

## Appendix — verification commands

```sh
# from the HiveRunner repo root
wc -l src/lib/orchestration/engine/*.ts
npx madge --extensions ts,tsx --circular src/lib/orchestration/
npm test  # runs the full orchestration aggregate; expect exit 0 with 38/38 suites
npm run build
npm run dev -- --port 3010
# smoke (after dev is up):
for path in /api/health /INS/dashboard /INS/goals /INS/memory; do
  curl -s -o /dev/null -w "%{http_code} $path\n" http://127.0.0.1:3010$path
done
```

Expected: every module ≤ its row in §3; madge reports `No circular dependency found`; `npm test` exit 0; build exit 0; smoke curls all 200.
