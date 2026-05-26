import assert from "node:assert";
import { rmSync } from "node:fs";

import { createCompany, getCompany } from "@/lib/orchestration/company-service";
import { GET as listCompanyProjectsRoute } from "@/app/api/orchestration/companies/[slug]/projects/route";
import { createProject, listProjects } from "@/lib/orchestration/service";

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
  console.log("\nOrchestration Company Workspace & Project Scope Tests\n");

  process.env.MC_WORKSPACE_ROOT = "/tmp/mission-control-phase2-workspaces";

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const freshCompany = createCompany({
    name: `Workspace Scope ${Date.now()}`,
    description: "fixture",
    status: "active",
  }).company;

  const freshCompanyView = getCompany(freshCompany.slug).company;

  await test("new company gets an isolated workspace binding", () => {
    assert.strictEqual(
      freshCompanyView.workspaceSlug,
      freshCompany.slug,
      "Expected new company workspace_slug to freeze the creation-time route slug",
    );
    assert.ok(
      freshCompanyView.workspace.root.endsWith(`/companies/${freshCompany.slug}`),
      "Expected non-default company workspace root under /companies/<company-slug>"
    );
    assert.ok(
      freshCompanyView.workspace.root.startsWith(process.env.MC_WORKSPACE_ROOT || ""),
      "Expected non-default company workspace root under MC_WORKSPACE_ROOT"
    );
    assert.strictEqual(freshCompanyView.workspace.source, "provisioned");
  });

  await test("new company does not inherit existing projects by default", () => {
    const scoped = listProjects({ companyIdOrSlug: freshCompany.slug }).projects;
    assert.strictEqual(scoped.length, 0, "Expected fresh company to start with zero projects");
  });

  createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
    name: `Default Company Project ${Date.now()}`,
    description: "default company production project",
    color: "#0ea5e9",
    emoji: "🛰️",
    status: "active",
  });

  const productionProject = createProject({
    companyId: freshCompany.id,
    name: `Scoped Production ${Date.now()}`,
    description: "production scoped project",
    color: "#22c55e",
    emoji: "🧭",
    status: "active",
  }).project;

  createProject({
    companyId: freshCompany.id,
    name: `[TEST] Demo Scope ${Date.now()}`,
    description: "test fixture should be hidden by default",
    color: "#f97316",
    emoji: "🧪",
    status: "active",
  });

  await test("company-scoped projects route returns company-scoped projects", async () => {
    const req = { nextUrl: new URL(`http://localhost/api/orchestration/companies/${freshCompany.slug}/projects`) };
    const res = await listCompanyProjectsRoute(req as never, {
      params: Promise.resolve({ slug: freshCompany.slug }),
    });
    assert.strictEqual(res.status, 200);

    const payload = (await res.json()) as { projects: Array<{ id: string }> };
    const ids = payload.projects.map((project) => project.id);
    assert.ok(ids.includes(productionProject.id), "Expected production project in scoped response");
    assert.strictEqual(ids.length, 2, "Expected scoped response to include only this company's projects");
  });

  await test("company-scoped projects route supports includeNonProduction=true", async () => {
    const req = {
      nextUrl: new URL(
        `http://localhost/api/orchestration/companies/${freshCompany.slug}/projects?includeNonProduction=true`
      ),
    };
    const res = await listCompanyProjectsRoute(req as never, {
      params: Promise.resolve({ slug: freshCompany.slug }),
    });
    assert.strictEqual(res.status, 200);

    const payload = (await res.json()) as { projects: Array<{ id: string }> };
    const ids = payload.projects.map((project) => project.id);
    assert.ok(ids.includes(productionProject.id), "Expected production project in includeNonProduction response");
    assert.ok(ids.length >= 2, "Expected test/demo project included when includeNonProduction=true");
  });

  await test("NeverIdle company keeps clean managed workspace root binding", () => {
    const defaultCompany = getCompany("neveridle-core").company;
    assert.strictEqual(
      defaultCompany.workspace.root,
      `${process.env.MC_WORKSPACE_ROOT}/companies/neveridle-core`,
    );
    assert.strictEqual(defaultCompany.workspace.source, "provisioned");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
