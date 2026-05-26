import { createHash, randomUUID } from "node:crypto";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import {
  createCompanyMemoryRecord,
  type CompanyMemoryKind,
  type CompanyMemoryRecord,
} from "@/lib/orchestration/company-memory";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";

const EXTRACTION_VERSION = "company-memory-extractor.v1";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type CompletedTaskRow = {
  id: string;
  task_key: string | null;
  title: string;
  description: string;
  status: "done" | "review" | "blocked" | "in_progress" | "to-do" | "backlog";
  project_id: string | null;
  project_name: string | null;
  assignee_agent_id: string | null;
  assignee_name: string | null;
  completed_at: string | null;
  updated_at: string;
};

type CommentEvidenceRow = {
  id: string;
  body: string;
  type: string;
  source: string | null;
  external_ref: string | null;
  author_agent_id: string | null;
  author_user_id: string | null;
  author_name: string | null;
  created_at: string;
};

type ExecutionRunRow = {
  id: string;
  provider: string;
  completed_at: string | null;
  updated_at: string;
};

export type MemoryExtractionInput = {
  taskId?: string;
  limit?: number;
  dryRun?: boolean;
};

export type MemoryExtractionSkipped = {
  taskId: string;
  taskKey: string | null;
  reason: "not_completed" | "no_clean_evidence" | "duplicate";
  slug?: string;
};

export type MemoryExtractionDraft = {
  slug: string;
  title: string;
  body: string;
  kind: CompanyMemoryKind;
  confidence: number;
  projectId: string | null;
  agentId: string | null;
  taskId: string;
  taskKey: string | null;
  executionRunId: string | null;
  metadata: Record<string, unknown>;
};

export type MemoryExtractionResult = {
  company: {
    id: string;
    slug: string;
    name: string;
    code: string | null;
  };
  dryRun: boolean;
  scannedTaskCount: number;
  createdCount: number;
  skippedCount: number;
  drafts: MemoryExtractionDraft[];
  memories: CompanyMemoryRecord[];
  skipped: MemoryExtractionSkipped[];
};

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? NaN)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit as number)));
}

function taskLookupSql(): string {
  return `
    SELECT
      t.id,
      t.task_key,
      t.title,
      t.description,
      t.status,
      t.project_id,
      p.name AS project_name,
      t.assignee_agent_id,
      a.name AS assignee_name,
      t.completed_at,
      t.updated_at
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN agents a ON a.id = t.assignee_agent_id
  `;
}

function listCompletedTasks(companyId: string, input: MemoryExtractionInput): CompletedTaskRow[] {
  const db = getOrchestrationDb();
  if (input.taskId?.trim()) {
    const needle = input.taskId.trim();
    const row = db
      .prepare(
        `${taskLookupSql()}
         WHERE COALESCE(t.company_id, p.company_id) = ?
           AND t.archived_at IS NULL
           AND (t.id = ? OR t.task_key = ?)
         LIMIT 1`,
      )
      .get(companyId, needle, needle) as CompletedTaskRow | undefined;
    if (!row) {
      throw new OrchestrationApiError(404, "task_not_found", "Task not found");
    }
    return [row];
  }

  return db
    .prepare(
      `${taskLookupSql()}
       WHERE COALESCE(t.company_id, p.company_id) = ?
         AND t.archived_at IS NULL
         AND t.status = 'done'
       ORDER BY COALESCE(t.completed_at, t.updated_at) DESC
       LIMIT ?`,
    )
    .all(companyId, clampLimit(input.limit)) as CompletedTaskRow[];
}

function listTaskEvidence(taskId: string): CommentEvidenceRow[] {
  return getOrchestrationDb()
    .prepare(
      `SELECT
         c.id,
         c.body,
         c.type,
         c.source,
         c.external_ref,
         c.author_agent_id,
         c.author_user_id,
         a.name AS author_name,
         c.created_at
       FROM comments c
       LEFT JOIN agents a ON a.id = c.author_agent_id
       WHERE c.task_id = ?
       ORDER BY c.created_at DESC
       LIMIT 12`,
    )
    .all(taskId) as CommentEvidenceRow[];
}

