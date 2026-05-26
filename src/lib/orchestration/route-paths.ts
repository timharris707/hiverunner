export const LEGACY_COMPANY_PREFIX = "/companies";
export const FALLBACK_COMPANY_SLUG = "hiverunner-workspace";

function sanitizeCodeSegment(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 8);
}

export function buildCompanyPath(companySlug: string, path = ""): string {
  return `${LEGACY_COMPANY_PREFIX}/${encodeURIComponent(companySlug)}${path}`;
}

export function buildCanonicalProjectTasksPath(companyCode: string, projectSlug: string): string {
  return `/${encodeURIComponent(sanitizeCodeSegment(companyCode))}/projects/${encodeURIComponent(projectSlug)}/tasks`;
}

export function buildCanonicalProjectBoardPath(companyCode: string, projectSlug: string, taskId?: string): string {
  const taskQuery = taskId ? `?task=${encodeURIComponent(taskId)}` : "";
  return `/${encodeURIComponent(sanitizeCodeSegment(companyCode))}/projects/${encodeURIComponent(projectSlug)}/board${taskQuery}`;
}

export function buildCanonicalProjectSettingsPath(companyCode: string, projectSlug: string): string {
  return `/${encodeURIComponent(sanitizeCodeSegment(companyCode))}/projects/${encodeURIComponent(projectSlug)}/settings`;
}

export function buildCanonicalProjectAgentsPath(companyCode: string, projectSlug: string): string {
  return `/${encodeURIComponent(sanitizeCodeSegment(companyCode))}/projects/${encodeURIComponent(projectSlug)}/agents`;
}

/* ── Company-level canonical paths ── */

export function buildCanonicalCompanyPath(companyCode: string, subpath = ""): string {
  return `/${encodeURIComponent(sanitizeCodeSegment(companyCode))}${subpath}`;
}

export function buildApprovalDetailPath(input: {
  companyCode?: string | null;
  companySlug: string;
  approvalId: string;
  linkedTaskKey?: string | null;
}): string {
  const approvalSubpath = `/approvals/${encodeURIComponent(input.approvalId)}`;

  if (input.companyCode?.trim()) {
    return buildCanonicalCompanyPath(input.companyCode, approvalSubpath);
  }

  return buildCompanyPath(input.companySlug, approvalSubpath);
}

export function buildCanonicalDashboardPath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/dashboard");
}

export function buildCanonicalInboxPath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/inbox");
}

export function buildCanonicalTasksPath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/tasks");
}

export function buildCanonicalGoalsPath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/goals");
}

export function buildCanonicalGoalPath(companyCode: string, goalIdOrKey: string): string {
  return buildCanonicalCompanyPath(companyCode, `/goals/${encodeURIComponent(goalIdOrKey)}`);
}

export function goalRouteKey(input: {
  id: string;
  goalKey?: string | null;
  sprintKey?: string | null;
}): string {
  return input.goalKey?.trim() || input.sprintKey?.trim() || input.id;
}

export function buildCanonicalTeamPath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/team");
}

export function buildCanonicalOrgPath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/org");
}

export function buildCanonicalSkillsPath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/skills");
}

export function buildCanonicalMemoryPath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/memory");
}

export function buildCanonicalRuntimesPath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/runtimes");
}

export function buildCanonicalHivesPath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/hives");
}

export function buildCanonicalCostsPath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/costs");
}

export function buildCanonicalActivityPath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/activity");
}

export function buildCanonicalFilesPath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/files");
}

export function buildCanonicalSettingsPath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/settings");
}

export function buildCanonicalManageProjectsPath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/manage-projects");
}

export function buildCanonicalRoutinesPath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/routines");
}

export function buildCanonicalProjectsPath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/projects");
}

export function buildCanonicalNewTaskPath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/tasks/new");
}

export function buildCanonicalAgentPath(companyCode: string, agentId: string): string {
  return buildCanonicalCompanyPath(companyCode, `/agents/${encodeURIComponent(agentId)}`);
}

export function buildCanonicalAgentRunsPath(companyCode: string, agentId: string): string {
  return buildCanonicalCompanyPath(companyCode, `/agents/${encodeURIComponent(agentId)}/runs`);
}

export function buildCanonicalRunDetailPath(companyCode: string, agentId: string, runId: string): string {
  return buildCanonicalCompanyPath(companyCode, `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`);
}

export function buildCanonicalNewAgentPath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/agents/new");
}
