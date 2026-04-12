# RFC: Mission Control Workspace Separation

Status: Draft
Date: 2026-04-11
Repo: `/Users/timharris/.openclaw/workspace/projects/mission-control-app`
Audited branch: `feat/mission-control-live-parity`
Scope: company workspace storage separation, lane isolation, safety, and compatibility planning only
Non-goal: implementation in this phase

## Executive Summary

Mission Control already separates stable and dev orchestration data with `MC_DATA_DIR`, but it does not yet own its workspace storage model. Workspace creation, lookup, deletion, inspection, and agent provisioning still span multiple OpenClaw-era conventions:

1. `~/.openclaw/workspace`
2. `~/.openclaw/workspace/companies/<slug>`
3. `~/.openclaw/workspace/companies/<companyId>`
4. `~/.openclaw/workspaces/<companySlug>`
5. `~/.openclaw/workspace-<agentSlug>`
6. `~/.openclaw/agents/<openclawAgentId>`

The live DB state is already mixed across those conventions. Stable mostly points at `~/.openclaw/workspaces/<slug>`. Dev is mixed between slug-based `~/.openclaw/workspaces/<slug>` and UUID-based `~/.openclaw/workspace/companies/<companyId>`.

The key architectural mistake is that "workspace storage" and "OpenClaw runtime integration" are treated as the same concern. They are not.

- Mission Control can and should own company workspace storage.
- Mission Control is still materially coupled to OpenClaw runtime state for sessions, instructions, skills, status, cron, dashboards, and some execution paths.
- This RFC recommends separating storage ownership first, while explicitly retaining OpenClaw runtime integration where it still exists.

## Recommendation

Adopt a Mission Control-owned, lane-specific workspace root via `MC_WORKSPACE_ROOT`, with recommended defaults:

- Stable: `~/.mission-control/stable/workspaces`
- Dev: `~/.mission-control/dev/workspaces`

New non-default companies should use a canonical path under:

```text
${MC_WORKSPACE_ROOT}/companies/<companyId>
```

`OPENCLAW_DIR` and `OPENCLAW_HOME` should remain only for OpenClaw runtime integration surfaces, not as the owner of Mission Control company workspaces.

Recommendation on legacy/default company:

- Keep `neveridle-core` as an explicit compatibility import from OpenClaw for now.
- Do not auto-migrate or hard-delete it in the first storage-separation cutover.
- Treat it as a special `workspace_source`, not a silent fallback.

Recommendation on root namespace:

- Prefer `~/.mission-control/...` over `~/.openclaw/workspaces-dev|stable`.
- Rationale: it expresses ownership correctly, reduces accidental coupling, supports future non-OpenClaw providers, and makes deletion/backup boundaries easier to reason about.

## Open Questions Requiring Human Decision

1. Should `neveridle-core` remain permanently mapped to OpenClaw home, or should it eventually become a normal Mission Control company?
2. Should project directories remain slug-based inside a company root for the first migration, or should Mission Control also introduce immutable project path identifiers in a follow-up?
3. Is preserving the current Files rail behavior for top-level OpenClaw workspaces still a product requirement, or can operator-facing rails become company-first and treat OpenClaw workspaces as a separate legacy/runtime view?
4. Should Mission Control introduce `MC_HOME` later and derive `MC_WORKSPACE_ROOT` from it, or keep this migration narrowly scoped to `MC_WORKSPACE_ROOT` only?

## Current State

### What Is Already Separated

- SQLite/data lane separation exists through `MC_DATA_DIR`.
- Stable uses `data/`.
- Dev uses `data-dev/`.

### What Is Not Separated

- Company workspaces are still stored under the OpenClaw namespace.
- Dev and stable can still point at overlapping workspace roots if configured that way.
- Multiple routes still hardcode `~/.openclaw/...` paths directly.
- Stable lane operational state still shares some repo-owned paths and symlinked `data/` behavior.

### Current Workspace Conventions in Code

