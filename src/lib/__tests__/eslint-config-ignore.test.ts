/**
 * Contract test for HiveRunner ESLint ignore scope.
 * Run:
 * npx tsx src/lib/__tests__/eslint-config-ignore.test.ts
 */

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

const { finish, test } = createTestRunner({ passLabel: "✓", failLabel: "✗" });

console.log("\nHiveRunner ESLint Ignore Contract Test\n");

async function run() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const eslint = new ESLint({ cwd: repoRoot });

  await test("generated and backup trees are ignored while real source files are still linted", async () => {
    const ignoredPaths = [
      ".stable/.next/dev/server/app/page.js",
      ".stable.backup-20260416T050829Z/.next/dev/server/app/page.js",
      ".next_backup_20260330_1919/dev/server/chunks/root.js",
      "_quarantine/components/Sidebar.tsx",
      "tmp/check-page.js",
      ".tmp-nev49-stable/scratch.js",
      ".tmp_navqa.cjs",
    ];

    for (const candidate of ignoredPaths) {
      const ignored = await eslint.isPathIgnored(path.join(repoRoot, candidate));
      assert.equal(ignored, true, `${candidate} should be ignored by eslint`);
    }

    const sourceIgnored = await eslint.isPathIgnored(path.join(repoRoot, "src/app/layout.tsx"));
    assert.equal(sourceIgnored, false, "real source files must remain linted");
  });

  finish();
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
