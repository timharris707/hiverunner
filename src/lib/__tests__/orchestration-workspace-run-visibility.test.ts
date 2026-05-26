import assert from "assert";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import {
  buildWorkspaceRunVisibility,
  captureWorkspaceGitSnapshots,
  detectReadOnlyIntent,
} from "@/lib/orchestration/execution/workspace-run-visibility";

assert.equal(detectReadOnlyIntent("Read-only task. Do not modify files."), true);
assert.equal(detectReadOnlyIntent("Do not make any file changes."), true);
assert.equal(detectReadOnlyIntent("Inspect the repo without modifying anything."), true);
assert.equal(detectReadOnlyIntent("Create docs/hiverunner-smoke.md. Do not modify any other files."), false);
assert.equal(detectReadOnlyIntent("Update only README.md and do not touch other files."), false);
assert.equal(detectReadOnlyIntent("Controlled write smoke after the read-only classifier fix."), false);
assert.equal(detectReadOnlyIntent("Verify intentional writes are not read-only warnings. Do not modify any other files."), false);

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hiverunner-workspace-visibility-"));

try {
  git(root, ["init"]);
  git(root, ["config", "user.email", "hiverunner@example.test"]);
  git(root, ["config", "user.name", "HiveRunner Test"]);
  write(path.join(root, "tracked.txt"), "initial\n");
  git(root, ["add", "tracked.txt"]);
  git(root, ["commit", "-m", "initial"]);

  write(path.join(root, "already-dirty.txt"), "baseline dirty\n");
  const before = captureWorkspaceGitSnapshots([root]);
  assert.equal(before.length, 1);
  assert.equal(before[0].isGitRepo, true);
  assert.equal(before[0].entries.length, 1);
  assert.equal(before[0].entries[0].path, "already-dirty.txt");

  write(path.join(root, "tracked.txt"), "changed\n");
  write(path.join(root, "created-during-run.txt"), "new\n");
  const after = captureWorkspaceGitSnapshots([root]);
  const visibility = buildWorkspaceRunVisibility({
    before,
    after,
    readOnlyIntent: detectReadOnlyIntent("Read-only task. Do not modify files."),
  });

  assert.equal(visibility.readOnlyIntent, true);
  assert.equal(visibility.totals.trackedRoots, 1);
  assert.equal(visibility.totals.gitRoots, 1);
  assert.equal(visibility.totals.beforeDirtyCount, 1);
  assert.equal(visibility.totals.changedDuringRunCount, 2);
  assert.equal(visibility.warnings.length, 1);

  const changedPaths = visibility.roots[0].changedDuringRun.map((entry) => entry.path).sort();
  assert.deepEqual(changedPaths, ["created-during-run.txt", "tracked.txt"]);
  assert.equal(
    visibility.roots[0].changedDuringRun.some((entry) => entry.path === "already-dirty.txt"),
    false,
  );

  console.log("orchestration-workspace-run-visibility: ok");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
