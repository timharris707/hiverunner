/**
 * Provider Activation Service — Tests
 *
 * Tests the Phase 1 validation layer: can a provider be activated
 * for a given agent in a given environment?
 */

import { chmodSync, mkdtempSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

import {
  checkProviderActivation,
  checkProviderEnvConfigured,
  checkModelProviderCompatibility,
  checkAllProviderActivations,
  resolveAgentProviderFromRecord,
  mapAdapterTypeToProviderId,
} from "../orchestration/service/provider-activation";
import type { AgentForActivationCheck } from "../orchestration/service/provider-activation";

/* ── Test Agent Fixtures ── */

const openclawAgent: AgentForActivationCheck = {
  id: "agent-forge",
  adapterType: "openclaw",
  model: "anthropic/claude-opus-4-6",
  openclawAgentId: "forge",
  paperclipAgentId: null,
};

const paperclipAgent: AgentForActivationCheck = {
  id: "agent-pixel",
  adapterType: "paperclip",
  model: "openai-codex/gpt-5.4",
  openclawAgentId: null,
  paperclipAgentId: "pixel-pc",
};

const dualIdAgent: AgentForActivationCheck = {
  id: "agent-dual",
  adapterType: "openclaw",
  model: "openai-codex/gpt-5.4", // compatible with both providers
  openclawAgentId: "dual-oc",
  paperclipAgentId: "dual-pc",
};

const unlinkedAgent: AgentForActivationCheck = {
  id: "agent-unlinked",
  adapterType: "openclaw",
  model: null,
  openclawAgentId: null,
  paperclipAgentId: null,
};

/* ── Test Environments ── */

const fakeClaudeBinDir = mkdtempSync(path.join(os.tmpdir(), "mc-anthropic-cli-"));
const fakeClaudeBinPath = path.join(fakeClaudeBinDir, "claude");
writeFileSync(fakeClaudeBinPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
chmodSync(fakeClaudeBinPath, 0o755);

const fullEnv: Record<string, string | undefined> = {
  OPENCLAW_DIR: "/Users/test/.openclaw",
  PAPERCLIP_API_URL: "https://paperclip.example.com",
  PAPERCLIP_API_KEY: "pk-test-key",
  PAPERCLIP_COMPANY_ID: "company-123",
  ANTHROPIC_API_KEY: "anthropic-test-key",
  PATH: fakeClaudeBinDir,
  HOME: "/Users/test",
};

const openclawOnlyEnv: Record<string, string | undefined> = {
  OPENCLAW_DIR: "/Users/test/.openclaw",
  PATH: fakeClaudeBinDir,
  HOME: "/Users/test",
};

const paperclipOnlyEnv: Record<string, string | undefined> = {
  PAPERCLIP_API_URL: "https://paperclip.example.com",
  PAPERCLIP_API_KEY: "pk-test-key",
  PAPERCLIP_COMPANY_ID: "company-123",
  PATH: fakeClaudeBinDir,
};

const emptyEnv: Record<string, string | undefined> = {};

/* ── Tests ── */

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
  fn();
}

// ─── mapAdapterTypeToProviderId ───

test("mapAdapterTypeToProviderId: openclaw → openclaw-heartbeat", () => {
  assert(mapAdapterTypeToProviderId("openclaw") === "openclaw-heartbeat", "should map openclaw");
});

test("mapAdapterTypeToProviderId: paperclip → paperclip", () => {
  assert(mapAdapterTypeToProviderId("paperclip") === "paperclip", "should pass through paperclip");
});

test("mapAdapterTypeToProviderId: unknown → passthrough", () => {
  assert(mapAdapterTypeToProviderId("hermes") === "hermes", "should pass through unknown");
});

// ─── checkProviderEnvConfigured ───

test("checkProviderEnvConfigured: openclaw in full env", () => {
  const result = checkProviderEnvConfigured("openclaw-heartbeat", fullEnv);
  assert(result.configured === true, "should be configured");
  assert(result.missing.length === 0, "no missing vars");
});

test("checkProviderEnvConfigured: paperclip in full env", () => {
  const result = checkProviderEnvConfigured("paperclip", fullEnv);
  assert(result.configured === true, "should be configured");
});

test("checkProviderEnvConfigured: paperclip missing vars", () => {
  const result = checkProviderEnvConfigured("paperclip", openclawOnlyEnv);
  assert(result.configured === false, "should not be configured");
  assert(result.missing.includes("PAPERCLIP_API_URL"), "missing PAPERCLIP_API_URL");
  assert(result.missing.includes("PAPERCLIP_API_KEY"), "missing PAPERCLIP_API_KEY");
});

test("checkProviderEnvConfigured: anthropic in full env", () => {
  const result = checkProviderEnvConfigured("anthropic", fullEnv);
  assert(result.configured === true, "anthropic should be configured");
  assert(result.missing.length === 0, "no missing vars");
  assert(!result.detail?.includes("ANTHROPIC_API_KEY"), "detail should not imply API key dependency");
});

test("checkProviderEnvConfigured: anthropic without API key but with CLI", () => {
  const result = checkProviderEnvConfigured("anthropic", openclawOnlyEnv);
  assert(result.configured === true, "anthropic should not require ANTHROPIC_API_KEY");
  assert(result.missing.length === 0, "no missing vars");
  assert(
    result.detail?.includes("does not verify whether the CLI is currently authenticated") === true,
    "detail should honestly describe unverifiable Claude CLI auth state",
  );
});

test("checkProviderEnvConfigured: anthropic without Claude CLI", () => {
  const result = checkProviderEnvConfigured("anthropic", { PATH: "" });
  assert(result.configured === false, "anthropic should not be configured without Claude CLI");
  assert(result.missing.includes("claude"), "missing claude CLI");
});

test("checkProviderEnvConfigured: unknown provider", () => {
  const result = checkProviderEnvConfigured("hermes", fullEnv);
  assert(result.configured === false, "unknown provider should not be configured");
});

// ─── checkModelProviderCompatibility ───

test("model compat: claude-opus on openclaw = compatible", () => {
  const result = checkModelProviderCompatibility("anthropic/claude-opus-4-6", "openclaw-heartbeat");
  assert(result.status === "compatible", "should be compatible");
});

test("model compat: gpt-5.4 on paperclip = compatible", () => {
  const result = checkModelProviderCompatibility("openai-codex/gpt-5.4", "paperclip");
  assert(result.status === "compatible", "should be compatible");
});

test("model compat: claude-opus on paperclip = incompatible", () => {
  const result = checkModelProviderCompatibility("anthropic/claude-opus-4-6", "paperclip");
  assert(result.status === "incompatible", "should be incompatible");
});

test("model compat: claude-opus on anthropic = compatible", () => {
  const result = checkModelProviderCompatibility("anthropic/claude-opus-4-6", "anthropic");
  assert(result.status === "compatible", "should be compatible");
});

test("model compat: unknown model = unknown status", () => {
  const result = checkModelProviderCompatibility("some/unknown-model", "openclaw-heartbeat");
  assert(result.status === "unknown", "should be unknown");
});

test("model compat: null model = unknown status", () => {
  const result = checkModelProviderCompatibility(null, "openclaw-heartbeat");
  assert(result.status === "unknown", "should be unknown for null model");
});

// ─── checkProviderActivation: basic checks ───

test("activation: openclaw agent → openclaw = already current (not blocking)", () => {
  const result = checkProviderActivation(openclawAgent, "openclaw-heartbeat", fullEnv);
  assert(result.canActivate === true, "should be activatable (same provider is a no-op)");
  const sameCheck = result.checks.find((c) => c.check === "not_current_provider");
  assert(sameCheck?.passed === false, "not_current_provider should fail (it IS current)");
  assert(sameCheck?.blocking === false, "same-provider check is advisory, not blocking");
});

test("activation: openclaw agent → paperclip in full env", () => {
  const result = checkProviderActivation(openclawAgent, "paperclip", fullEnv);
  // Should fail: agent has no paperclip_agent_id
  assert(result.canActivate === false, "should not be activatable (no paperclip ID)");
  const idCheck = result.checks.find((c) => c.check === "external_id_linked");
  assert(idCheck?.passed === false, "external_id_linked should fail");
});

test("activation: dual-id agent → paperclip in full env", () => {
  const result = checkProviderActivation(dualIdAgent, "paperclip", fullEnv);
  assert(result.canActivate === true, "should be activatable (has both IDs + env configured)");
  assert(result.consequences !== null, "should have consequences");
  assert(result.consequences!.tierChange !== null, "should show tier change");
  assert(result.consequences!.tierChange!.from.tier === 3, "from tier 3");
  assert(result.consequences!.tierChange!.to.tier === 1, "to tier 1");
});

test("activation: openclaw agent → anthropic in full env", () => {
  const result = checkProviderActivation(openclawAgent, "anthropic", fullEnv);
  assert(result.canActivate === true, "should be activatable");
  const idCheck = result.checks.find((c) => c.check === "external_id_linked");
  assert(idCheck?.passed === true, "anthropic should not require external ID linkage");
  assert(result.consequences?.tierChange?.to.tier === 4, "anthropic should be tier 4");
});

test("activation: paperclip agent → openclaw in full env", () => {
  const result = checkProviderActivation(paperclipAgent, "openclaw-heartbeat", fullEnv);
  // Should fail: agent has no openclaw_agent_id
  assert(result.canActivate === false, "should not be activatable (no openclaw ID)");
});

test("activation: planned provider (hermes)", () => {
  const result = checkProviderActivation(openclawAgent, "hermes", fullEnv);
  assert(result.canActivate === false, "hermes is planned, should not be activatable");
  const adapterCheck = result.checks.find((c) => c.check === "adapter_registered");
  assert(adapterCheck?.passed === false, "adapter_registered should fail for planned");
});

test("activation: unknown provider", () => {
  const result = checkProviderActivation(openclawAgent, "unknown-thing", fullEnv);
  assert(result.canActivate === false, "unknown provider should not be activatable");
  const knownCheck = result.checks.find((c) => c.check === "provider_known");
  assert(knownCheck?.passed === false, "provider_known should fail");
});

// ─── checkProviderActivation: env gating ───

test("activation: paperclip without env vars", () => {
  const result = checkProviderActivation(dualIdAgent, "paperclip", openclawOnlyEnv);
  assert(result.canActivate === false, "should not be activatable without paperclip env");
  const envCheck = result.checks.find((c) => c.check === "env_configured");
  assert(envCheck?.passed === false, "env_configured should fail");
});

test("activation: anthropic without env vars", () => {
  const result = checkProviderActivation(openclawAgent, "anthropic", openclawOnlyEnv);
  assert(result.canActivate === true, "should be activatable with Claude CLI even without ANTHROPIC_API_KEY");
  const envCheck = result.checks.find((c) => c.check === "env_configured");
  assert(envCheck?.passed === true, "env_configured should pass");
});

test("activation: anthropic without Claude CLI is blocking", () => {
  const result = checkProviderActivation(openclawAgent, "anthropic", { PATH: "" });
  assert(result.canActivate === false, "should not be activatable without Claude CLI");
  const envCheck = result.checks.find((c) => c.check === "env_configured");
  assert(envCheck?.passed === false, "env_configured should fail");
});

// ─── checkProviderActivation: model compatibility ───

test("activation: incompatible model is blocking", () => {
  const agentWithIncompatModel: AgentForActivationCheck = {
    ...dualIdAgent,
    model: "anthropic/claude-opus-4-6", // not compatible with paperclip
  };
  const result = checkProviderActivation(agentWithIncompatModel, "paperclip", fullEnv);
  assert(result.canActivate === false, "should not be activatable with incompatible model");
  const modelCheck = result.checks.find((c) => c.check === "model_compatible");
  assert(modelCheck?.passed === false, "model_compatible should fail");
  assert(modelCheck?.blocking === true, "model incompatibility should be blocking");
});

// ─── checkProviderActivation: consequences ───

test("activation consequences: tier change from T3 to T1", () => {
  // dualIdAgent already has openai-codex/gpt-5.4 which is compatible with both
  const result = checkProviderActivation(dualIdAgent, "paperclip", fullEnv);
  assert(result.canActivate === true, "should be activatable");
  assert(result.consequences !== null, "should have consequences");
  assert(result.consequences!.configReset === true, "config should reset on switch");
  assert(result.consequences!.capabilityChanges.length > 0, "should have capability changes");
  // liveText and actionDetection should be lost
  const liveTextChange = result.consequences!.capabilityChanges.find((c) => c.capability === "liveText");
  assert(liveTextChange?.from === true, "losing liveText");
  assert(liveTextChange?.to === false, "liveText not available on paperclip");
});

// ─── checkAllProviderActivations ───

test("checkAllProviderActivations: returns results for all known providers", () => {
  const results = checkAllProviderActivations(openclawAgent, fullEnv);
  assert("openclaw-heartbeat" in results, "should include openclaw");
  assert("paperclip" in results, "should include paperclip");
  assert("anthropic" in results, "should include anthropic");
  assert("hermes" in results, "should include hermes");
  assert("byo-webhook" in results, "should include byo-webhook");
});

// ─── resolveAgentProviderFromRecord ───

test("resolveAgentProviderFromRecord: explicit adapter_type=paperclip", () => {
  const result = resolveAgentProviderFromRecord({
    adapterType: "paperclip",
    openclawAgentId: "oc-id",
    paperclipAgentId: "pc-id",
  });
  assert(result.providerId === "paperclip", "should resolve to paperclip despite having openclaw ID");
});

test("resolveAgentProviderFromRecord: adapter_type=openclaw with openclaw ID", () => {
  const result = resolveAgentProviderFromRecord({
    adapterType: "openclaw",
    openclawAgentId: "oc-id",
  });
  assert(result.providerId === "openclaw-heartbeat", "should resolve to openclaw-heartbeat");
});

test("resolveAgentProviderFromRecord: adapter_type=openclaw but only paperclip ID (data inconsistency)", () => {
  const result = resolveAgentProviderFromRecord({
    adapterType: "openclaw",
    paperclipAgentId: "pc-id",
  });
  // Should fall back to paperclip since that's the only link
  assert(result.providerId === "paperclip", "should fall back to paperclip for data inconsistency");
});

test("resolveAgentProviderFromRecord: no adapter_type, fallback to ID inference", () => {
  const result = resolveAgentProviderFromRecord({
    openclawAgentId: "oc-id",
  });
  assert(result.providerId === "openclaw-heartbeat", "should infer from openclaw ID");
});

test("resolveAgentProviderFromRecord: nothing set", () => {
  const result = resolveAgentProviderFromRecord({});
  assert(result.providerId === "none", "should resolve to none provider");
  assert(result.tier === 0, "should be tier 0 (PostRun)");
});

// ─── Summary ───

console.log(`\n\n  Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed > 0) {
  process.exit(1);
}
