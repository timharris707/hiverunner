import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_HEAP_MB = "12288";
const heapMb = process.env.HIVERUNNER_BUILD_HEAP_MB || DEFAULT_HEAP_MB;
const isolateRootArtifacts = process.env.HIVERUNNER_BUILD_ISOLATE_ROOT_ARTIFACTS !== "0";
const appRoot = process.cwd();

if (!/^[1-9][0-9]*$/.test(heapMb)) {
  console.error(`[build] HIVERUNNER_BUILD_HEAP_MB must be a positive integer, got ${JSON.stringify(heapMb)}`);
  process.exit(1);
}

const nextBin = join(appRoot, "node_modules", "next", "dist", "bin", "next");

if (!existsSync(nextBin)) {
  console.error("[build] Next.js build binary not found. Run npm install or npm ci first.");
  process.exit(1);
}

const transientRootNames = new Set([
  ".next",
  ".playwright-cli",
  "data-dev",
  "output",
  "playwright-report",
  "test-results",
]);
const transientRootPrefixes = [".next_backup_", ".stable.backup-"];

function shouldHideRootArtifact(name) {
  return transientRootNames.has(name) || transientRootPrefixes.some((prefix) => name.startsWith(prefix));
}

function hideRootArtifacts() {
  if (!isolateRootArtifacts) {
    return { entries: [], holdDir: null };
  }

  const entries = readdirSync(appRoot)
    .filter(shouldHideRootArtifact)
    .sort()
    .map((name) => ({
      name,
      source: join(appRoot, name),
      hidden: null,
      keepGeneratedOnSuccess: name === ".next",
    }));

  if (entries.length === 0) {
    return { entries, holdDir: null };
  }

  const holdDir = mkdtempSync(join(tmpdir(), "hiverunner-next-build-hidden-"));

  try {
    for (const entry of entries) {
      entry.hidden = join(holdDir, entry.name);
      renameSync(entry.source, entry.hidden);
    }
  } catch (error) {
    restoreRootArtifacts({ entries, holdDir, buildSucceeded: false });
    throw error;
  }

  console.log(`[build] Temporarily hiding root build artifacts: ${entries.map((entry) => entry.name).join(", ")}`);
  return { entries, holdDir };
}

function restoreRootArtifacts({ entries, holdDir, buildSucceeded }) {
  if (!holdDir) {
    return;
  }

  for (const entry of entries) {
    if (!entry.hidden || !existsSync(entry.hidden)) {
      continue;
    }

    if (buildSucceeded && entry.keepGeneratedOnSuccess) {
      rmSync(entry.hidden, { force: true, recursive: true });
      continue;
    }

    if (existsSync(entry.source)) {
      rmSync(entry.source, { force: true, recursive: true });
    }

    renameSync(entry.hidden, entry.source);
  }

  rmSync(holdDir, { force: true, recursive: true });
}

console.log(`[build] Using Node heap ${heapMb}MB for Next.js production compile`);

let result;
let hiddenArtifacts;

try {
  hiddenArtifacts = hideRootArtifacts();
  result = spawnSync(
    process.execPath,
    [`--max-old-space-size=${heapMb}`, nextBin, "build", "--webpack", "--experimental-build-mode", "compile", ...process.argv.slice(2)],
    {
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED || "1",
      },
      stdio: "inherit",
    },
  );
} catch (error) {
  console.error(`[build] Failed while preparing Next.js build: ${error.message}`);
  process.exit(1);
} finally {
  if (hiddenArtifacts) {
    const buildSucceeded = Boolean(result && !result.error && !result.signal && result.status === 0);
    try {
      restoreRootArtifacts({ ...hiddenArtifacts, buildSucceeded });
    } catch (error) {
      console.error(`[build] Failed to restore hidden root artifacts: ${error.message}`);
      process.exit(1);
    }
  }
}

if (result.error) {
  console.error(`[build] Failed to start Next.js build: ${result.error.message}`);
  process.exit(1);
}

if (result.signal) {
  console.error(`[build] Next.js build terminated by signal ${result.signal}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
