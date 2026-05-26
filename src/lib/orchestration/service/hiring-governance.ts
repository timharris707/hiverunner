import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";

export type CompanyHiringGovernanceSettings = {
  autoApproveNewHires: boolean;
};

export type CompanyHiringGovernanceView = {
  company: {
    id: string;
    slug: string;
    name: string;
  };
  hiring: CompanyHiringGovernanceSettings;
};

const DEFAULT_HIRING_GOVERNANCE: CompanyHiringGovernanceSettings = {
  autoApproveNewHires: false,
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseSettingsJson(value: string | null | undefined): Record<string, unknown> {
  if (!value?.trim()) return {};
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function normalizeHiringSettings(settings: Record<string, unknown>): CompanyHiringGovernanceSettings {
  const governance = asRecord(settings.governance);
  const hiring = asRecord(governance.hiring);
  return {
    autoApproveNewHires:
      typeof hiring.autoApproveNewHires === "boolean"
        ? hiring.autoApproveNewHires
        : DEFAULT_HIRING_GOVERNANCE.autoApproveNewHires,
  };
}

function resolveCompany(companyIdOrSlug: string, db: Database.Database) {
  const resolved = resolveCompanyIdBySlug(companyIdOrSlug, db);
  if (!resolved) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
  return resolved;
}

function ensureCompanySettingsJsonColumn(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(companies)").all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === "settings_json")) return;
  db.prepare("ALTER TABLE companies ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'").run();
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
    hiring: normalizeHiringSettings(parseSettingsJson(row?.settings_json)),
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
  const settings = parseSettingsJson(row?.settings_json);
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
