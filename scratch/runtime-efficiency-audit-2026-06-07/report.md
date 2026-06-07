# HiveRunner Runtime Efficiency Audit - Goal INS-G006

Audit timestamp: 2026-06-07
Lane: stable executor, http://127.0.0.1:3001
Database: data/orchestration.db
Goal: INS-G006, Run Intelligence Implementation

## Scope

Included the Goal INS-G006 sprint row, direct goal tasks, and child sprints:

- INS-S016: Sprint 1 - Run Trace v1
- INS-S017: Sprint 2 - Review-Backed Evals v1
- INS-S018: Sprint 3 - Starter Sprint Templates and Team
- INS-S019: Sprint 4 - Improve v1 and Improvement Review
- INS-S020: Sprint 5 - HiveRunner MCP Server
- INS-S021: Sprint 6 - Improvement Experiments v1 and Comparison Reports

The previous report appears to have used a slightly earlier subset ending around INS-S020. The comparable INS-S016..INS-S020 slice in the current DB is 64 tasks and 228 runs. The full current goal hierarchy is 75 tasks and 257 runs.

## Headline Findings

- 75 tasks audited, all currently `done`.
- 257 execution runs.
- 167 completed runs.
- 90 non-completed runs, or 35.0 percent of all runs.
- 26 of 75 tasks had at least one non-completed run, or 34.7 percent of tasks.
- 67 of 75 tasks had multiple execution runs, or 89.3 percent of tasks.
- Average runs per task: 3.43.
- Recorded execution time: 22.99 hours.
- Run span: 2026-06-06T21:09:37.484Z to 2026-06-07T19:03:18.319Z.
- Recorded usage: 380,420,069 input tokens, 2,374,009 output tokens, 382,658,269 total tokens.
- Cache-read input tokens: 360,043,392.
- Median task: 2 runs, 11.6 recorded minutes, 3,477,307 input tokens.
- P95 task: 7 runs, 67.0 recorded minutes, 14,801,618 input tokens.

## Sprint Breakdown

| Scope | Tasks | Runs | Non-completed | Recorded hours | Input tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| GOAL | 7 | 41 | 33 | 0.72 | 2,629,003 |
| INS-S016 | 12 | 29 | 0 | 2.44 | 56,755,565 |
| INS-S017 | 10 | 35 | 6 | 1.82 | 92,400,199 |
| INS-S018 | 13 | 41 | 11 | 5.56 | 59,952,491 |
| INS-S019 | 12 | 59 | 22 | 7.82 | 121,466,918 |
| INS-S020 | 10 | 23 | 8 | 1.73 | 23,242,578 |
| INS-S021 | 11 | 29 | 10 | 2.89 | 23,973,315 |

INS-S019 is the worst combined runtime and token slice. INS-S017 is unusually token-heavy despite lower recorded hours. The direct goal planning lane has the highest failure concentration because INS-205 repeatedly failed before useful execution.

## Failure Classes

Top non-completed run classes:

- 31 runs: `runtime_error`, `env: node: No such file or directory`, all on INS-205.
- 15 runs: cancelled with `External runner command terminated by signal SIGTERM`, across 11 tasks.
- 8 runs: `external_signal`, `Timed out: run exceeded 10 minute limit`, across 5 tasks.
- 7 runs: `silent_timeout`, no stdout/stderr for 600000ms, across 5 tasks.
- 6 runs: Gemini command exited with code 1, across 2 tasks.
- 4 runs: run not started within 10 minutes, across 4 tasks.
- 1 run: stale recorded process was no longer alive.

The INS-205 environment failure repeated 31 times between 2026-06-06T21:09:37.484Z and 2026-06-06T21:29:58.353Z. This is pure harness churn and should have stopped after the first identical preflight failure.

## Slowest / Noisiest Tasks

By board lifecycle proxy (`updated_at - created_at`):

- INS-256, Capture Improve browser proof and promotion package: 6.16h board lifecycle, 13 runs, 10 non-completed.
- INS-255, Verify Improve v1 automated gates: 4.62h board lifecycle, 9 runs, 5 non-completed.
- INS-243, Capture Slice 3 browser proof and promotion package: 3.55h board lifecycle, 4 runs, 0 non-completed.
- INS-250, Build Improve queue UI and navigation: 1.65h board lifecycle, 7 runs, 5 non-completed.

