/**
 * Contract test for voice session route context binding.
 * Run:
 *   node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/voice-session-route-context.test.ts
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${name}`);
      console.error(`    ${message}`);
    });
}

function makeRequest(body?: unknown) {
  return new Request("http://localhost/api/voice/session", {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function restoreEnvVar(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

console.log("\nVoice Session Route Context Contract Test\n");

async function run() {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "mc-voice-session-route-"));
  const fakeHome = path.join(tmpRoot, "home");
  const workspaceRoot = path.join(fakeHome, ".openclaw", "workspace");
  const memoryDir = path.join(workspaceRoot, "memory");
  const dbPath = path.join(tmpRoot, "voice-session-route-context.db");
  const originalEnv = {
    HOME: process.env.HOME,
    OPENCLAW_WORKSPACE: process.env.OPENCLAW_WORKSPACE,
    OPENCLAW_WORKSPACE_ROOT: process.env.OPENCLAW_WORKSPACE_ROOT,
    ORCHESTRATION_DB_PATH: process.env.ORCHESTRATION_DB_PATH,
    GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };

  mkdirSync(memoryDir, { recursive: true });
  writeFileSync(
    path.join(workspaceRoot, "MEMORY.md"),
    "# Memory\n\n## Core\nGlobal startup memory fixture.\n\n## Working Style\nStay crisp and useful.\n\n## Hard Rules (PERMANENT)\nDo not bluff.\n",
    "utf-8"
  );
  writeFileSync(
    path.join(workspaceRoot, "HEARTBEAT.md"),
    "# Heartbeat\n\nFresh heartbeat instructions for the global startup path.\n",
    "utf-8"
  );
  writeFileSync(
    path.join(memoryDir, "2026-04-16.md"),
    "# Daily Memory\n\nOperator focus: verify voice session context binding end-to-end.\n",
    "utf-8"
  );

  try {
    process.env.HOME = fakeHome;
    process.env.OPENCLAW_WORKSPACE = workspaceRoot;
    process.env.OPENCLAW_WORKSPACE_ROOT = workspaceRoot;
    process.env.ORCHESTRATION_DB_PATH = dbPath;
    process.env.GOOGLE_AI_API_KEY = "***";
    delete process.env.GEMINI_API_KEY;

    const { POST } = await import("@/app/api/voice/session/route");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { createCompany } = await import("@/lib/orchestration/company-service");
    const {
      createProject,
      createProjectAgent,
      createTask,
      createTaskComment,
      moveTask,
    } = await import("@/lib/orchestration/service");

    const company = createCompany({
      name: "Acme Voice Labs",
      description: "Voice route fixture company",
      status: "active",
    }).company;

    const project = createProject({
      companyId: company.id,
      name: "HiveRunner Voice Control",
      description: "Project-scoped fixture for voice session context resolution.",
      color: "#2563eb",
      emoji: "🎙️",
      status: "active",
    }).project;

    const outOfScopeCompany = createCompany({
      name: "Other Scope Co",
      description: "Companion company for scope-isolation coverage.",
      status: "active",
    }).company;

    const outOfScopeProject = createProject({
      companyId: outOfScopeCompany.id,
      name: "Scope Spillover",
      description: "Holds an out-of-scope agent for binding validation.",
      color: "#7c3aed",
      emoji: "🛰️",
      status: "active",
    }).project;

    const agent = createProjectAgent({
      projectId: project.id,
      name: "Scout",
      emoji: "🧭",
      role: "Operations Lead",
      personality: "Direct",
      status: "idle",
      skills: ["operations", "voice"],
    }).agent;

    getOrchestrationDb()
      .prepare("UPDATE agents SET avatar_url = ? WHERE id = ?")
      .run(`data:image/png;base64,${"a".repeat(3000)}`, agent.id);

    const outOfScopeAgent = createProjectAgent({
      projectId: outOfScopeProject.id,
      name: "Satellite",
      emoji: "🛰️",
      role: "External Operator",
      personality: "Detached",
      status: "idle",
      skills: ["scope", "qa"],
    }).agent;

    const task = createTask({
      projectId: project.id,
      title: "Ship HiveRunner Voice session context binding",
      description:
        "Implement the server-side voice session context resolver so HiveRunner Voice starts with current HiveRunner task context instead of a generic snapshot.",
      priority: "P1",
      type: "feature",
      status: "to-do",
      assignee: agent.id,
      labels: ["voice", "context"],
      createdBy: "test-suite",
    }).task;

    moveTask({
      taskId: task.id,
      status: "in-progress",
      actorUserId: "test-suite",
    });

    const commentBodies = [
      "Oldest context note that should fall off the prompt window.",
      "Confirm the route can accept an empty POST body.",
      "Resolve task bindings from real HiveRunner data.",
      "Include recent comments and activity without dumping the full timeline.",
      "Return a clean 404 when a bound task cannot be found.",
    ];

    commentBodies.forEach((body, index) => {
      createTaskComment({
        taskId: task.id,
        body,
        type: "comment",
        authorAgentId: agent.id,
        createdAt: `2026-01-01T00:0${index}:00.000Z`,
      });
    });

    const archivedAssignee = createProjectAgent({
      projectId: project.id,
      name: "Ghost Scout",
      emoji: "👻",
      role: "Former Operator",
      personality: "Quiet",
      status: "idle",
      skills: ["legacy", "voice"],
    }).agent;

    const archivedTask = createTask({
      projectId: project.id,
      title: "Verify archived assignees do not bind voice sessions",
      description: "Task fixture for archived-assignee binding coverage.",
      priority: "P2",
      type: "bug",
      status: "to-do",
      assignee: archivedAssignee.id,
      labels: ["voice", "archived-agent"],
      createdBy: "test-suite",
    }).task;

    const archivedAt = new Date().toISOString();
    getOrchestrationDb()
      .prepare("UPDATE agents SET archived_at = ?, updated_at = ? WHERE id = ?")
      .run(archivedAt, archivedAt, archivedAssignee.id);

    await test("POST with empty body still returns 200 and generic startup context", async () => {
      const response = await POST(makeRequest() as never);
      const body = await response.json() as {
        wsUrl: string;
        voiceName: string;
        systemPrompt: string;
        binding?: { scope: string; mode: string; source: string };
      };

      assert.equal(response.status, 200);
      assert.equal(body.voiceName, "Charon");
      assert.match(body.wsUrl, /^wss:\/\//);
      assert.match(body.wsUrl, /\?key=/);
      assert.equal(body.binding?.scope, "global");
      assert.equal(body.binding?.mode, "discuss");
      assert.equal(body.binding?.source, "voice-lab");
      assert.match(body.systemPrompt, /## Fresh startup context/);
      assert.match(body.systemPrompt, /## Gemini Voice Direction/);
      assert.match(body.systemPrompt, /Selected Gemini voice: Charon\./);
      assert.match(body.systemPrompt, /Delivery style: News desk\./);
      assert.match(body.systemPrompt, /Global startup memory fixture\./);
      assert.match(body.systemPrompt, /session\.marker/);
      assert.doesNotMatch(body.systemPrompt, /Fresh heartbeat instructions/);
      assert.doesNotMatch(body.systemPrompt, /Heartbeat \/ current-ops instructions/);
    });

    await test("POST with global agent binding uses agent context instead of broad startup memory", async () => {
      const response = await POST(
        makeRequest({
          companySlug: company.slug,
          agentId: agent.id,
          source: "voice-lab",
          mode: "discuss",
        }) as never
      );
      const body = await response.json() as {
        binding: {
          scope: string;
          companySlug?: string;
          agentId?: string;
          agentName?: string;
          agentAvatarUrl?: string;
          agentVoiceId?: string;
          mode: string;
          source: string;
        };
        voiceName: string;
        systemPrompt: string;
      };

      assert.equal(response.status, 200);
      assert.deepEqual(body.binding, {
        scope: "global",
        companySlug: company.slug,
        agentId: agent.id,
        agentName: agent.name,
        agentVoiceId: "Schedar",
        mode: "discuss",
        source: "voice-lab",
      });
      assert.equal(body.binding.agentAvatarUrl, undefined);
      assert.equal(body.voiceName, "Schedar");
      assert.match(body.systemPrompt, /You are Scout — Operations Lead/);
      assert.match(body.systemPrompt, /### Bound voice agent/);
      assert.match(body.systemPrompt, /No specific task or project is bound to this call/);
      assert.doesNotMatch(body.systemPrompt, /Global startup memory fixture\./);
      assert.doesNotMatch(body.systemPrompt, /Fresh heartbeat instructions/);
    });

    await test("POST with company code alias still resolves global agent binding", async () => {
      const db = getOrchestrationDb();
      db.prepare("UPDATE companies SET company_code = ? WHERE id = ?").run("ACME", company.id);

      const response = await POST(
        makeRequest({
          companySlug: "ACME",
          agentId: agent.id,
          source: "voice-lab",
          mode: "discuss",
        }) as never
      );
      const body = await response.json() as {
        binding: {
          scope: string;
          companySlug?: string;
          agentId?: string;
          agentName?: string;
        };
        systemPrompt: string;
      };

      assert.equal(response.status, 200);
      assert.equal(body.binding.scope, "global");
      assert.equal(body.binding.companySlug, company.slug);
      assert.equal(body.binding.agentId, agent.id);
      assert.equal(body.binding.agentName, agent.name);
      assert.match(body.systemPrompt, /You are Scout — Operations Lead/);
    });

    await test("POST with task binding returns bound task/project/agent metadata", async () => {
      const response = await POST(
        makeRequest({
          taskKey: task.key,
          agentId: agent.id,
          source: "task-detail",
          mode: "review",
        }) as never
      );
      const body = await response.json() as {
        binding: {
          scope: string;
          companySlug?: string;
          projectId?: string;
          projectSlug?: string;
          projectName?: string;
          taskId?: string;
          taskKey?: string;
          taskTitle?: string;
          taskStatus?: string;
          agentId?: string;
          agentName?: string;
          agentAvatarUrl?: string;
          agentVoiceId?: string;
          mode: string;
          source: string;
        };
      };

      assert.equal(response.status, 200);
      assert.deepEqual(body.binding, {
        scope: "task",
        companySlug: company.slug,
        projectId: project.id,
        projectSlug: project.slug,
        projectName: project.name,
        taskId: task.id,
        taskKey: task.key,
        taskTitle: task.title,
        taskStatus: "in-progress",
        agentId: agent.id,
        agentName: agent.name,
        agentVoiceId: "Schedar",
        mode: "review",
        source: "task-detail",
      });
    });

    await test("task-bound system prompt includes task title, status, assignee, and recent comments", async () => {
      const response = await POST(
        makeRequest({
          taskKey: task.key,
          source: "task-detail",
          mode: "review",
        }) as never
      );
      const body = await response.json() as { systemPrompt: string };

      assert.equal(response.status, 200);
      assert.match(body.systemPrompt, /### Bound scope/);
      assert.match(body.systemPrompt, /## Gemini Voice Direction/);
      assert.match(body.systemPrompt, /Selected Gemini voice: Schedar\./);
      assert.match(body.systemPrompt, /Delivery style: Neutral coordinator\./);
      assert.match(body.systemPrompt, /Scope: task/);
      assert.match(body.systemPrompt, /Project: HiveRunner Voice Control/);
      assert.match(body.systemPrompt, /Task: \[/);
      assert.match(body.systemPrompt, /Ship HiveRunner Voice session context binding/);
      assert.match(body.systemPrompt, /Status: In Progress/);
      assert.match(body.systemPrompt, /Assignee: Scout/);
      assert.match(body.systemPrompt, /### Recent comments/);
      assert.match(body.systemPrompt, /Confirm the route can accept an empty POST body\./);
      assert.match(body.systemPrompt, /Resolve task bindings from real HiveRunner data\./);
      assert.match(body.systemPrompt, /Include recent comments and activity without dumping the full timeline\./);
      assert.match(body.systemPrompt, /Return a clean 404 when a bound task cannot be found\./);
      assert.doesNotMatch(body.systemPrompt, /Oldest context note that should fall off the prompt window\./);
      assert.match(body.systemPrompt, /### Recent task activity/);
      assert.match(body.systemPrompt, /Status changed from To-Do to In Progress/);
      assert.doesNotMatch(body.systemPrompt, /Status changed from to-do to in-progress/);
      assert.doesNotMatch(body.systemPrompt, /Global startup memory fixture\./);
    });

    await test("POST with project binding returns project-scoped context", async () => {
      const response = await POST(
        makeRequest({
          projectId: project.id,
          source: "project-overview",
          mode: "discuss",
        }) as never
      );
      const body = await response.json() as {
        binding: {
          scope: string;
          companySlug?: string;
          projectId?: string;
          projectSlug?: string;
          projectName?: string;
          mode: string;
          source: string;
        };
        systemPrompt: string;
      };

      assert.equal(response.status, 200);
      assert.deepEqual(body.binding, {
        scope: "project",
        companySlug: company.slug,
        projectId: project.id,
        projectSlug: project.slug,
        projectName: project.name,
        mode: "discuss",
        source: "project-overview",
      });
      assert.match(body.systemPrompt, /### Bound scope/);
      assert.match(body.systemPrompt, /Scope: project/);
      assert.match(body.systemPrompt, /### Project summary/);
      assert.match(body.systemPrompt, /### Project task snapshot/);
      assert.doesNotMatch(body.systemPrompt, /Global startup memory fixture\./);
    });

    await test("project slug binding rejects a mismatched company scope", async () => {
      const response = await POST(
        makeRequest({
          companySlug: outOfScopeCompany.slug,
          projectSlug: project.slug,
          source: "project-overview",
          mode: "discuss",
        }) as never
      );
      const body = await response.json() as { error?: { code?: string; message?: string } };

      assert.equal(response.status, 404);
      assert.equal(body.error?.code, "project_not_found");
      assert.match(body.error?.message ?? "", /project not found/i);
    });

    await test("unknown task returns 404 with clean error", async () => {
      const response = await POST(
        makeRequest({
          taskKey: "VOICE-404",
          source: "task-detail",
          mode: "review",
        }) as never
      );
      const body = await response.json() as {
        error?: {
          code?: string;
          message?: string;
          details?: unknown;
        };
      };

      assert.equal(response.status, 404);
      assert.deepEqual(body, {
        error: {
          code: "task_not_found",
          message: "Task not found",
        },
      });
    });

    await test("explicit out-of-scope agent binding returns invalid binding error instead of falling back", async () => {
      const response = await POST(
        makeRequest({
          taskKey: task.key,
          agentId: outOfScopeAgent.id,
          source: "task-detail",
          mode: "review",
        }) as never
      );
      const body = await response.json() as {
        error?: {
          code?: string;
          message?: string;
        };
        binding?: {
          agentId?: string;
          agentName?: string;
        };
      };

      assert.equal(response.status, 400);
      assert.deepEqual(body, {
        error: {
          code: "invalid_voice_binding",
          message: "Requested agent is not available for this voice binding",
        },
      });
      assert.equal(body.binding, undefined);
    });

    await test("archived task assignee is excluded from bound agent context", async () => {
      const response = await POST(
        makeRequest({
          taskId: archivedTask.id,
          source: "task-detail",
          mode: "review",
        }) as never
      );
      const body = await response.json() as {
        binding: {
          scope: string;
          companySlug?: string;
          projectId?: string;
          projectSlug?: string;
          projectName?: string;
          taskId?: string;
          taskKey?: string;
          taskTitle?: string;
          taskStatus?: string;
          agentId?: string;
          agentName?: string;
          mode: string;
          source: string;
        };
        systemPrompt: string;
      };

      assert.equal(response.status, 200);
      assert.deepEqual(body.binding, {
        scope: "task",
        companySlug: company.slug,
        projectId: project.id,
        projectSlug: project.slug,
        projectName: project.name,
        taskId: archivedTask.id,
        taskKey: archivedTask.key,
        taskTitle: archivedTask.title,
        taskStatus: archivedTask.status,
        mode: "review",
        source: "task-detail",
      });
      assert.match(body.systemPrompt, /Status: To-Do/);
      assert.doesNotMatch(body.systemPrompt, /Status: to-do/);
      assert.match(body.systemPrompt, /Assignee: Unassigned/);
      assert.match(body.systemPrompt, /Agent: No agent bound/);
    });
  } finally {
    restoreEnvVar("HOME", originalEnv.HOME);
    restoreEnvVar("OPENCLAW_WORKSPACE", originalEnv.OPENCLAW_WORKSPACE);
    restoreEnvVar("OPENCLAW_WORKSPACE_ROOT", originalEnv.OPENCLAW_WORKSPACE_ROOT);
    restoreEnvVar("ORCHESTRATION_DB_PATH", originalEnv.ORCHESTRATION_DB_PATH);
    restoreEnvVar("GOOGLE_AI_API_KEY", originalEnv.GOOGLE_AI_API_KEY);
    restoreEnvVar("GEMINI_API_KEY", originalEnv.GEMINI_API_KEY);
    rmSync(tmpRoot, { recursive: true, force: true });
  }

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
