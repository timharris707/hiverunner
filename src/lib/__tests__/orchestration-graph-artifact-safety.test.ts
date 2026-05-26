import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  diffGraphArtifactInventories,
  rollbackGraphArtifactInventory,
  snapshotGraphArtifactInventory,
  writeGraphArtifactsSafely,
} from "@/lib/orchestration/graph-artifact-safety";
import { getCompanyMemorySettings, initializeCompanyMemoryVault } from "@/lib/orchestration/memory-vault";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  PASS ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      console.error(`  FAIL ${name}`);
      console.error(`    ${error instanceof Error ? error.message : String(error)}`);
    });
}

async function run() {
  console.log("\nGraph Artifact Safety Tests\n");
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "mc-graph-artifacts-"));
  process.env.MC_WORKSPACE_ROOT = workspaceRoot;
  const db = getOrchestrationDb();
  const stamp = Date.now();
  const company = createCompany({
    name: `Graph Artifact Company ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;
  db.prepare("UPDATE companies SET workspace_root = ? WHERE id = ?").run(
    path.join(workspaceRoot, "companies", company.slug),
    company.id,
  );
  const init = initializeCompanyMemoryVault(company.slug);
  const settings = getCompanyMemorySettings(company.slug).settings;

  await test("snapshots graph/map zones and compares before/after writes", async () => {
    mkdirSync(path.join(init.vaultRoot, "graph"), { recursive: true });
    writeFileSync(path.join(init.vaultRoot, "graph", "existing.json"), "{\"nodes\":[]}\n", "utf-8");
    const before = await snapshotGraphArtifactInventory({ vaultRoot: settings.vaultRoot, includeContent: true });
    const result = await writeGraphArtifactsSafely(company.slug, [
      { path: "graph/existing.json", content: "{\"nodes\":[\"company\"]}\n" },
      { path: "maps/company-map.md", content: "# Company Map\n\n[[Graph Artifact Company]]\n" },
    ]);
    const manualDiff = diffGraphArtifactInventories(before, result.after);

    assert.deepStrictEqual(result.diff.added, ["maps/company-map.md"]);
    assert.deepStrictEqual(result.diff.changed, ["graph/existing.json"]);
    assert.deepStrictEqual(result.diff.removed, []);
    assert.deepStrictEqual(result.diff, manualDiff);
    assert.ok(result.rollbackNotes.includes("graph/existing.json"));
    assert.ok(result.rollbackNotes.includes("maps/company-map.md"));
  });

  await test("rejects prohibited graph writes before touching declared zones", async () => {
    const before = await snapshotGraphArtifactInventory({ vaultRoot: settings.vaultRoot, includeContent: true });
    await assert.rejects(
      () => writeGraphArtifactsSafely(company.slug, [
        { path: "graph/safe.json", content: "{}\n" },
        { path: "company/prohibited.md", content: "# Bad\n" },
      ]),
      (error: unknown) => error instanceof OrchestrationApiError && error.code === "graph_artifact_zone_not_allowed",
    );
    const after = await snapshotGraphArtifactInventory({ vaultRoot: settings.vaultRoot, includeContent: true });
    assert.deepStrictEqual(diffGraphArtifactInventories(before, after), {
      added: [],
      changed: [],
      removed: [],
      unchanged: before.files.map((file) => file.relativePath),
    });
  });

  await test("idempotent rerun reports unchanged inventory and no file changes", async () => {
    const first = await writeGraphArtifactsSafely(company.slug, [
      { path: "graph/idempotent.json", content: "{\"stable\":true}\n" },
      { path: "maps/idempotent.md", content: "# Stable Map\n\nNo drift.\n" },
    ]);
    const second = await writeGraphArtifactsSafely(company.slug, [
      { path: "graph/idempotent.json", content: "{\"stable\":true}\n" },
      { path: "maps/idempotent.md", content: "# Stable Map\n\nNo drift.\n" },
    ]);

    assert.ok(first.writes.every((write) => write.changed));
    assert.ok(second.writes.every((write) => !write.changed));
    assert.deepStrictEqual(second.diff.added, []);
    assert.deepStrictEqual(second.diff.changed, []);
    assert.deepStrictEqual(second.diff.removed, []);
  });

  await test("rollback restores changed files and removes generated additions", async () => {
    const snapshot = await snapshotGraphArtifactInventory({ vaultRoot: settings.vaultRoot, includeContent: true });
    await writeGraphArtifactsSafely(company.slug, [
      { path: "graph/existing.json", content: "{\"nodes\":[\"mutated\"]}\n" },
      { path: "maps/rollback-only.md", content: "# Remove Me\n" },
    ]);
    const restored = await rollbackGraphArtifactInventory(snapshot);
    assert.deepStrictEqual(diffGraphArtifactInventories(snapshot, restored), {
      added: [],
      changed: [],
      removed: [],
      unchanged: snapshot.files.map((file) => file.relativePath),
    });
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
