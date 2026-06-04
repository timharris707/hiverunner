# Fallow Hygiene Roadmap

Date: 2026-06-04

This note tracks the follow-up cleanup stream after the initial Fallow evaluation. Fallow is being used as an advisory cleanup and architecture-health signal for HiveRunner; it is not a runtime dependency, CI gate, or source of automatic deletion.

## Current Baseline

Measured from a temporary worktree at `origin/main` after PR #44.

- Scan commit: `6880bc0d8` (`Share memory and skills route helpers`)
- Scan runtime: about 3 seconds for health, dead-code, and duplication reports
- Health score: 63, grade C
- Total measured LOC: 245,853
- Dead-code findings: 470 total
  - unused files: 47
  - unused exports: 297
  - unused type exports: 53
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 61
  - circular dependencies: 9
- Duplication: 203 clone groups, 165 clone families, 33,836 duplicated lines, 11.3% duplication across 432 files
- Complexity: 985 high-complexity functions reported

For comparison, the initial 2026-06-03 baseline reported health score 59, 508 dead-code issues, 220 clone groups, and 11.6% duplication. The cleanup stream is moving the numbers, but the remaining full-warning pool is still broad.

Latest checkpoint after PR #55:

- Scan commit: `7b9230764` (`Clean up memory quality test helpers`)
- Dead-code findings: 459 total
  - unused files: 47
  - unused exports: 288
  - unused type exports: 52
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 60
  - circular dependencies: 9
- Duplication: 169 clone groups, 152 clone families, 31,192 duplicated lines, 10.4% duplication across 418 files

Latest checkpoint after PR #60:

