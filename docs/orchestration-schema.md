# Orchestration SQLite Schema (Sprint 1 Foundation)

This schema is the Phase 1 storage layer for Mission Control orchestration.

- Database file: `data/orchestration.db`
- Engine mode: SQLite + WAL
- Migration tracking table: `schema_migrations`
- Seed strategy: deterministic dev bootstrap via script

## Commands

```bash
npm run orchestration:migrate
npm run orchestration:seed
```

Optional override:

```bash
ORCHESTRATION_DB_PATH=/tmp/orchestration.db npm run orchestration:migrate
```

## Tables

- `projects`
- `avatar_themes`
- `sprints`
- `agents`
- `tasks`
- `comments`
- `task_events`
- `status_transition_rules`
- `execution_runs`

## Postgres Compatibility Notes

- IDs are app-generated text UUIDs, not SQLite rowids.
- JSON-like values use `*_json` text columns so we can map to `jsonb` later.
- Timestamps are explicit ISO-8601 strings (`created_at`, `updated_at`, etc.).
- Constraints and transition rules are explicit and portable.
- No SQLite-only virtual tables or FTS features are used.

## Seed/Dev Strategy

`npm run orchestration:seed` inserts idempotent sample records:

- 2 projects (`weather-edge`, `mission-control`)
- 2 themes
- 2 active sprints
- 3 agents
- 5 tasks spread across board states

This gives UI and API development a stable baseline for board rendering,
assignment flows, and transition testing without requiring manual setup.
