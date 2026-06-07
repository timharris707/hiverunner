import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import {
  ensureCompanySettingsJsonColumn,
  normalizeHiringGovernanceSettings,
  parseCompanySettingsJson,
  type CompanyHiringGovernanceSettings,
} from "@/lib/orchestration/hiring-governance-settings";

export type { CompanyHiringGovernanceSettings } from "@/lib/orchestration/hiring-governance-settings";

export type CompanyHiringGovernanceView = {
  company: {
    id: string;
    slug: string;
    name: string;
  };
  hiring: CompanyHiringGovernanceSettings;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeHiringSettings(settings: Record<string, unknown>): CompanyHiringGovernanceSettings {
  return normalizeHiringGovernanceSettings(settings);
}

function resolveCompany(companyIdOrSlug: string, db: Database.Database) {
  const resolved = resolveCompanyIdBySlug(companyIdOrSlug, db);
  if (!resolved) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
  return resolved;
}

export function getCompanyHiringGovernanceSettings(
  companyIdOrSlug: string,
  db = getOrchestrationDb(),
): CompanyHiringGovernanceView {
  ensureCompanySettingsJsonColumn(db);
  const company = resolveCompany(companyIdOrSlug, db);
  const row = db
    .prepare("SELECT settings_json FROM companies WHERE id = ? LIMIT 1")
    .get(company.id) as { settings_json: string | null } | undefined;

  return {
    company: {
      id: company.id,
      slug: company.slug,
      name: company.name,
    },
    hiring: normalizeHiringSettings(parseCompanySettingsJson(row?.settings_json)),
  };
}

export function updateCompanyHiringGovernanceSettings(input: {
  companyIdOrSlug: string;
  autoApproveNewHires?: boolean;
  db?: Database.Database;
}): CompanyHiringGovernanceView {
  const db = input.db ?? getOrchestrationDb();
  ensureCompanySettingsJsonColumn(db);
  const company = resolveCompany(input.companyIdOrSlug, db);
  const row = db
    .prepare("SELECT settings_json FROM companies WHERE id = ? LIMIT 1")
    .get(company.id) as { settings_json: string | null } | undefined;
  const settings = parseCompanySettingsJson(row?.settings_json);
  const governance = asRecord(settings.governance);
  const hiring = {
    ...asRecord(governance.hiring),
    ...(typeof input.autoApproveNewHires === "boolean"
      ? { autoApproveNewHires: input.autoApproveNewHires }
      : {}),
  };
  const nextSettings = {
    ...settings,
    governance: {
      ...governance,
      hiring,
    },
  };
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE companies
     SET settings_json = ?, updated_at = ?
     WHERE id = ?`
  ).run(JSON.stringify(nextSettings), now, company.id);

  return getCompanyHiringGovernanceSettings(company.id, db);
}

export function shouldAutoApproveNewHires(companyIdOrSlug: string, db = getOrchestrationDb()): boolean {
  return getCompanyHiringGovernanceSettings(companyIdOrSlug, db).hiring.autoApproveNewHires;
}
