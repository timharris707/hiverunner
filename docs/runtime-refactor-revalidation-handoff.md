# Runtime Platform Refactor — Re-Validation & Clean Re-Promote (INS-G006)

> Status: handoff for a fresh session (Claude Ultra or operator-driven)
> Created: 2026-06-08, after independent QA of the "goal complete" promotion claim
> This goal does **not** re-implement the runtime refactor. The implementation is largely done and is
> already deployed to stable (3001). This goal **re-validates it honestly and re-promotes it cleanly**,
> because the promotion gate passed against a confounded baseline and the new safety features were never
> exercised or asserted.

---

## ⚠️ 0. WHERE THE WORKSPACE IS — read this first

**The workspace is:**

```
/Users/timharris/.mission-control/app
```

- Git remote `origin`: `https://github.com/timharris707/hiverunner.git`
- Working branch: `codex/overseer-floating-surface-polish` (HEAD `58e6e19a80316f98019b6af385a34177e5291a0e` at handoff time)
- Benchmark artifacts live **outside** the repo at: `/Users/timharris/.mission-control/runtime-benchmarks/ins-g006/`
- Ground-truth DB: `/Users/timharris/.mission-control/app/data/orchestration.db`

**Do NOT work in `/Users/timharris/workspace/hiverunner`.** That is a different, orphaned checkout with a
disjoint history and a different board DB — even `INS-G006` means something else there. Anything you read
there will mislead you.

**Sanity check before you touch anything** (all four must pass):

```sh
cd /Users/timharris/.mission-control/app
git rev-parse --show-toplevel        # => /Users/timharris/.mission-control/app
git remote get-url origin            # => https://github.com/timharris707/hiverunner.git
git branch --show-current            # => codex/overseer-floating-surface-polish (or your working branch off it)
test -f docs/runtime-platform-refactor-goal.md && echo WORKSPACE_OK
```

Lanes (see `docs/two-lane-runtime.md`): **3010** = observer (engine tick FORCED off — cannot run benchmarks),
**3001** = stable / execution owner (`.stable/`, `data/`), **exec-dev** = isolated benchmark lane
(default port **3020** via `lane.sh exec-dev`, or **3011** via `PORT`/`MC_DATA_DIR` override as used so far).

---

## 1. Why this goal exists (the QA finding)

The previous session marked the runtime refactor complete and promoted it, citing
`runtime-benchmarks/ins-g006/runtime-promotion-gate-strict-historical-segments.md` (PASS) with headline
numbers: ~67% fewer input tokens, 0.90 runs/task, 0.0% runtime failures, first-evidence p50 75 ms.

Independent verification against the real artifacts found four problems:

1. **The cited baseline is the historical INS-G006 run, not a control.** Its baseline arm's run window is
   `2026-06-06 → 06-07` (the original messy run, including INS-205's 31× `env: node` churn), sliced into
   three "segments" to satisfy the gate's "≥3 repeats" check. The plan required the **old build run on the
   same frozen fixture** — that is the only valid A/B.

2. **A true old-build control DOES exist — and it tells a very different story.** The team actually ran the
   pre-refactor build (commit `97d6b0caf`, "old97") on the frozen fixture (`final-baseline-r4-old97-repeat-1/`).
   On the gate's own metric (fresh input ÷ completed runs):

   | Metric (fresh ÷ completed run) | Historical baseline *(cited)* | **Old build on fixture *(true control)*** | Candidate (new build) |
   | --- | ---: | ---: | ---: |
   | Fresh input | 158,924 | **41,369** | 51,885 (median) |
   | Avg runs/task | 4.5–8.0 | **1.4** | 0.90 |
   | Non-completed | 56–70% | **~7% (1/14)** | 0% |

   Against the proper control the candidate is **~25% *higher* fresh tokens per completed run** (≈13% lower
   per *task* only because it needs fewer runs/task). Either way it is **nowhere near the ≥50% reduction
   target** — that target only "passes" against the inflated historical baseline. The genuine, honest wins
   are **runs/task 1.4 → 0.9 (~31% fewer)** and **non-completed ~7% → 0%**. Those are real but modest.

3. **The marquee new features were never exercised AND are not gated.** In the candidate run:
   `runtime_preflight_results` = 0 (circuit breaker never fired), detect-unhealthy samples = 0 (the 90s
   suspicion path produced nothing), in-window `overseer_turns` = 0 (Overseer watch mode not run), and the
   `fallback_used` rows present are fixture carry-over, not produced by the run. Worse, the gate
   (`src/lib/orchestration/runtime-benchmark.ts`) has **no positive check** for any of these, and it
   **skips** the detect-unhealthy p50/p95 checks entirely when `failureBuckets.runtimeQuality === 0`. So the
   gate structurally cannot prove the safety/observability features that justified the refactor.

4. **The stable promote was "dirty" — but only from untracked artifacts.** `.stable/.promotion-metadata.json`
   has `repo_dirty="1"`. The deployed *code* equals HEAD's tracked files (it used `--tracked-build`, a
   `git archive` of HEAD), so this is **not a code-integrity problem** — the dirt is purely untracked
   benchmark/scratch files (notably the 232 MB `data-exec-dev-3011/`, which `.gitignore` misses). It should
   be cleaned up and re-promoted so provenance is exact.

