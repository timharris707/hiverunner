/**
 * Contract test for src/lib/auth/auth-mode.ts.
 * Run: npx tsx src/lib/__tests__/auth-mode.test.ts
 */

import assert from "node:assert/strict";

import {
  DEFAULT_LOCAL_OWNER_EMAIL,
  LOCAL_OWNER_ID,
  getAuthMode,
  getLocalOwner,
  isLocalSingleUserMode,
  isSupabaseConfigured,
} from "@/lib/auth/auth-mode";

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
  console.log("\nAuth Mode Resolver Contract Test\n");

  await test("isSupabaseConfigured returns true only when both Supabase env vars are present", () => {
    assert.equal(isSupabaseConfigured({} as NodeJS.ProcessEnv), false);
    assert.equal(
      isSupabaseConfigured({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" } as NodeJS.ProcessEnv),
      false,
    );
    assert.equal(
      isSupabaseConfigured({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "key" } as NodeJS.ProcessEnv),
      false,
    );
    assert.equal(
      isSupabaseConfigured({
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "key",
      } as NodeJS.ProcessEnv),
      true,
    );
    // Whitespace-only counts as missing.
    assert.equal(
      isSupabaseConfigured({
        NEXT_PUBLIC_SUPABASE_URL: "  ",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "key",
      } as NodeJS.ProcessEnv),
      false,
    );
  });

  await test("getAuthMode defaults to local-single-user when no Supabase env is set", () => {
    assert.equal(getAuthMode({} as NodeJS.ProcessEnv), "local-single-user");
    assert.equal(isLocalSingleUserMode({} as NodeJS.ProcessEnv), true);
  });

  await test("getAuthMode stays local-single-user when Supabase env vars are set without explicit mode", () => {
    assert.equal(
      getAuthMode({
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "key",
      } as NodeJS.ProcessEnv),
      "local-single-user",
    );
  });

  await test("explicit MC_AUTH_MODE overrides inference", () => {
    assert.equal(
      getAuthMode({
        MC_AUTH_MODE: "local-single-user",
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "key",
      } as NodeJS.ProcessEnv),
      "local-single-user",
    );
    assert.equal(
      getAuthMode({ MC_AUTH_MODE: "supabase" } as NodeJS.ProcessEnv),
      "supabase",
    );
  });

  await test("MC_AUTH_MODE accepts common aliases and is case-insensitive", () => {
    assert.equal(getAuthMode({ MC_AUTH_MODE: "LOCAL" } as NodeJS.ProcessEnv), "local-single-user");
    assert.equal(getAuthMode({ MC_AUTH_MODE: "single-user" } as NodeJS.ProcessEnv), "local-single-user");
    assert.equal(getAuthMode({ MC_AUTH_MODE: "Hosted" } as NodeJS.ProcessEnv), "supabase");
  });

  await test("unknown MC_AUTH_MODE falls back to local-single-user", () => {
    assert.equal(getAuthMode({ MC_AUTH_MODE: "totally-bogus" } as NodeJS.ProcessEnv), "local-single-user");
    assert.equal(
      getAuthMode({
        MC_AUTH_MODE: "totally-bogus",
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "key",
      } as NodeJS.ProcessEnv),
      "local-single-user",
    );
  });

  await test("getLocalOwner returns a stable identity with optional email override", () => {
    const def = getLocalOwner({} as NodeJS.ProcessEnv);
    assert.equal(def.id, LOCAL_OWNER_ID);
    assert.equal(def.email, DEFAULT_LOCAL_OWNER_EMAIL);

    const override = getLocalOwner({ MC_LOCAL_OWNER_EMAIL: "tim@example" } as NodeJS.ProcessEnv);
    assert.equal(override.id, LOCAL_OWNER_ID);
    assert.equal(override.email, "tim@example");
  });

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
