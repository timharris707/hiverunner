import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { GET as listCompanyInboxRoute } from "@/app/api/orchestration/companies/[slug]/inbox/route";
import { approveSprintPlanDraft, createCompany, createCompanyGoal, createSprintPlanDrafts } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { createProject, createProjectAgent, createTask, createTaskComment } from "@/lib/orchestration/service";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  [pass] ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      console.error(`  [fail] ${name}`);
      console.error(`    ${error instanceof Error ? error.message : String(error)}`);
    });
}

function makeGetRequest(url: string) {
  return {
    nextUrl: new URL(url),
  };
}

async function run() {
  console.log("\nOrchestration Inbox Thread Read State Regression Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  await test("thread row remains unread when latest execution event is read but another thread event is unread", async () => {
    const company = createCompany({
      name: `Inbox Thread ${Date.now()}`,
      description: "Inbox thread read-state regression fixture",
      status: "active",
    }).company;

    const project = createProject({
      companyId: company.id,
      name: `Inbox Thread Project ${Date.now()}`,
      description: "Inbox thread read-state project",
      color: "#f97316",
      emoji: "I",
      status: "active",
    }).project;

    const agent = createProjectAgent({
      projectId: project.id,
      name: `Inbox Agent ${Date.now()}`,
      emoji: "A",
      role: "Reviewer",
      personality: "Direct",
      status: "idle",
      skills: ["qa"],
    }).agent;

    const task = createTask({
      companyIdOrSlug: company.id,
      projectId: project.id,
      title: "Unread thread row fixture",
      description: "A thread with a read execution event and unread task activity.",
      priority: "P2",
      type: "feature",
      status: "review",
      assignee: agent.id,
      labels: [],
      createdBy: agent.id,
    }).task;

    createTaskComment({
      taskId: task.id,
      body: "Unread worker comment that should keep the thread unread.",
      type: "comment",
      authorAgentId: agent.id,
      source: "codex",
      createdAt: "2026-05-05T10:00:00.000Z",
    });

    const db = getOrchestrationDb();
    const runId = randomUUID();
    const completedAt = new Date(Date.now() + 60_000).toISOString();
    const startedAt = new Date(Date.now() + 59_000).toISOString();
    db.prepare(
      `INSERT INTO execution_runs
         (id, task_id, agent_id, provider, session_id, status, started_at, completed_at, error_message, token_usage_json, duration_ms, created_at, updated_at)
       VALUES
         (?, ?, ?, 'codex', ?, 'completed', ?, ?, NULL, '{}', 1000, ?, ?)`
    ).run(
      runId,
      task.id,
      agent.id,
      `session-${runId}`,
      startedAt,
      completedAt,
      startedAt,
      completedAt,
    );
    db.prepare(
      `INSERT INTO inbox_read_state (id, company_id, user_id, event_id, read_at)
       VALUES (?, ?, 'default', ?, ?)`
    ).run(randomUUID(), company.id, `execution:${runId}`, "2026-05-05T10:03:00.000Z");

    const res = await listCompanyInboxRoute(
      makeGetRequest(`http://localhost/api/orchestration/companies/${company.code}/inbox?includeDone=true&includeTaskSnapshot=false&kinds=task,approval,execution`) as never,
      { params: Promise.resolve({ slug: company.code }) }
    );
    assert.equal(res.status, 200);

    const payload = (await res.json()) as {
      unreadCount: number;
      events: Array<{ id: string; taskKey?: string; isRead: boolean }>;
    };
    const event = payload.events.find((item) => item.taskKey === task.key);
    assert.ok(event, "expected task thread in inbox");
    assert.equal(event.id, `execution:${runId}`);
    assert.equal(event.isRead, false);
    assert.equal(payload.unreadCount, 1);
  });

  await test("sprint plan draft inbox event exposes materialized proposal groups", async () => {
    const company = createCompany({
      name: `Inbox Draft ${Date.now()}`,
      description: "Inbox draft materialized regression fixture",
      status: "active",
    }).company;

    const project = createProject({
      companyId: company.id,
      name: `Inbox Draft Project ${Date.now()}`,
      description: "Inbox draft project",
      color: "#22c55e",
      emoji: "D",
      status: "active",
    }).project;

    const agent = createProjectAgent({
      projectId: project.id,
      name: `Draft Planner ${Date.now()}`,
      emoji: "P",
      role: "Planner",
      personality: "Structured",
      status: "idle",
      skills: ["planning"],
    }).agent;

    const goal = createCompanyGoal({
      companyIdOrSlug: company.id,
      projectId: project.id,
      goalKind: "company",
      name: `Inbox materialized goal ${Date.now()}`,
      goal: "Ship a multi-sprint plan",
      status: "active",
      leadAgentId: agent.id,
    }).goal;

    const planningTask = createTask({
      companyIdOrSlug: company.id,
      projectId: project.id,
      title: "Plan multi-sprint work",
      description: "Planning task fixture",
      priority: "P2",
      type: "feature",
      status: "review",
      assignee: agent.id,
      labels: [],
      createdBy: agent.id,
    }).task;

    const { drafts } = createSprintPlanDrafts({
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      planningTaskId: planningTask.id,
      proposedByAgentId: agent.id,
      drafts: [
        {
          sequenceNumber: 1,
          sprint: {
            name: "First sprint",
            objective: "Materialize initial work",
            successCriteria: ["First sprint exists"],
            validationChecks: ["Task exists"],
            outOfScope: [],
          },
          tasks: [{
            id: "draft-task-1",
            title: "First materialized task",
            description: "Task from approved draft",
            priority: "P2",
            type: "feature",
          }],
        },
        {
          sequenceNumber: 2,
          sprint: {
            name: "Second sprint",
            objective: "Keep future work editable",
            successCriteria: ["Second draft remains pending"],
            validationChecks: ["Inbox points to review"],
            outOfScope: [],
          },
          tasks: [{
            id: "draft-task-2",
            title: "Future pending task",
            description: "Task from future draft",
            priority: "P2",
            type: "feature",
          }],
        },
      ],
    });

    approveSprintPlanDraft({
      companyIdOrSlug: company.id,
      companyGoalId: goal.sprint.id,
      draftId: drafts[0].id,
      actorUserId: "inbox-test",
    });

    const res = await listCompanyInboxRoute(
      makeGetRequest(`http://localhost/api/orchestration/companies/${company.code}/inbox?includeDone=true&includeTaskSnapshot=false&kinds=sprint_plan_draft`) as never,
      { params: Promise.resolve({ slug: company.code }) }
    );
    assert.equal(res.status, 200);

    const payload = (await res.json()) as {
      events: Array<{ kind: string; draftId?: string; draftMaterialized?: boolean }>;
    };
    const event = payload.events.find((item) => item.kind === "sprint_plan_draft");
    assert.ok(event, "expected remaining draft group in inbox");
    assert.equal(event.draftId, drafts[1].id);
    assert.equal(event.draftMaterialized, true);
  });

  if (failed > 0) {
    console.error(`\n${failed} failed, ${passed} passed`);
    process.exit(1);
  }
  console.log(`\n${passed} passed`);
}

void run();
