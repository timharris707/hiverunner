# Run Intelligence Slice 4: Improve v1 Implementation Contract

> Status: Contract for build (INS-245)
> Last updated: 2026-06-07
> Author: Meridian (Deep Architecture Specialist)
> Source of truth: `docs/run-intelligence.md` §"Slice 4: Improve v1 And Improvement Review"

This contract turns the Improve v1 strategy into an implementable, additive,
rollback-safe slice. It names exact files, the recommendation schema, trigger
classes, evidence payloads, the approval-package bridge, rollback posture,
high-blast-radius risks, out-of-scope boundaries, and the focused test list.

It is binding on the parallel build tasks: INS-249 (APIs/client), INS-250 (queue
UI/nav), INS-251 (contextual surfaces), INS-252 (approval bridge), INS-253
(trigger controls/suppression), INS-254 (Activity/audit), INS-255 (gates),
INS-256 (browser proof/promotion).

## Operating Rule

Stable `3001` is the operator/oversight control lane only. **Do not edit
`.stable`. Do not run implementation verification against stable `3001`.** All
implementation and browser verification run on dev `3010` or another isolated
dev lane. Schema is additive only — no destructive rewrites of existing tables.

---

## 1. Grounding findings (CodeGraph / Fallow / direct read)

Verified against the working tree on branch `codex/overseer-floating-surface-polish`.

### Persistence (direct read: `src/lib/orchestration/db.ts`)
- better-sqlite3, single DB at `MC_DATA_DIR/orchestration.db`.
- Versioned migration runner: `runOrchestrationMigrations()` (db.ts:5192),
  `schema_migrations(version,name,checksum,applied_at)`, each migration in a
  transaction, skipped if already applied. **Current max version: 116**
  (db.ts:3473). Improve adds **v117+**.
- Idempotence convention is uniform: `CREATE TABLE/INDEX/TRIGGER IF NOT EXISTS`.
- Closest precedent to copy is **`eval_cases`** (migration v115, db.ts:3386–3471):
  `id TEXT PRIMARY KEY` (randomUUID), `company_id TEXT NOT NULL REFERENCES
  companies(id) ON DELETE CASCADE`, ISO `created_at` default
  `strftime('%Y-%m-%dT%H:%M:%fZ','now')`, JSON columns as
  `TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(...))`, status as a `CHECK (… IN
  (...))` enum, optional `idempotency_key` with partial-unique index, compound
  indexes `(company_id, <filter>, created_at DESC)`, immutability via a
  `BEFORE UPDATE … RAISE(ABORT)` trigger.
- **No `suppression`, `trigger`, or `*_history` tables exist yet.** Improve
  introduces them net-new (additive, zero migration risk to existing data).

### API / client contract (direct read)
- Company-scoped routes live under
  `src/app/api/orchestration/companies/[slug]/<feature>/route.ts`.
  Mirror `…/evals/route.ts`.
- Shared helpers: `src/lib/orchestration/api.ts` — `errorResponse(status,code,
  message,details?)`, `handleRouteError(error,context)`, `OrchestrationApiError`.
- Company resolution: `resolveCompanyIdBySlug(slugOrId, db?)` →
  `ResolvedCompanyIdentity` (`src/lib/orchestration/company-resolver.ts:22`).
- Service layer pattern: `src/lib/orchestration/eval-cases.ts` exports
  `createEvalCase` / `listEvalCases(companyId, filters, db)`.
- Typed client fetcher: `src/lib/orchestration/client.ts`
  (`listCompanyEvalCases(slug, filters)`); request/response types in
  `src/lib/orchestration/types.ts`.
- Nav: `src/components/HiveRunnerShell/Dock.tsx` `COMPANY_ITEMS` (~line 199) +
  route mapper (~line 858); path builder in
  `src/lib/orchestration/route-paths.ts` (`buildCanonicalEvalsPath` precedent).

