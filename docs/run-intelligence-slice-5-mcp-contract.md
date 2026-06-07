# Run Intelligence Slice 5: HiveRunner MCP Server v1 Contract

> Status: Contract for build (INS-259)
> Last updated: 2026-06-07
> Author: Meridian (Deep Architecture Specialist)
> Source of truth: `docs/run-intelligence.md` §"Slice 5: HiveRunner MCP Server"
> Sprint: Sprint 5 — HiveRunner MCP Server

This contract turns the MCP slice strategy into an implementable, additive,
local-first slice. It names the exact server location, transport, dependency
strategy, MCP resource set and schemas, governed tool set and schemas, the
redaction boundary, the approval-governance calls, the blast-radius map, the
out-of-scope consumer-MCP boundary, and the focused test list.

It is binding on the parallel build tasks:
- **INS-260** — Build local MCP server scaffold and registry (Mannie)
- **INS-261** — Expose redacted read resources (Mannie)
- **INS-262** — Expose governed MCP tools (Mannie)
- **INS-263** — Add MCP redaction and evidence export parity (Clarity)
- **INS-264** — Document runner MCP usage reporting boundary (Scout)
- **INS-265** — Create MCP smoke client and focused tests (Gator)
- **INS-266** — Prepare operator MCP usage guide (Scout)
- **INS-267** — MCP verification and promotion package (Gator)

## Operating Rule

Stable `3001` is the operator/oversight control lane only. **Do not edit
`.stable`. Do not run implementation verification against stable `3001`.** All
implementation and verification run on dev `3010` or an isolated lane against an
isolated DB. The MCP server is **read-mostly + governed-write only**; it adds
**zero new persistence** and **zero new migrations** — it wraps existing
services. Every state-changing tool routes through the existing approval
governance and never mutates durable state directly.

The slice is **server-side only**: HiveRunner *exposes* an MCP control-plane
server. It does **not** turn HiveRunner runners into MCP *clients* that consume
arbitrary external MCP tools. See §9.

---

## 1. Grounding findings (direct read)

Verified against the working tree on branch `codex/overseer-floating-surface-polish`,
2026-06-07.

### Persistence (`src/lib/orchestration/db.ts`)
- better-sqlite3, single synchronous DB at `MC_DATA_DIR/orchestration.db`,
  singleton via `getOrchestrationDb()` (db.ts:5432). WAL, `foreign_keys = ON`.
- Current **max migration version: 118**. Improve (Slice 4) shipped its tables
  (`improvement_recommendations`, `improvement_suppressions`,
  `improvement_trigger_firings`, `improvement_recommendation_approval_links`,
  `improvement_evidence_sets`, etc.). **MCP adds no migrations.**
- Every read/write service already accepts an optional
  `db?: Database.Database` argument (e.g. `createEvalCase(input, db?)`,
  `listImproveRecommendations(companyIdOrSlug, filters?, db?)`). This is the seam
  the MCP server uses for an isolated test DB — no new isolation code needed.
- Test isolation helper: `createIsolatedOrchestrationWorkspace()` and
  `resetSqliteDatabaseFiles()` in
  `src/lib/__tests__/helpers/orchestration-workspace-isolation.ts`.

### Redaction (`src/lib/orchestration/run-trace.ts`) — the security spine
- `buildRedactedRunTraceExport(input: RunTraceEvidenceInput): RunTraceRedactedExport`
  is the **only** sanctioned path to a shareable trace.
- Redaction policy constant: `RUN_TRACE_REDACTION_POLICY =
  "hiverunner.run_trace_redaction.v1"`; export schema:
  `RUN_TRACE_REDACTED_EXPORT_SCHEMA = "hiverunner.run_trace_redacted_export.v1"`.
- Categories: `bearer_token`, `api_key`, `sensitive_field`, `private_credential`.
  Six API-key regexes (`sk-…`, `ghp_/gho_/…`, `AIza…`, `AKIA…`, `xox[baprs]-…`,
  `(api|secret|token|key)_…`) plus PEM private-key blocks and `Bearer …`.
- Field-name redaction via `isSensitiveFieldName()` with a `SAFE_FIELD_NAMES`
  allowlist (`key`, `taskkey`, `runid`, `id`, `publickey`, …).
- `eval-cases.ts` independently re-asserts the redaction contract:
  `assertRedactedSnapshot()` throws if `schema`/`policy` don't match or if a
  `CREDENTIAL_PATTERNS` regex matches the serialized snapshot. **MCP reuses this
  same assert pattern as a second-line guard on every export.**

