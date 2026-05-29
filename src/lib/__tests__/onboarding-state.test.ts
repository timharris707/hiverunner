import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ONBOARDING_STATE_VERSION,
  defaultOnboardingState,
  isSoftwareSetupComplete,
  markSoftwareSetupComplete,
  normalizeOnboardingState,
  readOnboardingState,
} from "@/lib/onboarding/onboarding-state";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiverunner-onboarding-state-"));
const filePath = path.join(tmpDir, "onboarding-state.json");

try {
  // Default / missing-file behavior.
  assert.equal(isSoftwareSetupComplete(defaultOnboardingState()), false);
  assert.equal(isSoftwareSetupComplete(readOnboardingState(filePath)), false, "missing file is not complete");

  // normalizeOnboardingState is defensive against junk and partial records.
  assert.equal(isSoftwareSetupComplete(normalizeOnboardingState(null)), false);
  assert.equal(isSoftwareSetupComplete(normalizeOnboardingState("nonsense")), false);
  assert.equal(
    isSoftwareSetupComplete(normalizeOnboardingState({ completedVia: "skipped" })),
    false,
    "a reason without a timestamp does not count as complete",
  );
  assert.equal(
    normalizeOnboardingState({ softwareSetupCompletedAt: "2026-01-01T00:00:00.000Z", completedVia: "bogus" }).completedVia,
    null,
    "unknown reasons are dropped",
  );

  // Marking complete writes durable, server-side state.
  const fixedNow = "2026-05-29T12:00:00.000Z";
  const written = markSoftwareSetupComplete({ via: "skipped", now: fixedNow }, filePath);
  assert.equal(written.softwareSetupCompletedAt, fixedNow);
  assert.equal(written.completedVia, "skipped");
  assert.equal(written.version, ONBOARDING_STATE_VERSION);
  assert.ok(fs.existsSync(filePath), "state file should be created on completion");

  const reread = readOnboardingState(filePath);
  assert.equal(isSoftwareSetupComplete(reread), true);
  assert.equal(reread.softwareSetupCompletedAt, fixedNow);

  // Write-once: both the first completion timestamp AND the first reason are
  // preserved on subsequent calls (this also makes concurrent POSTs deterministic).
  const second = markSoftwareSetupComplete({ via: "created-workspace", now: "2026-06-01T00:00:00.000Z" }, filePath);
  assert.equal(second.softwareSetupCompletedAt, fixedNow, "original completion time is preserved");
  assert.equal(second.completedVia, "skipped", "first completion reason is preserved (write-once)");

  console.log("PASS onboarding-state");
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
