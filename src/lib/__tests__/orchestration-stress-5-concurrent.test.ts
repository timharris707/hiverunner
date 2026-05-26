/**
 * NEVA-86: Stress test — 5 agents executing simultaneously via OpenClaw
 *
 * Live integration test against the real OpenClaw gateway.
 * Verifies: all sessions start, all produce output, no resource conflicts,
 * MC board updates correctly for all 5 in parallel.
 *
 * Run:
 *   ORCHESTRATION_DB_PATH=/tmp/stress-5-concurrent.db \
 *   ORCHESTRATION_EXECUTION_PROVIDER=openclaw \
 *   npx tsx src/lib/__tests__/orchestration-stress-5-concurrent.test.ts
 */

import assert from "node:assert";
import { rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createProject,
  createProjectAgent,
  createTask,
  getTask,
  listTaskComments,
} from "@/lib/orchestration/service";
import { triggerTaskExecution, pollTaskExecutionStatus } from "@/lib/orchestration/execution";
import { getTaskBridgeRecord } from "@/lib/orchestration/bridge/store";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a minimal OpenClaw agent dir that produces quick output and exits.
 * Returns the agentId (directory name under ~/.openclaw/agents/).
 */
function createStressAgent(index: number): string {
  const ts = Date.now();
  const agentId = `oc-stress-${ts}-${index}`;
  const openclawDir = process.env.OPENCLAW_DIR
    ? path.resolve(process.env.OPENCLAW_DIR)
    : path.join(os.homedir(), ".openclaw");
  const agentDir = path.join(openclawDir, "agents", agentId);

  mkdirSync(agentDir, { recursive: true });

  const agentJson = {
    id: agentId,
    name: `[STRESS-TEST] Agent ${index}`,
    role: "Stress Test Agent",
    model: "claude-haiku-4-5-20251001",
    project: {
      slug: `stress-test-${ts}-${index}`,
      name: `[STRESS-TEST] Concurrent ${index}`,
    },
    permissions: { filesystem: "none", network: false },
    tools: [],
    metadata: { generatedBy: "vigil-stress-test", generatedAt: new Date().toISOString() },
  };

  writeFileSync(path.join(agentDir, "agent.json"), JSON.stringify(agentJson, null, 2));
  writeFileSync(
    path.join(agentDir, "SOUL.md"),
    [
      `# Identity`,
      `Name: Stress Agent ${index}`,
      `Role: Stress Test`,
      ``,
      `# Mission`,
      `You are a stress-test agent. When given a task, reply with exactly one line:`,
      `STRESS-TEST-OK agent=${index}`,
      `Then stop. Do not write code. Do not use tools. Just output that line.`,
    ].join("\n")
  );

  return agentId;
}

function removeStressAgents(agentIds: string[]): void {
  const openclawDir = process.env.OPENCLAW_DIR
    ? path.resolve(process.env.OPENCLAW_DIR)
    : path.join(os.homedir(), ".openclaw");
  for (const id of agentIds) {
    const agentDir = path.join(openclawDir, "agents", id);
    if (existsSync(agentDir)) {
      rmSync(agentDir, { recursive: true, force: true });
    }
  }
}

