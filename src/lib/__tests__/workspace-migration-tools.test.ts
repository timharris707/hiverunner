import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
  console.log("\nWorkspace Migration Tooling Tests\n");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-migration-tools-"));
  const openClawDir = path.join(tempRoot, "openclaw");
  const openClawWorkspaceRoot = path.join(openClawDir, "workspace");
  const hiveRunnerWorkspaceRoot = path.join(tempRoot, "hiverunner", "stable", "workspaces");
  const dbPath = path.join(tempRoot, "orchestration.db");

  fs.mkdirSync(openClawWorkspaceRoot, { recursive: true });
  fs.mkdirSync(path.join(openClawDir, "workspaces"), { recursive: true });
  fs.mkdirSync(hiveRunnerWorkspaceRoot, { recursive: true });

  process.env.ORCHESTRATION_DB_PATH = dbPath;
  process.env.MC_WORKSPACE_ROOT = hiveRunnerWorkspaceRoot;
  process.env.OPENCLAW_DIR = openClawDir;
  process.env.OPENCLAW_WORKSPACE_ROOT = openClawWorkspaceRoot;

  const { createCompany } = await import("@/lib/orchestration/company-service");
  const { createProject, createProjectAgent } = await import("@/lib/orchestration/service");
  const { getOrchestrationDb, closeOrchestrationDb } = await import("@/lib/orchestration/db");
  const {
    buildWorkspaceMigrationBackupPlan,
    readWorkspaceMigrationInventory,
    verifyWorkspaceMigrationCompatibility,
    writeWorkspaceMigrationBackupSnapshot,
  } = await import("@/lib/workspaces/migration");

  const safeCompany = createCompany({
    name: "Safe Co",
    description: "fixture",
    status: "active",
  }).company;
  const missingCompany = createCompany({
    name: "Missing Co",
    description: "fixture",
    status: "active",
  }).company;

  const db = getOrchestrationDb();
  const safeCompanyRoot = path.join(openClawDir, "workspaces", safeCompany.slug);
  const missingCompanyRoot = path.join(openClawDir, "workspaces", missingCompany.slug);
  db.prepare("UPDATE companies SET workspace_root = ?, workspace_source = 'provisioned' WHERE id = ?").run(
    safeCompanyRoot,
    safeCompany.id,
  );
  db.prepare("UPDATE companies SET workspace_root = ?, workspace_source = 'provisioned' WHERE id = ?").run(
    missingCompanyRoot,
    missingCompany.id,
  );

  fs.mkdirSync(path.join(safeCompanyRoot, "agents"), { recursive: true });
  fs.mkdirSync(path.join(safeCompanyRoot, "projects"), { recursive: true });
  fs.mkdirSync(path.join(safeCompanyRoot, "memory"), { recursive: true });
  fs.mkdirSync(path.join(safeCompanyRoot, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(openClawDir, "workspaces", "orphan-shop"), { recursive: true });
  fs.mkdirSync(path.join(openClawWorkspaceRoot, "companies", "orphan-company-id"), { recursive: true });

  const safeProject = createProject({
    companyId: safeCompany.id,
    name: "Alpha Project",
    description: "fixture",
    color: "#22c55e",
    emoji: "🧪",
    status: "active",
  }).project;

  fs.mkdirSync(path.join(safeCompanyRoot, "projects", safeProject.slug), { recursive: true });

  const companyScopedAgent = createProjectAgent({
    projectId: safeProject.id,
    name: "Builder Bot",
    role: "Builder",
    personality: "Steady",
    emoji: "🤖",
    status: "idle",
    skills: [],
  }).agent;

  const legacyFallbackAgent = createProjectAgent({
    projectId: safeProject.id,
    name: "Legacy Runner",
    role: "Runner",
    personality: "Compat",
    emoji: "🏃",
    status: "idle",
    skills: [],
  }).agent;

  fs.mkdirSync(path.join(safeCompanyRoot, "agents", companyScopedAgent.slug), { recursive: true });
  fs.mkdirSync(path.join(openClawDir, `workspace-${legacyFallbackAgent.slug}`), { recursive: true });

  await test("inventory classifies manual review, blocked, orphaned, and legacy compatibility items", () => {
    const inventory = readWorkspaceMigrationInventory();
    const safeRecord = inventory.companies.find((company) => company.companyId === safeCompany.id);
    const missingRecord = inventory.companies.find((company) => company.companyId === missingCompany.id);
    const defaultRecord = inventory.companies.find((company) => company.companySlug === "hiverunner-workspace");

    assert.ok(safeRecord);
    assert.ok(missingRecord);
    assert.ok(defaultRecord);
    assert.strictEqual(
      inventory.environment.backupRoot,
      path.join(tempRoot, "hiverunner", "backups", "migration", "stable"),
    );
    assert.strictEqual(safeRecord?.workspaceSlug, safeCompany.workspaceSlug);
    assert.strictEqual(
      safeRecord?.plannedWorkspaceRoot,
      path.join(hiveRunnerWorkspaceRoot, "companies", safeCompany.workspaceSlug),
    );
    assert.strictEqual(safeRecord?.classification, "manual-review");
    assert.strictEqual(missingRecord?.classification, "manual-review");
    assert.ok(missingRecord?.reasons.includes("source_directory_missing"));
    assert.strictEqual(defaultRecord?.classification, "blocked");
    assert.ok(
      inventory.orphanedDirectories.some((directory) => directory.path.endsWith("/orphan-shop")),
      "Expected orphaned OpenClaw workspace directory in inventory",
    );
    assert.ok(
      inventory.legacyAgentDirectories.some(
        (directory) =>
          directory.path.endsWith(`/workspace-${legacyFallbackAgent.slug}`) &&
          directory.classification === "legacy-compatible",
      ),
      "Expected legacy agent workspace compatibility record",
    );
  });

  await test("snapshot plan captures DB rows and writes a manifest without copying workspaces by default", () => {
    const inventory = readWorkspaceMigrationInventory();
    const plan = buildWorkspaceMigrationBackupPlan({
      inventory,
      includeOrphanedDirectories: true,
      snapshotId: "test-snapshot",
    });

    assert.ok(plan.rows.companies.length >= 3);
    assert.ok(
      plan.rows.companies.some(
        (company) => company.id === safeCompany.id && company.workspace_slug === safeCompany.workspaceSlug,
      ),
      "Expected workspace_slug to be preserved in company row snapshots",
    );
    assert.ok(plan.rows.projects.some((project) => project.id === safeProject.id));
    assert.ok(plan.rows.agents.some((agent) => agent.id === companyScopedAgent.id));
    assert.ok(
      plan.directorySources.some((source) => source.companyId === safeCompany.id && source.exists),
      "Expected DB-backed safe company directory in snapshot plan",
    );
    assert.ok(
      plan.directorySources.some((source) => source.companyId === null && source.sourcePath.endsWith("/orphan-shop")),
      "Expected orphaned directory in snapshot plan when included explicitly",
    );

    const result = writeWorkspaceMigrationBackupSnapshot(plan, {
      writeManifest: true,
      copyWorkspaces: false,
    });
    assert.ok(fs.existsSync(result.manifestPath), "Expected snapshot manifest to be written");
    assert.strictEqual(result.copiedDirectoryCount, 0);
  });

  await test("snapshot flow can copy workspace directories into the backup root when requested explicitly", () => {
    const plan = buildWorkspaceMigrationBackupPlan({
      includeOrphanedDirectories: false,
      snapshotId: "test-snapshot-copy",
    });

    const result = writeWorkspaceMigrationBackupSnapshot(plan, {
      writeManifest: true,
      copyWorkspaces: true,
    });

    assert.ok(fs.existsSync(result.manifestPath), "Expected manifest to exist for copied snapshot");
    assert.ok(result.copiedDirectoryCount >= 1, "Expected at least one company workspace to be copied");
    assert.ok(
      fs.existsSync(
        path.join(plan.outputRoot, "directories", `${safeCompany.slug}-${safeCompany.id}`, "agents"),
      ),
      "Expected copied company workspace tree in the snapshot output",
    );
  });

  await test("verification reports company, project, agent, deletion safety, and legacy compatibility results", () => {
    const report = verifyWorkspaceMigrationCompatibility();
    const safeCompanyCheck = report.companyResolution.find((item) => item.companyId === safeCompany.id);
    const safeProjectCheck = report.projectResolution.find((item) => item.projectId === safeProject.id);
    const companyScopedAgentCheck = report.agentResolution.find((item) => item.agentId === companyScopedAgent.id);
    const legacyAgentCheck = report.agentResolution.find((item) => item.agentId === legacyFallbackAgent.id);
    const defaultDeleteSafety = report.deletionSafety.find((item) => item.companySlug === "hiverunner-workspace");

    assert.strictEqual(safeCompanyCheck?.status, "ok");
    assert.strictEqual(safeProjectCheck?.status, "ok");
    assert.strictEqual(companyScopedAgentCheck?.status, "ok");
    assert.strictEqual(companyScopedAgentCheck?.source, "company-convention");
    assert.strictEqual(legacyAgentCheck?.status, "ok");
    assert.strictEqual(legacyAgentCheck?.source, "company-convention");
    assert.strictEqual(defaultDeleteSafety?.status, "blocked");
    assert.ok(
      report.legacyCompatibility.some(
        (item) =>
          item.check === "workspace alias resolves to default OpenClaw workspace" &&
          item.status === "blocked",
      ),
      "Expected legacy workspace alias verification result to flag that the generic workspace alias now resolves to HiveRunner",
    );
  });

  closeOrchestrationDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
