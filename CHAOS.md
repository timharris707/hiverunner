# CHAOS.md — Mission Control Failure Matrix

Every way MC can break, the expected recovery, and which automated test covers it.

Automated tests live in `e2e/chaos.spec.ts`.
Run with: `npx playwright test e2e/chaos.spec.ts`

---

## Legend

| Column | Meaning |
|--------|---------|
| **Scenario** | The failure or chaos event |
| **Layer** | Where it occurs (API / DB / FS / Network / Runtime) |
| **Trigger** | How to reproduce |
| **Expected behavior** | What MC should do instead of crashing |
| **Recovery mechanism** | The code path that saves us |
| **Test** | The `chaos.spec.ts` test group that covers it |

---

## 1. API Input Chaos

### 1.1 Malformed JSON body on POST /api/tasks

| Field | Value |
|-------|-------|
| **Layer** | API |
| **Trigger** | Send `Content-Type: application/json` with body `{ broken json` |
| **Expected behavior** | 400 or 500, `{ error: "..." }` — never crashes server |
| **Recovery mechanism** | Next.js JSON parse error is caught in try/catch in route handler |
| **Test** | `chaos: malformed JSON body` |

---

### 1.2 Malformed JSON body on PATCH /api/tasks

| Field | Value |
|-------|-------|
| **Layer** | API |
| **Trigger** | PATCH with body `not-json-at-all` |
| **Expected behavior** | 400 or 500 with `{ error }` |
| **Recovery mechanism** | try/catch in route handler |
| **Test** | `chaos: malformed JSON on PATCH` |

---

### 1.3 PATCH without task ID

| Field | Value |
|-------|-------|
| **Layer** | API |
| **Trigger** | PATCH `{ status: "done" }` — no `id` field |
| **Expected behavior** | 404 — task not found |
| **Recovery mechanism** | `idx === -1` guard returns 404 |
| **Test** | `chaos: PATCH missing id` |

---

### 1.4 PATCH on non-existent task

| Field | Value |
|-------|-------|
| **Layer** | API |
| **Trigger** | PATCH `{ id: "TASK-0000000000000", status: "done" }` |
| **Expected behavior** | 404 `{ error: "Task not found" }` |
| **Recovery mechanism** | `findIndex` returns -1, explicit 404 |
| **Test** | `chaos: PATCH non-existent task` |

---

### 1.5 POST /api/tasks/build without taskId

| Field | Value |
|-------|-------|
| **Layer** | API |
| **Trigger** | POST `{}` to `/api/tasks/build` |
| **Expected behavior** | 400 `{ error: "taskId is required" }` |
| **Recovery mechanism** | Explicit guard at top of build route |
| **Test** | `chaos: build POST missing taskId` |

---

### 1.6 POST /api/tasks/build with non-existent taskId

| Field | Value |
|-------|-------|
| **Layer** | API |
| **Trigger** | POST `{ taskId: "TASK-0000000000000" }` |
| **Expected behavior** | 404 `{ error: "Task not found" }` |
| **Recovery mechanism** | `queueOrStartBuild` returns `{ kind: "missing" }` |
| **Test** | `chaos: build POST non-existent task` |

---

### 1.7 Unknown/extra fields on POST

| Field | Value |
|-------|-------|
| **Layer** | API |
| **Trigger** | POST task with extra fields: `{ title: "X", unknownField: true, nested: { a: 1 } }` |
| **Expected behavior** | 201 — task created, extra fields preserved (no schema stripping) |
| **Recovery mechanism** | Spread merge `{ id, ...task, created, updated }` |
| **Test** | `chaos: POST with extra unknown fields` |

---

### 1.8 Empty string title and description

| Field | Value |
|-------|-------|
| **Layer** | API |
| **Trigger** | POST `{ title: "", description: "" }` |
| **Expected behavior** | Task created with empty strings — no crash |
| **Recovery mechanism** | No server-side title validation |
| **Test** | `chaos: POST with empty string fields` |

---

### 1.9 Unicode and emoji in task fields

| Field | Value |
|-------|-------|
| **Layer** | API |
| **Trigger** | POST `{ title: "🔥 Tëst — 日本語 \u0000" }` |
| **Expected behavior** | Task created and retrievable with correct encoding |
| **Recovery mechanism** | JSON.stringify/parse and SQLite handle UTF-8 natively |
| **Test** | `chaos: POST with unicode and emoji` |

---

## 2. State Machine Violations

### 2.1 All illegal forward-jump transitions

