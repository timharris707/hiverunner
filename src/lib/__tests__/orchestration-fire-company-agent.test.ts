import assert from "node:assert";
import { rmSync } from "node:fs";

import {
  assignTask,
  createProject,
  createProjectAgent,
  createTask,
  createTaskComment,
  fireCompanyAgent,
  getTask,
  listProjectAgents,
  listTaskComments,
} from "@/lib/orchestration/service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { OrchestrationApiError } from "@/lib/orchestration/api";

const DEFAULT_COMPANY = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";
const OTHER_COMPANY = "830d5f6b-b9f1-4288-ada5-89868513c21d";

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
  console.log("\nFire Company Agent Cascade Tests\n");
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  // Seed a second company row so cross-company rejection can be exercised.
  const db = getOrchestrationDb();
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO companies
      (id, name, slug, description, status, created_at, updated_at, runtime_slug)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
  ).run(
    OTHER_COMPANY,
    "Fixture Other Company",
    "fire-test-other",
    "Cross-company fixture for fire-agent tests",
    nowIso,
    nowIso,
    "fire-test-other"
  );

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const primary = createProject({
    companyId: DEFAULT_COMPANY,
    name: `Fire Cascade Primary ${stamp}`,
    description: "fixture",
    color: "#0ea5e9",
    emoji: "🧯",
    status: "active",
  }).project;

  const other = createProject({
    companyId: OTHER_COMPANY,
    name: `Fire Cascade Other ${stamp}`,
    description: "fixture",
    color: "#f97316",
    emoji: "🌋",
    status: "active",
  }).project;

  await test("fire without replacement nulls reporting_to and rewrites text to fallback", () => {
    const oldCeo = createProjectAgent({
      projectId: primary.id,
      name: `Ridgecap ${stamp}`,
      emoji: "⛰️",
      role: "CEO",
      personality: "Outgoing",
      status: "idle",
      skills: [],
    }).agent;

    const worker = createProjectAgent({
      projectId: primary.id,
      name: `Worker1 ${stamp}`,
      emoji: "🔧",
      role: "Engineer",
      personality: "Reports to Ridgecap",
      status: "idle",
      skills: [],
      reportingTo: oldCeo.id,
    }).agent;

    const task = createTask({
      projectId: primary.id,
      title: `${oldCeo.name} to decide the Bridge workflow`,
      description: `Blocked: ${oldCeo.name} needs to pick an owner. Bridge stays unchanged.`,
      priority: "P1",
      type: "feature",
      status: "on-deck",
      labels: [],
      createdBy: "test",
    }).task;

    assignTask({ taskId: task.id, assignee: oldCeo.id, actorUserId: "test" });

    const result = fireCompanyAgent({
      agentId: oldCeo.id,
      replacementFallback: "the operator",
    });

    assert.strictEqual(result.cascade.tasksReassigned, 1);
    assert.strictEqual(result.cascade.titlesRewritten, 1);
    assert.strictEqual(result.cascade.descriptionsRewritten, 1);
    assert.strictEqual(result.cascade.reportsToUpdated, 1);

    const loaded = getTask(task.id).task;
    assert.ok(!loaded.assignee, `assignee should be empty after fire-without-replacement, got: ${loaded.assignee}`);
    assert.ok(loaded.title.includes("the operator"), `expected title to include fallback, got: ${loaded.title}`);
    assert.ok(!loaded.title.includes(oldCeo.name.split(" ")[0]), `expected name removed, got: ${loaded.title}`);
    assert.ok(loaded.description.includes("Bridge stays unchanged"), "word-boundary rewrite must not match substrings like Bridge");

    const updatedAgents = listProjectAgents(primary.id).agents;
    const reloadedWorker = updatedAgents.find((a) => a.id === worker.id);
    assert.ok(reloadedWorker, "worker row must still exist");
    assert.ok(!reloadedWorker!.reportingTo, `worker reporting_to should be empty, got: ${reloadedWorker!.reportingTo}`);

    const archivedRow = db
      .prepare("SELECT archived_at FROM agents WHERE id = ?")
      .get(oldCeo.id) as { archived_at: string | null } | undefined;
    assert.ok(archivedRow?.archived_at, "fired agent must have archived_at set");
  });

  await test("fire with replacement reassigns tasks and cascades reporting_to", () => {
    const oldCeo = createProjectAgent({
      projectId: primary.id,
      name: `Mountainpeak ${stamp}`,
      emoji: "🏔️",
      role: "CEO",
      personality: "Old CEO",
      status: "idle",
      skills: [],
    }).agent;

    const newCeo = createProjectAgent({
      projectId: primary.id,
      name: `Skyline ${stamp}`,
      emoji: "🌇",
      role: "CEO",
      personality: "New CEO",
      status: "idle",
      skills: [],
    }).agent;

    const worker = createProjectAgent({
      projectId: primary.id,
      name: `Worker2 ${stamp}`,
      emoji: "🔨",
      role: "Engineer",
      personality: "Reports to Mountainpeak",
      status: "idle",
      skills: [],
      reportingTo: oldCeo.id,
    }).agent;

    const task = createTask({
      projectId: primary.id,
      title: `${oldCeo.name} to approve launch`,
      description: `${oldCeo.name} must sign off before launch.`,
      priority: "P0",
      type: "feature",
      status: "on-deck",
      labels: [],
      createdBy: "test",
    }).task;

    assignTask({ taskId: task.id, assignee: oldCeo.id, actorUserId: "test" });

    createTaskComment({
      taskId: task.id,
      body: `${oldCeo.name} owns this.`,
      type: "comment",
      authorUserId: "test",
    });

    const result = fireCompanyAgent({
      agentId: oldCeo.id,
      replacementAgentId: newCeo.id,
    });

    assert.strictEqual(result.cascade.tasksReassigned, 1);
    assert.strictEqual(result.cascade.reportsToUpdated, 1);
    assert.ok(result.cascade.titlesRewritten >= 1);
    assert.ok(result.cascade.descriptionsRewritten >= 1);

    const loaded = getTask(task.id).task;
    assert.strictEqual(loaded.assignee, newCeo.name);
    assert.ok(loaded.title.includes(newCeo.name), `title should name the replacement, got: ${loaded.title}`);
    assert.ok(!loaded.title.includes(oldCeo.name), `title should no longer name the departed, got: ${loaded.title}`);
    assert.ok(loaded.description.includes(newCeo.name));

    const comments = listTaskComments(task.id).comments;
    const ownComment = comments.find((c) => c.text.includes(oldCeo.name));
    assert.ok(ownComment, "comment bodies must remain unchanged (historical record)");

    const updatedAgents = listProjectAgents(primary.id).agents;
    const reloadedWorker = updatedAgents.find((a) => a.id === worker.id);
    assert.strictEqual(reloadedWorker!.reportingTo, newCeo.id);
  });

  await test("fire rejects same-id replacement", () => {
    const solo = createProjectAgent({
      projectId: primary.id,
      name: `Solo ${stamp}`,
      emoji: "🧘",
      role: "Generalist",
      personality: "",
      status: "idle",
      skills: [],
    }).agent;

    assert.throws(
      () =>
        fireCompanyAgent({
          agentId: solo.id,
          replacementAgentId: solo.id,
        }),
      (err: unknown) =>
        err instanceof OrchestrationApiError && err.code === "replacement_invalid"
    );
  });

  await test("fire rejects replacement from another company", () => {
    const victim = createProjectAgent({
      projectId: primary.id,
      name: `Victim ${stamp}`,
      emoji: "🎯",
      role: "Engineer",
      personality: "",
      status: "idle",
      skills: [],
    }).agent;

    const crossCompany = createProjectAgent({
      projectId: other.id,
      name: `Crossco ${stamp}`,
      emoji: "🛸",
      role: "Engineer",
      personality: "",
      status: "idle",
      skills: [],
    }).agent;

    assert.throws(
      () =>
        fireCompanyAgent({
          agentId: victim.id,
          replacementAgentId: crossCompany.id,
        }),
      (err: unknown) =>
        err instanceof OrchestrationApiError && err.code === "replacement_company_mismatch"
    );
  });

  await test("fire rejects already-archived agent", () => {
    const doomed = createProjectAgent({
      projectId: primary.id,
      name: `Doomed ${stamp}`,
      emoji: "⚰️",
      role: "Engineer",
      personality: "",
      status: "idle",
      skills: [],
    }).agent;

    fireCompanyAgent({ agentId: doomed.id });

    assert.throws(
      () => fireCompanyAgent({ agentId: doomed.id }),
      (err: unknown) =>
        err instanceof OrchestrationApiError && err.code === "agent_already_archived"
    );
  });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
