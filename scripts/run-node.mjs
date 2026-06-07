#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";

import { ensureHiverunnerNode, resolveHiverunnerNodeBin } from "./lib/ensure-hiverunner-node.mjs";

ensureHiverunnerNode("run-node");

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node ./scripts/run-node.mjs [node options] <script> [args]");
  process.exit(1);
}

const nodeBin = resolveHiverunnerNodeBin() || process.execPath;
const nodeDir = path.dirname(nodeBin);
const result = spawnSync(nodeBin, args, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PATH: `${nodeDir}:${process.env.PATH ?? ""}`,
  },
  stdio: "inherit",
});

if (result.error) {
  console.error(`[run-node] ERROR: ${result.error.message}`);
  process.exit(1);
}
if (result.signal) {
  process.kill(process.pid, result.signal);
  process.exit(1);
}
process.exit(result.status ?? 1);
