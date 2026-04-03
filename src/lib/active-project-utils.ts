import type { ActiveProjectState } from "@/lib/active-project-state";
import type { OrchestrationProject } from "@/lib/orchestration/types";

export function resolveActiveProject(
  projects: OrchestrationProject[],
  activeProject: ActiveProjectState | null,
  companySlug: string
): OrchestrationProject | null {
  if (!activeProject || activeProject.companySlug !== companySlug) return null;
  return (
    projects.find(
      (project) =>
        project.id === activeProject.projectId ||
        (!!activeProject.projectSlug && project.slug === activeProject.projectSlug)
    ) ?? null
  );
}
