export function isCeoRole(role: string): boolean {
  return role.trim().split(/\s+/).some((token) => token.toLowerCase() === "ceo");
}

export function isCompanyOrchestrationLeadRole(role: string): boolean {
  if (isCeoRole(role)) return true;
  const normalized = role.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized.includes("product orchestrator") || normalized.includes("orchestration lead")) return true;
  // Operators may title the company lead "Team Lead" or just "Lead". A leading
  // "Lead" word marks the company lead ("Lead", "Lead / Product Orchestrator");
  // a trailing one marks a specialist ("QA / Verification Lead") and must not
  // capture sweep/review routing.
  if (normalized.includes("team lead")) return true;
  return normalized === "lead" || normalized.startsWith("lead ") || normalized.startsWith("lead/");
}
