import assert from "node:assert/strict";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

async function json(response: Response) {
  return await response.json() as { models?: Array<{ id?: string; label?: string; default?: boolean }>; error?: string };
}

async function run() {
  if (!process.env.ORCHESTRATION_DB_PATH) {
    process.env.ORCHESTRATION_DB_PATH = path.join(os.tmpdir(), `mc-runtime-models-route-${Date.now()}.db`);
  }
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  const [{ GET, POST }, { getOrchestrationDb }, { discoverRuntimeModels }, availableModelsService] = await Promise.all([
    import("@/app/api/orchestration/runtime-models/route"),
    import("@/lib/orchestration/db"),
    import("@/lib/orchestration/runtime-models"),
    import("@/lib/orchestration/service/available-models"),
  ]);
  const { createAvailableModel, updateAvailableModel } = availableModelsService;
  const db = getOrchestrationDb();

  updateAvailableModel("gpt-5", { displayName: "Catalog GPT Five" }, db);
  createAvailableModel({
    id: "gpt-5.6",
    displayName: "Catalog GPT 5.6",
    runtimeProvider: "openai",
    defaultRuntimeLabel: "Codex",
    modelSourceId: "openai",
    capabilities: ["text", "tools"],
  }, db);

  const getResponse = await GET(new NextRequest("http://localhost/api/orchestration/runtime-models?provider=codex"));
  assert.equal(getResponse.status, 200);
  const getPayload = await json(getResponse);
  assert.ok(getPayload.models?.some((model) => model.id === "openai-codex/gpt-5.6" && model.label === "Catalog GPT 5.6"));
  assert.ok(getPayload.models?.some((model) => model.id === "openai-codex/gpt-5" && model.label === "Catalog GPT Five"));
  assert.ok(getPayload.models?.some((model) => model.id === "openai-codex/gpt-5.5"));

  const postResponse = await POST(new NextRequest("http://localhost/api/orchestration/runtime-models", {
    method: "POST",
    body: JSON.stringify({ provider: "gemini" }),
  }));
  assert.equal(postResponse.status, 200);
  const postPayload = await json(postResponse);
  assert.ok(postPayload.models?.some((model) => model.id === "google/gemini-3-pro-preview"));

  db.prepare("UPDATE available_models SET is_active = 0 WHERE runtime_provider = 'anthropic'").run();
  const fallbackResponse = await GET(new NextRequest("http://localhost/api/orchestration/runtime-models?provider=anthropic"));
  assert.equal(fallbackResponse.status, 200);
  const fallbackPayload = await json(fallbackResponse);
  assert.ok(!fallbackPayload.models?.some((model) => model.id === "anthropic/claude-sonnet-4-8"));
  assert.ok(!fallbackPayload.models?.some((model) => model.id === "anthropic/claude-haiku-4-8"));
  assert.ok(fallbackPayload.models?.some((model) => model.id === "anthropic/claude-opus-4-8"));
  assert.ok(fallbackPayload.models?.some((model) => model.id === "anthropic/claude-sonnet-4-6"));

  const commandPath = path.join(os.tmpdir(), `mc-openclaw-models-${Date.now()}.sh`);
  writeFileSync(
    commandPath,
    [
      "#!/bin/sh",
      "printf '%s\\n' '{\"models\":[{\"key\":\"local/llama-4\",\"name\":\"Llama 4 Local\",\"contextWindow\":131072,\"tags\":[\"default\"]}]}'",
    ].join("\n"),
    "utf8",
  );
  chmodSync(commandPath, 0o755);
  const openClawResult = discoverRuntimeModels({ provider: "openclaw", commandPath });
  assert.equal(openClawResult.models[0]?.id, "local/llama-4");
  assert.equal(openClawResult.models[0]?.label, "Llama 4 Local");
  assert.equal(openClawResult.models[0]?.default, true);
  rmSync(commandPath, { force: true });

  const missingProviderResponse = await GET(new NextRequest("http://localhost/api/orchestration/runtime-models"));
  assert.equal(missingProviderResponse.status, 400);

  console.log("Runtime models route test passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
