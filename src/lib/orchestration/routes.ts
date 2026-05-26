import "server-only";

import { listCompanies } from "@/lib/orchestration/company-service";
import { listProjects } from "@/lib/orchestration/service";
import {
  FALLBACK_COMPANY_SLUG,
  buildCanonicalProjectAgentsPath,
  buildCanonicalProjectBoardPath,
  buildCanonicalProjectTasksPath,
  buildCanonicalProjectSettingsPath,
  buildCompanyPath,
} from "@/lib/orchestration/route-paths";

export function getCompanyCodeMap(): Map<string, string> {
  const { companies } = listCompanies({ includeNonProduction: true, includeArchived: true });
  const byCode = new Map<string, string>();

  for (const company of companies) {
    const code = (company.code || "").trim().toUpperCase();
    if (!code) continue;
    if (!byCode.has(code)) {
      byCode.set(code, company.slug);
    }
  }

  return byCode;
}

export function resolveCompanySlugFromCode(companyCode: string): string | null {
  const normalized = (companyCode || "").trim().toUpperCase();
  if (!normalized) return null;
  return getCompanyCodeMap().get(normalized) ?? null;
}

export function getCompanyCode(companySlug: string): string {
  const { companies } = listCompanies({ includeNonProduction: true, includeArchived: true });
  const match = companies.find((company) => company.slug === companySlug);
  return match?.code?.trim().toUpperCase() || companySlug.slice(0, 3).toUpperCase() || "CMP";
}

export function buildCanonicalProjectTasksRoute(companySlug: string, projectSlug: string): string {
  return buildCanonicalProjectTasksPath(getCompanyCode(companySlug), projectSlug);
}

export function buildCanonicalProjectBoardRoute(companySlug: string, projectSlug: string, taskId?: string): string {
  return buildCanonicalProjectBoardPath(getCompanyCode(companySlug), projectSlug, taskId);
}

export function buildCanonicalProjectSettingsRoute(companySlug: string, projectSlug: string): string {
  return buildCanonicalProjectSettingsPath(getCompanyCode(companySlug), projectSlug);
}

export function buildCanonicalProjectAgentsRoute(companySlug: string, projectSlug: string): string {
  return buildCanonicalProjectAgentsPath(getCompanyCode(companySlug), projectSlug);
}

export function findProjectSlugById(companySlug: string, projectIdOrSlug: string): string | null {
  const { projects } = listProjects({
    companyIdOrSlug: companySlug,
    includeArchived: true,
  });

  const project = projects.find(
    (candidate) => candidate.id === projectIdOrSlug || candidate.slug === projectIdOrSlug
  );

  return project?.slug ?? null;
}

// Stable ID for fallback resolution — never changes, unlike slugs.
const FALLBACK_COMPANY_ID = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";
const PRIMARY_COMPANY_CODE = "INS";

export function resolvePrimaryCompanySlug(): string {
  const { companies } = listCompanies();
  const primary = companies.find((company) => company.code?.trim().toUpperCase() === PRIMARY_COMPANY_CODE);
  if (primary) return primary.slug;
  const canonical = companies.find((company) => company.id === FALLBACK_COMPANY_ID);
  return canonical?.slug ?? companies[0]?.slug ?? FALLBACK_COMPANY_SLUG;
}

export { FALLBACK_COMPANY_SLUG, buildCompanyPath };