| Convention | Current source |
|---|---|
| `~/.openclaw/workspace` | default company fallback in `src/lib/orchestration/company-service.ts`, migration v13 in `src/lib/orchestration/db.ts`, Files rails aliases in `src/lib/files/workspace-resolver.ts` |
| `~/.openclaw/workspace/companies/<slug>` | migration v13 backfill in `src/lib/orchestration/db.ts` |
| `~/.openclaw/workspace/companies/<companyId>` | `createCompany()` in `src/lib/orchestration/company-service.ts`; fallback in `companyFromRow()` |
| `~/.openclaw/workspaces/<companySlug>` | `src/app/api/orchestration/companies/create-full/route.ts`; many existing live rows |
| `~/.openclaw/workspace-<agentSlug>` | project workspace inspection fallbacks and Files/operator rails legacy behavior |
| `~/.openclaw/agents/<openclawAgentId>` | OpenClaw runtime scaffold, session history, managed instructions, config inspection |

### Current Live DB Snapshot

Observed local state during audit:

| Lane | Companies | `~/.openclaw/workspace` | `~/.openclaw/workspaces/<slug>` | `~/.openclaw/workspace/companies/<uuid>` |
|---|---:|---:|---:|---:|
| Stable (`data/orchestration.db`) | 5 | 1 | 4 | 0 |
| Dev (`data-dev/orchestration.db`) | 4 | 1 | 2 | 1 |

Additional observed conditions:

- All persisted workspace roots currently exist on disk.
- `~/.openclaw/workspaces/` contains company-like directories that are not in the DB, so orphan/manual/test workspaces already exist.
- Legacy top-level `workspace-*` directories still exist.

### Current Lifecycle by Subsystem

#### Company Creation

- `src/lib/orchestration/company-service.ts`
  - `createCompany()` writes `workspace_root = OPENCLAW_WORKSPACE_ROOT/companies/<companyId>`.
  - This is the most rename-safe convention in the codebase.
- `src/app/api/orchestration/companies/create-full/route.ts`
  - Bypasses `createCompany()`.
  - Creates `~/.openclaw/workspaces/<companySlug>`.
  - Also provisions CEO workspace, instruction files, project directory, and `openclaw agents add` directly.
- Result: the codebase has two incompatible creation flows for the same concept.

#### Workspace Resolution

- `src/lib/files/workspace-resolver.ts`
  - Resolves `"workspace"` and `"mission-control"` under `OPENCLAW_DIR`.
  - Returns `companies.workspace_root` when a company slug matches.
  - Falls back to `path.join(OPENCLAW_DIR, workspace)` for arbitrary names.
- `src/app/api/orchestration/projects/[id]/workspaces/route.ts`
  - Infers project roots from `<companyRoot>/projects/<projectSlug>`.
  - Falls back to `workspace-<agentSlug>` for agents.
- Result: persisted company roots exist, but project and agent workspace inspection still rely on convention-heavy inference.

#### Agent Provisioning

- `src/lib/orchestration/service/company-agent-provisioning.ts`
  - Uses `<company.workspace_root>/agents/<agentSlug>`.
  - Shells out to `openclaw agents add`.
- `src/app/api/orchestration/companies/[slug]/agents/hire/route.ts`
  - Reimplements provisioning logic directly instead of calling the service.
- `src/lib/orchestration/openclaw-agent-scaffold.ts`
  - Creates separate runtime scaffold under `~/.openclaw/agents/<openclawAgentId>`.
- `src/lib/orchestration/service/agent.ts`
  - `createProjectAgent()` optionally invokes OpenClaw scaffold creation.
- Result: there are at least two company-agent provisioning paths and a separate OpenClaw runtime-scaffold path.

#### Deletion and Cleanup Safety

- `src/lib/orchestration/company-service.ts`
  - `hardDeleteCompany()` deletes OpenClaw agents and then removes the company workspace directory.
  - Safety gate only allows paths inside `~/.openclaw` and recognizes naming patterns.
- `scripts/cleanup-test-artifacts.ts`
  - Deletes `workspace_root` with raw `fs.rmSync(...)` and no shared path safety helper.
  - Defaults to `process.cwd()/data/orchestration.db`, which is stable-lane-centric.
- `src/app/api/files/delete/route.ts`
  - Uses string-prefix containment (`fullPath.startsWith(base)`), which is weaker than path-segment-safe containment.
- Result: deletion safety is inconsistent and still assumes OpenClaw-owned roots.

