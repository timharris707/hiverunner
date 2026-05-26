import assert from "node:assert";
import os from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";

if (!process.env.ORCHESTRATION_DB_PATH) {
  process.env.ORCHESTRATION_DB_PATH = path.join(
    os.tmpdir(),
    `mc-propose-memory-edge-cases-test-${Date.now()}.db`,
  );
}

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
  console.log("\npropose_memory edge-case hardening tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH!;
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
  const { createCompany } = await import("@/lib/orchestration/company-service");
  const { getOrchestrationDb } = await import("@/lib/orchestration/db");
  const { executeMcAction, parseActionsFromText } = await import("@/lib/orchestration/engine/engine");

  const db = getOrchestrationDb();

  const company = createCompany({
    name: `Propose Memory Edge Cases Co ${Date.now()}`,
    description: "fixture",
    status: "active",
  }).company;

  const project = createProject({
    companyId: company.id,
    name: `Edge Cases Project ${Date.now()}`,
    description: "fixture project",
    color: "#0ea5e9",
    emoji: "E",
    status: "active",
  }).project;

  const agent = createProjectAgent({
    projectId: project.id,
    name: "Scout",
    emoji: "icon:search",
    role: "Research Specialist",
    personality: "Fixture agent.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;

  const { task } = createTask({
    projectId: project.id,
    title: "Edge case fixture task",
    description: "Used as source task for propose_memory tests.",
    status: "in-progress",
    type: "research",
    priority: "P2",
    assignee: agent.id,
    labels: [],
    createdBy: "test",
  });

  const baseInput = {
    agentId: agent.id,
    agentName: agent.name,
    companyId: company.id,
    taskKey: task.key ?? "",
    runId: "run-edge-case-fixture",
  };

  // ─── Edge case 1: Malformed payload ───────────────────────────────────────

  await test("edge case 1a: missing body is caught at parse time with field name in error", () => {
    const { parseErrors } = parseActionsFromText('```mc-action\n{"action":"propose_memory"}\n```');
    assert.ok(parseErrors.length > 0, "expected a parse error for missing body");
    assert.ok(
      parseErrors[0].includes("body"),
      `expected error to name the 'body' field, got: ${parseErrors[0]}`,
    );
  });

  await test("edge case 1b: whitespace-only body is caught at parse time with field name in error", () => {
    const { parseErrors } = parseActionsFromText('```mc-action\n{"action":"propose_memory","body":"   "}\n```');
    assert.ok(parseErrors.length > 0, "expected a parse error for whitespace-only body");
    assert.ok(
      parseErrors[0].includes("body"),
      `expected error to name the 'body' field, got: ${parseErrors[0]}`,
    );
  });

  await test("edge case 1c: tags not an array is caught at parse time with field name in error", () => {
    const { parseErrors } = parseActionsFromText('```mc-action\n{"action":"propose_memory","body":"valid body","tags":"not-array"}\n```');
    assert.ok(parseErrors.length > 0, "expected a parse error for non-array tags");
    assert.ok(
      parseErrors[0].includes("tags"),
      `expected error to name the 'tags' field, got: ${parseErrors[0]}`,
    );
  });

  await test("edge case 1d: target_source_file non-string is caught at parse time with field name in error", () => {
    const { parseErrors } = parseActionsFromText('```mc-action\n{"action":"propose_memory","body":"valid body","target_source_file":123}\n```');
    assert.ok(parseErrors.length > 0, "expected a parse error for non-string target_source_file");
    assert.ok(
      parseErrors[0].includes("target_source_file"),
      `expected error to name the 'target_source_file' field, got: ${parseErrors[0]}`,
    );
  });

  await test("edge case 1e: whitespace-only body returns failed at execution time (belt-and-suspenders)", async () => {
    const result = await executeMcAction(
      { action: "propose_memory", body: "   " },
      baseInput,
      db,
    );
    assert.strictEqual(result.kind, "failed");
    assert.ok(
      (result as { kind: "failed"; reason: string }).reason.includes("body"),
      `expected reason to mention 'body', got: ${(result as { kind: "failed"; reason: string }).reason}`,
    );
  });

  // ─── Edge case 2: Duplicate pending proposal ──────────────────────────────

  await test("edge case 2: duplicate pending proposal returns skipped_duplicate", async () => {
    const body = "This is a unique memory body for duplicate test " + Date.now();

    const first = await executeMcAction(
      { action: "propose_memory", body },
      baseInput,
      db,
    );
    assert.strictEqual(first.kind, "proposed_memory", `first proposal should succeed, got: ${first.kind}`);

    const second = await executeMcAction(
      { action: "propose_memory", body },
      baseInput,
      db,
    );
    assert.strictEqual(
      second.kind,
      "skipped_duplicate",
      `second identical proposal should be skipped_duplicate, got: ${second.kind}`,
    );
  });

  await test("edge case 2: different body from same task is not a duplicate", async () => {
    const bodyA = "Memory A " + Date.now();
    const bodyB = "Memory B " + Date.now();

    const first = await executeMcAction({ action: "propose_memory", body: bodyA }, baseInput, db);
    assert.strictEqual(first.kind, "proposed_memory");

    const second = await executeMcAction({ action: "propose_memory", body: bodyB }, baseInput, db);
    assert.strictEqual(second.kind, "proposed_memory", "different body should create a new candidate");
  });

  // ─── Edge case 3: Agent not in roster ─────────────────────────────────────

  await test("edge case 3: agent name not in company roster returns failed", async () => {
    const result = await executeMcAction(
      { action: "propose_memory", body: "Memory from ghost agent" },
      { ...baseInput, agentName: "GhostAgent_DoesNotExist_XYZ" },
      db,
    );
    assert.strictEqual(result.kind, "failed");
    const reason = (result as { kind: "failed"; reason: string }).reason;
    assert.ok(
      reason.includes("agent_not_in_roster"),
      `expected agent_not_in_roster in reason, got: ${reason}`,
    );
    assert.ok(
      reason.includes("GhostAgent_DoesNotExist_XYZ"),
      `expected agent name in reason, got: ${reason}`,
    );
  });

  await test("edge case 3: valid roster agent succeeds", async () => {
    const result = await executeMcAction(
      { action: "propose_memory", body: "Memory from valid agent " + Date.now() },
      baseInput,
      db,
    );
    assert.strictEqual(result.kind, "proposed_memory");
  });

  // ─── Edge case 4: Unknown category defaults to Tim ────────────────────────

  await test("edge case 4: unknown category routes to Tim and does not reject", async () => {
    const result = await executeMcAction(
      { action: "propose_memory", body: "Unknown category memory " + Date.now(), category: "zorkblatz" },
      baseInput,
      db,
    );
    assert.strictEqual(result.kind, "proposed_memory");
    assert.strictEqual(
      (result as { kind: "proposed_memory"; routedTo: string | null }).routedTo,
      "Tim",
      "unknown category should route to Tim",
    );
  });

  await test("edge case 4: known category 'legal' routes to Castor", async () => {
    const result = await executeMcAction(
      { action: "propose_memory", body: "Legal memory " + Date.now(), category: "legal" },
      baseInput,
      db,
    );
    assert.strictEqual(result.kind, "proposed_memory");
    assert.strictEqual(
      (result as { kind: "proposed_memory"; routedTo: string | null }).routedTo,
      "Castor",
    );
  });

  // ─── Edge case 5: target_source_file outside allowed directories ──────────

  await test("edge case 5: target_source_file in /tmp is rejected", async () => {
    const result = await executeMcAction(
      {
        action: "propose_memory",
        body: "Memory with disallowed file path " + Date.now(),
        target_source_file: "/tmp/evil.md",
      },
      baseInput,
      db,
    );
    assert.strictEqual(result.kind, "failed");
    const reason = (result as { kind: "failed"; reason: string }).reason;
    assert.ok(
      reason.includes("target_source_file_path_not_allowed"),
      `expected target_source_file_path_not_allowed in reason, got: ${reason}`,
    );
  });

  await test("edge case 5: target_source_file path traversal outside allowed dirs is rejected", async () => {
    const result = await executeMcAction(
      {
        action: "propose_memory",
        body: "Memory with traversal path " + Date.now(),
        target_source_file: path.join(os.homedir(), ".mission-control/workspace/../../etc/passwd"),
      },
      baseInput,
      db,
    );
    assert.strictEqual(result.kind, "failed");
    const reason = (result as { kind: "failed"; reason: string }).reason;
    assert.ok(
      reason.includes("target_source_file_path_not_allowed"),
      `path traversal should be rejected, got reason: ${reason}`,
    );
  });

  await test("edge case 5: target_source_file in allowed workspaces dir is accepted", async () => {
    const previousMcWorkspaceRoot = process.env.MC_WORKSPACE_ROOT;
    const allowedPath = path.join(
      os.homedir(),
      ".mission-control/workspace/companies/insight/agents/scout/notes.md",
    );

    try {
      delete process.env.MC_WORKSPACE_ROOT;
      const result = await executeMcAction(
        {
          action: "propose_memory",
          body: "Memory with allowed file path " + Date.now(),
          target_source_file: allowedPath,
        },
        baseInput,
        db,
      );
      assert.strictEqual(result.kind, "proposed_memory");
    } finally {
      if (previousMcWorkspaceRoot === undefined) {
        delete process.env.MC_WORKSPACE_ROOT;
      } else {
        process.env.MC_WORKSPACE_ROOT = previousMcWorkspaceRoot;
      }
    }
  });

  await test("edge case 5: target_source_file honors MC_WORKSPACE_ROOT override", async () => {
    const previousMcWorkspaceRoot = process.env.MC_WORKSPACE_ROOT;
    const workspaceRoot = path.join(os.tmpdir(), `mc-propose-memory-workspaces-${Date.now()}`);
    process.env.MC_WORKSPACE_ROOT = workspaceRoot;

    try {
      const result = await executeMcAction(
        {
          action: "propose_memory",
          body: "Memory with overridden workspace root " + Date.now(),
          target_source_file: path.join(workspaceRoot, "companies/insight/agents/scout/notes.md"),
        },
        baseInput,
        db,
      );
      assert.strictEqual(result.kind, "proposed_memory");
    } finally {
      if (previousMcWorkspaceRoot === undefined) {
        delete process.env.MC_WORKSPACE_ROOT;
      } else {
        process.env.MC_WORKSPACE_ROOT = previousMcWorkspaceRoot;
      }
    }
  });

  await test("edge case 5: target_source_file in wiki dir is accepted", async () => {
    const allowedPath = path.join(os.homedir(), "wiki/queries/some-note.md");
    const result = await executeMcAction(
      {
        action: "propose_memory",
        body: "Memory with wiki file path " + Date.now(),
        target_source_file: allowedPath,
      },
      baseInput,
      db,
    );
    assert.strictEqual(result.kind, "proposed_memory");
  });

  // ─── Summary ──────────────────────────────────────────────────────────────

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Unexpected test runner error:", err);
  process.exit(1);
});
