import type Database from "better-sqlite3";

import { getLocalOwner } from "@/lib/auth/auth-mode";

type UserIdRow = {
  id: string;
};

type CompanyIdRow = {
  id: string;
};

const LOCAL_OWNER_ALIAS_EMAIL_ENVS = [
  "MC_LOCAL_OWNER_EMAIL",
  "NEXT_PUBLIC_ADMIN_EMAIL",
] as const;

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function findUserIdByEmail(db: Database.Database, email: string): string | undefined {
  const row = db
    .prepare("SELECT id FROM users WHERE lower(email) = lower(?) AND archived_at IS NULL LIMIT 1")
    .get(email) as UserIdRow | undefined;
  return row?.id;
}

export function resolveCanonicalLocalOwnerUserId(
  db: Database.Database,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const localOwner = getLocalOwner(env);

  const direct = db
    .prepare("SELECT id FROM users WHERE id = ? AND archived_at IS NULL LIMIT 1")
    .get(localOwner.id) as UserIdRow | undefined;
  if (direct) return direct.id;

  const byEmail = findUserIdByEmail(db, localOwner.email);
  if (byEmail) return byEmail;

  const legacyOwner = db
    .prepare(
      `SELECT owner_user_id AS id
       FROM companies
       WHERE owner_user_id IS NOT NULL
         AND archived_at IS NULL
       GROUP BY owner_user_id
       ORDER BY COUNT(*) DESC
       LIMIT 1`
    )
    .get() as UserIdRow | undefined;
  return legacyOwner?.id ?? localOwner.id;
}

function resolveAliasOwnerUserIds(
  db: Database.Database,
  canonicalOwnerUserId: string,
  env: NodeJS.ProcessEnv,
): string[] {
  const localOwner = getLocalOwner(env);
  const aliasEmails = uniqueNonEmpty([
    localOwner.email,
    ...LOCAL_OWNER_ALIAS_EMAIL_ENVS.map((key) => env[key]),
  ]);
  const aliasIds = aliasEmails
    .map((email) => findUserIdByEmail(db, email))
    .filter((id): id is string => Boolean(id))
    .filter((id) => id !== canonicalOwnerUserId);
  return Array.from(new Set(aliasIds));
}

export function reconcileLocalSingleUserCompanyOwnership(
  db: Database.Database,
  canonicalOwnerUserId: string,
  env: NodeJS.ProcessEnv = process.env,
): { updatedCompanies: number; updatedProjects: number } {
  const aliasIds = resolveAliasOwnerUserIds(db, canonicalOwnerUserId, env);
  if (aliasIds.length === 0) {
    return { updatedCompanies: 0, updatedProjects: 0 };
  }

  const placeholders = aliasIds.map(() => "?").join(", ");
  const affectedCompanies = db
    .prepare(
      `SELECT id
       FROM companies
       WHERE owner_user_id IN (${placeholders})
         AND archived_at IS NULL`
    )
    .all(...aliasIds) as CompanyIdRow[];
  if (affectedCompanies.length === 0) {
    return { updatedCompanies: 0, updatedProjects: 0 };
  }

  const companyIds = affectedCompanies.map((company) => company.id);
  const companyPlaceholders = companyIds.map(() => "?").join(", ");
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const companyResult = db
      .prepare(
        `UPDATE companies
         SET owner_user_id = ?, updated_at = ?
         WHERE id IN (${companyPlaceholders})
           AND owner_user_id IN (${placeholders})`
      )
      .run(canonicalOwnerUserId, now, ...companyIds, ...aliasIds);
    const projectResult = db
      .prepare(
        `UPDATE projects
         SET owner_user_id = ?, updated_at = ?
         WHERE company_id IN (${companyPlaceholders})
           AND owner_user_id IN (${placeholders})`
      )
      .run(canonicalOwnerUserId, now, ...companyIds, ...aliasIds);
    return {
      updatedCompanies: companyResult.changes,
      updatedProjects: projectResult.changes,
    };
  });
  return tx();
}

export function resolveAndReconcileLocalOwnerUserId(
  db: Database.Database,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const ownerUserId = resolveCanonicalLocalOwnerUserId(db, env);
  reconcileLocalSingleUserCompanyOwnership(db, ownerUserId, env);
  return ownerUserId;
}
