import assert from "node:assert";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  pass ${name}`);
  } catch (error: unknown) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  fail ${name}`);
    console.error(`    ${message}`);
  }
}

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

function run() {
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

    test("Gemini runner consumes the HiveRunner external runner contract", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-gemini-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_GEMINI_COMMAND: fakeGemini,
          FAKE_GEMINI_ARGS_FILE: argsFile,
          FAKE_GEMINI_PROMPT_FILE: promptFile,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
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

    test("Gemini runner dry-run validates payload without launching Gemini CLI", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-gemini-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_GEMINI_COMMAND: fakeGemini,
          HIVERUNNER_GEMINI_DRY_RUN: "1",
          FAKE_GEMINI_ARGS_FILE: argsFile,
          FAKE_GEMINI_PROMPT_FILE: promptFile,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.strictEqual(output.runnerProvider, "gemini");
      assert.strictEqual(output.runnerModel, "gemini-3-pro-preview");
      assert.ok(String(output.resultText).includes("dry run accepted"));
    });

    test("Gemini runner ignores legacy task model-routing when a resolved runner model is present", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-gemini-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify({
          ...payload,
          runnerModel: "google/gemini-3-pro-preview",
          execution: {
            modelRouting: {
              model: "openai-codex/gpt-5.5",
            },
          },
        }),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_GEMINI_COMMAND: fakeGemini,
          HIVERUNNER_GEMINI_DRY_RUN: "1",
          FAKE_GEMINI_ARGS_FILE: argsFile,
          FAKE_GEMINI_PROMPT_FILE: promptFile,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.strictEqual(output.runnerModel, "gemini-3-pro-preview");
    });

    test("Gemini 3.5 Flash benchmark cells run through direct API after no-generation preflight", () => {
      rmSync(argsFile, { force: true });
      rmSync(promptFile, { force: true });
      rmSync(invocationsFile, { force: true });
      const result = spawnSync(process.execPath, ["scripts/hiverunner-gemini-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify({
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
        }),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_GEMINI_COMMAND: fakeGemini,
          HIVERUNNER_GEMINI_API_BASE_URL: fakeApi.baseUrl,
          GEMINI_API_KEY: "fixture-key",
          FAKE_GEMINI_ARGS_FILE: argsFile,
          FAKE_GEMINI_PROMPT_FILE: promptFile,
          FAKE_GEMINI_INVOCATIONS_FILE: invocationsFile,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
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

    test("Gemini benchmark preflight blocks model-not-found before launching benchmark cells", () => {
      rmSync(invocationsFile, { force: true });
      const result = spawnSync(process.execPath, ["scripts/hiverunner-gemini-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify({
          ...payload,
          runnerModel: "google/gemini-3.5-missing",
          benchmark: {
            candidateId: "gemini-3.5-missing",
            packetRunId: payload.runId,
            preflight: { required: true },
          },
        }),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_GEMINI_COMMAND: fakeGemini,
          HIVERUNNER_GEMINI_API_BASE_URL: fakeApi.baseUrl,
          GEMINI_API_KEY: "fixture-key",
          FAKE_GEMINI_ARGS_FILE: argsFile,
          FAKE_GEMINI_PROMPT_FILE: promptFile,
          FAKE_GEMINI_INVOCATIONS_FILE: invocationsFile,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
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

    test("Gemini benchmark preflight rejects stale packet_run_id rows before runtime access", () => {
      rmSync(invocationsFile, { force: true });
      const result = spawnSync(process.execPath, ["scripts/hiverunner-gemini-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify({
          ...payload,
          runnerModel: "google/gemini-3.5-flash",
          benchmark: {
            candidateId: "gemini-3.5-flash",
            packet_run_id: "stale-packet-run",
            preflight: { required: true },
          },
        }),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_GEMINI_COMMAND: fakeGemini,
          HIVERUNNER_GEMINI_PREFLIGHT_METADATA_FILE: accessibleMetadataFile,
          FAKE_GEMINI_ARGS_FILE: argsFile,
          FAKE_GEMINI_PROMPT_FILE: promptFile,
          FAKE_GEMINI_INVOCATIONS_FILE: invocationsFile,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
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

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
