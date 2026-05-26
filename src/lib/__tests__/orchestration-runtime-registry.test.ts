import assert from "node:assert";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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

function writeFakeCli(binDir: string, name: string, version: string): void {
  const file = path.join(binDir, name);
  writeFileSync(
    file,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then\n  printf '%s\\n' "${version}"\n  exit 0\nfi\nexit 0\n`,
    "utf8",
  );
  chmodSync(file, 0o755);
}

async function run() {
  console.log("\nRuntime Registry Tests\n");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "orchestration-runtime-registry-"));
  const homeDir = path.join(tempRoot, "home");
  const homeLocalBinDir = path.join(homeDir, ".local", "bin");
  const binDir = path.join(tempRoot, "bin");
  const dbPath = path.join(tempRoot, "orchestration.db");
  const workspaceRoot = path.join(homeDir, ".mission-control", "dev", "workspaces");

  mkdirSync(binDir, { recursive: true });
  mkdirSync(homeLocalBinDir, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  writeFakeCli(binDir, "codex", "codex 9.9.9");
  writeFakeCli(binDir, "claude", "claude 8.8.8");
  writeFakeCli(homeLocalBinDir, "hermes", "Hermes Agent v0.11.0");

  process.env.HOME = homeDir;
  process.env.ORCHESTRATION_DB_PATH = dbPath;
  process.env.MC_WORKSPACE_ROOT = workspaceRoot;
  process.env.PATH = binDir;
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";

  const { createCompany } = await import("@/lib/orchestration/company-service");
  const { closeOrchestrationDb, getOrchestrationDb } = await import("@/lib/orchestration/db");
  const {
    detectLocalRuntimeCandidates,
    listRuntimeDependencyReadiness,
    listCompanyRuntimes,
    probeCompanyRuntimes,
    upsertCompanyRuntime,
  } = await import("@/lib/orchestration/runtime-registry");

  const company = createCompany({
    name: "Runtime Registry Co",
    description: "Provider-neutral runtime registry fixture.",
    status: "active",
  }).company;

  await test("detects non-OpenClaw local runtimes from PATH", () => {
    const detected = detectLocalRuntimeCandidates(process.env);
    const providers = new Set(detected.map((runtime) => runtime.provider));
    assert.ok(providers.has("codex"), "codex should be detected");
    assert.ok(providers.has("anthropic"), "claude should map to anthropic");
    assert.ok(providers.has("hermes"), "hermes should be detected from ~/.local/bin");
    assert.ok(
      providers.has("codex") && providers.has("anthropic") && providers.has("hermes"),
      "Codex, Claude, and HERMES detection should not depend on OpenClaw",
    );
  });

  await test("classifies runtime dependencies without making optional CLIs required for boot", () => {
    const readiness = listRuntimeDependencyReadiness(process.env, { fast: true });
    const byId = new Map(readiness.map((item) => [item.id, item]));
    assert.strictEqual(byId.get("local-boot")?.status, "ready");
    assert.strictEqual(byId.get("local-boot")?.optionality, "core_local_boot");
    assert.strictEqual(byId.get("codex-cli")?.status, "ready");
    assert.strictEqual(byId.get("codex-cli")?.commandPath, path.join(binDir, "codex"));
    assert.strictEqual(byId.get("claude-code-cli")?.status, "ready");
    assert.strictEqual(byId.get("claude-code-cli")?.optionality, "optional_runtime");
    assert.strictEqual(byId.get("gemini-cli")?.optionality, "optional_runtime");
    assert.notStrictEqual(byId.get("gemini-cli")?.optionality, "core_local_boot");
    assert.strictEqual(byId.get("openai-api-key")?.optionality, "optional_provider_key");
    assert.strictEqual(byId.get("openai-api-key")?.status, "missing_optional");
    assert.strictEqual(byId.get("openrouter-api-key")?.optionality, "optional_provider_key");
  });

  await test("upserts a company-scoped Codex runtime without OpenClaw fields", () => {
    const result = upsertCompanyRuntime({
      companyIdOrSlug: company.slug,
      provider: "codex",
      runtimeSlug: "local-codex",
      displayName: "Local Codex",
      runtimeKind: "cli",
      scope: "company",
      command: "codex",
      version: "codex 9.9.9",
      status: "online",
      workspaceRoot: company.workspace.root,
      metadata: { detectedBy: "test" },
    });

    assert.strictEqual(result.created, true);
    assert.strictEqual(result.runtime.provider, "codex");
    assert.strictEqual(result.runtime.runtimeSlug, "local-codex");
    assert.strictEqual(result.runtime.status, "online");
    assert.strictEqual(result.runtime.metadata.detectedBy, "test");

    const listed = listCompanyRuntimes(company.id).runtimes;
    assert.strictEqual(listed.length, 1);
    assert.strictEqual(listed[0]?.provider, "codex");
    assert.strictEqual(listed[0]?.workspaceRoot, company.workspace.root);
  });

  await test("re-upsert updates the same runtime row", () => {
    const result = upsertCompanyRuntime({
      companyIdOrSlug: company.id,
      provider: "codex",
      runtimeSlug: "local-codex",
      displayName: "Local Codex Updated",
      runtimeKind: "cli",
      scope: "company",
      command: "codex",
      version: "codex 10.0.0",
      status: "offline",
      workspaceRoot: company.workspace.root,
      metadata: { detectedBy: "second-pass" },
    });

    assert.strictEqual(result.created, false);
    assert.strictEqual(result.runtime.displayName, "Local Codex Updated");
    assert.strictEqual(result.runtime.status, "offline");
    assert.strictEqual(result.runtime.metadata.detectedBy, "second-pass");
    assert.strictEqual(listCompanyRuntimes(company.id).runtimes.length, 1);
  });

  await test("agent-scoped non-OpenClaw runtimes default to isolated agent workspaces", () => {
    const db = getOrchestrationDb();
    db.prepare(
      `INSERT INTO agents
        (id, company_id, name, slug, emoji, role, personality, status, adapter_type, model, created_at, updated_at)
       VALUES
        ('runtime-agent-1', ?, 'Runtime Agent', 'runtime-agent', ':', 'Engineer', '', 'idle', 'codex', 'openai-codex/gpt-5.4', datetime('now'), datetime('now'))`,
    ).run(company.id);

    const result = upsertCompanyRuntime({
      companyIdOrSlug: company.id,
      agentId: "runtime-agent-1",
      provider: "codex",
      runtimeSlug: "agent-codex",
      displayName: "Agent Codex",
      runtimeKind: "cli",
      scope: "agent",
      command: "codex",
      status: "online",
      workspaceRoot: company.workspace.root,
      metadata: { detectedBy: "agent-isolation-test" },
    });

    assert.strictEqual(
      result.runtime.workspaceRoot,
      path.join(company.workspace.root, "agents", "runtime-agent"),
    );
    assert.strictEqual(
      (result.runtime.metadata.workspaceIsolation as Record<string, unknown>).source,
      "agent",
    );
  });

  await test("agent-scoped runtimes for archived agents are hidden from inventory", () => {
    const db = getOrchestrationDb();
    db.prepare("UPDATE agents SET archived_at = datetime('now') WHERE id = ?").run("runtime-agent-1");

    const listed = listCompanyRuntimes(company.id).runtimes;

    const disabledRuntime = db
      .prepare("SELECT status, metadata_json FROM agent_runtimes WHERE runtime_slug = ? LIMIT 1")
      .get("agent-codex") as { status: string; metadata_json: string } | undefined;
    assert.strictEqual(disabledRuntime?.status, "disabled");
    assert.strictEqual(JSON.parse(disabledRuntime?.metadata_json ?? "{}").disabledBecause, "runtime_inventory_cleanup");

    assert.ok(
      listed.some((runtime) => runtime.runtimeSlug === "local-codex"),
      "company-scoped runtimes should remain visible",
    );
    assert.ok(
      !listed.some((runtime) => runtime.runtimeSlug === "agent-codex"),
      "archived agent runtime should be hidden from inventory",
    );
  });

  await test("runtime health probe marks an installed CLI ready", () => {
    const { runtimes } = probeCompanyRuntimes(company.id, process.env);
    const runtime = runtimes.find((row) => row.runtimeSlug === "local-codex");
    assert.ok(runtime, "runtime should still be present");
    assert.strictEqual(runtime!.status, "online");
    assert.strictEqual(runtime!.health?.status, "ready");
    assert.strictEqual(runtime!.health?.label, "Ready");
    assert.strictEqual(runtime!.health?.workspaceWritable, true);
    assert.strictEqual(runtime!.health?.authReady, true);
    assert.strictEqual(runtime!.health?.version, "codex 9.9.9");
    assert.ok(runtime!.metadata.health, "probe result should be stored in metadata");
  });

  await test("runtime health probe marks a missing CLI offline", () => {
    upsertCompanyRuntime({
      companyIdOrSlug: company.id,
      provider: "gemini",
      runtimeSlug: "missing-gemini",
      displayName: "Missing Gemini",
      runtimeKind: "cli",
      scope: "company",
      command: "missing-gemini-cli",
      status: "unknown",
      workspaceRoot: company.workspace.root,
      metadata: { detectedBy: "missing-cli-test" },
    });

    const { runtimes } = probeCompanyRuntimes(company.id, process.env);
    const runtime = runtimes.find((row) => row.runtimeSlug === "missing-gemini");
    assert.ok(runtime, "missing runtime should be present");
    assert.strictEqual(runtime!.status, "offline");
    assert.strictEqual(runtime!.health?.status, "missing_cli");
    assert.strictEqual(runtime!.health?.label, "Missing CLI");
    assert.strictEqual(runtime!.health?.authReady, null);
  });

  closeOrchestrationDb();
  rmSync(tempRoot, { recursive: true, force: true });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
