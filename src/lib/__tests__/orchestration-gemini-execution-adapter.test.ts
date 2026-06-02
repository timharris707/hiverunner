import assert from "node:assert";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  process.env.MC_GEMINI_EXEC_TIMEOUT_MS = "15000";
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";

  const { createCompany } = await import("@/lib/orchestration/company-service");
  const { getOrchestrationDb, closeOrchestrationDb } = await import("@/lib/orchestration/db");
  const { createProject, createProjectAgent } = await import("@/lib/orchestration/service");
  const { upsertCompanyRuntime } = await import("@/lib/orchestration/runtime-registry");
  const { geminiExecutionAdapter } = await import("@/lib/orchestration/execution/adapters");

  const db = getOrchestrationDb();
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
  const agent = createProjectAgent({
    projectId: project.id,
    name: "Gemini Runner",
    emoji: "G",
    role: "Engineer",
    personality: "Runs Gemini fixture tests.",
    status: "idle",
    skills: [],
  }).agent;

  db.prepare(
    `UPDATE agents
     SET adapter_type = 'gemini',
         model = 'google/gemini-2.5-pro',
         runtime_config_json = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      reasoningEffort: "high",
      speedPreference: "fast_1_5x",
      fastMode: true,
      serviceTier: "fast",
    }),
    new Date().toISOString(),
    agent.id,
  );

  upsertCompanyRuntime({
    companyIdOrSlug: company.id,
    agentId: agent.id,
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

  const agentRow = db.prepare(
    `SELECT id, name, role, personality, company_id, openclaw_agent_id,
            adapter_type, adapter_config_json, runtime_config_json,
            capabilities
     FROM agents
     WHERE id = ?`,
  ).get(agent.id) as {
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

  const baseInput = {
    agent: agentRow,
    prompt: "Run the Gemini adapter fixture.",
    session: {
      id: "gemini-runtime-config-session",
      agentId: agentRow.id,
      companyId: agentRow.company_id,
      adapterType: "gemini",
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
  };

  await test("route-attempt Gemini model wins without inventing unsupported control flags", async () => {
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
    assert.strictEqual(args[args.indexOf("--model") + 1], "gemini-3-flash-preview");
    assert.ok(!args.includes("--effort"), `Gemini reasoning is telemetry-only: ${args.join(" ")}`);
    assert.ok(!args.includes("--speed"), `Gemini speed is telemetry-only: ${args.join(" ")}`);
    assert.ok(!args.some((arg) => arg.includes("service_tier")), `Gemini service tier is telemetry-only: ${args.join(" ")}`);
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

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
