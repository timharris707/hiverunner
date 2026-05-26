import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { GET, POST } from "@/app/api/orchestration/runtime-models/route";

async function json(response: Response) {
  return await response.json() as { models?: Array<{ id?: string }>; error?: string };
}

async function run() {
  const getResponse = await GET(new NextRequest("http://localhost/api/orchestration/runtime-models?provider=codex"));
  assert.equal(getResponse.status, 200);
  const getPayload = await json(getResponse);
  assert.ok(getPayload.models?.some((model) => model.id === "openai-codex/gpt-5.5"));

  const postResponse = await POST(new NextRequest("http://localhost/api/orchestration/runtime-models", {
    method: "POST",
    body: JSON.stringify({ provider: "gemini" }),
  }));
  assert.equal(postResponse.status, 200);
  const postPayload = await json(postResponse);
  assert.ok(postPayload.models?.some((model) => model.id === "google/gemini-3-pro-preview"));

  const missingProviderResponse = await GET(new NextRequest("http://localhost/api/orchestration/runtime-models"));
  assert.equal(missingProviderResponse.status, 400);

  console.log("Runtime models route test passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
