# HiveRunner Roadmap

HiveRunner is being prepared as a local-first agent orchestration app that a new
operator can clone, boot, and understand without private workspace context.

## Current Focus

- Keep the public clone and first-run setup path reliable.
- Make `/companies/new` create useful neutral workspaces and starter teams.
- Keep auth clear: local-single-user by default, Supabase only when explicitly
  configured.
- Keep runtime providers optional and visible as readiness states, not required
  setup blockers.
- Remove stale private workspace, preserved app, and historical planning surface
  from the public repository.

## Near-Term Work

- Improve first-run guidance after workspace creation.
- Add clearer runtime readiness checks for optional CLIs and provider keys.
- Improve runner telemetry so quiet runs and cancelled runs are easier to
  diagnose.
- Continue reducing stale docs, fixtures, and private-history references.
- Keep dependency audit output clean for fresh GitHub onboarding.

## Deferred

- Horizontal scaling and multi-process orchestration.
- SQLite-to-Postgres migration.
- Hosted multi-tenant deployment hardening beyond the current Supabase auth
  option.
- Broad preview browser E2E as a required merge gate.
- Provider-routing redesign.

See `README.md` for the current supported local install path.
