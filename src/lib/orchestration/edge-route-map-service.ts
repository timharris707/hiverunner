import { getOrchestrationDb } from "@/lib/orchestration/db";
import type { EdgeRouteMaps } from "@/lib/orchestration/edge-route-maps";

type CompanyRouteRow = {
  slug: string;
  company_code: string | null;
};

type ProjectRouteRow = {
  id: string;
  slug: string | null;
  company_slug: string;
};

export function buildEdgeRouteMaps(): EdgeRouteMaps {
  const db = getOrchestrationDb();

  const companyRows = db.prepare(
    `SELECT slug, company_code
       FROM companies
      WHERE company_code IS NOT NULL
        AND TRIM(company_code) <> ''`
  ).all() as CompanyRouteRow[];

  const projectRows = db.prepare(
    `SELECT p.id, p.slug, c.slug AS company_slug
       FROM projects p
       INNER JOIN companies c ON c.id = p.company_id
      WHERE p.slug IS NOT NULL
        AND TRIM(p.slug) <> ''`
  ).all() as ProjectRouteRow[];

  const companyCodeToSlug: Record<string, string> = {};
  const companySlugToCode: Record<string, string> = {};
  const projectIdToSlugByCompany: Record<string, Record<string, string>> = {};

  for (const row of companyRows) {
    const slug = row.slug.trim();
    const code = row.company_code?.trim().toUpperCase() ?? "";
    if (!slug || !code) continue;
    companyCodeToSlug[code] = slug;
    companySlugToCode[slug] = code;
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

  return {
    companyCodeToSlug,
    companySlugToCode,
    projectIdToSlugByCompany,
    generatedAt: new Date().toISOString(),
  };
}
