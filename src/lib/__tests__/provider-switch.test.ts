/**
 * Provider Switch Service — Tests
 *
 * Tests the Phase 2 mutation layer: safely switching an agent's
 * execution provider with validation, blocking, and audit.
 *
 * Uses the real orchestration database (ORCHESTRATION_DB_PATH must be set).
 * Creates transient test agents, exercises switch paths, then cleans up.
 */

if (!process.env.ORCHESTRATION_DB_PATH) {
  throw new Error(
    "ORCHESTRATION_DB_PATH is required for this test. " +
    "Example: ORCHESTRATION_DB_PATH=./data/orchestration.db npx tsx src/lib/__tests__/provider-switch.test.ts",
  );
}

import { getOrchestrationDb } from "../orchestration/db";
import { switchAgentProvider } from "../orchestration/service/provider-switch";

/* ── Test Setup ── */

const TEST_PREFIX = `_test_switch_${Date.now()}_`;

function setup() {
  const db = getOrchestrationDb();

  // Ensure test company exists
  db.prepare(
    `INSERT OR IGNORE INTO companies (id, name, slug, created_at, updated_at)
     VALUES ('${TEST_PREFIX}co', '${TEST_PREFIX}Co', '${TEST_PREFIX}co', datetime('now'), datetime('now'))`,
  ).run();

  // OpenClaw-only agent
  db.prepare(
    `INSERT INTO agents (id, company_id, name, slug, emoji, role, personality, status, adapter_type, model, openclaw_agent_id, created_at, updated_at)
     VALUES ('${TEST_PREFIX}oc', '${TEST_PREFIX}co', '${TEST_PREFIX}OC', '${TEST_PREFIX}oc', '🤖', 'Eng', '', 'idle', 'openclaw', 'openai-codex/gpt-5.4', '${TEST_PREFIX}oc-ext', datetime('now'), datetime('now'))`,
  ).run();

  // Paperclip-only agent
  db.prepare(
    `INSERT INTO agents (id, company_id, name, slug, emoji, role, personality, status, adapter_type, model, paperclip_agent_id, created_at, updated_at)
     VALUES ('${TEST_PREFIX}pc', '${TEST_PREFIX}co', '${TEST_PREFIX}PC', '${TEST_PREFIX}pc', '📎', 'Analyst', '', 'idle', 'paperclip', 'openai-codex/gpt-5.4', '${TEST_PREFIX}pc-ext', datetime('now'), datetime('now'))`,
  ).run();

  // Dual-ID agent
  db.prepare(
    `INSERT INTO agents (id, company_id, name, slug, emoji, role, personality, status, adapter_type, model, openclaw_agent_id, paperclip_agent_id, created_at, updated_at)
     VALUES ('${TEST_PREFIX}dual', '${TEST_PREFIX}co', '${TEST_PREFIX}Dual', '${TEST_PREFIX}dual', '🔄', 'V', '', 'idle', 'openclaw', 'openai-codex/gpt-5.4', '${TEST_PREFIX}dual-oc', '${TEST_PREFIX}dual-pc', datetime('now'), datetime('now'))`,
  ).run();

  // Agent with incompatible model
  db.prepare(
    `INSERT INTO agents (id, company_id, name, slug, emoji, role, personality, status, adapter_type, model, openclaw_agent_id, paperclip_agent_id, created_at, updated_at)
     VALUES ('${TEST_PREFIX}inc', '${TEST_PREFIX}co', '${TEST_PREFIX}Inc', '${TEST_PREFIX}inc', '❌', 'T', '', 'idle', 'openclaw', 'anthropic/claude-opus-4-6', '${TEST_PREFIX}inc-oc', '${TEST_PREFIX}inc-pc', datetime('now'), datetime('now'))`,
  ).run();

  return db;
}

function cleanup(db: ReturnType<typeof getOrchestrationDb>) {
  // Clean up in reverse dependency order
  db.prepare(`DELETE FROM agent_runtime_state WHERE agent_id LIKE '${TEST_PREFIX}%'`).run();
  db.prepare(`DELETE FROM heartbeat_runs WHERE agent_id LIKE '${TEST_PREFIX}%'`).run();
  db.prepare(`DELETE FROM agent_wakeup_requests WHERE agent_id LIKE '${TEST_PREFIX}%'`).run();
  db.prepare(`DELETE FROM agent_task_sessions WHERE agent_id LIKE '${TEST_PREFIX}%'`).run();
  db.prepare(`DELETE FROM agents WHERE id LIKE '${TEST_PREFIX}%'`).run();
  db.prepare(`DELETE FROM companies WHERE id LIKE '${TEST_PREFIX}%'`).run();
}

