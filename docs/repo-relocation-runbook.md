# Repo Relocation Runbook

Date: 2026-04-11

Goal:
- prepare the Mission Control repo to move from `/Users/timharris/.openclaw/workspace/projects/mission-control-app`
- to `/Users/timharris/.mission-control/app`
- without changing company migrations, `neveridle-core`, or `workspace-forge`

Status:
- readiness implemented
- repo move not executed in this phase

## Scope

This runbook covers repo relocation only.

Out of scope:
- additional company workspace migration
- `neveridle-core` storage/runtime redesign
- `workspace-forge` removal
- orphan cleanup
- repo move execution in this phase

`workspace-forge` remains `REVIEW` and is explicitly not part of the repo move.

## Files Changed In This Readiness Phase

### Runtime helpers

- `src/lib/runtime-paths.ts`
- `src/lib/data-dir.ts`
- `src/app/api/terminal/route.ts`
- `src/app/(dashboard)/terminal/page.tsx`

### Scripts

- `scripts/lib/runtime-paths.sh`
- `scripts/run_dev_service.sh`
- `scripts/run_stable_service.sh`
- `scripts/start_dev_service.sh`
- `scripts/start_stable_service.sh`
- `scripts/stop_dev_service.sh`
- `scripts/stop_stable_service.sh`
- `scripts/healthcheck_dev_service.sh`
- `scripts/healthcheck_stable_service.sh`
- `scripts/doctor.sh`
- `scripts/lane.sh`
- `scripts/mc-watchdog.sh`
- `scripts/mission_control_watchdog.sh`
- `scripts/promote_to_stable.sh`
- `scripts/rollback_stable.sh`
- `scripts/stable_release_common.sh`
- `scripts/perf-audit-seed.ts`
- `scripts/cleanup-test-artifacts.ts`

### Config and tests

- `config/com.harris-autonomous.mc-dev.plist`
- `config/com.harris-autonomous.mc-stable.plist`
- `config/com.harrisautonomous.mission-control-dev.watchdog.plist`
- `config/com.harrisautonomous.mission-control-stable.watchdog.plist`
- `config/com.harris-autonomous.mc-worker.plist`
- `src/lib/__tests__/runtime-paths.test.ts`
- `e2e/dashboard-metrics.spec.ts`

### Docs

- `README.md`
- `docs/two-lane-runtime.md`
- `docs/repo-relocation-runbook.md`

## What Changed

1. `MC_APP_ROOT` is now the canonical repo-root contract for runtime scripts and launchd wrappers.
2. Service scripts derive `MC_APP_ROOT` from their own location when it is unset, so the current checkout still works in place.
3. `MC_DATA_DIR` now falls back to `MC_APP_ROOT/data` rather than binding directly to `process.cwd()/data`.
4. Browser terminal execution now runs from `MC_APP_ROOT`, and quick commands no longer hardcode the current repo path.
5. Launchd plists now execute scripts through `MC_APP_ROOT` and no longer hardcode repo-local script paths or working directories.
6. Launchd log targets are prepared for `/Users/timharris/.mission-control/logs`, so repo relocation does not need to keep logs inside the checkout.

## Final Ordered Relocation Procedure

1. Confirm the current workspace state is still acceptable for move execution.
   - `npm run workspace:migration:verify -- --format json`
   - confirm `blocked=0`
   - confirm `workspace-forge` remains `REVIEW` and untouched

2. Back up repo and runtime config first.
   - copy the current repo to a dated backup path
   - copy the launchd plist files from `config/`
   - copy the installed `~/Library/LaunchAgents/` Mission Control plists if present
   - snapshot `/Users/timharris/.mission-control/logs` if it exists
   - snapshot repo-local `data/`, `data-dev/`, and `.stable/`

3. Copy the repo to the target path.
   - source: `/Users/timharris/.openclaw/workspace/projects/mission-control-app`
   - target: `/Users/timharris/.mission-control/app`
   - do not delete the source checkout

4. Update only the checked-in plist `MC_APP_ROOT` values from old path to new path.
   - `config/com.harris-autonomous.mc-dev.plist`
   - `config/com.harris-autonomous.mc-stable.plist`
   - `config/com.harrisautonomous.mission-control-dev.watchdog.plist`
   - `config/com.harrisautonomous.mission-control-stable.watchdog.plist`
   - `config/com.harris-autonomous.mc-worker.plist`

5. Reinstall or overwrite the live launchd plist copies from the relocated repo.
   - copy the checked-in plists into `~/Library/LaunchAgents/`
   - do not mutate unrelated launchd jobs

6. Start from the relocated repo only after config is updated.
   - dev lane from `/Users/timharris/.mission-control/app/scripts/start_dev_service.sh`
   - stable lane from `/Users/timharris/.mission-control/app/scripts/start_stable_service.sh`

7. Verify the relocated runtime.
   - `MC_APP_ROOT=/Users/timharris/.mission-control/app scripts/doctor.sh`
   - healthcheck dev and stable
   - browser terminal quick commands
   - `npm run workspace:migration:verify -- --format json`

8. Soak before retirement.
   - leave the old checkout in place until validation and operator checks pass
   - do not clean up the old repo copy in the same turn as the move

## Backup-First Checklist

- repo copy backup exists
- `data/` backup exists
- `data-dev/` backup exists
- `.stable/` backup exists
- checked-in plists backup exists
- installed launchd plist backup exists
- `/Users/timharris/.mission-control/logs` backup exists if present

If any backup is missing, do not execute the move.

## Rollback Procedure

Trigger rollback if any of these happen:
- launchd jobs fail to start from the relocated repo
- dev or stable healthchecks fail after the move
- browser terminal fails because `MC_APP_ROOT` is wrong
- repo-local code paths still point at the old checkout
- `npm run workspace:migration:verify -- --format json` introduces any new `blocked` finding

Rollback steps:
1. stop the relocated dev/stable services
2. restore the old checked-in and installed launchd plists
3. restart from `/Users/timharris/.openclaw/workspace/projects/mission-control-app`
4. keep `/Users/timharris/.mission-control/app` for inspection
5. rerun:
   - `scripts/doctor.sh`
   - `npm run workspace:migration:verify -- --format json`

## Post-Move Verification Checklist

- `MC_APP_ROOT` in all Mission Control plists points to `/Users/timharris/.mission-control/app`
- dev lane starts and serves `http://127.0.0.1:3010/api/mc/health`
- stable lane starts and serves `http://127.0.0.1:3001/api/mc/health`
- `scripts/doctor.sh` reports the expected PIDs and healthy lanes
- browser terminal quick commands still work
- `npm run workspace:migration:verify -- --format json` still returns `blocked=0`
- migrated stable companies still resolve to Mission Control-owned roots
- `neveridle-core` remains on `/Users/timharris/.openclaw/workspace`
- `workspace-forge` remains untouched and still classified `REVIEW`

## Remaining Out-Of-Scope Debt After Relocation

- `neveridle-core` still depends on the OpenClaw default workspace
- `workspace-forge` still exists on disk and remains `REVIEW`
- historical docs still contain old absolute repo paths as audit artifacts
- broader OpenClaw runtime decoupling is still separate work

## Ready-State Assessment

The system is ready for a dedicated repo-relocation execution phase next.

The remaining work for that phase is operational:
- copy the repo
- update `MC_APP_ROOT` in the plist files
- reinstall launchd config
- verify

The move no longer depends on hidden hardcoded repo-path assumptions in the service scripts, terminal quick commands, or the data-dir fallback.
