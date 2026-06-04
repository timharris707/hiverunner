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

These are good near-term hygiene targets because they are mostly test-only or small helper extractions.

1. CSRF repeated case bodies
   - Source signal: clone family 50 in `src/lib/__tests__/csrf-protection.test.ts`.
   - Expected shape: one helper for repeated request/case assertions inside the same test file.
   - Validation: `npm run test:csrf`, `git diff --check`, `npm run fallow:changed`.
   - Estimate: one small PR.

2. Memory/skill/review test fixture cluster
   - Source signal: clone families 91-95 across company memory route, company skills route, memory extractor, review routing, review decision, and skill candidate tests.
   - Expected shape: one small shared fixture/assertion helper, only if direct reads confirm identical semantics.
   - Validation: touched test files plus `npm run fallow:changed`.
   - Estimate: one or two small PRs.

3. Create-task dependency/subtask test cluster
   - Source signal: clone families 96-100 around `orchestration-create-task-depends-on.test.ts` and neighboring task update/reconcile tests.
   - Expected shape: extract repeated setup/assertion helpers without changing task behavior.
   - Validation: touched tests plus relevant task update/reconcile tests.
   - Estimate: one or two PRs.

4. Single-file adapter test repetition
   - Source signal: clone family 141 in `orchestration-symphony-execution-adapter.test.ts`.
   - Expected shape: table/helper extraction inside the test file or a tiny local helper.
   - Validation: Symphony adapter tests and `npm run fallow:changed`.
   - Estimate: one PR.

5. Dead export micro-prunes
   - Source signal: remaining unused exports in isolated utilities such as `src/lib/cron-parser.ts`, `src/lib/agent-status.ts`, `src/lib/agent-skills.ts`, and small UI helper modules.
   - Expected shape: direct import searches before removal; avoid dynamic/runtime or framework entry points.
   - Validation: `rg` import checks, focused tests when available, `npm run fallow:changed`.
   - Estimate: one to three small PRs, depending on dynamic-use uncertainty.

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

For the next run, the recommended target is the CSRF repeated case-body cleanup plus, if that merges cleanly, one memory/skill/review test fixture cluster. Avoid runner scripts until the remaining test-helper clusters are cleaner.
