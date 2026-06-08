import assert from "node:assert";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { createTestRunner } from "./helpers/simple-test-runner";

const { finish, test } = createTestRunner({ passLabel: "pass", failLabel: "fail" });

type ExtraEnv = Record<string, string | undefined>;

function writeFakeGemini(file: string) {
  writeFileSync(
    file,
    `#!${process.execPath}
const fs = require("fs");
const args = process.argv.slice(2);
fs.writeFileSync(process.env.FAKE_GEMINI_ARGS_FILE, args.join("\\n"), "utf8");
const promptIndex = args.indexOf("--prompt");
const prompt = promptIndex >= 0 ? args[promptIndex + 1] || "" : "";
fs.writeFileSync(process.env.FAKE_GEMINI_PROMPT_FILE, prompt, "utf8");
if (process.env.FAKE_GEMINI_INVOCATIONS_FILE) {
  fs.appendFileSync(process.env.FAKE_GEMINI_INVOCATIONS_FILE, JSON.stringify({ args, prompt }) + "\\n", "utf8");
}
const delayMs = Number.parseInt(process.env.FAKE_GEMINI_DELAY_MS || "0", 10);
if (Number.isFinite(delayMs) && delayMs > 0) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}
if (process.env.FAKE_GEMINI_MODE === "spinner-sleep") {
  setInterval(() => {
    process.stdout.write("\\r- Generating");
  }, 25);
  setTimeout(() => process.stdout.write("too late\\n"), 60_000);
  return;
}
if (process.env.FAKE_GEMINI_MODE === "stderr-progress-sleep") {
  setInterval(() => {
    process.stderr.write("Still working...\\n");
  }, 25);
  setTimeout(() => process.stdout.write("too late\\n"), 60_000);
  return;
}
if (process.env.FAKE_GEMINI_MODE === "stderr-auth-chatter-sleep") {
  setInterval(() => {
    process.stderr.write("Using cached OAuth credentials for Gemini model access.\\n");
  }, 25);
  setTimeout(() => process.stdout.write("too late\\n"), 60_000);
  return;
}
if (process.env.FAKE_GEMINI_MODE === "json-live") {
  process.stdout.write(JSON.stringify({ type: "message", role: "assistant", text: "Gemini streamed a live update." }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "function_call", name: "npm test", args: { command: "npm test" } }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "function_response", name: "npm test", response: "tests passed" }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "response.completed",
    role: "assistant",
    text: "Gemini final summary.",
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 }
  }) + "\\n");
  return;
}
process.stdout.write("Fixture Gemini completed the external runner task.\\n");
`,
    "utf8",
  );
  chmodSync(file, 0o755);
}

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function startFakeGeminiApi(tempRoot: string) {
  const serverFile = path.join(tempRoot, "fake-gemini-api.cjs");
  const portFile = path.join(tempRoot, "fake-gemini-api-port.txt");
  const requestsFile = path.join(tempRoot, "fake-gemini-api-requests.jsonl");
  writeFileSync(
    serverFile,
    `const http = require("http");
const fs = require("fs");
const portFile = process.argv[2];
const requestsFile = process.argv[3];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    fs.appendFileSync(requestsFile, JSON.stringify({ method: req.method, url: req.url, body }) + "\\n", "utf8");
    if (req.method === "GET" && req.url.startsWith("/v1beta/models/gemini-3.5-flash")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ name: "models/gemini-3.5-flash", supportedGenerationMethods: ["generateContent"] }));
      return;
    }
    if (req.method === "GET" && req.url.startsWith("/v1beta/models/gemini-3.5-missing")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: 404, message: "Model not found: gemini-3.5-missing" } }));
      return;
    }
    if (req.method === "POST" && req.url.startsWith("/v1beta/models/gemini-3.5-flash:generateContent")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "Fixture Google direct API completed T1/T2/T5 smoke cell." }] } }],
        usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7, totalTokenCount: 18 }
      }));
      return;
    }
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Unexpected fake API request" } }));
  });
});
server.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(portFile, String(server.address().port), "utf8");
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`,
    "utf8",
  );
  const child = spawn(process.execPath, [serverFile, portFile, requestsFile], { stdio: "ignore" });
  for (let i = 0; i < 100; i += 1) {
    if (existsSync(portFile)) {
      const port = readFileSync(portFile, "utf8").trim();
      return {
        baseUrl: `http://127.0.0.1:${port}/v1beta`,
        requestsFile,
        stop: () => child.kill("SIGTERM"),
      };
    }
    sleepSync(25);
  }
  child.kill("SIGTERM");
  throw new Error("Fake Gemini API did not start");
}