### Governance seams (direct read)
- **Approvals:** `src/lib/orchestration/service/approval.ts` — `createApproval({
  companyIdOrSlug, type, requestedByAgentId?, approverAgentId?, payload?,
  linkedTaskId?, db? })` inserts a `pending` row, dedups, auto-routes
  (`resolveApprovalRoute` 507–607), enqueues approver wake. Statuses: `pending`,
  `revision_requested`, `approved`, `rejected`, `cancelled`.
  **`approvals.type` is a fixed CHECK enum** (db.ts:1665):
  `('hire_agent','approve_ceo_strategy','budget_override_required',
  'provider_switch','protected_runtime_command')`. Link to task is
  `linked_task_id` (FK to `tasks.id`), resolvable by key via
  `resolveApprovalByTaskKey`.
- **Inbox:** derived, not a table — `buildInboxFeedCte()` in
  `company-service.ts` UNIONs approvals automatically; read state in
  `inbox_read_state`. **An accepted recommendation that becomes an approval shows
  in Inbox for free.**
- **Activity/Audit:** `src/lib/orchestration/service/audit.ts`
  `recordCompanyAuditEvent({ companyId, eventType, agentId?, taskId?,
  approvalId?, actorUserId?, metadata? })` → `company_audit_events`.
  Activity feed events in `service/activity.ts` carry `taskId`/`taskKey`.
  **Note:** audit `metadata_json` is stored un-redacted today — Improve must not
  put raw evidence/secrets there (see §4).

### CodeGraph blast radius
- `codegraph callers createApproval` → 15 callers; `codegraph impact
  createApproval` → **41 affected symbols**. `createApproval` and the `approvals`
  table are load-bearing. The Improve bridge must **call `createApproval`
  unchanged** and must **not** alter its signature or the approvals CHECK enum in
  v1 (see §6 risk R1).
- `npm run fallow:changed` baseline: clean for this lane (no Improve files exist
  yet); rerun after each build task lands.

---

## 2. New persistence (additive, migrations v117–v119)

Three net-new tables. No existing table is altered in v1.

