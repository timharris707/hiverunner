# OpenClaw Execution Cancel API Contract (Forge ↔ Pixel)

Date: 2026-04-01  
Participants: Forge (backend), Pixel (frontend)

## Endpoint

`PATCH /api/orchestration/tasks/:id/execution`

Purpose: Cancel an attached OpenClaw execution session for a task and return the updated task state for the board UI.

## Request Body

```json
{
  "actorUserId": "optional string",
  "note": "optional string",
  "targetStatus": "to-do | in-progress"
}
```

- `targetStatus` default: `to-do`
- `targetStatus: in-progress` keeps card in In Progress after cancellation.

## Response

```json
{
  "taskId": "uuid",
  "mode": "openclaw|manual",
  "sessionId": "string | undefined",
  "cancelled": {
    "attempted": true,
    "acknowledged": true,
    "status": "cancelled|skipped",
    "reason": "optional string",
    "raw": "optional raw gateway status"
  },
  "transition": {
    "attempted": true,
    "from": "backlog|to-do|in-progress|review|done|blocked",
    "to": "backlog|to-do|in-progress|review|done|blocked",
    "changed": false,
    "skipped": false,
    "skipReason": "optional string"
  },
  "task": "OrchestrationTask payload"
}
```

## Backend Behavior

- Validates request with Zod.
- Supports OpenClaw cancellation methods with compatibility fallback:
  - `sessions.cancel`
  - `sessions_cancel`
  - `sessions.stop`
  - `sessions_stop`
- Writes a status-update comment with source `mission_control`.
- Clears `tasks.execution_session_id` when cancellation is acknowledged.
- If `targetStatus=to-do`, task transitions from `in-progress` to `to-do`.

## Skip Conditions (non-error)

- `execution_mode_not_openclaw`
- `execution_session_missing`
- `task_not_in_progress`
- `cancellation_not_acknowledged`

## Errors

- `400 validation_error` for invalid task id or payload.
- `404 task_not_found` when task is missing.
- `502 openclaw_gateway_call_failed` when all cancellation gateway methods fail.
- `500 internal_error` fallback.
