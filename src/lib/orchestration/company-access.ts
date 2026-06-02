const SAFE_SQL_ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertSafeAlias(alias: string): string {
  const trimmed = alias.trim();
  if (!SAFE_SQL_ALIAS.test(trimmed)) {
    throw new Error(`Unsafe SQL alias for company access predicate: ${alias}`);
  }
  return trimmed;
}

export function buildCompanyAccessCondition(
  companyAlias: string,
  userId: string | undefined | null,
): { sql: string; args: string[] } | null {
  const scopedUserId = userId?.trim();
  if (!scopedUserId) return null;

  const alias = assertSafeAlias(companyAlias);
  return {
    sql: `(${alias}.owner_user_id = ? OR EXISTS (
        SELECT 1
          FROM company_members cm_access
         WHERE cm_access.company_id = ${alias}.id
           AND cm_access.user_id = ?
           AND cm_access.status = 'active'
      ))`,
    args: [scopedUserId, scopedUserId],
  };
}

export function buildAccessibleCompanyIdSubquery(
  userId: string,
): { sql: string; args: string[] } {
  const access = buildCompanyAccessCondition("c", userId);
  if (!access) {
    return {
      sql: "SELECT c.id FROM companies c WHERE c.archived_at IS NULL",
      args: [],
    };
  }

  return {
    sql: `SELECT c.id
            FROM companies c
           WHERE c.archived_at IS NULL
             AND ${access.sql}`,
    args: access.args,
  };
}