### Approval governance (`src/lib/orchestration/service/approval.ts`, types.ts)
- `ApprovalType = "hire_agent" | "approve_ceo_strategy" |
  "budget_override_required" | "provider_switch" | "protected_runtime_command"`.
- `ApprovalStatus = "pending" | "revision_requested" | "approved" | "rejected"
  | "cancelled"`.
- `createApproval(input) → { approval }`, `getApproval(id, db?)`,
  `listApprovals(input)`, `updateApprovalStatus(input)`, `resolveApprovalRoute(input)`.
- Improve→approval bridge (`service/improvement-approval.ts`):
  `acceptImprovementRecommendationsForApproval(input)` creates an
  `approve_ceo_strategy` approval with `governance.durableStateMutated: false`
  and package schema `hiverunner.improvement_approval_package.v1`.
- Activity audit: `recordImproveActivity()` (`service/improvement-provenance.ts`)
  writes `company_audit_events` with schema `hiverunner.improve_activity.v1`.

### Service read surface (already exists, returns plain JSON)
- Run Trace: `buildRunTraceViewModel`, `buildRedactedRunTraceExport` (`run-trace.ts`).
- Evals: `listEvalCases(companyId, filters?, db?)`, `createEvalCase(input, db?)`
  (`eval-cases.ts`).
- Improve: `listImproveRecommendations`, `getImproveRecommendation`
  (`improvement-recommendations.ts`).
- Team/Bench: `listCompanyAgents`, `getCompanyAgentProfile`, `lookupAgentByName`
  (`service/agent.ts`).
- Templates: `listBuiltInStarterSprintTemplates`, `getBuiltInStarterSprintTemplate`
  (`starter-sprint-templates.ts`); `getTemplateVersion` (`template-persistence.ts`).
- Tasks/Goals/Projects: `listTasks`, `getTask` (`service/task.ts`);
  `listProjectSprints` (`service/sprint.ts`); `listProjects`, `getProject`
  (`service/project.ts`).
- Route helpers: `route-paths.ts` (`buildCanonicalRunTracePath`,
  `buildCanonicalEvalCasePath`, `buildCanonicalImprovePath`,
  `buildCanonicalGoalPath`, `buildCanonicalTeamPath`, …); company-code resolution
  in `routes.ts` (`resolveCompanySlugFromCode`, `getCompanyCode`).

### Dependency reality
- **No MCP SDK is currently in `package.json`.** `zod@4.3.6` and
  `better-sqlite3@12.6.2` are present. See §3 for the dependency decision.

---

## 2. Server shape and file layout (INS-260)

Net-new directory, additive, isolated from the Next.js request path:

```
src/lib/orchestration/mcp/
  server.ts            — createHiveRunnerMcpServer(deps): McpServer
  registry.ts          — resource + tool registry (the single source of names)
  context.ts           — McpRequestContext: { companyId, companySlug, db, actor }
  resources/
    run-trace.ts       — trace + trace-export resource readers
    evals.ts           — eval case list/read readers
    improve.ts         — improvement recommendation readers
    team.ts            — agents / active crew / bench readers
    templates.ts       — starter sprint + team template readers
    work.ts            — goals / sprints / tasks / projects readers
  tools/
    save-eval-case.ts
    attach-evidence.ts
    create-improvement-recommendation.ts
    request-approval.ts
  redaction.ts         — re-exports + assert wrapper around run-trace redaction
  schemas.ts           — zod schemas for every resource payload + tool I/O
  errors.ts            — McpToolError mapping to MCP isError results
bin/
  hiverunner-mcp.ts    — stdio entrypoint (local process launcher)
```

**Server identity:** `name: "hiverunner"`, `version: "1.0.0"`. Resource/tool
names are namespaced `hiverunner.<domain>.<verb>` and frozen in `registry.ts`.

**Context resolution:** Every request resolves a company via
`resolveCompanySlugFromCode` / `resolveCompanyIdBySlug` and injects the active
`db` handle. The MCP server is **single-company-per-process** by default
(company supplied at launch); resource URIs still carry the company code so a
future multi-company host is non-breaking.

---

## 3. Transport and dependency strategy (INS-260)

- **Transport: stdio only for v1.** The server launches as a local child
  process (`bin/hiverunner-mcp.ts`) speaking MCP over stdio. No HTTP listener,
  no network bind, no auth layer — consistent with "local-first" and the
  out-of-scope "no hosted MCP service / public auth layer" boundary.
