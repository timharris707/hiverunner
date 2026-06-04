import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

const { finish, test } = createTestRunner({ passLabel: "[pass]", failLabel: "[fail]" });

async function run() {
  console.log("\nSettings Missing Runtime Config Test\n");

  const originalOpenClawDir = process.env.OPENCLAW_DIR;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hiverunner-settings-runtime-"));
  process.env.OPENCLAW_DIR = tempRoot;

  try {
    const { GET } = await import("@/app/api/settings/route");

    await test("returns a degraded config payload when openclaw.json is absent", async () => {
      const response = await GET();
      assert.equal(response.status, 200);

      const body = await response.json() as {
        config?: {
          agents?: {
            optionalRuntime?: { configured?: boolean; status?: string };
          };
          gateway?: { configured?: boolean; status?: string };
        };
        providers?: unknown[];
      };

      assert.equal(body.config?.agents?.optionalRuntime?.configured, false);
      assert.equal(body.config?.agents?.optionalRuntime?.status, "not_configured");
      assert.equal(body.config?.gateway?.configured, false);
      assert.deepEqual(body.providers, []);
    });
  } finally {
    if (originalOpenClawDir === undefined) {
      delete process.env.OPENCLAW_DIR;
    } else {
      process.env.OPENCLAW_DIR = originalOpenClawDir;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
