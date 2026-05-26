import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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
  console.log("\nOrchestration Import/Export Runtime Identity Tests\n");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "orchestration-import-export-runtime-identity-"));
  const dbPath = path.join(tempRoot, "orchestration.db");

  process.env.ORCHESTRATION_DB_PATH = dbPath;

  const { createCompany } = await import("@/lib/orchestration/company-service");
  const { createProject, createProjectAgent } = await import("@/lib/orchestration/service");
  const { closeOrchestrationDb, getOrchestrationDb } = await import("@/lib/orchestration/db");
  const { GET: exportCompanyRoute } = await import("@/app/api/orchestration/companies/[slug]/export/route");
  const { POST: importCompanyRoute } = await import("@/app/api/orchestration/companies/[slug]/import/route");

  const db = getOrchestrationDb();

  const sourceCompany = createCompany({
    name: "Runtime Identity Source",
    description: "fixture",
    status: "active",
  }).company;
  const sourceProject = createProject({
    companyId: sourceCompany.id,
    name: "Runtime Identity Project",
    description: "fixture",
    color: "#0ea5e9",
    emoji: "\ud83e\uddea",
    status: "active",
  }).project;
  const sourceAgent = createProjectAgent({
    projectId: sourceProject.id,
    name: "Forge",
    emoji: "\ud83d\udd27",
    role: "Backend Engineer",
    personality: "Systematic",
    model: "openai/gpt-5.4",
    openclawAgentId: `mc-${sourceCompany.runtimeSlug}-forge`,
    status: "idle",
    skills: [],
  }).agent;

  let exportedPackage: Record<string, unknown> | null = null;

  await test("export includes company runtime slug and agent runtime identity fields", async () => {
    const req = {
      nextUrl: new URL(
        `http://localhost/api/orchestration/companies/${sourceCompany.slug}/export?categories=company,projects,agents`,
      ),
    };

    const res = await exportCompanyRoute(req as never, {
      params: Promise.resolve({ slug: sourceCompany.slug }),
    });

    assert.strictEqual(res.status, 200);
    const payload = (await res.json()) as {
      company: { id?: string; runtimeSlug?: string };
      agents: Array<{ runtimeSlug?: string; openclawAgentId?: string }>;
    };

    exportedPackage = payload as unknown as Record<string, unknown>;
    assert.strictEqual(payload.company.id, sourceCompany.id);
    assert.strictEqual(payload.company.runtimeSlug, sourceCompany.runtimeSlug);
    assert.strictEqual(payload.agents.length, 1);
    assert.strictEqual(payload.agents[0]?.runtimeSlug, sourceAgent.runtimeSlug);
    assert.strictEqual(payload.agents[0]?.openclawAgentId, sourceAgent.openclawAgentId);
  });

  db.prepare("UPDATE companies SET runtime_slug = NULL WHERE id = ?").run(sourceCompany.id);
  db.prepare("UPDATE agents SET runtime_slug = NULL, openclaw_agent_id = NULL WHERE id = ?").run(sourceAgent.id);

  await test("import restores runtime identity fields onto the same company and agent rows", async () => {
    assert.ok(exportedPackage, "Expected export package to be available");

    const req = {
      async json() {
        return {
          package: exportedPackage,
          strategy: "overwrite",
        };
      },
    };

    const res = await importCompanyRoute(req as never, {
      params: Promise.resolve({ slug: sourceCompany.slug }),
    });

    assert.strictEqual(res.status, 200);

    const importedCompany = db
      .prepare("SELECT runtime_slug FROM companies WHERE id = ?")
      .get(sourceCompany.id) as { runtime_slug: string | null } | undefined;
    const importedAgent = db
      .prepare(
        `SELECT runtime_slug, openclaw_agent_id
         FROM agents
         WHERE id = ?
         LIMIT 1`,
      )
      .get(sourceAgent.id) as
      | {
          runtime_slug: string | null;
          openclaw_agent_id: string | null;
        }
      | undefined;

    assert.strictEqual(importedCompany?.runtime_slug, sourceCompany.runtimeSlug);
    assert.strictEqual(importedAgent?.runtime_slug, sourceAgent.runtimeSlug ?? null);
    assert.strictEqual(importedAgent?.openclaw_agent_id, sourceAgent.openclawAgentId ?? null);
  });

  closeOrchestrationDb();
  rmSync(tempRoot, { force: true, recursive: true });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
