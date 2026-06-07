# HiveRunner Local MCP Server

This guide is for operators who want to run the local HiveRunner MCP server,
connect an MCP client, inspect Run Intelligence resources, and understand which
tools are governed.

The server is local-first and stdio-only. It does not open an HTTP port, does
not write global MCP client config, does not modify `.stable`, and does not make
HiveRunner runners consume arbitrary external MCP tools.

Implementation verification for this slice must run from the source checkout on
dev `3010` or another isolated lane. Do not verify implementation behavior
against stable `3001`.

## Prerequisites

Use a clean local checkout with Node.js 22 and installed dependencies:

```sh
npm ci
```

The MCP process reads the same local orchestration database used by HiveRunner.
By default that is `MC_DATA_DIR/orchestration.db`; the script-managed dev lane
uses `data-dev/`.

Confirm the local registry scaffold before connecting another client:

```sh
npm run test:orchestration:mcp-registry
```

## Start The Server

Start the MCP server from the source workspace:

```sh
npm --silent run mcp:local -- --company INS
```

`--company` accepts an active company id, slug, or company code. The process
resolves one company at startup and serves that company for the life of the
stdio session.

Environment alternatives:

```sh
HIVERUNNER_MCP_COMPANY=INS npm --silent run mcp:local

HIVERUNNER_MCP_COMPANY=INS \
HIVERUNNER_MCP_ACTOR="Operator MCP Client" \
npm --silent run mcp:local
```

Supported launch flags:

```text
--company <company-code-or-slug>
--actor <display-name>
--help
```

Because MCP uses stdio, do not run the start command in a normal terminal and
wait for logs. Your MCP client should spawn this command and speak MCP over the
child process stdin/stdout.

## Connect A Client

Use this shape for MCP clients that accept a JSON server definition and support
`cwd`:

```json
{
  "mcpServers": {
    "hiverunner-insight": {
      "command": "npm",
      "args": [
        "--silent",
        "run",
        "mcp:local",
        "--",
        "--company",
        "INS",
        "--actor",
        "Operator MCP Client"
      ],
      "cwd": "/absolute/path/to/hiverunner"
    }
  }
}
```

If your client does not support `cwd`, use a shell wrapper:

```json
{
  "mcpServers": {
    "hiverunner-insight": {
      "command": "sh",
      "args": [
        "-lc",
        "cd /absolute/path/to/hiverunner && npm --silent run mcp:local -- --company INS --actor 'Operator MCP Client'"
      ]
    }
  }
}
```

After connection, the first checks are:

1. `initialize`
2. `resources/list`
3. `resources/read` for `hiverunner://INS/mcp/capabilities`
4. `tools/list`

## Local Smoke Client

The reusable smoke client connects over stdio, lists resources/tools, reads
requested resources, optionally invokes governed tools, and emits a compact
transcript. Run it from the source checkout after replacing `INS` with the
company code you want to inspect.

```sh
npm --silent run mcp:smoke -- \
  --company INS \
  --resource hiverunner://INS/mcp/capabilities
```

To save the transcript:

```sh
npm --silent run mcp:smoke -- \
  --company INS \
  --resource hiverunner://INS/mcp/capabilities \
  --transcript /tmp/hiverunner-mcp-smoke-transcript.json
```

The focused INS-265 smoke test drives the same client against an isolated
database and can persist an operator proof transcript:

```sh
HIVERUNNER_MCP_SMOKE_TRANSCRIPT_PATH=/absolute/path/to/mcp-smoke-transcript.json \
npm run test:orchestration:mcp-smoke-client
```

For ad-hoc clients, the equivalent minimal inline script is:

