# HiveRunner Local-First Boundary

> Last updated: 2026-05-25

HiveRunner is currently a first-class local operator application. It is not yet
a horizontally scalable hosted service. This document defines the supported
boundary for B5/B6 so public users can clone and run the app without assuming a
deployment model that the architecture does not support yet.

## Supported Today

- One trusted operator on a local machine or private machine.
- One active execution owner per data lane.
- SQLite databases stored under `MC_DATA_DIR`.
- Company workspaces stored under `MC_WORKSPACE_ROOT`.
- A local UI/build process on `:3010` that is observer-only.
- One separate execution owner when autonomous work should run.
- The two-lane local runtime:
  - dev lane on `:3010`, forced observer-only with `MC_ENGINE_TICK=off`
  - stable lane on `:3001`, normally execution owner with `MC_ENGINE_TICK=on`
- Optional Supabase auth for identity, but not a complete hosted multi-tenant
  deployment story by itself.
- Optional runtime CLIs and provider keys, documented separately in
  [`docs/runtime-dependencies.md`](runtime-dependencies.md).

## Not Supported Yet

- Multiple server instances sharing one `MC_DATA_DIR` while all can write.
- Multiple engine tick owners claiming and executing work from the same data
  lane.
- Horizontally scaled serverless or container replicas.
- Multi-tenant hosted operation with shared runtime workers.
- Postgres-backed orchestration state.
- Distributed locks, queues, or external scheduler ownership.
- Durable hosted filesystem semantics for local workspaces and agent artifacts.

## B5: Single-Process Assumptions

### Findings

- `server.js` owns the autonomous engine tick loop through `MC_ENGINE_TICK`.
- `server.js` keeps local WebSocket client sets, polling intervals, and an
  `engineTickRunning` flag in process memory.
- The edge-route map cache uses `globalThis` in `src/middleware.ts` and
  `src/lib/orchestration/edge-route-map-service.ts`.
- Several runtime helpers use in-memory maps or timers for local process
  coordination, including gateway stream state and local file/session locks.
- The current safety model relies on one process being the effective execution
  owner, even though DB claim queries reduce duplicate-run risk.

### Classification

- Acceptable local-first constraint: one process owns execution for a lane.
- Misleading surface addressed: public PR validation should remain local-first
  and should not imply a hosted preview provider is required.
- Future architecture project: distributed engine ownership needs an external
  queue/lease service, process-independent event fanout, and explicit worker
  topology.

### Boundary

Run exactly one engine tick owner per `MC_DATA_DIR`. Port `3010` is not eligible
to be that owner; it is forced observer-only so local development does not race
the execution lane or corrupt the Next dev cache during active work. If you need
active dev execution, use a separate execution lane with its own port, data dir,
workspace root, and logs.

## B6: SQLite Primary Store

### Findings

- `src/lib/orchestration/db.ts` stores orchestration state in
  `orchestration.db` under `MC_DATA_DIR`.
- The main orchestration DB uses WAL mode, `synchronous=NORMAL`,
  `foreign_keys=ON`, and `busy_timeout=5000`.
- Legacy task/activity stores also use SQLite under `MC_DATA_DIR`.
- Direct test entrypoints are guarded from accidentally running against live
  local DB paths unless `ORCHESTRATION_DB_PATH` points at an isolated temp DB.
- The app assumes filesystem-local SQLite semantics, including sidecar `-wal`
  and `-shm` files.

### Classification

- Acceptable local-first constraint: SQLite is the supported store for a local
  operator lane.
- Low-risk hardening already present: WAL mode, busy timeout, direct-test live
  DB guard, and separated dev/stable data directories.
- Future architecture project: hosted multi-user deployment needs a Postgres
  data model, migration path, and replacement for filesystem-backed workspace
  assumptions.

### Boundary

Keep `MC_DATA_DIR` on a local disk. Do not put the active SQLite files on a
network filesystem or share them across multiple hosts. Back up the main
database together with its `-wal` and `-shm` sidecar files, or stop the process
and run a checkpoint before copying.

## Deployment Surface

The default public PR gate is local-first: install dependencies, audit
dependencies, typecheck, build, and run targeted Node tests. Hosted preview
deployments are not required to evaluate or contribute to HiveRunner.

A production hosted version would need, at minimum:

- Postgres-backed orchestration state.
- A durable queue and distributed lease for engine work.
- Process-independent event streaming.
- Hosted workspace/artifact storage.
- Tenant-scoped credential storage and audit logs.
- Hosted auth hardening beyond the local-first sharing path.

## Operator Rules

1. Use `MC_ENGINE_TICK=on` in only one process per data lane.
2. Use `MC_ENGINE_TICK=off` for observer/UI-only processes.
3. Use separate `MC_DATA_DIR` values for dev, stable, tests, and experiments.
4. Keep `MC_WORKSPACE_ROOT` private and backed up with the data directory.
5. Treat hosted previews as optional experiments, not as the product runtime.
6. Use Supabase only when you intentionally switch auth mode; it does not
   remove the local-first storage and engine limits.

## Recommendation

B5 and B6 should remain open as architecture blockers for hosted multi-user
deployment. For share-readiness, the current repo is acceptable if it presents
HiveRunner honestly as local-first and keeps the unsupported hosted boundary
clear in README, operations docs, and PR review notes.
