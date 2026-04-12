# Mission Control Workspace Separation — Agent Prompt Pack

Use this with a fresh coding agent session in:
`/Users/timharris/.openclaw/workspace/projects/mission-control-app`

Recommended branch:
`feat/mission-control-live-parity`

Recommended agent:
**Codex**

Why Codex here:
- this is a repo-wide architectural migration, not a one-file fix
- we need careful staged execution, test discipline, and a lot of file tracing
- we want strong implementation follow-through after the design pass

---

## Operator note

This work is intentionally broken into phases.

**Do not ask the agent to do everything in one shot.**
That is how big infra changes go sideways.

Run these in order:
1. Phase 1 — discovery + RFC only
2. Human review / decision
3. Phase 2 — abstraction + compatibility implementation
4. Human review / test pass
5. Phase 3 — migration tooling and dry-run verification
6. Human review / explicit cutover approval
7. Phase 4 — cutover execution

---

# Phase 1 Prompt — Discovery + RFC only

Copy/paste this as the first message to the fresh agent:

```text
You are doing a deep architectural audit of Mission Control workspace handling.

Repository:
/Users/timharris/.openclaw/workspace/projects/mission-control-app

Branch:
feat/mission-control-live-parity

Your job in THIS PHASE is discovery and design only.
Do NOT implement the migration yet.
Do NOT move directories.
Do NOT rewrite DB rows.
Do NOT perform destructive cleanup.
Do NOT make unrelated product/UI changes.

Context you must start from:
- Mission Control already has lane-separated data:
  - stable uses data/orchestration.db
  - dev uses data-dev/orchestration.db
- But workspace handling is inconsistent and currently mixes multiple conventions.
- Current known workspace patterns in the codebase include:
  1. neveridle-core special-cased to ~/.openclaw/workspace
  2. createCompany() using OPENCLAW_WORKSPACE_ROOT/companies/<companyId>
  3. create-full route provisioning ~/.openclaw/workspaces/<slug>
  4. agent workspace fallback checking ~/.openclaw/workspace-<agentSlug>
- Live DB state is mixed across these patterns.
- The product goal is to make Mission Control production-quality and not conceptually dependent on OpenClaw for company workspace storage.

Desired direction to evaluate seriously:
- Introduce a Mission Control-owned workspace root abstraction, likely via MC_WORKSPACE_ROOT
- Likely targets:
  - stable: ~/.mission-control/stable/workspaces
  - dev: ~/.mission-control/dev/workspaces
- Keep OPENCLAW_DIR only for runtime integration surfaces, not as the owner of Mission Control company workspaces

You must inspect, at minimum, these files and any directly-related dependencies they reveal:
- src/lib/orchestration/company-service.ts
- src/lib/orchestration/db.ts
- src/lib/files/workspace-resolver.ts
- src/lib/orchestration/service/company-agent-provisioning.ts
- src/app/api/orchestration/companies/create-full/route.ts
- src/app/api/orchestration/companies/route.ts
- src/app/api/files/workspaces/route.ts
- src/app/api/orchestration/projects/[id]/workspaces/route.ts
- src/app/api/orchestration/projects/[id]/workspaces/[agentSlug]/route.ts
- src/lib/orchestration/execution.ts
- src/lib/orchestration/service/provider-activation.ts
- src/lib/paths.ts
- src/lib/dashboard-highlights.ts
- src/lib/dashboard-stats.ts
- src/lib/tasks-log.ts
- src/lib/ideas-store.ts
- scripts/run_dev_service.sh
- scripts/run_stable_service.sh
- config/com.harris-autonomous.mc-dev.plist
- config/com.harris-autonomous.mc-stable.plist
- relevant tests under src/lib/__tests__/

Deliverables for this phase:
1. A written RFC at docs/workspace-separation-rfc.md
2. A migration impact map listing every affected subsystem:
   - company creation
   - workspace resolution
   - agent provisioning
   - deletion/cleanup safety
   - launch/runtime configuration
   - tests
   - dashboards / logs / idea intake / OpenClaw runtime coupling
3. A precise inventory of current workspace conventions in code and in live DB assumptions
4. A recommended target architecture
5. A phased migration plan with rollback strategy
6. A risk register
7. A list of exact files that must change in Phase 2, Phase 3, and Phase 4

Important requirements:
- Challenge bad assumptions if you find them
- Call out where Mission Control is still coupled to OpenClaw beyond workspace storage
- Distinguish “workspace storage independence” from “runtime integration independence”
- If you think ~/.mission-control/... is better than ~/.openclaw/workspaces-stable|dev, say so clearly and explain why
- If a safer transitional architecture exists, include it

Output format at the end of this phase:
- short executive summary
- recommendation
- open questions needing human decision
- path to implementation

You may edit docs and add an RFC file in this phase.
Do not implement runtime or migration changes yet.
```

---

# Phase 2 Prompt — Implement abstraction + compatibility only

Use this only after the RFC is reviewed and approved.

