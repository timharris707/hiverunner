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

function writeFakeCodexCli(binDir: string): string {
  const file = path.join(binDir, "codex");
  writeFileSync(
    file,
    `#!/bin/sh
printf '%s\\n' "$PWD" > "$FAKE_CODEX_CWD_FILE"
printf '%s\\n' "$*" > "$FAKE_CODEX_ARGS_FILE"
printf '%s\\n' '---RUN---' >> "$FAKE_CODEX_STDIN_FILE"
/bin/cat >> "$FAKE_CODEX_STDIN_FILE"
if [ "$FAKE_CODEX_EMPTY_OUTPUT" = "1" ]; then
  printf 'Reading additional input from stdin...\\n' >&2
  exit 0
fi
json=0
out=""
prev=""
for arg in "$@"; do
  if [ "$arg" = "--json" ]; then
    json=1
  fi
  if [ "$prev" = "--output-last-message" ]; then
    out="$arg"
    break
  fi
  prev="$arg"
done
if [ -n "$out" ]; then
  printf '\`\`\`mc-action\\n{"action":"report","summary":"fake codex completed in %s"}\\n\`\`\`\\n' "$PWD" > "$out"
else
  printf '\`\`\`mc-action\\n{"action":"report","summary":"fake codex completed in %s"}\\n\`\`\`\\n' "$PWD"
fi
if [ "$json" = "1" ]; then
  printf '%s\\n' '{"type":"session.started","message":"Codex session started"}'
  printf '%s\\n' '{"type":"assistant.text.delta","text":"fake codex is inspecting the task"}'
  printf '%s\\n' '{"type":"tool.call","name":"shell","command":"pwd"}'
  printf '%s\\n' '{"type":"tool.result","name":"shell","output":"fixture output"}'
  printf '%s\\n' '{"type":"usage","usage":{"input_tokens":1234,"output_tokens":56,"cache_read_input_tokens":78,"cache_creation_input_tokens":9,"total_tokens":1377}}'
  printf '%s\\n' '{"type":"assistant.final","text":"\`\`\`mc-action\\n{\\"action\\":\\"report\\",\\"summary\\":\\"fake codex completed from json events\\"}\\n\`\`\`"}'
fi
exit 0
`,
    "utf8",
  );
  chmodSync(file, 0o755);
  return file;
}