| Field | Value |
|-------|-------|
| **Layer** | API / State machine |
| **Trigger** | Attempt `backlog → review`, `backlog → done`, `on-deck → done`, etc. |
| **Expected behavior** | 400 `{ error: "Invalid status transition: X → Y" }` |
| **Recovery mechanism** | `VALID_TASK_TRANSITIONS` map check before apply |
| **Test** | `chaos: invalid state transitions — all illegal jumps` |

---

### 2.2 Backward transition (regression): `done → backlog`

| Field | Value |
|-------|-------|
| **Layer** | API / State machine |
| **Trigger** | Task is `done`, PATCH `{ status: "backlog" }` |
| **Expected behavior** | 400 — done is terminal, no regressions allowed |
| **Recovery mechanism** | `VALID_TASK_TRANSITIONS["done"]` is `[]` |
| **Test** | `chaos: done is terminal — no backward transitions` |

---

### 2.3 Self-transition (no-op) on same status

| Field | Value |
|-------|-------|
| **Layer** | API |
| **Trigger** | Task is `backlog`, PATCH `{ status: "backlog" }` |
| **Expected behavior** | 200 — no-op, task unchanged |
| **Recovery mechanism** | `if (newStatus !== previousTask.status)` guard skips transition logic |
| **Test** | `chaos: self-transition is a no-op` |

---

## 3. Enforcement Gates

### 3.1 In-progress gate: POST without acceptance_criteria

| Field | Value |
|-------|-------|
| **Layer** | API / Gate |
| **Trigger** | POST `{ status: "in-progress" }` with no `acceptance_criteria` field |
| **Expected behavior** | 400 `{ error: "acceptance_criteria required..." }` |
| **Recovery mechanism** | Pre-write guard in POST handler |
| **Test** | `chaos: in-progress gate — POST missing criteria` |

---

### 3.2 In-progress gate: POST with empty acceptance_criteria array

| Field | Value |
|-------|-------|
| **Layer** | API / Gate |
| **Trigger** | POST `{ status: "in-progress", acceptance_criteria: [] }` |
| **Expected behavior** | 400 — empty array is as bad as missing |
| **Recovery mechanism** | `Array.isArray(criteria) && criteria.length === 0` check |
| **Test** | `chaos: in-progress gate — empty criteria array` |

---

### 3.3 In-progress gate: PATCH without acceptance_criteria (task has none)

| Field | Value |
|-------|-------|
| **Layer** | API / Gate |
| **Trigger** | Task has no criteria, PATCH `{ status: "in-progress" }` |
| **Expected behavior** | 400 |
| **Recovery mechanism** | PATCH handler checks `updates.acceptance_criteria ?? previousTask.acceptance_criteria` |
| **Test** | `chaos: in-progress gate — PATCH missing criteria` |

---

### 3.4 Review→done gate: no reviewAssignedTo

| Field | Value |
|-------|-------|
| **Layer** | API / Gate |
| **Trigger** | Task in `review`, PATCH `{ status: "done" }` without `reviewAssignedTo` |
| **Expected behavior** | 400 `{ error: "review → done requires Gater..." }` |
| **Recovery mechanism** | Explicit guard in PATCH handler before transitionTask() |
| **Test** | `chaos: review→done gate — missing reviewAssignedTo` |

---

### 3.5 Review→done gate: reviewAssignedTo present — succeeds

| Field | Value |
|-------|-------|
| **Layer** | API / Gate |
| **Trigger** | Task in `review`, PATCH `{ status: "done", reviewAssignedTo: "Gater" }` |
| **Expected behavior** | 200 — task advances to done |
| **Recovery mechanism** | Gate passes, transitionTask() applies |
| **Test** | `chaos: review→done gate — with reviewer succeeds` |

---

## 4. Reconciliation & Build Recovery

### 4.1 GET /api/tasks always triggers reconcile without crashing

| Field | Value |
|-------|-------|
| **Layer** | Runtime / Reconciliation |
| **Trigger** | GET /api/tasks (calls `reconcileBuildQueue` on every read) |
| **Expected behavior** | 200 `{ tasks: [...] }` — reconcile is non-fatal if nothing to do |
| **Recovery mechanism** | reconcileBuildQueue catches all internal errors; GET still returns data |
| **Test** | `chaos: GET /api/tasks triggers reconcile safely` |

---

### 4.2 Build log endpoint survives with empty/no queued builds