/* ── Test Infrastructure ── */

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function test(name: string, fn: () => void): void {
  console.log(`\n  ${name}`);
  try {
    fn();
  } catch (err) {
    failed++;
    console.error(`  FAIL (exception): ${(err as Error).message || err}`);
  }
}

/* ── Set up env for activation checks ── */
process.env.OPENCLAW_WORKSPACE_ROOT = process.env.OPENCLAW_WORKSPACE_ROOT || "/tmp/test-workspace";
process.env.PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL || "https://paperclip.test.com";
process.env.PAPERCLIP_API_KEY = process.env.PAPERCLIP_API_KEY || "pk-test";
process.env.PAPERCLIP_COMPANY_ID = process.env.PAPERCLIP_COMPANY_ID || "company-test";

/* ── Run Tests ── */

const db = setup();

try {
  // ─── Already-current provider ───

  test("switch: already-current provider returns structured refusal", () => {
    const result = switchAgentProvider(`${TEST_PREFIX}oc`, "openclaw");
    assert(result.switched === false, "should not switch");
    assert(result.blockReason === "already_current", "block reason should be already_current");
    assert(result.changes === null, "no changes");
  });

  // ─── Agent not found ───

  test("switch: unknown agent returns agent_not_found", () => {
    const result = switchAgentProvider("nonexistent-agent-xyz", "paperclip");
    assert(result.switched === false, "should not switch");
    assert(result.blockReason === "agent_not_found", "block reason should be agent_not_found");
  });

  // ─── Missing external ID ───

  test("switch: missing external ID blocks switch", () => {
    const result = switchAgentProvider(`${TEST_PREFIX}oc`, "paperclip");
    assert(result.switched === false, "should not switch");
    assert(result.blockReason === "validation_failed", "should fail validation");
    const idCheck = result.activation!.checks.find((c) => c.check === "external_id_linked");
    assert(idCheck?.passed === false, "external_id_linked should fail");
  });

  // ─── Model incompatibility ───

  test("switch: incompatible model blocks switch", () => {
    const result = switchAgentProvider(`${TEST_PREFIX}inc`, "paperclip");
    assert(result.switched === false, "should not switch");
    assert(result.blockReason === "validation_failed", "should fail validation");
    const modelCheck = result.activation!.checks.find((c) => c.check === "model_compatible");
    assert(modelCheck?.passed === false, "model_compatible should fail");
  });

  // ─── In-flight execution blocks switch ───

  test("switch: in-flight execution blocks switch", () => {
    // Create in-flight run
    db.prepare(
      `INSERT INTO heartbeat_runs (id, agent_id, company_id, invocation_source, status, created_at, updated_at)
       VALUES ('${TEST_PREFIX}run-inflight', '${TEST_PREFIX}dual', '${TEST_PREFIX}co', 'on_demand', 'running', datetime('now'), datetime('now'))`,
    ).run();

    const result = switchAgentProvider(`${TEST_PREFIX}dual`, "paperclip");
    assert(result.switched === false, "should not switch");
    assert(result.blockReason === "in_flight_execution", "should be blocked by in-flight");
    assert(result.inFlightDetails !== null, "should include details");
    assert(result.inFlightDetails!.activeHeartbeatRuns > 0, "should show active runs");

    // Clear in-flight
    db.prepare(
      `UPDATE heartbeat_runs SET status = 'succeeded' WHERE id = '${TEST_PREFIX}run-inflight'`,
    ).run();
  });

  // ─── Successful switch ───

  test("switch: dual-ID agent successfully switches openclaw → paperclip", () => {
    const pre = db.prepare(`SELECT adapter_type, provider_changed_at, previous_adapter_type FROM agents WHERE id = '${TEST_PREFIX}dual'`).get() as Record<string, unknown>;
    assert(pre.adapter_type === "openclaw", "pre-state should be openclaw");
    assert(pre.provider_changed_at === null, "should not have been switched before");

    const result = switchAgentProvider(`${TEST_PREFIX}dual`, "paperclip");
    assert(result.switched === true, "should switch");
    assert(result.blockReason === null, "no block reason");
    assert(result.changes !== null, "should have changes");
    assert(result.changes!.previousProvider === "openclaw", "previous = openclaw");
    assert(result.changes!.newProvider === "paperclip", "new = paperclip");
    assert(result.changes!.adapterTypeUpdated === true, "adapter_type updated");
    assert(result.changes!.providerChangedAtSet === true, "timestamp set");
    assert(result.changes!.previousAdapterTypeRecorded === true, "previous recorded");
    assert(result.changes!.modelKept === true, "model preserved");

    // Verify DB state
    const post = db.prepare(`SELECT adapter_type, provider_changed_at, previous_adapter_type FROM agents WHERE id = '${TEST_PREFIX}dual'`).get() as Record<string, unknown>;
    assert(post.adapter_type === "paperclip", "DB should be paperclip");
    assert(post.provider_changed_at !== null, "timestamp should be set");
    assert(post.previous_adapter_type === "openclaw", "previous should be openclaw");
  });

  // ─── Switch back ───

  test("switch: switches back paperclip → openclaw", () => {
    const result = switchAgentProvider(`${TEST_PREFIX}dual`, "openclaw");
    assert(result.switched === true, "should switch back");
    assert(result.changes!.previousProvider === "paperclip", "previous = paperclip");
    assert(result.changes!.newProvider === "openclaw", "new = openclaw");

    const agent = db.prepare(`SELECT adapter_type, previous_adapter_type FROM agents WHERE id = '${TEST_PREFIX}dual'`).get() as Record<string, unknown>;
    assert(agent.adapter_type === "openclaw", "back to openclaw");
    assert(agent.previous_adapter_type === "paperclip", "previous now paperclip");
  });

  // ─── Runtime state reset ───

  test("switch: runtime state is reset but tokens preserved", () => {
    db.prepare(
      `INSERT OR REPLACE INTO agent_runtime_state
       (agent_id, company_id, adapter_type, session_id, state_json,
        last_run_id, last_run_status, total_input_tokens, total_output_tokens,
        total_cost_cents, created_at, updated_at)
       VALUES ('${TEST_PREFIX}dual', '${TEST_PREFIX}co', 'openclaw', 'sess-123',
               '{"ctx":"test"}', 'run-456', 'succeeded', 1000, 2000, 5.50,
               datetime('now'), datetime('now'))`,
    ).run();

    const result = switchAgentProvider(`${TEST_PREFIX}dual`, "paperclip");
    assert(result.switched === true, "should switch");
    assert(result.changes!.runtimeStateReset === true, "runtime state reset");

    const state = db.prepare(`SELECT * FROM agent_runtime_state WHERE agent_id = '${TEST_PREFIX}dual'`).get() as Record<string, unknown>;
    assert(state.adapter_type === "paperclip", "adapter_type updated");
    assert(state.session_id === null, "session_id cleared");
    assert(state.state_json === "{}", "state_json cleared");
    assert(state.last_run_id === null, "last_run_id cleared");
    assert((state.total_input_tokens as number) === 1000, "input tokens preserved");
    assert((state.total_output_tokens as number) === 2000, "output tokens preserved");
    assert((state.total_cost_cents as number) === 5.50, "cost preserved");

    switchAgentProvider(`${TEST_PREFIX}dual`, "openclaw"); // reset
  });

  // ─── Activation consequences ───

  test("switch: includes tier change consequences", () => {
    const result = switchAgentProvider(`${TEST_PREFIX}dual`, "paperclip");
    assert(result.switched === true, "should switch");
    assert(result.activation?.consequences !== null, "consequences included");
    assert(result.activation!.consequences!.tierChange !== null, "tier change computed");
    assert(result.activation!.consequences!.tierChange!.from.tier === 3, "from T3");
    assert(result.activation!.consequences!.tierChange!.to.tier === 1, "to T1");
    assert(result.activation!.consequences!.capabilityChanges.length > 0, "capability changes");

    switchAgentProvider(`${TEST_PREFIX}dual`, "openclaw"); // reset
  });

} finally {
  cleanup(db);
}

console.log(`\n\n  Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed > 0) {
  process.exit(1);
}
