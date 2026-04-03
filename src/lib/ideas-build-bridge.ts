import type Database from "better-sqlite3";

export type BuildTakeawayAction = "build-now" | "add-to-queue";

export type ResolvedBridgeProject = {
  id: string;
  slug: string;
  name: string;
  companyId: string;
};

export type ResolvedBridgeAssignee = {
  id: string;
  name: string;
};

const PRIORITY_MAP: Record<string, "P0" | "P1" | "P2"> = {
  high: "P0",
  medium: "P1",
  low: "P2",
};

export function mapTakeawayPriority(priority: unknown): "P0" | "P1" | "P2" {
  const key = String(priority ?? "").trim().toLowerCase();
  return PRIORITY_MAP[key] ?? "P1";
}

export function mapActionToTaskStatus(action: BuildTakeawayAction): "in-progress" | "backlog" {
  return action === "build-now" ? "in-progress" : "backlog";
}

export function appendTakeawayTaskNote(input: {
  currentNotes: unknown;
  taskId: string;
  action: BuildTakeawayAction;
}): string {
  const prefix = String(input.currentNotes ?? "").trim();
  const line = `Task created: ${input.taskId} (${input.action}, orchestration)`;
  if (prefix.includes(line)) {
    return prefix;
  }
  return [prefix, line].filter(Boolean).join("\n");
}

export function resolveBridgeProject(
  db: Database.Database,
  projectRef: string
): ResolvedBridgeProject | null {
  const normalized = projectRef.trim();
  if (!normalized) return null;

  const row = db
    .prepare(
      `SELECT
        id,
        slug,
        name,
        company_id
       FROM projects
       WHERE archived_at IS NULL
         AND (id = ? OR slug = ? OR lower(name) = lower(?))
       LIMIT 1`
    )
    .get(normalized, normalized, normalized) as
    | {
        id: string;
        slug: string;
        name: string;
        company_id: string | null;
      }
    | undefined;

  if (!row || !row.company_id) {
    return null;
  }

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    companyId: row.company_id,
  };
}

export function resolveBridgeAssignee(
  db: Database.Database,
  companyId: string,
  assigneeRef: string
): ResolvedBridgeAssignee | null {
  const normalized = assigneeRef.trim();
  if (!normalized) return null;

  const row = db
    .prepare(
      `SELECT id, name
       FROM agents
       WHERE company_id = ?
         AND archived_at IS NULL
         AND (id = ? OR lower(name) = lower(?))
       ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at DESC, created_at ASC
       LIMIT 1`
    )
    .get(companyId, normalized, normalized, normalized) as
    | {
        id: string;
        name: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return row;
}
