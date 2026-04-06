/**
 * Provider Switch Service — Tests
 *
 * Tests both the shared decision path (computeSwitchPlan) and the
 * mutation path (switchAgentProvider), ensuring they are aligned.
 *
 * Uses the real orchestration database (ORCHESTRATION_DB_PATH must be set).
 */

if (!process.env.ORCHESTRATION_DB_PATH) {
  throw new Error(
    "ORCHESTRATION_DB_PATH is required for this test. " +
    "Example: ORCHESTRATION_DB_PATH=./data/orchestration.db npx tsx src/lib/__tests__/provider-switch.test.ts",
  );
}

import { getOrchestrationDb } from "../orchestration/db";
import {
  computeSwitchPlan,
  switchAgentProvider,
} from "../orchestration/service/provider-switch";

/* ── Test Setup ── */

const TEST_PREFIX = `_test_switch_${Date.now()}_`;

function setup() {
  const db = getOrchestrationDb();

  db.prepare(
    `INSERT OR IGNORE INTO companies (id, name, slug, created_at, updated_at)
     VALUES ('${TEST_PREFIX}co', '${TEST_PREFIX}Co', '${TEST_PREFIX}co', datetime('now'), datetime('now'))`,
  ).run();

  // OpenClaw-only agent
  db.prepare(
    `INSERT INTO agents (id, company_id, name, slug, emoji, role, personality, status, adapter_type, model, openclaw_agent_id, created_at, updated_at)
     VALUES ('${TEST_PREFIX}oc', '${TEST_PREFIX}co', '${TEST_PREFIX}OC', '${TEST_PREFIX}oc', '🤖', 'Eng', '', 'idle', 'openclaw', 'openai-codex/gpt-5.4', '${TEST_PREFIX}oc-ext', datetime('now'), datetime('now'))`,
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
  db.prepare(`DELETE FROM agent_runtime_state WHERE agent_id LIKE '${TEST_PREFIX}%'`).run();
  db.prepare(`DELETE FROM heartbeat_runs WHERE agent_id LIKE '${TEST_PREFIX}%'`).run();
  db.prepare(`DELETE FROM agent_wakeup_requests WHERE agent_id LIKE '${TEST_PREFIX}%'`).run();
  db.prepare(`DELETE FROM agent_task_sessions WHERE agent_id LIKE '${TEST_PREFIX}%'`).run();
  db.prepare(`DELETE FROM agents WHERE id LIKE '${TEST_PREFIX}%'`).run();
  db.prepare(`DELETE FROM companies WHERE id LIKE '${TEST_PREFIX}%'`).run();
}

/* ── Test Infra ── */

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) { passed++; } else { failed++; console.error(`  FAIL: ${message}`); }
}

function test(name: string, fn: () => void): void {
  console.log(`\n  ${name}`);
  try { fn(); } catch (err) { failed++; console.error(`  FAIL (exception): ${(err as Error).message}`); }
}

/* ── Env ── */
process.env.OPENCLAW_WORKSPACE_ROOT = process.env.OPENCLAW_WORKSPACE_ROOT || "/tmp/test-workspace";
process.env.PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL || "https://paperclip.test.com";
process.env.PAPERCLIP_API_KEY = process.env.PAPERCLIP_API_KEY || "pk-test";
process.env.PAPERCLIP_COMPANY_ID = process.env.PAPERCLIP_COMPANY_ID || "company-test";
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "anthropic-test";

/* ── Run ── */

const db = setup();

