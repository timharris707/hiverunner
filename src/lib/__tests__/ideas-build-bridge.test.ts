/**
 * Ideas build bridge tests.
 * Run: npx tsx src/lib/__tests__/ideas-build-bridge.test.ts
 */

import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  appendTakeawayTaskNote,
  mapActionToTaskStatus,
  mapTakeawayPriority,
  resolveBridgeAssignee,
  resolveBridgeProject,
} from "@/lib/ideas-build-bridge";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

function seedDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      slug TEXT,
      name TEXT,
      archived_at TEXT
    );

    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      name TEXT,
      archived_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);

  db.prepare(
    `INSERT INTO projects (id, company_id, slug, name, archived_at)
     VALUES (?, ?, ?, ?, NULL)`
  ).run("project-1", "company-1", "mission-control", "HiveRunner");

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO agents (id, company_id, name, archived_at, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?)`
  ).run("agent-1", "company-1", "Forge", now, now);

  return db;
}

console.log("\nIdeas Build Bridge Tests\n");

test("priority mapping follows takeover contract", () => {
  assert.equal(mapTakeawayPriority("high"), "P0");
  assert.equal(mapTakeawayPriority("medium"), "P1");
  assert.equal(mapTakeawayPriority("low"), "P2");
  assert.equal(mapTakeawayPriority("unknown"), "P1");
});

test("action mapping uses in-progress for build-now and backlog for queue", () => {
  assert.equal(mapActionToTaskStatus("build-now"), "in-progress");
  assert.equal(mapActionToTaskStatus("add-to-queue"), "backlog");
});

test("takeaway task note append is idempotent for repeated build requests", () => {
  const first = appendTakeawayTaskNote({
    currentNotes: "",
    taskId: "task-123",
    action: "add-to-queue",
  });
  assert.equal(first, "Task created: task-123 (add-to-queue, orchestration)");

  const second = appendTakeawayTaskNote({
    currentNotes: first,
    taskId: "task-123",
    action: "add-to-queue",
  });
  assert.equal(second, first);
});

test("project and assignee lookup resolves by slug/name with company scope", () => {
  const db = seedDb();

  const project = resolveBridgeProject(db, "mission-control");
  assert.ok(project);
  assert.equal(project.id, "project-1");
  assert.equal(project.companyId, "company-1");

  const byName = resolveBridgeProject(db, "HiveRunner");
  assert.ok(byName);
  assert.equal(byName.id, "project-1");

  const assignee = resolveBridgeAssignee(db, "company-1", "forge");
  assert.ok(assignee);
  assert.equal(assignee.id, "agent-1");

  const missingAssignee = resolveBridgeAssignee(db, "company-1", "pixel");
  assert.equal(missingAssignee, null);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
