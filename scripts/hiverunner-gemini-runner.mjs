#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  asRecord,
  buildExternalRunnerEnv,
  buildExternalRunnerPrompt,
  numberFrom,
  numberFromEnv,
  readStdin,
  runBufferedCommand,
  splitCommandLine,
  stringFrom,
} from "./lib/external-runner-utils.mjs";

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
const DEFAULT_NO_OUTPUT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_PROGRESS_INTERVAL_MS = 30 * 1000;
const DEFAULT_TERMINATION_GRACE_MS = 5 * 1000;
const DEFAULT_PREFLIGHT_TIMEOUT_MS = 15 * 1000;
const PREFLIGHT_SCHEMA = "hiverunner.benchmark.model-preflight.v1";
const DIRECT_GENERATION_SCHEMA = "hiverunner.benchmark.google-direct-generation.v1";
const DEFAULT_GEMINI_MODEL = "gemini-3-pro-preview";
const RUNNER_VERSION = "hiverunner-gemini-runner 0.1.0";
const LIVE_EVENT_SCHEMA = "hiverunner.external-runner.live-event.v1";
const LIVE_EVENT_PREFIX = "::hiverunner-live-event ";
const DEFAULT_LIVE_EVENT_LIMIT = 200;
const ANSI_CONTROL_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const BRAILLE_SPINNER_PATTERN = /^[\u2800-\u28ff]\s*/u;

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(RUNNER_VERSION);
  process.exit(0);
}

