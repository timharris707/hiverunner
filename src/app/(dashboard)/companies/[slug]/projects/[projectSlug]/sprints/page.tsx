import { redirect } from "next/navigation";
import { resolveCompanyProjectId } from "../resolve-project";

export default async function CompanyProjectSprintsPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const { slug, projectSlug } = await params;
  const projectId = resolveCompanyProjectId(slug, projectSlug);
  redirect(`/projects/${encodeURIComponent(projectId)}/sprints`);
}
