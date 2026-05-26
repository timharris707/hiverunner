# Agent Archive And Delete Semantics

Date: 2026-05-02

## User Model

Agents support two different retirement actions:

- Archive agent: reversible. Use when the agent may be useful later.
- Delete agent: permanent. Use for test agents, bad hires, duplicates, or disposable QA artifacts.

## Archive Agent

Archive preserves the agent identity and history:

- Keeps the agent database row.
- Sets `archived_at` and moves status to `offline`.
- Hides the agent from normal active rosters and assignment lookups.
- Keeps agent memory files, workspace files, run history, comments, and audit records.
- Runs the departure cascade so open assignments and reporting references no longer point at an inactive worker.
- Allows restore from the Team page when archived agents are shown.

## Restore Agent

Restore is available for archived agents:

- Clears `archived_at`.
- Sets status back to `idle`.
- Returns the agent to the active Team roster and normal assignment paths.
- Does not recreate deleted runtime queues or external provider state.

## Delete Agent

Delete is permanent and should be reserved for artifacts that should not come back:

- Deletes the agent database row.
- Deletes private runtime artifacts that cascade from the agent, including wakeup requests, task sessions, runtime state, heartbeat runs, and heartbeat run events.
- Deletes the HiveRunner agent workspace directory under the company workspace.
- Queues OpenClaw runtime deletion when the agent has an OpenClaw runtime id.
- Deletes provider-neutral runtime rows bound directly to that agent.
- Detaches shared company history instead of deleting shared work records: assigned tasks, comments, task events, approvals, execution runs, audit events, cost events, and routines keep their records but no longer point at the deleted agent.
- Runs the departure cascade before deleting so open assignments and reporting references are not left pointing at a missing worker.

## UI Placement

- Active agent detail page: three-dot menu exposes `Archive agent` and `Delete agent`, each behind a confirmation.
- Team page: `Show archived` reveals archived agents with `Restore` and `Delete` actions.

## API Contract

- `DELETE /api/orchestration/agents/:id`: archive.
- `DELETE /api/orchestration/agents/:id?hard=true`: hard delete.
- `POST /api/orchestration/agents/:id/restore`: restore archived agent.