function normalizeGeminiModel(value) {
  const model = stringFrom(value).replace(/^google\//i, "").toLowerCase();
  if (
    !model ||
    model === "auto" ||
    model === "default" ||
    model === "google-default" ||
    model === "gemini-default" ||
    model === "gemini-pro" ||
    model === "pro"
  ) {
    return DEFAULT_GEMINI_MODEL;
  }
  if (model === "flash") return "gemini-3-flash-preview";
  if (model === "flash-lite") return "gemini-2.5-flash-lite";
  return model;
}

function parseJsonLine(line) {
  try {
    const parsed = JSON.parse(line);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function formatDuration(durationMs) {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function extractText(value, depth = 0) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => extractText(item, depth + 1)).filter(Boolean).join("\n").trim();
  }
  if (depth > 6) return "";
  const record = asRecord(value);
  if (!record) return "";
  const direct =
    stringFrom(record.text) ||
    stringFrom(record.message) ||
    stringFrom(record.content) ||
    stringFrom(record.response) ||
    stringFrom(record.result) ||
    stringFrom(record.output) ||
    stringFrom(record.output_text);
  if (direct) return direct;

  for (const key of [
    "message",
    "item",
    "event",
    "delta",
    "content",
    "parts",
    "output",
    "response",
    "result",
    "candidate",
    "candidates",
    "functionCall",
    "function_call",
  ]) {
    const nested = record[key];
    if (nested && typeof nested === "object") {
      const text = extractText(nested, depth + 1);
      if (text) return text;
    }
  }

  return "";
}

function stripAnsiControl(value) {
  return String(value ?? "").replace(ANSI_CONTROL_PATTERN, "");
}

function normalizeGeminiPlainTextLine(value) {
  let text = stripAnsiControl(value).trim();
  text = text.replace(BRAILLE_SPINNER_PATTERN, "").trim();
  if (/^[|/\\]\s*/.test(text)) {
    text = text.replace(/^[|/\\]\s*/, "").trim();
  } else if (/^[-_.]\s+(loading|thinking|generating|processing|working|waiting|running|still working)\b/i.test(text)) {
    text = text.replace(/^[-_.]\s*/, "").trim();
  }
  if (!text) return "";
  if (/^[|/\\_.\-\s]+$/.test(text)) return "";
  if (/^(loading|thinking|generating|processing|working|waiting|running|still working)\.?\s*$/i.test(text)) {
    return "";
  }
  return text;
}

function meaningfulPlainTextFromOutput(value) {
  const lines = stripAnsiControl(value)
    .split(/\r?\n|\r/)
    .map(normalizeGeminiPlainTextLine)
    .filter(Boolean);
  return lines.join("\n").trim();
}

function geminiEventType(record) {
  return stringFrom(record.type) || stringFrom(record.kind) || stringFrom(record.event) || "gemini_event";
}

function geminiNestedRecord(record) {
  return asRecord(record.item) ||
    asRecord(record.message) ||
    asRecord(record.event) ||
    asRecord(record.delta) ||
    asRecord(record.functionCall) ||
    asRecord(record.function_call);
}

function geminiNestedType(record) {
  const nested = geminiNestedRecord(record);
  return nested ? stringFrom(nested.type) || stringFrom(nested.kind) || stringFrom(nested.name) : "";
}

function firstStringValue(values) {
  for (const value of values) {
    const text = stringFrom(value);
    if (text) return text;
  }
  return "";
}

function geminiToolName(record) {
  const nested = geminiNestedRecord(record);
  return firstStringValue([
    record.tool_name,
    record.toolName,
    record.name,
    record.command,
    nested?.tool_name,
    nested?.toolName,
    nested?.name,
    nested?.command,
    geminiNestedType(record),
    geminiEventType(record),
  ]);
}

function geminiRecordMetadata(type, nestedType) {
  return {
    runnerProvider: "gemini",
    source: "gemini-stdout",
    geminiEventType: type,
    geminiNestedType: nestedType || null,
  };
}

function geminiProviderErrorEvent(body, metadata) {
  if (!body) return null;
  return {
    kind: "provider_error",
    role: "system",
    title: "Gemini error",
    body,
    metadata,
  };
}

function geminiToolEvent(record, body, lowerType, metadata) {
  const toolName = geminiToolName(record);
  const isResult = /(result|output|completed|finish|response)/.test(lowerType);
  return {
    kind: isResult ? "tool_result" : "tool_call_start",
    role: "tool",
    title: toolName || (isResult ? "Gemini tool result" : "Gemini tool call"),
    body: body || `Gemini ${isResult ? "completed" : "started"} ${toolName || "a tool call"}.`,
    metadata,
  };
}

function geminiThinkingEvent(body, metadata) {
  if (!body) return null;
  return {
    kind: "thinking_summary",
    role: "assistant",
    title: "Gemini thinking summary",
    body,
    metadata,
  };
}

function geminiAssistantEvent(body, lowerType, metadata) {
  if (!body) return null;
  const isFinal = /(final|result|completed|complete|response)/.test(lowerType);
  return {
    kind: isFinal ? "assistant_text_final" : "assistant_text_delta",
    role: "assistant",
    title: isFinal ? "Gemini assistant final" : "Gemini assistant text",
    body,
    metadata,
  };
}

function geminiProviderEvent(type, metadata) {
  return {
    kind: "provider_event",
    role: "system",
    title: "Gemini event",
    body: type || "Gemini event",
    metadata,
  };
}

function geminiTranscriptEventFromRecord(record) {
  const type = geminiEventType(record);
  const nestedType = geminiNestedType(record);
  const lowerType = `${type} ${nestedType}`.toLowerCase();
  if (lowerType.includes("usage")) return null;

  const body = extractText(record);
  const metadata = geminiRecordMetadata(type, nestedType);
  if (/error|exception|failed|failure/.test(lowerType)) return geminiProviderErrorEvent(body, metadata);
  if (/(tool|function|command|shell|terminal)/.test(lowerType)) return geminiToolEvent(record, body, lowerType, metadata);
  if (/(reason|thinking|thought)/.test(lowerType)) return geminiThinkingEvent(body, metadata);
  if (body) return geminiAssistantEvent(body, lowerType, metadata);
  if (/session|turn|start/.test(lowerType)) return geminiProviderEvent(type, metadata);
  return null;
}

function geminiTranscriptEventFromPlainText(body) {
  const text = normalizeGeminiPlainTextLine(body);
  if (!text) return null;
  return {
    kind: "assistant_text_delta",
    role: "assistant",
    title: "Gemini assistant text",
    body: text,
    metadata: {
      runnerProvider: "gemini",
      source: "gemini-stdout",
      outputFormat: "text",
    },
  };
}

function collectUsage(records) {
  const usage = {};
  for (const record of records) {
    const candidate = asRecord(record.usage) ?? asRecord(record.usageMetadata) ?? asRecord(record.tokenUsage) ?? record;
    if (!candidate) continue;
    usage.inputTokens ??= numberFrom(candidate.inputTokens ?? candidate.input_tokens ?? candidate.promptTokenCount);
    usage.outputTokens ??= numberFrom(candidate.outputTokens ?? candidate.output_tokens ?? candidate.candidatesTokenCount);
    usage.totalTokens ??= numberFrom(candidate.totalTokens ?? candidate.total_tokens ?? candidate.totalTokenCount);
  }
  if (!usage.totalTokens && (usage.inputTokens || usage.outputTokens)) {
    usage.totalTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  }
  return usage;
}

function trimForLiveEvent(value, maxChars = 4000) {
  const text = stringFrom(value);
  if (text.length <= maxChars) return text;
  return text.slice(-maxChars);
}

function emitRunnerLiveEvent(event) {
  try {
    process.stderr.write(`${LIVE_EVENT_PREFIX}${JSON.stringify({
      schema: LIVE_EVENT_SCHEMA,
      event,
    })}\n`);
  } catch {
    // Live progress is best effort; final JSON output is still authoritative.
  }
}

function createGeminiLiveEventEmitter(limit) {
  let forwarded = 0;
  let limitReported = false;

  const maybeEmitLimit = () => {
    if (limitReported) return;
    limitReported = true;
    emitRunnerLiveEvent({
      kind: "runtime_progress",
      role: "system",
      title: "Gemini live event limit reached",
      body: `Gemini live output exceeded ${limit} forwarded event(s); continuing to buffer final output.`,
      metadata: {
        runnerProvider: "gemini",
        source: "gemini-stdout",
        liveEventLimit: limit,
      },
    });
  };

  return (event) => {
    if (!event) return false;
    const body = trimForLiveEvent(event.body);
    if (!body && !stringFrom(event.title)) return false;
    if (forwarded >= limit) {
      maybeEmitLimit();
      return true;
    }
    forwarded += 1;
    emitRunnerLiveEvent({
      ...event,
      body,
    });
    return true;
  };
}

function createGeminiLiveStdoutForwarder() {
  const limit = numberFromEnv("HIVERUNNER_GEMINI_LIVE_EVENT_LIMIT", DEFAULT_LIVE_EVENT_LIMIT);
  const emitEvent = createGeminiLiveEventEmitter(limit);
  let lineBuffer = "";

  const ingestLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line) return false;
    const record = parseJsonLine(line);
    if (record) return emitEvent(geminiTranscriptEventFromRecord(record));
    return emitEvent(geminiTranscriptEventFromPlainText(rawLine));
  };

  return {
    push(chunk) {
      const text = lineBuffer + chunk.toString("utf8");
      const lines = text.split(/\r?\n|\r/);
      lineBuffer = lines.pop() ?? "";
      let sawMeaningful = false;
      for (const line of lines) {
        if (ingestLine(line)) sawMeaningful = true;
      }
      return sawMeaningful;
    },
    flush() {
      const pending = lineBuffer;
      lineBuffer = "";
      return pending.trim() ? ingestLine(pending) : false;
    },
  };
}

