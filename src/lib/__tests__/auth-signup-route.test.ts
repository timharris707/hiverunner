/**
 * Contract test for /api/auth/signup.
 *
 * Goal: prove the public self-service signup route is closed. Every HTTP
 * method must return 403, no account is created, and the response shape is
 * the stable disabled-signup payload.
 *
 * Run: npx tsx src/lib/__tests__/auth-signup-route.test.ts
 */

import assert from "node:assert";
import { DELETE, GET, PATCH, POST, PUT } from "@/app/api/auth/signup/route";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error: unknown) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function expectDisabled(res: Response, method: string) {
  assert.strictEqual(res.status, 403, `${method} expected 403, got ${res.status}`);
  const body = await res.json();
  assert.strictEqual(body.success, false, `${method} expected success=false`);
  assert.strictEqual(
    typeof body.error,
    "string",
    `${method} expected error message`,
  );
  assert.ok(
    /signup is disabled/i.test(body.error),
    `${method} expected disabled-signup error, got "${body.error}"`,
  );
}

(async () => {
  console.log("\nAuth Signup Route Contract Test\n");

  await test("POST /api/auth/signup returns 403", async () => {
    await expectDisabled(await POST(), "POST");
  });

  await test("GET /api/auth/signup returns 403", async () => {
    await expectDisabled(await GET(), "GET");
  });

  await test("PUT /api/auth/signup returns 403", async () => {
    await expectDisabled(await PUT(), "PUT");
  });

  await test("PATCH /api/auth/signup returns 403", async () => {
    await expectDisabled(await PATCH(), "PATCH");
  });

  await test("DELETE /api/auth/signup returns 403", async () => {
    await expectDisabled(await DELETE(), "DELETE");
  });

  await test("response has no auth cookie (no account created)", async () => {
    const res = await POST();
    const setCookie = res.headers.get("set-cookie");
    assert.strictEqual(
      setCookie,
      null,
      `expected no Set-Cookie, got "${setCookie}"`,
    );
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
