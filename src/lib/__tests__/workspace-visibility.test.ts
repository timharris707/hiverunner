import assert from "node:assert";

import {
  isOperatorVisibleWorkspaceId,
  shouldIncludeWorkspaceInOperatorRails,
} from "@/lib/workspace-visibility";

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
  console.log("\nWorkspace Visibility Tests\n");

  test("keeps primary workspace visible", () => {
    assert.strictEqual(isOperatorVisibleWorkspaceId("workspace"), true);
  });

  test("hides known stress workspace prefixes", () => {
    assert.strictEqual(
      isOperatorVisibleWorkspaceId("workspace-oc-stress-1775105740798-5"),
      false
    );
    assert.strictEqual(
      isOperatorVisibleWorkspaceId("workspace-stress-agent-1775105740798-5"),
      false
    );
  });

  test("hides temporary/generated/test workspace prefixes", () => {
    assert.strictEqual(isOperatorVisibleWorkspaceId("workspace-temp-123"), false);
    assert.strictEqual(isOperatorVisibleWorkspaceId("workspace-tmp-123"), false);
    assert.strictEqual(isOperatorVisibleWorkspaceId("workspace-generated-123"), false);
    assert.strictEqual(isOperatorVisibleWorkspaceId("workspace-test-123"), false);
  });

  test("requires identity for agent workspace rails", () => {
    assert.strictEqual(
      shouldIncludeWorkspaceInOperatorRails({
        workspaceId: "workspace-forge",
        hasIdentityFile: false,
      }),
      false
    );
    assert.strictEqual(
      shouldIncludeWorkspaceInOperatorRails({
        workspaceId: "workspace-forge",
        hasIdentityFile: true,
      }),
      true
    );
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run();

