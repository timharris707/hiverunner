import assert from "node:assert";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import {
  isOperatorVisibleWorkspaceId,
  shouldIncludeWorkspaceInOperatorRails,
} from "@/lib/workspace-visibility";

const { finish, test } = createTestRunner({ passLabel: "\u2713", failLabel: "\u2717" });

async function run() {
  console.log("\nWorkspace Visibility Tests\n");

  await test("keeps primary workspace visible", () => {
    assert.strictEqual(isOperatorVisibleWorkspaceId("workspace"), true);
  });

  await test("hides known stress workspace prefixes", () => {
    assert.strictEqual(
      isOperatorVisibleWorkspaceId("workspace-oc-stress-1775105740798-5"),
      false
    );
    assert.strictEqual(
      isOperatorVisibleWorkspaceId("workspace-stress-agent-1775105740798-5"),
      false
    );
  });

  await test("hides temporary/generated/test workspace prefixes", () => {
    assert.strictEqual(isOperatorVisibleWorkspaceId("workspace-temp-123"), false);
    assert.strictEqual(isOperatorVisibleWorkspaceId("workspace-tmp-123"), false);
    assert.strictEqual(isOperatorVisibleWorkspaceId("workspace-generated-123"), false);
    assert.strictEqual(isOperatorVisibleWorkspaceId("workspace-test-123"), false);
  });

  await test("requires identity for agent workspace rails", () => {
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

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
