/**
 * G5 backend — register_artifact mc-action + tasks.artifact_* columns.
 *
 * Phase G of orchestration-integrity lane. Trigger: WEA-282 / WEA-284 — Tim
 * never knew the HTML report existed because the orchestration had no
 * delivery channel; the file was written to disk and the only pointer was a
 * comment body. This phase adds first-class artifact registration on the
 * task itself so the UI can render it inline (next phase) and so G2's no-op
 * detection has a content hash to compare across rework cycles.
 *
 * Migration v48 adds: artifact_uri, artifact_kind, artifact_registered_at,
 * artifact_sha256.
 *
 * Run:
 *   ORCHESTRATION_DB_PATH=/tmp/orchestration-register-artifact.db \
 *     npx tsx src/lib/__tests__/orchestration-register-artifact.test.ts
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

console.log("\nOrchestration register_artifact + migration v48 (G5 backend)\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    const { createProject, createProjectAgent, createTask } =
      await import("@/lib/orchestration/service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const engineMod = await import("@/lib/orchestration/engine/engine");

    type RegisterAction = {
      action: "register_artifact";
      taskKey: string;
      uri: string;
      kind?: string;
      sha256?: string;
    };
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
        name: `Artifact ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
        description: "artifact fixture",
        color: "#8b5cf6",
        emoji: "📦",
        status: "active",
      }).project;
      const agent = createProjectAgent({
        projectId: project.id,
        name: `Builder-${label}-${Math.random().toString(36).slice(2, 4)}`,
        emoji: "🔧",
        role: "Builder",
        personality: "Deterministic",
        openclawAgentId: `builder-${label}-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["build"],
      }).agent;
      const task = createTask({
        projectId: project.id,
        title: `Artifact fixture ${label}`,
        description: "x",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: agent.id,
        labels: [],
        createdBy: "g5-test",
      }).task;
      return { project, agent, task };
    }

    await test("migration v48 added artifact columns to tasks table", () => {
      const cols = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
      const names = new Set(cols.map((c) => c.name));
      for (const expected of ["artifact_uri", "artifact_kind", "artifact_registered_at", "artifact_sha256"]) {
        assert.ok(names.has(expected), `missing column: ${expected}`);
      }
    });

    await test("register_artifact persists uri/kind/sha and emits a task.artifact_registered event", () => {
      const { project, agent, task } = makeFixture("happy");
      const sha = "a".repeat(64);
      const result = executeRegisterArtifact(
        {
          action: "register_artifact",
          taskKey: task.key as string,
          uri: "file:///tmp/exposure_pnl_report.html",
          kind: "html",
          sha256: sha,
        },
        { agentId: agent.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(result.taskFound, true);
      assert.equal(result.kind, "html");

      const stored = db
        .prepare(
          "SELECT artifact_uri, artifact_kind, artifact_registered_at, artifact_sha256 FROM tasks WHERE id = ?",
        )
        .get(task.id) as {
          artifact_uri: string;
          artifact_kind: string;
          artifact_registered_at: string;
          artifact_sha256: string;
        };
      assert.equal(stored.artifact_uri, "file:///tmp/exposure_pnl_report.html");
      assert.equal(stored.artifact_kind, "html");
      assert.ok(stored.artifact_registered_at);
      assert.equal(stored.artifact_sha256, sha);

      const events = db
        .prepare("SELECT COUNT(*) AS n FROM task_events WHERE task_id = ? AND event_type = 'task.artifact_registered'")
        .get(task.id) as { n: number };
      assert.equal(events.n, 1);
    });

    await test("unknown kind defaults to 'file'; invalid sha256 stored as null with shaInvalid flag", () => {
      const { project, agent, task } = makeFixture("kind-fallback");
      const result = executeRegisterArtifact(
        {
          action: "register_artifact",
          taskKey: task.key as string,
          uri: "file:///tmp/something.bin",
          kind: "exotic",
          sha256: "not-a-real-sha",
        },
        { agentId: agent.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(result.kind, "file");

      const stored = db
        .prepare("SELECT artifact_kind, artifact_sha256 FROM tasks WHERE id = ?")
        .get(task.id) as { artifact_kind: string; artifact_sha256: string | null };
      assert.equal(stored.artifact_kind, "file");
      assert.equal(stored.artifact_sha256, null, "invalid sha must be stored as null");

      const evt = db
        .prepare(
          "SELECT metadata_json FROM task_events WHERE task_id = ? AND event_type = 'task.artifact_registered' LIMIT 1",
        )
        .get(task.id) as { metadata_json: string };
      const metadata = JSON.parse(evt.metadata_json) as Record<string, unknown>;
      assert.equal(metadata.shaInvalid, true);
    });

    await test("re-registering on the same task overwrites previous artifact fields", () => {
      const { project, agent, task } = makeFixture("overwrite");
      const sha1 = "1".repeat(64);
      executeRegisterArtifact(
        { action: "register_artifact", taskKey: task.key as string, uri: "file:///v1", kind: "html", sha256: sha1 },
        { agentId: agent.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      const sha2 = "2".repeat(64);
      executeRegisterArtifact(
        { action: "register_artifact", taskKey: task.key as string, uri: "file:///v2", kind: "html", sha256: sha2 },
        { agentId: agent.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      const stored = db
        .prepare("SELECT artifact_uri, artifact_sha256 FROM tasks WHERE id = ?")
        .get(task.id) as { artifact_uri: string; artifact_sha256: string };
      assert.equal(stored.artifact_uri, "file:///v2");
      assert.equal(stored.artifact_sha256, sha2);
      const events = db
        .prepare("SELECT COUNT(*) AS n FROM task_events WHERE task_id = ? AND event_type = 'task.artifact_registered'")
        .get(task.id) as { n: number };
      assert.equal(events.n, 2, "each register emits its own event for audit");
    });

    await test("unknown task_key returns taskFound=false without writing", () => {
      const { project, agent } = makeFixture("missing-task");
      const result = executeRegisterArtifact(
        { action: "register_artifact", taskKey: "WEA-DOES-NOT-EXIST", uri: "file:///x", kind: "html" },
        { agentId: agent.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(result.taskFound, false);
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
