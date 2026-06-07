# Run Intelligence Slice 6: Improvement Experiments v1 Contract

> Status: Contract for build (INS-269)
> Last updated: 2026-06-07
> Author: Meridian (Deep Architecture Specialist)
> Source of truth: `docs/run-intelligence.md` §"Slice 6: Improvement Experiments"
> and §"Future Loop: Improvement Experiments"
> Sprint: Sprint 6 — Improvement Experiments v1 and Comparison Reports

This contract turns the Improvement Experiments slice into an implementable,
additive, local-first, governance-preserving slice. It names the exact files,
the experiment/variant/attempt/report persistence, the source and objective
rules, the variant-cap and hard-limit semantics, the isolated attempt execution
harness, the comparison report and Improve handoff governance, the redaction
boundary, the **carried-forward MCP-consumption boundary**, the blast-radius map,
the focused test list, and the **promotion-gate / Fallow decision**.

It is binding on the parallel build tasks:
- **INS-272** — Build experiment launch experience (Samantha)
- **INS-273** — Wire variant review, approvals, and limits (Samantha)
- **INS-274** — Implement isolated attempt execution harness (Ralph)
- **INS-275** — Generate comparison reports and Improve handoff (Mannie)
- **INS-276** — Integrate experiment evidence into Run Intelligence surfaces (Toby)
- **INS-277** — Update operator docs and runner boundary guidance (Scout)
- **INS-278** — Run focused automated verification (Gator)
- **INS-279** — Prepare browser proof and promotion package (Ralph)

## Operating Rule

Stable `3001` is the operator/oversight control lane only. **Do not edit
`.stable`. Do not run implementation verification against stable `3001`.** All
implementation and browser verification run on dev `3010` or another isolated
dev lane against an isolated DB. Schema is **additive only** — no destructive
rewrites of existing tables.

Experiments are **comparison-evidence generators, not silent replacements**.
The slice must satisfy the sprint's non-negotiables: experiments **do not apply
durable mutations, do not change agent defaults, do not alter templates, and do
not promote code** outside existing approval paths; **live** workspace mode is a
governed, explicit operator choice and is never the default; and HiveRunner
runners do **not** consume arbitrary external MCP tools, nor does the MCP server
expose any tool that launches, approves, or runs an experiment (§8).

The product promise (from `run-intelligence.md`):

> Improvement Experiments use Ralph Loop-style iteration to generate comparison
> evidence, not to silently replace reviewed work.

---

## 1. Grounding findings (direct read)

Verified against the working tree on branch
`codex/overseer-floating-surface-polish`, 2026-06-07.

### Persistence (`src/lib/orchestration/db.ts`)
- better-sqlite3, single synchronous DB at `MC_DATA_DIR/orchestration.db`,
  singleton via `getOrchestrationDb()`. WAL, `foreign_keys = ON`. Versioned
  runner `runOrchestrationMigrations()`,
  `schema_migrations(version,name,checksum,applied_at)`, each migration in a
  transaction, skipped if already applied.
- **Current max migration version: 118** (`version: 118`,
  `name: "improvement_recommendation_lifecycle_persistence"`, db.ts:3686–3687).
  Improvement Experiments add **v119+**. No existing table is altered in v1.
- Idempotence convention is uniform: `CREATE TABLE/INDEX/TRIGGER IF NOT EXISTS`.
- Closest precedents to copy:
  - **`eval_cases`** (v115, db.ts:3383–3471): `id TEXT PRIMARY KEY` (randomUUID),
    `company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE`, ISO
    `created_at` default `strftime('%Y-%m-%dT%H:%M:%fZ','now')`, JSON columns as
    `TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(...))`, status/enum via `CHECK
    (… IN (...))`, optional `idempotency_key` with **partial-unique** index,
    compound indexes `(company_id, <filter>, created_at DESC)`, immutability via
    a `BEFORE UPDATE … RAISE(ABORT)` trigger.
  - **`improvement_recommendations`** (v117, status enum
    `('suggested','needs-more-evidence','accepted-for-approval','dismissed','superseded','applied')`),
    **`improvement_evidence_sets`** and
    **`improvement_recommendation_approval_links`** (v118) for the link-table
    pattern Slice 6 reuses for evidence/report links.
- Every read/write service accepts an optional `db?: Database.Database` argument
  (`createEvalCase(input, db?)`, `listImproveRecommendations(slugOrId, filters?,
  db?)`). This is the seam experiments use for an isolated test DB — no new
  isolation code needed.

