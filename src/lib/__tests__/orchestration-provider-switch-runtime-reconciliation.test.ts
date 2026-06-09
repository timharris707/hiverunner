import assert from "node:assert/strict";
import path from "node:path";

import { restoreEnvSnapshot, setTestNodeEnv, snapshotEnv } from "@/lib/__tests__/helpers/env-test-harness";
import {
  createIsolatedOrchestrationWorkspace,
  resetSqliteDatabaseFiles,
} from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

const { finish, test } = createTestRunner({ passLabel: "pass", failLabel: "fail" });

async function run() {
  console.log("\nProvider Switch Runtime Reconciliation Tests\n");

  const envSnapshot = snapshotEnv(["NODE_ENV", "ORCHESTRATION_DB_PATH", "MC_WORKSPACE_ROOT"]);
  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "orchestration-provider-switch-runtime-",
  });
  const dbPath = path.join(workspaceIsolation.tempRoot, "orchestration.db");
  let closeOrchestrationDb: (() => void) | undefined;

  try {
    process.env.ORCHESTRATION_DB_PATH = dbPath;
    process.env.MC_WORKSPACE_ROOT = workspaceIsolation.workspaceRoot;
    setTestNodeEnv("development");
    resetSqliteDatabaseFiles(dbPath);

    const { createCompany } = await import("@/lib/orchestration/company-service");
    const dbModule = await import("@/lib/orchestration/db");
    const { createProject, createProjectAgent } = await import("@/lib/orchestration/service");
    const { switchAgentProvider } = await import("@/lib/orchestration/service/provider-switch");

    closeOrchestrationDb = dbModule.closeOrchestrationDb;
    const db = dbModule.getOrchestrationDb();
    const company = createCompany({
      name: "Provider Switch Runtime Co",
      description: "fixture",
      status: "active",
    }).company;
    const project = createProject({
      companyId: company.id,
      name: "Runtime Switch Project",
      description: "fixture",
      color: "#0ea5e9",
      emoji: "icon:route",
      status: "active",
    }).project;
    const agent = createProjectAgent({
      projectId: project.id,
      name: "Scout",
      emoji: "icon:search",
      role: "Research Agent",
      personality: "Checks runtime routing.",
      adapterType: "openclaw",
      openclawAgentId: "provider-switch-runtime-scout",
      model: "openai-codex/gpt-5.4",
      skills: [],
      status: "idle",
    }).agent;

    await test("switching from OpenClaw to Codex disables stale OpenClaw runtime and attaches Codex runtime", () => {
      const before = db
        .prepare("SELECT provider, status, command FROM agent_runtimes WHERE agent_id = ?")
        .all(agent.id) as Array<{ provider: string; status: string; command: string | null }>;
      assert.deepEqual(before.map((row) => row.provider), ["openclaw"]);
      assert.equal(before[0]?.command, "openclaw");

      const result = switchAgentProvider(agent.id, "codex", undefined, {
        requireApproval: false,
        billingConfirmed: true,
        actorUserId: "test",
        targetModel: "gpt-5.5",
      });

      assert.equal(result.switched, true);
      assert.equal(result.blockReason, null);

      const switchedAgent = db
        .prepare("SELECT adapter_type, model, previous_adapter_type FROM agents WHERE id = ?")
        .get(agent.id) as { adapter_type: string; model: string; previous_adapter_type: string | null };
      assert.equal(switchedAgent.adapter_type, "codex");
      assert.equal(switchedAgent.model, "gpt-5.5");
      assert.equal(switchedAgent.previous_adapter_type, "openclaw");

      const runtimeState = db
        .prepare("SELECT adapter_type, session_id, last_run_id, last_run_status, last_error FROM agent_runtime_state WHERE agent_id = ?")
        .get(agent.id) as {
          adapter_type: string;
          session_id: string | null;
          last_run_id: string | null;
          last_run_status: string | null;
          last_error: string | null;
        };
      assert.equal(runtimeState.adapter_type, "codex");
      assert.equal(runtimeState.session_id, null);
      assert.equal(runtimeState.last_run_id, null);
      assert.equal(runtimeState.last_run_status, null);
      assert.equal(runtimeState.last_error, null);

      const runtimes = db
        .prepare(
          `SELECT provider, status, command, runtime_slug, metadata_json
           FROM agent_runtimes
           WHERE agent_id = ?
           ORDER BY provider`,
        )
        .all(agent.id) as Array<{
          provider: string;
          status: string;
          command: string | null;
          runtime_slug: string;
          metadata_json: string;
        }>;
      assert.equal(runtimes.length, 2);

      const codexRuntime = runtimes.find((row) => row.provider === "codex");
      assert.ok(codexRuntime);
      assert.equal(codexRuntime.status, "unknown");
      assert.equal(codexRuntime.command, null);
      assert.equal(codexRuntime.runtime_slug, "scout");
      const codexMetadata = JSON.parse(codexRuntime.metadata_json) as Record<string, unknown>;
      assert.equal(codexMetadata.source, "provider_switch");
      assert.equal(codexMetadata.previousProvider, "openclaw");
      assert.equal(codexMetadata.targetProvider, "codex");
      assert.equal(codexMetadata.model, "gpt-5.5");

      const openClawRuntime = runtimes.find((row) => row.provider === "openclaw");
      assert.ok(openClawRuntime);
      assert.equal(openClawRuntime.status, "disabled");
      assert.equal(openClawRuntime.command, "openclaw");
      const openClawMetadata = JSON.parse(openClawRuntime.metadata_json) as Record<string, unknown>;
      assert.equal(openClawMetadata.disabledBy, "provider_switch");
      assert.equal(openClawMetadata.previousProvider, "openclaw");
      assert.equal(openClawMetadata.targetProvider, "codex");
      assert.equal(openClawMetadata.targetModel, "gpt-5.5");
    });
  } finally {
    closeOrchestrationDb?.();
    restoreEnvSnapshot(envSnapshot);
    workspaceIsolation.dispose();
  }

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
