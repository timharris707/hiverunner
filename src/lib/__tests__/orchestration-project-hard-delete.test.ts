/**
 * Contract test for hard project deletion cleanup and direct-test DB guard.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-project-hard-delete.db \
 *   npx tsx src/lib/__tests__/orchestration-project-hard-delete.test.ts
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${name}`);
      console.error(`    ${message}`);
    });
}

console.log("\nOrchestration Project Hard Delete Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-project-hard-delete-"));
  const workspaceRoot = path.join(tempRoot, "workspaces");
  const openclawDir = path.join(tempRoot, ".openclaw");

  process.env.MC_WORKSPACE_ROOT = workspaceRoot;
  process.env.OPENCLAW_DIR = openclawDir;
  process.env.OPENCLAW_WORKSPACE_ROOT = path.join(openclawDir, "workspace");

  try {
    if (dbPath) fs.rmSync(dbPath, { force: true });

    const { closeOrchestrationDb, getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { createCompany } = await import("@/lib/orchestration/company-service");
    const { createProject, createProjectAgent, createTask, hardDeleteProject } = await import("@/lib/orchestration/service");
    const {
      resolveCompanyAgentWorkspacePath,
      resolveCompanyProjectWorkspaceCandidates,
    } = await import("@/lib/workspaces/company-paths");

    await test("hard delete removes project rows, task rows, agent rows, and company workspace artifacts", async () => {
      const company = createCompany({
        name: `Delete Test Co ${Date.now()}`,
        description: "hard delete fixture",
        status: "active",
      }).company;

      const project = createProject({
        companyId: company.id,
        name: `Prompt Focus Cleanup ${Date.now()}`,
        description: "hard delete project fixture",
        color: "#0ea5e9",
        emoji: "🧪",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `Delete Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🔧",
        role: "Backend Engineer",
        personality: "Careful",
        openclawAgentId: `delete-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["cleanup"],
      }).agent;

      createTask({
        projectId: project.id,
        title: "Delete me",
        description: "fixture task",
        priority: "P1",
        type: "bug",
        status: "in-progress",
        assignee: agent.id,
        labels: ["cleanup"],
        createdBy: "test-suite",
      });

      const projectWorkspacePath = resolveCompanyProjectWorkspaceCandidates(company.workspace.root, {
        slug: project.slug,
        name: project.name,
      })[0];
      const agentWorkspacePath = resolveCompanyAgentWorkspacePath(company.workspace.root, agent.slug);
      assert.ok(projectWorkspacePath);
      assert.ok(agentWorkspacePath);

      fs.mkdirSync(path.join(projectWorkspacePath, "nested"), { recursive: true });
      fs.writeFileSync(path.join(projectWorkspacePath, "nested", "note.txt"), "fixture\n", "utf8");
      fs.mkdirSync(agentWorkspacePath!, { recursive: true });
      fs.writeFileSync(path.join(agentWorkspacePath!, "IDENTITY.md"), "fixture\n", "utf8");

      const result = hardDeleteProject(project.id);
      const db = getOrchestrationDb();
      const remainingProject = db.prepare("SELECT id FROM projects WHERE id = ?").get(project.id);
      const remainingAgent = db.prepare("SELECT id FROM agents WHERE id = ?").get(agent.id);
      const remainingTasks = db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE project_id = ?").get(project.id) as { count: number };

      assert.equal(result.projectId, project.id);
      assert.equal(result.projectSlug, project.slug);
      assert.deepEqual(result.openclawAgents.queued, [agent.openclawAgentId]);
      assert.equal(result.deletedCounts.project, 1);
      assert.equal(result.deletedCounts.agents, 1);
      assert.equal(result.deletedCounts.tasks, 1);
      assert.equal(remainingProject, undefined);
      assert.equal(remainingAgent, undefined);
      assert.equal(remainingTasks.count, 0);
      assert.equal(fs.existsSync(projectWorkspacePath), false);
      assert.equal(fs.existsSync(agentWorkspacePath!), false);
      assert.equal(result.workspace.projectPaths.some((entry) => entry.path === projectWorkspacePath && entry.deleted), true);
      assert.equal(result.workspace.agentPaths.some((entry) => entry.path === agentWorkspacePath && entry.deleted), true);
    });

    await test("direct __tests__ entrypoints fail fast without ORCHESTRATION_DB_PATH", () => {
      closeOrchestrationDb();

      const child = spawnSync(
        process.execPath,
        ["--import", "./scripts/register-ts-paths.mjs", "src/lib/__tests__/orchestration-heartbeat-prompt-focus.test.ts"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            ORCHESTRATION_DB_PATH: "",
          },
          encoding: "utf8",
        }
      );

      assert.notEqual(child.status, 0);
      assert.match(`${child.stderr}\n${child.stdout}`, /Refusing to run a direct test entrypoint against a live HiveRunner orchestration DB/);
    });
  } finally {
    const { closeOrchestrationDb } = await import("@/lib/orchestration/db");
    closeOrchestrationDb();
    if (dbPath) fs.rmSync(dbPath, { force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
