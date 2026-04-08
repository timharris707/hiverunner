import { redirect } from "next/navigation";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { listProjects } from "@/lib/orchestration/service";

/**
 * Server layout for project pages. Handles alias-to-canonical redirect:
 * if the URL contains an old project slug, redirects to the canonical slug.
 */
export default async function ProjectSlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const { slug: companySlug, projectSlug } = await params;

  // Check if the project slug in the URL matches a current project.
  const { projects } = listProjects({
    companyIdOrSlug: companySlug,
    includeArchived: true,
  });

  const directMatch = projects.find(
    (p) => p.slug === projectSlug || p.id === projectSlug,
  );

  if (directMatch) {
    // Slug is current — render normally.
    return <>{children}</>;
  }

  // Check if the slug is a historical alias.
  try {
    const db = getOrchestrationDb();
    const alias = db
      .prepare("SELECT project_id FROM project_slug_aliases WHERE slug_alias = ? LIMIT 1")
      .get(projectSlug) as { project_id: string } | undefined;

    if (alias) {
      const canonicalProject = projects.find((p) => p.id === alias.project_id);
      if (canonicalProject) {
        // Redirect from old slug to canonical slug, preserving the rest of the URL.
        // We can't easily get the sub-path from here, so redirect to the project root.
        redirect(
          `/companies/${encodeURIComponent(companySlug)}/projects/${encodeURIComponent(canonicalProject.slug)}`,
        );
      }
    }
  } catch {
    // DB unavailable — fall through to let the page show its own 404.
  }

  return <>{children}</>;
}
