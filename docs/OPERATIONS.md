# HiveRunner Operations Runbook

> How to operate, diagnose, and recover the HiveRunner local runtime.
> Written 2026-04-05. Kept honest about what is real vs aspirational.

## Quick Reference

```bash
# Diagnose everything
scripts/lane.sh doctor

# Fix stale PIDs automatically
scripts/lane.sh doctor --fix

# Dev lane
scripts/lane.sh dev start
scripts/lane.sh dev stop
scripts/lane.sh dev restart
scripts/lane.sh dev status
scripts/lane.sh dev logs

# Stable lane
scripts/lane.sh stable start
scripts/lane.sh stable stop
scripts/lane.sh stable restart
scripts/lane.sh stable status

# Promote dev → stable
scripts/lane.sh promote

# Roll back stable
scripts/lane.sh rollback
```

---

## Architecture: Two-Lane Runtime

```
Dev Lane (:3010)                    Stable Lane (:3001)
├── NODE_ENV=development            ├── NODE_ENV=production
├── MC_ENGINE_TICK=off              ├── MC_ENGINE_TICK=on
├── Role: observer (no execution)   ├── Role: executor (owns execution)
├── Hot reload (Next dev / webpack) ├── Pre-built (.stable/.next/)
├── Subject to dev-cache issues     ├── Isolated from dev cache
├── Used during active dev          ├── Used as operator surface
├── .next/dev/ (ephemeral)          ├── .stable/ (promoted build)
└── PID: data/hiverunner-dev.pid    └── PID: data/hiverunner-stable.pid

Both lanes:
├── Use SQLite databases under their own MC_DATA_DIR
├── Share node_modules/ (via symlink in .stable/)
├── Use the same server.js
└── Are independently startable, stoppable, and watchdog-able
```

Port `3000` is retired for HiveRunner itself. The only supported local lanes are `3010` for dev and `3001` for stable.

## Execution Ownership

By default, **only the stable lane executes orchestration work**.
The dev lane on port `3010` is observer-only — it serves pages and API
responses but does not claim or execute queued heartbeat runs. The 3010 lane
is *forced* observer-only by `scripts/run_dev_service.sh`, `server.js`, and
`/api/hiverunner/health`; an accidental `MC_ENGINE_TICK=on` export against
3010 is ignored.

`MC_ENGINE_TICK=off` is also the safe posture for sandbox testing, CI smoke
runs, and any throwaway lane where you do not want the process to claim
queued work.

This is controlled by `MC_ENGINE_TICK`:

| Value | Behavior | Default for |
|-------|----------|-------------|
| `on` | Engine tick active — claims and executes queued runs | Stable lane (`3001`) |
| `off` | Engine tick disabled — observer-only (safe sandbox/test posture) | Dev lane (`3010`) |
| `auto` | Active if production, disabled if development | Fallback |

