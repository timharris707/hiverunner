import assert from "node:assert";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { createTestRunner } from "./helpers/simple-test-runner";

const { finish, test } = createTestRunner({ passLabel: "pass", failLabel: "fail" });

type RunnerContractFixture = {
  case: string;
  description: string;
  valid: boolean;
  payload: Record<string, unknown>;
  response?: Record<string, unknown>;
  responseText?: string;
  expected?: {
    actionTypes?: string[];
    artifactKind?: string;
    error?: boolean;
    parseError?: boolean;
    status?: string;
    transcriptKinds?: string[];
  };
};

const FIXTURE_DIR = path.join(process.cwd(), "src", "lib", "__tests__", "fixtures", "hiverunner-symphony-runner-contract");
const REQUIRED_FIXTURE_CASES = [
  "artifact",
  "cancellation",
  "failure",
  "malformed-response",
  "success",
  "task-action",
  "tool-event",
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readContractFixtures(): RunnerContractFixture[] {
  return readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as RunnerContractFixture);
}

function parseResponseText(fixture: RunnerContractFixture): Record<string, unknown> | null {
  if (fixture.response) return fixture.response;
  if (!fixture.responseText) return null;
  try {
    return asRecord(JSON.parse(fixture.responseText));
  } catch {
    return null;
  }
}