- Scan commit: `46f400316` (`Reuse orchestration DB reset test helpers`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 459 total
  - unused files: 47
  - unused exports: 288
  - unused type exports: 52
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 60
  - circular dependencies: 9
- Duplication: 160 clone groups, 136 clone families, 29,840 duplicated lines, 10.0% duplication across 410 files
- Health score: 73, grade B
- Total measured LOC: 245,730

Net movement from the PR #55 checkpoint: 9 fewer clone groups, 16 fewer clone families, 1,352 fewer duplicated lines, and 8 fewer files with clones. Dead-code counts did not move in this batch because the work was deliberately test-fixture cleanup.

## Completed Cleanup

Merged Fallow-driven or Fallow-adjacent hygiene PRs:

- #26: reuse SQLite reset helper in session reset tests
- #28: dedupe orchestration test runner harness
- #29: dedupe agent project fixture setup
- #30: reuse SQLite reset fixture helper
- #31-#35: reuse SQLite reset helpers across task mutation, execution cancel, memory route, OpenClaw session, and wiki review tests
- #37: reuse executable script helper in OpenClaw test fixtures
- #38: prune unused public exports
- #39: remove unused legacy helper files
- #40: share voice session test harness
- #41: share execution hive route helpers
- #42: share middleware bypass test harness
- #43: share auth env test helpers
- #44: share memory and skills route helpers
- #46: share CSRF owner session assertion
- #48: share Symphony adapter test helpers
- #49: share memory/review learning fixtures
- #50: share create-task fixture helpers
- #52: reuse shared adapter test runner
- #53: prune unused utility exports
- #54: use shared runner in sync tests
- #55: clean up memory quality test helpers
- #57: reuse execution route test helpers
- #58: reuse build route test helpers
- #59: reuse auth route test helpers
- #60: reuse orchestration DB reset test helpers

Related but not cleanup:

- #36 fixed the pre-existing `orchestration-openclaw-running-output-wait.test.ts` reliability issue that surfaced during cleanup validation.

## Operating Rules

- Use explicit git worktrees for Fallow batches.
- Assign one worker per worktree with disjoint write ownership.
- Keep each PR narrow enough that direct file reads and focused tests can validate behavior.
- Run `git diff --check` and `npm run fallow:changed` for every cleanup PR.
- Use CodeGraph `query`, `callers`, `callees`, and `impact` before editing high-blast-radius orchestration/runtime/API code.
- Do not commit `.fallow/`, `.codegraph/`, `.understand-anything/`, or generated scan output.
- Do not use `fallow fix` without separate review.
- Update this roadmap after each merged cleanup batch with PR numbers, baseline deltas when useful, and the next recommended target.

## Next Safe Queue

These are good near-term hygiene targets because they are mostly test-only or small helper extractions. Pick by expected gain and risk, not by raw Fallow ordering.

1. Remaining repeated setup shells and route-test fixtures
   - Source signal: the largest remaining duplication family spans repeated test setup/import/env blocks across 39 files, plus smaller setup families in OpenClaw/heartbeat/voice-style orchestration tests.
   - Expected shape: continue reusing existing helpers, especially `createTestRunner`, `resetSqliteDatabaseFiles`, auth env, middleware, voice session, and orchestration fixtures. Prefer small clusters with shared setup semantics; avoid one global harness.
   - Validation: touched test files plus `npm run fallow:changed`.
   - Estimate: several small PRs; use subagents with explicit worktrees for disjoint clusters.

2. Single-file or tiny-family test fixture extractions
   - Source signal: remaining clone families include `orchestration-execution-cancel.test.ts`, `orchestration-execution-route-dispatch.test.ts`, `orchestration-bundle5-reliability.test.ts`, and build-route fixture bodies.
   - Expected shape: local helper functions inside the test file or a narrow existing test helper, not a broad framework abstraction.
   - Validation: touched route tests plus `npm run fallow:changed`.
   - Estimate: two to four small PRs.

3. Dead export micro-prunes
   - Source signal: dead-code remains at 459 findings; near-term candidates include isolated helper exports such as `setMiddlewareNodeEnv` and utilities that direct import searches prove unused.
   - Expected shape: direct import searches before removal; avoid dynamic/runtime, public client APIs, provider boundaries, framework entry points, and barrel re-exports. Run builds for export/file removals.
   - Validation: `rg` import checks, focused tests when available, `npm run fallow:changed`; run `npm run build` when exports are touched.
   - Estimate: one to three small PRs, depending on dynamic-use uncertainty.

## Completed Queue Items

- CSRF repeated case bodies
  - Source signal: clone family 50 in `src/lib/__tests__/csrf-protection.test.ts`.
  - Completed by #46 with a local owner-session assertion helper.
  - Validation: `npm run test:csrf`, `git diff --check`, `npm run fallow:changed`.

- Symphony adapter single-file repetition
  - Source signal: clone family 141 in `src/lib/__tests__/orchestration-symphony-execution-adapter.test.ts`.
  - Completed by #48 with local setup/execute helpers.
  - Validation: Symphony adapter test, `git diff --check`, `npm run fallow:changed`.

- Memory/skill/review test fixture cluster
  - Source signal: clone families 91-95 across company memory route, company skills route, memory extractor, review routing, review decision, and skill candidate tests.
  - Completed by #49 with shared orchestration learning fixtures.
  - Validation: touched test files, `git diff --check`, `npm run fallow:changed`.

- Create-task dependency/subtask test cluster
  - Source signal: clone families 96-100 around `orchestration-create-task-depends-on.test.ts` and neighboring task update/reconcile tests.
  - Completed by #50 with shared create-task fixture helpers.
  - Validation: touched test files, `git diff --check`, `npm run fallow:changed`.
  - Caveat: `orchestration-update-task-status-rejection.test.ts` still has two pre-existing failures reproduced on clean `origin/main`; do not treat that as introduced by #50.

- Adapter test runner duplication
  - Source signal: repeated pass/fail harnesses in Anthropic, Codex, Gemini, HERMES, execution adapter registry, and runtime registry tests.
  - Completed by #52 with `createTestRunner`.
  - Validation: touched adapter/registry tests, `git diff --check`, `npm run fallow:changed`, GitHub Local-First CI.

- Utility dead-export micro-prune
  - Source signal: unused exports in `src/lib/cron-parser.ts`, `src/lib/agent-status.ts`, and `src/lib/orchestration/avatar-icons.ts`.
  - Completed by #53 after direct symbol and import-path searches.
  - Validation: `git diff --check`, `npm run fallow:changed`, `npm run build`, GitHub Local-First CI.

- Sync utility test runner duplication
  - Source signal: repeated synchronous pass/fail harnesses in runtime, voice, workspace, and company wizard tests.
  - Completed by #54 with `createTestRunner`.
  - Validation: nine touched tests, `git diff --check`, `npm run fallow:changed`, GitHub Local-First CI.
  - Deferred: `workspace-root-resolution.test.ts` and `gateway-stream-bridge.test.ts` need separate DB/test-isolation review before harness conversion.

- Memory quality test helper duplication
  - Source signal: repeated pass/fail runners, DB cleanup, and fixture setup in memory quality/retrieval/vault tests.
  - Completed by #55 with `createTestRunner`, `resetSqliteDatabaseFiles`, and existing learning fixtures where semantics matched.
  - Validation: six touched tests, `git diff --check`, `npm run fallow:changed`, GitHub Local-First CI.

- Execution route test helper duplication
  - Source signal: repeated pass/fail runners and DB cleanup in execution route, hives, inbox, and wiki governance tests.
  - Completed by #57 with `createTestRunner` and `resetSqliteDatabaseFiles`.
  - Validation: six touched tests, `git diff --check`, `npm run fallow:changed`, GitHub Local-First CI.

- Build/status/continuation test helper duplication
  - Source signal: repeated tiny runners and DB cleanup in build route, factory status, local health, passive report, and continuation tests.
  - Completed by #58 with `createTestRunner` and `resetSqliteDatabaseFiles`.
  - Validation: seven touched tests, `git diff --check`, `npm run fallow:changed`, GitHub Local-First CI.

- Auth and route-adjacent test helper duplication
  - Source signal: repeated pass/fail runners in auth, CSRF, ideas migration, and company owner authorization tests.
  - Completed by #59 with `createTestRunner` and one SQLite reset-helper reuse.
  - Validation: five touched tests, `npm run test:csrf`, `git diff --check`, `npm run fallow:changed`, GitHub Local-First CI.

- Orchestration DB reset/setup shell duplication
  - Source signal: repeated manual db/wal/shm cleanup and local pass/fail runners across orchestration contract tests.
  - Completed by #60 with `createTestRunner`, `resetSqliteDatabaseFiles`, and an opt-in stack-preview option to preserve existing bundle-test diagnostics.
  - Validation: nine touched tests, `git diff --check`, `npm run fallow:changed`, GitHub Local-First CI.

## Defer Or Plan Separately

These are real findings, but they should not be folded into the current low-risk hygiene stream.

- Runner script helper extraction
  - Fallow reports multiple high-savings clone families across the provider runner scripts.
  - Risk is higher because runner behavior is operational. Do this only as a dedicated runner PR with every runner test and at least one manual command-path review.

- Runtime adapter common helpers
  - Fallow reports duplication across Anthropic, Codex, Gemini, Hermes, OpenClaw, and Symphony execution adapters.
  - This touches execution semantics and provider boundaries. Treat it as architecture work, not incidental cleanup.

- Circular dependency cleanup
  - Current count remains 9.
  - Most cycles involve build queue/quota scheduling or orchestration engine/runtime modules. These need CodeGraph impact analysis and design notes before edits.

- Large page/component complexity
  - Current health report lists large dashboard/task/detail/configuration pages and central engine services.
  - These are product architecture/refactor targets. Do not use Fallow alone to drive changes here.

- Full dead-file removal across UI/components
  - Fallow reports 47 unused files, many in UI and avatar/office/component areas.
  - Some may be planned, dynamic, or story/demo assets. Prune only after direct import searches and product intent review.

## Size And Cadence

The full Fallow warning pool is not a one-morning cleanup. Cleaning every reported dead-code, duplicate, complexity, and circular-dependency finding safely would likely be a multi-day to multi-week effort because many findings are high-blast-radius architecture work.

The low-risk hygiene queue above is more bounded. A reasonable cadence is:

- 2-4 small hygiene PRs per focused work block when using explicit worktrees and subagents.
- Stop after each batch to merge, clean worktrees, update this roadmap, and choose the next target.
- Re-run a full advisory Fallow baseline after every 5-8 hygiene PRs or after any major architecture change.
- Keep `fallow:changed` as a PR-level audit, not a full blocking gate.

For the next run, prioritize highest-gain, lowest-risk slices: remaining narrow test setup duplication first, especially route-test fixtures, execution-cancel single-file repetition, and small repeated build-route fixture bodies. Mix in isolated dead-export micro-prunes when direct import searches make them obvious. Avoid runner scripts and runtime adapter helper extraction until the test-helper clusters are cleaner and CodeGraph impact analysis is done.
