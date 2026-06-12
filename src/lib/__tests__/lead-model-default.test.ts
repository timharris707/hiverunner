import assert from "node:assert";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import {
  LEAD_RECOMMENDED_MODEL,
  LEAD_RECOMMENDED_REASONING_EFFORT,
  leadDefaultFromProbeOutcome,
} from "@/lib/orchestration/lead-model-default";

const { finish, test } = createTestRunner({ passLabel: "pass", failLabel: "fail" });

async function run() {
  console.log("\nLead Model Default Tests\n");

  await test("verified probe recommends the frontier model at extra-high thinking", () => {
    const verified = leadDefaultFromProbeOutcome("ok");
    assert.equal(verified.model, LEAD_RECOMMENDED_MODEL);
    assert.equal(verified.model, "anthropic/claude-fable-5");
    assert.equal(verified.reasoningEffort, LEAD_RECOMMENDED_REASONING_EFFORT);
    assert.equal(verified.reasoningEffort, "xhigh");
    assert.equal(verified.source, "verified");
    assert.ok(verified.note.trim());
  });

  await test("unservable model degrades to the anthropic deep-reasoning tier (Opus) with a visible note", () => {
    const fallback = leadDefaultFromProbeOutcome("model_unavailable");
    assert.equal(fallback.model, "anthropic/claude-opus-4-8");
    assert.equal(fallback.source, "fallback_anthropic");
    assert.equal(fallback.reasoningEffort, "xhigh");
    assert.ok(fallback.note.trim());
  });

  await test("missing CLI keeps the provider default so clone-and-run never hard-fails", () => {
    const fallback = leadDefaultFromProbeOutcome("cli_missing");
    assert.equal(fallback.model, "openai-codex/gpt-5.5");
    assert.equal(fallback.source, "fallback_provider");
    assert.equal(fallback.reasoningEffort, null);
    assert.ok(fallback.note.trim());
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