#### Launch and Runtime Configuration

- `scripts/run_dev_service.sh` and `scripts/run_stable_service.sh`
  - Set `MC_DATA_DIR`.
  - Do not set `MC_WORKSPACE_ROOT`.
- `config/com.harris-autonomous.mc-dev.plist` and `config/com.harris-autonomous.mc-stable.plist`
  - Set `MC_DATA_DIR`.
  - Do not set `MC_WORKSPACE_ROOT`.
- `scripts/stable_release_common.sh`
  - Stable lane still shares some repo operational state via symlink strategy.
- Result: lane separation is explicit for data, not for workspaces.

#### OpenClaw Runtime Coupling Beyond Workspace Storage

Mission Control still reads or writes OpenClaw-owned runtime state in many places:

- `src/lib/orchestration/execution.ts`
  - reads `~/.openclaw/agents/<id>/SOUL.md`
  - dispatches through `openclaw gateway call`
- `src/lib/orchestration/engine/engine.ts`
  - heartbeat sessions and transcript lookup under `~/.openclaw/agents/.../sessions`
- `src/app/api/orchestration/agents/[id]/instructions/route.ts`
  - reads/writes managed SOUL files in OpenClaw runtime dirs
- `src/app/api/orchestration/agents/[id]/openclaw-config/route.ts`
  - reads `~/.openclaw/openclaw.json` and agent sessions
- `src/lib/dashboard-highlights.ts`, `src/lib/dashboard-stats.ts`, `src/lib/tasks-log.ts`, `src/lib/ideas-store.ts`
  - read OpenClaw workspace or OpenClaw cron/session/config artifacts directly
- `src/lib/agent-skills.ts`, `src/lib/skill-parser.ts`, `src/lib/secrets.ts`, `src/lib/agent-status.ts`, `src/lib/usage-collector.ts`, `src/lib/advisory-agent.ts`
  - all retain OpenClaw assumptions

This is the hidden dependency map the migration must not hand-wave away.

### Hidden Assumptions That Do Not Survive Audit

1. "Data separation already solved lane separation."
   - False. SQLite separation exists; workspace separation does not.
2. "Company workspace separation means Mission Control is decoupled from OpenClaw."
   - False. Runtime, sessions, skills, dashboards, instructions, cron, and provider activation still depend on OpenClaw.
3. "There is one company creation contract."
   - False. `createCompany()` and `create-full` disagree on path shape and provisioning flow.
4. "Deletion safety is already centralized."
   - False. `hardDeleteCompany()`, Files delete, and `cleanup-test-artifacts.ts` all use different safety rules.
5. "Project workspaces are first-class."
   - False. They are still inferred, not persisted.

## Affected Files and Subsystems

