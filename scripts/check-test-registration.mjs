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
  // Categories below were diagnosed per-file and adversarially verified on
  // 2026-06-12 (see wiki: 2026-06-12_test-gate-coverage-triage.md).
  //
  // REAL BUGS in app code — the test is right, the code is wrong:
  // - trust-rules-rollups: reconcileParentTaskStatus re-INSERTs the
  //   hierarchy:auto-complete comment, violating the v4 unique index on
  //   comments(task_id, source, external_ref) on repeat rollups.
  // - create-full-runtime-identity: one case expects initialExecution.reason
  //   to stay "company_creation_kickoff", but triggerTaskExecution overwrites
  //   the caller's reason with the skip cause when the dev-lane execution gate
  //   suppresses the kickoff ("dev_autonomous_test_mode_disabled"). Fails at
  //   pre-planning-policy HEAD too (verified 2026-06-12 in a clean worktree),
  //   so it is independent of the template-launch 400 fix below; needs an
  //   intent decision on the reason contract before wiring.
  //   (The planning-policy 400s that also hit this file are fixed — see
  //   template-draft-plan note.)
  "orchestration-trust-rules-rollups.test.ts",
  "orchestration-create-full-runtime-identity.test.ts",
  // FIXED 2026-06-12 and wired into the gate:
  // - template-draft-plan: planning-policy gate (2ec97f351) rejected the
  //   built-in starter templates' own canned plans (template launch 400);
  //   template-sourced drafts now skip policy shape validation.
  // - update-task-status-rejection: applyStatusTransition's separator
  //   collapse stranded canonical "to-do" as "to_do" (missing from
  //   VALID_STATUSES), rejecting agent to-do requests; normalizeTaskStatusToken
  //   now maps it back (also fixes normalizeCreateTaskStatus's dead "to-do"
  //   arm). The two 8916318ec review->done drift cases were re-asserted
  //   against the convert-ungated-review-to-done contract.
  //
  // STALE TESTS — code moved on, test asserts old behavior:
  // - vs "ungated review requests convert to done" (8916318ec):
  "orchestration-no-op-resubmission.test.ts",
  "orchestration-create-task-depends-on.test.ts",
  // - vs planning-policy gate (2ec97f351): fixture plans trip the new
  //   heuristics (engine mismatch / tight-utility wording):
  "orchestration-bundle4-operator-experience.test.ts",
  "orchestration-goals-page-draft-symphony.test.ts",
  // - vs on-deck -> to-do rename (8d527236b): fixture seed became canonical,
  //   so the normalization UPDATE is a no-op:
  "orchestration-status-normalization.test.ts",
  // - vs NeverIdle -> HiveRunner rebrand: looks up legacy "neveridle-core"
  //   default-company slug:
  "orchestration-company-workspace-project-scope.test.ts",
  // - vs execution-hive bootstrap (c8f41794a): expected fast 409 is gone, a
  //   real external runner gets dispatched and times out after 120s:
  "orchestration-bundle3-regression-wakeup.test.ts",
  // - vs async engine-tick execution pipeline: asserts the old synchronous
  //   sessionId/executionMode=openclaw contract:
  "orchestration-stress-5-concurrent.test.ts",
  // - vs matched-use memory evaluator: expects status "not_evaluated" but
  //   every import now ends with storeMatchedMemoryUseEvaluation:
  "orchestration-memory-utilization-receipts.test.ts",
  // - child spawn uses --import register-ts-paths.mjs, which cannot load the
  //   ObservabilityTier `export enum` under Node type-stripping; spawn via
  //   run-ts-test.mjs (or add --experimental-transform-types) to fix:
  "orchestration-project-hard-delete.test.ts",
  // - ideas store migrated JSON -> SQLite; test must set
  //   IDEAS_LEGACY_REVIEWS_PATH for its fixture to be imported:
  "ideas-takeaway-build-route-dedup.test.ts",
  //
  // RUNNER INCOMPAT — uses import.meta, which run-ts-test.mjs's CJS
  // transform cannot execute; needs a tsx/ESM runner or a __dirname rewrite:
  "eslint-config-ignore.test.ts",
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
