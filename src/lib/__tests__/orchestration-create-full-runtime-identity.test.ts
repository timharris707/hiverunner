import assert from "node:assert";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

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
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";
  process.env.PATH = `${binDir}:${process.env.PATH || ""}`;

  const { POST: createFullRoute } = await import("@/app/api/orchestration/companies/create-full/route");
  const { provisionSelectedStarterAgentsForCreateFull } = await import("@/lib/orchestration/create-full-starter-team-provisioning");
  const { closeOrchestrationDb, getOrchestrationDb } = await import("@/lib/orchestration/db");

  await test("create-full provisions a human-readable OpenClaw runtime id for the CEO when explicitly enabled", async () => {
    process.env.MC_ENABLE_OPENCLAW_AGENT_PROVISIONING = "1";
    const req = {
      async json() {
        return {
          company: {
            name: "Runtime Identity Co",
            slug: "runtime-identity-co",
            description: "Fixture company for create-full runtime identity coverage.",
          },
          owner: {
            displayName: "Test Owner",
            email: "owner@example.test",
          },
          project: {
            name: "Operations",
            description: "Initial project",
          },
          ceo: {
            name: "Forge",
            runtimeProvider: "openclaw",
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

    let res: Awaited<ReturnType<typeof createFullRoute>>;
    try {
      res = await createFullRoute(req as never);
    } finally {
      delete process.env.MC_ENABLE_OPENCLAW_AGENT_PROVISIONING;
    }
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
        `SELECT c.runtime_slug AS company_runtime_slug, a.runtime_slug AS agent_runtime_slug,
                a.openclaw_agent_id, a.avatar_style_id, a.avatar_gender, a.voice_id,
                a.avatar_url, a.emoji
         FROM agents a
         INNER JOIN companies c ON c.id = a.company_id
         WHERE a.id = ?`,
      )
      .get(payload.agent.id) as
      | {
          company_runtime_slug: string | null;
          agent_runtime_slug: string | null;
          openclaw_agent_id: string | null;
          avatar_style_id: string | null;
          avatar_gender: string | null;
          voice_id: string | null;
          avatar_url: string | null;
          emoji: string | null;
        }
      | undefined;

    const expectedRuntimeId = `mc-${row?.company_runtime_slug}-forge`;
    assert.ok(row, "Expected CEO agent row to exist");
    assert.strictEqual(row?.agent_runtime_slug, "forge");
    assert.strictEqual(payload.agent.openclawAgentId, expectedRuntimeId);
    assert.strictEqual(row?.openclaw_agent_id, expectedRuntimeId);
    assert.strictEqual(row?.avatar_style_id, "editorial-executive");
    assert.strictEqual(row?.avatar_gender, "androgynous");
    assert.strictEqual(row?.voice_id, "Orus");
    assert.strictEqual(row?.avatar_url, null);
    assert.strictEqual(row?.emoji, "icon:crown");
    assert.ok(payload.workspace.startsWith(mcWorkspaceRoot), `workspace must live under ${mcWorkspaceRoot}`);
    assert.ok(payload.workspace.includes("runtime-identity-co"));
    assert.ok(payload.agentDir.endsWith("/agents/forge"));

    for (const fileName of ["IDENTITY.md", "SOUL.md", "AGENTS.md", "HEARTBEAT.md", "TOOLS.md"]) {
      assert.ok(existsSync(path.join(payload.agentDir, fileName)), `${fileName} must be written`);
    }

    const identity = readFileSync(path.join(payload.agentDir, "IDENTITY.md"), "utf8");
    const soul = readFileSync(path.join(payload.agentDir, "SOUL.md"), "utf8");
    const tools = readFileSync(path.join(payload.agentDir, "TOOLS.md"), "utf8");
    assert.ok(identity.includes("Voice: Orus"));
    assert.ok(identity.includes("Avatar Style: editorial-executive"));
    assert.ok(soul.includes("I am Forge, the CEO"));
    assert.ok(soul.includes("Hire, route, and evaluate specialist agents."));
    assert.ok(tools.includes("Use `./source` for HiveRunner source code"));
    assert.ok(lstatSync(path.join(payload.workspace, "source")).isSymbolicLink());
    assert.ok(lstatSync(path.join(payload.agentDir, "source")).isSymbolicLink());
    assert.strictEqual(realpathSync(path.join(payload.agentDir, "source")), realpathSync(process.cwd()));
  });

  await test("create-full infers the CEO runtime provider from the selected model without OpenClaw artifacts", async () => {
    const req = {
      async json() {
        return {
          company: {
            name: "Manual Runtime Co",
            slug: "manual-runtime-co",
            description: "Fixture company that should not touch OpenClaw by default.",
          },
          owner: {
            displayName: "Test Owner",
            email: "owner@example.test",
          },
          project: {
            name: "Operations",
            description: "Initial project",
          },
          ceo: {
            name: "Mira",
            model: "openai/gpt-5.4",
            guidance: "",
          },
          task: {
            title: "Plan the first milestone",
            description: "Do not auto-provision OpenClaw.",
            priority: "P1",
          },
        };
      },
    };

    const res = await createFullRoute(req as never);
    if (res.status !== 201) {
      const errorPayload = (await res.json()) as { error?: string };
      throw new Error(`Expected 201, got ${res.status}: ${errorPayload.error ?? "missing error payload"}`);
    }

    const payload = (await res.json()) as {
      agent: { id: string; runtimeProvider: string; openclawAgentId: string | null };
      initialExecution: { status: string; reason?: string; mode?: string };
      agentDir: string;
    };
    assert.strictEqual(payload.agent.runtimeProvider, "codex");
    assert.strictEqual(payload.agent.openclawAgentId, null);
    assert.ok(["queued", "skipped"].includes(payload.initialExecution.status));
    assert.strictEqual(payload.initialExecution.reason, "company_creation_kickoff");
    assert.ok(["codex", "manual"].includes(payload.initialExecution.mode));

    const db = getOrchestrationDb();
    const row = db
      .prepare(
        `SELECT a.adapter_type, a.openclaw_agent_id, ar.provider, ar.command
         FROM agents a
         LEFT JOIN agent_runtimes ar ON ar.agent_id = a.id
         WHERE a.id = ?
         ORDER BY ar.updated_at DESC
         LIMIT 1`,
      )
      .get(payload.agent.id) as
      | {
          adapter_type: string | null;
          openclaw_agent_id: string | null;
          provider: string | null;
          command: string | null;
        }
      | undefined;

    assert.ok(row, "Expected CEO agent runtime row to exist");
    assert.strictEqual(row?.adapter_type, "codex");
    assert.strictEqual(row?.openclaw_agent_id, null);
    assert.strictEqual(row?.provider, "codex");
    assert.strictEqual(row?.command, "codex");
    assert.ok(existsSync(path.join(payload.agentDir, "IDENTITY.md")), "identity files should still be written");
    assert.ok(!existsSync(path.join(homeDir, ".openclaw", "agents", "mira")), "non-OpenClaw CEO must not create an OpenClaw agent scaffold");
  });

  await test("create-full binds browser-created local workspaces to the local owner", async () => {
    process.env.MC_AUTH_MODE = "local-single-user";
    process.env.MC_LOCAL_OWNER_EMAIL = "owner@localhost.local";

    const req = new NextRequest("http://localhost:3011/api/orchestration/companies/create-full", {
      method: "POST",
      headers: {
        host: "localhost:3011",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        company: {
          name: "Local Owner Browser Co",
          slug: "local-owner-browser-co",
          description: "Fixture company created through a browser request in local-single-user mode.",
        },
        owner: {
          displayName: "Browser Operator",
          email: "browser-operator@example.test",
        },
        project: {
          name: "Operations",
          description: "Initial project",
        },
        ceo: {
          name: "Atlas",
          model: "manual",
          guidance: "",
        },
        task: {
          title: "Plan the first local milestone",
          description: "Verify local owner authorization after company launch.",
          priority: "P1",
        },
      }),
    });

    const res = await createFullRoute(req);
    if (res.status !== 201) {
      const errorPayload = (await res.json()) as { error?: string };
      throw new Error(`Expected 201, got ${res.status}: ${errorPayload.error ?? "missing error payload"}`);
    }

    const payload = (await res.json()) as {
      company: { id: string; owner?: { id?: string; email?: string } };
      dashboardHref: string;
    };

    const db = getOrchestrationDb();
    const row = db
      .prepare("SELECT owner_user_id FROM companies WHERE id = ?")
      .get(payload.company.id) as { owner_user_id: string | null } | undefined;

    assert.ok(row, "Expected company row to exist");
    assert.strictEqual(row.owner_user_id, "local-owner");
    assert.strictEqual(payload.company.owner?.id, "local-owner");
    assert.strictEqual(payload.company.owner?.email, "browser-operator@example.test");
    assert.strictEqual(payload.dashboardHref, "/LOC/dashboard");
  });

  await test("create-full materializes selected starter-team agents through manual provisioning", async () => {
    const req = {
      async json() {
        return {
          company: {
            name: "Starter Team Co",
            slug: "starter-team-co",
            description: "Fixture company for starter team provisioning.",
          },
          owner: {
            displayName: "Test Owner",
            email: "owner@example.test",
          },
          project: null,
          starterTeam: {
            workType: "software-product",
            agents: [
              {
                name: "Devon",
                role: "Implementation Engineer",
                mission: "Build the first scoped milestone.",
                capabilities: ["Application development", "Implementation planning"],
                selected: true,
                runtimeProvider: "openclaw",
                model: "openai/gpt-5.4",
              },
              {
                name: "Devon",
                role: "Duplicate Implementation Engineer",
                mission: "This duplicate role should not create or report twice.",
                capabilities: ["Duplicate"],
                selected: true,
              },
              {
                name: "Lena",
                role: "Replacement Lead",
                mission: "This role should not replace the CEO.",
                capabilities: ["Leadership"],
                selected: true,
              },
              {
                name: "Noel",
                role: "Unselected Reviewer",
                mission: "This role should not be created.",
                capabilities: ["Review"],
                selected: false,
              },
            ],
          },
          ceo: {
            name: "Lena",
            model: "openai/gpt-5.4",
            guidance: "",
          },
          task: {
            title: "Plan the first starter milestone",
            description: "Kick off execution with selected starter teammates.",
            priority: "P1",
          },
        };
      },
    };

    const res = await createFullRoute(req as never);
    if (res.status !== 201) {
      const errorPayload = (await res.json()) as { error?: string };
      throw new Error(`Expected 201, got ${res.status}: ${errorPayload.error ?? "missing error payload"}`);
    }

    const payload = (await res.json()) as {
      company: { id: string };
      project: { id: string; name: string };
      agent: { id: string };
      starterTeam: { selectedCount: number; agents: Array<{ id: string; name: string; runtimeProvider: string }> };
      workspace: string;
    };

    assert.strictEqual(payload.project.name, "Operations");
    assert.strictEqual(payload.starterTeam.selectedCount, 1);
    assert.strictEqual(payload.starterTeam.agents[0]?.name, "Devon");
    assert.strictEqual(payload.starterTeam.agents[0]?.runtimeProvider, "manual");

    const duplicateRes = await createFullRoute(req as never);
    assert.strictEqual(duplicateRes.status, 409);
    const duplicatePayload = (await duplicateRes.json()) as { error?: string };
    assert.ok(duplicatePayload.error?.includes('Company slug "starter-team-co" already exists'));

    const db = getOrchestrationDb();
    const companyCount = db
      .prepare("SELECT COUNT(*) AS count FROM companies WHERE slug = ?")
      .get("starter-team-co") as { count: number };
    assert.strictEqual(companyCount.count, 1);

    const starterRows = db
      .prepare(
        `SELECT name, role, adapter_type, model, openclaw_agent_id, project_id, reporting_to
         FROM agents
         WHERE company_id = ? AND name IN ('Devon', 'Noel')
         ORDER BY name ASC`,
      )
      .all(payload.company.id) as Array<{
        name: string;
        role: string;
        adapter_type: string | null;
        model: string | null;
        openclaw_agent_id: string | null;
        project_id: string | null;
        reporting_to: string | null;
      }>;

    assert.strictEqual(starterRows.length, 1);
    assert.strictEqual(starterRows[0]?.name, "Devon");
    assert.strictEqual(starterRows[0]?.role, "Implementation Engineer");
    assert.strictEqual(starterRows[0]?.adapter_type, "manual");
    assert.strictEqual(starterRows[0]?.model, "");
    assert.strictEqual(starterRows[0]?.openclaw_agent_id, null);
    assert.strictEqual(starterRows[0]?.project_id, payload.project.id);
    assert.strictEqual(starterRows[0]?.reporting_to, payload.agent.id);
    assert.ok(!existsSync(path.join(homeDir, ".openclaw", "agents", "devon")), "starter agents must not create OpenClaw scaffolds by default");

    const workspaceAgents = readFileSync(path.join(payload.workspace, "AGENTS.md"), "utf8");
    assert.ok(workspaceAgents.includes("**Lena**"));
    assert.ok(workspaceAgents.includes("**Devon**"));
    assert.ok(!workspaceAgents.includes("Noel"));
  });

  await test("starter-team provisioning warnings are non-fatal per selected role", () => {
    const result = provisionSelectedStarterAgentsForCreateFull({
      selectedStarterAgents: [
        {
          name: "Corey",
          role: "Implementation Engineer",
          mission: "Build scoped changes.",
          capabilities: ["Build"],
        },
        {
          name: "Gator",
          role: "Quality Reviewer",
          mission: "Review the first release.",
          capabilities: ["Review"],
        },
      ],
      companyId: "company-id",
      requestedByAgentId: "ceo-id",
      projectId: "project-id",
      db: getOrchestrationDb(),
      provisioner(input) {
        if (input.payload.name === "Gator") {
          throw new Error("workspace path unavailable");
        }
        return {
          agentId: "corey-agent-id",
          agentSlug: "corey",
          runtimeSlug: "corey",
          openclawAgentId: null,
          projectId: "project-id",
          workspacePath: "/tmp/corey",
        };
      },
    });

    assert.deepStrictEqual(result.agents, [
      {
        id: "corey-agent-id",
        slug: "corey",
        name: "Corey",
        role: "Implementation Engineer",
        projectId: "project-id",
        runtimeProvider: "manual",
      },
    ]);
    assert.deepStrictEqual(result.warnings, [
      {
        name: "Gator",
        role: "Quality Reviewer",
        message: "workspace path unavailable",
      },
    ]);
  });

  await test("create-full keeps blank/custom starter team empty even if role cards are submitted", async () => {
    const req = {
      async json() {
        return {
          company: {
            name: "Blank Starter Co",
            slug: "blank-starter-co",
            description: "Fixture company for blank starter setup.",
          },
          owner: {
            displayName: "Test Owner",
            email: "owner@example.test",
          },
          project: null,
          starterTeam: {
            workType: "blank-custom",
            agents: [
              {
                name: "Extra Builder",
                role: "Custom Role",
                mission: "This role should be ignored for blank/custom.",
                capabilities: ["Build"],
                selected: true,
              },
            ],
          },
          ceo: {
            name: "Blake",
            runtimeProvider: "openclaw",
            model: "",
            guidance: "",
          },
          task: {
            title: "Define the first custom workspace task",
            description: "No starter agents should be created by default.",
            priority: "P1",
          },
        };
      },
    };

    const res = await createFullRoute(req as never);
    assert.strictEqual(res.status, 201);

    const payload = (await res.json()) as {
      company: { id: string };
      agent: { id: string; name: string; runtimeProvider: string; openclawAgentId: string | null };
      starterTeam: { selectedCount: number; agents: Array<{ id: string; name: string }> };
    };

    assert.strictEqual(payload.agent.runtimeProvider, "manual");
    assert.strictEqual(payload.agent.openclawAgentId, null);
    assert.strictEqual(payload.starterTeam.selectedCount, 0);
    assert.deepStrictEqual(payload.starterTeam.agents, []);

    const db = getOrchestrationDb();
    const agentRows = db
      .prepare(
        `SELECT id, name, role, adapter_type, openclaw_agent_id
         FROM agents
         WHERE company_id = ?
         ORDER BY created_at ASC`,
      )
      .all(payload.company.id) as Array<{
        id: string;
        name: string;
        role: string;
        adapter_type: string | null;
        openclaw_agent_id: string | null;
      }>;

    assert.strictEqual(agentRows.length, 1);
    assert.strictEqual(agentRows[0]?.id, payload.agent.id);
    assert.strictEqual(agentRows[0]?.name, "Blake");
    assert.strictEqual(agentRows[0]?.role, "CEO");
    assert.strictEqual(agentRows[0]?.adapter_type, "manual");
    assert.strictEqual(agentRows[0]?.openclaw_agent_id, null);
    assert.ok(!existsSync(path.join(homeDir, ".openclaw", "agents", "blake")), "gated OpenClaw setup must not create a CEO scaffold");
  });

  await test("create-full rejects unknown starter-team work types", async () => {
    const req = {
      async json() {
        return {
          company: {
            name: "Invalid Starter Co",
            slug: "invalid-starter-co",
            description: "Fixture company for invalid starter setup.",
          },
          owner: {
            displayName: "Test Owner",
            email: "owner@example.test",
          },
          project: null,
          starterTeam: {
            workType: "sales-team",
            agents: [],
          },
          ceo: {
            name: "Iris",
            model: "",
            guidance: "",
          },
          task: {
            title: "Try invalid starter team",
            description: "",
            priority: "P1",
          },
        };
      },
    };

    const res = await createFullRoute(req as never);
    assert.strictEqual(res.status, 400);
    const payload = (await res.json()) as { error: string };
    assert.ok(payload.error.includes("Unknown starter team work type"));
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