| Subsystem | Key files | Why affected |
|---|---|---|
| Company creation and persistence | `src/lib/orchestration/company-service.ts`, `src/lib/orchestration/db.ts`, `src/app/api/orchestration/companies/route.ts`, `src/app/api/orchestration/companies/create-full/route.ts` | canonical workspace root, source metadata, creation-path consistency |
| Workspace resolution and Files APIs | `src/lib/files/workspace-resolver.ts`, `src/app/api/files/route.ts`, `src/app/api/files/workspaces/route.ts`, `src/app/api/files/delete/route.ts`, `src/app/api/files/write/route.ts`, `src/app/api/files/mkdir/route.ts`, `src/app/api/files/download/route.ts`, `src/app/api/files/upload/route.ts`, `src/app/api/browse/route.ts` | generic OpenClaw fallbacks, operator rails, path safety |
| Project workspace inspection | `src/app/api/orchestration/projects/[id]/workspaces/route.ts`, `src/app/api/orchestration/projects/[id]/workspaces/[agentSlug]/route.ts` | convention-heavy project/agent workspace inference |
| Agent provisioning | `src/lib/orchestration/service/company-agent-provisioning.ts`, `src/app/api/orchestration/companies/[slug]/agents/hire/route.ts`, `src/app/api/orchestration/companies/create-full/route.ts`, `src/lib/orchestration/openclaw-agent-scaffold.ts`, `src/lib/orchestration/service/agent.ts` | duplicate provisioning, split between company storage and OpenClaw runtime scaffold |
| Deletion and cleanup safety | `src/lib/orchestration/company-service.ts`, `scripts/cleanup-test-artifacts.ts`, `src/app/api/files/delete/route.ts` | path allowlists assume OpenClaw ownership; safety not shared |
| Launch and lane config | `scripts/run_dev_service.sh`, `scripts/run_stable_service.sh`, `config/com.harris-autonomous.mc-dev.plist`, `config/com.harris-autonomous.mc-stable.plist`, `server.js`, `scripts/stable_release_common.sh` | explicit lane-specific workspace root export and diagnostics |
| UI copy and operator expectations | `src/app/companies/new/page.tsx`, `README.md`, `docs/two-lane-runtime.md` | current copy still points at `~/.openclaw/workspaces/<slug>` or stale runtime assumptions |
| Provider/runtime activation logic | `src/lib/orchestration/service/provider-activation.ts`, `src/lib/orchestration/execution.ts`, `src/lib/orchestration/engine/engine.ts` | runtime readiness must stop using storage-root assumptions as proxy |
| OpenClaw-coupled dashboards and utilities | `src/lib/paths.ts`, `src/lib/dashboard-highlights.ts`, `src/lib/dashboard-stats.ts`, `src/lib/tasks-log.ts`, `src/lib/ideas-store.ts`, `src/lib/agent-skills.ts`, `src/lib/skill-parser.ts`, `src/lib/secrets.ts`, `src/lib/agent-status.ts`, `src/lib/usage-collector.ts`, `src/lib/advisory-agent.ts` | must be explicitly declared out-of-scope or follow-up scope; they are not magically fixed by storage separation |
| Tests | `src/lib/__tests__/orchestration-company-workspace-project-scope.test.ts`, `src/lib/__tests__/orchestration-agent-company-scoping.test.ts`, `src/lib/__tests__/orchestration-openclaw-agent-scaffold.test.ts`, `src/lib/__tests__/provider-activation.test.ts`, `src/lib/__tests__/orchestration-openclaw-execution.test.ts`, `src/lib/__tests__/workspace-visibility.test.ts`, `e2e/files-workspace-visibility.spec.ts` | current expectations encode legacy path contracts and OpenClaw assumptions |

## Recommended Target Architecture

### Architectural Boundary

Mission Control should distinguish three different storage classes:

1. Mission Control-owned company workspaces
2. OpenClaw-owned runtime state
3. Legacy compatibility roots

Those classes must not share the same root abstraction.

### Proposed Root Model

Use a Mission Control-owned root for company workspaces:

```text
~/.mission-control/
  stable/
    workspaces/
      companies/
        <companyId>/
          AGENTS.md
          projects/
          agents/
  dev/
    workspaces/
      companies/
        <companyId>/
```

An explicit immutable `workspace_slug` is now the filesystem label for the canonical
Mission Control-managed company folder shape:

```text
${MC_WORKSPACE_ROOT}/companies/<workspace_slug>--<companyId>
```

`workspace_root` remains the authoritative runtime path, and managed Mission Control
company rows now point at that human-readable-plus-ID layout after the dedicated rename
migration.

Recommended env contract:

- `MC_WORKSPACE_ROOT`
  - absolute path to the lane-specific Mission Control workspace root
- `MC_DATA_DIR`
  - existing lane-specific data root
- `OPENCLAW_DIR` / `OPENCLAW_HOME`
  - runtime integration only

### Canonical Write Contract

- All newly created non-default companies write `companies.workspace_root` explicitly.
- All newly created companies also persist `companies.workspace_slug` once, at creation time.
- Managed Mission Control company rows use `${MC_WORKSPACE_ROOT}/companies/<workspace_slug>--<companyId>` as the canonical on-disk root.
- `workspace_source` should be normalized to ownership-oriented values, for example:
  - `mission-control`
  - `openclaw-default`
  - `legacy-openclaw-workspaces`
  - `legacy-openclaw-company-root`
  - `external`

The exact enum names can vary, but the current `provisioned/openclaw/manual/imported` vocabulary is too ambiguous for migration safety.

### Canonical Read Contract

Mission Control should resolve company workspaces in this order:

