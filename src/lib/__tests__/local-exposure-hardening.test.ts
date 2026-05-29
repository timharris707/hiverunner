/**
 * Regression tests for local exposure hardening.
 * Run: node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/local-exposure-hardening.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";

import {
  isSensitiveLocalSingleUserApiPath,
  middleware,
  shouldBlockLocalSingleUserSensitiveApi,
} from "@/middleware";

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
  console.log("\nLocal Exposure Hardening Contract Test\n");

  const originalAuthMode = process.env.MC_AUTH_MODE;
  const originalNodeEnv = process.env.NODE_ENV;

  try {
    process.env.MC_AUTH_MODE = "local-single-user";
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "development",
      configurable: true,
      enumerable: true,
      writable: true,
    });

    await test("server defaults local bind to loopback unless HOST is explicitly set", () => {
      const serverSource = readFileSync(join(process.cwd(), "server.js"), "utf8");

      assert.match(serverSource, /process\.env\.HOST\?\.trim\(\) \|\| "127\.0\.0\.1"/);
      assert.doesNotMatch(serverSource, /const hostname = "0\.0\.0\.0"/);
      assert.match(serverSource, /WARNING: binding HiveRunner to/);
      assert.match(serverSource, /HOST=0\.0\.0\.0/);
    });

    await test("classifies sensitive local-single-user APIs", () => {
      assert.equal(isSensitiveLocalSingleUserApiPath("/api/files"), true);
      assert.equal(isSensitiveLocalSingleUserApiPath("/api/files/workspace/read"), true);
      assert.equal(isSensitiveLocalSingleUserApiPath("/api/terminal"), true);
      assert.equal(isSensitiveLocalSingleUserApiPath("/api/settings/profile"), true);
      assert.equal(isSensitiveLocalSingleUserApiPath("/api/tasks/INS-1"), true);
      assert.equal(isSensitiveLocalSingleUserApiPath("/api/git/status"), true);
      assert.equal(isSensitiveLocalSingleUserApiPath("/api/search"), true);
      assert.equal(isSensitiveLocalSingleUserApiPath("/api/sessions/current"), true);

      assert.equal(isSensitiveLocalSingleUserApiPath("/api/tasks-public"), false);
      assert.equal(isSensitiveLocalSingleUserApiPath("/api/health"), false);
    });

    await test("allows sensitive APIs from loopback in local-single-user mode", async () => {
      const request = new NextRequest("http://localhost:3010/api/tasks", {
        headers: { host: "localhost:3010" },
      });

      const response = await middleware(request, async () => {
        throw new Error("sensitive local API guard should not need session lookup");
      });

      assert.equal(shouldBlockLocalSingleUserSensitiveApi("/api/tasks", "localhost:3010"), false);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");
    });

    await test("rejects sensitive APIs from non-loopback hosts in local-single-user mode", async () => {
      const request = new NextRequest("http://192.168.1.44:3010/api/tasks", {
        headers: { host: "192.168.1.44:3010" },
      });

      const response = await middleware(request, async () => {
        throw new Error("non-loopback local API request should fail before session lookup");
      });

      assert.equal(shouldBlockLocalSingleUserSensitiveApi("/api/tasks", "192.168.1.44:3010"), true);
      assert.equal(response.status, 403);

      const body = await response.json() as { error?: { code?: string } };
      assert.equal(body.error?.code, "local_access_required");
    });

    await test("documents Host-spoof caveat when remote socket address is unavailable", async () => {
      const request = new NextRequest("http://192.168.1.44:3010/api/tasks", {
        headers: { host: "localhost:3010" },
      });

      const response = await middleware(request, async () => {
        throw new Error("Host-spoof caveat should be documented without faking remote socket detection");
      });

      assert.equal(request.nextUrl.hostname, "192.168.1.44");
      assert.equal(shouldBlockLocalSingleUserSensitiveApi("/api/tasks", "localhost:3010"), false);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");

      const middlewareSource = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");
      assert.match(middlewareSource, /Host\/browser-origin hardening/);
      assert.match(middlewareSource, /not a substitute/);

      const serverSource = readFileSync(join(process.cwd(), "server.js"), "utf8");
      assert.match(serverSource, /unsafe for untrusted LANs/);
    });

    await test("does not apply local-only sensitive API guard in hosted Supabase mode", async () => {
      process.env.MC_AUTH_MODE = "supabase";

      const request = new NextRequest("http://app.example.com/api/tasks", {
        headers: { host: "app.example.com" },
      });

      const response = await middleware(request, async () => {
        throw new Error("internal API compatibility should not need session lookup here");
      });

      assert.equal(shouldBlockLocalSingleUserSensitiveApi("/api/tasks", "app.example.com"), false);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");
    });

    await test("terminal allowlist blocks obvious indirect command execution escapes", () => {
      const terminalSource = readFileSync(join(process.cwd(), "src/app/api/terminal/route.ts"), "utf8");

      assert.doesNotMatch(terminalSource, /'awk'/);
      assert.doesNotMatch(terminalSource, /'xargs'/);
      assert.match(terminalSource, /\\bawk\\b/);
      assert.match(terminalSource, /\\bxargs\\b/);
      assert.match(terminalSource, /\\s-exec\\b/);
    });
  } finally {
    if (originalAuthMode === undefined) {
      delete process.env.MC_AUTH_MODE;
    } else {
      process.env.MC_AUTH_MODE = originalAuthMode;
    }

    Object.defineProperty(process.env, "NODE_ENV", {
      value: originalNodeEnv,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
