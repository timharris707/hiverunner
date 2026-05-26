import assert from "node:assert";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

function writeFakeOpenClaw(file: string) {
  writeFileSync(
    file,
    `#!${process.execPath}
const fs = require("fs");

fs.writeFileSync(process.env.FAKE_OPENCLAW_CWD_FILE, process.cwd(), "utf8");
const args = process.argv.slice(2);
const method = args[2];
const paramsIndex = args.indexOf("--params");
const params = paramsIndex >= 0 ? JSON.parse(args[paramsIndex + 1]) : {};

const callsPath = process.env.FAKE_OPENCLAW_CALLS_FILE;
const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath, "utf8")) : [];
calls.push({ method, params, args });
fs.writeFileSync(callsPath, JSON.stringify(calls, null, 2), "utf8");

if (method === "sessions.create") {
  process.stdout.write(JSON.stringify({ ok: true, key: params.key, sessionId: "openclaw-fixture-session" }) + "\\n");
  process.exit(0);
}
if (method === "sessions.send") {
  process.stdout.write(JSON.stringify({ runId: "openclaw-fixture-run", status: "started" }) + "\\n");
  process.exit(0);
}
if (method === "sessions.get") {
  if (process.env.FAKE_OPENCLAW_FAILED === "1") {
    process.stdout.write(JSON.stringify({ status: "failed", messages: [] }) + "\\n");
    process.exit(0);
  }
  if (process.env.FAKE_OPENCLAW_NO_FINAL === "1") {
    process.stdout.write(JSON.stringify({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Fixture prompt" }],
          timestamp: 1778340000000
        }
      ]
    }) + "\\n");
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    status: "completed",
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "Fixture prompt" }],
        timestamp: 1778340000000
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "OpenClaw fixture final answer.\\n\\n\`\`\`mc-action\\n{\\\"action\\\":\\\"report\\\",\\\"summary\\\":\\\"OpenClaw final output imported.\\\"}\\n\`\`\`" }],
        provider: "openai-codex",
        model: "gpt-5.5",
        usage: { input: 10, output: 5, totalTokens: 15 },
        stopReason: "stop",
        responseId: "resp-openclaw-fixture",
        timestamp: 1778340000100
      }
    ]
  }) + "\\n");
  process.exit(0);
}
process.stderr.write("unknown method: " + method + "\\n");
process.exit(1);
`,
    "utf8",
  );
  chmodSync(file, 0o755);
}

