import { CompanyErrorState } from "@/components/company/company-ui";
import { buildCompanyPath } from "@/lib/orchestration/route-paths";
import ApprovalDetailClient from "../../ApprovalDetailClient";
import { resolveApprovalByTaskKey } from "@/lib/orchestration/service/approval";

export const dynamic = "force-dynamic";

export default async function ApprovalTaskAliasPage({
  params,
}: {
  params: Promise<{ slug: string; taskKey: string }>;
}) {
  const { slug, taskKey } = await params;
  const decodedTaskKey = decodeURIComponent(taskKey);
  const resolution = resolveApprovalByTaskKey({
    companyIdOrSlug: slug,
    taskKey: decodedTaskKey,
  });

  if (resolution.status === "not_found") {
    return (
      <CompanyErrorState
        title="Approval not found"
        detail={`No approval is linked to task ${decodedTaskKey}.`}
        href={buildCompanyPath(slug, "/approvals/all")}
      />
    );
  }

  if (resolution.status === "ambiguous") {
    return (
      <CompanyErrorState
        title="Approval alias is ambiguous"
        detail={`Task ${decodedTaskKey} is linked to multiple approvals. Use the existing approval UUID URL for now.`}
        href={buildCompanyPath(slug, "/approvals/all")}
      />
    );
  }

  return <ApprovalDetailClient slug={slug} approvalId={resolution.approvalId} />;
}
