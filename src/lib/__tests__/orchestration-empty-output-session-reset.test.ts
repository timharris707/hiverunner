import assert from "node:assert";
import { rmSync } from "node:fs";

import { createProject, createProjectAgent } from "@/lib/orchestration/service";
import { resetAgentRuntimeSessionForSelfHeal } from "@/lib/orchestration/engine/engine";
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
  console.log("\nEmpty-Output Session Reset Tests\n");
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
    name: `Empty Output ${stamp}`,
    description: "fixture",
    color: "#f59e0b",
    emoji: "🪫",
    status: "active",
  }).project;

  await test("resetAgentRuntimeSessionForSelfHeal nulls this agent's session_id only", () => {
    const victim = createProjectAgent({
      projectId: project.id,
      name: `EmptyVictim ${stamp}`,
      emoji: "🪫",
      role: "Engineer",
      personality: "",
      status: "idle",
      skills: [],
    }).agent;

    const bystander = createProjectAgent({
      projectId: project.id,
      name: `EmptyBystander ${stamp}`,
      emoji: "💼",
      role: "Engineer",
      personality: "",
      status: "idle",
      skills: [],
    }).agent;

    // Seed both agents with a session_id — they both got one from the
    // creation-time INSERT (which sets session_id to NULL by default), so
    // we overwrite directly.
    const nowSeed = new Date().toISOString();
    const setSession = db.prepare(
      "UPDATE agent_runtime_state SET session_id = ?, updated_at = ? WHERE agent_id = ?",
    );
    setSession.run("victim-sess-abc", nowSeed, victim.id);
    setSession.run("bystander-sess-xyz", nowSeed, bystander.id);

    resetAgentRuntimeSessionForSelfHeal(db, victim.id, "empty_assistant_output");

    const read = db.prepare(
      "SELECT session_id FROM agent_runtime_state WHERE agent_id = ?",
    );
    const victimRow = read.get(victim.id) as { session_id: string | null } | undefined;
    const bystanderRow = read.get(bystander.id) as { session_id: string | null } | undefined;

    assert.strictEqual(
      victimRow?.session_id ?? null,
      null,
      "victim's session_id must be nulled",
    );
    assert.strictEqual(
      bystanderRow?.session_id,
      "bystander-sess-xyz",
      `bystander must be untouched — scope is agent-local, got: ${bystanderRow?.session_id}`,
    );
  });

  await test("resetAgentRuntimeSessionForSelfHeal is a no-op if the row doesn't exist", () => {
    const stubId = "9999aaaa-9999-aaaa-9999-aaaa99999999";
    // Row doesn't exist; UPDATE should match 0 rows. No throw expected.
    resetAgentRuntimeSessionForSelfHeal(db, stubId, "missing_row_test");

    const row = db
      .prepare("SELECT session_id FROM agent_runtime_state WHERE agent_id = ?")
      .get(stubId) as { session_id: string | null } | undefined;
    assert.strictEqual(row, undefined, "no row should be created");
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
