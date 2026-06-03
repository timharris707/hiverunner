# Fallow Initial Report

Date: 2026-06-03

This is the first advisory Fallow pass for HiveRunner. Fallow is configured as an optional codebase-intelligence tool only. It is not part of production runtime, and this report does not recommend automatic deletion without separate validation.

## Tool Reference

- npm package: `fallow`
- Docs: https://docs.fallow.tools
- GitHub: https://github.com/fallow-rs/fallow
- HiveRunner pins `fallow@2.85.0` because `.npmrc` `min-release-age=3` blocks today's latest `fallow@2.87.0`.

## Version Choice

The repository `.npmrc` uses `min-release-age=3`, so scripts pin `fallow@2.85.0` instead of `fallow@latest`. At the time this report was generated, `fallow@latest` was `2.87.0`, published on 2026-06-03, and npm correctly blocked it as too new for the release-age policy. Version `2.85.0` is the newest verified version that satisfied the guard and includes `health --report-only`.

## Commands

- `npm run fallow` - runs the pinned Fallow CLI with `.fallowrc.jsonc`
- `npm run fallow:health` - advisory health score and complexity report
- `npm run fallow:dead-code` - unused code, dependency hygiene, duplicate exports, and cycles
- `npm run fallow:dupes` - copy-paste and structural duplication report
- `npm run fallow:audit` - changed-file PR hygiene audit against `origin/main`
- `npm run fallow:changed` - alias for changed-file audit against `origin/main`
- `npm run fallow:report` - writes markdown reports to `output/fallow/`

## Configuration Notes

The config focuses on application, route, middleware, server, script, and e2e sources. It ignores generated, build, vendor, runtime-data, archive, and local artifact paths such as `.next`, `node_modules`, `output`, `data`, `.fallow`, Playwright outputs, and archived workspaces. Dynamic runtime assets and skill/model/avatar directories are marked as dynamically loaded to reduce false confidence.

## Initial Findings

Generated local artifacts:

- `output/fallow/fallow-health.md`
- `output/fallow/fallow-dead-code.md`
- `output/fallow/fallow-dupes.md`
- `output/fallow/fallow-audit.md`

Summary from the first run:

- Health score: 59, grade C.
- Scope measured: 247,596 LOC.
- Dead files: 7.8%.
- Dead exports: 11.6%.
- Circular dependencies: 9.
- Unused dependencies: 5.
- Duplication: 11.6%, with 220 clone groups.
- Dead-code report: 508 issues, including 59 unused files, 317 unused exports, 50 unused types, 2 unused class members, 19 duplicate export pairs, 1 unlisted dependency, 1 test-only production dependency, and 9 circular dependencies.
- Changed-file audit for this tooling branch: no issues in the changed files. Six inherited dependency findings were excluded by the new-only audit gate.

Top health hotspots reported by Fallow include large/complex surfaces such as:

- `src/app/(dashboard)/companies/[slug]/tasks/[taskKey]/page.tsx`
- `src/components/HiveRunnerShell/Dock.tsx`
- `src/hooks/useVoiceSession.ts`
- `src/app/(dashboard)/companies/[slug]/goals/page.tsx`
- `src/app/(dashboard)/companies/[slug]/agents/[agentId]/configuration/page.tsx`
- `src/lib/orchestration/engine/heartbeat-manager.ts`

These should be treated as planning signals, not quick cleanup targets.

## Suggested Follow-Up PRs

1. Dependency hygiene review.
   Verify whether `@react-three/drei`, `@react-three/fiber`, `@react-three/rapier`, `lightweight-charts`, and `three` are still intentionally retained for planned or dynamic UI surfaces. Also resolve the reported `sharp` unlisted dependency and decide whether `@playwright/test` belongs in `devDependencies`.

2. Test fixture dedupe.
   Extract repeated local-auth, database, and orchestration test setup patterns from `src/lib/__tests__`. This is likely a low-risk PR because it can preserve behavior and improve future test maintenance.

3. Runner script shared helpers.
   Reduce repeated boilerplate across `scripts/hiverunner-claude-runner.mjs`, `scripts/hiverunner-gemini-runner.mjs`, `scripts/hiverunner-hermes-runner.mjs`, `scripts/hiverunner-openclaw-runner.mjs`, and `scripts/hiverunner-symphony-runner.mjs`. Keep this narrow and validate every runner command touched.

4. API route helper extraction.
   Review duplicated route patterns around company slug lookup, auth/error handling, model-source/runtime responses, memory/skills routes, and hives routes. Start with one route family instead of refactoring all API routes at once.

5. Dead export triage for isolated utilities.
   Start with smaller targets Fallow called out, such as `src/lib/cron-parser.ts`, `src/lib/orchestration/company-routes.ts`, `src/lib/orchestration/project-display.ts`, and `src/lib/public-identity.ts`. Each removal should be backed by direct import searches and tests because Fallow can miss dynamic/framework entry points.

## Non-Goals

- Do not use `fallow fix` without a separate review.
- Do not remove UI components, runtime adapters, skill files, or provider assets based on this report alone.
- Do not make Fallow a required production dependency.
- Do not turn health findings into a blocking CI gate until the existing baseline is intentionally ratcheted.
