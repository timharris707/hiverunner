/**
 * Contract test for legacy auth cookie removal from login/logout routes.
 * Run: npx tsx src/lib/__tests__/auth-legacy-cookie-routes.test.ts
 */

import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { LOCAL_DEV_SESSION_COOKIE } from "@/lib/auth/local-dev-session";

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

function setNodeEnv(value: string) {
  Object.defineProperty(process.env, "NODE_ENV", {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

async function run() {
  console.log("\nAuth Legacy Cookie Route Contract Test\n");

  const originalNodeEnv = process.env.NODE_ENV;
  const originalAuthMode = process.env.MC_AUTH_MODE;
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalSupabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const originalAdminPassword = process.env.ADMIN_PASSWORD;
  const originalAuthSecret = process.env.AUTH_SECRET;

  try {
    process.env.ADMIN_PASSWORD = "legacy-password";
    process.env.AUTH_SECRET = "legacy-secret-must-not-be-cookie";

    await test("local-single-user login sets only the local session cookie", async () => {
      setNodeEnv("production");
      process.env.MC_AUTH_MODE = "local-single-user";
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      const response = await login(new NextRequest("http://localhost:3010/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password: "legacy-password" }),
      }));

      assert.equal(response.status, 200);
      const setCookie = response.headers.get("set-cookie") ?? "";
      assert.match(setCookie, new RegExp(`${LOCAL_DEV_SESSION_COOKIE}=1`));
      assert.doesNotMatch(setCookie, /mc_auth=/);
      assert.doesNotMatch(setCookie, /legacy-secret-must-not-be-cookie/);
    });

    await test("hosted-mode legacy password login is disabled and sets no cookie", async () => {
      setNodeEnv("production");
      process.env.MC_AUTH_MODE = "supabase";
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

      const response = await login(new NextRequest("https://app.example.com/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password: "legacy-password" }),
      }));

      assert.equal(response.status, 410);
      assert.equal(response.headers.get("set-cookie"), null);
      const body = await response.json() as { success?: boolean };
      assert.equal(body.success, false);
    });

    await test("logout clears the local session cookie without clearing mc_auth", async () => {
      process.env.MC_AUTH_MODE = "local-single-user";
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      const response = await logout();

      assert.equal(response.status, 200);
      const setCookie = response.headers.get("set-cookie") ?? "";
      assert.match(setCookie, new RegExp(`${LOCAL_DEV_SESSION_COOKIE}=`));
      assert.doesNotMatch(setCookie, /mc_auth=/);
      assert.doesNotMatch(setCookie, /legacy-secret-must-not-be-cookie/);
    });
  } finally {
    if (originalNodeEnv !== undefined) {
      setNodeEnv(originalNodeEnv);
    }
    if (originalAuthMode === undefined) {
      delete process.env.MC_AUTH_MODE;
    } else {
      process.env.MC_AUTH_MODE = originalAuthMode;
    }
    if (originalSupabaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    }
    if (originalSupabaseKey === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalSupabaseKey;
    }
    if (originalAdminPassword === undefined) {
      delete process.env.ADMIN_PASSWORD;
    } else {
      process.env.ADMIN_PASSWORD = originalAdminPassword;
    }
    if (originalAuthSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = originalAuthSecret;
    }
  }

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
