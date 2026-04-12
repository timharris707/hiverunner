# Two-Lane Local Runtime

Mission Control runs two independent lanes on the same machine:

| Lane   | Port | Mode       | Directory    | Purpose                    |
|--------|------|------------|--------------|----------------------------|
| Dev    | 3010 | development| repo root    | Active development (HMR)   |
| Stable | 3001 | production | `.stable/`   | Last-known-good build      |

Port `3000` is retired for Mission Control. It is not a supported dev lane or stable lane. If anything is listening on `3000`, treat that as a separate app or an accidental/manual compatibility run, not part of the two-lane runtime.

## Quick Reference

```sh
# Unified CLI
scripts/lane.sh dev start          # start dev lane
scripts/lane.sh dev stop           # stop dev lane
scripts/lane.sh stable status      # check stable lane
scripts/lane.sh stable logs        # tail stable logs
scripts/lane.sh promote            # tag + build + deploy to stable
scripts/lane.sh promote --reconcile-live --allow-dirty
                                   # repair bookkeeping for the current live stable lane
scripts/lane.sh rollback           # roll stable back to prior checkpoint

# Or use individual scripts directly
scripts/start_dev_service.sh
scripts/stop_dev_service.sh
scripts/start_stable_service.sh
scripts/stop_stable_service.sh
scripts/promote_to_stable.sh
scripts/promote_to_stable.sh --reconcile-live --allow-dirty
scripts/rollback_stable.sh
```

## Path Contract

Local runtime path ownership is now explicit:

- `MC_APP_ROOT` identifies the Mission Control checkout root
- `MC_DATA_DIR` identifies the lane data directory
- `MC_LOG_DIR` identifies the service/watchdog PID and log directory
- `MC_WORKSPACE_ROOT` identifies the Mission Control-owned company workspace root

The checked-in scripts derive `MC_APP_ROOT` from their own location when it is unset, so the current checkout still works in place. Launchd plists set `MC_APP_ROOT` explicitly so repo relocation only needs a controlled config change rather than hidden path edits.

## Recommended Workflow

```sh
# 1. Work in dev lane
scripts/lane.sh dev start

# 2. Commit the exact build you want stable to represent
git add <files>
git commit -m "..."
git push origin <branch>

# 3. Promote that committed checkpoint
scripts/lane.sh promote

# 4. Push the release checkpoint tag to GitHub
git push origin <stable-tag-from-promote-output>

# 5. If stable regresses, roll back to the previous promoted checkpoint
scripts/lane.sh rollback
```

Promotion is intentionally commit-backed. By default `scripts/promote_to_stable.sh` refuses to run if the repo is dirty, because the stable lane should map cleanly to a git commit and tag. If you intentionally need to deploy a dirty tree, pass `--allow-dirty` and expect the release metadata to record that the deployed state diverged from `HEAD`.

## Promotion Flow

```
  repo (dev on :3010)
       │
       │  scripts/promote_to_stable.sh
       │
       ├─ 1. npm run build (production bundle)
       ├─ 2. Create annotated git tag stable/<timestamp>-<sha>
       ├─ 3. Stop stable lane if running
       ├─ 4. Backup previous .stable/ (keeps 2 backups)
       ├─ 5. Copy build artifacts + server.js + config to .stable/
       │     (node_modules + data/ + public/ are symlinked)
       ├─ 6. Write release metadata under data/releases/stable/
       ├─ 7. Start stable lane on :3001
       └─ 8. Health-check verification
```

Promotion records:

- `.stable/.promotion-metadata.json` for the live stable lane.
- `data/releases/stable/current.env` for the currently deployed checkpoint and its previous checkpoint.
- `data/releases/stable/history/<release-id>.json` for an operator-readable history trail.
- A local annotated git tag such as `stable/20260402T183000Z-abc1234`.

The git tag is the checkpoint of record. Push it to GitHub after a successful promotion so the checkpoint exists off-machine too.

If stable is already running but the bookkeeping files are missing, reconcile the live lane without rebuilding it:

```sh
scripts/promote_to_stable.sh --reconcile-live --allow-dirty
```

## Rollback Flow

`scripts/rollback_stable.sh` rebuilds the target commit in a temporary git worktree and redeploys stable from that build. This keeps the active dev checkout untouched.

