# Phase 4c Cleanup Debt Audit And Repo Relocation Plan

Date: 2026-04-11

Update:
- Forge compatibility follow-up is recorded in [forge-compatibility-followup-2026-04-11.md](/Users/timharris/.openclaw/workspace/projects/mission-control-app/docs/forge-compatibility-followup-2026-04-11.md).
- `workspace-forge` remains `REVIEW`, but Mission Control no longer uses it as the preferred live compatibility path.
- Repo execution prep is now tracked in [repo-relocation-runbook.md](/Users/timharris/.openclaw/workspace/projects/mission-control-app/docs/repo-relocation-runbook.md).

Scope:
- audit `workspace-forge`
- fix stale embedded path references for migrated stable agents
- plan repo relocation only
- no repo move
- no new company migration
- no `neveridle-core` changes
- no orphan cleanup

## A. `workspace-forge` Audit

Classification: `REVIEW`

### Evidence

1. The directory exists as a tiny standalone bootstrap workspace, not as a populated company repo.
   - Created and last modified: `2026-04-04 09:50:05 PDT`
   - Path: [workspace-forge](/Users/timharris/.openclaw/workspace-forge)
   - Evidence: it contains only bootstrap/persona files plus a local `.git`, with no app repo, no commits, and no remote.
   - Files:
     - [AGENTS.md](/Users/timharris/.openclaw/workspace-forge/AGENTS.md)
     - [BOOTSTRAP.md](/Users/timharris/.openclaw/workspace-forge/BOOTSTRAP.md)
     - [.git/config](/Users/timharris/.openclaw/workspace-forge/.git/config)
     - [.openclaw/workspace-state.json](/Users/timharris/.openclaw/workspace-forge/.openclaw/workspace-state.json)

2. Mission Control still has an active `Forge` agent row that resolves to this legacy path through compatibility fallback.
   - Agent row: `6f707951-fd68-41b0-bd53-dc6f6222fe5e | Forge | slug=forge | openclaw_agent_id=forge | status=working`
   - Company: `neveridle-core`
   - Resolver logic: [company-paths.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/lib/workspaces/company-paths.ts:117) falls back to `path.join(resolveOpenClawDir(env), \`workspace-\${agentSlug}\`)`.

3. OpenClaw runtime no longer has a live `forge` entry in [openclaw.json](/Users/timharris/.openclaw/openclaw.json).
   - `jq '.agents.list[] | select(.id=="forge" or .name=="Forge")'` returned no entry.
   - This means `workspace-forge` is not currently backed by an active runtime registry binding.

4. Historical OpenClaw agent state still references both `workspace-forge` and `workspace/forge`.
   - Agent state directory: [/Users/timharris/.openclaw/agents/forge](/Users/timharris/.openclaw/agents/forge)
   - Historical sessions:
     - [deleted session trace](/Users/timharris/.openclaw/agents/forge/sessions/4c2c2cbf-65c4-4e24-9d63-3ee28ebdf393.jsonl.deleted.2026-04-07T08-12-16.795Z)
     - [reset session trace](/Users/timharris/.openclaw/agents/forge/sessions/3a7c1435-bcca-4d3e-969e-f4c1a94140f0.jsonl.reset.2026-04-07T11-40-22.462Z)
   - Those sessions show the agent starting in `workspace-forge`, failing to find memory files, then later operating from `/Users/timharris/.openclaw/workspace/forge`.

5. There is evidence of user-facing workflow contact with the `Forge` agent, but not of a current runtime dependency on `workspace-forge` specifically.
   - Repeated stable API hits to `/api/orchestration/companies/neveridle-core/agents/forge` exist in [mission-control-stable.log](/Users/timharris/.openclaw/workspace/projects/mission-control-app/data/mission-control-stable.log).
   - `workspace-forge` itself only shows up in logs as failed file reads:
     - [gateway.err.log](/Users/timharris/.openclaw/logs/gateway.err.log:25371)
     - [gateway.err.log](/Users/timharris/.openclaw/logs/gateway.err.log:25372)
     - [gateway.err.log](/Users/timharris/.openclaw/logs/gateway.err.log:25373)

