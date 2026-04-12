import assert from "node:assert";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  \u2713 ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  \u2717 ${name}`);
      console.error(`    ${message}`);
    });
}

async function run() {
  console.log("\nCompany Agent Provisioning Runtime Identity Tests\n");

  const tempRoot = mkdtempSync(
    path.join(os.tmpdir(), "orchestration-company-agent-provisioning-runtime-identity-"),
  );
  const homeDir = path.join(tempRoot, "home");
  const binDir = path.join(tempRoot, "bin");
  const dbPath = path.join(tempRoot, "orchestration.db");
  const mcWorkspaceRoot = path.join(homeDir, ".mission-control", "dev", "workspaces");
  const fakeOpenClawPath = path.join(binDir, "openclaw");

  mkdirSync(binDir, { recursive: true });
  mkdirSync(mcWorkspaceRoot, { recursive: true });

  writeFileSync(
    fakeOpenClawPath,
    "#!/bin/sh\nif [ \"$1\" = \"agents\" ] && [ \"$2\" = \"add\" ]; then\n  printf '{\"agentId\":\"%s\"}\\n' \"$3\"\n  exit 0\nfi\nexit 1\n",
    "utf8",
  );
  chmodSync(fakeOpenClawPath, 0o755);

  process.env.HOME = homeDir;
  process.env.ORCHESTRATION_DB_PATH = dbPath;
  process.env.MC_WORKSPACE_ROOT = mcWorkspaceRoot;
  process.env.NODE_ENV = "development";
  process.env.PATH = `${binDir}:${process.env.PATH || ""}`;

  const { createCompany } = await import("@/lib/orchestration/company-service");
  const { createProject } = await import("@/lib/orchestration/service");
  const { closeOrchestrationDb, getOrchestrationDb } = await import("@/lib/orchestration/db");
  const { materializeApprovedHireAgent, stagePendingHireAgent } = await import(
    "@/lib/orchestration/service/company-agent-provisioning"
  );

  const company = createCompany({
    name: "Provisioning Runtime Identity Co",
    description: "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: "Operations",
    description: "fixture",
    color: "#0ea5e9",
    emoji: "\ud83d\ude80",
    status: "active",
  }).project;

  await test("approved hires use human-readable OpenClaw runtime ids for new agents", () => {
    const db = getOrchestrationDb();

    const result = materializeApprovedHireAgent({
      approvalCompanyId: company.id,
      requestedByAgentId: null,
      payload: {
        projectId: project.id,
        name: "Forge",
        role: "Backend Engineer",
        model: "openai/gpt-5.4",
      },
      db,
    });

    const row = db
      .prepare("SELECT runtime_slug, openclaw_agent_id FROM agents WHERE id = ?")
      .get(result.agentId) as
      | {
          runtime_slug: string | null;
          openclaw_agent_id: string | null;
        }
      | undefined;

    const expectedRuntimeId = `mc-${company.runtimeSlug}-forge`;
    assert.strictEqual(result.runtimeSlug, "forge");
    assert.strictEqual(result.openclawAgentId, expectedRuntimeId);
    assert.strictEqual(row?.runtime_slug, "forge");
    assert.strictEqual(row?.openclaw_agent_id, expectedRuntimeId);
    assert.ok(result.workspacePath.endsWith("/agents/forge"));
  });

  await test("approval materialization reuses a staged agent when payload only has agentName", () => {
    const db = getOrchestrationDb();

    const staged = stagePendingHireAgent({
      approvalCompanyId: company.id,
      requestedByAgentId: null,
      payload: {
        projectId: project.id,
        name: "John Denver",
        role: "Singer",
        personality: "Country singer fixture.",
        mission: "Verify hire approvals do not duplicate staged agents.",
        model: "openai/gpt-5.4",
      },
      db,
    });

    const materialized = materializeApprovedHireAgent({
      approvalCompanyId: company.id,
      requestedByAgentId: null,
      payload: {
        agentId: staged.agentId,
        agentName: "John Denver",
        role: "Singer",
        model: "openai/gpt-5.4",
      },
      db,
    });

    const rows = db
      .prepare(
        `SELECT id, name, status, runtime_slug, openclaw_agent_id
         FROM agents
         WHERE company_id = ?
           AND lower(name) IN ('john denver', 'unnamed agent')
         ORDER BY created_at ASC`
      )
      .all(company.id) as Array<{
        id: string;
        name: string;
        status: string;
        runtime_slug: string | null;
        openclaw_agent_id: string | null;
      }>;

    assert.strictEqual(materialized.agentId, staged.agentId);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]?.id, staged.agentId);
    assert.strictEqual(rows[0]?.name, "John Denver");
    assert.strictEqual(rows[0]?.status, "idle");
    assert.strictEqual(rows[0]?.runtime_slug, "john-denver");
    assert.strictEqual(rows[0]?.openclaw_agent_id, `mc-${company.runtimeSlug}-john-denver`);
  });

  closeOrchestrationDb();
  rmSync(tempRoot, { force: true, recursive: true });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