**Bottom line:** the foundational fixes are real and shippable, but the proof overstates the win ~5× on
tokens and never demonstrates the safety features. This goal produces honest proof and a clean promote.

---

## 2. The `/goal` (paste this into the new session)

```
/goal Runtime Refactor Re-Validation And Clean Re-Promote (INS-G006)

Workspace: /Users/timharris/.mission-control/app (origin timharris707/hiverunner, branch
codex/overseer-floating-surface-polish). NOT ~/workspace/hiverunner. Confirm with the sanity check in
docs/runtime-refactor-revalidation-handoff.md before any edit.

The runtime platform refactor is implemented and deployed to stable (3001), but its promotion gate passed
against a confounded HISTORICAL baseline, the new safety/observability features were never exercised, the
gate has no checks for them, and the stable promote was dirty from untracked artifacts. Re-validate honestly
and re-promote cleanly. Do not re-architect; reuse the existing harness
(scripts/runtime-benchmark*.ts, scripts/runtime-promotion-gate.ts, scripts/prepare-exec-dev-benchmark.ts,
scripts/lane.sh).

Execution: run this through Codex coordination, sub-agents allowed on any runtime; do NOT use HiveRunner
orchestration to manage it. Benchmark only on an isolated exec-dev lane (3011/3020, MC_ENGINE_TICK=on,
isolated MC_DATA_DIR seeded from a copy). Never benchmark on 3010 (observer) or 3001 (stable). Read the full
plan, exact commands, and artifact inventory in docs/runtime-refactor-revalidation-handoff.md.

Sprints:
A. Commit hygiene + clean re-promote (provenance).
B. True old-build-vs-new control benchmark on the frozen fixture (3 repeats per arm).
C. Inject and GATE the four safety signals (preflight circuit-break, 90s detect-unhealthy, Overseer LLM
   watch turn, provider fallback).
D. Honest gate report + decision on the token target; clean promote or revise the target.

Definition of done: a promotion-gate report whose BASELINE arm is the old build on the SAME frozen fixture
(>=3 repeats), with the four safety signals positively asserted, honest fresh-input/per-task and runs/task
deltas, no dirty promote, and 3001 mapped to a real commit.
```

---

## 3. The plan

### Sprint A — Commit hygiene + clean re-promote (do first; small)

**Why:** the promote was dirty from untracked artifacts and `.gitignore` misses the 232 MB exec-dev lane dir.

**Do:**
1. Append to `/Users/timharris/.mission-control/app/.gitignore` (the existing rule `/data-exec-dev/` does
   NOT match `data-exec-dev-3011/`; `/output/` is already ignored):
   ```gitignore
   # benchmark / exec lane data and ephemera (do not commit)
   /data-exec-dev-3011/
   data-exec-dev-*/
   /mc-action.json
   scratch/**/*.png
   scratch/**/*.csv
   scratch/**/*.log
   ```
