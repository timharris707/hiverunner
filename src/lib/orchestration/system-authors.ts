export const HIVE_RUNNER_SYSTEM_AUTHOR_PREFIX = "hiverunner:";
export const LEGACY_MISSION_CONTROL_SYSTEM_AUTHOR_PREFIX = "mission-control:";

export function isHiveRunnerSystemAuthor(authorUserId: string | null | undefined): boolean {
  const normalized = authorUserId?.trim().toLowerCase() ?? "";
  return (
    normalized.startsWith(HIVE_RUNNER_SYSTEM_AUTHOR_PREFIX)
    || normalized.startsWith(LEGACY_MISSION_CONTROL_SYSTEM_AUTHOR_PREFIX)
  );
}
