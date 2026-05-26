#!/usr/bin/env npx tsx
/**
 * cleanup-test-artifacts.ts
 *
 * Safely removes disposable test companies, projects, and related artifacts
 * from the orchestration database and filesystem workspaces.
 *
 * Usage:
 *   npx tsx scripts/cleanup-test-artifacts.ts            # dry-run (audit only)
 *   npx tsx scripts/cleanup-test-artifacts.ts --apply     # actually delete
 *   npx tsx scripts/cleanup-test-artifacts.ts --verbose   # show details in dry-run
 *
 * Safety:
 *   - Companies listed in PROTECTED_SLUGS are never deleted
 *   - Dry-run is the default; --apply is required to mutate
 *   - Each deletion is wrapped in a transaction
 *   - Workspace directories are only removed if the company is deleted first
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

import { resolveHiveRunnerDataDir } from "../src/lib/runtime-paths";
import { isSafeManagedCompanyWorkspacePath } from "../src/lib/workspaces/delete-safety";

// ── Config ──────────────────────────────────────────────────────────────────

const DB_PATH = process.env.ORCHESTRATION_DB_PATH
  ?? path.join(resolveHiveRunnerDataDir(process.env), "orchestration.db");

/** Companies that must never be deleted regardless of name patterns. */
const PROTECTED_SLUGS = new Set([
  "hiverunner-workspace",
  "cascade-inc",
  "river-s-edge",
  "virtual-design-house",
]);

/** Default public local company ID. */
const DEFAULT_COMPANY_ID = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";

/** Slug patterns that indicate disposable test data. */
const TEST_COMPANY_PATTERNS = [
  /^auto-sync-labs/,
  /^rename-labs/,
  /^other-corp/,
  /^alias-collision/,
  /^e2e-/,
  /^cache-test/,
  /^ambiguity/,
  /^propagation/,
  /^project-rename-host/,
  /^proptest/,
  /^propclean/,
  /^goals-scope-\d/,
  /-mnq[a-z0-9]{4,}/,  // random suffix test IDs
];

/** Tokens in slug/name that indicate test data. */
const TEST_TOKENS = [
  "test", "demo", "sandbox", "fixture", "smoke", "scratch",
  "tmp", "temp", "playground", "e2e", "collision", "ambiguity",
];

/** Project slug patterns (within NEV) that indicate automated test output. */
const TEST_PROJECT_PATTERNS = [
  /^s10a-test/,
  /^s11-nav/,
  /^orch-test/,
  /^orch-task/,
  /^orch-activity/,
  /^orch-inbox/,
  /^agent-test/,
  /^default-company/,
  /^company-scope/,
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function isTestCompanySlug(slug: string): boolean {
  if (PROTECTED_SLUGS.has(slug)) return false;
  if (TEST_COMPANY_PATTERNS.some((p) => p.test(slug))) return true;
  const tokens = slug.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/);
  return TEST_TOKENS.some((t) => tokens.includes(t));
}

function isTestProjectSlug(slug: string): boolean {
  return TEST_PROJECT_PATTERNS.some((p) => p.test(slug));
}

type CompanyRow = {
  id: string;
  slug: string;
  company_code: string | null;
  name: string;
  workspace_root: string | null;
};

type ArtifactCounts = {
  agents: number;
  projects: number;
  tasks: number;
  taskEvents: number;
  comments: number;
  approvals: number;
  executionRuns: number;
  heartbeatRuns: number;
};