function run() {
  console.log("\nHiveRunner OpenClaw External Runner Tests\n");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "hiverunner-openclaw-runner-test-"));
  try {
    const workspace = path.join(tempRoot, "workspace");
    const companyWorkspace = path.join(tempRoot, "company");
    const fakeOpenClaw = path.join(tempRoot, "fake-openclaw");
    const cwdFile = path.join(tempRoot, "cwd.txt");
    const callsFile = path.join(tempRoot, "calls.json");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(companyWorkspace, { recursive: true });
    writeFakeOpenClaw(fakeOpenClaw);

    const payload = {
      schema: "hiverunner.symphony.execution.v1",
      runId: "run-openclaw-fixture",
      task: {
        id: "task-id",
        key: "INS-63",
        title: "Add OpenClaw external runner wrapper",
        project: { name: "HiveRunner" },
        company: { name: "Insight" },
      },
      agent: {
        id: "agent-id",
        name: "Denise",
        role: "Integrations Engineer",
        openclawAgentId: "denise-openclaw",
      },
      workspace: {
        cwd: workspace,
        sourceWorkspaceRoot: workspace,
        companyWorkspaceRoot: companyWorkspace,
        additionalWritableDirs: [companyWorkspace],
        runtimeCapabilities: {
          trustedLocalExecution: true,
          capabilities: ["loopback-services"],
        },
      },
      prompt: "Implement the OpenClaw runner wrapper.",
    };

    test("OpenClaw runner consumes the HiveRunner external runner contract", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-openclaw-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_OPENCLAW_COMMAND: fakeOpenClaw,
          FAKE_OPENCLAW_CWD_FILE: cwdFile,
          FAKE_OPENCLAW_CALLS_FILE: callsFile,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.strictEqual(output.sessionId, "openclaw-fixture-session");
      assert.strictEqual(output.sessionKey && String(output.sessionKey).startsWith("external-runner:denise-openclaw:INS-63:"), true);
      assert.strictEqual(output.runnerProvider, "openclaw");
      assert.strictEqual(output.runnerModel, null);
      assert.ok(String(output.resultText).includes("OpenClaw fixture final answer."));

      assert.strictEqual(realpathSync(readFileSync(cwdFile, "utf8")), realpathSync(workspace));
      const calls = JSON.parse(readFileSync(callsFile, "utf8")) as Array<{ method: string; params: Record<string, string> }>;
      assert.deepStrictEqual(calls.map((call) => call.method), ["sessions.create", "sessions.send", "sessions.get"]);
      assert.strictEqual(calls[0].params.agentId, "denise-openclaw");
      assert.ok(calls[0].params.key.startsWith("external-runner:denise-openclaw:INS-63:"));
      assert.ok(calls[0].params.label.includes("INS-63"));
      assert.strictEqual(calls[1].params.key, calls[0].params.key);
      assert.strictEqual(calls[2].params.key, calls[0].params.key);
      assert.ok(calls[1].params.message.includes("HiveRunner external runner contract"));
      assert.ok(calls[1].params.message.includes("INS-63 - Add OpenClaw external runner wrapper"));
      assert.ok(calls[1].params.message.includes("Trusted local runtime capabilities: loopback-services"));
      assert.ok(calls[1].params.message.includes("Additional writable directories:"));
      assert.ok(calls[1].params.message.includes("Implement the OpenClaw runner wrapper."));
      const usage = output.usage as Record<string, unknown>;
      assert.strictEqual(usage.openclawStatus, "completed");
      assert.strictEqual(usage.openclawAcceptedStatus, "started");
      assert.strictEqual(usage.finalProvider, "openai-codex");
      assert.strictEqual(usage.finalModel, "gpt-5.5");
      assert.strictEqual(usage.inputTokens, 10);
      assert.strictEqual(usage.outputTokens, 5);
      assert.strictEqual(usage.totalTokens, 15);
      assert.strictEqual(usage.invocationMode, "gateway.sessions.create_send_poll_get");
      assert.ok(Array.isArray(output.transcriptEvents));
    });

    test("OpenClaw runner fails instead of completing when final output never arrives", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-openclaw-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_OPENCLAW_COMMAND: fakeOpenClaw,
          HIVERUNNER_OPENCLAW_FINAL_TIMEOUT_MS: "20",
          HIVERUNNER_OPENCLAW_FINAL_POLL_MS: "1",
          FAKE_OPENCLAW_NO_FINAL: "1",
          FAKE_OPENCLAW_CWD_FILE: cwdFile,
          FAKE_OPENCLAW_CALLS_FILE: callsFile,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.ok(String(output.error).includes("did not produce final assistant output"));
      assert.ok(String(output.resultText).includes("OpenClaw external runner failed"));
      const usage = output.usage as Record<string, unknown>;
      assert.strictEqual(usage.openclawStatus, "running");
      assert.strictEqual(usage.openclawAcceptedStatus, "started");
      assert.strictEqual(usage.invocationMode, "gateway.sessions.create_send_poll_get");
    });

    test("OpenClaw runner fails when the session monitor observes a failed terminal state", () => {
      writeFileSync(callsFile, "[]", "utf8");
      const result = spawnSync(process.execPath, ["scripts/hiverunner-openclaw-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_OPENCLAW_COMMAND: fakeOpenClaw,
          FAKE_OPENCLAW_FAILED: "1",
          FAKE_OPENCLAW_CWD_FILE: cwdFile,
          FAKE_OPENCLAW_CALLS_FILE: callsFile,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.ok(String(output.error).includes("OpenClaw session ended with status failed"));
      assert.ok(String(output.resultText).includes("OpenClaw external runner failed"));
      const usage = output.usage as Record<string, unknown>;
      assert.strictEqual(usage.openclawStatus, "failed");
      assert.strictEqual(usage.openclawAcceptedStatus, "started");
      const calls = JSON.parse(readFileSync(callsFile, "utf8")) as Array<{ method: string }>;
      assert.deepStrictEqual(calls.map((call) => call.method), ["sessions.create", "sessions.send", "sessions.get"]);
    });

    test("OpenClaw runner dry-run validates payload without launching gateway", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-openclaw-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_OPENCLAW_COMMAND: fakeOpenClaw,
          HIVERUNNER_OPENCLAW_DRY_RUN: "1",
          FAKE_OPENCLAW_CWD_FILE: cwdFile,
          FAKE_OPENCLAW_CALLS_FILE: callsFile,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.strictEqual(output.runnerProvider, "openclaw");
      assert.strictEqual(output.runnerModel, null);
      assert.ok(String(output.resultText).includes("dry run accepted"));
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
