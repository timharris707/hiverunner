import type Database from "better-sqlite3";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { recordImproveActivity } from "@/lib/orchestration/service/improvement-provenance";
import type { ApprovalStatus, ImprovementApprovalPackageStatus } from "@/lib/orchestration/types";

type ImprovementApprovalLinkRow = {
  id: string;
  company_id: string;
  recommendation_id: string;
  recommendation_status: string;
  scope_type: string;
  scope_key: string;
  title: string;
  severity: string;
  company_code: string | null;
};

function linkStatusForApproval(status: string): ImprovementApprovalPackageStatus {
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  if (status === "cancelled") return "cancelled";
  return "submitted";
}

function resolveProjectForImproveActivity(
  db: Database.Database,
  row: ImprovementApprovalLinkRow,
): string | null {
  if (row.scope_type === "project") {
    const project = db
      .prepare("SELECT id FROM projects WHERE id = ? AND company_id = ? AND archived_at IS NULL LIMIT 1")
      .get(row.scope_key, row.company_id) as { id: string } | undefined;
    if (project) return project.id;
  }

  if (row.scope_type === "agent") {
    const agent = db
      .prepare("SELECT project_id FROM agents WHERE id = ? AND company_id = ? AND archived_at IS NULL LIMIT 1")
      .get(row.scope_key, row.company_id) as { project_id: string } | undefined;
    if (agent?.project_id) return agent.project_id;
  }

  const fallback = db
    .prepare(
      `SELECT id
       FROM projects
       WHERE company_id = ?
         AND archived_at IS NULL
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    )
    .get(row.company_id) as { id: string } | undefined;
  return fallback?.id ?? null;
}

export function syncImproveApprovalDecision(input: {
  approvalId: string;
  status: ApprovalStatus | string;
  decisionNote?: string | null;
  actorUserId?: string | null;
  db?: Database.Database;
}): { updated: number } {
  const db = input.db ?? getOrchestrationDb();
  const status = linkStatusForApproval(input.status);
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT
         l.id,
         l.company_id,
         l.recommendation_id,
         r.status AS recommendation_status,
         r.scope_type,
         r.scope_key,
         r.title,
         r.severity,
         c.company_code
       FROM improvement_recommendation_approval_links l
       INNER JOIN improvement_recommendations r ON r.id = l.recommendation_id
       INNER JOIN companies c ON c.id = l.company_id
       WHERE l.approval_id = ?`,
    )
    .all(input.approvalId) as ImprovementApprovalLinkRow[];

  if (rows.length === 0) return { updated: 0 };

  const update = db.prepare(
    `UPDATE improvement_recommendation_approval_links
     SET status = ?,
         updated_at = ?
     WHERE id = ?`,
  );
  for (const row of rows) {
    update.run(status, now, row.id);
    const projectId = resolveProjectForImproveActivity(db, row);
    if (!projectId) continue;
    recordImproveActivity({
      companyId: row.company_id,
      companyCode: row.company_code,
      eventType: "improve.approval_decision_synced",
      actorUserId: input.actorUserId ?? null,
      source: {
        recommendationId: row.recommendation_id,
        recommendationStatus: row.recommendation_status,
        severity: row.severity,
        projectId,
        approvalPackageId: row.id,
        approvalId: input.approvalId,
        approvalStatus: input.status,
        approvalDecision: input.decisionNote ?? status,
        summary: row.title,
      },
    }, db);
  }

  return { updated: rows.length };
}
