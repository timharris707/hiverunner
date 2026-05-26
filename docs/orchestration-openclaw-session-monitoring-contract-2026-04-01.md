# OpenClaw Session Monitoring API Contract (Forge ↔ Pixel)

Date: 2026-04-01  
Participants: Forge (backend), Pixel (frontend)

## Endpoint

`GET /api/orchestration/tasks/:id/execution`

Purpose: Poll OpenClaw `sessions.history` for a task's attached execution session and return a UI-ready snapshot.

## Response

```json
{
  "taskId": "uuid",
  "mode": "openclaw|manual",
  "sessionId": "string | undefined",
  "polledAt": "ISO-8601",
  "status": {
    "state": "running|completed|unknown|skipped",
    "terminal": true,
    "reason": "optional string",
    "raw": "optional normalized source state"
  },
  "comments": {
    "imported": 0,
    "skippedDuplicates": 0,
    "lastImportedEventId": "optional string"
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

## Backend behavior

- Polls OpenClaw using `sessions.history` (fallback `sessions_history`).
- Imports new session output lines into task comments (idempotent by external ref).
- If session is terminal and task is `in-progress`, task auto-transitions to `review`.
- Adds a status comment when auto-transition fires.

## Errors

- `400 validation_error` for invalid task id params.
- `404 task_not_found` when task is missing.
- `502 openclaw_gateway_call_failed` if OpenClaw history call fails.
- `500 internal_error` fallback.
