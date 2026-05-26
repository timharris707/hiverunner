import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

import { getOrchestrationDb } from "@/lib/orchestration/db";

export type CompanyAuditEventInput = {
  companyId: string;
  eventType: string;
  agentId?: string | null;
  runtimeId?: string | null;
  taskId?: string | null;
  approvalId?: string | null;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
};

export function recordCompanyAuditEvent(
  input: CompanyAuditEventInput,
  db: Database.Database = getOrchestrationDb(),
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO company_audit_events
      (id, company_id, agent_id, runtime_id, task_id, approval_id,
       event_type, actor_user_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.companyId,
    input.agentId ?? null,
    input.runtimeId ?? null,
    input.taskId ?? null,
    input.approvalId ?? null,
    input.eventType,
    input.actorUserId ?? null,
    JSON.stringify(input.metadata ?? {}),
    new Date().toISOString(),
  );
  return id;
}
