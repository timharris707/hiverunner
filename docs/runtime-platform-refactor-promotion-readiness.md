# Runtime Platform Refactor Promotion Readiness

Status: implementation committed; stable promotion blocked pending controlled replay.

Generated: 2026-06-07

## Implemented Commits

- `823cb620c` - Align execution engine labels
- `d8ab778ea` - Add runtime proof gates and action replay

## What This Package Verifies

The runtime refactor implementation now includes:

- Live/runtime proof surfaces in Run Trace, including browser proof attachments, manifest links, screenshots, videos, command details, hashes, and task-artifact registration state.
- Strict runtime action ledger reservation before `mc-action` execution for heartbeat imports and legacy execution polling.
- Manual action replay API at `/api/orchestration/engine/actions/[actionId]/replay`.
- Runtime benchmark summaries with protocol metadata, action-ledger untracked counts, browser proof metrics, and first-evidence / detect-unhealthy latency metrics.
- Repeated old-vs-new promotion gate support with baseline/candidate medians, p95s, replay-noise thresholds, UI consistency proof, and untracked-action proof requirements.
- The v2 benchmark preparation protocol documented in `docs/runtime-platform-refactor-goal.md`.

## Current Observed Baseline

Source: `scratch/runtime-platform-refactor-promotion/current-ins-g006-summary.md`

This is the completed full `INS-G006` goal from the local SQLite DB, not the required frozen 10-task replay fixture.

- Tasks: 75
- Execution runs: 257
- Completed runs: 167
- Non-completed runs: 90 (35.0%)
- Average runs per task: 3.43
- Runtime-quality failures: 53 (20.6%)
- Combined input tokens: 478,080,674
- Combined fresh input tokens: 28,020,514
- First-evidence p50 / p95: 181,689ms / 1,116,613ms
- Detect-unhealthy p50 / p95: 529,606ms / 1,800,385ms
- Repeated deterministic env failure still visible in baseline data: `INS-205` repeated `env: node: No such file or directory` 31 times.

## Validation Completed

- `node ./node_modules/typescript/bin/tsc --noEmit --pretty false`
- `npm run lint` (passes with existing warnings)
- `env ORCHESTRATION_DB_PATH=/tmp/hiverunner-bundle5-ledger-replay-final2.db node ./scripts/run-ts-test.mjs src/lib/__tests__/orchestration-bundle5-reliability.test.ts`
- `node ./scripts/run-tsx.mjs src/lib/__tests__/runtime-benchmark.test.ts`
- `npm run test:orchestration:run-trace-view-render`
- `node ./scripts/run-ts-test.mjs src/lib/__tests__/orchestration-run-trace-view-model.test.ts`
- `env ORCHESTRATION_DB_PATH=/tmp/orchestration-engine-run-events-route-proof-final2.db node ./scripts/run-ts-test.mjs src/lib/__tests__/orchestration-engine-run-events-route.test.ts`
- `git diff --check`
- `codegraph sync .`
- `codegraph status .` (index up to date)

## Known Non-Blocking Checks

- `npm run build` was not run because the build guard refused to hide `.next` while the dev lane was live on port `3010`.
- `npm run fallow:changed` still fails on broad branch-vs-`origin/main` audit debt: unused exports, duplicate exports, duplication, and complexity across hundreds of changed files. This is the existing repo-wide Fallow gate state, not a targeted runtime-proof regression.

## Promotion Blocker

The mechanical stable-promotion gate has not passed because the required controlled benchmark evidence does not exist yet.

Required missing evidence:

- A frozen 10-task `INS-G006`-class replay fixture.
- At least 3 baseline repeats and 3 candidate repeats against that same fixture.
- Candidate summary JSON files exported with `scripts/runtime-benchmark.ts`.
- Baseline summary JSON files exported with `scripts/runtime-benchmark.ts`.
- Explicit UI-consistency proof JSON.
- Explicit untracked-action proof JSON.
- A passing `scripts/runtime-promotion-gate.ts` report.

Current `data-exec-dev/benchmark-manifest.json` is an older v1 copy of the full 75-task `INS-G006` goal, not the v2 frozen 10-task protocol.

## Recommendation

Do not promote to stable `3001` yet.

Next step is to create or select the frozen 10-task fixture in an isolated execution-dev lane, run the 3x baseline / 3x candidate replay protocol, and only then run `scripts/runtime-promotion-gate.ts`. If the operator explicitly waives the controlled replay requirement, promote with that waiver recorded here.