### Existing experiment scaffolding (INS-272 in flight — direct read)
- `src/lib/orchestration/experiment-launch.ts` **already exists** as a typed
  **view-model stub** (no persistence, no API, no execution). It is the
  authoritative source for the v1 launch vocabulary and Slice 6 persistence must
  match it, not re-invent it:
  - `ExperimentLaunchSourceKind = "eval_case" | "run_trace"` (**eval_case
    preferred**; see `preferenceCopy` and `buildRunTraceExperimentLaunchModel`).
  - `ExperimentLaunchObjectiveKey = "reduce_review_returns" |
    "improve_acceptance" | "reduce_cost" | "shorten_runtime"`.
  - `ExperimentWorkspaceModeKey = "snapshot" | "branch" | "live"` — `snapshot`
    `recommended: true`; `live` `requiresExplicitConfirmation: true`.
  - `defaultExperimentLaunchLimits()`: `variantCap` default 2 / **min 1 / max 3**;
    `attemptLimit` default 3 / min 1 / max 10; `timeboxMinutes` default 30 /
    min 5 / max 120.
  - Availability gating: Run Trace source is `disabled` until the source run is
    **terminal** *and* has a **reviewer outcome**
    (`runTraceLaunchAvailability`, `TERMINAL_RUN_STATUSES`,
    `REVIEWED_TASK_STATUSES`).
  - `buildExperimentLaunchStubRequest()` returns an `ExperimentLaunchStubRequest`
    that is currently **staged locally** ("Backend experiment launch wiring is
    pending"). Slice 6 replaces that stub with a real persisted launch (§2–§3).

### Redaction (`src/lib/orchestration/run-trace.ts`) — the security spine
- `buildRedactedRunTraceExport(input)` / `buildRunTraceViewModel(input)` are the
  **only** sanctioned paths to a shareable trace.
- Constants: `RUN_TRACE_REDACTION_POLICY = "hiverunner.run_trace_redaction.v1"`;
  `RUN_TRACE_REDACTED_EXPORT_SCHEMA = "hiverunner.run_trace_redacted_export.v1"`.
  Categories: `bearer_token`, `api_key`, `sensitive_field`, `private_credential`.
- `findRunTraceCredentialLeak(serialized)` / `assertNoRunTraceCredentialLeak()`
  and `redactRunTracePayload<T>()` are exported and reusable.
- `eval-cases.ts` re-asserts via `assertRedactedSnapshot(snapshot, serialized)`,
  which throws if schema/policy don't match or a credential pattern matches.
  **Experiments reuse this same assert on every report, snapshot, and attempt
  trace before bytes leave the process.**

### Eval cases / Run Trace source (`src/lib/orchestration/eval-cases.ts`)
- `createEvalCase(input, db?)`, `listEvalCases(companyId, filters?, db?)`.
- Eval cases store an immutable `redacted_snapshot_json` (a
  `RunTraceRedactedExport`) with `snapshotSha256`, capture quality, and review
  outcome — exactly the immutable source `experiment-launch.ts` reads via
  `OrchestrationEvalCase`. Run Trace is the secondary source.

### Improve / approval seams
- `createImproveRecommendation(input, db?)`,
  `listImproveRecommendations(slugOrId, filters?, db?)`,
  `getImproveRecommendation(slugOrId, recId, db?)`
  (`improvement-recommendations.ts`). Trigger classes
  (`improvement-recommendation-triggers.ts`): `missing_capability`,
  `missing_tool_runtime`, `repeated_review_return`, `template_drift`,
  `reviewer_request`. Slice 6 adds **no new trigger class** in the enum; it
  feeds the existing `reviewer_request` path on operator acceptance (§6).
- `acceptImprovementRecommendationsForApproval(input)`
  (`service/improvement-approval.ts`) creates an `approve_ceo_strategy` approval
  with `governance.durableStateMutated: false`, requires rollback notes and at
  least one present evidence item, and writes
  `improvement_recommendation_approval_links`. **The experiment→Improve handoff
  reuses this unchanged.**
- Approvals (`service/approval.ts`): `createApproval(input)`,
  `resolveApprovalRoute(input)`. `ApprovalType` = `hire_agent |
  approve_ceo_strategy | budget_override_required | provider_switch |
  protected_runtime_command` — **fixed CHECK enum**; Slice 6 adds **no** new
  approval type (R1).

### Isolated execution + runner contract
- Test/isolation helper: `createIsolatedOrchestrationWorkspace(options?)` in
  `src/lib/__tests__/helpers/orchestration-workspace-isolation.ts` returns
  `{ tempRoot, workspaceRoot, openClawDir, openClawWorkspaceRoot, syncDatabase,
  dispose }`.
- External runner contract: `docs/hiverunner-external-runner-contract.md` —
  stdin `hiverunner.symphony.execution.v1` (`runId`, `task`, `agent`,
  `workspace.cwd`, `prompt`), stdout (`resultText`, token counts,
  `transcriptEvents[]`). Bundled runners under `scripts/hiverunner-*-runner.mjs`.
  Attempts reuse this contract; they do **not** invent a new runner protocol.
- Engine: `src/lib/orchestration/engine/` — `action-dispatcher.ts` (~156K,
  load-bearing), `prompt-builder.ts`, `engine.ts`, `heartbeat-manager.ts`. The
  attempt harness **must not** alter the production dispatch path (§5, R2).

### MCP (Slice 5, already shipped — boundary to carry forward)
- `src/lib/orchestration/mcp/` (`server.ts`, `registry.ts`, `context.ts`,
  `resources/`, `tools/governed.ts`, `redaction.ts`, `schemas.ts`) plus
  `bin/hiverunner-mcp.ts`. The Slice 5 contract froze "expose first, consume
  later" and exactly four governed tools (`save_case`, `attach`,
  `create_recommendation`, `request_approval`). **Slice 6 adds no MCP tool and
  no consumer-MCP wiring** (§8).

