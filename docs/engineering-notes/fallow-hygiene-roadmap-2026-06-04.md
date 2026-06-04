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

Latest checkpoint after PR #65:

- Scan commit: `0e968dc1c` (`Reuse auth env test helpers`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 459 total
  - unused files: 47
  - unused exports: 288
  - unused type exports: 52
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 60
  - circular dependencies: 9
- Duplication: 147 clone groups, 126 clone families, 29,161 duplicated lines, 9.8% duplication
- Health score: 73, grade B
- Total measured LOC: 245,730

Net movement from the PR #60 checkpoint: 13 fewer clone groups, 10 fewer clone families, 679 fewer duplicated lines, and a 0.2 percentage-point reduction in reported duplication. Dead-code counts did not move in this batch because the work remained test-fixture focused.

Latest checkpoint after PR #70:

- Scan commit: `a1662e5d0` (`Remove unused middleware test env helper`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 458 total
  - unused files: 47
  - unused exports: 287
  - unused type exports: 52
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 60
  - circular dependencies: 9
- Duplication: 146 clone groups, 125 clone families, 29,114 duplicated lines, 9.8% duplication
- Health score: 73, grade B
- Total measured LOC: 245,730

Net movement from the PR #65 checkpoint: 1 fewer clone group, 1 fewer clone family, 47 fewer duplicated lines, and 1 fewer dead-code finding. This batch intentionally stayed low-risk, but the return was smaller than earlier fixture-helper batches; future work should keep using expected-gain/risk triage instead of treating every Fallow warning as equally valuable.

Latest checkpoint after PR #76:

- Scan commit: `f3c6bd4e7` (`Dedupe bundle5 review fixtures`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 458 total
  - unused files: 47
  - unused exports: 287
  - unused type exports: 52
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 60
  - circular dependencies: 9
- Duplication: 134 clone groups, 117 clone families, 28,029 duplicated lines, 9.4% duplication
- Health score: 73, grade B
- Total measured LOC: 245,730

Net movement from the PR #70 checkpoint: 12 fewer clone groups, 8 fewer clone families, 1,085 fewer duplicated lines, and a 0.4 percentage-point reduction in reported duplication. Dead-code counts did not move because this batch focused on test-harness and fixture duplication.

Latest checkpoint after PR #82:

- Scan commit: `ad158d22b` (`Reuse orchestration async test helpers`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 458 total
  - unused files: 47
  - unused exports: 287
  - unused type exports: 52
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 60
  - circular dependencies: 9
- Duplication: 123 clone groups, 107 clone families, 27,565 duplicated lines, 9.3% duplication
- Health score: 73, grade B
- Total measured LOC: 245,730

Net movement from the PR #76 checkpoint: 11 fewer clone groups, 10 fewer clone families, 464 fewer duplicated lines, and a 0.1 percentage-point reduction in reported duplication. Dead-code counts stayed flat because this batch stayed test-only and focused on shared runner/setup helpers.

Latest checkpoint after PR #88:

- Scan commit: `4ae51e98e` (`Reduce runner duplication in goal and model tests`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 458 total
  - unused files: 47
  - unused exports: 287
  - unused type exports: 52
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 60
  - circular dependencies: 9
- Duplication: 112 clone groups, 96 clone families, 27,122 duplicated lines, 9.1% duplication
- Health score: 73, grade B
- Total measured LOC: 245,726

Net movement from the PR #82 checkpoint: 11 fewer clone groups, 11 fewer clone families, 443 fewer duplicated lines, and a 0.2 percentage-point reduction in reported duplication. Dead-code counts stayed flat because this batch intentionally remained test/helper-focused.

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
- #62: clean up orchestration setup test helpers
- #63: clean up execution cancel test fixtures
- #64: share build task test fixtures
- #65: reuse auth env test helpers
- #67: dedupe Symphony adapter test fixtures
- #68: clean up create task dependency test fixtures
- #69: refactor CSRF test case fixtures
- #70: remove unused middleware test env helper
- #72: reuse simple runner harness in runner tests
- #73: clean up OpenClaw heartbeat test harnesses
- #74: tidy route dispatch test fixtures
- #75: reduce provisioning runtime alias fixture duplication
- #76: dedupe bundle5 review fixtures
- #78: reuse orchestration runner helpers in memory tests
- #79: reuse shared runner harnesses in sync tests
- #80: refactor adapter fixture test setup
- #81: reuse simple test runner in route contracts
- #82: reuse orchestration async test helpers
- #84: reuse SQLite reset helper in proof tests
- #85: tighten orchestration execution test setup
- #86: use shared test runner in live voice tests
- #87: use shared test runner in small route tests
- #88: reduce runner duplication in goal and model tests

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

1. Remaining SQLite reset/setup shells and tiny route/test runners
   - Source signal: the largest low-risk remaining test-only groups still include manual `ORCHESTRATION_DB_PATH` cleanup blocks, repeated local pass/fail runners, and small route/setup shells across orchestration contract tests.
   - Expected shape: continue reusing existing helpers, especially `createTestRunner`, `resetSqliteDatabaseFiles`, auth env, middleware, voice session, and orchestration fixtures. Prefer small clusters with shared setup semantics; avoid one global harness.
   - Validation: touched test files plus `npm run fallow:changed`.
   - Estimate: several small PRs; use subagents with explicit worktrees for disjoint clusters.

2. Single-file or tiny-family test fixture extractions
   - Source signal: remaining clone families include `orchestration-company-agents-route.test.ts`, `orchestration-create-task-depends-on.test.ts`, execution route/hive tests, and small route-test bodies.
   - Expected shape: local helper functions inside the test file or a narrow existing test helper, not a broad framework abstraction.
   - Validation: touched route tests plus `npm run fallow:changed`.
   - Estimate: two to four small PRs.

3. Dead export micro-prunes
   - Source signal: dead-code remains at 458 findings; near-term candidates should be isolated helper exports or files that direct import searches prove unused.
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

- Orchestration setup helper duplication
  - Source signal: repeated runners, DB resets, env snapshots, and local setup bodies in dev-execution, agent scoping/profile/runtime update, and approval routing tests.
  - Completed by #62 with existing test helpers plus small local helpers where setup semantics matched.
  - Validation: five touched tests, `git diff --check`, `npm run fallow:changed`, GitHub Local-First CI.

- Execution cancel single-file fixture duplication
  - Source signal: repeated subprocess-backed provider cancellation setup in `orchestration-execution-cancel.test.ts`.
  - Completed by #63 with local fixture helpers while leaving the heartbeat cancellation contract separate.
  - Validation: focused execution-cancel test, `git diff --check`, `npm run fallow:changed`, GitHub Local-First CI.

- Build task fixture duplication
  - Source signal: repeated make/upsert/delete/get task fixture helpers in build route, factory status, and build-state terminal transition tests.
  - Completed by #64 with a narrow `build-task-fixtures` test helper. The helper also creates the local fixture project directory so the tests pass in clean checkouts.
  - Validation: three touched tests from a clean local project-dir state, `git diff --check`, `npm run fallow:changed`, GitHub Local-First CI.

- Auth/env test helper duplication
  - Source signal: repeated runners and env setup/restore shells in auth, local-single-user, cost opt-in, and local exposure hardening tests.
  - Completed by #65 with `createTestRunner` and env snapshot helpers.
  - Validation: five touched tests, `git diff --check`, `npm run fallow:changed`, GitHub Local-First CI.

- Remaining single-file test fixture cleanup and one dead-export micro-prune
  - Source signal: remaining clone families in `orchestration-symphony-execution-adapter.test.ts`, `orchestration-create-task-depends-on.test.ts`, and `csrf-protection.test.ts`, plus an isolated unused `setMiddlewareNodeEnv` helper export.
  - Completed by #67, #68, #69, and #70 using explicit worktrees and one worker per branch.
  - Validation: focused touched tests, `git diff --check`, `npm run fallow:changed`, and GitHub Local-First CI.
  - Caveat: this moved the metrics only slightly. Keep future batches focused on slices with clear repetition and low behavioral risk; do not spend hours polishing tiny clone groups with little navigation or maintenance payoff.

- Test harness and local fixture cleanup
  - Source signal: high-weight clone groups around repeated pass/fail harnesses and local fixture setup in runner tests, OpenClaw heartbeat tests, route dispatch tests, provisioning runtime alias tests, and Bundle 5 review tests.
  - Completed by #72, #73, #74, #75, and #76 with explicit worktrees and one worker per branch.
  - Validation: focused touched tests, `git diff --check`, `npm run fallow:changed`, and GitHub Local-First CI.
  - Caveat: #73 intentionally left `orchestration-openclaw-session-mc-action-extraction.test.ts` and `orchestration-openclaw-suffixed-session-import.test.ts` untouched after they reproduced a pre-existing isolated-DB failure: no active execution hive configured for the fixture company.

- Follow-on runner/setup helper cleanup
  - Source signal: repeated pass/fail runners and fixture setup in bootstrap readiness, memory evidence, passive report loop guard, idea route contracts, sync runner/tracker tests, adapter fixture tests, and async orchestration tests.
  - Completed by #78, #79, #80, #81, and #82 with explicit worktrees and one worker per branch.
  - Validation: focused touched tests, `git diff --check`, `npm run fallow:changed`, and GitHub Local-First CI.
  - Caveat: this batch confirmed the expected-gain/risk pattern: test-only runner cleanup still helps, but the biggest remaining raw Fallow savings are now runner scripts, provider adapters, and OpenClaw-adjacent setup. Treat those as planned work, not incidental hygiene.

- SQLite reset and remaining runner/setup test cleanup
  - Source signal: repeated manual SQLite cleanup, environment setup, executable-script stubs, and local test runners across proof, live/voice, small route, goal/model, and execution route tests.
  - Completed by #84, #85, #86, #87, and #88 with explicit worktrees and one worker per branch.
  - Validation: focused touched tests, `git diff --check`, `npm run fallow:changed`, and GitHub Local-First CI.
  - Caveat: two pre-existing test contract issues surfaced and were deliberately left out of the hygiene PRs: `orchestration-foundation-workflow.test.ts` / `orchestration-query-contracts.test.ts` under fresh isolated DB paths, and `orchestration-live-status.test.ts` expecting broader live-run semantics than the current `live-status` implementation provides.

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

- Test reliability issues surfaced during hygiene
  - `orchestration-foundation-workflow.test.ts` and `orchestration-query-contracts.test.ts` failed when run directly with fresh DB paths during the PR #84 slice. Those failures should be investigated as test setup/fixture reliability, not folded into helper cleanup.
  - `orchestration-live-status.test.ts` failed identically before and after the PR #86 helper conversion. The test expects queued/pending and SSE-only signals to count as live, while the current implementation only treats `running` snapshots as live. Resolve this as a runtime/test-contract decision.

## Size And Cadence

The full Fallow warning pool is not a one-morning cleanup. Cleaning every reported dead-code, duplicate, complexity, and circular-dependency finding safely would likely be a multi-day to multi-week effort because many findings are high-blast-radius architecture work.

The low-risk hygiene queue above is more bounded. A reasonable cadence is:

- 2-4 small hygiene PRs per focused work block when using explicit worktrees and subagents.
- Stop after each batch to merge, clean worktrees, update this roadmap, and choose the next target.
- Re-run a full advisory Fallow baseline after every 5-8 hygiene PRs or after any major architecture change.
- Keep `fallow:changed` as a PR-level audit, not a full blocking gate.

For the next run, prioritize highest-gain, lowest-risk slices: remaining narrow test setup duplication first, especially test files that can still adopt `createTestRunner`, route-test fixture setup, and single-file fixture bodies with obvious repeated setup. Mix in isolated dead-export micro-prunes when direct import searches make them obvious. If a candidate appears to save only a handful of lines or mostly duplicate import blocks, skip it for now. Do not fold the two fragile OpenClaw session tests from #73 into general hygiene until their isolated-DB fixture setup is understood. Avoid runner scripts and runtime adapter helper extraction until the test-helper clusters are cleaner and CodeGraph impact analysis is done.

After PR #88, the remaining low-risk test-helper pool is smaller. Continue only with clusters that still have clear maintenance value, such as company-agent route single-file duplication, create-task/dependency repeated assertion bodies, and isolated DB setup shells that pass clean direct tests. Skip tiny import-only clones. Keep the fragile OpenClaw session tests and the newly surfaced live-status/foundation/query reliability issues out of general hygiene until their contracts are understood. Runner scripts and provider execution adapter helper extraction remain higher-impact but higher-risk; schedule those only as dedicated PRs with CodeGraph impact checks and the full runner/adapter test matrix.
