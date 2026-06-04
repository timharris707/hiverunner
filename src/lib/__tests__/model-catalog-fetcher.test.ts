import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  refreshAllAvailableModels,
  refreshAnthropicModels,
  refreshGoogleModels,
  refreshOpenAiModels,
  refreshOpenRouterModels,
} from "@/lib/orchestration/model-catalog-fetcher";
import {
  createAvailableModel,
  getAvailableModelOrThrow,
  listAvailableModelRefreshStatuses,
  listAvailableModels,
  updateAvailableModel,
} from "@/lib/orchestration/service/available-models";

process.env.ORCHESTRATION_DB_PATH ||= path.join(os.tmpdir(), `mc-model-catalog-fetcher-${Date.now()}.db`);

const { finish, test } = createTestRunner({ passLabel: "pass", failLabel: "fail", errorStackLines: 20 });

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  } as Response;
}

async function run() {
  console.log("\nModel Catalog Fetcher Tests\n");
  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);
  const db = getOrchestrationDb();

  await test("OpenAI refresh filters to chat-capable models", async () => {
    const result = await refreshOpenAiModels({
      env: { OPENAI_API_KEY: "test-key" },
      fetcher: async () => jsonResponse({
        data: [
          { id: "gpt-5" },
          { id: "gpt-4o-mini" },
          { id: "text-embedding-3-large" },
          { id: "whisper-1" },
        ],
      }),
    });
    assert.equal(result.status, "refreshed");
    assert.deepEqual(result.models.map((model) => model.id), ["gpt-5", "gpt-4o-mini"]);
  });

  await test("Google refresh keeps generateContent models", async () => {
    const result = await refreshGoogleModels({
      env: { GEMINI_API_KEY: "test-key" },
      fetcher: async () => jsonResponse({
        models: [
          { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
          { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] },
        ],
      }),
    });
    assert.equal(result.status, "refreshed");
    assert.deepEqual(result.models.map((model) => model.id), ["gemini-2.5-pro"]);
  });

  await test("OpenRouter refresh maps broker catalog", async () => {
    const result = await refreshOpenRouterModels({
      env: { OPENROUTER_API_KEY: "test-key" },
      fetcher: async () => jsonResponse({
        data: [
          { id: "openai/gpt-5", name: "OpenAI: GPT-5", context_length: 128000 },
        ],
      }),
    });
    assert.equal(result.status, "refreshed");
    assert.equal(result.models[0]?.runtimeProvider, "openrouter");
    assert.equal(result.models[0]?.contextWindow, 128000);
  });

  await test("Anthropic refresh uses official model response when key exists", async () => {
    const result = await refreshAnthropicModels({
      env: { ANTHROPIC_API_KEY: "test-key" },
      fetcher: async () => jsonResponse({
        data: [
          { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" },
        ],
      }),
    });
    assert.equal(result.status, "refreshed");
    assert.equal(result.models[0]?.id, "claude-sonnet-4-6");
  });

  await test("refresh upserts seed models without overwriting operator-added rows", async () => {
    createAvailableModel({
      id: "gpt-custom",
      displayName: "Operator GPT Custom",
      runtimeProvider: "openai",
      defaultRuntimeLabel: "Codex",
      modelSourceId: "openai",
      capabilities: ["text"],
      description: "operator owned",
    }, db);
    updateAvailableModel("gpt-5", { isActive: false }, db);

    const statuses = await refreshAllAvailableModels({
      db,
      env: {
        OPENAI_API_KEY: "test-key",
        GOOGLE_API_KEY: "test-key",
        ANTHROPIC_API_KEY: "test-key",
        OPENROUTER_API_KEY: "test-key",
      },
      fetcher: async (url) => {
        const text = String(url);
        if (text.includes("openai.com")) return jsonResponse({ data: [{ id: "gpt-5" }, { id: "gpt-new" }] });
        if (text.includes("generativelanguage")) return jsonResponse({ models: [{ name: "models/gemini-new", supportedGenerationMethods: ["generateContent"] }] });
        if (text.includes("openrouter.ai")) return jsonResponse({ data: [{ id: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.6" }] });
        if (text.includes("anthropic.com")) return jsonResponse({ data: [{ id: "claude-opus-4-7", display_name: "Claude Opus 4.7" }] });
        return jsonResponse({}, false, 404);
      },
    });

    assert.ok(statuses.some((status) => status.provider === "openai" && status.status === "refreshed"));
    assert.equal(getAvailableModelOrThrow("gpt-custom", db).displayName, "Operator GPT Custom");
    assert.equal(getAvailableModelOrThrow("gpt-5", db).isActive, false);
    assert.equal(getAvailableModelOrThrow("gpt-new", db).isSeed, true);
    assert.ok(listAvailableModels({ includeInactive: true }, db).some((model) => model.id === "gemini-new"));
    assert.ok(listAvailableModelRefreshStatuses(db).length >= 4);
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
