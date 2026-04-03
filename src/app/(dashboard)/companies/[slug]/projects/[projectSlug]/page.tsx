import { redirect } from "next/navigation";

import { buildCanonicalProjectIssuesRoute } from "@/lib/orchestration/routes";

export default async function CompanyProjectPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const { slug, projectSlug } = await params;
  redirect(buildCanonicalProjectIssuesRoute(slug, projectSlug));
}