2. Confirm `git status --short` now shows only intended files. The tracked tree is already clean
   (`git diff HEAD` and `git diff --cached` are empty); the docs in `scratch/runtime-platform-refactor-promotion/`
   and `scratch/runtime-efficiency-audit-2026-06-07/*.md` are already committed. Commit this handoff doc and
   the `.gitignore` change. **Do not** commit `.codegraph/`, `.fallow/`, the corrupted CSVs, or lane data
   (CLAUDE.md / AGENTS.md High-Blast-Radius Playbook). Omit Claude attribution from the commit per repo
   convention.
3. Clean re-promote so 3001 maps to a real commit (previous checkpoint `f2cb347bf` exists, so rollback is
   available):
   ```sh
   cd /Users/timharris/.mission-control/app
   scripts/lane.sh promote          # commit-backed; refuses dirty — should NOT need --allow-dirty now
   ```

**Acceptance:** `git status` clean of artifacts; a new promote with `repo_dirty="0"` in
`.stable/.promotion-metadata.json`; `scripts/lane.sh stable status` healthy; `scripts/lane.sh rollback --dry-run` resolves.

### Sprint B — True control benchmark (old build vs new, same fixture)

**Why:** the cited baseline is historical. Replace it with the old build run on the frozen fixture.

Executor model: the replay is driven **in-process** by `scripts/runtime-benchmark-repeat.ts`
(`engine.tick(db)` against the isolated fixture DB until the 10 frozen tasks are terminal). The **old build**
is selected by launching from the old worktree's cwd (tsconfig `@/*` → `./src` resolves relative to cwd).
The exec-dev lane (3011/3020) is for UI-truth/browser-proof and observation.

**Do:**
1. Seed an isolated fixture copy (does NOT touch stable; refuses targets under `data/` or `data-dev/`):
   ```sh
   cd /Users/timharris/.mission-control/app
   npm run runtime:prepare-exec-dev -- \
     --source-db /Users/timharris/.mission-control/app/data/orchestration.db \
     --target-db /Users/timharris/.mission-control/app/data-exec-dev-3011/orchestration.db \
     --goal INS-G006 --fixture-id ins-g006-runtime-replay-v2 \
     --expected-tasks 10 --required-repeats 3 --reset-selected-tasks-to to-do \
     --task-keys INS-205,INS-208,INS-221,INS-232,INS-250,INS-256,INS-262,INS-274,INS-277,INS-278
   ```
   For the **old-build** arm, reproduce the prep exactly as r4 did — see
   `runtime-benchmarks/ins-g006/final-baseline-r4-old97-repeat-1/data/benchmark-manifest.json`, which also
   passed `--source-workspace-root <old worktree>`, `--company-workspace-root <…>`, and
   `--sanitize-runner-routes` (it dropped 4 fallbacks, preferred codex). Each repeat needs its own frozen DB copy.
2. (Optional, for UI-truth checks) start the isolated lane with the engine tick on:
   ```sh
   cd /Users/timharris/.mission-control/app
   PORT=3011 MC_DATA_DIR="$PWD/data-exec-dev-3011" \
     MC_WORKSPACE_ROOT="$HOME/.hiverunner/exec-dev/workspaces" \
     scripts/lane.sh exec-dev start && scripts/lane.sh exec-dev status
   # (Bare `scripts/lane.sh exec-dev start` uses PORT 3020 + data-exec-dev/.)
   ```