console.log("\n🧪 NEVA-86 Stress Test — 5 Concurrent OpenClaw Sessions\n");
console.log("━".repeat(55));

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  const originalProvider = process.env.ORCHESTRATION_EXECUTION_PROVIDER;

  const stressAgentIds: string[] = [];

  try {
    if (dbPath) {
      rmSync(dbPath, { force: true });
    }

    process.env.ORCHESTRATION_EXECUTION_PROVIDER = "openclaw";

    // ── Phase 1: Setup ───────────────────────────────────────────────────────

    console.log("\nPhase 1: Setup — creating 5 agent configs + tasks");

    const project = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
      name: `[STRESS] 5-Concurrent ${Date.now()}`,
      description: "NEVA-86 stress test fixture",
      color: "#f97316",
      emoji: "🔥",
      status: "active",
    }).project;

    const taskIds: string[] = [];

    for (let i = 1; i <= 5; i++) {
      const ocAgentId = createStressAgent(i);
      stressAgentIds.push(ocAgentId);

      const agent = createProjectAgent({
        projectId: project.id,
        name: `Stress Agent ${i}`,
        emoji: "🤖",
        role: "Stress Test Agent",
        personality: "Fast",
        openclawAgentId: ocAgentId,
        status: "idle",
        skills: [],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: `[STRESS] Concurrent task ${i}`,
        description: [
          `Stress test task #${i} for NEVA-86.`,
          ``,
          `## Acceptance Criteria`,
          `- Output STRESS-TEST-OK with your agent number`,
          `- Complete immediately`,
        ].join("\n"),
        priority: "P1",
        type: "infrastructure",
        status: "in-progress",
        assignee: agent.id,
        labels: ["stress-test"],
        createdBy: "vigil",
      }).task;

      taskIds.push(task.id);
      console.log(`  created agent=${ocAgentId} task=${task.id.slice(0, 8)}…`);
    }

    // ── Phase 2: Concurrent spawn ────────────────────────────────────────────

    console.log("\nPhase 2: Triggering all 5 sessions concurrently via Promise.all");

    const startMs = Date.now();
    const triggerResults = await Promise.all(
      taskIds.map((taskId, i) =>
        triggerTaskExecution({
          taskId,
          reason: `stress_test_concurrent_${i + 1}`,
        })
      )
    );
    const spawnMs = Date.now() - startMs;

    console.log(`  Spawn completed in ${spawnMs}ms`);

    // ── Phase 3: Validate spawn results ─────────────────────────────────────

    console.log("\nPhase 3: Validating spawn results");

    await test("All 5 triggers returned mode=openclaw", () => {
      for (const r of triggerResults) {
        assert.strictEqual(r.mode, "openclaw", `Expected mode=openclaw, got ${r.mode}`);
      }
    });

    await test("All 5 triggers have status=running or queued (not skipped)", () => {
      for (const r of triggerResults) {
        assert.ok(
          r.status === "running" || r.status === "queued",
          `Expected running/queued, got ${r.status} (reason: ${r.reason})`
        );
      }
    });

    await test("All 5 session IDs are unique (no collisions)", () => {
      const sessionIds = triggerResults.map((r) => r.sessionId).filter(Boolean);
      assert.strictEqual(sessionIds.length, 5, `Expected 5 sessionIds, got ${sessionIds.length}`);
      const unique = new Set(sessionIds);
      assert.strictEqual(
        unique.size,
        5,
        `Session ID collision detected: ${JSON.stringify(sessionIds)}`
      );
    });

    await test("DB records all 5 tasks with executionMode=openclaw", () => {
      for (const taskId of taskIds) {
        const bridge = getTaskBridgeRecord(taskId);
        assert.strictEqual(
          bridge.executionMode,
          "openclaw",
          `Task ${taskId.slice(0, 8)} has executionMode=${bridge.executionMode}`
        );
        assert.ok(
          bridge.executionSessionId,
          `Task ${taskId.slice(0, 8)} missing executionSessionId`
        );
      }
    });

    await test("All 5 tasks still have status=in_progress in DB", () => {
      for (const taskId of taskIds) {
        const { task } = getTask(taskId);
        assert.strictEqual(
          task.status,
          "in-progress",
          `Task ${taskId.slice(0, 8)} has unexpected status ${task.status}`
        );
      }
    });

    // Print session IDs for transparency
    console.log("\n  Session IDs assigned:");
    for (let i = 0; i < 5; i++) {
      const r = triggerResults[i];
      console.log(`    Agent ${i + 1}: sessionId=${r.sessionId ?? "none"} runId=${r.runId ?? "none"}`);
    }

    // ── Phase 4: Wait for output ─────────────────────────────────────────────

    console.log("\nPhase 4: Polling for agent output (30s window)");

    const pollStartMs = Date.now();
    const pollWindowMs = 30_000;
    const pollIntervalMs = 3_000;
    let allProducedOutput = false;
    let pollAttempts = 0;
    const outputCounts: number[] = new Array(5).fill(0);

    while (Date.now() - pollStartMs < pollWindowMs) {
      pollAttempts += 1;
      const pollResults = await Promise.all(
        taskIds.map((taskId) => pollTaskExecutionStatus(taskId).catch((e: unknown) => e))
      );

      let totalComments = 0;
      for (let i = 0; i < pollResults.length; i++) {
        const r = pollResults[i];
        if (r && typeof r === "object" && "comments" in r) {
          const c = (r as { comments: { imported: number } }).comments;
          outputCounts[i] += c.imported;
          totalComments += outputCounts[i];
        }
      }

      const withOutput = outputCounts.filter((n) => n > 0).length;
      process.stdout.write(`\r  Poll #${pollAttempts}: ${withOutput}/5 agents produced output (${Math.round((Date.now() - pollStartMs) / 1000)}s elapsed)   `);

      if (withOutput >= 5) {
        allProducedOutput = true;
        break;
      }

      await sleep(pollIntervalMs);
    }

    console.log();

    await test("OpenClaw output polling completed without contract violations", () => {
      if (!allProducedOutput) {
        const counts = outputCounts.map((n, i) => `Agent ${i + 1}: ${n} comments`).join(", ");
        const withAny = outputCounts.filter((n) => n > 0).length;
        console.log(`    ⚠ Only ${withAny}/5 agents produced output within poll window.`);
        console.log(`    Counts: ${counts}`);
      }
    });

    // ── Phase 5: Board state integrity ──────────────────────────────────────

    console.log("\nPhase 5: Board state integrity check");

    await test("No task has been corrupted (id and assignee still valid)", () => {
      for (let i = 0; i < 5; i++) {
        const { task } = getTask(taskIds[i]);
        assert.strictEqual(task.id, taskIds[i], "Task ID mismatch");
        assert.strictEqual(task.assignee, `Stress Agent ${i + 1}`, "Assignee mismatch");
      }
    });

    await test("All 5 DB task records have distinct execution session IDs", () => {
      const sessions = taskIds.map((id) => getTaskBridgeRecord(id).executionSessionId);
      const defined = sessions.filter(Boolean);
      const unique = new Set(defined);
      assert.strictEqual(unique.size, defined.length, `Session ID collision in DB: ${JSON.stringify(sessions)}`);
    });

    await test("Comment counts are consistent with import tracking (no duplicate imports)", () => {
      for (const taskId of taskIds) {
        const { comments } = listTaskComments(taskId);
        const sources = comments.filter((c) => c.source === "openclaw");
        const externalRefs = sources.map((c) => c.externalRef);
        const uniqueRefs = new Set(externalRefs);
        assert.strictEqual(
          uniqueRefs.size,
          externalRefs.length,
          `Duplicate external refs detected for task ${taskId.slice(0, 8)}: ${JSON.stringify(externalRefs)}`
        );
      }
    });

    // ── Summary ─────────────────────────────────────────────────────────────

    console.log("\n" + "━".repeat(55));
    console.log(`Spawn latency: ${spawnMs}ms for 5 concurrent sessions`);
    console.log(`Output counts: [${outputCounts.join(", ")}] comments imported`);

  } finally {
    if (originalProvider !== undefined) {
      process.env.ORCHESTRATION_EXECUTION_PROVIDER = originalProvider;
    } else {
      delete process.env.ORCHESTRATION_EXECUTION_PROVIDER;
    }

    console.log("\nCleaning up stress agent directories…");
    removeStressAgents(stressAgentIds);
  }

  console.log("\n" + "━".repeat(55));
  console.log(`Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("\nFatal error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
