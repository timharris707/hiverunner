import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProviderRuntimeConfigPatch,
  getProviderRuntimeControls,
  readProviderRuntimeSelection,
  supportsCodexFastMode,
  supportsGeminiThinkingLevel,
} from "@/lib/orchestration/provider-runtime-controls";

test("codex exposes xhigh reasoning and fast mode for verified GPT models", () => {
  const controls = getProviderRuntimeControls("codex", "openai-codex/gpt-5.5");
  assert.equal(controls?.reasoning.available, true);
  assert.deepEqual(controls?.reasoning.options.map((option) => option.value), ["low", "medium", "high", "xhigh"]);
  assert.equal(controls?.speed.available, true);
  assert.equal(supportsCodexFastMode("openai-codex/gpt-5.4"), true);
  assert.equal(supportsCodexFastMode("openai-codex/gpt-5.4-mini"), false);
});

test("anthropic exposes max reasoning but no unverified speed flag", () => {
  const controls = getProviderRuntimeControls("anthropic", "anthropic/claude-opus-4-6");
  assert.equal(controls?.reasoning.available, true);
  assert.deepEqual(controls?.reasoning.options.map((option) => option.value), ["low", "medium", "high", "xhigh", "max"]);
  assert.equal(controls?.speed.available, false);
  assert.equal(controls?.speed.options.find((option) => option.value === "fast")?.available, false);
  assert.deepEqual(
    readProviderRuntimeSelection("anthropic", { reasoningEffort: "max", fastMode: true }, "anthropic/claude-opus-4-6"),
    { reasoningEffort: "max", speedMode: null },
  );
});

test("gemini exposes thinking levels for Gemini 3 models and leaves speed to model tiers", () => {
  const controls = getProviderRuntimeControls("gemini", "google/gemini-3.5-flash");
  const proControls = getProviderRuntimeControls("gemini", "google/gemini-3-pro-preview");
  const pro31Controls = getProviderRuntimeControls("gemini", "google/gemini-3.1-pro-preview");
  assert.equal(controls?.reasoning.available, true);
  assert.deepEqual(controls?.reasoning.options.map((option) => option.value), ["minimal", "low", "medium", "high"]);
  assert.deepEqual(proControls?.reasoning.options.map((option) => option.value), ["low", "high"]);
  assert.deepEqual(pro31Controls?.reasoning.options.map((option) => option.value), ["low", "medium", "high"]);
  assert.equal(controls?.speed.available, false);
  assert.equal(supportsGeminiThinkingLevel("google/gemini-3-flash-preview"), true);
  assert.equal(supportsGeminiThinkingLevel("google/gemini-2.5-flash"), false);
  assert.deepEqual(
    readProviderRuntimeSelection("gemini", { thinkingLevel: "minimal", speedPreference: "fast" }, "google/gemini-3.5-flash"),
    { reasoningEffort: "minimal", speedMode: null },
  );
});

test("runtime selection reads legacy aliases without losing fast preference", () => {
  assert.deepEqual(
    readProviderRuntimeSelection("codex", {
      modelReasoningEffort: "xhigh",
      speedPreference: "fast_1_5x",
    }, "gpt-5.5"),
    { reasoningEffort: "xhigh", speedMode: "fast" },
  );
});

test("runtime patch writes compatibility keys for execution adapters", () => {
  assert.deepEqual(
    buildProviderRuntimeConfigPatch("codex", { reasoningEffort: "xhigh", speedMode: "fast" }),
    {
      reasoningEffort: "xhigh",
      modelReasoningEffort: "xhigh",
      thinkingLevel: "xhigh",
      fastMode: true,
      speedPreference: "fast",
      serviceTier: "fast",
    },
  );
});
