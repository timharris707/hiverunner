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

function writeFakeHermes(file: string) {
  writeFileSync(
    file,
    `#!${process.execPath}
const fs = require("fs");
const readline = require("readline");

fs.writeFileSync(process.env.FAKE_HERMES_CWD_FILE, process.cwd(), "utf8");
fs.writeFileSync(process.env.FAKE_HERMES_ARGS_FILE, process.argv.slice(2).join("\\n"), "utf8");

const rl = readline.createInterface({ input: process.stdin });

function send(value) {
  process.stdout.write(JSON.stringify(value) + "\\n");
}

function notify(sessionId, update) {
  send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } });
}

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } });
    return;
  }
  if (message.method === "session/new") {
    fs.writeFileSync(process.env.FAKE_HERMES_SESSION_PARAMS_FILE, JSON.stringify(message.params), "utf8");
    send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "hermes-fixture-session" } });
    return;
  }
  if (message.method === "session/set_model") {
    fs.writeFileSync(process.env.FAKE_HERMES_MODEL_FILE, message.params.modelId || "", "utf8");
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "session/prompt") {
    const text = message.params.prompt && message.params.prompt[0] ? message.params.prompt[0].text : "";
    fs.writeFileSync(process.env.FAKE_HERMES_PROMPT_FILE, text, "utf8");
    notify(message.params.sessionId, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "Plan the HERMES runner fixture." }
    });
    notify(message.params.sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: "tool-hermes-1",
      title: "terminal: echo fixture",
      kind: "execute"
    });
    notify(message.params.sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-hermes-1",
      status: "completed",
      rawOutput: "fixture output"
    });
    notify(message.params.sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: "Fixture HERMES completed the external runner task.\\n\\n" +
          "\`\`\`mc-action\\n" +
          JSON.stringify({ action: "update_task", taskKey: "INS-62", status: "review" }) +
          "\\n\`\`\`"
      }
    });
    notify(message.params.sessionId, {
      sessionUpdate: "usage_update",
      usage: { inputTokens: 31, outputTokens: 17, totalTokens: 54, thoughtTokens: 4, cachedReadTokens: 6 }
    });
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { stopReason: "end_turn", usage: { inputTokens: 31, outputTokens: 17, totalTokens: 54, thoughtTokens: 4, cachedReadTokens: 6 } }
    });
    setTimeout(() => process.exit(0), 10);
    return;
  }
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown method" } });
});
`,
    "utf8",
  );
  chmodSync(file, 0o755);
}

function run() {
  console.log("\nHiveRunner HERMES External Runner Tests\n");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "hiverunner-hermes-runner-test-"));
  try {
    const workspace = path.join(tempRoot, "workspace");
    const companyWorkspace = path.join(tempRoot, "company");
    const fakeHermes = path.join(tempRoot, "fake-hermes");
    const argsFile = path.join(tempRoot, "args.txt");
    const cwdFile = path.join(tempRoot, "cwd.txt");
    const modelFile = path.join(tempRoot, "model.txt");
    const promptFile = path.join(tempRoot, "prompt.txt");
    const sessionParamsFile = path.join(tempRoot, "session-params.json");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(companyWorkspace, { recursive: true });
    writeFakeHermes(fakeHermes);

    const payload = {
      schema: "hiverunner.symphony.execution.v1",
      runId: "run-hermes-fixture",
      runnerModel: "anthropic/claude-sonnet-4-6",
      task: {
        id: "task-id",
        key: "INS-62",
        title: "Add Hermes external runner wrapper",
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
      prompt: "Implement the HERMES runner wrapper.",
    };

    test("HERMES runner consumes the HiveRunner external runner contract", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-hermes-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_HERMES_COMMAND: fakeHermes,
          FAKE_HERMES_ARGS_FILE: argsFile,
          FAKE_HERMES_CWD_FILE: cwdFile,
          FAKE_HERMES_MODEL_FILE: modelFile,
          FAKE_HERMES_PROMPT_FILE: promptFile,
          FAKE_HERMES_SESSION_PARAMS_FILE: sessionParamsFile,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.strictEqual(output.sessionId, "hermes-fixture-session");
      assert.strictEqual(output.runnerProvider, "hermes");
      assert.strictEqual(output.runnerModel, "anthropic/claude-sonnet-4-6");
      assert.ok(String(output.resultText).includes("Fixture HERMES completed the external runner task."));
      assert.strictEqual(output.inputTokens, 31);
      assert.strictEqual(output.outputTokens, 17);
      assert.strictEqual(output.totalTokens, 54);
      assert.strictEqual(output.thoughtTokens, 4);
      assert.strictEqual(output.cacheReadTokens, 6);

      assert.strictEqual(realpathSync(readFileSync(cwdFile, "utf8")), realpathSync(workspace));
      assert.deepStrictEqual(readFileSync(argsFile, "utf8").split("\n"), ["acp"]);
      assert.strictEqual(readFileSync(modelFile, "utf8"), "anthropic/claude-sonnet-4-6");
      const sessionParams = JSON.parse(readFileSync(sessionParamsFile, "utf8")) as Record<string, unknown>;
      assert.strictEqual(sessionParams.cwd, workspace);
      assert.strictEqual(sessionParams.model, "anthropic/claude-sonnet-4-6");

      const prompt = readFileSync(promptFile, "utf8");
      assert.ok(prompt.includes("HiveRunner external runner contract"));
      assert.ok(prompt.includes("INS-62 - Add Hermes external runner wrapper"));
      assert.ok(prompt.includes("Trusted local runtime capabilities: playwright-video-recording"));
      assert.ok(prompt.includes("Additional writable directories:"));
      assert.ok(prompt.includes("Implement the HERMES runner wrapper."));
    });

    test("HERMES runner dry-run accepts default aliases without launching ACP", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-hermes-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify({ ...payload, runnerModel: "hermes/default" }),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_HERMES_COMMAND: fakeHermes,
          HIVERUNNER_HERMES_DRY_RUN: "1",
          FAKE_HERMES_ARGS_FILE: argsFile,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.strictEqual(output.runnerProvider, "hermes");
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