### Route / nav / API patterns
- `route-paths.ts` exports `buildCanonicalEvalsPath`, `buildCanonicalEvalCasePath`,
  `buildCanonicalImprovePath`, `buildCanonicalRunTracePath`,
  `buildCanonicalTaskRunTracePath`, `buildCanonicalGoalPath`,
  `buildCanonicalTeamPath`, … Slice 6 adds **no new top-level canonical path**
  (no Experiments nav — §9).
- Company-scoped API: `src/app/api/orchestration/companies/[slug]/<feature>/route.ts`
  (mirror `…/evals/route.ts` and `…/improve/route.ts`); shared helpers in
  `api.ts` (`errorResponse`, `handleRouteError`); company resolution
  `resolveCompanyIdBySlug(slugOrId, db?)`.
- Nav: `src/components/HiveRunnerShell/Dock.tsx` `COMPANY_ITEMS` already has
  `Evals` and `Improve`. **No `Experiments` item is added** (§9).

### Dependency reality
- No new runtime dependency is required. `better-sqlite3@12.6.2`, `zod`, and the
  existing runner/engine stack cover the slice.

---

## 2. New persistence (additive, migrations v119–v122)

Four net-new tables plus one link table. No existing table is altered. The
sprint validation requires coverage of **experiment, variant, attempt, report,
source-link, limit, and evidence-link** persistence — source-link and limits are
columns on the experiment row; evidence-link is the link table.

### v119 `improvement_experiments`
```
id                     TEXT PRIMARY KEY                 -- randomUUID
company_id             TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE
project_id             TEXT REFERENCES projects(id) ON DELETE SET NULL
status                 TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
                         ('draft','variants_pending','approved','running',
                          'completed','failed','cancelled'))
source_kind            TEXT NOT NULL CHECK (source_kind IN ('eval_case','run_trace'))
source_eval_case_id    TEXT REFERENCES eval_cases(id) ON DELETE SET NULL     -- source-link
source_run_id          TEXT                                                  -- source-link (run trace)
source_task_id         TEXT REFERENCES tasks(id) ON DELETE SET NULL
source_snapshot_sha256 TEXT                             -- copied from eval case when source_kind='eval_case'
objective              TEXT NOT NULL CHECK (objective IN
                         ('reduce_review_returns','improve_acceptance',
                          'reduce_cost','shorten_runtime'))
workspace_mode         TEXT NOT NULL CHECK (workspace_mode IN ('snapshot','branch','live'))
live_confirmed         INTEGER NOT NULL DEFAULT 0       -- 0/1; must be 1 when workspace_mode='live' (§5)
limit_variant_cap      INTEGER NOT NULL CHECK (limit_variant_cap BETWEEN 1 AND 3)   -- hard limit
limit_attempt_max      INTEGER NOT NULL CHECK (limit_attempt_max BETWEEN 1 AND 10)  -- hard limit
limit_timebox_minutes  INTEGER NOT NULL CHECK (limit_timebox_minutes BETWEEN 5 AND 120) -- hard limit
created_by_user_id     TEXT
created_by_agent_id    TEXT REFERENCES agents(id) ON DELETE SET NULL
created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
idempotency_key        TEXT
```
Indexes: `(company_id, status, created_at DESC)`,
`(company_id, source_eval_case_id)`, `(company_id, source_run_id)`,
`(company_id, source_task_id)`, partial UNIQUE
`(company_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.
Experiments are **mutable** (status/limits/updated_at change), so no immutability
trigger. The CHECK ranges on the three `limit_*` columns are the **hard limit**
enforcement at the persistence layer, mirroring `experiment-launch.ts` spec
bounds; the service re-validates before insert.

### v120 `improvement_experiment_variants`
```
id                     TEXT PRIMARY KEY
experiment_id          TEXT NOT NULL REFERENCES improvement_experiments(id) ON DELETE CASCADE
company_id             TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE
ordinal                INTEGER NOT NULL                 -- 1..variant_cap; original is ordinal 0
label                  TEXT NOT NULL
is_baseline            INTEGER NOT NULL DEFAULT 0        -- 1 = the original/source run, not a new variant
dimension              TEXT NOT NULL CHECK (dimension IN
                         ('runner_or_model','agent','prompt_or_handoff','tool_setup',
                          'task_decomposition','template_capability_slot','memory_or_context'))
