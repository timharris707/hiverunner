import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { createCompany } from "@/lib/orchestration/company-service";
import { listProjectAgents } from "@/lib/orchestration/service";
import { POST as createProjectRoute } from "@/app/api/orchestration/projects/route";
import { GET as getProjectBoardRoute } from "@/app/api/orchestration/projects/[id]/board/route";
import {
  GET as listProjectAgentsRoute,
  POST as createProjectAgentRoute,
} from "@/app/api/orchestration/projects/[id]/agents/route";
import { POST as createTaskRoute } from "@/app/api/orchestration/tasks/route";
import { PATCH as reorderTaskRoute } from "@/app/api/orchestration/tasks/reorder/route";
import { GET as getTaskRoute } from "@/app/api/orchestration/tasks/[id]/route";
import {
  GET as listTaskCommentsRoute,
  POST as createTaskCommentRoute,
} from "@/app/api/orchestration/tasks/[id]/comments/route";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  \u2713 ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      console.error(`  \u2717 ${name}`);
      console.error(`    ${error instanceof Error ? error.message : String(error)}`);
    });
}

function makeJsonRequest(url: string, body: unknown) {
  return {
    url,
    nextUrl: new URL(url),
    async json() {
      return body;
    },
  };
}

async function run() {
  console.log("\nOrchestration Foundation Workflow Regression Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const company = createCompany({
    name: `Workflow Scope ${Date.now()}`,
    description: "Workflow regression fixture",
    status: "active",
  }).company;

  const createProjectRes = await createProjectRoute(
    makeJsonRequest("http://localhost/api/orchestration/projects", {
      companyId: company.id,
      name: `Foundation Workflow ${Date.now()}`,
      description: "Project create -> agent add -> task create -> board move -> detail -> completion",
      color: "#14b8a6",
      emoji: "\ud83d\udef0\ufe0f",
      status: "active",
    }) as never
  );
  assert.equal(createProjectRes.status, 201);
  const createProjectPayload = (await createProjectRes.json()) as {
    project: { id: string; name: string };
  };
  const projectId = createProjectPayload.project.id;

  const createAgentRes = await createProjectAgentRoute(
    makeJsonRequest(`http://localhost/api/orchestration/projects/${projectId}/agents`, {
      name: `Workflow Agent ${Date.now()}`,
      emoji: "\ud83d\udee1\ufe0f",
      role: "QA Engineer",
      personality: "Strict and reproducible",
      status: "idle",
      skills: ["regression"],
    }) as never,
    { params: Promise.resolve({ id: projectId }) }
  );
  assert.equal(createAgentRes.status, 201);
  const createAgentPayload = (await createAgentRes.json()) as {
    agent: { id: string; name: string };
  };
  const agentId = createAgentPayload.agent.id;

  const createTaskRes = await createTaskRoute(
    makeJsonRequest("http://localhost/api/orchestration/tasks", {
      projectId,
      title: "Workflow regression task",
      description: "Fixture task for board/detail/completion coverage",
      priority: "P1",
      type: "feature",
      status: "backlog",
      assignee: agentId,
      labels: ["workflow", "regression"],
      createdBy: "test-suite",
    }) as never
  );
  assert.equal(createTaskRes.status, 201);
  const createTaskPayload = (await createTaskRes.json()) as {
    task: { id: string; status: string; assignee?: string };
  };
  const taskId = createTaskPayload.task.id;

  await test("project create and agent add routes persist workflow entities", async () => {
    const res = await listProjectAgentsRoute(
      { nextUrl: new URL(`http://localhost/api/orchestration/projects/${projectId}/agents`) } as never,
      { params: Promise.resolve({ id: projectId }) }
    );
    assert.equal(res.status, 200);
    const payload = (await res.json()) as { agents: Array<{ id: string; name: string }> };
    assert.ok(payload.agents.some((agent) => agent.id === agentId));
  });

  await test("task create route surfaces backlog task on the board", async () => {
    const res = await getProjectBoardRoute(
      { nextUrl: new URL(`http://localhost/api/orchestration/projects/${projectId}/board`) } as never,
      { params: Promise.resolve({ id: projectId }) }
    );
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      tasks: Array<{ id: string; status: string; assignee?: string }>;
    };
    const task = payload.tasks.find((row) => row.id === taskId);
    assert.ok(task);
    assert.equal(task?.status, "backlog");
    assert.equal(task?.assignee, createAgentPayload.agent.name);
  });

  await test("detail route includes unified task detail payload for the drawer", async () => {
    const commentRes = await createTaskCommentRoute(
      makeJsonRequest(`http://localhost/api/orchestration/tasks/${taskId}/comments`, {
        body: "QA note: task opened from workflow regression test.",
        type: "comment",
        authorAgentId: agentId,
      }) as never,
      { params: Promise.resolve({ id: taskId }) }
    );
    assert.equal(commentRes.status, 201);

    const listCommentsRes = await listTaskCommentsRoute(
      { nextUrl: new URL(`http://localhost/api/orchestration/tasks/${taskId}/comments`) } as never,
      { params: Promise.resolve({ id: taskId }) }
    );
    assert.equal(listCommentsRes.status, 200);
    const commentsPayload = (await listCommentsRes.json()) as {
      comments: Array<{ text: string; author: string }>;
    };
    assert.equal(commentsPayload.comments.length, 1);
    assert.equal(commentsPayload.comments[0]?.author, createAgentPayload.agent.name);

    const detailRes = await getTaskRoute(
      { nextUrl: new URL(`http://localhost/api/orchestration/tasks/${taskId}`) } as never,
      { params: Promise.resolve({ id: taskId }) }
    );
    assert.equal(detailRes.status, 200);
    const detailPayload = (await detailRes.json()) as {
      task: { id: string; comments?: Array<{ text: string }> };
      detail?: {
        task: { id: string; title: string };
        timeline: Array<{ summary: string; provenance: string; body?: string }>;
        childTasks: Array<{ id: string }>;
        runSummary: { totalRuns: number; structuredActionCount: number; importedReportCount: number };
      };
    };
    assert.equal(detailPayload.task.id, taskId);
    assert.equal(detailPayload.task.comments?.[0]?.text, "QA note: task opened from workflow regression test.");
    assert.equal(detailPayload.detail?.task.id, taskId);
    assert.ok(Array.isArray(detailPayload.detail?.timeline));
    assert.ok(detailPayload.detail!.timeline.some((item) => item.provenance === "comment" && item.body === "QA note: task opened from workflow regression test."));
    assert.ok(Array.isArray(detailPayload.detail?.childTasks));
    assert.equal(typeof detailPayload.detail?.runSummary.totalRuns, "number");
    assert.equal(typeof detailPayload.detail?.runSummary.structuredActionCount, "number");
    assert.equal(typeof detailPayload.detail?.runSummary.importedReportCount, "number");
  });

  await test("board move flows backlog -> to-do -> in-progress and marks the agent working", async () => {
    const onDeckRes = await reorderTaskRoute(
      makeJsonRequest("http://localhost/api/orchestration/tasks/reorder", {
        taskId,
        status: "to-do",
        actorUserId: "test-suite",
      }) as never
    );
    assert.equal(onDeckRes.status, 200);
    const onDeckPayload = (await onDeckRes.json()) as {
      task: { status: string };
      transition: { from: string; to: string; statusChanged: boolean };
      heartbeat: { attempted: boolean; status: string; reason?: string };
    };
    assert.equal(onDeckPayload.transition.from, "backlog");
    assert.equal(onDeckPayload.transition.to, "to-do");
    assert.equal(onDeckPayload.task.status, "to-do");
    assert.equal(onDeckPayload.heartbeat.attempted, false);
    assert.equal(onDeckPayload.heartbeat.reason, "no_in_progress_transition");

    const inProgressRes = await reorderTaskRoute(
      makeJsonRequest("http://localhost/api/orchestration/tasks/reorder", {
        taskId,
        status: "in-progress",
        actorUserId: "test-suite",
      }) as never
    );
    assert.equal(inProgressRes.status, 200);
    const payload = (await inProgressRes.json()) as {
      task: { status: string; assignee?: string };
      transition: { from: string; to: string; statusChanged: boolean };
      heartbeat: { attempted: boolean; status: string; reason?: string };
    };
    assert.equal(payload.transition.from, "to-do");
    assert.equal(payload.transition.to, "in-progress");
    assert.equal(payload.transition.statusChanged, true);
    assert.equal(payload.task.assignee, createAgentPayload.agent.name);
    assert.equal(payload.heartbeat.attempted, true);
    assert.equal(payload.heartbeat.status, "skipped");
    assert.equal(payload.heartbeat.reason, "manual_runtime");

    const agents = listProjectAgents(projectId).agents;
    const updatedAgent = agents.find((agent) => agent.id === agentId);
    assert.equal(updatedAgent?.status, "working");
    assert.equal(updatedAgent?.currentTask, "Workflow regression task");
  });

  await test("completion requires review notes and returns completedAt in board/detail payloads", async () => {
    const reviewRes = await reorderTaskRoute(
      makeJsonRequest("http://localhost/api/orchestration/tasks/reorder", {
        taskId,
        status: "review",
        actorUserId: "test-suite",
      }) as never
    );
    assert.equal(reviewRes.status, 200);

    const rejectedDoneRes = await reorderTaskRoute(
      makeJsonRequest("http://localhost/api/orchestration/tasks/reorder", {
        taskId,
        status: "done",
        actorUserId: "test-suite",
      }) as never
    );
    assert.equal(rejectedDoneRes.status, 400);
    const rejectedDonePayload = (await rejectedDoneRes.json()) as { error: { code: string } };
    assert.equal(rejectedDonePayload.error.code, "review_notes_required");

    const doneRes = await reorderTaskRoute(
      makeJsonRequest("http://localhost/api/orchestration/tasks/reorder", {
        taskId,
        status: "done",
        actorUserId: "test-suite",
        reviewNotes: "QA verified workflow completion regression path.",
      }) as never
    );
    assert.equal(doneRes.status, 200);
    const donePayload = (await doneRes.json()) as {
      task: { status: string; completedAt?: string };
      heartbeat: { attempted: boolean; reason?: string };
    };
    assert.equal(donePayload.task.status, "done");
    assert.ok(donePayload.task.completedAt);
    assert.equal(donePayload.heartbeat.attempted, false);
    assert.equal(donePayload.heartbeat.reason, "no_in_progress_transition");

    const boardRes = await getProjectBoardRoute(
      { nextUrl: new URL(`http://localhost/api/orchestration/projects/${projectId}/board`) } as never,
      { params: Promise.resolve({ id: projectId }) }
    );
    assert.equal(boardRes.status, 200);
    const boardPayload = (await boardRes.json()) as {
      tasks: Array<{ id: string; status: string; completedAt?: string }>;
    };
    const boardTask = boardPayload.tasks.find((row) => row.id === taskId);
    assert.equal(boardTask?.status, "done");
    assert.ok(boardTask?.completedAt, "Expected completedAt on board task payload");

    const detailRes = await getTaskRoute(
      { nextUrl: new URL(`http://localhost/api/orchestration/tasks/${taskId}`) } as never,
      { params: Promise.resolve({ id: taskId }) }
    );
    assert.equal(detailRes.status, 200);
    const detailPayload = (await detailRes.json()) as {
      task: { status: string; completedAt?: string };
    };
    assert.equal(detailPayload.task.status, "done");
    assert.ok(detailPayload.task.completedAt, "Expected completedAt on detail payload");

    const agents = listProjectAgents(projectId).agents;
    const updatedAgent = agents.find((agent) => agent.id === agentId);
    assert.equal(updatedAgent?.status, "idle");
    assert.equal(updatedAgent?.currentTask, undefined);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