By recorded process time:

- INS-256: 1.31h recorded process time, 13 runs.
- INS-250: 1.17h recorded process time, 7 runs.
- INS-236: 1.15h recorded process time, 7 runs.
- INS-243: 1.12h recorded process time, 4 runs.
- INS-253: 1.00h recorded process time, 5 runs.

Note: 66 of 75 done tasks are missing `completed_at`, so board lifecycle should be treated as a rough product-flow clock. Runtime optimization should primarily use `execution_runs.duration_ms`, run span, retries, and token usage.

## Top Token Consumers

- INS-229, Prepare Evals promotion package: 28,473,307 input tokens, 7 runs, 3 non-completed.
- INS-253, Implement trigger controls and suppression: 23,001,055 input tokens, 5 runs, 1 non-completed.
- INS-254, Record Improve Activity and audit provenance: 16,390,091 input tokens, 4 runs, 0 non-completed.
- INS-255, Verify Improve v1 automated gates: 14,801,618 input tokens, 9 runs, 5 non-completed.
- INS-256, Capture Improve browser proof and promotion package: 13,894,123 input tokens, 13 runs, 10 non-completed.

This confirms that the waste is not only retry churn. Completed Codex-backed runs routinely consumed multi-million-token input loads. The context payload needs a budget and compaction strategy.

## Runtime Provider Mix

- Symphony/Codex/gpt-5.5 completed: 122 runs, 12.00h, 355,958,713 input tokens.
- Symphony/Codex/gpt-5.5 cancelled: 19 runs, 2.26h, 23,837,370 input tokens.
- Symphony/Codex/gpt-5.5 failed: 36 runs, 2.60h, 0 recorded input tokens.
- Symphony/Anthropic/claude-opus-4-8 completed: 36 runs, 1.99h, 623,940 input tokens.

The Codex lane carried almost all recorded token load. Anthropic runs were much smaller in this dataset.

## Structured Action Ingestion

Current evidence:

- 257 execution runs.
- 248 runs had a linked heartbeat id.
- 719 actions were found in linked heartbeat result JSON.
- 716 actions were executed.
- 81 runs had action/result errors, mostly failed runs and benign idempotency/status errors.

This does not prove widespread silent action drops in INS-G006. It does prove the current system is free-text action-channel dependent:

- `mc-action` blocks are parsed from assistant text by regex in `src/lib/orchestration/engine/action-dispatcher.ts`.
- Live UI detection separately uses a similar regex in `src/hooks/useLiveRunStream.ts`.
- There is no durable pending-action table in the current schema.
- `execution_run_transcript_events` stores final assistant text and provider events, not a replayable action ledger.

The right fix is still to introduce durable pending/parsed action records with replay and validation status.

## Current Health

`GET http://127.0.0.1:3001/api/health` returned healthy during this audit:

- HiveRunner process up.
- Orchestration DB up.
- Schema v119 readable.

The earlier compatibility checksum warning was not reproduced from the current health endpoint. `schema_migrations` has only `version`, `name`, `checksum`, and `applied_at`; no warning/status column exists in that table.

## Recommendation

I agree with the prior assessment. This should be treated as a runtime-platform blocker, not a cosmetic performance task.

The highest-leverage refactor is:

1. Preflight gate and circuit breaker before queue execution.
2. Durable run-attempt model with explicit retry/resume semantics.
3. Token/context budget ledger visible at task, sprint, and goal levels.
4. Context reduction and source/reference injection caps.
5. Structured action ledger with parse/validation/replay states.
6. Deterministic timeout/cancellation state machine.
7. Replay benchmark against an INS-G006-class 10-task sprint.

Acceptance target for replay:

- Less than 1.5 runs per task.
- Less than 10 percent non-completed runs.
- At least 50 percent lower recorded input tokens versus this baseline.
- Zero repeated identical environment failures.
- Zero silent action drops; every parsed action has a durable terminal ingestion state.