```sh
HIVERUNNER_MCP_COMPANY=INS node --input-type=module <<'JS'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const company = process.env.HIVERUNNER_MCP_COMPANY;
const client = new Client({ name: "hiverunner-local-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: "npm",
  args: [
    "--silent",
    "run",
    "mcp:local",
    "--",
    "--company",
    company,
    "--actor",
    "Local MCP smoke client",
  ],
});

try {
  await client.connect(transport);
  const resources = await client.listResources();
  const tools = await client.listTools();
  const capabilities = await client.readResource({
    uri: `hiverunner://${company}/mcp/capabilities`,
  });

  const content = capabilities.contents[0];
  const capabilityText = content && "text" in content ? content.text : "{}";

  console.log(JSON.stringify({
    server: client.getServerVersion(),
    resources: resources.resources.map((resource) => resource.name),
    tools: tools.tools.map((tool) => ({
      name: tool.name,
      governance: tool._meta?.governance,
    })),
    capabilities: JSON.parse(capabilityText),
  }, null, 2));
} finally {
  await client.close().catch(() => undefined);
}
JS
```

## Inspect Run Intelligence Resources

`resources/list` advertises the operator-facing Run Intelligence read surface.
Resource URIs use:

```text
hiverunner://{companyCode}/{domain}/...
```

The v1 public resources are:

| Resource | URI |
|---|---|
| `hiverunner.goals.list` | `hiverunner://INS/goals` |
| `hiverunner.tasks.list` | `hiverunner://INS/tasks` |
| `hiverunner.task.read` | `hiverunner://INS/tasks/{taskKey}` |
| `hiverunner.trace.read` | `hiverunner://INS/runs/{runId}/trace` |
| `hiverunner.trace.export` | `hiverunner://INS/runs/{runId}/trace/export` |
| `hiverunner.evals.list` | `hiverunner://INS/eval-cases` |
| `hiverunner.eval.read` | `hiverunner://INS/eval-cases/{caseId}` |
| `hiverunner.improve.list` | `hiverunner://INS/improve` |
| `hiverunner.improve.read` | `hiverunner://INS/improve/{recId}` |
| `hiverunner.team.list` | `hiverunner://INS/team` |
| `hiverunner.team.bench` | `hiverunner://INS/team/bench` |
| `hiverunner.templates.list` | `hiverunner://INS/templates` |
| `hiverunner.template.read` | `hiverunner://INS/templates/{templateVersionId}` |

There is also a connection-state resource:

```text
hiverunner://INS/mcp/capabilities
```

That resource returns `mcp.capabilities.v1` with server identity, launch
company, registered resource/tool names, and boundary flags.

Current scaffold note: until the resource reader implementation is present,
registered Run Intelligence resources may return `mcp.scaffold_resource.v1`
with `status: "registered"`. That means the MCP registry is connected but the
specific reader is not yet implemented in the current checkout.

## Governed Tools

`tools/list` advertises exactly four HiveRunner tools:

| Tool | Governance | What it may do |
|---|---|---|
| `hiverunner.eval.save_case` | `append_only` | Save a redacted review-backed eval case. |
| `hiverunner.evidence.attach` | `append_only` | Attach redacted evidence summaries to an eval case or recommendation. |
| `hiverunner.improve.create_recommendation` | `append_only` | Create a suggested improvement recommendation without changing runtime behavior. |
| `hiverunner.approval.request` | `approval_request` | Create a pending approval request through existing approval routing. |

The MCP server does not expose approval decisions, engine ticks, direct task
execution, provider switches, runtime credential mutation, or passthrough calls
to other MCP servers. State-changing behavior must stay inside the existing
HiveRunner governance path.

## Improvement Experiment Boundary

Improvement Experiments create comparison evidence. They do not automatically
replace the source run, source eval case, agent defaults, template defaults, task
state, branch contents, or stable release state.

For v1, experiment launch and execution remain a HiveRunner UI/service workflow,
not an MCP-runner workflow. The local MCP server may expose redacted experiment
reports as read resources later, and a future governed tool may attach evidence
or request an Improvement recommendation, but this server must not expose tools
that launch experiments, approve variants, run attempts, select live mode, or
promote experiment output.

The MCP boundary is also not a runner capability grant. Connecting an MCP client
to HiveRunner does not make HiveRunner runners consume arbitrary external MCP
tools, and the HiveRunner MCP server does not proxy calls to other MCP servers.
If a future governed runner-as-client feature exists, runner MCP usage is
reported only as redacted Run Trace evidence through the external runner
contract.

Operator rules to preserve:

- Prefer Eval Case sources; Run Trace sources need review context or explicit
  operator acceptance.
