import assert from "node:assert/strict";
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
      console.log(`  ✓ ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${name}`);
      console.error(`    ${message}`);
    });
}

console.log("\nVoice Usage Cost Tracking Tests\n");

async function run() {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "mc-voice-cost-"));
  const dbPath = path.join(tmpRoot, "voice-cost.db");
  const originalDbPath = process.env.ORCHESTRATION_DB_PATH;
  process.env.ORCHESTRATION_DB_PATH = dbPath;

  try {
    const { createCompany } = await import("@/lib/orchestration/company-service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
    const { persistVoiceCostEvent } = await import("@/lib/voice-cost-persistence");
    const {
      createVoiceUsageTelemetry,
      mergeGeminiLiveUsage,
      mergeOpenAiRealtimeUsage,
    } = await import("@/lib/voice-usage-telemetry");

    const company = createCompany({
      name: `Voice Cost Co ${Date.now()}`,
      description: "fixture",
      status: "active",
    }).company;
    const project = createProject({
      companyId: company.id,
      name: `Voice Cost Project ${Date.now()}`,
      description: "fixture",
      color: "#0ea5e9",
      emoji: "🎙️",
      status: "active",
    }).project;
    const agent = createProjectAgent({
      projectId: project.id,
      name: "Linda Voice Cost",
      role: "Buyer",
      personality: "Clear and practical.",
      skills: ["voice", "testing"],
      status: "idle",
    }).agent;
    const task = createTask({
      projectId: project.id,
      title: "Track voice session cost",
      description: "fixture",
      priority: "P2",
      type: "feature",
      status: "to-do",
      assignee: agent.id,
      labels: ["voice"],
      createdBy: "test",
    }).task;
    const binding = {
      scope: "task" as const,
      companySlug: company.slug,
      projectId: project.id,
      projectSlug: project.slug,
      projectName: project.name,
      taskId: task.id,
      taskKey: task.key ?? task.id,
      taskTitle: task.title,
      agentId: agent.id,
      agentName: agent.name,
      mode: "discuss" as const,
      source: "task-detail" as const,
    };

    await test("OpenAI Realtime response usage records one deduped voice cost event", () => {
      const usage = createVoiceUsageTelemetry("openai-realtime-2", "gpt-realtime-2");
      mergeOpenAiRealtimeUsage(usage, {
        total_tokens: 253,
        input_tokens: 132,
        output_tokens: 121,
        input_token_details: {
          text_tokens: 119,
          audio_tokens: 13,
          cached_tokens: 64,
          cached_tokens_details: { text_tokens: 64, audio_tokens: 0 },
        },
        output_token_details: {
          text_tokens: 30,
          audio_tokens: 91,
        },
      });

      const first = persistVoiceCostEvent({ sessionId: "voice-openai-cost", binding, usage, durationSeconds: 30, messages: 2 });
      const second = persistVoiceCostEvent({ sessionId: "voice-openai-cost", binding, usage, durationSeconds: 30, messages: 2 });

      assert.equal(first, "voice:voice-openai-cost:openai-realtime-2:gpt-realtime-2");
      assert.equal(second, "voice:voice-openai-cost:openai-realtime-2:gpt-realtime-2");

      const rows = getOrchestrationDb()
        .prepare("SELECT provider, model, input_tokens, output_tokens, cost_cents FROM cost_events WHERE id = ?")
        .all(first) as Array<{ provider: string; model: string; input_tokens: number; output_tokens: number; cost_cents: number }>;
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.provider, "openai");
      assert.equal(rows[0]!.model, "gpt-realtime-2");
      assert.equal(rows[0]!.input_tokens, 132);
      assert.equal(rows[0]!.output_tokens, 121);
      assert.ok(rows[0]!.cost_cents > 0);
    });

    await test("Gemini Live usage metadata records token and estimated cost detail", () => {
      const usage = createVoiceUsageTelemetry("gemini-live", "gemini-3.1-flash-live-preview");
      mergeGeminiLiveUsage(usage, {
        promptTokenCount: 250,
        candidatesTokenCount: 120,
        totalTokenCount: 370,
        promptTokensDetails: [
          { modality: "AUDIO", tokenCount: 200 },
          { modality: "TEXT", tokenCount: 50 },
        ],
        responseTokensDetails: [
          { modality: "AUDIO", tokenCount: 100 },
          { modality: "TEXT", tokenCount: 20 },
        ],
      });

      const eventId = persistVoiceCostEvent({ sessionId: "voice-gemini-cost", binding, usage, durationSeconds: 20, messages: 2 });
      assert.equal(eventId, "voice:voice-gemini-cost:gemini-live:gemini-3.1-flash-live-preview");

      const row = getOrchestrationDb()
        .prepare("SELECT provider, model, input_tokens, output_tokens, cost_cents FROM cost_events WHERE id = ?")
        .get(eventId) as { provider: string; model: string; input_tokens: number; output_tokens: number; cost_cents: number } | undefined;
      assert.ok(row);
      assert.equal(row.provider, "gemini");
      assert.equal(row.model, "gemini-3.1-flash-live-preview");
      assert.equal(row.input_tokens, 250);
      assert.equal(row.output_tokens, 120);
      assert.ok(row.cost_cents > 0);
    });
  } finally {
    if (originalDbPath === undefined) {
      delete process.env.ORCHESTRATION_DB_PATH;
    } else {
      process.env.ORCHESTRATION_DB_PATH = originalDbPath;
    }
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
