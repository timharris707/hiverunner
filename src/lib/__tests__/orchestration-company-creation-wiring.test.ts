import assert from "node:assert";
import { existsSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

process.env.MC_WORKSPACE_ROOT =
  process.env.MC_WORKSPACE_ROOT ??
  path.join(os.tmpdir(), `mc-company-wiring-${Date.now()}`);

import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";

const WORKSPACE_ROOT = process.env.MC_WORKSPACE_ROOT!;

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  \u2713 ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  \u2717 ${name}`);
      console.error(`    ${message}`);
    });
}

async function run() {
  console.log("\nCompany Creation Wiring Tests\n");
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  await test("createCompany materializes workspace projects/, memory/, scripts/", () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const result = createCompany({
      name: `Wiring Co ${stamp}`,
      description: "fixture",
      status: "active",
    });

    const db = getOrchestrationDb();
    const row = db
      .prepare("SELECT workspace_root FROM companies WHERE id = ?")
      .get(result.company.id) as { workspace_root: string | null } | undefined;
    const workspaceRoot = row?.workspace_root ?? null;
    assert.ok(workspaceRoot, "companies.workspace_root must be stored after createCompany");
    assert.ok(
      workspaceRoot!.startsWith(WORKSPACE_ROOT),
      `workspace_root must live inside MC_WORKSPACE_ROOT (${WORKSPACE_ROOT}), got: ${workspaceRoot}`
    );

    for (const subdir of ["projects", "memory", "scripts"]) {
      const dir = path.join(workspaceRoot!, subdir);
      assert.ok(
        existsSync(dir),
        `${subdir}/ must exist on disk after createCompany, missing: ${dir}`
      );
      assert.ok(
        statSync(dir).isDirectory(),
        `${subdir}/ must be a directory, got: ${dir}`
      );
    }
  });

  // Cleanup: remove the tmp workspace the test scaffolded.
  rmSync(WORKSPACE_ROOT, { recursive: true, force: true });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
