import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

const { finish, test } = createTestRunner({ passLabel: "pass", failLabel: "fail" });

function rows(db: { prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] } }, sql: string, ...args: unknown[]) {
  return db.prepare(sql).all(...args);
}

function sourceRows(db: ReturnType<typeof import("@/lib/orchestration/db").getOrchestrationDb>, sessionId: string, companyId: string) {
  return {
    session: rows(db, "SELECT * FROM overseer_sessions WHERE id = ? ORDER BY id", sessionId),
    messages: rows(db, "SELECT * FROM overseer_session_messages WHERE session_id = ? ORDER BY sequence, id", sessionId),
    events: rows(db, "SELECT * FROM overseer_session_events WHERE session_id = ? ORDER BY sequence, id", sessionId),
    turns: rows(db, "SELECT * FROM overseer_turns WHERE session_id = ? ORDER BY created_at, id", sessionId),
    approvals: rows(db, "SELECT * FROM approvals WHERE company_id = ? ORDER BY created_at, id", companyId),
    costEvents: rows(db, "SELECT * FROM cost_events WHERE company_id = ? ORDER BY occurred_at, id", companyId),
  };
}

async function run() {
  console.log("\nOverseer Context Snapshot Tests\n");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "overseer-context-snapshots-"));
  const dbPath = path.join(tempRoot, "orchestration.db");
  const workspaceRoot = path.join(tempRoot, "workspaces");
  process.env.ORCHESTRATION_DB_PATH = dbPath;
  process.env.MC_WORKSPACE_ROOT = workspaceRoot;
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";

  const { createCompany } = await import("@/lib/orchestration/company-service");
  const { closeOrchestrationDb, getOrchestrationDb, runOrchestrationMigrations } = await import("@/lib/orchestration/db");
  const { createProject } = await import("@/lib/orchestration/service");
  const { createApproval } = await import("@/lib/orchestration/service/approval");
  const {
    appendOverseerMessage,
    completeOverseerTurn,
    compactOverseerSessionWithSummary,
    createOverseerContextSnapshot,
    createOverseerSession,
    createOverseerTurn,
    listOverseerContextSnapshots,
    recordOverseerEvent,
  } = await import("@/lib/orchestration/overseer/service");

  const db = getOrchestrationDb();

  await test("context snapshot migration is idempotent on a temp SQLite database", () => {
    const firstRerun = runOrchestrationMigrations(db);
    const secondRerun = runOrchestrationMigrations(db);
    assert.deepStrictEqual(firstRerun.applied, []);
    assert.deepStrictEqual(secondRerun.applied, []);

    const columns = db.prepare("PRAGMA table_info(overseer_context_snapshots)").all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    for (const name of [
      "session_id",
      "company_id",
      "version",
      "summary_hash",
      "source_message_min_sequence",
      "source_message_max_sequence",
      "source_event_min_sequence",
      "source_event_max_sequence",
      "usage_snapshot_json",
      "attachment_manifest_json",
      "compaction_metadata_json",
      "created_by",
      "created_at",
    ]) {
      assert.ok(names.has(name), `missing ${name}`);
    }
  });

  const company = createCompany({
    name: "Snapshot Fixture Co",
    description: "Context snapshot fixture.",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: "Snapshot Product",
    description: "fixture",
    color: "#0ea5e9",
    emoji: "icon:database",
    status: "active",
  }).project;
  const session = createOverseerSession({
    companyIdOrSlug: company.id,
    projectId: project.id,
    title: "Snapshot fixture",
    createdBy: "test-operator",
  }).session;

  const user = appendOverseerMessage({
    sessionId: session.id,
    role: "user",
    content: "Persist this source context.",
    metadata: {
      attachments: [
        {
          name: "notes.md",
          path: "/tmp/notes.md",
          size: 42,
          sha256: "abc123",
        },
      ],
    },
  });
  const turn = createOverseerTurn({
    sessionId: session.id,
    userMessageId: user.id,
    prompt: user.content,
  });
  const assistant = appendOverseerMessage({
    sessionId: session.id,
    turnId: turn.id,
    role: "assistant",
    content: "Captured.",
  });
  recordOverseerEvent({
    sessionId: session.id,
    turnId: turn.id,
    eventType: "turn.completed",
    event: { ok: true },
  });
  completeOverseerTurn({
    sessionId: session.id,
    turnId: turn.id,
    status: "completed",
    assistantMessageId: assistant.id,
    codexSessionId: "thread-snapshot-fixture",
    usage: {
      inputTokens: 12,
      outputTokens: 5,
      totalTokens: 17,
    },
  });
  createApproval({
    companyIdOrSlug: company.id,
    type: "protected_runtime_command",
    payload: {
      source: "overseer",
      actionType: "fixture",
      sessionId: session.id,
      fingerprint: "snapshot-fixture",
    },
  });

  await test("service creates and lists versioned snapshots without mutating source rows", () => {
    const before = sourceRows(db, session.id, company.id);

    const first = createOverseerContextSnapshot({
      sessionId: session.id,
      summary: "Durable context summary v1.",
      compactionMetadata: { strategy: "test", source: "unit" },
      createdBy: "snapshot-test",
    }).snapshot;
    const second = createOverseerContextSnapshot({
      sessionId: session.id,
      summary: "Durable context summary v2.",
      usageSnapshot: { inputTokens: 20, outputTokens: 10, totalTokens: 30, turnCount: 1 },
      attachmentManifest: [{ name: "manual.txt", sha256: "def456" }],
      compactionMetadata: { strategy: "manual-test" },
      createdBy: "snapshot-test",
    }).snapshot;

    const after = sourceRows(db, session.id, company.id);
    assert.deepStrictEqual(after, before);

    assert.strictEqual(first.version, 1);
    assert.strictEqual(first.summaryHash.length, 64);
    assert.strictEqual(first.sourceBounds.messages.count, 2);
    assert.strictEqual(first.sourceBounds.messages.minSequence, 1);
    assert.strictEqual(first.sourceBounds.messages.maxSequence, 2);
    assert.strictEqual(first.sourceBounds.events.count, 1);
    assert.strictEqual(first.sourceBounds.events.minSequence, 1);
    assert.strictEqual(first.sourceBounds.events.maxSequence, 1);
    assert.strictEqual(first.sourceBounds.turns.count, 1);
    assert.strictEqual(first.usage.totalTokens, 17);
    assert.strictEqual(first.attachmentManifest[0]?.name, "notes.md");
    assert.strictEqual(first.attachmentManifest[0]?.sourceMessageId, user.id);
    assert.deepStrictEqual(first.compactionMetadata, { strategy: "test", source: "unit" });
    assert.strictEqual(first.createdBy, "snapshot-test");

    assert.strictEqual(second.version, 2);
    assert.strictEqual(second.usage.totalTokens, 30);
    assert.deepStrictEqual(second.attachmentManifest, [{ name: "manual.txt", sha256: "def456" }]);

    const listed = listOverseerContextSnapshots({ sessionId: session.id, companyIdOrSlug: company.slug }).snapshots;
    assert.deepStrictEqual(listed.map((snapshot) => snapshot.version), [2, 1]);
    assert.deepStrictEqual(listed.map((snapshot) => snapshot.summary), [
      "Durable context summary v2.",
      "Durable context summary v1.",
    ]);
  });

  await test("service rejects duplicate explicit versions", () => {
    assert.throws(
      () => createOverseerContextSnapshot({
        sessionId: session.id,
        version: 2,
        summary: "Duplicate version should fail.",
      }),
      (error: unknown) => error instanceof Error && error.message.includes("Context snapshot version already exists"),
    );
  });

  await test("deterministic compaction snapshots before appending summary memory", () => {
    const beforeMessages = rows(db, "SELECT * FROM overseer_session_messages WHERE session_id = ? ORDER BY sequence, id", session.id);
    const beforeEvents = rows(db, "SELECT * FROM overseer_session_events WHERE session_id = ? ORDER BY sequence, id", session.id);

    const result = compactOverseerSessionWithSummary({
      sessionId: session.id,
      decision: {
        shouldCompact: true,
        reason: "Unit test deterministic compaction.",
        source: "unavailable",
        triggerPercent: 80,
        context: {
          usedTokens: null,
          limitTokens: null,
          percent: null,
        },
      },
    });

    const afterMessages = rows(db, "SELECT * FROM overseer_session_messages WHERE session_id = ? ORDER BY sequence, id", session.id);
    const afterEvents = rows(db, "SELECT * FROM overseer_session_events WHERE session_id = ? ORDER BY sequence, id", session.id);
    assert.deepStrictEqual(afterMessages.slice(0, beforeMessages.length), beforeMessages);
    assert.deepStrictEqual(afterEvents.slice(0, beforeEvents.length), beforeEvents);
    assert.strictEqual(afterMessages.length, beforeMessages.length + 1);
    assert.strictEqual(afterEvents.length, beforeEvents.length + 1);
    assert.strictEqual(result.summary.strategy, "deterministic_summary_turn");
    assert.ok(result.messageId);

    const snapshots = listOverseerContextSnapshots({ sessionId: session.id, companyIdOrSlug: company.slug }).snapshots;
    assert.strictEqual(snapshots[0]?.version, 3);
    assert.strictEqual(snapshots[0]?.sourceBounds.messages.count, beforeMessages.length);
    assert.strictEqual(snapshots[0]?.sourceBounds.events.count, beforeEvents.length);
    assert.strictEqual(snapshots[0]?.createdBy, "runtime");
    assert.strictEqual(snapshots[0]?.compactionMetadata.createdBeforeMutation, true);
    assert.strictEqual(snapshots[0]?.compactionMetadata.source, "deterministic_runtime_compaction");
  });

  closeOrchestrationDb();
  rmSync(tempRoot, { recursive: true, force: true });
  finish({ summaryIndent: "  " });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
