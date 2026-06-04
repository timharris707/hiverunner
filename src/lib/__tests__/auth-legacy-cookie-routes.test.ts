/**
 * Contract test for legacy auth cookie removal from login/logout routes.
 * Run: npx tsx src/lib/__tests__/auth-legacy-cookie-routes.test.ts
 */

import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { restoreEnvSnapshot, setTestNodeEnv, snapshotEnv } from "@/lib/__tests__/helpers/env-test-harness";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { LOCAL_DEV_SESSION_COOKIE } from "@/lib/auth/local-dev-session";

const { finish, test } = createTestRunner({ failLabel: "[fail]", passLabel: "[pass]" });

async function run() {
  console.log("\nAuth Legacy Cookie Route Contract Test\n");

  const envSnapshot = snapshotEnv([
    "NODE_ENV",
    "MC_AUTH_MODE",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "ADMIN_PASSWORD",
    "AUTH_SECRET",
  ]);

  try {
    process.env.ADMIN_PASSWORD = "legacy-password";
    process.env.AUTH_SECRET = "legacy-secret-must-not-be-cookie";

    await test("local-single-user login sets only the local session cookie", async () => {
      setTestNodeEnv("production");
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
      setTestNodeEnv("production");
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
    restoreEnvSnapshot(envSnapshot);
  }

  finish();
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
