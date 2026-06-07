import assert from "node:assert";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { captureBrowserProof } from "@/lib/orchestration/browser-proof";
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
    await test("captureBrowserProof writes a manifest, hashes artifacts, and builds an operator comment", async () => {
      const result = await captureBrowserProof({
        taskKey: "INS-999",
        runId: "run-proof",
        baseUrl: "http://localhost:3010",
        urls: [{ path: "/INS/improve", label: "Improve queue" }],
        artifactRoot: tempRoot,
        runner: async ({ artifactDir, specs }) => {
          assert.equal(specs.length, 1);
          assert.ok(existsSync(specs[0]!), "generated URL proof spec should exist");
          await fs.writeFile(path.join(artifactDir, "01-improve-queue.png"), "fake png");
          await fs.mkdir(path.join(artifactDir, "test-results"), { recursive: true });
          await fs.writeFile(path.join(artifactDir, "test-results", "video.webm"), "fake video");
          return { exitCode: 0, stdout: "3 passed", stderr: "" };
        },
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

      const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8")) as Record<string, unknown>;
      assert.equal(manifest.schema, "hiverunner.browser_proof_manifest.v1");
      assert.equal(manifest.taskKey, "INS-999");
      assert.equal(manifest.ok, true);
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
