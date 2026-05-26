"use client";

import { buildCanonicalProjectAgentsPath, buildCanonicalProjectBoardPath, buildCanonicalProjectTasksPath } from "@/lib/orchestration/route-paths";
import type { OrchestrationCompany } from "@/lib/orchestration/types";

function fallbackCode(companySlug: string): string {
  return companySlug.slice(0, 3).toUpperCase() || "CMP";
}

export function companyCodeFor(company: Pick<OrchestrationCompany, "code" | "slug"> | null | undefined): string {
  if (!company) return "CMP";
  return (company.code || fallbackCode(company.slug)).trim().toUpperCase();
}

export function canonicalProjectTasksHref(
  company: Pick<OrchestrationCompany, "code" | "slug"> | null | undefined,
  projectSlug: string
): string {
  return buildCanonicalProjectTasksPath(companyCodeFor(company), projectSlug);
}

export function canonicalProjectBoardHref(
  company: Pick<OrchestrationCompany, "code" | "slug"> | null | undefined,
  projectSlug: string,
  taskId?: string
): string {
  return buildCanonicalProjectBoardPath(companyCodeFor(company), projectSlug, taskId);
}

export function canonicalProjectAgentsHref(
  company: Pick<OrchestrationCompany, "code" | "slug"> | null | undefined,
  projectSlug: string
): string {
  return buildCanonicalProjectAgentsPath(companyCodeFor(company), projectSlug);
}
