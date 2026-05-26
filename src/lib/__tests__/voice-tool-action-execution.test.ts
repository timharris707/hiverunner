import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  createProject,
  createProjectAgent,
  createTask,
  getTask,
  listTaskComments,
} from "@/lib/orchestration/service";
import { executeVoiceActionTool } from "@/lib/voice-task-action-execution";

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

console.log("\nVoice Tool Action Execution Tests\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const company = createCompany({
    name: `Voice Action Co ${Date.now()}`,
    description: "fixture",
    status: "active",
  }).company;

  const project = createProject({
    companyId: company.id,
    name: `Voice Action Project ${Date.now()}`,
    description: "fixture",
    color: "#f59e0b",
    emoji: "⚡",
    status: "active",
  }).project;

  const agent = createProjectAgent({
    projectId: project.id,
    name: `Scout ${Date.now()}`,
    emoji: "🧭",
    role: "Research Agent",
    personality: "Direct",
    status: "idle",
    skills: ["voice", "execution"],
  }).agent;
  getOrchestrationDb()
    .prepare("UPDATE agents SET adapter_type = 'anthropic', model = 'anthropic/claude-sonnet-4-6' WHERE id = ?")
    .run(agent.id);

  const task = createTask({
    projectId: project.id,
    title: "Task-bound voice action target",
    description: "fixture",
    priority: "P1",
    type: "feature",
    status: "in-progress",
    assignee: agent.id,
    labels: ["voice"],
    createdBy: "test",
  }).task;

  const aliasTask = createTask({
    projectId: project.id,
    title: "Task status alias target",
    description: "fixture",
    priority: "P1",
    type: "feature",
    status: "in-progress",
    assignee: agent.id,
    labels: ["voice", "alias"],
    createdBy: "test",
  }).task;

  const blockedTask = createTask({
    projectId: project.id,
    title: "Task status wording target",
    description: "fixture",
    priority: "P1",
    type: "feature",
    status: "blocked",
    assignee: agent.id,
    labels: ["voice", "wording"],
    createdBy: "test",
  }).task;

  const binding = {
    scope: "task" as const,
    companySlug: company.slug,
    projectId: project.id,
    projectSlug: project.slug,
    projectName: project.name,
    taskId: task.id,
    taskKey: task.key,
    taskTitle: task.title,
    taskStatus: task.status,
    agentId: agent.id,
    agentName: agent.name,
    mode: "discuss" as const,
    source: "task-detail" as const,
  };

  const aliasBinding = {
    scope: "task" as const,
    companySlug: company.slug,
    projectId: project.id,
    projectSlug: project.slug,
    projectName: project.name,
    taskId: aliasTask.id,
    taskKey: aliasTask.key,
    taskTitle: aliasTask.title,
    taskStatus: aliasTask.status,
    agentId: agent.id,
    agentName: agent.name,
    mode: "discuss" as const,
    source: "task-detail" as const,
  };

  const blockedBinding = {
    scope: "task" as const,
    companySlug: company.slug,
    projectId: project.id,
    projectSlug: project.slug,
    projectName: project.name,
    taskId: blockedTask.id,
    taskKey: blockedTask.key,
    taskTitle: blockedTask.title,
    taskStatus: blockedTask.status,
    agentId: agent.id,
    agentName: agent.name,
    mode: "discuss" as const,
    source: "task-detail" as const,
  };

  await test("add_task_comment attributes the comment to the bound agent, tags it source=voice, and does not wake the assignee who just posted it", async () => {
    const first = await executeVoiceActionTool({
      tool: "add_task_comment",
      params: {
        body: "Please pick this back up and post the next concrete step when you have it.",
      },
      binding,
      sessionId: "voice-action-session",
      intentId: "intent-comment-1",
    });

    const second = await executeVoiceActionTool({
      tool: "add_task_comment",
      params: {
        body: "Please pick this back up and post the next concrete step when you have it.",
      },
      binding,
      sessionId: "voice-action-session",
      intentId: "intent-comment-1",
    });

    assert.equal(first.action, "add_task_comment");
    assert.equal(first.deduped, false);
    assert.equal(second.action, "add_task_comment");
    assert.equal(second.deduped, true);

    const comments = listTaskComments(task.id).comments;
    assert.equal(comments.length, 1);
    assert.match(comments[0]!.text, /Please pick this back up/);
    assert.equal(comments[0]!.author, agent.name);

    const db = getOrchestrationDb();
    const stored = db
      .prepare("SELECT source, external_ref, author_agent_id, author_user_id FROM comments WHERE task_id = ?")
      .all(task.id) as Array<{ source: string; external_ref: string | null; author_agent_id: string | null; author_user_id: string | null }>;
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.source, "voice");
    assert.match(stored[0]?.external_ref ?? "", /voice-action:/);
    assert.equal(stored[0]?.author_agent_id, agent.id);

    // The bound agent is both the speaker and the comment author — waking them
    // to read the comment they just posted would be redundant. Agent-authored
    // comments do not trigger the user-comment wake path.
    const wakeups = db
      .prepare("SELECT id, status, reason FROM agent_wakeup_requests WHERE agent_id = ? ORDER BY created_at ASC")
      .all(agent.id) as Array<{ id: string; status: string; reason: string | null }>;
    assert.equal(wakeups.length, 0);
  });

  await test("start_task_work moves the bound task into progress and queues a runtime wake", async () => {
    const taskToStart = createTask({
      projectId: project.id,
      title: "Voice start work target",
      description: "fixture",
      priority: "P1",
      type: "research",
      status: "to-do",
      assignee: agent.id,
      labels: ["voice", "start-work"],
      createdBy: "test",
    }).task;
    const startBinding = {
      ...binding,
      taskId: taskToStart.id,
      taskKey: taskToStart.key,
      taskTitle: taskToStart.title,
      taskStatus: taskToStart.status,
    };

    const result = await executeVoiceActionTool({
      tool: "start_task_work",
      params: {},
      binding: startBinding,
      sessionId: "voice-action-session",
      intentId: "intent-start-work-1",
    });

    assert.equal(result.action, "start_task_work");
    assert.equal(result.fromStatus, "to-do");
    assert.equal(result.toStatus, "in-progress");
    assert.equal(result.execution?.status, "queued");
    assert.ok(result.execution?.runId, "start_task_work should return the queued heartbeat run id");

    const refreshed = getTask(taskToStart.id).task;
    assert.equal(refreshed.status, "in-progress");

    const db = getOrchestrationDb();
    const wakeups = db
      .prepare("SELECT status, reason FROM agent_wakeup_requests WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1")
      .all(agent.id) as Array<{ status: string; reason: string | null }>;
    assert.equal(wakeups[0]?.status, "queued");
    assert.equal(wakeups[0]?.reason, "voice_start_task_work");
  });

  await test("move_task_status accepts common task-lane aliases like To-Do and maps them onto HiveRunner status values", async () => {
    const result = await executeVoiceActionTool({
      tool: "move_task_status",
      params: {
        status: "To-Do",
      },
      binding: aliasBinding,
      sessionId: "voice-action-session",
      intentId: "intent-status-alias-1",
    });

    assert.equal(result.action, "move_task_status");
    assert.equal(result.changed, true);
    assert.equal(result.toStatus, "to-do");

    const refreshed = getTask(aliasTask.id).task;
    assert.equal(refreshed.status, "to-do");

    const db = getOrchestrationDb();
    const statusEvents = db
      .prepare("SELECT event_type, from_status, to_status FROM task_events WHERE task_id = ? AND event_type = 'task.status_changed'")
      .all(aliasTask.id) as Array<{ event_type: string; from_status: string; to_status: string }>;
    assert.equal(statusEvents.length, 1);
    assert.equal(statusEvents[0]?.from_status, "in_progress");
    assert.equal(statusEvents[0]?.to_status, "to-do");
  });

  await test("move_task_status surfaces invalid-transition wording with user-facing labels", async () => {
    await assert.rejects(
      () => executeVoiceActionTool({
        tool: "move_task_status",
        params: { status: "done" },
        binding: blockedBinding,
        sessionId: "voice-action-session",
        intentId: "intent-status-wording-1",
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Blocked -> Done/);
        assert.doesNotMatch(error.message, /to-do|to-do/i);
        return true;
      },
    );
  });

  await test("move_task_status changes the bound task once and treats a repeated identical request as a no-op", async () => {
    const first = await executeVoiceActionTool({
      tool: "move_task_status",
      params: {
        status: "blocked",
        blockedReason: "Waiting on the Google AI key path to be fixed.",
      },
      binding,
      sessionId: "voice-action-session",
      intentId: "intent-status-1",
    });

    const second = await executeVoiceActionTool({
      tool: "move_task_status",
      params: {
        status: "blocked",
        blockedReason: "Waiting on the Google AI key path to be fixed.",
      },
      binding,
      sessionId: "voice-action-session",
      intentId: "intent-status-1",
    });

    assert.equal(first.action, "move_task_status");
    assert.equal(first.changed, true);
    assert.equal(first.toStatus, "blocked");
    assert.equal(second.action, "move_task_status");
    assert.equal(second.changed, false);
    assert.equal(second.reason, "already_in_requested_state");

    const refreshed = getTask(task.id).task;
    assert.equal(refreshed.status, "blocked");
    assert.equal(refreshed.blockedReason, "Waiting on the Google AI key path to be fixed.");

    const db = getOrchestrationDb();
    const statusEvents = db
      .prepare("SELECT event_type, from_status, to_status FROM task_events WHERE task_id = ? AND event_type = 'task.status_changed'")
      .all(task.id) as Array<{ event_type: string; from_status: string; to_status: string }>;
    assert.equal(statusEvents.length, 1);
    assert.equal(statusEvents[0]?.from_status, "in_progress");
    assert.equal(statusEvents[0]?.to_status, "blocked");
  });

  await test("task-mutating voice action tools reject non-task-bound sessions", async () => {
    await assert.rejects(
      () =>
        executeVoiceActionTool({
          tool: "add_task_comment",
          params: { body: "This should not land anywhere." },
          binding: {
            scope: "global",
            mode: "discuss",
            source: "voice-lab",
          },
          sessionId: "voice-action-session",
          intentId: "intent-global-1",
        }),
      /task-bound session/i,
    );
  });

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

void run();
