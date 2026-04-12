export const LEGACY_COMPANY_PREFIX = "/companies";
export const FALLBACK_COMPANY_SLUG = "neveridle-core";

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

/** @deprecated Use buildCanonicalProjectTasksPath — kept for call-site compatibility during migration. */
export const buildCanonicalProjectIssuesPath = buildCanonicalProjectTasksPath;

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
  const approvalSubpath = input.linkedTaskKey
    ? `/approvals/task/${encodeURIComponent(input.linkedTaskKey)}`
    : `/approvals/${encodeURIComponent(input.approvalId)}`;

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

export function buildCanonicalIssuesPath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/issues");
}

export function buildCanonicalGoalsPath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/goals");
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

export function buildCanonicalNewIssuePath(companyCode: string): string {
  return buildCanonicalCompanyPath(companyCode, "/issues/new");
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