plan_json              TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(plan_json))   -- the proposed change
approval_state         TEXT NOT NULL DEFAULT 'proposed' CHECK (approval_state IN
                         ('proposed','approved','rejected'))
created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
UNIQUE(experiment_id, ordinal)
```
Index: `(company_id, experiment_id, ordinal)`. The `dimension` enum is exactly
the comparison axes named in `run-intelligence.md` §"Future Loop". A guard
trigger or service check enforces that the count of non-baseline `approved`
variants never exceeds the parent's `limit_variant_cap` (§4).

### v121 `improvement_experiment_attempts`
```
id                     TEXT PRIMARY KEY
experiment_id          TEXT NOT NULL REFERENCES improvement_experiments(id) ON DELETE CASCADE
variant_id             TEXT NOT NULL REFERENCES improvement_experiment_variants(id) ON DELETE CASCADE
company_id             TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE
attempt_number         INTEGER NOT NULL                 -- 1..limit_attempt_max
status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
                         ('pending','running','succeeded','failed','cancelled','timed_out'))
execution_run_id       TEXT                             -- the isolated execution_run created for this attempt (§5)
trace_link             TEXT                             -- canonical run-trace path for the attempt run
verification_json      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(verification_json)) -- external check result
metrics_json           TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metrics_json))      -- cost/tokens/duration/outcome
failure_class          TEXT
started_at             TEXT
ended_at               TEXT
created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
UNIQUE(experiment_id, variant_id, attempt_number)
```
Indexes: `(company_id, experiment_id, status)`, `(experiment_id, variant_id)`.
A service-layer guard enforces `attempt_number <= limit_attempt_max` and the
per-experiment timebox; the `timed_out` / `cancelled` statuses are first-class
(the sprint requires failure/cancel coverage). `metrics_json` and
`verification_json` are **redacted at write** (§7).

### v122 `improvement_experiment_reports` + `improvement_experiment_evidence_links`
```
-- improvement_experiment_reports
id                     TEXT PRIMARY KEY
experiment_id          TEXT NOT NULL REFERENCES improvement_experiments(id) ON DELETE CASCADE
company_id             TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE
schema                 TEXT NOT NULL DEFAULT 'hiverunner.experiment_comparison_report.v1'
redaction_policy       TEXT NOT NULL DEFAULT 'hiverunner.run_trace_redaction.v1'
report_json            TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(report_json))       -- redacted comparison
report_sha256          TEXT NOT NULL                    -- no-op / resubmission detection
conclusion             TEXT NOT NULL DEFAULT 'inconclusive' CHECK (conclusion IN
                         ('variant_better','baseline_better','inconclusive'))
accepted_state         TEXT NOT NULL DEFAULT 'unreviewed' CHECK (accepted_state IN
                         ('unreviewed','accepted','dismissed'))
linked_recommendation_id TEXT REFERENCES improvement_recommendations(id) ON DELETE SET NULL
created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))