3. Run 3 NEW-build repeats and 3 OLD-build repeats. Per repeat, run the executor, capture its
   `startedAt`/`completedAt` window, then build the arm summary from that window:
   ```sh
   # executor (new build: run from /Users/timharris/.mission-control/app ;
   #           old build: cd into …/final-baseline-rN-old97/source-worktree first)
   node ./scripts/run-tsx.mjs scripts/runtime-benchmark-repeat.ts \
     --db <frozen fixture DB for this repeat> --goal INS-G006 \
     --task-keys INS-205,INS-208,INS-221,INS-232,INS-250,INS-256,INS-262,INS-274,INS-277,INS-278 \
     --max-minutes 30 --allowed-runner-providers codex,anthropic \
     --out <repeat-dir>/repeat-window.json

   # summary (note: --arm/--repeat REQUIRE --run-started-after/--run-started-before)
   node ./scripts/run-tsx.mjs scripts/runtime-benchmark.ts \
     --db <same frozen DB> --goal INS-G006 --format json \
     --fixture-id ins-g006-runtime-replay-v2 --arm <baseline|candidate> --repeat <N> \
     --required-repeats 3 --expected-tasks 10 \
     --task-keys INS-205,INS-208,INS-221,INS-232,INS-250,INS-256,INS-262,INS-274,INS-277,INS-278 \
     --run-started-after <window.startedAt> --run-started-before <window.completedAt> \
     --out <repeat-dir>/<baseline|candidate>-repeat-<N>.json
   ```
   You can reuse the 3 existing new-build candidate summaries (`final-r18/r19/r20-candidate-1305e42cd/`) if
   the build is unchanged. The old-build arm currently has only **1** completed repeat (r4); produce 2 more.

**Acceptance:** 3 candidate + 3 old-build summaries, all `fixtureId=ins-g006-runtime-replay-v2`, all 10
frozen task keys, all final tasks done; baseline arm built from the **old worktree**, not historical windows.

### Sprint C — Inject and GATE the four safety signals

**Why:** today these are unexercised and the gate has no check for them (so "it works" is unproven). All four
must produce a recorded, asserted signal. Injection surfaces (verified in source):

- **Deterministic preflight circuit-break** → `src/lib/orchestration/runtime-preflight.ts`
  (`detectPreflightFailure` → `openCircuitRow` writes one `runtime_preflight_results` row,
  `classification='deterministic_preflight'`). Drive it via a fixture task whose
  `metadata.hiverunnerBenchmarkReplay.requiredLaneReadinessChecks` / runner fingerprint fails
  (e.g. `missing_runner_script`, `missing_node_binary`). Assert: exactly **one** circuit-open row for that
  fingerprint and **no churn** (no repeated identical failures).
- **90s detect-unhealthy** → `src/lib/orchestration/live-run-liveness.ts` (`DEFAULT_SUSPICIOUS_MS=90000`,
  derived label only). A gate-visible **sample** needs an `execution_run_attempt_events` row of type
  `watchdog_timeout`/`failed` (NOT `stale_process_missing`). Inject a silent/stuck run; you will likely need
  to lower the no-output timeout for the fixture (`no_output_timeout` default is 600000 ms) so the case
  finishes inside the benchmark. Assert: ≥1 detect-unhealthy sample with p50 within target.
- **Overseer LLM watch turn** → `src/lib/orchestration/overseer/service.ts`. NOTE: `runOverseerWatchCheck`
  writes NO `overseer_turns` row and spends no tokens — a gate-visible turn must be a real LLM turn
  (`createOverseerTurn` + `completeOverseerTurn`). Assert: ≥1 in-window `overseer_turns` row **under a token
  ceiling** (this is the "low-token watch mode" claim made measurable).
- **Provider fallback** → `src/lib/orchestration/execution-route-resolver.ts` (`fallback_used` /
  `fallback_index` / `fallback_from_provider`). Must stay within the allowlist: the repeat runner ABORTS
  (exit 2) on any provider outside `--allowed-runner-providers` — so inject **codex → anthropic**, not
  gemini/openclaw. Assert: ≥1 `fallback_used` row produced by the run.

Then **add positive gate checks** to `src/lib/orchestration/runtime-benchmark.ts`
(`evaluateRuntimeBenchmarkPromotionGate` / `buildRuntimeBenchmarkPromotionReport`): require ≥1 circuit-open
row, ≥1 detect-unhealthy sample (stop skipping when `runtimeQuality===0`), ≥1 in-window Overseer turn under
the ceiling, and ≥1 `fallback_used` row — and surface them in the `--evidence` proof.

