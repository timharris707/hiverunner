import assert from "node:assert";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let passed = 0;
let failed = 0;

type SymphonyFixturePayload = {
  schema: string;
  runId: string;
  executionEngine: string;
  runnerProvider: string;
  runnerModel: string | null;
  modelLane: string;
  modelRouting?: string | null;
  modelRoutingLabel?: string | null;
  activeHiveId?: string | null;
  activeHiveName?: string | null;
  execution: {
    engine: string;
    runnerProvider: string;
    runnerModel: string | null;
    modelLane: string;
    modelRoutingMode?: string | null;
    modelRoutingLabel?: string | null;
    activeHiveId?: string | null;
    activeHiveName?: string | null;
    modelRouting: {
      label: string;
      model: string | null;
      reasoningEffort: string | null;
      speedPreference: string | null;
    };
  };
  task: {
    id: string;
    key: string | null;
    title: string;
    symphonyIssue: {
      id: string;
      identifier: string;
      title: string;
      description: string;
      priority: number | null;
      state: string;
      branch_name: string;
      url: string | null;
      assignee_id: string | null;
      blocked_by: Array<{ identifier: string }>;
      labels: string[];
      assigned_to_worker: boolean;
      created_at: string | null;
      updated_at: string | null;
      metadata: {
        source: string;
        priority: string;
        type: string;
        status: string;
      };
    };
    company: {
      id: string;
    };
  };
  issue: {
    id: string;
    identifier: string;
    title: string;
    description: string;
    priority: number | null;
    state: string;
    branch_name: string;
    url: string | null;
    assignee_id: string | null;
    blocked_by: Array<{ identifier: string }>;
    labels: string[];
    assigned_to_worker: boolean;
    created_at: string | null;
    updated_at: string | null;
    metadata: {
      source: string;
      priority: string;
      type: string;
      status: string;
    };
  } | null;
  agent: {
    id: string;
    runtimeSkills?: Array<{
      slug: string;
      name: string;
      version: number;
    }>;
  };
  session: {
    adapterType: string;
  };
  workspace: {
    cwd: string;
    companyWorkspaceRoot?: string | null;
    sourceWorkspaceRoot?: string | null;
    additionalWritableDirs?: string[];
    runtimeCapabilities?: {
      trustedLocalExecution?: boolean;
      sandbox?: string | null;
      approvalPolicy?: string | null;
      capabilities?: string[];
    };
  };
  prompt: string;
};

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

function writeFakeSymphonyCli(binDir: string): string {
  const file = path.join(binDir, "symphony");
  writeFileSync(
    file,
    `#!${process.execPath}
const fs = require("fs");

fs.writeFileSync(process.env.FAKE_SYMPHONY_CWD_FILE, process.cwd(), "utf8");
fs.writeFileSync(process.env.FAKE_SYMPHONY_ARGS_FILE, process.argv.slice(2).join(" "), "utf8");
if (process.env.FAKE_SYMPHONY_ENV_FILE) {
  fs.writeFileSync(process.env.FAKE_SYMPHONY_ENV_FILE, JSON.stringify({
    sandbox: process.env.HIVERUNNER_SYMPHONY_SANDBOX || null,
    approvalPolicy: process.env.HIVERUNNER_SYMPHONY_APPROVAL_POLICY || null,
    model: process.env.HIVERUNNER_SYMPHONY_MODEL || null
  }), "utf8");
}

const input = fs.readFileSync(0, "utf8");
fs.writeFileSync(process.env.FAKE_SYMPHONY_STDIN_FILE, input, "utf8");

const payload = JSON.parse(input);
if (process.env.FAKE_SYMPHONY_MODE === "self-sigterm") {
  process.stderr.write("fixture runner sending SIGTERM to itself\\n");
  process.kill(process.pid, "SIGTERM");
  return;
}
if (process.env.FAKE_SYMPHONY_MODE === "sleep") {
  process.stderr.write("fixture runner sleeping past adapter timeout\\n");
  setTimeout(() => process.stdout.write(JSON.stringify({ sessionId: "late-session", resultText: "too late" })), 60_000);
  return;
}
const taskKey = payload.task && payload.task.key ? payload.task.key : "SYM-1";
const action = JSON.stringify({ action: "update_task", taskKey, status: "review" });

process.stdout.write(JSON.stringify({
  sessionId: "symphony-fixture-session",
  resultText: "External runner completed fixture work.\\n\\n\`\`\`mc-action\\n" + action + "\\n\`\`\`",
  assistantSummary: "External runner completed fixture work.",
  inputTokens: 11,
  outputTokens: 7,
  totalTokens: 18,
  usage: process.env.FAKE_SYMPHONY_USAGE_MODEL ? {
    runnerModel: process.env.FAKE_SYMPHONY_USAGE_RUNNER_MODEL || null,
    model: process.env.FAKE_SYMPHONY_USAGE_MODEL
  } : undefined,
  transcriptEvents: [
    {
      role: "assistant",
      kind: "message",
      title: "External runner result",
      body: "External runner completed fixture work."
    }
  ]
}) + "\\n");
`,
    "utf8",
  );
  chmodSync(file, 0o755);
  return file;
}

