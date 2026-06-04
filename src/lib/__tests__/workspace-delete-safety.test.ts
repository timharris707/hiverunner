import assert from "node:assert";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import {
  classifyCompanyWorkspaceRoot,
  isPathContained,
} from "@/lib/workspaces/delete-safety";

const { finish, test } = createTestRunner({ passLabel: "\u2713", failLabel: "\u2717" });

async function run() {
  console.log("\nWorkspace Delete Safety Tests\n");

  const env = {
    HOME: "/Users/test",
    OPENCLAW_DIR: "/Users/test/.openclaw",
    MC_WORKSPACE_ROOT: "/Users/test/.mission-control/stable/workspaces",
  };

  await test("path containment accepts descendants but rejects traversal-prefix lookalikes", () => {
    assert.strictEqual(isPathContained("/tmp/root", "/tmp/root/nested/file.txt"), true);
    assert.strictEqual(isPathContained("/tmp/root", "/tmp/root-elsewhere/file.txt"), false);
  });

  await test("canonical HiveRunner company roots are safe to delete", () => {
    const result = classifyCompanyWorkspaceRoot(
      "/Users/test/.mission-control/stable/workspaces/companies/acme-123",
      env,
    );
    assert.strictEqual(result.classification, "hiverunner");
    assert.strictEqual(result.safeToDelete, true);
  });

  await test("legacy OpenClaw company workspaces remain safe during compatibility window", () => {
    const result = classifyCompanyWorkspaceRoot(
      "/Users/test/.openclaw/workspaces/acme",
      env,
    );
    assert.strictEqual(result.classification, "legacy-openclaw-company");
    assert.strictEqual(result.safeToDelete, true);
  });

  await test("default OpenClaw workspace stays protected", () => {
    const result = classifyCompanyWorkspaceRoot(
      "/Users/test/.openclaw/workspace",
      env,
    );
    assert.strictEqual(result.classification, "default-openclaw-workspace");
    assert.strictEqual(result.safeToDelete, false);
  });

  await test("external roots are rejected", () => {
    const result = classifyCompanyWorkspaceRoot("/tmp/external-company-root", env);
    assert.strictEqual(result.classification, "external");
    assert.strictEqual(result.safeToDelete, false);
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
