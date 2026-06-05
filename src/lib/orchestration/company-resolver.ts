import type Database from "better-sqlite3";

import { buildCompanyAccessCondition } from "@/lib/orchestration/company-access";
import { getOrchestrationDb } from "@/lib/orchestration/db";

export type ResolvedCompanyIdentity = {
  id: string;
  slug: string;
  workspace_slug: string | null;
  runtime_slug: string | null;
  company_code: string | null;
  name: string;
  workspace_root: string | null;
  workspace_source: "openclaw" | "provisioned" | "imported" | "manual" | null;
};

/**
 * Lightweight alias-aware company resolver. Accepts a slug (current or historical)
 * or a company UUID. Returns core identity fields without expensive joins.
 * Use this in API route handlers instead of inline `WHERE slug = ?` queries.
 */
export function resolveCompanyIdBySlug(
  slugOrId: string,
  db: Database.Database = getOrchestrationDb(),
  input?: { includeArchived?: boolean; ownerUserId?: string },
): ResolvedCompanyIdentity | undefined {
  const includeArchived = input?.includeArchived ?? false;
  const archivedClause = includeArchived ? "1=1" : "c.archived_at IS NULL";
  const access = buildCompanyAccessCondition("c", input?.ownerUserId);
  const accessClause = access ? `AND ${access.sql}` : "";
  // Direct match on id, current slug, or stable company code.
  const direct = db
    .prepare(
      `SELECT c.id, c.slug, c.company_code, c.name, c.workspace_root, c.workspace_source,
              c.workspace_slug, c.runtime_slug
       FROM companies c
       WHERE (c.id = ? OR c.slug = ? OR UPPER(c.company_code) = UPPER(?)) AND ${archivedClause}
         ${accessClause}
       LIMIT 1`,
    )
    .get(slugOrId, slugOrId, slugOrId, ...(access?.args ?? [])) as ResolvedCompanyIdentity | undefined;
  if (direct) return direct;

  // Fall back to stored slug alias.
  const alias = db
    .prepare("SELECT company_id FROM company_slug_aliases WHERE slug_alias = ? LIMIT 1")
    .get(slugOrId) as { company_id: string } | undefined;
  if (!alias) return undefined;

  return db
    .prepare(
      `SELECT c.id, c.slug, c.company_code, c.name, c.workspace_root, c.workspace_source,
              c.workspace_slug, c.runtime_slug
       FROM companies c
       WHERE c.id = ? AND ${archivedClause}
         ${accessClause}
       LIMIT 1`,
    )
    .get(alias.company_id, ...(access?.args ?? [])) as ResolvedCompanyIdentity | undefined;
}