**Acceptance:** the gate FAILS if any of the four signals is absent, and PASSES on a run where each fired
exactly as designed (one circuit-open, one unhealthy detection, one bounded Overseer turn, one fallback).

### Sprint D — Honest gate report + token-target decision; clean promote

**Do:**
1. Run the gate with the **old-build** baseline (drop-in: baseline selection is just which `--baseline-summary`
   files you pass):
   ```sh
   cd /Users/timharris/.mission-control/app
   node ./scripts/run-tsx.mjs scripts/runtime-promotion-gate.ts \
     --candidate-summary /Users/timharris/.mission-control/runtime-benchmarks/ins-g006/final-r18-candidate-1305e42cd/candidate-repeat-1-with-proof.json \
     --candidate-summary /Users/timharris/.mission-control/runtime-benchmarks/ins-g006/final-r19-candidate-1305e42cd/candidate-repeat-2-with-proof.json \
     --candidate-summary /Users/timharris/.mission-control/runtime-benchmarks/ins-g006/final-r20-candidate-1305e42cd/candidate-repeat-3-with-proof.json \
     --baseline-summary <old97 baseline-repeat-1.json> \
     --baseline-summary <old97 baseline-repeat-2.json> \
     --baseline-summary <old97 baseline-repeat-3.json> \
     --evidence /Users/timharris/.mission-control/runtime-benchmarks/ins-g006/promotion-evidence.json \
     --goal INS-G006 --required-repeats 3 --expected-tasks 10 \
     --format markdown --out /Users/timharris/.mission-control/runtime-benchmarks/ins-g006/runtime-promotion-gate-OLDBUILD-control.md
   ```
2. **Expect the ≥50% fresh-input check to FAIL** against the proper control (the metric is fresh ÷ completed
   runs vs baseline median; old=41,369, candidate≈51,885). Make a real decision:
   - either push the context-reduction work (Sprint 4 of the original goal) until fresh-input/task genuinely
     drops, OR
   - revise the acceptance to the honest achievable target (runs/task ~31% fewer, non-completed → 0,
     fresh-input roughly break-even per run / ~13% better per task), and state it explicitly in
     `docs/runtime-platform-refactor-goal.md`.
   Do not keep a 50% claim the controlled data does not support.
3. Only after the controlled gate passes (with the four safety checks and an honest token line), re-promote
   per Sprint A.

**Acceptance:** `runtime-promotion-gate-OLDBUILD-control.md` is the cited evidence; its baseline is the old
build on the fixture; the four safety checks are present and green; the token line is honest; promote is clean.

---

## 4. Relevant docs & artifacts (exact paths)

### Plan / spec docs (in `/Users/timharris/.mission-control/app/docs/`)
- `runtime-platform-refactor-goal.md` — the implementation goal/spec (the thing built against).
- `runtime-refactor-operational-brief.md` — operational pain framing (INS-205..279).
- `runtime-platform-refactor-promotion-readiness.md` — promotion package; "implementation committed, stable
  promotion blocked pending controlled replay"; lists impl commits `823cb620c`, `d8ab778ea`.
- `two-lane-runtime.md` — lane contract (3010 observer / 3001 stable / exec-dev). Promote+rollback flow.
- `runtime-dependencies.md`, `runtime-isolation.md` — runtime dep + isolation contracts (Node 22 pin).
- `runtime-refactor-revalidation-handoff.md` — **this document.**

### Repo guidance (root of the workspace)
- `CLAUDE.md`, `AGENTS.md` — High-Blast-Radius Playbook (CodeGraph, `npm run fallow:changed`, never commit
  `.codegraph/`/`.fallow/`); read `.agents/skills/hiverunner-orchestration-overseer/SKILL.md` first.
- `CONTEXT.md` — product language canon (Run Intelligence, Run Trace, etc.).