function extractMcActions(text: string): Array<Record<string, unknown>> {
  const actions: Array<Record<string, unknown>> = [];
  const pattern = /```mc-action[^\n]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const parsed = JSON.parse(match[1].trim());
    const record = asRecord(parsed);
    assert.ok(record, "mc-action block must be a JSON object");
    actions.push(record);
  }
  return actions;
}

function validateRunnerPayload(fixture: RunnerContractFixture) {
  const payload = fixture.payload;
  assert.strictEqual(payload.schema, "hiverunner.symphony.execution.v1", `${fixture.case} payload schema`);
  assert.ok(stringValue(payload.runId), `${fixture.case} payload runId`);
  const task = asRecord(payload.task);
  assert.ok(task, `${fixture.case} payload task`);
  assert.ok(stringValue(task!.id), `${fixture.case} task id`);
  assert.ok(stringValue(task!.title), `${fixture.case} task title`);
  const workspace = asRecord(payload.workspace);
  assert.ok(workspace, `${fixture.case} payload workspace`);
  assert.ok(stringValue(workspace!.cwd), `${fixture.case} workspace cwd`);
  assert.ok(stringValue(payload.prompt), `${fixture.case} payload prompt`);
}

function validateAction(action: Record<string, unknown>, fixture: RunnerContractFixture) {
  assert.ok(stringValue(action.action), `${fixture.case} action type`);
  switch (action.action) {
    case "add_comment":
      assert.ok(stringValue(action.taskKey), `${fixture.case} add_comment taskKey`);
      assert.ok(stringValue(action.body), `${fixture.case} add_comment body`);
      break;
    case "update_task":
      assert.ok(stringValue(action.taskKey), `${fixture.case} update_task taskKey`);
      assert.ok(stringValue(action.status) || stringValue(action.comment), `${fixture.case} update_task status or comment`);
      break;
    case "register_artifact":
      assert.ok(stringValue(action.taskKey), `${fixture.case} register_artifact taskKey`);
      assert.ok(stringValue(action.uri), `${fixture.case} register_artifact uri`);
      if (action.sha256 !== undefined) {
        assert.match(stringValue(action.sha256), /^[a-f0-9]{64}$/i, `${fixture.case} register_artifact sha256`);
      }
      break;
    case "report":
      assert.ok(stringValue(action.summary), `${fixture.case} report summary`);
      break;
    default:
      assert.fail(`${fixture.case} includes unsupported fixture action '${String(action.action)}'`);
  }
}

function validateTranscriptEvents(response: Record<string, unknown>, fixture: RunnerContractFixture) {
  const events = response.transcriptEvents;
  if (events === undefined) return;
  if (!Array.isArray(events)) {
    assert.fail(`${fixture.case} transcriptEvents must be an array`);
  }
  for (const event of events) {
    const record = asRecord(event);
    assert.ok(record, `${fixture.case} transcript event must be an object`);
    assert.ok(stringValue(record!.kind), `${fixture.case} transcript event kind`);
    assert.ok(stringValue(record!.title), `${fixture.case} transcript event title`);
    assert.ok(stringValue(record!.body), `${fixture.case} transcript event body`);
  }
}

function validateRunnerResponse(fixture: RunnerContractFixture) {
  const response = parseResponseText(fixture);
  if (!fixture.valid) {
    assert.strictEqual(response, null, `${fixture.case} should not parse as a valid runner response`);
    assert.strictEqual(fixture.expected?.parseError, true, `${fixture.case} should declare parseError`);
    return;
  }

  assert.ok(response, `${fixture.case} response`);
  assert.ok(stringValue(response!.sessionId), `${fixture.case} response sessionId`);
  assert.strictEqual(typeof response!.resultText, "string", `${fixture.case} response resultText`);
  assert.ok(stringValue(response!.assistantSummary) || stringValue(response!.resultText), `${fixture.case} response summary or resultText`);
  if (fixture.expected?.error) {
    assert.ok(stringValue(response!.error), `${fixture.case} expected error`);
  } else {
    assert.strictEqual(response!.error, undefined, `${fixture.case} unexpected error`);
  }
  if (fixture.expected?.status) {
    assert.strictEqual(response!.status, fixture.expected.status, `${fixture.case} status`);
  }

  for (const tokenKey of ["inputTokens", "outputTokens", "totalTokens"] as const) {
    if (response![tokenKey] !== undefined) {
      assert.strictEqual(typeof response![tokenKey], "number", `${fixture.case} ${tokenKey}`);
      assert.ok((response![tokenKey] as number) >= 0, `${fixture.case} ${tokenKey} must be non-negative`);
    }
  }
  if (
    typeof response!.inputTokens === "number" &&
    typeof response!.outputTokens === "number" &&
    typeof response!.totalTokens === "number"
  ) {
    assert.strictEqual(response!.totalTokens, response!.inputTokens + response!.outputTokens, `${fixture.case} totalTokens`);
  }

  validateTranscriptEvents(response!, fixture);
  const actions = extractMcActions(stringValue(response!.resultText));
  for (const action of actions) validateAction(action, fixture);
  if (fixture.expected?.actionTypes) {
    assert.deepStrictEqual(actions.map((action) => action.action), fixture.expected.actionTypes, `${fixture.case} action types`);
  }
  if (fixture.expected?.artifactKind) {
    const artifact = actions.find((action) => action.action === "register_artifact");
    assert.ok(artifact, `${fixture.case} expected register_artifact action`);
    assert.strictEqual(artifact!.kind, fixture.expected.artifactKind, `${fixture.case} artifact kind`);
  }
  if (fixture.expected?.transcriptKinds) {
    const events = response!.transcriptEvents as Array<{ kind: string }> | undefined;
    assert.ok(events, `${fixture.case} expected transcript events`);
    assert.deepStrictEqual(events!.map((event) => event.kind), fixture.expected.transcriptKinds, `${fixture.case} transcript kinds`);
  }
}

function writeFakeCodex(file: string) {
  writeFileSync(
    file,
    `#!${process.execPath}
const fs = require("fs");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("-o");
const outputFile = outputIndex >= 0 ? args[outputIndex + 1] : null;
const prompt = fs.readFileSync(0, "utf8");
fs.writeFileSync(process.env.FAKE_CODEX_ARGS_FILE, args.join("\\n"), "utf8");
fs.writeFileSync(process.env.FAKE_CODEX_PROMPT_FILE, prompt, "utf8");
if (process.env.FAKE_CODEX_ENV_FILE) {
  fs.writeFileSync(process.env.FAKE_CODEX_ENV_FILE, JSON.stringify({
    HIVERUNNER_SYMPHONY_RUNNER: process.env.HIVERUNNER_SYMPHONY_RUNNER || null,
    MC_DATA_DIR: process.env.MC_DATA_DIR || null,
    MC_ENGINE_TICK: process.env.MC_ENGINE_TICK || null,
    MC_WORKSPACE_ROOT: process.env.MC_WORKSPACE_ROOT || null,
    ORCHESTRATION_DB_PATH: process.env.ORCHESTRATION_DB_PATH || null,
    PORT: process.env.PORT || null,
  }), "utf8");
}
if (process.env.FAKE_CODEX_PID_FILE) {
  fs.writeFileSync(process.env.FAKE_CODEX_PID_FILE, String(process.pid), "utf8");
}
if (process.env.FAKE_CODEX_MODE === "silent-sleep") {
  setTimeout(() => {}, 60_000);
  return;
}
if (process.env.FAKE_CODEX_MODE === "record-sigterm-sleep") {
  process.on("SIGTERM", () => {
    fs.writeFileSync(process.env.FAKE_CODEX_TERM_FILE, "SIGTERM", "utf8");
    process.exit(0);
  });
  setInterval(() => {}, 1_000);
  return;
}
if (process.env.FAKE_CODEX_MODE === "sigterm-success-after-silence") {
  process.on("SIGTERM", () => {
    if (outputFile) {
      fs.writeFileSync(outputFile, "Fixture Codex completed after a delayed graceful exit.", "utf8");
    }
    process.stdout.write(JSON.stringify({ type: "session", session_id: "fixture-recovered-session" }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "message", role: "assistant", message: "Fixture Codex completed after a delayed graceful exit." }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "usage", input_tokens: 4, output_tokens: 6, total_tokens: 10 }) + "\\n");
    process.exit(0);
  });
  setTimeout(() => {}, 60_000);
  return;
}
if (process.env.FAKE_CODEX_MODE === "streaming-progress") {
  process.stdout.write(JSON.stringify({ type: "session", session_id: "fixture-stream-session" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "message", role: "assistant", message: "Fixture Codex streamed an early progress update." }) + "\\n");
  setTimeout(() => {
    if (outputFile) {
      fs.writeFileSync(outputFile, "Fixture Codex completed after streaming progress.", "utf8");
    }
    process.stdout.write(JSON.stringify({ type: "usage", input_tokens: 3, output_tokens: 5, total_tokens: 8 }) + "\\n");
  }, 80);
  return;
}
if (process.env.FAKE_CODEX_MODE === "current-jsonl-shape") {
  if (outputFile) {
    fs.writeFileSync(outputFile, "Current Codex JSONL final message.", "utf8");
  }
  process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "fixture-current-thread" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "turn.started" }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "item.started",
    item: { id: "cmd-1", type: "command_execution", command: "npm test" },
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "item.completed",
    item: { id: "cmd-1", type: "command_execution", command: "npm test", aggregated_output: "tests passed" },
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "item.completed",
    item: { id: "msg-1", type: "agent_message", text: "Current Codex JSONL produced nested assistant text." },
  }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 7, output_tokens: 9, total_tokens: 16, reasoning_output_tokens: 3 } }) + "\\n");
  return;
}
if (process.env.FAKE_CODEX_MODE === "nested-usage-shape") {
  if (outputFile) {
    fs.writeFileSync(outputFile, "Nested usage final message.", "utf8");
  }
  process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "fixture-nested-usage-thread" }) + "\\n");
  process.stdout.write(JSON.stringify({
    type: "turn.completed",
    event: {
      message: {
        usage: {
          input_tokens: 21,
          output_tokens: 13,
          cache_read_input_tokens: 8,
          total_tokens: 34
        }
      }
    }
  }) + "\\n");
  return;
}
if (outputFile) {
  fs.writeFileSync(outputFile, "Fixture Codex completed the external runner task.", "utf8");
}
process.stdout.write(JSON.stringify({ type: "session", session_id: "fixture-session" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "message", role: "assistant", message: "Fixture Codex completed the external runner task." }) + "\\n");
process.stdout.write(JSON.stringify({ type: "usage", input_tokens: 13, output_tokens: 8, total_tokens: 21 }) + "\\n");
`,
    "utf8",
  );
  chmodSync(file, 0o755);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs: number, description: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await wait(25);
  }
  assert.fail(`Timed out waiting for ${description}`);
}

function waitForChildExit(child: ReturnType<typeof spawn>, timeoutMs: number) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Timed out waiting for child process exit"));
    }, timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function run() {
  console.log("\nHiveRunner External Runner Tests\n");

  await test("runner contract fixtures cover and validate expected response classes", () => {
    const fixtures = readContractFixtures();
    assert.deepStrictEqual(fixtures.map((fixture) => fixture.case), REQUIRED_FIXTURE_CASES);
    for (const fixture of fixtures) {
      assert.ok(fixture.description, `${fixture.case} description`);
      validateRunnerPayload(fixture);
      validateRunnerResponse(fixture);
    }
  });

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "hiverunner-symphony-runner-test-"));
  try {
    const workspace = path.join(tempRoot, "workspace");
    const fakeCodex = path.join(tempRoot, "fake-codex");
    const argsFile = path.join(tempRoot, "args.txt");
    const promptFile = path.join(tempRoot, "prompt.txt");
    const envFile = path.join(tempRoot, "env.json");
    const codexHome = path.join(tempRoot, "codex-home");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(path.join(codexHome, "config.toml"), 'model = "gpt-5.5"\n', "utf8");
    writeFakeCodex(fakeCodex);

    const payload = {
      schema: "hiverunner.symphony.execution.v1",
      runId: "run-fixture",
      task: {
        id: "task-id",
        key: "INS-1",
        title: "Run fixture task",
        project: { name: "Fixture Project" },
        company: { name: "Insight" },
      },
      workspace: { cwd: workspace },
      prompt: "Implement the fixture task.",
    };

    await test("runner converts HiveRunner payload into a Codex exec invocation", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-symphony-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_SYMPHONY_CODEX_COMMAND: fakeCodex,
          HIVERUNNER_SYMPHONY_MODEL: "",
          ORCHESTRATION_DB_PATH: path.join(tempRoot, "control.db"),
          MC_DATA_DIR: path.join(tempRoot, "data"),
          MC_ENGINE_TICK: "on",
          MC_WORKSPACE_ROOT: path.join(tempRoot, "control-workspace"),
          PORT: "3021",
          FAKE_CODEX_ARGS_FILE: argsFile,
          FAKE_CODEX_PROMPT_FILE: promptFile,
          FAKE_CODEX_ENV_FILE: envFile,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.strictEqual(output.sessionId, "fixture-session");
      assert.strictEqual(output.resultText, "Fixture Codex completed the external runner task.");
      assert.strictEqual(output.inputTokens, 13);
      assert.strictEqual(output.outputTokens, 8);
      assert.strictEqual(output.totalTokens, 21);

      const args = readFileSync(argsFile, "utf8").split("\n");
      assert.ok(args.includes("exec"));
      assert.ok(args.includes("--json"));
      assert.ok(args.includes("-C"));
      assert.ok(args.includes(workspace));
      assert.ok(args.includes("-o"));
      assert.strictEqual(args.at(-1), "-");

      const prompt = readFileSync(promptFile, "utf8");
      assert.ok(prompt.includes("external execution runner"));
      assert.ok(prompt.includes("Symphony-compatible task handoff"));
      assert.ok(prompt.includes("INS-1 - Run fixture task"));
      assert.ok(prompt.includes("Implement the fixture task."));

      const childEnv = JSON.parse(readFileSync(envFile, "utf8")) as Record<string, unknown>;
      assert.strictEqual(childEnv.HIVERUNNER_SYMPHONY_RUNNER, "1");
      assert.strictEqual(childEnv.ORCHESTRATION_DB_PATH, null);
      assert.strictEqual(childEnv.MC_DATA_DIR, null);
      assert.strictEqual(childEnv.MC_ENGINE_TICK, null);
      assert.strictEqual(childEnv.MC_WORKSPACE_ROOT, null);
      assert.strictEqual(childEnv.PORT, null);
    });

    await test("runner terminates a silent Codex subprocess with a no-output diagnostic", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-symphony-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify(payload),
        encoding: "utf8",
        timeout: 5000,
        env: {
          ...process.env,
          HIVERUNNER_SYMPHONY_CODEX_COMMAND: fakeCodex,
          HIVERUNNER_SYMPHONY_MODEL: "",
          HIVERUNNER_SYMPHONY_TIMEOUT_MS: "5000",
          HIVERUNNER_SYMPHONY_CODEX_NO_OUTPUT_TIMEOUT_MS: "120",
          HIVERUNNER_SYMPHONY_CODEX_PROGRESS_INTERVAL_MS: "25",
          HIVERUNNER_SYMPHONY_CODEX_TERMINATION_GRACE_MS: "25",
          FAKE_CODEX_ARGS_FILE: argsFile,
          FAKE_CODEX_PROMPT_FILE: promptFile,
          FAKE_CODEX_MODE: "silent-sleep",
        },
      });

      assert.strictEqual(result.status, 0, result.stderr || String(result.error));
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.match(String(output.error), /produced no stdout\/stderr/i);
      assert.strictEqual(output.noOutputTimedOut, true);
      assert.strictEqual(output.timedOut, false);
      assert.strictEqual(output.terminationReason, "no_output_timeout");
      assert.ok(Number(output.durationMs) < 5000, `silent subprocess should fail before spawnSync timeout, got ${String(output.durationMs)}ms`);
      assert.match(result.stderr, /Codex still active/);

      const usage = output.usage as Record<string, unknown>;
      assert.strictEqual(usage.noOutputTimedOut, true);
      assert.strictEqual(usage.terminationReason, "no_output_timeout");
      const prompt = readFileSync(promptFile, "utf8");
      assert.ok(prompt.includes("Implement the fixture task."));
    });

    await test("runner propagates parent SIGTERM to the Codex subprocess tree", async () => {
      const pidFile = path.join(tempRoot, "codex-child.pid");
      const termFile = path.join(tempRoot, "codex-child.term");
      const child = spawn(process.execPath, ["scripts/hiverunner-symphony-runner.mjs"], {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          HIVERUNNER_SYMPHONY_CODEX_COMMAND: fakeCodex,
          HIVERUNNER_SYMPHONY_MODEL: "",
          HIVERUNNER_SYMPHONY_CODEX_TERMINATION_GRACE_MS: "100",
          FAKE_CODEX_ARGS_FILE: argsFile,
          FAKE_CODEX_PROMPT_FILE: promptFile,
          FAKE_CODEX_MODE: "record-sigterm-sleep",
          FAKE_CODEX_PID_FILE: pidFile,
          FAKE_CODEX_TERM_FILE: termFile,
        },
      });
      let stderr = "";
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk) => {
        stderr += chunk;
      });
      child.stdin.end(JSON.stringify(payload));

      try {
        await waitFor(() => existsSync(pidFile), 1_000, "fake Codex pid file");
        const childPid = Number.parseInt(readFileSync(pidFile, "utf8"), 10);
        assert.ok(Number.isFinite(childPid) && childPid > 0, "fake Codex pid should be recorded");
        process.kill(child.pid!, "SIGTERM");
        const exit = await waitForChildExit(child, 3_000);
        assert.strictEqual(exit.code, 143, stderr);
        assert.strictEqual(exit.signal, null);
        await waitFor(() => existsSync(termFile), 1_000, "fake Codex SIGTERM marker");
        assert.strictEqual(readFileSync(termFile, "utf8"), "SIGTERM");
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
    });

    await test("runner treats a clean child exit with final output as recovered from no-output", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-symphony-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify(payload),
        encoding: "utf8",
        timeout: 5000,
        env: {
          ...process.env,
          HIVERUNNER_SYMPHONY_CODEX_COMMAND: fakeCodex,
          HIVERUNNER_SYMPHONY_MODEL: "",
          HIVERUNNER_SYMPHONY_TIMEOUT_MS: "5000",
          HIVERUNNER_SYMPHONY_CODEX_NO_OUTPUT_TIMEOUT_MS: "120",
          HIVERUNNER_SYMPHONY_CODEX_PROGRESS_INTERVAL_MS: "25",
          HIVERUNNER_SYMPHONY_CODEX_TERMINATION_GRACE_MS: "1000",
          FAKE_CODEX_ARGS_FILE: argsFile,
          FAKE_CODEX_PROMPT_FILE: promptFile,
          FAKE_CODEX_MODE: "sigterm-success-after-silence",
        },
      });

      assert.strictEqual(result.status, 0, result.stderr || String(result.error));
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.strictEqual(output.error, undefined);
      assert.strictEqual(output.sessionId, "fixture-recovered-session");
      assert.strictEqual(output.resultText, "Fixture Codex completed after a delayed graceful exit.");
      assert.strictEqual(output.noOutputTimedOut, false);
      assert.strictEqual(output.recoveredNoOutputTimeout, true);
      assert.strictEqual(output.terminationReason, null);
      assert.strictEqual(output.exitCode, 0);
      assert.strictEqual(output.signal, null);
      assert.ok(Number(output.stdoutBytes) > 0);

      const usage = output.usage as Record<string, unknown>;
      assert.strictEqual(usage.noOutputTimedOut, false);
      assert.strictEqual(usage.recoveredNoOutputTimeout, true);
      assert.strictEqual(usage.exitCode, 0);
    });

    await test("runner forwards live Codex stdout events without polluting final JSON stdout", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-symphony-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_SYMPHONY_CODEX_COMMAND: fakeCodex,
          HIVERUNNER_SYMPHONY_MODEL: "",
          FAKE_CODEX_ARGS_FILE: argsFile,
          FAKE_CODEX_PROMPT_FILE: promptFile,
          FAKE_CODEX_MODE: "streaming-progress",
        },
      });

      assert.strictEqual(result.status, 0, result.stderr || String(result.error));
      assert.ok(!result.stdout.includes("::hiverunner-live-event"), "live frames must stay out of final stdout JSON");
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.strictEqual(output.sessionId, "fixture-stream-session");
      assert.strictEqual(output.resultText, "Fixture Codex completed after streaming progress.");
      assert.strictEqual(output.totalTokens, 8);

      const liveLines = result.stderr
        .split(/\r?\n/)
        .filter((line) => line.startsWith("::hiverunner-live-event "));
      assert.ok(liveLines.length >= 2, `expected live event frames on stderr, got ${result.stderr}`);
      const assistantFrame = liveLines
        .map((line) => JSON.parse(line.slice("::hiverunner-live-event ".length)) as Record<string, unknown>)
        .map((frame) => frame.event as Record<string, unknown>)
        .find((event) => event.kind === "assistant_text_delta");
      assert.ok(assistantFrame, "expected an assistant_text_delta live frame");
      assert.match(String(assistantFrame!.body), /early progress update/);
    });

    await test("runner normalizes current Codex exec JSONL item events into live frames", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-symphony-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_SYMPHONY_CODEX_COMMAND: fakeCodex,
          HIVERUNNER_SYMPHONY_MODEL: "",
          FAKE_CODEX_ARGS_FILE: argsFile,
          FAKE_CODEX_PROMPT_FILE: promptFile,
          FAKE_CODEX_MODE: "current-jsonl-shape",
        },
      });

      assert.strictEqual(result.status, 0, result.stderr || String(result.error));
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.strictEqual(output.sessionId, "fixture-current-thread");
      assert.strictEqual(output.resultText, "Current Codex JSONL final message.");
      assert.strictEqual(output.inputTokens, 7);
      assert.strictEqual(output.outputTokens, 9);
      assert.strictEqual(output.totalTokens, 16);

      const liveEvents = result.stderr
        .split(/\r?\n/)
        .filter((line) => line.startsWith("::hiverunner-live-event "))
        .map((line) => JSON.parse(line.slice("::hiverunner-live-event ".length)) as Record<string, unknown>)
        .map((frame) => frame.event as Record<string, unknown>);
      assert.ok(liveEvents.some((event) => event.kind === "provider_event" && event.title === "Codex session started"));
      assert.ok(liveEvents.some((event) => event.kind === "tool_call_start" && event.title === "npm test"));
      assert.ok(liveEvents.some((event) => event.kind === "tool_result" && /tests passed/.test(String(event.body))));
      assert.ok(liveEvents.some((event) => event.kind === "assistant_text_final" && /nested assistant text/.test(String(event.body))));

      const transcriptEvents = output.transcriptEvents as Array<Record<string, unknown>>;
      assert.ok(transcriptEvents.some((event) => event.kind === "tool_call_start"));
      assert.ok(transcriptEvents.some((event) => event.kind === "tool_result"));
      assert.ok(transcriptEvents.some((event) => event.kind === "assistant_text_final"));
    });

    await test("runner extracts usage from nested Codex JSONL envelopes", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-symphony-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_SYMPHONY_CODEX_COMMAND: fakeCodex,
          HIVERUNNER_SYMPHONY_MODEL: "",
          FAKE_CODEX_ARGS_FILE: argsFile,
          FAKE_CODEX_PROMPT_FILE: promptFile,
          FAKE_CODEX_MODE: "nested-usage-shape",
        },
      });

      assert.strictEqual(result.status, 0, result.stderr || String(result.error));
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.strictEqual(output.sessionId, "fixture-nested-usage-thread");
      assert.strictEqual(output.inputTokens, 21);
      assert.strictEqual(output.outputTokens, 13);
      assert.strictEqual(output.cacheReadInputTokens, 8);
      assert.strictEqual(output.totalTokens, 34);
    });

    await test("runner reports the Codex configured default when the CLI owns model selection", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-symphony-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
          HIVERUNNER_SYMPHONY_CODEX_COMMAND: fakeCodex,
          HIVERUNNER_SYMPHONY_MODEL: "",
          FAKE_CODEX_ARGS_FILE: argsFile,
          FAKE_CODEX_PROMPT_FILE: promptFile,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      const usage = output.usage as Record<string, unknown>;
      assert.strictEqual(output.runnerProvider, "codex");
      assert.strictEqual(output.runnerModel, "gpt-5.5");
      assert.strictEqual(usage.runnerModel, "gpt-5.5");
      assert.strictEqual(usage.model, "gpt-5.5");

      const args = readFileSync(argsFile, "utf8").split("\n");
      assert.ok(!args.includes("--model"), `runtime-managed Codex should let the CLI select its configured default, got ${args.join(" ")}`);
    });

    await test("runner includes trusted local runtime capabilities in the Codex prompt", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-symphony-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify({
          ...payload,
          workspace: {
            cwd: workspace,
            runtimeCapabilities: {
              trustedLocalExecution: true,
              capabilities: ["docker", "local-postgres", "loopback-services", "playwright-video-recording"],
            },
          },
        }),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_SYMPHONY_CODEX_COMMAND: fakeCodex,
          HIVERUNNER_SYMPHONY_MODEL: "",
          FAKE_CODEX_ARGS_FILE: argsFile,
          FAKE_CODEX_PROMPT_FILE: promptFile,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const prompt = readFileSync(promptFile, "utf8");
      assert.ok(prompt.includes("Trusted local runtime capabilities: docker, local-postgres, loopback-services, playwright-video-recording"));
      assert.ok(prompt.includes("trusted local HiveRunner runtime"));
    });

    await test("runner strips provider prefixes from Codex model env before invoking the CLI", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-symphony-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_SYMPHONY_CODEX_COMMAND: fakeCodex,
          HIVERUNNER_SYMPHONY_MODEL: "openai-codex/gpt-5.4-mini",
          FAKE_CODEX_ARGS_FILE: argsFile,
          FAKE_CODEX_PROMPT_FILE: promptFile,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const args = readFileSync(argsFile, "utf8").split("\n");
      const modelIndex = args.indexOf("--model");
      assert.ok(modelIndex >= 0, "Codex model flag should be present for explicit non-default models");
      assert.strictEqual(args[modelIndex + 1], "gpt-5.4-mini");
      assert.ok(!args.includes("openai-codex/gpt-5.4-mini"));
    });

    await test("runner omits Codex model flag for default aliases so the CLI can use its account default", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-symphony-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify({
          ...payload,
          execution: {
            modelRouting: {
              model: "openai-codex/gpt-5.5",
            },
          },
        }),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_SYMPHONY_CODEX_COMMAND: fakeCodex,
          HIVERUNNER_SYMPHONY_MODEL: "openai-codex/default",
          FAKE_CODEX_ARGS_FILE: argsFile,
          FAKE_CODEX_PROMPT_FILE: promptFile,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const args = readFileSync(argsFile, "utf8").split("\n");
      assert.ok(!args.includes("--model"), `default aliases should omit --model, got ${args.join(" ")}`);
    });

    await test("runner uses resolved payload model instead of legacy task model-routing", () => {
      const result = spawnSync(process.execPath, ["scripts/hiverunner-symphony-runner.mjs"], {
        cwd: process.cwd(),
        input: JSON.stringify({
          ...payload,
          runnerModel: "openai-codex/gpt-5.3-codex-spark",
          execution: {
            modelRouting: {
              model: "openai-codex/gpt-5.5",
            },
          },
        }),
        encoding: "utf8",
        env: {
          ...process.env,
          HIVERUNNER_SYMPHONY_CODEX_COMMAND: fakeCodex,
          HIVERUNNER_SYMPHONY_MODEL: "",
          FAKE_CODEX_ARGS_FILE: argsFile,
          FAKE_CODEX_PROMPT_FILE: promptFile,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const args = readFileSync(argsFile, "utf8").split("\n");
      const modelIndex = args.indexOf("--model");
      assert.ok(modelIndex >= 0, "Codex model flag should be present for routed non-default models");
      assert.strictEqual(args[modelIndex + 1], "gpt-5.3-codex-spark");
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