function getLatestExecutionRun(taskId: string): ExecutionRunRow | null {
  const row = getOrchestrationDb()
    .prepare(
      `SELECT id, provider, completed_at, updated_at
       FROM execution_runs
       WHERE task_id = ?
       ORDER BY COALESCE(completed_at, updated_at) DESC
       LIMIT 1`,
    )
    .get(taskId) as ExecutionRunRow | undefined;
  return row ?? null;
}

function isRuntimeLogComment(comment: CommentEvidenceRow): boolean {
  const body = comment.body.trim();
  if (!body) return true;
  if (comment.source === "engine" && comment.external_ref?.startsWith("engine:circuit_breaker:")) return true;

  const normalized = body.toLowerCase();
  return (
    normalized.startsWith("codex execution completed") ||
    normalized.startsWith("symphony execution failed") ||
    normalized.startsWith("openclaw execution") ||
    normalized.includes("command: codex exec") ||
    normalized.includes("stdout:") ||
    normalized.includes("stderr:") ||
    normalized.includes("```mc-action") ||
    normalized.includes("\"operation\":") ||
    normalized.includes("execution_run_id") ||
    normalized.includes("runtime skill count")
  );
}

function cleanEvidenceText(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 1600)
    .trim();
}

function chooseEvidence(comments: CommentEvidenceRow[]): { comment: CommentEvidenceRow; text: string; skippedRuntimeLogCount: number } | null {
  let skippedRuntimeLogCount = 0;
  for (const comment of comments) {
    if (isRuntimeLogComment(comment)) {
      skippedRuntimeLogCount += 1;
      continue;
    }
    const text = cleanEvidenceText(comment.body);
    if (text.length >= 25) {
      return { comment, text, skippedRuntimeLogCount };
    }
  }
  return null;
}

function classifyMemoryKind(text: string, task: CompletedTaskRow): CompanyMemoryKind {
  const haystack = `${task.title}\n${task.description}\n${text}`.toLowerCase();
  if (/\b(decision|decided|approved|accepted|reject|rejected|policy)\b/.test(haystack)) return "decision";
  if (/\b(prefer|preference|wants|should always|should never|design system)\b/.test(haystack)) return "preference";
  if (/\b(architecture|schema|database|api|runtime|workspace|adapter|websocket|socket)\b/.test(haystack)) return "architecture";
  if (/\b(legal|compliance|lending|borrower|loan|finance|financial|agreement|regulation)\b/.test(haystack)) return "domain_constraint";
  if (/\b(workflow|checklist|process|steps|handoff|routing|qa|release)\b/.test(haystack)) return "workflow_note";
  if (/\b(skill|repeatable|playbook|procedure|pattern)\b/.test(haystack)) return "skill_evidence";
  return "fact";
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function normalizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "memory";
}

function hasExistingMemory(companyId: string, slug: string): boolean {
  const row = getOrchestrationDb()
    .prepare("SELECT 1 AS found FROM company_memory_records WHERE company_id = ? AND slug = ? LIMIT 1")
    .get(companyId, slug) as { found: number } | undefined;
  return Boolean(row);
}

