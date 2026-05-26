import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { resolveHiveRunnerLane } from "@/lib/workspaces/root";

type LeaseRow = {
  company_id: string;
  enabled_at: string;
  enabled_until: string;
  enabled_by: string | null;
  note: string | null;
  slug: string;
  company_code: string | null;
  name: string;
};

type CompanyIdentity = {
  id: string;
  slug: string;
  code: string;
  name: string;
};

type LeaseSummary = {
  company: CompanyIdentity;
  enabledAt: string;
  enabledUntil: string;
  remainingSeconds: number;
  indefinite: boolean;
  enabledBy?: string;
  note?: string;
};

export type DevExecutionTestModeView = {
  lane: "dev" | "stable";
  gateEnabled: boolean;
  available: boolean;
  reason?: string;
  company: CompanyIdentity;
  activeLease: LeaseSummary | null;
  activeForCurrentCompany: boolean;
  activeCompany: CompanyIdentity | null;
  defaultDurationMinutes: number;
  maxDurationMinutes: number;
};

const DEFAULT_DURATION_MINUTES = 6 * 60;
const MAX_DURATION_MINUTES = 12 * 60;
const INDEFINITE_ENABLED_UNTIL = "9999-12-31T23:59:59.999Z";

function nowIso(): string {
  return new Date().toISOString();
}

function toCompanyIdentity(row: {
  id: string;
  slug: string;
  company_code: string | null;
  name: string;
}): CompanyIdentity {
  return {
    id: row.id,
    slug: row.slug,
    code: row.company_code?.trim() || row.slug.slice(0, 3).toUpperCase(),
    name: row.name,
  };
}

function isDevExecutionGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.MC_DEV_EXECUTION_TEST_MODE || "").trim() === "1";
}

export function isDevExecutionTestModeSupported(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveHiveRunnerLane(env) === "dev" && (env.PORT || "3010") === "3010";
}

export function isDevExecutionTestModeAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return isDevExecutionTestModeSupported(env) && isDevExecutionGateEnabled(env);
}

function resolveTargetCompany(
  companyIdOrSlug: string,
  db = getOrchestrationDb(),
): CompanyIdentity {
  const resolved = resolveCompanyIdBySlug(companyIdOrSlug, db, { includeArchived: false });
  if (!resolved) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
  return toCompanyIdentity(resolved);
}

function deleteExpiredLeases(now: string, db = getOrchestrationDb()): number {
  return db
    .prepare(
      `DELETE FROM dev_execution_test_leases
       WHERE enabled_until <= ?`
    )
    .run(now).changes;
}

function mapLeaseRow(row: LeaseRow, now = nowIso()): LeaseSummary {
  const indefinite = row.enabled_until === INDEFINITE_ENABLED_UNTIL;
  return {
    company: toCompanyIdentity({
      id: row.company_id,
      slug: row.slug,
      company_code: row.company_code,
      name: row.name,
    }),
    enabledAt: row.enabled_at,
    enabledUntil: row.enabled_until,
    remainingSeconds: indefinite
      ? Number.MAX_SAFE_INTEGER
      : Math.max(0, Math.floor((new Date(row.enabled_until).getTime() - new Date(now).getTime()) / 1000)),
    indefinite,
    enabledBy: row.enabled_by?.trim() || undefined,
    note: row.note?.trim() || undefined,
  };
}

function listActiveLeaseRows(
  now: string,
  db = getOrchestrationDb(),
): LeaseRow[] {
  deleteExpiredLeases(now, db);
  return db
    .prepare(
      `SELECT
         l.company_id,
         l.enabled_at,
         l.enabled_until,
         l.enabled_by,
         l.note,
         c.slug,
         c.company_code,
         c.name
       FROM dev_execution_test_leases l
       INNER JOIN companies c ON c.id = l.company_id
       WHERE c.archived_at IS NULL
         AND l.enabled_until > ?
       ORDER BY l.enabled_at DESC, l.updated_at DESC`
    )
    .all(now) as LeaseRow[];
}

function getSingleActiveLease(
  now: string,
  db = getOrchestrationDb(),
): LeaseSummary | null {
  const rows = listActiveLeaseRows(now, db);
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    return null;
  }
  return mapLeaseRow(rows[0], now);
}

function buildUnavailableView(
  company: CompanyIdentity,
  env: NodeJS.ProcessEnv = process.env,
): DevExecutionTestModeView {
  const lane = resolveHiveRunnerLane(env);
  const gateEnabled = isDevExecutionGateEnabled(env);

  if (lane !== "dev") {
    return {
      lane,
      gateEnabled,
      available: false,
      reason: "Dev execution test mode is hard-disabled outside the dev lane.",
      company,
      activeLease: null,
      activeForCurrentCompany: false,
      activeCompany: null,
      defaultDurationMinutes: DEFAULT_DURATION_MINUTES,
      maxDurationMinutes: MAX_DURATION_MINUTES,
    };
  }

  return {
    lane,
    gateEnabled,
    available: false,
    reason: "Set MC_DEV_EXECUTION_TEST_MODE=1 for the dev lane and restart port 3010 to expose this test control.",
    company,
    activeLease: null,
    activeForCurrentCompany: false,
    activeCompany: null,
    defaultDurationMinutes: DEFAULT_DURATION_MINUTES,
    maxDurationMinutes: MAX_DURATION_MINUTES,
  };
}

