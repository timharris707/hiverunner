#!/usr/bin/env node
import {
  asRecord,
  buildExternalRunnerEnv,
  buildExternalRunnerPrompt,
  numberFromEnv,
  readStdin,
  runBufferedCommand,
  splitCommandLine,
  stringFrom,
} from "./lib/external-runner-utils.mjs";

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const DEFAULT_FINAL_POLL_MS = 2 * 1000;
const RUNNER_VERSION = "hiverunner-openclaw-runner 0.1.0";

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(RUNNER_VERSION);
  process.exit(0);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldWaitForFinal() {
  const value = stringFrom(process.env.HIVERUNNER_OPENCLAW_WAIT_FOR_FINAL).toLowerCase();
  return value !== "0" && value !== "false" && value !== "no";
}

function normalizeStatusToken(value) {
  const raw = stringFrom(value);
  return raw ? raw.toLowerCase().replace(/[\s-]+/g, "_") : "";
}

function sessionStateFrom(record) {
  return normalizeStatusToken(record?.status) ||
    normalizeStatusToken(record?.state) ||
    normalizeStatusToken(record?.result);
}

function isFailedSessionState(state) {
  return ["failed", "failure", "error"].includes(state);
}

function isCancelledSessionState(state) {
  return ["cancelled", "canceled", "stopped", "terminated"].includes(state);
}

function isCompletedSessionState(state) {
  return ["done", "completed", "finished", "success", "succeeded"].includes(state);
}

function isTerminalSessionPayload(record, state) {
  return Boolean(record?.done) ||
    Boolean(record?.completed) ||
    Boolean(record?.isComplete) ||
    isCompletedSessionState(state) ||
    isFailedSessionState(state) ||
    isCancelledSessionState(state);
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      const record = asRecord(part);
      if (!record) return "";
      if (record.type && record.type !== "text") return "";
      return stringFrom(record.text) || stringFrom(record.content) || stringFrom(record.message);
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function normalizeUsage(usage) {
  const record = asRecord(usage);
  if (!record) return {};
  const inputTokens = Number(record.input ?? record.inputTokens ?? record.input_tokens);
  const outputTokens = Number(record.output ?? record.outputTokens ?? record.output_tokens);
  const totalTokens = Number(record.totalTokens ?? record.total_tokens);
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : undefined,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : undefined,
    totalTokens: Number.isFinite(totalTokens)
      ? totalTokens
      : Number.isFinite(inputTokens) || Number.isFinite(outputTokens)
        ? (Number.isFinite(inputTokens) ? inputTokens : 0) + (Number.isFinite(outputTokens) ? outputTokens : 0)
        : undefined,
  };
}

function transcriptEventsFromMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((message) => {
      const record = asRecord(message);
      if (!record) return null;
      const body = textFromContent(record.content);
      if (!body) return null;
      return {
        role: stringFrom(record.role) || "assistant",
        kind: "message",
        title: record.role === "user" ? "OpenClaw user message" : "OpenClaw assistant message",
        body,
        metadata: {
          provider: stringFrom(record.provider) || null,
          model: stringFrom(record.model) || null,
          timestamp: record.timestamp ?? null,
        },
      };
    })
    .filter(Boolean)
    .slice(-25);
}

function finalAssistantFromMessages(messages) {
  if (!Array.isArray(messages)) return null;
  for (const message of [...messages].reverse()) {
    const record = asRecord(message);
    if (!record || stringFrom(record.role) !== "assistant") continue;
    const text = textFromContent(record.content);
    if (!text) continue;
    return {
      text,
      provider: stringFrom(record.provider) || null,
      model: stringFrom(record.model) || null,
      usage: normalizeUsage(record.usage),
      stopReason: stringFrom(record.stopReason) || null,
      responseId: stringFrom(record.responseId) || null,
    };
  }
  return null;
}

function buildPrompt(payload) {
  return buildExternalRunnerPrompt(
    payload,
    "You are running through OpenClaw as an implementation of the HiveRunner external runner contract.",
  );
}