6. The earlier “compatibility root” label was tooling-driven, not proof of legitimacy.
   - Operator visibility tests explicitly treat `workspace-forge` as a visible `workspace-*` ID if it has an identity file.
   - Evidence: [workspace-visibility.test.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/lib/__tests__/workspace-visibility.test.ts:49)

### Conclusion

`workspace-forge` looks more like experimental or stray bootstrap residue than a legitimate long-lived workspace. However, it is not yet safe to delete because:
- the active `Forge` agent row under `neveridle-core` still resolves to it through compatibility fallback
- there is persisted OpenClaw agent state for `forge`
- the human explicitly does not know its provenance

That keeps the correct classification at `REVIEW`, not `KEEP`, and not `SAFE_TO_REMOVE`.

### What Would Need To Happen Before Removal

Before any removal decision:
1. decide whether `Forge` should be retired, remapped to a canonical workspace, or re-bound to a live runtime entry
2. remove the compatibility dependency by updating or archiving the `Forge` agent row
3. verify that no operator UI, file API, or session monitor flow still resolves `workspace-forge`
4. snapshot [/Users/timharris/.openclaw/workspace-forge](/Users/timharris/.openclaw/workspace-forge) and [/Users/timharris/.openclaw/agents/forge](/Users/timharris/.openclaw/agents/forge) before any deletion

## B. Embedded Path Reference Fixes

These changes were path-text fixes only. No behavior or instruction flow was intentionally changed.

### Corrected Files

- [donald AGENTS.md](/Users/timharris/.mission-control/stable/workspaces/companies/53351dd9-641c-4bf8-aed0-4472188b6cf4/agents/donald/AGENTS.md)
  - before: `/Users/timharris/.openclaw/workspaces/cascade-inc`
  - after: `/Users/timharris/.mission-control/stable/workspaces/companies/53351dd9-641c-4bf8-aed0-4472188b6cf4`
- [sandie AGENTS.md](/Users/timharris/.mission-control/stable/workspaces/companies/d74cdcd1-8d09-41f8-a07a-9167f505252c/agents/sandie/AGENTS.md)
  - before: `/Users/timharris/.openclaw/workspaces/river-s-edge`
  - after: `/Users/timharris/.mission-control/stable/workspaces/companies/d74cdcd1-8d09-41f8-a07a-9167f505252c`
- [rick AGENTS.md](/Users/timharris/.mission-control/stable/workspaces/companies/830d5f6b-b9f1-4288-ada5-89868513c21d/agents/rick/AGENTS.md)
  - before: `/Users/timharris/.openclaw/workspaces/virtual-design-house`
  - after: `/Users/timharris/.mission-control/stable/workspaces/companies/830d5f6b-b9f1-4288-ada5-89868513c21d`
- [bob AGENTS.md](/Users/timharris/.mission-control/stable/workspaces/companies/d74cdcd1-8d09-41f8-a07a-9167f505252c/agents/bob/AGENTS.md)
  - before: `/Users/timharris/.openclaw/workspaces/river-s-edge/agents/bob`
  - after: `/Users/timharris/.mission-control/stable/workspaces/companies/d74cdcd1-8d09-41f8-a07a-9167f505252c/agents/bob`
- [bill AGENTS.md](/Users/timharris/.mission-control/stable/workspaces/companies/d74cdcd1-8d09-41f8-a07a-9167f505252c/agents/bill/AGENTS.md)
  - before: `/Users/timharris/.openclaw/workspaces/river-s-edge/agents/bill`
  - after: `/Users/timharris/.mission-control/stable/workspaces/companies/d74cdcd1-8d09-41f8-a07a-9167f505252c/agents/bill`
- [top-dog AGENTS.md](/Users/timharris/.mission-control/stable/workspaces/companies/d5f5283f-9421-434c-a31c-7a5a3570b1df/agents/top-dog/AGENTS.md)
  - before: `/Users/timharris/.openclaw/workspaces/tims-jobs`
  - after: `/Users/timharris/.mission-control/stable/workspaces/companies/d5f5283f-9421-434c-a31c-7a5a3570b1df/agents/top-dog`

Residual note:
- `top-dog` still has legacy CEO-style wording around “Everything about the company lives here.” The path is now correct; the remaining wording issue is behavior/prompt debt and was left alone in this phase.

## C. Repo Relocation Plan

