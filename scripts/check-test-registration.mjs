#!/usr/bin/env node
// Guard: every test file under src/lib/__tests__/ must be reachable from the
// orchestration gate (`npm test`), so the gate cannot silently skip tests.
//
// Background (2026-06-12 coverage triage): 191 of 270 test files had no
// package.json script entry at all, and another 14 were registered only under
// plain test:* names that `npm test` never runs — per-file script entries are
// the only test discovery mechanism (scripts/run-orchestration-tests.mjs runs
// only test:orchestration:* scripts; there is no glob runner). This check
// fails the gate when a test file is not reachable from a test:orchestration:*
// script, either directly or via one level of `npm run` indirection (wrapper
// entries like "test:orchestration:auth-mode": "npm run --silent test:auth-mode").
//
// KNOWN_OUT_OF_GATE lists files that deterministically failed standalone runs
// during the triage and are deliberately NOT wired into the gate until fixed.
// Shrink this list as repairs land; never grow it without a reason comment.
import { readFile, readdir } from "node:fs/promises";

const KNOWN_OUT_OF_GATE = new Set([
  // Drifted vs "ungated tasks finalize done" (8916318ec) and review-flow changes:
  "orchestration-no-op-resubmission.test.ts",
  "orchestration-create-task-depends-on.test.ts",
  "orchestration-bundle4-operator-experience.test.ts",
  // Template/draft planning-policy drift (plans now rejected by planning_policy.v1):
  "orchestration-goals-page-draft-symphony.test.ts",
  "orchestration-template-draft-plan.test.ts",
  "orchestration-create-full-runtime-identity.test.ts",
  // Status-model drift (to-do / migration v47 rules):
  "orchestration-update-task-status-rejection.test.ts",
  "orchestration-status-normalization.test.ts",
  // Infra/loader staleness or external-runner dependence:
  "orchestration-project-hard-delete.test.ts",
  "orchestration-bundle3-regression-wakeup.test.ts",
  "orchestration-stress-5-concurrent.test.ts",
  // Individual real assertion failures under investigation:
  "orchestration-memory-utilization-receipts.test.ts",
  "orchestration-trust-rules-rollups.test.ts",
  "orchestration-company-workspace-project-scope.test.ts",
  // Blocked on this machine's corrupt legacy tasks.db (machine state, not code):
  "build-state-terminal-transitions.test.ts",
  "factory-status-route.test.ts",
  "tasks-build-route.test.ts",
  // Rest-group failures (runner incompat / missing env isolation / real fail):
  "eslint-config-ignore.test.ts",
  "onboarding-complete-route.test.ts",
  "ideas-takeaway-build-route-dedup.test.ts",
]);

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const scripts = pkg.scripts ?? {};
const testFiles = (await readdir(new URL("../src/lib/__tests__", import.meta.url)))
  .filter((name) => /\.test\.tsx?$/.test(name))
  .sort();

// Expand each gate script's command through one level of `npm run <name>`
// indirection so wrapper entries count as gate coverage.
function expandedCommand(name, depth = 0) {
  const command = scripts[name] ?? "";
  if (depth >= 2) return command;
  const referenced = [...command.matchAll(/npm run (?:--silent )?([A-Za-z0-9:._-]+)/g)]
    .map((m) => m[1])
    .filter((ref) => ref in scripts);
  return [command, ...referenced.map((ref) => expandedCommand(ref, depth + 1))].join("\n");
}

const gateText = Object.keys(scripts)
  .filter((name) => name.startsWith("test:orchestration:"))
  .map((name) => expandedCommand(name))
  .join("\n");

const problems = [];
for (const name of testFiles) {
  const inGate = gateText.includes(`src/lib/__tests__/${name}`);
  const excused = KNOWN_OUT_OF_GATE.has(name);
  if (!inGate && !excused) {
    problems.push(`NOT IN GATE: src/lib/__tests__/${name} — add a test:orchestration:* script entry (or, if it must stay out, add it to KNOWN_OUT_OF_GATE in scripts/check-test-registration.mjs with a reason)`);
  } else if (inGate && excused) {
    problems.push(`STALE EXCUSE: src/lib/__tests__/${name} is reachable from the gate but still listed in KNOWN_OUT_OF_GATE — remove it from the list`);
  }
}

if (problems.length > 0) {
  console.error(`Test registration check failed (${problems.length} problem${problems.length === 1 ? "" : "s"}):`);
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}

console.log(
  `Test registration check passed: ${testFiles.length} test files, ` +
  `${testFiles.length - KNOWN_OUT_OF_GATE.size} reachable from the gate, ` +
  `${KNOWN_OUT_OF_GATE.size} known-out-of-gate (failing, tracked for repair).`,
);
