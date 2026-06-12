import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createIsolatedOrchestrationWorkspace,
  resetSqliteDatabaseFiles,
} from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import {
  DEFAULT_ORCHESTRATION_COMPANY_ID,
  createFixtureAgent,
  createFixtureProject,
} from "@/lib/__tests__/helpers/orchestration-create-task-fixtures";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

process.env.ORCHESTRATION_DB_PATH ||= path.join(
  tmpdir(),
  `orchestration-company-lead-designation-${process.pid}-${Date.now()}.db`,
);

const { finish, test } = createTestRunner({ passLabel: "pass", failLabel: "fail" });

async function run() {
  console.log("\nCompany Lead Designation Tests\n");
  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);

  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "mc-company-lead-",
  });

  try {
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { findCompanyCeo } = await import("@/lib/orchestration/engine/engine-queries");
    const { getCompanyLeadAgent, setCompanyLeadAgent } = await import("@/lib/orchestration/company-lead");
    const { createProject } = await import("@/lib/orchestration/service/project");
    const { createProjectAgent } = await import("@/lib/orchestration/service/agent");

    const db = getOrchestrationDb();
    workspaceIsolation.syncDatabase(db);
    const companyId = DEFAULT_ORCHESTRATION_COMPANY_ID;

    const project = createFixtureProject(createProject, {
      namePrefix: "LeadDesignation",
      description: "Company lead designation tests",
      color: "#88ff88",
      emoji: "👑",
    });
    const ceoTitled = createFixtureAgent(createProjectAgent, {
      projectId: project.id,
      namePrefix: "barometer",
      emoji: "🌤️",
      role: "Weather CEO",
      skills: ["orchestration"],
    });
    const eagle = createFixtureAgent(createProjectAgent, {
      projectId: project.id,
      namePrefix: "eagle",
      emoji: "🦅",
      role: "Eagle",
      skills: ["orchestration"],
    });

    await test("without a designation, the role-title heuristic still resolves the lead", () => {
      db.prepare("UPDATE companies SET lead_agent_id = NULL WHERE id = ?").run(companyId);
      const lead = findCompanyCeo(companyId, db);
      assert.ok(lead, "expected heuristic fallback to find the CEO-titled agent");
      assert.equal(lead?.id, ceoTitled.id);
    });

    await test("an arbitrary-titled designated lead beats the CEO-titled heuristic match", () => {
      const designated = setCompanyLeadAgent({ companyId, agentId: eagle.id }, db);
      assert.equal(designated.role, "Eagle");
      assert.equal(getCompanyLeadAgent(companyId, db)?.id, eagle.id);
      const lead = findCompanyCeo(companyId, db);
      assert.equal(lead?.id, eagle.id, "designation must be authoritative over role strings");
    });

    await test("archiving the designated lead falls back to the heuristic", () => {
      db.prepare("UPDATE agents SET archived_at = ? WHERE id = ?").run(new Date().toISOString(), eagle.id);
      const lead = findCompanyCeo(companyId, db);
      assert.equal(lead?.id, ceoTitled.id, "archived designation must not capture routing");
      db.prepare("UPDATE agents SET archived_at = NULL WHERE id = ?").run(eagle.id);
    });

    await test("designation rejects agents outside the company and archived agents", () => {
      assert.throws(
        () => setCompanyLeadAgent({ companyId: "some-other-company", agentId: eagle.id }, db),
        /belong to the company/i,
      );
      db.prepare("UPDATE agents SET archived_at = ? WHERE id = ?").run(new Date().toISOString(), eagle.id);
      assert.throws(
        () => setCompanyLeadAgent({ companyId, agentId: eagle.id }, db),
        /archived/i,
      );
      db.prepare("UPDATE agents SET archived_at = NULL WHERE id = ?").run(eagle.id);
      assert.throws(
        () => setCompanyLeadAgent({ companyId, agentId: "missing-agent-id" }, db),
        /not found/i,
      );
    });

    await test("switching the lead is a single re-designation", () => {
      setCompanyLeadAgent({ companyId, agentId: eagle.id }, db);
      assert.equal(findCompanyCeo(companyId, db)?.id, eagle.id);
      setCompanyLeadAgent({ companyId, agentId: ceoTitled.id }, db);
      assert.equal(findCompanyCeo(companyId, db)?.id, ceoTitled.id);
    });
  } finally {
    workspaceIsolation.dispose();
  }

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
