import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
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

console.log("\nVoice Transcript Storage Tests\n");

async function run() {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "mc-voice-storage-"));
  const fakeHome = path.join(tmpRoot, "home");
  const mcWorkspaceRoot = path.join(tmpRoot, "mc-workspaces");
  const openclawWorkspaceRoot = path.join(fakeHome, ".openclaw", "workspace");
  const dbPath = path.join(tmpRoot, "voice-transcript-storage.db");

  const originalEnv = {
    HOME: process.env.HOME,
    MC_WORKSPACE_ROOT: process.env.MC_WORKSPACE_ROOT,
    OPENCLAW_WORKSPACE: process.env.OPENCLAW_WORKSPACE,
    OPENCLAW_WORKSPACE_ROOT: process.env.OPENCLAW_WORKSPACE_ROOT,
    ORCHESTRATION_DB_PATH: process.env.ORCHESTRATION_DB_PATH,
  };

  mkdirSync(fakeHome, { recursive: true });
  mkdirSync(mcWorkspaceRoot, { recursive: true });
  mkdirSync(path.join(openclawWorkspaceRoot, "memory", "voice"), { recursive: true });

  try {
    process.env.HOME = fakeHome;
    process.env.MC_WORKSPACE_ROOT = mcWorkspaceRoot;
    process.env.OPENCLAW_WORKSPACE = openclawWorkspaceRoot;
    process.env.OPENCLAW_WORKSPACE_ROOT = openclawWorkspaceRoot;
    process.env.ORCHESTRATION_DB_PATH = dbPath;

    const { createCompany } = await import("@/lib/orchestration/company-service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { persistVoiceTranscript } = await import("@/lib/voice-memory");
    const { createProject, createProjectAgent, createTask, listTaskComments } = await import("@/lib/orchestration/service");
    const { POST } = await import("@/app/api/voice/transcript/route");

    const company = createCompany({
      name: "Example Workspace",
      description: "Voice storage fixture",
      status: "active",
    }).company;

    getOrchestrationDb()
      .prepare("UPDATE companies SET workspace_root = NULL, workspace_source = 'openclaw' WHERE id = ?")
      .run(company.id);

    const project = createProject({
      companyId: company.id,
      name: "Ideas Pipeline",
      description: "Voice transcript route fixture",
      color: "#14b8a6",
      emoji: "💡",
      status: "active",
    }).project;

    const agent = createProjectAgent({
      projectId: project.id,
      name: "Scout",
      emoji: "🧭",
      role: "Research Agent",
      personality: "Methodical",
      status: "idle",
      skills: ["voice"],
    }).agent;

    const task = createTask({
      projectId: project.id,
      title: "Process Claude Code setup video",
      description: "Fixture task for transcript route persistence.",
      priority: "P1",
      type: "feature",
      status: "in-progress",
      assignee: agent.id,
      labels: ["voice"],
      createdBy: "test",
    }).task;

    const transcript = [
      { role: "user" as const, text: "Hey Scout, what's the status on NEV-1?", timestamp: 1_000 },
      { role: "assistant" as const, text: "I'm reviewing the Claude Code setup task now.", timestamp: 11_000 },
    ];

    await test("task-bound transcripts write into HiveRunner-owned workspace even when company workspace points at OpenClaw", async () => {
      const saved = await persistVoiceTranscript(transcript, {
        binding: {
          scope: "task",
          companySlug: company.slug,
          projectSlug: "ideas-pipeline",
          projectName: "Ideas Pipeline",
          taskId: "task-123",
          taskKey: "NEV-1",
          taskTitle: "Process Claude Code setup video",
          agentId: "agent-123",
          agentName: "Scout",
          mode: "discuss",
          source: "task-detail",
        },
      });

      assert.ok(saved.filePath.startsWith(mcWorkspaceRoot), `expected HiveRunner workspace path, got ${saved.filePath}`);
      assert.ok(!saved.filePath.startsWith(openclawWorkspaceRoot), `did not expect OpenClaw workspace path, got ${saved.filePath}`);
      assert.ok(saved.workspaceRoot.startsWith(mcWorkspaceRoot), `expected HiveRunner workspace root, got ${saved.workspaceRoot}`);

      const markdown = readFileSync(saved.filePath, "utf-8");
      assert.match(markdown, /NEV-1/);
      assert.match(markdown, /Ideas Pipeline/);
      assert.match(markdown, /Scout/);

      const rollup = readFileSync(saved.rollupPath, "utf-8");
      assert.match(rollup, /NEV-1/);
      assert.match(rollup, /task-bound/i);
    });

    await test("unbound transcripts still stay inside HiveRunner workspace instead of OpenClaw workspace", async () => {
      const saved = await persistVoiceTranscript(transcript);
      assert.ok(saved.filePath.startsWith(mcWorkspaceRoot), `expected HiveRunner workspace path, got ${saved.filePath}`);
      assert.ok(!saved.filePath.startsWith(openclawWorkspaceRoot), `did not expect OpenClaw workspace path, got ${saved.filePath}`);
      assert.match(saved.workspaceRoot, /mc-workspaces/);
    });

    await test("transcript route writes task-bound proof comment in the same request", async () => {
      const response = await POST(new Request("http://localhost/api/voice/transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "route-proof-session",
          binding: {
            scope: "task",
            companySlug: company.slug,
            projectId: project.id,
            projectSlug: project.slug,
            projectName: project.name,
            taskId: task.id,
            taskKey: task.key,
            taskTitle: task.title,
            agentId: agent.id,
            agentName: agent.name,
            mode: "discuss",
            source: "task-detail",
          },
          acceptedMarkers: [],
          transcript,
        }),
      }) as never);

      assert.equal(response.status, 200);
      const body = await response.json() as { outcome?: { createdSessionComment?: boolean } };
      assert.equal(body.outcome?.createdSessionComment, true);

      const comments = listTaskComments(task.id).comments;
      assert.equal(comments.length, 1);
      assert.match(comments[0]!.text, /Voice session recorded/i);
    });
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

void run();
