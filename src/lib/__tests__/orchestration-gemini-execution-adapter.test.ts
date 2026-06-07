import assert from "node:assert";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

const { finish, test } = createTestRunner({ passLabel: "pass", failLabel: "fail" });

type AdapterAgentRow = {
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

function writeFakeGeminiCli(binDir: string): string {
  const file = path.join(binDir, "gemini");
  writeFileSync(
    file,
    `#!${process.execPath}
const fs = require("fs");
const args = process.argv.slice(2);
fs.writeFileSync(process.env.FAKE_GEMINI_CWD_FILE, process.cwd(), "utf8");
fs.writeFileSync(process.env.FAKE_GEMINI_ARGS_FILE, JSON.stringify(args), "utf8");
const promptIndex = args.indexOf("--prompt");
fs.writeFileSync(process.env.FAKE_GEMINI_PROMPT_FILE, promptIndex >= 0 ? args[promptIndex + 1] || "" : "", "utf8");
if (process.env.FAKE_GEMINI_SETTINGS_FILE) {
  const settingsPath = process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH || "";
  fs.writeFileSync(process.env.FAKE_GEMINI_SETTINGS_FILE, JSON.stringify({
    path: settingsPath,
    content: settingsPath && fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, "utf8") : "",
  }), "utf8");
}
process.stdout.write("Fixture Gemini adapter completed.\\n");
`,
    "utf8",
  );
  chmodSync(file, 0o755);
  return file;
}

async function run() {
  console.log("\nGemini Execution Adapter Tests\n");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "orchestration-gemini-execution-"));
  const homeDir = path.join(tempRoot, "home");
  const binDir = path.join(tempRoot, "bin");
  const dbPath = path.join(tempRoot, "orchestration.db");
  const workspaceRoot = path.join(homeDir, ".mission-control", "dev", "workspaces");
  const cwdFile = path.join(tempRoot, "cwd.txt");
  const argsFile = path.join(tempRoot, "args.json");
  const promptFile = path.join(tempRoot, "prompt.txt");
  const settingsFile = path.join(tempRoot, "settings.json");

  mkdirSync(binDir, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  const fakeGemini = writeFakeGeminiCli(binDir);

  process.env.HOME = homeDir;
  process.env.ORCHESTRATION_DB_PATH = dbPath;
  process.env.MC_WORKSPACE_ROOT = workspaceRoot;
  process.env.PATH = binDir;
  process.env.FAKE_GEMINI_CWD_FILE = cwdFile;
  process.env.FAKE_GEMINI_ARGS_FILE = argsFile;
  process.env.FAKE_GEMINI_PROMPT_FILE = promptFile;
  process.env.FAKE_GEMINI_SETTINGS_FILE = settingsFile;
  process.env.MC_GEMINI_EXEC_TIMEOUT_MS = "15000";
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";

  const { createCompany } = await import("@/lib/orchestration/company-service");
  const { getOrchestrationDb, closeOrchestrationDb } = await import("@/lib/orchestration/db");
  const { createProject, createProjectAgent } = await import("@/lib/orchestration/service");
  const { upsertCompanyRuntime } = await import("@/lib/orchestration/runtime-registry");
  const { geminiExecutionAdapter } = await import("@/lib/orchestration/execution/adapters");

  const db = getOrchestrationDb();
  const now = () => new Date().toISOString();
  const selectAgentRow = (agentId: string): AdapterAgentRow => {
    const agentRow = db.prepare(
      `SELECT id, name, role, personality, company_id, openclaw_agent_id,
              adapter_type, adapter_config_json, runtime_config_json,
              capabilities
       FROM agents
       WHERE id = ?`,
    ).get(agentId) as AdapterAgentRow;
    agentRow.runtime_workspace_root = null;
    return agentRow;
  };
  const createAdapterInput = (agentRow: AdapterAgentRow, prompt: string, sessionId: string) => ({
    agent: agentRow,
    prompt,
    session: {
      id: sessionId,
      agentId: agentRow.id,
      companyId: agentRow.company_id,
      adapterType: "gemini",
      taskKey: "__heartbeat__",
      sessionParams: {},
      sessionDisplayId: null,
      lastRunId: null,
      lastError: null,
      createdAt: now(),
      updatedAt: now(),
    },
    runtimeState: {
      agentId: agentRow.id,
      companyId: agentRow.company_id,
      adapterType: "gemini",
      sessionId: null,
      state: {},
      lastRunId: null,
      lastRunStatus: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostCents: 0,
      lastError: null,
    },
  });

  const company = createCompany({
    name: "Gemini Execution Co",
    description: "Gemini adapter fixture.",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: "Gemini Execution Project",
    description: "fixture",
    color: "#16a34a",
    emoji: "G",
    status: "active",
  }).project;
  const createGeminiFixtureAgent = ({
    name,
    model,
    runtimeConfig,
  }: {
    name: string;
    model: string;
    runtimeConfig: Record<string, unknown>;
  }) => {
    const createdAgent = createProjectAgent({
      projectId: project.id,
      name,
      emoji: "G",
      role: "Engineer",
      personality: "Runs Gemini fixture tests.",
      status: "idle",
      skills: [],
    }).agent;

    db.prepare(
      `UPDATE agents
       SET adapter_type = 'gemini',
           model = ?,
           runtime_config_json = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(model, JSON.stringify(runtimeConfig), now(), createdAgent.id);

    upsertCompanyRuntime({
      companyIdOrSlug: company.id,
      agentId: createdAgent.id,
      provider: "gemini",
      runtimeSlug: "fixture-gemini",
      displayName: "Fixture Gemini",
      runtimeKind: "cli",
      scope: "agent",
      command: fakeGemini,
      status: "online",
      workspaceRoot: company.workspace.root,
      metadata: { commandPath: fakeGemini },
    });

    return createdAgent;
  };

  const agent = createGeminiFixtureAgent({
    name: "Gemini Runner",
    model: "google/gemini-2.5-pro",
    runtimeConfig: {
      model: "google/gemini-2.5-flash-lite",
      reasoningEffort: "high",
      speedPreference: "fast_1_5x",
      fastMode: true,
      serviceTier: "fast",
    },
  });

  const agentRow = selectAgentRow(agent.id);
  const baseInput = createAdapterInput(agentRow, "Run the Gemini adapter fixture.", "gemini-runtime-config-session");

  await test("route-attempt Gemini model wins and applies thinking through CLI model config", async () => {
    const result = await geminiExecutionAdapter.execute({
      ...baseInput,
      executionRouteAttempt: {
        target: {
          runtimeProvider: "gemini",
          runtimeLabel: "Gemini CLI",
          model: "google/gemini-3-flash-preview",
          source: {
            runtimeId: "gemini",
            runtimeLabel: "Gemini CLI",
            modelSourceId: "google",
            modelSourceLabel: "Google Direct",
            modelId: "google/gemini-3-flash-preview",
            modelLabel: "Gemini 3 Flash Preview",
            mode: "direct_source",
          },
        },
        fallbackUsed: false,
        fallbackIndex: null,
        fallbackFromProvider: null,
      },
    });

    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.runnerModel, "gemini-3-flash-preview");
    const args = JSON.parse(readFileSync(argsFile, "utf8")) as string[];
    assert.deepStrictEqual(args.slice(0, 6), ["--prompt", "Run the Gemini adapter fixture.", "--output-format", "text", "--approval-mode", "yolo"]);
    assert.ok(args.includes("--model"));
    const cliModelArg = args[args.indexOf("--model") + 1];
    assert.ok(cliModelArg.startsWith("hiverunner-"), `Gemini CLI should receive the per-run model alias: ${cliModelArg}`);
    assert.ok(!args.includes("--effort"), `Gemini thinking is configured through model config, not --effort: ${args.join(" ")}`);
    assert.ok(!args.includes("--speed"), `Gemini speed is telemetry-only: ${args.join(" ")}`);
    assert.ok(!args.some((arg) => arg.includes("service_tier")), `Gemini service tier is telemetry-only: ${args.join(" ")}`);
    const settingsRecord = JSON.parse(readFileSync(settingsFile, "utf8")) as { path: string; content: string };
    assert.ok(settingsRecord.path.includes("hiverunner-gemini-cli-"), settingsRecord.path);
    const settings = JSON.parse(settingsRecord.content) as {
      modelConfigs?: { customAliases?: Record<string, { modelConfig?: { model?: string; generateContentConfig?: { thinkingConfig?: { thinkingLevel?: string } } } }> };
    };
    const aliasConfig = settings.modelConfigs?.customAliases?.[cliModelArg]?.modelConfig;
    assert.strictEqual(aliasConfig?.model, "gemini-3-flash-preview");
    assert.strictEqual(aliasConfig?.generateContentConfig?.thinkingConfig?.thinkingLevel, "HIGH");
    const usage = result.usage ?? {};
    assert.strictEqual(usage.reasoningEffort, "high");
    assert.strictEqual(usage.speedPreference, "fast_1_5x");
    assert.strictEqual(usage.fastMode, true);
    assert.strictEqual(usage.serviceTier, "fast");
  });

  await test("agent runtime config model wins over agent-profile route fallback", async () => {
    const result = await geminiExecutionAdapter.execute({
      ...baseInput,
      executionRouteAttempt: {
        target: {
          runtimeProvider: "gemini",
          runtimeLabel: "Gemini CLI",
          model: "gemini-2.5-pro",
          source: {
            runtimeId: "gemini",
            runtimeLabel: "Gemini CLI",
            modelSourceId: "agent_profile",
            modelSourceLabel: "Agent profile",
            modelId: "gemini-2.5-pro",
            modelLabel: "gemini-2.5-pro",
            mode: "runtime_managed",
          },
        },
        fallbackUsed: false,
        fallbackIndex: null,
        fallbackFromProvider: null,
      },
    });

    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.runnerModel, "gemini-2.5-flash-lite");
    const args = JSON.parse(readFileSync(argsFile, "utf8")) as string[];
    assert.strictEqual(args[args.indexOf("--model") + 1], "gemini-2.5-flash-lite");
  });

  closeOrchestrationDb();
  rmSync(tempRoot, { recursive: true, force: true });

  finish({ summaryIndent: "  " });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
