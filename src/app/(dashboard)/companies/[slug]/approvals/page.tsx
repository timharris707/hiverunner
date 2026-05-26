import { redirect } from "next/navigation";

import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { buildCanonicalCompanyPath, buildCompanyPath } from "@/lib/orchestration/route-paths";

export default async function CompanyApprovalsIndexRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const companyCode = resolveCompanyIdBySlug(slug)?.company_code?.trim();
  redirect(
    companyCode
      ? buildCanonicalCompanyPath(companyCode, "/approvals/pending")
      : buildCompanyPath(slug, "/approvals/pending")
  );
}
