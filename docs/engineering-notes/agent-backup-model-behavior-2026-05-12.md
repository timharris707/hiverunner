# Agent Backup Model Behavior

## Current Behavior

HiveRunner does not have an agent-level backup model field today. Provider fallback is configured on execution hive lanes:

- Each active hive owns lanes such as `default`, `deep`, `fast`, `mini`, `vision`, and `local`.
- Each lane has one primary route target and up to three fallback route targets.
- At dispatch time, HiveRunner resolves the company's active hive plus the task's `modelLane`, then sends the resolved primary/fallback chain to the execution engine.
- Agents inherit fallback behavior through the lane their task uses. If an agent is assigned a task on the `deep` lane, that task uses the `deep` lane's fallback chain regardless of the agent's default provider.

## Agent-Level Fields

There is no current agents-table field for a backup provider, backup model, or per-agent fallback chain. The agent configuration page stores the agent's primary provider/model preference, while the runtime failover path is lane-scoped.

## Recommendation

Prefer Option 1 first: add a read-only "Inherited fallback chain" display on the agent configuration page.

This is the lower-risk next step because it matches the current architecture, requires no schema change, and helps operators understand what will happen when a provider fails. It also keeps fallback behavior consistent across tasks that share a lane.

Option 2, adding per-agent backup model fields, should wait until we have evidence that lane-level fallbacks are too coarse. It would require new schema, conflict-resolution rules between agent fallback and lane fallback, and additional UI to explain which fallback wins.