function countArtifacts(db: Database.Database, companyId: string): ArtifactCounts {
  const q = (sql: string) =>
    (db.prepare(sql).get(companyId) as { c: number }).c;

  const projectIds = db
    .prepare("SELECT id FROM projects WHERE company_id = ?")
    .all(companyId)
    .map((r) => (r as { id: string }).id);

  let tasks = 0,
    taskEvents = 0,
    comments = 0;
  for (const pid of projectIds) {
    tasks += (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE project_id = ?").get(pid) as { c: number }).c;
    taskEvents += (db.prepare("SELECT COUNT(*) as c FROM task_events WHERE project_id = ?").get(pid) as { c: number }).c;
    comments += (db.prepare("SELECT COUNT(*) as c FROM comments WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)").get(pid) as { c: number }).c;
  }

  return {
    agents: q("SELECT COUNT(*) as c FROM agents WHERE company_id = ?"),
    projects: projectIds.length,
    tasks,
    taskEvents,
    comments,
    approvals: q("SELECT COUNT(*) as c FROM approvals WHERE company_id = ?"),
    executionRuns: (db.prepare("SELECT COUNT(*) as c FROM execution_runs WHERE agent_id IN (SELECT id FROM agents WHERE company_id = ?)").get(companyId) as { c: number }).c,
    heartbeatRuns: q("SELECT COUNT(*) as c FROM heartbeat_runs WHERE company_id = ?"),
  };
}

function deleteCompanyFull(db: Database.Database, companyId: string): void {
  const projectIds = db
    .prepare("SELECT id FROM projects WHERE company_id = ?")
    .all(companyId)
    .map((r) => (r as { id: string }).id);

  for (const pid of projectIds) {
    db.prepare("DELETE FROM task_events WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)").run(pid);
    db.prepare("DELETE FROM comments WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)").run(pid);
    db.prepare("DELETE FROM execution_runs WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)").run(pid);
    db.prepare("DELETE FROM tasks WHERE project_id = ?").run(pid);
  }
  db.prepare("DELETE FROM heartbeat_runs WHERE company_id = ?").run(companyId);
  db.prepare("DELETE FROM approvals WHERE company_id = ?").run(companyId);
  db.prepare("DELETE FROM execution_runs WHERE agent_id IN (SELECT id FROM agents WHERE company_id = ?)").run(companyId);
  db.prepare("DELETE FROM agents WHERE company_id = ?").run(companyId);
  db.prepare("DELETE FROM project_slug_aliases WHERE project_id IN (SELECT id FROM projects WHERE company_id = ?)").run(companyId);
  db.prepare("DELETE FROM projects WHERE company_id = ?").run(companyId);
  db.prepare("DELETE FROM company_slug_aliases WHERE company_id = ?").run(companyId);
  db.prepare("DELETE FROM companies WHERE id = ?").run(companyId);
}

function deleteProjectFull(db: Database.Database, projectId: string): void {
  db.prepare("DELETE FROM task_events WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)").run(projectId);
  db.prepare("DELETE FROM comments WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)").run(projectId);
  db.prepare("DELETE FROM execution_runs WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)").run(projectId);
  db.prepare("DELETE FROM tasks WHERE project_id = ?").run(projectId);
  db.prepare("DELETE FROM project_slug_aliases WHERE project_id = ?").run(projectId);
  db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
}

// ── Main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const verbose = args.includes("--verbose");

if (!fs.existsSync(DB_PATH)) {
  console.error("Database not found at", DB_PATH);
  process.exit(1);
}

const db = new Database(DB_PATH);
console.log(apply ? "MODE: APPLY (will delete)" : "MODE: DRY-RUN (audit only)");
console.log("");

// ── Audit companies ─────────────────────────────────────────────────────

const companies = db
  .prepare("SELECT id, slug, company_code, name, workspace_root FROM companies ORDER BY slug")
  .all() as CompanyRow[];

const toDelete: Array<{ company: CompanyRow; counts: ArtifactCounts }> = [];
const toKeep: CompanyRow[] = [];

for (const co of companies) {
  if (PROTECTED_SLUGS.has(co.slug)) {
    toKeep.push(co);
    continue;
  }
  if (isTestCompanySlug(co.slug)) {
    const counts = countArtifacts(db, co.id);
    toDelete.push({ company: co, counts });
  } else {
    toKeep.push(co);
  }
}

console.log(`Companies: ${companies.length} total, ${toDelete.length} test, ${toKeep.length} keep`);
console.log("");

if (toDelete.length > 0) {
  console.log("DELETE candidates:");
  for (const { company: co, counts } of toDelete) {
    const parts = [co.company_code ?? "---", co.slug];
    if (verbose) {
      parts.push(
        `agents=${counts.agents}`,
        `projects=${counts.projects}`,
        `tasks=${counts.tasks}`,
      );
    }
    console.log("  -", parts.join(" | "));
  }
  console.log("");
}

console.log("KEEP:");
for (const co of toKeep) {
  console.log("  +", co.company_code ?? "---", co.slug);
}
console.log("");

// ── Audit test projects inside protected companies ──────────────────────

const nevProjects = db
  .prepare("SELECT id, slug, name FROM projects WHERE company_id = ?")
  .all(DEFAULT_COMPANY_ID) as Array<{ id: string; slug: string; name: string }>;

const testProjects = nevProjects.filter((p) => isTestProjectSlug(p.slug));

if (testProjects.length > 0) {
  console.log(`NEV test projects to delete: ${testProjects.length}`);
  if (verbose) {
    for (const p of testProjects.slice(0, 10)) {
      console.log("  -", p.slug);
    }
    if (testProjects.length > 10) {
      console.log(`  ... and ${testProjects.length - 10} more`);
    }
  }
  console.log("");
}

// ── Execute ─────────────────────────────────────────────────────────────

if (!apply) {
  console.log("Dry-run complete. Run with --apply to delete.");
  process.exit(0);
}

// ── Pre-mutation backup ────────────────────────────────────────────────
// Automatically snapshot orchestration.db before any destructive operation.
// This ensures a known-good restore point exists regardless of how the
// script is invoked.
const backupTimestamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
const backupPath = DB_PATH + `.backup-${backupTimestamp}-before-cleanup`;
fs.copyFileSync(DB_PATH, backupPath);
console.log(`Pre-cleanup backup: ${backupPath}`);
console.log("");

let deletedCompanies = 0;
let deletedWorkspaces = 0;
let deletedProjects = 0;

const deleteCompanyTx = db.transaction((co: CompanyRow) => {
  deleteCompanyFull(db, co.id);
});

for (const { company: co } of toDelete) {
  deleteCompanyTx(co);
  deletedCompanies++;
  if (
    co.workspace_root &&
    isSafeManagedCompanyWorkspacePath(co.workspace_root) &&
    fs.existsSync(co.workspace_root)
  ) {
    fs.rmSync(co.workspace_root, { recursive: true, force: true });
    deletedWorkspaces++;
  }
}

const deleteProjectTx = db.transaction((pid: string) => {
  deleteProjectFull(db, pid);
});

for (const p of testProjects) {
  deleteProjectTx(p.id);
  deletedProjects++;
}

// Clean orphaned aliases
db.prepare("DELETE FROM company_slug_aliases WHERE company_id NOT IN (SELECT id FROM companies)").run();
db.prepare("DELETE FROM project_slug_aliases WHERE project_id NOT IN (SELECT id FROM projects)").run();

console.log(`Deleted: ${deletedCompanies} companies, ${deletedWorkspaces} workspaces, ${deletedProjects} NEV test projects`);

// ── Post-cleanup inventory and safety check ─────────────────────────────

const remaining = db
  .prepare("SELECT slug, company_code FROM companies ORDER BY slug")
  .all() as Array<{ slug: string; company_code: string | null }>;
console.log(`\nRemaining companies (${remaining.length}):`);
for (const co of remaining) {
  console.log("  ", co.company_code ?? "---", co.slug);
}

const nevProjectCount = (db.prepare("SELECT COUNT(*) as c FROM projects WHERE company_id = ?").get(DEFAULT_COMPANY_ID) as { c: number }).c;
console.log(`NEV projects remaining: ${nevProjectCount}`);

// Row count drop check: warn if tasks dropped to 0 in a system that still
// has active projects, or if the total task count dropped by more than 50%.
const preBackupDb = new Database(backupPath, { readonly: true });
const preTasks = (preBackupDb.prepare("SELECT COUNT(*) as c FROM tasks").get() as { c: number }).c;
preBackupDb.close();
const postTasks = (db.prepare("SELECT COUNT(*) as c FROM tasks").get() as { c: number }).c;
const postProjects = (db.prepare("SELECT COUNT(*) as c FROM projects").get() as { c: number }).c;

console.log(`\nTask count: ${preTasks} -> ${postTasks}`);
if (postTasks === 0 && postProjects > 0) {
  console.warn("WARNING: task count is now 0 but projects still exist.");
  console.warn("         If this is unintended, restore from: " + backupPath);
}
if (preTasks > 0 && postTasks < preTasks * 0.5) {
  console.warn(`WARNING: task count dropped by more than 50% (${preTasks} -> ${postTasks}).`);
  console.warn("         Verify no legitimate tasks were deleted.");
  console.warn("         Restore from: " + backupPath);
}
