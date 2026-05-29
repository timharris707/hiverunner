import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { tryCanonicalRewrite, tryLegacyRedirect } from "@/middleware";
import { EDGE_ROUTE_MAPS_FALLBACK } from "@/lib/orchestration/edge-route-maps";

/**
 * Characterization test for the `/HIVE/...` dev navigation issue (RSC payload
 * fallback). See docs/onboarding-rsc-navigation.md for the full write-up.
 *
 * This does NOT fix the issue (that touches the broader `[companyCode]` ->
 * `(dashboard)/companies/[slug]` rewrite architecture, out of scope for the
 * onboarding split). It pins the architectural facts behind the symptom so a
 * future fix has a clear target and this test will flag if the shape changes.
 */
const origin = "http://localhost:3010";
const repoRoot = process.cwd();

// 1. The short company-code board path (`/HIVE/tasks`) has NO physical page.
//    It exists only because middleware rewrites it onto the canonical route.
const companyCodeTasksPage = path.join(repoRoot, "src", "app", "[companyCode]", "tasks", "page.tsx");
assert.equal(
  fs.existsSync(companyCodeTasksPage),
  false,
  "`/HIVE/tasks` is served via middleware rewrite, not a physical [companyCode]/tasks page",
);

// 2. The canonical destination IS a physical page under the dashboard group.
const canonicalTasksPage = path.join(repoRoot, "src", "app", "(dashboard)", "companies", "[slug]", "tasks", "page.tsx");
assert.ok(
  fs.existsSync(canonicalTasksPage),
  "canonical /companies/[slug]/tasks page should exist",
);

// 3. With the static fallback maps (the state on a fresh install, before any
//    company-derived edge map is fetched), `/HIVE/tasks` is rewritten — not
//    redirected — onto the canonical slug path. A client-side (soft) RSC
//    navigation to `/HIVE/tasks` therefore depends on this rewrite resolving
//    consistently AND on the canonical page not issuing its own redirect().
//    When the canonical page redirects (missing company / slug canonicalization)
//    during an RSC fetch, Next logs "Failed to fetch RSC payload" and falls back
//    to a hard browser navigation — the reported symptom.
const rewrite = tryCanonicalRewrite("/HIVE/tasks", new URLSearchParams("view=board&group=status"), origin, EDGE_ROUTE_MAPS_FALLBACK);
assert.ok(rewrite, "/HIVE/tasks should resolve to a canonical rewrite target");
assert.equal(
  rewrite?.pathname,
  "/companies/hiverunner-workspace/tasks",
  "the fallback maps rewrite HIVE -> hiverunner-workspace",
);
assert.equal(rewrite?.searchParams.get("view"), "board");

// 4. A bare `/HIVE` is handled separately (a redirect to /HIVE/dashboard happens
//    in middleware itself), and canonical rewrite returns the dashboard target.
const bareRewrite = tryCanonicalRewrite("/HIVE", new URLSearchParams(), origin, EDGE_ROUTE_MAPS_FALLBACK);
assert.equal(bareRewrite?.pathname, "/companies/hiverunner-workspace/dashboard");

// 5. The onboarding split deliberately routes to PHYSICAL pages (/setup,
//    /companies/new, /companies/[slug]/dashboard), so first-run navigation never
//    relies on the [companyCode] rewrite and is unaffected by this issue.
assert.equal(
  tryCanonicalRewrite("/setup", new URLSearchParams(), origin, EDGE_ROUTE_MAPS_FALLBACK),
  null,
  "/setup is a real physical route and must not be rewritten",
);
assert.equal(
  tryLegacyRedirect("/companies/new", new URLSearchParams(), origin, EDGE_ROUTE_MAPS_FALLBACK),
  null,
  "/companies/new must never be redirected by the legacy company rewriter",
);

console.log("PASS companycode-rewrite-rsc (characterization)");
