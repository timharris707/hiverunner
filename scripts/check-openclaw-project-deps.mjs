#!/usr/bin/env node
/**
 * check-openclaw-project-deps.mjs
 *
 * Guards against silent HiveRunner → `.openclaw/workspace/projects/<name>/` couplings.
 *
 * Motivation: project-specific OpenClaw paths are private machine/workspace
 * couplings. This check ensures any NEW reference fails CI until an engineer
 * either (a) migrates the dependency out of OpenClaw, or (b) adds an entry to
 * scripts/openclaw-project-deps-allowlist.json with a clear rationale and
 * migration target.
 *
 * Matches: `.openclaw/workspace/projects/<anything>` in any src/ file.
 * Does NOT match: `.openclaw/openclaw.json`, `.openclaw/agents/`, etc. — the
 * checker only fires on project-specific deps, which is the class of silent
 * coupling we want to prevent. Generic OpenClaw integration (orchestration,
 * agents, workspace root, config) is expected integration and not in scope.
 *
 * Usage:
 *   node scripts/check-openclaw-project-deps.mjs
 *   npm run check:openclaw-project-deps   # same thing, wired in package.json
 *
 * Exit codes:
 *   0 — clean (all hits are on the allowlist)
 *   1 — found refs not on the allowlist (build should fail)
 *   2 — allowlist itself references a file/pattern that no longer appears in
 *       src/ (the allowlist is stale and should be tightened)
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, "..");
const SRC_ROOT = join(APP_ROOT, "src");
const ALLOWLIST_PATH = join(__dirname, "openclaw-project-deps-allowlist.json");

const PATTERN = /\.openclaw\/workspace\/projects\/([a-z0-9_-]+)/gi;
const FILE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (FILE_EXTS.has(extname(name))) out.push(p);
  }
  return out;
}

function loadAllowlist() {
  const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  if (!Array.isArray(raw.allowlist)) throw new Error("allowlist.json missing 'allowlist' array");
  // Normalize into a lookup keyed by file + substring match on pattern
  return raw.allowlist.map((entry) => ({
    file: entry.file.replace(/\\/g, "/"),
    pattern: entry.pattern,
    feature: entry.feature,
  }));
}

function findHits() {
  const hits = [];
  for (const abs of walk(SRC_ROOT)) {
    const rel = relative(APP_ROOT, abs).replace(/\\/g, "/");
    const text = readFileSync(abs, "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      PATTERN.lastIndex = 0;
      const matches = line.match(PATTERN);
      if (!matches) continue;
      for (const m of matches) {
        hits.push({ file: rel, line: i + 1, match: m, context: line.trim().slice(0, 140) });
      }
    }
  }
  return hits;
}

function main() {
  const allowlist = loadAllowlist();
  const hits = findHits();

  // Entry matches hit when file agrees and one pattern is a prefix of the
  // other. The detected match might be just `.openclaw/workspace/projects/<name>`
  // (if the full path continues past our regex capture), while the allowlist
  // entry might be more specific like `.../<name>/reviews.json` — either
  // direction is acceptable.
  const matches = (h, a) =>
    h.file === a.file
    && (h.match.startsWith(a.pattern) || a.pattern.startsWith(h.match));

  const unlisted = hits.filter((h) => !allowlist.some((a) => matches(h, a)));
  const stale = allowlist.filter((a) => !hits.some((h) => matches(h, a)));

  if (unlisted.length === 0 && stale.length === 0) {
    console.log(`✓ openclaw-project-deps: ${hits.length} ref(s) across ${new Set(hits.map((h) => h.file)).size} file(s), all on allowlist.`);
    process.exit(0);
  }

  if (unlisted.length > 0) {
    console.error(`✗ openclaw-project-deps: ${unlisted.length} ref(s) not on allowlist:\n`);
    for (const h of unlisted) {
      console.error(`  ${h.file}:${h.line}  ${h.match}`);
      console.error(`    ${h.context}`);
    }
    console.error("\nTo fix: either migrate the reference out of .openclaw/workspace/projects/");
    console.error("OR add an entry to scripts/openclaw-project-deps-allowlist.json with");
    console.error("rationale + migration_target fields. See existing entries for the shape.");
  }

  if (stale.length > 0) {
    console.error(`\n⚠ openclaw-project-deps: ${stale.length} allowlist entry/entries no longer match any src/ ref (stale, should be removed):\n`);
    for (const a of stale) {
      console.error(`  file=${a.file}  pattern=${a.pattern}  feature=${a.feature}`);
    }
  }

  process.exit(unlisted.length > 0 ? 1 : 2);
}

main();
