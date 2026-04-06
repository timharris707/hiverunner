# Mission Control Operations Runbook

> How to operate, diagnose, and recover the Mission Control local runtime.
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
Dev Lane (:3000)                    Stable Lane (:3001)
├── NODE_ENV=development            ├── NODE_ENV=production
├── Hot reload (Turbopack)          ├── Pre-built (.stable/.next/)
├── Subject to cache corruption     ├── Isolated from dev cache
├── Used during active dev          ├── Used as operator surface
├── .next/dev/ (ephemeral)          ├── .stable/ (promoted build)
└── PID: data/mc-dev.pid            └── PID: data/mc-stable.pid

Both lanes:
├── Share SQLite databases (data/*.db) — WAL mode handles concurrency
├── Share node_modules/ (via symlink in .stable/)
├── Use the same server.js
└── Are independently startable, stoppable, and watchdog-able
```

## Common Scenarios

### "Is it running?"

```bash
scripts/lane.sh doctor
```

This shows:
- PID file state (present? alive? matching port listener?)
- Port listener state (who's on :3000 and :3001?)
- Healthcheck status (API responding? Pages rendering?)
- Watchdog status (launchd loaded?)
- Database state

### "The dev server is frozen / stuck"

```bash
scripts/lane.sh dev restart
```

This will:
1. Kill the tracked PID (graceful → force)
2. Kill any orphan on port 3000
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

This is Turbopack cache corruption. The restart script already
handles it (clears `.next/dev`), but if you need manual recovery:

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
rm data/mission-control-dev.pid
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
| `GET /api/mc/health` | Watchdog probe. No DB. Returns PID, mode, uptime. | <10ms |
| `GET /api/health` | Full system health. Checks services, pings external deps. | ~2s |
| `GET /api/orchestration/companies` | API smoke test. Queries DB. | ~50ms |

The watchdog uses `/api/mc/health` as primary, with fallback to
`/api/orchestration/companies` for older builds that don't have it yet.

The dev watchdog also probes a page render (`/NEV/inbox`) to catch
Turbopack corruption that leaves the API working but pages broken.

---

## Watchdog (launchd)

### Enable

```bash
# Dev watchdog (checks :3000 every 15s, restarts on failure)
cp config/com.harris-autonomous.mc-dev.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.harris-autonomous.mc-dev.plist

# Stable watchdog (checks :3001 every 15s)
cp config/com.harris-autonomous.mc-stable.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.harris-autonomous.mc-stable.plist
```

### Disable

```bash
launchctl unload ~/Library/LaunchAgents/com.harris-autonomous.mc-dev.plist
mv ~/Library/LaunchAgents/com.harris-autonomous.mc-dev.plist \
   ~/Library/LaunchAgents/com.harris-autonomous.mc-dev.plist.DISABLED
```

### Check status

```bash
scripts/lane.sh doctor  # shows watchdog status
```

---

## What Remains Fragile

1. **Dev cache corruption is inherent to Turbopack dev mode.**
   The watchdog mitigates this by clearing `.next/dev` on restart,
   but the root cause is upstream in Next.js/Turbopack.

2. **Concurrent dev + stable on same DB.**
   SQLite WAL mode handles concurrent reads safely, but concurrent
   writes from two server instances could cause SQLITE_BUSY errors
   under heavy load. In practice, only one lane runs the engine tick
   loop (the one that booted first claims it).

3. **No process manager.** We use raw nohup + PID files instead of
   pm2 or similar. This is simpler but means no auto-restart on OOM
   or crash — that's the watchdog's job.

4. **Watchdog is currently DISABLED.** The launchd plist is renamed
   to `.DISABLED`. Enable it for automatic recovery.

---

## Files Reference

| File | Purpose |
|------|---------|
| `server.js` | Main server entry point |
| `scripts/lane.sh` | Unified CLI for both lanes |
| `scripts/doctor.sh` | Runtime health diagnostic |
| `scripts/start_dev_service.sh` | Start dev lane |
| `scripts/stop_dev_service.sh` | Stop dev lane |
| `scripts/healthcheck_dev_service.sh` | Dev watchdog probe + recovery |
| `scripts/start_stable_service.sh` | Start stable lane |
| `scripts/stop_stable_service.sh` | Stop stable lane |
| `scripts/healthcheck_stable_service.sh` | Stable watchdog probe + recovery |
| `scripts/promote_to_stable.sh` | Build + deploy to stable |
| `scripts/rollback_stable.sh` | Roll back stable lane |
| `config/com.harris-autonomous.mc-dev.plist` | Dev watchdog launchd config |
| `config/com.harris-autonomous.mc-stable.plist` | Stable watchdog launchd config |
| `data/mission-control-dev.pid` | Dev server PID |
| `data/mission-control-stable.pid` | Stable server PID |
| `data/mission-control-dev.log` | Dev server stdout |
| `data/mission-control-dev.err.log` | Dev server stderr |
| `src/app/api/mc/health/route.ts` | Lightweight healthcheck endpoint |
