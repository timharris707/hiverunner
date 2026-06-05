export function isCeoRole(role: string): boolean {
  return role.trim().split(/\s+/).some((token) => token.toLowerCase() === "ceo");
}

export function isCompanyOrchestrationLeadRole(role: string): boolean {
  if (isCeoRole(role)) return true;
  const normalized = role.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized.includes("product orchestrator") || normalized.includes("orchestration lead");
}
