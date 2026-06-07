import assert from "node:assert/strict";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import {
  isAgentActivelyRunning,
  isAgentLive,
  isRunActivelyRunning,
  isRunLive,
} from "@/lib/orchestration/live-status";

const { finish, test } = createTestRunner({ passLabel: "[PASS]", failLabel: "[FAIL]" });

async function run() {
  console.log("\nOrchestration Live Status Tests\n");

  await test("active predicate only counts queued, pending, and running runs", () => {
    assert.equal(isRunActivelyRunning("queued"), true);
    assert.equal(isRunActivelyRunning("pending"), true);
    assert.equal(isRunActivelyRunning("running"), true);
    assert.equal(isRunActivelyRunning("completed"), false);
    assert.equal(isRunActivelyRunning("succeeded"), false);
    assert.equal(isRunActivelyRunning("failed"), false);
  });

  await test("isRunLive treats queued, pending, and running as live", () => {
    assert.equal(isRunLive("queued"), true);
    assert.equal(isRunLive("pending"), true);
    assert.equal(isRunLive("running"), true);
    assert.equal(isRunLive("succeeded"), false);
    assert.equal(isRunLive("failed"), false);
  });

  await test("recently finished runs stay live briefly for global chrome", () => {
    assert.equal(
      isRunLive(
        {
          status: "succeeded",
          finishedAt: "2026-05-01T00:03:57.806Z",
          liveIndicatorUntil: "2026-05-01T00:04:27.806Z",
        },
        new Date("2026-05-01T00:04:00.000Z").getTime()
      ),
      true
    );
    assert.equal(
      isRunLive(
        {
          status: "succeeded",
          finishedAt: "2026-05-01T00:03:57.806Z",
          liveIndicatorUntil: "2026-05-01T00:04:27.806Z",
        },
        new Date("2026-05-01T00:04:28.000Z").getTime()
      ),
      false
    );
  });

  await test("grace-window live indicators do not count as active runs", () => {
    const futureLiveIndicator = new Date(Date.now() + 60_000).toISOString();
    const completedRun = {
      status: "completed",
      finishedAt: new Date().toISOString(),
      liveIndicatorUntil: futureLiveIndicator,
    };

    assert.equal(isRunLive(completedRun), true);
    assert.equal(isRunActivelyRunning(completedRun), false);
  });

  await test("terminal live run status overrides stale SSE after grace expires", () => {
    const liveRunsByAgentId = new Map([
      ["agent-1", { status: "succeeded", finishedAt: "2026-05-01T00:03:57.806Z", liveIndicatorUntil: null }],
    ]);
    const liveAgentIds = new Set(["agent-1"]);

    assert.equal(
      isAgentLive({
        agentId: "agent-1",
        agentStatus: "working",
        liveAgentIds,
        liveRunsByAgentId,
      }),
      false
    );
  });

  await test("SSE-only signal still marks agent live when no run snapshot exists yet", () => {
    assert.equal(
      isAgentLive({
        agentId: "agent-2",
        agentStatus: "idle",
        liveAgentIds: new Set(["agent-2"]),
        liveRunsByAgentId: new Map(),
      }),
      true
    );
  });

  await test("persisted working status alone does not keep an agent live in navigation", () => {
    assert.equal(
      isAgentLive({
        agentId: "agent-3",
        agentStatus: "working",
        liveAgentIds: new Set(),
        liveRunsByAgentId: new Map(),
      }),
      false
    );
  });

  await test("agent active count ignores stale liveAgentIds fallback", () => {
    const runsByAgentId = new Map([
      [
        "agent_recent",
        {
          status: "completed",
          finishedAt: new Date().toISOString(),
          liveIndicatorUntil: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
      ["agent_running", { status: "running", finishedAt: null, liveIndicatorUntil: null }],
    ]);

    assert.equal(
      isAgentLive({
        agentId: "agent_recent",
        liveAgentIds: new Set(["agent_recent"]),
        liveRunsByAgentId: runsByAgentId,
      }),
      true
    );
    assert.equal(isAgentActivelyRunning({ agentId: "agent_recent", liveRunsByAgentId: runsByAgentId }), false);
    assert.equal(isAgentActivelyRunning({ agentId: "agent_running", liveRunsByAgentId: runsByAgentId }), true);
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
