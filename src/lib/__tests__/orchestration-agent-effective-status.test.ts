import assert from "node:assert";
import { randomUUID } from "node:crypto";

import { createProjectAgent, listCompanyAgents } from "@/lib/orchestration/service";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { withIsolatedAgentProjectFixture } from "@/lib/__tests__/helpers/orchestration-agent-project-fixture";

const DEFAULT_COMPANY = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";

const { finish, test } = createTestRunner({ passLabel: "\u2713", failLabel: "\u2717" });

async function run() {
  console.log("\nAgent Effective Status Tests\n");
  await withIsolatedAgentProjectFixture(
    {
      companyId: DEFAULT_COMPANY,
      projectNamePrefix: "Effective Status",
      color: "#a855f7",
      emoji: "⏸",
      workspacePrefix: "mc-agent-effective-status-",
    },
    async ({ db, project, stamp }) => {

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
    },
  );

  finish({ summaryIndent: "  " });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
