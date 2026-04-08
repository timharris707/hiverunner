import assert from "node:assert";

import {
  createCompany,
} from "@/lib/orchestration/company-service";
import {
  createProject,
  getProject,
  updateProjectSettings,
} from "@/lib/orchestration/service";
import { buildEdgeRouteMaps } from "@/lib/orchestration/edge-route-map-service";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error?.message || String(error)}`);
  }
}

const SUFFIX = Date.now().toString(36);

console.log("\nProject rename safety tests\n");

// ---------- Setup ----------

const company = createCompany({
  name: `Project Rename Host ${SUFFIX}`,
  description: "Host company for project rename tests.",
  status: "active",
}).company;

const project = createProject({
  companyId: company.id,
  name: `Rename Project ${SUFFIX}`,
  description: "Tests project rename safety.",
  color: "#10b981",
  emoji: "🔄",
  status: "active",
}).project;

const originalSlug = project.slug;
const projectId = project.id;

// ---------- 1. Display-name-only change is safe ----------

test("name-only change: project is retrievable by original slug", () => {
  const { project: updated } = updateProjectSettings({
    projectIdOrSlug: originalSlug,
    name: `Rename Project Rebranded ${SUFFIX}`,
  });
  assert.strictEqual(updated.name, `Rename Project Rebranded ${SUFFIX}`);
  assert.strictEqual(updated.slug, originalSlug);
  assert.strictEqual(updated.id, projectId);
});

// ---------- 2. Slug change creates durable alias ----------

const newSlug = `renamed-project-${SUFFIX}`;

test("slug change: update succeeds", () => {
  const { project: updated } = updateProjectSettings({
    projectIdOrSlug: originalSlug,
    slug: newSlug,
  });
  assert.strictEqual(updated.slug, newSlug);
  assert.strictEqual(updated.id, projectId);
});

test("slug change: project is retrievable by NEW slug", () => {
  const { project: fetched } = getProject(newSlug);
  assert.strictEqual(fetched.slug, newSlug);
  assert.strictEqual(fetched.id, projectId);
});

test("slug change: project is STILL retrievable by OLD slug via alias", () => {
  const { project: fetched } = getProject(originalSlug);
  assert.strictEqual(fetched.slug, newSlug); // canonical
  assert.strictEqual(fetched.id, projectId);
});

test("slug change: project is retrievable by ID", () => {
  const { project: fetched } = getProject(projectId);
  assert.strictEqual(fetched.slug, newSlug);
});

// ---------- 3. Multiple renames preserve full alias history ----------

const thirdSlug = `project-final-${SUFFIX}`;

test("second slug change: preserves both old aliases", () => {
  updateProjectSettings({ projectIdOrSlug: newSlug, slug: thirdSlug });

  // All three slugs should resolve.
  for (const s of [originalSlug, newSlug, thirdSlug]) {
    const { project: fetched } = getProject(s);
    assert.strictEqual(fetched.id, projectId, `getProject("${s}") should resolve to project ID`);
    assert.strictEqual(fetched.slug, thirdSlug, `getProject("${s}") should return canonical slug`);
  }
});

// ---------- 4. Slug collision protection ----------

test("slug change: rejects slug already used by another project", () => {
  const other = createProject({
    companyId: company.id,
    name: `Other Project ${SUFFIX}`,
    description: "Collision target.",
    color: "#ef4444",
    emoji: "🎯",
    status: "active",
  }).project;

  try {
    updateProjectSettings({ projectIdOrSlug: thirdSlug, slug: other.slug });
    assert.fail("Expected slug collision error");
  } catch (error: any) {
    assert.ok(
      error.message?.includes("slug") || error.code === "project_slug_taken",
      `Unexpected error: ${error.message}`,
    );
  }
});

test("slug change: rejects slug that collides with an existing alias", () => {
  // originalSlug is now an alias for our test project.
  const other2 = createProject({
    companyId: company.id,
    name: `Alias Collision Project ${SUFFIX}`,
    description: "Tests alias collision.",
    color: "#f59e0b",
    emoji: "⚠️",
    status: "active",
  }).project;

  try {
    updateProjectSettings({ projectIdOrSlug: other2.slug, slug: originalSlug });
    assert.fail("Expected alias collision error");
  } catch (error: any) {
    assert.ok(
      error.message?.includes("slug") || error.code === "project_slug_taken",
      `Unexpected error: ${error.message}`,
    );
  }
});

// ---------- 5. Creation path rejects slugs that collide with aliases ----------

test("createProject: auto-increments slug when it collides with an alias", () => {
  const { project: created } = createProject({
    companyId: company.id,
    name: `collision-test-${SUFFIX}`,
    slug: originalSlug, // request an aliased slug
    description: "Should get a different slug.",
    color: "#6366f1",
    emoji: "🔀",
    status: "active",
  });

  assert.notStrictEqual(created.slug, originalSlug,
    "Created project should NOT get the aliased slug");
});

// ---------- 6. Rename then create cannot create ambiguity ----------

test("rename-then-create cannot create project slug/alias ambiguity", () => {
  const x = createProject({
    companyId: company.id,
    name: `Ambiguity X ${SUFFIX}`,
    description: "Ambiguity test.",
    color: "#8b5cf6",
    emoji: "🔮",
    status: "active",
  }).project;
  const xSlug = x.slug;

  // Rename X → Y
  updateProjectSettings({ projectIdOrSlug: xSlug, slug: `ambiguity-y-${SUFFIX}` });

  // Create Z requesting X's old slug
  const z = createProject({
    companyId: company.id,
    name: `test-z-${SUFFIX}`,
    slug: xSlug,
    description: "Should not shadow the alias.",
    color: "#ec4899",
    emoji: "🌸",
    status: "active",
  }).project;

  assert.notStrictEqual(z.slug, xSlug, "New project must not shadow the alias");

  // Alias still resolves to X
  const { project: resolved } = getProject(xSlug);
  assert.strictEqual(resolved.id, x.id);
});

// ---------- 7. Cache invalidation ----------

test("cache version bumped on project slug change", () => {
  const g = globalThis as typeof globalThis & { __mcEdgeRouteMapVersion?: number };
  const before = g.__mcEdgeRouteMapVersion ?? 0;

  const temp = createProject({
    companyId: company.id,
    name: `Cache Test Project ${SUFFIX}`,
    description: "Cache test.",
    color: "#14b8a6",
    emoji: "⚡",
    status: "active",
  }).project;

  // Name-only: should NOT bump
  updateProjectSettings({ projectIdOrSlug: temp.slug, name: `Renamed ${SUFFIX}` });
  assert.strictEqual(g.__mcEdgeRouteMapVersion ?? 0, before,
    "Name-only change should not bump cache version");

  // Slug change: SHOULD bump
  updateProjectSettings({ projectIdOrSlug: temp.slug, slug: `cache-proj-new-${SUFFIX}` });
  assert.ok((g.__mcEdgeRouteMapVersion ?? 0) > before,
    "Slug change should bump cache version");
});

// ---------- Summary ----------

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
