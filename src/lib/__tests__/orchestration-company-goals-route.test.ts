import assert from "node:assert";
import { rmSync } from "node:fs";

import { createCompany } from "@/lib/orchestration/company-service";
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

  await test("DELETE removes a goal by sprint id", async () => {
    const req = {
      async json() {
        return { sprintId };
      },
    };

    const res = await deleteCompanyGoalsRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });

    assert.strictEqual(res.status, 200);
    const payload = (await res.json()) as { sprintId: string; projectId: string; deletedAt: string };
    assert.strictEqual(payload.sprintId, sprintId);
    assert.strictEqual(payload.projectId, project.id);
    assert.ok(typeof payload.deletedAt === "string" && payload.deletedAt.length > 0);
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