Target move:
- from: `/Users/timharris/.openclaw/workspace/projects/mission-control-app`
- to: `/Users/timharris/.mission-control/app`

Planning only. No move was executed in Phase 4c.

### Exact Hardcoded Repo-Path References That Must Change

#### Launchd plists

- [config/com.harris-autonomous.mc-dev.plist](/Users/timharris/.openclaw/workspace/projects/mission-control-app/config/com.harris-autonomous.mc-dev.plist)
- [config/com.harris-autonomous.mc-stable.plist](/Users/timharris/.openclaw/workspace/projects/mission-control-app/config/com.harris-autonomous.mc-stable.plist)
- [config/com.harrisautonomous.mission-control-dev.watchdog.plist](/Users/timharris/.openclaw/workspace/projects/mission-control-app/config/com.harrisautonomous.mission-control-dev.watchdog.plist)
- [config/com.harrisautonomous.mission-control-stable.watchdog.plist](/Users/timharris/.openclaw/workspace/projects/mission-control-app/config/com.harrisautonomous.mission-control-stable.watchdog.plist)
- [config/com.harris-autonomous.mc-worker.plist](/Users/timharris/.openclaw/workspace/projects/mission-control-app/config/com.harris-autonomous.mc-worker.plist)

These embed the current repo path as `ProgramArguments`, `WorkingDirectory`, environment data roots, and log destinations.

#### Shell scripts and operational tooling

- [scripts/run_dev_service.sh](/Users/timharris/.openclaw/workspace/projects/mission-control-app/scripts/run_dev_service.sh)
- [scripts/run_stable_service.sh](/Users/timharris/.openclaw/workspace/projects/mission-control-app/scripts/run_stable_service.sh)
- [scripts/start_dev_service.sh](/Users/timharris/.openclaw/workspace/projects/mission-control-app/scripts/start_dev_service.sh)
- [scripts/start_stable_service.sh](/Users/timharris/.openclaw/workspace/projects/mission-control-app/scripts/start_stable_service.sh)
- [scripts/stop_dev_service.sh](/Users/timharris/.openclaw/workspace/projects/mission-control-app/scripts/stop_dev_service.sh)
- [scripts/stop_stable_service.sh](/Users/timharris/.openclaw/workspace/projects/mission-control-app/scripts/stop_stable_service.sh)
- [scripts/healthcheck_dev_service.sh](/Users/timharris/.openclaw/workspace/projects/mission-control-app/scripts/healthcheck_dev_service.sh)
- [scripts/healthcheck_stable_service.sh](/Users/timharris/.openclaw/workspace/projects/mission-control-app/scripts/healthcheck_stable_service.sh)
- [scripts/doctor.sh](/Users/timharris/.openclaw/workspace/projects/mission-control-app/scripts/doctor.sh)
- [scripts/lane.sh](/Users/timharris/.openclaw/workspace/projects/mission-control-app/scripts/lane.sh)
- [scripts/mc-watchdog.sh](/Users/timharris/.openclaw/workspace/projects/mission-control-app/scripts/mc-watchdog.sh)
- [scripts/mission_control_watchdog.sh](/Users/timharris/.openclaw/workspace/projects/mission-control-app/scripts/mission_control_watchdog.sh)
- [scripts/promote_to_stable.sh](/Users/timharris/.openclaw/workspace/projects/mission-control-app/scripts/promote_to_stable.sh)
- [scripts/rollback_stable.sh](/Users/timharris/.openclaw/workspace/projects/mission-control-app/scripts/rollback_stable.sh)
- [scripts/stable_release_common.sh](/Users/timharris/.openclaw/workspace/projects/mission-control-app/scripts/stable_release_common.sh)
- [scripts/perf-audit-seed.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/scripts/perf-audit-seed.ts)

Most of these hardcode `APP_DIR="/Users/timharris/.openclaw/workspace/projects/mission-control-app"`.
`perf-audit-seed.ts` hardcodes the DB file directly.

#### Runtime logging paths

The launchd/watchdog files above also hardcode repo-local log files:
- `data/mission-control-dev.log`
- `data/mission-control-dev.err.log`
- `data/mission-control-stable.log`
- `data/mission-control-stable.err.log`
- `data/mc-dev-watchdog.out.log`
- `data/mc-dev-watchdog.err.log`
- `data/mc-stable-watchdog.out.log`
- `data/mc-stable-watchdog.err.log`