1. Persisted `companies.workspace_root`
2. Explicit default-company compatibility rule, if the company is intentionally mapped to OpenClaw home
3. Transitional legacy compatibility logic only where required

It should not:

- silently infer arbitrary company workspaces from `OPENCLAW_DIR`
- silently create a new convention from missing state
- treat OpenClaw runtime paths as Mission Control company roots

### Project and Agent Subpaths

For the first migration:

- make company root canonical and persisted
- keep project and agent subpaths behind shared helpers
- do not attempt a simultaneous project-path storage redesign unless a separate migration is approved

Recommended first-step helpers:

- `resolveCanonicalCompanyWorkspaceRoot(companyId)`
- `resolveCompanyProjectWorkspacePath(companyRoot, project)`
- `resolveCompanyAgentWorkspacePath(companyRoot, agentSlug)`

This keeps Phase 2 focused while still removing path drift.

### Default Company Policy

`neveridle-core` is not a normal company today. It is a compatibility bridge to OpenClaw home.

Recommended policy:

- mark it explicitly as an OpenClaw-backed special case
- exclude it from automatic cutover
- exclude it from destructive hard delete
- do not let its fallback behavior leak into general company logic

### Deletion Safety Policy

Deletion must be ownership-driven, not name-pattern-driven.

Recommended rules:

1. Only Mission Control-owned roots under `MC_WORKSPACE_ROOT` are eligible for automatic hard delete.
2. Legacy/external/OpenClaw-backed roots require explicit override or are archive-only.
3. All deletions use one shared, path-segment-safe containment helper.
4. Company workspace deletion should check both DB ownership metadata and an on-disk Mission Control marker file before recursive removal.

Suggested marker:

```text
<companyRoot>/.mission-control/workspace.json
```

Containing at least:

- company id
- lane
- root version
- created by Mission Control

### What This RFC Does Not Claim

This migration does not make Mission Control independent from OpenClaw runtime. After the storage cutover, the following still remain OpenClaw-coupled unless a later RFC changes them:

- agent sessions
- managed instructions
- OpenClaw config inspection
- skills discovery
- dashboard session/cost/status rollups
- cron/runs integration
- advisory agent execution

## Phased Migration Plan

### Phase 1: RFC and Decision

Deliverable:

- this RFC

Decision gates:

- approve `~/.mission-control/<lane>/workspaces`
- approve default-company policy
- approve compatibility window

### Phase 2: Abstraction and Compatibility, No Real Migration

Goals:

- introduce `MC_WORKSPACE_ROOT`
- route all new company creation through one canonical helper
- route workspace resolution through one compatibility layer
- unify deletion safety logic
- update launch scripts/plists/docs/tests

Rules:

- no directory moves
- no live DB cutover
- preserve existing persisted `workspace_root` values
- leave OpenClaw runtime integration intact

Success criteria:

- new non-default companies use Mission Control-owned roots
- existing rows still resolve
- dev and stable each advertise their own workspace root
- tests cover both canonical and legacy resolution

### Phase 3: Inventory, Backup, Dry-Run Migration Tooling

Goals:

- classify every company by current workspace source
- back up both lane DBs and each workspace candidate
- generate dry-run move plan and collision report
- verify project and agent resolution before any cutover

Success criteria:

- every company is categorized as safe auto-migrate, manual review, or blocked
- orphan and untracked workspaces are reported separately from DB-backed workspaces

### Phase 4: Controlled Cutover for Non-Default Companies

Goals:

- move only approved non-default company roots
- update only approved `companies.workspace_root` rows
- verify Files rails, project workspace inspection, agent workspace inspection, and company deletion behavior

Rules:

- cut over one lane at a time
- stop on any path collision or verification failure
- do not auto-migrate `neveridle-core`

### Phase 5: Follow-Up Runtime Decoupling RFC

Out of scope for the first migration, but required if the product goal becomes full OpenClaw independence:

- sessions/history ownership
- managed instructions ownership
- dashboard data sources
- skill/config/secrets resolution
- provider activation semantics

## Rollback Plan

### Rollback Principles

- reversible by manifest
- lane-specific
- backup-first
- no destructive in-place rewrites without a restorable source

### Before Any Cutover