| Field | Value |
|-------|-------|
| **Layer** | API / Build log |
| **Trigger** | GET /api/tasks/build when no builds are active |
| **Expected behavior** | 200 with valid build log structure |
| **Recovery mechanism** | `readBuildLog()` returns default structure if file is missing |
| **Test** | `chaos: GET /api/tasks/build returns valid structure` |

---

### 4.3 Build POST for task not in in-progress returns informational response

| Field | Value |
|-------|-------|
| **Layer** | API / Build |
| **Trigger** | POST /api/tasks/build for a task in `backlog` or `review` status |
| **Expected behavior** | 200 `{ message: "Task is not in progress..." }` — not an error |
| **Recovery mechanism** | `queueOrStartBuild` returns `{ kind: "not-in-progress" }` |
| **Test** | `chaos: build for non-in-progress task returns informational 200` |

---

## 5. Concurrency

### 5.1 Concurrent PATCH requests on the same task

| Field | Value |
|-------|-------|
| **Layer** | API / Concurrency |
| **Trigger** | Two simultaneous PATCH requests updating different non-status fields on the same task |
| **Expected behavior** | Both return 200, task reflects at least one update (last-write-wins on field level) |
| **Recovery mechanism** | SQLite serializes writes; atomic upsert |
| **Test** | `chaos: concurrent PATCHes — both complete without 500` |

---

### 5.2 Concurrent task creation (unique ID guarantee)

| Field | Value |
|-------|-------|
| **Layer** | API / Concurrency |
| **Trigger** | Three simultaneous POST /api/tasks requests |
| **Expected behavior** | All three succeed with unique TASK-{timestamp} IDs |
| **Recovery mechanism** | `TASK-${Date.now()}` — millisecond-granular, concurrent requests in same ms get same ID (known limitation) |
| **Test** | `chaos: concurrent POSTs — all get unique IDs (best-effort)` |

---

## 6. SSE Stream Lifecycle

### 6.1 SSE connect returns correct headers

| Field | Value |
|-------|-------|
| **Layer** | API / SSE |
| **Trigger** | GET /api/activities/stream |
| **Expected behavior** | 200 with `Content-Type: text/event-stream` header |
| **Recovery mechanism** | Headers set unconditionally before stream opens |
| **Test** | `chaos: SSE /api/activities/stream — correct headers` |

---

### 6.2 SSE sends initial `connected` ping

| Field | Value |
|-------|-------|
| **Layer** | API / SSE |
| **Trigger** | Connect to /api/activities/stream and read first chunk |
| **Expected behavior** | First SSE event is `data: {"type":"connected",...}` |
| **Recovery mechanism** | First `send()` call in stream start() sends connected ping |
| **Test** | `chaos: SSE stream — initial connected event` |

---

## 7. Health Endpoint Resilience

### 7.1 Health endpoint always returns valid schema even with degraded services

| Field | Value |
|-------|-------|
| **Layer** | API / Health |
| **Trigger** | GET /api/health when external services are unreachable |
| **Expected behavior** | 200 with `{ status: "degraded" \| "critical" \| "healthy", checks: [...], timestamp, uptime }` |
| **Recovery mechanism** | `checkUrl`/`checkSystemdService` return `{ status: "down" }` on failure, never throw |
| **Test** | `chaos: GET /api/health — valid schema even when services are down` |

---

### 7.2 Health uptime is always positive

| Field | Value |
|-------|-------|
| **Layer** | API / Health |
| **Trigger** | GET /api/health immediately after server start |
| **Expected behavior** | `uptime > 0` |
| **Recovery mechanism** | `process.uptime()` is always positive from first tick |
| **Test** | `chaos: GET /api/health — uptime is positive number` |

---

### 7.3 Health status aggregation: down count drives overall status

| Field | Value |
|-------|-------|
| **Layer** | API / Health |
| **Trigger** | Some checks return `down` |
| **Expected behavior** | `status` is `"degraded"` if <50% down, `"critical"` if ≥50% down, `"healthy"` if none down |
| **Recovery mechanism** | `downCount / checks.length` threshold logic |
| **Test** | `chaos: GET /api/health — status reflects check results` |

---

## 8. Agent Memory Edge Cases

### 8.1 GET agent memory for unknown agent

| Field | Value |
|-------|-------|
| **Layer** | API / FS |
| **Trigger** | GET /api/agents/memory?agentId=does-not-exist |
| **Expected behavior** | 200 with empty memory object (not 404 or 500) |
| **Recovery mechanism** | `readAgentMemory()` returns empty shell `{ agentId, entries: [] }` if file missing |
| **Test** | `chaos: GET agent memory for unknown agent — returns empty shell` |

