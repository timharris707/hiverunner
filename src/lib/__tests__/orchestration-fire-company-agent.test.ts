import assert from "node:assert";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assignTask,
  cleanupDepartedAgentReferences,
  createProject,
  createProjectAgent,
  createTask,
  createTaskComment,
  fireCompanyAgent,
  getTask,
  hardDeleteCompanyAgent,
  listProjectAgents,
  listTaskComments,
  restoreCompanyAgent,
} from "@/lib/orchestration/service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { OrchestrationApiError } from "@/lib/orchestration/api";
import { upsertCompanyRuntime } from "@/lib/orchestration/runtime-registry";
import { resolveCompanyAgentWorkspacePath } from "@/lib/workspaces/company-paths";
import { createIsolatedOrchestrationWorkspace } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";

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
  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "mc-fire-company-agent-",
  });

  // Seed a second company row so cross-company rejection can be exercised.
  const db = getOrchestrationDb();
  workspaceIsolation.syncDatabase(db);
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
  workspaceIsolation.syncDatabase(db);

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
      status: "to-do",
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

  await test("fire disables agent-scoped runtime rows automatically", () => {
    const runtimeAgent = createProjectAgent({
      projectId: primary.id,
      name: `Runtime Cleanup ${stamp}`,
      emoji: "icon:cpu",
      role: "Engineer",
      personality: "Has a runtime row.",
      status: "idle",
      skills: [],
    }).agent;

    upsertCompanyRuntime({
      companyIdOrSlug: DEFAULT_COMPANY,
      agentId: runtimeAgent.id,
      provider: "codex",
      runtimeSlug: `runtime-cleanup-${stamp}`,
      displayName: `Runtime cleanup ${stamp}`,
      runtimeKind: "cli",
      scope: "agent",
      command: "codex",
      status: "online",
    });

    fireCompanyAgent({ agentId: runtimeAgent.id });

    const runtime = db
      .prepare("SELECT status, metadata_json FROM agent_runtimes WHERE agent_id = ? AND runtime_slug = ? LIMIT 1")
      .get(runtimeAgent.id, `runtime-cleanup-${stamp}`) as { status: string; metadata_json: string } | undefined;
    assert.strictEqual(runtime?.status, "disabled");
    assert.strictEqual(JSON.parse(runtime?.metadata_json ?? "{}").disabledBecause, "agent_archived");
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
      status: "to-do",
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

  await test("restore archived agent makes it active again", () => {
    const agent = createProjectAgent({
      projectId: primary.id,
      name: `Restore Me ${stamp}`,
      emoji: "♻️",
      role: "Research Agent",
      personality: "Recoverable",
      status: "idle",
      skills: [],
    }).agent;

    fireCompanyAgent({ agentId: agent.id });
    const result = restoreCompanyAgent({ agentId: agent.id });
    const restored = db
      .prepare("SELECT status, archived_at FROM agents WHERE id = ?")
      .get(agent.id) as { status: string; archived_at: string | null } | undefined;

    assert.equal(result.agent.id, agent.id);
    assert.equal(restored?.status, "idle");
    assert.equal(restored?.archived_at, null);
  });

  await test("hard delete removes private runtime artifacts and agent workspace", () => {
    const workspaceRoot = path.join(os.tmpdir(), `mission-control-agent-delete-${stamp}`);
    mkdirSync(workspaceRoot, { recursive: true });
    db.prepare("UPDATE companies SET workspace_root = ? WHERE id = ?").run(workspaceRoot, DEFAULT_COMPANY);

    const agent = createProjectAgent({
      projectId: primary.id,
      name: `Delete Me ${stamp}`,
      emoji: "🧹",
      role: "Disposable QA Agent",
      personality: "Temporary",
      openclawAgentId: `delete-me-${stamp}`,
      status: "idle",
      skills: [],
    }).agent;

    const agentWorkspace = resolveCompanyAgentWorkspacePath(workspaceRoot, agent.slug);
    assert.ok(agentWorkspace);
    mkdirSync(agentWorkspace, { recursive: true });
    writeFileSync(path.join(agentWorkspace, "SOUL.md"), "temporary fixture\n", "utf8");

    const task = createTask({
      projectId: primary.id,
      title: `Task owned by ${agent.name}`,
      description: `${agent.name} should disappear from this assignment.`,
      priority: "P2",
      type: "research",
      status: "to-do",
      labels: [],
      createdBy: "test",
    }).task;
    assignTask({ taskId: task.id, assignee: agent.id, actorUserId: "test" });

    db.prepare(
      `INSERT OR REPLACE INTO agent_runtime_state
        (agent_id, company_id, adapter_type, state_json, created_at, updated_at)
       VALUES (?, ?, 'codex', '{}', datetime('now'), datetime('now'))`
    ).run(agent.id, DEFAULT_COMPANY);
    db.prepare(
      `INSERT INTO agent_wakeup_requests
        (id, agent_id, company_id, source, status, payload_json, requested_at, created_at, updated_at)
       VALUES (?, ?, ?, 'explicit', 'queued', '{}', datetime('now'), datetime('now'), datetime('now'))`
    ).run(`wakeup-${stamp}`, agent.id, DEFAULT_COMPANY);
    db.prepare(
      `INSERT INTO agent_task_sessions
        (id, agent_id, company_id, adapter_type, task_key, session_params_json, created_at, updated_at)
       VALUES (?, ?, ?, 'codex', ?, '{}', datetime('now'), datetime('now'))`
    ).run(`session-${stamp}`, agent.id, DEFAULT_COMPANY, task.taskKey ?? task.id);
    db.prepare(
      `INSERT INTO heartbeat_runs
        (id, agent_id, company_id, invocation_source, status, usage_json, result_json, context_snapshot_json, created_at, updated_at)
       VALUES (?, ?, ?, 'on_demand', 'queued', '{}', '{}', '{}', datetime('now'), datetime('now'))`
    ).run(`run-${stamp}`, agent.id, DEFAULT_COMPANY);
    db.prepare(
      `INSERT INTO heartbeat_run_events
        (id, run_id, agent_id, event_type, detail, created_at)
       VALUES (?, ?, ?, 'status', 'fixture', datetime('now'))`
    ).run(`event-${stamp}`, `run-${stamp}`, agent.id);

    const result = hardDeleteCompanyAgent({ agentId: agent.id, replacementFallback: "the team" });
    const remainingAgent = db.prepare("SELECT id FROM agents WHERE id = ?").get(agent.id);
    const remainingRuntimeState = db
      .prepare("SELECT COUNT(*) AS count FROM agent_runtime_state WHERE agent_id = ?")
      .get(agent.id) as { count: number };
    const remainingRunEvents = db
      .prepare("SELECT COUNT(*) AS count FROM heartbeat_run_events WHERE agent_id = ?")
      .get(agent.id) as { count: number };
    const loadedTask = getTask(task.id).task;

    assert.equal(result.agentId, agent.id);
    assert.deepEqual(result.openclawAgents.queued, [agent.openclawAgentId]);
    assert.equal(result.deletedCounts.runtimeState, 1);
    assert.equal(result.deletedCounts.heartbeatRunEvents, 1);
    assert.equal(remainingAgent, undefined);
    assert.equal(remainingRuntimeState.count, 0);
    assert.equal(remainingRunEvents.count, 0);
    assert.equal(loadedTask.assignee, undefined);
    assert.equal(existsSync(agentWorkspace), false);
  });

  await test("cleanupDepartedAgentReferences rewrites text after agent row is gone", () => {
    const orphanName = `GhostCeo ${stamp}`;

    const newCeo = createProjectAgent({
      projectId: primary.id,
      name: `Replacement ${stamp}`,
      emoji: "🌅",
      role: "CEO",
      personality: "New CEO after hard-delete",
      status: "idle",
      skills: [],
    }).agent;

    const task = createTask({
      projectId: primary.id,
      title: `${orphanName} to review launch`,
      description: `Blocked: ${orphanName} has not responded. Bridge stays intact.`,
      priority: "P1",
      type: "feature",
      status: "to-do",
      labels: [],
      createdBy: "test",
    }).task;

    // Simulate an agent that was hard-deleted: no row exists for orphanName.
    const conflict = db
      .prepare("SELECT id FROM agents WHERE company_id = ? AND LOWER(name) = LOWER(?)")
      .get(DEFAULT_COMPANY, orphanName) as { id: string } | undefined;
    assert.ok(!conflict, "test fixture must not have an active agent with the orphan name");

    const result = cleanupDepartedAgentReferences({
      companyId: DEFAULT_COMPANY,
      departedName: orphanName,
      replacementAgentId: newCeo.id,
    });

    assert.strictEqual(result.cascade.tasksReassigned, 0, "orphan cleanup cannot reassign by id");
    assert.ok(result.cascade.titlesRewritten >= 1);
    assert.ok(result.cascade.descriptionsRewritten >= 1);
    assert.ok(result.replacement);
    assert.strictEqual(result.replacement!.id, newCeo.id);

    const loaded = getTask(task.id).task;
    assert.ok(loaded.title.includes(newCeo.name));
    assert.ok(!loaded.title.includes(orphanName));
    assert.ok(loaded.description.includes(newCeo.name));
    assert.ok(loaded.description.includes("Bridge stays intact"));
  });

  await test("cleanupDepartedAgentReferences rejects when active agent with same name still exists", () => {
    const stillHere = createProjectAgent({
      projectId: primary.id,
      name: `ActiveStillHere ${stamp}`,
      emoji: "🟢",
      role: "Engineer",
      personality: "",
      status: "idle",
      skills: [],
    }).agent;

    assert.throws(
      () =>
        cleanupDepartedAgentReferences({
          companyId: DEFAULT_COMPANY,
          departedName: stillHere.name,
        }),
      (err: unknown) =>
        err instanceof OrchestrationApiError && err.code === "departed_agent_still_active"
    );
  });

  await test("cleanupDepartedAgentReferences rejects blank departedName", () => {
    assert.throws(
      () =>
        cleanupDepartedAgentReferences({
          companyId: DEFAULT_COMPANY,
          departedName: "   ",
        }),
      (err: unknown) =>
        err instanceof OrchestrationApiError && err.code === "departed_name_required"
    );
  });

  await test("fire-without-replacement writes $-containing fallback verbatim", () => {
    const doomed = createProjectAgent({
      projectId: primary.id,
      name: `DollarCeo ${stamp}`,
      emoji: "💵",
      role: "CEO",
      personality: "",
      status: "idle",
      skills: [],
    }).agent;

    const task = createTask({
      projectId: primary.id,
      title: `${doomed.name} to review the budget`,
      description: `Ping ${doomed.name} about the budget`,
      priority: "P1",
      type: "feature",
      status: "to-do",
      labels: [],
      createdBy: "test",
    }).task;

    // $100, $&, $1 would all be interpreted as replacement-string backreferences
    // if rewriteNameInText passed toName directly into String.replace. Guard the
    // caller by asserting the label reaches the stored row exactly.
    const fallback = "the $100 ops team ($&)";
    const result = fireCompanyAgent({
      agentId: doomed.id,
      replacementFallback: fallback,
    });

    assert.strictEqual(result.cascade.titlesRewritten, 1);
    assert.strictEqual(result.cascade.descriptionsRewritten, 1);

    const loaded = getTask(task.id).task;
    assert.ok(
      loaded.title.includes(fallback),
      `title must contain fallback verbatim, got: ${loaded.title}`
    );
    assert.ok(
      loaded.description.includes(fallback),
      `description must contain fallback verbatim, got: ${loaded.description}`
    );
  });

  await test("fire rewrite uses Unicode-aware word boundaries (no substring corruption on accented names)", () => {
    const jose = createProjectAgent({
      projectId: primary.id,
      name: `José ${stamp}`,
      emoji: "🧑",
      role: "Engineer",
      personality: "",
      status: "idle",
      skills: [],
    }).agent;

    const task = createTask({
      projectId: primary.id,
      // Standalone occurrence should rewrite; "Joséphine" must stay intact
      // because "José" is a substring inside a longer Unicode word.
      title: `Call ${jose.name} today`,
      description: `Joséphine already signed off; only ${jose.name} is left.`,
      priority: "P1",
      type: "feature",
      status: "to-do",
      labels: [],
      createdBy: "test",
    }).task;

    assignTask({ taskId: task.id, assignee: jose.id, actorUserId: "test" });

    const result = fireCompanyAgent({
      agentId: jose.id,
      replacementFallback: "the operator",
    });

    assert.strictEqual(result.cascade.titlesRewritten, 1);
    assert.strictEqual(result.cascade.descriptionsRewritten, 1);

    const loaded = getTask(task.id).task;
    assert.ok(
      loaded.title.includes("the operator"),
      `expected standalone name rewritten to fallback, got: ${loaded.title}`
    );
    assert.ok(
      !loaded.title.includes(jose.name),
      `expected departed name removed from title, got: ${loaded.title}`
    );
    assert.ok(
      loaded.description.includes("Joséphine already signed off"),
      `Unicode substring must not be corrupted, got: ${loaded.description}`
    );
    assert.ok(
      loaded.description.includes("the operator"),
      `standalone Unicode match must be rewritten, got: ${loaded.description}`
    );
  });

  await test("fire cascade nulls agent_runtime_state.session_id across the company", () => {
    const victim = createProjectAgent({
      projectId: primary.id,
      name: `SessionVictim ${stamp}`,
      emoji: "🎭",
      role: "Engineer",
      personality: "",
      status: "idle",
      skills: [],
    }).agent;

    const bystander = createProjectAgent({
      projectId: primary.id,
      name: `SessionBystander ${stamp}`,
      emoji: "🎪",
      role: "Engineer",
      personality: "",
      status: "idle",
      skills: [],
    }).agent;

    const nowSeed = new Date().toISOString();
    const upsertRuntimeState = db.prepare(
      `INSERT OR REPLACE INTO agent_runtime_state
        (agent_id, company_id, adapter_type, session_id, state_json, updated_at)
       VALUES (?, ?, 'openclaw', ?, '{}', ?)`
    );
    upsertRuntimeState.run(victim.id, DEFAULT_COMPANY, "victim-sess-123", nowSeed);
    upsertRuntimeState.run(bystander.id, DEFAULT_COMPANY, "bystander-sess-456", nowSeed);

    fireCompanyAgent({ agentId: victim.id });

    const readSession = db.prepare(
      "SELECT session_id FROM agent_runtime_state WHERE agent_id = ?"
    );
    const victimRow = readSession.get(victim.id) as { session_id: string | null } | undefined;
    const bystanderRow = readSession.get(bystander.id) as { session_id: string | null } | undefined;

    assert.strictEqual(
      victimRow?.session_id ?? null,
      null,
      "fired agent's runtime_state.session_id must be nulled"
    );
    assert.strictEqual(
      bystanderRow?.session_id ?? null,
      null,
      "bystander agent in same company must also have session_id nulled"
    );
  });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  workspaceIsolation.dispose();
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
