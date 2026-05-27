import assert from "node:assert/strict";

import {
  buildTaskVoiceLaunchLabel,
  getVoicePresenterCopy,
} from "@/lib/voice-ui-copy";
import type { ResolvedVoiceBinding } from "@/lib/voice-binding";

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

function makeTaskBinding(overrides: Partial<ResolvedVoiceBinding> = {}): ResolvedVoiceBinding {
  return {
    scope: "task",
    mode: "discuss",
    source: "task-detail",
    companySlug: "hive",
    projectId: "project-1",
    projectSlug: "ideas-pipeline",
    projectName: "Ideas Pipeline",
    taskId: "task-1",
    taskKey: "NEV-1",
    taskTitle: "Ship the next voice slice",
    taskStatus: "in-progress",
    agentId: "agent-1",
    agentName: "Scout",
    ...overrides,
  };
}

console.log("\nVoice UI Copy Tests\n");

test("task launch label uses the assigned agent name when available", () => {
  assert.equal(buildTaskVoiceLaunchLabel("Scout"), "Talk to Scout");
  assert.equal(buildTaskVoiceLaunchLabel("  "), "Talk to Agent");
  assert.equal(buildTaskVoiceLaunchLabel(undefined), "Talk to Agent");
});

test("task-bound presenter copy foregrounds the assigned agent while keeping Voice Chat distinct", () => {
  const copy = getVoicePresenterCopy(makeTaskBinding());

  assert.equal(copy.heading, "Scout via Voice Chat");
  assert.equal(copy.subtitle, "Optional experimental realtime voice session with Scout for this task.");
  assert.equal(copy.speakingLabel, "Scout is speaking");
  assert.equal(copy.startSessionLabel, "Start Task Session");
  assert.match(copy.boundSessionHint, /writes a visible voice note back to the task/i);
});

test("unbound presenter copy falls back to Voice Chat wording", () => {
  const copy = getVoicePresenterCopy(null);

  assert.equal(copy.heading, "Voice Chat");
  assert.equal(copy.subtitle, "Optional experimental realtime voice conversation with the HiveRunner assistant");
  assert.equal(copy.speakingLabel, "Assistant is speaking");
  assert.equal(copy.startSessionLabel, "Start Voice Session");
  assert.equal(copy.boundSessionHint, null);
});

if (failed > 0) {
  console.error(`\nResult: ${passed}/${passed + failed} passed`);
  process.exit(1);
}

console.log(`\nResult: ${passed}/${passed + failed} passed`);
