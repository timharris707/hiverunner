import assert from "node:assert";
import { rmSync } from "node:fs";

import { createProject, createProjectAgent } from "@/lib/orchestration/service";
import { getOrchestrationDb } from "@/lib/orchestration/db";

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
  console.log("\nAgent Creation Wiring Tests\n");
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const db = getOrchestrationDb();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const project = createProject({
    companyId: DEFAULT_COMPANY,
    name: `Wiring Fixture ${stamp}`,
    description: "fixture",
    color: "#22c55e",
    emoji: "🔌",
    status: "active",
  }).project;

  await test("createProjectAgent seeds agent_runtime_state row with expected defaults", () => {
    const agent = createProjectAgent({
      projectId: project.id,
      name: `WiringSubject ${stamp}`,
      emoji: "🧪",
      role: "Engineer",
      personality: "Fixture",
      status: "idle",
      skills: [],
    }).agent;

    const row = db
      .prepare(
        `SELECT agent_id, company_id, adapter_type, session_id, state_json,
                total_input_tokens, total_output_tokens, total_cost_cents,
                created_at, updated_at
         FROM agent_runtime_state
         WHERE agent_id = ?`
      )
      .get(agent.id) as
      | {
          agent_id: string;
          company_id: string;
          adapter_type: string;
          session_id: string | null;
          state_json: string;
          total_input_tokens: number;
          total_output_tokens: number;
          total_cost_cents: number;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    assert.ok(row, "agent_runtime_state row must exist after createProjectAgent");
    assert.strictEqual(row!.agent_id, agent.id);
    assert.strictEqual(row!.company_id, DEFAULT_COMPANY);
    assert.strictEqual(row!.adapter_type, "openclaw");
    assert.strictEqual(row!.session_id, null);
    assert.strictEqual(row!.state_json, "{}");
    assert.strictEqual(row!.total_input_tokens, 0);
    assert.strictEqual(row!.total_output_tokens, 0);
    assert.strictEqual(row!.total_cost_cents, 0);
    assert.ok(row!.created_at, "created_at must be populated");
    assert.ok(row!.updated_at, "updated_at must be populated");
  });

  await test("agent creation is atomic: runtime_state row absent if agent insert fails", () => {
    // Duplicate-name creation should fail with agent_name_conflict before any
    // rows land. Verify no orphan agent_runtime_state row appears.
    const name = `AtomicSubject ${stamp}`;
    createProjectAgent({
      projectId: project.id,
      name,
      emoji: "🧱",
      role: "Engineer",
      personality: "",
      status: "idle",
      skills: [],
    });

    const beforeCount = (db
      .prepare("SELECT COUNT(*) AS n FROM agent_runtime_state")
      .get() as { n: number }).n;

    let threw = false;
    try {
      createProjectAgent({
        projectId: project.id,
        name,
        emoji: "🧱",
        role: "Engineer",
        personality: "",
        status: "idle",
        skills: [],
      });
    } catch {
      threw = true;
    }
    assert.ok(threw, "duplicate-name creation must throw");

    const afterCount = (db
      .prepare("SELECT COUNT(*) AS n FROM agent_runtime_state")
      .get() as { n: number }).n;
    assert.strictEqual(
      afterCount,
      beforeCount,
      "failed creation must not leak runtime_state rows"
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