function hasMeaningfulGeminiOutput(stream, chunk) {
  if (stream === "stdout") return false;
  return meaningfulPlainTextFromOutput(chunk.toString("utf8")).length > 0;
}

function createGeminiOutputTracker() {
  const liveStdout = createGeminiLiveStdoutForwarder();
  return {
    push(stream, chunk) {
      if (stream === "stdout") return liveStdout.push(chunk);
      return hasMeaningfulGeminiOutput(stream, chunk);
    },
    flush() {
      return liveStdout.flush();
    },
  };
}

function benchmarkHarnessPricing(payload) {
  const benchmark = benchmarkContext(payload);
  return asRecord(benchmark.harnessLocalPricing) ?? asRecord(payload.harnessLocalPricing);
}

function benchmarkPricingTier(payload) {
  const benchmark = benchmarkContext(payload);
  return stringFrom(benchmark.costPricingTier ?? benchmark.pricingTier ?? payload.costPricingTier) || "standard";
}

function perMillionCost(tokens, usdPerMillion) {
  return (Math.max(0, tokens ?? 0) / 1_000_000) * usdPerMillion;
}

function benchmarkCostTelemetry(payload, model, usage) {
  if (!isBenchmarkPayload(payload)) return null;
  const pricing = benchmarkHarnessPricing(payload);
  const tier = benchmarkPricingTier(payload);
  const tierPricing = asRecord(pricing?.[tier]);
  const inputUsdPerMillion = numberFrom(tierPricing?.input);
  const outputUsdPerMillion = numberFrom(tierPricing?.output);
  const inputTokens = numberFrom(usage.inputTokens);
  const outputTokens = numberFrom(usage.outputTokens);
  const hasTokenUsage = inputTokens !== undefined || outputTokens !== undefined;
  const base = {
    schema: "hiverunner.benchmark.cost-telemetry.v1",
    provider: "google",
    runtimeProvider: "gemini",
    modelId: model,
    currency: stringFrom(pricing?.currency) || "USD",
    exactProviderCostUsd: null,
    exactProviderCostCents: null,
    inputTokens: inputTokens ?? null,
    outputTokens: outputTokens ?? null,
    totalTokens: numberFrom(usage.totalTokens) ?? null,
  };

  if (hasTokenUsage && inputUsdPerMillion !== undefined && outputUsdPerMillion !== undefined) {
    const estimatedCostUsd =
      perMillionCost(inputTokens ?? 0, inputUsdPerMillion) +
      perMillionCost(outputTokens ?? 0, outputUsdPerMillion);
    return {
      ...base,
      costKind: "estimated",
      estimatedCostUsd,
      estimatedCostCents: estimatedCostUsd * 100,
      estimateSource: "benchmark_payload.harnessLocalPricing",
      pricingTier: tier,
      pricingUnit: stringFrom(pricing?.unit) || "per_1m_tokens",
      inputUsdPerMillion,
      outputUsdPerMillion,
      unavailableReason: null,
    };
  }

  return {
    ...base,
    costKind: "unavailable",
    estimatedCostUsd: null,
    estimatedCostCents: null,
    estimateSource: null,
    pricingTier: tier,
    pricingUnit: stringFrom(pricing?.unit) || null,
    inputUsdPerMillion: inputUsdPerMillion ?? null,
    outputUsdPerMillion: outputUsdPerMillion ?? null,
    unavailableReason: hasTokenUsage
      ? "benchmark_payload_missing_harness_local_pricing"
      : "provider_usage_tokens_unavailable",
  };
}

