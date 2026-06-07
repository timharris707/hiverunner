# Runtime Refactor Operational Brief

Status: working brief
Created: 2026-06-07
Source evidence: Run Intelligence goal tasks `INS-205` through `INS-279`, local orchestration database run records, task comments/status updates, and the Run Intelligence product contracts.

Implementation goal: `docs/runtime-platform-refactor-goal.md`

## Bottom line

The Run Intelligence docs describe the product features we built: Run Trace, Evals, Improve, MCP, and future experiment loops. They do not fully document the operational pain we hit while using HiveRunner to build those features.

This brief captures the missing runtime-refactor notes. The central issue is transparency: runs can start and appear active while the operator cannot quickly tell whether the CLI is alive, making progress, blocked, failing at startup, producing output, or silently burning time.

## What we experienced

- We frequently had to wait several minutes before knowing whether a CLI-backed run was doing useful work.
- Cards showed active work timers, but not enough live runtime evidence: no dependable stdout tail, stderr tail, tool-call stream, phase marker, command lifecycle, or "last meaningful output" indicator.
- Silent or unhealthy runs often survived too long before intervention. Several runs were cancelled only after 5 to 12 minutes, and some failed or timed out much later.
- Watchdog messages often appeared at hour-level staleness. That is useful for cleanup, but far too late for operator confidence during active work.
- Overseer monitoring became expensive and heavy. It sometimes used very large token counts for what should have been a low-cost polling and summarization task.
- We had repeated manual uncertainty about whether the board was stuck, whether a runner was genuinely alive, whether an agent was making progress, and whether we should cancel or wait.
- Browser proof and screenshots were not reliable as a first-class agent capability until a helper path was used manually. We wasted time trying to obtain proof that should have been routine.
- Active crew/live counts and visible board state were confusing at times. The app could show agents as active even when the visible board did not make that obvious.
- Execution-engine identity was unclear. The UI showed a mixture of HiveRunner/Symphony/external-runner labels and icons, and task details often collapsed that into "External runner (task)" instead of naming the actual engine.

## What we saw in the run data

For `INS-205` through `INS-279`, local run records and comments showed these recurring signals:

- 42 watchdog comments and 47 heartbeat-related comments.
- 44 cancellation-related comments.
- 12 comments mentioning silent behavior.
- Multiple failed or cancelled runs above 5 minutes, including examples around 6, 8.8, 10, 11.4, 12.4, 12.6, 18.7, 23, 26.6, and 30 minutes.
- Gemini silent-timeout runs reached 30 minutes in multiple cases.
- Several Codex/Symphony runs failed or were cancelled after long periods with `external_signal`, timeout, cancellation, or stale-process symptoms.
- At least one stale-process repair was required after a recorded PID was no longer alive.
- Early runs hit startup/runtime failures such as missing Node/PATH behavior. Those should be preflight failures, not repeated task attempts.
- There were model/provider mismatches in the run records, such as Gemini-provider rows carrying a `gpt-5.5` model label. That suggests runtime identity and display metadata are not always trustworthy.

Representative examples:

- `INS-205`: repeated startup/runtime failures across agents before the environment issue was understood.
- `INS-216`, `INS-215`, `INS-213`, `INS-212`, `INS-211`, `INS-208`, `INS-217`, `INS-210`: stuck-agent watchdog status updates after stale heartbeats.
- `INS-229`: premature executions and cancellation paths that did not always have a real adapter cancel available.
- `INS-255`: orphaned silent runner cancellation and backoff rotation after repeated failed runs.
- `INS-256`: repeated proof-capture trouble, Gemini/Anthropic silent timeout symptoms, stale PID repair, and eventual success only after using a first-class proof helper path.
- `INS-260`: silent Mannie/Codex run cancelled after roughly 12 minutes.
- `INS-261` and `INS-262`: cancelled after no meaningful runner output.
- `INS-271`: unhealthy Codex/Symphony attempt and manual review intervention.
- `INS-273`, `INS-275`, `INS-279`: cancelled after multi-minute unhealthy attempts.

## What needs to change

The runtime problem is not just UI polish. We need a runner harness refactor that makes the CLI execution observable and governable in real time.

Required changes:

1. Live CLI telemetry
   - Stream command lifecycle events, stdout tail, stderr tail, tool calls, model stream activity, and progress markers while the run is active.
   - Show the latest meaningful event on the card and task detail within seconds.

2. Fast startup proof
   - Within 5 to 10 seconds, every run should emit either "started and healthy" evidence or a startup failure.
   - Missing Node, missing binary, missing auth, invalid model, unavailable provider, and missing workspace should fail before the task is assigned to a long run.

3. Short unhealthy-run thresholds
   - If there is no meaningful CLI output, tool activity, heartbeat, or model stream progress for 60 to 120 seconds, the run should be marked suspicious or unhealthy.
   - The operator should not have to wait 5 to 12 minutes to learn that a run is probably dead.

4. Separate heartbeat from progress
   - A process heartbeat only proves that something may still exist.
   - Progress needs separate evidence: bytes emitted, tool call started/ended, file changed, test started, browser proof captured, or model stream token activity.

5. Process truth and cancellation truth
   - Track PID, process group, child liveness, exit code, signal, cancellation request, cancellation result, and stale PID repair as first-class runtime facts.
   - Remove or fix no-op cancellation paths such as missing adapter cancel support.

6. First-class proof capture
   - Agents need a governed screenshot/browser-proof capability that works from tasks without improvising browser automation.
   - Proof capture should produce artifacts and task evidence quickly, ideally under 30 seconds for simple page screenshots.

7. Runtime identity clarity
   - Store and display actual execution engine, runner provider, provider model, reasoning/effort, speed, and wrapper path from one source of truth.
   - Cards, task detail, Run Trace, and execution records should agree.

8. Low-token monitoring mode
   - Overseer watch mode should be polling-driven and cheap by default.
   - It should summarize state changes, not repeatedly reason over huge context unless an escalation requires it.

9. Provider quarantine and preflight
   - Providers with repeated silent-timeout behavior, such as Gemini during this goal, should be quarantined or restricted until a wrapper health check proves reliable.
   - Provider/model availability should come from the shared runtime selection system, not hard-coded labels.

10. Remove stale assumptions
   - Stale OpenClaw paths or terminology should not appear in HiveRunner runtime paths, prompts, proof capture, or diagnostics.

## Acceptance criteria for the refactor

- Every CLI-backed run shows a visible runtime event within 10 seconds.
- Every active run exposes live stdout/stderr tail, last tool event, last model-stream event, current phase, and last meaningful progress timestamp.
- A run with no meaningful progress for 90 seconds becomes visibly suspicious and eligible for automatic intervention.
- Startup failures are caught before long-running task execution.
- Browser-proof tasks can capture and attach screenshots through a first-class helper.
- Active crew counts, board cards, task detail, and run records agree.
- Execution-engine labels and icons are accurate: HiveRunner, Symphony, or manual.
- Overseer monitoring can run continuously without multi-million-token turns.
- Cancellation records show whether the child process actually stopped.
- Run Trace contains enough active-run and terminal evidence to explain what happened without guessing.

## Refactor direction

Build this as a unified runtime harness, not as isolated UI patches. The harness should sit between HiveRunner task orchestration and provider-specific CLI adapters. It should normalize telemetry, health, cancellation, proof artifacts, provider preflight, and trace persistence before the board or Overseer summarizes anything.

The UI can then become simpler and more truthful: cards show last meaningful progress, detail pages show the live trace, Overseer watches cheap state deltas, and operators can intervene within one or two minutes instead of waiting for long silent timeouts.