These need to move in lockstep with the repo path, or be abstracted behind `APP_DIR`.

#### Code assumptions about repo location

Repo-path-specific:
- [src/app/(dashboard)/terminal/page.tsx](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/(dashboard)/terminal/page.tsx)
  - hardcodes `git -C /Users/timharris/.openclaw/workspace/projects/mission-control-app`
  - hardcodes `ls /Users/timharris/.openclaw/workspace/projects`

Not strictly repo-path-specific, but still relevant OpenClaw coupling:
- [src/lib/data-dir.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/lib/data-dir.ts)
  - falls back to `process.cwd()/data`
- [src/lib/orchestration/db.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/lib/orchestration/db.ts)
  - DB location is repo-agnostic if `MC_DATA_DIR` is set, otherwise inherits the `process.cwd()/data` fallback
- [src/app/api/git/route.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/api/git/route.ts)
- [src/app/api/actions/route.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/api/actions/route.ts)
- [src/app/(dashboard)/trading/page.tsx](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/(dashboard)/trading/page.tsx)
- [src/app/api/trading/weather-stats/route.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/api/trading/weather-stats/route.ts)
- [src/app/api/trading/positions/route.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/api/trading/positions/route.ts)
- [src/app/api/trading/kalshi-portfolio/route.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/api/trading/kalshi-portfolio/route.ts)
- [src/app/api/trading/kalshi-positions/route.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/app/api/trading/kalshi-positions/route.ts)

Those are broader OpenClaw-workspace assumptions rather than direct Mission Control repo-path assumptions. They do not all block the repo move itself, but they remain compatibility debt.

#### Docs

Absolute current repo-path references exist in:
- [README.md](/Users/timharris/.openclaw/workspace/projects/mission-control-app/README.md)
- [docs/two-lane-runtime.md](/Users/timharris/.openclaw/workspace/projects/mission-control-app/docs/two-lane-runtime.md)
- [docs/workspace-separation-rfc.md](/Users/timharris/.openclaw/workspace/projects/mission-control-app/docs/workspace-separation-rfc.md)
- [docs/workspace-separation-agent-prompts.md](/Users/timharris/.openclaw/workspace/projects/mission-control-app/docs/workspace-separation-agent-prompts.md)
- [docs/workspace-separation-phase2-checkpoint.md](/Users/timharris/.openclaw/workspace/projects/mission-control-app/docs/workspace-separation-phase2-checkpoint.md)
- [docs/workspace-migration-dry-run-2026-04-11.md](/Users/timharris/.openclaw/workspace/projects/mission-control-app/docs/workspace-migration-dry-run-2026-04-11.md)
- [docs/paperclip-parity-backlog.md](/Users/timharris/.openclaw/workspace/projects/mission-control-app/docs/paperclip-parity-backlog.md)

The generated audit/history docs can remain historical, but any operational doc should be updated or clearly marked as historical.

### Does Phase 3 Migration Tooling Assume The Repo Is Still Under `.openclaw/workspace`?

Answer: not materially.

- [scripts/workspace-migration.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/scripts/workspace-migration.ts) has no hardcoded repo path.
- [src/lib/workspaces/migration.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/lib/workspaces/migration.ts) resolves the DB via `ORCHESTRATION_DB_PATH` or `MC_DATA_DIR`, not a hardcoded repo path.
- [src/lib/orchestration/db.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/lib/orchestration/db.ts) does the same.
- [src/lib/data-dir.ts](/Users/timharris/.openclaw/workspace/projects/mission-control-app/src/lib/data-dir.ts) falls back to `process.cwd()/data`, so it remains repo-location-sensitive only if `MC_DATA_DIR` is omitted.

Conclusion:
- the migration tooling is usable after repo relocation as long as `MC_DATA_DIR` or `ORCHESTRATION_DB_PATH` remains correctly set
- the tooling is not itself a blocker
- generated docs from prior runs will still contain old absolute paths and become historical artifacts

### Ordered Relocation Plan

1. Freeze the scope.
   - No company/workspace migration work in the same turn.
   - No `neveridle-core` changes during the repo move itself.

