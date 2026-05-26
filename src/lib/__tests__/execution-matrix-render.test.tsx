import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ExecutionMatrix } from "@/app/(dashboard)/companies/[slug]/runtimes/execution-matrix";
import { SEEDED_EXECUTION_HIVES, SEEDED_MODEL_SOURCES } from "@/lib/orchestration/execution-hives";

const html = renderToStaticMarkup(<ExecutionMatrix selectedHive={SEEDED_EXECUTION_HIVES[0]} />);

assert.match(html, /data-execution-matrix-path="animated"/);
assert.doesNotMatch(html, /Hive → Mode/);
assert.doesNotMatch(html, /Mode → Runtime/);
assert.doesNotMatch(html, /Runtime → Model Routing/);
assert.doesNotMatch(html, /interactive routing selector/);
assert.doesNotMatch(html, /Clean taxonomy/);
assert.doesNotMatch(html, /Probe coverage/);
assert.match(html, /animation:/);
assert.equal((html.match(/height:560px/g) ?? []).length, 6);
assert.match(html, /execution-matrix-scroll/);
assert.match(html, /Symphony/);
assert.match(html, /HiveRunner Native/);
assert.match(html, /Manual/);
assert.match(html, /aria-label="Select mode: Symphony"/);
assert.match(html, /data-matrix-option="mode:symphony"/);
assert.match(html, /Claude Code/);
assert.match(html, /Codex/);
assert.match(html, /Gemini CLI/);
assert.match(html, /Hermes/);
assert.match(html, /OpenClaw/);
assert.match(html, /aria-label="Select runtime: Claude Code"/);
assert.match(html, /data-matrix-option="runtime:claude-code"/);
assert.match(html, /Runtime managed/);
assert.match(html, /Hive managed/);
assert.match(html, /OpenRouter/);
assert.match(html, /aria-label="Select routing: Runtime managed"/);
assert.match(html, /data-matrix-option="routing:runtime-managed"/);
assert.match(html, /Pin to Anthropic source/);
assert.match(html, /policy \+ fallbacks/);

const credentialHtml = renderToStaticMarkup(
  <ExecutionMatrix
    selectedHive={SEEDED_EXECUTION_HIVES[0]}
    modelSources={SEEDED_MODEL_SOURCES.map((source) => (
      source.id === "openrouter" ? { ...source, status: "connected" as const, authSurface: "managed-secret-store" } : source
    ))}
  />,
);

assert.match(credentialHtml, /needs credential/);
assert.match(credentialHtml, /credential configured/);
assert.doesNotMatch(credentialHtml, /connected ·/);
assert.match(credentialHtml, /OpenRouter/);

const probedHtml = renderToStaticMarkup(
  <ExecutionMatrix
    selectedHive={SEEDED_EXECUTION_HIVES[0]}
    modelSources={SEEDED_MODEL_SOURCES}
    modelSourceProbes={{
      openrouter: {
        sourceId: "openrouter",
        status: "pass",
        label: "OpenRouter",
        checkedAt: "2026-05-09T00:00:00.000Z",
        endpointLabel: "OpenRouter key",
        latencyMs: 42,
        configuredSecretNames: ["OPENROUTER_API_KEY"],
        note: "OpenRouter key is valid.",
      },
    }}
  />,
);

assert.match(probedHtml, /probe passed · 42ms/);

console.log("Execution Matrix animated path render test passed");
