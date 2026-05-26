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

function writeFakeClaudeCli(binDir: string): string {
  const file = path.join(binDir, "claude");
  writeFileSync(
    file,
    `#!/bin/sh
printf '%s\\n' "$PWD" > "$FAKE_CLAUDE_CWD_FILE"
printf '%s\\n' "$*" > "$FAKE_CLAUDE_ARGS_FILE"
/bin/cat > "$FAKE_CLAUDE_STDIN_FILE"
printf '%s\\n' '{"type":"system","subtype":"init","session_id":"claude-session-fixture","model":"claude-sonnet-4-6"}'
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"Plan the fixture."},{"type":"tool_use","id":"toolu_fixture","name":"Read","input":{"file_path":"README.md"}},{"type":"text","text":"Claude completed fixture work."}]}}'
printf '%s\\n' '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_fixture","content":[{"type":"text","text":"Read fixture result."}],"is_error":false}]}}'
printf '%s\\n' '{"type":"result","subtype":"success","result":"\`\`\`mc-action\\n{\\"action\\":\\"report\\",\\"summary\\":\\"Final Claude fixture summary.\\"}\\n\`\`\`","is_error":false,"usage":{"input_tokens":111,"output_tokens":22,"cache_read_input_tokens":3,"cache_creation_input_tokens":4},"total_cost_usd":0.0123,"session_id":"claude-session-fixture","stop_reason":"end_turn"}'
exit 0
`,
    "utf8",
  );
  chmodSync(file, 0o755);
  return file;
}

