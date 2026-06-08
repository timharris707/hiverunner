import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

const { finish, test } = createTestRunner({ passLabel: "pass", failLabel: "fail" });

function writeFakeCodexCli(binDir: string): string {
  const file = path.join(binDir, "codex");
  writeFileSync(
    file,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'codex-cli 9.9.9'
  exit 0
fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then
  printf '%s\\n' 'Logged in using ChatGPT'
  exit 0
fi
printf '%s\\n' "$PWD" >> "$FAKE_OVERSEER_CWD_LOG"
printf '%s\\n' "$*" >> "$FAKE_OVERSEER_ARGS_LOG"
printf '%s\\n' '---STDIN---' >> "$FAKE_OVERSEER_STDIN_LOG"
stdin_file="$FAKE_OVERSEER_STDIN_LOG.$$.stdin"
/bin/cat > "$stdin_file"
/bin/cat "$stdin_file" >> "$FAKE_OVERSEER_STDIN_LOG"
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ] || [ "$prev" = "--output-last-message" ]; then
    out="$arg"
  fi
  prev="$arg"
done
if /usr/bin/grep -q 'CHANGE_WORKSPACE_FILE' "$stdin_file"; then
  printf '%s\\n' 'after' >> tracked.txt
fi
if /usr/bin/grep -q 'HiveRunner Overseer compacted summary' "$stdin_file"; then
  if [ -n "$out" ]; then
    printf '%s\\n' 'Compacted continuation answer from a fresh Codex session.' > "$out"
  fi
  /bin/rm -f "$stdin_file"
  printf '%s\\n' '{"type":"thread.started","thread_id":"thread-fixture-compact-456"}'
  printf '%s\\n' '{"type":"assistant.final","text":"Compacted continuation answer from a fresh Codex session."}'
  printf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":31,"output_tokens":9,"total_tokens":40}}'
  exit 0
fi
/bin/rm -f "$stdin_file"
for arg in "$@"; do
  if [ "$prev" = "-o" ] || [ "$prev" = "--output-last-message" ]; then
    out="$arg"
  fi
  prev="$arg"
done
case " $* " in
*' resume '*)
  if [ -n "$out" ]; then
    printf '%s\\n' 'Follow-up answer from resumed Codex session.' > "$out"
  fi
  printf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":11,"output_tokens":7,"total_tokens":18}}'
  exit 0
  ;;
esac
if [ -n "$out" ]; then
  cat > "$out" <<'EOF'
First answer.

\`\`\`mc-action
{"action":"create_task","title":"Approval gated task","description":"Should not execute before approval."}
\`\`\`
EOF
fi
printf '%s\\n' '{"type":"thread.started","thread_id":"thread-fixture-123"}'
printf '%s\\n' '{"type":"assistant.final","text":"First answer.\\n\\n\`\`\`mc-action\\n{\\"action\\":\\"create_task\\",\\"title\\":\\"Approval gated task\\",\\"description\\":\\"Should not execute before approval.\\"}\\n\`\`\`"}'
printf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":23,"output_tokens":5,"total_tokens":28},"rate_limits":{"primary":{"used_percent":26,"window_minutes":10080,"resets_at":"2026-06-01T12:00:00.000Z"}}}'
exit 0
`,
    "utf8",
  );
  chmodSync(file, 0o755);
  return file;
}

function writeFakeProviderCli(binDir: string, command: "claude" | "gemini"): string {
  const file = path.join(binDir, command);
  const isClaude = command === "claude";
  writeFileSync(
    file,
    isClaude
      ? `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'Claude Code 9.9.9'
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s\\n' 'Claude logged in'
  exit 0
fi
printf '%s\\n' "$*" >> "$FAKE_OVERSEER_ARGS_LOG"
/bin/cat >/dev/null
printf '%s\\n' '{"type":"system","subtype":"init","session_id":"claude-overseer-fixture","model":"claude-opus-4.8"}'
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"Claude Overseer answer."},{"type":"tool_use","id":"tool-1","name":"Bash","input":{"command":"pwd"}}]}}'
printf '%s\\n' '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool-1","content":[{"type":"text","text":"ok"}]}]}}'
printf '%s\\n' '{"type":"result","session_id":"claude-overseer-fixture","usage":{"input_tokens":14,"output_tokens":6,"total_tokens":20},"result":"Claude Overseer answer."}'
exit 0
`
      : `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'gemini-cli 9.9.9'
  exit 0
fi
printf '%s\\n' "$*" >> "$FAKE_OVERSEER_ARGS_LOG"
printf '%s\\n' '{"type":"thread.started","session_id":"gemini-overseer-fixture","model":"gemini-3-pro-preview"}'
printf '%s\\n' '{"type":"assistant.final","text":"Gemini Overseer answer.","usage":{"input_tokens":11,"output_tokens":7,"total_tokens":18}}'
exit 0
`,
    "utf8",
  );
  chmodSync(file, 0o755);
  return file;
}

