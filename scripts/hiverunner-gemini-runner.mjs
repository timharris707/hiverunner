#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
const DEFAULT_PREFLIGHT_TIMEOUT_MS = 15 * 1000;
const PREFLIGHT_SCHEMA = "hiverunner.benchmark.model-preflight.v1";
const DIRECT_GENERATION_SCHEMA = "hiverunner.benchmark.google-direct-generation.v1";
const DEFAULT_GEMINI_MODEL = "gemini-3-pro-preview";
const RUNNER_VERSION = "hiverunner-gemini-runner 0.1.0";

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(RUNNER_VERSION);
  process.exit(0);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      body += chunk;
    });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => resolve(body));
  });
}

function splitCommandLine(value) {
  const parts = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|'([^']*)'|[^\s]+/g;
  let match;
  while ((match = pattern.exec(value)) !== null) {
    if (match[1] !== undefined) {
      parts.push(match[1].replace(/\\"/g, "\"").replace(/\\\\/g, "\\"));
    } else if (match[2] !== undefined) {
      parts.push(match[2]);
    } else {
      parts.push(match[0]);
    }
  }
  return parts;
}

function stringFrom(value) {
  return typeof value === "string" ? value.trim() : "";
}

function numberFromEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function numberFrom(value) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
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

function extractText(value) {
  if (typeof value === "string") return value;
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

  return Object.entries(record)
    .filter(([key]) => ["text", "content", "message", "response", "result", "output"].includes(key))
    .map(([, nested]) => extractText(nested))
    .filter(Boolean)
    .join("\n");
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
    const body = extractText(record);
    if (!body) continue;
    events.push({
      role: stringFrom(record.role) || "assistant",
      kind: stringFrom(record.type) || stringFrom(record.kind) || "message",
      title: "Gemini event",
      body,
    });
  }
  if (events.length === 0 && finalMessage) {
    events.push({
      role: "assistant",
      kind: "message",
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
  const task = asRecord(payload.task) ?? {};
  const project = asRecord(task.project) ?? {};
  const company = asRecord(task.company) ?? {};
  const workspace = asRecord(payload.workspace) ?? {};
  const runtimeCapabilities = asRecord(workspace.runtimeCapabilities) ?? {};
  const capabilities = Array.isArray(runtimeCapabilities.capabilities)
    ? runtimeCapabilities.capabilities.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const additionalWritableDirs = Array.isArray(workspace.additionalWritableDirs)
    ? workspace.additionalWritableDirs.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const context = [
    "You are running as a Gemini CLI implementation of the HiveRunner external runner contract.",
    "",
    `HiveRunner run ID: ${payload.runId ?? "unknown"}`,
    `Task: ${task.key ?? task.id ?? "unknown"} - ${task.title ?? "Untitled task"}`,
    `Project: ${project.name ?? project.slug ?? "unknown"}`,
    `Company: ${company.name ?? company.slug ?? company.code ?? "unknown"}`,
    `Source workspace for code changes and tests: ${workspace.sourceWorkspaceRoot ?? workspace.cwd ?? "unknown"}`,
    `Company workspace for HiveRunner artifacts: ${workspace.companyWorkspaceRoot ?? "unknown"}`,
    additionalWritableDirs.length > 0 ? `Additional writable directories: ${additionalWritableDirs.join(", ")}` : "",
    capabilities.length > 0 ? `Trusted local runtime capabilities: ${capabilities.join(", ")}` : "",
    runtimeCapabilities.trustedLocalExecution ? "This task is running in a trusted local HiveRunner runtime. Use local services and verification tools when the task requires them, and report any unavailable capability explicitly." : "",
    "",
    "HiveRunner is the source of truth for task state. If you need to update HiveRunner task state, include a fenced mc-action block in your final response.",
    "Make product code changes in the source workspace. Use the company workspace only for HiveRunner artifacts, notes, or task outputs when requested.",
  ].join("\n");

  return [context, stringFrom(payload.prompt)].filter(Boolean).join("\n\n");
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
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        HIVERUNNER_EXTERNAL_RUNNER: "1",
        HIVERUNNER_GEMINI_RUNNER: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let killedForBuffer = false;
    let spawnError = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= maxBufferBytes) stdoutChunks.push(chunk);
      if (stdoutBytes > maxBufferBytes && !killedForBuffer) {
        killedForBuffer = true;
        child.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= maxBufferBytes) stderrChunks.push(chunk);
    });
    child.on("error", (error) => {
      spawnError = error.message;
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const error =
        spawnError ??
        (timedOut ? `Gemini command timed out after ${timeoutMs}ms` : null) ??
        (killedForBuffer ? `Gemini command exceeded ${maxBufferBytes} bytes of stdout` : null) ??
        (exitCode === 0 ? null : `Gemini command exited with code ${exitCode}${signal ? ` (${signal})` : ""}`);
      resolve({
        stdout,
        stderr,
        exitCode,
        signal,
        error,
        durationMs: Date.now() - startedAt,
      });
    });
  });
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
  const assistantSummary =
    records.map(extractText).filter(Boolean).at(-1) ||
    result.stdout.trim() ||
    result.stderr.trim();

  process.stdout.write(JSON.stringify({
    sessionId: `gemini-${payload.runId ?? Date.now()}`,
    resultText: preflight ? [preflightReport(preflight), assistantSummary].filter(Boolean).join("\n\n") : assistantSummary,
    assistantSummary: preflight ? `Preflight ${preflight.status}; ${assistantSummary}` : assistantSummary,
    error: result.error ?? undefined,
    runnerProvider: "gemini",
    runnerModel: invocation.model,
    preflight,
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
