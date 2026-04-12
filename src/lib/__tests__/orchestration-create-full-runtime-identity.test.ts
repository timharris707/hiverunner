import assert from "node:assert";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  console.log("\nCreate Full Runtime Identity Tests\n");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "orchestration-create-full-runtime-identity-"));
  const homeDir = path.join(tempRoot, "home");
  const binDir = path.join(tempRoot, "bin");
  const dbPath = path.join(tempRoot, "orchestration.db");
  const mcWorkspaceRoot = path.join(homeDir, ".mission-control", "dev", "workspaces");
  const mcToolSource = path.join(
    homeDir,
    ".openclaw",
    "workspace",
    "projects",
    "mission-control-app",
    "scripts",
    "mc-tool.js",
  );
  const fakeOpenClawPath = path.join(binDir, "openclaw");

  mkdirSync(path.dirname(mcToolSource), { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(mcWorkspaceRoot, { recursive: true });

  writeFileSync(mcToolSource, "#!/usr/bin/env node\nconsole.log('mc-tool fixture');\n", "utf8");
  chmodSync(mcToolSource, 0o755);

  writeFileSync(
    fakeOpenClawPath,
    "#!/bin/sh\nif [ \"$1\" = \"agents\" ] && [ \"$2\" = \"add\" ]; then\n  printf '{\"agentId\":\"%s\"}\\n' \"$3\"\n  exit 0\nfi\nexit 1\n",
    "utf8",
  );
  chmodSync(fakeOpenClawPath, 0o755);

  process.env.HOME = homeDir;
  process.env.ORCHESTRATION_DB_PATH = dbPath;
  process.env.MC_WORKSPACE_ROOT = mcWorkspaceRoot;
  process.env.NODE_ENV = "development";
  process.env.PATH = `${binDir}:${process.env.PATH || ""}`;

  const { POST: createFullRoute } = await import("@/app/api/orchestration/companies/create-full/route");
  const { closeOrchestrationDb, getOrchestrationDb } = await import("@/lib/orchestration/db");

  await test("create-full provisions a human-readable OpenClaw runtime id for the CEO", async () => {
    const req = {
      async json() {
        return {
          company: {
            name: "Runtime Identity Co",
            slug: "runtime-identity-co",
            description: "Fixture company for create-full runtime identity coverage.",
          },
          project: {
            name: "Operations",
            description: "Initial project",
          },
          ceo: {
            name: "Forge",
            model: "openai/gpt-5.4",
            guidance: "",
          },
          task: {
            title: "Ship the first milestone",
            description: "Kick off execution for the first milestone.",
            priority: "P1",
          },
        };
      },
    };

    const res = await createFullRoute(req as never);
    assert.strictEqual(res.status, 201);

    const payload = (await res.json()) as {
      company: { id: string; slug: string };
      agent: { id: string; openclawAgentId: string | null };
      agentDir: string;
      workspace: string;
    };

    const db = getOrchestrationDb();
    const row = db
      .prepare(
        `SELECT c.runtime_slug AS company_runtime_slug, a.runtime_slug AS agent_runtime_slug, a.openclaw_agent_id
         FROM agents a
         INNER JOIN companies c ON c.id = a.company_id
         WHERE a.id = ?`,
      )
      .get(payload.agent.id) as
      | {
          company_runtime_slug: string | null;
          agent_runtime_slug: string | null;
          openclaw_agent_id: string | null;
        }
      | undefined;

    const expectedRuntimeId = `mc-${row?.company_runtime_slug}-forge`;
    assert.ok(row, "Expected CEO agent row to exist");
    assert.strictEqual(row?.agent_runtime_slug, "forge");
    assert.strictEqual(payload.agent.openclawAgentId, expectedRuntimeId);
    assert.strictEqual(row?.openclaw_agent_id, expectedRuntimeId);
    assert.ok(payload.workspace.includes("/.mission-control/dev/workspaces/companies/runtime-identity-co--"));
    assert.ok(payload.agentDir.endsWith("/agents/forge"));
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