- Choose one primary objective before running variants.
- Recommend `snapshot` or `branch` workspace modes by default.
- Treat `live` workspace mode as explicit governed execution.
- Require approved hard limits for variants, attempts, cost/tokens, wall-clock
  time, and verification commands.
- Save comparison reports as evidence attachments.
- Send conclusions to Improve only when accepted or when configured trigger
  thresholds are met.

Current scaffold note: until governed tool implementations are present, tool
calls return a structured `mcp.tool.error.v1` result with
`code: "tool_not_implemented"`.

## Dev-Lane Setup

For operator-visible UI checks, use the dev lane:

```sh
scripts/lane.sh dev start
scripts/lane.sh dev status
curl http://127.0.0.1:3010/api/hiverunner/health
```

Port `3010` is observer-only. The script-managed dev lane forces
`MC_ENGINE_TICK=off`, even if an operator accidentally exports a different
value. Use it for UI/build observation and MCP proof artifacts, not active
execution ownership.

If a test needs a separate execution-capable development lane, do not reuse
`3010`. Use a distinct port, data directory, workspace root, and log directory.
For example:

```sh
PORT=3020 \
MC_DATA_DIR="$PWD/data-mcp-dev" \
MC_WORKSPACE_ROOT="$HOME/.hiverunner/mcp-dev/workspaces" \
MC_LOG_DIR="$PWD/data-mcp-dev/logs" \
MC_ENGINE_TICK=on \
NODE_ENV=development \
node --max-old-space-size=8192 server.js
```

Only run one execution owner for a given `MC_DATA_DIR`.

To point MCP at an isolated database for focused tests, set either
`MC_DATA_DIR` before launching the MCP process or use the test harness pattern
with `ORCHESTRATION_DB_PATH`:

```sh
MC_DATA_DIR="$PWD/data-mcp-dev" npm --silent run mcp:local -- --company INS

ORCHESTRATION_DB_PATH=/tmp/hiverunner-mcp-local.db \
npm run test:orchestration:mcp-registry
```

## Troubleshooting

**Startup returns `missing_company`.** Supply `--company <code-or-slug>` or set
`HIVERUNNER_MCP_COMPANY`.

**Startup returns `company_not_found`.** The company must exist and be active in
the database used by the MCP process. Check that `MC_DATA_DIR` or
`ORCHESTRATION_DB_PATH` points at the lane you intended.

**The capabilities read works but other resources show `mcp.scaffold_resource.v1`.**
The server registry is connected, but this checkout only has the scaffold reader
for that resource. Use the capabilities resource and `resources/list` to confirm
the client wiring, then verify with the checkout that contains the read-resource
implementation.

**A governed tool returns `tool_not_implemented`.** The tool name is registered,
but the current checkout has not wired the governed tool handler yet. This is
expected for the scaffold before the governed tool slice lands.

**A resource URI returns `resource_not_found`.** Use the concrete URI from
`resources/list`. Company codes are normalized to uppercase alphanumeric values
in URIs, and templated placeholders such as `{taskKey}` or `{runId}` must be
replaced with real ids from the same company.

**The MCP client hangs after launch.** Make sure the client is using stdio and
not expecting an HTTP URL. The MCP server logs startup errors to stderr as JSON,
but normal protocol traffic goes over stdin/stdout.

**The dev UI shows old data.** Restart the dev lane and confirm the data path:

```sh
scripts/lane.sh dev restart
scripts/lane.sh dev status
```

The script-managed dev lane uses `data-dev/`; stable `3001` uses `data/`.

**A local test should not touch current dev data.** Run it with an isolated
`ORCHESTRATION_DB_PATH` or a dedicated `MC_DATA_DIR`, and remove that directory
after the proof is captured.

## Source References

- `bin/hiverunner-mcp.ts` is the stdio entrypoint.
- `src/lib/orchestration/mcp/cli-options.ts` defines launch flags and env vars.
- `src/lib/orchestration/mcp/context.ts` resolves the active company and actor.
- `src/lib/orchestration/mcp/registry.ts` is the source of resource/tool names.
- `src/lib/orchestration/mcp/server.ts` registers MCP handlers.
- `docs/run-intelligence-slice-5-mcp-contract.md` is the Slice 5 MCP contract.
- `docs/two-lane-runtime.md` defines the `3010` and `3001` lane boundary.
