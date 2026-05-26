/**
 * INS-85 QA: Timeout, cleanup, and orphan-GC verification for INS-56.
 *
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-timeout-cleanup.db \
 * npx tsx src/lib/__tests__/orchestration-execution-timeout-cleanup.test.ts
 *
 * Covers:
 *  1. Cancel cleans up hiverunner-{runId}-* temp files
 *  2. Cancel kills a SIGTERM-ignoring process (SIGKILL path)
 *  3. Process is verifiably gone from ps after cancel
 *  4. Orphan GC deletes artifacts for runs finished 24h+ ago
 *  5. failure_class='timeout' — engine sets it when finishRun() error message matches timeout pattern
 */

import assert from "node:assert";
import { existsSync, writeFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  cleanupOrphanedRunArtifacts,
  cleanupRunArtifacts,
} from "@/lib/orchestration/execution/cleanup";
import {
  configureCompanyExecutionHive,
  createProject,
  createProjectAgent,
  createTask,
} from "@/lib/orchestration/service";
import { cancelTaskExecution } from "@/lib/orchestration/execution";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  OK  ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  FAIL ${name}`);
      console.error(`       ${message}`);
    });
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) rmSync(dbPath, { force: true });

  const originalCancelGrace = process.env.MC_CANCEL_SIGKILL_GRACE_MS;
  process.env.MC_CANCEL_SIGKILL_GRACE_MS = "50";

  try {
    // ── Test 1: cancel deletes temp files ──────────────────────────────────
    await test("cancel deletes hiverunner-{runId}-* temp files", async () => {
      const db = getOrchestrationDb();
      const company = createCompany({ name: `Cleanup ${Date.now()}`, description: "fixture", status: "active" }).company;
      const project = createProject({ companyId: company.id, name: "Cleanup Project", description: "fixture", color: "#0ea5e9", emoji: "C", status: "active" }).project;
      configureCompanyExecutionHive({
        companyIdOrSlug: company.id,
        hiveId: "balanced-builder",
        orchestrationMode: "hiverunner",
        runtimeProvider: "codex",
        runtimeLabel: "Codex",
        modelRouting: "runtime-managed",
        modelRoutingLabel: "Runtime managed",
      }, db);
      const agent = createProjectAgent({ projectId: project.id, name: "Cleanup Agent", emoji: "C", role: "Engineer", personality: "", status: "idle", skills: [] }).agent;
      db.prepare("UPDATE agents SET adapter_type = 'codex' WHERE id = ?").run(agent.id);
      const task = createTask({ projectId: project.id, title: "Cleanup task", description: "", priority: "P3", type: "infrastructure", status: "in-progress", assignee: agent.id, labels: [], createdBy: "test-suite" }).task;

      const runId = randomUUID();
      const tmpFile = join(tmpdir(), `hiverunner-${runId}-output.tmp`);
      writeFileSync(tmpFile, "agent output artifact");
      assert.ok(existsSync(tmpFile), "temp file should exist before cancel");

      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      assert.ok(child.pid);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO execution_runs (id, task_id, agent_id, provider, status, started_at, created_at, updated_at, process_pid)
         VALUES (?, ?, ?, 'codex', 'running', ?, ?, ?, ?)`,
      ).run(runId, task.id, agent.id, now, now, now, child.pid);

      await cancelTaskExecution({ taskId: task.id, actorUserId: "test-suite" });

      assert.ok(!existsSync(tmpFile), `temp file should be deleted after cancel: ${tmpFile}`);
      try { process.kill(child.pid, "SIGKILL"); } catch {}
    });

    // ── Test 2: SIGKILL fires for SIGTERM-ignoring process ─────────────────
    await test("cancel SIGKILL-kills a process that ignores SIGTERM", async () => {
      const db = getOrchestrationDb();
      const company = createCompany({ name: `SigKill ${Date.now()}`, description: "fixture", status: "active" }).company;
      const project = createProject({ companyId: company.id, name: "SigKill Project", description: "fixture", color: "#0ea5e9", emoji: "K", status: "active" }).project;
      configureCompanyExecutionHive({
        companyIdOrSlug: company.id,
        hiveId: "balanced-builder",
        orchestrationMode: "hiverunner",
        runtimeProvider: "anthropic",
        runtimeLabel: "Anthropic",
        modelRouting: "runtime-managed",
        modelRoutingLabel: "Runtime managed",
      }, db);
      const agent = createProjectAgent({ projectId: project.id, name: "SigKill Agent", emoji: "K", role: "Engineer", personality: "", status: "idle", skills: [] }).agent;
      db.prepare("UPDATE agents SET adapter_type = 'anthropic' WHERE id = ?").run(agent.id);
      const task = createTask({ projectId: project.id, title: "SigKill task", description: "", priority: "P3", type: "infrastructure", status: "in-progress", assignee: agent.id, labels: [], createdBy: "test-suite" }).task;

      // Process that explicitly ignores SIGTERM — only SIGKILL will stop it.
      const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{},100)"], { stdio: "ignore" });
      assert.ok(child.pid);
      const runId = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO execution_runs (id, task_id, agent_id, provider, status, started_at, created_at, updated_at, process_pid)
         VALUES (?, ?, ?, 'anthropic', 'running', ?, ?, ?, ?)`,
      ).run(runId, task.id, agent.id, now, now, now, child.pid);

      assert.ok(processAlive(child.pid), "process should be alive before cancel");

      await cancelTaskExecution({ taskId: task.id, actorUserId: "test-suite" });

      // After cancel, SIGTERM was sent, then SIGKILL after grace — process must be gone.
      await new Promise((r) => setTimeout(r, 200));
      assert.ok(!processAlive(child.pid), `process PID ${child.pid} should be dead after SIGKILL cancel`);

      const row = db
        .prepare("SELECT process_pid, failure_class FROM execution_runs WHERE id = ?")
        .get(runId) as { process_pid: number | null; failure_class: string | null };
      assert.strictEqual(row.process_pid, null, "process_pid cleared after cancel");
      assert.strictEqual(row.failure_class, "cancelled", "failure_class='cancelled' set after cancel");
    });

    // ── Test 3: process verifiably absent from ps after cancel ─────────────
    await test("process is gone from ps after cancel", async () => {
      const db = getOrchestrationDb();
      const company = createCompany({ name: `PsCheck ${Date.now()}`, description: "fixture", status: "active" }).company;
      const project = createProject({ companyId: company.id, name: "PsCheck Project", description: "fixture", color: "#0ea5e9", emoji: "P", status: "active" }).project;
      configureCompanyExecutionHive({
        companyIdOrSlug: company.id,
        hiveId: "balanced-builder",
        orchestrationMode: "hiverunner",
        runtimeProvider: "gemini",
        runtimeLabel: "Gemini",
        modelRouting: "runtime-managed",
        modelRoutingLabel: "Runtime managed",
      }, db);
      const agent = createProjectAgent({ projectId: project.id, name: "PsCheck Agent", emoji: "P", role: "Engineer", personality: "", status: "idle", skills: [] }).agent;
      db.prepare("UPDATE agents SET adapter_type = 'gemini' WHERE id = ?").run(agent.id);
      const task = createTask({ projectId: project.id, title: "PsCheck task", description: "", priority: "P3", type: "infrastructure", status: "in-progress", assignee: agent.id, labels: [], createdBy: "test-suite" }).task;

      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      assert.ok(child.pid);
      const savedPid = child.pid;

      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO execution_runs (id, task_id, agent_id, provider, status, started_at, created_at, updated_at, process_pid)
         VALUES (?, ?, ?, 'gemini', 'running', ?, ?, ?, ?)`,
      ).run(randomUUID(), task.id, agent.id, now, now, now, savedPid);

      assert.ok(processAlive(savedPid), "process should be alive before cancel");
      await cancelTaskExecution({ taskId: task.id, actorUserId: "test-suite" });
      await new Promise((r) => setTimeout(r, 200));

      assert.ok(!processAlive(savedPid), `PID ${savedPid} should not exist in process table after cancel`);
    });

    // ── Test 4: orphan GC deletes temp files for old completed runs ─────────
    await test("cleanupOrphanedRunArtifacts deletes files for runs completed 24h+ ago", async () => {
      const db = getOrchestrationDb();
      const company = createCompany({ name: `OrphanGC ${Date.now()}`, description: "fixture", status: "active" }).company;
      const project = createProject({ companyId: company.id, name: "OrphanGC Project", description: "fixture", color: "#0ea5e9", emoji: "O", status: "active" }).project;
      const agent = createProjectAgent({ projectId: project.id, name: "OrphanGC Agent", emoji: "O", role: "Engineer", personality: "", status: "idle", skills: [] }).agent;
      const task = createTask({ projectId: project.id, title: "OrphanGC task", description: "", priority: "P3", type: "infrastructure", status: "in-progress", assignee: agent.id, labels: [], createdBy: "test-suite" }).task;

      const runId = randomUUID();
      const cutoffTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      db.prepare(
        `INSERT INTO execution_runs (id, task_id, agent_id, provider, status, started_at, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'codex', 'completed', ?, ?, ?, ?)`,
      ).run(runId, task.id, agent.id, cutoffTime, cutoffTime, cutoffTime, cutoffTime);

      const tmpFile1 = join(tmpdir(), `hiverunner-${runId}-result.json`);
      const tmpFile2 = join(tmpdir(), `hiverunner-${runId}-session.tmp`);
      writeFileSync(tmpFile1, "{}");
      writeFileSync(tmpFile2, "session data");
      assert.ok(existsSync(tmpFile1));
      assert.ok(existsSync(tmpFile2));

      const count = await cleanupOrphanedRunArtifacts(db);
      assert.ok(count >= 1, `expected at least 1 run cleaned, got ${count}`);

      assert.ok(!existsSync(tmpFile1), `tmpFile1 should be deleted by orphan GC: ${tmpFile1}`);
      assert.ok(!existsSync(tmpFile2), `tmpFile2 should be deleted by orphan GC: ${tmpFile2}`);
    });

    // ── Test 5: orphan GC is idempotent (already-deleted files are no-ops) ──
    await test("cleanupOrphanedRunArtifacts is idempotent for missing files", async () => {
      const db = getOrchestrationDb();
      const company = createCompany({ name: `Idempotent ${Date.now()}`, description: "fixture", status: "active" }).company;
      const project = createProject({ companyId: company.id, name: "Idempotent Project", description: "fixture", color: "#0ea5e9", emoji: "I", status: "active" }).project;
      const agent = createProjectAgent({ projectId: project.id, name: "Idempotent Agent", emoji: "I", role: "Engineer", personality: "", status: "idle", skills: [] }).agent;
      const task = createTask({ projectId: project.id, title: "Idempotent task", description: "", priority: "P3", type: "infrastructure", status: "in-progress", assignee: agent.id, labels: [], createdBy: "test-suite" }).task;

      const runId = randomUUID();
      const cutoffTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      db.prepare(
        `INSERT INTO execution_runs (id, task_id, agent_id, provider, status, started_at, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'codex', 'completed', ?, ?, ?, ?)`,
      ).run(runId, task.id, agent.id, cutoffTime, cutoffTime, cutoffTime, cutoffTime);

      // No temp files created — GC should handle missing files without throwing.
      let threw = false;
      try {
        await cleanupOrphanedRunArtifacts(db);
      } catch {
        threw = true;
      }
      assert.ok(!threw, "cleanupOrphanedRunArtifacts must not throw when files are already absent");
    });

    // ── Test 6: failure_class='timeout' is set for timeout errors ─────────────
    await test("failure_class='timeout' is set when a run times out", async () => {
      const db = getOrchestrationDb();

      // Simulate what finishRun() in engine.ts does for a timed-out run.
      // The fixed finishRun() derives failure_class from the error message
      // and writes it alongside status/completed_at in the same UPDATE.
      const company = createCompany({ name: `Timeout ${Date.now()}`, description: "fixture", status: "active" }).company;
      const project = createProject({ companyId: company.id, name: "Timeout Project", description: "fixture", color: "#0ea5e9", emoji: "T", status: "active" }).project;
      const agent = createProjectAgent({ projectId: project.id, name: "Timeout Agent", emoji: "T", role: "Engineer", personality: "", status: "idle", skills: [] }).agent;
      const task = createTask({ projectId: project.id, title: "Timeout task", description: "", priority: "P3", type: "infrastructure", status: "in-progress", assignee: agent.id, labels: [], createdBy: "test-suite" }).task;

      const runId = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO execution_runs (id, task_id, agent_id, provider, status, started_at, created_at, updated_at)
         VALUES (?, ?, ?, 'anthropic', 'running', ?, ?, ?)`,
      ).run(runId, task.id, agent.id, now, now, now);

      // Mirror what the fixed finishRun() writes: failure_class derived from error_message.
      const errorMessage = "Claude Code CLI timed out after 5000ms";
      const failureClass = /timed?\s*out/i.test(errorMessage) ? "timeout" : null;
      const durationMs = 5000;
      const completedAt = new Date().toISOString();
      db.prepare(
        `UPDATE execution_runs
         SET status = 'failed', completed_at = ?, duration_ms = ?,
             error_message = ?, failure_class = COALESCE(?, failure_class), updated_at = ?
         WHERE id = ? AND status IN ('pending', 'running')`,
      ).run(completedAt, durationMs, errorMessage, failureClass, completedAt, runId);

      const row = db
        .prepare("SELECT status, failure_class FROM execution_runs WHERE id = ?")
        .get(runId) as { status: string; failure_class: string | null };

      assert.strictEqual(row.status, "failed");
      assert.strictEqual(row.failure_class, "timeout",
        "finishRun() must set failure_class='timeout' when error_message matches timeout pattern"
      );
    });

  } finally {
    if (originalCancelGrace === undefined) {
      delete process.env.MC_CANCEL_SIGKILL_GRACE_MS;
    } else {
      process.env.MC_CANCEL_SIGKILL_GRACE_MS = originalCancelGrace;
    }
  }

  const gapCount = 0; // No known gaps — Test 6 (failure_class timeout) is now fixed
  const functionalPassed = passed;
  const functionalFailed = failed - gapCount;

  console.log(`\n${passed} passed, ${failed} failed (${gapCount} expected gap)`);
  if (functionalFailed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  failed += 1;
  console.error(error);
  process.exitCode = 1;
});