async function run() {
  console.log("\nExternal Runner Execution Adapter Tests\n");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "orchestration-symphony-execution-"));
  const homeDir = path.join(tempRoot, "home");
  const binDir = path.join(tempRoot, "bin");
  const dbPath = path.join(tempRoot, "orchestration.db");
  const workspaceRoot = path.join(homeDir, ".mission-control", "dev", "workspaces");
  const cwdFile = path.join(tempRoot, "cwd.txt");
  const argsFile = path.join(tempRoot, "args.txt");
  const envFile = path.join(tempRoot, "env.json");
  const stdinFile = path.join(tempRoot, "stdin.json");

  mkdirSync(binDir, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  const fakeSymphony = writeFakeSymphonyCli(binDir);

  process.env.HOME = homeDir;
  process.env.ORCHESTRATION_DB_PATH = dbPath;
  process.env.MC_WORKSPACE_ROOT = workspaceRoot;
  process.env.PATH = `${path.dirname(process.execPath)}:${binDir}`;
  process.env.FAKE_SYMPHONY_CWD_FILE = cwdFile;
  process.env.FAKE_SYMPHONY_ARGS_FILE = argsFile;
  process.env.FAKE_SYMPHONY_ENV_FILE = envFile;
  process.env.FAKE_SYMPHONY_STDIN_FILE = stdinFile;
  process.env.SYMPHONY_EXEC_TIMEOUT_MS = "15000";
  process.env.MC_DEV_EXECUTION_TEST_MODE = "1";
  process.env.PORT = "3010";
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";

  try {
    const { createCompany } = await import("@/lib/orchestration/company-service");
    const { getOrchestrationDb, closeOrchestrationDb } = await import("@/lib/orchestration/db");
    const { createProject, createProjectAgent, createTask, getTask } = await import("@/lib/orchestration/service");
    const { assignCompanySkillToAgent, createCompanySkill, updateCompanySkill } = await import("@/lib/orchestration/company-skills");
    const { updateDevExecutionTestMode } = await import("@/lib/orchestration/service/dev-execution-test-mode");
    const { executeHeartbeatRun } = await import("@/lib/orchestration/engine/engine");
    const { cancelTaskExecution, pollTaskExecutionStatus, triggerTaskExecution } = await import("@/lib/orchestration/execution");
    const { upsertCompanyRuntime } = await import("@/lib/orchestration/runtime-registry");
    const { ensureCompanyExecutionHives } = await import("@/lib/orchestration/service/execution-hives");

    const db = getOrchestrationDb();
    const company = createCompany({
      name: "External Runner Execution Co",
      description: "External runner adapter fixture.",
      status: "active",
    }).company;
    const project = createProject({
      companyId: company.id,
      name: "External Runner Execution Project",
      description: "fixture",
      color: "#0ea5e9",
      emoji: "S",
      status: "active",
    }).project;
    const agent = createProjectAgent({
      projectId: project.id,
      name: "HiveRunner Agent",
      emoji: "H",
      role: "Engineer",
      personality: "Runs selected tasks.",
      status: "idle",
      skills: [],
    }).agent;

    function setActiveHiveDefaultRoute(input: {
      runtimeId: string;
      runtimeLabel: string;
      modelLabel?: string | null;
      mode?: string;
    }) {
      ensureCompanyExecutionHives({ companyIdOrSlug: company.id }, db);
      const row = db
        .prepare(
          `SELECT id, lanes_json
           FROM company_execution_hives
           WHERE company_id = ? AND archived_at IS NULL AND is_active = 1
           LIMIT 1`,
        )
        .get(company.id) as { id: string; lanes_json: string } | undefined;
      assert.ok(row, "active execution hive should exist");
      const lanes = JSON.parse(row!.lanes_json) as Array<Record<string, unknown>>;
      const updated = lanes.map((lane) => lane.id === "default"
        ? {
            ...lane,
            primary: {
              mode: input.mode ?? "runtime_managed",
              runtimeId: input.runtimeId,
              runtimeLabel: input.runtimeLabel,
              ...(input.modelLabel ? { modelLabel: input.modelLabel } : {}),
            },
            fallbacks: [],
          }
        : lane);
      db.prepare(
        `UPDATE company_execution_hives
         SET orchestration_mode = 'symphony',
             lanes_json = ?,
             updated_at = ?
         WHERE id = ?`,
      ).run(JSON.stringify(updated), new Date().toISOString(), row!.id);
    }

    setActiveHiveDefaultRoute({ runtimeId: "codex", runtimeLabel: "Codex" });
    const staleQaAgent = createProjectAgent({
      projectId: project.id,
      name: "QA Batch Fixture",
      emoji: "Q",
      role: "QA",
      personality: "Old generated QA fixture that must not receive fresh review handoffs.",
      status: "idle",
      skills: [],
    }).agent;
    db.prepare("UPDATE agents SET adapter_type = ?, runtime_slug = ? WHERE id = ?")
      .run("symphony", "qa-batch-fixture", staleQaAgent.id);
    upsertCompanyRuntime({
      companyIdOrSlug: company.id,
      agentId: staleQaAgent.id,
      provider: "symphony",
      runtimeSlug: "qa-batch-fixture",
      displayName: "Stale QA Batch Runtime",
      runtimeKind: "cli",
      scope: "agent",
      command: path.join(tempRoot, "missing-stale-qa-runner.mjs"),
      status: "error",
      workspaceRoot: path.join(company.workspace.root, "agents", "qa-batch-fixture"),
      metadata: {
        health: {
          status: "failed_probe",
          error: "missing stale QA runner",
        },
      },
    });

    const agentScopedRuntimeRoot = path.join(company.workspace.root, "agents", "hiverunner-agent");
    upsertCompanyRuntime({
      companyIdOrSlug: company.id,
      agentId: agent.id,
      provider: "symphony",
      runtimeSlug: "fixture-symphony",
      displayName: "Fixture External Runner",
      runtimeKind: "cli",
      scope: "agent",
      command: fakeSymphony,
      status: "online",
      workspaceRoot: agentScopedRuntimeRoot,
      metadata: {
        commandPath: fakeSymphony,
        commandArgs: ["--fixture"],
        hiverunnerSymphony: {
          sandbox: "danger-full-access",
          approvalPolicy: "never",
          model: "openai-codex/gpt-5.4-mini",
        },
        trustedLocalExecution: {
          enabled: true,
          capabilities: ["docker", "local-postgres", "loopback-services", "playwright-video-recording"],
          notes: "Fixture trusted local execution profile.",
        },
      },
    });

    const activeRuntimeSkill = createCompanySkill(company.id, {
      name: "Fixture External Runner Runtime Skill",
      description: "Active approved skill that should be visible to the external runner payload.",
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

    updateDevExecutionTestMode({
      companyIdOrSlug: company.id,
      enabled: true,
      durationMinutes: 5,
      actor: "test",
      note: "External runner adapter test",
    }, db);

    const task = createTask({
      projectId: project.id,
      title: "Run external runner adapter fixture",
      description: "Exercise the external runner execution adapter from a HiveRunner task.",
      priority: "P1",
      type: "feature",
      status: "in-progress",
      assignee: agent.id,
      labels: ["symphony"],
      createdBy: "test",
      executionEngine: "symphony",
    }).task;

    await test("task executionEngine=symphony dispatches through the external runner contract", async () => {
      const queued = await triggerTaskExecution({
        taskId: task.id,
        reason: "symphony_execution_adapter_test",
      });

      assert.strictEqual(queued.mode, "symphony");
      assert.strictEqual(queued.status, "queued");
      assert.strictEqual(queued.queued, true);
      assert.ok(queued.runId, "triggerTaskExecution should enqueue a heartbeat run");

      const result = await executeHeartbeatRun(queued.runId!, db);
      assert.strictEqual(result.status, "succeeded", result.error ?? "heartbeat should succeed");
      assert.strictEqual(result.error, null);

      const payload = JSON.parse(readFileSync(stdinFile, "utf8")) as SymphonyFixturePayload;
      assert.strictEqual(realpathSync(readFileSync(cwdFile, "utf8").trim()), realpathSync(payload.workspace.cwd));
      assert.strictEqual(
        realpathSync(payload.workspace.cwd),
        realpathSync(company.workspace.root),
        "External runner should use the shared company workspace even when the selected runtime is agent-scoped",
      );
      assert.ok(
        realpathSync(payload.workspace.cwd).startsWith(realpathSync(company.workspace.root)),
        "External runner should run inside the company workspace tree",
      );
      assert.strictEqual(readFileSync(argsFile, "utf8"), "--fixture");

      assert.strictEqual(payload.schema, "hiverunner.symphony.execution.v1");
      assert.strictEqual(payload.runId, queued.runId);
      assert.strictEqual(payload.executionEngine, "symphony");
      assert.strictEqual(payload.runnerProvider, "codex");
      assert.strictEqual(payload.runnerModel, "gpt-5.4-mini");
      assert.strictEqual(payload.modelLane, "default");
      assert.strictEqual(payload.execution.engine, "symphony");
      assert.strictEqual(payload.execution.runnerProvider, "codex");
      assert.strictEqual(payload.execution.runnerModel, "gpt-5.4-mini");
      assert.strictEqual(payload.task.id, task.id);
      assert.strictEqual(payload.task.key, task.key);
      assert.strictEqual(payload.task.title, "Run external runner adapter fixture");
      assert.strictEqual(payload.task.company.id, company.id);
      assert.ok(payload.issue, "payload should include an upstream-compatible normalized issue");
      assert.strictEqual(payload.issue!.id, task.id);
      assert.strictEqual(payload.issue!.identifier, task.key);
      assert.strictEqual(payload.issue!.title, "Run external runner adapter fixture");
      assert.strictEqual(payload.issue!.description, "Exercise the external runner execution adapter from a HiveRunner task.");
      assert.strictEqual(payload.issue!.priority, 2);
      assert.strictEqual(payload.issue!.state, "in_progress");
      assert.ok(payload.issue!.branch_name.includes(String(task.key).toLowerCase()));
      assert.deepStrictEqual(payload.issue!.labels, ["symphony"]);
      assert.strictEqual(payload.issue!.assigned_to_worker, true);
      assert.strictEqual(payload.issue!.metadata.source, "hiverunner");
      assert.strictEqual(payload.task.symphonyIssue.identifier, payload.issue!.identifier);
      assert.strictEqual(payload.agent.id, agent.id);
      assert.deepStrictEqual(
        payload.agent.runtimeSkills?.map((skill) => skill.slug),
        ["fixture-external-runner-runtime-skill"],
      );
      assert.strictEqual(payload.session.adapterType, "symphony");
      assert.strictEqual(payload.workspace.runtimeCapabilities?.trustedLocalExecution, true);
      assert.strictEqual(payload.workspace.runtimeCapabilities?.sandbox, "danger-full-access");
      assert.deepStrictEqual(payload.workspace.runtimeCapabilities?.capabilities, [
        "docker",
        "local-postgres",
        "loopback-services",
        "playwright-video-recording",
      ]);
      assert.ok(String(payload.prompt).includes("Run external runner adapter fixture"));
      assert.ok(String(payload.prompt).includes("Fixture External Runner Runtime Skill"));
      const runnerEnv = JSON.parse(readFileSync(envFile, "utf8")) as { sandbox: string | null; approvalPolicy: string | null; model: string | null };
      assert.strictEqual(runnerEnv.sandbox, "danger-full-access");
      assert.strictEqual(runnerEnv.approvalPolicy, "never");
      assert.strictEqual(runnerEnv.model, "gpt-5.4-mini");

      const executionRun = db
        .prepare(
          `SELECT id, provider, execution_engine, runner_provider, runner_model, status, session_id, token_usage_json
           FROM execution_runs
           WHERE task_id = ? AND agent_id = ?
           LIMIT 1`,
        )
        .get(task.id, agent.id) as {
          id: string;
          provider: string;
          execution_engine: string | null;
          runner_provider: string | null;
          runner_model: string | null;
          status: string;
          session_id: string | null;
          token_usage_json: string | null;
        } | undefined;
      assert.ok(executionRun, "execution_run should be created");
      assert.strictEqual(executionRun!.provider, "symphony");
      assert.strictEqual(executionRun!.execution_engine, "symphony");
      assert.strictEqual(executionRun!.runner_provider, "codex");
      assert.strictEqual(executionRun!.runner_model, "gpt-5.4-mini");
      assert.strictEqual(executionRun!.status, "completed");
      assert.strictEqual(executionRun!.session_id, null);

      const usage = JSON.parse(executionRun!.token_usage_json ?? "{}") as Record<string, unknown>;
      assert.strictEqual(usage.provider, "symphony");
      assert.strictEqual(usage.executionEngine, "symphony");
      assert.strictEqual(usage.runnerProvider, "codex");
      assert.strictEqual(usage.runnerModel, "gpt-5.4-mini");
      assert.strictEqual(usage.integrationPath, "hiverunner-symphony-command");
      assert.strictEqual(usage.sessionId, "symphony-fixture-session");
      assert.strictEqual(usage.runtimeSkillCount, 1);
      assert.strictEqual((usage.runnerEnv as { HIVERUNNER_SYMPHONY_SANDBOX?: string }).HIVERUNNER_SYMPHONY_SANDBOX, "danger-full-access");
      assert.strictEqual((usage.runnerEnv as { HIVERUNNER_SYMPHONY_MODEL?: string }).HIVERUNNER_SYMPHONY_MODEL, "gpt-5.4-mini");
      assert.strictEqual((usage.runtimeCapabilities as { trustedLocalExecution?: boolean }).trustedLocalExecution, true);
      assert.deepStrictEqual(
        (usage.runtimeSkills as Array<{ slug: string }>).map((skill) => skill.slug),
        ["fixture-external-runner-runtime-skill"],
      );
      assert.strictEqual(usage.inputTokens, 11);
      assert.strictEqual(usage.outputTokens, 7);
      assert.ok(String(usage.resultText).includes("External runner completed fixture work."));
      assert.strictEqual(usage.transcriptEventCount, 4);
      const workspaceRunVisibility = usage.workspaceRunVisibility as { schema: string; totals: { trackedRoots: number } };
      assert.strictEqual(workspaceRunVisibility.schema, "hiverunner.workspace_run_visibility.v1");
      assert.strictEqual(workspaceRunVisibility.totals.trackedRoots >= 1, true);

      const transcriptCount = db
        .prepare(`SELECT COUNT(*) AS count FROM execution_run_transcript_events WHERE execution_run_id = ? AND provider = 'symphony'`)
        .get(executionRun!.id) as { count: number };
      assert.strictEqual(transcriptCount.count, 4);

      const polled = await pollTaskExecutionStatus(task.id);
      assert.strictEqual(polled.mode, "symphony");
      assert.strictEqual(polled.runId, executionRun!.id);
      assert.strictEqual(polled.status.state, "completed");
      assert.strictEqual(polled.status.raw, "completed");
      assert.strictEqual(polled.status.terminal, true);

      const cancelled = await cancelTaskExecution({ taskId: task.id });
      assert.strictEqual(cancelled.mode, "symphony");
      assert.strictEqual(cancelled.cancelled.status, "skipped");
      assert.strictEqual(cancelled.cancelled.reason, "execution_run_already_terminal");

      assert.strictEqual(getTask(task.id).task.status, "review");
      const routedTask = db
        .prepare(
          `SELECT assignee_agent_id
           FROM tasks
           WHERE id = ?
           LIMIT 1`,
        )
        .get(task.id) as { assignee_agent_id: string | null } | undefined;
      assert.strictEqual(
        routedTask?.assignee_agent_id,
        agent.id,
        "default review handoff should not assign stale QA agents with failed registered runtimes",
      );
    });

    await test("active hive default lane overrides Symphony runtime provider metadata", async () => {
      try {
        setActiveHiveDefaultRoute({ runtimeId: "claude-code", runtimeLabel: "Claude Code" });
        db.prepare("UPDATE companies SET settings_json = ? WHERE id = ?").run(
          JSON.stringify({
            execution: {
              defaultEngine: "symphony",
              defaultModelRouting: "openrouter",
              defaultModelRoutingLabel: "OpenRouter",
              activeHiveId: "fixture-hive",
              activeHiveName: "Fixture Hive",
            },
          }),
          company.id,
        );

        const matrixTask = createTask({
          projectId: project.id,
          title: "Run external runner matrix default fixture",
          description: "Exercise company Matrix runner provider defaults.",
          priority: "P2",
          type: "feature",
          status: "in-progress",
          assignee: agent.id,
          labels: ["symphony"],
          createdBy: "test",
          executionEngine: "symphony",
        }).task;

        const queued = await triggerTaskExecution({
          taskId: matrixTask.id,
          reason: "symphony_execution_matrix_default_test",
        });

        assert.strictEqual(queued.mode, "symphony");
        assert.strictEqual(queued.status, "queued");
        assert.ok(queued.runId, "triggerTaskExecution should enqueue a heartbeat run");

        const result = await executeHeartbeatRun(queued.runId!, db);
        assert.strictEqual(result.status, "succeeded", result.error ?? "heartbeat should succeed");

        const payload = JSON.parse(readFileSync(stdinFile, "utf8")) as SymphonyFixturePayload;
        assert.strictEqual(payload.runnerProvider, "anthropic");
        assert.strictEqual(payload.runnerModel, null);
        assert.strictEqual(payload.modelRouting, "openrouter");
        assert.strictEqual(payload.modelRoutingLabel, "OpenRouter");
        assert.strictEqual(payload.activeHiveName, "Balanced Builder");
        assert.strictEqual(payload.execution.runnerProvider, "anthropic");
        assert.strictEqual(payload.execution.modelRoutingMode, "openrouter");

        const executionRun = db
          .prepare(
            `SELECT provider, runner_provider, runner_model, token_usage_json
             FROM execution_runs
             WHERE task_id = ? AND agent_id = ?
             LIMIT 1`,
          )
          .get(matrixTask.id, agent.id) as {
            provider: string;
            runner_provider: string | null;
            runner_model: string | null;
            token_usage_json: string | null;
          } | undefined;
        assert.ok(executionRun, "execution_run should be created");
        assert.strictEqual(executionRun!.provider, "symphony");
        assert.strictEqual(executionRun!.runner_provider, "anthropic");
        assert.strictEqual(executionRun!.runner_model, null);
        const usage = JSON.parse(executionRun!.token_usage_json ?? "{}") as Record<string, unknown>;
        assert.strictEqual(usage.runnerProvider, "anthropic");
        assert.strictEqual(usage.modelRouting, "openrouter");
        assert.strictEqual(usage.modelRoutingLabel, "OpenRouter");
      } finally {
        db.prepare("UPDATE companies SET settings_json = ? WHERE id = ?").run("{}", company.id);
        setActiveHiveDefaultRoute({ runtimeId: "codex", runtimeLabel: "Codex" });
      }
    });

    await test("external runner usage model backfills the execution-run runner model", async () => {
      const usageModelAgent = createProjectAgent({
        projectId: project.id,
        name: "Usage Model Agent",
        emoji: "U",
        role: "Engineer",
        personality: "Runs selected tasks.",
        status: "idle",
        skills: [],
      }).agent;
      upsertCompanyRuntime({
        companyIdOrSlug: company.id,
        agentId: usageModelAgent.id,
        provider: "symphony",
        runtimeSlug: "usage-model-fixture",
        displayName: "Usage Model Fixture Runner",
        runtimeKind: "cli",
        scope: "agent",
        command: fakeSymphony,
        status: "online",
        workspaceRoot: path.join(company.workspace.root, "agents", "usage-model-fixture"),
        metadata: {
          commandPath: fakeSymphony,
          runnerConfig: {
            provider: "codex",
            model: "openai-codex/gpt-5.4-mini",
          },
        },
      });
      const usageModelTask = createTask({
        projectId: project.id,
        title: "Run usage model fixture",
        description: "Exercise runner-reported concrete model backfill.",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: usageModelAgent.id,
        labels: ["symphony", "usage-model"],
        createdBy: "test",
        executionEngine: "symphony",
      }).task;

      process.env.FAKE_SYMPHONY_USAGE_MODEL = "gpt-5.5";
      try {
        const queued = await triggerTaskExecution({
          taskId: usageModelTask.id,
          reason: "symphony_usage_model_backfill_test",
        });
        assert.ok(queued.runId, "triggerTaskExecution should enqueue a heartbeat run");

        const result = await executeHeartbeatRun(queued.runId!, db);
        assert.strictEqual(result.status, "succeeded", result.error ?? "heartbeat should succeed");

        const executionRun = db
          .prepare(
            `SELECT runner_provider, runner_model, token_usage_json
             FROM execution_runs
             WHERE task_id = ? AND agent_id = ?
             LIMIT 1`,
          )
          .get(usageModelTask.id, usageModelAgent.id) as {
            runner_provider: string | null;
            runner_model: string | null;
            token_usage_json: string | null;
          } | undefined;
        assert.ok(executionRun, "execution_run should be created");
        assert.strictEqual(executionRun!.runner_provider, "codex");
        assert.strictEqual(executionRun!.runner_model, "gpt-5.5");

        const usage = JSON.parse(executionRun!.token_usage_json ?? "{}") as Record<string, unknown>;
        assert.strictEqual(usage.runnerModel, "gpt-5.5");
      } finally {
        delete process.env.FAKE_SYMPHONY_USAGE_MODEL;
      }
    });

    await test("route-selected Anthropic runtime ignores legacy top-level model metadata", async () => {
      const legacyModelAgent = createProjectAgent({
        projectId: project.id,
        name: "Legacy Model Ignore Agent",
        emoji: "L",
        role: "Engineer",
        personality: "Runs selected tasks.",
        status: "idle",
        skills: [],
      }).agent;

      upsertCompanyRuntime({
        companyIdOrSlug: company.id,
        agentId: legacyModelAgent.id,
        provider: "symphony",
        runtimeSlug: "fixture-route-legacy-model-guard",
        displayName: "Fixture External Runner Legacy Model Guard",
        runtimeKind: "cli",
        scope: "agent",
        command: fakeSymphony,
        status: "online",
        workspaceRoot: path.join(company.workspace.root, "agents", "route-legacy-model-guard"),
        metadata: {
          commandPath: fakeSymphony,
          runnerConfig: {
            provider: "anthropic",
            bundledRunner: true,
          },
          model: "openai-codex/gpt-5.5",
        },
      });
      const legacyModelTask = createTask({
        projectId: project.id,
        title: "Route-selected runtime ignores legacy model fixture",
        description: "Exercise route runtime precedence over legacy model metadata fields.",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: legacyModelAgent.id,
        labels: ["symphony", "legacy-model"],
        createdBy: "test",
        executionEngine: "symphony",
      }).task;

      try {
        setActiveHiveDefaultRoute({ runtimeId: "claude-code", runtimeLabel: "Claude Code" });

        const queued = await triggerTaskExecution({
          taskId: legacyModelTask.id,
          reason: "symphony_route_legacy_model_guard_test",
        });
        assert.ok(queued.runId, "triggerTaskExecution should enqueue a heartbeat run");

        const result = await executeHeartbeatRun(queued.runId!, db);
        assert.strictEqual(result.status, "succeeded", result.error ?? "heartbeat should succeed");

        const payload = JSON.parse(readFileSync(stdinFile, "utf8")) as SymphonyFixturePayload;
        assert.strictEqual(payload.runnerProvider, "anthropic");
        assert.strictEqual(payload.runnerModel, null);
        assert.strictEqual(payload.execution.runnerProvider, "anthropic");
        assert.strictEqual(payload.execution.runnerModel, null);

        const executionRun = db
          .prepare(
            `SELECT provider, runner_provider, runner_model, token_usage_json
             FROM execution_runs
             WHERE task_id = ? AND agent_id = ?
             LIMIT 1`,
          )
          .get(legacyModelTask.id, legacyModelAgent.id) as {
            provider: string;
            runner_provider: string | null;
            runner_model: string | null;
            token_usage_json: string | null;
          } | undefined;
        assert.ok(executionRun, "execution_run should be created");
        assert.strictEqual(executionRun!.provider, "symphony");
        assert.strictEqual(executionRun!.runner_provider, "anthropic");
        assert.strictEqual(executionRun!.runner_model, null);

        const usage = JSON.parse(executionRun!.token_usage_json ?? "{}") as Record<string, unknown>;
        assert.strictEqual(usage.runnerProvider, "anthropic");
        assert.strictEqual(usage.runnerModel, null);
        const usageRunnerEnv = usage.runnerEnv as { HIVERUNNER_CLAUDE_MODEL?: string | null };
        assert.ok(!usageRunnerEnv || usageRunnerEnv.HIVERUNNER_CLAUDE_MODEL !== "openai-codex/gpt-5.5");
      } finally {
        setActiveHiveDefaultRoute({ runtimeId: "codex", runtimeLabel: "Codex" });
      }
    });

    await test("legacy task execution routing does not override the active hive lane", async () => {
      try {
        setActiveHiveDefaultRoute({ runtimeId: "claude-code", runtimeLabel: "Claude Code" });
        db.prepare("UPDATE companies SET settings_json = ? WHERE id = ?").run(
          JSON.stringify({
            execution: {
              defaultEngine: "symphony",
              defaultModelRouting: "openrouter",
              defaultModelRoutingLabel: "OpenRouter",
            },
          }),
          company.id,
        );

        const overrideTask = createTask({
          projectId: project.id,
          title: "Run external runner task override fixture",
          description: "Exercise task-level Matrix runner provider overrides.",
          priority: "P2",
          type: "feature",
          status: "in-progress",
          assignee: agent.id,
          labels: ["symphony"],
          createdBy: "test",
          executionEngine: "symphony",
          executionRuntimeProvider: "gemini",
          executionRuntimeLabel: "Gemini CLI",
          executionModelRouting: "google",
          executionModelRoutingLabel: "Google Direct",
        }).task;

        const queued = await triggerTaskExecution({
          taskId: overrideTask.id,
          reason: "symphony_task_execution_routing_override_test",
        });

        assert.strictEqual(queued.mode, "symphony");
        assert.ok(queued.runId, "triggerTaskExecution should enqueue a heartbeat run");

        const result = await executeHeartbeatRun(queued.runId!, db);
        assert.strictEqual(result.status, "succeeded", result.error ?? "heartbeat should succeed");

        const payload = JSON.parse(readFileSync(stdinFile, "utf8")) as SymphonyFixturePayload;
        assert.strictEqual(payload.runnerProvider, "anthropic");
        assert.strictEqual(payload.modelRouting, "google");
        assert.strictEqual(payload.modelRoutingLabel, "Google Direct");
        assert.strictEqual(payload.execution.runnerProvider, "anthropic");
        assert.strictEqual(payload.execution.modelRoutingMode, "google");

        const executionRun = db
          .prepare(
            `SELECT runner_provider, token_usage_json
             FROM execution_runs
             WHERE task_id = ? AND agent_id = ?
             LIMIT 1`,
          )
          .get(overrideTask.id, agent.id) as {
            runner_provider: string | null;
            token_usage_json: string | null;
        } | undefined;
        assert.ok(executionRun, "execution_run should be created");
        assert.strictEqual(executionRun!.runner_provider, "anthropic");
        const usage = JSON.parse(executionRun!.token_usage_json ?? "{}") as Record<string, unknown>;
        assert.strictEqual(usage.runnerProvider, "anthropic");
        assert.strictEqual(usage.modelRouting, "google");
      } finally {
        db.prepare("UPDATE companies SET settings_json = ? WHERE id = ?").run("{}", company.id);
        setActiveHiveDefaultRoute({ runtimeId: "codex", runtimeLabel: "Codex" });
      }
    });

    await test("Matrix runtime provider overrides a legacy bundled Codex runner command", async () => {
      setActiveHiveDefaultRoute({ runtimeId: "claude-code", runtimeLabel: "Claude Code" });
      const matrixOverrideAgent = createProjectAgent({
        projectId: project.id,
        name: "Matrix Provider Override Agent",
        emoji: "M",
        role: "Engineer",
        personality: "Runs provider-neutral external runner tasks.",
        status: "idle",
        skills: [],
      }).agent;
      const legacyBundledCodexRunner = path.join(process.cwd(), "scripts", "hiverunner-symphony-runner.mjs");
      upsertCompanyRuntime({
        companyIdOrSlug: company.id,
        agentId: matrixOverrideAgent.id,
        provider: "symphony",
        runtimeSlug: "fixture-legacy-codex-runner",
        displayName: "Fixture Legacy Bundled Codex Runner",
        runtimeKind: "external",
        scope: "agent",
        command: legacyBundledCodexRunner,
        status: "online",
        metadata: {
          commandPath: legacyBundledCodexRunner,
          commandArgs: ["--legacy-codex-arg"],
          runnerConfig: {
            provider: "codex",
            model: "openai-codex/gpt-5.5",
            bundledRunner: true,
          },
        },
      });
      db.prepare("UPDATE companies SET settings_json = ? WHERE id = ?").run(
        JSON.stringify({
          execution: {
            defaultEngine: "symphony",
            defaultRuntimeProvider: "anthropic",
            defaultRuntimeLabel: "Claude Code",
            defaultModelRouting: "runtime-managed",
            defaultModelRoutingLabel: "Runtime managed",
            activeHiveId: "fixture-provider-neutral-hive",
            activeHiveName: "Fixture Provider Neutral Hive",
          },
        }),
        company.id,
      );
      const matrixOverrideTask = createTask({
        projectId: project.id,
        title: "Run matrix provider command override fixture",
        description: "Exercise provider-neutral command selection over a legacy Codex runner command.",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: matrixOverrideAgent.id,
        labels: ["symphony", "matrix"],
        createdBy: "test",
        executionEngine: "symphony",
      }).task;

      process.env.HIVERUNNER_CLAUDE_DRY_RUN = "1";
      try {
        const queued = await triggerTaskExecution({
          taskId: matrixOverrideTask.id,
          reason: "symphony_matrix_provider_command_override_test",
        });

        assert.strictEqual(queued.mode, "symphony");
        assert.ok(queued.runId, "triggerTaskExecution should enqueue a heartbeat run");

        const result = await executeHeartbeatRun(queued.runId!, db);
        assert.strictEqual(result.status, "succeeded", result.error ?? "heartbeat should succeed");

        const executionRun = db
          .prepare(
            `SELECT provider, execution_engine, runner_provider, status, token_usage_json
             FROM execution_runs
             WHERE task_id = ? AND agent_id = ?
             LIMIT 1`,
          )
          .get(matrixOverrideTask.id, matrixOverrideAgent.id) as {
            provider: string;
            execution_engine: string | null;
            runner_provider: string | null;
            status: string;
            token_usage_json: string | null;
          } | undefined;
        assert.ok(executionRun, "execution_run should be created");
        assert.strictEqual(executionRun!.provider, "symphony");
        assert.strictEqual(executionRun!.execution_engine, "symphony");
        assert.strictEqual(executionRun!.runner_provider, "anthropic");
        assert.strictEqual(executionRun!.status, "completed");

        const usage = JSON.parse(executionRun!.token_usage_json ?? "{}") as Record<string, unknown>;
        assert.strictEqual(usage.runnerProvider, "anthropic");
        assert.strictEqual(usage.modelRouting, "runtime-managed");
        assert.ok(String(usage.command).endsWith("scripts/hiverunner-claude-runner.mjs"));
        assert.ok(!String(usage.command).endsWith("scripts/hiverunner-symphony-runner.mjs"));
        assert.strictEqual(String(usage.runnerArgs ?? "").includes("--legacy-codex-arg"), false);
        assert.ok(String(usage.resultText).includes("Claude external runner dry run accepted"));
      } finally {
        delete process.env.HIVERUNNER_CLAUDE_DRY_RUN;
        db.prepare("UPDATE companies SET settings_json = ? WHERE id = ?").run("{}", company.id);
        setActiveHiveDefaultRoute({ runtimeId: "codex", runtimeLabel: "Codex" });
      }
    });

    await test("default bundled runner accepts the external runner payload when no runtime command is registered", async () => {
      setActiveHiveDefaultRoute({ runtimeId: "codex", runtimeLabel: "Codex" });
      const defaultRunnerAgent = createProjectAgent({
        projectId: project.id,
        name: "Default External Runner Agent",
        emoji: "D",
        role: "Engineer",
        personality: "Runs selected tasks.",
        status: "idle",
        skills: [],
      }).agent;
      const defaultRunnerTask = createTask({
        projectId: project.id,
        title: "Run default external runner fixture",
        description: "Exercise the bundled HiveRunner external runner.",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: defaultRunnerAgent.id,
        labels: ["symphony"],
        createdBy: "test",
        executionEngine: "symphony",
      }).task;

      process.env.HIVERUNNER_SYMPHONY_DRY_RUN = "1";
      try {
        const queued = await triggerTaskExecution({
          taskId: defaultRunnerTask.id,
          reason: "symphony_default_runner_test",
        });

        assert.strictEqual(queued.mode, "symphony");
        assert.strictEqual(queued.status, "queued");
        assert.ok(queued.runId, "triggerTaskExecution should enqueue a heartbeat run");

        const result = await executeHeartbeatRun(queued.runId!, db);
        assert.strictEqual(result.status, "succeeded", result.error ?? "heartbeat should succeed");
        assert.strictEqual(result.error, null);

        const executionRun = db
          .prepare(
            `SELECT provider, status, token_usage_json
             FROM execution_runs
             WHERE task_id = ? AND agent_id = ?
             LIMIT 1`,
          )
          .get(defaultRunnerTask.id, defaultRunnerAgent.id) as { provider: string; status: string; token_usage_json: string | null } | undefined;
        assert.ok(executionRun, "execution_run should be created");
        assert.strictEqual(executionRun!.provider, "symphony");
        assert.strictEqual(executionRun!.status, "completed");

        const usage = JSON.parse(executionRun!.token_usage_json ?? "{}") as Record<string, unknown>;
        assert.strictEqual(usage.provider, "symphony");
        assert.strictEqual(usage.integrationPath, "hiverunner-symphony-command");
        assert.ok(String(usage.command).endsWith("scripts/hiverunner-symphony-runner.mjs"));
        assert.ok(String(usage.resultText).includes("External runner dry run accepted the HiveRunner task payload."));
      } finally {
        delete process.env.HIVERUNNER_SYMPHONY_DRY_RUN;
      }
    });

    await test("blank command selects the Claude wrapper when runtime metadata requests Anthropic", async () => {
      setActiveHiveDefaultRoute({ runtimeId: "claude-code", runtimeLabel: "Claude Code" });
      const claudeRunnerAgent = createProjectAgent({
        projectId: project.id,
        name: "Claude External Runner Agent",
        emoji: "C",
        role: "Engineer",
        personality: "Runs selected tasks through Claude Code.",
        status: "idle",
        skills: [],
      }).agent;
      upsertCompanyRuntime({
        companyIdOrSlug: company.id,
        agentId: claudeRunnerAgent.id,
        provider: "symphony",
        runtimeSlug: "fixture-claude-runner",
        displayName: "Fixture External Runner / Claude Code",
        runtimeKind: "external",
        scope: "agent",
        command: null,
        status: "online",
        metadata: {
          runnerContract: "hiverunner.symphony.execution.v1",
          runnerConfig: {
            provider: "anthropic",
            profile: "claude-code",
            model: "claude-sonnet-4-6",
            permissionMode: "bypassPermissions",
            bundledRunner: true,
          },
        },
      });
      const claudeRunnerTask = createTask({
        projectId: project.id,
        title: "Run Claude external runner fixture",
        description: "Exercise the metadata-selected Claude external runner.",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: claudeRunnerAgent.id,
        labels: ["symphony", "claude"],
        createdBy: "test",
        executionEngine: "symphony",
      }).task;

      process.env.HIVERUNNER_CLAUDE_DRY_RUN = "1";
      try {
        const queued = await triggerTaskExecution({
          taskId: claudeRunnerTask.id,
          reason: "symphony_claude_runner_test",
        });

        assert.strictEqual(queued.mode, "symphony");
        assert.strictEqual(queued.status, "queued");
        assert.ok(queued.runId, "triggerTaskExecution should enqueue a heartbeat run");

        const result = await executeHeartbeatRun(queued.runId!, db);
        assert.strictEqual(result.status, "succeeded", result.error ?? "heartbeat should succeed");
        assert.strictEqual(result.error, null);

        const executionRun = db
          .prepare(
            `SELECT provider, execution_engine, runner_provider, runner_model, status, token_usage_json
             FROM execution_runs
             WHERE task_id = ? AND agent_id = ?
             LIMIT 1`,
          )
          .get(claudeRunnerTask.id, claudeRunnerAgent.id) as {
            provider: string;
            execution_engine: string | null;
            runner_provider: string | null;
            runner_model: string | null;
            status: string;
            token_usage_json: string | null;
          } | undefined;
        assert.ok(executionRun, "execution_run should be created");
        assert.strictEqual(executionRun!.provider, "symphony");
        assert.strictEqual(executionRun!.execution_engine, "symphony");
        assert.strictEqual(executionRun!.runner_provider, "anthropic");
        assert.strictEqual(executionRun!.runner_model, "claude-sonnet-4-6");
        assert.strictEqual(executionRun!.status, "completed");

        const usage = JSON.parse(executionRun!.token_usage_json ?? "{}") as Record<string, unknown>;
        assert.strictEqual(usage.runnerProvider, "anthropic");
        assert.strictEqual(usage.runnerModel, "claude-sonnet-4-6");
        assert.ok(String(usage.command).endsWith("scripts/hiverunner-claude-runner.mjs"));
        assert.strictEqual((usage.runnerEnv as { HIVERUNNER_CLAUDE_MODEL?: string }).HIVERUNNER_CLAUDE_MODEL, "claude-sonnet-4-6");
        assert.strictEqual((usage.runnerEnv as { HIVERUNNER_CLAUDE_PERMISSION_MODE?: string }).HIVERUNNER_CLAUDE_PERMISSION_MODE, "bypassPermissions");
        assert.ok(String(usage.resultText).includes("Claude external runner dry run accepted the HiveRunner task payload."));
      } finally {
        delete process.env.HIVERUNNER_CLAUDE_DRY_RUN;
      }
    });

    await test("blank command selects the Gemini wrapper when runtime metadata requests Gemini", async () => {
      setActiveHiveDefaultRoute({ runtimeId: "gemini-cli", runtimeLabel: "Gemini CLI" });
      const geminiRunnerAgent = createProjectAgent({
        projectId: project.id,
        name: "Gemini External Runner Agent",
        emoji: "G",
        role: "Engineer",
        personality: "Runs selected tasks through Gemini CLI.",
        status: "idle",
        skills: [],
      }).agent;
      upsertCompanyRuntime({
        companyIdOrSlug: company.id,
        agentId: geminiRunnerAgent.id,
        provider: "symphony",
        runtimeSlug: "fixture-gemini-runner",
        displayName: "Fixture External Runner / Gemini",
        runtimeKind: "external",
        scope: "agent",
        command: null,
        status: "online",
        metadata: {
          runnerContract: "hiverunner.symphony.execution.v1",
          runnerConfig: {
            provider: "gemini",
            profile: "gemini-cli",
            model: "google/gemini-3-pro-preview",
            approvalMode: "yolo",
            bundledRunner: true,
          },
        },
      });
      const geminiRunnerTask = createTask({
        projectId: project.id,
        title: "Run Gemini external runner fixture",
        description: "Exercise the metadata-selected Gemini external runner.",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: geminiRunnerAgent.id,
        labels: ["symphony", "gemini"],
        createdBy: "test",
        executionEngine: "symphony",
      }).task;

      process.env.HIVERUNNER_GEMINI_DRY_RUN = "1";
      try {
        const queued = await triggerTaskExecution({
          taskId: geminiRunnerTask.id,
          reason: "symphony_gemini_runner_test",
        });

        assert.strictEqual(queued.mode, "symphony");
        assert.strictEqual(queued.status, "queued");
        assert.ok(queued.runId, "triggerTaskExecution should enqueue a heartbeat run");

        const result = await executeHeartbeatRun(queued.runId!, db);
        assert.strictEqual(result.status, "succeeded", result.error ?? "heartbeat should succeed");
        assert.strictEqual(result.error, null);

        const executionRun = db
          .prepare(
            `SELECT provider, execution_engine, runner_provider, runner_model, status, token_usage_json
             FROM execution_runs
             WHERE task_id = ? AND agent_id = ?
             LIMIT 1`,
          )
          .get(geminiRunnerTask.id, geminiRunnerAgent.id) as {
            provider: string;
            execution_engine: string | null;
            runner_provider: string | null;
            runner_model: string | null;
            status: string;
            token_usage_json: string | null;
          } | undefined;
        assert.ok(executionRun, "execution_run should be created");
        assert.strictEqual(executionRun!.provider, "symphony");
        assert.strictEqual(executionRun!.execution_engine, "symphony");
        assert.strictEqual(executionRun!.runner_provider, "gemini");
        assert.strictEqual(executionRun!.runner_model, "gemini-3-pro-preview");
        assert.strictEqual(executionRun!.status, "completed");

        const usage = JSON.parse(executionRun!.token_usage_json ?? "{}") as Record<string, unknown>;
        assert.strictEqual(usage.runnerProvider, "gemini");
        assert.strictEqual(usage.runnerModel, "gemini-3-pro-preview");
        assert.ok(String(usage.command).endsWith("scripts/hiverunner-gemini-runner.mjs"));
        assert.strictEqual((usage.runnerEnv as { HIVERUNNER_GEMINI_MODEL?: string }).HIVERUNNER_GEMINI_MODEL, "google/gemini-3-pro-preview");
        assert.strictEqual((usage.runnerEnv as { HIVERUNNER_GEMINI_APPROVAL_MODE?: string }).HIVERUNNER_GEMINI_APPROVAL_MODE, "yolo");
        assert.ok(String(usage.resultText).includes("Gemini external runner dry run accepted the HiveRunner task payload."));
      } finally {
        delete process.env.HIVERUNNER_GEMINI_DRY_RUN;
      }
    });

    await test("blank command selects the HERMES wrapper when runtime metadata requests HERMES", async () => {
      setActiveHiveDefaultRoute({ runtimeId: "hermes", runtimeLabel: "Hermes" });
      const hermesRunnerAgent = createProjectAgent({
        projectId: project.id,
        name: "HERMES External Runner Agent",
        emoji: "H",
        role: "Engineer",
        personality: "Runs selected tasks through HERMES ACP.",
        status: "idle",
        skills: [],
      }).agent;
      upsertCompanyRuntime({
        companyIdOrSlug: company.id,
        agentId: hermesRunnerAgent.id,
        provider: "symphony",
        runtimeSlug: "fixture-hermes-runner",
        displayName: "Fixture External Runner / HERMES ACP",
        runtimeKind: "external",
        scope: "agent",
        command: null,
        status: "online",
        metadata: {
          runnerContract: "hiverunner.symphony.execution.v1",
          runnerConfig: {
            provider: "hermes",
            profile: "hermes-acp",
            model: "anthropic/claude-sonnet-4-6",
            hermesArgs: "acp",
            bundledRunner: true,
          },
        },
      });
      const hermesRunnerTask = createTask({
        projectId: project.id,
        title: "Run HERMES external runner fixture",
        description: "Exercise the metadata-selected HERMES external runner.",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: hermesRunnerAgent.id,
        labels: ["symphony", "hermes"],
        createdBy: "test",
        executionEngine: "symphony",
      }).task;

      process.env.HIVERUNNER_HERMES_DRY_RUN = "1";
      try {
        const queued = await triggerTaskExecution({
          taskId: hermesRunnerTask.id,
          reason: "symphony_hermes_runner_test",
        });

        assert.strictEqual(queued.mode, "symphony");
        assert.strictEqual(queued.status, "queued");
        assert.ok(queued.runId, "triggerTaskExecution should enqueue a heartbeat run");

        const result = await executeHeartbeatRun(queued.runId!, db);
        assert.strictEqual(result.status, "succeeded", result.error ?? "heartbeat should succeed");
        assert.strictEqual(result.error, null);

        const executionRun = db
          .prepare(
            `SELECT provider, execution_engine, runner_provider, runner_model, status, token_usage_json
             FROM execution_runs
             WHERE task_id = ? AND agent_id = ?
             LIMIT 1`,
          )
          .get(hermesRunnerTask.id, hermesRunnerAgent.id) as {
            provider: string;
            execution_engine: string | null;
            runner_provider: string | null;
            runner_model: string | null;
            status: string;
            token_usage_json: string | null;
          } | undefined;
        assert.ok(executionRun, "execution_run should be created");
        assert.strictEqual(executionRun!.provider, "symphony");
        assert.strictEqual(executionRun!.execution_engine, "symphony");
        assert.strictEqual(executionRun!.runner_provider, "hermes");
        assert.strictEqual(executionRun!.runner_model, "anthropic/claude-sonnet-4-6");
        assert.strictEqual(executionRun!.status, "completed");

        const usage = JSON.parse(executionRun!.token_usage_json ?? "{}") as Record<string, unknown>;
        assert.strictEqual(usage.runnerProvider, "hermes");
        assert.strictEqual(usage.runnerModel, "anthropic/claude-sonnet-4-6");
        assert.ok(String(usage.command).endsWith("scripts/hiverunner-hermes-runner.mjs"));
        assert.strictEqual((usage.runnerEnv as { HIVERUNNER_HERMES_MODEL?: string }).HIVERUNNER_HERMES_MODEL, "anthropic/claude-sonnet-4-6");
        assert.strictEqual((usage.runnerEnv as { HIVERUNNER_HERMES_ARGS?: string }).HIVERUNNER_HERMES_ARGS, "acp");
        assert.ok(String(usage.resultText).includes("HERMES external runner dry run accepted the HiveRunner task payload."));
      } finally {
        delete process.env.HIVERUNNER_HERMES_DRY_RUN;
      }
    });

    await test("blank command selects the OpenClaw wrapper when runtime metadata requests OpenClaw", async () => {
      setActiveHiveDefaultRoute({ runtimeId: "openclaw", runtimeLabel: "OpenClaw" });
      const openclawRunnerAgent = createProjectAgent({
        projectId: project.id,
        name: "OpenClaw External Runner Agent",
        emoji: "O",
        role: "Engineer",
        personality: "Runs selected tasks through the OpenClaw gateway.",
        openclawAgentId: "openclaw-external-runner-agent",
        status: "idle",
        skills: [],
      }).agent;
      upsertCompanyRuntime({
        companyIdOrSlug: company.id,
        agentId: openclawRunnerAgent.id,
        provider: "symphony",
        runtimeSlug: "fixture-openclaw-runner",
        displayName: "Fixture External Runner / OpenClaw Gateway",
        runtimeKind: "external",
        scope: "agent",
        command: null,
        status: "online",
        metadata: {
          runnerContract: "hiverunner.symphony.execution.v1",
          runnerConfig: {
            provider: "openclaw",
            profile: "openclaw-gateway",
            openclawCommand: "openclaw",
            openclawAgentId: "openclaw-external-runner-agent",
            bundledRunner: true,
          },
        },
      });
      const openclawRunnerTask = createTask({
        projectId: project.id,
        title: "Run OpenClaw external runner fixture",
        description: "Exercise the metadata-selected OpenClaw external runner.",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: openclawRunnerAgent.id,
        labels: ["symphony", "openclaw"],
        createdBy: "test",
        executionEngine: "symphony",
      }).task;

      process.env.HIVERUNNER_OPENCLAW_DRY_RUN = "1";
      try {
        const queued = await triggerTaskExecution({
          taskId: openclawRunnerTask.id,
          reason: "symphony_openclaw_runner_test",
        });

        assert.strictEqual(queued.mode, "symphony");
        assert.strictEqual(queued.status, "queued");
        assert.ok(queued.runId, "triggerTaskExecution should enqueue a heartbeat run");

        const result = await executeHeartbeatRun(queued.runId!, db);
        assert.strictEqual(result.status, "succeeded", result.error ?? "heartbeat should succeed");
        assert.strictEqual(result.error, null);

        const executionRun = db
          .prepare(
            `SELECT provider, execution_engine, runner_provider, runner_model, status, token_usage_json
             FROM execution_runs
             WHERE task_id = ? AND agent_id = ?
             LIMIT 1`,
          )
          .get(openclawRunnerTask.id, openclawRunnerAgent.id) as {
            provider: string;
            execution_engine: string | null;
            runner_provider: string | null;
            runner_model: string | null;
            status: string;
            token_usage_json: string | null;
          } | undefined;
        assert.ok(executionRun, "execution_run should be created");
        assert.strictEqual(executionRun!.provider, "symphony");
        assert.strictEqual(executionRun!.execution_engine, "symphony");
        assert.strictEqual(executionRun!.runner_provider, "openclaw");
        assert.strictEqual(executionRun!.runner_model, null);
        assert.strictEqual(executionRun!.status, "completed");

        const usage = JSON.parse(executionRun!.token_usage_json ?? "{}") as Record<string, unknown>;
        assert.strictEqual(usage.runnerProvider, "openclaw");
        assert.strictEqual(usage.runnerModel, null);
        assert.ok(String(usage.command).endsWith("scripts/hiverunner-openclaw-runner.mjs"));
        assert.strictEqual((usage.runnerEnv as { HIVERUNNER_OPENCLAW_COMMAND?: string }).HIVERUNNER_OPENCLAW_COMMAND, "openclaw");
        assert.strictEqual((usage.runnerEnv as { HIVERUNNER_OPENCLAW_AGENT_ID?: string }).HIVERUNNER_OPENCLAW_AGENT_ID, "openclaw-external-runner-agent");
        assert.ok(String(usage.resultText).includes("OpenClaw external runner dry run accepted the HiveRunner task payload."));
      } finally {
        delete process.env.HIVERUNNER_OPENCLAW_DRY_RUN;
      }
    });

    await test("project source workspace overrides Symphony execution cwd", async () => {
      setActiveHiveDefaultRoute({ runtimeId: "codex", runtimeLabel: "Codex" });
      const sourceWorkspaceRoot = path.join(tempRoot, "real-product-repo");
      mkdirSync(sourceWorkspaceRoot, { recursive: true });
      const sourceProject = createProject({
        companyId: company.id,
        name: "Existing Product Repo",
        description: "fixture",
        color: "#22c55e",
        emoji: "R",
        status: "active",
        sourceWorkspaceRoot,
      }).project;
      const sourceAgent = createProjectAgent({
        projectId: sourceProject.id,
        name: "Source Workspace Agent",
        emoji: "W",
        role: "Engineer",
        personality: "Runs selected tasks.",
        status: "idle",
        skills: [],
      }).agent;
      upsertCompanyRuntime({
        companyIdOrSlug: company.id,
        agentId: sourceAgent.id,
        provider: "symphony",
        runtimeSlug: "fixture-symphony-source",
        displayName: "Fixture External Runner Source",
        runtimeKind: "cli",
        scope: "agent",
        command: fakeSymphony,
        status: "online",
        metadata: {
          commandPath: fakeSymphony,
          commandArgs: ["--source-fixture"],
        },
      });
      const sourceTask = createTask({
        projectId: sourceProject.id,
        title: "Run source workspace fixture",
        description: "Exercise project source workspace routing.",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: sourceAgent.id,
        labels: ["symphony"],
        createdBy: "test",
        executionEngine: "symphony",
      }).task;

      const queued = await triggerTaskExecution({
        taskId: sourceTask.id,
        reason: "symphony_source_workspace_test",
      });
      assert.strictEqual(queued.mode, "symphony");
      assert.ok(queued.runId, "triggerTaskExecution should enqueue a heartbeat run");

      const result = await executeHeartbeatRun(queued.runId!, db);
      assert.strictEqual(result.status, "succeeded", result.error ?? "heartbeat should succeed");

      const payload = JSON.parse(readFileSync(stdinFile, "utf8")) as SymphonyFixturePayload;
      assert.strictEqual(realpathSync(readFileSync(cwdFile, "utf8").trim()), realpathSync(sourceWorkspaceRoot));
      assert.strictEqual(realpathSync(payload.workspace.cwd), realpathSync(sourceWorkspaceRoot));
      assert.strictEqual(realpathSync(payload.workspace.sourceWorkspaceRoot ?? ""), realpathSync(sourceWorkspaceRoot));
      assert.strictEqual(realpathSync(payload.workspace.companyWorkspaceRoot ?? ""), realpathSync(company.workspace.root));
      assert.deepStrictEqual(payload.workspace.additionalWritableDirs?.map((dir) => realpathSync(dir)), [realpathSync(company.workspace.root)]);

      const executionRun = db
        .prepare(
          `SELECT token_usage_json
           FROM execution_runs
           WHERE task_id = ? AND agent_id = ?
           LIMIT 1`,
        )
        .get(sourceTask.id, sourceAgent.id) as { token_usage_json: string | null } | undefined;
      assert.ok(executionRun, "execution_run should be created");
      const usage = JSON.parse(executionRun!.token_usage_json ?? "{}") as Record<string, unknown>;
      assert.strictEqual(realpathSync(String(usage.cwd)), realpathSync(sourceWorkspaceRoot));
      assert.strictEqual(realpathSync(String(usage.sourceWorkspaceRoot)), realpathSync(sourceWorkspaceRoot));
      assert.strictEqual(realpathSync(String(usage.companyWorkspaceRoot)), realpathSync(company.workspace.root));
    });

    await test("adapter timeout diagnostics are distinct from externally signalled runner exits", async () => {
      setActiveHiveDefaultRoute({ runtimeId: "codex", runtimeLabel: "Codex" });

      async function runDiagnosticFixture(mode: "sleep" | "self-sigterm", title: string) {
        const diagnosticAgent = createProjectAgent({
          projectId: project.id,
          name: `Runner Diagnostic ${mode}`,
          emoji: "D",
          role: "Engineer",
          personality: "Exercises runner termination diagnostics.",
          status: "idle",
          skills: [],
        }).agent;
        upsertCompanyRuntime({
          companyIdOrSlug: company.id,
          agentId: diagnosticAgent.id,
          provider: "symphony",
          runtimeSlug: `fixture-runner-diagnostic-${mode}`,
          displayName: "Fixture Runner Diagnostic",
          runtimeKind: "external",
          scope: "agent",
          command: fakeSymphony,
          status: "online",
          metadata: {
            commandPath: fakeSymphony,
            runnerConfig: { provider: "codex" },
          },
        });
        const diagnosticTask = createTask({
          projectId: project.id,
          title,
          description: "Exercise Symphony runner termination provenance.",
          priority: "P2",
          type: "maintenance",
          status: "in-progress",
          assignee: diagnosticAgent.id,
          labels: ["symphony", "diagnostics"],
          createdBy: "test",
          executionEngine: "symphony",
        }).task;

        process.env.FAKE_SYMPHONY_MODE = mode;
        const previousTimeout = process.env.SYMPHONY_EXEC_TIMEOUT_MS;
        if (mode === "sleep") process.env.SYMPHONY_EXEC_TIMEOUT_MS = "100";
        try {
          const queued = await triggerTaskExecution({
            taskId: diagnosticTask.id,
            reason: `symphony_runner_diagnostic_${mode}`,
          });
          assert.ok(queued.runId, "triggerTaskExecution should enqueue a heartbeat run");
          const result = await executeHeartbeatRun(queued.runId!, db);
          assert.strictEqual(result.status, "failed");
          return db
            .prepare(
              `SELECT status, error_message, failure_class, process_pid, metadata_json, token_usage_json
               FROM execution_runs
               WHERE task_id = ? AND agent_id = ?
               LIMIT 1`,
            )
            .get(diagnosticTask.id, diagnosticAgent.id) as {
              status: string;
              error_message: string | null;
              failure_class: string | null;
              process_pid: number | null;
              metadata_json: string | null;
              token_usage_json: string | null;
            };
        } finally {
          delete process.env.FAKE_SYMPHONY_MODE;
          if (previousTimeout === undefined) delete process.env.SYMPHONY_EXEC_TIMEOUT_MS;
          else process.env.SYMPHONY_EXEC_TIMEOUT_MS = previousTimeout;
        }
      }

      const timeoutRun = await runDiagnosticFixture("sleep", "Run adapter timeout diagnostic fixture");
      assert.strictEqual(timeoutRun.status, "failed");
      assert.strictEqual(timeoutRun.process_pid, null);
      assert.strictEqual(timeoutRun.failure_class, "adapter_timeout");
      assert.match(timeoutRun.error_message ?? "", /timed out/i);
      const timeoutMetadata = JSON.parse(timeoutRun.metadata_json ?? "{}") as Record<string, unknown>;
      const timeoutRunner = timeoutMetadata.externalRunner as Record<string, unknown>;
      assert.ok(Number(timeoutRunner.pid) > 0, "timeout metadata should retain the child pid");
      assert.ok(timeoutRunner.pgid === null || Number(timeoutRunner.pgid) > 0, "timeout metadata should record pgid when available");
      assert.strictEqual(timeoutRunner.timedOut, true);
      assert.strictEqual(timeoutRunner.killedForBuffer, false);
      assert.strictEqual(timeoutRunner.terminationReason, "adapter_timeout");
      assert.strictEqual(typeof timeoutMetadata.heartbeatRunId, "string");
      assert.match(String(timeoutRunner.stderrTail), /sleeping past adapter timeout/);
      const timeoutUsage = JSON.parse(timeoutRun.token_usage_json ?? "{}") as Record<string, unknown>;
      assert.strictEqual(timeoutUsage.timedOut, true);
      assert.strictEqual(timeoutUsage.terminationReason, "adapter_timeout");

      const signalRun = await runDiagnosticFixture("self-sigterm", "Run external signal diagnostic fixture");
      assert.strictEqual(signalRun.status, "failed");
      assert.strictEqual(signalRun.process_pid, null);
      assert.strictEqual(signalRun.failure_class, "external_signal");
      assert.match(signalRun.error_message ?? "", /SIGTERM/);
      const signalMetadata = JSON.parse(signalRun.metadata_json ?? "{}") as Record<string, unknown>;
      const signalRunner = signalMetadata.externalRunner as Record<string, unknown>;
      assert.ok(Number(signalRunner.pid) > 0, "signal metadata should retain the child pid");
      assert.strictEqual(signalRunner.signal, "SIGTERM");
      assert.strictEqual(signalRunner.timedOut, false);
      assert.strictEqual(signalRunner.killedForBuffer, false);
      assert.strictEqual(signalRunner.terminationReason, "external_signal");
      assert.match(String(signalRunner.stderrTail), /sending SIGTERM to itself/);
      const signalUsage = JSON.parse(signalRun.token_usage_json ?? "{}") as Record<string, unknown>;
      assert.strictEqual(signalUsage.signal, "SIGTERM");
      assert.strictEqual(signalUsage.terminationReason, "external_signal");
    });

    await test("missing external runner command fails the execution run with a useful provider error", async () => {
      setActiveHiveDefaultRoute({ runtimeId: "codex", runtimeLabel: "Codex" });
      const missingRunnerAgent = createProjectAgent({
        projectId: project.id,
        name: "Missing External Runner Agent",
        emoji: "M",
        role: "Engineer",
        personality: "Exercises failure handling.",
        status: "idle",
        skills: [],
      }).agent;
      upsertCompanyRuntime({
        companyIdOrSlug: company.id,
        agentId: missingRunnerAgent.id,
        provider: "symphony",
        runtimeSlug: "missing-symphony",
        displayName: "Missing External Runner",
        command: path.join(tempRoot, "bin", "definitely-missing-symphony"),
        runtimeKind: "external",
        scope: "agent",
        status: "online",
      });
      const missingRunnerTask = createTask({
        projectId: project.id,
        title: "Run missing external runner command fixture",
        description: "Exercise missing command failure handling.",
        priority: "P2",
        type: "maintenance",
        status: "in-progress",
        assignee: missingRunnerAgent.id,
        labels: ["symphony"],
        createdBy: "test",
        executionEngine: "symphony",
      }).task;

      const queued = await triggerTaskExecution({
        taskId: missingRunnerTask.id,
        reason: "symphony_missing_command_test",
      });
      assert.strictEqual(queued.mode, "symphony");
      assert.strictEqual(queued.status, "queued");
      assert.ok(queued.runId, "triggerTaskExecution should enqueue a heartbeat run");

      const result = await executeHeartbeatRun(queued.runId!, db);
      assert.strictEqual(result.status, "failed");
      assert.ok(String(result.error).includes("definitely-missing-symphony"));

      const executionRun = db
        .prepare(
          `SELECT provider, status, error_message, token_usage_json
           FROM execution_runs
           WHERE task_id = ? AND agent_id = ?
           LIMIT 1`,
        )
        .get(missingRunnerTask.id, missingRunnerAgent.id) as { provider: string; status: string; error_message: string | null; token_usage_json: string | null } | undefined;
      assert.ok(executionRun, "execution_run should be created");
      assert.strictEqual(executionRun!.provider, "symphony");
      assert.strictEqual(executionRun!.status, "failed");
      assert.ok(String(executionRun!.error_message).includes("definitely-missing-symphony"));

      const usage = JSON.parse(executionRun!.token_usage_json ?? "{}") as Record<string, unknown>;
      assert.strictEqual(usage.provider, "symphony");
      assert.strictEqual(usage.exitCode, -2);
      assert.ok(String(usage.command).includes("definitely-missing-symphony"));
    });

    closeOrchestrationDb();
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
