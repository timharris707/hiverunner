import assert from "node:assert/strict";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import {
  buildRequestedVoiceBindingFromSearchParams,
  resolveDisplayVoiceBinding,
} from "@/lib/voice-requested-binding";

const { finish, test } = createTestRunner({ passLabel: "\u2713", failLabel: "\u2717" });

function makeSearchParams(values: Record<string, string | undefined>) {
  return {
    get(name: string) {
      return values[name] ?? null;
    },
  };
}

async function run() {
  console.log("\nRequested Voice Binding Tests\n");

  await test("empty search params produce no requested binding", () => {
    assert.equal(buildRequestedVoiceBindingFromSearchParams(makeSearchParams({})), null);
  });

  await test("task query params preserve agent name for pre-connect UI copy", () => {
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

  await test("display binding merges a richer requested agent name into the live binding", () => {
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

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