### Audit (ground truth = DB, NOT the CSVs)
- `data/orchestration.db` — **ground-truth** SQLite (~232 MB). Use read-only sqlite for any number.
- `scratch/runtime-efficiency-audit-2026-06-07/report.md`, `refactor-plan.md` — audit narrative (tracked).
- `scratch/runtime-efficiency-audit-2026-06-07/*.csv` — **SANITIZER-CORRUPTED** (the token `node` → `n`,
  e.g. `env: n:`). Do not trust; cross-check the DB. (Untracked; will be gitignored in Sprint A.)

### Fixture / promotion scratch (`/Users/timharris/.mission-control/app/scratch/runtime-platform-refactor-promotion/`)
- `fixture-manifest-v2.json` — frozen fixture (`ins-g006-runtime-replay-v2`, 10 keys: INS-205, 208, 221,
  232, 250, 256, 262, 274, 277, 278). source `data/orchestration.db` → target `data-exec-dev-3011/orchestration.db`.
- `baseline-selected-10-summary.{json,md}`, `current-ins-g006-summary.{json,md}` — selected baseline + current snapshots.
- `output/runtime-benchmark/current-candidate-snapshot.json` — latest single candidate snapshot.

### Benchmark artifacts (`/Users/timharris/.mission-control/runtime-benchmarks/ins-g006/`)
- `runtime-promotion-gate-strict-historical-segments.{md,json}` — **HISTORICAL baseline (CONFOUNDED). The
  previously-cited "PASS." Do NOT cite as the clean before/after.**
- `runtime-promotion-gate-strict-three-baseline.json`, `runtime-promotion-gate-historical-baseline.json` —
  also HISTORICAL-derived baselines.
- `historical-baseline-segment-{1-full,2-early-mid,3-late}.json`, `historical-baseline-selected-10-current-schema.json`
  — slices of the one historical run, used as the (wrong) baseline summaries.
- `final-baseline-r4-old97-repeat-1/` — **OLD-BUILD-ON-FIXTURE CONTROL (the CORRECT baseline), the fullest.**
  Contains `source-worktree` (git HEAD `97d6b0caf`), frozen `data/orchestration.db`, `data/benchmark-manifest.json`
  (the exact prep flags to reproduce), `baseline-repeat-1.json` (the one completed control summary:
  completed=13, fresh/completed=41,369, runs/task=1.4, non-completed=1), `repeat-check-old-source.json`,
  `repeat-check-current-source.json`.
- `final-baseline-r2-97d6b0caf/`, `final-baseline-r3-old97-repeat-1/` — old-build control attempts,
  setup/check only (no emitted summary). Need 2 more completed repeats for the 3-repeat control.
- `final-r18/r19/r20-candidate-1305e42cd/` — the 3 NEW-build candidate repeats (build `1305e42cd`) backing
  `promotion-evidence.json`. `candidate-repeat-{1,2,3}-with-proof.json`, fresh/completed 51,885 / 50,267 / 76,445.
- `promotion-evidence.json` — the `--evidence` proof (`hiverunner.runtime_promotion_evidence.v1`):
  uiConsistency.ok=true, untrackedActions.ok=true/count=0. Extend it with the four safety attestations in Sprint C.
- `candidate-r1..r8/`, `final-r2..r17/`, `baseline-r1/`, `baseline-isolation-probe-20260608T123345/` — earlier iterations / probes (context only).

### Harness scripts (`/Users/timharris/.mission-control/app/scripts/`)
- `lane.sh` — lane CLI: `<dev|exec-dev|stable> <start|stop|restart|status|logs|rollback>`, plus `promote`,
  `rollback`, `doctor [--fix]`. exec-dev defaults: PORT 3020, `data-exec-dev/`, `MC_ENGINE_TICK=on`.
- `prepare-exec-dev-benchmark.ts` (npm `runtime:prepare-exec-dev`) — seeds an isolated fixture DB via
  `.backup()` (does not mutate source); refuses targets under `data/` or `data-dev/`.
- `runtime-benchmark-repeat.ts` — the in-process replay driver (`engine.tick`); `--db`, `--task-keys`,
  `--max-minutes` (def 30), `--allowed-runner-providers` (def codex,anthropic), `--allow-live-workspace`,
  `--check-only`, `--out`. Aborts (exit 2) on out-of-allowlist providers.