async function run() {
  console.log("\nAnthropic Execution Adapter Tests\n");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "orchestration-anthropic-execution-"));
  const homeDir = path.join(tempRoot, "home");
  const binDir = path.join(tempRoot, "bin");
  const dbPath = path.join(tempRoot, "orchestration.db");
  const workspaceRoot = path.join(homeDir, ".mission-control", "dev", "workspaces");
  const cwdFile = path.join(tempRoot, "cwd.txt");
  const argsFile = path.join(tempRoot, "args.txt");
  const stdinFile = path.join(tempRoot, "stdin.txt");

  mkdirSync(binDir, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  const fakeClaude = writeFakeClaudeCli(binDir);

  process.env.HOME = homeDir;
  process.env.ORCHESTRATION_DB_PATH = dbPath;
  process.env.MC_WORKSPACE_ROOT = workspaceRoot;
  process.env.PATH = binDir;
  process.env.FAKE_CLAUDE_CWD_FILE = cwdFile;
  process.env.FAKE_CLAUDE_ARGS_FILE = argsFile;
  process.env.FAKE_CLAUDE_STDIN_FILE = stdinFile;
  process.env.MC_CLAUDE_EXEC_TIMEOUT_MS = "15000";
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";

  const { createCompany } = await import("@/lib/orchestration/company-service");
  const { getOrchestrationDb, closeOrchestrationDb } = await import("@/lib/orchestration/db");
  const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
  const { enqueueWakeup, executeHeartbeatRun } = await import("@/lib/orchestration/engine/engine");
  const { upsertCompanyRuntime } = await import("@/lib/orchestration/runtime-registry");
  const { ensureCompanyExecutionHives } = await import("@/lib/orchestration/service/execution-hives");
  const { anthropicExecutionAdapter } = await import("@/lib/orchestration/execution/adapters");

  const db = getOrchestrationDb();
  const company = createCompany({
    name: "Anthropic Execution Co",
    description: "Anthropic adapter fixture.",
    status: "active",
  }).company;
  ensureCompanyExecutionHives({ companyIdOrSlug: company.id }, db);
  const project = createProject({
    companyId: company.id,
    name: "Anthropic Execution Project",
    description: "fixture",
    color: "#8b5cf6",
    emoji: "A",
    status: "active",
  }).project;
  const agent = createProjectAgent({
    projectId: project.id,
    name: "Claude Runner",
    emoji: "A",
    role: "Engineer",
    personality: "Runs Claude fixture tests.",
    status: "idle",
    skills: [],
  }).agent;

  db.prepare(
    `UPDATE agents
     SET adapter_type = 'anthropic', model = 'anthropic/claude-sonnet-4-6', updated_at = ?
     WHERE id = ?`,
  ).run(new Date().toISOString(), agent.id);
  db.prepare(
    `UPDATE agent_runtime_state
     SET adapter_type = 'anthropic', updated_at = ?
     WHERE agent_id = ?`,
  ).run(new Date().toISOString(), agent.id);

  upsertCompanyRuntime({
    companyIdOrSlug: company.id,
    agentId: agent.id,
    provider: "anthropic",
    runtimeSlug: "fixture-claude",
    displayName: "Fixture Claude",
    runtimeKind: "cli",
    scope: "agent",
    command: fakeClaude,
    status: "online",
    workspaceRoot: company.workspace.root,
    metadata: {
      commandPath: fakeClaude,
      model: "anthropic/claude-sonnet-4-6",
      permissionMode: "bypassPermissions",
    },
  });

  const task = createTask({
    projectId: project.id,
    title: "Run Claude adapter fixture",
    description: "Exercise the Anthropic execution adapter without OpenClaw.",
    priority: "P2",
    type: "maintenance",
    status: "in-progress",
    assignee: agent.id,
    labels: [],
    createdBy: "test",
  }).task;

  await test("heartbeat run dispatches through Claude CLI and records structured telemetry", async () => {
    const wake = enqueueWakeup({
      agentId: agent.id,
      companyId: company.id,
      source: "explicit",
      reason: "anthropic execution adapter test",
      invocationSource: "on_demand",
      contextSnapshot: {
        wakeSource: "test",
        wakeReason: "anthropic_execution_adapter",
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
    const args = readFileSync(argsFile, "utf8");
    assert.ok(args.includes("--permission-mode bypassPermissions"), `unexpected args: ${args}`);
    assert.ok(args.includes("--model claude-sonnet-4-6"), `unexpected args: ${args}`);
    assert.ok(args.includes("--print --input-format text --output-format stream-json --verbose"), `unexpected args: ${args}`);
    assert.ok(!args.includes("Run Claude adapter fixture"), "prompt should not be passed through argv");
    assert.ok(!args.includes("Agent Instructions"), "prompt body should not be passed through argv");
    const stdinPrompt = readFileSync(stdinFile, "utf8");
    assert.ok(
      stdinPrompt.includes("Claude Runner"),
      `prompt should be streamed to Claude stdin; got ${stdinPrompt.length} chars: ${stdinPrompt.slice(0, 240)}`,
    );
    assert.ok(stdinPrompt.length > 1000, "stdin prompt should contain the full heartbeat prompt");

    const executionRun = db
      .prepare(
        `SELECT id, provider, runner_provider, runner_model, status, token_usage_json
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
        token_usage_json: string | null;
      } | undefined;
    assert.ok(executionRun, "execution_run should be created");
    assert.strictEqual(executionRun!.provider, "anthropic");
    assert.strictEqual(executionRun!.runner_provider, "anthropic");
    assert.strictEqual(executionRun!.runner_model, "claude-sonnet-4-6");
    assert.strictEqual(executionRun!.status, "completed");
    const metadata = JSON.parse(executionRun!.token_usage_json ?? "{}") as Record<string, unknown>;
    assert.strictEqual(metadata.provider, "anthropic");
    assert.strictEqual(metadata.runnerProvider, "anthropic");
    assert.strictEqual(metadata.runnerModel, "claude-sonnet-4-6");
    assert.strictEqual(metadata.integrationPath, "cli-stream-json");
    assert.strictEqual(metadata.structuredTelemetry, true);
    assert.strictEqual(metadata.sessionId, "claude-session-fixture");
    assert.strictEqual(metadata.cliModel, "claude-sonnet-4-6");
    assert.strictEqual(metadata.inputTokens, 111);
    assert.strictEqual(metadata.outputTokens, 22);
    assert.strictEqual(metadata.totalInputTokens, 118);
    assert.strictEqual(metadata.totalOutputTokens, 22);
    assert.strictEqual(metadata.totalCostCents, 1);
    assert.ok(String(metadata.resultText ?? "").includes("Final Claude fixture summary."));
    assert.deepStrictEqual(metadata.toolCallNames, ["Read"]);
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
    assert.strictEqual(transcriptEvents[2]?.title, "Read");
    assert.strictEqual(transcriptEvents[4]?.event_kind, "assistant_text_final");
    assert.ok(transcriptEvents[4]?.body.includes("Final Claude fixture summary."));
    assert.strictEqual(transcriptEvents[5]?.event_kind, "run_end");

    const comment = db
      .prepare(
        `SELECT body, source
         FROM comments
         WHERE task_id = ? AND body LIKE '%Final Claude fixture summary%'
         LIMIT 1`,
      )
      .get(task.id) as { body: string; source: string } | undefined;
    assert.ok(comment, "Anthropic adapter should import the structured report comment");
    assert.ok(comment!.body.includes("Final Claude fixture summary."));

    const runtimeState = db
      .prepare(
        `SELECT adapter_type, last_run_id, last_run_status, total_input_tokens,
                total_output_tokens, total_cost_cents, last_error
         FROM agent_runtime_state
         WHERE agent_id = ?`,
      )
      .get(agent.id) as {
        adapter_type: string;
        last_run_id: string | null;
        last_run_status: string | null;
        total_input_tokens: number;
        total_output_tokens: number;
        total_cost_cents: number;
        last_error: string | null;
      };
    assert.strictEqual(runtimeState.adapter_type, "anthropic");
    assert.strictEqual(runtimeState.last_run_id, wake.heartbeatRunId);
    assert.strictEqual(runtimeState.last_run_status, "succeeded");
    assert.strictEqual(runtimeState.total_input_tokens, 118);
    assert.strictEqual(runtimeState.total_output_tokens, 22);
    assert.strictEqual(runtimeState.total_cost_cents, 1);
    assert.strictEqual(runtimeState.last_error, null);
  });

  await test("stale Claude 3.7 Sonnet aliases normalize before CLI execution", async () => {
    db.prepare(
      `UPDATE agents
       SET model = 'anthropic/claude-3-7-sonnet', updated_at = ?
       WHERE id = ?`,
    ).run(new Date().toISOString(), agent.id);
    upsertCompanyRuntime({
      companyIdOrSlug: company.id,
      agentId: agent.id,
      provider: "anthropic",
      runtimeSlug: "fixture-claude",
      displayName: "Fixture Claude",
      runtimeKind: "cli",
      scope: "agent",
      command: fakeClaude,
      status: "online",
      workspaceRoot: company.workspace.root,
      metadata: {
        commandPath: fakeClaude,
        model: "anthropic/claude-3-7-sonnet",
        permissionMode: "bypassPermissions",
      },
    });

    const staleAliasTask = createTask({
      projectId: project.id,
      title: "Run stale Claude alias fixture",
      description: "Exercise runtime normalization for old Claude aliases.",
      priority: "P2",
      type: "maintenance",
      status: "in-progress",
      assignee: agent.id,
      labels: [],
      createdBy: "test",
    }).task;

    const wake = enqueueWakeup({
      agentId: agent.id,
      companyId: company.id,
      source: "explicit",
      reason: "anthropic stale alias adapter test",
      invocationSource: "on_demand",
      contextSnapshot: {
        wakeSource: "test",
        wakeReason: "anthropic_stale_alias",
        taskId: staleAliasTask.id,
      },
    }, db);

    const result = await executeHeartbeatRun(wake.heartbeatRunId, db);
    assert.strictEqual(result.status, "succeeded", result.error ?? "stale Claude alias should normalize");
    const args = readFileSync(argsFile, "utf8");
    assert.ok(args.includes("--model claude-sonnet-4-6"), `unexpected args: ${args}`);
    assert.ok(!args.includes("claude-3-7-sonnet"), `stale alias should not reach CLI: ${args}`);
  });

  await test("lane-routed Claude execution ignores non-Claude agent profile model", async () => {
    const codexProfileAgent = createProjectAgent({
      projectId: project.id,
      name: "Codex Profile Routed Through Claude",
      emoji: "C",
      role: "Engineer",
      personality: "Has a Codex profile but can be lane-routed through Claude.",
      status: "idle",
      skills: [],
    }).agent;
    db.prepare(
      `UPDATE agents
       SET adapter_type = 'codex', model = 'openai-codex/gpt-5.5', updated_at = ?
       WHERE id = ?`,
    ).run(new Date().toISOString(), codexProfileAgent.id);
    const agentRow = db.prepare(
      `SELECT id, name, role, personality, company_id, openclaw_agent_id,
              adapter_type, adapter_config_json, runtime_config_json,
              capabilities
       FROM agents
       WHERE id = ?`,
    ).get(codexProfileAgent.id) as {
      id: string;
      name: string;
      role: string;
      personality: string;
      company_id: string;
      openclaw_agent_id: string | null;
      adapter_type: string;
      adapter_config_json: string;
      runtime_config_json: string;
      capabilities: string;
      runtime_workspace_root: string | null;
    };
    agentRow.runtime_workspace_root = null;

    const directResult = await anthropicExecutionAdapter.execute({
      agent: agentRow,
      prompt: "Run the routed Claude fixture.",
      session: {
        id: "route-claude-session",
        agentId: agentRow.id,
        companyId: agentRow.company_id,
        adapterType: "anthropic",
        taskKey: "__heartbeat__",
        sessionParams: {},
        sessionDisplayId: null,
        lastRunId: null,
        lastError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      runtimeState: {
        agentId: agentRow.id,
        companyId: agentRow.company_id,
        adapterType: "anthropic",
        sessionId: null,
        state: {},
        lastRunId: null,
        lastRunStatus: null,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostCents: 0,
        lastError: null,
      },
      executionRouteAttempt: {
        target: {
          runtimeProvider: "anthropic",
          runtimeLabel: "Claude Code",
          model: null,
          source: {
            runtimeId: "anthropic",
            runtimeLabel: "Claude Code",
            modelId: "runtime managed",
            modelLabel: "runtime managed",
            mode: "runtime_managed",
          },
        },
        fallbackUsed: false,
        fallbackIndex: null,
        fallbackFromProvider: null,
      },
    });

    assert.strictEqual(directResult.runnerModel, "claude-sonnet-4-6");
    const args = readFileSync(argsFile, "utf8");
    assert.ok(args.includes("--model claude-sonnet-4-6"), `unexpected args: ${args}`);
    assert.ok(!args.includes("openai-codex/gpt-5.5"), `Codex profile model must not reach Claude CLI: ${args}`);
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
