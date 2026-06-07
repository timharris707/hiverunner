# HiveRunner External Runner Contract

HiveRunner owns task selection, company/project defaults, and Kanban state. The external runner is a
Symphony-compatible runner boundary, not a Linear poller.

> **Compatibility note:** `symphony` in schema names (`hiverunner.symphony.execution.v1`),
> environment variable prefixes (`SYMPHONY_EXEC_COMMAND`, `HIVERUNNER_SYMPHONY_*`), and existing
> `execution_engine` database records and settings is a durable compatibility label for this external
> runner boundary. It does not mean Codex is the required or only provider. Codex is the default
> bundled runner; Claude Code, Gemini, HERMES, OpenClaw, and any custom command consume the same
> payload schema and are equally supported behind this boundary.

The external runner adapter sends one JSON payload on stdin:

```json
{
  "schema": "hiverunner.symphony.execution.v1",
  "runId": "heartbeat-run-id",
  "task": { "id": "task-id", "key": "INS-1", "title": "Task title" },
  "issue": { "id": "task-id", "identifier": "INS-1", "title": "Task title", "state": "in_progress" },
  "agent": { "id": "agent-id", "name": "Agent" },
  "workspace": { "cwd": "/path/to/company/workspace" },
  "prompt": "HiveRunner task prompt"
}
```

`task` is the HiveRunner-native shape. `issue` is an upstream Symphony-compatible normalized issue
shape derived from the same HiveRunner task. Keeping both lets the bundled one-task runner stay
small while preserving a clean path to a future HiveRunner tracker adapter for Symphony's daemon
orchestrator.

The default command is `scripts/hiverunner-symphony-runner.mjs`. It reads that payload, runs
`codex exec --json` inside `workspace.cwd`, and returns JSON on stdout. Product language should call
the execution surface the external runner, with Codex as the default bundled runner implementation.
Codex is the OpenAI coding/execution surface for this integration, so there is no separate
ChatGPT/OpenAI runner option in HiveRunner.

```json
{
  "sessionId": "codex-session-or-run-id",
  "resultText": "final assistant message",
  "assistantSummary": "final assistant message",
  "inputTokens": 0,
  "outputTokens": 0,
  "totalTokens": 0,
  "transcriptEvents": []
}
```

Runtime overrides for the Codex wrapper:

- `SYMPHONY_EXEC_COMMAND`: replace the whole external runner command used by the HiveRunner adapter.
- `SYMPHONY_EXEC_ARGS`: append runner args at the adapter layer.
- `HIVERUNNER_SYMPHONY_CODEX_COMMAND`: command used by the default runner, default `codex`.
- `HIVERUNNER_SYMPHONY_CODEX_ARGS`: replace the default `codex exec --json ...` args.
- `HIVERUNNER_SYMPHONY_MODEL`: pass a model to `codex exec`.
- `HIVERUNNER_SYMPHONY_DRY_RUN=1`: validate the handoff without launching Codex.

The first non-Codex wrapper is `scripts/hiverunner-claude-runner.mjs`. Attach provider
`External runner`, choose runner implementation `Claude Code`, and leave `Command` blank to let
HiveRunner select the bundled Claude wrapper from runtime metadata. You can still point a runtime
command at that script directly when you need an explicit custom command. It reads the same payload
schema, launches Claude Code with stream-json output, and returns the same result JSON shape.
Provider-specific runtime overrides:

- `HIVERUNNER_CLAUDE_COMMAND`: command used by the Claude wrapper, default `claude`.
- `HIVERUNNER_CLAUDE_ARGS`: replace the default Claude Code args.
- `HIVERUNNER_CLAUDE_MODEL`: pass a model to Claude Code.
- `HIVERUNNER_CLAUDE_PERMISSION_MODE`: permission mode, default `bypassPermissions` to match the
  existing trusted local Anthropic adapter.
- `HIVERUNNER_CLAUDE_DRY_RUN=1` or `HIVERUNNER_EXTERNAL_RUNNER_DRY_RUN=1`: validate the handoff
  without launching Claude Code.

