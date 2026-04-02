import "server-only";
import { listCompanies } from "@/lib/orchestration/company-service";

export const FALLBACK_COMPANY_SLUG = "neveridle-core";

export function resolvePrimaryCompanySlug(): string {
  const { companies } = listCompanies();
  const canonical = companies.find((company) => company.slug === FALLBACK_COMPANY_SLUG);
  return canonical?.slug ?? companies[0]?.slug ?? FALLBACK_COMPANY_SLUG;
}
