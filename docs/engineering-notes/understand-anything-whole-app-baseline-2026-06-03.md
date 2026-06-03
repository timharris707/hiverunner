# Whole-App Understand Anything Baseline

Date: 2026-06-03

A controlled whole-app Understand Anything baseline exists as an optional
architecture reference for HiveRunner. Use it to orient future agents and humans
around major architecture layers, guided graph navigation, and high-blast-radius
areas before broad planning, onboarding, or architecture work. Do not treat it as
a repo dependency, runtime input, public-user requirement, or cleanup mandate.

External local baseline path (machine-local reference, not a required repo
path):
`/Users/timharris/.mission-control/understand-anything-baselines/hiverunner-20260603-0152-complete`

Key artifacts:

- Report:
  `/Users/timharris/.mission-control/understand-anything-baselines/hiverunner-20260603-0152-complete/hiverunner-understand-anything-baseline-report.md`
- Graph:
  `/Users/timharris/.mission-control/understand-anything-baselines/hiverunner-20260603-0152-complete/repo/.understand-anything/knowledge-graph.json`

Baseline stats:

- Scope: 1,127 files, 58 semantic batches, 178 batch fragments.
- Graph: 5,396 nodes, 10,006 edges, 10 layers, 9 tour steps.
- Validation: 0 graph issues; 82 orphan-node warnings; 45 dangling semantic
  edges dropped during merge normalization.
- Runtime/cost: about 73 minutes and 1.03M tokens.
- Dashboard: browser-verified at run time.
- Repo impact: no live checkout/runtime changes and no `.understand-anything/`
  artifacts committed.

Operational guidance:

- Generated `.understand-anything/` artifacts are local/external only. Do not
  commit them.
- Do not add Understand Anything as a HiveRunner package dependency.
- Do not alter global agent configs just to consume this baseline.
- Public users do not need the external baseline path to run or use HiveRunner.
- Use focused Understand Anything passes for normal feature work.
- Reserve whole-app passes for quarterly refreshes or before major architecture
  and onboarding efforts.

High-blast-radius hubs identified by the baseline:

- `src/lib/orchestration/client.ts`
- `src/lib/orchestration/api.ts`
- `src/lib/orchestration/db.ts`
- `src/lib/orchestration/company-service.ts`
- `src/lib/orchestration/types.ts`
- `src/lib/orchestration/contracts.ts`
- `src/lib/orchestration/engine/engine.ts`
- `src/lib/orchestration/engine/action-dispatcher.ts`
- `src/lib/orchestration/engine/sweeper.ts`
- `src/lib/orchestration/runtime-registry.ts`
- `src/app/api/orchestration/companies/create-full/route.ts`
- `src/lib/build-queue.ts`
