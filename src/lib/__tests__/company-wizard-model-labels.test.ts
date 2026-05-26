import assert from "node:assert";

import { COMPANY_WIZARD_MODEL_FALLBACK } from "@/lib/orchestration/company-wizard";

const BANNED_LABEL_PATTERNS = [
  /\bGPT\b/i,
  /\bClaude\b/i,
  /\bGemini\b/i,
  /\bOpenAI\b/i,
  /\bAnthropic\b/i,
  /\bGoogle\b/i,
];

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  pass ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  fail ${name}`);
    console.error(`    ${message}`);
  }
}

console.log("\nCompany Wizard Model Label Tests\n");

test("CEO model labels are neutral while routing values stay intact", () => {
  assert.equal(COMPANY_WIZARD_MODEL_FALLBACK.length, 11);

  const expectedValues = [
    "openai-codex/gpt-5.5",
    "openai-codex/gpt-5.4",
    "openai-codex/gpt-5.3-codex",
    "anthropic/claude-sonnet-4-6",
    "anthropic/claude-opus-4-6",
    "anthropic/claude-haiku-4-5",
    "google/gemini-3-pro-preview",
    "google/gemini-3.1-pro-preview",
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

if (failed > 0) {
  console.error(`\n${failed} failed, ${passed} passed`);
  process.exit(1);
}

console.log(`\n${passed} passed, ${failed} failed`);
