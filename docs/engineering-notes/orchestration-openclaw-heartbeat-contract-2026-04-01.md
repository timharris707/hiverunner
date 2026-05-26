# OpenClaw Agent Heartbeat API Contract (Forge ↔ Pixel)

Date: 2026-04-01  
Participants: Forge (backend), Pixel (frontend)

## Endpoint

`POST /api/orchestration/agents/:id/heartbeat`

Purpose: Accept cron-driven heartbeats from OpenClaw automation and keep HiveRunner agent liveness/state current.

## Auth

- If `ORCHESTRATION_HEARTBEAT_TOKEN` is configured, caller must send:
  - `X-Orchestration-Heartbeat-Token: <token>`
- If token is unset, endpoint accepts internal trusted calls.

## Request Body

```json
{
  "status": "idle|working|paused|offline|error",
  "currentTaskId": "uuid | null",
  "runtimeMinutesDelta": 0,
  "observedAt": "ISO-8601",
  "source": "cron|openclaw|manual"
}
```

All fields optional.

## Response (202)

```json
{
  "agent": "OrchestrationAgent payload",
  "heartbeat": {
    "source": "cron|openclaw|manual",
    "receivedAt": "ISO-8601",
    "observedAt": "ISO-8601",
    "runtimeMinutesDelta": 0
  }
}
```

## Backend Behavior

- Validates payload with Zod.
- Updates:
  - `agents.last_heartbeat`
  - `agents.status`
  - `agents.current_task_id` (if explicitly set; omitted preserves prior value)
  - `agents.total_runtime_minutes += runtimeMinutesDelta`
- Validates `currentTaskId` belongs to the same project as the agent.

## Errors

- `400 validation_error` for invalid payload/params.
- `400 invalid_current_task` when task is not in the agent's project.
- `401 unauthorized` when heartbeat token is required and invalid.
- `404 agent_not_found` when target agent is missing.
- `500 internal_error` fallback.
