# Two-Lane Local Runtime

HiveRunner runs two independent lanes on the same machine:

| Lane   | Port | Mode       | Directory    | `MC_ENGINE_TICK` | Purpose                    |
|--------|------|------------|--------------|------------------|----------------------------|
| Dev    | 3010 | development| repo root    | `off` (forced)   | UI/build observer lane — no autonomous execution |
| Stable | 3001 | production | `.stable/`   | `on`             | Execution owner + last-known-good build |

`3010` is the UI/build observer lane. It is forced observer-only and **must
not** execute autonomous work. Active execution belongs on stable `3001`, or
on a separate explicit isolated execution lane (different port, different
`MC_DATA_DIR`, different `MC_WORKSPACE_ROOT`) — see
[Active Dev Execution](#active-dev-execution).

`MC_ENGINE_TICK=off` is the safe posture for sandbox lanes, CI smoke runs,
and any process you do not want to claim queued orchestration work.

Port `3000` is retired for HiveRunner. It is not a supported dev lane or stable lane. If anything is listening on `3000`, treat that as a separate app or an accidental/manual compatibility run, not part of the two-lane runtime.

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

- `MC_APP_ROOT` identifies the HiveRunner checkout root
- `MC_DATA_DIR` identifies the lane data directory
- `MC_LOG_DIR` identifies the script-managed PID and log directory
- `MC_WORKSPACE_ROOT` identifies the HiveRunner-owned company workspace root

The checked-in scripts derive `MC_APP_ROOT` from their own location when it is
unset, so the current checkout works in place without private launchd plists or
machine-specific config files.

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
       ├─ 1. npm run build (production bundle; 12GB heap default)
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
  hiverunner-dev.pid         # dev PID
  hiverunner-dev.log         # dev stdout
  hiverunner-dev.err.log     # dev stderr
  hr-dev-watchdog.out.log         # dev watchdog output
  hr-dev-watchdog.err.log         # dev watchdog errors
  hiverunner-stable.pid      # stable PID
  hiverunner-stable.log      # stable stdout
  hiverunner-stable.err.log  # stable stderr
  hr-stable-watchdog.out.log      # stable watchdog output
  hr-stable-watchdog.err.log      # stable watchdog errors
```

Manual script execution defaults to `$MC_APP_ROOT/data` unless `MC_LOG_DIR` is
set to a local path.

## Process Management

The dev lane is script-managed by default:

- `scripts/start_dev_service.sh` starts `scripts/run_dev_service.sh` in the
  background with `nohup`, writes `hiverunner-dev.pid`, and logs to
  `hiverunner-dev.log` under `MC_LOG_DIR` (default: `data/`).
- Port `3010` is forced observer-only. `scripts/run_dev_service.sh`,
  `server.js`, and `/api/hiverunner/health` all report `MC_ENGINE_TICK=off`,
  `role=observer`, even if `MC_DEV_EXECUTION_TEST_MODE=1` or an operator
  accidentally exports `MC_ENGINE_TICK=on`.
- In `MC_DEV_EXECUTION_TEST_MODE=1`, protected runtime controls can still be
  visible for testing, but the 3010 process must not own active engine ticks.
- `scripts/stop_dev_service.sh` stops the tracked process and clears stale
  lock/failure files.
- `scripts/healthcheck_dev_service.sh` is a manual or external-supervisor
  recovery probe. It defers restarts during boot grace and adopts a listener
  restarted by an external supervisor instead of spawning a duplicate process
  that would race into `EADDRINUSE`.

The public repo does not ship machine-specific launchd plists. If you want
automatic restart, point launchd, systemd, pm2, or another local supervisor at
`scripts/healthcheck_dev_service.sh` from outside the repo.

## Databases

HiveRunner separates lane data with `MC_DATA_DIR`:

- Dev uses `data-dev/`
- Stable uses `data/`

Stable still deploys from `.stable/`, but the lanes no longer share the same orchestration SQLite path by default.

## Active Dev Execution

Do not turn on active execution in the `3010` lane. The RCA from the 3010
stability incident showed that combining active ticks with cold Next dev
compiles, prewarm traffic, watchdog restarts, and cache clears can destabilize
the UI/build lane.

If active dev execution is needed, create a separate disabled-by-default lane
rather than reusing `3010`. The lane must have:

- a distinct port, such as `3011` or `3020`
- a distinct `MC_DATA_DIR`
- a distinct `MC_WORKSPACE_ROOT`
- distinct PID/log files
- an explicit `MC_ENGINE_TICK=on`
- a clear dry-run or operator-confirmed start path

Example design sketch only; do not run this against real orchestration state
without a dedicated script and validation:

```sh
PORT=3020 \
MC_DATA_DIR="$PWD/data-exec-dev" \
MC_WORKSPACE_ROOT="$HOME/.hiverunner/exec-dev/workspaces" \
MC_LOG_DIR="$PWD/data-exec-dev/logs" \
MC_ENGINE_TICK=on \
NODE_ENV=development \
node --max-old-space-size=8192 server.js
```

Before enabling that lane, seed or copy only the data intended for execution,
verify no other process owns that `MC_DATA_DIR`, and keep `3010` observer-only.

## Workspace Roots

HiveRunner separates company workspace storage with `MC_WORKSPACE_ROOT`:

- Dev defaults to `~/.hiverunner/dev/workspaces`
- Stable defaults to `~/.hiverunner/stable/workspaces`

Company rows now persist an immutable `workspace_slug` alongside the mutable route `slug`.
Managed company rows still resolve from persisted `workspace_root`, and the canonical on-disk folder shape is now:

```text
${MC_WORKSPACE_ROOT}/companies/<workspace_slug>--<companyId>
```

Existing persisted `workspace_root` values are still honored during the
transition. Legacy OpenClaw-backed workspaces remain explicit compatibility
cases and are not auto-migrated by this phase.

Phase 3 tooling for this migration:

```sh
npm run workspace:migration:inventory
npm run workspace:migration:dry-run
npm run workspace:migration:snapshot
npm run workspace:migration:verify
```

For public installs, keep rollback tied to git tags and local backups of
`MC_DATA_DIR` and `MC_WORKSPACE_ROOT`.

## Caveats

- First promotion requires `npm run build` to succeed (TypeScript errors are currently ignored via `ignoreBuildErrors`). The build wrapper defaults to a 12GB Node heap via `HIVERUNNER_BUILD_HEAP_MB=12288`.
- For reproducible validation, use `npm run build:tracked`. It exports tracked files into a temporary directory with `git archive`, installs from `package-lock.json`, then runs audit, typecheck, and build. Do not validate production builds from a copied dirty working tree.
- `.stable/` is gitignored — it's a deployment artifact, not source.
- `data/releases/stable/` is gitignored operational state. The durable checkpoint is the git tag you push to GitHub.
- Rollback rebuilds from a temporary worktree and reuses the repo's current `node_modules`. If dependencies changed incompatibly between checkpoints, install the matching dependencies before retrying.
- Improving `.gitignore` does not untrack files that are already committed. Existing tracked runtime artifacts will keep showing up in `git status` until they are explicitly removed from the index in a separate cleanup commit.