function resolveOpenClawAgentId(payload) {
  const agent = asRecord(payload.agent) ?? {};
  return stringFrom(process.env.HIVERUNNER_OPENCLAW_AGENT_ID) ||
    stringFrom(agent.openclawAgentId) ||
    stringFrom(agent.openclaw_agent_id) ||
    stringFrom(agent.externalAgentId);
}

function buildOpenClawInvocation() {
  const commandParts = splitCommandLine(process.env.HIVERUNNER_OPENCLAW_COMMAND || process.env.ORCHESTRATION_OPENCLAW_CLI || "openclaw");
  const command = commandParts[0] || "openclaw";
  return {
    command,
    commandPrefixArgs: commandParts.slice(1),
  };
}

async function gatewayCall({ command, commandPrefixArgs, method, params, cwd }) {
  const timeoutMs = numberFromEnv("HIVERUNNER_OPENCLAW_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const maxBufferBytes = numberFromEnv("HIVERUNNER_OPENCLAW_MAX_BUFFER", DEFAULT_MAX_BUFFER_BYTES);
  const args = [
    ...commandPrefixArgs,
    "gateway",
    "call",
    method,
    "--json",
    "--params",
    JSON.stringify(params),
  ];

  const result = await runBufferedCommand({
    command,
    args,
    cwd,
    env: buildExternalRunnerEnv({
      HIVERUNNER_EXTERNAL_RUNNER: "1",
      HIVERUNNER_OPENCLAW_RUNNER: "1",
    }),
    timeoutMs,
    maxBufferBytes,
    describeTimeout: () => `OpenClaw gateway call ${method} timed out after ${timeoutMs}ms`,
    describeBufferLimit: () => `OpenClaw gateway call ${method} exceeded ${maxBufferBytes} bytes of stdout`,
    describeExit: ({ exitCode, signal }) => `OpenClaw gateway call ${method} exited with code ${exitCode}${signal ? ` (${signal})` : ""}`,
  });
  const { stdout, stderr, error } = result;
  let json = null;
  if (!error) {
    try {
      json = JSON.parse(stdout);
    } catch (parseError) {
      return {
        ok: false,
        args,
        stdout,
        stderr,
        error: parseError instanceof Error ? parseError.message : String(parseError),
      };
    }
  }
  return { ok: !error, args, stdout, stderr, error, json };
}

async function gatewayCallWithFallback(input) {
  const primary = await gatewayCall(input);
  if (primary.ok || !String(primary.error ?? "").includes("unknown method")) {
    return primary;
  }
  return gatewayCall({
    ...input,
    method: input.method.replace(/\./g, "_"),
  });
}

async function waitForOpenClawFinal({ invocation, sessionKey, cwd, startedAt }) {
  const timeoutMs = numberFromEnv("HIVERUNNER_OPENCLAW_FINAL_TIMEOUT_MS", numberFromEnv("HIVERUNNER_OPENCLAW_TIMEOUT_MS", DEFAULT_TIMEOUT_MS));
  const pollMs = numberFromEnv("HIVERUNNER_OPENCLAW_FINAL_POLL_MS", DEFAULT_FINAL_POLL_MS);
  let lastResult = null;
  let lastMessages = [];

  while (Date.now() - startedAt < timeoutMs) {
    const getResult = await gatewayCallWithFallback({
      ...invocation,
      method: "sessions.get",
      params: { key: sessionKey },
      cwd,
    });
    lastResult = getResult;
    if (!getResult.ok) {
      return {
        error: getResult.error || "OpenClaw session status lookup failed.",
        stdout: getResult.stdout,
        stderr: getResult.stderr,
        openclawStatus: "status_lookup_failed",
      };
    }
    const session = asRecord(getResult.json) ?? {};
    const state = sessionStateFrom(session);
    const messages = Array.isArray(session.messages)
      ? session.messages
      : [];
    lastMessages = messages;
    const final = finalAssistantFromMessages(messages);
    if (final) {
      return {
        finalText: final.text,
        finalProvider: final.provider,
        finalModel: final.model,
        finalUsage: final.usage,
        stopReason: final.stopReason,
        responseId: final.responseId,
        transcriptEvents: transcriptEventsFromMessages(messages),
        openclawStatus: "completed",
      };
    }
    if (isFailedSessionState(state) || isCancelledSessionState(state)) {
      return {
        error: `OpenClaw session ended with status ${state}.`,
        openclawStatus: state,
        stdout: getResult.stdout,
        stderr: getResult.stderr,
        transcriptEvents: transcriptEventsFromMessages(messages),
      };
    }
    if (isTerminalSessionPayload(session, state)) {
      return {
        error: `OpenClaw session completed without final assistant output${state ? ` (status ${state})` : ""}.`,
        openclawStatus: state || "completed",
        stdout: getResult.stdout,
        stderr: getResult.stderr,
        transcriptEvents: transcriptEventsFromMessages(messages),
      };
    }
    await sleep(pollMs);
  }

  return {
    error: `OpenClaw run accepted but did not produce final assistant output within ${timeoutMs}ms.`,
    openclawStatus: "running",
    stdout: lastResult?.stdout,
    stderr: lastResult?.stderr,
    transcriptEvents: transcriptEventsFromMessages(lastMessages),
  };
}

async function runOpenClaw({ payload, cwd, prompt }) {
  const invocation = buildOpenClawInvocation();
  const agentId = resolveOpenClawAgentId(payload);
  if (!agentId) {
    return { error: "OpenClaw external runner requires agent.openclawAgentId or HIVERUNNER_OPENCLAW_AGENT_ID." };
  }
  const task = asRecord(payload.task) ?? {};
  const taskKey = stringFrom(task.key) || stringFrom(task.id) || stringFrom(payload.runId) || "task";
  const suffix = Math.random().toString(36).slice(2, 10);
  const sessionKey = `external-runner:${agentId}:${taskKey}:${suffix}`;
  const startedAt = Date.now();

  const createResult = await gatewayCallWithFallback({
    ...invocation,
    method: "sessions.create",
    params: {
      key: sessionKey,
      agentId,
      label: `HiveRunner external runner: ${taskKey} ${suffix}`,
    },
    cwd,
  });
  if (!createResult.ok || !asRecord(createResult.json)?.sessionId) {
    return {
      error: createResult.error || `OpenClaw session create returned no sessionId for ${sessionKey}`,
      stdout: createResult.stdout,
      stderr: createResult.stderr,
      durationMs: Date.now() - startedAt,
    };
  }
  const sessionId = String(asRecord(createResult.json).sessionId);
  const sendResult = await gatewayCallWithFallback({
    ...invocation,
    method: "sessions.send",
    params: {
      key: sessionKey,
      message: prompt,
    },
    cwd,
  });
  if (!sendResult.ok) {
    return {
      sessionId,
      sessionKey,
      error: sendResult.error || "OpenClaw session send failed.",
      stdout: sendResult.stdout,
      stderr: sendResult.stderr,
      durationMs: Date.now() - startedAt,
    };
  }
  const sendJson = asRecord(sendResult.json) ?? {};
  if (shouldWaitForFinal()) {
    const final = await waitForOpenClawFinal({
      invocation,
      sessionKey,
      cwd,
      startedAt,
    });
    if (final.error) {
      return {
        sessionId,
        sessionKey,
        openclawRunId: stringFrom(sendJson.runId),
        openclawAcceptedStatus: stringFrom(sendJson.status) || "accepted",
        openclawStatus: final.openclawStatus || "running",
        error: final.error,
        stdout: final.stdout,
        stderr: final.stderr,
        transcriptEvents: final.transcriptEvents,
        durationMs: Date.now() - startedAt,
      };
    }
    return {
      sessionId,
      sessionKey,
      openclawRunId: stringFrom(sendJson.runId),
      openclawAcceptedStatus: stringFrom(sendJson.status) || "accepted",
      openclawStatus: final.openclawStatus,
      resultText: final.finalText,
      assistantSummary: final.finalText,
      finalProvider: final.finalProvider,
      finalModel: final.finalModel,
      finalUsage: final.finalUsage,
      stopReason: final.stopReason,
      responseId: final.responseId,
      transcriptEvents: final.transcriptEvents,
      durationMs: Date.now() - startedAt,
    };
  }
  return {
    sessionId,
    sessionKey,
    openclawRunId: stringFrom(sendJson.runId),
    openclawAcceptedStatus: stringFrom(sendJson.status) || "accepted",
    openclawStatus: stringFrom(sendJson.status) || "started",
    durationMs: Date.now() - startedAt,
  };
}

async function main() {
  const rawInput = await readStdin();
  const payload = JSON.parse(rawInput);
  if (payload.schema !== "hiverunner.symphony.execution.v1") {
    throw new Error(`Unsupported payload schema: ${payload.schema ?? "missing"}`);
  }

  const workspace = asRecord(payload.workspace) ?? {};
  const cwd = stringFrom(workspace.cwd) || process.cwd();
  const prompt = buildPrompt(payload);

  if (process.env.HIVERUNNER_OPENCLAW_DRY_RUN === "1" || process.env.HIVERUNNER_EXTERNAL_RUNNER_DRY_RUN === "1") {
    process.stdout.write(JSON.stringify({
      sessionId: `openclaw-dry-run-${payload.runId ?? Date.now()}`,
      resultText: [
        "OpenClaw external runner dry run accepted the HiveRunner task payload.",
        "",
        "```mc-action",
        JSON.stringify({ action: "report", summary: "OpenClaw external runner dry run completed without launching the OpenClaw gateway." }),
        "```",
      ].join("\n"),
      assistantSummary: "OpenClaw external runner dry run completed without launching the OpenClaw gateway.",
      runnerProvider: "openclaw",
      runnerModel: null,
      transcriptEvents: [
        {
          role: "assistant",
          kind: "message",
          title: "OpenClaw external runner dry run",
          body: prompt,
        },
      ],
    }) + "\n");
    return;
  }

  const result = await runOpenClaw({ payload, cwd, prompt });
  const task = asRecord(payload.task) ?? {};
  const assistantSummary = result.error
    ? `OpenClaw external runner failed: ${result.error}`
    : stringFrom(result.assistantSummary) ||
      `OpenClaw gateway accepted ${task.key ?? "the task"} for execution${result.openclawRunId ? ` as run ${result.openclawRunId}` : ""}.`;
  process.stdout.write(JSON.stringify({
    sessionId: result.sessionId || `openclaw-${payload.runId ?? Date.now()}`,
    sessionKey: result.sessionKey,
    resultText: stringFrom(result.resultText) || assistantSummary,
    assistantSummary,
    error: result.error ?? undefined,
    runnerProvider: "openclaw",
    runnerModel: null,
    durationMs: result.durationMs,
    transcriptEvents: Array.isArray(result.transcriptEvents) && result.transcriptEvents.length > 0
      ? result.transcriptEvents
      : [{
          role: "assistant",
          kind: "message",
          title: "OpenClaw gateway handoff",
          body: assistantSummary,
        }],
    usage: {
      runnerProvider: "openclaw",
      runnerModel: null,
      openclawRunId: result.openclawRunId ?? null,
      openclawAcceptedStatus: result.openclawAcceptedStatus ?? null,
      openclawStatus: result.openclawStatus ?? null,
      finalProvider: result.finalProvider ?? null,
      finalModel: result.finalModel ?? null,
      responseId: result.responseId ?? null,
      stopReason: result.stopReason ?? null,
      integrationPath: "openclaw-gateway-sessions",
      invocationMode: shouldWaitForFinal()
        ? "gateway.sessions.create_send_poll_get"
        : "gateway.sessions.create_then_send",
      promptDelivery: "json_params_message",
      jsonEventCapture: true,
      inputTokens: result.finalUsage?.inputTokens,
      outputTokens: result.finalUsage?.outputTokens,
      totalTokens: result.finalUsage?.totalTokens,
    },
  }) + "\n");
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
    resultText: "",
    assistantSummary: "",
    runnerProvider: "openclaw",
    runnerModel: null,
  }) + "\n");
});