async function run() {
  console.log("\nHiveRunner Gemini External Runner Tests\n");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "hiverunner-gemini-runner-test-"));
  try {
    const workspace = path.join(tempRoot, "workspace");
    const companyWorkspace = path.join(tempRoot, "company");
    const fakeGemini = path.join(tempRoot, "fake-gemini");
    const argsFile = path.join(tempRoot, "args.txt");
    const promptFile = path.join(tempRoot, "prompt.txt");
    const invocationsFile = path.join(tempRoot, "invocations.jsonl");
    const accessibleMetadataFile = path.join(tempRoot, "accessible-models.json");
    const missingMetadataFile = path.join(tempRoot, "missing-models.json");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(companyWorkspace, { recursive: true });
    writeFakeGemini(fakeGemini);
    const fakeApi = startFakeGeminiApi(tempRoot);
    writeFileSync(accessibleMetadataFile, JSON.stringify({ models: { "gemini-3.5-flash": { ok: true } } }), "utf8");
    writeFileSync(
      missingMetadataFile,
      JSON.stringify({ models: { "gemini-3.5-flash": { status: 404, message: "Model not found: gemini-3.5-flash" } } }),
      "utf8",
    );

    function runGeminiRunnerResult(inputPayload: unknown, extraEnv: ExtraEnv = {}) {
      return spawnSync(process.execPath, ["scripts/hiverunner-gemini-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify(inputPayload),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_GEMINI_COMMAND: fakeGemini,
          FAKE_GEMINI_ARGS_FILE: argsFile,
          FAKE_GEMINI_PROMPT_FILE: promptFile,
          ...extraEnv,
        },
      });
    }

    function runGeminiRunner(inputPayload: unknown, extraEnv: ExtraEnv = {}) {
      const result = runGeminiRunnerResult(inputPayload, extraEnv);

      assert.strictEqual(result.status, 0, result.stderr);
      return JSON.parse(result.stdout) as Record<string, unknown>;
    }

    const payload = {
      schema: "hiverunner.symphony.execution.v1",
      runId: "run-gemini-fixture",
      runnerModel: "google/gemini-3-pro-preview",
      task: {
        id: "task-id",
        key: "INS-61",
        title: "Add Gemini external runner wrapper",
        project: { name: "HiveRunner" },
        company: { name: "Insight" },
      },
      workspace: {
        cwd: workspace,
        sourceWorkspaceRoot: workspace,
        companyWorkspaceRoot: companyWorkspace,
        additionalWritableDirs: [companyWorkspace],
        runtimeCapabilities: {
          trustedLocalExecution: true,
          capabilities: ["playwright-video-recording"],
        },
      },
      prompt: "Implement the Gemini runner wrapper.",
    };

    await test("Gemini runner consumes the HiveRunner external runner contract", () => {
      const output = runGeminiRunner(payload);
      assert.strictEqual(output.sessionId, "gemini-run-gemini-fixture");
      assert.strictEqual(output.runnerProvider, "gemini");
      assert.strictEqual(output.runnerModel, "gemini-3-pro-preview");
      assert.strictEqual(output.resultText, "Fixture Gemini completed the external runner task.");

      const args = readFileSync(argsFile, "utf8").split("\n");
      assert.ok(args.includes("--prompt"));
      assert.ok(args.includes("--output-format"));
      assert.ok(args.includes("text"));
      assert.ok(args.includes("--approval-mode"));
      assert.ok(args.includes("yolo"));
      assert.ok(args.includes("--model"));
      assert.ok(args.includes("gemini-3-pro-preview"));
      assert.ok(args.includes("--include-directories"));
      assert.ok(args.includes(companyWorkspace));

      const prompt = readFileSync(promptFile, "utf8");
      assert.ok(prompt.includes("HiveRunner external runner contract"));
      assert.ok(prompt.includes("INS-61 - Add Gemini external runner wrapper"));
      assert.ok(prompt.includes("Trusted local runtime capabilities: playwright-video-recording"));
      assert.ok(prompt.includes("Additional writable directories:"));
      assert.ok(prompt.includes("Implement the Gemini runner wrapper."));
    });

    await test("Gemini runner dry-run validates payload without launching Gemini CLI", () => {
      const output = runGeminiRunner(payload, { HIVERUNNER_GEMINI_DRY_RUN: "1" });
      assert.strictEqual(output.runnerProvider, "gemini");
      assert.strictEqual(output.runnerModel, "gemini-3-pro-preview");
      assert.ok(String(output.resultText).includes("dry run accepted"));
    });

    await test("Gemini runner ignores legacy task model-routing when a resolved runner model is present", () => {
      const output = runGeminiRunner(
        {
          ...payload,
          runnerModel: "google/gemini-3-pro-preview",
          execution: {
            modelRouting: {
              model: "openai-codex/gpt-5.5",
            },
          },
        },
        { HIVERUNNER_GEMINI_DRY_RUN: "1" },
      );
      assert.strictEqual(output.runnerModel, "gemini-3-pro-preview");
    });

    await test("Gemini runner emits stderr progress without polluting final JSON stdout", () => {
      const output = runGeminiRunnerResult(payload, {
        FAKE_GEMINI_DELAY_MS: "90",
        HIVERUNNER_GEMINI_PROGRESS_INTERVAL_MS: "10",
      });

      assert.strictEqual(output.status, 0, output.stderr);
      assert.match(output.stderr, /\[hiverunner-gemini-runner\] Gemini still active after /);
      assert.match(output.stderr, /since last meaningful stdout\/stderr/);
      const parsed = JSON.parse(output.stdout) as Record<string, unknown>;
      assert.strictEqual(parsed.runnerProvider, "gemini");
      assert.strictEqual(parsed.resultText, "Fixture Gemini completed the external runner task.");
    });

    await test("Gemini runner does not count spinner-only stdout as meaningful activity", () => {
      const output = runGeminiRunnerResult(payload, {
        FAKE_GEMINI_MODE: "spinner-sleep",
        HIVERUNNER_GEMINI_TIMEOUT_MS: "5000",
        HIVERUNNER_GEMINI_NO_OUTPUT_TIMEOUT_MS: "120",
        HIVERUNNER_GEMINI_PROGRESS_INTERVAL_MS: "25",
        HIVERUNNER_GEMINI_TERMINATION_GRACE_MS: "25",
      });

      assert.strictEqual(output.status, 0, output.stderr || String(output.error));
      const parsed = JSON.parse(output.stdout) as Record<string, unknown>;
      assert.match(String(parsed.error), /no meaningful stdout\/stderr/i);
      assert.strictEqual(parsed.noOutputTimedOut, true);
      assert.strictEqual(parsed.timedOut, false);
      assert.strictEqual(parsed.terminationReason, "no_output_timeout");
      assert.ok(Number(parsed.durationMs) < 5000, `spinner-only subprocess should fail before full timeout, got ${String(parsed.durationMs)}ms`);
      assert.ok(Number(parsed.stdoutBytes) > 0, "spinner fixture should produce raw stdout bytes");
      assert.ok(!String(parsed.resultText).includes("Generating"), "spinner noise should not become result text");
      const usage = parsed.usage as Record<string, unknown>;
      assert.strictEqual(usage.noOutputTimedOut, true);
      assert.strictEqual(usage.terminationReason, "no_output_timeout");
      const liveLines = output.stderr
        .split(/\r?\n/)
        .filter((line) => line.startsWith("::hiverunner-live-event "));
      assert.strictEqual(liveLines.length, 0, "spinner-only output should not emit transcript live frames");
    });

    await test("Gemini runner does not count stderr progress chatter as meaningful activity", () => {
      const output = runGeminiRunnerResult(payload, {
        FAKE_GEMINI_MODE: "stderr-progress-sleep",
        HIVERUNNER_GEMINI_TIMEOUT_MS: "5000",
        HIVERUNNER_GEMINI_NO_OUTPUT_TIMEOUT_MS: "120",
        HIVERUNNER_GEMINI_PROGRESS_INTERVAL_MS: "25",
        HIVERUNNER_GEMINI_TERMINATION_GRACE_MS: "25",
      });

      assert.strictEqual(output.status, 0, output.stderr || String(output.error));
      const parsed = JSON.parse(output.stdout) as Record<string, unknown>;
      assert.match(String(parsed.error), /no meaningful stdout\/stderr/i);
      assert.strictEqual(parsed.noOutputTimedOut, true);
      assert.strictEqual(parsed.terminationReason, "no_output_timeout");
      assert.ok(Number(parsed.stderrBytes) > 0, "stderr progress fixture should produce raw stderr bytes");
      assert.ok(Number(parsed.durationMs) < 5000, `stderr progress should fail before full timeout, got ${String(parsed.durationMs)}ms`);
      const usage = parsed.usage as Record<string, unknown>;
      assert.strictEqual(usage.noOutputTimedOut, true);
    });

    await test("Gemini runner does not let credential chatter keep the CLI alive", () => {
      const output = runGeminiRunnerResult(payload, {
        FAKE_GEMINI_MODE: "stderr-auth-chatter-sleep",
        HIVERUNNER_GEMINI_TIMEOUT_MS: "5000",
        HIVERUNNER_GEMINI_NO_OUTPUT_TIMEOUT_MS: "120",
        HIVERUNNER_GEMINI_PROGRESS_INTERVAL_MS: "25",
        HIVERUNNER_GEMINI_TERMINATION_GRACE_MS: "25",
      });

      assert.strictEqual(output.status, 0, output.stderr || String(output.error));
      const parsed = JSON.parse(output.stdout) as Record<string, unknown>;
      assert.match(String(parsed.error), /no meaningful stdout\/stderr/i);
      assert.strictEqual(parsed.noOutputTimedOut, true);
      assert.strictEqual(parsed.terminationReason, "no_output_timeout");
      assert.ok(Number(parsed.stderrBytes) > 0, "credential chatter fixture should produce raw stderr bytes");
      assert.ok(Number(parsed.durationMs) < 5000, `credential chatter should fail before full timeout, got ${String(parsed.durationMs)}ms`);
      assert.ok(!String(parsed.resultText).includes("OAuth credentials"), "credential chatter should not become result text on timeout");
      const usage = parsed.usage as Record<string, unknown>;
      assert.strictEqual(usage.noOutputTimedOut, true);
    });

    await test("Gemini runner normalizes Gemini CLI JSON output into transcript and live events", () => {
      const output = runGeminiRunnerResult(payload, {
        FAKE_GEMINI_MODE: "json-live",
      });

      assert.strictEqual(output.status, 0, output.stderr || String(output.error));
      assert.ok(!output.stdout.includes("::hiverunner-live-event"), "live frames must stay out of final stdout JSON");
      const parsed = JSON.parse(output.stdout) as Record<string, unknown>;
      assert.strictEqual(parsed.runnerProvider, "gemini");
      assert.strictEqual(parsed.resultText, "Gemini final summary.");
      assert.strictEqual(parsed.inputTokens, 5);
      assert.strictEqual(parsed.outputTokens, 7);
      assert.strictEqual(parsed.totalTokens, 12);

      const liveEvents = output.stderr
        .split(/\r?\n/)
        .filter((line) => line.startsWith("::hiverunner-live-event "))
        .map((line) => JSON.parse(line.slice("::hiverunner-live-event ".length)) as Record<string, unknown>)
        .map((frame) => frame.event as Record<string, unknown>);
      assert.ok(liveEvents.some((event) => event.kind === "assistant_text_delta" && /live update/.test(String(event.body))));
      assert.ok(liveEvents.some((event) => event.kind === "tool_call_start" && event.title === "npm test"));
      assert.ok(liveEvents.some((event) => event.kind === "tool_result" && /tests passed/.test(String(event.body))));
      assert.ok(liveEvents.some((event) => event.kind === "assistant_text_final" && /final summary/.test(String(event.body))));

      const transcriptEvents = parsed.transcriptEvents as Array<Record<string, unknown>>;
      assert.ok(transcriptEvents.some((event) => event.kind === "assistant_text_delta"));
      assert.ok(transcriptEvents.some((event) => event.kind === "tool_call_start"));
      assert.ok(transcriptEvents.some((event) => event.kind === "tool_result"));
      assert.ok(transcriptEvents.some((event) => event.kind === "assistant_text_final"));
    });

    await test("Gemini 3.5 Flash benchmark cells run through direct API after no-generation preflight", () => {
      rmSync(argsFile, { force: true });
      rmSync(promptFile, { force: true });
      rmSync(invocationsFile, { force: true });
      const output = runGeminiRunner(
        {
          ...payload,
          runnerModel: "google/gemini-3.5-flash",
          benchmark: {
            candidateId: "gemini-3.5-flash",
            packetRunId: payload.runId,
            preflight: { required: true },
            harnessLocalPricing: {
              currency: "USD",
              unit: "per_1m_tokens",
              standard: { input: 1.5, output: 9 },
            },
          },
        },
        {
          HIVERUNNER_GEMINI_API_BASE_URL: fakeApi.baseUrl,
          GEMINI_API_KEY: "fixture-key",
          FAKE_GEMINI_INVOCATIONS_FILE: invocationsFile,
        },
      );
      assert.strictEqual(output.runnerProvider, "gemini");
      assert.strictEqual(output.runnerModel, "gemini-3.5-flash");
      const preflight = output.preflight as Record<string, unknown>;
      assert.strictEqual(preflight.status, "passed");
      assert.strictEqual(preflight.benchmarkCellsAllowed, true);
      assert.strictEqual(preflight.endpointRuntimeSource, "gemini-api-v1beta-models-get");
      assert.strictEqual(preflight.noGeneration, true);
      assert.strictEqual(preflight.modelId, "gemini-3.5-flash");
      const directGeneration = output.directGeneration as Record<string, unknown>;
      assert.strictEqual(directGeneration.endpointRuntimeSource, "gemini-api-v1beta-generateContent");
      assert.strictEqual(directGeneration.provider, "google");
      assert.strictEqual(directGeneration.runtimeProvider, "google-direct");
      assert.strictEqual(directGeneration.modelId, "gemini-3.5-flash");
      assert.strictEqual(directGeneration.noCli, true);
      assert.strictEqual(directGeneration.preflightEndpointRuntimeSource, "gemini-api-v1beta-models-get");
      const usage = output.usage as Record<string, unknown>;
      assert.strictEqual(usage.inputTokens, 11);
      assert.strictEqual(usage.outputTokens, 7);
      assert.strictEqual(usage.totalTokens, 18);
      const costTelemetry = usage.benchmarkCostTelemetry as Record<string, unknown>;
      assert.strictEqual(costTelemetry.schema, "hiverunner.benchmark.cost-telemetry.v1");
      assert.strictEqual(costTelemetry.costKind, "estimated");
      assert.strictEqual(costTelemetry.estimateSource, "benchmark_payload.harnessLocalPricing");
      assert.strictEqual(costTelemetry.inputUsdPerMillion, 1.5);
      assert.strictEqual(costTelemetry.outputUsdPerMillion, 9);
      assert.strictEqual(Number(costTelemetry.estimatedCostUsd), (11 / 1_000_000) * 1.5 + (7 / 1_000_000) * 9);
      assert.ok(String(output.resultText).includes("preflight passed"));
      assert.ok(String(output.resultText).includes("Fixture Google direct API completed T1/T2/T5 smoke cell."));
      assert.throws(() => readFileSync(invocationsFile, "utf8"), /ENOENT/, "direct API generation must not launch Gemini CLI");
      assert.throws(() => readFileSync(argsFile, "utf8"), /ENOENT/, "direct API generation must not prepare Gemini CLI args");
      const requests = readFileSync(fakeApi.requestsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      assert.ok(requests.some((request) => request.method === "GET" && request.url.startsWith("/v1beta/models/gemini-3.5-flash")));
      assert.ok(requests.some((request) => request.method === "POST" && request.url.startsWith("/v1beta/models/gemini-3.5-flash:generateContent")));
    });

    await test("Gemini benchmark preflight blocks model-not-found before launching benchmark cells", () => {
      rmSync(invocationsFile, { force: true });
      const output = runGeminiRunner(
        {
          ...payload,
          runnerModel: "google/gemini-3.5-missing",
          benchmark: {
            candidateId: "gemini-3.5-missing",
            packetRunId: payload.runId,
            preflight: { required: true },
          },
        },
        {
          HIVERUNNER_GEMINI_API_BASE_URL: fakeApi.baseUrl,
          GEMINI_API_KEY: "fixture-key",
          FAKE_GEMINI_INVOCATIONS_FILE: invocationsFile,
        },
      );
      const preflight = output.preflight as Record<string, unknown>;
      assert.strictEqual(output.runnerProvider, "gemini");
      assert.strictEqual(output.runnerModel, "gemini-3.5-missing");
      assert.strictEqual(preflight.status, "blocked");
      assert.strictEqual(preflight.terminalErrorClass, "model_not_found");
      assert.strictEqual(preflight.benchmarkCellsAllowed, false);
      assert.strictEqual(preflight.heartbeatRunId, payload.runId);
      assert.ok(String(preflight.stderrTail).includes("Model not found"));
      const usage = output.usage as Record<string, unknown>;
      const costTelemetry = usage.benchmarkCostTelemetry as Record<string, unknown>;
      assert.strictEqual(costTelemetry.costKind, "unavailable");
      assert.strictEqual(costTelemetry.unavailableReason, "provider_usage_tokens_unavailable");
      assert.ok(String(output.resultText).includes("preflight blocked"));
      assert.ok(String(output.resultText).includes("benchmark cells blocked"));
      assert.throws(() => readFileSync(invocationsFile, "utf8"), /ENOENT/, "blocked preflight must not launch a benchmark cell");
    });

    await test("Gemini benchmark preflight rejects stale packet_run_id rows before runtime access", () => {
      rmSync(invocationsFile, { force: true });
      const output = runGeminiRunner(
        {
          ...payload,
          runnerModel: "google/gemini-3.5-flash",
          benchmark: {
            candidateId: "gemini-3.5-flash",
            packet_run_id: "stale-packet-run",
            preflight: { required: true },
          },
        },
        {
          HIVERUNNER_GEMINI_PREFLIGHT_METADATA_FILE: accessibleMetadataFile,
          FAKE_GEMINI_INVOCATIONS_FILE: invocationsFile,
        },
      );
      const preflight = output.preflight as Record<string, unknown>;
      assert.strictEqual(preflight.status, "blocked");
      assert.strictEqual(preflight.terminalErrorClass, "stale_packet_run_id");
      assert.strictEqual(preflight.benchmarkCellsAllowed, false);
      assert.strictEqual(preflight.heartbeatRunId, payload.runId);
      assert.strictEqual(preflight.packetRunId, null);
      assert.ok(String(preflight.stderrTail).includes("current runId is run-gemini-fixture"));
      assert.ok(String(output.resultText).includes("terminalErrorClass=stale_packet_run_id"));
      assert.throws(() => readFileSync(invocationsFile, "utf8"), /ENOENT/, "stale packet rows must not launch a runtime probe or cell");
    });
    fakeApi.stop();
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  finish();
}

run();