The Gemini wrapper is `scripts/hiverunner-gemini-runner.mjs`. Attach provider `External runner`,
choose runner implementation `Gemini`, and leave `Command` blank to let HiveRunner select the
bundled Gemini CLI wrapper from runtime metadata. It reads the same payload schema, launches Gemini
CLI, and returns the same result JSON shape.
Provider-specific runtime overrides:

- `HIVERUNNER_GEMINI_COMMAND`: command used by the Gemini wrapper, default `gemini`.
- `HIVERUNNER_GEMINI_ARGS`: replace the default Gemini CLI args.
- `HIVERUNNER_GEMINI_MODEL`: pass a model to Gemini CLI. `google/...` prefixes are normalized for
  the CLI invocation.
- `HIVERUNNER_GEMINI_APPROVAL_MODE`: approval mode, default `yolo` for trusted local external-runner
  execution.
- `HIVERUNNER_GEMINI_DRY_RUN=1` or `HIVERUNNER_EXTERNAL_RUNNER_DRY_RUN=1`: validate the handoff
  without launching Gemini CLI.

The HERMES wrapper is `scripts/hiverunner-hermes-runner.mjs`. Attach provider `External runner`,
choose runner implementation `HERMES ACP`, and leave `Command` blank to let HiveRunner select the
bundled HERMES wrapper from runtime metadata. It reads the same payload schema, launches
`hermes acp`, drives the ACP JSON-RPC session, and returns the same result JSON shape.
Provider-specific runtime overrides:

- `HIVERUNNER_HERMES_COMMAND`: command used by the HERMES wrapper, default `hermes`.
- `HIVERUNNER_HERMES_ARGS`: replace the default HERMES args, default `acp`.
- `HIVERUNNER_HERMES_MODEL`: pass a model to HERMES ACP. Default aliases such as `hermes/default`
  are omitted so local HERMES config can choose the provider/model.
- `HIVERUNNER_HERMES_TIMEOUT_MS`: per-wrapper process timeout.
- `HIVERUNNER_HERMES_DRY_RUN=1` or `HIVERUNNER_EXTERNAL_RUNNER_DRY_RUN=1`: validate the handoff
  without launching HERMES ACP.

The OpenClaw wrapper is `scripts/hiverunner-openclaw-runner.mjs`. Attach provider `External runner`,
choose runner implementation `OpenClaw Gateway`, and leave `Command` blank to let HiveRunner select
the bundled OpenClaw wrapper from runtime metadata. It reads the same payload schema, creates an
OpenClaw gateway session, sends the HiveRunner prompt with `sessions.send`, then polls
`sessions.get` until it can return final assistant output or a terminal failure/timeout. Handoff
acceptance is recorded as `usage.openclawAcceptedStatus`; the final monitor result is recorded as
`usage.openclawStatus`, so HiveRunner does not treat enqueue acceptance as completed work.

Provider-specific runtime overrides:

- `HIVERUNNER_OPENCLAW_COMMAND`: command used by the OpenClaw wrapper, default `openclaw`.
- `HIVERUNNER_OPENCLAW_AGENT_ID`: OpenClaw agent ID for the gateway session. If omitted, the wrapper
  uses `agent.openclawAgentId` from the HiveRunner payload.
- `HIVERUNNER_OPENCLAW_TIMEOUT_MS`: per-gateway-call timeout.
- `HIVERUNNER_OPENCLAW_MAX_BUFFER`: per-gateway-call stdout/stderr buffer cap.
- `HIVERUNNER_OPENCLAW_FINAL_TIMEOUT_MS`: async completion monitor timeout. Defaults to
  `HIVERUNNER_OPENCLAW_TIMEOUT_MS`, then 20 minutes.
- `HIVERUNNER_OPENCLAW_FINAL_POLL_MS`: async completion monitor polling interval, default 2 seconds.
- `HIVERUNNER_OPENCLAW_WAIT_FOR_FINAL=0`: opt out of completion monitoring and return after
  `sessions.send` handoff acceptance.