### v117 `improvement_recommendations`
```
id                     TEXT PRIMARY KEY                 -- randomUUID
company_id             TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE
project_id             TEXT REFERENCES projects(id) ON DELETE SET NULL
status                 TEXT NOT NULL CHECK (status IN
                         ('suggested','needs_more_evidence','accepted_for_approval',
                          'dismissed','superseded','applied'))
trigger_class          TEXT NOT NULL                    -- see §3 enum
recommendation_type    TEXT NOT NULL CHECK (recommendation_type IN
                         ('missing_skill','missing_tool_or_runtime','suggested_agent_role',
                          'bench_or_exclude_agent','template_capability_slot','reviewer_note'))
severity               TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical'))
confidence             REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1)
title                  TEXT NOT NULL
rationale              TEXT NOT NULL                    -- "why this exists" (exit criterion)
proposed_change_json   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(proposed_change_json))
affected_surfaces_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(affected_surfaces_json))
evidence_json          TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(evidence_json))  -- redacted, see §4
generated_text         TEXT NOT NULL                    -- original model output, immutable record
operator_text          TEXT                             -- editable operator version (null until edited)
rollback_notes         TEXT                             -- correction/rollback guidance
dismissal_category     TEXT CHECK (dismissal_category IS NULL OR dismissal_category IN
                         ('not_useful','already_done','wrong','defer','duplicate'))
suppression_fingerprint TEXT NOT NULL                   -- stable hash; drives repeat-suppression (§3)
linked_approval_id     TEXT REFERENCES approvals(id) ON DELETE SET NULL  -- set on accept (§5)
superseded_by_id       TEXT REFERENCES improvement_recommendations(id) ON DELETE SET NULL
source_eval_case_id    TEXT REFERENCES eval_cases(id) ON DELETE SET NULL
source_run_id          TEXT
source_task_id         TEXT REFERENCES tasks(id) ON DELETE SET NULL
source_agent_id        TEXT REFERENCES agents(id) ON DELETE SET NULL
idempotency_key        TEXT
created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
```
Indexes: `(company_id, status, created_at DESC)`, `(company_id, trigger_class,
created_at DESC)`, `(company_id, recommendation_type, created_at DESC)`,
`(company_id, source_task_id)`, `(company_id, source_eval_case_id)`, partial
UNIQUE `(company_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.
Recommendations are **mutable** (status/operator_text/updated_at change), so no
immutability trigger — unlike `eval_cases`. `generated_text` is write-once by
convention (enforced in the service layer, not a DB trigger, to keep edits cheap).

### v118 `improvement_trigger_state`
Per-company control of built-in trigger classes (enable/disable + company pause)
and a bounded firing log.
```
id            TEXT PRIMARY KEY
company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE
trigger_class TEXT NOT NULL                  -- §3 enum
enabled       INTEGER NOT NULL DEFAULT 1     -- 0/1
last_fired_at TEXT
fire_count    INTEGER NOT NULL DEFAULT 0
created_at    TEXT NOT NULL DEFAULT (...)
updated_at    TEXT NOT NULL DEFAULT (...)
UNIQUE(company_id, trigger_class)
```
Company-wide pause is a single settings flag
(`companies.settings_json → improve.paused`), not a row, to match existing
governance-settings convention (`governance.hiring.autoApproveNewHires`).
Recent firings for the UI read from `improvement_recommendations.created_at`
grouped by `trigger_class` — no separate event table needed in v1.

### v119 `improvement_suppressions`
```
id              TEXT PRIMARY KEY
company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE
fingerprint     TEXT NOT NULL                 -- matches suppression_fingerprint
reason          TEXT NOT NULL CHECK (reason IN ('dismissed','applied'))
source_recommendation_id TEXT REFERENCES improvement_recommendations(id) ON DELETE SET NULL
suppressed_until TEXT                          -- null = until new evidence
created_at      TEXT NOT NULL DEFAULT (...)
UNIQUE(company_id, fingerprint)
```
Suppression check on generation: a candidate whose `suppression_fingerprint`
matches an active row is dropped (or written as `needs_more_evidence` only if its
evidence set changed — see §3). This satisfies the exit criterion "dismissed
recommendations suppress repeats until new evidence appears."

---

## 3. Trigger classes and suppression semantics

Built-in, named, **no custom trigger builder** (out of scope). v1 enum:

| `trigger_class`            | Fires from                                              |
|----------------------------|---------------------------------------------------------|
| `review_returned_or_rejected` | eval case with outcome `returned`/`rejected`/`blocked` |
| `recurring_failure_pattern`   | repeated failed/returned runs for one agent/template   |
| `missing_capability`          | run evidence shows a needed skill/tool/runtime absent  |
| `template_fit_signal`         | template/task-type mismatch surfaced in review         |
| `manual`                      | operator-created recommendation                        |

`suppression_fingerprint = sha256(company_id | recommendation_type |
normalized target key | trigger_class)`. The fingerprint is **evidence-independent**
so repeats collapse; the **evidence set hash** is stored inside `evidence_json`
so a materially new evidence set can re-open a suppressed item as
`needs_more_evidence` rather than silently resurfacing.

---

## 4. Evidence payload shape (redacted)

`evidence_json` is the explainability backbone ("Improve can explain why each
recommendation exists"). Shape:
```jsonc
{
  "schema": "hiverunner.improvement_evidence.v1",
  "evidenceSetHash": "<sha256 of normalized evidence>",
  "items": [
    { "kind": "eval_case", "id": "...", "outcome": "returned", "ref": "/…/evals/<id>" },
    { "kind": "run_trace", "runId": "...", "captureQuality": "partial", "ref": "/…" },
    { "kind": "review_note", "text": "<redacted>", "reviewerName": "..." }
  ],
  "redaction": { "policy": "hiverunner.run_trace_redaction.v1", "redactedCount": 0 }
}
```
**Redaction rule:** reuse the Run Trace redactor
(`buildRedactedRunTraceExport` / patterns in
`src/lib/orchestration/run-trace.ts`) on any free-text or trace-derived field
before persisting. Evidence references are stored as IDs + canonical route refs,
not inlined transcripts. **Never write raw evidence into approval payloads or
`company_audit_events.metadata_json`** (audit is un-redacted today) — store an ID
+ ref and let the consumer fetch through the redacted read path.

---

## 5. Approval-package bridge (accept → governed approval)

Accepting a recommendation must flow through **existing** governance unchanged.

Decision (v1, lowest blast radius): **reuse `createApproval` with existing
approval types** — do **not** add a new `approvals.type` enum value in v1 (that
requires a SQLite table rebuild of a 41-symbol load-bearing table; deferred, see
R1). Map recommendation_type → existing approval type:

| recommendation_type        | approval `type`            |
|----------------------------|----------------------------|
| `suggested_agent_role`     | `hire_agent`               |
| `missing_tool_or_runtime`  | `protected_runtime_command`|
| `missing_skill`            | `protected_runtime_command`|
| `bench_or_exclude_agent`   | `protected_runtime_command`|
| `template_capability_slot` | `protected_runtime_command`|
| `reviewer_note`            | no approval — applied as a note via existing review/eval path |

Bridge service `acceptRecommendation(recommendationId, db)`:
1. Build a **draft approval package** in `payload`:
   `{ source: "improve", improvementRecommendationId, recommendationType,
   severity, rationale, proposedChange, evidenceRefs, rollbackNotes,
   preview/diff? }`. Evidence is refs only (§4).
2. `createApproval({ companyIdOrSlug, type, payload, linkedTaskId, db })`.
3. Set `improvement_recommendations.linked_approval_id` and status
   `accepted_for_approval`; write a suppression row (`reason:'applied'` is set
   only after the approval is *approved*, via the cascade below).
4. `recordCompanyAuditEvent({ eventType:'improvement.accepted_as_approval',
   approvalId, taskId, metadata:{ improvementRecommendationId } })` — IDs only.
5. The approval appears in **Inbox** automatically (CTE union). Link-back
   (Approvals/Inbox → Improve) is the `payload.improvementRecommendationId`,
   rendered as a contextual link on the approval detail.

On approval decision, a cascade (mirror `cascadeApprovalDecisionToLinkedTask`)
moves the recommendation: `approved → applied` (+ suppression `applied`),
`rejected → dismissed`. **Improve never applies a durable change itself** — the
existing approval execution path does, exactly as today. This satisfies "accepted
recommendations flow through existing approvals" and "critical recommendations
become visible without bypassing governance."

---

## 6. High-blast-radius risks

- **R1 — approvals.type enum (db.ts:1665).** Adding `improvement_recommendation`
  as a first-class type needs a CHECK-constraint table rebuild of `approvals`
  (load-bearing, 41 symbols via `createApproval`). **Mitigation:** v1 reuses
  existing types (§5) + a `payload.source:"improve"` discriminator. New type is
  explicitly deferred.
- **R2 — un-redacted audit metadata.** `company_audit_events.metadata_json` is
  stored raw. **Mitigation:** Improve writes only IDs/refs to audit + approval
  payloads (§4). Enforced by a focused test asserting no secret/transcript text
  lands in either.
- **R3 — Inbox CTE coupling.** Improve relies on the approvals branch of
  `buildInboxFeedCte`. **Mitigation:** no CTE change in v1 — recommendations
  reach Inbox only as approvals, never as a new union branch (deferred).
- **R4 — suppression starvation.** A too-broad fingerprint hides genuinely new
  problems. **Mitigation:** evidence-set hash re-opens as `needs_more_evidence`
  (§3); covered by test.
- **R5 — `createApproval` dedup.** It dedups by type+linked_task; an accepted
  recommendation on a task that already has a pending approval of the same type
  could collide. **Mitigation:** include `improvementRecommendationId` in the
  dedup fingerprint path or assert distinct linkage in the bridge; covered by
  test.

---

## 7. Out-of-scope (enforced by sprint contract)

- No auto-apply of durable role/template/runner/model/skill/filesystem changes.
- No custom trigger builder / automation rule editor.
- No scorecards, leaderboards, eval reruns, MCP work, or Improvement Experiments.
- No bypass of approval governance or `autoApproveNewHires`.
- No new `approvals.type` value, no Inbox CTE branch, no audit-redaction rework
  in v1 (all deferred per R1–R3).
- No `.stable` edits; no verification on stable `3001`.

---

## 8. Exact focused tests

New runner files under `src/lib/__tests__/`, wired as `test:orchestration:*`
scripts (custom node runner, `createTestRunner`, isolated DB via
`createIsolatedOrchestrationWorkspace`). Run a single file with
`node ./scripts/run-ts-test.mjs <path>` (with `ORCHESTRATION_DB_PATH` set).

**A. `orchestration-improvement-recommendation-persistence.test.ts`**
1. migration v117–v119 create tables, indexes, and CHECK enums
2. migrations are idempotent + self-heal when artifacts exist but the
   `schema_migrations` row was deleted (mirror eval-case test)
3. create recommendation in each status; status transitions
   suggested→needs_more_evidence→accepted_for_approval→applied,
   suggested→dismissed, →superseded
4. suppression: dismissed item's fingerprint blocks an identical repeat
5. suppression re-open: changed evidence-set hash yields
   `needs_more_evidence`, not a silent duplicate
6. **redaction:** persisted `evidence_json` contains no secret/transcript text
   (reuse run-trace secret fixtures)

**B. `orchestration-improvement-recommendation-route.test.ts`**
7. list endpoint filters by status, trigger_class, recommendation_type, project
8. edit (operator_text), dismiss (with category), suppress endpoints
9. company-not-found + validation error envelopes via `api.ts` helpers

**C. `orchestration-improvement-approval-bridge.test.ts`**
10. accept → `createApproval` called with the mapped existing type + draft
    package; recommendation gets `linked_approval_id` + `accepted_for_approval`
11. governance denial path: approval `rejected` cascades recommendation →
    `dismissed`; **no durable change applied**
12. governance success path: approval `approved` cascades → `applied` +
    suppression `applied`
13. audit + Inbox: `recordCompanyAuditEvent` fired with IDs only; approval
    surfaces in `listCompanyInbox`; link-back id present in payload
14. dedup guard (R5): accepting two distinct recommendations on one task does
    not collapse into one approval

**D. `orchestration-improvement-trigger-controls.test.ts`**
15. enable/disable a trigger_class; company pause suppresses generation
16. recent-firings read returns expected grouping

**E. Render (mirror `orchestration-evals-library-render.test.tsx`)**
17. `orchestration-improve-queue-render.test.tsx`: queue filtering, evidence
    detail, edit/dismiss/suppress, accept-to-approval, contextual links render
    without hydration error.

Promotion gates (INS-255/256): `npm run lint`, `npm run build`, the five
`test:orchestration:*` scripts above, `npm run fallow:changed`, stable-lane
check (no `.stable` diff), browser proof on `3010` with console/hydration health.

---

## 9. File manifest for implementers

Create (additive):
- `src/lib/orchestration/db.ts` — migrations v117–v119 (append to MIGRATIONS).
- `src/lib/orchestration/improvement-recommendations.ts` — service
  (`createRecommendation`, `listRecommendations`, `updateRecommendation`,
  `dismissRecommendation`, `acceptRecommendation`, suppression + fingerprint).
- `src/app/api/orchestration/companies/[slug]/improve/route.ts` (+ subroutes for
  accept/dismiss/suppress/trigger-state).
- `src/lib/orchestration/types.ts` — request/response + record interfaces.
- `src/lib/orchestration/client.ts` — `listCompanyImprovements(slug, filters)` etc.
- `src/lib/orchestration/route-paths.ts` — `buildCanonicalImprovePath`.
- `src/components/HiveRunnerShell/Dock.tsx` — `Improve` nav item + route case.
- `src/app/[companyCode]/improve/…` — queue page + contextual surfaces.
- `src/lib/__tests__/orchestration-improvement-*.test.ts(x)` — §8 suites.

Touch (minimal, behavior-preserving):
- approval bridge calls `createApproval` **unchanged**; cascade mirrors
  `cascadeApprovalDecisionToLinkedTask` without altering it.

Do not touch in v1: `approvals` table schema, `buildInboxFeedCte`, audit
redaction posture, `createApproval` signature.
