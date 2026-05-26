import { writeFile } from "node:fs/promises";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  diffGraphArtifactInventories,
  snapshotGraphArtifactInventory,
  writeGraphArtifactsSafely,
} from "@/lib/orchestration/graph-artifact-safety";
import { getCompanyMemorySettings, initializeCompanyMemoryVault } from "@/lib/orchestration/memory-vault";

async function main() {
  const outputDir = path.resolve("output", "ins-37");
  mkdirSync(outputDir, { recursive: true });

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }
  const workspaceRoot = path.join(outputDir, "workspace");
  rmSync(workspaceRoot, { recursive: true, force: true });
  mkdirSync(workspaceRoot, { recursive: true });
  process.env.MC_WORKSPACE_ROOT = workspaceRoot;

  const db = getOrchestrationDb();
  const company = createCompany({
    name: "INS-37 Graph Safety Proof",
    description: "Fixture company for graph artifact safety evidence",
    status: "active",
  }).company;
  db.prepare("UPDATE companies SET workspace_root = ? WHERE id = ?").run(
    path.join(workspaceRoot, "companies", company.slug),
    company.id,
  );
  initializeCompanyMemoryVault(company.slug);
  const settings = getCompanyMemorySettings(company.slug).settings;

  const before = await snapshotGraphArtifactInventory({ vaultRoot: settings.vaultRoot, includeContent: false });
  const first = await writeGraphArtifactsSafely(company.slug, [
    { path: "graph/company-memory-graph.json", content: JSON.stringify({ nodes: ["company"], edges: [] }, null, 2) + "\n" },
    { path: "maps/company-knowledge-map.md", content: "# Company Knowledge Map\n\n- [[Company Memory Graph]]\n" },
  ]);

  let rejected: { code: string; message: string } | null = null;
  try {
    await writeGraphArtifactsSafely(company.slug, [
      { path: "company/prohibited-graph-write.md", content: "# This must not write\n" },
    ]);
  } catch (error) {
    rejected = {
      code: typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const afterRejected = await snapshotGraphArtifactInventory({ vaultRoot: settings.vaultRoot, includeContent: false });
  const second = await writeGraphArtifactsSafely(company.slug, [
    { path: "graph/company-memory-graph.json", content: JSON.stringify({ nodes: ["company"], edges: [] }, null, 2) + "\n" },
    { path: "maps/company-knowledge-map.md", content: "# Company Knowledge Map\n\n- [[Company Memory Graph]]\n" },
  ]);

  const evidence = {
    company: { id: company.id, slug: company.slug },
    vaultRoot: settings.vaultRoot,
    beforeInventory: before,
    firstWrite: {
      diff: first.diff,
      writes: first.writes,
    },
    prohibitedPathAttempt: rejected,
    afterRejectedDiff: diffGraphArtifactInventories(first.after, afterRejected),
    idempotentRerun: {
      diff: second.diff,
      writes: second.writes,
    },
    rollbackNotesPath: path.join(outputDir, "rollback-notes.md"),
  };

  await writeFile(path.join(outputDir, "graph-safety-evidence.json"), JSON.stringify(evidence, null, 2) + "\n", "utf-8");
  await writeFile(path.join(outputDir, "rollback-notes.md"), first.rollbackNotes, "utf-8");
  console.log(JSON.stringify({
    outputDir,
    evidencePath: path.join(outputDir, "graph-safety-evidence.json"),
    rollbackNotesPath: path.join(outputDir, "rollback-notes.md"),
    rejected,
    firstDiff: first.diff,
    idempotentDiff: second.diff,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
