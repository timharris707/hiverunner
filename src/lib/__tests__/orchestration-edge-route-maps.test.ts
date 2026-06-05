import assert from "node:assert";

import { createSyncTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { tryCanonicalRewrite, tryLegacyRedirect } from "@/proxy";
import { buildEdgeRouteMaps } from "@/lib/orchestration/edge-route-map-service";
import { createCompany } from "@/lib/orchestration/company-service";
import { createProject } from "@/lib/orchestration/service";

const { finish, test } = createSyncTestRunner({ passLabel: "✓", failLabel: "✗" });

console.log("\nEdge route maps auto-sync test\n");

const company = createCompany({
  name: "Auto Sync Labs",
  description: "Verifies edge route maps read from the DB.",
  status: "active",
}).company;

const project = createProject({
  companyId: company.id,
  name: "Routing Core",
  description: "Canonical routing validation project.",
  color: "#7c3aed",
  emoji: "🧭",
  status: "active",
}).project;

const maps = buildEdgeRouteMaps();

test("new companies are present in DB-backed edge route maps", () => {
  assert.strictEqual(maps.companyCodeToSlug[company.code], company.slug);
  assert.strictEqual(maps.companySlugToCode[company.slug], company.code);
});

test("new projects are present in project-id redirect compatibility maps", () => {
  assert.strictEqual(maps.projectIdToSlugByCompany[company.slug]?.[project.id], project.slug);
});

test("canonical company-code URLs rewrite using the generated route map", () => {
  const rewritten = tryCanonicalRewrite(
    `/${company.code}/dashboard`,
    new URLSearchParams(),
    "http://localhost:3010",
    maps,
  );

  assert.ok(rewritten);
  assert.strictEqual(rewritten?.pathname, `/companies/${company.slug}/dashboard`);
});

test("legacy issue URLs are not kept alive as product routes", () => {
  const redirected = tryLegacyRedirect(
    `/companies/${company.slug}/issues`,
    new URLSearchParams([["projectId", project.id]]),
    "http://localhost:3010",
    maps,
  );

  assert.strictEqual(redirected, null);
});

test("legacy weather-edge company slug redirects to NEV canonical dashboard", () => {
  const redirected = tryLegacyRedirect(
    "/companies/weather-edge/dashboard",
    new URLSearchParams(),
    "http://localhost:3010",
  );

  assert.ok(redirected);
  assert.strictEqual(redirected?.pathname, "/NEV/dashboard");
});

test("bare weather-edge company route redirects to NEV dashboard", () => {
  const redirected = tryLegacyRedirect(
    "/companies/weather-edge",
    new URLSearchParams(),
    "http://localhost:3010",
  );

  assert.ok(redirected);
  assert.strictEqual(redirected?.pathname, "/NEV/dashboard");
});

finish();
