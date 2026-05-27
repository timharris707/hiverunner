import assert from "node:assert/strict";

import {
  normalizeAvatarPreviewResponse,
  normalizeAvatarProviderStatus,
} from "@/lib/orchestration/avatar-wizard-data";

function run() {
  assert.deepEqual(
    normalizeAvatarProviderStatus({
      provider: "openai",
      label: "OpenAI (DALL-E)",
      aiAvailable: true,
    }),
    {
      provider: "openai",
      label: "OpenAI (DALL-E)",
      aiAvailable: true,
    },
  );

  assert.deepEqual(
    normalizeAvatarProviderStatus({
      error: { message: "Add OPENAI_API_KEY to enable generated portraits." },
    }),
    {
      provider: "local",
      label: "AI image generation unavailable",
      aiAvailable: false,
      setupHint: "Add OPENAI_API_KEY to enable generated portraits.",
    },
  );

  assert.deepEqual(
    normalizeAvatarPreviewResponse({
      previews: [
        { url: "https://example.test/avatar.png" },
        "data:image/png;base64,abc123",
        { b64_json: "ZGF0YQ==" },
        "",
        null,
      ],
      error: { message: "Preview payload invalid" },
    }),
    {
      previews: [
        "https://example.test/avatar.png",
        "data:image/png;base64,abc123",
        "data:image/png;base64,ZGF0YQ==",
      ],
      error: "Preview payload invalid",
    },
  );

  assert.deepEqual(
    normalizeAvatarPreviewResponse({
      data: [
        { b64_json: "b3BlbmFpLWltYWdl" },
        { message: "not an image" },
      ],
    }),
    { previews: ["data:image/png;base64,b3BlbmFpLWltYWdl"] },
  );

  assert.deepEqual(
    normalizeAvatarPreviewResponse(null),
    { previews: [] },
  );

  console.log("Avatar wizard data normalization test passed");
}

run();
