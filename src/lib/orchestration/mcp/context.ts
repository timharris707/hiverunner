import type Database from "better-sqlite3";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-resolver";
import { HiveRunnerMcpStartupError } from "@/lib/orchestration/mcp/errors";
import { normalizeMcpCompanyCode } from "@/lib/orchestration/mcp/registry";

export type McpRequestContext = {
  companyId: string;
  companySlug: string;
  companyCode: string;
  companyName: string;
  db: Database.Database;
  actor: {
    type: "local_mcp_client";
    name: string;
  };
};

export type ResolveMcpRequestContextInput = {
  company: string;
  actorName?: string;
  db?: Database.Database;
};

export function resolveMcpRequestContext(
  input: ResolveMcpRequestContextInput,
): McpRequestContext {
  const requestedCompany = input.company.trim();
  if (!requestedCompany) {
    throw new HiveRunnerMcpStartupError(
      "missing_company",
      "Start the HiveRunner MCP server with --company <company-code-or-slug> or HIVERUNNER_MCP_COMPANY.",
    );
  }

  const db = input.db ?? getOrchestrationDb();
  const company = resolveCompanyIdBySlug(requestedCompany, db, { includeArchived: false });
  if (!company) {
    throw new HiveRunnerMcpStartupError(
      "company_not_found",
      `No active HiveRunner company matched "${requestedCompany}".`,
    );
  }

  return {
    companyId: company.id,
    companySlug: company.slug,
    companyCode: normalizeMcpCompanyCode(company.company_code ?? company.slug),
    companyName: company.name,
    db,
    actor: {
      type: "local_mcp_client",
      name: input.actorName?.trim() || "local-mcp-client",
    },
  };
}