-- improvement_experiment_evidence_links  (mirrors improvement_recommendation_approval_links)
id                     TEXT PRIMARY KEY
experiment_id          TEXT NOT NULL REFERENCES improvement_experiments(id) ON DELETE CASCADE
report_id              TEXT REFERENCES improvement_experiment_reports(id) ON DELETE CASCADE
company_id             TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE
target_kind            TEXT NOT NULL CHECK (target_kind IN ('eval_case','run_trace'))   -- where the report attaches
target_id              TEXT NOT NULL                    -- eval_case_id or run_id
href                   TEXT                             -- canonical UI deep-link
created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
UNIQUE(report_id, target_kind, target_id)
```
The report is the evidence attachment that surfaces on the **source eval case or
run trace** (§9) — never a new top-level surface. `report_sha256` lets the
existing no-op detection catch byte-identical resubmissions.

---

## 3. Source, objective, and workspace-mode rules (INS-272/273)

Carry the `experiment-launch.ts` vocabulary into persistence and the launch API
unchanged:

- **Source.** `eval_case` is preferred; `run_trace` is allowed only when the
  source run is **terminal** and **reviewed** (mirror
  `runTraceLaunchAvailability`). When `source_kind='eval_case'`, copy the eval
  case's `snapshotSha256` into `source_snapshot_sha256` so the experiment binds
  to an immutable reviewed snapshot.
- **Objective.** Exactly one of the four objective keys. The service validates
  membership and rejects unknown objectives with an `api.ts` validation envelope.
- **Workspace mode.** `snapshot` (recommended default) or `branch` run in
  isolation (§5). `live` is accepted **only** when the launch request carries an
  explicit confirmation that sets `live_confirmed = 1`; a `live` request without
  confirmation is a `validation_error`, not a silent downgrade. `live` is treated
  as governed execution.
- **Launch API (INS-272).** `POST
  /api/orchestration/companies/[slug]/experiments` creates the `draft`
  experiment from an `ExperimentLaunchStubRequest`-shaped body (now real, not
  staged). `GET …/experiments` and `GET …/experiments/[id]` read back the
  experiment, variants, attempts, and report. Service:
  `src/lib/orchestration/improvement-experiments.ts`
  (`createExperiment`, `listExperiments`, `getExperiment`, plus the variant /
  attempt / report functions in §4–§6). Client: `client.ts`
  (`createCompanyExperiment`, `listCompanyExperiments`, …); request/response
  types in `types.ts`.

---

## 4. Variant planning, caps, and approval (INS-273)

- HiveRunner proposes **one to three** variants for the chosen objective; the
  operator approves which variants run. The baseline (ordinal 0,
  `is_baseline = 1`) is the original source run and is always part of the
  comparison.
- **Hard cap.** Approved non-baseline variants must be `≤ limit_variant_cap`
  (1–3). Enforced both by the persistence guard and the service. Attempting to
  approve a fourth variant returns a `limit_exceeded` error.
- **Variant approval is not an Approvals-table approval.** It is an operator
  gate recorded as `approval_state` on the variant row, gating execution; it does
  **not** create an `approvals` record. The only thing that reaches the
  `approvals` table is the eventual **Improve handoff** (§6) and, when
  `workspace_mode='live'`, the governed live-execution confirmation. This keeps
  the load-bearing `approvals` enum and `createApproval` untouched (R1).
- An experiment moves `draft → variants_pending` once variants are proposed and
  `variants_pending → approved` once at least one variant is operator-approved
  and limits validate.

---

## 5. Isolated attempt execution harness (INS-274) — the riskiest surface

The harness runs bounded attempts in a **fresh, isolated context** and must not
mutate the source task, board, or production workspace by default.

- **Isolation by mode.**
  - `snapshot`: copy the source workspace state into a temp root (reuse the
    `createIsolatedOrchestrationWorkspace` pattern; production uses the same
    temp-root discipline). Read-only against the original.
  - `branch`: an isolated git worktree/branch under the dev lane; reversible.
  - `live`: the active workspace, **only** when `live_confirmed = 1`; treated as
    governed execution and clearly labeled higher-risk.
- **Fresh context per attempt.** Each attempt builds its prompt from the variant
  plan + the immutable source snapshot — not from accumulated prior-attempt
  state. Ralph-Loop discipline: bounded repeated attempts, fresh context,
  external verification, progress/state captured in `metrics_json` /
  `verification_json`, hard guardrails.
- **Reuse the external runner contract, do not fork it.** An attempt invokes a
  bundled runner via the existing stdin `hiverunner.symphony.execution.v1` /
  stdout (`transcriptEvents`) contract, against the isolated `workspace.cwd`.
  Each attempt creates its **own `execution_run`** row tagged as an experiment
  attempt (so Run Trace renders it) and linked via
  `improvement_experiment_attempts.execution_run_id` / `trace_link`.
- **Durable-mutation suppression (the core safety design).** Attempt runs route
  `mc-action` output through a **record-only experiment sink**: parsed actions
  are captured into the attempt trace as evidence but are **not** applied to the
  source task, board, agents, templates, runtimes, or memory. The production
  `action-dispatcher.ts` path is **not** reused for durable application during an
  experiment. Experiments never change agent defaults, alter templates, or
  promote code.
- **External verification, not self-assessment.** `verification_json` records an
  objective check (e.g. test/build result, reviewer-criteria check, cost/runtime
  delta) rather than the attempt grading itself.
- **Hard limits enforced at runtime.** `attempt_number ≤ limit_attempt_max`,
  per-experiment timebox (`limit_timebox_minutes`), and variant cap. Breaching a
  limit transitions the attempt to `timed_out`/`cancelled` and the experiment to
  `completed`/`cancelled` — never an unbounded loop.

**Stop-and-report trigger.** If isolation or durable-mutation suppression cannot
be achieved without editing the production engine loop
(`engine.ts`/`action-dispatcher.ts` dispatch path), the runner contract, or
status-transition logic, that exceeds this slice — report instead of editing
load-bearing execution code (R2).

---

## 6. Comparison report and Improve handoff governance (INS-275)

- Every experiment **always produces a comparison report** (saved to
  `improvement_experiment_reports`, redacted, `schema
  hiverunner.experiment_comparison_report.v1`). The report compares baseline vs
  approved variants on the experiment objective, with per-attempt
  cost/runtime/outcome and the external verification result.
- The report is saved as a **linked evidence attachment** on the source eval
  case or run trace via `improvement_experiment_evidence_links` (§2, §9). It does
  **not** create a top-level navigation surface.
- **Improve handoff is governed and optional.** An Improvement recommendation is
  created **only** when (a) the operator accepts the report conclusion
  (`accepted_state='accepted'`), or (b) a configured trigger threshold is met.
  Speculative experiment output must not flood Improve.
- The handoff reuses existing services unchanged:
  1. `createImproveRecommendation({ companyId, triggerKey: 'reviewer_request',
     scopeType, scopeKey, title, rationale, proposedChange, severity, confidence,
     evidence: [...report + attempt refs...] })` — status starts `suggested`;
     set `linked_recommendation_id` on the report.
  2. Promotion to a governed change goes through
     `acceptImprovementRecommendationsForApproval(...)` exactly as Slice 4 — which
     creates the `approve_ceo_strategy` approval with `durableStateMutated:false`,
     requires rollback notes, and writes the approval link. **The experiment path
     adds no new approval type and no new durable-mutation path.**
- Evidence is stored as **IDs + canonical route refs**, never inlined
  transcripts, and never written to `company_audit_events.metadata_json` raw
  (the Slice 4 R2 rule still holds).

---

## 7. Redaction boundary (INS-275/278)

**One boundary, reused, double-checked.** Comparison reports, source snapshots,
attempt traces, and any MCP-read resource (§8) must not leak credential-shaped
values.

1. **Source of truth:** `run-trace.ts` (`buildRedactedRunTraceExport`,
   `redactRunTracePayload`, `findRunTraceCredentialLeak`). The experiment layer
   writes **no** raw payload; report/metrics/verification JSON is passed through
   `redactRunTracePayload` before persist.
2. **Second-line guard:** every report and attempt-trace export re-runs
   `assertRedactedSnapshot` / `findRunTraceCredentialLeak` and **fails closed**
   (`redaction_violation`) rather than emitting a suspect payload.
3. **Parity:** attempt traces render through the same Run Trace redaction the UI
   export and eval snapshot use; a parity test diffs experiment report/attempt
   output against the redactor and asserts neither contains the credential
   fixtures (`sk-…`, `Bearer eyJ…`, `AKIA…`, PEM blocks).
4. **No new redaction logic.** If a field needs redacting, it is added to
   `run-trace.ts` (single owner), not to the experiment layer.

---

## 8. MCP boundary — carried forward unchanged (INS-277)

This is a binding non-negotiable from the sprint and from Slice 5. Slice 6
**carries forward the "no arbitrary MCP consumption" boundary** and adds a second
clause:

- **Runners do not consume arbitrary external MCP tools** to run experiments or
  attempts. No runner (Codex/Claude/Gemini/Symphony/HERMES/OpenClaw/custom) is
  wired to discover or call external MCP tools as part of experiment execution.
- **The HiveRunner MCP server exposes no tool that launches, approves, or runs an
  experiment.** `tools/list` stays the exactly-four governed Slice 5 set
  (`save_case`, `attach`, `create_recommendation`, `request_approval`). No
  `experiment.launch`, `experiment.run`, `experiment.approve`, or
  `variant.approve` tool is added.
- **Read-only experiment resources are deferred.** A future, additive
  `hiverunner.experiment.read` / `experiment.report.read` resource (redacted,
  read-only, same `links` discipline) may be added later under the Slice 5
  resource pattern, but it is **out of scope for v1** and is not required for the
  sprint. Launch/approve/run stay operator actions in the HiveRunner UI on
  stable `3001`.
- Future runner-as-client MCP usage remains evidence-only normalized trace
  events (`tool_call_start`/`tool_result`), per the Slice 5 §9 reporting
  boundary — not implemented here.

---

## 9. Run Intelligence surface integration (INS-276)

- **No top-level Experiments navigation.** `Dock.tsx` `COMPANY_ITEMS` is
  unchanged; no `buildCanonicalExperimentsPath` is added. Experiments surface
  **inside** existing surfaces:
  - The launch control lives where `experiment-launch.ts` models already render
    (Eval Case detail and reviewed Run Trace), replacing the local stub with a
    real launch.
  - The comparison report renders as an **evidence attachment** on the source
    eval case (`Evals`) and the source run trace, via the evidence-link rows.
  - Accepted conclusions appear in `Improve` as ordinary recommendations with
    experiment evidence; no parallel queue.
- Task Activity records compact, link-only events ("experiment launched",
  "comparison report saved", "recommendation created from experiment"), pointing
  at the specialized surface rather than duplicating it — consistent with the
  Run Trace Activity rule.

---

## 10. Blast-radius map

| Area | Touched? | Risk | Mitigation |
|---|---|---|---|
| `db.ts` migrations | **Yes, additive v119–v122** | low | new tables only; no existing table altered; idempotent `IF NOT EXISTS` |
| `run-trace.ts` redaction | **Read-only import** | low | reuse redactor/assert; no logic change |
| `eval-cases.ts` | import `listEvalCases`/snapshot read | low | read-only source binding |
| `improvement-recommendations.ts` / `service/improvement-approval.ts` | import create + accept-for-approval | low | handoff reuses unchanged services |
| `service/approval.ts` / `approvals` enum | **No** | none | no new approval type (R1) |
| `engine/action-dispatcher.ts`, `engine.ts` | **No edit**; attempt harness wraps runner invocation with a record-only sink | **high if violated** | stop-and-report trigger (§5, R2); production dispatch path untouched |
| External runner contract | **Reused, not forked** | low | same stdin/stdout schema |
| MCP (`mcp/**`, `bin/hiverunner-mcp.ts`) | **No** | none | no new tool/resource in v1 (§8) |
| `Dock.tsx` / `route-paths.ts` | **No new nav/path** | none | evidence-attachment surfacing only (§9) |
| Stable `3001` / `.stable` | **No** | none | dev/isolated lane only |
| `package.json` | **No new dep** | none | existing stack covers the slice |

---

## 11. Out-of-scope (enforced by sprint contract)

- No durable mutations from experiments; no change to agent defaults; no template
  alteration; no code promotion outside existing approval paths.
- `live` workspace execution is never the default and requires explicit governed
  operator confirmation.
- No generic scorer engine, hosted eval dashboard, or top-level **Experiments**
  navigation surface.
- No new `approvals.type`, no Inbox CTE branch, no audit-redaction rework.
- No arbitrary external-MCP consumption by runners; no MCP tool that launches,
  approves, or runs experiments (§8).
- No broad workspace-path cleanup or unrelated Fallow hygiene folded into this
  slice unless strictly required for promotion safety (§13).
- No `.stable` edits; no verification on stable `3001`.

---

## 12. Focused test list (INS-278)

All tests use an isolated DB via `createIsolatedOrchestrationWorkspace()` and the
`db?` service argument, wired as `test:orchestration:*` scripts (custom node
runner, `node ./scripts/run-ts-test.mjs <path>` with `ORCHESTRATION_DB_PATH`).

**A. `orchestration-experiment-persistence.test.ts`**
1. migrations v119–v122 create the four tables + the evidence-link table,
   indexes, and CHECK enums.
2. migrations are idempotent and self-heal when artifacts exist but the
   `schema_migrations` row was deleted (mirror the eval-case test).
3. persistence round-trips for **experiment, variant, attempt, report,
   source-link, limit, and evidence-link** (the sprint's named entities).
4. **limit CHECKs** reject `variant_cap` outside 1–3, `attempt_max` outside 1–10,
   `timebox` outside 5–120.

**B. `orchestration-experiment-service.test.ts`**
5. **source rules:** eval_case source binds `source_snapshot_sha256`; run_trace
   source is rejected unless terminal + reviewed.
6. **objective validation:** unknown objective → validation error; each of the
   four objectives accepted.
7. **workspace-mode rules:** `snapshot`/`branch` accepted; `live` without
   confirmation rejected; `live` with `live_confirmed=1` accepted.
8. **variant caps:** approving more than `limit_variant_cap` non-baseline variants
   → `limit_exceeded`.
9. **hard limits / lifecycle:** attempt beyond `limit_attempt_max` blocked;
   `succeeded`, `failed`, `cancelled`, and `timed_out` attempt states all persist
   and roll the experiment to a terminal status.
10. **report generation:** a completed experiment yields exactly one comparison
    report with a `conclusion` and `report_sha256`.
11. **Improve handoff governance:** no recommendation is created until
    `accepted_state='accepted'` (or a configured threshold); on accept,
    `createImproveRecommendation` + `acceptImprovementRecommendationsForApproval`
    are invoked with **evidence refs only**, and `durableStateMutated` stays
    false; rejecting/dismissing applies no durable change.

**C. `orchestration-experiment-redaction.test.ts`**
12. comparison report, source snapshot, attempt `metrics_json`/`verification_json`,
    and (if added) any MCP read **fail closed** on injected credential fixtures;
    report/attempt output is byte-parity with `buildRedactedRunTraceExport` and
    contains none of `sk-…`, `Bearer eyJ…`, `AKIA…`, PEM blocks.

**D. `orchestration-experiment-route.test.ts`**
13. `POST/GET …/experiments` happy paths + `company_not_found` and
    `validation_error` envelopes via `api.ts` helpers.

**E. Render (mirror `orchestration-evals-library-render.test.tsx`)**
14. `orchestration-experiment-launch-render.test.tsx`: launch control (objective,
    workspace-mode, limits), variant approval, attempt status, report viewing,
    and the Improve-handoff action render without hydration error and surface
    **inside** Evals/Run Trace (no top-level Experiments nav).

**Browser proof (INS-279):** on dev `3010` / isolated lane with seeded data,
prove launch → variant approval → attempt status → report viewing → Improve
handoff, with console/hydration health and **no `.stable` status/diff**.

---

## 13. Promotion-gate decision — Fallow clean / waiver / hold

**Required by INS-269 validation: state whether Sprint 6 promotion requires
Fallow cleanup or an operator waiver.**

**Decision:** Sprint 6 promotion requires `npm run fallow:changed` to pass
**clean on the new experiment files**, under the existing **new-only** gate
(`.fallowrc.jsonc → "gate": "new-only"`, i.e. `fallow audit --changed-since
origin/main`). It does **not** require clearing the pre-existing repo-wide Fallow
backlog (the ~383 dead-code findings / 2 residual circular-dependency clusters /
clone-group duplication tracked in
`docs/engineering-notes/fallow-hygiene-roadmap-2026-06-04.md`). There is **no
standing hard Fallow release hold** carried from Sprint 4 — `fallow:changed` was
a clean promotion gate there and remains one here.

**Default expectation: clean, no waiver needed.** The experiment slice is
additive (new files under `improvement-experiments.ts`, `experiment-launch.ts`,
new API routes, new tests) and should not introduce new dead code, new cycles,
or new duplication if it reuses the existing services named in this contract.

**Operator-waiver escape hatch (narrow, recorded, not silent).** A waiver is
required **only** if a new experiment file unavoidably (a) joins one of the 2
residual circular-dependency clusters, or (b) trips a clone-group/duplication
threshold that cannot be resolved without editing load-bearing code outside this
slice's blast radius (§10). In that case the implementer must **stop and report**
the specific finding in the INS-279 promotion package and request an explicit
operator waiver — promotion does not proceed on a silent pass. Folding broad
Fallow hygiene into this sprint is out of scope (§11).

**The full promotion gate (INS-278/279):** `npm run lint`, `npm run build`, the
`test:orchestration:*` suites in §12, `npm run fallow:changed` (clean-or-waived
per above), stable-lane check (no `.stable` diff), dev-lane target proof, and the
browser proof — plus the explicit Fallow clean/waiver/hold line in the package.

---

## 14. Schema registry (frozen names)

Reused (do not redefine): `hiverunner.run_trace_redaction.v1`,
`hiverunner.run_trace_redacted_export.v1`, `hiverunner.run_trace_view.v1`,
`hiverunner.improvement_approval_package.v1`, `hiverunner.improve_activity.v1`.

New (experiment-owned, additive):
`hiverunner.experiment_comparison_report.v1` (report payload),
`hiverunner.experiment_launch_request.v1` (launch API body, the realized
`ExperimentLaunchStubRequest`), `hiverunner.experiment_variant_plan.v1`
(`plan_json`), `hiverunner.experiment_attempt_metrics.v1`
(`metrics_json` + `verification_json`). All new schemas are thin envelopes over
existing service return types and redacted via the single run-trace boundary.

---

## 15. Task → contract section map

| Task | Owns | Contract sections |
|---|---|---|
| INS-272 | Launch experience + experiment create/read API + persistence v119 | §2 (v119), §3 |
| INS-273 | Variant review, approvals, limits | §2 (v120), §4 |
| INS-274 | Isolated attempt execution harness | §2 (v121), §5 |
| INS-275 | Comparison reports + Improve handoff | §2 (v122), §6, §7 |
| INS-276 | Run Intelligence surface integration | §9 |
| INS-277 | Operator docs + runner/MCP boundary guidance | §8, §11 |
| INS-278 | Focused automated verification | §12 |
| INS-279 | Browser proof + promotion package (Fallow decision) | §12 (browser), §13 |

---

*End of contract. Binding on INS-272…INS-279. Deviations require an updated
contract revision, not silent drift.*
</content>
</invoke>
