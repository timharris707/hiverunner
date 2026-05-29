import assert from "node:assert/strict";
import fs from "node:fs";

import { GET, POST } from "@/app/api/onboarding/complete/route";
import { MC_DATA_DIR } from "@/lib/data-dir";
import { onboardingStateFilePath } from "@/lib/onboarding/onboarding-state";
import type { NextRequest } from "next/server";

// This test requires an isolated MC_DATA_DIR so it never touches a real install.
// The npm script sets MC_DATA_DIR=/tmp/... before invoking; guard in case it is run directly.
function assertIsolatedDataDir() {
  if (!process.env.MC_DATA_DIR || !/tmp|TEMP|temp/.test(process.env.MC_DATA_DIR)) {
    throw new Error(
      "onboarding-complete-route.test.ts must run with MC_DATA_DIR pointed at a temp directory (see package.json test script).",
    );
  }
}

function fakeRequest(body: unknown): NextRequest {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

async function run() {
  assertIsolatedDataDir();
  const stateFile = onboardingStateFilePath(MC_DATA_DIR);
  fs.rmSync(stateFile, { force: true });

  // GET before completion reports not-complete.
  const before = await (await GET()).json();
  assert.equal(before.complete, false);
  assert.equal(before.softwareSetupCompletedAt, null);

  // POST with a valid reason persists completion.
  const posted = await (await POST(fakeRequest({ via: "skipped" }))).json();
  assert.equal(posted.complete, true);
  assert.equal(posted.completedVia, "skipped");
  assert.ok(typeof posted.softwareSetupCompletedAt === "string" && posted.softwareSetupCompletedAt.length > 0);
  assert.ok(fs.existsSync(stateFile), "completion should be written to the data dir");

  // GET after completion reflects durable state.
  const after = await (await GET()).json();
  assert.equal(after.complete, true);
  assert.equal(after.completedVia, "skipped");

  // POST with an invalid/absent reason still completes, defaulting the reason,
  // and never throws on a bad body.
  fs.rmSync(stateFile, { force: true });
  const defaulted = await (await POST(fakeRequest({ via: "not-a-reason" }))).json();
  assert.equal(defaulted.complete, true);
  assert.equal(defaulted.completedVia, "completed");

  const noBody = await (await POST(fakeRequest(undefined))).json();
  assert.equal(noBody.complete, true);

  console.log("PASS onboarding-complete-route");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