```text
Proceed with Phase 2 only.

Goal:
Implement the workspace-root abstraction and compatibility layer, but do NOT run a real migration/cutover yet.

Approved direction:
- Mission Control gets a lane-specific workspace root abstraction via MC_WORKSPACE_ROOT
- Target roots should support:
  - stable: ~/.mission-control/stable/workspaces
  - dev: ~/.mission-control/dev/workspaces
- OPENCLAW_DIR remains for runtime integration only

Rules for this phase:
- No destructive migration of existing company workspace roots yet
- No moving real directories yet
- No direct DB rewrite of existing rows unless strictly required for compatibility and explicitly justified
- No unrelated UI or product changes
- Preserve backward compatibility for existing workspace_root values and legacy path conventions during the transition

Implement in this phase:
1. Introduce a single canonical workspace-root abstraction for Mission Control
2. Route company creation/provisioning through that abstraction
3. Route workspace resolution through that abstraction
4. Update deletion safety so it can safely handle the new Mission Control-owned roots
5. Update launch scripts / plists / env handling so dev and stable can each define MC_WORKSPACE_ROOT
6. Update all user-facing workspace path copy to reflect the new abstraction, not old hardcoded paths
7. Update tests to match the intended contract
8. Add docs describing how dev/stable workspace roots are configured

Compatibility requirements:
- Existing persisted company workspace_root values must still work
- Legacy fallback behavior should remain only where necessary and should be clearly marked transitional
- neveridle-core special handling must be explicitly reviewed, not hand-waved

Deliverables:
- code changes
- updated tests
- docs for configuration
- a short implementation report describing what changed and what still waits for migration/cutover

Before finishing:
- run targeted tests for affected systems
- list any remaining blockers for Phase 3
```

---

# Phase 3 Prompt — Migration tooling + dry-run only

Use this only after Phase 2 lands cleanly.

```text
Proceed with Phase 3 only.

Goal:
Build migration tooling and verification for workspace-root cutover, but do NOT perform the live cutover yet.

Rules:
- Dry-run by default
- Conservative, auditable, reversible
- No implicit destructive moves
- No unrelated refactors

Build:
1. A workspace migration inventory tool
2. A backup/snapshot flow for affected DB rows and workspace directories
3. A dry-run migrator that reports:
   - current company id / slug / workspace_root
   - proposed new path under MC_WORKSPACE_ROOT
   - whether source exists
   - whether destination exists
   - conflicts / collisions / unsafe cases
4. A verification tool that checks:
   - company row consistency
   - project workspace inference
   - agent workspace inference
   - deletion safety compatibility
   - backward compatibility behavior
5. A rollback procedure document

The tooling must clearly distinguish:
- safe auto-migrate
- requires manual review
- blocked / unsafe

Deliverables:
- scripts and docs
- dry-run report from current local state
- concise list of manual-review items

Do not perform the actual cutover in this phase.
```

---

# Phase 4 Prompt — Controlled cutover execution

Use this only after dry-run review and explicit human approval.

```text
Proceed with Phase 4 only.

Goal:
Execute the approved workspace-root cutover safely.

Rules:
- Backup first
- Log everything
- Stop on unsafe conditions
- Prefer reversible file moves
- Verify before declaring success

Cutover requirements:
1. Create fresh backups of affected DB/state and workspace directories
2. Move only approved workspace roots to the new MC_WORKSPACE_ROOT locations
3. Update only the approved DB rows
4. Verify:
   - stable lane works
   - dev lane works
   - company selector works
   - project workspaces resolve
   - agent workspaces resolve
   - deletion safety still works
   - no legacy path is still required for the migrated set
5. Produce a concise cutover report with:
   - moved items
   - unchanged items
   - review-needed items
   - bugs discovered
   - rollback instructions if needed

If any verification fails, stop and report instead of improvising.
```

---

# Recommended human operating pattern

## Best starting point
Start a fresh **Codex** session and use **Phase 1 only** first.

Do not let the first run edit core behavior yet.
The first run should produce the RFC and migration plan.

## After Phase 1
Bring the result back for review.
We should decide explicitly on:
- `~/.mission-control/...` vs `.openclaw/...`
- whether `neveridle-core` should remain special-cased
- how much OpenClaw coupling we are willing to leave in place for now

## My recommendation
Preferred target:
- `~/.mission-control/stable/workspaces`
- `~/.mission-control/dev/workspaces`

That is the clean product boundary.

---

# Quick start version

If you only want one short prompt to begin, use this:

```text
Audit Mission Control workspace architecture and produce an RFC only, no implementation yet.

Repo: /Users/timharris/.openclaw/workspace/projects/mission-control-app
Branch: feat/mission-control-live-parity

We need to separate Mission Control workspace storage from OpenClaw and from dev/stable lane cross-contamination.
Data separation already exists (data vs data-dev), but workspace handling is inconsistent and mixed across multiple conventions.

Investigate all company creation, workspace resolution, agent provisioning, deletion safety, runtime config, tests, and OpenClaw coupling.
Then write docs/workspace-separation-rfc.md with:
- current state
- affected files/subsystems
- recommended target architecture
- phased migration plan
- rollback plan
- risk register
- exact implementation plan

Do not implement the migration yet.
Challenge assumptions and call out any hidden OpenClaw dependencies.
```