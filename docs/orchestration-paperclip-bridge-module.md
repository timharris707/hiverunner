# Orchestration Paperclip Bridge Module

Date: 2026-04-01  
Owner: Forge (backend)

## Purpose

Provide a thin, removable integration layer between Mission Control orchestration and the Paperclip API.

The bridge foundation is isolated under `src/lib/orchestration/bridge/` so Phase 2 can remove it without touching core board/task logic.

## Module Surface

- `config.ts`
  - `getPaperclipBridgeConfigFromEnv()`
  - Validates required env vars and returns normalized config:
    - `PAPERCLIP_API_URL`
    - `PAPERCLIP_API_KEY`
    - `PAPERCLIP_COMPANY_ID`
    - optional `PAPERCLIP_RUN_ID`
- `client.ts`
  - `PaperclipBridgeClient`
  - Typed wrappers:
    - `createIssue`
    - `updateIssue`
    - `getIssue`
    - `createIssueComment`
    - `checkoutIssue`
    - `getAgent`
    - `getBridgeHealth`
  - Predictable bridge errors via `PaperclipBridgeError` with:
    - `status`
    - `code`
    - `retriable`
- `mapping.ts`
  - Status and priority mapping between local DB and Paperclip issue models
  - `buildPaperclipIssueDescription()` appends stable MC metadata block for traceability
- `store.ts`
  - SQLite-backed task/agent mapping helpers:
    - `getTaskBridgeRecord`
    - `resolveTaskPaperclipAssignee`
    - `setTaskPaperclipIssueMapping`
    - `setTaskExecutionMode`

## Data Model Tie-ins

Existing orchestration schema fields used by the bridge:

- `agents.paperclip_agent_id`
- `tasks.paperclip_issue_id`
- `tasks.execution_mode`
- `tasks.execution_session_id`

No schema changes were required for this foundation step.

## Next Steps

1. `sync-task` foundation is implemented via assignment heartbeat flow:
   - `getTaskBridgeRecord`
   - `resolveTaskPaperclipAssignee`
   - `PaperclipBridgeClient.createIssue/updateIssue`
   - `setTaskPaperclipIssueMapping`
2. `pull-status` route is implemented at:
   - `GET /api/orchestration/tasks/[id]/bridge/pull-status`
   - reads mapped `paperclip_issue_id`
   - fetches issue + incremental comments from Paperclip
   - maps status back via `mapPaperclipStatusToLocal`
   - imports new Paperclip comments idempotently (`comments.source='paperclip'`, `comments.external_ref`)
   - returns UI-ready payload with `pollIntervalMs: 30000`
3. `trigger-heartbeat` route is implemented at:
   - `POST /api/orchestration/tasks/[id]/bridge/trigger-heartbeat`
   - verifies task + assignment state
   - upserts mapped Paperclip issue before wake
   - triggers agent wake and returns normalized run metadata
4. `bridge/status` health route is implemented at:
   - `GET /api/orchestration/bridge/status`
   - checks connection with `getBridgeHealth()`
   - returns sync timestamps + mapping diagnostics for UI
