import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  \u2713 ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  \u2717 ${name}`);
      console.error(`    ${message}`);
    });
}

async function run() {
  console.log("\nCompany Delete OpenClaw Cleanup Tests\n");

  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "orchestration-company-delete-openclaw-cleanup-"),
  );
  const homeDir = path.join(tempRoot, "home");
  const binDir = path.join(tempRoot, "bin");
  const openclawDir = path.join(homeDir, ".openclaw");
  const agentsDir = path.join(openclawDir, "agents");
  const fakeOpenClawPath = path.join(binDir, "openclaw");

  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(agentsDir, { recursive: true });

  fs.writeFileSync(
    fakeOpenClawPath,
    `#!/bin/sh
if [ "$1" = "agents" ] && [ "$2" = "delete" ]; then
  case "$3" in
    missing-agent)
      echo "no such agent" >&2
      exit 1
      ;;
    fail-agent)
      echo "kaboom" >&2
      exit 2
      ;;
    *)
      exit 0
      ;;
  esac
fi
echo "unsupported" >&2
exit 1
`,
    "utf8",
  );
  fs.chmodSync(fakeOpenClawPath, 0o755);

  process.env.HOME = homeDir;
  process.env.OPENCLAW_DIR = openclawDir;
  process.env.PATH = `${binDir}:${process.env.PATH || ""}`;

  const emptyDeletedDir = path.join(agentsDir, "deleted-agent");
  const emptyMissingDir = path.join(agentsDir, "missing-agent");
  const nonEmptyDir = path.join(agentsDir, "non-empty-agent");
  const failDir = path.join(agentsDir, "fail-agent");
  const unrelatedDir = path.join(agentsDir, "unrelated-live-agent");

  fs.mkdirSync(emptyDeletedDir, { recursive: true });
  fs.mkdirSync(emptyMissingDir, { recursive: true });
  fs.mkdirSync(nonEmptyDir, { recursive: true });
  fs.mkdirSync(failDir, { recursive: true });
  fs.mkdirSync(unrelatedDir, { recursive: true });
  fs.writeFileSync(path.join(nonEmptyDir, "agent.json"), "{\"ok\":true}\n", "utf8");
  fs.writeFileSync(path.join(unrelatedDir, "agent.json"), "{\"live\":true}\n", "utf8");

  const { cleanupDeletedCompanyOpenClawAgents } = await import("@/lib/orchestration/company-service");

  await test("recursively removes deleted OpenClaw agent dirs after unregister and leaves failed deletes alone", async () => {
    const result = await cleanupDeletedCompanyOpenClawAgents([
      "deleted-agent",
      "missing-agent",
      "non-empty-agent",
      "fail-agent",
    ]);

    assert.deepStrictEqual(result.deleted, ["deleted-agent", "non-empty-agent"]);
    assert.deepStrictEqual(result.missing, ["missing-agent"]);
    assert.deepStrictEqual(result.failed, ["fail-agent"]);
    assert.deepStrictEqual(result.deletedAgentDirs.sort(), ["deleted-agent", "missing-agent", "non-empty-agent"]);
    assert.deepStrictEqual(result.retainedAgentDirs.sort(), []);

    assert.ok(!fs.existsSync(emptyDeletedDir), "expected deleted-agent dir to be removed");
    assert.ok(!fs.existsSync(emptyMissingDir), "expected missing-agent orphan dir to be removed");
    assert.ok(!fs.existsSync(nonEmptyDir), "expected non-empty-agent dir to be removed");
    assert.ok(fs.existsSync(failDir), "expected fail-agent dir to remain after unregister failure");
    assert.ok(fs.existsSync(unrelatedDir), "expected unrelated agent dir to remain untouched");
  });

  fs.rmSync(tempRoot, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
