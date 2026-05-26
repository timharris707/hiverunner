import assert from "node:assert/strict";

import {
  buildRequestedVoiceBindingFromSearchParams,
  resolveDisplayVoiceBinding,
} from "@/lib/voice-requested-binding";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  ✗ ${name}`);
    console.error(`    ${message}`);
  }
}

function makeSearchParams(values: Record<string, string | undefined>) {
  return {
    get(name: string) {
      return values[name] ?? null;
    },
  };
}

console.log("\nRequested Voice Binding Tests\n");

test("empty search params produce no requested binding", () => {
  assert.equal(buildRequestedVoiceBindingFromSearchParams(makeSearchParams({})), null);
});

test("task query params preserve agent name for pre-connect UI copy", () => {
  const binding = buildRequestedVoiceBindingFromSearchParams(
    makeSearchParams({
      companySlug: "hive",
      projectSlug: "ideas-pipeline",
      taskKey: "NEV-1",
      agentId: "agent-1",
      agentName: "Scout",
      mode: "review",
      source: "task-detail",
    })
  );

  assert.deepEqual(binding, {
    scope: "task",
    companySlug: "hive",
    projectSlug: "ideas-pipeline",
    taskKey: "NEV-1",
    agentId: "agent-1",
    agentName: "Scout",
    mode: "review",
    source: "task-detail",
  });
});

test("display binding merges a richer requested agent name into the live binding", () => {
  const requested = buildRequestedVoiceBindingFromSearchParams(
    makeSearchParams({
      companySlug: "hive",
      projectSlug: "ideas-pipeline",
      taskKey: "NEV-1",
      agentId: "agent-1",
      agentName: "Scout",
      mode: "discuss",
      source: "task-detail",
    })
  );

  const resolved = resolveDisplayVoiceBinding(
    {
      scope: "task",
      companySlug: "hive",
      projectSlug: "ideas-pipeline",
      taskKey: "NEV-1",
      agentId: "agent-1",
      mode: "discuss",
      source: "task-detail",
    },
    requested,
  );

  assert.deepEqual(resolved, {
    scope: "task",
    companySlug: "hive",
    projectSlug: "ideas-pipeline",
    taskKey: "NEV-1",
    agentId: "agent-1",
    agentName: "Scout",
    mode: "discuss",
    source: "task-detail",
  });
});

if (failed > 0) {
  console.error(`\nResult: ${passed}/${passed + failed} passed`);
  process.exit(1);
}

console.log(`\nResult: ${passed}/${passed + failed} passed`);