function collectTranscriptEvents(records, finalMessage) {
  const events = [];
  for (const record of records) {
    const event = geminiTranscriptEventFromRecord(record);
    if (event) events.push(event);
  }
  if (events.length === 0 && finalMessage) {
    events.push({
      role: "assistant",
      kind: "assistant_text_final",
      title: "Gemini final message",
      body: finalMessage,
    });
  }
  return events.slice(-25);
}

function trimForStorage(value, maxChars = 4000) {
  if (!value) return "";
  return String(value).slice(-maxChars);
}

function benchmarkPacketRunId(payload) {
  const benchmark = asRecord(payload.benchmark) ?? asRecord(payload.benchmarkContext) ?? {};
  return stringFrom(benchmark.packet_run_id) ||
    stringFrom(benchmark.packetRunId) ||
    stringFrom(payload.packet_run_id) ||
    stringFrom(payload.packetRunId);
}

function shouldRunPreflight(payload, model) {
  const setting = stringFrom(process.env.HIVERUNNER_GEMINI_PREFLIGHT).toLowerCase();
  if (["0", "false", "off", "skip"].includes(setting)) return false;
  if (["1", "true", "on", "required"].includes(setting)) return true;

  const benchmark = asRecord(payload.benchmark) ?? asRecord(payload.benchmarkContext) ?? {};
  const preflight = asRecord(benchmark.preflight) ?? {};
  if (preflight.required === true || benchmark.preflightRequired === true) return true;
  if (payload.benchmarkOnly === true || benchmark.benchmarkOnly === true) return true;
  if (stringFrom(benchmark.candidateId) || stringFrom(payload.candidateId)) return true;
  return /^gemini-3\.5[-.]/i.test(model);
}

function preflightReport(preflight) {
  const status = preflight.status === "passed" ? "passed" : preflight.status === "skipped" ? "skipped" : "blocked";
  const allowed = preflight.benchmarkCellsAllowed ? "allowed" : "blocked";
  const errorClass = preflight.terminalErrorClass ? ` terminalErrorClass=${preflight.terminalErrorClass}` : "";
  return [
    "```mc-action",
    JSON.stringify({
      action: "report",
      summary: `Gemini benchmark model preflight ${status}; benchmark cells ${allowed} for ${preflight.provider}/${preflight.modelId}.${errorClass}`,
    }),
    "```",
  ].join("\n");
}

function preflightResultOutput(payload, preflight) {
  const costTelemetry = benchmarkCostTelemetry(payload, preflight.modelId, {});
  return {
    sessionId: `gemini-preflight-${payload.runId ?? Date.now()}`,
    resultText: preflightReport(preflight),
    assistantSummary: `Gemini benchmark model preflight ${preflight.status}; benchmark cells ${preflight.benchmarkCellsAllowed ? "allowed" : "blocked"}.`,
    runnerProvider: "gemini",
    runnerModel: preflight.modelId,
    preflight,
    usage: {
      runnerProvider: "gemini",
      runnerModel: preflight.modelId,
      preflight,
      ...(costTelemetry ? { benchmarkCostTelemetry: costTelemetry } : {}),
    },
    transcriptEvents: [
      {
        role: "assistant",
        kind: preflight.status === "passed" ? "provider_event" : "provider_error",
        title: "Gemini benchmark model preflight",
        body: `Preflight ${preflight.status}; benchmark cells ${preflight.benchmarkCellsAllowed ? "allowed" : "blocked"}.`,
        metadata: preflight,
      },
    ],
  };
}

function basePreflight(payload, model) {
  const packetRunId = benchmarkPacketRunId(payload);
  const runId = stringFrom(payload.runId);
  const currentPacketRunId = packetRunId && (!runId || packetRunId === runId) ? packetRunId : null;
  return {
    schema: PREFLIGHT_SCHEMA,
    checkedAtUtc: new Date().toISOString(),
    provider: "google",
    runtimeProvider: "gemini",
    modelId: model,
    runnerModel: resolvePayloadModel(payload),
    endpointRuntimeSource: null,
    status: "pending",
    terminalErrorClass: null,
    benchmarkCellsAllowed: false,
    noGeneration: true,
    heartbeatRunId: runId || null,
    runId: runId || null,
    packetRunId: currentPacketRunId,
    stdoutTail: "",
    stderrTail: "",
  };
}

function classifyPreflightError(input) {
  const status = Number(input.status ?? 0);
  const text = `${input.code ?? ""} ${input.message ?? ""} ${input.stderr ?? ""} ${input.stdout ?? ""}`;
  if (status === 404 || /\b(404|not[_ -]?found|modelnotfound|model not found|not_found)\b/i.test(text)) return "model_not_found";
  if ([401, 403].includes(status) || /\b(unauthorized|permission|forbidden|access denied|auth)\b/i.test(text)) return "runtime_access_denied";
  if (input.timeout) return "preflight_timeout";
  return "runtime_error";
}

