import type Database from "better-sqlite3";

import { getCompanyLeadAgent } from "@/lib/orchestration/company-lead";
import { isCeoRole } from "@/lib/orchestration/engine/role-matcher";

/**
 * Onboarding-asset bucket resolution.
 *
 * Which prompt bucket (`ceo` vs `default`) an agent receives is a designation
 * question, not a title question: companies.lead_agent_id names the company
 * lead, and operators may title that agent anything ("CEO", "Team Lead",
 * "Eagle"). When a designation exists it alone decides — the designated agent
 * gets the lead bucket and everyone else gets the default bucket even if
 * their title says "CEO". The role-string heuristic survives only as the
 * fallback for companies with no designation (pre-migration data, or the
 * lead was archived).
 *
 * Lives outside prompt-builder so non-prompt consumers (instruction sources
 * API, Improve template patches) can resolve buckets without importing the
 * prompt assembly module.
 */

export type OnboardingBucket = "ceo" | "default";

export type OnboardingBucketContext = {
  db?: Database.Database | null;
  companyId?: string | null;
  agentId?: string | null;
};

export function resolveOnboardingAssetBucket(
  role: string,
  context?: OnboardingBucketContext,
): OnboardingBucket {
  if (context?.db && context.companyId) {
    try {
      const lead = getCompanyLeadAgent(context.companyId, context.db);
      if (lead) {
        return lead.id === context.agentId ? "ceo" : "default";
      }
    } catch {
      // Designation lookup must never break prompt assembly; fall through to
      // the role heuristic.
    }
  }
  return isCeoRole(role) ? "ceo" : "default";
}
