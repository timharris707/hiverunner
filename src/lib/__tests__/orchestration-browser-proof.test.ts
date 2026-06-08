import assert from "node:assert";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { buildBrowserProofChildEnv, captureBrowserProof } from "@/lib/orchestration/browser-proof";
import { parseActionsFromText } from "@/lib/orchestration/engine/action-dispatcher";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  pass ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(`  fail ${name}`);
      console.error(message);
    });
}

console.log("\nOrchestration Browser Proof Tests\n");

async function run() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "hiverunner-browser-proof-"));
  try {
    await test("browser proof child env keeps provider secrets out", () => {
      const originalOpenAi = process.env.OPENAI_API_KEY;
      const originalAnthropic = process.env.ANTHROPIC_API_KEY;
      process.env.OPENAI_API_KEY = "secret-openai";
      process.env.ANTHROPIC_API_KEY = "secret-anthropic";
      try {
        const env = buildBrowserProofChildEnv({
          baseUrl: "http://localhost:3010",
          artifactDir: path.join(tempRoot, "proof"),
        });
        assert.equal(env.BASE_URL, "http://localhost:3010");
        assert.equal(env.OPENAI_API_KEY, undefined);
        assert.equal(env.ANTHROPIC_API_KEY, undefined);
        assert.equal(env.HIVERUNNER_BROWSER_PROOF_ARTIFACT_DIR, path.join(tempRoot, "proof"));
      } finally {
        if (originalOpenAi === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = originalOpenAi;
        if (originalAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = originalAnthropic;
      }
    });

    await test("captureBrowserProof writes a manifest, hashes artifacts, and builds an operator comment", async () => {
      const db = new Database(path.join(tempRoot, "browser-proof-audit.db"));
      db.exec(`
        CREATE TABLE runtime_browser_proof_audit (
          id TEXT PRIMARY KEY,
          company_id TEXT,
          agent_id TEXT,
          task_id TEXT,
          task_key TEXT,
          heartbeat_run_id TEXT,
          execution_run_id TEXT,
          status TEXT NOT NULL,
          exit_code INTEGER NOT NULL,
          duration_ms INTEGER NOT NULL,
          base_url TEXT NOT NULL,
          project TEXT NOT NULL,
          command TEXT NOT NULL,
          artifact_dir TEXT NOT NULL,
          manifest_path TEXT NOT NULL,
          manifest_sha256 TEXT NOT NULL,
          artifact_count INTEGER NOT NULL,
          screenshot_count INTEGER NOT NULL,
          video_count INTEGER NOT NULL,
          specs_json TEXT NOT NULL,
          urls_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      const originalSecret = process.env.HIVERUNNER_BROWSER_PROOF_SECRET;
      process.env.HIVERUNNER_BROWSER_PROOF_SECRET = "proof-secret-value";
      const result = await captureBrowserProof({
        taskKey: "INS-999",
        runId: "run-proof",
        executionRunId: "execution-proof",
        baseUrl: "http://localhost:3010",
        urls: [{ path: "/INS/improve", label: "Improve queue" }],
        artifactRoot: tempRoot,
        audit: {
          db,
          companyId: "company-proof",
          agentId: "agent-proof",
          taskId: "task-proof",
          taskKey: "INS-999",
        },
        runner: async ({ artifactDir, specs, timeoutMs }) => {
          assert.equal(specs.length, 1);
          assert.ok(existsSync(specs[0]!), "generated URL proof spec should exist");
          assert.equal(timeoutMs, 30_000);
          const generatedSpec = await fs.readFile(specs[0]!, "utf8");
          assert.match(generatedSpec, /timeout: 10_000/);
          assert.match(generatedSpec, /timeout: 3_000/);
          assert.match(generatedSpec, /timeout: 5_000/);
          await fs.writeFile(path.join(artifactDir, "01-improve-queue.png"), "fake png");
          await fs.mkdir(path.join(artifactDir, "test-results"), { recursive: true });
          await fs.writeFile(path.join(artifactDir, "test-results", "video.webm"), "fake video");
          return { exitCode: 0, stdout: "3 passed proof-secret-value", stderr: "proof-secret-value" };
        },
      }).finally(() => {
        if (originalSecret === undefined) delete process.env.HIVERUNNER_BROWSER_PROOF_SECRET;
        else process.env.HIVERUNNER_BROWSER_PROOF_SECRET = originalSecret;
      });

      assert.equal(result.ok, true);
      assert.equal(result.exitCode, 0);
      assert.ok(result.manifestPath.endsWith("manifest.json"));
      assert.match(result.manifestUri, /^file:\/\//);
      assert.match(result.manifestSha256, /^[a-f0-9]{64}$/);
      assert.equal(result.artifacts.filter((artifact) => artifact.kind === "image").length, 1);
      assert.equal(result.artifacts.filter((artifact) => artifact.kind === "video").length, 1);
      assert.match(result.commentBody, /Browser proof captured/);
      assert.match(result.commentBody, /Screenshots: 1/);
      assert.doesNotMatch(result.stdoutTail, /proof-secret-value/);
      assert.doesNotMatch(result.stderrTail, /proof-secret-value/);
      assert.match(result.stdoutTail, /\[REDACTED\]/);

      const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8")) as Record<string, unknown>;
      assert.equal(manifest.schema, "hiverunner.browser_proof_manifest.v1");
      assert.equal(manifest.taskKey, "INS-999");
      assert.equal(manifest.ok, true);
      assert.doesNotMatch(JSON.stringify(manifest), /proof-secret-value/);
      assert.match(JSON.stringify(manifest), /\[REDACTED\]/);
      const audit = db
        .prepare("SELECT status, task_id, task_key, heartbeat_run_id, execution_run_id, screenshot_count, video_count FROM runtime_browser_proof_audit")
        .get() as
        | {
            status: string;
            task_id: string | null;
            task_key: string | null;
            heartbeat_run_id: string | null;
            execution_run_id: string | null;
            screenshot_count: number;
            video_count: number;
          }
        | undefined;
      assert.equal(audit?.status, "succeeded");
      assert.equal(audit?.task_id, "task-proof");
      assert.equal(audit?.task_key, "INS-999");
      assert.equal(audit?.heartbeat_run_id, "run-proof");
      assert.equal(audit?.execution_run_id, "execution-proof");
      assert.equal(audit?.screenshot_count, 1);
      assert.equal(audit?.video_count, 1);
      db.close();
    });

    await test("capture_browser_proof mc-action parses as a first-class action", () => {
      const parsed = parseActionsFromText([
        "```mc-action",
        JSON.stringify({
          action: "capture_browser_proof",
          taskKey: "INS-999",
          baseUrl: "http://localhost:3010",
          urls: [{ path: "/INS/improve", label: "Improve queue" }],
        }),
        "```",
      ].join("\n"));

      assert.deepEqual(parsed.parseErrors, []);
      assert.equal(parsed.actions.length, 1);
      assert.equal(parsed.actions[0]?.action, "capture_browser_proof");
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