function buildDraft(task: CompletedTaskRow, evidence: { comment: CommentEvidenceRow; text: string; skippedRuntimeLogCount: number }): MemoryExtractionDraft {
  const kind = classifyMemoryKind(evidence.text, task);
  const taskLabel = task.task_key ?? task.id.slice(0, 8);
  const title = `Task outcome: ${taskLabel} ${task.title}`.slice(0, 140);
  const slug = normalizeSlug(`${taskLabel}-${kind}-${hashText(evidence.text)}`);
  const latestRun = getLatestExecutionRun(task.id);
  const sourceAuthor = evidence.comment.author_name ?? evidence.comment.author_agent_id ?? evidence.comment.author_user_id ?? "unknown";
  const confidence = evidence.comment.type === "review" || /verified|approved|accepted|confirmed/i.test(evidence.text) ? 0.72 : 0.62;

  return {
    slug,
    title,
    body: [
      `Task ${taskLabel} completed with this durable outcome:`,
      "",
      evidence.text,
      "",
      `Source: ${sourceAuthor} on ${evidence.comment.created_at}.`,
    ].join("\n"),
    kind,
    confidence,
    projectId: task.project_id,
    agentId: evidence.comment.author_agent_id ?? task.assignee_agent_id,
    taskId: task.id,
    taskKey: task.task_key,
    executionRunId: latestRun?.id ?? null,
    metadata: {
      extractionVersion: EXTRACTION_VERSION,
      sourceType: "task_comment",
      sourceCommentId: evidence.comment.id,
      sourceCommentType: evidence.comment.type,
      sourceCommentSource: evidence.comment.source,
      sourceCommentExternalRef: evidence.comment.external_ref,
      sourceAuthor,
      taskId: task.id,
      taskKey: task.task_key,
      projectId: task.project_id,
      projectName: task.project_name,
      assigneeAgentId: task.assignee_agent_id,
      assigneeName: task.assignee_name,
      executionRunId: latestRun?.id ?? null,
      executionRunProvider: latestRun?.provider ?? null,
      skippedRuntimeLogCommentCount: evidence.skippedRuntimeLogCount,
      extractedAt: new Date().toISOString(),
    },
  };
}

export function extractCompanyMemoryCandidates(companyIdOrSlug: string, input: MemoryExtractionInput = {}): MemoryExtractionResult {
  const db = getOrchestrationDb();
  const company = resolveCompanyIdBySlug(companyIdOrSlug, db);
  if (!company) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const tasks = listCompletedTasks(company.id, input);
  const drafts: MemoryExtractionDraft[] = [];
  const memories: CompanyMemoryRecord[] = [];
  const skipped: MemoryExtractionSkipped[] = [];

  for (const task of tasks) {
    if (task.status !== "done") {
      skipped.push({ taskId: task.id, taskKey: task.task_key, reason: "not_completed" });
      continue;
    }

    const evidence = chooseEvidence(listTaskEvidence(task.id));
    if (!evidence) {
      skipped.push({ taskId: task.id, taskKey: task.task_key, reason: "no_clean_evidence" });
      continue;
    }

    const draft = buildDraft(task, evidence);
    if (hasExistingMemory(company.id, draft.slug)) {
      skipped.push({ taskId: task.id, taskKey: task.task_key, reason: "duplicate", slug: draft.slug });
      continue;
    }

    drafts.push(draft);
    if (!input.dryRun) {
      const created = createCompanyMemoryRecord(company.id, {
        title: draft.title,
        slug: draft.slug,
        body: draft.body,
        kind: draft.kind,
        scope: draft.projectId ? "project" : "company",
        status: "draft",
        source: "extractor",
        confidence: draft.confidence,
        projectId: draft.projectId,
        agentId: draft.agentId,
        taskId: draft.taskId,
        executionRunId: draft.executionRunId,
        reviewRequired: true,
        reviewState: "requested",
        metadata: draft.metadata,
      });
      memories.push(created.memory);
    }
  }

  return {
    company: {
      id: company.id,
      slug: company.slug,
      name: company.name,
      code: company.company_code,
    },
    dryRun: input.dryRun === true,
    scannedTaskCount: tasks.length,
    createdCount: memories.length,
    skippedCount: skipped.length,
    drafts,
    memories,
    skipped,
  };
}

export function createMemoryExtractionRunId(): string {
  return `memory-extract-${randomUUID()}`;
}