**Active execution must not live on `3010`.** If you need a dev-flavored
execution lane, create a separate lane on a different port (for example
`3011` or `3020`) with its own `MC_DATA_DIR` and `MC_WORKSPACE_ROOT` and set
`MC_ENGINE_TICK=on` there. See
[Active Dev Execution](two-lane-runtime.md#active-dev-execution) for the
shape of that lane.

Only one process should have `MC_ENGINE_TICK=on` for a given `MC_DATA_DIR`.
Additional processes against the same data lane must be observer-only. The
database claim queries reduce duplicate-run risk, but HiveRunner's current
runtime is intentionally local-first and single-execution-owner, not a
distributed scheduler.

**Check current state:**
```bash
curl http://127.0.0.1:3010/api/hiverunner/health  # shows "role": "observer"
curl http://127.0.0.1:3001/api/hiverunner/health  # shows "role": "executor"
scripts/lane.sh doctor                    # shows engine tick for both
```

### Dev Autonomous Test Mode

Dev can be made test-ready without turning it into a permanent executor lane:

- `MC_DEV_EXECUTION_TEST_MODE=1` exposes a dev-only company settings control on `:3010`
- execution is still OFF by default until a company-scoped lease is enabled in the UI
- only one dev company can hold the lease at a time
- leases auto-expire, so dev falls back to observer-only without manual cleanup

Stable ignores this mode completely.

## Common Scenarios

### "Is it running?"

```bash
scripts/lane.sh doctor
```

This shows:
- PID file state (present? alive? matching port listener?)
- Port listener state (who's on :3010 and :3001?)
- Healthcheck status (API responding? Pages rendering?)
- Process-manager status (PID/log path present?)
- Database state

### "The dev server is frozen / stuck"

```bash
scripts/lane.sh dev restart
```

This will:
1. Kill the tracked PID (graceful → force)
2. Kill any orphan on port 3010
3. Clear stale `.next/dev/lock`
4. Start fresh

If that fails:

```bash
# Nuclear: kill everything, clear dev cache
scripts/lane.sh dev stop
rm -rf .next/dev
scripts/lane.sh dev start
```

### "Pages render wrong but API works"

This is usually Next dev-cache corruption. The restart path already handles
the common stale-lock case, but if you need manual recovery:

```bash
rm -rf .next/dev
scripts/lane.sh dev restart
```

### "PID file is stale / wrong"

The healthcheck and doctor scripts now handle this automatically:

```bash
scripts/lane.sh doctor --fix     # Auto-fix stale PIDs
```

Or manually:
```bash
rm data/hiverunner-dev.pid
```

The healthcheck script will adopt the actual port listener on next run.

### "I started the server with npm/node directly"

The healthcheck script will detect the untracked listener and adopt it
into the PID file. No manual intervention needed.

### "I want a stable operator surface"

```bash
scripts/lane.sh promote
```

This builds, tags, deploys to `.stable/`, and starts on :3001.
Then access the stable surface at `http://localhost:3001`.

### "The stable lane regressed"

```bash
scripts/lane.sh rollback
```

This restores the previous promoted checkpoint.

---

## Healthcheck Endpoints

| Endpoint | Purpose | Speed |
|----------|---------|-------|
| `GET /api/hiverunner/health` | Watchdog probe. No external calls. Returns PID, mode, uptime, and migration compatibility. | fast |
| `GET /api/mc/health` | Legacy alias for existing watchdogs. | fast |
| `GET /api/health` | Local platform health. Checks process and local DB readiness only; no provider/network calls. | fast |
| `GET /api/orchestration/companies` | API smoke test. Queries DB. | ~50ms |

The watchdog uses `/api/hiverunner/health` as primary, with fallback aliases
for older builds that don't have it yet.

The dev healthcheck also probes a page render (`/`) to catch cases where the
API works but pages are stuck compiling or broken.

---

## Process Management

The public repo does not ship machine-specific launchd plists. The dev lane is
script-managed by default:

- `scripts/lane.sh dev start` launches `scripts/run_dev_service.sh` in the
  background with `nohup`.
- `scripts/lane.sh dev stop` stops the tracked PID and any orphaned listener on
  port `3010`.
- `scripts/healthcheck_dev_service.sh` can be called manually or by an external
  local supervisor to restart the dev lane after repeated health failures.

Create a local launchd/systemd/pm2 wrapper outside the repo if you want
automatic restart on your machine.

---

## What Remains Fragile

1. **Dev cache corruption can still happen in Next dev mode.**
   Restarting the dev lane clears stale lock/failure state, and the healthcheck
   can clear `.next/dev` before a managed restart.

2. **SQLite is local-first storage.**
   WAL mode and busy timeouts reduce local contention, but SQLite still has one
   writer at a time and assumes local filesystem semantics. Keep `MC_DATA_DIR`
   on local disk, do not share it across hosts, and do not run multiple
   execution owners against it.

3. **Hosted multi-user deployment is not solved.**
   Supabase can provide hosted auth, but the engine, workspace storage, event
   streams, and SQLite persistence still need an architecture project before
   HiveRunner is a horizontally scalable hosted service.

4. **No bundled supervisor.** The public repo keeps automatic restart local to
   the operator. The lane scripts use raw `nohup` + PID files; add launchd,
   systemd, pm2, or another process manager outside the repo when you need
   crash/OOM recovery.

For the formal local-first boundary, see
[`docs/local-first-boundary.md`](local-first-boundary.md).

---

## Files Reference

| File | Purpose |
|------|---------|
| `server.js` | Main server entry point |
| `scripts/lane.sh` | Unified CLI for both lanes |
| `scripts/doctor.sh` | Runtime health diagnostic |
| `scripts/start_dev_service.sh` | Start dev lane |
| `scripts/stop_dev_service.sh` | Stop dev lane |
| `scripts/healthcheck_dev_service.sh` | Dev health probe + recovery hook |
| `scripts/start_stable_service.sh` | Start stable lane |
| `scripts/stop_stable_service.sh` | Stop stable lane |
| `scripts/healthcheck_stable_service.sh` | Stable watchdog probe + recovery |
| `scripts/promote_to_stable.sh` | Build + deploy to stable |
| `scripts/rollback_stable.sh` | Roll back stable lane |
| `data/hiverunner-dev.pid` | Dev server PID |
| `data/hiverunner-stable.pid` | Stable server PID |
| `data/hiverunner-dev.log` | Dev server stdout |
| `data/hiverunner-dev.err.log` | Dev server stderr |
| `src/app/api/hiverunner/health/route.ts` | Canonical lightweight healthcheck alias |
| `src/app/api/mc/health/route.ts` | Legacy lightweight healthcheck endpoint |
