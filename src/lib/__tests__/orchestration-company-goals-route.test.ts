import assert from "node:assert";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { createProject } from "@/lib/orchestration/service";
import {
  DELETE as deleteCompanyGoalsRoute,
  GET as getCompanyGoalsRoute,
  PATCH as patchCompanyGoalsRoute,
  POST as postCompanyGoalsRoute,
} from "@/app/api/orchestration/companies/[slug]/goals/route";

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
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  \u2717 ${name}`);
      console.error(`    ${message}`);
    });
}

async function run() {
  console.log("\nOrchestration Company Goals Route Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const company = createCompany({
    name: `Goals Scope ${Date.now()}`,
    description: "fixture",
    status: "active",
  }).company;

  const project = createProject({
    companyId: company.id,
    name: `Goals Project ${Date.now()}`,
    description: "fixture",
    color: "#22c55e",
    emoji: "\ud83e\udded",
    status: "active",
  }).project;

  let sprintId = "";
  let childSprintId = "";

  await test("POST creates a company-scoped goal and returns goal payload", async () => {
    const req = {
      async json() {
        return {
          projectId: project.id,
          name: "Sprint Goal Alpha",
          goal: "Ship goal CRUD endpoint",
          status: "planned",
        };
      },
    };

    const res = await postCompanyGoalsRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });

    assert.strictEqual(res.status, 201);
    const payload = (await res.json()) as {
      company: { id: string };
      goal: { sprint: { id: string; name: string; goal: string; status: string }; projectId: string };
    };

    assert.strictEqual(payload.company.id, company.id);
    assert.strictEqual(payload.goal.projectId, project.id);
    assert.strictEqual(payload.goal.sprint.name, "Sprint Goal Alpha");
    assert.strictEqual(payload.goal.sprint.goal, "Ship goal CRUD endpoint");
    assert.strictEqual(payload.goal.sprint.status, "planned");
    sprintId = payload.goal.sprint.id;
  });

  await test("PATCH updates goal fields and status", async () => {
    const req = {
      async json() {
        return {
          sprintId,
          goal: "Ship and verify company goals CRUD endpoint",
          status: "active",
        };
      },
    };

    const res = await patchCompanyGoalsRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });

    assert.strictEqual(res.status, 200);
    const payload = (await res.json()) as {
      goal: { sprint: { id: string; goal: string; status: string } };
    };

    assert.strictEqual(payload.goal.sprint.id, sprintId);
    assert.strictEqual(payload.goal.sprint.goal, "Ship and verify company goals CRUD endpoint");
    assert.strictEqual(payload.goal.sprint.status, "active");
  });

  await test("GET lists updated goals for the company", async () => {
    const req = {
      nextUrl: new URL(`http://localhost/api/orchestration/companies/${company.slug}/goals`),
    };

    const res = await getCompanyGoalsRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });

    assert.strictEqual(res.status, 200);
    const payload = (await res.json()) as {
      goals: Array<{ sprint: { id: string; status: string } }>;
      summary: { total: number; active: number };
    };

    assert.ok(payload.goals.some((goal) => goal.sprint.id === sprintId));
    assert.strictEqual(payload.summary.total, 1);
    assert.strictEqual(payload.summary.active, 1);
  });

  await test("GET resolves goals by stable company code", async () => {
    const req = {
      nextUrl: new URL(`http://localhost/api/orchestration/companies/${company.code}/goals`),
    };

    const res = await getCompanyGoalsRoute(req as never, {
      params: Promise.resolve({ slug: company.code }),
    });

    assert.strictEqual(res.status, 200);
    const payload = (await res.json()) as {
      company: { id: string; code: string };
      goals: Array<{ sprint: { id: string } }>;
    };

    assert.strictEqual(payload.company.id, company.id);
    assert.strictEqual(payload.company.code, company.code);
    assert.ok(payload.goals.some((goal) => goal.sprint.id === sprintId));
  });

  await test("POST creates a child sprint under the company goal", async () => {
    const req = {
      async json() {
        return {
          projectId: project.id,
          parentId: sprintId,
          goalKind: "sprint",
          name: "Sprint Goal Alpha - execution slice",
          goal: "Build the first execution slice",
          status: "planned",
        };
      },
    };

    const res = await postCompanyGoalsRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });

    assert.strictEqual(res.status, 201);
    const payload = (await res.json()) as {
      goal: { sprint: { id: string; parentId: string | null; goalKind: string | null } };
    };

    childSprintId = payload.goal.sprint.id;
    assert.strictEqual(payload.goal.sprint.parentId, sprintId);
    assert.strictEqual(payload.goal.sprint.goalKind, "sprint");

    const db = getOrchestrationDb();
    db.prepare(
      `INSERT INTO tasks (id, project_id, sprint_id, title, description, priority, type, status, created_by, company_id, task_key)
       VALUES (?, ?, ?, 'Delete cascade fixture task', 'fixture', 'medium', 'feature', 'to-do', 'system', ?, 'DEL-1')`
    ).run(randomUUID(), project.id, childSprintId, company.id);
    db.prepare(
      `INSERT INTO goal_sprint_plan_drafts (id, company_id, company_goal_id, status, sprint_json, tasks_json)
       VALUES (?, ?, ?, 'pending', '{}', '[]')`
    ).run(randomUUID(), company.id, sprintId);
    db.prepare(
      `INSERT INTO goal_contract_items (id, sprint_id, kind, text, position)
       VALUES (?, ?, 'success_criterion', 'Delete cascade fixture contract item', 0)`
    ).run(randomUUID(), childSprintId);
  });

  await test("DELETE removes a goal subtree by sprint id", async () => {
    const req = {
      async json() {
        return { sprintId };
      },
    };

    const res = await deleteCompanyGoalsRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });

    assert.strictEqual(res.status, 200);
    const payload = (await res.json()) as { sprintId: string; sprintIds: string[]; taskIds: string[]; projectId: string; deletedAt: string };
    assert.strictEqual(payload.sprintId, sprintId);
    assert.ok(payload.sprintIds.includes(sprintId));
    assert.ok(payload.sprintIds.includes(childSprintId));
    assert.strictEqual(payload.taskIds.length, 1);
    assert.strictEqual(payload.projectId, project.id);
    assert.ok(typeof payload.deletedAt === "string" && payload.deletedAt.length > 0);

    const db = getOrchestrationDb();
    const remainingSprints = db.prepare("SELECT COUNT(*) AS count FROM sprints WHERE id IN (?, ?)").get(sprintId, childSprintId) as { count: number };
    const remainingTasks = db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE sprint_id IN (?, ?)").get(sprintId, childSprintId) as { count: number };
    const remainingDrafts = db.prepare("SELECT COUNT(*) AS count FROM goal_sprint_plan_drafts WHERE company_goal_id = ?").get(sprintId) as { count: number };
    const remainingContractItems = db.prepare("SELECT COUNT(*) AS count FROM goal_contract_items WHERE sprint_id IN (?, ?)").get(sprintId, childSprintId) as { count: number };
    assert.strictEqual(remainingSprints.count, 0);
    assert.strictEqual(remainingTasks.count, 0);
    assert.strictEqual(remainingDrafts.count, 0);
    assert.strictEqual(remainingContractItems.count, 0);
  });

  await test("PATCH rejects payloads that do not include updatable fields", async () => {
    const req = {
      async json() {
        return { sprintId };
      },
    };

    const res = await patchCompanyGoalsRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });

    assert.strictEqual(res.status, 400);
    const payload = (await res.json()) as {
      error: { code: string; message: string };
    };
    assert.strictEqual(payload.error.code, "validation_error");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