- **SDK: add `@modelcontextprotocol/sdk` as a direct dependency** (pinned), used
  only by `src/lib/orchestration/mcp/**` and `bin/hiverunner-mcp.ts`. It must not
  be imported by any Next.js route, server component, or the engine — enforced by
  a focused import-boundary test (§10). If operator policy forbids the new
  dependency, the fallback is a minimal in-repo JSON-RPC stdio shim implementing
  `initialize`, `resources/list`, `resources/read`, `tools/list`, `tools/call`;
  the registry/resource/tool layer is SDK-agnostic so this swap is local.
- **Validation: `zod` (already present)** for every tool input and every
  resource/tool output. No new validation library.
- **Process model:** the MCP server reuses the in-process `getOrchestrationDb()`
  singleton (or an injected isolated DB in tests). It does **not** spawn the
  Next.js app and does **not** call the HTTP API — it calls the service layer
  directly, so there is one code path and one redaction boundary.

---

## 4. MCP resources — read surface (INS-261)

All resources are **read-only**. Every trace/eval payload is redacted at the
service boundary (§6). URI scheme: `hiverunner://{companyCode}/{domain}/...`.

| Resource name | URI template | Backed by | Output schema |
|---|---|---|---|
| `hiverunner.goals.list` | `hiverunner://{cc}/goals` | `listProjectSprints` + goal context | `mcp.goals.v1` |
| `hiverunner.tasks.list` | `hiverunner://{cc}/tasks` | `listTasks` | `mcp.tasks.v1` |
| `hiverunner.task.read` | `hiverunner://{cc}/tasks/{taskKey}` | `getTask` | `mcp.task.v1` |
| `hiverunner.trace.read` | `hiverunner://{cc}/runs/{runId}/trace` | `buildRunTraceViewModel` → redacted view | `hiverunner.run_trace_view.v1` |
| `hiverunner.trace.export` | `hiverunner://{cc}/runs/{runId}/trace/export` | `buildRedactedRunTraceExport` | `hiverunner.run_trace_redacted_export.v1` |
| `hiverunner.evals.list` | `hiverunner://{cc}/eval-cases` | `listEvalCases` | `mcp.eval_cases.v1` |
| `hiverunner.eval.read` | `hiverunner://{cc}/eval-cases/{caseId}` | `listEvalCases`→find | `mcp.eval_case.v1` (snapshot already redacted) |
| `hiverunner.improve.list` | `hiverunner://{cc}/improve` | `listImproveRecommendations` | `mcp.improve.v1` |
| `hiverunner.improve.read` | `hiverunner://{cc}/improve/{recId}` | `getImproveRecommendation` | `mcp.improvement.v1` |
| `hiverunner.team.list` | `hiverunner://{cc}/team` | `listCompanyAgents` (+ readiness) | `mcp.team.v1` |
| `hiverunner.team.bench` | `hiverunner://{cc}/team/bench` | `listCompanyAgents({rosterState})` | `mcp.team.v1` |
| `hiverunner.templates.list` | `hiverunner://{cc}/templates` | `listBuiltInStarterSprintTemplates` | `mcp.templates.v1` |
| `hiverunner.template.read` | `hiverunner://{cc}/templates/{templateVersionId}` | `getBuiltInStarterSprintTemplate` / `getTemplateVersion` | `mcp.template.v1` |

Every resource payload includes a `links` object built from `route-paths.ts`
(e.g. `buildCanonicalRunTracePath`, `buildCanonicalEvalCasePath`,
`buildCanonicalImprovePath`) so an external agent can deep-link an operator back
into the HiveRunner UI on stable `3001` for oversight. Resources are paginated
with `limit` (default 50, max 200) mirroring `listTasks`/`listEvalCases` limits.

`resources/list` returns exactly the 13 entries above. Any other URI returns a
structured `resource_not_found` error.

---

## 5. MCP tools — governed write surface (INS-262)

Exactly **four** tools. None mutates durable trace/eval/approval state directly;
each is append-only via an existing service, and the two state-changing ones that
need sign-off create an **approval** rather than applying a change.

### 5.1 `hiverunner.eval.save_case`
- **Backed by:** `createEvalCase(input, db)`.
- **Input (zod `mcp.tool.save_eval_case.input.v1`):** `{ companyCode, sourceTask,
  sourceRun, review:{outcome,rationale,...}, captureQuality, evidenceGaps,
  redactedSnapshot, idempotencyKey? }`.
