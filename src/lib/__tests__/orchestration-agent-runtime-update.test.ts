import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
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

async function run() {
  console.log("\nAgent Runtime Update Tests\n");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "orchestration-agent-runtime-update-"));
  const workspaceRoot = path.join(tempRoot, "workspaces");
  const dbPath = path.join(tempRoot, "orchestration.db");
  mkdirSync(workspaceRoot, { recursive: true });

  process.env.ORCHESTRATION_DB_PATH = dbPath;
  process.env.MC_WORKSPACE_ROOT = workspaceRoot;
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";

  const { OrchestrationApiError } = await import("@/lib/orchestration/api");
  const { createCompany } = await import("@/lib/orchestration/company-service");
  const { closeOrchestrationDb, getOrchestrationDb } = await import("@/lib/orchestration/db");
  const { executeMcAction } = await import("@/lib/orchestration/engine/action-dispatcher");
  const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
  const { listApprovals } = await import("@/lib/orchestration/service/approval");
  const { applyApprovedAgentRuntimeUpdate } = await import("@/lib/orchestration/service/agent-runtime-update");

  const db = getOrchestrationDb();
  const company = createCompany({
    name: "Runtime Update Fixture Co",
    description: "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: "Runtime Update Project",
    description: "fixture",
    color: "#22c55e",
    emoji: "icon:bot",
    status: "active",
  }).project;
  const overseer = createProjectAgent({
    projectId: project.id,
    name: "Overseer",
    emoji: "icon:radar",
    role: "Runtime Governance",
    personality: "Approves runtime changes.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const oracle = createProjectAgent({
    projectId: project.id,
    name: "Oracle",
    emoji: "icon:sparkles",
    role: "Lead",
    personality: "Coordinates work.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const claude = createProjectAgent({
    projectId: project.id,
    name: "Claude Runtime",
    emoji: "icon:brain",
    role: "Research",
    personality: "Uses Claude.",
    model: "claude-sonnet-4-6",
    skills: [],
    status: "idle",
  }).agent;
  const task = createTask({
    projectId: project.id,
    title: "Govern runtime settings",
    description: "fixture",
    priority: "P2",
    type: "maintenance",
    status: "in-progress",
    assignee: overseer.id,
    labels: [],
    createdBy: "test",
  }).task;

  function configureRuntime(input: {
    agentId: string;
    adapterType: string;
    provider: string;
    model: string;
    runtimeConfig: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }) {
    const now = new Date().toISOString();
    db.prepare("UPDATE agents SET adapter_type = ?, model = ?, runtime_config_json = ?, updated_at = ? WHERE id = ?").run(
      input.adapterType,
      input.model,
      JSON.stringify(input.runtimeConfig),
      now,
      input.agentId,
    );
    db.prepare(
      `UPDATE agent_runtimes
       SET provider = ?,
           runtime_kind = 'cli',
           status = 'online',
           command = ?,
           metadata_json = ?,
           workspace_root = ?,
           updated_at = ?
       WHERE company_id = ?
         AND agent_id = ?
         AND scope = 'agent'`,
    ).run(
      input.provider,
      input.provider === "anthropic" ? "claude" : "codex",
      JSON.stringify(input.metadata),
      path.join(workspaceRoot, input.agentId),
      now,
      company.id,
      input.agentId,
    );
  }

  configureRuntime({
    agentId: oracle.id,
    adapterType: "codex",
    provider: "codex",
    model: "openai-codex/gpt-5.5",
    runtimeConfig: { reasoningEffort: "high", speedPreference: "standard", fastMode: false, serviceTier: "default", modelLane: "default" },
    metadata: { reasoningEffort: "high", modelReasoningEffort: "high", speedPreference: "standard", fastMode: false, serviceTier: "default" },
  });
  configureRuntime({
    agentId: claude.id,
    adapterType: "anthropic",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    runtimeConfig: { reasoningEffort: "high" },
    metadata: { reasoningEffort: "high" },
  });

  await test("dispatcher-created update_agent approval applies Oracle runtime controls only after approval", async () => {
    const action = {
      action: "update_agent" as const,
      companySlug: company.slug,
      agentId: oracle.id,
      agentName: "Oracle",
      changes: {
        runtimeConfig: {
          reasoningEffort: "xhigh",
          modelReasoningEffort: "xhigh",
          thinkingLevel: "xhigh",
          speedPreference: "fast",
          fastMode: true,
          serviceTier: "fast",
          modelLane: "deep",
        },
        runtimeMetadataPatch: {
          reasoningEffort: "xhigh",
          modelReasoningEffort: "xhigh",
          speedPreference: "fast",
          fastMode: true,
          serviceTier: "fast",
        },
      },
      reason: "Operator requested Oracle use xhigh reasoning and fast runtime.",
    };

    const outcome = await executeMcAction(action, {
      agentId: overseer.id,
      agentName: overseer.name,
      companyId: company.id,
      taskKey: task.taskKey,
      runId: `run-${randomUUID()}`,
      source: "test",
    }, db);
    assert.strictEqual(outcome.kind, "created_approval");

    const beforeApproval = db.prepare("SELECT runtime_config_json FROM agents WHERE id = ?").get(oracle.id) as { runtime_config_json: string };
    assert.strictEqual(JSON.parse(beforeApproval.runtime_config_json).reasoningEffort, "high");
    assert.strictEqual(JSON.parse(beforeApproval.runtime_config_json).fastMode, false);

    const approval = listApprovals({ companyIdOrSlug: company.id, type: "protected_runtime_command" })
      .approvals
      .find((candidate) => candidate.id === outcome.approvalId);
    assert.ok(approval);
    assert.strictEqual(approval.payload.actionType, "update_agent");

    const applied = applyApprovedAgentRuntimeUpdate({
      companyId: company.id,
      action: approval.payload.action,
      approvalId: approval.id,
      actorUserId: "operator",
      db,
    });
    assert.deepStrictEqual(
      new Set(applied.changedFields),
      new Set([
        "runtimeConfig.reasoningEffort",
        "runtimeConfig.modelReasoningEffort",
        "runtimeConfig.thinkingLevel",
        "runtimeConfig.speedPreference",
        "runtimeConfig.fastMode",
        "runtimeConfig.serviceTier",
        "runtimeConfig.modelLane",
        "runtimeMetadataPatch.reasoningEffort",
        "runtimeMetadataPatch.modelReasoningEffort",
        "runtimeMetadataPatch.speedPreference",
        "runtimeMetadataPatch.fastMode",
        "runtimeMetadataPatch.serviceTier",
      ]),
    );

    const updatedAgent = db.prepare("SELECT runtime_config_json FROM agents WHERE id = ?").get(oracle.id) as { runtime_config_json: string };
    const updatedRuntime = db.prepare("SELECT metadata_json FROM agent_runtimes WHERE agent_id = ?").get(oracle.id) as { metadata_json: string };
    const runtimeConfig = JSON.parse(updatedAgent.runtime_config_json) as Record<string, unknown>;
    const metadata = JSON.parse(updatedRuntime.metadata_json) as Record<string, unknown>;

    assert.strictEqual(runtimeConfig.reasoningEffort, "xhigh");
    assert.strictEqual(runtimeConfig.modelReasoningEffort, "xhigh");
    assert.strictEqual(runtimeConfig.thinkingLevel, "xhigh");
    assert.strictEqual(runtimeConfig.speedPreference, "fast");
    assert.strictEqual(runtimeConfig.fastMode, true);
    assert.strictEqual(runtimeConfig.serviceTier, "fast");
    assert.strictEqual(runtimeConfig.modelLane, "deep");
    assert.strictEqual(metadata.reasoningEffort, "xhigh");
    assert.strictEqual(metadata.fastMode, true);
    assert.strictEqual(metadata.serviceTier, "fast");
  });

  await test("approved update_agent rejects unsafe runtime fields", () => {
    assert.throws(
      () => applyApprovedAgentRuntimeUpdate({
        companyId: company.id,
        action: {
          action: "update_agent",
          agentId: oracle.id,
          changes: {
            runtimeConfig: {
              reasoningEffort: "xhigh",
              temperature: 1,
            },
          },
        },
        approvalId: "approval-unsafe",
        actorUserId: "operator",
        db,
      }),
      (error: unknown) => error instanceof OrchestrationApiError && error.code === "unsafe_agent_update_field",
    );
  });

  await test("Anthropic-backed agent accepts max reasoning while Codex rejects it", () => {
    const applied = applyApprovedAgentRuntimeUpdate({
      companyId: company.id,
      action: {
        action: "update_agent",
        agentId: claude.id,
        changes: {
          runtimeConfig: { reasoningEffort: "max" },
          runtimeMetadataPatch: { reasoningEffort: "max" },
        },
      },
      actorUserId: "operator",
      db,
    });
    assert.ok(applied.changedFields.includes("runtimeConfig.reasoningEffort"));

    const updatedClaude = db.prepare("SELECT runtime_config_json FROM agents WHERE id = ?").get(claude.id) as { runtime_config_json: string };
    assert.strictEqual(JSON.parse(updatedClaude.runtime_config_json).reasoningEffort, "max");

    assert.throws(
      () => applyApprovedAgentRuntimeUpdate({
        companyId: company.id,
        action: {
          action: "update_agent",
          agentId: oracle.id,
          changes: {
            runtimeConfig: { reasoningEffort: "max" },
          },
        },
        approvalId: "approval-codex-max",
        actorUserId: "operator",
        db,
      }),
      (error: unknown) => error instanceof OrchestrationApiError && error.code === "invalid_reasoning_effort",
    );
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
