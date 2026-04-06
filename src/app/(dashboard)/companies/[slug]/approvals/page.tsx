import { redirect } from "next/navigation";

import { buildCompanyPath } from "@/lib/orchestration/route-paths";

export default async function CompanyApprovalsIndexRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(buildCompanyPath(slug, "/approvals/pending"));
}
