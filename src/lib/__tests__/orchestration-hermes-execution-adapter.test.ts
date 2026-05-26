import assert from "node:assert";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  pass ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  fail ${name}`);
      console.error(`    ${message}`);
    });
}

function writeFakeHermesCli(binDir: string): string {
  const file = path.join(binDir, "hermes");
  writeFileSync(
    file,
    `#!${process.execPath}
const fs = require("fs");
const readline = require("readline");

fs.writeFileSync(process.env.FAKE_HERMES_CWD_FILE, process.cwd(), "utf8");
fs.writeFileSync(process.env.FAKE_HERMES_ARGS_FILE, process.argv.slice(2).join(" "), "utf8");

const rl = readline.createInterface({ input: process.stdin });

function send(value) {
  process.stdout.write(JSON.stringify(value) + "\\n");
}

function notify(sessionId, update) {
  send({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId, update },
  });
}

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } });
    return;
  }
  if (message.method === "session/new") {
    fs.writeFileSync(process.env.FAKE_HERMES_SESSION_PARAMS_FILE, JSON.stringify(message.params), "utf8");
    send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "hermes-session-fixture" } });
    return;
  }
  if (message.method === "session/set_model") {
    fs.writeFileSync(process.env.FAKE_HERMES_MODEL_FILE, message.params.modelId || "", "utf8");
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "session/prompt") {
    const text = message.params.prompt && message.params.prompt[0] ? message.params.prompt[0].text : "";
    const taskKey = process.env.FAKE_HERMES_ACTION_TASK_KEY || "HER-1";
    fs.writeFileSync(process.env.FAKE_HERMES_PROMPT_FILE, text, "utf8");
    notify(message.params.sessionId, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "Plan the HERMES fixture." }
    });
    notify(message.params.sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: "tool-hermes-1",
      title: "terminal: echo fixture",
      kind: "execute",
      rawInput: { command: "echo fixture" }
    });
    notify(message.params.sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-hermes-1",
      status: "completed",
      rawOutput: "fixture output"
    });
    notify(message.params.sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: "HERMES completed fixture work.\\n\\n" +
          "\`\`\`mc-action\\n" +
          JSON.stringify({ action: "update_task", taskKey, status: "review" }) +
          "\\n\`\`\`"
      }
    });
    notify(message.params.sessionId, {
      sessionUpdate: "usage_update",
      usage: { inputTokens: 123, outputTokens: 45, totalTokens: 174, thoughtTokens: 7, cachedReadTokens: 6 }
    });
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        stopReason: "end_turn",
        usage: { inputTokens: 123, outputTokens: 45, totalTokens: 174, thoughtTokens: 7, cachedReadTokens: 6 }
      }
    });
    setTimeout(() => process.exit(0), 10);
    return;
  }
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown method" } });
});
`,
    "utf8",
  );
  chmodSync(file, 0o755);
  return file;
}

async function run() {
  console.log("\nHERMES Execution Adapter Tests\n");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "orchestration-hermes-execution-"));
  const homeDir = path.join(tempRoot, "home");
  const binDir = path.join(tempRoot, "bin");
  const dbPath = path.join(tempRoot, "orchestration.db");
  const workspaceRoot = path.join(homeDir, ".mission-control", "dev", "workspaces");
  const cwdFile = path.join(tempRoot, "cwd.txt");
  const argsFile = path.join(tempRoot, "args.txt");
  const promptFile = path.join(tempRoot, "prompt.txt");
  const modelFile = path.join(tempRoot, "model.txt");
  const sessionParamsFile = path.join(tempRoot, "session-params.json");

  mkdirSync(binDir, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  const fakeHermes = writeFakeHermesCli(binDir);

  process.env.HOME = homeDir;
  process.env.ORCHESTRATION_DB_PATH = dbPath;
  process.env.MC_WORKSPACE_ROOT = workspaceRoot;
  process.env.PATH = binDir;
  process.env.FAKE_HERMES_CWD_FILE = cwdFile;
  process.env.FAKE_HERMES_ARGS_FILE = argsFile;
  process.env.FAKE_HERMES_PROMPT_FILE = promptFile;
  process.env.FAKE_HERMES_MODEL_FILE = modelFile;
  process.env.FAKE_HERMES_SESSION_PARAMS_FILE = sessionParamsFile;
  process.env.MC_HERMES_EXEC_TIMEOUT_MS = "15000";
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";

  const { createCompany } = await import("@/lib/orchestration/company-service");
  const { getOrchestrationDb, closeOrchestrationDb } = await import("@/lib/orchestration/db");
  const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
  const { enqueueWakeup, executeHeartbeatRun } = await import("@/lib/orchestration/engine/engine");
  const { upsertCompanyRuntime } = await import("@/lib/orchestration/runtime-registry");
  const { configureCompanyExecutionHive, ensureCompanyExecutionHives } = await import("@/lib/orchestration/service/execution-hives");

  const db = getOrchestrationDb();
  const company = createCompany({
    name: "HERMES Execution Co",
    description: "HERMES adapter fixture.",
    status: "active",
  }).company;
  ensureCompanyExecutionHives({ companyIdOrSlug: company.slug }, db);
  configureCompanyExecutionHive({
    companyIdOrSlug: company.slug,
    hiveId: "balanced-builder",
    orchestrationMode: "hiverunner",
    runtimeProvider: "hermes",
    runtimeLabel: "HERMES",
    modelRouting: "runtime-managed",
    modelRoutingLabel: "Runtime managed",
  }, db);
  const project = createProject({
    companyId: company.id,
    name: "HERMES Execution Project",
    description: "fixture",
    color: "#8b5cf6",
    emoji: "H",
    status: "active",
  }).project;
  const agent = createProjectAgent({
    projectId: project.id,
    name: "HERMES Runner",
    emoji: "H",
    role: "Engineer",
    personality: "Runs HERMES fixture tests.",
    status: "idle",
    skills: [],
  }).agent;

  db.prepare(
    `UPDATE agents
     SET adapter_type = 'hermes', model = 'anthropic/claude-sonnet-4-6', updated_at = ?
     WHERE id = ?`,
  ).run(new Date().toISOString(), agent.id);
  db.prepare(
    `UPDATE agent_runtime_state
     SET adapter_type = 'hermes', updated_at = ?
     WHERE agent_id = ?`,
  ).run(new Date().toISOString(), agent.id);

  upsertCompanyRuntime({
    companyIdOrSlug: company.id,
    agentId: agent.id,
    provider: "hermes",
    runtimeSlug: "fixture-hermes",
    displayName: "Fixture HERMES",
    runtimeKind: "cli",
    scope: "agent",
    command: fakeHermes,
    status: "online",
    workspaceRoot: company.workspace.root,
    metadata: {
      commandPath: fakeHermes,
      model: "anthropic/claude-sonnet-4-6",
    },
  });

  const task = createTask({
    projectId: project.id,
    title: "Run HERMES adapter fixture",
    description: "Exercise the HERMES execution adapter without OpenClaw.",
    priority: "P2",
    type: "maintenance",
    status: "in-progress",
    assignee: agent.id,
    labels: [],
    createdBy: "test",
  }).task;
  process.env.FAKE_HERMES_ACTION_TASK_KEY = task.key;

  await test("heartbeat run dispatches through HERMES ACP and records structured telemetry", async () => {
    const wake = enqueueWakeup({
      agentId: agent.id,
      companyId: company.id,
      source: "explicit",
      reason: "hermes execution adapter test",
      invocationSource: "on_demand",
      contextSnapshot: {
        wakeSource: "test",
        wakeReason: "hermes_execution_adapter",
        taskId: task.id,
      },
    }, db);

    const result = await executeHeartbeatRun(wake.heartbeatRunId, db);
    assert.strictEqual(result.status, "succeeded", result.error ?? "heartbeat should succeed");
    assert.strictEqual(result.error, null);

    assert.strictEqual(
      realpathSync(readFileSync(cwdFile, "utf8").trim()),
      realpathSync(company.workspace.root),
    );
    assert.strictEqual(readFileSync(argsFile, "utf8"), "acp");
    assert.strictEqual(readFileSync(modelFile, "utf8"), "anthropic/claude-sonnet-4-6");
    const sessionParams = JSON.parse(readFileSync(sessionParamsFile, "utf8")) as Record<string, unknown>;
    assert.strictEqual(sessionParams.model, "anthropic/claude-sonnet-4-6");
    assert.ok(readFileSync(promptFile, "utf8").includes("Run HERMES adapter fixture"), "prompt should include focused task context");

    const executionRun = db
      .prepare(
        `SELECT id, provider, runner_provider, runner_model, status, session_id, token_usage_json
         FROM execution_runs
         WHERE task_id = ? AND agent_id = ?
         LIMIT 1`,
      )
      .get(task.id, agent.id) as {
        id: string;
        provider: string;
        runner_provider: string | null;
        runner_model: string | null;
        status: string;
        session_id: string | null;
        token_usage_json: string | null;
      } | undefined;
    assert.ok(executionRun, "execution_run should be created");
    assert.strictEqual(executionRun!.provider, "hermes");
    assert.strictEqual(executionRun!.runner_provider, "hermes");
    assert.strictEqual(executionRun!.runner_model, "anthropic/claude-sonnet-4-6");
    assert.strictEqual(executionRun!.status, "completed");
    assert.strictEqual(executionRun!.session_id, null, "HERMES ACP session should not be fed into the OpenClaw session importer");

    const metadata = JSON.parse(executionRun!.token_usage_json ?? "{}") as Record<string, unknown>;
    assert.strictEqual(metadata.provider, "hermes");
    assert.strictEqual(metadata.runnerProvider, "hermes");
    assert.strictEqual(metadata.runnerModel, "anthropic/claude-sonnet-4-6");
    assert.strictEqual(metadata.integrationPath, "acp-json-rpc");
    assert.strictEqual(metadata.sessionId, "hermes-session-fixture");
    assert.strictEqual(metadata.model, "anthropic/claude-sonnet-4-6");
    assert.ok(String(metadata.resultText).includes("HERMES completed fixture work."));
    assert.ok(String(metadata.resultText).includes(`"taskKey":"${task.key}"`));
    assert.strictEqual(metadata.inputTokens, 123);
    assert.strictEqual(metadata.outputTokens, 45);
    assert.strictEqual(metadata.totalInputTokens, 129);
    assert.strictEqual(metadata.totalOutputTokens, 45);
    assert.strictEqual(metadata.cacheReadTokens, 6);
    assert.strictEqual(metadata.thoughtTokens, 7);
    assert.deepStrictEqual(metadata.toolCallNames, ["terminal"]);
    assert.strictEqual(metadata.observedThinking, true);
    assert.strictEqual(metadata.observedStructuredTools, true);
    assert.strictEqual(metadata.transcriptEventCount, 6);

    const transcriptEvents = db
      .prepare(
        `SELECT event_kind, role, title, body
         FROM execution_run_transcript_events
         WHERE execution_run_id = ?
         ORDER BY sequence ASC`,
      )
      .all(executionRun!.id) as Array<{ event_kind: string; role: string | null; title: string | null; body: string }>;
    assert.strictEqual(transcriptEvents.length, 6);
    assert.strictEqual(transcriptEvents[0]?.event_kind, "run_start");
    assert.strictEqual(transcriptEvents[1]?.event_kind, "thinking_summary");
    assert.strictEqual(transcriptEvents[2]?.event_kind, "tool_call_start");
    assert.strictEqual(transcriptEvents[2]?.title, "terminal");
    assert.strictEqual(transcriptEvents[3]?.event_kind, "tool_result");
    assert.ok(transcriptEvents[3]?.body.includes("fixture output"));
    assert.strictEqual(transcriptEvents[4]?.event_kind, "assistant_text_final");
    assert.ok(transcriptEvents[4]?.body.includes("HERMES completed fixture work."));
    assert.strictEqual(transcriptEvents[5]?.event_kind, "run_end");

    const comment = db
      .prepare(
        `SELECT body, source
         FROM comments
         WHERE task_id = ? AND author_agent_id = ? AND external_ref LIKE 'hermes:%'
         LIMIT 1`,
      )
      .get(task.id, agent.id) as { body: string; source: string } | undefined;
    assert.ok(comment, "HERMES adapter should add a task evidence comment");
    assert.strictEqual(comment!.source, "hermes");
    assert.ok(comment!.body.includes("HERMES execution completed."));
    assert.ok(comment!.body.includes("HERMES completed fixture work."));
    assert.ok(comment!.body.includes("Tools: terminal"));

    const heartbeatResult = db
      .prepare("SELECT result_json FROM heartbeat_runs WHERE id = ? LIMIT 1")
      .get(wake.heartbeatRunId) as { result_json: string | null } | undefined;
    const actionResults = JSON.parse(heartbeatResult?.result_json ?? "{}") as Record<string, unknown>;
    assert.strictEqual(actionResults.actionsFound, 1);
    assert.strictEqual(actionResults.actionsExecuted, 1);

    const updatedTask = db
      .prepare("SELECT status FROM tasks WHERE id = ? LIMIT 1")
      .get(task.id) as { status: string } | undefined;
    assert.strictEqual(updatedTask?.status, "review");

    const runtimeState = db
      .prepare(
        `SELECT adapter_type, session_id, last_run_id, last_run_status,
                total_input_tokens, total_output_tokens, total_cost_cents, last_error
         FROM agent_runtime_state
         WHERE agent_id = ?`,
      )
      .get(agent.id) as {
        adapter_type: string;
        session_id: string | null;
        last_run_id: string | null;
        last_run_status: string | null;
        total_input_tokens: number;
        total_output_tokens: number;
        total_cost_cents: number;
        last_error: string | null;
      };
    assert.strictEqual(runtimeState.adapter_type, "hermes");
    assert.strictEqual(runtimeState.session_id, null);
    assert.strictEqual(runtimeState.last_run_id, wake.heartbeatRunId);
    assert.strictEqual(runtimeState.last_run_status, "succeeded");
    assert.strictEqual(runtimeState.total_input_tokens, 129);
    assert.strictEqual(runtimeState.total_output_tokens, 45);
    assert.strictEqual(runtimeState.total_cost_cents, 0);
    assert.strictEqual(runtimeState.last_error, null);
  });

  closeOrchestrationDb();
  rmSync(tempRoot, { recursive: true, force: true });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
