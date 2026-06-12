import assert from "node:assert";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { COMPANY_WIZARD_MODEL_FALLBACK } from "@/lib/orchestration/company-wizard";

const BANNED_LABEL_PATTERNS = [
  /\bGPT\b/i,
  /\bClaude\b/i,
  /\bGemini\b/i,
  /\bOpenAI\b/i,
  /\bAnthropic\b/i,
  /\bGoogle\b/i,
];

const { finish, test } = createTestRunner({ passLabel: "pass", failLabel: "fail" });

async function run() {
  console.log("\nCompany Wizard Model Label Tests\n");

  await test("CEO model labels are neutral while routing values stay intact", () => {
    assert.equal(COMPANY_WIZARD_MODEL_FALLBACK.length, 13);

    const expectedValues = [
      "anthropic/claude-fable-5",
      "openai-codex/gpt-5.5",
      "openai-codex/gpt-5.4",
      "openai-codex/gpt-5.3-codex",
      "anthropic/claude-sonnet-4-6",
      "anthropic/claude-opus-4-8",
      "anthropic/claude-haiku-4-5",
      "google/gemini-3-pro-preview",
      "google/gemini-3.1-pro-preview",
      "google/gemini-3.5-flash",
      "google/gemini-3-flash-preview",
      "google/gemini-2.5-pro",
      "google/gemini-2.5-flash",
    ];

    assert.deepEqual(
      COMPANY_WIZARD_MODEL_FALLBACK.map((model) => model.value),
      expectedValues,
    );

    for (const model of COMPANY_WIZARD_MODEL_FALLBACK) {
      assert.ok(model.label.trim(), `${model.value} needs a visible label`);
      for (const pattern of BANNED_LABEL_PATTERNS) {
        assert.equal(pattern.test(model.label), false, `${model.value} label includes provider/model copy`);
      }
    }
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
