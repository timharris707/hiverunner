/**
 * G2 — No-op resubmission detection (Phase G of orchestration-integrity lane).
 *
 * Trigger: WEA-284 on 2026-04-26. Sentinel rejected with specific row-count
 * findings. Prism re-ran the same generator script, producing a byte-identical
 * HTML file. Prism's resubmission was logged as if it were a fix; the engine
 * had no way to know nothing had actually changed.
 *
 * Rule: when an agent moves a task * → review and the artifact_sha256 on the
 * task matches the sha that was on it at the moment of the most recent
 * rejection (review → in_progress / to-do), reject the resubmission with
 * reason `no_op_resubmission` and bump the consecutive_noop_wakes circuit
 * breaker. Best-effort: the check is skipped when either side is null, so
 * tasks without registered artifacts are unaffected.
 *
 * Run:
 *   ORCHESTRATION_DB_PATH=/tmp/orchestration-no-op.db \
 *     npx tsx src/lib/__tests__/orchestration-no-op-resubmission.test.ts
 */

import assert from "node:assert";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${name}`);
      console.error(`    ${message}`);
    });
}

console.log("\nOrchestration update_task — No-Op Resubmission (G2)\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    const { createProject, createProjectAgent, createTask, moveTask } =
      await import("@/lib/orchestration/service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const engineMod = await import("@/lib/orchestration/engine/engine");

    type UpdateTaskAction = {
      action: "update_task";
      taskKey: string;
      status?: string;
      assignee?: string;
      comment?: string;
    };
    type RegisterAction = {
      action: "register_artifact";
      taskKey: string;
      uri: string;
      kind?: string;
      sha256?: string;
    };

    const executeUpdateTask = (engineMod as unknown as {
      executeUpdateTask: (
        action: UpdateTaskAction,
        input: { agentId: string; companyId: string; runId: string },
        db: unknown,
      ) => { statusApplied: boolean; statusRejectedReason?: string };
    }).executeUpdateTask;

    const executeRegisterArtifact = (engineMod as unknown as {
      executeRegisterArtifact: (
        action: RegisterAction,
        input: { agentId: string; companyId: string; runId: string },
        db: unknown,
      ) => { taskFound: boolean; kind: string | null };
    }).executeRegisterArtifact;

    const companyId = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";
    const db = getOrchestrationDb() as unknown as {
      prepare: (q: string) => {
        get: (...a: unknown[]) => unknown;
        all: (...a: unknown[]) => unknown;
        run: (...a: unknown[]) => unknown;
      };
    };

    function makeFixture(label: string) {
      const project = createProject({
        companyId,
        name: `NoOp ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
        description: "no-op detection fixture",
        color: "#f97316",
        emoji: "🔁",
        status: "active",
      }).project;

      const builder = createProjectAgent({
        projectId: project.id,
        name: `Builder-${label}-${Math.random().toString(36).slice(2, 4)}`,
        emoji: "🔧",
        role: "Builder",
        personality: "Deterministic",
        openclawAgentId: `builder-${label}-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["build"],
      }).agent;

      const reviewer = createProjectAgent({
        projectId: project.id,
        name: `Reviewer-${label}-${Math.random().toString(36).slice(2, 4)}`,
        emoji: "🛡️",
        role: "Reviewer",
        personality: "Deterministic",
        openclawAgentId: `reviewer-${label}-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["review"],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: `Build with artifact ${label}`,
        description: "x",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: builder.id,
        labels: [],
        createdBy: "g2-test",
      }).task;

      return { project, builder, reviewer, task };
    }

    const sha = (n: string) => n.repeat(64).slice(0, 64);

    await test("rejection event captures rejected_artifact_sha256 when artifact is registered", () => {
      const { project, builder, reviewer, task } = makeFixture("capture-sha");
      executeRegisterArtifact(
        { action: "register_artifact", taskKey: task.key as string, uri: "file:///v1", kind: "html", sha256: sha("a") },
        { agentId: builder.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      // Move task into review (via service so we don't trip the no-op check).
      moveTask({ taskId: task.id, status: "review", actorUserId: "g2-test" });

      // Reviewer rejects via engine action: review → in_progress.
      const reject = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "in-progress", comment: "row counts wrong" },
        { agentId: reviewer.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(reject.statusApplied, true, "rejection must apply");

      const event = db
        .prepare(
          `SELECT metadata_json FROM task_events
           WHERE task_id = ? AND from_status = 'review' AND to_status = 'in_progress'
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(task.id) as { metadata_json: string };
      const metadata = JSON.parse(event.metadata_json) as Record<string, unknown>;
      assert.equal(metadata.rejected_artifact_sha256, sha("a"), "rejected sha must be captured on the rejection event");
    });

    await test("resubmission with same sha is rejected as no_op_resubmission and bumps the noop counter", () => {
      const { project, builder, reviewer, task } = makeFixture("noop-bounce");
      executeRegisterArtifact(
        { action: "register_artifact", taskKey: task.key as string, uri: "file:///v1", kind: "html", sha256: sha("b") },
        { agentId: builder.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      moveTask({ taskId: task.id, status: "review", actorUserId: "g2-test" });
      executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "in-progress", comment: "rejected" },
        { agentId: reviewer.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );

      // Builder resubmits without changing the artifact.
      const resubmit = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "review", comment: "Ready for review (round 2)." },
        { agentId: builder.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(resubmit.statusApplied, false, "no-op resubmission must not apply");
      assert.equal(resubmit.statusRejectedReason, "no_op_resubmission");

      const post = db
        .prepare("SELECT status, consecutive_noop_wakes FROM tasks WHERE id = ?")
        .get(task.id) as { status: string; consecutive_noop_wakes: number | null };
      assert.equal(post.status, "in_progress", "status must remain in_progress");
      assert.equal(post.consecutive_noop_wakes, 1, "noop counter must increment");
    });

    await test("resubmission with a NEW sha (artifact actually changed) is allowed", () => {
      const { project, builder, reviewer, task } = makeFixture("real-fix");
      executeRegisterArtifact(
        { action: "register_artifact", taskKey: task.key as string, uri: "file:///v1", kind: "html", sha256: sha("c") },
        { agentId: builder.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      moveTask({ taskId: task.id, status: "review", actorUserId: "g2-test" });
      executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "in-progress", comment: "rejected" },
        { agentId: reviewer.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );

      // Builder actually fixes the artifact (re-register with different sha).
      executeRegisterArtifact(
        { action: "register_artifact", taskKey: task.key as string, uri: "file:///v2", kind: "html", sha256: sha("d") },
        { agentId: builder.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );

      const resubmit = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "review", comment: "Ready for review (real fix)." },
        { agentId: builder.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(resubmit.statusApplied, true, "real fix with new sha must be allowed");

      const post = db
        .prepare("SELECT status FROM tasks WHERE id = ?")
        .get(task.id) as { status: string };
      assert.equal(post.status, "review");
    });

    await test("tasks without a registered artifact are unaffected (best-effort)", () => {
      const { project, builder, reviewer, task } = makeFixture("no-artifact");
      // Skip register_artifact entirely.
      moveTask({ taskId: task.id, status: "review", actorUserId: "g2-test" });
      executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "in-progress", comment: "rejected" },
        { agentId: reviewer.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      const resubmit = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "review", comment: "Ready (no artifact registered)." },
        { agentId: builder.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(resubmit.statusApplied, true, "without artifact_sha256, no-op detection must NOT fire");
    });

    const total = passed + failed;
    console.log(`\nResult: ${passed}/${total} passed`);
    if (failed > 0) process.exitCode = 1;
  } catch (err) {
    console.error("Test harness crashed:", err);
    process.exitCode = 1;
  }
}

run();
