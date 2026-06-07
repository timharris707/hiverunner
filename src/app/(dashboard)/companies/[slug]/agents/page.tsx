import { redirect } from "next/navigation";

import { COMPANY_SLUG_TO_CODE } from "@/lib/orchestration/edge-route-maps";
import { buildCanonicalTeamPath } from "@/lib/orchestration/route-paths";

export default async function CompanyAgentsRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const code = COMPANY_SLUG_TO_CODE[slug] ?? slug.slice(0, 3).toUpperCase();
  redirect(buildCanonicalTeamPath(code));
}
