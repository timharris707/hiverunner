/**
 * HiveRunner — Company lead designation.
 *
 * Every company designates exactly one agent as its lead via
 * companies.lead_agent_id. The designation — not the role title — is what the
 * engine routes triage, sweeps, and reviews through, so operators can title
 * the lead anything ("CEO", "Team Lead", "Eagle") without breaking
 * orchestration. The single-pointer schema makes "exactly one lead" a
 * structural fact rather than a convention, and switching leads is one update.
 *
 * findCompanyCeo (engine-queries.ts) resolves the designation first and only
 * falls back to the legacy role-title heuristic when the designation is
 * missing or points at an archived agent.
 */

import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";

export type CompanyLeadAgent = {
  id: string;
  name: string;
  role: string;
  adapter_type: string | null;
};

export function getCompanyLeadAgent(
  companyId: string,
  db: Database.Database = getOrchestrationDb(),
): CompanyLeadAgent | null {
  const row = db
    .prepare(
      `SELECT a.id, a.name, a.role, a.adapter_type
       FROM companies c
       INNER JOIN agents a ON a.id = c.lead_agent_id
       WHERE c.id = ? AND a.archived_at IS NULL
       LIMIT 1`,
    )
    .get(companyId) as CompanyLeadAgent | undefined;
  return row ?? null;
}

export function setCompanyLeadAgent(
  input: { companyId: string; agentId: string },
  db: Database.Database = getOrchestrationDb(),
): CompanyLeadAgent {
  const agent = db
    .prepare(
      `SELECT id, name, role, adapter_type, company_id, archived_at
       FROM agents WHERE id = ? LIMIT 1`,
    )
    .get(input.agentId) as (CompanyLeadAgent & { company_id: string; archived_at: string | null }) | undefined;

  if (!agent) {
    throw new OrchestrationApiError(404, "agent_not_found", "Lead agent not found");
  }
  if (agent.company_id !== input.companyId) {
    throw new OrchestrationApiError(400, "agent_not_in_company", "Lead agent must belong to the company");
  }
  if (agent.archived_at) {
    throw new OrchestrationApiError(400, "agent_archived", "An archived agent cannot be the company lead");
  }

  db.prepare("UPDATE companies SET lead_agent_id = ?, updated_at = ? WHERE id = ?")
    .run(agent.id, new Date().toISOString(), input.companyId);

  return { id: agent.id, name: agent.name, role: agent.role, adapter_type: agent.adapter_type };
}
