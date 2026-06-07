import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const REQUIRED_MAJOR = "22";

function nodeMajor(nodeBin) {
  try {
    return execFileSync(nodeBin, ["-e", "process.stdout.write(process.versions.node.split('.')[0])"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function addIfExecutable(candidates, candidate) {
  if (!candidate || candidates.includes(candidate) || !existsSync(candidate)) return;
  candidates.push(candidate);
}

function fnmNodeCandidates() {
  const root = path.join(os.homedir(), ".local", "share", "fnm", "node-versions");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((entry) => entry.startsWith(`v${REQUIRED_MAJOR}.`))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((entry) => path.join(root, entry, "installation", "bin", "node"));
}

export function resolveHiverunnerNodeBin() {
  const candidates = [];
  addIfExecutable(candidates, process.env.HIVERUNNER_NODE_BIN);
  addIfExecutable(candidates, process.env.NODE_BIN);
  for (const candidate of fnmNodeCandidates()) addIfExecutable(candidates, candidate);
  addIfExecutable(candidates, "/usr/local/bin/node");
  addIfExecutable(candidates, "/opt/homebrew/bin/node");

  for (const candidate of candidates) {
    if (nodeMajor(candidate) === REQUIRED_MAJOR) return candidate;
  }
  return "";
}

export function ensureHiverunnerNode(label = "hiverunner") {
  if (process.versions.node.split(".")[0] === REQUIRED_MAJOR) return;

  const nodeBin = resolveHiverunnerNodeBin();
  if (!nodeBin) {
    console.error(`[${label}] ERROR: HiveRunner requires Node.js ${REQUIRED_MAJOR}.x for local commands.`);
    console.error(`[${label}] Current Node: ${process.version} at ${process.execPath}`);
    console.error(`[${label}] Set HIVERUNNER_NODE_BIN=/absolute/path/to/node to choose the repo runtime.`);
    process.exit(1);
  }

  let sameBinary = false;
  try {
    sameBinary = realpathSync(nodeBin) === realpathSync(process.execPath);
  } catch {
    sameBinary = nodeBin === process.execPath;
  }
  if (sameBinary) return;

  const nodeDir = path.dirname(nodeBin);
  console.error(`[${label}] Re-execing with HiveRunner Node ${REQUIRED_MAJOR}.x: ${nodeBin}`);
  const result = spawnSync(nodeBin, process.argv.slice(1), {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${nodeDir}:${process.env.PATH ?? ""}`,
    },
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`[${label}] ERROR: failed to re-exec ${nodeBin}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}
