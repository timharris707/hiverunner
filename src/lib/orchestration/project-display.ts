type ProjectIdentity = {
  slug?: string | null;
  name?: string | null;
  projectSlug?: string | null;
  projectName?: string | null;
};

const HIVE_RUNNER_ORCHESTRATION_SLUG = "hiverunner-orchestration";
const LEGACY_HIVE_RUNNER_ORCHESTRATION_SLUG = "mission-control-orchestration";
const LEGACY_HIVE_RUNNER_ORCHESTRATION_NAME = "HiveRunner orchestration";
const HIVE_RUNNER_ORCHESTRATION_NAME = "HiveRunner Orchestration";

export function isHiveRunnerOrchestrationProject(project?: ProjectIdentity | null): boolean {
  const slug = String(project?.slug ?? project?.projectSlug ?? "").trim().toLowerCase();
  const name = String(project?.name ?? project?.projectName ?? "").trim().toLowerCase();
  return (
    slug === HIVE_RUNNER_ORCHESTRATION_SLUG
    || slug === LEGACY_HIVE_RUNNER_ORCHESTRATION_SLUG
    || name === LEGACY_HIVE_RUNNER_ORCHESTRATION_NAME
  );
}

export function formatProjectDisplayName(project?: ProjectIdentity | null, fallback = "Project"): string {
  if (isHiveRunnerOrchestrationProject(project)) return HIVE_RUNNER_ORCHESTRATION_NAME;
  return String(project?.name ?? project?.projectName ?? "").trim() || fallback;
}
