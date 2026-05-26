import assert from "node:assert";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function writeFakeClaude(file: string) {
  writeFileSync(
    file,
    `#!${process.execPath}
const fs = require("fs");
const args = process.argv.slice(2);
const prompt = fs.readFileSync(0, "utf8");
fs.writeFileSync(process.env.FAKE_CLAUDE_ARGS_FILE, args.join("\\n"), "utf8");
fs.writeFileSync(process.env.FAKE_CLAUDE_PROMPT_FILE, prompt, "utf8");
process.stdout.write(JSON.stringify({ type: "system", session_id: "claude-fixture-session" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "assistant", role: "assistant", message: { content: [{ type: "text", text: "Fixture Claude completed the external runner task." }] } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", result: "Fixture Claude completed the external runner task.", usage: { input_tokens: 21, output_tokens: 13, total_tokens: 34 } }) + "\\n");
`,
    "utf8",
  );
  chmodSync(file, 0o755);
}

function run() {
  console.log("\nHiveRunner Claude External Runner Tests\n");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "hiverunner-claude-runner-test-"));
  try {
    const workspace = path.join(tempRoot, "workspace");
    const fakeClaude = path.join(tempRoot, "fake-claude");
    const argsFile = path.join(tempRoot, "args.txt");
    const promptFile = path.join(tempRoot, "prompt.txt");
    mkdirSync(workspace, { recursive: true });
    writeFakeClaude(fakeClaude);

    const payload = {
      schema: "hiverunner.symphony.execution.v1",
      runId: "run-claude-fixture",
      runnerModel: "anthropic/claude-sonnet",
      task: {
        id: "task-id",
        key: "INS-53",
        title: "Select and stub the second non-Codex provider runner",
        project: { name: "HiveRunner" },
        company: { name: "Insight" },
      },
      workspace: {
        cwd: workspace,
        sourceWorkspaceRoot: workspace,
        companyWorkspaceRoot: path.join(tempRoot, "company"),
        additionalWritableDirs: [path.join(tempRoot, "company")],
        runtimeCapabilities: {
          trustedLocalExecution: true,
          capabilities: ["playwright-video-recording"],
        },
      },
      prompt: "Implement the Claude runner wrapper.",
    };

    test("Claude runner consumes the HiveRunner external runner contract", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-claude-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_CLAUDE_COMMAND: fakeClaude,
          FAKE_CLAUDE_ARGS_FILE: argsFile,
          FAKE_CLAUDE_PROMPT_FILE: promptFile,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.strictEqual(output.sessionId, "claude-fixture-session");
      assert.strictEqual(output.runnerProvider, "anthropic");
      assert.strictEqual(output.runnerModel, "claude-sonnet-4-6");
      assert.strictEqual(output.resultText, "Fixture Claude completed the external runner task.");
      assert.strictEqual(output.inputTokens, 21);
      assert.strictEqual(output.outputTokens, 13);
      assert.strictEqual(output.totalTokens, 34);

      const args = readFileSync(argsFile, "utf8").split("\n");
      assert.ok(args.includes("--permission-mode"));
      assert.ok(args.includes("bypassPermissions"));
      assert.ok(args.includes("--model"));
      assert.ok(args.includes("claude-sonnet-4-6"));
      assert.ok(args.includes("--output-format"));
      assert.ok(args.includes("stream-json"));

      const prompt = readFileSync(promptFile, "utf8");
      assert.ok(prompt.includes("HiveRunner external runner contract"));
      assert.ok(prompt.includes("INS-53 - Select and stub the second non-Codex provider runner"));
      assert.ok(prompt.includes("Trusted local runtime capabilities: playwright-video-recording"));
      assert.ok(prompt.includes("Additional writable directories:"));
      assert.ok(prompt.includes("Implement the Claude runner wrapper."));
    });

    test("Claude runner dry-run validates payload without launching Claude Code", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-claude-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_CLAUDE_COMMAND: fakeClaude,
          HIVERUNNER_CLAUDE_DRY_RUN: "1",
          FAKE_CLAUDE_ARGS_FILE: argsFile,
          FAKE_CLAUDE_PROMPT_FILE: promptFile,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.strictEqual(output.runnerProvider, "anthropic");
      assert.strictEqual(output.runnerModel, "claude-sonnet-4-6");
      assert.ok(String(output.resultText).includes("dry run accepted"));
    });

    test("Claude runner ignores legacy task model-routing when a resolved runner model is present", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-claude-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify({
          ...payload,
          runnerModel: "anthropic/claude-sonnet",
          execution: {
            modelRouting: {
              model: "openai-codex/gpt-5.5",
            },
          },
        }),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_CLAUDE_COMMAND: fakeClaude,
          HIVERUNNER_CLAUDE_DRY_RUN: "1",
          FAKE_CLAUDE_ARGS_FILE: argsFile,
          FAKE_CLAUDE_PROMPT_FILE: promptFile,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.strictEqual(output.runnerModel, "claude-sonnet-4-6");
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