- `HIVERUNNER_OPENCLAW_DRY_RUN=1` or `HIVERUNNER_EXTERNAL_RUNNER_DRY_RUN=1`: validate the handoff
  without launching the OpenClaw gateway.

Runner provider stance:

- `Codex` is the initial default runner.
- `Claude Code` is available as a first non-Codex wrapper through
  `scripts/hiverunner-claude-runner.mjs`.
- `Gemini` is available through `scripts/hiverunner-gemini-runner.mjs` and consumes the same
  `hiverunner.symphony.execution.v1` stdin contract and emits the same stdout result contract.
- `HERMES` is available through `scripts/hiverunner-hermes-runner.mjs` and drives `hermes acp`
  through the same versioned stdin/stdout contract.
- `OpenClaw` is available through `scripts/hiverunner-openclaw-runner.mjs` and drives the OpenClaw
  gateway `sessions.create` / `sessions.send` flow through the same versioned stdin/stdout contract.
- A custom runner can already be supplied through `SYMPHONY_EXEC_COMMAND` when a company needs a
  provider-specific experiment before a first-class wrapper exists.

In the HiveRunner Runtimes UI, attach provider `External runner`, choose a runner implementation, and
leave `Command` blank to use the selected bundled Codex, Claude, Gemini, HERMES, or OpenClaw wrapper.
Custom runner profiles must set a command that consumes the same stdin/stdout contract.

## Operator Setup

1. Attach a company-level runtime from **Company → Runtimes → Attach Runtime**.
2. Choose provider `External runner`.
3. Choose runner implementation `Bundled Codex`, `Claude Code`, `Gemini`, `HERMES ACP`,
   `OpenClaw Gateway`, or `Custom runner`.
4. Leave `Command` blank for a bundled runner. Set an executable command for `Custom runner`.
5. Set the company, project, or task execution engine to `External runner`.
6. Assign the task to a runnable agent and move it to `In Progress`.

Task, project, and company settings inherit in this order:

1. Task execution-engine override.
2. Project default execution engine.
3. Company default execution engine.
4. Global default, currently `HiveRunner`.

Use `Manual` when a task should stay visible on the board but never auto-dispatch.

## Custom Runner Contract

A custom runner is any executable command that:

1. reads the payload JSON from stdin,
2. performs the task inside `workspace.cwd`,
3. writes either JSON or plain text to stdout,
4. includes HiveRunner `mc-action` blocks when it wants task state, comments, approvals, or artifacts
   recorded.

The adapter accepts JSON fields such as `resultText`, `assistantSummary`, `sessionId`, token counts,
provider/model metadata, `usage`, and `transcriptEvents`. If stdout is plain text without
`mc-action` blocks, HiveRunner records it as a passive report.

Minimal custom runner shape:

```js
#!/usr/bin/env node
const input = JSON.parse(await new Promise((resolve, reject) => {
  let body = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { body += chunk; });
  process.stdin.on("end", () => resolve(body));
  process.stdin.on("error", reject);
}));

const taskKey = input.task?.key;
process.stdout.write(JSON.stringify({
  sessionId: `custom-${input.runId}`,
  resultText: [
    "Custom Symphony-compatible runner completed.",
    "",
    "```mc-action",
    JSON.stringify({ action: "add_comment", taskKey, body: "Custom runner completed." }),
    "```",
    "```mc-action",
    JSON.stringify({ action: "update_task", taskKey, status: "review" }),
    "```",
  ].join("\n"),
}) + "\n");
```

## Runner Trace Capability

Rich trace capture is optional. A custom runner remains valid when it returns plain text, or when it
returns the minimal JSON shape above with only `sessionId` and `resultText`. Extra trace fields give
Run Trace v1 better chronology, usage, artifact, failure, and memory evidence, but their absence is
reported as missing evidence rather than a contract failure.

Recommended optional JSON fields:

| Field | Shape | Trace use |
| --- | --- | --- |
| `assistantSummary` | string | Compact result summary when different from `resultText`. |
| `status` | string | Terminal runner status such as `completed`, `failed`, or `cancelled` when known. |
| `error` | string | Safe failure message. Do not include secrets, raw env, or full stderr dumps. |
| `runnerProvider` | string | Provider label such as `codex`, `anthropic`, `gemini`, `hermes`, `openclaw`, or a custom provider id. |
| `runnerModel` | string or null | Actual model used by the runner when known. |
| `durationMs` | number | Runner wall-clock duration in milliseconds. |
| `inputTokens`, `outputTokens`, `totalTokens` | numbers | Token totals when the provider reports them. |
| `cacheReadInputTokens`, `cacheCreationInputTokens` | numbers | Cache token details when available. |
| `totalCostUsd`, `totalCostCents` | numbers | Cost estimate or provider-reported cost when available. |
| `usage` | object | Provider-specific usage metadata. Prefer also setting the common top-level token fields. |
| `transcriptEvents` | array | Ordered transcript or timeline events. |
| `rawProviderEvents` | array | Optional redacted raw provider event samples for diagnostics. Keep bounded. |
| `traceCapabilities` | array | Capability names the runner expects to provide, such as `transcriptEvents`, `usage`, `artifacts`, `failureClass`, `memoryReceipts`, or future `runnerMcpToolUsage`. |
| `failureClass` | string | Optional coarse failure category, such as `provider_error`, `timeout`, `cancelled`, `missing_tool`, or `contract_error`. |
| `cancellationReason` | string | Safe explanation when `status` is `cancelled`. |
| `memoryReceipts` | array | Optional memory evidence references. Prefer the `memory_receipt` `mc-action` for durable reporting. |

The initial bundled runners already emit a subset of these fields. Custom runners can add them
incrementally; they do not need to implement the full table.

### Transcript Events

`transcriptEvents` entries should be small operator-facing records:

```json
{
  "role": "assistant",
  "kind": "tool_call_start",
  "title": "Shell",
  "body": "rg --files src/lib/orchestration",
  "occurredAt": "2026-06-06T22:40:00.000Z",
  "metadata": { "tool": "shell" }
}
```

Required fields for portable events are `kind`, `title`, and `body`. `role`, `occurredAt`, and
`metadata` are optional. Use stable `kind` values when possible:

- `message`
- `provider_event`
- `assistant_text_delta`
- `assistant_text_final`
- `thinking_summary`
- `tool_call_start`
- `tool_call_end`
- `tool_result`
- `usage_update`
- `artifact`
- `memory`
- `provider_error`
- `run_start`
- `run_end`

Provider-specific event names are accepted, but the Run Trace UI may normalize them into the common
taxonomy.

### Future Runner MCP Usage Reporting Boundary

HiveRunner MCP Server v1 exposes HiveRunner resources and governed HiveRunner tools to MCP clients.
It does **not** make Codex, Claude, Gemini, HERMES, OpenClaw, Symphony wrappers, or custom runners
into MCP clients, and it does not proxy calls to external MCP servers. Runner-side MCP tool
consumption is a later slice with separate governance for provider configuration, credentials,
filesystem/network access, and approval routing.

Future runner-as-client implementations may report MCP tool usage into Run Trace through the same
`transcriptEvents` lane used for other structured tool calls. That reporting is evidence only: it
must describe what the runner did; it must not imply that the HiveRunner MCP Server executed,
approved, relayed, or audited the external MCP call.

Reporting rules for future runner-consumed MCP tools:

- Use normalized Run Trace event kinds (`tool_call_start`, `tool_call_end`, `tool_result`, and
  `usage_update` when useful). Do not add raw MCP protocol messages to `rawProviderEvents`.
- Keep event bodies operator-facing and bounded. Summarize the intent/result rather than storing raw
  MCP request arguments, tool outputs, file contents, prompts, or provider transcripts.
- Metadata may include safe identifiers such as `toolSystem: "mcp"`, `mcpServer`, `mcpTool`,
  `toolCallId`, `approvalMode`, `durationMs`, `success`, and coarse `resultSummary`.
- Metadata and bodies must never include API keys, OAuth tokens, bearer headers, connection strings,
  secret env vars, private key material, cookie/session data, or credential-bearing MCP payloads.
- If a future MCP tool call requires approval, report the approval state or approval id only. The
  approval decision remains governed by HiveRunner's existing approval path, not by the trace event.

Example normalized trace events only:

```json
[
  {
    "role": "assistant",
    "kind": "tool_call_start",
    "title": "MCP tool started",
    "body": "Searched project documentation through an approved local docs tool.",
    "occurredAt": "2026-06-07T16:20:00.000Z",
    "metadata": {
      "toolSystem": "mcp",
      "mcpServer": "local-docs",
      "mcpTool": "search",
      "toolCallId": "mcp-call-1",
      "approvalMode": "preapproved_read"
    }
  },
  {
    "role": "tool",
    "kind": "tool_call_end",
    "title": "MCP tool finished",
    "body": "The local docs search completed successfully.",
    "occurredAt": "2026-06-07T16:20:01.250Z",
    "metadata": {
      "toolSystem": "mcp",
      "mcpServer": "local-docs",
      "mcpTool": "search",
      "toolCallId": "mcp-call-1",
      "durationMs": 1250,
      "success": true
    }
  },
  {
    "role": "tool",
    "kind": "tool_result",
    "title": "MCP tool result",
    "body": "Returned three documentation matches; no raw document text stored in the trace event.",
    "occurredAt": "2026-06-07T16:20:01.260Z",
    "metadata": {
      "toolSystem": "mcp",
      "mcpServer": "local-docs",
      "mcpTool": "search",
      "toolCallId": "mcp-call-1",
      "resultSummary": "3 matches"
    }
  }
]
```

### Improvement Experiment Runner Boundary

Improvement Experiments are orchestrated by HiveRunner as controlled comparison
runs. They are not a new runner API and they do not change the one-task
stdin/stdout contract by default. A runner still receives a bounded task prompt
and workspace cwd, performs that task, and returns safe result evidence plus any
`mc-action` blocks.

When a task is an experiment attempt, runner authors should treat the handoff as
a governed comparison attempt with an explicit source, objective, workspace
mode, variant, and hard limits:

- `source`: a reviewed Run Trace or Eval Case. Eval Case is preferred because it
  is immutable reviewed evidence.
- `objective`: the one thing the operator is trying to improve, such as cost,
  runtime, acceptance rate, evidence quality, or fewer tool failures.
- `workspaceMode`: `snapshot`, `branch`, or `live`.
- `limits`: approved attempt count, wall-clock, cost/token budget, allowed
  verification commands, and cancellation rules.
- `variant`: the approved runner/model/agent/prompt/tool/decomposition/template
  change being compared.

Runner output is evidence for HiveRunner's comparison report. It is not an
instruction to mutate production state. Even when a variant appears better, the
runner must not change agent defaults, template defaults, source eval cases,
review outcomes, task status beyond the assigned task contract, stable release
state, or production workspace state unless the handoff explicitly authorizes
that mutation.

Workspace mode rules for runners:

- `snapshot` means operate only inside the copied workspace state supplied in
  `workspace.cwd`.
- `branch` means operate only inside the isolated branch/worktree supplied in
  `workspace.cwd`; leave promotion or merge decisions to HiveRunner governance.
- `live` means active workspace execution was explicitly selected by the
  operator. Treat it as governed high-risk execution, obey the exact limits, and
  make any real mutation visible in the final report.

Experiment reports remain HiveRunner-owned evidence attachments. Runners should
return enough bounded evidence for the report: attempt status, changed files or
artifacts, verification result, duration, token/cost data when available,
failure/cancellation reason, and redaction-safe notes about evidence gaps.

MCP boundary for experiment runners:

- An Improvement Experiment does not authorize the runner to discover, consume,
  or proxy arbitrary external MCP tools.
- The HiveRunner MCP Server exposing resources and governed tools is separate
  from runner-side MCP consumption.
- If a future governed runner-as-client slice allows an MCP tool call, report it
  as safe Run Trace evidence only. Do not put raw MCP requests, responses,
  credentials, file contents, provider transcripts, or auth headers in
  `transcriptEvents` or `rawProviderEvents`.

### Capture Quality And Missing Data

Capture quality describes evidence capture, not the quality of the agent's work. HiveRunner derives
it from runner capabilities and captured evidence:

- `complete`: expected trace data was captured for the runner's declared or known capabilities.
- `partial`: useful evidence exists, but expected categories are missing.
- `minimal`: only basic result/status evidence is available.
- `failed`: trace capture itself failed or is unusable.

Missing trace data should be labeled explicitly:

- `not_captured`: HiveRunner did not store this data.
- `not_available`: the runner or provider does not expose this data.
- `capture_failed`: HiveRunner attempted capture and failed.

Examples: missing cost data should show as cost not captured; a runner with no transcript should show
no transcript recorded; a manual or minimal run should show minimal capture instead of an error.

### Reporting Guidance

Usage and cost:

- Put common totals in top-level token/cost fields when available.
- Include provider-specific details in `usage` if they help audit the run.
- Omit unknown values instead of sending zero unless the provider explicitly reported zero.

Artifacts and evidence:

- Report durable artifacts with a `register_artifact` `mc-action` in `resultText`.
- Include `uri`, `kind`, and `sha256` when the artifact is a local file.
- Use `record_validation_evidence` or `record_success_evidence` only for goal-contract validation
  evidence, not for every transient file.

Failures and cancellations:

- Set a safe `error` string for failures.
- Set `status: "cancelled"` and `cancellationReason` for operator or runtime cancellations.
- Add a `provider_error` transcript event when the failure context is useful and safe to show.

Memory:

- Use a `memory_receipt` `mc-action` when injected memory affected the work.
- Reference memory record IDs and evidence envelope IDs instead of copying full memory bodies.
- If no memory was injected or used, omit memory fields; Run Trace will label the memory evidence as
  missing or not available.

Raw provider data:

- Redact secrets before emitting `rawProviderEvents`.
- Keep raw event arrays bounded; the transcript should carry the operator-facing chronology.

### Rich Custom Runner Output Example

This example is intentionally richer than the required contract. A minimal custom runner can still
return only `sessionId` and `resultText`.

```json
{
  "sessionId": "custom-fixture-run-123",
  "status": "completed",
  "resultText": "Generated the fixture report.\n\n```mc-action\n{\"action\":\"register_artifact\",\"taskKey\":\"INS-ART\",\"uri\":\"file:///tmp/hiverunner-fixture-workspace/report.html\",\"kind\":\"html\",\"sha256\":\"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\"}\n```\n```mc-action\n{\"action\":\"memory_receipt\",\"taskKey\":\"INS-ART\",\"used\":[{\"recordId\":\"memory-1\",\"evidenceEnvelopeId\":\"envelope-1\",\"reason\":\"Provided runner contract context.\"}],\"ignored\":[],\"irrelevant\":[]}\n```",
  "assistantSummary": "Generated the fixture report.",
  "runnerProvider": "custom-runner",
  "runnerModel": "local-model-v1",
  "durationMs": 1842,
  "inputTokens": 42,
  "outputTokens": 21,
  "totalTokens": 63,
  "usage": {
    "runnerProvider": "custom-runner",
    "runnerModel": "local-model-v1"
  },
  "traceCapabilities": ["transcriptEvents", "usage", "artifacts", "memoryReceipts"],
  "transcriptEvents": [
    {
      "role": "assistant",
      "kind": "tool_call_start",
      "title": "Shell",
      "body": "Generate report.html"
    },
    {
      "kind": "tool_result",
      "title": "Shell",
      "body": "report.html written and hashed"
    },
    {
      "role": "assistant",
      "kind": "assistant_text_final",
      "title": "External runner result",
      "body": "Generated the fixture report."
    }
  ]
}
```

## Upstream Symphony Compatibility

Upstream Symphony is still useful as the reference architecture and future hardened runner
source, but the current reference implementation is a long-running Linear polling service. For
HiveRunner, the clean integration is this one-task runner contract so HiveRunner remains the source
of work and state.

The pieces worth borrowing from upstream Symphony are the daemon execution loop, issue/workspace
reconciliation, retry/backoff model, stalled-run detection, workflow file hot reload, Codex app-server
integration, and observability dashboard. The Linear poller itself should stay optional because it
competes with HiveRunner as the task source of truth.

The likely future-compatible shape is a HiveRunner tracker adapter for upstream Symphony, not a
return to Linear. That would let Symphony run as an optional engine/poller for selected companies or
projects while still reading and writing HiveRunner tasks.

## HiveRunner Tracker Adapter Boundary

The first HiveRunner tracker adapter boundary lives in
`src/lib/orchestration/symphony/tracker-adapter.ts`. It mirrors upstream Symphony's tracker callback
shape without changing the current production execution path:

| Upstream tracker operation | HiveRunner operation |
| --- | --- |
| `fetch_candidate_issues()` | fetch active HiveRunner tasks whose resolved execution engine is `symphony` and, when worker IDs are supplied, are unassigned or assigned to that worker |
| `fetch_issues_by_states(state_names)` | fetch tasks by normalized HiveRunner states |
| `fetch_issue_states_by_ids(issue_ids)` | refresh visible tasks by UUID or task key |
| `create_comment(issue_id, body)` | create a HiveRunner task comment |
| `update_issue_state(issue_id, state_name)` | move the HiveRunner Kanban task to the mapped status |

The adapter defaults to `executionEngine=symphony`, using the normal task/project/company inheritance
rules. That preserves the exact flexibility we want: a company, project, or individual task can be
selected for the external runner while other work remains on HiveRunner or manual execution.

When a runner supplies `workerAgentIds`, candidate fetches are scoped to tasks that are either
unassigned or already assigned to one of those workers. Explicit state refresh by ID can still return
another worker's task, with `assigned_to_worker: false`, so a runner can detect ownership drift
without accidentally picking up work it should not execute.

State aliases intentionally accept both HiveRunner and upstream-style names:

| Input state | HiveRunner status |
| --- | --- |
| `Todo`, `To Do`, `to-do`, `to-do` | `to-do` |
| `In Progress`, `in-progress`, `in_progress` | `in_progress` |
| `Human Review`, `In Review`, `review` | `review` |
| `Closed`, `Complete`, `Completed`, `Done` | `done` |
| `Backlog` | `backlog` |
| `Blocked` | `blocked` |

This adapter is not yet wired into the upstream Elixir daemon. The next integration step is to decide
whether to call it over an HTTP/stdio shim from upstream Symphony or to port the tracker behaviour
directly into a HiveRunner-owned daemon process. The one-task runner remains the stable path until
that daemon path has equivalent cancellation, retry, and observability coverage.

### Stdio Shim

`scripts/hiverunner-symphony-tracker.ts` exposes the tracker adapter as JSON over stdin/stdout from
the HiveRunner app repo root. It is disabled by default for all data and mutation operations. Enable
it only for an intentional local integration process:

```sh
HIVERUNNER_SYMPHONY_TRACKER_ENABLED=1 npm run symphony:tracker
```

Health is always available:

```json
{ "operation": "health" }
```

Example candidate fetch:

```json
{
  "operation": "fetch_candidate_issues",
  "options": {
    "companyIdOrSlug": "HIVE",
    "projectIdOrSlug": "runtime-usage-checks",
    "executionEngine": "symphony"
  }
}
```

Example state update:

```json
{
  "operation": "update_issue_state",
  "options": { "companyIdOrSlug": "HIVE" },
  "issueId": "NEV-47",
  "stateName": "Human Review"
}
```

Responses are single JSON objects:

```json
{ "ok": true, "operation": "fetch_candidate_issues", "result": [] }
```

Failures return `ok: false` and the process exits non-zero. That makes the shim safe for shell,
Elixir port, or supervisor-based callers.

### HTTP Tracker Route

The same tracker contract is also available from the running HiveRunner app:

```sh
GET  /api/orchestration/symphony/tracker
POST /api/orchestration/symphony/tracker
```

`GET` returns health and schema information even while tracker work is disabled. `POST` accepts the
same JSON payloads as the stdio shim and is disabled by default. Enable it for intentional local
runner integration with:

```sh
HIVERUNNER_SYMPHONY_TRACKER_ENABLED=1
```

For a long-running local runner, set a token and send it as either `Authorization: Bearer <token>` or
`x-hiverunner-symphony-token: <token>`:

```sh
HIVERUNNER_SYMPHONY_TRACKER_TOKEN=local-secret
```

This route is the preferred boundary for a runner attached to the app on port 3010 because it uses
the compiled Next server and the live HiveRunner database instead of depending on repo-root `tsx`
execution.

For the script-managed dev lane, export the variables before restarting 3010:

```sh
HIVERUNNER_SYMPHONY_TRACKER_ENABLED=1 \
HIVERUNNER_SYMPHONY_TRACKER_TOKEN=local-secret \
scripts/lane.sh dev restart
```

`scripts/run_dev_service.sh` forwards only these explicit tracker variables into the dev server and
logs whether token auth is configured without printing the token.

For a safe first end-to-end execution pass, enable the bundled runner dry run before restarting the
dev lane:

```sh
HIVERUNNER_SYMPHONY_DRY_RUN=1 \
scripts/lane.sh dev restart
```

The dev launcher also forwards the explicit Symphony-named execution variables used by the adapter
and bundled runner: `SYMPHONY_EXEC_COMMAND`, `SYMPHONY_EXEC_ARGS`, `SYMPHONY_EXEC_TIMEOUT_MS`,
`SYMPHONY_EXEC_MAX_BUFFER`, `HIVERUNNER_SYMPHONY_CODEX_COMMAND`, `HIVERUNNER_SYMPHONY_CODEX_ARGS`,
`HIVERUNNER_SYMPHONY_APPROVAL_POLICY`, `HIVERUNNER_SYMPHONY_SANDBOX`, `HIVERUNNER_SYMPHONY_MODEL`,
`HIVERUNNER_SYMPHONY_PROFILE`, `HIVERUNNER_SYMPHONY_TIMEOUT_MS`, and
`HIVERUNNER_SYMPHONY_MAX_BUFFER`.

Current payload compatibility with upstream Symphony's normalized issue model:

| Symphony issue field | HiveRunner source |
| --- | --- |
| `id` | task UUID |
| `identifier` | task key, falling back to task UUID |
| `title` / `description` | task title and description |
| `priority` | `critical=1`, `high=2`, `medium=3`, `low=4` |
| `state` | HiveRunner task status, such as `in_progress` or `review` |
| `branch_name` | deterministic slug from task key and title |
| `url` | canonical HiveRunner task path, with `HIVERUNNER_APP_URL` or `NEXT_PUBLIC_APP_URL` as the optional base |
| `assignee_id` | HiveRunner assignee agent UUID |
| `blocked_by` | task dependency identifiers from `depends_on_json` |
| `labels` | HiveRunner task labels |
| `assigned_to_worker` | always `true` for the one-task handoff |

The main compatibility difference is state ownership. Upstream Symphony expects a tracker adapter to
poll active states, refresh state between turns, create comments, and update issue state. HiveRunner
already owns those operations in its database and Kanban UI. A future upstream-style integration
should implement those tracker callbacks against HiveRunner APIs instead of reintroducing Linear.