async function run() {
  console.log("\nOverseer Cockpit Tests\n");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "orchestration-overseer-"));
  const homeDir = path.join(tempRoot, "home");
  const binDir = path.join(tempRoot, "bin");
  const dbPath = path.join(tempRoot, "orchestration.db");
  const workspaceRoot = path.join(tempRoot, "workspaces");
  const argsLog = path.join(tempRoot, "args.log");
  const cwdLog = path.join(tempRoot, "cwd.log");
  const stdinLog = path.join(tempRoot, "stdin.log");
  const originalPath = process.env.PATH ?? "";

  mkdirSync(binDir, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  const fakeCodex = writeFakeCodexCli(binDir);
  writeFakeProviderCli(binDir, "claude");
  writeFakeProviderCli(binDir, "gemini");

  process.env.HOME = homeDir;
  process.env.ORCHESTRATION_DB_PATH = dbPath;
  process.env.MC_WORKSPACE_ROOT = workspaceRoot;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
  process.env.FAKE_OVERSEER_ARGS_LOG = argsLog;
  process.env.FAKE_OVERSEER_CWD_LOG = cwdLog;
  process.env.FAKE_OVERSEER_STDIN_LOG = stdinLog;
  process.env.MC_OVERSEER_CODEX_TIMEOUT_MS = "15000";
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";

  const { createCompany } = await import("@/lib/orchestration/company-service");
  const { closeOrchestrationDb, getOrchestrationDb } = await import("@/lib/orchestration/db");
  const { createProject, createTask } = await import("@/lib/orchestration/service");
  const { listApprovals } = await import("@/lib/orchestration/service/approval");
  const {
    appendOverseerMessage,
    completeOverseerTurn,
    createApprovalsForOverseerActions,
    createOverseerContextSnapshot,
    createOverseerSession,
    createOverseerTurn,
    getOverseerReadiness,
    getOverseerSession,
    getOverseerTurn,
    getOverseerWatchState,
    listOverseerContextSnapshots,
    listOverseerEvents,
    listOverseerMessages,
    recordOverseerEvent,
    runOverseerWatchCheck,
    setOverseerTurnCodexSessionId,
    startOverseerWatch,
    stopOverseerWatch,
    updateOverseerSession,
    updateOverseerSettings,
  } = await import("@/lib/orchestration/overseer/service");
  const { buildRawOverseerTranscriptExport } = await import("@/lib/orchestration/overseer/export");
  const { detectCodexStatus, readCodexSessionTelemetry, runOverseerCodexTurn } = await import("@/lib/orchestration/overseer/codex-runtime");
  const { runOverseerCliTurn } = await import("@/lib/orchestration/overseer/cli-runtime");
  const { applyApprovedAgentRuntimeUpdate } = await import("@/lib/orchestration/service/agent-runtime-update");
  const {
    GET: getCompactionRoute,
    PATCH: patchCompactionRoute,
    POST: postCompactionRoute,
  } = await import("@/app/api/orchestration/companies/[slug]/overseer/sessions/[sessionId]/compaction/route");
  const { POST: postAttachmentRoute } = await import("@/app/api/orchestration/companies/[slug]/overseer/sessions/[sessionId]/attachments/route");
  const { GET: getExportRoute } = await import("@/app/api/orchestration/companies/[slug]/overseer/sessions/[sessionId]/export/route");
  const { POST: postMessageRoute } = await import("@/app/api/orchestration/companies/[slug]/overseer/sessions/[sessionId]/messages/route");
  const { GET: getSessionRoute } = await import("@/app/api/orchestration/companies/[slug]/overseer/sessions/[sessionId]/route");
  const { POST: postWatchRoute } = await import("@/app/api/orchestration/companies/[slug]/overseer/sessions/[sessionId]/watch/route");
  const { POST: postApprovalRoute } = await import("@/app/api/orchestration/approvals/[id]/route");

  const db = getOrchestrationDb();
  const company = createCompany({
    name: "Overseer Fixture Co",
    description: "Overseer fixture.",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: "Overseer Product",
    description: "fixture",
    color: "#22c55e",
    emoji: "icon:bot",
    status: "active",
  }).project;

  await test("migration creates first-class Overseer tables", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'overseer_%' ORDER BY name")
      .all() as Array<{ name: string }>;
    assert.deepStrictEqual(
      tables.map((row) => row.name),
      [
        "overseer_context_snapshots",
        "overseer_session_events",
        "overseer_session_messages",
        "overseer_sessions",
        "overseer_turns",
      ],
    );
  });

  await test("migration adds Overseer compaction fields to sessions", () => {
    const columns = db.prepare("PRAGMA table_info(overseer_sessions)").all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    for (const name of [
      "compaction_policy",
      "compaction_context_threshold",
      "compacted_summary",
      "compacted_at",
      "compacted_by",
      "compaction_metadata_json",
    ]) {
      assert.ok(names.has(name), `missing ${name}`);
    }
  });

  await test("settings readiness detects Codex CLI and ChatGPT login", () => {
    updateOverseerSettings({ companyIdOrSlug: company.id, codexCommand: fakeCodex });
    const codexStatus = detectCodexStatus(fakeCodex);
    const readiness = getOverseerReadiness({ companyIdOrSlug: company.id, projectId: project.id, codexStatus });
    assert.strictEqual(readiness.codex.installed, true);
    assert.strictEqual(readiness.codex.authReady, true);
    assert.strictEqual(readiness.codex.authMode, "chatgpt");
    assert.strictEqual(readiness.ready, true);
  });

  await test("session creation uses the bound company project workspace", () => {
    const session = createOverseerSession({
      companyIdOrSlug: company.id,
      projectId: project.id,
      title: "Fixture Overseer",
    }).session;
    assert.ok(session.workspaceRoot.startsWith(company.workspace.root), session.workspaceRoot);
    assert.ok(!session.workspaceRoot.includes(".mission-control/app"), session.workspaceRoot);
    assert.ok(session.workspaceRoot.endsWith(path.join("projects", project.slug)), session.workspaceRoot);
  });

  const session = createOverseerSession({
    companyIdOrSlug: company.id,
    projectId: project.id,
    title: "Runtime Fixture",
  }).session;

  await test("session update stores provider, model, reasoning, and fast-mode controls", () => {
    const updated = updateOverseerSession({
      sessionId: session.id,
      provider: "codex",
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
      fastMode: true,
    }).session;
    assert.strictEqual(updated.model, "gpt-5.5");
    assert.strictEqual(updated.reasoningEffort, "xhigh");
    assert.strictEqual(updated.scope.fastMode, true);
    assert.strictEqual(updated.scope.overseerProvider, "codex");
  });

  await test("watch mode stores resident state in session scope and appends updates", () => {
    const watchTask = createTask({
      companyIdOrSlug: company.id,
      projectId: project.id,
      title: "Watch the active lane",
      description: "Watch fixture task.",
      priority: "P2",
      type: "feature",
      status: "in-progress",
      labels: [],
      createdBy: "operator",
    }).task;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO execution_runs
        (id, task_id, provider, status, started_at, created_at, updated_at)
       VALUES (?, ?, 'codex', 'running', ?, ?, ?)`,
    ).run("watch-run-fixture-1", watchTask.id, now, now, now);

    const watchSession = createOverseerSession({
      companyIdOrSlug: company.id,
      projectId: project.id,
      title: "Scope Watch Fixture",
    }).session;
    const started = startOverseerWatch({ sessionId: watchSession.id, intervalMs: 30_000 }).session;
    assert.strictEqual(started.status, "idle");
    assert.strictEqual(started.processPid, null);
    const startedWatch = getOverseerWatchState(started);
    assert.strictEqual(startedWatch?.status, "watching");
    assert.strictEqual(startedWatch.enabled, true);
    assert.strictEqual(startedWatch.intervalMs, 30_000);
    assert.strictEqual(startedWatch.checkCount, 1);
    assert.ok(startedWatch.digest);
    assert.ok(started.lastTurnAt);

    const startMessages = listOverseerMessages(watchSession.id).messages;
    assert.ok(startMessages.some((message) => (
      message.role === "assistant"
      && message.metadata.kind === "overseer_watch_update"
      && message.content.includes("Watching started")
      && message.content.includes("active 1")
      && message.content.includes("running 1")
    )));
    const startEvents = listOverseerEvents(watchSession.id).events;
    assert.ok(startEvents.some((event) => event.eventType === "overseer.watch.started"));
    assert.ok(startEvents.some((event) => event.eventType === "overseer.watch.check"));

    const unchangedMessageCount = startMessages.length;
    const unchangedCheck = runOverseerWatchCheck({ sessionId: watchSession.id });
    assert.strictEqual(unchangedCheck.changed, false);
    assert.strictEqual(listOverseerMessages(watchSession.id).messages.length, unchangedMessageCount);

    db.prepare("UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ?").run(new Date().toISOString(), watchTask.id);
    const changedCheck = runOverseerWatchCheck({ sessionId: watchSession.id });
    assert.strictEqual(changedCheck.changed, true);
    const changedMessages = listOverseerMessages(watchSession.id).messages;
    assert.ok(changedMessages.some((message) => (
      message.metadata.kind === "overseer_watch_update"
      && message.content.includes("review 1")
    )));

    const stopped = stopOverseerWatch({ sessionId: watchSession.id }).session;
    assert.strictEqual(stopped.status, "idle");
    assert.strictEqual(stopped.processPid, null);
    const stoppedWatch = getOverseerWatchState(stopped);
    assert.strictEqual(stoppedWatch?.status, "stopped");
    assert.strictEqual(stoppedWatch.enabled, false);
    assert.ok(stoppedWatch.stoppedAt);
    assert.ok(listOverseerEvents(watchSession.id).events.some((event) => event.eventType === "overseer.watch.stopped"));
  });

  await test("watch route starts and stops scope-based watching without changing DB status", async () => {
    const routeSession = createOverseerSession({
      companyIdOrSlug: company.id,
      projectId: project.id,
      title: "Route Watch Fixture",
    }).session;
    const startRes = await postWatchRoute({
      async json() {
        return { action: "start", intervalMs: 30_000 };
      },
    } as never, {
      params: Promise.resolve({ slug: company.slug, sessionId: routeSession.id }),
    });
    assert.strictEqual(startRes.status, 200);
    const startPayload = await startRes.json() as {
      session: { status: string; scope?: { watch?: { status?: string; enabled?: boolean; checkCount?: number } } };
      messages: Array<{ role: string; metadata: Record<string, unknown> }>;
      events: Array<{ eventType: string }>;
    };
    assert.strictEqual(startPayload.session.status, "idle");
    assert.strictEqual(startPayload.session.scope?.watch?.status, "watching");
    assert.strictEqual(startPayload.session.scope?.watch?.enabled, true);
    assert.strictEqual(startPayload.session.scope?.watch?.checkCount, 1);
    assert.ok(startPayload.messages.some((message) => message.metadata.kind === "overseer_watch_update"));
    assert.ok(startPayload.events.some((event) => event.eventType === "overseer.watch.started"));

    const stopRes = await postWatchRoute({
      async json() {
        return { action: "stop" };
      },
    } as never, {
      params: Promise.resolve({ slug: company.slug, sessionId: routeSession.id }),
    });
    assert.strictEqual(stopRes.status, 200);
    const stopPayload = await stopRes.json() as {
      session: { status: string; scope?: { watch?: { status?: string; enabled?: boolean; stoppedAt?: string | null } } };
      events: Array<{ eventType: string }>;
    };
    assert.strictEqual(stopPayload.session.status, "idle");
    assert.strictEqual(stopPayload.session.scope?.watch?.status, "stopped");
    assert.strictEqual(stopPayload.session.scope?.watch?.enabled, false);
    assert.ok(stopPayload.session.scope?.watch?.stoppedAt);
    assert.ok(stopPayload.events.some((event) => event.eventType === "overseer.watch.stopped"));
  });

  await test("running Codex thread id is stored before turn completion", () => {
    const liveSession = createOverseerSession({
      companyIdOrSlug: company.id,
      projectId: project.id,
      title: "Live Telemetry Fixture",
    }).session;
    const user = appendOverseerMessage({
      sessionId: liveSession.id,
      role: "user",
      content: "Start live telemetry.",
    });
    const turn = createOverseerTurn({
      sessionId: liveSession.id,
      userMessageId: user.id,
      prompt: "Start live telemetry.",
    });
    setOverseerTurnCodexSessionId({
      sessionId: liveSession.id,
      turnId: turn.id,
      codexSessionId: "thread-live-fixture-123",
    });

    assert.strictEqual(getOverseerSession(liveSession.id).codexSessionId, "thread-live-fixture-123");
    assert.strictEqual(getOverseerTurn(turn.id).codexSessionId, "thread-live-fixture-123");
  });

  await test("message route persists follow-ups while a run is active and drains them later", async () => {
    const queueSession = createOverseerSession({
      companyIdOrSlug: company.id,
      projectId: project.id,
      title: "Queued Follow-up Fixture",
    }).session;
    const activeUser = appendOverseerMessage({
      sessionId: queueSession.id,
      role: "user",
      content: "Start a slow turn.",
    });
    const activeTurn = createOverseerTurn({
      sessionId: queueSession.id,
      userMessageId: activeUser.id,
      prompt: "Start a slow turn.",
    });
    const turnCountBeforeQueue = (db
      .prepare("SELECT COUNT(*) AS count FROM overseer_turns WHERE session_id = ?")
      .get(queueSession.id) as { count: number }).count;

    const queueRes = await postMessageRoute({
      async json() {
        return { content: "Queue this while the active run is still thinking." };
      },
    } as never, {
      params: Promise.resolve({ slug: company.slug, sessionId: queueSession.id }),
    });
    assert.strictEqual(queueRes.status, 202);
    const queuePayload = await queueRes.json() as {
      queued?: boolean;
      queuedMessageId?: string;
      messages: Array<{ id: string; role: string; content: string; metadata: Record<string, unknown> }>;
      events: Array<{ eventType: string; event: Record<string, unknown> }>;
    };
    assert.strictEqual(queuePayload.queued, true);
    assert.ok(queuePayload.queuedMessageId);
    assert.ok(queuePayload.messages.some((message) => (
      message.id === queuePayload.queuedMessageId
      && message.role === "user"
      && message.content.includes("Queue this")
      && message.metadata.queueStatus === "queued"
    )));
    assert.ok(queuePayload.events.some((event) => (
      event.eventType === "overseer.message.queued"
      && event.event.messageId === queuePayload.queuedMessageId
    )));
    const turnCountAfterQueue = (db
      .prepare("SELECT COUNT(*) AS count FROM overseer_turns WHERE session_id = ?")
      .get(queueSession.id) as { count: number }).count;
    assert.strictEqual(turnCountAfterQueue, turnCountBeforeQueue);

    completeOverseerTurn({
      sessionId: queueSession.id,
      turnId: activeTurn.id,
      status: "completed",
      codexSessionId: "thread-fixture-123",
      durationMs: 90_000,
    });

    const drainRes = await postMessageRoute({
      async json() {
        return { queuedMessageId: queuePayload.queuedMessageId };
      },
    } as never, {
      params: Promise.resolve({ slug: company.slug, sessionId: queueSession.id }),
    });
    assert.strictEqual(drainRes.status, 200);
    const drainPayload = await drainRes.json() as {
      messages: Array<{ id: string; role: string; content: string; metadata: Record<string, unknown> }>;
      events: Array<{ eventType: string }>;
    };
    const drainedMessage = drainPayload.messages.find((message) => message.id === queuePayload.queuedMessageId);
    assert.strictEqual(drainedMessage?.metadata.queueStatus, "completed");
    assert.ok(drainedMessage?.metadata.turnId);
    assert.ok(drainPayload.messages.some((message) => (
      message.role === "assistant"
      && message.content.includes("Follow-up answer from resumed Codex session.")
    )));
    assert.ok(drainPayload.events.some((event) => event.eventType === "codex.resume.started"));
    const turnCountAfterDrain = (db
      .prepare("SELECT COUNT(*) AS count FROM overseer_turns WHERE session_id = ?")
      .get(queueSession.id) as { count: number }).count;
    assert.strictEqual(turnCountAfterDrain, turnCountBeforeQueue + 1);
  });

  await test("session update stores defensive compaction controls in scope", () => {
    const updated = updateOverseerSession({
      sessionId: session.id,
      compaction: {
        mode: "auto",
        thresholdPercent: 80,
        status: "requested",
        manualRequestedAt: "2026-05-30T21:45:00.000Z",
      },
    }).session;
    assert.deepStrictEqual(updated.scope.compaction, {
      mode: "auto",
      thresholdPercent: 80,
      status: "requested",
      manualRequestedAt: "2026-05-30T21:45:00.000Z",
    });

    const withSummary = updateOverseerSession({
      sessionId: session.id,
      compaction: {
        status: "idle",
        hasMemorySummary: true,
        summaryUpdatedAt: "2026-05-30T22:00:00.000Z",
      },
    }).session;
    assert.deepStrictEqual(withSummary.scope.compaction, {
      mode: "auto",
      thresholdPercent: 80,
      status: "idle",
      manualRequestedAt: "2026-05-30T21:45:00.000Z",
      hasMemorySummary: true,
      summaryUpdatedAt: "2026-05-30T22:00:00.000Z",
    });
  });

  await test("compaction settings API updates policy and records an event", async () => {
    const patchRes = await patchCompactionRoute({
      async json() {
        return { policy: "auto", contextThreshold: 82, actorUserId: "test-operator" };
      },
    } as never, {
      params: Promise.resolve({ slug: company.slug, sessionId: session.id }),
    });
    assert.strictEqual(patchRes.status, 200);
    const patchPayload = await patchRes.json() as {
      compaction: { policy: string; contextThreshold: number; latestSummary: string | null };
    };
    assert.strictEqual(patchPayload.compaction.policy, "auto");
    assert.strictEqual(patchPayload.compaction.contextThreshold, 82);
    assert.strictEqual(patchPayload.compaction.latestSummary, null);

    const getRes = await getCompactionRoute({} as never, {
      params: Promise.resolve({ slug: company.slug, sessionId: session.id }),
    });
    assert.strictEqual(getRes.status, 200);
    const getPayload = await getRes.json() as {
      compaction: { policy: string; contextThreshold: number };
    };
    assert.strictEqual(getPayload.compaction.policy, "auto");
    assert.strictEqual(getPayload.compaction.contextThreshold, 82);

    const events = listOverseerEvents(session.id).events;
    assert.ok(events.some((event) => event.eventType === "compaction.settings_updated"));
  });

  await test("compaction request API is approval-gated before durable summary mutation", async () => {
    const postRes = await postCompactionRoute({
      async json() {
        return {
          summary: "Compacted fixture summary with current decisions and open follow-ups.",
          source: "runtime",
          reason: "Context reached the configured threshold.",
          metadata: { usedTokens: 91000 },
          requestedBy: "runtime-worker",
        };
      },
    } as never, {
      params: Promise.resolve({ slug: company.slug, sessionId: session.id }),
    });
    assert.strictEqual(postRes.status, 202);
    const postPayload = await postRes.json() as { approvalId: string; status: string };
    assert.strictEqual(postPayload.status, "approval_required");
    assert.ok(postPayload.approvalId);

    const beforeApproval = getOverseerSession(session.id);
    assert.strictEqual(beforeApproval.compaction.latestSummary, null);
    assert.strictEqual(beforeApproval.compaction.compactedAt, null);

    const approvals = listApprovals({ companyIdOrSlug: company.id, type: "protected_runtime_command" }).approvals;
    const approval = approvals.find((item) => item.id === postPayload.approvalId);
    assert.ok(approval);
    assert.strictEqual(approval?.payload.actionType, "compact_overseer_session");
    assert.strictEqual(approval?.payload.sessionId, session.id);

    const duplicateRes = await postCompactionRoute({
      async json() {
        return {
          summary: "Compacted fixture summary with current decisions and open follow-ups.",
          source: "runtime",
          reason: "Duplicate pending request should reuse the same approval.",
          metadata: { usedTokens: 91000 },
          requestedBy: "runtime-worker",
        };
      },
    } as never, {
      params: Promise.resolve({ slug: company.slug, sessionId: session.id }),
    });
    assert.strictEqual(duplicateRes.status, 202);
    const duplicatePayload = await duplicateRes.json() as { approvalId: string; status: string };
    assert.strictEqual(duplicatePayload.approvalId, postPayload.approvalId);

    const approveRes = await postApprovalRoute({
      async json() {
        return { action: "approve", decidedByUserId: "test-approver" };
      },
    } as never, {
      params: Promise.resolve({ id: postPayload.approvalId }),
    });
    assert.strictEqual(approveRes.status, 200);
    const approvePayload = await approveRes.json() as {
      approvedOverseerCompaction: { applied: boolean; compaction: { latestSummary: string | null; compactedBy: string | null } };
    };
    assert.strictEqual(approvePayload.approvedOverseerCompaction.applied, true);
    assert.strictEqual(
      approvePayload.approvedOverseerCompaction.compaction.latestSummary,
      "Compacted fixture summary with current decisions and open follow-ups.",
    );
    assert.strictEqual(approvePayload.approvedOverseerCompaction.compaction.compactedBy, "test-approver");

    const afterApproval = getOverseerSession(session.id);
    assert.strictEqual(afterApproval.compaction.latestSummary, "Compacted fixture summary with current decisions and open follow-ups.");
    assert.strictEqual(afterApproval.compaction.compactedBy, "test-approver");
    assert.ok(afterApproval.compaction.compactedAt);
    assert.ok(afterApproval.compaction.metadata.snapshotId);
    assert.strictEqual(afterApproval.compaction.metadata.snapshotVersion, 1);
    assert.match(String(afterApproval.compaction.metadata.snapshotSummaryHash), /^[a-f0-9]{64}$/);
    const snapshots = listOverseerContextSnapshots({ sessionId: session.id, companyIdOrSlug: company.slug }).snapshots;
    assert.strictEqual(snapshots.length, 1);
    assert.strictEqual(snapshots[0]?.summary, "Compacted fixture summary with current decisions and open follow-ups.");
    assert.strictEqual(snapshots[0]?.createdBy, "test-approver");
    assert.strictEqual(snapshots[0]?.sourceBounds.messages.count, 0);
    assert.ok((snapshots[0]?.sourceBounds.events.count ?? 0) >= 1);
    assert.strictEqual(snapshots[0]?.compactionMetadata.approvalId, postPayload.approvalId);
    assert.strictEqual(snapshots[0]?.compactionMetadata.createdBeforeMutation, true);
    const events = listOverseerEvents(session.id).events;
    assert.ok(events.some((event) => event.eventType === "compaction.approval_requested"));
    assert.ok(events.some((event) => (
      event.eventType === "compaction.applied"
      && event.event.snapshotVersion === 1
      && event.event.snapshotId === snapshots[0]?.id
    )));
  });

  await test("rejected compaction approval records the decision without mutating memory", async () => {
    const rejectedSummary = "Rejected compaction summary should never become durable memory.";
    const postRes = await postCompactionRoute({
      async json() {
        return {
          summary: rejectedSummary,
          source: "manual",
          reason: "Operator rejected this compaction.",
          requestedBy: "operator",
        };
      },
    } as never, {
      params: Promise.resolve({ slug: company.slug, sessionId: session.id }),
    });
    assert.strictEqual(postRes.status, 202);
    const postPayload = await postRes.json() as { approvalId: string };
    const beforeReject = getOverseerSession(session.id);

    const rejectRes = await postApprovalRoute({
      async json() {
        return { action: "reject", decidedByUserId: "test-rejector", decisionNote: "Reject fixture." };
      },
    } as never, {
      params: Promise.resolve({ id: postPayload.approvalId }),
    });
    assert.strictEqual(rejectRes.status, 200);
    const afterReject = getOverseerSession(session.id);
    assert.strictEqual(afterReject.compaction.latestSummary, beforeReject.compaction.latestSummary);
    assert.notStrictEqual(afterReject.compaction.latestSummary, rejectedSummary);
    assert.deepStrictEqual(
      listOverseerContextSnapshots({ sessionId: session.id, companyIdOrSlug: company.slug }).snapshots.map((snapshot) => snapshot.summary),
      ["Compacted fixture summary with current decisions and open follow-ups."],
    );
    assert.ok(listOverseerEvents(session.id).events.some((event) => (
      event.eventType === "compaction.approval_rejected"
      && event.event.approvalId === postPayload.approvalId
    )));
  });

  await test("first message runs codex exec, stores transcript, usage, and approval gate", async () => {
    const user = appendOverseerMessage({
      sessionId: session.id,
      role: "user",
      content: "Create the implementation task.",
    });
    const result = await runOverseerCodexTurn({
      sessionId: session.id,
      userMessageId: user.id,
      userMessage: user.content,
      command: fakeCodex,
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(
      result.approvalIds.length,
      1,
      JSON.stringify(listOverseerMessages(session.id).messages.map((message) => ({ role: message.role, content: message.content }))),
    );

    const stored = getOverseerSession(session.id);
    assert.strictEqual(stored.codexSessionId, "thread-fixture-123");
    assert.strictEqual(stored.status, "approval_required");
    assert.strictEqual(stored.usage.totalTokens, 28);
    assert.strictEqual(stored.quota.status, "available");
    assert.strictEqual(stored.quota.buckets?.[0]?.usedPercent, 26);
    assert.strictEqual(stored.quota.buckets?.[0]?.resetsAt, "2026-06-01T12:00:00.000Z");

    const messages = listOverseerMessages(session.id).messages;
    assert.ok(messages.some((message) => message.role === "assistant" && message.content.includes("mc-action")));
    assert.ok(messages.some((message) => message.role === "approval"));
    const events = listOverseerEvents(session.id).events;
    assert.strictEqual(events.filter((event) => event.eventType === "thread.started").length, 1);
    assert.strictEqual(events.filter((event) => event.eventType === "turn.completed").length, 1);

    const approvals = listApprovals({ companyIdOrSlug: company.id, type: "protected_runtime_command", status: "pending" }).approvals;
    assert.strictEqual(approvals.length, 1);
    assert.strictEqual(approvals[0]?.payload.actionType, "create_task");

    const actionLedger = db
      .prepare(
        `SELECT source, status, action_type, approval_id, overseer_session_id
         FROM runtime_action_ledger
         WHERE overseer_session_id = ? AND action_type = 'create_task'
         LIMIT 1`,
      )
      .get(session.id) as
      | {
          source: string;
          status: string;
          action_type: string | null;
          approval_id: string | null;
          overseer_session_id: string | null;
        }
      | undefined;
    assert.strictEqual(actionLedger?.source, "overseer");
    assert.strictEqual(actionLedger?.status, "pending_approval");
    assert.strictEqual(actionLedger?.approval_id, approvals[0]?.id);
    assert.strictEqual(actionLedger?.overseer_session_id, session.id);

    const args = readFileSync(argsLog, "utf8");
    assert.match(args, /exec --json/);
    assert.match(args, /--sandbox read-only/);
    assert.match(args, /service_tier="fast"/);
    const cwd = readFileSync(cwdLog, "utf8").trim().split(/\n/)[0];
    assert.strictEqual(realpathSync(cwd), realpathSync(stored.workspaceRoot));
  });

  await test("Overseer action ledger records parse_failed and observed safe actions", () => {
    const user = appendOverseerMessage({
      sessionId: session.id,
      role: "user",
      content: "Observe safe actions and malformed blocks.",
    });
    const turn = createOverseerTurn({
      sessionId: session.id,
      userMessageId: user.id,
      prompt: user.content,
    });
    const assistantText = [
      "```mc-action",
      "{\"action\":\"report\"}",
      "```",
      "```mc-action",
      JSON.stringify({ action: "report", summary: "Safe report action observed." }),
      "```",
    ].join("\n");

    const approvalResult = createApprovalsForOverseerActions({
      session,
      turnId: turn.id,
      messageId: user.id,
      assistantText,
    });
    assert.deepStrictEqual(approvalResult.approvalIds, []);
    assert.strictEqual(approvalResult.safeActions, 1);
    assert.strictEqual(approvalResult.parseErrors.length, 1);

    const rows = db
      .prepare(
        `SELECT status, action_type, parse_error
         FROM runtime_action_ledger
         WHERE overseer_turn_id = ?
         ORDER BY block_index ASC`,
      )
      .all(turn.id) as Array<{ status: string; action_type: string | null; parse_error: string | null }>;
    assert.deepStrictEqual(
      rows.map((row) => row.status),
      ["parse_failed", "observed"],
    );
    assert.strictEqual(rows[0]?.action_type, "report");
    assert.ok(rows[0]?.parse_error?.includes("summary"));
    assert.strictEqual(rows[1]?.action_type, "report");
    assert.strictEqual(rows[1]?.parse_error, null);
  });

  await test("session telemetry reads saved Codex token-count and rate-limit status", () => {
    const stored = getOverseerSession(session.id);
    assert.ok(stored.codexSessionId);
    const codexSessionDir = path.join(homeDir, ".codex", "sessions", "2026", "05", "30");
    mkdirSync(codexSessionDir, { recursive: true });
    writeFileSync(
      path.join(codexSessionDir, `rollout-2026-05-30T12-00-00-${stored.codexSessionId}.jsonl`),
      `${JSON.stringify({
        timestamp: "2026-05-30T21:30:05.350Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 82800,
              total_tokens: 91000,
            },
            total_token_usage: {
              total_tokens: 212000,
            },
            model_context_window: 258400,
          },
          rate_limits: {
            primary: {
              used_percent: 37,
              window_minutes: 300,
              resets_at: 1780185029,
            },
            secondary: {
              used_percent: 49,
              window_minutes: 10080,
              resets_at: 1780462312,
            },
            plan_type: "pro",
          },
        },
      })}\n`,
      "utf8",
    );

    const telemetry = readCodexSessionTelemetry(stored.codexSessionId);
    assert.ok(telemetry);
    assert.strictEqual(telemetry.context.usedTokens, 82800);
    assert.strictEqual(telemetry.context.limitTokens, 258400);
    assert.strictEqual(telemetry.context.cumulativeTotalTokens, 212000);
    assert.strictEqual(telemetry.quota.status, "available");
    assert.strictEqual(telemetry.quota.buckets?.[0]?.label, "5h limit");
    assert.strictEqual(telemetry.quota.buckets?.[0]?.usedPercent, 37);
    assert.strictEqual(telemetry.quota.buckets?.[0]?.resetsAt, "2026-05-30T23:50:29.000Z");
    assert.strictEqual(telemetry.quota.buckets?.[1]?.label, "Weekly limit");
  });

  await test("session route can derive live Codex telemetry from thread-started events", async () => {
    const liveSession = createOverseerSession({
      companyIdOrSlug: company.id,
      projectId: project.id,
      title: "Route Telemetry Fixture",
    }).session;
    const user = appendOverseerMessage({
      sessionId: liveSession.id,
      role: "user",
      content: "Start route telemetry.",
    });
    const turn = createOverseerTurn({
      sessionId: liveSession.id,
      userMessageId: user.id,
      prompt: "Start route telemetry.",
    });
    recordOverseerEvent({
      sessionId: liveSession.id,
      turnId: turn.id,
      eventType: "thread.started",
      event: { type: "thread.started", thread_id: "thread-route-fallback-123" },
    });
    const codexSessionDir = path.join(homeDir, ".codex", "sessions", "2026", "05", "31");
    mkdirSync(codexSessionDir, { recursive: true });
    writeFileSync(
      path.join(codexSessionDir, "rollout-2026-05-31T12-00-00-thread-route-fallback-123.jsonl"),
      `${JSON.stringify({
        timestamp: "2026-05-31T21:30:05.350Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 12000,
              total_tokens: 14000,
            },
            model_context_window: 258400,
          },
        },
      })}\n`,
      "utf8",
    );

    assert.strictEqual(getOverseerSession(liveSession.id).codexSessionId, null);
    const detailRes = await getSessionRoute({} as never, {
      params: Promise.resolve({ slug: company.slug, sessionId: liveSession.id }),
    });
    assert.strictEqual(detailRes.status, 200);
    const detailPayload = await detailRes.json() as {
      codexTelemetry?: { context?: { usedTokens?: number | null; limitTokens?: number | null } } | null;
    };
    assert.strictEqual(detailPayload.codexTelemetry?.context?.usedTokens, 12000);
    assert.strictEqual(detailPayload.codexTelemetry?.context?.limitTokens, 258400);
  });

  await test("follow-up message resumes the stored Codex session", async () => {
    const user = appendOverseerMessage({
      sessionId: session.id,
      role: "user",
      content: "Continue from there.",
    });
    const result = await runOverseerCodexTurn({
      sessionId: session.id,
      userMessageId: user.id,
      userMessage: user.content,
      command: fakeCodex,
    });
    assert.strictEqual(result.ok, true);
    const args = readFileSync(argsLog, "utf8");
    assert.match(args, /resume/);
    assert.match(args, /thread-fixture-123/);
    const stored = getOverseerSession(session.id);
    assert.strictEqual(stored.usage.totalTokens, 46, readFileSync(argsLog, "utf8"));
    const events = listOverseerEvents(session.id).events;
    assert.ok(events.some((event) => event.eventType === "codex.resume.started"));
    assert.strictEqual(events.filter((event) => event.eventType === "turn.completed").length, 2);
  });

  await test("monitoring chat uses deterministic snapshot instead of resuming Codex", async () => {
    const beforeArgs = readFileSync(argsLog, "utf8");
    const beforeUsage = getOverseerSession(session.id).usage.totalTokens;
    const response = await postMessageRoute({
      async json() {
        return { content: "What's the sprint status right now?" };
      },
    } as never, {
      params: Promise.resolve({ slug: company.slug, sessionId: session.id }),
    });
    assert.strictEqual(response.status, 200);
    const payload = await response.json() as {
      fastPath?: boolean;
      action?: string;
      session: { usage?: { totalTokens?: number } };
      messages: Array<{ role: string; content: string; metadata: Record<string, unknown> }>;
      events: Array<{ eventType: string }>;
    };
    assert.strictEqual(payload.fastPath, true);
    assert.strictEqual(payload.action, "snapshot");
    assert.strictEqual(readFileSync(argsLog, "utf8"), beforeArgs);
    assert.strictEqual(getOverseerSession(session.id).usage.totalTokens, beforeUsage);
    assert.strictEqual(payload.session.usage?.totalTokens, beforeUsage);
    assert.ok(payload.messages.some((message) => (
      message.role === "assistant"
      && message.metadata.kind === "overseer_watch_snapshot"
      && message.content.includes("Monitoring snapshot")
    )));
    assert.ok(payload.events.some((event) => event.eventType === "overseer.monitoring.fast_path"));
    assert.ok(payload.events.some((event) => event.eventType === "overseer.watch.snapshot"));
  });

  await test("continuous monitoring chat starts resident watch instead of resuming Codex", async () => {
    const monitorSession = createOverseerSession({
      companyIdOrSlug: company.id,
      projectId: project.id,
      title: "Persistent Monitor Fixture",
    }).session;
    const oldUser = appendOverseerMessage({
      sessionId: monitorSession.id,
      role: "user",
      content: "Monitor this sprint.",
    });
    const oldTurn = createOverseerTurn({
      sessionId: monitorSession.id,
      userMessageId: oldUser.id,
      prompt: oldUser.content,
    });
    completeOverseerTurn({
      sessionId: monitorSession.id,
      turnId: oldTurn.id,
      status: "completed",
      codexSessionId: "thread-heavy-monitor-123",
      usage: {
        inputTokens: 5_202_835,
        outputTokens: 25_399,
        totalTokens: 5_228_234,
      },
      durationMs: 180_000,
    });

    const beforeArgs = readFileSync(argsLog, "utf8");
    const beforeUsage = getOverseerSession(monitorSession.id).usage.totalTokens;
    const beforeTurnCount = (db
      .prepare("SELECT COUNT(*) AS count FROM overseer_turns WHERE session_id = ?")
      .get(monitorSession.id) as { count: number }).count;
    const response = await postMessageRoute({
      async json() {
        return { content: "Monitor the current sprint continuously and give me updates." };
      },
    } as never, {
      params: Promise.resolve({ slug: company.slug, sessionId: monitorSession.id }),
    });
    assert.strictEqual(response.status, 200);
    const payload = await response.json() as {
      fastPath?: boolean;
      action?: string;
      turnId?: string | null;
      approvalIds?: string[];
      session: {
        usage?: { totalTokens?: number };
        scope?: { watch?: { status?: string; enabled?: boolean; checkCount?: number } };
      };
      messages: Array<{ role: string; content: string; metadata: Record<string, unknown> }>;
      events: Array<{ eventType: string }>;
    };
    assert.strictEqual(payload.fastPath, true);
    assert.strictEqual(payload.action, "start_watch");
    assert.strictEqual(payload.turnId, null);
    assert.deepStrictEqual(payload.approvalIds, []);
    assert.strictEqual(readFileSync(argsLog, "utf8"), beforeArgs);
    assert.strictEqual(getOverseerSession(monitorSession.id).usage.totalTokens, beforeUsage);
    assert.strictEqual(payload.session.usage?.totalTokens, beforeUsage);
    assert.strictEqual(payload.session.scope?.watch?.status, "watching");
    assert.strictEqual(payload.session.scope?.watch?.enabled, true);
    assert.strictEqual(payload.session.scope?.watch?.checkCount, 1);
    const afterTurnCount = (db
      .prepare("SELECT COUNT(*) AS count FROM overseer_turns WHERE session_id = ?")
      .get(monitorSession.id) as { count: number }).count;
    assert.strictEqual(afterTurnCount, beforeTurnCount);
    assert.strictEqual(getOverseerWatchState(getOverseerSession(monitorSession.id))?.status, "watching");
    assert.ok(payload.messages.some((message) => (
      message.role === "assistant"
      && message.metadata.kind === "overseer_watch_update"
      && message.content.includes("Watching started")
    )));
    assert.ok(payload.events.some((event) => event.eventType === "overseer.monitoring.fast_path"));
    assert.ok(payload.events.some((event) => event.eventType === "overseer.watch.started"));
    assert.ok(payload.events.some((event) => event.eventType === "overseer.watch.check"));
    assert.ok(!payload.events.some((event) => event.eventType === "codex.resume.started"));

    stopOverseerWatch({ sessionId: monitorSession.id });
  });

  await test("auto compaction requests approval before changing durable session memory", async () => {
    const storedBefore = getOverseerSession(session.id);
    assert.strictEqual(storedBefore.codexSessionId, "thread-fixture-123");
    const existingSummary = storedBefore.compaction.latestSummary;
    updateOverseerSession({
      sessionId: session.id,
      compaction: {
        mode: "auto",
        thresholdPercent: 80,
      },
    });
    const codexSessionFile = path.join(homeDir, ".codex", "sessions", "2026", "05", "30", `rollout-2026-05-30T12-00-00-${storedBefore.codexSessionId}.jsonl`);
    appendFileSync(
      codexSessionFile,
      `${JSON.stringify({
        timestamp: "2026-05-30T22:45:00.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 221000,
              total_tokens: 230000,
            },
            model_context_window: 258400,
          },
        },
      })}\n`,
      "utf8",
    );

    const user = appendOverseerMessage({
      sessionId: session.id,
      role: "user",
      content: "Continue after compaction.",
    });
    const result = await runOverseerCodexTurn({
      sessionId: session.id,
      userMessageId: user.id,
      userMessage: user.content,
      command: fakeCodex,
    });
    assert.strictEqual(result.ok, true);

    const stored = getOverseerSession(session.id);
    assert.strictEqual(stored.codexSessionId, "thread-fixture-123");
    assert.strictEqual(stored.compaction.latestSummary, existingSummary);
    assert.strictEqual(stored.compaction.compactedBy, "test-approver");
    assert.strictEqual(stored.usage.totalTokens, 64);

    const pendingApprovals = listApprovals({
      companyIdOrSlug: company.id,
      type: "protected_runtime_command",
      status: "pending",
    }).approvals;
    assert.ok(pendingApprovals.some((approval) => approval.payload.actionType === "compact_overseer_session"));

    const stdin = readFileSync(stdinLog, "utf8");
    assert.match(stdin, /Compacted session summary to preserve before answering:/);
    assert.match(stdin, /Compacted fixture summary with current decisions and open follow-ups./);
    const lastArgs = readFileSync(argsLog, "utf8").trim().split(/\n/).at(-1) ?? "";
    assert.match(lastArgs, /resume/);
    assert.match(lastArgs, /thread-fixture-123/);

    const events = listOverseerEvents(session.id).events;
    assert.ok(events.some((event) => event.eventType === "codex.compaction.requested"));
    assert.ok(events.some((event) => event.eventType === "compaction.approval_requested"));
    assert.ok(!events.some((event) => event.eventType === "codex.compaction.completed"));
  });

  await test("raw transcript export route packages one session with stable content hashes", async () => {
    const attachmentPath = path.join(tempRoot, "fixture-attachment.txt");
    writeFileSync(attachmentPath, "attached evidence\n", "utf8");
    const attachmentMessage = appendOverseerMessage({
      sessionId: session.id,
      role: "user",
      content: "Attach the evidence file to the raw export fixture.",
      metadata: {
        attachments: [
          {
            id: "attachment-fixture-1",
            name: "fixture-attachment.txt",
            mimeType: "text/plain",
            size: 18,
            path: attachmentPath,
            uploadedAt: "2026-05-30T23:10:00.000Z",
          },
        ],
      },
    });
    recordOverseerEvent({
      sessionId: session.id,
      eventType: "attachment.manifested",
      event: { messageId: attachmentMessage.id, attachmentCount: 1 },
      occurredAt: "2026-05-30T23:10:01.000Z",
    });
    createOverseerContextSnapshot({
      sessionId: session.id,
      summary: "Context snapshot fixture.",
      usageSnapshot: { inputTokens: 10, outputTokens: 4, totalTokens: 14, turnCount: 1 },
      attachmentManifest: [{ id: "attachment-fixture-1", name: "fixture-attachment.txt" }],
      compactionMetadata: { pinned: true },
      createdBy: "test-fixture",
    });
    db.prepare(
      `INSERT INTO cost_events (
        id, company_id, provider, biller, billing_type, model,
        input_tokens, output_tokens, cost_cents, cost_source,
        confidence, metadata_json, occurred_at, created_at
      ) VALUES (?, ?, 'openai', 'openai', 'metered_api', 'gpt-5.5',
        10, 4, 1.25, 'reported', 'reported', ?, ?, ?)`,
    ).run(
      "cost-event-overseer-fixture",
      company.id,
      JSON.stringify({ sessionId: session.id, rawUsage: { sessionId: session.id } }),
      "2026-05-30T23:13:00.000Z",
      "2026-05-30T23:13:00.000Z",
    );

    const beforeEventCount = (db
      .prepare("SELECT COUNT(*) AS count FROM overseer_session_events WHERE session_id = ?")
      .get(session.id) as { count: number }).count;
    const routeRes = await getExportRoute({} as never, {
      params: Promise.resolve({ slug: company.slug, sessionId: session.id }),
    });
    assert.strictEqual(routeRes.status, 200);
    const afterEventCount = (db
      .prepare("SELECT COUNT(*) AS count FROM overseer_session_events WHERE session_id = ?")
      .get(session.id) as { count: number }).count;
    assert.strictEqual(afterEventCount, beforeEventCount, "export route must be read-only");
    assert.match(
      routeRes.headers.get("content-disposition") ?? "",
      /^attachment; filename="overseer-transcript-overseer-fixture-co-runtime-fixture-\d{4}-\d{2}-\d{2}-[a-f0-9-]+\.json"$/,
    );

    const payload = await routeRes.json() as {
      _meta: { format: string; filename: string; categories: string[] };
      session: { id: string };
      turns: unknown[];
      messages: Array<{ id: string; metadata: Record<string, unknown> }>;
      events: unknown[];
      compaction: { state: { latestSummary: string | null; metadata: Record<string, unknown> } };
      snapshots: Array<{ sourceTable?: string; summary?: string; compactionMetadata?: Record<string, unknown> }>;
      approvals: Array<{ payload: Record<string, unknown> }>;
      attachmentManifest: Array<Record<string, unknown>>;
      usage: {
        session: { totalTokens?: number };
        quota: { status: string };
        costEvents: { totalCostCents: number; events: unknown[] };
      };
      continuityProof: {
        status: string;
        sourceRowCounts: Record<string, number>;
        hashes: Record<string, string>;
        snapshotVersions: Array<{ version: number | null; summaryHash: string | null }>;
        latestSnapshotVersion: number | null;
        latestCompactionApprovalId: string | null;
        latestCompaction: { snapshotId: string | null; snapshotVersion: number | null; snapshotSummaryHash: string | null };
      };
      contentHashes: Record<string, string>;
    };
    assert.strictEqual(payload._meta.format, "hiverunner-overseer-raw-transcript");
    assert.ok(payload._meta.categories.includes("messages"));
    assert.ok(payload._meta.categories.includes("attachmentManifest"));
    assert.strictEqual(payload.session.id, session.id);
    assert.ok(payload.turns.length >= 3);
    assert.ok(payload.messages.some((message) => message.id === attachmentMessage.id));
    assert.ok(payload.events.length > 0);
    assert.ok(payload.compaction.state.latestSummary);
    assert.ok(payload.compaction.state.metadata.approvalId);
    assert.ok(payload.snapshots.some((snapshot) => (
      snapshot.sourceTable === "overseer_context_snapshots"
      && snapshot.summary === "Context snapshot fixture."
      && snapshot.compactionMetadata?.pinned === true
    )));
    assert.ok(payload.approvals.some((approval) => approval.payload.sessionId === session.id));
    assert.ok(payload.attachmentManifest.some((attachment) => (
      attachment.messageId === attachmentMessage.id
      && attachment.name === "fixture-attachment.txt"
      && typeof attachment.metadataSha256 === "string"
    )));
    assert.ok((payload.usage.session.totalTokens ?? 0) >= 64);
    assert.strictEqual(payload.usage.quota.status, "available");
    assert.strictEqual(payload.usage.costEvents.totalCostCents, 1.25);
    assert.strictEqual(payload.usage.costEvents.events.length, 1);
    assert.strictEqual(payload.continuityProof.status, "verified");
    assert.strictEqual(payload.continuityProof.sourceRowCounts.messages, payload.messages.length);
    assert.strictEqual(payload.continuityProof.sourceRowCounts.events, payload.events.length);
    assert.strictEqual(payload.continuityProof.sourceRowCounts.snapshots, payload.snapshots.length);
    assert.strictEqual(payload.continuityProof.sourceRowCounts.attachmentManifest, payload.attachmentManifest.length);
    assert.ok(payload.continuityProof.snapshotVersions.some((snapshot) => snapshot.version === 2));
    assert.strictEqual(payload.continuityProof.latestSnapshotVersion, 2);
    assert.ok(payload.continuityProof.latestCompactionApprovalId);
    assert.match(payload.continuityProof.hashes.messagesSha256, /^[a-f0-9]{64}$/);
    assert.strictEqual(payload.continuityProof.hashes.messagesSha256, payload.contentHashes.messagesSha256);
    const detailRes = await getSessionRoute({} as never, {
      params: Promise.resolve({ slug: company.slug, sessionId: session.id }),
    });
    assert.strictEqual(detailRes.status, 200);
    const detailPayload = await detailRes.json() as { continuityProof?: { status: string; latestSnapshotVersion: number | null } };
    assert.strictEqual(detailPayload.continuityProof?.status, "verified");
    assert.strictEqual(detailPayload.continuityProof?.latestSnapshotVersion, 2);
    for (const hash of Object.values(payload.contentHashes)) {
      assert.match(hash, /^[a-f0-9]{64}$/);
    }

    const rebuilt = buildRawOverseerTranscriptExport({
      companyIdOrSlug: company.slug,
      sessionId: session.id,
      exportedAt: "2026-05-30T23:20:00.000Z",
    });
    assert.strictEqual(payload._meta.filename, rebuilt.filename);
    assert.deepStrictEqual(payload.contentHashes, rebuilt.package.contentHashes);
  });

  await test("attachment uploads land in the session workspace and export manifests their hashes", async () => {
    const outputRoot = path.join(process.cwd(), "output");
    mkdirSync(outputRoot, { recursive: true });
    const attachmentTempRoot = mkdtempSync(path.join(outputRoot, "overseer-attachment-route-"));
    const attachmentWorkspaceRoot = path.join(attachmentTempRoot, "workspaces");
    const originalWorkspaceRoot = process.env.MC_WORKSPACE_ROOT;
    process.env.MC_WORKSPACE_ROOT = attachmentWorkspaceRoot;
    mkdirSync(attachmentWorkspaceRoot, { recursive: true });

    try {
      const attachmentCompany = createCompany({
        name: "Overseer Attachment Co",
        description: "Attachment upload fixture.",
        status: "active",
      }).company;
      const attachmentProject = createProject({
        companyId: attachmentCompany.id,
        name: "Attachment Project",
        description: "Attachment upload fixture.",
        color: "#38bdf8",
        emoji: "icon:paperclip",
        status: "active",
      }).project;

      const attachmentSession = createOverseerSession({
        companyIdOrSlug: attachmentCompany.id,
        projectId: attachmentProject.id,
        title: "Attachment durability fixture",
      }).session;
      assert.ok(attachmentSession.workspaceRoot.startsWith(attachmentWorkspaceRoot), attachmentSession.workspaceRoot);
      assert.ok(!attachmentSession.workspaceRoot.startsWith(os.tmpdir()), attachmentSession.workspaceRoot);

      const form = new FormData();
      form.append("files", new File([Buffer.from("first attachment\n", "utf8")], "Quarterly Plan (final).md", {
        type: "text/markdown",
      }));
      form.append("files", new File([Buffer.from("second attachment\n", "utf8")], "../../unsafe name?.txt", {
        type: "text/plain",
      }));

      const response = await postAttachmentRoute(new Request(
        `http://localhost/api/orchestration/companies/${attachmentCompany.slug}/overseer/sessions/${attachmentSession.id}/attachments`,
        {
          method: "POST",
          body: form,
        },
      ) as never, {
        params: Promise.resolve({ slug: attachmentCompany.slug, sessionId: attachmentSession.id }),
      });
      assert.strictEqual(response.status, 200);

      const body = await response.json() as {
        attachments: Array<{
          id: string;
          name: string;
          originalName?: string;
          storedName?: string;
          mimeType: string;
          size: number;
          byteSize?: number;
          sha256: string;
          path: string;
          uploadedAt: string;
        }>;
      };
      assert.strictEqual(body.attachments.length, 2);

      for (const attachment of body.attachments) {
        assert.ok(attachment.path.startsWith(attachmentSession.workspaceRoot), attachment.path);
        assert.ok(!attachment.path.startsWith(os.tmpdir()), attachment.path);
        assert.strictEqual(attachment.byteSize ?? attachment.size, attachment.size);
        assert.match(attachment.sha256, /^[a-f0-9]{64}$/);
        const storedName = path.basename(attachment.path);
        assert.strictEqual(attachment.storedName, storedName);
        assert.strictEqual(attachment.originalName ?? attachment.name, attachment.name);
        assert.ok(!storedName.includes(".."));
        assert.ok(!storedName.includes("/"));
        assert.ok(!storedName.includes("\\"));
        const content = readFileSync(attachment.path);
        const fileSha = createHash("sha256").update(content).digest("hex");
        assert.strictEqual(fileSha, attachment.sha256);
      }

      const message = appendOverseerMessage({
        sessionId: attachmentSession.id,
        role: "user",
        content: "Persist the uploaded files.",
        metadata: { attachments: body.attachments },
      });

      const exportPackage = buildRawOverseerTranscriptExport({
        companyIdOrSlug: attachmentCompany.slug,
        sessionId: attachmentSession.id,
      }).package;
      assert.ok(exportPackage.attachmentManifest.some((attachment) => (
        attachment.messageId === message.id
        && attachment.sha256 === body.attachments[0]?.sha256
        && attachment.path === body.attachments[0]?.path
        && typeof attachment.metadataSha256 === "string"
      )));
      assert.ok(exportPackage.attachmentManifest.every((attachment) => (
        typeof attachment.metadataSha256 === "string"
        && /^[a-f0-9]{64}$/.test(String(attachment.metadataSha256))
      )));
      assert.match(exportPackage.contentHashes.attachmentManifestSha256, /^[a-f0-9]{64}$/);
      assert.match(exportPackage.contentHashes.payloadSha256, /^[a-f0-9]{64}$/);
      const exportedMessage = exportPackage.messages.find((exported) => exported.id === message.id);
      const exportedAttachments = Array.isArray(exportedMessage?.metadata.attachments)
        ? exportedMessage!.metadata.attachments as Array<Record<string, unknown>>
        : [];
      assert.strictEqual(exportedAttachments[0]?.sha256, body.attachments[0]?.sha256);
      assert.strictEqual(exportedAttachments[0]?.path, body.attachments[0]?.path);
    } finally {
      process.env.MC_WORKSPACE_ROOT = originalWorkspaceRoot;
      rmSync(attachmentTempRoot, { recursive: true, force: true });
    }
  });

  await test("Claude and Gemini Overseer turns normalize provider events and usage into export proof", async () => {
    for (const provider of ["anthropic", "gemini"] as const) {
      const providerSession = createOverseerSession({
        companyIdOrSlug: company.id,
        projectId: project.id,
        title: `${provider} parity fixture`,
      }).session;
      updateOverseerSession({
        sessionId: providerSession.id,
        provider,
        model: provider === "anthropic" ? "claude-opus-4.8" : "gemini-3-pro-preview",
        reasoningEffort: provider === "anthropic" ? "xhigh" : null,
      });
      const user = appendOverseerMessage({
        sessionId: providerSession.id,
        role: "user",
        content: `Run ${provider} parity fixture.`,
      });
      const result = await runOverseerCliTurn({
        sessionId: providerSession.id,
        userMessageId: user.id,
        userMessage: user.content,
        provider,
      });
      assert.strictEqual(result.ok, true);
      if (provider === "anthropic") {
        const providerArgs = readFileSync(argsLog, "utf8").trim().split(/\r?\n/).at(-1) ?? "";
        assert.ok(
          providerArgs.includes("--output-format stream-json --include-partial-messages --permission-mode plan"),
          `Claude Overseer CLI should request partial stream-json messages: ${providerArgs}`,
        );
      }
      const exported = buildRawOverseerTranscriptExport({
        companyIdOrSlug: company.slug,
        sessionId: providerSession.id,
      }).package;
      assert.ok(exported.messages.some((message) => (
        message.role === "assistant"
        && message.metadata.provider === provider
      )));
      assert.ok(exported.events.some((event) => (
        typeof event.event === "object"
        && event.event !== null
        && (event.event as Record<string, unknown>).provider === provider
      )));
      assert.ok((exported.usage.session.totalTokens ?? 0) > 0);
      assert.strictEqual(exported.continuityProof.sourceRowCounts.messages, exported.messages.length);
      assert.strictEqual(exported.continuityProof.hashes.usageSha256, exported.contentHashes.usageSha256);
    }
  });

  await test("runtime records workspace diff stats after Codex changes tracked files", async () => {
    mkdirSync(session.workspaceRoot, { recursive: true });
    writeFileSync(path.join(session.workspaceRoot, "tracked.txt"), "before\n", "utf8");
    for (const args of [
      ["init"],
      ["add", "tracked.txt"],
      ["-c", "user.email=fixture@example.test", "-c", "user.name=Fixture", "commit", "-m", "init"],
    ]) {
      const result = spawnSync("git", args, { cwd: session.workspaceRoot, encoding: "utf8" });
      assert.strictEqual(result.status, 0, `${args.join(" ")}\n${result.stderr}`);
    }

    const user = appendOverseerMessage({
      sessionId: session.id,
      role: "user",
      content: "CHANGE_WORKSPACE_FILE",
    });
    const result = await runOverseerCodexTurn({
      sessionId: session.id,
      userMessageId: user.id,
      userMessage: user.content,
      command: fakeCodex,
    });
    assert.strictEqual(result.ok, true);

    const events = listOverseerEvents(session.id).events.filter((event) => event.eventType === "workspace.diff");
    const diffEvent = events[events.length - 1];
    assert.ok(diffEvent, "expected a workspace.diff event");
    assert.strictEqual(diffEvent.event.filesChanged, 1);
    assert.strictEqual(diffEvent.event.additions, 1);
    assert.strictEqual(diffEvent.event.deletions, 0);
  });

  await test("approved update_agent action applies agent runtime settings", () => {
    const agentId = randomUUID();
    const runtimeId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO agents
        (id, company_id, project_id, name, slug, runtime_slug, emoji, role,
         personality, status, adapter_type, model, runtime_config_json, created_at, updated_at)
       VALUES
        (?, ?, ?, 'Oracle', 'oracle', 'oracle', 'icon:sparkles', 'Lead', '', 'idle', 'codex',
         'openai-codex/gpt-5.5', ?, ?, ?)`,
    ).run(
      agentId,
      company.id,
      project.id,
      JSON.stringify({ reasoningEffort: "high", speedPreference: "fast_1_5x", modelLane: "default" }),
      now,
      now,
    );
    db.prepare(
      `INSERT INTO agent_runtimes
        (id, company_id, agent_id, provider, runtime_kind, scope, runtime_slug,
         display_name, command, version, status, workspace_root, metadata_json,
         last_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, 'codex', 'cli', 'agent', 'oracle', 'Oracle Codex',
               ?, 'codex-cli 9.9.9', 'online', ?, ?, ?, ?, ?)`,
    ).run(
      runtimeId,
      company.id,
      agentId,
      fakeCodex,
      path.join(workspaceRoot, "companies", "fixture", "agents", "oracle"),
      JSON.stringify({ reasoningEffort: "high", modelReasoningEffort: "high", speedPreference: "fast_1_5x" }),
      now,
      now,
      now,
    );

    const user = appendOverseerMessage({
      sessionId: session.id,
      role: "user",
      content: "Switch Oracle to X-High.",
    });
    const turn = createOverseerTurn({
      sessionId: session.id,
      userMessageId: user.id,
      prompt: user.content,
    });
    const assistantText = [
      "```mc-action",
      JSON.stringify({
        action: "update_agent",
        companySlug: company.slug,
        agentId,
        agentName: "Oracle",
        changes: {
          runtimeConfig: {
            reasoningEffort: "xhigh",
            speedPreference: "fast_1_5x",
            modelLane: "default",
          },
          runtimeMetadataPatch: {
            reasoningEffort: "xhigh",
            modelReasoningEffort: "xhigh",
          },
        },
        reason: "Operator requested Oracle use X-High reasoning.",
      }),
      "```",
    ].join("\n");

    const approvalResult = createApprovalsForOverseerActions({
      session,
      turnId: turn.id,
      messageId: user.id,
      assistantText,
    });
    assert.strictEqual(approvalResult.approvalIds.length, 1);

    const before = db
      .prepare("SELECT runtime_config_json FROM agents WHERE id = ?")
      .get(agentId) as { runtime_config_json: string };
    assert.strictEqual(JSON.parse(before.runtime_config_json).reasoningEffort, "high");

    const approval = listApprovals({ companyIdOrSlug: company.id, type: "protected_runtime_command" })
      .approvals
      .find((candidate) => candidate.id === approvalResult.approvalIds[0]);
    assert.ok(approval);
    assert.strictEqual(approval.payload.actionType, "update_agent");

    const applied = applyApprovedAgentRuntimeUpdate({
      companyId: company.id,
      action: approval.payload.action,
      approvalId: approval.id,
      actorUserId: "operator",
      db,
    });
    assert.strictEqual(applied.agentId, agentId);

    const updatedAgent = db
      .prepare("SELECT runtime_config_json FROM agents WHERE id = ?")
      .get(agentId) as { runtime_config_json: string };
    const updatedRuntime = db
      .prepare("SELECT metadata_json FROM agent_runtimes WHERE id = ?")
      .get(runtimeId) as { metadata_json: string };
    assert.strictEqual(JSON.parse(updatedAgent.runtime_config_json).reasoningEffort, "xhigh");
    assert.strictEqual(JSON.parse(updatedAgent.runtime_config_json).speedPreference, "fast_1_5x");
    assert.strictEqual(JSON.parse(updatedRuntime.metadata_json).reasoningEffort, "xhigh");
    assert.strictEqual(JSON.parse(updatedRuntime.metadata_json).modelReasoningEffort, "xhigh");
  });

  closeOrchestrationDb();
  rmSync(tempRoot, { recursive: true, force: true });
  finish({ summaryIndent: "  " });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
