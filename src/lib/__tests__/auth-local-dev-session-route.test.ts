/**
 * Contract test for /api/auth/local-dev/session.
 * Run: npx tsx src/lib/__tests__/auth-local-dev-session-route.test.ts
 */

import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import {
  createLocalDevSessionResponse,
  isLoopbackHost,
  isLocalDevSessionRequestAllowed,
} from "@/lib/auth/local-dev-session-response";
import { LOCAL_DEV_SESSION_COOKIE } from "@/lib/auth/local-dev-session";
import { LOCAL_OWNER_ID } from "@/lib/auth/auth-mode";
import {
  auditSupabaseAdminOperation,
  createAdminClient,
  type SupabaseAdminAuditContext,
  type createServerSupabaseClient,
} from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

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

function setAuthMode(value: string | undefined) {
  if (value === undefined) {
    delete process.env.MC_AUTH_MODE;
  } else {
    process.env.MC_AUTH_MODE = value;
  }
}

async function run() {
  console.log("\nAuth Local Dev Session Route Contract Test\n");

  const originalNodeEnv = process.env.NODE_ENV;
  const originalEmail = process.env.MC_LOCAL_DEV_EMAIL;
  const originalPassword = process.env.MC_LOCAL_DEV_PASSWORD;
  const originalAuthMode = process.env.MC_AUTH_MODE;
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalSupabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Force Supabase mode for tests that exercise the Supabase code path.
  setAuthMode("supabase");
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

  try {
    await test("recognizes only loopback hosts", () => {
      assert.equal(isLoopbackHost("localhost:3010"), true);
      assert.equal(isLoopbackHost("127.0.0.1:3010"), true);
      assert.equal(isLoopbackHost("[::1]:3010"), true);
      assert.equal(isLoopbackHost("localhost.example.com:3010"), false);
      assert.equal(isLoopbackHost("mission-control.local:3010"), false);
    });

    await test("Supabase mode: allows only development loopback requests", () => {
      setNodeEnv("development");
      assert.equal(
        isLocalDevSessionRequestAllowed(new NextRequest("http://localhost:3010/api/auth/local-dev/session")),
        true,
      );
      assert.equal(
        isLocalDevSessionRequestAllowed(new NextRequest("http://localhost:3000/api/auth/local-dev/session")),
        true,
      );
      assert.equal(
        isLocalDevSessionRequestAllowed(new NextRequest("http://example.com/api/auth/local-dev/session")),
        false,
      );

      setNodeEnv("production");
      assert.equal(
        isLocalDevSessionRequestAllowed(new NextRequest("http://localhost:3010/api/auth/local-dev/session")),
        false,
      );
    });

    await test("Supabase mode: returns 404 outside development loopback", async () => {
      setNodeEnv("production");
      const request = new NextRequest("http://localhost:3010/api/auth/local-dev/session", {
        method: "POST",
        body: JSON.stringify({ email: "tim@localhost.test", password: "secret" }),
      });

      const response = await createLocalDevSessionResponse(request, async () => {
        throw new Error("Supabase client should not be created");
      });

      assert.equal(response.status, 404);
      const body = await response.json() as { success?: boolean };
      assert.equal(body.success, false);
    });

    await test("Supabase mode: requires local dev credentials before sign-in", async () => {
      setNodeEnv("development");
      delete process.env.MC_LOCAL_DEV_EMAIL;
      delete process.env.MC_LOCAL_DEV_PASSWORD;

      const request = new NextRequest("http://localhost:3010/api/auth/local-dev/session", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const response = await createLocalDevSessionResponse(request, async () => {
        throw new Error("Supabase client should not be created");
      });

      assert.equal(response.status, 400);
    });

    await test("Supabase mode: auto-provisions a loopback-only local dev user when requested", async () => {
      setNodeEnv("development");
      delete process.env.MC_LOCAL_DEV_EMAIL;
      delete process.env.MC_LOCAL_DEV_PASSWORD;

      const request = new NextRequest("http://localhost:3010/api/auth/local-dev/session", {
        method: "POST",
        body: JSON.stringify({ autoProvision: true }),
      });

      let createdUser: { email?: string; password?: string; email_confirm?: boolean } | undefined;
      let signInPayload: unknown;
      let adminContext: SupabaseAdminAuditContext | undefined;
      const response = await createLocalDevSessionResponse(
        request,
        async () => ({
          auth: {
            async signInWithPassword(payload: { email: string; password: string }) {
              signInPayload = payload;
              return {
                data: {
                  user: { id: "auto-provisioned-user", email: payload.email },
                },
                error: null,
              };
            },
          },
        } as ServerSupabaseClient),
        (context) => {
          adminContext = context;
          return {
            auth: {
              admin: {
                async createUser(payload: { email?: string; password?: string; email_confirm?: boolean }) {
                  createdUser = payload;
                  return { data: { user: { id: "auto-provisioned-user" } }, error: null };
                },
              },
            },
          };
        },
      );

      assert.equal(adminContext?.operation, "local-dev-session.auto-provision");
      assert.match(adminContext?.reason ?? "", /loopback-only local dev/i);
      assert.equal(adminContext?.route, "/api/auth/local-dev/session");
      assert.ok(createdUser);
      assert.equal(createdUser.email, "local-dev@localhost.test");
      assert.equal(createdUser.email_confirm, true);
      assert.equal(typeof createdUser.password, "string");
      assert.equal((createdUser.password ?? "").startsWith("local-dev-"), true);
      assert.equal((createdUser.password ?? "").length < 72, true);
      assert.deepEqual(signInPayload, {
        email: "local-dev@localhost.test",
        password: createdUser.password,
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`${LOCAL_DEV_SESSION_COOKIE}=1`));

      const body = await response.json() as { success?: boolean; user?: { id?: string; email?: string } };
      assert.equal(body.success, true);
      assert.equal(body.user?.id, "auto-provisioned-user");
      assert.equal(body.user?.email, "local-dev@localhost.test");
    });

    await test("Supabase mode: creates a session with provided local dev credentials", async () => {
      setNodeEnv("development");
      const request = new NextRequest("http://localhost:3010/api/auth/local-dev/session", {
        method: "POST",
        body: JSON.stringify({ email: "tim@localhost.test", password: "local-password" }),
      });

      let signInPayload: unknown;
      const response = await createLocalDevSessionResponse(request, async () => ({
        auth: {
          async signInWithPassword(payload: unknown) {
            signInPayload = payload;
            return {
              data: {
                user: { id: "local-dev-user", email: "tim@localhost.test" },
              },
              error: null,
            };
          },
        },
      } as ServerSupabaseClient));

      assert.deepEqual(signInPayload, {
        email: "tim@localhost.test",
        password: "local-password",
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`${LOCAL_DEV_SESSION_COOKIE}=1`));

      const body = await response.json() as { success?: boolean; user?: { id?: string; email?: string } };
      assert.equal(body.success, true);
      assert.equal(body.user?.id, "local-dev-user");
      assert.equal(body.user?.email, "tim@localhost.test");
    });

    await test("Supabase mode: creates a session on a strict side port from env credentials", async () => {
      setNodeEnv("development");
      process.env.MC_LOCAL_DEV_EMAIL = "side-port@localhost.test";
      process.env.MC_LOCAL_DEV_PASSWORD = "side-port-password";

      const request = new NextRequest("http://localhost:3000/api/auth/local-dev/session", {
        method: "POST",
        body: JSON.stringify({}),
      });

      let signInPayload: unknown;
      const response = await createLocalDevSessionResponse(request, async () => ({
        auth: {
          async signInWithPassword(payload: unknown) {
            signInPayload = payload;
            return {
              data: {
                user: { id: "side-port-user", email: "side-port@localhost.test" },
              },
              error: null,
            };
          },
        },
      } as ServerSupabaseClient));

      assert.deepEqual(signInPayload, {
        email: "side-port@localhost.test",
        password: "side-port-password",
      });
      assert.equal(response.status, 200);

      const body = await response.json() as { success?: boolean; user?: { id?: string; email?: string } };
      assert.equal(body.success, true);
      assert.equal(body.user?.id, "side-port-user");
      assert.equal(body.user?.email, "side-port@localhost.test");
    });

    await test("Supabase admin client requires explicit privileged context", () => {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      assert.throws(
        () => createAdminClient({ operation: "", reason: "missing operation test" }),
        /privileged operation name and reason/i,
      );
      assert.throws(
        () => createAdminClient({ operation: "test.missing-key", reason: "verify missing service role fails closed" }),
        /SUPABASE_SERVICE_ROLE_KEY/i,
      );
    });

    await test("Supabase admin audit marker is structured and secret-free", () => {
      const originalInfo = console.info;
      const messages: string[] = [];
      console.info = (message?: unknown) => {
        messages.push(String(message));
      };

      try {
        auditSupabaseAdminOperation({
          operation: "auth.admin.createUser",
          reason: "test audit marker",
          route: "/api/auth/local-dev/session",
          requestId: "request-123",
        });
      } finally {
        console.info = originalInfo;
      }

      assert.equal(messages.length, 1);
      assert.match(messages[0], /^\[security\] /);
      assert.match(messages[0], /"event":"supabase_admin_operation"/);
      assert.match(messages[0], /"operation":"auth.admin.createUser"/);
      assert.doesNotMatch(messages[0], /SERVICE_ROLE|secret|password/i);
    });

    // ── Local-single-user mode ────────────────────────────────────────────
    setAuthMode("local-single-user");
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    await test("local-single-user: allowed on loopback even when NODE_ENV is production", () => {
      setNodeEnv("production");
      assert.equal(
        isLocalDevSessionRequestAllowed(new NextRequest("http://localhost:3010/api/auth/local-dev/session")),
        true,
      );
      assert.equal(
        isLocalDevSessionRequestAllowed(new NextRequest("http://127.0.0.1:3010/api/auth/local-dev/session")),
        true,
      );
      assert.equal(
        isLocalDevSessionRequestAllowed(new NextRequest("http://example.com/api/auth/local-dev/session")),
        false,
      );
    });

    await test("local-single-user: short-circuits without invoking Supabase factory", async () => {
      setNodeEnv("development");
      const request = new NextRequest("http://localhost:3010/api/auth/local-dev/session", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const response = await createLocalDevSessionResponse(
        request,
        async () => {
          throw new Error("Supabase factory must not be called in local-single-user mode");
        },
        () => {
          throw new Error("Supabase admin must not be created in local-single-user mode");
        },
      );

      assert.equal(response.status, 200);
      assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`${LOCAL_DEV_SESSION_COOKIE}=1`));

      const body = await response.json() as {
        success?: boolean;
        mode?: string;
        user?: { id?: string; email?: string };
      };
      assert.equal(body.success, true);
      assert.equal(body.mode, "local-single-user");
      assert.equal(body.user?.id, LOCAL_OWNER_ID);
      assert.match(body.user?.email ?? "", /@/);
    });

    await test("local-single-user: respects MC_LOCAL_OWNER_EMAIL override", async () => {
      setNodeEnv("development");
      const original = process.env.MC_LOCAL_OWNER_EMAIL;
      process.env.MC_LOCAL_OWNER_EMAIL = "tim@custom-host";
      try {
        const request = new NextRequest("http://localhost:3010/api/auth/local-dev/session", {
          method: "POST",
          body: JSON.stringify({}),
        });

        const response = await createLocalDevSessionResponse(
          request,
          async () => {
            throw new Error("Supabase factory must not be called");
          },
        );

        const body = await response.json() as { user?: { email?: string } };
        assert.equal(body.user?.email, "tim@custom-host");
      } finally {
        if (original === undefined) {
          delete process.env.MC_LOCAL_OWNER_EMAIL;
        } else {
          process.env.MC_LOCAL_OWNER_EMAIL = original;
        }
      }
    });
  } finally {
    if (originalNodeEnv === undefined) {
      Reflect.deleteProperty(process.env, "NODE_ENV");
    } else {
      setNodeEnv(originalNodeEnv);
    }

    if (originalEmail === undefined) {
      delete process.env.MC_LOCAL_DEV_EMAIL;
    } else {
      process.env.MC_LOCAL_DEV_EMAIL = originalEmail;
    }

    if (originalPassword === undefined) {
      delete process.env.MC_LOCAL_DEV_PASSWORD;
    } else {
      process.env.MC_LOCAL_DEV_PASSWORD = originalPassword;
    }

    setAuthMode(originalAuthMode);
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
    if (originalServiceRoleKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
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