- **Guard:** `redactedSnapshot.schema` must equal
  `RUN_TRACE_REDACTED_EXPORT_SCHEMA` and `redaction.policy` must equal
  `RUN_TRACE_REDACTION_POLICY`; the MCP layer re-runs the `assertRedactedSnapshot`
  credential scan before calling the service. Idempotent via `idempotencyKey`.
- **Output:** `{ evalCaseId, snapshotSha256, links }`.
- **Governance:** append-only, no approval required (matches existing
  eval-save behavior). Records nothing the operator hasn't already gated by
  reviewing the run.

### 5.2 `hiverunner.evidence.attach`
- **Backed by:** existing evidence-set composition used by Improve
  (`improvement-recommendation-triggers.ts` evidence inputs /
  `OrchestrationImprovementEvidenceSet`). Attaches redacted evidence summaries to
  a recommendation draft or eval case.
- **Input (`mcp.tool.attach_evidence.input.v1`):** `{ companyCode, target:{kind:
  "recommendation"|"eval_case", id}, evidence:[{sourceType, sourceId, title,
  summary, links, redactionPolicy}] }`.
- **Guard:** every evidence item must carry `redactionPolicy ===
  RUN_TRACE_REDACTION_POLICY`; summaries are credential-scanned before persist.
- **Output:** `{ evidenceSetId, attached: n, links }`.
- **Governance:** append-only.

### 5.3 `hiverunner.improve.create_recommendation`
- **Backed by:** `createImprovementApprovalBridgeRecommendation(input)` (does
  **not** auto-create an approval; status starts `suggested`).
- **Input (`mcp.tool.create_recommendation.input.v1`):** `{ companyCode,
  triggerClass, scope, title, rationale, proposedChange, severity, confidence,
  evidence, idempotencyKey? }`.
- **Output:** `{ recommendationId, status:"suggested", improveHref }`.
- **Governance:** creating a *suggestion* is append-only and queue-visible to the
  operator; it does not change runtime behavior. Promotion to action requires
  5.4.

### 5.4 `hiverunner.approval.request`
- **Backed by:** `createApproval(input)` and, for recommendation promotion,
  `acceptImprovementRecommendationsForApproval(input)`.
- **Input (`mcp.tool.request_approval.input.v1`):** `{ companyCode, type:
  ApprovalType, payload, linkedTaskKey?, recommendationIds?, riskNotes,
  rollbackNotes }`.
- **Guard:** `type` must be a member of the existing `ApprovalType` union; the
  tool **cannot** set status to `approved`/`rejected` — it only creates a
  `pending` approval routed by `resolveApprovalRoute`. There is **no MCP path to
  decide an approval**; decision stays an operator action in the HiveRunner UI.
- **Output:** `{ approvalId, status:"pending", approverAgentName, approvalHref }`.
- **Governance:** this is the only "state-changing" tool, and the state it
  changes is "an approval now exists, pending operator decision" — exactly the
  existing governance seam. `governance.durableStateMutated` stays `false`.

`tools/list` returns exactly these four. Each tool result records an
`recordImproveActivity` / audit row where the underlying service already does so;
the MCP layer adds no parallel audit system.

---

## 6. Redaction boundary (INS-263)

**One boundary, reused, double-checked.**

1. **Source of truth:** `buildRedactedRunTraceExport` / `buildRunTraceViewModel`
   in `run-trace.ts`. The MCP server never serializes a raw `RunTraceEvidenceInput`
   or any `rawPayload` to a client.
2. **`mcp/redaction.ts`** re-exports `RUN_TRACE_REDACTION_POLICY`,
   `RUN_TRACE_REDACTED_EXPORT_SCHEMA`, and wraps `assertRedactedSnapshot`
   (lifted to a shared exported helper from `eval-cases.ts`) so both eval-save and
   every trace/eval **read** run the same credential scan before bytes leave the
   process.
3. **Parity guarantee:** the trace bytes returned by `hiverunner.trace.export`
   are byte-identical to what the Run Trace UI export and the eval-case snapshot
   store — proven by a parity test that diffs MCP export vs `buildRedactedRunTraceExport`
   output for the same run, and asserts neither contains the credential fixtures
   (`sk-proj-…`, `Bearer eyJ…`, `AKIA…`, PEM blocks) used in
   `orchestration-eval-case-persistence.test.ts`.
4. **Improve/eval reads** return snapshots that were already redacted at write
   time; the MCP layer still re-scans on read (defense in depth) and fails closed
   (`redaction_violation` error) rather than emitting a suspect payload.