async function run() {
  console.log("\nCodex Execution Adapter Tests\n");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "orchestration-codex-execution-"));
  const homeDir = path.join(tempRoot, "home");
  const binDir = path.join(tempRoot, "bin");
  const dbPath = path.join(tempRoot, "orchestration.db");
  const workspaceRoot = path.join(homeDir, ".mission-control", "dev", "workspaces");
  const cwdFile = path.join(tempRoot, "cwd.txt");
  const argsFile = path.join(tempRoot, "args.txt");
  const stdinFile = path.join(tempRoot, "stdin.txt");

  mkdirSync(binDir, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  const fakeCodex = writeFakeCodexCli(binDir);

  process.env.HOME = homeDir;
  process.env.ORCHESTRATION_DB_PATH = dbPath;
  process.env.MC_WORKSPACE_ROOT = workspaceRoot;
  process.env.PATH = binDir;
  process.env.FAKE_CODEX_CWD_FILE = cwdFile;
  process.env.FAKE_CODEX_ARGS_FILE = argsFile;
  process.env.FAKE_CODEX_STDIN_FILE = stdinFile;
  process.env.MC_CODEX_EXEC_TIMEOUT_MS = "15000";
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";

  const { createCompany } = await import("@/lib/orchestration/company-service");
  const { getOrchestrationDb, closeOrchestrationDb } = await import("@/lib/orchestration/db");
  const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
  const { enqueueWakeup, executeHeartbeatRun, executeMcAction } = await import("@/lib/orchestration/engine/engine");
  const { upsertCompanyRuntime } = await import("@/lib/orchestration/runtime-registry");
  const { configureCompanyExecutionHive, ensureCompanyExecutionHives } = await import("@/lib/orchestration/service/execution-hives");
  const { assignCompanySkillToAgent, createCompanySkill, listRuntimeAgentSkills, updateCompanySkill } = await import("@/lib/orchestration/company-skills");
  const { updateApprovalStatus } = await import("@/lib/orchestration/service/approval");
  const { updateCompanyRuntimeGovernanceSettings } = await import("@/lib/orchestration/service/runtime-governance");

  const db = getOrchestrationDb();
  const company = createCompany({
    name: "Codex Execution Co",
    description: "Codex adapter fixture.",
    status: "active",
  }).company;
  ensureCompanyExecutionHives({ companyIdOrSlug: company.slug }, db);
  configureCompanyExecutionHive({
    companyIdOrSlug: company.slug,
    hiveId: "balanced-builder",
    orchestrationMode: "hiverunner",
    runtimeProvider: "codex",
    runtimeLabel: "Codex",
    modelRouting: "runtime-managed",
    modelRoutingLabel: "Runtime managed",
  }, db);
  const project = createProject({
    companyId: company.id,
    name: "Codex Execution Project",
    description: "fixture",
    color: "#3b82f6",
    emoji: "C",
    status: "active",
  }).project;
  const agent = createProjectAgent({
    projectId: project.id,
    name: "Codex Runner",
    emoji: "C",
    role: "Engineer",
    personality: "Runs Codex fixture tests.",
    status: "idle",
    skills: [],
  }).agent;

  db.prepare(
    `UPDATE agents
     SET adapter_type = 'codex',
         model = 'openai-codex/gpt-5.3-codex',
         updated_at = ?
     WHERE id = ?`,
  ).run(new Date().toISOString(), agent.id);
  db.prepare(
    `UPDATE agent_runtime_state
     SET adapter_type = 'codex', updated_at = ?
     WHERE agent_id = ?`,
  ).run(new Date().toISOString(), agent.id);

  const runtime = upsertCompanyRuntime({
    companyIdOrSlug: company.id,
    agentId: agent.id,
    provider: "codex",
    runtimeSlug: "fixture-codex",
    displayName: "Fixture Codex",
    runtimeKind: "cli",
    scope: "agent",
    command: fakeCodex,
    status: "online",
    workspaceRoot: company.workspace.root,
    metadata: { commandPath: fakeCodex, reasoningEffort: "high" },
  }).runtime;

  const activeRuntimeSkill = createCompanySkill(company.id, {
    name: "Fixture Codex Runtime Skill",
    description: "Active approved skill that should be visible to Codex execution.",
    source: "seed",
    scope: "project",
  }).skill;
  updateCompanySkill(company.id, activeRuntimeSkill.id, {
    status: "active",
    reviewState: "approved",
  });
  assignCompanySkillToAgent(company.id, {
    agentId: agent.id,
    skillId: activeRuntimeSkill.id,
    status: "active",
    source: "seed",
  });
  assert.deepStrictEqual(
    listRuntimeAgentSkills(company.id, agent.id).skills.map((skill) => skill.slug),
    ["fixture-codex-runtime-skill"],
  );

  const task = createTask({
    projectId: project.id,
    title: "Run Codex adapter fixture",
    description: "Exercise the Codex execution adapter without OpenClaw.",
    priority: "P2",
    type: "maintenance",
    status: "in-progress",
    assignee: agent.id,
    labels: [],
    createdBy: "test",
    modelLane: "fast",
  }).task;

  await test("heartbeat run dispatches through Codex CLI and records task evidence", async () => {
    const wake = enqueueWakeup({
      agentId: agent.id,
      companyId: company.id,
      source: "explicit",
      reason: "codex execution adapter test",
      invocationSource: "on_demand",
      contextSnapshot: {
        wakeSource: "test",
        wakeReason: "codex_execution_adapter",
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
    assert.ok(args.startsWith("exec --json --full-auto "), `unexpected args: ${args}`);
    assert.ok(args.includes(`--add-dir ${realpathSync(runtime.workspaceRoot ?? company.workspace.root)}`), `agent runtime workspace must stay writable: ${args}`);
    assert.ok(!args.includes(`--add-dir ${realpathSync(process.cwd())}`), `non-core source workspace should not be writable: ${args}`);
    assert.ok(args.includes('-c model_reasoning_effort="high"'), `high reasoning metadata should pass through: ${args}`);
    assert.ok(args.includes("--model gpt-5.3-codex-spark"), `fast lane should override the agent model: ${args}`);
    assert.ok(args.includes("--output-last-message"), `unexpected args: ${args}`);
    assert.ok(args.trim().endsWith(" -"), `prompt should be read from stdin, unexpected args: ${args}`);
    assert.ok(!args.includes("Run Codex adapter fixture"), "prompt should not be passed as argv");
    const stdinText = readFileSync(stdinFile, "utf8");
    assert.ok(stdinText.includes("---RUN---"), "fake CLI should receive stdin pipe");
    assert.ok(stdinText.includes("Fixture Codex Runtime Skill"), `approved runtime skill should be injected into prompt. Prompt excerpt: ${stdinText.slice(0, 1800)}`);

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
    assert.strictEqual(executionRun!.provider, "codex");
    assert.strictEqual(executionRun!.runner_provider, "codex");
    assert.strictEqual(executionRun!.runner_model, "gpt-5.3-codex-spark");
    assert.strictEqual(executionRun!.status, "completed");
    const metadata = JSON.parse(executionRun!.token_usage_json ?? "{}") as Record<string, unknown>;
    assert.strictEqual(metadata.provider, "codex");
    assert.strictEqual(metadata.runnerProvider, "codex");
    assert.strictEqual(metadata.runnerModel, "gpt-5.3-codex-spark");
    assert.strictEqual(metadata.integrationPath, "cli-json-events");
    assert.strictEqual(metadata.model, "gpt-5.3-codex-spark");
    assert.strictEqual(metadata.taskModelLane, "fast");
    assert.strictEqual(metadata.taskModelRoutingLabel, "Fast lane");
    assert.strictEqual(metadata.speedPreference, "fast_1_5x");
    assert.strictEqual(metadata.runtimeSkillCount, 1);
    assert.deepStrictEqual(
      (metadata.runtimeSkills as Array<{ slug: string }>).map((skill) => skill.slug),
      ["fixture-codex-runtime-skill"],
    );
    assert.strictEqual(metadata.structuredTelemetry, true);
    assert.strictEqual(metadata.observedLiveText, true);
    assert.strictEqual(metadata.observedStructuredTools, true);
    assert.strictEqual(metadata.inputTokens, 1234);
    assert.strictEqual(metadata.outputTokens, 56);
    assert.strictEqual(metadata.cacheReadInputTokens, 78);
    assert.strictEqual(metadata.cacheCreationInputTokens, 9);
    assert.strictEqual(metadata.totalTokens, 1377);
    assert.ok(Array.isArray(metadata.toolCallNames));
    assert.ok((metadata.toolCallNames as string[]).includes("shell"));
    assert.ok(Array.isArray(metadata.additionalWritableDirs));
    assert.ok(String(metadata.stdoutTail ?? "").includes("fake codex completed"));
    assert.ok(Number(metadata.transcriptEventCount ?? 0) >= 9);
    const diagnostics = metadata.diagnostics as Record<string, unknown> | undefined;
    assert.ok(diagnostics, "Codex usage should include process diagnostics");
    assert.ok(Number(diagnostics!.promptChars ?? 0) > 0, "diagnostics should include prompt size");
    assert.strictEqual(diagnostics!.timeoutMs, 15000);
    assert.strictEqual(diagnostics!.timedOut, false);
    assert.ok(Number(diagnostics!.stdoutBytes ?? 0) > 0, "diagnostics should include stdout bytes");

    const transcriptEvents = db
      .prepare(
        `SELECT event_kind, role, title, body
         FROM execution_run_transcript_events
         WHERE execution_run_id = ?
         ORDER BY sequence ASC`,
      )
      .all(executionRun!.id) as Array<{ event_kind: string; role: string | null; title: string | null; body: string }>;
    assert.ok(transcriptEvents.length >= 3);
    assert.strictEqual(transcriptEvents[0]?.event_kind, "run_start");
    assert.ok(transcriptEvents.some((event) => event.event_kind === "provider_event" && event.title === "Codex process started"));
    assert.ok(transcriptEvents.some((event) => event.event_kind === "provider_event" && event.title === "Codex prompt sent"));
    assert.ok(transcriptEvents.some((event) => event.event_kind === "assistant_text_delta"));
    assert.ok(transcriptEvents.some((event) => event.event_kind === "tool_call_start"));
    assert.ok(transcriptEvents.some((event) => event.event_kind === "tool_result"));
    assert.ok(transcriptEvents.some((event) => event.event_kind === "assistant_text_final" && event.body.includes("fake codex completed")));
    assert.strictEqual(transcriptEvents[transcriptEvents.length - 1]?.event_kind, "run_end");

    const comment = db
      .prepare(
        `SELECT body
         FROM comments
         WHERE task_id = ? AND author_agent_id = ? AND external_ref LIKE 'codex:%'
         LIMIT 1`,
      )
      .get(task.id, agent.id) as { body: string } | undefined;
    assert.ok(comment, "Codex adapter should add a task evidence comment");
    assert.ok(comment!.body.includes("Codex execution completed."));
    assert.ok(comment!.body.includes("fake codex completed"));

    const runtimeState = db
      .prepare(
        `SELECT adapter_type, last_run_id, last_run_status, last_error
         FROM agent_runtime_state
         WHERE agent_id = ?`,
      )
      .get(agent.id) as {
        adapter_type: string;
        last_run_id: string | null;
        last_run_status: string | null;
        last_error: string | null;
      };
    assert.strictEqual(runtimeState.adapter_type, "codex");
    assert.strictEqual(runtimeState.last_run_id, wake.heartbeatRunId);
    assert.strictEqual(runtimeState.last_run_status, "succeeded");
    assert.strictEqual(runtimeState.last_error, null);
  });

  await test("manual heartbeat execution refuses preclaimed running runs", async () => {
    const preclaimedTask = createTask({
      projectId: project.id,
      title: "Run preclaimed heartbeat fixture",
      description: "Simulate a tick claiming the run before a manual trigger arrives.",
      priority: "P2",
      type: "maintenance",
      status: "in-progress",
      assignee: agent.id,
      labels: [],
      createdBy: "test",
    }).task;

    writeFileSync(cwdFile, "before-preclaimed-run", "utf8");
    writeFileSync(argsFile, "before-preclaimed-run", "utf8");

    const wake = enqueueWakeup({
      agentId: agent.id,
      companyId: company.id,
      source: "explicit",
      reason: "preclaimed heartbeat guard test",
      invocationSource: "on_demand",
      contextSnapshot: {
        wakeSource: "test",
        wakeReason: "preclaimed_heartbeat_guard",
        taskId: preclaimedTask.id,
      },
    }, db);

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE heartbeat_runs SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?`,
    ).run(now, now, wake.heartbeatRunId);
    db.prepare(
      `UPDATE agent_wakeup_requests SET status = 'claimed', claimed_at = ?, updated_at = ? WHERE id = ?`,
    ).run(now, now, wake.wakeupRequestId);

    try {
      const result = await executeHeartbeatRun(wake.heartbeatRunId, db);
      assert.strictEqual(result.status, "running");
      assert.strictEqual(result.error, "Run is already running; another executor claimed it");
      assert.strictEqual(readFileSync(cwdFile, "utf8"), "before-preclaimed-run");
      assert.strictEqual(readFileSync(argsFile, "utf8"), "before-preclaimed-run");
    } finally {
      const finishedAt = new Date().toISOString();
      db.prepare(
        `UPDATE heartbeat_runs SET status = 'cancelled', finished_at = ?, error = ?, updated_at = ? WHERE id = ?`,
      ).run(finishedAt, "test cleanup", finishedAt, wake.heartbeatRunId);
      db.prepare(
        `UPDATE agent_wakeup_requests SET status = 'failed', finished_at = ?, updated_at = ? WHERE id = ?`,
      ).run(finishedAt, finishedAt, wake.wakeupRequestId);
    }
  });

  await test("protected runtime execution requires approval before Codex runs", async () => {
    const protectedTask = createTask({
      projectId: project.id,
      title: "Deploy production database migration",
      description: "Run `prisma migrate deploy` against production after updating .env.production.",
      priority: "P1",
      type: "maintenance",
      status: "in-progress",
      assignee: agent.id,
      labels: [],
      createdBy: "test",
    }).task;

    writeFileSync(cwdFile, "before-protected-run", "utf8");
    writeFileSync(argsFile, "before-protected-run", "utf8");
    db.prepare("UPDATE agents SET status = 'working' WHERE id = ?").run(agent.id);

    const blockedWake = enqueueWakeup({
      agentId: agent.id,
      companyId: company.id,
      source: "explicit",
      reason: "protected codex execution adapter test",
      invocationSource: "on_demand",
      contextSnapshot: {
        wakeSource: "test",
        wakeReason: "protected_codex_execution_adapter",
        taskId: protectedTask.id,
      },
    }, db);

    const blocked = await executeHeartbeatRun(blockedWake.heartbeatRunId, db);
    assert.strictEqual(blocked.status, "cancelled");
    assert.ok(blocked.error?.includes("requires approval"), "blocked run should explain approval requirement");
    assert.strictEqual(readFileSync(cwdFile, "utf8"), "before-protected-run");
    assert.strictEqual(readFileSync(argsFile, "utf8"), "before-protected-run");
    const blockedAgent = db
      .prepare("SELECT status FROM agents WHERE id = ? LIMIT 1")
      .get(agent.id) as { status: string } | undefined;
    assert.strictEqual(blockedAgent?.status, "idle", "approval-gated runs should clear the working state");
    const blockedRuntimeState = db
      .prepare("SELECT last_run_id, last_run_status, last_error FROM agent_runtime_state WHERE agent_id = ? LIMIT 1")
      .get(agent.id) as { last_run_id: string | null; last_run_status: string | null; last_error: string | null } | undefined;
    assert.strictEqual(blockedRuntimeState?.last_run_id, blockedWake.heartbeatRunId);
    assert.strictEqual(blockedRuntimeState?.last_run_status, "cancelled");
    assert.ok(blockedRuntimeState?.last_error?.includes("requires approval"));

    const approval = db
      .prepare(
        `SELECT id, status, payload_json
         FROM approvals
         WHERE type = 'protected_runtime_command'
           AND linked_task_id = ?
         LIMIT 1`,
      )
      .get(protectedTask.id) as { id: string; status: string; payload_json: string } | undefined;
    assert.ok(approval, "protected approval should be created");
    assert.strictEqual(approval!.status, "pending");
    const payload = JSON.parse(approval!.payload_json) as Record<string, unknown>;
    assert.strictEqual(payload.provider, "codex");
    assert.strictEqual(payload.taskId, protectedTask.id);

    const blockedExecutionRunCount = (
      db.prepare("SELECT COUNT(*) AS count FROM execution_runs WHERE task_id = ?")
        .get(protectedTask.id) as { count: number }
    ).count;
    assert.strictEqual(blockedExecutionRunCount, 0, "no execution_run before approval");

    updateApprovalStatus({
      approvalId: approval!.id,
      status: "approved",
      decidedByUserId: "test",
      decisionNote: "Fixture approval",
    });

    const approvedWake = enqueueWakeup({
      agentId: agent.id,
      companyId: company.id,
      source: "explicit",
      reason: "protected codex execution approved",
      invocationSource: "on_demand",
      contextSnapshot: {
        wakeSource: "test",
        wakeReason: "protected_codex_execution_adapter_approved",
        taskId: protectedTask.id,
      },
    }, db);

    const approved = await executeHeartbeatRun(approvedWake.heartbeatRunId, db);
    assert.strictEqual(approved.status, "succeeded", approved.error ?? "approved protected run should execute");
    assert.ok(readFileSync(argsFile, "utf8").trim().endsWith(" -"), "approved run should read prompt from stdin");

    const executionRun = db
      .prepare(
        `SELECT provider, status
         FROM execution_runs
         WHERE task_id = ?
         LIMIT 1`,
      )
      .get(protectedTask.id) as { provider: string; status: string } | undefined;
    assert.ok(executionRun, "execution_run should be created after approval");
    assert.strictEqual(executionRun!.provider, "codex");
    assert.strictEqual(executionRun!.status, "completed");
  });

  await test("hire actions inherit requesting Codex runtime defaults", async () => {
    const outcome = await executeMcAction(
      {
        action: "hire_agent",
        name: "Codex Inherited Engineer",
        role: "Implementation Engineer",
        capabilities: "Implement scoped tasks in the QA workspace.",
        reason: "Verify runtime inheritance.",
      },
      {
        agentId: agent.id,
        agentName: agent.name,
        companyId: company.id,
        taskKey: task.id,
        runId: "test-hire-runtime-inheritance",
      },
      db,
    );

    assert.strictEqual(outcome.kind, "created_approval");
    const approval = db
      .prepare(
        `SELECT payload_json
         FROM approvals
         WHERE company_id = ?
           AND type = 'hire_agent'
           AND json_extract(payload_json, '$.name') = 'Codex Inherited Engineer'
         LIMIT 1`,
      )
      .get(company.id) as { payload_json: string } | undefined;
    assert.ok(approval, "hire approval should be created");
    const payload = JSON.parse(approval!.payload_json) as { agentId: string; runtimeProvider?: string; model?: string };
    assert.strictEqual(payload.runtimeProvider, "codex");
    assert.strictEqual(payload.model, "openai-codex/gpt-5.3-codex");

    const inheritedAgent = db
      .prepare(
        `SELECT adapter_type, model, status
         FROM agents
         WHERE id = ?`,
      )
      .get(payload.agentId) as { adapter_type: string; model: string; status: string } | undefined;
    assert.strictEqual(inheritedAgent?.adapter_type, "codex");
    assert.strictEqual(inheritedAgent?.model, "openai-codex/gpt-5.3-codex");
    assert.strictEqual(inheritedAgent?.status, "paused");
  });

  await test("empty successful Codex output fails instead of creating fake progress", async () => {
    process.env.FAKE_CODEX_EMPTY_OUTPUT = "1";
    try {
      const emptyTask = createTask({
        projectId: project.id,
        title: "Run Codex empty output fixture",
        description: "Codex exits successfully but produces no assistant response.",
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
        reason: "empty codex output test",
        invocationSource: "on_demand",
        contextSnapshot: {
          wakeSource: "test",
          wakeReason: "empty_codex_output",
          taskId: emptyTask.id,
        },
      }, db);

      const result = await executeHeartbeatRun(wake.heartbeatRunId, db);
      assert.strictEqual(result.status, "failed");
      assert.strictEqual(result.error, "codex exec completed without assistant output");

      const executionRun = db
        .prepare(
          `SELECT status, error_message, token_usage_json
           FROM execution_runs
           WHERE task_id = ?
           LIMIT 1`,
        )
        .get(emptyTask.id) as { status: string; error_message: string | null; token_usage_json: string | null } | undefined;
      assert.ok(executionRun, "execution_run should be created");
      assert.strictEqual(executionRun!.status, "failed");
      assert.strictEqual(executionRun!.error_message, "codex exec completed without assistant output");
      const usage = JSON.parse(executionRun!.token_usage_json ?? "{}") as {
        taskEvidenceCommentCreated?: boolean;
        stdoutTail?: string;
        stderrTail?: string;
        transcriptEventCount?: number;
        diagnostics?: Record<string, unknown>;
      };
      assert.strictEqual(usage.taskEvidenceCommentCreated, false);
      assert.strictEqual(usage.stdoutTail, "");
      assert.ok(String(usage.stderrTail ?? "").includes("Reading additional input from stdin"));
      assert.strictEqual(usage.diagnostics?.timedOut, false);
      assert.ok(Number(usage.diagnostics?.stderrBytes ?? 0) > 0, "diagnostics should capture stderr bytes");
      assert.ok(Number(usage.transcriptEventCount ?? 0) >= 6);

      const commentCount = (
        db.prepare(
          `SELECT COUNT(*) AS count
           FROM comments
           WHERE task_id = ?
             AND author_agent_id = ?
             AND external_ref LIKE 'codex:%'`,
        ).get(emptyTask.id, agent.id) as { count: number }
      ).count;
      assert.strictEqual(commentCount, 0, "empty Codex output should not create fake evidence comments");
    } finally {
      delete process.env.FAKE_CODEX_EMPTY_OUTPUT;
    }
  });

  await test("negated production references do not require protected runtime approval", async () => {
    const safeTask = createTask({
      projectId: project.id,
      title: "QA workspace-only orchestration test",
      description: "Do not touch production systems or production companies. Use disposable non-production sample data only. No secrets, credentials, or .env files are needed. Stay inside this isolated QA workspace.",
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
      reason: "negated production reference test",
      invocationSource: "on_demand",
      contextSnapshot: {
        wakeSource: "test",
        wakeReason: "negated_production_reference",
        taskId: safeTask.id,
      },
    }, db);

    const result = await executeHeartbeatRun(wake.heartbeatRunId, db);
    assert.strictEqual(result.status, "succeeded", result.error ?? "negated production reference should not block");

    const approvalCount = (
      db.prepare(
        `SELECT COUNT(*) AS count
         FROM approvals
         WHERE type = 'protected_runtime_command'
           AND linked_task_id = ?`,
      ).get(safeTask.id) as { count: number }
    ).count;
    assert.strictEqual(approvalCount, 0, "no protected approval for negated production-only wording");
  });

  await test("non-core company Codex runs do not receive app source as writable add-dir", async () => {
    const agentWorkspace = path.join(company.workspace.root, "agents", "codex-runner");
    mkdirSync(agentWorkspace, { recursive: true });
    upsertCompanyRuntime({
      companyIdOrSlug: company.id,
      agentId: agent.id,
      provider: "codex",
      runtimeSlug: "fixture-codex",
      displayName: "Fixture Codex",
      runtimeKind: "cli",
      scope: "agent",
      command: fakeCodex,
      status: "online",
      workspaceRoot: agentWorkspace,
      metadata: { commandPath: fakeCodex },
    });

    const isolatedTask = createTask({
      projectId: project.id,
      title: "Write company project artifact only",
      description: "Create project files under the company workspace; do not modify the app repo.",
      priority: "P2",
      type: "feature",
      status: "in-progress",
      assignee: agent.id,
      labels: [],
      createdBy: "test",
    }).task;

    const wake = enqueueWakeup({
      agentId: agent.id,
      companyId: company.id,
      source: "explicit",
      reason: "non-core source writable guard test",
      invocationSource: "on_demand",
      contextSnapshot: {
        wakeSource: "test",
        wakeReason: "non_core_source_writable_guard",
        taskId: isolatedTask.id,
      },
    }, db);

    const result = await executeHeartbeatRun(wake.heartbeatRunId, db);
    assert.strictEqual(result.status, "succeeded", result.error ?? "non-core codex run should execute");
    assert.strictEqual(realpathSync(readFileSync(cwdFile, "utf8").trim()), realpathSync(company.workspace.root));
    const args = readFileSync(argsFile, "utf8");
    assert.ok(args.includes(agentWorkspace), "agent runtime workspace should remain writable");
    assert.ok(!args.includes(process.cwd()), "app repo must not be passed as a writable add-dir for non-core companies");
  });

  await test("company setting can disable protected runtime approvals", async () => {
    updateCompanyRuntimeGovernanceSettings({
      companyIdOrSlug: company.id,
      requireProtectedRuntimeApprovals: false,
      db,
    });

    const ungatedTask = createTask({
      projectId: project.id,
      title: "Run protected command during fixture",
      description: "Run `prisma migrate deploy` against production after updating .env.production.",
      priority: "P1",
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
      reason: "runtime governance disabled test",
      invocationSource: "on_demand",
      contextSnapshot: {
        wakeSource: "test",
        wakeReason: "runtime_governance_disabled",
        taskId: ungatedTask.id,
      },
    }, db);

    const result = await executeHeartbeatRun(wake.heartbeatRunId, db);
    assert.strictEqual(result.status, "succeeded", result.error ?? "disabled runtime gate should allow execution");
    assert.ok(readFileSync(argsFile, "utf8").trim().endsWith(" -"), "ungated run should read prompt from stdin");

    const approvalCount = (
      db.prepare(
        `SELECT COUNT(*) AS count
         FROM approvals
         WHERE type = 'protected_runtime_command'
           AND linked_task_id = ?`,
      ).get(ungatedTask.id) as { count: number }
    ).count;
    assert.strictEqual(approvalCount, 0, "runtime governance disabled should not create protected approvals");

    updateCompanyRuntimeGovernanceSettings({
      companyIdOrSlug: company.id,
      requireProtectedRuntimeApprovals: true,
      db,
    });
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
