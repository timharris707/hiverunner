import assert from "node:assert/strict";

import {
  normalizeAvatarWizardErrorMessage,
  normalizeSafeErrorMessage,
} from "@/lib/orchestration/avatar-wizard-errors";

function run() {
  assert.equal(
    normalizeAvatarWizardErrorMessage(
      { error: { code: "voice_api_not_configured", message: "Add OPENAI_API_KEY to enable previews." } },
      "Fallback",
    ),
    "Add OPENAI_API_KEY to enable previews.",
  );

  assert.equal(
    normalizeAvatarWizardErrorMessage(
      { message: "Preview generation failed" },
      "Fallback",
    ),
    "Preview generation failed",
  );

  assert.equal(
    normalizeAvatarWizardErrorMessage(
      { error: { error: { message: "Nested error" } } },
      "Fallback",
    ),
    "Nested error",
  );

  assert.equal(
    normalizeAvatarWizardErrorMessage(
      { error: { code: "broken_payload" } },
      "Fallback",
    ),
    "Fallback",
  );

  assert.equal(
    normalizeAvatarWizardErrorMessage("   direct message   ", "Fallback"),
    "direct message",
  );

  assert.equal(
    normalizeSafeErrorMessage(
      {
        error: {
          code: "gemini_api_key_not_configured",
          message: "Voice chat is optional and needs GOOGLE_AI_API_KEY or GEMINI_API_KEY before Start call can connect.",
        },
        setup: {
          note: "Voice chat is optional; the rest of HiveRunner works without this key.",
          steps: [
            "Add GOOGLE_AI_API_KEY=your-key or GEMINI_API_KEY=your-key to .env.local",
            "Restart the dev server",
          ],
        },
      },
      "Fallback",
    ),
    "Voice chat is optional and needs GOOGLE_AI_API_KEY or GEMINI_API_KEY before Start call can connect. Voice chat is optional; the rest of HiveRunner works without this key. Add GOOGLE_AI_API_KEY=your-key or GEMINI_API_KEY=your-key to .env.local Restart the dev server",
  );

  assert.equal(
    normalizeSafeErrorMessage(
      { error: { code: "broken_payload" } },
      "Fallback",
    ),
    "Fallback",
  );

  assert.equal(
    normalizeSafeErrorMessage(new Error("[object Object]"), "Fallback"),
    "Fallback",
  );

  console.log("Avatar wizard error normalization test passed");
}

run();
