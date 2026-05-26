import assert from "node:assert";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const TMP_TAG = `mc-provision-scaffold-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const TMP_WORKSPACE = path.join(os.tmpdir(), `${TMP_TAG}-workspace`);
const TMP_OPENCLAW = path.join(os.tmpdir(), `${TMP_TAG}-openclaw`);

// Force both paths to our tmp dirs. CLI-level env vars (e.g. from the npm
// script) would otherwise diverge from the check paths below.
process.env.MC_WORKSPACE_ROOT = TMP_WORKSPACE;
process.env.OPENCLAW_DIR = TMP_OPENCLAW;

import { materializeApprovedHireAgent } from "@/lib/orchestration/service/company-agent-provisioning";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { ensureCompanyWorkspaceScaffold } from "@/lib/workspaces/company-paths";

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
  console.log("\nProvisioning OpenClaw Scaffold Tests\n");
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const db = getOrchestrationDb();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const companyId = randomUUID();
  const companyWorkspaceRoot = path.join(TMP_WORKSPACE, "companies", `scaffold-${stamp}`);
  ensureCompanyWorkspaceScaffold(companyWorkspaceRoot);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO companies
      (id, slug, workspace_slug, runtime_slug, company_code, name, description, status,
       workspace_root, workspace_source, theme_name, theme_prompt_template,
       theme_keywords_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'fixture', 'active', ?, 'provisioned',
             'Corporate Noir', 'dark premium portrait, cohesive team style',
             '[]', ?, ?)`
  ).run(
    companyId,
    `scaffold-co-${stamp}`,
    `scaffold-co-${stamp}`,
    `scaffold-co-${stamp}`,
    `SCAF${stamp.slice(-3)}`.toUpperCase().slice(0, 6),
    `Scaffold Co ${stamp}`,
    companyWorkspaceRoot,
    now,
    now,
  );

  const projectId = randomUUID();
  db.prepare(
    `INSERT INTO projects
      (id, company_id, slug, name, description, color, status, settings_json,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, 'fixture', '#0ea5e9', 'active', '{}', ?, ?)`
  ).run(
    projectId,
    companyId,
    `scaffold-proj-${stamp}`,
    `Scaffold Proj ${stamp}`,
    now,
    now,
  );

  // Seed an existing agent with an openclaw_agent_id so the re-provision path
  // is exercised (the path that previously skipped scaffold). Using
  // randomUUID() matches the scaffold ID pattern /^[a-zA-Z0-9._-]+$/.
  const existingAgentId = randomUUID();
  const existingOpenclawId = `scaffold-existing-${stamp}`;
  db.prepare(
    `INSERT INTO agents
      (id, company_id, project_id, name, slug, runtime_slug, emoji, role,
       personality, avatar_url, status, current_task_id, model,
       openclaw_agent_id, skills_json, tasks_completed, total_runtime_minutes,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '🧩', 'Engineer', '', 'data:image/png,', 'idle',
             NULL, 'anthropic/claude-sonnet-4-6', ?, '[]', 0, 0, ?, ?)`
  ).run(
    existingAgentId,
    companyId,
    projectId,
    `Scaffold Existing ${stamp}`,
    `scaffold-existing-${stamp}`,
    `scaffold-existing-${stamp}`,
    existingOpenclawId,
    now,
    now,
  );

  // Confirm no scaffold exists yet on the openclaw side.
  const scaffoldDir = path.join(TMP_OPENCLAW, "agents", existingOpenclawId);
  const existingWorkspaceDir = path.join(companyWorkspaceRoot, "agents", `scaffold-existing-${stamp}`);
  mkdirSync(existingWorkspaceDir, { recursive: true });
  writeFileSync(
    path.join(existingWorkspaceDir, "BOOTSTRAP.md"),
    "# Bootstrap\n\nHello. Replace this with identity files.\n",
    "utf8",
  );
  assert.ok(
    !existsSync(scaffoldDir),
    "fixture precondition: scaffold dir must not exist yet",
  );

  await test("re-provisioning an existing agent materializes openclaw scaffold", () => {
    materializeApprovedHireAgent({
      approvalCompanyId: companyId,
      payload: {
        agentId: existingAgentId,
        name: `Scaffold Existing ${stamp}`,
        role: "Engineer",
        capabilities: "testing",
        reason: "fixture",
        projectId,
      },
      db,
    });

    const agentJsonPath = path.join(scaffoldDir, "agent.json");
    const soulPath = path.join(scaffoldDir, "SOUL.md");

    assert.ok(existsSync(agentJsonPath), `agent.json must exist at ${agentJsonPath}`);
    assert.ok(existsSync(soulPath), `SOUL.md must exist at ${soulPath}`);

    const config = JSON.parse(readFileSync(agentJsonPath, "utf8"));
    assert.strictEqual(config.id, existingOpenclawId);
    assert.strictEqual(config.project.slug, `scaffold-proj-${stamp}`);

    const soul = readFileSync(soulPath, "utf8");
    assert.ok(
      soul.includes(`I am Scaffold Existing ${stamp}, the Engineer`),
      `SOUL.md must name the agent, got: ${soul.slice(0, 120)}…`,
    );
    assert.ok(soul.includes("Read the codebase before changing behavior."), "SOUL.md must include role-specific rules");
    assert.strictEqual(config.metadata.voiceId, "Iapetus");
    assert.strictEqual(config.metadata.avatar.styleId, "technical-operator");
    assert.ok(!existsSync(path.join(existingWorkspaceDir, "BOOTSTRAP.md")), "placeholder BOOTSTRAP.md must be removed");
  });

  await test("scaffold is idempotent across repeated materialize calls", () => {
    // Second call should not throw and should leave files intact.
    materializeApprovedHireAgent({
      approvalCompanyId: companyId,
      payload: {
        agentId: existingAgentId,
        name: `Scaffold Existing ${stamp}`,
        role: "Engineer",
        capabilities: "testing",
        reason: "fixture",
        projectId,
      },
      db,
    });

    const agentJsonPath = path.join(scaffoldDir, "agent.json");
    assert.ok(existsSync(agentJsonPath), "agent.json must still exist after second call");
  });

  // Cleanup.
  rmSync(TMP_WORKSPACE, { recursive: true, force: true });
  rmSync(TMP_OPENCLAW, { recursive: true, force: true });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
