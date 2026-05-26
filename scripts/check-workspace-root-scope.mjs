#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, "..");
const SRC_ROOT = join(APP_ROOT, "src");
const FILE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

const DISALLOWED_SRC_PATTERNS = [
  { name: "private absolute developer path", pattern: /\/Users\/timharris\b/g },
  { name: "absolute OpenClaw workspace path", pattern: /\/Users\/[^"'\s]+\/\.openclaw\/workspace\b/g },
  { name: "hardcoded OpenClaw workspace literal", pattern: /\.openclaw\/workspace\b/g },
];

const PROTECTED_DIFF_PATTERNS = [
  /^scripts\/promotion-/,
  /^promotion-reconsideration\//,
  /^docs\/promotion-evidence-/,
  /(^|\/)pricing(\/|\.|-)/i,
  /(^|\/)catalog(\/|\.|-)/i,
  /(^|\/)lanes?\//i,
  /(^|\/)task-model-routing\.ts$/i,
  /(^|\/)llm-router\.ts$/i,
  /(^|\/)model-catalog-fetcher\.ts$/i,
  /(^|\/)available-models(\.ts|\/)/i,
  /(^|\/)runtime-models(\.ts|\/)/i,
  /(^|\/)model-source/i,
  /provider-fallback/i,
  /fallback-provider/i,
];

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const abs = join(dir, name);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      files.push(...walk(abs));
    } else if (FILE_EXTS.has(extname(name))) {
      files.push(abs);
    }
  }
  return files;
}

function isAllowedFixture(relPath) {
  return (
    relPath.includes("/__tests__/") ||
    /\.test\.[tj]sx?$/.test(relPath) ||
    relPath.includes("/fixtures/") ||
    relPath.endsWith(".config.ts") ||
    relPath.endsWith(".config.js")
  );
}

function findDisallowedPathMatches() {
  const hits = [];
  for (const abs of walk(SRC_ROOT)) {
    const rel = relative(APP_ROOT, abs).replace(/\\/g, "/");
    if (isAllowedFixture(rel)) continue;
    const lines = readFileSync(abs, "utf8").split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const entry of DISALLOWED_SRC_PATTERNS) {
        entry.pattern.lastIndex = 0;
        if (!entry.pattern.test(line)) continue;
        hits.push({
          file: rel,
          line: i + 1,
          name: entry.name,
          context: line.trim().slice(0, 180),
        });
      }
    }
  }
  return hits;
}

function getChangedFiles() {
  try {
    const diffOutput = execFileSync("git", ["diff", "--name-only"], {
      cwd: APP_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const statusOutput = execFileSync("git", ["status", "--short", "--untracked-files=all"], {
      cwd: APP_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const tracked = diffOutput.split("\n").map((line) => line.trim()).filter(Boolean);
    const status = statusOutput
      .split("\n")
      .map((line) => line.slice(3).trim())
      .filter(Boolean)
      .map((line) => line.includes(" -> ") ? line.split(" -> ").pop() : line)
      .filter(Boolean);
    return [...new Set([...tracked, ...status])];
  } catch {
    return [];
  }
}

function getFileDiff(file) {
  try {
    return execFileSync("git", ["diff", "--", file], {
      cwd: APP_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

function isAllowedCompileOnlyProtectedDiff(file) {
  const diff = getFileDiff(file);
  if (!diff.trim()) return false;

  if (file === "src/lib/pricing.ts") {
    return diff.includes('-    "gpt-5.4": "openai-codex/gpt-5.4",') &&
      !diff.split("\n").some((line) => {
        if (!line.startsWith("+") && !line.startsWith("-")) return false;
        if (line.startsWith("+++") || line.startsWith("---")) return false;
        return line !== '-    "gpt-5.4": "openai-codex/gpt-5.4",';
      });
  }

  if (file === "src/lib/orchestration/model-catalog-fetcher.ts") {
    const changedLines = diff
      .split("\n")
      .filter((line) => (line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---"));
    const allowed = new Set([
      "-    .map((item) => {",
      "+    .map((item): RuntimeCatalogModelInput | null => {",
      "-    .filter((model): model is RuntimeCatalogModelInput => Boolean(model));",
      "+    .filter((model): model is RuntimeCatalogModelInput => model !== null);",
    ]);
    return changedLines.length > 0 && changedLines.every((line) => allowed.has(line));
  }

  return false;
}

function findProtectedDiffMatches() {
  return getChangedFiles().filter((file) => {
    const protectedFile = PROTECTED_DIFF_PATTERNS.some((pattern) => pattern.test(file));
    return protectedFile && !isAllowedCompileOnlyProtectedDiff(file);
  });
}

function findAllowedCompileOnlyProtectedDiffMatches() {
  return getChangedFiles().filter((file) => {
    const protectedFile = PROTECTED_DIFF_PATTERNS.some((pattern) => pattern.test(file));
    return protectedFile && isAllowedCompileOnlyProtectedDiff(file);
  });
}

const pathHits = findDisallowedPathMatches();
const protectedHits = findProtectedDiffMatches();
const allowedProtectedHits = findAllowedCompileOnlyProtectedDiffMatches();

if (pathHits.length > 0) {
  console.error("workspace-root-scope: disallowed production src path matches found:");
  for (const hit of pathHits) {
    console.error(`- ${hit.file}:${hit.line} ${hit.name}`);
    console.error(`  ${hit.context}`);
  }
}

if (protectedHits.length > 0) {
  console.error("workspace-root-scope: protected out-of-scope files are modified:");
  for (const file of protectedHits) {
    console.error(`- ${file}`);
  }
}

if (pathHits.length > 0 || protectedHits.length > 0) {
  process.exit(1);
}

if (allowedProtectedHits.length > 0) {
  console.log("workspace-root-scope: production src paths clean; protected release surfaces contain only allowed compile-only no-op fixes:");
  for (const file of allowedProtectedHits) {
    console.log(`- ${file}`);
  }
} else {
  console.log("workspace-root-scope: production src paths clean and protected release surfaces untouched.");
}
