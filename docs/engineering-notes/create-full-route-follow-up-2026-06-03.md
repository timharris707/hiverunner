# Create-full Route Follow-up

Date: 2026-06-03

`POST /api/orchestration/companies/create-full` is intentionally left unchanged
in the onboarding safety/copy follow-up. A focused Understand Anything pass
flagged it as a high-blast-radius first-run route because one handler currently
owns validation, company creation, workspace scaffolding, default skill seeding,
starter-agent provisioning, CEO runtime registration, first-task creation, and
execution kickoff.

Recommended follow-up PR:

1. Add characterization tests around the public route contract before extracting
   internals.
2. Extract behavior-preserving service functions for validation, workspace
   materialization, skill seeding/export, starter-team provisioning, and launch
   href construction.
3. Keep the route response shape stable, especially `boardHref`,
   `dashboardHref`, seeded Overseer skill behavior, and no-provider-key launch.

Do not combine this with provider-key safety work; it is a separate refactor
with higher regression risk.
