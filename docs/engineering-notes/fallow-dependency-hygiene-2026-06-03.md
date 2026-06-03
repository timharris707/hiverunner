# Fallow Dependency Hygiene Review

Date: 2026-06-03

This review follows the advisory dependency findings from the initial Fallow report. It is intentionally limited to package metadata and lockfile hygiene. No app code, UI components, routes, tests, runners, or architecture were removed.

## Reviewed Dependencies

- `sharp`
  - Status: kept as a production dependency.
  - Reason: `src/app/api/orchestration/companies/[slug]/agents/[agentId]/avatar/route.ts` imports `sharp` directly to create avatar thumbnails. It was present transitively in the lockfile but missing from `package.json`.

- `@playwright/test`
  - Status: moved from `dependencies` to `devDependencies`.
  - Reason: it is used by `playwright.config.ts` and `e2e/*.spec.ts`, not by production runtime.

- `playwright`
  - Status: kept as a production dependency.
  - Reason: `src/lib/visual-qa.ts` imports `playwright` directly for runtime visual QA screenshot capture.

- `@react-three/drei`, `@react-three/fiber`, `@react-three/rapier`, `three`
  - Status: removed from direct dependencies.
  - Reason: no direct imports, dynamic imports, script usage, or docs-backed runtime requirement were found.

- `lightweight-charts`
  - Status: removed from direct dependencies.
  - Reason: no direct imports, dynamic imports, script usage, or docs-backed runtime requirement were found.

## Follow-Up Candidates

- If a future 3D or chart surface is added, add the required package back in the same PR as the feature that imports it.
- `playwright` can be revisited later if visual QA becomes a dev-only workflow, but that would require a runtime behavior decision and is outside this hygiene pass.