Create:

1. SQLite backup of `data/orchestration.db`
2. SQLite backup of `data-dev/orchestration.db`
3. Export of all `companies` rows with `workspace_root` and `workspace_source`
4. Tarball or snapshot per workspace scheduled for movement
5. Manifest describing source path, destination path, lane, company id, slug, checksum/exists state

### Rollback Trigger Conditions

Rollback immediately if any of these occur:

- destination already exists unexpectedly
- source path missing or mismatched
- Files API resolves the wrong workspace
- project/agent workspace inspection falls back incorrectly
- task execution or heartbeat pathing breaks for migrated agents
- delete safety now permits a legacy/OpenClaw root that should remain protected

### Rollback Procedure

Per-company rollback:

1. stop new writes for the affected lane
2. move the workspace back from destination to source using the manifest
3. restore `companies.workspace_root` for that company
4. rerun verification

Lane-level rollback:

1. stop the lane
2. restore DB backup for that lane
3. restore any moved workspaces from backup or move them back from destination
4. restart the lane
5. rerun verification

### Rollback Scope Recommendation

- Prefer per-company rollback when one migration item fails.
- Prefer full-lane rollback when path classification, helper behavior, or delete-safety logic is globally wrong.

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|---|---|---:|---|
| `neveridle-core` is treated like a normal company during migration | catastrophic deletion or broken default-company behavior | medium | explicit source classification, cutover exclusion, no hard delete |
| Existing mixed `workspace_root` values are normalized incorrectly | broken resolution or wrong moves | high | inventory tool, explicit source classification, no blind string rewriting |
| `createCompany()` and `create-full` keep drifting | new data enters multiple conventions again | high | single provisioning service and single canonical root helper |
| Files/delete safety remains path-prefix based | deletion escape or accidental removal | medium | shared path-segment-safe helper and ownership marker |
| `cleanup-test-artifacts.ts` bypasses new safety rules | destructive cleanup outside managed roots | high | force script to use shared safety helper and explicit lane/db inputs |
| Dev and stable point at the same `MC_WORKSPACE_ROOT` | lane contamination continues | medium | explicit env per lane, startup logging, verification test |
| UI/docs still advertise old paths | operator confusion and misprovisioning | high | update docs/UI copy in same phase as abstraction |
| Tests keep asserting stale path contracts | false confidence | high | update/add tests for canonical and legacy cases |
| Product assumes storage separation equals runtime independence | incorrect planning and under-scoped work | high | explicitly document OpenClaw runtime coupling as follow-up scope |
| Orphan directories under `~/.openclaw/workspaces` are mistaken for managed company roots | accidental migration or deletion | medium | classify DB-backed versus orphan/manual paths separately in tooling |

## Exact Implementation Plan

### Phase 2: Source Changes Required

Recommended new helpers:

- `src/lib/workspaces/root.ts`
  - own `MC_WORKSPACE_ROOT` resolution
  - classify canonical versus legacy roots
  - expose lane-aware defaults
- `src/lib/workspaces/company-paths.ts`
  - canonical company/project/agent path helpers
- `src/lib/workspaces/delete-safety.ts`
  - shared containment and ownership checks

Required modifications:

1. `src/lib/orchestration/company-service.ts`
   - replace `OPENCLAW_WORKSPACE_ROOT` ownership assumptions with Mission Control root helpers
   - make default-company handling explicit, not implicit
   - update `hardDeleteCompany()` to use shared ownership-based safety
2. `src/lib/orchestration/db.ts`
   - stop encoding new OpenClaw-owned defaults for future writes/migrations
   - if needed, add migration for clearer `workspace_source` vocabulary or supporting metadata
3. `src/app/api/orchestration/companies/create-full/route.ts`
   - stop writing `~/.openclaw/workspaces/<slug>`
   - route through the same company/provisioning helpers as normal creation
4. `src/lib/orchestration/service/company-agent-provisioning.ts`
   - source workspace paths only from shared company path helpers
5. `src/app/api/orchestration/companies/[slug]/agents/hire/route.ts`
   - stop duplicating provisioning logic; reuse service layer
6. `src/lib/files/workspace-resolver.ts`
   - make company roots company-first
   - remove generic "arbitrary workspace under OpenClaw" fallback for company semantics