No new redaction logic is written. If a field needs redacting, it is added to
`run-trace.ts` (single owner), not to the MCP layer.

---

## 7. Permission / approval-governance calls (INS-262, INS-263)

- **Read resources:** no approval; gated only by company resolution. An external
  agent can read everything an operator could see redacted in the UI.
- **`save_case` / `attach` / `create_recommendation`:** append-only, no approval,
  but every write is queue/audit visible to the operator (Improve queue, Evals
  library, Activity).
- **`approval.request`:** routes through `resolveApprovalRoute` → `createApproval`
  (status `pending`). The MCP client **cannot** approve, reject, cascade, or
  apply. `updateApprovalStatus`, `cascadeApprovalDecisionToLinkedTask`,
  `acceptImprovementRecommendationsForApproval`'s decision step, and
  `syncImproveApprovalDecision` are **not** exposed as MCP tools — they remain
  operator-only via the existing UI/API on stable `3001`.
- **No runtime-control surface:** the MCP server never exposes
  `provider_switch`, hive/lane/model routing, hiring execution, task status
  mutation, or engine controls as tools. The only way those happen via MCP is by
  *requesting* an approval that an operator then decides.

---

## 8. Blast-radius map

| Area | Touched? | Risk | Mitigation |
|---|---|---|---|
| `db.ts` / migrations | **No** | none | MCP adds zero tables/migrations |
| `run-trace.ts` redaction | **Read-only import**; lift `assertRedactedSnapshot` to a shared export | low | pure refactor + parity test; existing callers unchanged |
| `eval-cases.ts` | import `createEvalCase`; export the assert helper | low | append-only; idempotent |
| `service/approval.ts` | import `createApproval`/`resolveApprovalRoute` only | low | no decision path exposed |
| `improvement-*` services | import create/list/get | low | suggestion-only writes |
| Next.js routes / engine | **No import of MCP code** | none | import-boundary test forbids it |
| `package.json` | +1 dep (`@modelcontextprotocol/sdk`) | low-med | pinned; isolated to `mcp/**` + `bin/`; fallback shim documented |
| Stable `3001` / `.stable` | **No** | none | dev/isolated lane only |

Stop-and-report trigger: if implementing any tool requires editing
`run-trace.ts` redaction *logic* (not just lifting the assert), the engine,
status transitions, or any migration — that exceeds this slice; report instead.

---

## 9. Out-of-scope — consumer-MCP behavior (INS-264)

Explicitly **not** in this slice, and the boundary must be documented for runner
authors:

- **HiveRunner runners do not become MCP clients in this slice.** No runner
  (Codex/Claude/Gemini/Symphony wrapper) is wired to discover or call arbitrary
  external MCP tools as part of task execution. The sprint forbids "arbitrary MCP
  tool consumption by runners."
- **No tool-call passthrough.** The MCP server does not proxy or relay calls to
  other MCP servers.
- **No hosted service, public auth, or cloud deployment** path is added.
- **No new trace/eval/approval/recommendation persistence** — existing services
  only.
- **No approval-decision authority** over MCP — operators decide on stable `3001`.
- **Runner MCP *usage reporting* (INS-264)** documents only the *boundary and the
  reporting contract* (how a future runner-as-client slice would report tool
  usage), not an implementation. It is a written boundary doc, not code.

### 9.1 Runner MCP usage reporting boundary

There are two separate concepts:

- **Exposed MCP surface in v1:** `hiverunner://...` resources and the four
  governed HiveRunner tools in §4-§5. These let external MCP clients inspect
  redacted Run Intelligence data and request governed writes through existing
  HiveRunner services.
- **Future runner-consumed MCP tools:** tools that a runner implementation, such
  as Codex, Claude, Gemini, HERMES, OpenClaw, Symphony, or a custom runner, might
  call from another MCP server while doing task work. Those calls are **not**
  wired in Sprint 5, are not proxied by the HiveRunner MCP Server, and need a
  later governance slice before execution.

When that later runner-as-client slice exists, runners may report their MCP tool
usage as normalized Run Trace events through the external runner
`transcriptEvents` contract. Reporting is evidence only. It must not carry raw
MCP protocol envelopes, request arguments, response payloads, auth headers,
tokens, cookies, connection strings, secret env values, file contents, private
keys, or provider transcripts.

Use only normalized trace event kinds such as `tool_call_start`, `tool_call_end`,
and `tool_result`. Keep the body safe for operators and put only non-secret
identifiers in metadata.