---

## 9. Known Unmitigated Risks (no automated test — manual monitoring required)

### 9.1 Quota state concurrent update race

| Field | Value |
|-------|-------|
| **Layer** | FS / Concurrency |
| **Risk** | Multiple simultaneous builds evaluate quota and write `quota-state.json` without a lock. Last write wins — earlier writes are silently lost. |
| **Impact** | Budget overrun: spend tracking under-counts, P2/P3 tasks run when budget is exhausted. |
| **Mitigation needed** | Wrap `loadQuotaState/saveQuotaState` in `withFactoryLock()` |

---

### 9.2 Agent memory concurrent write corruption

| Field | Value |
|-------|-------|
| **Layer** | FS / Concurrency |
| **Risk** | Two concurrent `recordAgentMemory()` calls on same agentId. No mutex — second write overwrites first. |
| **Impact** | Memory entries from one agent run silently lost. |
| **Mitigation needed** | Add per-agentId file lock (similar to `withSessionLock`) |

---

### 9.3 Advisory session POST/PATCH race

| Field | Value |
|-------|-------|
| **Layer** | FS / Concurrency |
| **Risk** | Session creation (POST) and field updates (PATCH) on advisory sessions do not use `withSessionLock`. Only `message` POSTs are protected. |
| **Impact** | Concurrent session updates can overwrite each other's changes. |
| **Mitigation needed** | Wrap advisory session POST and PATCH in `withSessionLock` |

---

### 9.4 Factory lock timeout blocks reconciliation

| Field | Value |
|-------|-------|
| **Layer** | FS / Locking |
| **Risk** | If the process dies while holding `data/locks/factory.lock`, the stale lock blocks the next reconcile for up to 30 seconds. During that window, stale builds are not cleaned up. |
| **Impact** | Up to 30s of missed reconciliation; builds run past their 20-min timeout could be detected late. |
| **Mitigation needed** | Current: stale lock deleted after 30s. Acceptable for now. |

---

### 9.5 Crash between journal and write (partial transition)

| Field | Value |
|-------|-------|
| **Layer** | DB / Crash recovery |
| **Risk** | If the server crashes after `dbJournalTransition()` but before `dbWriteTasks()`, the task state in the DB does not reflect the transition. |
| **Impact** | On restart, `_replayCheck()` in `getDb()` detects and replays the journaled transition. One-time replay only at startup — not continuous. |
| **Mitigation needed** | None — current recovery is sufficient for single-node deployment. |

---

### 9.6 Stale build detection lag (up to 15 seconds)

| Field | Value |
|-------|-------|
| **Layer** | Runtime / Reconciliation |
| **Risk** | Reconciliation is throttled to once per 15 seconds. A hung build is detected at most 15s after the next GET /api/tasks call that triggers reconcile. |
| **Impact** | Minor: builds can appear stuck for up to 15s longer than their 20-min timeout. |
| **Mitigation needed** | Acceptable. Could add a dedicated cron endpoint for more frequent reconcile. |

---

### 9.7 SSE activity stream duplicate events on lag

| Field | Value |
|-------|-------|
| **Layer** | API / SSE |
| **Risk** | If `lastId` tracking falls behind (e.g., DB rollback, ID collisions), a reconnecting client may see duplicate activity events. |
| **Impact** | Cosmetic — duplicate activity feed items in the UI. |
| **Mitigation needed** | Client-side deduplication by `id` field would resolve this. |

---

### 9.8 Same-millisecond concurrent task creation (ID collision)

| Field | Value |
|-------|-------|
| **Layer** | API / ID generation |
| **Risk** | `TASK-${Date.now()}` has millisecond resolution. Two simultaneous POST requests in the same millisecond get the same ID. Second write silently overwrites first in the task list. |
| **Impact** | One task silently lost. Rare in practice (requires sub-ms concurrent requests). |
| **Mitigation needed** | Use `TASK-${Date.now()}-${Math.random().toString(36).slice(2,7)}` for collision-safe IDs. |

---

## Test File Reference

```
e2e/chaos.spec.ts
```

Run the full chaos suite:
```bash
npx playwright test e2e/chaos.spec.ts --project=chromium
```

Run a specific scenario:
```bash
npx playwright test e2e/chaos.spec.ts -g "malformed JSON"
```

Run all e2e tests including chaos:
```bash
npm run test:e2e
```
