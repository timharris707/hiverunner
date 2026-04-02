import { notFound } from "next/navigation";

import { listProjects } from "@/lib/orchestration/service";

export function resolveCompanyProjectId(companySlug: string, projectSlugOrId: string): string {
  const { projects } = listProjects({
    companyIdOrSlug: companySlug,
    includeArchived: true,
  });

  const project = projects.find(
    (candidate) => candidate.id === projectSlugOrId || candidate.slug === projectSlugOrId
  );

  if (!project) {
    notFound();
  }

  return project.id;
}