2. Snapshot the current repo runtime configuration.
   - Back up the current launchd plists.
   - Back up the service/watchdog scripts.
   - Back up the current repo-local `data/` and `data-dev/` directories or confirm they remain in place.

3. Introduce a single `APP_DIR` source of truth in scripts/plists.
   - Replace hardcoded repo paths with the target `/Users/timharris/.mission-control/app`.
   - Prefer deriving log/data paths from `APP_DIR` rather than duplicating absolute strings.

4. Update repo-path-sensitive product surfaces.
   - Fix the terminal page commands.
   - Fix any operational scripts still pointing at the old repo path.
   - Fix `perf-audit-seed.ts`.

5. Move the repo as a filesystem copy first.
   - Copy `/Users/timharris/.openclaw/workspace/projects/mission-control-app` to `/Users/timharris/.mission-control/app`.
   - Leave the original repo in place until verification passes.

6. Rebind runtime configuration to the new repo location.
   - Update launchd plists to the new `WorkingDirectory` and script paths.
   - Reload/restart the affected Mission Control services from the new location.

7. Verify with the new repo location live.
   - Confirm dev/stable services boot.
   - Confirm `MC_DATA_DIR` and `MC_WORKSPACE_ROOT` still resolve correctly.
   - Confirm migration tooling still reads the same DB and workspace roots.

8. Only after a successful soak, decide whether the old repo copy can be retired.

### Rollback Plan

Rollback triggers:
- service fails to boot from `/Users/timharris/.mission-control/app`
- wrong lane data directory is used
- wrong `MC_WORKSPACE_ROOT` is used
- launchd reload points at stale paths or produces restart loops
- Mission Control file browsing or terminal surfaces still hardcode the old repo and fail
- dry-run or verify tooling reports new blocked findings

Rollback steps:
1. stop the new launchd jobs
2. restore the prior plists and script references from backup
3. restart the old services from `/Users/timharris/.openclaw/workspace/projects/mission-control-app`
4. keep the copied repo at `/Users/timharris/.mission-control/app` for inspection, but do not keep it active
5. rerun:
   - stable/dev healthchecks
   - `npm run workspace:migration:verify -- --format json`

### Post-Move Verification Checklist

- `pwd` inside the service runtime resolves to `/Users/timharris/.mission-control/app`
- stable lane serves from the new repo path
- dev lane serves from the new repo path
- stable lane still uses the stable data directory
- dev lane still uses the dev data directory
- both lanes still export the correct `MC_WORKSPACE_ROOT`
- `npm run workspace:migration:verify -- --format json` stays at zero blocked findings
- the four migrated stable companies still resolve to Mission Control-owned roots
- runtime-aligned agents `donald`, `sandie`, `rick`, `bob`, `bill`, and `top-dog` still point at the canonical Mission Control workspace paths
- `neveridle-core` still points at `/Users/timharris/.openclaw/workspace`
- terminal/dashboard repo actions no longer assume the old path

### Explicit Blockers Before Repo Relocation

1. `workspace-forge` is unresolved and still compatibility-addressable.
   - Not a direct repo-move blocker on its own, but it is unresolved cleanup debt under `neveridle-core`.

2. The service stack still hardcodes the current repo path in many scripts and plists.

3. The terminal page still hardcodes the current repo path.

4. `perf-audit-seed.ts` hardcodes the current repo DB path.

5. Historical and operational docs still embed the current repo path.

6. `MC_DATA_DIR` fallback behavior still depends on the process working directory when the env var is absent.
   - This is survivable but should not be left implicit during a move.

7. Broader OpenClaw coupling remains.
   - The repo move should not attempt to solve `neveridle-core`, trading-path assumptions, `workspace-forge`, or the remaining operator/file-API compatibility surface in the same step.

## D. Recommendation

Current readiness for a dedicated repo-relocation phase: `not ready yet`

Why:
- the repo move itself is straightforward
- the operational configuration around it is still partially hardcoded
- there is unresolved `neveridle-core` compatibility debt, including `workspace-forge`
- there are product surfaces and scripts that still assume the repo lives under `.openclaw/workspace`

What should happen next:
1. land the repo-relocation prep changes only
2. explicitly replace hardcoded `APP_DIR` and repo-path references
3. keep the move copy-first and reversible
4. leave `neveridle-core` and `workspace-forge` untouched during the repo move itself
