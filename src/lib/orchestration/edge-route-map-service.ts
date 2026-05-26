import { getOrchestrationDb } from "@/lib/orchestration/db";
import type { EdgeRouteMaps } from "@/lib/orchestration/edge-route-maps";
import { withEdgeRouteMapFallback } from "@/lib/orchestration/edge-route-maps";

type CompanyRouteRow = {
  slug: string;
  company_code: string | null;
};

type ProjectRouteRow = {
  id: string;
  slug: string | null;
  company_slug: string;
};

type SlugAliasRow = {
  slug_alias: string;
  company_code: string;
};

type ProjectAliasRow = {
  slug_alias: string;
  canonical_slug: string;
};

export function buildEdgeRouteMaps(): EdgeRouteMaps {
  const db = getOrchestrationDb();

  const companyRows = db.prepare(
    `SELECT slug, company_code
       FROM companies
      WHERE company_code IS NOT NULL
        AND TRIM(company_code) <> ''
      ORDER BY created_at ASC, rowid ASC`
  ).all() as CompanyRouteRow[];

  const projectRows = db.prepare(
    `SELECT p.id, p.slug, c.slug AS company_slug
       FROM projects p
       INNER JOIN companies c ON c.id = p.company_id
      WHERE p.slug IS NOT NULL
        AND TRIM(p.slug) <> ''`
  ).all() as ProjectRouteRow[];

  // Include durable slug aliases so old URLs resolve after renames.
  const aliasRows = db.prepare(
    `SELECT a.slug_alias, c.company_code
       FROM company_slug_aliases a
       INNER JOIN companies c ON c.id = a.company_id
      WHERE c.company_code IS NOT NULL
        AND TRIM(c.company_code) <> ''`
  ).all() as SlugAliasRow[];

  // Project slug aliases: old project slug → current canonical slug.
  const projectAliasRows = db.prepare(
    `SELECT pa.slug_alias, p.slug AS canonical_slug
       FROM project_slug_aliases pa
       INNER JOIN projects p ON p.id = pa.project_id
      WHERE p.slug IS NOT NULL
        AND TRIM(p.slug) <> ''`
  ).all() as ProjectAliasRow[];

  const companyCodeToSlug: Record<string, string> = {};
  const companySlugToCode: Record<string, string> = {};
  const actualCompanyCodes: string[] = [];
  const projectIdToSlugByCompany: Record<string, Record<string, string>> = {};
  const projectSlugAliasToCanonical: Record<string, string> = {};

  for (const row of companyRows) {
    const slug = row.slug.trim();
    const code = row.company_code?.trim().toUpperCase() ?? "";
    if (!slug || !code) continue;
    companyCodeToSlug[code] = slug;
    companySlugToCode[slug] = code;
    actualCompanyCodes.push(code);
  }

  // Aliases map old slugs → company code, enabling legacy redirect resolution.
  // They never overwrite the canonical slug → code mapping.
  for (const row of aliasRows) {
    const alias = row.slug_alias.trim();
    const code = row.company_code.trim().toUpperCase();
    if (!alias || !code) continue;
    if (!companySlugToCode[alias]) {
      companySlugToCode[alias] = code;
    }
  }

  for (const row of projectRows) {
    const companySlug = row.company_slug.trim();
    const projectSlug = row.slug?.trim() ?? "";
    if (!companySlug || !projectSlug) continue;
    if (!projectIdToSlugByCompany[companySlug]) {
      projectIdToSlugByCompany[companySlug] = {};
    }
    projectIdToSlugByCompany[companySlug][row.id] = projectSlug;
  }

  for (const row of projectAliasRows) {
    const alias = row.slug_alias.trim();
    const canonical = row.canonical_slug.trim();
    if (!alias || !canonical) continue;
    projectSlugAliasToCanonical[alias] = canonical;
  }

  return {
    companyCodeToSlug,
    companySlugToCode,
    actualCompanyCodes,
    projectIdToSlugByCompany,
    projectSlugAliasToCanonical,
    generatedAt: new Date().toISOString(),
  };
}

type GlobalCacheState = {
  __mcEdgeRouteMapCache?: {
    maps: EdgeRouteMaps;
    expiresAt: number;
    version: number;
  };
  __mcEdgeRouteMapVersion?: number;
};

const EDGE_ROUTE_MAP_CACHE_TTL_MS = 30_000;

/**
 * Bump the edge route map version AND eagerly rebuild the cache from the DB.
 * This runs in the Node.js server process and writes directly to globalThis,
 * which the middleware reads from on the next request — no HTTP self-fetch needed.
 */
export function refreshEdgeRouteMapCache(): void {
  const g = globalThis as typeof globalThis & GlobalCacheState;
  g.__mcEdgeRouteMapVersion = (g.__mcEdgeRouteMapVersion ?? 0) + 1;

  try {
    const maps = buildEdgeRouteMaps();
    const merged = withEdgeRouteMapFallback(maps);
    g.__mcEdgeRouteMapCache = {
      maps: merged,
      expiresAt: Date.now() + EDGE_ROUTE_MAP_CACHE_TTL_MS,
      version: g.__mcEdgeRouteMapVersion,
    };
  } catch {
    // DB access failed; middleware will try HTTP fetch as fallback.
  }
}
