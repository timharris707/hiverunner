import assert from "node:assert";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { createProject, createProjectAgent, listCompanyAgents } from "@/lib/orchestration/service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { createIsolatedOrchestrationWorkspace } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";

const DEFAULT_COMPANY = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";

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
  console.log("\nAgent Effective Status Tests\n");
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "mc-agent-effective-status-",
  });

  try {
    const db = getOrchestrationDb();
    workspaceIsolation.syncDatabase(db);
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const project = createProject({
      companyId: DEFAULT_COMPANY,
      name: `Effective Status ${stamp}`,
      description: "fixture",
      color: "#a855f7",
      emoji: "⏸",
      status: "active",
    }).project;

    function seedFreshHeartbeatRun(agentId: string, companyId: string) {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO heartbeat_runs
          (id, agent_id, company_id, invocation_source, status,
           started_at, created_at, updated_at)
         VALUES (?, ?, ?, 'on_demand', 'running', ?, ?, ?)`
      ).run(randomUUID(), agentId, companyId, now, now, now);
    }

    await test("paused status beats fresh running heartbeat", () => {
      const agent = createProjectAgent({
        projectId: project.id,
        name: `PausedAgent ${stamp}`,
        emoji: "⏸",
        role: "Engineer",
        personality: "",
        status: "idle",
        skills: [],
      }).agent;

      // Simulate an in-flight heartbeat run (e.g. stuck from before pause).
      seedFreshHeartbeatRun(agent.id, DEFAULT_COMPANY);

      // Operator pauses the agent — persist 'paused' directly, mirroring the
      // heartbeatProjectAgent path.
      db.prepare(
        "UPDATE agents SET status = 'paused', updated_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), agent.id);

      const listed = listCompanyAgents(DEFAULT_COMPANY).agents.find(
        (a) => a.id === agent.id
      );
      assert.ok(listed, "paused agent must still appear in list");
      assert.strictEqual(
        listed!.status,
        "paused",
        `paused agent with fresh heartbeat must resolve as paused, got: ${listed!.status}`
      );
    });

    await test("offline status beats fresh running heartbeat", () => {
      const agent = createProjectAgent({
        projectId: project.id,
        name: `OfflineAgent ${stamp}`,
        emoji: "📴",
        role: "Engineer",
        personality: "",
        status: "idle",
        skills: [],
      }).agent;

      seedFreshHeartbeatRun(agent.id, DEFAULT_COMPANY);

      db.prepare(
        "UPDATE agents SET status = 'offline', updated_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), agent.id);

      const listed = listCompanyAgents(DEFAULT_COMPANY).agents.find(
        (a) => a.id === agent.id
      );
      assert.ok(listed, "offline agent must still appear in list");
      assert.strictEqual(
        listed!.status,
        "offline",
        `offline agent with fresh heartbeat must resolve as offline, got: ${listed!.status}`
      );
    });

    await test("idle agent with fresh running heartbeat still resolves as working (regression guard)", () => {
      const agent = createProjectAgent({
        projectId: project.id,
        name: `WorkingAgent ${stamp}`,
        emoji: "🔧",
        role: "Engineer",
        personality: "",
        status: "idle",
        skills: [],
      }).agent;

      seedFreshHeartbeatRun(agent.id, DEFAULT_COMPANY);

      const listed = listCompanyAgents(DEFAULT_COMPANY).agents.find(
        (a) => a.id === agent.id
      );
      assert.ok(listed, "idle agent must appear in list");
      assert.strictEqual(
        listed!.status,
        "working",
        `idle agent with fresh heartbeat must resolve as working, got: ${listed!.status}`
      );
    });
  } finally {
    workspaceIsolation.dispose();
  }

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