Example normalized trace events only:

```json
[
  {
    "role": "assistant",
    "kind": "tool_call_start",
    "title": "MCP tool started",
    "body": "Queried an approved local docs MCP tool for project context.",
    "occurredAt": "2026-06-07T16:20:00.000Z",
    "metadata": {
      "toolSystem": "mcp",
      "mcpServer": "local-docs",
      "mcpTool": "search",
      "toolCallId": "mcp-call-1",
      "approvalMode": "preapproved_read"
    }
  },
  {
    "role": "tool",
    "kind": "tool_result",
    "title": "MCP tool result",
    "body": "Returned three safe documentation matches; raw result text was not stored.",
    "occurredAt": "2026-06-07T16:20:01.260Z",
    "metadata": {
      "toolSystem": "mcp",
      "mcpServer": "local-docs",
      "mcpTool": "search",
      "toolCallId": "mcp-call-1",
      "resultSummary": "3 matches"
    }
  }
]
```

---

## 10. Focused test list (INS-265, INS-267)

All tests use an isolated DB via `createIsolatedOrchestrationWorkspace()` and the
`db?` service argument. Run under the existing `simple-test-runner` harness.

1. `orchestration-mcp-registry.test.ts` — `resources/list` returns exactly the 13
   names in §4; `tools/list` returns exactly the 4 in §5; names are frozen/stable.
2. `orchestration-mcp-resource-read.test.ts` — each resource reads goals, tasks,
   trace, eval cases, team/bench, templates, improve against the isolated DB and
   validates against its zod output schema.
3. `orchestration-mcp-redaction-parity.test.ts` — MCP `trace.export` ≡
   `buildRedactedRunTraceExport`; neither emits the credential fixtures; eval/improve
   reads fail closed on an injected unredacted value.
4. `orchestration-mcp-governed-tools.test.ts` — `save_case`, `attach_evidence`,
   `create_recommendation`, and `request_approval` each succeed; `request_approval`
   creates a `pending` approval via `resolveApprovalRoute` and **cannot** set a
   decided status; no decision/cascade tool exists.
5. `orchestration-mcp-import-boundary.test.ts` — no file under `src/app/**`,
   `src/lib/orchestration/engine/**`, or server components imports
   `src/lib/orchestration/mcp/**` or the MCP SDK.
6. `orchestration-mcp-smoke-client.test.ts` (INS-265) — a local MCP client over
   stdio captures `initialize`, `resources/list`, `resources/read` (≥1),
   `tools/list`, and ≥2 state-changing `tools/call` with approval-safe results;
   transcript saved as the operator artifact.

**Build gates (INS-267):** `npm run lint`, `npm run build`, `npm run fallow:changed`,
no `.stable` edits. Operator proof runs from dev `3010` / isolated lane with the
saved smoke-client transcript showing resources + governance behavior.

---

## 11. Schema registry (frozen names)

Reused (do not redefine): `hiverunner.run_trace_view.v1`,
`hiverunner.run_trace_redacted_export.v1`, `hiverunner.run_trace_redaction.v1`,
`hiverunner.improvement_approval_package.v1`, `hiverunner.improve_activity.v1`.

New (MCP-owned, additive): `mcp.goals.v1`, `mcp.tasks.v1`, `mcp.task.v1`,
`mcp.eval_cases.v1`, `mcp.eval_case.v1`, `mcp.improve.v1`, `mcp.improvement.v1`,
`mcp.team.v1`, `mcp.templates.v1`, `mcp.template.v1`, and the four tool I/O
schemas in §5. All MCP-owned schemas are thin envelopes over existing service
return types — they re-shape and add `links`, they do not re-model the domain.

---

## 12. Task → contract section map

| Task | Owns | Contract sections |
|---|---|---|
| INS-260 | Server scaffold + registry + transport + deps | §2, §3, §11 |
| INS-261 | Read resources | §4, §6 (read path) |
| INS-262 | Governed tools | §5, §7 |
| INS-263 | Redaction + evidence export parity | §6, test 3 |
| INS-264 | Runner MCP usage reporting boundary doc | §9 |
| INS-265 | Smoke client + focused tests | §10 |
| INS-266 | Operator MCP usage guide | §4 links, §7 governance |
| INS-267 | Verification + promotion package | §10 gates |

---

*End of contract. Binding on INS-260…INS-267. Deviations require an updated
contract revision, not silent drift.*
