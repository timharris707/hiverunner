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

  const todoTask = createTask({
    projectId: project.id,
    title: "Task status wording target",
    description: "fixture",
    priority: "P1",
    type: "feature",
    status: "on-deck",
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

  const todoBinding = {
    scope: "task" as const,
    companySlug: company.slug,
    projectId: project.id,
    projectSlug: project.slug,
    projectName: project.name,
    taskId: todoTask.id,
    taskKey: todoTask.key,
    taskTitle: todoTask.title,
    taskStatus: todoTask.status,
    agentId: agent.id,
    agentName: agent.name,
    mode: "discuss" as const,
    source: "task-detail" as const,
  };

  await test("add_task_comment attributes the comment to the bound agent, tags it source=voice, and does not wake the assignee who just posted it", () => {
    const first = executeVoiceActionTool({
      tool: "add_task_comment",
      params: {
        body: "Please pick this back up and post the next concrete step when you have it.",
      },
      binding,
      sessionId: "voice-action-session",
      intentId: "intent-comment-1",
    });

    const second = executeVoiceActionTool({
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

  await test("move_task_status accepts common task-lane aliases like To-Do and maps them onto Mission Control status values", () => {
    const result = executeVoiceActionTool({
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
    assert.equal(result.toStatus, "on-deck");

    const refreshed = getTask(aliasTask.id).task;
    assert.equal(refreshed.status, "on-deck");

    const db = getOrchestrationDb();
    const statusEvents = db
      .prepare("SELECT event_type, from_status, to_status FROM task_events WHERE task_id = ? AND event_type = 'task.status_changed'")
      .all(aliasTask.id) as Array<{ event_type: string; from_status: string; to_status: string }>;
    assert.equal(statusEvents.length, 1);
    assert.equal(statusEvents[0]?.from_status, "in_progress");
    assert.equal(statusEvents[0]?.to_status, "on_deck");
  });

  await test("move_task_status surfaces invalid-transition wording with user-facing To-Do instead of internal on-deck", () => {
    assert.throws(
      () => executeVoiceActionTool({
        tool: "move_task_status",
        params: {
          status: "done",
        },
        binding: todoBinding,
        sessionId: "voice-action-session",
        intentId: "intent-status-wording-1",
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /To-Do -> Done/);
        assert.doesNotMatch(error.message, /on-deck|on_deck/i);
        return true;
      },
    );
  });

  await test("move_task_status changes the bound task once and treats a repeated identical request as a no-op", () => {
    const first = executeVoiceActionTool({
      tool: "move_task_status",
      params: {
        status: "blocked",
        blockedReason: "Waiting on the Google AI key path to be fixed.",
      },
      binding,
      sessionId: "voice-action-session",
      intentId: "intent-status-1",
    });

    const second = executeVoiceActionTool({
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

  await test("task-mutating voice action tools reject non-task-bound sessions", () => {
    assert.throws(
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
