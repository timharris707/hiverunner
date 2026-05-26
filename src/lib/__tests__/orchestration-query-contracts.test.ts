import assert from "node:assert";
import { rmSync } from "node:fs";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { createCompany } from "@/lib/orchestration/company-service";
import {
  createProject,
  createProjectAgent,
  createTask,
  getTask,
  listCompanyAgents,
  listProjects,
  listTasks,
  syncCompanyAgentsFromOpenClaw,
} from "@/lib/orchestration/service";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  [PASS] ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  [FAIL] ${name}`);
      console.error(`    ${message}`);
    });
}

async function run() {
  console.log("\nOrchestration Query Contracts Tests\n");
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const defaultCompanySlug = "neveridle-core";
  const otherCompany = createCompany({
    name: `Query Scope ${Date.now()}`,
    description: "fixture",
    status: "active",
  }).company;

  const defaultProject = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
    name: `Default Scope ${Date.now()}`,
    description: "Default company project",
    color: "#b45309",
    emoji: "🛰️",
    status: "active",
  }).project;

  const otherProject = createProject({
    companyId: otherCompany.id,
    name: `Other Scope ${Date.now()}`,
    description: "Other company project",
    color: "#f97316",
    emoji: "🔧",
    status: "active",
  }).project;

  const defaultAgent = createProjectAgent({
    projectId: defaultProject.id,
    name: `Scope Agent ${Date.now()}`,
    emoji: "🤖",
    role: "Backend Engineer",
    personality: "Precise",
    status: "idle",
    skills: [],
  }).agent;

  const qaRoleAgent = createProjectAgent({
    projectId: defaultProject.id,
    name: `Quality Gate ${Date.now()}`,
    emoji: "🛡️",
    role: "QA Lead",
    personality: "Strict reviewer",
    status: "idle",
    skills: [],
  }).agent;

  const otherAgent = createProjectAgent({
    projectId: otherProject.id,
    name: `Other Scope Agent ${Date.now()}`,
    emoji: "🧭",
    role: "Planner",
    personality: "Methodical",
    status: "idle",
    skills: [],
  }).agent;

  createTask({
    projectId: defaultProject.id,
    title: "Alpha critical task",
    description: "Search target alpha",
    priority: "P0",
    type: "feature",
    status: "in-progress",
    assignee: defaultAgent.id,
    labels: ["scope"],
    createdBy: "test",
  });

  createTask({
    projectId: defaultProject.id,
    title: "Beta low task",
    description: "Search target beta",
    priority: "P3",
    type: "bug",
    status: "to-do",
    labels: ["scope"],
    createdBy: "test",
  });

  createTask({
    projectId: otherProject.id,
    title: "Gamma external task",
    description: "Must stay out of default company queries",
    priority: "P1",
    type: "feature",
    status: "backlog",
    assignee: otherAgent.id,
    labels: ["external"],
    createdBy: "test",
  });

  await test("listProjects supports server-side company scope", () => {
    const scoped = listProjects({ companyIdOrSlug: otherCompany.slug }).projects;
    assert.ok(scoped.length >= 1, "Expected scoped projects for non-default company");
    assert.ok(scoped.every((project) => project.companyId === otherCompany.id));
    assert.ok(scoped.some((project) => project.id === otherProject.id));
    assert.ok(!scoped.some((project) => project.id === defaultProject.id));
  });

  await test("listTasks supports company + assignee + type + search filters", () => {
    const rows = listTasks({
      companyIdOrSlug: defaultCompanySlug,
      assignee: defaultAgent.id,
      type: "feature",
      search: "alpha",
      includeNonProduction: true,
    }).tasks;

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]?.title, "Alpha critical task");
  });

  await test("listTasks supports stable priority sorting", () => {
    const rows = listTasks({
      companyIdOrSlug: defaultCompanySlug,
      sort: "priority-asc",
      includeNonProduction: true,
    }).tasks;
    assert.ok(rows.length >= 2, "Expected at least two default-company tasks");
    assert.strictEqual(rows[0]?.priority, "P0");
  });

  await test("openclaw sync updates default company and skips non-default by default", () => {
    const defaultSync = syncCompanyAgentsFromOpenClaw({
      companyIdOrSlug: defaultCompanySlug,
      agents: [
        {
          id: "openclaw-forge",
          name: "Forge",
          emoji: "🔧",
          model: "gpt-5.4",
          status: "online",
        },
        {
          id: "openclaw-roster-new",
          name: `Roster New ${Date.now()}`,
          emoji: "🛰️",
          model: "gpt-5.4-mini",
          status: "offline",
        },
      ],
    });

    assert.ok(defaultSync.synced >= 1, "Expected at least one sync write in default company");

    const otherSync = syncCompanyAgentsFromOpenClaw({
      companyIdOrSlug: otherCompany.slug,
      agents: [{ id: "openclaw-other", name: "Should Skip" }],
    });

    assert.strictEqual(otherSync.synced, 0);
    assert.strictEqual(otherSync.inserted, 0);
    assert.strictEqual(otherSync.updated, 0);
  });

  await test("synced openclaw agent appears in company agent list", () => {
    const agents = listCompanyAgents(defaultCompanySlug, { includeNonProduction: true }).agents;
    assert.ok(
      agents.some((agent) => agent.openclawAgentId === "openclaw-roster-new"),
      "Expected synced OpenClaw agent in default company roster"
    );
  });

  await test("company roster keeps canonical seeded agents and QA roles visible", () => {
    const agents = listCompanyAgents(defaultCompanySlug).agents;
    const forgeCount = agents.filter((agent) => agent.name === "Forge").length;
    assert.strictEqual(forgeCount, 1, "Expected deduplicated Forge identity in production roster");
    assert.ok(
      agents.some((agent) => agent.id === qaRoleAgent.id),
      "Expected QA role agents to remain visible in production roster"
    );
    assert.ok(
      agents.some((agent) => agent.role.toLowerCase().includes("qa")),
      "Expected at least one QA-role agent in production roster"
    );
    assert.strictEqual(
      new Set(agents.map((agent) => agent.name.toLowerCase())).size,
      agents.length,
      "Expected roster names to be de-duplicated"
    );
  });

  await test("company agent/task queries reconcile stale terminal openclaw state", () => {
    const staleAgent = qaRoleAgent;

    const staleTask = createTask({
      projectId: defaultProject.id,
      title: "Stale terminal run should self-heal",
      description: "Regression fixture for stale live-state cleanup.",
      priority: "P1",
      type: "infrastructure",
      status: "in-progress",
      assignee: staleAgent.id,
      labels: ["scope", "stale-live"],
      createdBy: "test",
    }).task;

    const db = getOrchestrationDb();
    const now = new Date().toISOString();

    db.prepare(
      `UPDATE tasks
       SET execution_mode = 'openclaw',
           execution_session_id = ?,
           updated_at = ?
       WHERE id = ?`
    ).run("session-stale-live-123", now, staleTask.id);

    db.prepare(
      `UPDATE agents
       SET status = 'idle',
           current_task_id = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(staleTask.id, now, staleAgent.id);

    db.prepare(
      `INSERT INTO execution_runs
        (id, task_id, agent_id, provider, session_id, status, started_at, completed_at, error_message,
         token_usage_json, duration_ms, idempotency_key, created_at, updated_at)
       VALUES
        (?, ?, ?, 'openclaw', ?, 'completed', ?, ?, NULL,
         '{}', ?, NULL, ?, ?)`
    ).run(
      `run-stale-${staleTask.id}`,
      staleTask.id,
      staleAgent.id,
      "session-stale-live-123",
      now,
      now,
      1_000,
      now,
      now,
    );

    const refreshedTask = getTask(staleTask.id).task;
    assert.strictEqual(refreshedTask.status, "review");

    const taskRow = db
      .prepare("SELECT execution_session_id FROM tasks WHERE id = ?")
      .get(staleTask.id) as { execution_session_id: string | null } | undefined;
    assert.strictEqual(taskRow?.execution_session_id ?? null, null);

    const agents = listCompanyAgents(defaultCompanySlug, { includeNonProduction: true }).agents;
    const reconciledAgent = agents.find((agent) => agent.id === staleAgent.id);
    assert.ok(reconciledAgent, "Expected reconciled agent in company roster");
    assert.strictEqual(reconciledAgent?.status, "idle");
    assert.strictEqual(reconciledAgent?.currentTask, undefined);

    const scopedTasks = listTasks({
      companyIdOrSlug: defaultCompanySlug,
      includeNonProduction: true,
    }).tasks;
    const reconciledTask = scopedTasks.find((task) => task.id === staleTask.id);
    assert.strictEqual(reconciledTask?.status, "review");
  });

  await test("company roster ignores openclaw execution rows missing session truth", () => {
    const staleAgent = defaultAgent;
    const staleTask = createTask({
      projectId: defaultProject.id,
      title: "Orphaned openclaw execution row",
      description: "Should not keep agent working without session truth.",
      priority: "P1",
      type: "infrastructure",
      status: "in-progress",
      assignee: staleAgent.id,
      labels: ["scope", "stale-live", "orphaned-session"],
      createdBy: "test",
    }).task;

    const db = getOrchestrationDb();
    const now = new Date().toISOString();

    db.prepare(
      `UPDATE agents
       SET status = 'working',
           current_task_id = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(staleTask.id, now, staleAgent.id);

    db.prepare(
      `INSERT INTO execution_runs
        (id, task_id, agent_id, provider, session_id, status, started_at, completed_at, error_message,
         token_usage_json, duration_ms, idempotency_key, created_at, updated_at)
       VALUES
        (?, ?, ?, 'openclaw', NULL, 'running', ?, NULL, NULL,
         '{}', NULL, NULL, ?, ?)`
    ).run(
      `run-orphaned-${staleTask.id}`,
      staleTask.id,
      staleAgent.id,
      now,
      now,
      now,
    );

    const agents = listCompanyAgents(defaultCompanySlug, { includeNonProduction: true }).agents;
    const reconciledAgent = agents.find((agent) => agent.id === staleAgent.id);
    assert.ok(reconciledAgent, "Expected agent in company roster");
    assert.strictEqual(reconciledAgent?.status, "idle");
    assert.strictEqual(reconciledAgent?.currentTask, undefined);
  });

  await test("avatar theme catalog is company-scoped in schema and data writes", () => {
    const db = getOrchestrationDb();
    const columns = db
      .prepare("PRAGMA table_info(avatar_themes)")
      .all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));

    assert.ok(columnNames.has("company_id"));
    assert.ok(!columnNames.has("project_id"));

    const themedProject = createProject({
      companyId: otherCompany.id,
      name: `Theme Scope ${Date.now()}`,
      description: "Theme scope fixture",
      color: "#d97706",
      emoji: "🎯",
      status: "active",
      avatarThemeName: "Signal Neon",
    }).project;

    assert.ok(themedProject.id);

    const themeRow = db
      .prepare(
        `SELECT company_id, name, is_default
         FROM avatar_themes
         WHERE company_id = ? AND lower(name) = lower(?)
         LIMIT 1`
      )
      .get(otherCompany.id, "Signal Neon") as
      | { company_id: string; name: string; is_default: number }
      | undefined;

    assert.ok(themeRow, "Expected project create to write company-scoped theme catalog row");
    assert.strictEqual(themeRow?.company_id, otherCompany.id);
    assert.strictEqual(themeRow?.is_default, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
