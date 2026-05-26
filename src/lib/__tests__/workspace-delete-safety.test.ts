import assert from "node:assert";

import {
  classifyCompanyWorkspaceRoot,
  isPathContained,
} from "@/lib/workspaces/delete-safety";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error: unknown) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  \u2717 ${name}`);
    console.error(`    ${message}`);
  }
}

function run() {
  console.log("\nWorkspace Delete Safety Tests\n");

  const env = {
    HOME: "/Users/test",
    OPENCLAW_DIR: "/Users/test/.openclaw",
    MC_WORKSPACE_ROOT: "/Users/test/.mission-control/stable/workspaces",
  };

  test("path containment accepts descendants but rejects traversal-prefix lookalikes", () => {
    assert.strictEqual(isPathContained("/tmp/root", "/tmp/root/nested/file.txt"), true);
    assert.strictEqual(isPathContained("/tmp/root", "/tmp/root-elsewhere/file.txt"), false);
  });

  test("canonical HiveRunner company roots are safe to delete", () => {
    const result = classifyCompanyWorkspaceRoot(
      "/Users/test/.mission-control/stable/workspaces/companies/acme-123",
      env,
    );
    assert.strictEqual(result.classification, "hiverunner");
    assert.strictEqual(result.safeToDelete, true);
  });

  test("legacy OpenClaw company workspaces remain safe during compatibility window", () => {
    const result = classifyCompanyWorkspaceRoot(
      "/Users/test/.openclaw/workspaces/acme",
      env,
    );
    assert.strictEqual(result.classification, "legacy-openclaw-company");
    assert.strictEqual(result.safeToDelete, true);
  });

  test("default OpenClaw workspace stays protected", () => {
    const result = classifyCompanyWorkspaceRoot(
      "/Users/test/.openclaw/workspace",
      env,
    );
    assert.strictEqual(result.classification, "default-openclaw-workspace");
    assert.strictEqual(result.safeToDelete, false);
  });

  test("external roots are rejected", () => {
    const result = classifyCompanyWorkspaceRoot("/tmp/external-company-root", env);
    assert.strictEqual(result.classification, "external");
    assert.strictEqual(result.safeToDelete, false);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
