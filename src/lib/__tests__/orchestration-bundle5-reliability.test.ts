/**
 * Bundle 5 operational reliability contract tests.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-bundle5-reliability.db \
 *   npx tsx src/lib/__tests__/orchestration-bundle5-reliability.test.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { formatRelativeTime } from "@/lib/format-relative-time";
import { compactAgentModelLabel, modelProviderColors, resolveAgentModelDisplay } from "@/lib/orchestration/agent-model-display";
import { getAgentLiveState } from "@/lib/orchestration/agent-live-state";
import { getOperationalStatusTag } from "@/lib/orchestration/comment-visibility";
import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb, runOrchestrationMigrations } from "@/lib/orchestration/db";
import { __testHooks as engineTestHooks, adapterActionTexts, executeUpdateTask, importAssistantTextAndExecuteActions } from "@/lib/orchestration/engine/engine";
import { sweepOpenTasks } from "@/lib/orchestration/engine/sweeper";
import { createApproval, updateApprovalStatus } from "@/lib/orchestration/service/approval";
import { createProject, createProjectAgent, createTask } from "@/lib/orchestration/service";
import { listTasks } from "@/lib/orchestration/service/task";

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
      if (error instanceof Error && error.stack) console.error(error.stack.split("\n").slice(1, 4).join("\n"));
    });
}

function actionBlock(action: Record<string, unknown>): string {
  return ["```mc-action", JSON.stringify(action), "```"].join("\n");
}

async function run() {
  console.log("\nBundle 5 Operational Reliability Tests\n");
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const db = getOrchestrationDb();
  const suffix = Date.now();
  const company = createCompany({
    name: `Bundle 5 Reliability ${suffix}`,
    description: "Bundle 5 fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `Bundle 5 Project ${suffix}`,
    description: "Bundle 5 fixture project",
    color: "#22c55e",
    emoji: "icon:activity",
    status: "active",
  }).project;
  const agent = createProjectAgent({
    projectId: project.id,
    name: `Mannie ${suffix}`,
    emoji: "icon:bot",
    role: "Implementation Engineer",
    personality: "Deterministic fixture",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;

  await test("migration bootstrap marks v70 applied when runner identity columns already exist", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "orchestration-v70-out-of-band-"));
    const dbPath = path.join(dir, "orchestration.db");
    const legacyDb = new Database(dbPath);
    try {
      runOrchestrationMigrations(legacyDb);
      legacyDb.prepare("DELETE FROM schema_migrations WHERE version = 70").run();

      const before = legacyDb
        .prepare("SELECT name FROM pragma_table_info('execution_runs') WHERE name IN ('execution_engine', 'runner_provider', 'runner_model') ORDER BY name")
        .all() as Array<{ name: string }>;
      assert.deepEqual(before.map((row) => row.name), ["execution_engine", "runner_model", "runner_provider"]);

      assert.doesNotThrow(() => runOrchestrationMigrations(legacyDb));
      const applied = legacyDb
        .prepare("SELECT name FROM schema_migrations WHERE version = 70")
        .get() as { name: string } | undefined;
      assert.equal(applied?.name, "execution_runs_add_runner_identity");
    } finally {
      legacyDb.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function malformedActionBlock(jsonLike: string): string {
    return ["```mc-action", jsonLike, "```"].join("\n");
  }

  function insertHeartbeatRun(runId: string, task?: { id: string; key: string }) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO heartbeat_runs
        (id, agent_id, company_id, invocation_source, trigger_detail, status, result_json, context_snapshot_json, started_at, created_at, updated_at)
       VALUES (?, ?, ?, 'wakeup_request', 'bundle-7 parse-drop test', 'running', '{}', ?, ?, ?, ?)`,
    ).run(
      runId,
      agent.id,
      company.id,
      JSON.stringify(task ? { taskId: task.id, taskKey: task.key } : {}),
      now,
      now,
      now,
    );
  }

  await test("approval decisions cascade to linked blocked tasks", () => {
    const task = createTask({
      projectId: project.id,
      title: "Approval-gated task",
      description: "Waits for an approval.",
      priority: "P1",
      type: "feature",
      status: "blocked",
      assignee: agent.id,
      labels: ["bundle-5"],
      blockedReason: "Approval pending",
      createdBy: "bundle-5-test",
    }).task;
    const approval = createApproval({
      companyIdOrSlug: company.id,
      type: "protected_runtime_command",
      requestedByAgentId: agent.id,
      approverAgentId: agent.id,
      linkedTaskId: task.id,
      payload: { command: "protected command", fingerprint: `bundle-5-${suffix}` },
      db,
    }).approval;
    db.prepare("UPDATE tasks SET blocked_reason = ? WHERE id = ?").run(`Waiting on approval ${approval.id}`, task.id);

    updateApprovalStatus({
      approvalId: approval.id,
      status: "cancelled",
      decidedByUserId: "bundle-5-test",
      decisionNote: "Synthetic cancellation",
    });

    const row = db.prepare("SELECT status, blocked_reason FROM tasks WHERE id = ?").get(task.id) as { status: string; blocked_reason: string | null };
    assert.equal(row.status, "backlog");
    assert.equal(row.blocked_reason, null);
    const comment = db.prepare("SELECT body FROM comments WHERE task_id = ? AND body LIKE '[APPROVAL_UNBLOCKED]%' ORDER BY created_at DESC LIMIT 1").get(task.id) as { body: string } | undefined;
    assert.match(comment?.body ?? "", /Required approval was cancelled/);
  });

  await test("resolved orphan approval cascades by blocked_reason reference", async () => {
    const task = createTask({
      projectId: project.id,
      title: "Orphan approval blocked task",
      description: "References an approval id in blocked_reason only.",
      priority: "P1",
      type: "feature",
      status: "blocked",
      assignee: agent.id,
      labels: ["bundle-5"],
      blockedReason: "Approval pending",
      createdBy: "bundle-5-test",
    }).task;
    const approval = createApproval({
      companyIdOrSlug: company.id,
      type: "protected_runtime_command",
      requestedByAgentId: agent.id,
      approverAgentId: agent.id,
      payload: { command: "protected command", fingerprint: `bundle-5-orphan-${suffix}` },
      db,
    }).approval;
    db.prepare("UPDATE approvals SET status = 'cancelled', decision_note = 'orphan cleanup', updated_at = ? WHERE id = ?").run(new Date().toISOString(), approval.id);
    db.prepare("UPDATE tasks SET blocked_reason = ? WHERE id = ?").run(`Waiting on approval ${approval.id}`, task.id);

    const { cascadeResolvedApprovalsToLinkedTasks } = await import("@/lib/orchestration/service/approval");
    const result = cascadeResolvedApprovalsToLinkedTasks({ db, companySlugs: [company.slug] });
    assert.equal(result.changed, 1);
    const row = db.prepare("SELECT status FROM tasks WHERE id = ?").get(task.id) as { status: string };
    assert.equal(row.status, "backlog");
  });

  await test("adapter action extraction keeps mc-actions from stdout/stderr after terminal errors", () => {
    const stdout = [
      "stdout before failure",
      actionBlock({ action: "add_comment", taskKey: "INS-130", body: "comment survived" }),
      actionBlock({ action: "update_task", taskKey: "INS-130", status: "review" }),
    ].join("\n");
    const texts = adapterActionTexts({ resultText: "", assistantSummary: "", stdoutTail: stdout, stderrTail: "stdin closed" });
    assert.equal(texts.length, 1);
    assert.match(texts[0], /update_task/);
  });

  await test("mc-action dispatch continues after an action failure and writes a harness warning", async () => {
    const task = createTask({
      projectId: project.id,
      title: "Harness warning task",
      description: "Exercises multi-action dispatch.",
      priority: "P1",
      type: "feature",
      status: "in-progress",
      assignee: agent.id,
      labels: ["bundle-5"],
      createdBy: "bundle-5-test",
    }).task;
    const text = [
      actionBlock({ action: "update_task", taskKey: "MISSING-1", status: "review" }),
      actionBlock({ action: "add_comment", taskKey: task.key, body: "The trailing action still dispatched." }),
    ].join("\n");
    const result = await importAssistantTextAndExecuteActions({
      assistantTexts: [text],
      agentId: agent.id,
      agentName: agent.name,
      companyId: company.id,
      taskKey: task.id,
      runId: randomUUID(),
      db,
      source: "bundle-5-test",
    });
    assert.equal(result.actionsFound, 2);
    assert.equal(result.actionsExecuted, 1);
    const trailing = db.prepare("SELECT body FROM comments WHERE task_id = ? AND body = ? LIMIT 1").get(task.id, "The trailing action still dispatched.") as { body: string } | undefined;
    assert.equal(Boolean(trailing), true);
    const warning = db.prepare("SELECT body FROM comments WHERE task_id = ? AND body LIKE '[HARNESS_WARNING]%' LIMIT 1").get(task.id) as { body: string } | undefined;
    assert.match(warning?.body ?? "", /update_task/);
  });

  await test("single parse error in a run produces a single HARNESS_WARNING comment on the task", async () => {
    const task = createTask({
      projectId: project.id,
      title: "Parse warning task",
      description: "Malformed mc-action blocks should be visible.",
      priority: "P1",
      type: "feature",
      status: "in-progress",
      assignee: agent.id,
      labels: ["bundle-7"],
      createdBy: "bundle-7-test",
    }).task;
    const runId = randomUUID();
    insertHeartbeatRun(runId, task);
    const result = await importAssistantTextAndExecuteActions({
      assistantTexts: [malformedActionBlock(`{"action":"add_comment","taskKey":"${task.key}","body":"unterminated`)],
      agentId: agent.id,
      agentName: agent.name,
      companyId: company.id,
      taskKey: task.id,
      runId,
      db,
      source: "bundle-7-test",
    });
    assert.equal(result.hadDroppedActions, true);
    const warnings = db.prepare("SELECT body FROM comments WHERE task_id = ? AND body LIKE '[HARNESS_WARNING]%'").all(task.id) as Array<{ body: string }>;
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].body, /1 mc-action block/);
    assert.match(warnings[0].body, /failed to parse/);
    const run = db.prepare("SELECT result_json FROM heartbeat_runs WHERE id = ?").get(runId) as { result_json: string };
    assert.equal((JSON.parse(run.result_json) as { hadDroppedActions?: boolean }).hadDroppedActions, true);
    db.prepare("UPDATE heartbeat_runs SET status = 'succeeded', finished_at = ?, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), new Date().toISOString(), runId);
  });

  await test("multiple parse errors in one run batch into one HARNESS_WARNING comment (not N comments)", async () => {
    const task = createTask({
      projectId: project.id,
      title: "Batched parse warning task",
      description: "Multiple malformed blocks should produce one warning.",
      priority: "P1",
      type: "feature",
      status: "in-progress",
      assignee: agent.id,
      labels: ["bundle-7"],
      createdBy: "bundle-7-test",
    }).task;
    const runId = randomUUID();
    insertHeartbeatRun(runId, task);
    const text = [
      malformedActionBlock(`{"action":"add_comment","taskKey":"${task.key}","body":"unterminated`),
      malformedActionBlock(`{"action":`),
    ].join("\n");
    const result = await importAssistantTextAndExecuteActions({
      assistantTexts: [text],
      agentId: agent.id,
      agentName: agent.name,
      companyId: company.id,
      taskKey: task.id,
      runId,
      db,
      source: "bundle-7-test",
    });
    assert.equal(result.hadDroppedActions, true);
    const warnings = db.prepare("SELECT body FROM comments WHERE task_id = ? AND body LIKE '[HARNESS_WARNING]%'").all(task.id) as Array<{ body: string }>;
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].body, /2 mc-action blocks/);
    db.prepare("UPDATE heartbeat_runs SET status = 'succeeded', finished_at = ?, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), new Date().toISOString(), runId);
  });

  await test("parse error on unbound heartbeat falls back to agent's most-recent task", async () => {
    const olderTask = createTask({
      projectId: project.id,
      title: "Older fallback task",
      description: "Should not receive the fallback warning.",
      priority: "P2",
      type: "feature",
      status: "in-progress",
      assignee: agent.id,
      labels: ["bundle-7"],
      createdBy: "bundle-7-test",
    }).task;
    const newerTask = createTask({
      projectId: project.id,
      title: "Newer fallback task",
      description: "Should receive the fallback warning.",
      priority: "P1",
      type: "feature",
      status: "in-progress",
      assignee: agent.id,
      labels: ["bundle-7"],
      createdBy: "bundle-7-test",
    }).task;
    db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(new Date(Date.now() - 60_000).toISOString(), olderTask.id);
    db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), newerTask.id);
    const runId = randomUUID();
    insertHeartbeatRun(runId);
    await importAssistantTextAndExecuteActions({
      assistantTexts: [malformedActionBlock(`{"action":"add_comment","body":"broken`)],
      agentId: agent.id,
      agentName: agent.name,
      companyId: company.id,
      taskKey: "__heartbeat__",
      runId,
      db,
      source: "bundle-7-test",
    });
    const olderWarnings = db.prepare("SELECT COUNT(*) AS count FROM comments WHERE task_id = ? AND body LIKE '[HARNESS_WARNING]%'").get(olderTask.id) as { count: number };
    const newerWarnings = db.prepare("SELECT COUNT(*) AS count FROM comments WHERE task_id = ? AND body LIKE '[HARNESS_WARNING]%'").get(newerTask.id) as { count: number };
    assert.equal(olderWarnings.count, 0);
    assert.equal(newerWarnings.count, 1);
    db.prepare("UPDATE heartbeat_runs SET status = 'succeeded', finished_at = ?, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), new Date().toISOString(), runId);
  });

  await test("HARNESS_WARNING comment does NOT trigger an assignee wake", async () => {
    const task = createTask({
      projectId: project.id,
      title: "No wake parse warning task",
      description: "Harness warning comments are machine-authored only.",
      priority: "P1",
      type: "feature",
      status: "in-progress",
      assignee: agent.id,
      labels: ["bundle-7"],
      createdBy: "bundle-7-test",
    }).task;
    const before = db.prepare("SELECT COUNT(*) AS count FROM agent_wakeup_requests WHERE agent_id = ?").get(agent.id) as { count: number };
    const runId = randomUUID();
    insertHeartbeatRun(runId, task);
    await importAssistantTextAndExecuteActions({
      assistantTexts: [malformedActionBlock(`{"action":"add_comment","taskKey":"${task.key}","body":"broken`)],
      agentId: agent.id,
      agentName: agent.name,
      companyId: company.id,
      taskKey: task.id,
      runId,
      db,
      source: "bundle-7-test",
    });
    const after = db.prepare("SELECT COUNT(*) AS count FROM agent_wakeup_requests WHERE agent_id = ?").get(agent.id) as { count: number };
    assert.equal(after.count, before.count);
    db.prepare("UPDATE heartbeat_runs SET status = 'succeeded', finished_at = ?, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), new Date().toISOString(), runId);
  });

  await test("dispatch-error path and parse-error path both route through emitHarnessWarningComment helper", () => {
    const commentImport = readFileSync("src/lib/orchestration/engine/comment-import.ts", "utf8");
    const helper = readFileSync("src/lib/orchestration/engine/harness-warning.ts", "utf8");
    assert.match(commentImport, /emitHarnessWarningComment\(/);
    assert.match(helper, /INSERT INTO comments/);
    assert.equal(/importCommentOnTask\([\s\S]{0,240}\[HARNESS_WARNING\]/.test(commentImport), false);
  });

  await test("CLI failure comments classify into the operational panel", () => {
    assert.equal(
      getOperationalStatusTag({ text: "[CLI_FAILURE] Claude CLI exited 1: preflight rejected", source: "mission_control", type: "status_update" }),
      "CLI_FAILURE",
    );
  });

  await test("relative timestamps use operator-friendly buckets", () => {
    const now = Date.parse("2026-05-16T12:00:00.000Z");
    assert.equal(formatRelativeTime(now - 20_000, now), "just now");
    assert.equal(formatRelativeTime(now - 60_000, now), "1 minute ago");
    assert.equal(formatRelativeTime(now - 3 * 60 * 60 * 1000, now), "3 hours ago");
    assert.equal(formatRelativeTime(now - 25 * 60 * 60 * 1000, now), "yesterday");
    assert.equal(formatRelativeTime(now - 5 * 60_000, now, { compact: true }), "5m ago");
    assert.equal(formatRelativeTime(now - 2 * 60 * 60 * 1000, now, { compact: true }), "2h ago");
  });

  await test("agent live state is derived from heartbeat_runs only", () => {
    const task = createTask({
      projectId: project.id,
      title: "Live heartbeat task",
      description: "Canonical live-state fixture.",
      priority: "P1",
      type: "feature",
      status: "in-progress",
      assignee: agent.id,
      labels: ["bundle-5"],
      createdBy: "bundle-5-test",
    }).task;
    const runId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO heartbeat_runs
        (id, agent_id, company_id, invocation_source, trigger_detail, status, context_snapshot_json, started_at, created_at, updated_at)
       VALUES (?, ?, ?, 'wakeup_request', 'bundle-5 live-state', 'running', ?, ?, ?, ?)`,
    ).run(runId, agent.id, company.id, JSON.stringify({ taskId: task.id, taskKey: task.key }), now, now, now);
    db.prepare("UPDATE agents SET status = 'idle' WHERE id = ?").run(agent.id);

    const live = getAgentLiveState(agent.id, db);
    assert.equal(live.live, true);
    assert.equal(live.runningRunId, runId);
    db.prepare("UPDATE heartbeat_runs SET status = 'succeeded', finished_at = ?, updated_at = ? WHERE id = ?").run(now, now, runId);
    assert.equal(getAgentLiveState(agent.id, db).live, false);
  });

  await test("task-card model display strips provider prefixes and derives provider color", () => {
    const cases = [
      { model: "openai-codex/gpt-5.5", provider: "codex", text: "GPT-5.5", color: modelProviderColors("codex").background },
      { model: "claude-sonnet-4-6", provider: "anthropic", text: "Sonnet 4.6", color: modelProviderColors("anthropic").background },
      { model: "anthropic/claude-haiku-4-5", provider: "anthropic", text: "Haiku 4.5", color: modelProviderColors("anthropic").background },
      { model: "gemini-2.5-pro", provider: "gemini", text: "G2.5 Pro", color: modelProviderColors("gemini").background },
      { model: "google/gemini-3-flash-preview", provider: "gemini", text: "G3 Flash", color: modelProviderColors("gemini").background },
      { model: "google/gemini-3.1-pro-preview", provider: "gemini", text: "G3.1 Pro", color: modelProviderColors("gemini").background },
      { model: "Google/Gemini 3.1 Pro Preview", provider: "gemini", text: "G3.1 Pro", color: modelProviderColors("gemini").background },
      { model: "Gemini 3 Flash Preview", provider: "gemini", text: "G3 Flash", color: modelProviderColors("gemini").background },
      { model: "Gemini 3.1 Flash Preview", provider: "gemini", text: "G3.1 Flash", color: modelProviderColors("gemini").background },
    ] as const;
    for (const entry of cases) {
      const display = resolveAgentModelDisplay({ model: entry.model, provider: "anthropic", executionEngine: "symphony" });
      assert.equal(display?.provider, entry.provider);
      assert.equal(display?.displayModel, entry.text);
      assert.equal(display?.background, entry.color);
      assert.ok(!display?.displayModel.includes("/"));
      assert.equal(compactAgentModelLabel(entry.model), entry.text);
    }
  });

  await test("done and reviewed task model display carries producer agent instead of reviewer", () => {
    const reviewCompany = createCompany({
      name: `Bundle 5 Source Agent ${suffix}`,
      description: "Source agent fixture",
      status: "active",
    }).company;
    const reviewProject = createProject({
      companyId: reviewCompany.id,
      name: `Source Agent Project ${suffix}`,
      description: "Source agent project",
      color: "#22c55e",
      emoji: "icon:user-check",
      status: "active",
    }).project;
    const producer = createProjectAgent({
      projectId: reviewProject.id,
      name: `Producer ${suffix}`,
      emoji: "icon:hammer",
      role: "Implementation Engineer",
      personality: "Fixture producer",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "idle",
    }).agent;
    const reviewer = createProjectAgent({
      projectId: reviewProject.id,
      name: `Reviewer ${suffix}`,
      emoji: "icon:check",
      role: "QA Specialist",
      personality: "Fixture reviewer",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "idle",
    }).agent;
    const finalReviewer = createProjectAgent({
      projectId: reviewProject.id,
      name: `Final Reviewer ${suffix}`,
      emoji: "icon:check-check",
      role: "Principal QA Specialist",
      personality: "Fixture final reviewer",
      model: "anthropic/claude-sonnet-4-6",
      skills: [],
      status: "idle",
    }).agent;
    const task = createTask({
      projectId: reviewProject.id,
      title: `Source agent done task ${suffix}`,
      description: "Verify completed cards keep the producer identity.",
      priority: "P1",
      type: "feature",
      status: "done",
      assignee: producer.id,
      labels: ["bundle-5"],
      createdBy: "bundle-5-test",
    }).task;
    const producedAt = new Date(Date.now() - 240_000).toISOString();
    const returnedAt = new Date(Date.now() - 180_000).toISOString();
    const reproducedAt = new Date(Date.now() - 120_000).toISOString();
    const reviewedAt = new Date().toISOString();
    const producerRunId = randomUUID();
    const reviewerRunId = randomUUID();
    const producerSecondRunId = randomUUID();
    const finalReviewerRunId = randomUUID();
    db.prepare(
      `INSERT INTO execution_runs
        (id, task_id, agent_id, provider, runner_provider, runner_model, status, started_at, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, 'anthropic', 'anthropic', 'claude-sonnet-4-6', 'completed', ?, ?, ?, ?)`,
    ).run(producerRunId, task.id, producer.id, producedAt, producedAt, producedAt, producedAt);
    db.prepare(
      `INSERT INTO execution_runs
        (id, task_id, agent_id, provider, runner_provider, runner_model, status, started_at, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, 'anthropic', 'anthropic', 'claude-haiku-4-5', 'completed', ?, ?, ?, ?)`,
    ).run(reviewerRunId, task.id, reviewer.id, returnedAt, returnedAt, returnedAt, returnedAt);
    db.prepare(
      `INSERT INTO execution_runs
        (id, task_id, agent_id, provider, runner_provider, runner_model, status, started_at, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, 'anthropic', 'anthropic', 'claude-opus-4-7', 'completed', ?, ?, ?, ?)`,
    ).run(producerSecondRunId, task.id, producer.id, reproducedAt, reproducedAt, reproducedAt, reproducedAt);
    db.prepare(
      `INSERT INTO execution_runs
        (id, task_id, agent_id, provider, runner_provider, runner_model, status, started_at, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, 'anthropic', 'anthropic', 'claude-sonnet-4-6', 'completed', ?, ?, ?, ?)`,
    ).run(finalReviewerRunId, task.id, finalReviewer.id, reviewedAt, reviewedAt, reviewedAt, reviewedAt);
    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.status_changed', 'in_progress', 'review', ?, ?)`,
    ).run(randomUUID(), reviewProject.id, task.id, producer.id, JSON.stringify({ source: "engine_action", runId: producerRunId }), producedAt);
    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.status_changed', 'review', 'in_progress', ?, ?)`,
    ).run(randomUUID(), reviewProject.id, task.id, reviewer.id, JSON.stringify({ source: "engine_action", runId: reviewerRunId }), returnedAt);
    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.assigned', ?, ?)`,
    ).run(
      randomUUID(),
      reviewProject.id,
      task.id,
      producer.id,
      JSON.stringify({
        source: "engine_default_review_handoff",
        runId: producerSecondRunId,
        previousAssignee: reviewer.id,
        newAssignee: finalReviewer.id,
      }),
      reproducedAt,
    );
    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.status_changed', 'in_progress', 'review', ?, ?)`,
    ).run(randomUUID(), reviewProject.id, task.id, producer.id, JSON.stringify({ source: "engine_action", runId: producerSecondRunId }), reproducedAt);
    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.artifact_registered', ?, ?)`,
    ).run(
      randomUUID(),
      reviewProject.id,
      task.id,
      producer.id,
      JSON.stringify({ uri: "file:///tmp/source-agent-fixture.md", kind: "file", sha256: "a".repeat(64) }),
      reproducedAt,
    );
    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.status_changed', 'review', 'done', ?, ?)`,
    ).run(randomUUID(), reviewProject.id, task.id, finalReviewer.id, JSON.stringify({ source: "engine_action", runId: finalReviewerRunId }), reviewedAt);

    const [row] = listTasks({ company: reviewCompany.slug, includeNonProduction: true, search: task.key }).tasks;
    assert.equal(row.displayAgentName, producer.name);
    assert.equal(row.displayAgentSource, "runner");
    assert.equal(row.modelDisplay?.sourceAgentName, producer.name);
    assert.equal(row.modelDisplay?.model, "claude-opus-4-7");

    const reviewTask = createTask({
      projectId: reviewProject.id,
      title: `Source agent review task ${suffix}`,
      description: "Verify review cards keep the producer identity.",
      priority: "P1",
      type: "feature",
      status: "review",
      assignee: finalReviewer.id,
      labels: ["bundle-5"],
      createdBy: "bundle-5-test",
    }).task;
    const reviewProducerRunId = randomUUID();
    const reviewProducerAt = new Date(Date.now() - 60_000).toISOString();
    db.prepare(
      `INSERT INTO execution_runs
        (id, task_id, agent_id, provider, runner_provider, runner_model, status, started_at, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, 'anthropic', 'anthropic', 'claude-sonnet-4-6', 'completed', ?, ?, ?, ?)`,
    ).run(reviewProducerRunId, reviewTask.id, producer.id, reviewProducerAt, reviewProducerAt, reviewProducerAt, reviewProducerAt);
    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.status_changed', 'in_progress', 'review', ?, ?)`,
    ).run(randomUUID(), reviewProject.id, reviewTask.id, producer.id, JSON.stringify({ source: "engine_action", runId: reviewProducerRunId }), reviewProducerAt);

    const [reviewRow] = listTasks({ company: reviewCompany.slug, includeNonProduction: true, search: reviewTask.key }).tasks;
    assert.equal(reviewRow.displayAgentName, producer.name);
    assert.equal(reviewRow.displayAgentSource, "runner");
    assert.equal(reviewRow.modelDisplay?.sourceAgentName, producer.name);
    assert.equal(reviewRow.modelDisplay?.model, "claude-sonnet-4-6");
  });

  await test("review watchdog routes to freshly reassigned reviewer using per-assignee idempotency", () => {
    const reviewCompany = createCompany({
      name: `Bundle 5 Review Reassign ${suffix}`,
      description: "Review reassignment fixture",
      status: "active",
    }).company;
    const reviewProject = createProject({
      companyId: reviewCompany.id,
      name: `Review Reassign Project ${suffix}`,
      description: "Review reassignment project",
      color: "#38bdf8",
      emoji: "icon:check",
      status: "active",
    }).project;
    const producer = createProjectAgent({
      projectId: reviewProject.id,
      name: `Producer ${suffix}`,
      emoji: "icon:hammer",
      role: "Implementation Engineer",
      personality: "Fixture producer",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "idle",
    }).agent;
    const reviewerA = createProjectAgent({
      projectId: reviewProject.id,
      name: `Clarity ${suffix}`,
      emoji: "icon:check",
      role: "QA Specialist",
      personality: "Fixture reviewer A",
      model: "claude-sonnet-4-6",
      skills: [],
      status: "idle",
    }).agent;
    const reviewerB = createProjectAgent({
      projectId: reviewProject.id,
      name: `Gator ${suffix}`,
      emoji: "icon:shield",
      role: "QA Specialist",
      personality: "Fixture reviewer B",
      model: "claude-sonnet-4-6",
      skills: [],
      status: "idle",
    }).agent;
    createProjectAgent({
      projectId: reviewProject.id,
      name: `Oracle ${suffix}`,
      emoji: "icon:brain",
      role: "CEO",
      personality: "Fixture CEO",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "idle",
    });
    const task = createTask({
      projectId: reviewProject.id,
      title: "Review reassignment timer task",
      description: "Review should wake the current reviewer, not stale watchdog escalation.",
      priority: "P1",
      type: "qa",
      status: "review",
      assignee: reviewerB.id,
      labels: ["bundle-5"],
      createdBy: "bundle-5-test",
    }).task;
    db.prepare("UPDATE agents SET adapter_type = 'codex' WHERE id IN (?, ?, ?)").run(producer.id, reviewerA.id, reviewerB.id);
    const submittedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const reassignedAt = new Date(Date.now() - 30 * 1000).toISOString();
    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, user_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'bundle-5-test', 'task.status_changed', 'in_progress', 'review', '{}', ?)`,
    ).run(randomUUID(), reviewProject.id, task.id, producer.id, submittedAt);
    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, user_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'bundle-5-test', 'task.assigned', 'review', 'review', ?, ?)`,
    ).run(
      randomUUID(),
      reviewProject.id,
      task.id,
      reviewerB.id,
      JSON.stringify({ assigneeId: reviewerB.id, previousAssigneeId: reviewerA.id }),
      reassignedAt,
    );
    db.prepare("UPDATE tasks SET assignee_agent_id = ?, assigned_at = ?, updated_at = ? WHERE id = ?")
      .run(reviewerB.id, reassignedAt, reassignedAt, task.id);
    db.prepare(
      `INSERT INTO agent_wakeup_requests
        (id, agent_id, company_id, source, reason, status, payload_json, idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, 'api', 'sweep_review_to_assignee', 'failed', '{}', ?, ?, ?)`,
    ).run(randomUUID(), reviewerA.id, reviewCompany.id, `review_assignee:${task.id}:${reviewerA.id}`, submittedAt, submittedAt);

    const result = sweepOpenTasks(db, { cap: 10, companySlugs: [reviewCompany.slug] });
    assert.equal(result.wakesEnqueued, 1, `expected current reviewer wake; got ${JSON.stringify(result)}`);
    const wake = db.prepare(
      `SELECT agent_id, reason, idempotency_key
       FROM agent_wakeup_requests
       WHERE json_extract(payload_json, '$.taskId') = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    ).get(task.id) as { agent_id: string; reason: string; idempotency_key: string } | undefined;
    assert.equal(wake?.agent_id, reviewerB.id);
    assert.equal(wake?.reason, "sweep_review_to_assignee");
    assert.equal(wake?.idempotency_key, `review_assignee:${task.id}:${reviewerB.id}`);
  });

  await test("review watchdog falls back to current reviewer when no escalation target is runnable", () => {
    const fallbackCompany = createCompany({
      name: `Bundle 5 Review Fallback ${suffix}`,
      description: "Review fallback fixture",
      status: "active",
    }).company;
    const fallbackProject = createProject({
      companyId: fallbackCompany.id,
      name: `Review Fallback Project ${suffix}`,
      description: "Review fallback project",
      color: "#f97316",
      emoji: "icon:check",
      status: "active",
    }).project;
    const producer = createProjectAgent({
      projectId: fallbackProject.id,
      name: `Fallback Producer ${suffix}`,
      emoji: "icon:hammer",
      role: "Implementation Engineer",
      personality: "Fixture producer",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "idle",
    }).agent;
    const reviewer = createProjectAgent({
      projectId: fallbackProject.id,
      name: `Fallback Reviewer ${suffix}`,
      emoji: "icon:check",
      role: "QA Specialist",
      personality: "Fixture reviewer",
      model: "claude-sonnet-4-6",
      skills: [],
      status: "idle",
    }).agent;
    createProjectAgent({
      projectId: fallbackProject.id,
      name: `Fallback CEO ${suffix}`,
      emoji: "icon:brain",
      role: "CEO",
      personality: "Paused CEO fixture",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "paused",
    });
    const task = createTask({
      projectId: fallbackProject.id,
      title: "Review fallback task",
      description: "No escalation target should route back to the current assignee.",
      priority: "P1",
      type: "qa",
      status: "review",
      assignee: reviewer.id,
      labels: ["bundle-5"],
      createdBy: "bundle-5-test",
    }).task;
    db.prepare("UPDATE agents SET adapter_type = 'codex' WHERE id IN (?, ?)").run(producer.id, reviewer.id);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, user_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'bundle-5-test', 'task.status_changed', 'in_progress', 'review', '{}', ?)`,
    ).run(randomUUID(), fallbackProject.id, task.id, producer.id, old);
    db.prepare("UPDATE tasks SET assigned_at = ?, updated_at = ? WHERE id = ?").run(old, old, task.id);

    const result = sweepOpenTasks(db, { cap: 10, companySlugs: [fallbackCompany.slug] });
    assert.equal(result.wakesEnqueued, 1, `expected fallback wake; got ${JSON.stringify(result)}`);
    const wake = db.prepare(
      `SELECT agent_id, reason, idempotency_key
       FROM agent_wakeup_requests
       WHERE json_extract(payload_json, '$.taskId') = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    ).get(task.id) as { agent_id: string; reason: string; idempotency_key: string } | undefined;
    assert.equal(wake?.agent_id, reviewer.id);
    assert.equal(wake?.reason, "sweep_review_to_assignee");
    assert.equal(wake?.idempotency_key, `review_assignee:${task.id}:${reviewer.id}`);
    const comment = db.prepare("SELECT body FROM comments WHERE task_id = ? AND body LIKE '[REVIEW_FALLBACK]%' LIMIT 1")
      .get(task.id) as { body: string } | undefined;
    assert.match(comment?.body ?? "", /No escalation target available/);
  });

  function wakeForTask(taskId: string, reason: string) {
    return db.prepare(
      `SELECT id, source, reason, agent_id, payload_json, idempotency_key, coalesced_count
       FROM agent_wakeup_requests
       WHERE reason = ?
         AND json_extract(payload_json, '$.taskId') = ?
       ORDER BY created_at ASC`,
    ).all(reason, taskId) as Array<{
      id: string;
      source: string;
      reason: string;
      agent_id: string;
      payload_json: string;
      idempotency_key: string | null;
      coalesced_count: number;
    }>;
  }

  function assertEngineReassignWake(input: {
    taskId: string;
    agentId: string;
    runId: string;
    reason: string;
    taskStatus: string;
  }) {
    const wakes = wakeForTask(input.taskId, input.reason);
    assert.equal(wakes.length, 1, `expected one deduped wake for ${input.reason}`);
    const wake = wakes[0];
    assert.equal(wake.source, "issue_assigned");
    assert.equal(wake.agent_id, input.agentId);
    assert.equal(wake.reason, input.reason);
    assert.ok(wake.idempotency_key?.includes(input.taskId), "idempotency key includes task id");
    assert.ok(wake.idempotency_key?.includes(input.agentId), "idempotency key includes assignee id");
    assert.ok(wake.idempotency_key?.includes(input.runId), "idempotency key includes run id");
    const payload = JSON.parse(wake.payload_json) as { taskId: string; taskStatus: string; projectId: string | null; runId: string };
    assert.equal(payload.taskId, input.taskId);
    assert.equal(payload.taskStatus, input.taskStatus);
    assert.equal(payload.runId, input.runId);
  }

  await test("engine_default_review_handoff enqueues issue_assigned wakeup for new reviewer", () => {
    const reviewCompany = createCompany({
      name: `Bundle 5 H Review Handoff ${suffix}`,
      description: "Engine reassignment wake fixture",
      status: "active",
    }).company;
    const reviewProject = createProject({
      companyId: reviewCompany.id,
      name: `Review Handoff Project ${suffix}`,
      description: "Review handoff project",
      color: "#0ea5e9",
      emoji: "icon:check",
      status: "active",
    }).project;
    const producer = createProjectAgent({
      projectId: reviewProject.id,
      name: `H Producer ${suffix}`,
      emoji: "icon:hammer",
      role: "Implementation Engineer",
      personality: "Fixture producer",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "idle",
    }).agent;
    const reviewer = createProjectAgent({
      projectId: reviewProject.id,
      name: `H Gator ${suffix}`,
      emoji: "icon:shield",
      role: "QA Specialist",
      personality: "Fixture reviewer",
      model: "claude-sonnet-4-6",
      skills: [],
      status: "idle",
    }).agent;
    db.prepare("UPDATE agents SET adapter_type = 'codex', review_specialist_categories = '[\"qa\",\"general\"]' WHERE id IN (?, ?)")
      .run(producer.id, reviewer.id);
    db.prepare("DELETE FROM agent_runtimes WHERE agent_id IN (?, ?)").run(producer.id, reviewer.id);
    const task = createTask({
      projectId: reviewProject.id,
      title: "Engine review handoff wake task",
      description: "Submitting to review should wake the reviewer immediately.",
      priority: "P1",
      type: "feature",
      status: "in-progress",
      assignee: producer.id,
      labels: ["bundle-5"],
      createdBy: "bundle-5-test",
    }).task;
    db.prepare("UPDATE tasks SET status = 'in_progress' WHERE id = ?").run(task.id);
    const runId = randomUUID();

    const first = executeUpdateTask(
      { action: "update_task", taskKey: task.key, status: "review" },
      { agentId: producer.id, companyId: reviewCompany.id, runId },
      db,
    );
    assert.equal(first.statusApplied, true, `status rejected: ${first.statusRejectedReason ?? "none"}`);
    assert.equal(first.assigneeApplied, true, `assignee rejected: ${first.assigneeRejectedReason ?? "none"}`);
    assertEngineReassignWake({
      taskId: task.id,
      agentId: reviewer.id,
      runId,
      reason: "engine_default_review_handoff",
      taskStatus: "review",
    });

    db.prepare("UPDATE tasks SET status = 'in_progress', assignee_agent_id = ?, assigned_at = ?, updated_at = ? WHERE id = ?")
      .run(producer.id, new Date().toISOString(), new Date().toISOString(), task.id);
    const second = executeUpdateTask(
      { action: "update_task", taskKey: task.key, status: "review" },
      { agentId: producer.id, companyId: reviewCompany.id, runId },
      db,
    );
    assert.equal(second.statusApplied, true);
    assertEngineReassignWake({
      taskId: task.id,
      agentId: reviewer.id,
      runId,
      reason: "engine_default_review_handoff",
      taskStatus: "review",
    });
  });

  await test("engine_review_completion_return_to_producer enqueues issue_assigned wakeup for producer", () => {
    const reviewCompany = createCompany({
      name: `Bundle 5 H Review Return ${suffix}`,
      description: "Engine return wake fixture",
      status: "active",
    }).company;
    const reviewProject = createProject({
      companyId: reviewCompany.id,
      name: `Review Return Project ${suffix}`,
      description: "Review return project",
      color: "#f59e0b",
      emoji: "icon:rotate-ccw",
      status: "active",
    }).project;
    const producer = createProjectAgent({
      projectId: reviewProject.id,
      name: `H Return Producer ${suffix}`,
      emoji: "icon:hammer",
      role: "Implementation Engineer",
      personality: "Fixture producer",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "idle",
    }).agent;
    const reviewer = createProjectAgent({
      projectId: reviewProject.id,
      name: `H Return Reviewer ${suffix}`,
      emoji: "icon:check",
      role: "QA Specialist",
      personality: "Fixture reviewer",
      model: "claude-sonnet-4-6",
      skills: [],
      status: "idle",
    }).agent;
    db.prepare("UPDATE agents SET adapter_type = 'codex' WHERE id IN (?, ?)").run(producer.id, reviewer.id);
    const task = createTask({
      projectId: reviewProject.id,
      title: "Engine review return wake task",
      description: "Rejecting review should wake the producer immediately.",
      priority: "P1",
      type: "feature",
      status: "review",
      assignee: reviewer.id,
      labels: ["bundle-5"],
      createdBy: "bundle-5-test",
    }).task;
    db.prepare(
      `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.status_changed', 'in_progress', 'review', ?, ?)`,
    ).run(randomUUID(), reviewProject.id, task.id, producer.id, JSON.stringify({ source: "engine_action" }), new Date(Date.now() - 60_000).toISOString());
    const runId = randomUUID();

    const first = executeUpdateTask(
      { action: "update_task", taskKey: task.key, status: "in_progress", comment: "Needs rework." },
      { agentId: reviewer.id, companyId: reviewCompany.id, runId },
      db,
    );
    assert.equal(first.statusApplied, true);
    assert.equal(first.assigneeApplied, true);
    assertEngineReassignWake({
      taskId: task.id,
      agentId: producer.id,
      runId,
      reason: "engine_review_completion_return_to_producer",
      taskStatus: "in_progress",
    });

    db.prepare("UPDATE tasks SET status = 'review', assignee_agent_id = ?, assigned_at = ?, updated_at = ? WHERE id = ?")
      .run(reviewer.id, new Date().toISOString(), new Date().toISOString(), task.id);
    const second = executeUpdateTask(
      { action: "update_task", taskKey: task.key, status: "in_progress", comment: "Needs rework again." },
      { agentId: reviewer.id, companyId: reviewCompany.id, runId },
      db,
    );
    assert.equal(second.statusApplied, true);
    assertEngineReassignWake({
      taskId: task.id,
      agentId: producer.id,
      runId,
      reason: "engine_review_completion_return_to_producer",
      taskStatus: "in_progress",
    });

    db.prepare("UPDATE tasks SET status = 'review', assignee_agent_id = ?, assigned_at = ?, updated_at = ? WHERE id = ?")
      .run(reviewer.id, new Date().toISOString(), new Date().toISOString(), task.id);
    const doneRunId = randomUUID();
    const done = executeUpdateTask(
      { action: "update_task", taskKey: task.key, status: "done", comment: "Review passed." },
      { agentId: reviewer.id, companyId: reviewCompany.id, runId: doneRunId },
      db,
    );
    assert.equal(done.statusApplied, true);
    assert.equal(done.assigneeApplied, true, "done review completion should preserve producer attribution");
    const postDone = db.prepare("SELECT status, assignee_agent_id FROM tasks WHERE id = ?").get(task.id) as {
      status: string;
      assignee_agent_id: string | null;
    } | undefined;
    assert.equal(postDone?.status, "done");
    assert.equal(postDone?.assignee_agent_id, producer.id);
    const doneWake = db.prepare(
      `SELECT COUNT(*) AS count
       FROM agent_wakeup_requests
       WHERE reason = 'engine_review_completion_return_to_producer'
         AND json_extract(payload_json, '$.taskId') = ?
         AND json_extract(payload_json, '$.runId') = ?`,
    ).get(task.id, doneRunId) as { count: number };
    assert.equal(doneWake.count, 0, "done review completion should not wake the producer");
    const doneAssignment = db.prepare(
      `SELECT metadata_json
       FROM task_events
       WHERE task_id = ?
         AND event_type = 'task.assigned'
         AND json_extract(metadata_json, '$.source') = 'engine_review_completion_return_to_producer'
         AND json_extract(metadata_json, '$.status') = 'done'`,
    ).get(task.id) as { metadata_json: string } | undefined;
    assert.ok(doneAssignment, "done review completion should emit a producer attribution event");
    const doneAssignmentMetadata = JSON.parse(doneAssignment.metadata_json) as {
      reviewer?: string;
      newAssignee?: string;
      previousAssignee?: string;
      status?: string;
    };
    assert.equal(doneAssignmentMetadata.reviewer, reviewer.id);
    assert.equal(doneAssignmentMetadata.newAssignee, producer.id);
    assert.equal(doneAssignmentMetadata.previousAssignee, reviewer.id);
    assert.equal(doneAssignmentMetadata.status, "done");
  });

  await test("engine_review_completion_return_to_producer rotates to capable alternate when producer is offline", () => {
    const reviewCompany = createCompany({
      name: `Bundle 5 H Review Return Fallback ${suffix}`,
      description: "Engine return fallback wake fixture",
      status: "active",
    }).company;
    const reviewProject = createProject({
      companyId: reviewCompany.id,
      name: `Review Return Fallback Project ${suffix}`,
      description: "Review return fallback project",
      color: "#f59e0b",
      emoji: "icon:rotate-ccw",
      status: "active",
    }).project;
    const producer = createProjectAgent({
      projectId: reviewProject.id,
      name: `H Offline Producer ${suffix}`,
      emoji: "icon:hammer",
      role: "Backend Implementation Engineer",
      personality: "Fixture producer",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "offline",
    }).agent;
    const alternate = createProjectAgent({
      projectId: reviewProject.id,
      name: `H Fallback Producer ${suffix}`,
      emoji: "icon:wrench",
      role: "Backend Implementation Engineer",
      personality: "Fixture fallback",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "idle",
    }).agent;
    const reviewer = createProjectAgent({
      projectId: reviewProject.id,
      name: `H Fallback Reviewer ${suffix}`,
      emoji: "icon:check",
      role: "QA Specialist",
      personality: "Fixture reviewer",
      model: "claude-sonnet-4-6",
      skills: [],
      status: "idle",
    }).agent;
    db.prepare("UPDATE agents SET adapter_type = 'codex', eligible_categories = ? WHERE id IN (?, ?)")
      .run(JSON.stringify(["backend", "implementation"]), producer.id, alternate.id);
    db.prepare("UPDATE agents SET adapter_type = 'codex' WHERE id = ?").run(reviewer.id);
    const task = createTask({
      projectId: reviewProject.id,
      title: "Backend review return fallback task",
      description: "Rejecting review should wake a capable alternate if the producer is offline.",
      priority: "P1",
      type: "feature",
      status: "review",
      assignee: reviewer.id,
      labels: ["backend"],
      createdBy: "bundle-5-test",
    }).task;
    db.prepare("UPDATE tasks SET eligible_assignee_ids = ? WHERE id = ?")
      .run(JSON.stringify([producer.id, alternate.id]), task.id);
    db.prepare(
      `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.status_changed', 'in_progress', 'review', ?, ?)`,
    ).run(randomUUID(), reviewProject.id, task.id, producer.id, JSON.stringify({ source: "engine_action" }), new Date(Date.now() - 60_000).toISOString());
    const runId = randomUUID();

    const result = executeUpdateTask(
      { action: "update_task", taskKey: task.key, status: "in_progress", comment: "Needs rework." },
      { agentId: reviewer.id, companyId: reviewCompany.id, runId },
      db,
    );
    assert.equal(result.statusApplied, true);
    assert.equal(result.assigneeApplied, true);

    const row = db.prepare("SELECT status, assignee_agent_id FROM tasks WHERE id = ?").get(task.id) as {
      status: string;
      assignee_agent_id: string | null;
    };
    assert.equal(row.status, "in_progress");
    assert.equal(row.assignee_agent_id, alternate.id, "offline producer should be replaced by capable fallback");

    assertEngineReassignWake({
      taskId: task.id,
      agentId: alternate.id,
      runId,
      reason: "engine_review_completion_return_to_producer",
      taskStatus: "in_progress",
    });

    const fallbackEvent = db.prepare(
      `SELECT metadata_json
       FROM task_events
       WHERE task_id = ?
         AND event_type = 'task.reassigned'
         AND json_extract(metadata_json, '$.source') = 'engine_reassignment_capable_fallback'
       ORDER BY created_at DESC
       LIMIT 1`,
    ).get(task.id) as { metadata_json: string } | undefined;
    assert.ok(fallbackEvent, "fallback reassignment event should be recorded");
    assert.match(fallbackEvent.metadata_json, /engine_review_completion_return_to_producer/);
  });

  await test("end-of-run autoflip does not undo review return to producer", () => {
    const reviewCompany = createCompany({
      name: `Bundle 5 Autoflip Review Return ${suffix}`,
      description: "End-of-run autoflip review return fixture",
      status: "active",
    }).company;
    const reviewProject = createProject({
      companyId: reviewCompany.id,
      name: `Autoflip Review Return Project ${suffix}`,
      description: "Autoflip review return project",
      color: "#f59e0b",
      emoji: "icon:rotate-ccw",
      status: "active",
    }).project;
    const producer = createProjectAgent({
      projectId: reviewProject.id,
      name: `Autoflip Producer ${suffix}`,
      emoji: "icon:hammer",
      role: "Implementation Engineer",
      personality: "Fixture producer",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "idle",
    }).agent;
    const reviewer = createProjectAgent({
      projectId: reviewProject.id,
      name: `Autoflip Reviewer ${suffix}`,
      emoji: "icon:check",
      role: "QA Specialist",
      personality: "Fixture reviewer",
      model: "claude-sonnet-4-6",
      skills: [],
      status: "idle",
    }).agent;
    db.prepare("UPDATE agents SET adapter_type = 'codex' WHERE id IN (?, ?)").run(producer.id, reviewer.id);
    const task = createTask({
      projectId: reviewProject.id,
      title: "Review return should stay in progress",
      description: "Reviewer sends changes required back to producer.",
      priority: "P1",
      type: "feature",
      status: "review",
      assignee: reviewer.id,
      labels: ["backend"],
      createdBy: "bundle-5-test",
    }).task;
    db.prepare(
      `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.status_changed', 'in_progress', 'review', ?, ?)`,
    ).run(randomUUID(), reviewProject.id, task.id, producer.id, JSON.stringify({ source: "engine_action" }), new Date(Date.now() - 60_000).toISOString());
    const runId = randomUUID();
    const runStart = new Date(Date.now() - 5_000).toISOString();

    const result = executeUpdateTask(
      { action: "update_task", taskKey: task.key, status: "in_progress", comment: "Changes required; return this to the producer." },
      { agentId: reviewer.id, companyId: reviewCompany.id, runId },
      db,
    );
    assert.equal(result.statusApplied, true);
    assert.equal(result.assigneeApplied, true);

    const flipped = engineTestHooks.autoFlipTaskToReviewAfterMissingEndDeclaration(db, {
      taskId: task.id,
      agentId: reviewer.id,
      runId,
      runWindowStart: runStart,
      now: new Date().toISOString(),
    });
    assert.equal(flipped, false, "autoflip should defer to explicit review -> in_progress declaration");

    const row = db.prepare("SELECT status, assignee_agent_id FROM tasks WHERE id = ?").get(task.id) as {
      status: string;
      assignee_agent_id: string | null;
    };
    assert.equal(row.status, "in_progress");
    assert.equal(row.assignee_agent_id, producer.id);

    const autoEvent = db.prepare(
      `SELECT COUNT(*) AS count
       FROM task_events
       WHERE task_id = ?
         AND json_extract(metadata_json, '$.source') = 'engine_end_of_run_autoflip'
         AND json_extract(metadata_json, '$.runId') = ?`,
    ).get(task.id, runId) as { count: number };
    assert.equal(autoEvent.count, 0);
  });

  await test("engine_action_reassign enqueues issue_assigned wakeup for new assignee", () => {
    const reassignCompany = createCompany({
      name: `Bundle 5 H Action Reassign ${suffix}`,
      description: "Engine action reassign wake fixture",
      status: "active",
    }).company;
    const reassignProject = createProject({
      companyId: reassignCompany.id,
      name: `Action Reassign Project ${suffix}`,
      description: "Action reassign project",
      color: "#a855f7",
      emoji: "icon:send",
      status: "active",
    }).project;
    const fromAgent = createProjectAgent({
      projectId: reassignProject.id,
      name: `H From ${suffix}`,
      emoji: "icon:user",
      role: "Implementation Engineer",
      personality: "Fixture from agent",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "idle",
    }).agent;
    const toAgent = createProjectAgent({
      projectId: reassignProject.id,
      name: `H To ${suffix}`,
      emoji: "icon:user-check",
      role: "Implementation Engineer",
      personality: "Fixture to agent",
      model: "claude-sonnet-4-6",
      skills: [],
      status: "idle",
    }).agent;
    const lead = createProjectAgent({
      projectId: reassignProject.id,
      name: `H Lead ${suffix}`,
      emoji: "icon:brain",
      role: "CEO",
      personality: "Fixture lead",
      model: "openai-codex/gpt-5.5",
      skills: [],
      status: "idle",
    }).agent;
    db.prepare("UPDATE agents SET adapter_type = 'codex' WHERE id IN (?, ?, ?)").run(fromAgent.id, toAgent.id, lead.id);
    const task = createTask({
      projectId: reassignProject.id,
      title: "Engine action reassign wake task",
      description: "Explicit reassignment should wake the new assignee immediately.",
      priority: "P1",
      type: "feature",
      status: "in-progress",
      assignee: fromAgent.id,
      labels: ["bundle-5"],
      createdBy: "bundle-5-test",
    }).task;
    const runId = randomUUID();

    const first = executeUpdateTask(
      { action: "update_task", taskKey: task.key, assignee: toAgent.name },
      { agentId: lead.id, companyId: reassignCompany.id, runId },
      db,
    );
    assert.equal(first.assigneeApplied, true);
    assertEngineReassignWake({
      taskId: task.id,
      agentId: toAgent.id,
      runId,
      reason: "engine_action_reassign",
      taskStatus: "in_progress",
    });

    db.prepare("UPDATE tasks SET assignee_agent_id = ?, assigned_at = ?, updated_at = ? WHERE id = ?")
      .run(fromAgent.id, new Date().toISOString(), new Date().toISOString(), task.id);
    const second = executeUpdateTask(
      { action: "update_task", taskKey: task.key, assignee: toAgent.name },
      { agentId: lead.id, companyId: reassignCompany.id, runId },
      db,
    );
    assert.equal(second.assigneeApplied, true);
    assertEngineReassignWake({
      taskId: task.id,
      agentId: toAgent.id,
      runId,
      reason: "engine_action_reassign",
      taskStatus: "in_progress",
    });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void run();
