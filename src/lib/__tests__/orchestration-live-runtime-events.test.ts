import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import type { MCLiveEvent } from "@/lib/orchestration/live-events";
import {
  __resetLiveRuntimeEventsForTests,
  getBufferedLiveRuntimeEvents,
  getLiveRuntimeEventsStatus,
  LIVE_RUNTIME_RING_BUFFER_SIZE,
  publishLiveRuntimeEvent,
  subscribeLiveRuntimeEvents,
} from "@/lib/orchestration/live-runtime-events";
import { normalizeLiveRunStreamEvent } from "@/hooks/useLiveRunStream";

process.env.ORCHESTRATION_DB_PATH = path.join(
  os.tmpdir(),
  `orchestration-live-runtime-events-${Date.now()}.db`,
);

const { finish, test } = createTestRunner({ passLabel: "PASS", failLabel: "FAIL" });

function runtimeEvent(input: {
  kind: MCLiveEvent["kind"];
  companyId?: string;
  agentId?: string;
  runId?: string;
  summary?: string;
  payload: MCLiveEvent["payload"];
  ts?: number;
  seq?: number;
}): MCLiveEvent {
  return {
    id: `${input.kind}-${input.seq ?? Date.now()}`,
    agentId: input.agentId ?? "agent-runtime-test",
    runId: input.runId ?? "run-runtime-test",
    companyId: input.companyId ?? "company-runtime-test",
    kind: input.kind,
    summary: input.summary ?? input.kind.replace(/_/g, " "),
    ts: input.ts ?? Date.now(),
    seq: input.seq,
    provider: "runtime-test",
    payload: input.payload,
  };
}

function createSseJsonReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";

  return async function readJson(label: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 1_000;

    while (Date.now() < deadline) {
      const timeoutMs = Math.max(1, deadline - Date.now());
      const result = await Promise.race([
        reader.read(),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), timeoutMs)),
      ]);

      if (result === "timeout") break;
      if (result.done) throw new Error(`SSE stream closed while waiting for ${label}`);

      buffer += decoder.decode(result.value, { stream: true });

      while (buffer.includes("\n\n")) {
        const boundary = buffer.indexOf("\n\n");
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLine = raw.split("\n").find((line) => line.startsWith("data: "));
        if (dataLine) {
          return JSON.parse(dataLine.slice("data: ".length)) as Record<string, unknown>;
        }
      }
    }

    throw new Error(`timed out waiting for ${label}`);
  };
}

