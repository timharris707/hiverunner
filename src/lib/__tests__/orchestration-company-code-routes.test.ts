import assert from "node:assert";
import { rmSync } from "node:fs";

import { NextRequest } from "next/server";

import { GET as getCompanyRoute } from "@/app/api/orchestration/companies/[slug]/route";
import { GET as getCompanyApprovalsRoute } from "@/app/api/orchestration/companies/[slug]/approvals/route";
import { createCompany } from "@/lib/orchestration/company-service";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  PASS ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  FAIL ${name}`);
      console.error(`    ${message}`);
    });
}

async function run() {
  console.log("\nOrchestration Company Code Route Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const originalApiKey = process.env.MC_API_KEY;
  process.env.MC_API_KEY = "company-code-route-test-key";

  const company = createCompany({
    name: `Code Route ${Date.now()}`,
    description: "fixture",
    status: "active",
    owner: { displayName: "Code Owner", email: `code-owner-${Date.now()}@example.test` },
  }).company;
  const ownerId = company.owner?.id;
  assert.ok(ownerId);
  const authReq = new NextRequest(`http://localhost/api/orchestration/companies/${company.code}`, {
    headers: {
      "x-mc-api-key": "company-code-route-test-key",
      "x-mc-run-as-user-id": ownerId,
    },
  });

  await test("company GET resolves by stable company code", async () => {
    const res = await getCompanyRoute(authReq, {
      params: Promise.resolve({ slug: company.code }),
    });

    assert.strictEqual(res.status, 200);
    const payload = (await res.json()) as { company: { id: string; code: string } };
    assert.strictEqual(payload.company.id, company.id);
    assert.strictEqual(payload.company.code, company.code);
  });

  await test("company approvals GET resolves by stable company code", async () => {
    const req = {
      nextUrl: new URL(`http://localhost/api/orchestration/companies/${company.code}/approvals?status=pending`),
    };

    const res = await getCompanyApprovalsRoute(req as never, {
      params: Promise.resolve({ slug: company.code }),
    });

    assert.strictEqual(res.status, 200);
    const payload = (await res.json()) as { approvals: unknown[] };
    assert.deepStrictEqual(payload.approvals, []);
  });

  if (originalApiKey === undefined) {
    delete process.env.MC_API_KEY;
  } else {
    process.env.MC_API_KEY = originalApiKey;
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
