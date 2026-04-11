# Paperclip to OpenClaw Agent Migration Guide

Date: 2026-04-01  
Owner: Forge (Backend)

## Purpose

Migrate existing Mission Control agents from Paperclip-backed execution to native OpenClaw execution with minimal downtime and rollback safety.

This runbook covers:
- Identity mapping (Paperclip agent -> Mission Control agent -> OpenClaw agent)
- Instruction migration (`AGENTS.md`/Paperclip profile -> OpenClaw `SOUL.md`)
- Execution workspace setup for OpenClaw-backed runs

## Current Runtime Expectations

- Mission Control execution provider defaults to `openclaw` (`ORCHESTRATION_EXECUTION_PROVIDER`).
- OpenClaw task execution requires `agents.openclaw_agent_id` on the assigned task agent.
- Agent identity prompt is read from:
  - `${OPENCLAW_DIR}/agents/<openclaw_agent_id>/SOUL.md`, or
  - `~/.openclaw/agents/<openclaw_agent_id>/SOUL.md` when `OPENCLAW_DIR` is unset.
- OpenClaw calls are made through:
  - `openclaw gateway call sessions.create`
  - `openclaw gateway call sessions.send`
  - `openclaw gateway call sessions.history` (fallback `sessions_history`)

## Identity Mapping

Map each person/role using this target shape:

| Concern | Source (Paperclip era) | Target (OpenClaw era) |
|---|---|---|
| Mission Control agent record | `agents.paperclip_agent_id` | Keep for rollback; also set `agents.openclaw_agent_id` |
| Execution identity | Paperclip agent id/urlKey | OpenClaw agent directory name (`agents/<id>/`) |
| Instruction source | Paperclip instructions path (`AGENTS.md`) | OpenClaw `SOUL.md` |
| Runtime backend | `paperclip` bridge | `openclaw` provider |

Recommended deterministic mapping for `openclaw_agent_id`:
- Lowercase slug derived from Mission Control agent name (example: `Forge` -> `forge`)
- Keep stable once assigned (do not rotate ids after tasks exist)

## Step 1: Inventory Existing Agent Links

For each project, export current agent linkage from Mission Control:

```bash
curl -sS "http://localhost:3010/api/orchestration/projects/<project-id-or-slug>/agents" | jq
```

Record for each agent:
- `id`
- `name`
- `paperclipAgentId`
- `openclawAgentId` (may be empty pre-migration)
- `model`
- `role`
- `personality`

## Step 2: Create OpenClaw Agent Directories

Note: automated generator work is tracked separately; this guide uses the manual path that works today.

For each target `openclaw_agent_id`:

```bash
mkdir -p "${OPENCLAW_DIR:-$HOME/.openclaw}/agents/<openclaw-agent-id>"
```

Create:
- `agent.json` (model/tools/permissions as required by your OpenClaw setup)
- `SOUL.md` (identity + operating directives)

Minimum `SOUL.md` template:

```md
# Identity
Name: Forge
Role: Backend Engineer

# Mission
Build and maintain Mission Control orchestration backend.

# Working Rules
- Validate all endpoint inputs
- Keep route handlers thin
- Return predictable error payloads
- Prefer clean migrations over ad-hoc schema changes
```

## Step 3: Migrate Instructions (Paperclip -> SOUL.md)

For each agent:
1. Read Paperclip-era instruction source (`AGENTS.md` and related notes).
2. Keep durable identity and role constraints.
3. Remove Paperclip heartbeat/protocol-only instructions from `SOUL.md` (those are control-plane concerns, not execution identity).
4. Keep engineering quality constraints and domain ownership.

Practical translation:
- Keep: role, responsibilities, coding standards, review expectations.
- Rewrite: "Paperclip task lifecycle" language -> "Mission Control/OpenClaw execution behavior".
- Drop: `X-Paperclip-Run-Id`, checkout/release requirements, Paperclip issue mutation rules.

## Step 4: Link Mission Control Agents to OpenClaw IDs

If an agent does not already have `openclawAgentId`, recreate or update agent records so each has a unique `openclawAgentId`.

Create example (new agent):

```bash
curl -sS -X POST "http://localhost:3010/api/orchestration/projects/<project-id>/agents" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Forge",
    "emoji": "🔧",
    "role": "Backend Engineer",
    "personality": "Pragmatic, API-first, schema-rigorous",
    "model": "gpt-5.3-codex",
    "paperclipAgentId": "forge",
    "openclawAgentId": "forge",
    "skills": ["backend", "sqlite", "orchestration"]
  }'
```

Rules:
- `openclawAgentId` must be globally unique in Mission Control.
- Keep `paperclipAgentId` during transition to allow rollback.

## Step 5: Configure Execution Workspace

Set env:

```bash
OPENCLAW_DIR=/absolute/path/to/.openclaw
ORCHESTRATION_EXECUTION_PROVIDER=openclaw
# Optional if openclaw binary is not on PATH
ORCHESTRATION_OPENCLAW_CLI=/absolute/path/to/openclaw
```

Workspace expectations:
- The target project repo exists under OpenClaw workspace (`${OPENCLAW_DIR}/workspace/...`).
- OpenClaw agent has filesystem/tool access needed for code execution in that workspace.

## Step 6: Validate End-to-End

1. Assign a migrated agent to a task.
2. Move task to `in-progress` using reorder endpoint:

```bash
curl -sS -X PATCH "http://localhost:3010/api/orchestration/tasks/reorder" \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "<task-id>",
    "status": "in-progress"
  }' | jq
```

3. Verify response heartbeat block shows OpenClaw queue/run details (`mode: "openclaw"`).
4. Poll execution:

```bash
curl -sS "http://localhost:3010/api/orchestration/tasks/<task-id>/execution" | jq
```

Expected:
- `mode: "openclaw"`
- imported OpenClaw updates under `comments`
- automatic transition to `review` when session reaches terminal state

## Step 7: Heartbeat Validation (Optional but Recommended)

If heartbeat token is enabled, test agent liveness updates:

```bash
curl -sS -X POST "http://localhost:3010/api/orchestration/agents/<agent-id>/heartbeat" \
  -H "Content-Type: application/json" \
  -H "x-orchestration-heartbeat-token: <token>" \
  -d '{
    "status": "working",
    "runtimeMinutesDelta": 2,
    "source": "openclaw"
  }' | jq
```

## Rollback Plan

If OpenClaw execution fails broadly:
1. Set `ORCHESTRATION_EXECUTION_PROVIDER=paperclip`.
2. Keep existing `paperclipAgentId` mappings unchanged.
3. Continue task execution through bridge routes until OpenClaw issues are resolved.

Do not delete `openclawAgentId`; keep dual mapping during stabilization.

## Cutover Checklist

- All active agents have non-empty `openclawAgentId`.
- Matching `${OPENCLAW_DIR}/agents/<openclawAgentId>/SOUL.md` exists for each migrated agent.
- `ORCHESTRATION_EXECUTION_PROVIDER=openclaw` in target environment.
- Smoke task run succeeds for each critical role (engineering + QA).
- Team confirms rollback env toggle tested once in staging.