```sh
# Preview the target without changing anything
scripts/rollback_stable.sh --dry-run

# Inspect the current and previous promoted checkpoint metadata
scripts/rollback_stable.sh --inspect

# Roll back to the previous promoted checkpoint
scripts/rollback_stable.sh

# Roll back to a specific checkpoint
scripts/rollback_stable.sh --to-tag stable/20260402T183000Z-abc1234
scripts/rollback_stable.sh --to-commit abc1234
```

Default rollback uses the previous promoted checkpoint from `data/releases/stable/current.env`. That means operator-safe rollback with no arguments only works after at least two successful promotions have been recorded.

After the first promotion, stable has a current checkpoint but no previous promoted checkpoint yet. In that case `scripts/rollback_stable.sh` and `scripts/rollback_stable.sh --dry-run` fail clearly, explain why, and tell the operator to either:

- promote stable again so a previous promoted checkpoint exists for future default rollback, or
- supply `--to-tag <stable/...>` or `--to-commit <sha>` explicitly.

Use `scripts/rollback_stable.sh --inspect` to view the recorded current and previous checkpoint metadata without making any changes.

## File Layout

```
$MC_LOG_DIR or $MC_APP_ROOT/data
  mission-control-dev.pid         # dev PID
  mission-control-dev.log         # dev stdout
  mission-control-dev.err.log     # dev stderr
  mc-dev-watchdog.out.log         # dev watchdog output
  mc-dev-watchdog.err.log         # dev watchdog errors
  mission-control-stable.pid      # stable PID
  mission-control-stable.log      # stable stdout
  mission-control-stable.err.log  # stable stderr
  mc-stable-watchdog.out.log      # stable watchdog output
  mc-stable-watchdog.err.log      # stable watchdog errors
```

The launchd plist files are prepared to use `MC_LOG_DIR=/Users/timharris/.mission-control/logs`. Manual script execution still defaults to `$MC_APP_ROOT/data` unless `MC_LOG_DIR` is set.

## Watchdog (launchd)

Each lane has its own launchd plist that runs a healthcheck every 15 seconds:

```sh
# Install watchdogs
cp config/com.harris-autonomous.mc-dev.plist ~/Library/LaunchAgents/
cp config/com.harris-autonomous.mc-stable.plist ~/Library/LaunchAgents/

# Load/unload
launchctl load ~/Library/LaunchAgents/com.harris-autonomous.mc-dev.plist
launchctl load ~/Library/LaunchAgents/com.harris-autonomous.mc-stable.plist

launchctl unload ~/Library/LaunchAgents/com.harris-autonomous.mc-stable.plist
```

The stable watchdog gracefully skips if no `.stable/.next` build exists yet.

## Databases

Mission Control separates lane data with `MC_DATA_DIR`:

- Dev uses `data-dev/`
- Stable uses `data/`

Stable still deploys from `.stable/`, but the lanes no longer share the same orchestration SQLite path by default.

## Workspace Roots

Mission Control separates company workspace storage with `MC_WORKSPACE_ROOT`:

- Dev defaults to `~/.mission-control/dev/workspaces`
- Stable defaults to `~/.mission-control/stable/workspaces`

Company rows now persist an immutable `workspace_slug` alongside the mutable route `slug`.
Managed company rows still resolve from persisted `workspace_root`, and the canonical on-disk folder shape is now:

```text
${MC_WORKSPACE_ROOT}/companies/<workspace_slug>--<companyId>
```

Existing persisted `workspace_root` values are still honored during the transition. `neveridle-core` remains explicitly backed by the OpenClaw default workspace for compatibility and is not auto-migrated by this phase.

Phase 3 tooling for this migration:

```sh
npm run workspace:migration:inventory
npm run workspace:migration:dry-run
npm run workspace:migration:snapshot
npm run workspace:migration:verify
```

Use [workspace-migration-rollback.md](workspace-migration-rollback.md) for workspace-cutover rollback and [repo-relocation-runbook.md](repo-relocation-runbook.md) for the repo move procedure and rollback checklist.

## Caveats

- First promotion requires `npm run build` to succeed (TypeScript errors are currently ignored via `ignoreBuildErrors`).
- `.stable/` is gitignored — it's a deployment artifact, not source.
- `data/releases/stable/` is gitignored operational state. The durable checkpoint is the git tag you push to GitHub.
- Rollback rebuilds from a temporary worktree and reuses the repo's current `node_modules`. If dependencies changed incompatibly between checkpoints, install the matching dependencies before retrying.
- Improving `.gitignore` does not untrack files that are already committed. Existing tracked runtime artifacts will keep showing up in `git status` until they are explicitly removed from the index in a separate cleanup commit.