7. `src/app/api/files/workspaces/route.ts`
   - separate Mission Control company workspaces from legacy OpenClaw workspaces in operator rails
8. `src/app/api/files/delete/route.ts`
   - replace raw string-prefix safety with shared deletion helper
9. `src/app/api/files/route.ts`
   - stop direct `path.join(OPENCLAW_DIR, workspace)` behavior where company/workspace abstraction should apply
10. `src/app/api/orchestration/projects/[id]/workspaces/route.ts`
   - use shared project/agent path helpers
11. `src/app/api/orchestration/projects/[id]/workspaces/[agentSlug]/route.ts`
   - use shared project/agent path helpers
12. `src/lib/orchestration/service/provider-activation.ts`
   - stop using `OPENCLAW_WORKSPACE_ROOT` as proxy for OpenClaw readiness
13. `scripts/run_dev_service.sh`
   - set explicit dev `MC_WORKSPACE_ROOT`
14. `scripts/run_stable_service.sh`
   - set explicit stable `MC_WORKSPACE_ROOT`
15. `config/com.harris-autonomous.mc-dev.plist`
   - export dev `MC_WORKSPACE_ROOT`
16. `config/com.harris-autonomous.mc-stable.plist`
   - export stable `MC_WORKSPACE_ROOT`
17. `server.js`
   - log resolved workspace root and lane at startup
18. `src/app/companies/new/page.tsx`
   - stop advertising `~/.openclaw/workspaces/<slug>`
19. `README.md`
   - correct historical "OpenClaw is the backend" guidance where it now conflicts with company workspace ownership
20. `docs/two-lane-runtime.md`
   - correct stale DB statement and document lane-specific workspace roots
21. `scripts/cleanup-test-artifacts.ts`
   - require explicit DB input or lane selection
   - share deletion safety rules

Required test updates/additions:

1. Update `src/lib/__tests__/orchestration-company-workspace-project-scope.test.ts`
   - canonical root expectations
   - legacy compatibility expectations
2. Update `src/lib/__tests__/provider-activation.test.ts`
   - OpenClaw readiness no longer keyed to `OPENCLAW_WORKSPACE_ROOT`
3. Update `src/lib/__tests__/workspace-visibility.test.ts`
   - operator rails behavior for company roots versus legacy OpenClaw roots
4. Add `src/lib/__tests__/workspace-root-resolution.test.ts`
   - canonical and legacy path resolution matrix
5. Add `src/lib/__tests__/workspace-delete-safety.test.ts`
   - Mission Control-owned, OpenClaw-owned, external, and malformed path cases
6. Update `e2e/files-workspace-visibility.spec.ts`
   - company-first workspace listing

### Phase 3: New Tooling and Docs Required

Recommended additions:

1. `scripts/workspace-inventory.ts`
   - enumerate DB rows and on-disk roots across both lanes
2. `scripts/workspace-migration-dry-run.ts`
   - map current path to proposed `MC_WORKSPACE_ROOT` destination
3. `scripts/workspace-verification.ts`
   - verify company/project/agent workspace resolution and delete-safety assumptions
4. `scripts/workspace-rollback-restore.ts`
   - assist manifest-driven rollback
5. `docs/workspace-separation-cutover.md`
   - operator runbook for dry-run, cutover, and rollback

Likely supporting updates:

- `package.json`
  - expose repeatable script commands if the repo prefers npm script entrypoints

### Phase 4: Cutover Execution Artifacts

Phase 4 should avoid broad source changes. It should primarily produce operational artifacts:

- lane-specific DB backups
- workspace tarballs/snapshots
- migration manifests
- verification reports
- post-cutover audit report

If a source change is still required in Phase 4, the plan is already off track. The code should be ready before cutover begins.

## Path to Implementation

1. Approve the target root namespace and default-company policy.
2. Land Phase 2 abstraction and compatibility without moving real data.
3. Build Phase 3 inventory, dry-run, backup, and verification tooling.
4. Review the dry-run report and classify manual-review items.
5. Execute Phase 4 cutover for non-default companies only.
6. Open a separate RFC if full runtime independence from OpenClaw is still desired.
