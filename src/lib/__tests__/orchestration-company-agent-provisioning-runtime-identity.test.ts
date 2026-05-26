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
  console.log("\nCompany Agent Provisioning Runtime Identity Tests\n");

  const tempRoot = mkdtempSync(
    path.join(os.tmpdir(), "orchestration-company-agent-provisioning-runtime-identity-"),
  );
  const homeDir = path.join(tempRoot, "home");
  const binDir = path.join(tempRoot, "bin");
  const dbPath = path.join(tempRoot, "orchestration.db");
  const mcWorkspaceRoot = path.join(homeDir, ".mission-control", "dev", "workspaces");
  const fakeOpenClawPath = path.join(binDir, "openclaw");

  mkdirSync(binDir, { recursive: true });
  mkdirSync(mcWorkspaceRoot, { recursive: true });

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

  const { createCompany } = await import("@/lib/orchestration/company-service");
  const { createProject } = await import("@/lib/orchestration/service");
  const { closeOrchestrationDb, getOrchestrationDb } = await import("@/lib/orchestration/db");
  const { materializeApprovedHireAgent, stagePendingHireAgent } = await import(
    "@/lib/orchestration/service/company-agent-provisioning"
  );

  const company = createCompany({
    name: "Provisioning Runtime Identity Co",
    description: "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: "Operations",
    description: "fixture",
    color: "#0ea5e9",
    emoji: "\ud83d\ude80",
    status: "active",
  }).project;

  await test("requested OpenClaw hires do not mutate OpenClaw config unless provisioning is explicitly enabled", () => {
    const db = getOrchestrationDb();

    const result = materializeApprovedHireAgent({
      approvalCompanyId: company.id,
      requestedByAgentId: null,
      payload: {
        projectId: project.id,
        name: "Claw Disabled",
        role: "OpenClaw Specialist",
        runtimeProvider: "openclaw",
        model: "anthropic/claude-sonnet-4-6",
      },
      db,
    });

    const agent = db
      .prepare(
        `SELECT adapter_type, openclaw_agent_id
         FROM agents
         WHERE id = ?`,
      )
      .get(result.agentId) as { adapter_type: string; openclaw_agent_id: string | null } | undefined;
    const runtime = db
      .prepare("SELECT provider, runtime_kind, command FROM agent_runtimes WHERE agent_id = ? LIMIT 1")
      .get(result.agentId) as { provider: string; runtime_kind: string; command: string | null } | undefined;

    assert.strictEqual(agent?.adapter_type, "manual");
    assert.strictEqual(agent?.openclaw_agent_id, null);
    assert.strictEqual(runtime?.provider, "manual");
    assert.strictEqual(runtime?.runtime_kind, "manual");
    assert.strictEqual(runtime?.command, null);
  });

  await test("company-level hires do not silently attach to the first project", () => {
    const db = getOrchestrationDb();

    const result = materializeApprovedHireAgent({
      approvalCompanyId: company.id,
      requestedByAgentId: null,
      payload: {
        name: "Company Wide",
        role: "Generalist",
        runtimeProvider: "codex",
      },
      db,
    });

    const agent = db
      .prepare(
        `SELECT project_id
         FROM agents
         WHERE id = ?`,
      )
      .get(result.agentId) as { project_id: string | null } | undefined;
    const identity = readFileSync(path.join(result.workspacePath, "IDENTITY.md"), "utf8");
    const soul = readFileSync(path.join(result.workspacePath, "SOUL.md"), "utf8");
    const workingAgreement = readFileSync(path.join(result.workspacePath, "AGENTS.md"), "utf8");

    assert.strictEqual(result.projectId, null);
    assert.strictEqual(agent?.project_id, null);
    assert.ok(identity.includes("Project Scope: All company projects"));
    assert.ok(soul.includes("I serve all company projects unless a task narrows the scope."));
    assert.ok(workingAgreement.includes("Project Scope: All company projects"));
    assert.ok(!identity.includes("Project: Operations"), "company-wide hire must not inherit the first project");
  });

  await test("approved hires use human-readable OpenClaw runtime ids for new agents when explicitly enabled", () => {
    const db = getOrchestrationDb();
    process.env.MC_ENABLE_OPENCLAW_AGENT_PROVISIONING = "1";

    let result!: ReturnType<typeof materializeApprovedHireAgent>;
    try {
      result = materializeApprovedHireAgent({
        approvalCompanyId: company.id,
        requestedByAgentId: null,
        payload: {
          projectId: project.id,
          name: "Forge",
          role: "Backend Engineer",
          runtimeProvider: "openclaw",
          model: "openai/gpt-5.4",
        },
        db,
      });
    } finally {
      delete process.env.MC_ENABLE_OPENCLAW_AGENT_PROVISIONING;
    }

    const row = db
      .prepare(
        `SELECT runtime_slug, openclaw_agent_id, avatar_style_id, avatar_gender,
                avatar_vibe, voice_id, avatar_url, emoji
         FROM agents
         WHERE id = ?`
      )
      .get(result.agentId) as
      | {
          runtime_slug: string | null;
          openclaw_agent_id: string | null;
          avatar_style_id: string | null;
          avatar_gender: string | null;
          avatar_vibe: string | null;
          voice_id: string | null;
          avatar_url: string | null;
          emoji: string | null;
        }
      | undefined;

    const expectedRuntimeId = `mc-${company.runtimeSlug}-forge`;
    assert.strictEqual(result.runtimeSlug, "forge");
    assert.strictEqual(result.openclawAgentId, expectedRuntimeId);
    assert.strictEqual(row?.runtime_slug, "forge");
    assert.strictEqual(row?.openclaw_agent_id, expectedRuntimeId);
    assert.strictEqual(row?.avatar_style_id, "technical-operator");
    assert.strictEqual(row?.avatar_gender, "androgynous");
    assert.ok(row?.avatar_vibe?.includes("systems-minded"));
    assert.strictEqual(row?.voice_id, "Iapetus");
    assert.strictEqual(row?.avatar_url, null);
    assert.strictEqual(row?.emoji, "icon:code");
    assert.ok(result.workspacePath.endsWith("/agents/forge"));

    for (const fileName of ["IDENTITY.md", "SOUL.md", "AGENTS.md", "HEARTBEAT.md", "TOOLS.md"]) {
      assert.ok(existsSync(path.join(result.workspacePath, fileName)), `${fileName} must be written`);
    }

    const soul = readFileSync(path.join(result.workspacePath, "SOUL.md"), "utf8");
    assert.ok(soul.includes("I am Forge, the Backend Engineer"));
    assert.ok(soul.includes("Read the codebase before changing behavior."));
    assert.ok(soul.includes("Voice:") === false, "voice belongs in IDENTITY.md, not SOUL.md");

    const identity = readFileSync(path.join(result.workspacePath, "IDENTITY.md"), "utf8");
    assert.ok(identity.includes("Voice: Iapetus"));
    assert.ok(identity.includes("Avatar Style: technical-operator"));
  });

  await test("approval materialization reuses a staged agent when payload only has agentName", () => {
    const db = getOrchestrationDb();

    const staged = stagePendingHireAgent({
      approvalCompanyId: company.id,
      requestedByAgentId: null,
      payload: {
        projectId: project.id,
        name: "John Denver",
        role: "Singer",
        personality: "Country singer fixture.",
        mission: "Verify hire approvals do not duplicate staged agents.",
        model: "openai/gpt-5.4",
      },
      db,
    });

    const materialized = materializeApprovedHireAgent({
      approvalCompanyId: company.id,
      requestedByAgentId: null,
      payload: {
        agentId: staged.agentId,
        agentName: "John Denver",
        role: "Singer",
        model: "openai/gpt-5.4",
      },
      db,
    });

    const rows = db
      .prepare(
        `SELECT id, name, status, adapter_type, runtime_slug, openclaw_agent_id
         FROM agents
         WHERE company_id = ?
           AND lower(name) IN ('john denver', 'unnamed agent')
         ORDER BY created_at ASC`
      )
      .all(company.id) as Array<{
        id: string;
        name: string;
        status: string;
        adapter_type: string;
        runtime_slug: string | null;
        openclaw_agent_id: string | null;
      }>;

    assert.strictEqual(materialized.agentId, staged.agentId);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]?.id, staged.agentId);
    assert.strictEqual(rows[0]?.name, "John Denver");
    assert.strictEqual(rows[0]?.status, "idle");
    assert.strictEqual(rows[0]?.adapter_type, "manual");
    assert.strictEqual(rows[0]?.runtime_slug, "john-denver");
    assert.strictEqual(rows[0]?.openclaw_agent_id, null);
  });

  await test("staged hires persist selected Codex runtime and fresh default model", () => {
    const db = getOrchestrationDb();

    const staged = stagePendingHireAgent({
      approvalCompanyId: company.id,
      requestedByAgentId: null,
      payload: {
        projectId: project.id,
        name: "Ada Lovelace",
        role: "Full-Stack Engineer",
        runtimeProvider: "codex",
        runtimeDisplayName: "Codex local",
        runtimeCommand: "codex",
        runtimeCommandPath: "/opt/homebrew/bin/codex",
        runtimeSource: "detected",
      },
      db,
    });

    const agent = db
      .prepare(
        `SELECT adapter_type, model, runtime_slug, openclaw_agent_id
         FROM agents
         WHERE id = ?`
      )
      .get(staged.agentId) as
      | {
          adapter_type: string;
          model: string;
          runtime_slug: string | null;
          openclaw_agent_id: string | null;
        }
      | undefined;
    const state = db
      .prepare(
        `SELECT adapter_type
         FROM agent_runtime_state
         WHERE agent_id = ?`
      )
      .get(staged.agentId) as { adapter_type: string } | undefined;
    const runtime = db
      .prepare(
        `SELECT provider, runtime_kind, command, metadata_json
         FROM agent_runtimes
         WHERE agent_id = ?`
      )
      .get(staged.agentId) as
      | {
          provider: string;
          runtime_kind: string;
          command: string | null;
          metadata_json: string;
        }
      | undefined;

    assert.strictEqual(agent?.adapter_type, "codex");
    assert.strictEqual(agent?.model, "openai-codex/gpt-5.5");
    assert.strictEqual(agent?.runtime_slug, "ada-lovelace");
    assert.strictEqual(agent?.openclaw_agent_id, null);
    assert.strictEqual(state?.adapter_type, "codex");
    assert.strictEqual(runtime?.provider, "codex");
    assert.strictEqual(runtime?.runtime_kind, "cli");
    assert.strictEqual(runtime?.command, "codex");

    const metadata = JSON.parse(runtime?.metadata_json ?? "{}") as Record<string, unknown>;
    assert.strictEqual(metadata.selectedRuntimeSource, "detected");
    assert.strictEqual(metadata.selectedRuntimeDisplayName, "Codex local");
    assert.strictEqual(metadata.commandPath, "/opt/homebrew/bin/codex");
    assert.strictEqual(metadata.model, "openai-codex/gpt-5.5");
    assert.ok(lstatSync(path.join(staged.workspacePath, "source")).isSymbolicLink());
    assert.strictEqual(realpathSync(path.join(staged.workspacePath, "source")), realpathSync(process.cwd()));
  });

  await test("Codex legacy GPT-5 aliases normalize to the current Codex default", () => {
    const db = getOrchestrationDb();

    const result = materializeApprovedHireAgent({
      approvalCompanyId: company.id,
      requestedByAgentId: null,
      payload: {
        projectId: project.id,
        name: "Codex Default",
        role: "Backend Engineer",
        runtimeProvider: "codex",
        model: "gpt-5",
      },
      db,
    });

    const agent = db
      .prepare(
        `SELECT adapter_type, model
         FROM agents
         WHERE id = ?`,
      )
      .get(result.agentId) as { adapter_type: string; model: string } | undefined;
    assert.strictEqual(agent?.adapter_type, "codex");
    assert.strictEqual(agent?.model, "openai-codex/gpt-5.5");
  });

  await test("approved runtime change removes stale staged manual runtime", () => {
    const db = getOrchestrationDb();

    const staged = stagePendingHireAgent({
      approvalCompanyId: company.id,
      requestedByAgentId: null,
      payload: {
        projectId: project.id,
        name: "Runtime Switcher",
        role: "Implementation Engineer",
      },
      db,
    });

    materializeApprovedHireAgent({
      approvalCompanyId: company.id,
      requestedByAgentId: null,
      payload: {
        agentId: staged.agentId,
        name: "Runtime Switcher",
        role: "Implementation Engineer",
        runtimeProvider: "codex",
        model: "openai-codex/gpt-5.3-codex",
      },
      db,
    });

    const agent = db
      .prepare(
        `SELECT adapter_type, model, status
         FROM agents
         WHERE id = ?`,
      )
      .get(staged.agentId) as { adapter_type: string; model: string; status: string } | undefined;
    const runtimes = db
      .prepare(
        `SELECT provider, runtime_kind, command
         FROM agent_runtimes
         WHERE agent_id = ?
         ORDER BY created_at`,
      )
      .all(staged.agentId) as Array<{ provider: string; runtime_kind: string; command: string | null }>;

    assert.strictEqual(agent?.adapter_type, "codex");
    assert.strictEqual(agent?.model, "openai-codex/gpt-5.3-codex");
    assert.strictEqual(agent?.status, "idle");
    assert.deepStrictEqual(runtimes, [{ provider: "codex", runtime_kind: "cli", command: "codex" }]);
  });

  await test("Gemini hires preserve current Gemini 3 selections in agent runtime config", () => {
    const db = getOrchestrationDb();

    const result = materializeApprovedHireAgent({
      approvalCompanyId: company.id,
      requestedByAgentId: null,
      payload: {
        projectId: project.id,
        name: "Gemma",
        role: "Research Analyst",
        runtimeProvider: "gemini",
        model: "google/gemini-3.1-pro-preview",
      },
      db,
    });

    const agent = db
      .prepare(
        `SELECT adapter_type, model, runtime_slug, openclaw_agent_id
         FROM agents
         WHERE id = ?`
      )
      .get(result.agentId) as
      | {
          adapter_type: string;
          model: string;
          runtime_slug: string | null;
          openclaw_agent_id: string | null;
        }
      | undefined;
    const runtime = db
      .prepare(
        `SELECT provider, runtime_kind, command, workspace_root, metadata_json
         FROM agent_runtimes
         WHERE agent_id = ?`
      )
      .get(result.agentId) as
      | {
          provider: string;
          runtime_kind: string;
          command: string | null;
          workspace_root: string | null;
          metadata_json: string;
        }
      | undefined;

    assert.strictEqual(agent?.adapter_type, "gemini");
    assert.strictEqual(agent?.model, "google/gemini-3.1-pro-preview");
    assert.strictEqual(agent?.runtime_slug, "gemma");
    assert.strictEqual(agent?.openclaw_agent_id, null);
    assert.strictEqual(runtime?.provider, "gemini");
    assert.strictEqual(runtime?.runtime_kind, "cli");
    assert.strictEqual(runtime?.command, "gemini");
    assert.ok(runtime?.workspace_root?.includes("/.mission-control/"), "Gemini workspace must be under HiveRunner");
    assert.ok(!runtime?.workspace_root?.includes("/.openclaw/"), "Gemini workspace must not use OpenClaw");
    assert.strictEqual(runtime?.workspace_root, result.workspacePath);

    const metadata = JSON.parse(runtime?.metadata_json ?? "{}") as Record<string, unknown>;
    assert.strictEqual(metadata.model, "google/gemini-3.1-pro-preview");
  });

  await test("Gemini default aliases normalize to the current Gemini default", () => {
    const db = getOrchestrationDb();

    const result = materializeApprovedHireAgent({
      approvalCompanyId: company.id,
      requestedByAgentId: null,
      payload: {
        projectId: project.id,
        name: "Gemini Default",
        role: "Research Analyst",
        runtimeProvider: "gemini",
        model: "google/gemini-default",
      },
      db,
    });

    const agent = db
      .prepare(
        `SELECT adapter_type, model
         FROM agents
         WHERE id = ?`,
      )
      .get(result.agentId) as { adapter_type: string; model: string } | undefined;
    assert.strictEqual(agent?.adapter_type, "gemini");
    assert.strictEqual(agent?.model, "google/gemini-2.5-pro");
  });

  await test("Gemini Pro aliases normalize to the locally available Gemini default", () => {
    const db = getOrchestrationDb();

    const result = materializeApprovedHireAgent({
      approvalCompanyId: company.id,
      requestedByAgentId: null,
      payload: {
        projectId: project.id,
        name: "Gemini Pro Alias",
        role: "Research Analyst",
        runtimeProvider: "gemini",
        model: "google/gemini-pro",
      },
      db,
    });

    const agent = db
      .prepare(
        `SELECT adapter_type, model
         FROM agents
         WHERE id = ?`,
      )
      .get(result.agentId) as { adapter_type: string; model: string } | undefined;
    assert.strictEqual(agent?.adapter_type, "gemini");
    assert.strictEqual(agent?.model, "google/gemini-2.5-pro");
  });

  await test("Gemini provider default aliases normalize to the locally available Gemini default", () => {
    const db = getOrchestrationDb();

    const result = materializeApprovedHireAgent({
      approvalCompanyId: company.id,
      requestedByAgentId: null,
      payload: {
        projectId: project.id,
        name: "Gemini Provider Default",
        role: "Research Analyst",
        runtimeProvider: "gemini",
        model: "google/default",
      },
      db,
    });

    const agent = db
      .prepare(
        `SELECT adapter_type, model
         FROM agents
         WHERE id = ?`,
      )
      .get(result.agentId) as { adapter_type: string; model: string } | undefined;
    assert.strictEqual(agent?.adapter_type, "gemini");
    assert.strictEqual(agent?.model, "google/gemini-2.5-pro");
  });

  await test("Anthropic hires normalize human Sonnet aliases to a Claude CLI model", () => {
    const db = getOrchestrationDb();

    const result = materializeApprovedHireAgent({
      approvalCompanyId: company.id,
      requestedByAgentId: null,
      payload: {
        projectId: project.id,
        name: "Claude Frontend",
        role: "Frontend Engineer",
        runtimeProvider: "anthropic",
        model: "claude-sonnet-4.5",
      },
      db,
    });

    const agent = db
      .prepare(
        `SELECT adapter_type, model
         FROM agents
         WHERE id = ?`,
      )
      .get(result.agentId) as { adapter_type: string; model: string } | undefined;
    const runtime = db
      .prepare(
        `SELECT provider, command, metadata_json
         FROM agent_runtimes
         WHERE agent_id = ?`,
      )
      .get(result.agentId) as
      | {
          provider: string;
          command: string | null;
          metadata_json: string;
        }
      | undefined;

    assert.strictEqual(agent?.adapter_type, "anthropic");
    assert.strictEqual(agent?.model, "anthropic/claude-sonnet-4-6");
    assert.strictEqual(runtime?.provider, "anthropic");
    assert.strictEqual(runtime?.command, "claude");

    const metadata = JSON.parse(runtime?.metadata_json ?? "{}") as Record<string, unknown>;
    assert.strictEqual(metadata.model, "anthropic/claude-sonnet-4-6");
  });

  await test("Anthropic default aliases normalize to the current Claude default", () => {
    const db = getOrchestrationDb();

    const result = materializeApprovedHireAgent({
      approvalCompanyId: company.id,
      requestedByAgentId: null,
      payload: {
        projectId: project.id,
        name: "Claude Default",
        role: "Frontend Engineer",
        runtimeProvider: "anthropic",
        model: "anthropic/claude-default",
      },
      db,
    });

    const agent = db
      .prepare(
        `SELECT adapter_type, model
         FROM agents
         WHERE id = ?`,
      )
      .get(result.agentId) as { adapter_type: string; model: string } | undefined;
    assert.strictEqual(agent?.adapter_type, "anthropic");
    assert.strictEqual(agent?.model, "anthropic/claude-sonnet-4-6");
  });

  await test("Anthropic bare Claude aliases normalize to the current Claude default", () => {
    const db = getOrchestrationDb();

    const result = materializeApprovedHireAgent({
      approvalCompanyId: company.id,
      requestedByAgentId: null,
      payload: {
        projectId: project.id,
        name: "Claude Bare Alias",
        role: "Frontend Engineer",
        runtimeProvider: "anthropic",
        model: "anthropic/Claude",
      },
      db,
    });

    const agent = db
      .prepare(
        `SELECT adapter_type, model
         FROM agents
         WHERE id = ?`,
      )
      .get(result.agentId) as { adapter_type: string; model: string } | undefined;
    assert.strictEqual(agent?.adapter_type, "anthropic");
    assert.strictEqual(agent?.model, "anthropic/claude-sonnet-4-6");
  });

  await test("Anthropic legacy 3.7 Sonnet aliases normalize to the current Claude default", () => {
    const db = getOrchestrationDb();

    const result = materializeApprovedHireAgent({
      approvalCompanyId: company.id,
      requestedByAgentId: null,
      payload: {
        projectId: project.id,
        name: "Claude Legacy",
        role: "Frontend Engineer",
        runtimeProvider: "anthropic",
        model: "anthropic/claude-3-7-sonnet",
      },
      db,
    });

    const agent = db
      .prepare(
        `SELECT adapter_type, model
         FROM agents
         WHERE id = ?`,
      )
      .get(result.agentId) as { adapter_type: string; model: string } | undefined;
    assert.strictEqual(agent?.adapter_type, "anthropic");
    assert.strictEqual(agent?.model, "anthropic/claude-sonnet-4-6");
  });

  await test("Hermes default model aliases are omitted so local Hermes config can decide", () => {
    const db = getOrchestrationDb();

    const result = materializeApprovedHireAgent({
      approvalCompanyId: company.id,
      requestedByAgentId: null,
      payload: {
        projectId: project.id,
        name: "Hermes QA",
        role: "QA Lead",
        runtimeProvider: "hermes",
        model: "hermes-default",
      },
      db,
    });

    const agent = db
      .prepare(
        `SELECT adapter_type, model
         FROM agents
         WHERE id = ?`
      )
      .get(result.agentId) as { adapter_type: string; model: string | null } | undefined;
    const runtime = db
      .prepare(
        `SELECT provider, command, metadata_json
         FROM agent_runtimes
         WHERE agent_id = ?`
      )
      .get(result.agentId) as
      | {
          provider: string;
          command: string | null;
          metadata_json: string;
        }
      | undefined;

    assert.strictEqual(agent?.adapter_type, "hermes");
    assert.strictEqual(agent?.model, "");
    assert.strictEqual(runtime?.provider, "hermes");
    assert.strictEqual(runtime?.command, "hermes");

    const metadata = JSON.parse(runtime?.metadata_json ?? "{}") as Record<string, unknown>;
    assert.strictEqual(metadata.model, "");
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
