# Runtime Benchmark Baseline - INS-G006

## Scope

- Fixture: ins-g006-runtime-replay-v2 (10-task expected)
- Arm/repeat: baseline / 1 of 3
- Frozen task keys: INS-205, INS-208, INS-221, INS-232, INS-250, INS-256, INS-262, INS-274, INS-277, INS-278
- Sprints: 7
- Tasks: 10
- Company IDs: cd9607f7-24bd-4596-9bcb-b3c013a75b7b
- Run window: 2026-06-06T21:09:37.484Z to 2026-06-07T18:57:13.014Z
- Overseer scope: company_all_turns (goal-level turn linkage is not durable yet)

## Execution Runs

- Total runs: 80
- Completed runs: 24
- Non-completed runs: 56 (70.0%)
- Tasks with breakdowns: 7 (70.0%)
- Tasks with multiple runs: 10 (100.0%)
- Average runs per task: 8.00
- Recorded process time: 5.05h

## Failure Buckets

- Deterministic preflight failures: 33
- Intentional/governance cancellations: 2
- Runtime-quality failures: 21 (26.3%)

## Usage

| Source | Input | Cache read | Fresh input | Output | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| execution_runs | 59,999,150 | 56,735,488 | 3,263,662 | 340,689 | 60,339,839 |
| overseer_turns (35) | 97,660,605 | 90,016,768 | 7,643,837 | 574,972 | 98,235,577 |
| combined | 157,659,755 | 146,752,256 | 10,907,499 | 915,661 | 158,575,416 |

## Action Ledger

- Total action rows: 0
- Terminal action rows: 0
- Non-terminal parsed actions: 0
- Parse failed actions: 0
- Pending approvals: 0
- Untracked actions: 0

## Browser Proof

- Total proof runs: 0
- Succeeded: 0
- Failed: 0
- Succeeded under 30s: 0
- Max duration: 0ms

## Latency

- First evidence samples: 76
- First evidence p50/p95: 19799ms / 1465761ms
- Detect unhealthy samples: 21
- Detect unhealthy p50/p95: 125796ms / 1800295ms

## Repeated Failures

- INS-205: 31x failed | runtime_error | External runner command exited with code 127: env: node: No such file or directory
- INS-250: 3x failed | none | Gemini command exited with code 1
- INS-256: 3x cancelled | cancelled | External runner command terminated by signal SIGTERM
- INS-256: 3x failed | none | Gemini command exited with code 1
- INS-205: 2x failed | runtime_error | External runner command exited with code 1: olve:861:10) at defaultResolve (node:internal/modules/esm/resolve:985:11) at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20) at ModuleLoader.resolve (node:inter
- INS-250: 2x failed | silent_timeout | External runner command produced no stdout/stderr for 600000ms
- INS-256: 2x failed | silent_timeout | External runner command produced no stdout/stderr for 600000ms
