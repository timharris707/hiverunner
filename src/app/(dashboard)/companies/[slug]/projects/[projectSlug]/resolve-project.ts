import { notFound } from "next/navigation";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { listProjects } from "@/lib/orchestration/service";

export function resolveCompanyProjectId(companySlug: string, projectSlugOrId: string): string {
  const { projects } = listProjects({
    companyIdOrSlug: companySlug,
    includeArchived: true,
  });

  const project = projects.find(
    (candidate) => candidate.id === projectSlugOrId || candidate.slug === projectSlugOrId
  );

  if (project) return project.id;

  // Fall back to project slug alias.
  try {
    const db = getOrchestrationDb();
    const alias = db
      .prepare("SELECT project_id FROM project_slug_aliases WHERE slug_alias = ? LIMIT 1")
      .get(projectSlugOrId) as { project_id: string } | undefined;
    if (alias) {
      // Verify the aliased project belongs to this company's project list.
      const aliasedProject = projects.find((c) => c.id === alias.project_id);
      if (aliasedProject) return aliasedProject.id;
    }
  } catch {
    // DB unavailable — fall through to notFound.
  }

  notFound();
}
