/**
 * H2 — Clean-context grader (maker ≠ grader, structurally).
 *
 * Covers the claim-time resolver (eligibility: review wake + registered G5
 * artifact + live review status + no self-grading), the synthetic route
 * attempt (anthropic / claude-haiku-4-5 by default, env-overridable), and the
 * clean-context prompt (artifact + acceptance criteria in; task thread OUT —
 * the sentinel-comment assertion is the regression tripwire for context
 * contamination).
 *
 * Run:
 *   ORCHESTRATION_DB_PATH=/tmp/orchestration-clean-context-grader.db \
 *     node ./scripts/run-ts-test.mjs src/lib/__tests__/orchestration-clean-context-grader.test.ts
 */

import assert from "node:assert";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  createBasicFixtureTask,
  createFixtureProject,
} from "@/lib/__tests__/helpers/orchestration-create-task-fixtures";

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

console.log("\nOrchestration clean-context grader (H2)\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    const { createProject, createTask } = await import("@/lib/orchestration/service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const {
      DEFAULT_GRADER_MODEL,
      buildCleanContextGraderPrompt,
      graderRouteAttempt,
      parseAcceptanceCriteria,
      resolveCleanContextGraderRun,
    } = await import("@/lib/orchestration/engine/grader");
    const { taskRequiresAutonomousReviewHandoff } = await import("@/lib/orchestration/engine/review-handler");
    const engineMod = await import("@/lib/orchestration/engine/engine");
    const executeUpdateTask = (engineMod as unknown as {
      executeUpdateTask: (
        action: { action: "update_task"; taskKey: string; status?: string; comment?: string },
        input: { agentId: string; companyId: string; runId: string },
        db: unknown,
      ) => { statusApplied: boolean; statusRejectedReason?: string };
    }).executeUpdateTask;
    const executeRegisterArtifact = (engineMod as unknown as {
      executeRegisterArtifact: (
        action: { action: "register_artifact"; taskKey: string; uri: string; kind?: string; sha256?: string },
        input: { agentId: string; companyId: string; runId: string },
        db: unknown,
      ) => { taskFound: boolean },
    }).executeRegisterArtifact;

    const db = getOrchestrationDb();
    const project = createFixtureProject(createProject, {
      namePrefix: "Grader",
      label: "H2",
      description: "Clean-context grader fixtures",
      color: "#8b5cf6",
      emoji: "🧪",
    });
    const graderAgentId = randomUUID();
    const makerAgentId = randomUUID();
    {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO agents
          (id, company_id, project_id, name, slug, runtime_slug, emoji, role, personality,
           status, adapter_type, skills_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        makerAgentId,
        project.companyId,
        project.id,
        `maker-${makerAgentId.slice(0, 6)}`,
        `maker-${makerAgentId.slice(0, 6)}`,
        `maker-${makerAgentId.slice(0, 6)}`,
        "🔧",
        "Builder",
        "Deterministic",
        "idle",
        "codex",
        JSON.stringify(["build"]),
        now,
        now,
      );
    }

    const DESCRIPTION = [
      "Build the export feature.",
      "",
      "## Acceptance Criteria",
      "- Exports render as valid HTML",
      "- Report includes all 16 cities",
      "3. Totals match the ledger",
      "",
      "## Notes",
      "Anything below the section must not parse as criteria.",
    ].join("\n");

    function makeReviewTask(input: { artifact?: boolean; status?: string } = {}) {
      const task = createBasicFixtureTask(createTask, {
        projectId: project.id,
        title: "Export report",
        description: DESCRIPTION,
        status: "in-progress",
        assignee: makerAgentId,
        createdBy: "h2-test",
      });
      const now = new Date().toISOString();
      db.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(input.status ?? "review", task.id);
      if (input.artifact !== false) {
        db.prepare(
          `UPDATE tasks
             SET artifact_uri = ?, artifact_kind = 'html', artifact_sha256 = ?, artifact_registered_at = ?
           WHERE id = ?`,
        ).run("file:///tmp/fixture-report.html", "a".repeat(64), now, task.id);
      }
      const row = db
        .prepare("SELECT id, task_key FROM tasks WHERE id = ? LIMIT 1")
        .get(task.id) as { id: string; task_key: string | null };
      return row;
    }

    function reviewWakeSnapshot(reason = "sweep_review_to_assignee"): Record<string, unknown> {
      return { wakeReason: reason, taskStatus: "review" };
    }

    await test("eligible review wake resolves to a grader run on the default cheap lane", () => {
      const task = makeReviewTask();
      const grader = resolveCleanContextGraderRun({
        db,
        taskKey: task.id,
        agentId: graderAgentId,
        contextSnapshot: reviewWakeSnapshot(),
      });
      assert.ok(grader, "expected a grader run");
      assert.equal(grader.attempt.target.runtimeProvider, "anthropic");
      assert.equal(grader.attempt.target.model, DEFAULT_GRADER_MODEL);
      assert.equal(grader.task.id, task.id);
    });

    await test("task_key reference resolves the same as id", () => {
      const task = makeReviewTask();
      assert.ok(task.task_key, "fixture task should have a key");
      const grader = resolveCleanContextGraderRun({
        db,
        taskKey: task.task_key as string,
        agentId: graderAgentId,
        contextSnapshot: reviewWakeSnapshot("engine_default_review_handoff"),
      });
      assert.ok(grader);
      assert.equal(grader.task.id, task.id);
    });

    await test("no registered artifact → normal review (null)", () => {
      const task = makeReviewTask({ artifact: false });
      const grader = resolveCleanContextGraderRun({
        db,
        taskKey: task.id,
        agentId: graderAgentId,
        contextSnapshot: reviewWakeSnapshot(),
      });
      assert.equal(grader, null);
    });

    await test("non-review wake reason (operator comment) → null", () => {
      const task = makeReviewTask();
      const grader = resolveCleanContextGraderRun({
        db,
        taskKey: task.id,
        agentId: graderAgentId,
        contextSnapshot: reviewWakeSnapshot("mission_control_comment"),
      });
      assert.equal(grader, null);
    });

    await test("task no longer in review at claim time → null", () => {
      const task = makeReviewTask({ status: "in_progress" });
      const grader = resolveCleanContextGraderRun({
        db,
        taskKey: task.id,
        agentId: graderAgentId,
        contextSnapshot: reviewWakeSnapshot(),
      });
      assert.equal(grader, null);
    });

    await test("woken agent is the review submission author → null (no self-grading)", () => {
      const task = makeReviewTask();
      const submittedAt = new Date(Date.now() - 60_000).toISOString();
      const commentAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 'task.status_changed', 'in_progress', 'review', '{}', ?)`,
      ).run(randomUUID(), project.id, task.id, makerAgentId, submittedAt);
      db.prepare(
        `INSERT INTO comments (id, task_id, author_agent_id, body, type, source, created_at, updated_at)
         VALUES (?, ?, ?, 'Ready for review: export report attached.', 'comment', 'agent', ?, ?)`,
      ).run(randomUUID(), task.id, makerAgentId, commentAt, commentAt);

      const asMaker = resolveCleanContextGraderRun({
        db,
        taskKey: task.id,
        agentId: makerAgentId,
        contextSnapshot: reviewWakeSnapshot(),
      });
      assert.equal(asMaker, null, "maker must not grade their own submission");

      const asReviewer = resolveCleanContextGraderRun({
        db,
        taskKey: task.id,
        agentId: graderAgentId,
        contextSnapshot: reviewWakeSnapshot(),
      });
      assert.ok(asReviewer, "a different agent still grades");
    });

    await test("kill switch and model override env vars are honored", () => {
      const task = makeReviewTask();
      process.env.HIVERUNNER_CLEAN_CONTEXT_GRADER = "0";
      try {
        assert.equal(
          resolveCleanContextGraderRun({
            db,
            taskKey: task.id,
            agentId: graderAgentId,
            contextSnapshot: reviewWakeSnapshot(),
          }),
          null,
        );
      } finally {
        delete process.env.HIVERUNNER_CLEAN_CONTEXT_GRADER;
      }

      process.env.HIVERUNNER_GRADER_MODEL = "claude-sonnet-4-6";
      try {
        assert.equal(graderRouteAttempt().target.model, "claude-sonnet-4-6");
      } finally {
        delete process.env.HIVERUNNER_GRADER_MODEL;
      }
      assert.equal(graderRouteAttempt().target.model, DEFAULT_GRADER_MODEL);
    });

    await test("route attempt is not agent_profile-sourced (adapter must honor the model)", () => {
      const attempt = graderRouteAttempt();
      const source = attempt.target.source as Record<string, unknown>;
      assert.notEqual(source.modelSourceId, "agent_profile");
      assert.equal(attempt.fallbackUsed, false);
    });

    await test("parseAcceptanceCriteria: bullets + numbered, stops at next heading", () => {
      const criteria = parseAcceptanceCriteria(DESCRIPTION);
      assert.deepEqual(criteria, [
        "Exports render as valid HTML",
        "Report includes all 16 cities",
        "Totals match the ledger",
      ]);
      assert.deepEqual(parseAcceptanceCriteria("no section here"), []);
    });

    await test("prompt contains artifact + criteria; excludes the task thread", () => {
      const task = makeReviewTask();
      const SENTINEL = `THREAD-SENTINEL-${randomUUID()}`;
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO comments (id, task_id, author_agent_id, body, type, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'comment', 'agent', ?, ?)`,
      ).run(randomUUID(), task.id, makerAgentId, `Maker reasoning: ${SENTINEL}`, now, now);

      const grader = resolveCleanContextGraderRun({
        db,
        taskKey: task.id,
        agentId: graderAgentId,
        contextSnapshot: reviewWakeSnapshot(),
      });
      assert.ok(grader);
      const prompt = buildCleanContextGraderPrompt({ agent: { name: "Gator" }, task: grader.task });

      assert.ok(prompt.includes("/tmp/fixture-report.html"), "artifact path (file:// resolved) present");
      assert.ok(prompt.includes("aaaaaaaaaaaa"), "sha prefix present");
      assert.ok(prompt.includes("Exports render as valid HTML"), "criteria present");
      assert.ok(prompt.includes(`"taskKey":"${grader.task.task_key ?? grader.task.id}"`), "task key in verdict templates");
      assert.ok(prompt.includes('"status":"done"'), "PASS template present");
      assert.ok(prompt.includes('"status":"in_progress"'), "FAIL template present");
      assert.ok(!prompt.includes(SENTINEL), "task-thread content must NOT leak into the grader prompt");
      assert.ok(!prompt.includes("## Notes"), "non-criteria description sections stay out when criteria exist");
    });

    await test("prompt falls back to description when no criteria section exists", () => {
      const task = createBasicFixtureTask(createTask, {
        projectId: project.id,
        title: "No criteria task",
        description: "Just ship the thing with quality.",
        status: "in-progress",
        assignee: makerAgentId,
        createdBy: "h2-test",
      });
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE tasks SET status = 'review', artifact_uri = 'output/report.html', artifact_kind = 'html', artifact_registered_at = ? WHERE id = ?`,
      ).run(now, task.id);
      const grader = resolveCleanContextGraderRun({
        db,
        taskKey: task.id,
        agentId: graderAgentId,
        contextSnapshot: reviewWakeSnapshot("sweep_review_to_ceo"),
      });
      assert.ok(grader, "artifact without sha is still eligible");
      const prompt = buildCleanContextGraderPrompt({ agent: { name: "Gator" }, task: grader.task });
      assert.ok(prompt.includes("Just ship the thing with quality."), "description fallback present");
      assert.ok(prompt.includes("not recorded"), "missing sha labeled");
      assert.ok(prompt.includes("output/report.html"), "relative artifact path passed through");
    });

    // ── H2.1 — a registered artifact gates the ungated review→done conversion ──

    await test("H2.1 predicate: registered artifact requires review handoff; opt-outs still win", () => {
      const base = { title: "t", type: "feature", labels_json: null as string | null };
      assert.equal(taskRequiresAutonomousReviewHandoff({ ...base, artifact_uri: "output/r.html" }), true, "artifact gates by default");
      assert.equal(taskRequiresAutonomousReviewHandoff({ ...base, artifact_uri: null }), false, "no artifact, no gate");
      assert.equal(taskRequiresAutonomousReviewHandoff({ ...base, artifact_uri: "   " }), false, "blank artifact uri is not a gate");
      assert.equal(
        taskRequiresAutonomousReviewHandoff({ ...base, labels_json: '["review-not-required"]', artifact_uri: "output/r.html" }),
        false,
        "explicit opt-out label beats the artifact gate",
      );
      process.env.HIVERUNNER_CLEAN_CONTEXT_GRADER = "0";
      try {
        assert.equal(
          taskRequiresAutonomousReviewHandoff({ ...base, artifact_uri: "output/r.html" }),
          false,
          "kill switch disables the artifact gate together with the grader",
        );
      } finally {
        delete process.env.HIVERUNNER_CLEAN_CONTEXT_GRADER;
      }
    });

    await test("H2.1: ungated submission with a registered artifact stays in review for the grader", () => {
      const task = createBasicFixtureTask(createTask, {
        projectId: project.id,
        title: "H2.1 artifact holds review",
        description: "## Acceptance Criteria\n- renders",
        status: "in-progress",
        assignee: makerAgentId,
        createdBy: "h2-test",
      });
      executeRegisterArtifact(
        { action: "register_artifact", taskKey: task.key as string, uri: "output/h21.html", kind: "html", sha256: "ab".repeat(32) },
        { agentId: makerAgentId, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      const result = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "review", comment: "Ready for review." },
        { agentId: makerAgentId, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(result.statusApplied, true, result.statusRejectedReason);
      const row = db.prepare("SELECT status, completed_at FROM tasks WHERE id = ?").get(task.id) as {
        status: string;
        completed_at: string | null;
      };
      assert.equal(row.status, "review", "artifact-registered submission must hold in review, not auto-convert to done");
      assert.equal(row.completed_at, null, "no terminal completion while the grader gate holds");
    });

    await test("H2.1: kill switch restores the ungated conversion (no stranding in review)", () => {
      const task = createBasicFixtureTask(createTask, {
        projectId: project.id,
        title: "H2.1 kill switch converts",
        description: "x",
        status: "in-progress",
        assignee: makerAgentId,
        createdBy: "h2-test",
      });
      executeRegisterArtifact(
        { action: "register_artifact", taskKey: task.key as string, uri: "output/h21-off.html", kind: "html", sha256: "cd".repeat(32) },
        { agentId: makerAgentId, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      process.env.HIVERUNNER_CLEAN_CONTEXT_GRADER = "0";
      try {
        const result = executeUpdateTask(
          { action: "update_task", taskKey: task.key as string, status: "review", comment: "Ready." },
          { agentId: makerAgentId, companyId: project.companyId, runId: randomUUID() },
          db,
        );
        assert.equal(result.statusApplied, true, result.statusRejectedReason);
      } finally {
        delete process.env.HIVERUNNER_CLEAN_CONTEXT_GRADER;
      }
      const row = db.prepare("SELECT status, completed_at FROM tasks WHERE id = ?").get(task.id) as {
        status: string;
        completed_at: string | null;
      };
      assert.equal(row.status, "done", "with the grader disabled, ungated review requests convert to done as before");
      assert.ok(row.completed_at, "conversion terminally completes the task");
    });

    await test("H2.1: review-not-required label converts to done even with a registered artifact", () => {
      const task = createBasicFixtureTask(createTask, {
        projectId: project.id,
        title: "H2.1 opt-out label converts",
        description: "x",
        status: "in-progress",
        assignee: makerAgentId,
        createdBy: "h2-test",
      });
      db.prepare(`UPDATE tasks SET labels_json = '["review-not-required"]' WHERE id = ?`).run(task.id);
      executeRegisterArtifact(
        { action: "register_artifact", taskKey: task.key as string, uri: "output/h21-optout.html", kind: "html", sha256: "ef".repeat(32) },
        { agentId: makerAgentId, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      const result = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "review", comment: "Ready." },
        { agentId: makerAgentId, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(result.statusApplied, true, result.statusRejectedReason);
      const row = db.prepare("SELECT status FROM tasks WHERE id = ?").get(task.id) as { status: string };
      assert.equal(row.status, "done", "explicit operator opt-out keeps the direct-to-done path");
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error("Test harness error:", error);
    process.exit(1);
  }
}

void run();
