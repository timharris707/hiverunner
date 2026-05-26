import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

const PLANNING_RETROSPECTIVE_CATEGORY = "planning_retrospective";
const MAX_CONTEXT_RECORDS = 5;
const MAX_CONTEXT_BODY = 420;

function normalizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "planning-retrospective";
}

function uniqueMemorySlug(db: Database.Database, companyId: string, baseSlug: string): string {
  const existing = db
    .prepare("SELECT slug FROM company_memory_records WHERE company_id = ? AND slug LIKE ?")
    .all(companyId, `${baseSlug}%`) as Array<{ slug: string }>;
  if (!existing.some((row) => row.slug === baseSlug)) return baseSlug;
  const used = new Set(existing.map((row) => row.slug));
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${baseSlug}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${baseSlug}-${randomUUID().slice(0, 8)}`;
}

function clip(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

export function recordPlanningRetrospectiveMemory(input: {
  db: Database.Database;
  companyId: string;
  projectId?: string | null;
  agentId?: string | null;
  taskId?: string | null;
  executionRunId?: string | null;
  title: string;
  body: string;
  outcome?: "approved" | "rejected" | "edited" | "noted";
  draftId?: string | null;
  companyGoalId?: string | null;
  confidence?: number;
  now?: string;
}): { id: string } | null {
  const title = clip(input.title, 180);
  const body = clip(input.body, 1200);
  if (!title || !body) return null;

  const now = input.now ?? new Date().toISOString();
  const id = randomUUID();
  const baseSlug = normalizeSlug(`planning-retrospective-${input.outcome ?? "noted"}-${input.draftId ?? title}`);
  const slug = uniqueMemorySlug(input.db, input.companyId, baseSlug);
  const metadata = {
    category: PLANNING_RETROSPECTIVE_CATEGORY,
    type: PLANNING_RETROSPECTIVE_CATEGORY,
    outcome: input.outcome ?? "noted",
    draftId: input.draftId ?? null,
    companyGoalId: input.companyGoalId ?? null,
  };

  input.db
    .prepare(
      `INSERT INTO company_memory_records (
         id, company_id, project_id, agent_id, task_id, execution_run_id, slug,
         title, body, kind, scope, status, source, confidence,
         review_required, review_state, reviewed_by_agent_id, reviewed_at,
         metadata_json, created_at, updated_at, archived_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'workflow_note', 'company', 'active', 'task', ?,
         0, 'approved', NULL, ?, ?, ?, ?, NULL)`,
    )
    .run(
      id,
      input.companyId,
      input.projectId ?? null,
      input.agentId ?? null,
      input.taskId ?? null,
      input.executionRunId ?? null,
      slug,
      title,
      body,
      Math.max(0, Math.min(1, input.confidence ?? 0.75)),
      now,
      JSON.stringify(metadata),
      now,
      now,
    );

  return { id };
}

export function buildPlanningRetrospectiveContext(input: {
  db: Database.Database;
  companyId: string | null | undefined;
}): string | null {
  if (!input.companyId) return null;
  const rows = input.db
    .prepare(
      `SELECT title, body, updated_at
       FROM company_memory_records
       WHERE company_id = ?
         AND status = 'active'
         AND (
           json_extract(metadata_json, '$.category') = ?
           OR json_extract(metadata_json, '$.type') = ?
           OR slug LIKE 'planning-retrospective%'
         )
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(input.companyId, PLANNING_RETROSPECTIVE_CATEGORY, PLANNING_RETROSPECTIVE_CATEGORY, MAX_CONTEXT_RECORDS) as Array<{
      title: string;
      body: string;
      updated_at: string;
    }>;

  const lines = [
    "Recent planning retrospectives:",
    "- Engine/default lesson: when a company goal has defaultExecutionEngine=symphony, proposed sprint defaults and task executionEngine should inherit symphony unless the operator explicitly asks for HiveRunner or manual; do not silently switch engines in drafts.",
  ];
  for (const row of rows) {
    lines.push(`- ${clip(row.title, 120)}: ${clip(row.body, MAX_CONTEXT_BODY)}`);
  }
  return lines.join("\n");
}