export function getDevExecutionTestModeView(
  companyIdOrSlug: string,
  db = getOrchestrationDb(),
  env: NodeJS.ProcessEnv = process.env,
): DevExecutionTestModeView {
  const company = resolveTargetCompany(companyIdOrSlug, db);
  if (!isDevExecutionTestModeAvailable(env)) {
    return buildUnavailableView(company, env);
  }

  const now = nowIso();
  const lease = getSingleActiveLease(now, db);
  return {
    lane: "dev",
    gateEnabled: true,
    available: true,
    company,
    activeLease: lease,
    activeForCurrentCompany: lease?.company.id === company.id,
    activeCompany: lease?.company ?? null,
    defaultDurationMinutes: DEFAULT_DURATION_MINUTES,
    maxDurationMinutes: MAX_DURATION_MINUTES,
  };
}

export function updateDevExecutionTestMode(
  input: {
    companyIdOrSlug: string;
    enabled: boolean;
    durationMinutes?: number;
    actor?: string;
    note?: string;
  },
  db = getOrchestrationDb(),
  env: NodeJS.ProcessEnv = process.env,
): DevExecutionTestModeView {
  const company = resolveTargetCompany(input.companyIdOrSlug, db);

  if (!isDevExecutionTestModeAvailable(env)) {
    throw new OrchestrationApiError(
      403,
      "dev_execution_test_mode_unavailable",
      buildUnavailableView(company, env).reason ?? "Dev execution test mode is unavailable",
    );
  }

  const now = nowIso();
  const activeRows = listActiveLeaseRows(now, db);
  if (activeRows.length > 1) {
    throw new OrchestrationApiError(
      409,
      "dev_execution_test_mode_ambiguous",
      "Multiple dev execution test mode leases are active. Disable them explicitly before enabling a new one.",
      {
        activeCompanies: activeRows.map((row) => toCompanyIdentity({
          id: row.company_id,
          slug: row.slug,
          company_code: row.company_code,
          name: row.name,
        })),
      },
    );
  }

  const activeLease = activeRows[0] ? mapLeaseRow(activeRows[0], now) : null;
  if (!input.enabled) {
    db.prepare(`DELETE FROM dev_execution_test_leases WHERE company_id = ?`).run(company.id);
    return getDevExecutionTestModeView(company.id, db, env);
  }

  if (activeLease && activeLease.company.id !== company.id) {
    throw new OrchestrationApiError(
      409,
      "dev_execution_test_mode_in_use",
      `Dev execution test mode is already active for ${activeLease.company.name}. Disable it there before enabling another company.`,
      {
        activeCompany: activeLease.company,
        enabledUntil: activeLease.enabledUntil,
      },
    );
  }

  const hasTemporaryDuration =
    typeof input.durationMinutes === "number" && Number.isFinite(input.durationMinutes);
  const enabledUntil = hasTemporaryDuration
    ? new Date(
        Date.now() +
          Math.max(1, Math.min(MAX_DURATION_MINUTES, Math.trunc(input.durationMinutes ?? DEFAULT_DURATION_MINUTES))) *
            60_000,
      ).toISOString()
    : INDEFINITE_ENABLED_UNTIL;

  db.prepare(
    `INSERT INTO dev_execution_test_leases
       (company_id, enabled_at, enabled_until, enabled_by, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(company_id) DO UPDATE SET
       enabled_at = excluded.enabled_at,
       enabled_until = excluded.enabled_until,
       enabled_by = excluded.enabled_by,
       note = excluded.note,
       updated_at = excluded.updated_at`
  ).run(
    company.id,
    now,
    enabledUntil,
    input.actor?.trim() || null,
    input.note?.trim() || null,
    now,
    now,
  );

  return getDevExecutionTestModeView(company.id, db, env);
}

export function canAutonomouslyExecuteCompany(
  companyId: string,
  db = getOrchestrationDb(),
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const lane = resolveHiveRunnerLane(env);
  if (lane !== "dev") {
    return true;
  }
  if (!isDevExecutionTestModeAvailable(env)) {
    return false;
  }
  const lease = getSingleActiveLease(nowIso(), db);
  return Boolean(lease && lease.company.id === companyId);
}

export function resolveQueuedHeartbeatClaimCompanyId(
  db = getOrchestrationDb(),
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const lane = resolveHiveRunnerLane(env);
  if (lane !== "dev") {
    return null;
  }
  if (!isDevExecutionTestModeAvailable(env)) {
    return "__disabled__";
  }
  const lease = getSingleActiveLease(nowIso(), db);
  return lease?.company.id ?? "__disabled__";
}
