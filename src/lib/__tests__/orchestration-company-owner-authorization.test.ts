import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { NextRequest } from "next/server";

import { GET as listCompaniesRoute } from "@/app/api/orchestration/companies/route";
import { GET as getCompanyRoute } from "@/app/api/orchestration/companies/[slug]/route";
import { GET as listProjectsRoute } from "@/app/api/orchestration/projects/route";
import { LOCAL_DEV_SESSION_COOKIE } from "@/lib/auth/local-dev-session";
import { createCompany, getCompany, listCompanies } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { middleware } from "@/middleware";

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

function apiRequest(url: string, userId: string): NextRequest {
  return new NextRequest(url, {
    headers: {
      "x-mc-api-key": "owner-auth-test-key",
      "x-mc-run-as-user-id": userId,
    },
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
  console.log("\nOrchestration Company Owner Authorization Test\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const originalApiKey = process.env.MC_API_KEY;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAuthMode = process.env.MC_AUTH_MODE;
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalSupabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const originalAdminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL;
  const originalLocalOwnerEmail = process.env.MC_LOCAL_OWNER_EMAIL;
  process.env.MC_API_KEY = "owner-auth-test-key";
  setNodeEnv("production");

  try {
    const suffix = Date.now();
    const owned = createCompany({
      name: `Owned Auth ${suffix}`,
      description: "owner authorization",
      status: "active",
      owner: { displayName: "Owner A", email: `owner-a-${suffix}@example.test` },
    }).company;
    const unowned = createCompany({
      name: `Other Auth ${suffix}`,
      description: "owner authorization",
      status: "active",
      owner: { displayName: "Owner B", email: `owner-b-${suffix}@example.test` },
    }).company;
    const ownerA = owned.owner?.id;
    const ownerB = unowned.owner?.id;
    assert.ok(ownerA);
    assert.ok(ownerB);

    await test("company service lists only companies owned by the scoped user", () => {
      const rows = listCompanies({ includeNonProduction: true, ownerUserId: ownerA }).companies;
      assert.ok(rows.some((row) => row.id === owned.id));
      assert.equal(rows.some((row) => row.id === unowned.id), false);
    });

    await test("company service preserves authorized company_code lookup", () => {
      const byCode = getCompany(owned.code, { ownerUserId: ownerA }).company;
      assert.equal(byCode.id, owned.id);
      assert.throws(() => getCompany(unowned.code, { ownerUserId: ownerA }), /Company not found/);
    });

    await test("company list route returns empty for a non-owner probe", async () => {
      const response = await listCompaniesRoute(apiRequest("http://localhost/api/orchestration/companies?includeNonProduction=true", "non-owner"));
      assert.equal(response.status, 200);
      const payload = await response.json() as { companies: Array<{ id: string }> };
      assert.deepEqual(payload.companies, []);
    });

    await test("loopback local-dev session resolves to the configured local owner", async () => {
      setNodeEnv("development");
      process.env.MC_AUTH_MODE = "supabase";
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
      process.env.MC_LOCAL_OWNER_EMAIL = owned.owner?.email ?? "";

      const response = await listCompaniesRoute(new NextRequest(
        "http://localhost:3010/api/orchestration/companies?includeNonProduction=true",
        {
          headers: {
            host: "localhost:3010",
            cookie: `${LOCAL_DEV_SESSION_COOKIE}=1`,
          },
        },
      ));

      assert.equal(response.status, 200);
      const payload = await response.json() as { companies: Array<{ id: string }> };
      const ids = new Set(payload.companies.map((company) => company.id));
      assert.equal(ids.has(owned.id), true);
      assert.equal(ids.has(unowned.id), false);
    });

    await test("local-single-user loopback API resolves to the configured local owner without a cookie", async () => {
      setNodeEnv("development");
      process.env.MC_AUTH_MODE = "local-single-user";
      process.env.MC_LOCAL_OWNER_EMAIL = owned.owner?.email ?? "";

      const response = await listCompaniesRoute(new NextRequest(
        "http://localhost:3010/api/orchestration/companies?includeNonProduction=true",
        { headers: { host: "localhost:3010" } },
      ));

      assert.equal(response.status, 200);
      const payload = await response.json() as { companies: Array<{ id: string }> };
      const ids = new Set(payload.companies.map((company) => company.id));
      assert.equal(ids.has(owned.id), true);
      assert.equal(ids.has(unowned.id), false);
    });

    await test("local-single-user repairs configured admin-email owner aliases without exposing unrelated owners", async () => {
      const legacyInsight = createCompany({
        name: `Insight Alias ${suffix}`,
        description: "historical local owner alias",
        status: "active",
        owner: { displayName: "Historical Tim", email: `admin-alias-${suffix}@example.test` },
      }).company;
      assert.ok(legacyInsight.owner?.id);

      const db = getOrchestrationDb();
      db.prepare(
        `UPDATE companies
         SET company_code = 'INS',
             slug = 'insight',
             name = 'Insight',
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`
      ).run(legacyInsight.id);

      setNodeEnv("development");
      process.env.MC_AUTH_MODE = "local-single-user";
      process.env.MC_LOCAL_OWNER_EMAIL = owned.owner?.email ?? "";
      process.env.NEXT_PUBLIC_ADMIN_EMAIL = legacyInsight.owner.email;

      const response = await listCompaniesRoute(new NextRequest(
        "http://localhost:3010/api/orchestration/companies?includeNonProduction=true",
        { headers: { host: "localhost:3010" } },
      ));

      assert.equal(response.status, 200);
      const payload = await response.json() as { companies: Array<{ id: string }> };
      const ids = new Set(payload.companies.map((company) => company.id));
      assert.equal(ids.has(owned.id), true);
      assert.equal(ids.has(legacyInsight.id), true);
      assert.equal(ids.has(unowned.id), false);

      const repaired = db
        .prepare("SELECT owner_user_id FROM companies WHERE id = ?")
        .get(legacyInsight.id) as { owner_user_id: string };
      const canonicalOwner = db
        .prepare("SELECT owner_user_id FROM companies WHERE id = ?")
        .get(owned.id) as { owner_user_id: string };
      assert.equal(repaired.owner_user_id, canonicalOwner.owner_user_id);
    });

    await test("company detail route denies forged company_code selection for a non-owner", async () => {
      const response = await getCompanyRoute(
        apiRequest(`http://localhost/api/orchestration/companies/${unowned.code}`, ownerA),
        { params: Promise.resolve({ slug: unowned.code }) },
      );
      assert.equal(response.status, 404);
    });

    await test("project query route cannot select an unowned ?company=", async () => {
      const response = await listProjectsRoute(apiRequest(
        `http://localhost/api/orchestration/projects?company=${encodeURIComponent(unowned.code)}`,
        ownerA,
      ));
      assert.equal(response.status, 404);
    });

    await test("middleware rejects forged run-as company context without API key", async () => {
      const request = new NextRequest(
        `http://localhost/api/orchestration/projects?company=${encodeURIComponent(unowned.code)}`,
        {
          headers: {
            "x-mc-run-as-user-id": ownerA,
          },
        },
      );
      const response = await middleware(request, async () => {
        throw new Error("run-as without API key must be rejected before session auth");
      });
      assert.equal(response.status, 401);
    });
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.MC_API_KEY;
    } else {
      process.env.MC_API_KEY = originalApiKey;
    }
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
    if (originalAdminEmail === undefined) {
      delete process.env.NEXT_PUBLIC_ADMIN_EMAIL;
    } else {
      process.env.NEXT_PUBLIC_ADMIN_EMAIL = originalAdminEmail;
    }
    if (originalLocalOwnerEmail === undefined) {
      delete process.env.MC_LOCAL_OWNER_EMAIL;
    } else {
      process.env.MC_LOCAL_OWNER_EMAIL = originalLocalOwnerEmail;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