try {

  // ═══════════════════════════════════════
  // PREFLIGHT TESTS (computeSwitchPlan)
  // ═══════════════════════════════════════

  test("preflight: noop for already-current provider", () => {
    const plan = computeSwitchPlan(`${TEST_PREFIX}oc`, "openclaw");
    assert(plan.allowed === false, "should not be allowed");
    assert(plan.mode === "noop", "mode should be noop");
    assert(plan.blockReason === "already_current", "block reason");
    assert(plan.blockers.length === 0, "no blockers for noop");
    assert(plan.stateChanges === null, "no state changes");
    assert(plan.currentProviderDisplay.displayName !== "unknown", "current display resolved");
  });

  test("preflight: blocked — missing external ID", () => {
    const plan = computeSwitchPlan(`${TEST_PREFIX}oc`, "paperclip");
    assert(plan.allowed === false, "should not be allowed");
    assert(plan.mode === "blocked", "mode should be blocked");
    assert(plan.blockReason === "validation_failed", "block reason");
    assert(plan.blockers.length > 0, "should have blockers");
    assert(plan.blockers.some((b) => b.code === "external_id_linked"), "external_id blocker");
  });

  test("preflight: blocked — incompatible model", () => {
    const plan = computeSwitchPlan(`${TEST_PREFIX}inc`, "paperclip");
    assert(plan.allowed === false, "should not be allowed");
    assert(plan.mode === "blocked", "mode should be blocked");
    assert(plan.blockers.some((b) => b.code === "model_compatible"), "model blocker");
  });

  test("preflight: blocked — agent not found", () => {
    const plan = computeSwitchPlan("nonexistent-xyz", "paperclip");
    assert(plan.allowed === false, "should not be allowed");
    assert(plan.mode === "blocked", "mode should be blocked");
    assert(plan.blockReason === "agent_not_found", "block reason");
  });

  test("preflight: blocked — in-flight execution", () => {
    db.prepare(
      `INSERT INTO heartbeat_runs (id, agent_id, company_id, invocation_source, status, created_at, updated_at)
       VALUES ('${TEST_PREFIX}run-pf', '${TEST_PREFIX}dual', '${TEST_PREFIX}co', 'on_demand', 'running', datetime('now'), datetime('now'))`,
    ).run();

    const plan = computeSwitchPlan(`${TEST_PREFIX}dual`, "paperclip");
    assert(plan.allowed === false, "should not be allowed");
    assert(plan.mode === "blocked", "mode should be blocked");
    assert(plan.blockReason === "in_flight_execution", "block reason");
    assert(plan.blockers.some((b) => b.code === "active_heartbeat_runs"), "heartbeat blocker");
    assert(plan.inFlight !== null, "in-flight details included");
    assert(plan.inFlight!.activeHeartbeatRuns > 0, "shows active runs");

    db.prepare(`UPDATE heartbeat_runs SET status = 'succeeded' WHERE id = '${TEST_PREFIX}run-pf'`).run();
  });

  test("preflight: switchable — dual-ID agent", () => {
    const plan = computeSwitchPlan(`${TEST_PREFIX}dual`, "paperclip");
    assert(plan.allowed === true, "should be allowed");
    assert(plan.mode === "switchable", "mode should be switchable");
    assert(plan.blockReason === null, "no block reason");
    assert(plan.blockers.length === 0, "no blockers");
    assert(plan.stateChanges !== null, "state changes included");
    assert(plan.stateChanges!.previousProvider === "openclaw", "previous");
    assert(plan.stateChanges!.newProvider === "paperclip", "new");
    assert(plan.stateChanges!.preserved.length > 0, "preserved list");
    assert(plan.stateChanges!.reset.length > 0, "reset list");
  });

  test("preflight: switchable — includes tier change warnings", () => {
    const plan = computeSwitchPlan(`${TEST_PREFIX}dual`, "paperclip");
    assert(plan.warnings.length > 0, "should have warnings");
    assert(plan.warnings.some((w) => w.code === "tier_downgrade"), "tier downgrade warning");
    assert(plan.warnings.some((w) => w.code === "capability_loss"), "capability loss warning");
  });

  test("preflight: switchable — openclaw agent to anthropic", () => {
    const plan = computeSwitchPlan(`${TEST_PREFIX}oc`, "anthropic");
    assert(plan.allowed === true, "should be allowed");
    assert(plan.mode === "switchable", "mode should be switchable");
    assert(plan.blockers.length === 0, "no blockers");
    assert(plan.targetProviderDisplay !== null, "target display included");
    assert(plan.targetProviderDisplay?.tier === 4, "anthropic tier");
  });

  test("preflight: switchable — has provider display info", () => {
    const plan = computeSwitchPlan(`${TEST_PREFIX}dual`, "paperclip");
    assert(plan.currentProviderDisplay.displayName !== "unknown", "current display");
    assert(plan.currentProviderDisplay.tier === 3, "current tier");
    assert(plan.targetProviderDisplay !== null, "target display included");
  });

  test("preflight: does NOT mutate — DB unchanged after preflight", () => {
    const pre = db.prepare(`SELECT adapter_type FROM agents WHERE id = '${TEST_PREFIX}dual'`).get() as { adapter_type: string };
    computeSwitchPlan(`${TEST_PREFIX}dual`, "paperclip");
    const post = db.prepare(`SELECT adapter_type FROM agents WHERE id = '${TEST_PREFIX}dual'`).get() as { adapter_type: string };
    assert(pre.adapter_type === post.adapter_type, "adapter_type unchanged after preflight");
  });

  // ═══════════════════════════════════════
  // ALIGNMENT: preflight ↔ mutation
  // ═══════════════════════════════════════

  test("alignment: preflight and mutation agree on switchable", () => {
    const plan = computeSwitchPlan(`${TEST_PREFIX}dual`, "paperclip");
    assert(plan.allowed === true, "preflight says switchable");

    const result = switchAgentProvider(`${TEST_PREFIX}dual`, "paperclip");
    assert(result.switched === true, "mutation succeeds");
    assert(result.plan.mode === "switchable", "mutation plan is switchable");
    assert(result.plan.agentId === plan.agentId, "same agent");

    // Reset for further tests
    switchAgentProvider(`${TEST_PREFIX}dual`, "openclaw");
  });

  test("alignment: preflight and mutation agree on blocked", () => {
    const plan = computeSwitchPlan(`${TEST_PREFIX}oc`, "paperclip");
    assert(plan.allowed === false, "preflight says blocked");

    const result = switchAgentProvider(`${TEST_PREFIX}oc`, "paperclip");
    assert(result.switched === false, "mutation also blocked");
    assert(result.blockReason === plan.blockReason, "same block reason");
  });

  test("alignment: preflight and mutation agree on noop", () => {
    const plan = computeSwitchPlan(`${TEST_PREFIX}oc`, "openclaw");
    assert(plan.mode === "noop", "preflight says noop");

    const result = switchAgentProvider(`${TEST_PREFIX}oc`, "openclaw");
    assert(result.switched === false, "mutation also not switched");
    assert(result.blockReason === "already_current", "same block reason");
  });

  // ═══════════════════════════════════════
  // MUTATION TESTS (switchAgentProvider)
  // ═══════════════════════════════════════

  test("mutation: successful switch includes plan", () => {
    const result = switchAgentProvider(`${TEST_PREFIX}dual`, "paperclip");
    assert(result.switched === true, "should switch");
    assert(result.plan !== undefined, "plan included");
    assert(result.plan.mode === "switchable", "plan says switchable");
    assert(result.plan.warnings.length > 0, "plan has warnings");

    switchAgentProvider(`${TEST_PREFIX}dual`, "openclaw"); // reset
  });

  test("mutation: runtime state reset preserves tokens", () => {
    db.prepare(
      `INSERT OR REPLACE INTO agent_runtime_state
       (agent_id, company_id, adapter_type, session_id, state_json,
        total_input_tokens, total_output_tokens, total_cost_cents,
        created_at, updated_at)
       VALUES ('${TEST_PREFIX}dual', '${TEST_PREFIX}co', 'openclaw', 'sess-x',
               '{"ctx":"v"}', 500, 800, 3.25, datetime('now'), datetime('now'))`,
    ).run();

    const result = switchAgentProvider(`${TEST_PREFIX}dual`, "paperclip");
    assert(result.switched === true, "should switch");
    assert(result.changes!.runtimeStateReset === true, "state reset");

    const state = db.prepare(`SELECT * FROM agent_runtime_state WHERE agent_id = '${TEST_PREFIX}dual'`).get() as Record<string, unknown>;
    assert(state.session_id === null, "session cleared");
    assert(state.state_json === "{}", "state cleared");
    assert((state.total_input_tokens as number) === 500, "tokens preserved");
    assert((state.total_cost_cents as number) === 3.25, "cost preserved");

    switchAgentProvider(`${TEST_PREFIX}dual`, "openclaw"); // reset
  });

  test("mutation: audit trail recorded", () => {
    switchAgentProvider(`${TEST_PREFIX}dual`, "paperclip");
    const agent = db.prepare(`SELECT provider_changed_at, previous_adapter_type FROM agents WHERE id = '${TEST_PREFIX}dual'`).get() as Record<string, unknown>;
    assert(agent.provider_changed_at !== null, "timestamp set");
    assert(agent.previous_adapter_type === "openclaw", "previous recorded");

    switchAgentProvider(`${TEST_PREFIX}dual`, "openclaw"); // reset
  });

} finally {
  cleanup(db);
}

console.log(`\n\n  Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed > 0) {
  process.exit(1);
}
