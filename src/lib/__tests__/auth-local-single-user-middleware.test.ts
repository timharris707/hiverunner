/**
 * Contract test for the middleware/updateSession behavior in
 * local-single-user mode. Verifies that no Supabase client is constructed and
 * a synthetic owner identity is returned.
 *
 * Run: npx tsx src/lib/__tests__/auth-local-single-user-middleware.test.ts
 */

import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { restoreEnvSnapshot, snapshotEnv } from "@/lib/__tests__/helpers/env-test-harness";
import { updateSession } from "@/lib/supabase/middleware";
import { LOCAL_OWNER_ID } from "@/lib/auth/auth-mode";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  [pass] ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  [fail] ${name}`);
      console.error(`    ${message}`);
    });
}

async function run() {
  console.log("\nLocal-Single-User Middleware Contract Test\n");

  const envSnapshot = snapshotEnv([
    "MC_AUTH_MODE",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "MC_LOCAL_OWNER_EMAIL",
  ]);

  try {
    // Local-single-user mode (inferred via missing Supabase env)
    delete process.env.MC_AUTH_MODE;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    await test("returns synthetic owner without contacting Supabase", async () => {
      const request = new NextRequest("http://localhost:3010/companies/insight/dashboard");
      const { user, supabaseResponse } = await updateSession(request);
      assert.ok(user, "Expected a synthetic owner user");
      assert.equal(user?.id, LOCAL_OWNER_ID);
      assert.ok(supabaseResponse, "Expected a supabaseResponse object");
    });

    await test("respects MC_LOCAL_OWNER_EMAIL override", async () => {
      process.env.MC_LOCAL_OWNER_EMAIL = "owner@example";
      try {
        const request = new NextRequest("http://localhost:3010/companies/insight/dashboard");
        const { user } = await updateSession(request);
        assert.equal(user?.email, "owner@example");
      } finally {
        delete process.env.MC_LOCAL_OWNER_EMAIL;
      }
    });

    await test("explicit MC_AUTH_MODE=local-single-user wins over Supabase env", async () => {
      process.env.MC_AUTH_MODE = "local-single-user";
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "key";
      try {
        const request = new NextRequest("http://localhost:3010/companies/insight/dashboard");
        const { user } = await updateSession(request);
        assert.equal(user?.id, LOCAL_OWNER_ID);
      } finally {
        delete process.env.MC_AUTH_MODE;
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      }
    });

    await test("hosted mode without configured env vars throws explicitly", async () => {
      process.env.MC_AUTH_MODE = "supabase";
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      try {
        const request = new NextRequest("http://localhost:3010/companies/insight/dashboard");
        await assert.rejects(updateSession(request), /Supabase auth mode selected/i);
      } finally {
        delete process.env.MC_AUTH_MODE;
      }
    });
  } finally {
    restoreEnvSnapshot(envSnapshot);
  }

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