async function run() {
  console.log("\nOrchestration Live Runtime Event Tests\n");

  await test("publish notifies subscribers and stores a per-run ring buffer", () => {
    __resetLiveRuntimeEventsForTests();
    const seen: MCLiveEvent[] = [];
    const unsubscribe = subscribeLiveRuntimeEvents((event) => seen.push(event));

    const first = publishLiveRuntimeEvent(runtimeEvent({
      kind: "command_start",
      payload: { command: "npm test" },
      seq: 1,
    }));

    assert.equal(seen.length, 1);
    assert.equal(seen[0], first);

    for (let i = 0; i < LIVE_RUNTIME_RING_BUFFER_SIZE + 3; i += 1) {
      publishLiveRuntimeEvent(runtimeEvent({
        kind: "stdout_chunk",
        payload: { chunk: `line ${i}` },
        seq: i + 2,
      }));
    }

    const buffered = getBufferedLiveRuntimeEvents({ runId: "run-runtime-test" });
    assert.equal(buffered.length, LIVE_RUNTIME_RING_BUFFER_SIZE);
    assert.equal((buffered[0].payload as { chunk?: string }).chunk, "line 3");
    assert.equal(getLiveRuntimeEventsStatus().bufferedEventCount, LIVE_RUNTIME_RING_BUFFER_SIZE);

    unsubscribe();
    publishLiveRuntimeEvent(runtimeEvent({
      kind: "stderr_chunk",
      payload: { chunk: "after unsubscribe" },
      seq: 999,
    }));
    assert.equal(seen.length, LIVE_RUNTIME_RING_BUFFER_SIZE + 4);
  });

  await test("live-stream SSE replays and streams runtime events with company filtering", async () => {
    __resetLiveRuntimeEventsForTests();
    const { resetSqliteDatabaseFiles } = await import("@/lib/__tests__/helpers/orchestration-workspace-isolation");
    resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);

    const [
      { GET },
      { createCompany },
    ] = await Promise.all([
      import("@/app/api/orchestration/engine/live-stream/route"),
      import("@/lib/orchestration/company-service"),
    ]);

    const stamp = Date.now();
    const company = createCompany({
      name: `Runtime SSE ${stamp}`,
      description: "fixture",
      status: "active",
    }).company;
    const otherCompany = createCompany({
      name: `Runtime SSE Other ${stamp}`,
      description: "fixture",
      status: "active",
    }).company;

    publishLiveRuntimeEvent(runtimeEvent({
      kind: "command_start",
      companyId: otherCompany.id,
      summary: "other command",
      payload: { command: "other command" },
      ts: stamp,
      seq: 1,
    }));
    publishLiveRuntimeEvent(runtimeEvent({
      kind: "command_start",
      companyId: company.id,
      summary: "target command",
      payload: { command: "target command", cwd: "/tmp/runtime-sse" },
      ts: stamp + 1,
      seq: 2,
    }));

    const response = await GET(
      new NextRequest(`http://localhost/api/orchestration/engine/live-stream?company=${encodeURIComponent(company.slug)}`),
    );
    assert.equal(response.status, 200);
    assert.ok(response.body, "expected SSE response body");

    const reader = response.body.getReader();
    const readJson = createSseJsonReader(reader);

    try {
      const connected = await readJson("connected event");
      assert.equal(connected.type, "connected");

      const replayed = await readJson("runtime replay event");
      assert.equal(replayed.type, "command_start");
      assert.equal(replayed.agentId, "agent-runtime-test");
      assert.equal(replayed.runId, "run-runtime-test");
      assert.equal(replayed.command, "target command");
      assert.equal(replayed.cwd, "/tmp/runtime-sse");

      publishLiveRuntimeEvent(runtimeEvent({
        kind: "stdout_chunk",
        companyId: company.id,
        summary: "runtime stdout",
        payload: { chunk: "hello from runtime" },
        ts: stamp + 2,
        seq: 3,
      }));

      const live = await readJson("runtime live event");
      assert.equal(live.type, "stdout_chunk");
      assert.equal(live.chunk, "hello from runtime");
      assert.equal(live.detail, "runtime stdout");
    } finally {
      await reader.cancel();
      const [
        { destroyAdapterRegistry },
        { destroyGatewayStreamBridge },
      ] = await Promise.all([
        import("@/lib/orchestration/adapters/registry"),
        import("@/lib/orchestration/gateway-stream-bridge"),
      ]);
      destroyAdapterRegistry();
      destroyGatewayStreamBridge();
    }
  });

  await test("hook normalization preserves runtime chunks and process lifecycle entries", () => {
    const ts = Date.parse("2026-06-07T12:00:00.000Z");
    const first = normalizeLiveRunStreamEvent({
      event: {
        type: "stdout_chunk",
        agentId: "agent-1",
        runId: "run-1",
        chunk: "hello\nruntime",
        ts,
      },
      idFactory: (prefix, eventTs) => `${prefix}-${eventTs}`,
      now: ts,
    });

    assert.ok(first);
    assert.equal(first.state.isActive, true);
    assert.equal(first.state.isStreaming, false);
    assert.equal(first.state.events[0].kind, "stdout_chunk");
    assert.equal(first.state.events[0].message, "stdout: hello runtime");

    const second = normalizeLiveRunStreamEvent({
      event: {
        type: "process_exit",
        agentId: "agent-1",
        runId: "run-1",
        pid: 4242,
        exitCode: 0,
        ts: ts + 1_000,
      },
      current: first.state,
      idFactory: (prefix, eventTs) => `${prefix}-${eventTs}`,
      now: ts + 1_000,
    });

    assert.ok(second);
    assert.equal(second.state.isActive, false);
    assert.equal(second.state.events.at(-1)?.kind, "process_exit");
    assert.equal(second.state.events.at(-1)?.message, "Process exited: pid 4242 exit 0");
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
