# Runtime Benchmark Baseline - INS-G006

## Scope

- Fixture: ins-g006-full-observed-2026-06-07 (75-task expected)
- Arm/repeat: baseline / 1 of 1
- Frozen task keys: INS-205, INS-206, INS-207, INS-208, INS-209, INS-210, INS-211, INS-212, INS-213, INS-214, INS-215, INS-216, INS-217, INS-218, INS-219, INS-220, INS-221, INS-222, INS-223, INS-224, INS-225, INS-226, INS-227, INS-228, INS-229, INS-230, INS-231, INS-232, INS-233, INS-234, INS-235, INS-236, INS-237, INS-238, INS-239, INS-240, INS-241, INS-242, INS-243, INS-244, INS-245, INS-246, INS-247, INS-248, INS-249, INS-250, INS-251, INS-252, INS-253, INS-254, INS-255, INS-256, INS-257, INS-258, INS-259, INS-260, INS-261, INS-262, INS-263, INS-264, INS-265, INS-266, INS-267, INS-268, INS-269, INS-270, INS-271, INS-272, INS-273, INS-274, INS-275, INS-276, INS-277, INS-278, INS-279
- Sprints: 7
- Tasks: 75
- Company IDs: cd9607f7-24bd-4596-9bcb-b3c013a75b7b
- Run window: 2026-06-06T21:09:37.484Z to 2026-06-07T19:03:18.319Z
- Overseer scope: company_all_turns (goal-level turn linkage is not durable yet)

## Execution Runs

- Total runs: 257
- Completed runs: 167
- Non-completed runs: 90 (35.0%)
- Tasks with breakdowns: 26 (34.7%)
- Tasks with multiple runs: 67 (89.3%)
- Average runs per task: 3.43
- Recorded process time: 22.99h

## Failure Buckets

- Deterministic preflight failures: 33
- Intentional/governance cancellations: 4
- Runtime-quality failures: 53 (20.6%)

## Usage

| Source | Input | Cache read | Fresh input | Output | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| execution_runs | 380,420,069 | 360,043,392 | 20,376,677 | 2,374,009 | 382,658,269 |
| overseer_turns (35) | 97,660,605 | 90,016,768 | 7,643,837 | 574,972 | 98,235,577 |
| combined | 478,080,674 | 450,060,160 | 28,020,514 | 2,948,981 | 480,893,846 |

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

- First evidence samples: 248
- First evidence p50/p95: 181689ms / 1116613ms
- Detect unhealthy samples: 53
- Detect unhealthy p50/p95: 529606ms / 1800385ms

## Repeated Failures

- INS-205: 31x failed | runtime_error | External runner command exited with code 127: env: node: No such file or directory
- INS-236: 3x failed | external_signal | Timed out: run exceeded 10 minute limit
- INS-250: 3x failed | none | Gemini command exited with code 1
- INS-256: 3x cancelled | cancelled | External runner command terminated by signal SIGTERM
- INS-256: 3x failed | none | Gemini command exited with code 1
- INS-205: 2x failed | runtime_error | External runner command exited with code 1: olve:861:10) at defaultResolve (node:internal/modules/esm/resolve:985:11) at #cachedDefaultResolve (node:internal/modules/esm/loader:747:20) at ModuleLoader.resolve (node:inter
- INS-229: 2x cancelled | cancelled | no-message
- INS-237: 2x failed | external_signal | Timed out: run exceeded 10 minute limit
- INS-250: 2x failed | silent_timeout | External runner command produced no stdout/stderr for 600000ms
- INS-255: 2x cancelled | cancelled | External runner command terminated by signal SIGTERM
- INS-256: 2x failed | silent_timeout | External runner command produced no stdout/stderr for 600000ms
- INS-275: 2x cancelled | cancelled | External runner command terminated by signal SIGTERM
