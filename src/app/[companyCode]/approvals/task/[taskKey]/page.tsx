import { redirect } from "next/navigation";

import { resolveCompanySlugFromCode } from "@/lib/orchestration/routes";

export const dynamic = "force-dynamic";

export default async function CanonicalApprovalTaskAliasPage({
  params,
}: {
  params: Promise<{ companyCode: string; taskKey: string }>;
}) {
  const { companyCode, taskKey } = await params;
  const companySlug = resolveCompanySlugFromCode(companyCode) ?? companyCode;
  redirect(`/companies/${encodeURIComponent(companySlug)}/approvals/task/${encodeURIComponent(taskKey)}`);
}
