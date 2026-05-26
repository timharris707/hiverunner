import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { createProject } from "@/lib/orchestration/service";
import {
  ensureCompanyManagedFileWorkspaces,
  listCompanyFileWorkspaces,
  resolveScopedFileWorkspaceBase,
} from "@/lib/files/workspace-registry";
import {
  resolveWorkspaceBase,
  resolveWorkspacePath,
} from "@/lib/files/workspace-resolver";

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
  console.log("\nFile Workspace Registry Tests\n");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-file-workspaces-"));
  process.env.MC_WORKSPACE_ROOT = path.join(tempRoot, "workspaces");
  process.env.OPENCLAW_DIR = path.join(tempRoot, "openclaw");
  process.env.OPENCLAW_WORKSPACE_ROOT = path.join(tempRoot, "openclaw", "workspace");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  }

  const sourceRoot = path.join(tempRoot, "loanmeld-source");
  fs.mkdirSync(path.join(sourceRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "src", "index.ts"), "export const ok = true;\n");

  const company = createCompany({
    name: `Workspace Registry ${Date.now()}`,
    description: "fixture",
    status: "active",
  }).company;

  const project = createProject({
    companyId: company.id,
    name: "LoanMeld",
    description: "linked source fixture",
    color: "#0ea5e9",
    emoji: "L",
    status: "active",
    sourceWorkspaceRoot: sourceRoot,
  }).project;

  const db = getOrchestrationDb();
  const now = new Date().toISOString();
  const agentId = "agent-file-workspace-scout";
  const companyAgentId = "agent-file-workspace-mason";
  db.prepare(
    `INSERT INTO agents (
       id,
       company_id,
       project_id,
       name,
       slug,
       role,
       personality,
       status,
       skills_json,
       created_at,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', '[]', ?, ?)`
  ).run(
    agentId,
    company.id,
    project.id,
    "Scout",
    "scout",
    "Researcher",
    "Fixture agent",
    now,
    now,
  );
  db.prepare(
    `INSERT INTO agents (
       id,
       company_id,
       project_id,
       name,
       slug,
       role,
       personality,
       status,
       skills_json,
       created_at,
       updated_at
     )
     VALUES (?, ?, NULL, ?, ?, ?, ?, 'idle', '[]', ?, ?)`
  ).run(
    companyAgentId,
    company.id,
    "Mason",
    "mason",
    "Company-level Engineer",
    "Fixture company agent",
    now,
    now,
  );

  const agentWorkspaceRoot = path.join(company.workspace.root, "agents", "scout");
  const companyAgentWorkspaceRoot = path.join(company.workspace.root, "agents", "mason");
  fs.mkdirSync(agentWorkspaceRoot, { recursive: true });
  fs.mkdirSync(companyAgentWorkspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(agentWorkspaceRoot, "IDENTITY.md"), "# Scout\n");
  fs.writeFileSync(path.join(companyAgentWorkspaceRoot, "IDENTITY.md"), "# Mason\n");

  const projectFilesId = `project:${project.id}:files`;
  const projectSourceId = `project:${project.id}:source`;
  const companyId = `company:${company.id}`;
  const agentMemoryId = `agent:${agentId}:memory`;
  const companyAgentMemoryId = `agent:${companyAgentId}:memory`;

  ensureCompanyManagedFileWorkspaces(company.id);
  const workspaces = listCompanyFileWorkspaces(company.slug);

  test("lists company, project files, project source, and agent memory workspaces", () => {
    const ids = new Set(workspaces.map((workspace) => workspace.id));
    assert.ok(ids.has(companyId), "Expected company workspace");
    assert.ok(ids.has(projectFilesId), "Expected managed project files workspace");
    assert.ok(ids.has(projectSourceId), "Expected linked project source workspace");
    assert.ok(ids.has(agentMemoryId), "Expected agent memory workspace");
    assert.ok(ids.has(companyAgentMemoryId), "Expected company-level agent memory workspace");
  });

  test("scaffolds managed company and project workspaces without copying source files", () => {
    const projectFiles = workspaces.find((workspace) => workspace.id === projectFilesId);
    assert.ok(projectFiles?.exists, "Expected project files workspace to exist");
    assert.ok(projectFiles?.path.startsWith(company.workspace.root), "Expected managed project files under company root");
    assert.strictEqual(
      fs.existsSync(path.join(projectFiles?.path || "", "src", "index.ts")),
      false,
      "Expected source files not to be copied into managed project files",
    );
  });

  test("resolves project source roots from explicit scoped workspace ids", () => {
    assert.strictEqual(resolveScopedFileWorkspaceBase(projectSourceId), sourceRoot);
    assert.strictEqual(resolveWorkspaceBase(projectSourceId), sourceRoot);
    assert.strictEqual(resolveWorkspacePath(projectSourceId, "src/index.ts")?.fullPath, path.join(sourceRoot, "src", "index.ts"));
  });

  test("keeps arbitrary external absolute paths blocked", () => {
    assert.strictEqual(resolveWorkspaceBase(path.join(tempRoot, "not-registered")), null);
  });

  test("blocks path traversal outside linked source roots", () => {
    assert.strictEqual(resolveWorkspacePath(projectSourceId, "../outside.txt"), null);
  });

  test("resolves agent memory as a scoped workspace", () => {
    assert.strictEqual(resolveWorkspaceBase(agentMemoryId), agentWorkspaceRoot);
    assert.strictEqual(resolveWorkspacePath(agentMemoryId, "IDENTITY.md")?.fullPath, path.join(agentWorkspaceRoot, "IDENTITY.md"));
    assert.strictEqual(resolveWorkspaceBase(companyAgentMemoryId), companyAgentWorkspaceRoot);
    assert.strictEqual(resolveWorkspacePath(companyAgentMemoryId, "IDENTITY.md")?.fullPath, path.join(companyAgentWorkspaceRoot, "IDENTITY.md"));
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
