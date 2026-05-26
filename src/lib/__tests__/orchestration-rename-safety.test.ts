import assert from "node:assert";

import { tryCanonicalRewrite, tryLegacyRedirect } from "@/middleware";
import { buildEdgeRouteMaps } from "@/lib/orchestration/edge-route-map-service";
import {
  createCompany,
  getCompany,
  resolveCompanyIdBySlug,
  updateCompany,
} from "@/lib/orchestration/company-service";
import { createProject } from "@/lib/orchestration/service";

let passed = 0;
let failed = 0;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error: unknown) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${errorMessage(error)}`);
  }
}

const ORIGIN = "http://localhost:3010";

// Use a unique suffix so re-runs don't collide on workspace_root.
const SUFFIX = Date.now().toString(36);

// ---------- Setup ----------

console.log("\nRename safety tests\n");

const company = createCompany({
  name: `Rename Labs ${SUFFIX}`,
  description: "Tests rename safety for companies.",
  status: "active",
}).company;

const originalSlug = company.slug;
const originalCode = company.code;
const originalWorkspaceSlug = company.workspaceSlug;
const originalRuntimeSlug = company.runtimeSlug;

const project = createProject({
  companyId: company.id,
  name: "Rename Project",
  description: "Project under renameable company.",
  color: "#10b981",
  emoji: "🔄",
  status: "active",
}).project;

// ---------- 1. Display-name-only change is safe ----------

test("name-only change: company is retrievable by original slug", () => {
  updateCompany({ companySlug: originalSlug, name: `Rename Labs Rebranded ${SUFFIX}` });
  const { company: fetched } = getCompany(originalSlug);
  assert.strictEqual(fetched.name, `Rename Labs Rebranded ${SUFFIX}`);
  assert.strictEqual(fetched.slug, originalSlug);
  assert.strictEqual(fetched.workspaceSlug, originalWorkspaceSlug);
  assert.strictEqual(fetched.runtimeSlug, originalRuntimeSlug);
  assert.strictEqual(fetched.code, originalCode);
});

test("name-only change: canonical route still resolves", () => {
  const maps = buildEdgeRouteMaps();
  const rewritten = tryCanonicalRewrite(
    `/${originalCode}/dashboard`,
    new URLSearchParams(),
    ORIGIN,
    maps,
  );
  assert.ok(rewritten);
  assert.strictEqual(rewritten?.pathname, `/companies/${originalSlug}/dashboard`);
});

test("name-only change: project route still resolves", () => {
  const maps = buildEdgeRouteMaps();
  const rewritten = tryCanonicalRewrite(
    `/${originalCode}/projects/${project.slug}/tasks`,
    new URLSearchParams(),
    ORIGIN,
    maps,
  );
  assert.ok(rewritten);
  assert.strictEqual(
    rewritten?.pathname,
    `/companies/${originalSlug}/projects/${project.slug}/tasks`,
  );
});

// ---------- 2. Slug change creates durable alias ----------

const newSlug = `rename-labs-v2-${SUFFIX}`;

test("slug change: update succeeds", () => {
  const { company: updated } = updateCompany({
    companySlug: originalSlug,
    slug: newSlug,
  });
  assert.strictEqual(updated.slug, newSlug);
  assert.strictEqual(updated.workspaceSlug, originalWorkspaceSlug);
  assert.strictEqual(updated.runtimeSlug, originalRuntimeSlug);
  assert.strictEqual(updated.code, originalCode);
});

test("slug change: company is retrievable by NEW slug", () => {
  const { company: fetched } = getCompany(newSlug);
  assert.strictEqual(fetched.slug, newSlug);
  assert.strictEqual(fetched.workspaceSlug, originalWorkspaceSlug);
  assert.strictEqual(fetched.runtimeSlug, originalRuntimeSlug);
  assert.strictEqual(fetched.code, originalCode);
});

test("slug change: company is STILL retrievable by OLD slug via alias", () => {
  const { company: fetched } = getCompany(originalSlug);
  // getCompany resolves via alias, but returns the canonical (current) slug.
  assert.strictEqual(fetched.slug, newSlug);
  assert.strictEqual(fetched.workspaceSlug, originalWorkspaceSlug);
  assert.strictEqual(fetched.runtimeSlug, originalRuntimeSlug);
  assert.strictEqual(fetched.code, originalCode);
});

test("slug change: edge route maps include old slug as alias", () => {
  const maps = buildEdgeRouteMaps();
  // Canonical mapping uses the new slug.
  assert.strictEqual(maps.companyCodeToSlug[originalCode], newSlug);
  assert.strictEqual(maps.companySlugToCode[newSlug], originalCode);
  // Old slug is present as an alias in the slug-to-code map.
  assert.strictEqual(maps.companySlugToCode[originalSlug], originalCode);
});

test("slug change: canonical rewrite uses NEW slug", () => {
  const maps = buildEdgeRouteMaps();
  const rewritten = tryCanonicalRewrite(
    `/${originalCode}/dashboard`,
    new URLSearchParams(),
    ORIGIN,
    maps,
  );
  assert.ok(rewritten);
  assert.strictEqual(rewritten?.pathname, `/companies/${newSlug}/dashboard`);
});

test("slug change: legacy redirect from OLD slug resolves to company code", () => {
  const maps = buildEdgeRouteMaps();
  const redirected = tryLegacyRedirect(
    `/companies/${originalSlug}/dashboard`,
    new URLSearchParams(),
    ORIGIN,
    maps,
  );
  assert.ok(redirected);
  assert.strictEqual(redirected?.pathname, `/${originalCode}/dashboard`);
});

test("slug change: legacy redirect from NEW slug also works", () => {
  const maps = buildEdgeRouteMaps();
  const redirected = tryLegacyRedirect(
    `/companies/${newSlug}/dashboard`,
    new URLSearchParams(),
    ORIGIN,
    maps,
  );
  assert.ok(redirected);
  assert.strictEqual(redirected?.pathname, `/${originalCode}/dashboard`);
});

// ---------- 3. Multiple renames preserve full alias history ----------

const thirdSlug = `rename-labs-final-${SUFFIX}`;

test("second slug change: preserves both old aliases", () => {
  updateCompany({ companySlug: newSlug, slug: thirdSlug });

  const maps = buildEdgeRouteMaps();
  // Both old slugs should map to the company code.
  assert.strictEqual(maps.companySlugToCode[originalSlug], originalCode);
  assert.strictEqual(maps.companySlugToCode[newSlug], originalCode);
  assert.strictEqual(maps.companySlugToCode[thirdSlug], originalCode);
  // Canonical code→slug points to the latest slug.
  assert.strictEqual(maps.companyCodeToSlug[originalCode], thirdSlug);
});

test("second slug change: company fetchable by any historical slug", () => {
  const c1 = getCompany(originalSlug);
  const c2 = getCompany(newSlug);
  const c3 = getCompany(thirdSlug);
  assert.strictEqual(c1.company.slug, thirdSlug);
  assert.strictEqual(c2.company.slug, thirdSlug);
  assert.strictEqual(c3.company.slug, thirdSlug);
  assert.strictEqual(c1.company.runtimeSlug, originalRuntimeSlug);
  assert.strictEqual(c2.company.runtimeSlug, originalRuntimeSlug);
  assert.strictEqual(c3.company.runtimeSlug, originalRuntimeSlug);
});

// ---------- 4. Slug collision protection ----------

test("slug change: rejects slug already used by another company", () => {
  const other = createCompany({
    name: `Other Corp ${SUFFIX}`,
    description: "Slug collision test.",
    status: "active",
  }).company;

  try {
    updateCompany({ companySlug: thirdSlug, slug: other.slug });
    assert.fail("Expected slug collision error");
  } catch (error: unknown) {
    const message = errorMessage(error);
    assert.ok(
      message.includes("slug") || errorCode(error) === "company_slug_taken",
      `Unexpected error: ${message}`,
    );
  }
});

test("slug change: rejects slug that collides with an existing alias for another company", () => {
  // originalSlug is now an alias for our test company.
  // A different company should not be able to take it.
  const other2 = createCompany({
    name: `Alias Collision Corp ${SUFFIX}`,
    description: "Tests alias collision.",
    status: "active",
  }).company;

  try {
    updateCompany({ companySlug: other2.slug, slug: originalSlug });
    assert.fail("Expected alias collision error");
  } catch (error: unknown) {
    const message = errorMessage(error);
    assert.ok(
      message.includes("slug") || errorCode(error) === "company_slug_taken",
      `Unexpected error: ${message}`,
    );
  }
});

// ---------- 5. Seeded weather-edge alias works via DB ----------

test("weather-edge alias is present in DB-backed route maps", () => {
  const maps = buildEdgeRouteMaps();
  assert.strictEqual(maps.companySlugToCode["weather-edge"], "NEV");
});

test("weather-edge legacy redirect resolves to NEV dashboard", () => {
  const maps = buildEdgeRouteMaps();
  const redirected = tryLegacyRedirect(
    "/companies/weather-edge/dashboard",
    new URLSearchParams(),
    ORIGIN,
    maps,
  );
  assert.ok(redirected);
  assert.strictEqual(redirected?.pathname, "/NEV/dashboard");
});

// ---------- 6. resolveCompanyIdBySlug works for all identity forms ----------

test("resolveCompanyIdBySlug: resolves by current slug", () => {
  const resolved = resolveCompanyIdBySlug(thirdSlug);
  assert.ok(resolved);
  assert.strictEqual(resolved?.slug, thirdSlug);
  assert.strictEqual(resolved?.company_code, originalCode);
});

test("resolveCompanyIdBySlug: resolves by old slug alias", () => {
  const resolved = resolveCompanyIdBySlug(originalSlug);
  assert.ok(resolved);
  // Returns canonical (current) slug, not the alias used for lookup.
  assert.strictEqual(resolved?.slug, thirdSlug);
});

test("resolveCompanyIdBySlug: resolves by company UUID", () => {
  const id = getCompany(thirdSlug).company.id;
  const resolved = resolveCompanyIdBySlug(id);
  assert.ok(resolved);
  assert.strictEqual(resolved?.slug, thirdSlug);
});

test("resolveCompanyIdBySlug: resolves by company code", () => {
  const resolved = resolveCompanyIdBySlug(originalCode);
  assert.ok(resolved);
  assert.strictEqual(resolved?.slug, thirdSlug);
  assert.strictEqual(resolved?.company_code, originalCode);
});

test("resolveCompanyIdBySlug: returns undefined for unknown slug", () => {
  const resolved = resolveCompanyIdBySlug("nonexistent-slug-xyz");
  assert.strictEqual(resolved, undefined);
});

// ---------- 7. No future rename requires a code patch ----------

test("end-to-end: create company, rename slug twice, all APIs resolve via every historical slug", () => {
  const fresh = createCompany({
    name: `E2E Rename Corp ${SUFFIX}`,
    description: "Full lifecycle test.",
    status: "active",
  }).company;

  const slugA = fresh.slug;
  const slugB = `e2e-renamed-${SUFFIX}`;
  const slugC = `e2e-final-${SUFFIX}`;

  // Rename A → B
  updateCompany({ companySlug: slugA, slug: slugB });
  // Rename B → C
  updateCompany({ companySlug: slugB, slug: slugC });

  // All three slugs resolve via resolveCompanyIdBySlug
  for (const s of [slugA, slugB, slugC]) {
    const resolved = resolveCompanyIdBySlug(s);
    assert.ok(resolved, `resolveCompanyIdBySlug("${s}") returned undefined`);
    assert.strictEqual(resolved?.id, fresh.id);
  }

  // All three slugs resolve via getCompany (full API)
  for (const s of [slugA, slugB, slugC]) {
    const { company: c } = getCompany(s);
    assert.strictEqual(c.id, fresh.id);
    assert.strictEqual(c.slug, slugC); // canonical is always latest
  }

  // Edge route maps include all three
  const maps = buildEdgeRouteMaps();
  for (const s of [slugA, slugB, slugC]) {
    assert.strictEqual(maps.companySlugToCode[s], fresh.code);
  }
});

// ---------- 8. Creation path rejects slugs that collide with aliases ----------

test("createCompany: auto-increments slug when it collides with an existing alias", () => {
  // originalSlug is now an alias for our test company (thirdSlug).
  // Creating a new company whose name would derive the same slug must auto-increment.
  //
  // We need to manufacture a company whose slugified name = originalSlug.
  // originalSlug is something like "rename-labs-<suffix>".
  // createCompany slugifies the name, so pass the slug directly as the name-derived input.
  // Actually, we can't control the exact slug from name alone. Instead, test via
  // the service layer's slug uniqueness loop by checking that a created company
  // with a colliding slug gets a different slug.

  // First verify the alias exists.
  const aliasResolved = resolveCompanyIdBySlug(originalSlug);
  assert.ok(aliasResolved, "originalSlug should resolve via alias");

  // Try to create with the exact slug that's already an alias.
  // createCompany auto-increments on collision, so it should succeed with a different slug.
  const { company: created } = createCompany({
    name: `test-collision-${SUFFIX}`,
    slug: originalSlug, // explicitly request the aliased slug
    description: "Should get a different slug due to alias collision.",
    status: "active",
  });

  assert.notStrictEqual(created.slug, originalSlug,
    "Created company should NOT get the aliased slug");
  assert.ok(created.slug.startsWith(originalSlug),
    "Created company slug should be an auto-incremented variant");
});

test("createCompany: slug cannot silently shadow an alias from another company", () => {
  // After the auto-increment, verify the alias still resolves to the original company.
  const aliasResolved = resolveCompanyIdBySlug(originalSlug);
  assert.ok(aliasResolved);
  assert.strictEqual(aliasResolved?.slug, thirdSlug,
    "Alias should still resolve to the original company, not the new one");
});

// ---------- 9. Rename then create cannot create ambiguity ----------

test("rename-then-create cannot create slug/alias ambiguity", () => {
  // Create company X, rename X's slug to Y, then create company Z
  // with name that would derive slug X.
  // Z must NOT get slug X (it's now an alias for X's company).
  const x = createCompany({
    name: `Ambiguity Test X ${SUFFIX}`,
    description: "Ambiguity test.",
    status: "active",
  }).company;
  const xOriginalSlug = x.slug;

  // Rename X → Y
  updateCompany({ companySlug: xOriginalSlug, slug: `ambiguity-y-${SUFFIX}` });

  // Create Z with slug that would be xOriginalSlug
  const z = createCompany({
    name: `test-z-${SUFFIX}`,
    slug: xOriginalSlug, // request the now-aliased slug
    description: "Should not get the aliased slug.",
    status: "active",
  }).company;

  assert.notStrictEqual(z.slug, xOriginalSlug,
    "New company must not shadow the alias");

  // Verify alias still points to X
  const resolved = resolveCompanyIdBySlug(xOriginalSlug);
  assert.ok(resolved);
  assert.strictEqual(resolved?.id, x.id);
});

// ---------- 10. Cache invalidation on rename ----------

test("cache invalidation: globalThis version is bumped on slug change", () => {
  const g = globalThis as typeof globalThis & { __mcEdgeRouteMapVersion?: number };
  const versionBefore = g.__mcEdgeRouteMapVersion ?? 0;

  const temp = createCompany({
    name: `Cache Test ${SUFFIX}`,
    description: "Tests cache invalidation.",
    status: "active",
  }).company;

  // Name-only change should NOT bump version.
  updateCompany({ companySlug: temp.slug, name: `Cache Test Renamed ${SUFFIX}` });
  const versionAfterName = g.__mcEdgeRouteMapVersion ?? 0;
  assert.strictEqual(versionAfterName, versionBefore,
    "Name-only change should not bump cache version");

  // Slug change SHOULD bump version.
  updateCompany({ companySlug: temp.slug, slug: `cache-test-new-${SUFFIX}` });
  const versionAfterSlug = g.__mcEdgeRouteMapVersion ?? 0;
  assert.ok(versionAfterSlug > versionBefore,
    "Slug change should bump cache version");
});

// ---------- Summary ----------

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
