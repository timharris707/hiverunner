import assert from "node:assert/strict";

import { tryCanonicalRewrite, tryLegacyRedirect } from "@/middleware";
import { EDGE_ROUTE_MAPS_FALLBACK } from "@/lib/orchestration/edge-route-maps";

/**
 * Regression guard for the company-route rewrite<->redirect loop that caused the
 * two-click / ERR_TOO_MANY_REDIRECTS navigation bug.
 *
 * The cycle was:
 *   tryCanonicalRewrite:  /{CODE}/sub            -> (rewrite)  /companies/{canonicalSlug}/sub
 *   tryLegacyRedirect:    /companies/{slug}/sub  -> (308)      /{CODE}/sub
 * Next re-runs middleware on the internal rewrite target, so redirecting the
 * CANONICAL slug back to the code form looped forever. The fix: tryLegacyRedirect
 * only redirects NON-canonical (legacy alias) slugs; the canonical slug renders.
 */
const origin = "http://localhost:3010";
const maps = EDGE_ROUTE_MAPS_FALLBACK;
const sp = (q = "") => new URLSearchParams(q);

// HIVE -> hiverunner-workspace is canonical; weather-edge -> NEV is a non-canonical alias.
const canonicalSlug = maps.companyCodeToSlug.HIVE;
assert.ok(canonicalSlug, "fixture: HIVE must have a canonical slug");

// 1. Canonical code URL rewrites onto the physical slug route.
const rw = tryCanonicalRewrite("/HIVE/dashboard", sp(), origin, maps);
assert.ok(rw, "/HIVE/dashboard should rewrite");
assert.equal(rw.pathname, `/companies/${canonicalSlug}/dashboard`);

// 2. THE FIX: the canonical slug must NOT redirect back to the code form.
assert.equal(
  tryLegacyRedirect(`/companies/${canonicalSlug}/dashboard`, sp(), origin, maps),
  null,
  "canonical slug subpath must not redirect (would form a rewrite<->redirect loop)",
);
assert.equal(tryLegacyRedirect(`/companies/${canonicalSlug}/tasks`, sp("view=board"), origin, maps), null);
assert.equal(tryLegacyRedirect(`/companies/${canonicalSlug}`, sp(), origin, maps), null, "canonical slug root must not redirect");

// 3. Composing rewrite then legacy-redirect on its target must not cycle.
assert.equal(
  tryLegacyRedirect(rw.pathname, sp(), origin, maps),
  null,
  "the rewrite target must not be redirected back -> loop is impossible",
);

// 4. Non-canonical ALIAS slugs still redirect to the canonical code URL (one hop)...
const aliasRedirect = tryLegacyRedirect("/companies/weather-edge/dashboard", sp(), origin, maps);
assert.ok(aliasRedirect, "alias slug should still redirect");
assert.equal(aliasRedirect.pathname, "/NEV/dashboard", "alias slug redirects to canonical code path");

// ...and that code path rewrites onto its canonical slug, which then does NOT redirect (terminates).
const aliasRewrite = tryCanonicalRewrite("/NEV/dashboard", sp(), origin, maps);
assert.ok(aliasRewrite);
assert.equal(aliasRewrite.pathname, `/companies/${maps.companyCodeToSlug.NEV}/dashboard`);
assert.equal(
  tryLegacyRedirect(aliasRewrite.pathname, sp(), origin, maps),
  null,
  "alias resolves to canonical slug and terminates (no further redirect)",
);

console.log("PASS middleware-canonical-redirect-loop");
