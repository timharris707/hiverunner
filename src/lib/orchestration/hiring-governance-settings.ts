import type Database from "better-sqlite3";

export type CompanyHiringGovernanceSettings = {
  autoApproveNewHires: boolean;
};

const DEFAULT_HIRING_GOVERNANCE: CompanyHiringGovernanceSettings = {
  autoApproveNewHires: false,
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function parseCompanySettingsJson(value: string | null | undefined): Record<string, unknown> {
  if (!value?.trim()) return {};
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

export function normalizeHiringGovernanceSettings(settings: Record<string, unknown>): CompanyHiringGovernanceSettings {
  const governance = asRecord(settings.governance);
  const hiring = asRecord(governance.hiring);
  return {
    autoApproveNewHires:
      typeof hiring.autoApproveNewHires === "boolean"
        ? hiring.autoApproveNewHires
        : DEFAULT_HIRING_GOVERNANCE.autoApproveNewHires,
  };
}

export function ensureCompanySettingsJsonColumn(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(companies)").all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === "settings_json")) return;
  db.prepare("ALTER TABLE companies ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'").run();
}

function getCompanyHiringGovernanceSettingsById(
  db: Database.Database,
  companyId: string,
): CompanyHiringGovernanceSettings {
  ensureCompanySettingsJsonColumn(db);
  const row = db
    .prepare("SELECT settings_json FROM companies WHERE id = ? LIMIT 1")
    .get(companyId) as { settings_json: string | null } | undefined;
  return normalizeHiringGovernanceSettings(parseCompanySettingsJson(row?.settings_json));
}

export function shouldAutoApproveNewHiresForCompanyId(
  db: Database.Database,
  companyId: string,
): boolean {
  return getCompanyHiringGovernanceSettingsById(db, companyId).autoApproveNewHires;
}
