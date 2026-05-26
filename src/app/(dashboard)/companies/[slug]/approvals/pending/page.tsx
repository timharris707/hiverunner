import { ApprovalsQueuePage } from "../ApprovalsQueuePage";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";

export default async function CompanyPendingApprovalsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const companyCode = resolveCompanyIdBySlug(slug)?.company_code;

  return <ApprovalsQueuePage view="pending" initialCompanyCode={companyCode} />;
}
