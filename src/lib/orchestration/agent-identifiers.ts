import type Database from "better-sqlite3";

export function slugifyAgentName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function ensureUniqueAgentSlug(
  db: Database.Database,
  companyId: string,
  desiredName: string,
  options?: { excludeAgentId?: string }
): string {
  const base = slugifyAgentName(desiredName) || "agent";
  let candidate = base;
  let n = 2;

  const query = options?.excludeAgentId
    ? `SELECT 1
       FROM agents
       WHERE company_id = ?
         AND archived_at IS NULL
         AND slug = ?
         AND id != ?
       LIMIT 1`
    : `SELECT 1
       FROM agents
       WHERE company_id = ?
         AND archived_at IS NULL
         AND slug = ?
       LIMIT 1`;

  const stmt = db.prepare(query);

  while (true) {
    const hit = options?.excludeAgentId
      ? stmt.get(companyId, candidate, options.excludeAgentId)
      : stmt.get(companyId, candidate);

    if (!hit) return candidate;

    candidate = `${base}-${n}`.slice(0, 56);
    n += 1;
  }
}