function normalizeApiModelName(model) {
  const normalized = normalizeGeminiModel(model).replace(/^models\//i, "");
  return `models/${normalized}`;
}

function googleApiKey() {
  return stringFrom(process.env.GOOGLE_AI_API_KEY) ||
    stringFrom(process.env.GEMINI_API_KEY) ||
    stringFrom(process.env.GOOGLE_API_KEY) ||
    stringFrom(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
}

function geminiApiBaseUrl() {
  return (stringFrom(process.env.HIVERUNNER_GEMINI_API_BASE_URL) || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
}

function geminiApiUrl(path, key) {
  return `${geminiApiBaseUrl()}/${path.replace(/^\/+/, "")}?key=${encodeURIComponent(key)}`;
}

function preflightMode() {
  const mode = stringFrom(process.env.HIVERUNNER_GEMINI_PREFLIGHT_MODE).toLowerCase();
  if (mode) return mode;
  if (stringFrom(process.env.HIVERUNNER_GEMINI_PREFLIGHT_METADATA_FILE)) return "metadata-file";
  return "api";
}

async function metadataFilePreflight(payload, model) {
  const preflight = basePreflight(payload, model);
  preflight.endpointRuntimeSource = "metadata-file";
  const file = stringFrom(process.env.HIVERUNNER_GEMINI_PREFLIGHT_METADATA_FILE);
  if (!file) {
    return {
      ...preflight,
      status: "blocked",
      terminalErrorClass: "preflight_configuration_error",
      benchmarkCellsAllowed: false,
      stderrTail: "HIVERUNNER_GEMINI_PREFLIGHT_METADATA_FILE is required for metadata-file preflight mode.",
    };
  }
  const parsed = JSON.parse(await readFile(file, "utf8"));
  const models = asRecord(parsed.models) ?? parsed;
  const entry = asRecord(models[model]) ?? asRecord(models[normalizeApiModelName(model)]) ?? null;
  if (entry?.ok === true || entry?.status === "ok" || entry?.status === "accessible") {
    return {
      ...preflight,
      status: "passed",
      terminalErrorClass: null,
      benchmarkCellsAllowed: true,
    };
  }
  const status = numberFrom(entry?.httpStatus ?? entry?.statusCode ?? entry?.status);
  const message = stringFrom(entry?.message ?? entry?.error) || `Model ${model} was not found in preflight metadata.`;
  return {
    ...preflight,
    status: "blocked",
    terminalErrorClass: classifyPreflightError({ status, message }),
    benchmarkCellsAllowed: false,
    stderrTail: trimForStorage(message),
  };
}

async function apiPreflight(payload, model) {
  const preflight = basePreflight(payload, model);
  preflight.endpointRuntimeSource = "gemini-api-v1beta-models-get";
  const key = googleApiKey();
  if (!key) {
    return {
      ...preflight,
      status: "blocked",
      terminalErrorClass: "preflight_configuration_error",
      benchmarkCellsAllowed: false,
      stderrTail: "GOOGLE_AI_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY is required for API model preflight.",
    };
  }
  const controller = new AbortController();
  const timeoutMs = numberFromEnv("HIVERUNNER_GEMINI_PREFLIGHT_TIMEOUT_MS", DEFAULT_PREFLIGHT_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const endpoint = geminiApiUrl(normalizeApiModelName(model), key);
  try {
    const response = await fetch(endpoint, { signal: controller.signal });
    const body = await response.text();
    if (response.ok) {
      return {
        ...preflight,
        status: "passed",
        terminalErrorClass: null,
        benchmarkCellsAllowed: true,
        stdoutTail: trimForStorage(body),
      };
    }
    return {
      ...preflight,
      status: "blocked",
      terminalErrorClass: classifyPreflightError({ status: response.status, message: body }),
      benchmarkCellsAllowed: false,
      stderrTail: trimForStorage(body),
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      ...preflight,
      status: "blocked",
      terminalErrorClass: classifyPreflightError({ timeout: timedOut, message: error instanceof Error ? error.message : String(error) }),
      benchmarkCellsAllowed: false,
      stderrTail: trimForStorage(error instanceof Error ? error.message : String(error)),
    };
  } finally {
    clearTimeout(timer);
  }
}

function benchmarkContext(payload) {
  return asRecord(payload.benchmark) ?? asRecord(payload.benchmarkContext) ?? {};
}

function isBenchmarkPayload(payload) {
  const benchmark = benchmarkContext(payload);
  return payload.benchmarkOnly === true ||
    benchmark.benchmarkOnly === true ||
    Boolean(stringFrom(benchmark.candidateId) || stringFrom(payload.candidateId));
}

function directGenerationMode() {
  return stringFrom(process.env.HIVERUNNER_GEMINI_GENERATION_MODE).toLowerCase();
}

function shouldUseDirectApiGeneration(payload, preflight, model) {
  const mode = directGenerationMode();
  if (["cli", "gemini-cli"].includes(mode)) return false;
  if (["api", "direct", "google-direct"].includes(mode)) return true;
  return preflight?.status === "passed" && isBenchmarkPayload(payload) && /^gemini-3\.5[-.]/i.test(model);
}

function extractGenerateContentText(body) {
  const candidates = Array.isArray(body?.candidates) ? body.candidates : [];
  const parts = candidates
    .flatMap((candidate) => Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [])
    .map((part) => stringFrom(part?.text))
    .filter(Boolean);
  return parts.join("\n").trim();
}

function usageFromGenerateContent(body) {
  const usage = asRecord(body?.usageMetadata) ?? {};
  const inputTokens = numberFrom(usage.promptTokenCount ?? usage.inputTokens ?? usage.input_tokens);
  const outputTokens = numberFrom(usage.candidatesTokenCount ?? usage.outputTokens ?? usage.output_tokens);
  const totalTokens = numberFrom(usage.totalTokenCount ?? usage.totalTokens ?? usage.total_tokens) ??
    (inputTokens || outputTokens ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined);
  return { inputTokens, outputTokens, totalTokens };
}

async function runDirectGeminiGeneration(prompt, model, preflight) {
  const key = googleApiKey();
  const startedAt = Date.now();
  const provenance = {
    schema: DIRECT_GENERATION_SCHEMA,
    provider: "google",
    runtimeProvider: "google-direct",
    modelId: model,
    runnerModel: model,
    endpointRuntimeSource: "gemini-api-v1beta-generateContent",
    preflightSchema: preflight?.schema ?? null,
    preflightEndpointRuntimeSource: preflight?.endpointRuntimeSource ?? null,
    noCli: true,
  };
  if (!key) {
    return {
      provenance,
      error: "Google direct generation requires GOOGLE_AI_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY.",
      terminalErrorClass: "runtime_access_denied",
      text: "",
      rawResponse: "",
      durationMs: Date.now() - startedAt,
    };
  }

  const controller = new AbortController();
  const timeoutMs = numberFromEnv("HIVERUNNER_GEMINI_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const endpoint = geminiApiUrl(`${normalizeApiModelName(model)}:generateContent`, key);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
      }),
    });
    const rawResponse = await response.text();
    let body = null;
    try {
      body = rawResponse ? JSON.parse(rawResponse) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      return {
        provenance,
        error: `Google direct generation failed with status ${response.status}`,
        terminalErrorClass: classifyPreflightError({ status: response.status, message: rawResponse }),
        text: "",
        rawResponse: trimForStorage(rawResponse),
        durationMs: Date.now() - startedAt,
      };
    }
    return {
      provenance,
      error: null,
      terminalErrorClass: null,
      text: extractGenerateContentText(body) || rawResponse.trim(),
      rawResponse: trimForStorage(rawResponse),
      usage: usageFromGenerateContent(body),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      provenance,
      error: error instanceof Error ? error.message : String(error),
      terminalErrorClass: classifyPreflightError({ timeout: timedOut, message: error instanceof Error ? error.message : String(error) }),
      text: "",
      rawResponse: "",
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

function replacePromptArg(args, prompt) {
  const next = [...args];
  const promptIndex = next.indexOf("--prompt");
  if (promptIndex >= 0) {
    next[promptIndex + 1] = prompt;
    return next;
  }
  return ["--prompt", prompt, ...next];
}

async function cliPreflight(payload, invocation, cwd) {
  const preflight = basePreflight(payload, invocation.model);
  preflight.endpointRuntimeSource = "gemini-cli-headless-probe";
  preflight.noGeneration = false;
  const prompt = "HiveRunner Gemini model preflight only. Do not inspect or edit files. Reply exactly: PREFLIGHT_OK";
  const result = await runGemini({
    ...invocation,
    args: replacePromptArg(invocation.args, prompt),
    cwd,
  });
  if (!result.error) {
    return {
      ...preflight,
      status: "passed",
      terminalErrorClass: null,
      benchmarkCellsAllowed: true,
      stdoutTail: trimForStorage(result.stdout),
      stderrTail: trimForStorage(result.stderr),
    };
  }
  return {
    ...preflight,
    status: "blocked",
    terminalErrorClass: classifyPreflightError({ message: result.error, stdout: result.stdout, stderr: result.stderr }),
    benchmarkCellsAllowed: false,
    stdoutTail: trimForStorage(result.stdout),
    stderrTail: trimForStorage(result.stderr || result.error),
  };
}

async function runPreflight(payload, invocation, cwd) {
  const preflight = basePreflight(payload, invocation.model);
  const packetRunId = benchmarkPacketRunId(payload);
  const runId = stringFrom(payload.runId);
  if (packetRunId && runId && packetRunId !== runId) {
    return {
      ...preflight,
      endpointRuntimeSource: "hiverunner-packet-run-id-guard",
      status: "blocked",
      terminalErrorClass: "stale_packet_run_id",
      benchmarkCellsAllowed: false,
      stderrTail: `Rejected stale packet_run_id before runtime probe; current runId is ${runId}.`,
    };
  }

  const mode = preflightMode();
  if (["off", "skip", "none"].includes(mode)) {
    return {
      ...preflight,
      endpointRuntimeSource: "disabled",
      status: "skipped",
      terminalErrorClass: null,
      benchmarkCellsAllowed: true,
    };
  }
  if (mode === "metadata-file") return metadataFilePreflight(payload, invocation.model);
  if (mode === "api") return apiPreflight(payload, invocation.model);
  return cliPreflight(payload, invocation, cwd);
}

function buildPrompt(payload) {
  return buildExternalRunnerPrompt(
    payload,
    "You are running as a Gemini CLI implementation of the HiveRunner external runner contract.",
  );
}

function resolvePayloadModel(payload) {
  return stringFrom(process.env.HIVERUNNER_GEMINI_MODEL) ||
    stringFrom(payload.runnerModel) ||
    DEFAULT_GEMINI_MODEL;
}

function buildGeminiInvocation(payload, prompt) {
  const commandParts = splitCommandLine(process.env.HIVERUNNER_GEMINI_COMMAND || "gemini");
  const command = commandParts[0] || "gemini";
  const commandPrefixArgs = commandParts.slice(1);
  const workspace = asRecord(payload.workspace) ?? {};
  const includeDirectories = Array.isArray(workspace.additionalWritableDirs)
    ? workspace.additionalWritableDirs.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const model = normalizeGeminiModel(resolvePayloadModel(payload));
  const approvalMode = stringFrom(process.env.HIVERUNNER_GEMINI_APPROVAL_MODE) || "yolo";
  const configuredArgs = process.env.HIVERUNNER_GEMINI_ARGS
    ? splitCommandLine(process.env.HIVERUNNER_GEMINI_ARGS)
    : [
        "--prompt",
        prompt,
        "--output-format",
        "text",
        "--approval-mode",
        approvalMode,
        "--model",
        model,
        ...includeDirectories.flatMap((includeDirectory) => ["--include-directories", includeDirectory]),
      ];

  return {
    command,
    args: [
      ...commandPrefixArgs,
      ...configuredArgs,
    ],
    model,
    approvalMode,
    includeDirectories,
  };
}

function runGemini({ command, args, cwd }) {
  const timeoutMs = numberFromEnv("HIVERUNNER_GEMINI_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const maxBufferBytes = numberFromEnv("HIVERUNNER_GEMINI_MAX_BUFFER", DEFAULT_MAX_BUFFER_BYTES);
  const noOutputTimeoutMs = numberFromEnv("HIVERUNNER_GEMINI_NO_OUTPUT_TIMEOUT_MS", DEFAULT_NO_OUTPUT_TIMEOUT_MS);
  const progressIntervalMs = numberFromEnv("HIVERUNNER_GEMINI_PROGRESS_INTERVAL_MS", DEFAULT_PROGRESS_INTERVAL_MS);
  const terminationGraceMs = numberFromEnv("HIVERUNNER_GEMINI_TERMINATION_GRACE_MS", DEFAULT_TERMINATION_GRACE_MS);
  const outputTracker = createGeminiOutputTracker();

  return runBufferedCommand({
    command,
    args,
    cwd,
    env: buildExternalRunnerEnv({
      HIVERUNNER_EXTERNAL_RUNNER: "1",
      HIVERUNNER_GEMINI_RUNNER: "1",
    }),
    timeoutMs,
    maxBufferBytes,
    noOutputTimeoutMs,
    progressIntervalMs,
    terminationGraceMs,
    describeTimeout: () => `Gemini command timed out after ${timeoutMs}ms`,
    describeNoOutputTimeout: () => `Gemini command produced no meaningful stdout/stderr for ${noOutputTimeoutMs}ms`,
    describeBufferLimit: () => `Gemini command exceeded ${maxBufferBytes} bytes of stdout`,
    describeExit: ({ exitCode, signal }) => `Gemini command exited with code ${exitCode}${signal ? ` (${signal})` : ""}`,
    isMeaningfulOutput: ({ stream, chunk }) => outputTracker.push(stream, chunk),
    onProgress: ({ durationMs, meaningfulSilentForMs, stdoutBytes, stderrBytes }) => {
      process.stderr.write(
        `[hiverunner-gemini-runner] Gemini still active after ${formatDuration(durationMs)}; ` +
        `${formatDuration(meaningfulSilentForMs)} since last meaningful stdout/stderr ` +
        `(${stdoutBytes} stdout bytes, ${stderrBytes} stderr bytes).\n`,
      );
    },
  }).then((result) => {
    outputTracker.flush();
    return result;
  });
}

function commandResultTelemetry(result) {
  return {
    timedOut: result.timedOut,
    noOutputTimedOut: result.noOutputTimedOut,
    killedForBuffer: result.killedForBuffer,
    forcedKilled: result.forcedKilled,
    recoveredNoOutputTimeout: result.noOutputTimedOut === true && result.exitCode === 0 && !result.error,
    terminationReason: result.error ? result.terminationReason : null,
    terminationSignalMethod: result.terminationSignalMethod,
    exitCode: result.exitCode,
    signal: result.signal,
    stdoutBytes: result.stdoutBytes,
    stderrBytes: result.stderrBytes,
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
  if (process.env.HIVERUNNER_GEMINI_DRY_RUN === "1" || process.env.HIVERUNNER_EXTERNAL_RUNNER_DRY_RUN === "1") {
    process.stdout.write(JSON.stringify({
      sessionId: `gemini-dry-run-${payload.runId ?? Date.now()}`,
      resultText: [
        "Gemini external runner dry run accepted the HiveRunner task payload.",
        "",
        "```mc-action",
        JSON.stringify({ action: "report", summary: "Gemini external runner dry run completed without launching Gemini CLI." }),
        "```",
      ].join("\n"),
      assistantSummary: "Gemini external runner dry run completed without launching Gemini CLI.",
      runnerProvider: "gemini",
      runnerModel: normalizeGeminiModel(resolvePayloadModel(payload)),
      transcriptEvents: [
        {
          role: "assistant",
          kind: "message",
          title: "Gemini external runner dry run",
          body: prompt,
        },
      ],
    }) + "\n");
    return;
  }

  const invocation = buildGeminiInvocation(payload, prompt);
  let preflight = null;
  if (shouldRunPreflight(payload, invocation.model)) {
    preflight = await runPreflight(payload, invocation, cwd);
    if (!preflight.benchmarkCellsAllowed) {
      process.stdout.write(JSON.stringify(preflightResultOutput(payload, preflight)) + "\n");
      return;
    }
  }
  if (shouldUseDirectApiGeneration(payload, preflight, invocation.model)) {
    const direct = await runDirectGeminiGeneration(prompt, invocation.model, preflight);
    const assistantSummary = direct.text || direct.rawResponse || direct.error || "";
    const usage = direct.usage ?? {};
    const costTelemetry = benchmarkCostTelemetry(payload, invocation.model, usage);
    process.stdout.write(JSON.stringify({
      sessionId: `gemini-direct-${payload.runId ?? Date.now()}`,
      resultText: preflight ? [preflightReport(preflight), assistantSummary].filter(Boolean).join("\n\n") : assistantSummary,
      assistantSummary: preflight ? `Preflight ${preflight.status}; ${assistantSummary}` : assistantSummary,
      error: direct.error ?? undefined,
      terminalErrorClass: direct.terminalErrorClass ?? undefined,
      runnerProvider: "gemini",
      runnerModel: invocation.model,
      preflight,
      directGeneration: direct.provenance,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      durationMs: direct.durationMs,
      transcriptEvents: [
        ...(preflight ? [{
          role: "assistant",
          kind: "provider_event",
          title: "Gemini benchmark model preflight",
          body: `Preflight ${preflight.status}; benchmark cells ${preflight.benchmarkCellsAllowed ? "allowed" : "blocked"}.`,
          metadata: preflight,
        }] : []),
        {
          role: "assistant",
          kind: direct.error ? "provider_error" : "message",
          title: "Google direct Gemini generation",
          body: assistantSummary,
          metadata: direct.provenance,
        },
      ],
      usage: {
        ...usage,
        runnerProvider: "gemini",
        runnerModel: invocation.model,
        preflight,
        directGeneration: direct.provenance,
        ...(costTelemetry ? { benchmarkCostTelemetry: costTelemetry } : {}),
      },
    }) + "\n");
    return;
  }
  const result = await runGemini({ ...invocation, cwd });
  const records = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseJsonLine)
    .filter(Boolean);
  const usage = collectUsage(records);
  const costTelemetry = benchmarkCostTelemetry(payload, invocation.model, usage);
  const commandTelemetry = commandResultTelemetry(result);
  const assistantSummary =
    records.map(extractText).filter(Boolean).at(-1) ||
    meaningfulPlainTextFromOutput(result.stdout) ||
    meaningfulPlainTextFromOutput(result.stderr) ||
    result.error ||
    "";

  process.stdout.write(JSON.stringify({
    sessionId: `gemini-${payload.runId ?? Date.now()}`,
    resultText: preflight ? [preflightReport(preflight), assistantSummary].filter(Boolean).join("\n\n") : assistantSummary,
    assistantSummary: preflight ? `Preflight ${preflight.status}; ${assistantSummary}` : assistantSummary,
    error: result.error ?? undefined,
    runnerProvider: "gemini",
    runnerModel: invocation.model,
    preflight,
    ...commandTelemetry,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    durationMs: result.durationMs,
    transcriptEvents: [
      ...(preflight ? [{
        role: "assistant",
        kind: "provider_event",
        title: "Gemini benchmark model preflight",
        body: `Preflight ${preflight.status}; benchmark cells ${preflight.benchmarkCellsAllowed ? "allowed" : "blocked"}.`,
        metadata: preflight,
      }] : []),
      ...collectTranscriptEvents(records, assistantSummary),
    ],
    usage: {
      ...usage,
      runnerProvider: "gemini",
      runnerModel: invocation.model,
      preflight,
      ...commandTelemetry,
      ...(costTelemetry ? { benchmarkCostTelemetry: costTelemetry } : {}),
    },
  }) + "\n");
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
    resultText: "",
    assistantSummary: "",
    runnerProvider: "gemini",
  }) + "\n");
});
