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

Latest checkpoint after PR #94:

- Scan commit: `0cd5edab6` (`test: dedupe provider runner harness setup`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 458 total
  - unused files: 47
  - unused exports: 287
  - unused type exports: 52
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 60
  - circular dependencies: 9
- Duplication: 109 clone groups, 93 clone families, 26,723 duplicated lines, 9.0% duplication
- Health score: 73, grade B
- Total measured LOC: 245,726

Net movement from the PR #88 checkpoint: 3 fewer clone groups, 3 fewer clone families, 399 fewer duplicated lines, and a 0.1 percentage-point reduction in reported duplication. This is useful but smaller than the early fixture-helper batches; future work should pivot toward higher-signal reliability or architecture targets instead of grinding tiny test clones.

Latest checkpoint after PR #102:

- Scan commit: `7f6b05d75` (`test: reuse overseer test runner helper`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 456 total
  - unused files: 47
  - unused exports: 285
  - unused type exports: 52
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 60
  - circular dependencies: 9
- Duplication: 108 clone groups, 92 clone families, 26,605 duplicated lines, 9.0% duplication
- Health score: 73, grade B
- Total measured LOC: 245,685

Net movement from the PR #94 checkpoint: 1 fewer clone group, 1 fewer clone family, 118 fewer duplicated lines, and 2 fewer dead-code findings. The content-draft helper extraction and project-color export cleanup were still worthwhile because they were simple and directly validated, but the raw Fallow metric movement confirms that the remaining cheap cleanup pool is near diminishing returns.

Latest checkpoint after PR #104:

- Scan commit: `bd50b9efa` (`refactor: share external runner script utilities`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 456 total
  - unused files: 47
  - unused exports: 285
  - unused type exports: 52
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 60
  - circular dependencies: 9
- Duplication: 103 clone groups, 91 clone families, 26,324 duplicated lines, 8.9% duplication
- Health score: 73, grade B
- Total measured LOC: 245,520

Net movement from the PR #102 checkpoint: 5 fewer clone groups, 1 fewer clone family, 281 fewer duplicated lines, and a 0.1 percentage-point reduction in reported duplication. This was a better payoff/risk trade than another tiny test-fixture pass because it removed repeated operational runner boilerplate while staying inside one dedicated PR and validating every touched runner wrapper.

Latest checkpoint after PR #106:

- Scan commit: `9c2625aa7` (`refactor: share external runner prompt builder`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 456 total
  - unused files: 47
  - unused exports: 285
  - unused type exports: 52
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 60
  - circular dependencies: 9
- Duplication: 100 clone groups, 89 clone families, 26,099 duplicated lines, 8.8% duplication
- Health score: 73, grade B
- Total measured LOC: 245,487

Net movement from the PR #104 checkpoint: 3 fewer clone groups, 2 fewer clone families, 225 fewer duplicated lines, and a 0.1 percentage-point reduction in reported duplication. Dead-code counts did not move. This confirms that focused runner-script extractions still have real signal, but the remaining runner-script duplication should be handled only when the helper boundary is obvious and the full runner matrix can validate it.

Latest checkpoint after PR #108:

- Scan commit: `6bffa1c50` (`chore: remove unused Habbo office components`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 453 total
  - unused files: 44
  - unused exports: 285
  - unused type exports: 52
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 60
  - circular dependencies: 9
- Duplication: 98 clone groups, 88 clone families, 25,997 duplicated lines, 8.8% duplication
- Health score: 73, grade B
- Total measured LOC: 244,660

Net movement from the PR #106 checkpoint: 3 fewer dead-code findings, 2 fewer clone groups, 1 fewer clone family, 102 fewer duplicated lines, and 827 fewer measured LOC. This was a good payoff/risk slice because direct searches proved the Habbo office React components were unreachable and the active `OfficeCanvas` PNG/canvas path stayed untouched.

Latest checkpoint after PR #110:

- Scan commit: `9ff7105d0` (`chore: remove unused Zelda office components`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 450 total
  - unused files: 41
  - unused exports: 285
  - unused type exports: 52
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 60
  - circular dependencies: 9
- Duplication: 98 clone groups, 88 clone families, 25,981 duplicated lines, 8.8% duplication
- Health score: 74, grade B
- Total measured LOC: 243,788

Net movement from the PR #108 checkpoint: 3 fewer dead-code findings, 16 fewer duplicated lines, 872 fewer measured LOC, and a 1-point health score improvement. This was another narrow dead-file prune with direct-search proof and build/lint validation.

Latest checkpoint after PR #112:

- Scan commit: `13472b238` (`chore: remove unused Stardew office components`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 447 total
  - unused files: 38
  - unused exports: 285
  - unused type exports: 52
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 60
  - circular dependencies: 9
- Duplication: 98 clone groups, 88 clone families, 25,981 duplicated lines, 8.8% duplication
- Health score: 73, grade B
- Total measured LOC: 242,726

Net movement from the PR #110 checkpoint: 3 fewer dead-code findings and 1,062 fewer measured LOC. Duplication counts were unchanged. The health score moved from 74 back to 73 because Fallow's weighted deductions shifted slightly despite the lower dead-file count; treat that as a reminder to use the metric directionally, not as an exact quality score.

Latest checkpoint after PR #114:

- Scan commit: `71854833b` (`chore: remove unused demo mode mask exports`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 442 total
  - unused files: 38
  - unused exports: 280
  - unused type exports: 52
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 60
  - circular dependencies: 9
- Duplication: 98 clone groups, 88 clone families, 25,981 duplicated lines, 8.8% duplication
- Health score: 73, grade B
- Total measured LOC: 242,686

Net movement from the PR #112 checkpoint: 5 fewer dead-code findings, 5 fewer unused exports, and 40 fewer measured LOC. Duplication and health score were unchanged. This was a good isolated export-prune slice because direct searches proved the masking helpers were unused and the demo-mode provider/hook surface stayed untouched.

Latest checkpoint after PR #116:

- Scan commit: `c8e78424d` (`chore: prune unused UI helper exports`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 434 total
  - unused files: 38
  - unused exports: 272
  - unused type exports: 52
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 60
  - circular dependencies: 9
- Duplication: 98 clone groups, 88 clone families, 25,981 duplicated lines, 8.8% duplication
- Health score: 74, grade B
- Total measured LOC: 242,572

Net movement from the PR #114 checkpoint: 8 fewer dead-code findings, 8 fewer unused exports, 114 fewer measured LOC, and a 1-point health score improvement. Duplication counts were unchanged. This was another good low-risk slice because the removed public surface was limited to directly searched UI/helper exports with remaining consumers still covered by build and lint.

Latest checkpoint after PR #120:

- Scan commit: `640435d9f` (`chore: prune unused voice display components`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 425 total
  - unused files: 34
  - unused exports: 265
  - unused type exports: 54
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 60
  - circular dependencies: 9
- Duplication: 98 clone groups, 88 clone families, 25,981 duplicated lines, 8.9% duplication
- Health score: 74, grade B
- Total measured LOC: 241,773

Net movement from the PR #116 checkpoint: 9 fewer dead-code findings, 4 fewer unused files, 7 fewer unused exports, 799 fewer measured LOC, and 5 fewer high-complexity functions above threshold. Unused type exports rose by 2 after removing component files, so treat the total dead-code movement as the more useful directional signal. Duplication line counts were unchanged, while the percentage moved from 8.8% to 8.9% because the total LOC denominator shrank.

Latest checkpoint after PR #126:

- Scan commit: `2a95b4a81` (`test: dedupe heartbeat prompt fixtures`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 422 total
  - unused files: 34
  - unused exports: 263
  - unused type exports: 54
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 59
  - circular dependencies: 9
- Duplication: 93 clone groups, 84 clone families, 25,655 duplicated lines, 8.8% duplication
- Health score: 74, grade B
- Total measured LOC: 241,773

Net movement from the PR #120 checkpoint: 3 fewer dead-code findings, 2 fewer unused exports, 1 fewer duplicate export, 5 fewer clone groups, 4 fewer clone families, 326 fewer duplicated lines, and a 0.1 percentage-point reduction in reported duplication. Health score and measured LOC were unchanged. This batch mixed one safe UI/export micro-prune with four narrow test-fixture cleanups; the parallel explicit-worktree approach improved throughput without broadening individual PR risk.

Latest checkpoint after PR #128:

- Scan commit: `d813b2554` (`chore: trim realtime and onboarding helper exports`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 420 total
  - unused files: 34
  - unused exports: 261
  - unused type exports: 54
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 59
  - circular dependencies: 9
- Duplication: 93 clone groups, 84 clone families, 25,655 duplicated lines, 8.8% duplication
- Health score: 74, grade B
- Total measured LOC: 241,758

Net movement from the PR #126 checkpoint: 2 fewer dead-code findings, 2 fewer unused exports, and 15 fewer measured LOC. Duplication and health score were unchanged. This was a safe direct-search micro-prune, but it also reinforces that individual low-risk dead-export slices now move the global metrics only slightly.

Latest checkpoint after PR #130:

- Scan commit: `b279f92d` (`chore: remove unused cron UI files`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 413 total
  - unused files: 31
  - unused exports: 258
  - unused type exports: 53
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 59
  - circular dependencies: 9
- Duplication: 93 clone groups, 84 clone families, 25,655 duplicated lines, 8.8% duplication
- Health score: 74, grade B
- Total measured LOC: 240,699

Net movement from the PR #128 checkpoint: 7 fewer dead-code findings, 3 fewer unused files, 3 fewer unused exports, 1 fewer unused type export, 1,059 fewer measured LOC, 4 fewer large functions, and 4 fewer high-complexity functions above threshold. Duplication counts were unchanged. This was a better payoff than single-symbol micro-prunes because the removed cron UI/parser files formed a coherent unreachable island with no live imports.

Latest checkpoint after PR #132:

- Scan commit: `3d7035d2e` (`chore: remove unused hook and skill helpers`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 410 total
  - unused files: 28
  - unused exports: 258
  - unused type exports: 53
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 59
  - circular dependencies: 9
- Duplication: 93 clone groups, 84 clone families, 25,655 duplicated lines, 8.8% duplication
- Health score: 74, grade B
- Total measured LOC: 240,464

Net movement from the PR #130 checkpoint: 3 fewer dead-code findings, 3 fewer unused files, and 235 fewer measured LOC. Duplication and health score were unchanged. This was another coherent dead-file island: direct searches proved the standalone `useAgentStatus`, `useDebounce`, and legacy `agent-skills` scanner files were unreachable, while voice/avatar hook candidates stayed deferred for product-intent review.

Latest checkpoint after PR #134:

- Scan commit: `adf827259` (`chore: remove unused legacy dashboard widgets`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 401 total
  - unused files: 20
  - unused exports: 256
  - unused type exports: 54
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 59
  - circular dependencies: 9
- Duplication: 93 clone groups, 84 clone families, 25,655 duplicated lines, 8.8% duplication
- Health score: 74, grade B
- Total measured LOC: 239,257

Net movement from the PR #132 checkpoint: 9 fewer dead-code findings, 8 fewer unused files, 2 fewer unused exports, 1 more unused type export after Fallow reclassification, and 1,207 fewer measured LOC. Duplication and health score were unchanged. This was a higher-payoff low-risk prune because the legacy dashboard/activity widget components formed a coherent unreachable island, while office, voice/avatar, markdown/file-tree, quick-action, and UI-barrel candidates stayed deferred.

Latest checkpoint after PR #137:

- Scan commit: `76228a394` (`chore: remove unused markdown file tree components`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 394 total
  - unused files: 13
  - unused exports: 256
  - unused type exports: 54
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 59
  - circular dependencies: 9
- Duplication: 93 clone groups, 84 clone families, 25,655 duplicated lines, 8.9% duplication
- Health score: 74, grade B
- Total measured LOC: 237,993

Net movement from the PR #134 checkpoint: 7 fewer dead-code findings, 7 fewer unused files, 1,264 fewer measured LOC, 8 fewer large functions, and 6 fewer high-complexity functions above threshold. Duplication line counts were unchanged; the percentage moved from 8.8% to 8.9% because the LOC denominator shrank. This was a two-PR explicit-worktree worker batch: #136 removed standalone skill/org/marketing UI files and #137 removed standalone markdown/file-tree UI files after direct path-import searches and full build/lint/Fallow validation.

Latest checkpoint after PR #139:

- Scan commit: `c19f87967` (`chore: remove unused shell UI components`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 392 total
  - unused files: 11
  - unused exports: 256
  - unused type exports: 54
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 59
  - circular dependencies: 9
- Duplication: 93 clone groups, 84 clone families, 25,655 duplicated lines, 8.9% duplication
- Health score: 74, grade B
- Total measured LOC: 237,727

Net movement from the PR #137 checkpoint: 2 fewer dead-code findings, 2 fewer unused files, 266 fewer measured LOC, 1 fewer large function, and 1 fewer high-complexity function above threshold. Duplication and health score were unchanged. This was the last obvious standalone UI dead-file slice: `QuickActionBar` and `ProjectShellNav` had no exact path imports, while the remaining dead-file list is mostly product-intent or high-blast-radius territory.

Latest checkpoint after PR #141:

- Scan commit: `b48d1edec` (`test: dedupe sweeper test helpers`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 392 total
  - unused files: 11
  - unused exports: 256
  - unused type exports: 54
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 59
  - circular dependencies: 9
- Duplication: 92 clone groups, 84 clone families, 25,601 duplicated lines, 8.9% duplication
- Health score: 74, grade B
- Total measured LOC: 237,727

Net movement from the PR #139 checkpoint: 1 fewer clone group and 54 fewer duplicated lines. Dead-code, health score, and measured LOC were unchanged. This was intentionally a narrow test-only pass: `orchestration-sweeper.test.ts` now reuses the shared test runner and has a local CEO fixture helper, while remaining sweeper duplication was left alone because further extraction would blur individual scenario setup.

Latest checkpoint after PR #143:

- Scan commit: `020564756` (`test: dedupe wakeup coalesce helpers`)
- Full advisory Fallow scan command: `fallow dupes --no-cache --summary`, `fallow dead-code --no-cache --summary`, and `fallow health --no-cache --score --complexity --top 12 --report-only`
- Dead-code findings: 392 total
  - unused files: 11
  - unused exports: 256
  - unused type exports: 54
  - unused class members: 2
  - unlisted dependencies: 1
  - duplicate exports: 59
  - circular dependencies: 9
- Duplication: 91 clone groups, 83 clone families, 25,484 duplicated lines, 8.8% duplication
- Health score: 74, grade B
- Total measured LOC: 237,727

Net movement from the PR #141 checkpoint: 1 fewer clone group, 1 fewer clone family, 117 fewer duplicated lines, and a 0.1 percentage-point reduction in reported duplication. Dead-code, health score, and measured LOC were unchanged. This was another narrow test-only pass: `orchestration-wakeup-coalesce.test.ts` now reuses the shared test runner and local wake-row assertion helpers, while the remaining inherited runner-boilerplate clone was left for a separate small cluster.

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
- #90: clean up build route test setup
- #91: simplify workspace file setup
- #92: reduce health continuation fixture duplication
- #93: clean up auth middleware tails
- #94: dedupe provider runner harness setup
- #100: extract content draft storage helper
- #101: prune unused project color helper exports
- #102: reuse shared runner in overseer tests
- #104: share external runner script utilities
- #106: share external runner prompt builder
- #108: remove unused Habbo office components
- #110: remove unused Zelda office components
- #112: remove unused Stardew office components
- #114: remove unused demo-mode mask exports
- #116: prune unused UI helper exports
- #118: trim local-only UI helper exports
- #119: prune unused agent avatar exports
- #120: prune unused voice display components
- #122: trim icon helper exports
- #123: dedupe review-loop wake assertions
- #124: dedupe voice startup missing-key cases
- #125: dedupe create-task depends action fixtures
- #126: dedupe heartbeat prompt fixtures
- #128: trim realtime and onboarding helper exports
- #130: remove unused cron UI files
- #132: remove unused hook and skill helper files
- #134: remove unused legacy dashboard widgets
- #136: remove unused skill/org/marketing UI files
- #137: remove unused markdown/file-tree UI files
- #139: remove unused shell UI components
- #141: dedupe sweeper test helpers
- #143: dedupe wakeup coalesce test helpers

Related but not cleanup:

- #36 fixed the pre-existing `orchestration-openclaw-running-output-wait.test.ts` reliability issue that surfaced during cleanup validation.
- #96 fixed the `orchestration-live-status.test.ts` reliability issue that surfaced during cleanup validation by aligning `live-status` with queued/pending, terminal grace-window, and SSE-only liveness semantics.
- #98 fixed the fresh isolated DB reliability failures in `orchestration-foundation-workflow.test.ts` and `orchestration-query-contracts.test.ts` by refreshing fixture assumptions around the seeded HiveRunner workspace slug, execution hives, and scoped OpenClaw reconciliation side effects.

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

3. Dead file/export micro-prunes
   - Source signal: dead-code remains at 392 findings; near-term candidates should be isolated helper exports or files that direct import searches prove unused.
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
  - Caveat: two pre-existing test contract issues surfaced and were deliberately left out of the hygiene PRs: `orchestration-foundation-workflow.test.ts` / `orchestration-query-contracts.test.ts` under fresh isolated DB paths, and `orchestration-live-status.test.ts` expecting broader live-run semantics than the current `live-status` implementation provided. The live-status issue was resolved separately by #96; the fresh-DB fixture issues were resolved separately by #98.

- Final narrow test-fixture cleanup batch
  - Source signal: repeated provider runner harnesses, auth middleware env tails, build route setup, workspace file setup, and health/continuation fixture bodies.
  - Completed by #90, #91, #92, #93, and #94 with explicit worktrees and one worker per branch.
  - Validation: focused touched tests, `git diff --check`, `npm run fallow:changed`, and GitHub Local-First CI.
  - Caveat: the metric movement was modest. Treat the remaining generic test-clone pool as lower priority unless a cluster has obvious fixture clarity or reliability payoff.

- Content draft helper, export micro-prune, and overseer runner cleanup
  - Source signal: repeated content-draft JSON load/save helpers, directly-proven unused project color helper exports, and repeated overseer test pass/fail runners.
  - Completed by #100, #101, and #102 with explicit worktrees and one worker per branch.
  - Validation: content route build validation, direct `rg` import searches for export changes, focused overseer tests, `git diff --check`, `npm run fallow:changed`, and GitHub Local-First CI.
  - Caveat: this was intentionally narrow and safe, but the Fallow metric movement was small. Further work should be selected by expected maintenance/reliability payoff, not by raw warning count.

- External runner script utility extraction
  - Source signal: high-weight clone families across `scripts/hiverunner-claude-runner.mjs`, `scripts/hiverunner-gemini-runner.mjs`, `scripts/hiverunner-hermes-runner.mjs`, `scripts/hiverunner-openclaw-runner.mjs`, and `scripts/hiverunner-symphony-runner.mjs`.
  - Completed by #104 with a shared `scripts/lib/external-runner-utils.mjs` helper for identical utility functions only. HERMES-specific number parsing stayed local because its fallback contract differs.
  - Validation: CodeGraph query/callers/callees/impact for the shared runner utility surface, all five dedicated runner tests, `node --check` on touched scripts, `git diff --check`, `npm run fallow:changed`, and GitHub Local-First CI.
  - Caveat: runner scripts are operational. Continue to handle remaining runner-script duplication one focused helper at a time with the full runner test matrix.

- External runner prompt helper extraction
  - Source signal: repeated prompt-body construction across the Claude, Gemini, HERMES, and OpenClaw external runner scripts.
  - Completed by #106 with a shared `buildExternalRunnerPrompt` helper while keeping provider-specific intro text local and leaving Symphony's distinct prompt builder unchanged.
  - Validation: CodeGraph query/callers/callees/impact for `buildPrompt`, all five dedicated runner tests, `node --check` on touched scripts, `git diff --check`, `npm run fallow:changed`, and GitHub Local-First CI.
  - Caveat: the remaining runner-script duplication is more operational, including spawn/result/dry-run handling. Do not extract it opportunistically; use a dedicated PR and the full runner matrix.

- Habbo office dead-file prune
  - Source signal: `HabboFurniture` duplication looked like a safe single-file candidate, but `fallow:changed` and direct searches showed the Habbo room, character, and furniture React components were unreachable.
  - Completed by #108 by removing `src/components/office/HabboRoom.tsx`, `src/components/office/HabboCharacter.tsx`, and `src/components/office/HabboFurniture.tsx`.
  - Validation: direct `rg` searches for every Habbo export, `git diff --check`, `npm run fallow:changed`, full Fallow dead-code and duplication summaries, `npm run build`, `npm run lint`, and GitHub Local-First CI.
  - Caveat: this is the model for future dead-file cleanup: prune only directly proven unreachable files in a narrow family. Do not bulk-delete the remaining unused UI/component files from Fallow without product intent review.

- Zelda office dead-file prune
  - Source signal: after the Habbo prune, the remaining Zelda office room, character, and furniture React components were also reported as unreachable and direct searches showed no runtime imports.
  - Completed by #110 by removing `src/components/office/ZeldaRoom.tsx`, `src/components/office/ZeldaCharacter.tsx`, and `src/components/office/ZeldaFurniture.tsx`.
  - Validation: direct `rg` searches for every Zelda export, `git diff --check`, `npm run fallow:changed`, full Fallow dead-code and duplication summaries, `npm run build`, `npm run lint`, and GitHub Local-First CI.
  - Caveat: this stayed intentionally narrower than deleting every office component Fallow reports. Continue only with directly proven, coherent families.

- Stardew office dead-file prune
  - Source signal: after the Habbo and Zelda prunes, the Stardew office room, character, and furniture React components were the remaining coherent unused office theme family.
  - Completed by #112 by removing `src/components/office/StardewRoom.tsx`, `src/components/office/StardewCharacter.tsx`, and `src/components/office/StardewFurniture.tsx`.
  - Validation: direct `rg` searches for every Stardew export, `git diff --check`, `npm run fallow:changed`, full Fallow dead-code and duplication summaries, `npm run build`, `npm run lint`, and GitHub Local-First CI.
  - Caveat: stop peeling office UI by default after this. `OfficeCanvas` and `PixelCharacter` need product intent review before removal because they are closer to the current PNG/canvas office direction.

- Demo-mode mask export micro-prune
  - Source signal: unused exported masking helpers in `src/lib/demo-mode.tsx`.
  - Completed by #114 by removing `maskDollar`, `maskKey`, `maskEmail`, `maskConnectionSubtext`, and `maskPercent` while keeping `DemoModeProvider`, `useDemoMode`, and storage helpers intact.
  - Validation: direct `rg` searches for every removed export, `git diff --check`, `npm run fallow:changed`, full Fallow dead-code summary, `npm run build`, `npm run lint`, and GitHub Local-First CI.
  - Caveat: the focused `tsx` test was blocked locally by the Codex sandbox IPC policy, so this PR relied on direct reference checks, build, lint, Fallow, and CI.

- UI helper export prune
  - Source signal: unused helper exports in `GoalPrimitives`, `task-display`, and `orchestration/ui`.
  - Completed by #116 by making goal date/status helpers file-local and removing unused task status-dot and stale-signal helpers.
  - Validation: direct `rg` searches for every removed/trimmed export, `git diff --check`, `npm run fallow:changed`, full Fallow dead-code summary, `npm run build`, `npm run lint`, and GitHub Local-First CI.
  - Caveat: this stayed intentionally inside UI/helper code. Do not apply the same dead-export treatment to provider, runtime, proxy, or orchestration engine exports without CodeGraph impact checks and focused tests.

- Parallel low-risk UI/export pruning batch
  - Source signal: unused exports in `KeyboardShortcuts`, `ProviderPresentation`, `tasks/types`, and `AgentAvatar`, plus unreachable voice display components.
  - Completed by #118, #119, and #120 with explicit worktrees and worker-owned scopes.
  - Validation: direct `rg` symbol/path searches, `git diff --check`, `npm run fallow:changed`, `npm run build`, `npm run lint` for #118, worker build validation for #119/#120, and GitHub Local-First CI.
  - Caveat: two worker scopes correctly stopped without edits. `CronJobCard`, `InlineTooltip`, and `RichDescription` are referenced by other currently unused component islands, so deleting them alone would break imports. `branding.ts` is live through `OfficeCanvas`, and `src/lib/ui/index.ts` is a documented public barrel. Keep these as product-intent or broader component-island decisions, not casual Fallow deletes.

- Icon helper export prune and parallel test-fixture cleanup
  - Source signal: unused component-local icon helper exports plus Fallow clone groups in review-loop wake queries, voice startup missing-key tests, create-task dependency action fixtures, and heartbeat prompt fixture setup.
  - Completed by #122, #123, #124, #125, and #126 with explicit worktrees and worker-owned scopes.
  - Validation: direct `rg` symbol/path searches for #122; focused touched tests for #123-#126; `git diff --check`; `npm run fallow:changed`; `npm run build` and `npm run lint` for #122; and GitHub Local-First CI for every PR.
  - Caveat: remaining test duplication is increasingly inherited setup/tail boilerplate spread across many files. Keep using changed-file gates and focused tests, but do not spend whole work blocks polishing small clone groups unless they improve fixture clarity or remove a repeated source of mistakes.

- Realtime/onboarding helper export micro-prune
  - Source signal: unused realtime context hook export, unused local realtime age formatter, and a file-local onboarding state filename constant exported only for its own module.
  - Completed by #128 with direct `rg` symbol/path searches and a two-file scoped edit.
  - Validation: onboarding state tests, onboarding complete route test with isolated `MC_DATA_DIR`, `git diff --check`, `npm run fallow:changed`, full Fallow dead-code summary, `npm run lint`, `npm run build`, and GitHub Local-First CI.
  - Caveat: this is representative of the remaining low-risk dead-export pool: useful housekeeping, but low metric movement. Favor bundles with several directly proven symbols or a clear maintainability benefit.

- Cron UI/parser dead-file island
  - Source signal: `CronJobCard`, `CronWeeklyTimeline`, and `cron-parser` were reported unused; direct searches showed no live imports outside the cron family itself.
  - Completed by #130 by removing the unused cron card, weekly timeline, and parser utility together so internal dead-family imports did not break typechecking.
  - Validation: direct `rg` symbol/path searches, `git diff --check`, `npm run fallow:changed`, full Fallow dead-code summary, `npm run lint`, `npm run build`, and GitHub Local-First CI.
  - Caveat: this is the preferred dead-file shape now: remove coherent unreachable islands, not isolated files that are still imported by other currently-unused files.

- Standalone hook and legacy skill helper dead-file island
  - Source signal: `useAgentStatus`, `useDebounce`, and `agent-skills` were reported unused; direct searches showed no live imports for those module paths or exported symbols. The similar avatar/Decart hook candidates were left alone because they sit on a product boundary.
  - Completed by #132 by removing `src/hooks/useAgentStatus.ts`, `src/hooks/useDebounce.ts`, and `src/lib/agent-skills.ts`.
  - Validation: direct `rg` symbol/path searches, `git diff --check`, `npm run fallow:changed`, full Fallow dead-code summary, `npm run lint`, `npm run build`, and GitHub Local-First CI.
  - Caveat: keep using product-intent review for remaining voice/avatar/UI component islands. Do not bulk-delete every Fallow unused file just because it is unreferenced by static import search.

- Legacy dashboard widget dead-file island
  - Source signal: Fallow reported several standalone dashboard/activity widgets as unused; direct searches showed no live path imports. The only same-name `ActivityFeed` live hits were a local component inside the overseer page, not imports of `src/components/ActivityFeed.tsx`.
  - Completed by #134 by removing `ActivityFeed`, `ActivityHeatmap`, `NarrativeFeed`, `StatsCard`, `InlineTooltip`, `RichDescription`, `WeatherWidget`, and `WeeklyCalendar`.
  - Validation: direct `rg` path-import searches, `git diff --check`, `npm run fallow:changed`, full Fallow dead-code summary, `npm run lint`, `npm run build`, and GitHub Local-First CI.
  - Caveat: this intentionally stayed inside the legacy widget island. `QuickActionBar`, office canvas files, voice/avatar hooks, markdown/file-tree components, and UI barrels still need separate product-intent or architecture review before removal.

- Parallel standalone UI dead-file worker batch
  - Source signal: after the widget-island prune, Fallow still reported small standalone UI files with no direct path imports. The slices were disjoint enough for two explicit worktree workers.
  - Completed by #136 and #137. #136 removed `SkillCard`, `SkillDetailModal`, `AgentOrgChart`, and marketing `ArchitectureDiagram`; #137 removed `FileTree`, `MarkdownEditor`, and `MarkdownPreview`.
  - Validation: worker-owned direct `rg` path-import and symbol searches, `git diff --check`, `npm run fallow:changed`, full Fallow dead-code summaries, `npm run lint`, `npm run build`, and GitHub Local-First CI for both PRs.
  - Caveat: broad substring searches still produce unrelated names such as API `getFileTree`; use exact path-import checks before deleting UI files. Remaining unused files are increasingly product-intent or architecture-boundary decisions.

- Standalone shell UI dead-file prune
  - Source signal: after the worker batch, `QuickActionBar` and `ProjectShellNav` remained as standalone unused UI components with no exact path imports.
  - Completed by #139 by removing `src/components/QuickActionBar.tsx` and `src/components/orchestration/ProjectShellNav.tsx`.
  - Validation: direct `rg` path-import and symbol searches, `git diff --check`, `npm run fallow:changed`, full Fallow dead-code summary, `npm run lint`, `npm run build`, and GitHub Local-First CI.
  - Caveat: `public/sw.js` also appears in Fallow's unused-file list, but it is registered by `ServiceWorkerRegistration` via `/sw.js`; do not delete it as dead code.

- Sweeper single-file test helper cleanup
  - Source signal: Fallow still reported repeated runner and fixture setup inside `orchestration-sweeper.test.ts`.
  - Completed by #141 by reusing `createTestRunner` and adding a local `makeCeo` fixture helper.
  - Validation: focused sweeper contract test with isolated `ORCHESTRATION_DB_PATH`, `git diff --check`, `npm run fallow:changed`, full Fallow duplication summary, `npm run lint`, and GitHub Local-First CI.
  - Caveat: `fallow:changed` still reports remaining duplication warnings in the large sweeper test. That is acceptable for now; further extraction should only happen around a clearer repeated scenario helper.

- Wakeup coalesce single-file test helper cleanup
  - Source signal: Fallow still reported repeated wake status/coalesce SQL query and assertion bodies inside `orchestration-wakeup-coalesce.test.ts`.
  - Completed by #143 by reusing `createTestRunner` and adding local wake-row query/assertion helpers.
  - Validation: focused wakeup coalesce contract test with isolated `ORCHESTRATION_DB_PATH`, `git diff --check`, `npm run fallow:changed`, full Fallow duplication summary, `npm run lint`, and GitHub Local-First CI.
  - Caveat: the changed-file audit still reports one inherited repeated runner/setup clone across neighboring orchestration tests. Leave that for a separate narrow cluster rather than broadening single-file cleanup opportunistically.

## Defer Or Plan Separately

These are real findings, but they should not be folded into the current low-risk hygiene stream.

- Remaining runner script helper extraction
  - Fallow still reports clone families across the provider runner scripts after the utility and prompt helper extractions.
  - Risk is higher because the remaining duplication is closer to command execution, subprocess handling, dry-run handling, and result serialization. Do this only as a dedicated runner PR with every runner test and at least one manual command-path review.

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
  - Fallow reports 11 unused files, many in UI and avatar/office/component areas.
  - Some may be planned, dynamic, or story/demo assets. Prune only after direct import searches and product intent review.

## Size And Cadence

The full Fallow warning pool is not a one-morning cleanup. Cleaning every reported dead-code, duplicate, complexity, and circular-dependency finding safely would likely be a multi-day to multi-week effort because many findings are high-blast-radius architecture work.

The low-risk hygiene queue above is more bounded. A reasonable cadence is:

- 2-4 small hygiene PRs per focused work block when using explicit worktrees and subagents.
- Stop after each batch to merge, clean worktrees, update this roadmap, and choose the next target.
- Re-run a full advisory Fallow baseline after every 5-8 hygiene PRs or after any major architecture change.
- Keep `fallow:changed` as a PR-level audit, not a full blocking gate.

After PR #143, the surfaced reliability issues from the recent hygiene batches are resolved and the low-risk Fallow queue is producing smaller returns. The two runner-script helper passes had better payoff than tiny test-fixture cleanup, and the Habbo/Zelda/Stardew/demo-mode/UI-helper/voice-display/icon-helper/realtime-onboarding/cron/hook-helper/widget-island/standalone-UI/shell-UI prunes confirmed that direct-search-proven dead code can still produce useful movement when targets are coherent. The remaining unused-file pool is no longer a good blind deletion queue: it includes a runtime-registered service worker, task detail, company creation, office canvas/branding, voice/avatar, and UI-barrel files. The next best target should be selected by expected gain and risk: either run CodeGraph-backed review before touching any task/company/voice/avatar/office candidate, or keep doing focused single-file/small-cluster test-helper cleanup with a clear validation path. Provider execution adapter helper extraction remains higher-impact but higher-risk; do it only as a dedicated PR with CodeGraph impact checks and the full adapter test matrix.