- `runtime-benchmark.ts` (npm `runtime:benchmark`) — builds an arm/repeat summary; `--arm`/`--repeat` REQUIRE
  `--run-started-after`/`--run-started-before`.
- `runtime-promotion-gate.ts` — the gate; `--candidate-summary` (×N), `--baseline-summary` (×N),
  `--baseline-db`, `--evidence`, `--goal`, `--required-repeats`, `--expected-tasks`, `--out`, `--format`.
- `promote_to_stable.sh` — commit-backed promote (`--allow-dirty`, `--tracked-build`, `--reconcile-live`,
  `--tag`); `stable_release_common.sh` (`repo_is_dirty` counts untracked).
- `run-tsx.mjs` — wrapper all `runtime:*` scripts call: `node ./scripts/run-tsx.mjs <script> <args>`.

### Core source touched by Sprint C
- `src/lib/orchestration/runtime-preflight.ts` — preflight + deterministic circuit (`runtime_preflight_results`).
- `src/lib/orchestration/live-run-liveness.ts` — 90s suspicion classifier (`DEFAULT_SUSPICIOUS_MS`).
- `src/lib/orchestration/engine/sweeper.ts` — stale/stuck detection + `execution_run_attempt_events`.
- `src/lib/orchestration/overseer/service.ts` — `overseer_turns` (LLM turn vs no-op watch-check).
- `src/lib/orchestration/execution-route-resolver.ts` — `fallback_used` route truth.
- `src/lib/orchestration/runtime-benchmark.ts` — summary + gate (add the four positive checks here).
- `src/lib/orchestration/execution-failure-class.ts` — failure-class buckets.

### Memory (cross-session context, `/Users/timharris/.claude/projects/-Users-timharris-workspace-hiverunner/memory/`)
- `canonical-repo-is-mission-control-app.md` — workspace is `.mission-control/app`, not workspace/hiverunner.
- `runtime-refactor-review.md` — the prior QA review of this exact work.
- `local-main-orphaned-from-origin.md`, `MEMORY.md` (index), `no-claude-attribution-in-git.md`.

---

## 5. Definition of done

1. Cited evidence = a gate report whose **baseline arm is the old build on the same frozen fixture**,
   ≥3 repeats per arm (median + p95).
2. The four safety signals (preflight circuit-break, 90s detect-unhealthy, bounded Overseer LLM turn,
   provider fallback) each fire once in a dedicated case **and** are positively asserted by the gate.
3. Token line is honest: report fresh-input **per task** and **per completed run** vs the old-build control;
   keep the ≥50% claim only if the controlled data supports it, otherwise revise the target in the goal doc.
4. Runs/task and non-completed deltas reported vs the old-build control (expected ~31% fewer runs/task,
   non-completed → 0).
5. No dirty promote: `.gitignore` updated, artifacts excluded, `repo_dirty="0"`, 3001 mapped to a real commit,
   rollback checkpoint present.

## 6. Quick-reference numbers (from current artifacts)
- Candidate (build 1305e42cd) fresh ÷ completed run: 51,885 / 50,267 / 76,445 → median 51,885; runs/task 0.90; non-completed 0%.
- Old-build control (97d6b0caf, r4, 1 repeat): fresh ÷ completed run 41,369; runs/task 1.4; non-completed 1/14 (~7%); completed runs 13.
- Historical baseline (cited, confounded): fresh ÷ completed run 158,924; runs/task 4.5–8.0; non-completed 56–70% (incl. INS-205 31× `env: node`).
- First evidence: candidate p50 75 ms / p95 122 ms (this is "telemetry now exists"; the old build emitted no harness lifecycle event, so treat as feature-exists, not an N× speedup).
- Fixture DB starts at schema v119; `getOrchestrationDb()` migrates it to v125 on open and creates the empty
  safety tables (`runtime_preflight_results` v120 … `runtime_action_ledger` v123 … v125).
