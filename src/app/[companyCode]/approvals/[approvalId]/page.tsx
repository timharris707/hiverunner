import { redirect } from "next/navigation";

import { resolveCompanySlugFromCode } from "@/lib/orchestration/routes";

export const dynamic = "force-dynamic";

export default async function CanonicalApprovalDetailPage({
  params,
}: {
  params: Promise<{ companyCode: string; approvalId: string }>;
}) {
  const { companyCode, approvalId } = await params;
  const companySlug = resolveCompanySlugFromCode(companyCode) ?? companyCode;
  redirect(`/companies/${encodeURIComponent(companySlug)}/approvals/${encodeURIComponent(approvalId)}`);
}
