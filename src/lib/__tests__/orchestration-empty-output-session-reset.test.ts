import assert from "node:assert";
import { rmSync } from "node:fs";

import { createProject, createProjectAgent } from "@/lib/orchestration/service";
import { resetAgentRuntimeSessionForSelfHeal } from "@/lib/orchestration/engine/engine";
import { openclawExecutionAdapter } from "@/lib/orchestration/execution/adapters";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { randomUUID } from "node:crypto";
import { createIsolatedOrchestrationWorkspace } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";

const clearOpenClawTaskSessionForSelfHeal =
  openclawExecutionAdapter.clearTaskSessionForSelfHeal;

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

  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "mc-empty-output-session-reset-",
  });

  try {
    const db = getOrchestrationDb();
    workspaceIsolation.syncDatabase(db);
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

    await test("clearOpenClawTaskSessionForSelfHeal wipes params for the right (agent, task) only", () => {
      const agent = createProjectAgent({
        projectId: project.id,
        name: `ClearOclawAgent ${stamp}`,
        emoji: "🧹",
        role: "Engineer",
        personality: "",
        status: "idle",
        skills: [],
      }).agent;

      const nowSeed = new Date().toISOString();
      const insertTaskSession = db.prepare(
        `INSERT INTO agent_task_sessions
          (id, agent_id, company_id, adapter_type, task_key, session_params_json,
           session_display_id, last_run_id, last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      // Seed two OpenClaw task-sessions for this agent (same agent, different
      // tasks) plus one for a different agent on the same task. Only the
      // first one should be cleared.
      const targetRowId = randomUUID();
      insertTaskSession.run(
        targetRowId,
        agent.id,
        DEFAULT_COMPANY,
        "openclaw",
        "TASK-CLEAR-target",
        JSON.stringify({ sessionId: "to-clear-sid", sessionKey: "to-clear-key" }),
        "to-clear-display",
        null,
        null,
        nowSeed,
        nowSeed,
      );
      const siblingRowId = randomUUID();
      insertTaskSession.run(
        siblingRowId,
        agent.id,
        DEFAULT_COMPANY,
        "openclaw",
        "TASK-CLEAR-sibling",
        JSON.stringify({ sessionId: "sibling-sid", sessionKey: "sibling-key" }),
        "sibling-display",
        null,
        null,
        nowSeed,
        nowSeed,
      );

      clearOpenClawTaskSessionForSelfHeal(db, {
        companyId: DEFAULT_COMPANY,
        agentId: agent.id,
        taskKey: "TASK-CLEAR-target",
        reason: "empty_assistant_output",
      });

      const readRow = db.prepare(
        `SELECT session_params_json, session_display_id, last_error
         FROM agent_task_sessions WHERE id = ?`,
      );
      const target = readRow.get(targetRowId) as {
        session_params_json: string;
        session_display_id: string | null;
        last_error: string | null;
      };
      const sibling = readRow.get(siblingRowId) as {
        session_params_json: string;
        session_display_id: string | null;
        last_error: string | null;
      };

      assert.strictEqual(
        target.session_params_json,
        "{}",
        `target params must be wiped, got: ${target.session_params_json}`,
      );
      assert.strictEqual(
        target.session_display_id,
        null,
        "target display id must be nulled",
      );
      assert.strictEqual(
        target.last_error,
        "self_heal:empty_assistant_output",
        `target last_error must record the self-heal reason, got: ${target.last_error}`,
      );

      assert.notStrictEqual(
        sibling.session_params_json,
        "{}",
        "sibling task session params must be untouched",
      );
      assert.strictEqual(
        sibling.session_display_id,
        "sibling-display",
        "sibling display id must be untouched",
      );
    });

    await test("clearOpenClawTaskSessionForSelfHeal ignores non-openclaw adapter rows", () => {
      const agent = createProjectAgent({
        projectId: project.id,
        name: `CrossAdapterAgent ${stamp}`,
        emoji: "🔀",
        role: "Engineer",
        personality: "",
        status: "idle",
        skills: [],
      }).agent;

      const nowSeed = new Date().toISOString();
      const codexRowId = randomUUID();
      db.prepare(
        `INSERT INTO agent_task_sessions
          (id, agent_id, company_id, adapter_type, task_key, session_params_json,
           session_display_id, last_run_id, last_error, created_at, updated_at)
         VALUES (?, ?, ?, 'codex', ?, ?, ?, NULL, NULL, ?, ?)`,
      ).run(
        codexRowId,
        agent.id,
        DEFAULT_COMPANY,
        "TASK-CROSS-codex",
        JSON.stringify({ codexRef: "keep-me" }),
        "codex-display",
        nowSeed,
        nowSeed,
      );

      clearOpenClawTaskSessionForSelfHeal(db, {
        companyId: DEFAULT_COMPANY,
        agentId: agent.id,
        taskKey: "TASK-CROSS-codex",
        reason: "empty_assistant_output",
      });

      const row = db
        .prepare(
          `SELECT session_params_json, session_display_id
           FROM agent_task_sessions WHERE id = ?`,
        )
        .get(codexRowId) as {
        session_params_json: string;
        session_display_id: string | null;
      };
      assert.ok(
        row.session_params_json.includes("keep-me"),
        `codex adapter row must stay intact, got: ${row.session_params_json}`,
      );
      assert.strictEqual(
        row.session_display_id,
        "codex-display",
        "codex display id must be untouched",
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
