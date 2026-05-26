#!/usr/bin/env node
/**
 * check-external-http-deps.mjs
 *
 * Guards against silent HiveRunner → external-process HTTP couplings. A
 * historical private sidecar on `:8050` broke local-first boot when it was
 * stopped, so active source should not depend on undisclosed sidecar servers.
 *
 * This checker exists so the coupling can't silently regrow. It scans for
 * any hit on a curated pattern list (e.g. `:8050`, `DASHBOARD_URL` env
 * hints) and fails if the hit isn't on the allowlist.
 *
 * Usage:
 *   node scripts/check-external-http-deps.mjs
 *   npm run check:external-http-deps
 *
 * Exit codes:
 *   0 — clean (zero hits, or all hits on allowlist)
 *   1 — found refs not on allowlist (CI should fail)
 *   2 — allowlist entries reference files that no longer have matches
 *       (allowlist is stale; tighten it)
 *
 * Adding a new pattern: extend PATTERNS below + bump _history in the
 * allowlist JSON so future agents know the checker grew.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, "..");
const SRC_ROOT = join(APP_ROOT, "src");
const ALLOWLIST_PATH = join(__dirname, "external-http-deps-allowlist.json");

// Patterns that indicate a runtime coupling to an external HTTP surface.
// Each entry is a human-readable name + a RegExp (or literal string).
// Matches are case-insensitive.
const PATTERNS = [
  { name: "external-dashboard-8050", pattern: /(?:localhost|127\.0\.0\.1):8050/i },
  { name: "DASHBOARD_BASE_URL env", pattern: /\bDASHBOARD_BASE_URL\b/i },
  { name: "DASHBOARD_URL env", pattern: /\bDASHBOARD_URL\b/i },
];

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
  return raw.allowlist.map((entry) => ({
    file: entry.file.replace(/\\/g, "/"),
    pattern_name: entry.pattern_name,
    match_substring: entry.match_substring,
    feature: entry.feature,
    rationale: entry.rationale,
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
      for (const p of PATTERNS) {
        const m = line.match(p.pattern);
        if (!m) continue;
        hits.push({
          file: rel,
          line: i + 1,
          pattern_name: p.name,
          match_substring: m[0],
          context: line.trim().slice(0, 140),
        });
      }
    }
  }
  return hits;
}

function main() {
  const allowlist = loadAllowlist();
  const hits = findHits();

  const matches = (h, a) =>
    h.file === a.file
    && h.pattern_name === a.pattern_name
    && (a.match_substring ? h.match_substring.toLowerCase() === a.match_substring.toLowerCase() : true);

  const unlisted = hits.filter((h) => !allowlist.some((a) => matches(h, a)));
  const stale = allowlist.filter((a) => !hits.some((h) => matches(h, a)));

  if (unlisted.length === 0 && stale.length === 0) {
    console.log(`✓ external-http-deps: ${hits.length} ref(s) across ${new Set(hits.map((h) => h.file)).size} file(s), all on allowlist.`);
    process.exit(0);
  }

  if (unlisted.length > 0) {
    console.error(`✗ external-http-deps: ${unlisted.length} ref(s) not on allowlist:\n`);
    for (const h of unlisted) {
      console.error(`  ${h.file}:${h.line}  [${h.pattern_name}] ${h.match_substring}`);
      console.error(`    ${h.context}`);
    }
    console.error("\nTo fix: either remove the coupling (preferred — HiveRunner must stand alone),");
    console.error("OR add an entry to scripts/external-http-deps-allowlist.json with");
    console.error("pattern_name + match_substring + feature + rationale fields.");
    console.error("The allowlist SHRINKS over time; do not grow it without a clear reason.");
  }

  if (stale.length > 0) {
    console.error(`\n⚠ external-http-deps: ${stale.length} allowlist entry/entries no longer match any src/ ref (stale, should be removed):\n`);
    for (const a of stale) {
      console.error(`  file=${a.file}  pattern_name=${a.pattern_name}  match=${a.match_substring}  feature=${a.feature}`);
    }
  }

  process.exit(unlisted.length > 0 ? 1 : 2);
}

main();
