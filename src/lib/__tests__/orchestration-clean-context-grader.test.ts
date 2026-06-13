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

    // ── H2.2 — artifact-carrying work cannot close itself via direct done ──

    // A second real agent so review handoff has an eligible reviewer and the
    // verdict/FAIL cases can act under a valid agent FK (graderAgentId above
    // is predicate-only and never inserted).
    const reviewerAgentId = randomUUID();
    {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO agents
          (id, company_id, project_id, name, slug, runtime_slug, emoji, role, personality,
           status, adapter_type, skills_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        reviewerAgentId,
        project.companyId,
        project.id,
        `reviewer-${reviewerAgentId.slice(0, 6)}`,
        `reviewer-${reviewerAgentId.slice(0, 6)}`,
        `reviewer-${reviewerAgentId.slice(0, 6)}`,
        "🧪",
        "QA Reviewer",
        "Deterministic",
        "idle",
        "codex",
        JSON.stringify(["qa"]),
        now,
        now,
      );
    }

    await test("H2.2: direct in_progress→done with a registered artifact converts to review and routes handoff", () => {
      const task = createBasicFixtureTask(createTask, {
        projectId: project.id,
        title: "H2.2 direct done holds",
        description: "## Acceptance Criteria\n- renders",
        status: "in-progress",
        assignee: makerAgentId,
        createdBy: "h2-test",
      });
      executeRegisterArtifact(
        { action: "register_artifact", taskKey: task.key as string, uri: "output/h22.html", kind: "html", sha256: "12".repeat(32) },
        { agentId: makerAgentId, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      const result = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "done", comment: "Finished and registered." },
        { agentId: makerAgentId, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(result.statusApplied, true, result.statusRejectedReason);
      const row = db.prepare("SELECT status, completed_at FROM tasks WHERE id = ?").get(task.id) as {
        status: string;
        completed_at: string | null;
      };
      assert.equal(row.status, "review", "artifact-carrying direct done must route to review for the grader");
      assert.equal(row.completed_at, null, "no terminal completion while the grader gate holds");
      const wake = db
        .prepare(
          `SELECT COUNT(*) AS n FROM agent_wakeup_requests
           WHERE reason = 'engine_default_review_handoff'
             AND json_extract(payload_json, '$.taskId') = ?`,
        )
        .get(task.id) as { n: number };
      assert.ok(wake.n >= 1, "review handoff wake must be queued for the grader to claim");
    });

    await test("H2.2: direct done without an artifact closes as before", () => {
      const task = createBasicFixtureTask(createTask, {
        projectId: project.id,
        title: "H2.2 no artifact closes",
        description: "x",
        status: "in-progress",
        assignee: makerAgentId,
        createdBy: "h2-test",
      });
      const result = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "done", comment: "Done, nothing to grade." },
        { agentId: makerAgentId, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(result.statusApplied, true, result.statusRejectedReason);
      const row = db.prepare("SELECT status FROM tasks WHERE id = ?").get(task.id) as { status: string };
      assert.equal(row.status, "done", "artifact-free tasks keep the direct done path");
    });

    await test("H2.2: opt-out label and kill switch keep the direct done path", () => {
      const optOut = createBasicFixtureTask(createTask, {
        projectId: project.id,
        title: "H2.2 opt-out closes",
        description: "x",
        status: "in-progress",
        assignee: makerAgentId,
        createdBy: "h2-test",
      });
      db.prepare(`UPDATE tasks SET labels_json = '["review-not-required"]' WHERE id = ?`).run(optOut.id);
      executeRegisterArtifact(
        { action: "register_artifact", taskKey: optOut.key as string, uri: "output/h22-optout.html", kind: "html", sha256: "34".repeat(32) },
        { agentId: makerAgentId, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      const optOutResult = executeUpdateTask(
        { action: "update_task", taskKey: optOut.key as string, status: "done", comment: "Done." },
        { agentId: makerAgentId, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(optOutResult.statusApplied, true, optOutResult.statusRejectedReason);
      assert.equal(
        (db.prepare("SELECT status FROM tasks WHERE id = ?").get(optOut.id) as { status: string }).status,
        "done",
        "explicit opt-out label keeps direct done",
      );

      const killSwitch = createBasicFixtureTask(createTask, {
        projectId: project.id,
        title: "H2.2 kill switch closes",
        description: "x",
        status: "in-progress",
        assignee: makerAgentId,
        createdBy: "h2-test",
      });
      executeRegisterArtifact(
        { action: "register_artifact", taskKey: killSwitch.key as string, uri: "output/h22-off.html", kind: "html", sha256: "56".repeat(32) },
        { agentId: makerAgentId, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      process.env.HIVERUNNER_CLEAN_CONTEXT_GRADER = "0";
      try {
        const killResult = executeUpdateTask(
          { action: "update_task", taskKey: killSwitch.key as string, status: "done", comment: "Done." },
          { agentId: makerAgentId, companyId: project.companyId, runId: randomUUID() },
          db,
        );
        assert.equal(killResult.statusApplied, true, killResult.statusRejectedReason);
      } finally {
        delete process.env.HIVERUNNER_CLEAN_CONTEXT_GRADER;
      }
      assert.equal(
        (db.prepare("SELECT status FROM tasks WHERE id = ?").get(killSwitch.id) as { status: string }).status,
        "done",
        "kill switch disables the direct-done gate together with the grader",
      );
    });

    await test("H2.2: review→done (the grader's verdict path) is exempt — REGRESSION-CRITICAL", () => {
      const task = createBasicFixtureTask(createTask, {
        projectId: project.id,
        title: "H2.2 verdict close exempt",
        description: "x",
        status: "in-progress",
        assignee: makerAgentId,
        createdBy: "h2-test",
      });
      executeRegisterArtifact(
        { action: "register_artifact", taskKey: task.key as string, uri: "output/h22-verdict.html", kind: "html", sha256: "78".repeat(32) },
        { agentId: makerAgentId, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      db.prepare("UPDATE tasks SET status = 'review' WHERE id = ?").run(task.id);
      const result = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "done", comment: "## Clean-Context Review — PASS\n\nCriteria: 1/1 satisfied" },
        { agentId: reviewerAgentId, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(result.statusApplied, true, result.statusRejectedReason);
      const row = db.prepare("SELECT status, completed_at FROM tasks WHERE id = ?").get(task.id) as {
        status: string;
        completed_at: string | null;
      };
      assert.equal(row.status, "done", "a verdict closing review→done must not be re-held");
      assert.ok(row.completed_at, "an engine done-transition must stamp completed_at (grader closes were leaving it NULL)");
    });

    await test("H2.2: duplicate done on an already-done task stays rejected (no reopen into review)", () => {
      const task = createBasicFixtureTask(createTask, {
        projectId: project.id,
        title: "H2.2 duplicate done no reopen",
        description: "x",
        status: "in-progress",
        assignee: makerAgentId,
        createdBy: "h2-test",
      });
      executeRegisterArtifact(
        { action: "register_artifact", taskKey: task.key as string, uri: "output/h22-dup.html", kind: "html", sha256: "bc".repeat(32) },
        { agentId: makerAgentId, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(task.id);
      // A retried/replayed done action must keep its already_at_status
      // rejection — done→review is a legal transition the conversion must
      // not trigger, or stale retries would reopen closed work.
      const result = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "done", comment: "Done (retry)." },
        { agentId: makerAgentId, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(result.statusApplied, false, "duplicate done must not apply");
      assert.equal(result.statusRejectedReason, "already_at_status");
      assert.equal(
        (db.prepare("SELECT status FROM tasks WHERE id = ?").get(task.id) as { status: string }).status,
        "done",
        "the task stays closed",
      );
    });

    await test("H2.2: direct done after a FAIL with an unchanged sha is rejected as no-op; a new sha re-enters review", () => {
      const task = createBasicFixtureTask(createTask, {
        projectId: project.id,
        title: "H2.2 post-FAIL resubmit",
        description: "x",
        status: "in-progress",
        assignee: makerAgentId,
        createdBy: "h2-test",
      });
      const staleSha = "9a".repeat(32);
      executeRegisterArtifact(
        { action: "register_artifact", taskKey: task.key as string, uri: "output/h22-fail.html", kind: "html", sha256: staleSha },
        { agentId: makerAgentId, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      // Simulate the grader FAIL arc: task sits in review, the grader sends it
      // back to in_progress — applyStatusTransition stamps the rejected sha.
      db.prepare("UPDATE tasks SET status = 'review' WHERE id = ?").run(task.id);
      const failVerdict = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "in_progress", comment: "## Clean-Context Review — FAIL\n\nGaps:\n1. missing total" },
        { agentId: reviewerAgentId, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(failVerdict.statusApplied, true, failVerdict.statusRejectedReason);

      const noOp = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "done", comment: "Done (unchanged)." },
        { agentId: makerAgentId, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(noOp.statusApplied, false, "unchanged artifact must not re-enter review");
      assert.equal(noOp.statusRejectedReason, "no_op_resubmission");

      executeRegisterArtifact(
        { action: "register_artifact", taskKey: task.key as string, uri: "output/h22-fail.html", kind: "html", sha256: "9b".repeat(32) },
        { agentId: makerAgentId, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      const reworked = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "done", comment: "Reworked with the missing total." },
        { agentId: makerAgentId, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(reworked.statusApplied, true, reworked.statusRejectedReason);
      assert.equal(
        (db.prepare("SELECT status FROM tasks WHERE id = ?").get(task.id) as { status: string }).status,
        "review",
        "a changed artifact re-enters review for a fresh grader pass",
      );
    });

    await test("H2.2: qa-typed createTask carries the review-intent label past the type downcast", () => {
      const created = createTask({
        projectId: project.id,
        title: "H2.2 qa type materializes label",
        description: "x",
        priority: "P2",
        type: "qa",
        status: "to-do",
        labels: [],
        createdBy: "h2-test",
      }).task;
      const row = db.prepare("SELECT type, labels_json FROM tasks WHERE id = ?").get(created.id) as {
        type: string;
        labels_json: string;
      };
      assert.equal(row.type, "research", "DB type still downcasts (legacy vocabulary)");
      assert.ok(JSON.parse(row.labels_json).includes("qa-required"), "review intent survives as a handoff label");
      assert.equal(
        taskRequiresAutonomousReviewHandoff({ title: created.title, type: row.type, labels_json: row.labels_json, artifact_uri: null }),
        true,
        "the materialized row now requires review handoff despite the downcast",
      );
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error("Test harness error:", error);
    process.exit(1);
  }
}

void run();
