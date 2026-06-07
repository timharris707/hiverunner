import { createHash, randomUUID } from "crypto";
import { getOrchestrationDb } from "@/lib/orchestration/db";

export type TemplateVersionScope = "built_in" | "company";
export type TemplateGeneratedWorkType = "goal" | "sprint" | "task" | "execution_run" | "eval_case" | "sprint_plan_draft";

export type TemplateVersionRecord = {
  id: string;
  companyId: string | null;
  scope: TemplateVersionScope;
  templateKey: string;
  version: number;
  name: string;
  description: string;
  status: "active" | "archived";
  template: Record<string, unknown>;
  intakeSchema: Record<string, unknown>;
  contentSha256: string;
  createdBy: string | null;
  rollbackNotes: string;
  createdAt: string;
};

export type TemplateIntakeAnswerRecord = {
  id: string;
  companyId: string;
  templateVersionId: string;
  companyGoalId: string | null;
  planningTaskId: string | null;
  proposalGroupId: string | null;
  submittedByAgentId: string | null;
  submittedByUserId: string | null;
  answers: Record<string, unknown>;
  normalizedAnswers: Record<string, unknown>;
  idempotencyKey: string | null;
  createdAt: string;
};

export type TemplateGeneratedWorkRecord = {
  id: string;
  companyId: string;
  templateVersionId: string;
  intakeAnswerId: string | null;
  sourceDraftId: string | null;
  generatedType: TemplateGeneratedWorkType;
  generatedId: string;
  goalId: string | null;
  sprintId: string | null;
  taskId: string | null;
  executionRunId: string | null;
  evalCaseId: string | null;
  provenance: Record<string, unknown>;
  rollbackNotes: string;
  createdAt: string;
};

type TemplateVersionRow = {
  id: string;
  company_id: string | null;
  scope: TemplateVersionScope;
  template_key: string;
  version: number;
  name: string;
  description: string;
  status: "active" | "archived";
  template_json: string;
  intake_schema_json: string;
  content_sha256: string;
  created_by: string | null;
  rollback_notes: string;
  created_at: string;
};

type TemplateIntakeAnswerRow = {
  id: string;
  company_id: string;
  template_version_id: string;
  company_goal_id: string | null;
  planning_task_id: string | null;
  proposal_group_id: string | null;
  submitted_by_agent_id: string | null;
  submitted_by_user_id: string | null;
  answers_json: string;
  normalized_answers_json: string;
  idempotency_key: string | null;
  created_at: string;
};

type TemplateGeneratedWorkRow = {
  id: string;
  company_id: string;
  template_version_id: string;
  intake_answer_id: string | null;
  source_draft_id: string | null;
  generated_type: TemplateGeneratedWorkType;
  generated_id: string;
  goal_id: string | null;
  sprint_id: string | null;
  task_id: string | null;
  execution_run_id: string | null;
  eval_case_id: string | null;
  provenance_json: string;
  rollback_notes: string;
  created_at: string;
};

type TemplateSourceForTaskRow = {
  company_id: string | null;
  task_id: string;
  sprint_id: string | null;
  goal_id: string | null;
  source_template_version_id: string | null;
  template_intake_answer_id: string | null;
  generation_provenance_json: string | null;
};

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function normalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJsonValue);
  if (!value || typeof value !== "object") return value ?? null;
  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = normalizeJsonValue(record[key]);
      return acc;
    }, {});
}

function jsonString(value: unknown): string {
  return JSON.stringify(normalizeJsonValue(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function compactString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function mapTemplateVersion(row: TemplateVersionRow): TemplateVersionRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    scope: row.scope,
    templateKey: row.template_key,
    version: Number(row.version),
    name: row.name,
    description: row.description,
    status: row.status,
    template: parseRecord(row.template_json),
    intakeSchema: parseRecord(row.intake_schema_json),
    contentSha256: row.content_sha256,
    createdBy: row.created_by,
    rollbackNotes: row.rollback_notes,
    createdAt: row.created_at,
  };
}

function mapTemplateIntakeAnswer(row: TemplateIntakeAnswerRow): TemplateIntakeAnswerRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    templateVersionId: row.template_version_id,
    companyGoalId: row.company_goal_id,
    planningTaskId: row.planning_task_id,
    proposalGroupId: row.proposal_group_id,
    submittedByAgentId: row.submitted_by_agent_id,
    submittedByUserId: row.submitted_by_user_id,
    answers: parseRecord(row.answers_json),
    normalizedAnswers: parseRecord(row.normalized_answers_json),
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
  };
}

function mapTemplateGeneratedWork(row: TemplateGeneratedWorkRow): TemplateGeneratedWorkRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    templateVersionId: row.template_version_id,
    intakeAnswerId: row.intake_answer_id,
    sourceDraftId: row.source_draft_id,
    generatedType: row.generated_type,
    generatedId: row.generated_id,
    goalId: row.goal_id,
    sprintId: row.sprint_id,
    taskId: row.task_id,
    executionRunId: row.execution_run_id,
    evalCaseId: row.eval_case_id,
    provenance: parseRecord(row.provenance_json),
    rollbackNotes: row.rollback_notes,
    createdAt: row.created_at,
  };
}

export function getTemplateVersion(templateVersionId: string): TemplateVersionRecord | null {
  const row = getOrchestrationDb()
    .prepare("SELECT * FROM template_versions WHERE id = ? LIMIT 1")
    .get(templateVersionId) as TemplateVersionRow | undefined;
  return row ? mapTemplateVersion(row) : null;
}

export function getTemplateVersionForCompany(companyId: string, templateVersionId: string): TemplateVersionRecord | null {
  const row = getOrchestrationDb()
    .prepare(
      `SELECT *
       FROM template_versions
       WHERE id = ?
         AND (scope = 'built_in' OR company_id = ?)
       LIMIT 1`,
    )
    .get(templateVersionId, companyId) as TemplateVersionRow | undefined;
  return row ? mapTemplateVersion(row) : null;
}

export function createTemplateVersion(input: {
  id?: string;
  companyId?: string | null;
  scope?: TemplateVersionScope;
  templateKey: string;
  version: number;
  name: string;
  description?: string;
  template: Record<string, unknown>;
  intakeSchema?: Record<string, unknown>;
  createdBy?: string | null;
  rollbackNotes?: string;
}): TemplateVersionRecord {
  const scope = input.scope ?? (input.companyId ? "company" : "built_in");
  const companyId = compactString(input.companyId ?? null);
  if (scope === "built_in" && companyId) throw new Error("Built-in template versions cannot have a company id");
  if (scope === "company" && !companyId) throw new Error("Company template versions require a company id");
  if (!Number.isInteger(input.version) || input.version < 1) throw new Error("Template version must be a positive integer");

  const templateJson = jsonString(input.template);
  const intakeSchemaJson = jsonString(input.intakeSchema ?? {});
  const id = input.id ?? randomUUID();

  getOrchestrationDb()
    .prepare(
      `INSERT INTO template_versions (
         id, company_id, scope, template_key, version, name, description, status,
         template_json, intake_schema_json, content_sha256, created_by, rollback_notes
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      companyId,
      scope,
      input.templateKey.trim(),
      input.version,
      input.name.trim(),
      input.description?.trim() ?? "",
      templateJson,
      intakeSchemaJson,
      sha256(templateJson),
      compactString(input.createdBy ?? null),
      input.rollbackNotes?.trim() || "Template versions are immutable; rollback by selecting an earlier version or creating a new version.",
    );

  const created = getTemplateVersion(id);
  if (!created) throw new Error("Template version was inserted but could not be loaded");
  return created;
}

export function getTemplateIntakeAnswer(intakeAnswerId: string): TemplateIntakeAnswerRecord | null {
  const row = getOrchestrationDb()
    .prepare("SELECT * FROM template_intake_answers WHERE id = ? LIMIT 1")
    .get(intakeAnswerId) as TemplateIntakeAnswerRow | undefined;
  return row ? mapTemplateIntakeAnswer(row) : null;
}

export function getTemplateIntakeAnswerForCompany(companyId: string, intakeAnswerId: string): TemplateIntakeAnswerRecord | null {
  const row = getOrchestrationDb()
    .prepare(
      `SELECT *
       FROM template_intake_answers
       WHERE id = ?
         AND company_id = ?
       LIMIT 1`,
    )
    .get(intakeAnswerId, companyId) as TemplateIntakeAnswerRow | undefined;
  return row ? mapTemplateIntakeAnswer(row) : null;
}

export function createTemplateIntakeAnswer(input: {
  id?: string;
  companyId: string;
  templateVersionId: string;
  companyGoalId?: string | null;
  planningTaskId?: string | null;
  proposalGroupId?: string | null;
  submittedByAgentId?: string | null;
  submittedByUserId?: string | null;
  answers: Record<string, unknown>;
  normalizedAnswers?: Record<string, unknown>;
  idempotencyKey?: string | null;
}): TemplateIntakeAnswerRecord {
  const db = getOrchestrationDb();
  const template = getTemplateVersionForCompany(input.companyId, input.templateVersionId);
  if (!template) throw new Error("Template version is not available to this company");

  const answersJson = jsonString(input.answers);
  const normalizedAnswersJson = jsonString(input.normalizedAnswers ?? input.answers);
  const idempotencyKey = compactString(input.idempotencyKey ?? null);

  if (idempotencyKey) {
    const existing = db
      .prepare(
        `SELECT *
         FROM template_intake_answers
         WHERE company_id = ?
           AND idempotency_key = ?
         LIMIT 1`,
      )
      .get(input.companyId, idempotencyKey) as TemplateIntakeAnswerRow | undefined;
    if (existing) {
      if (existing.template_version_id !== input.templateVersionId || existing.answers_json !== answersJson) {
        throw new Error("Template intake idempotency key already exists with different answers");
      }
      return mapTemplateIntakeAnswer(existing);
    }
  }

  const id = input.id ?? randomUUID();
  db.prepare(
    `INSERT INTO template_intake_answers (
       id, company_id, template_version_id, company_goal_id, planning_task_id,
       proposal_group_id, submitted_by_agent_id, submitted_by_user_id,
       answers_json, normalized_answers_json, idempotency_key
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.companyId,
    input.templateVersionId,
    compactString(input.companyGoalId ?? null),
    compactString(input.planningTaskId ?? null),
    compactString(input.proposalGroupId ?? null),
    compactString(input.submittedByAgentId ?? null),
    compactString(input.submittedByUserId ?? null),
    answersJson,
    normalizedAnswersJson,
    idempotencyKey,
  );

  const created = getTemplateIntakeAnswer(id);
  if (!created) throw new Error("Template intake answer was inserted but could not be loaded");
  return created;
}

function generatedIdFromInput(input: {
  generatedId?: string;
  goalId?: string | null;
  sprintId?: string | null;
  taskId?: string | null;
  executionRunId?: string | null;
  evalCaseId?: string | null;
}): string {
  const candidates = [
    input.generatedId,
    input.taskId,
    input.sprintId,
    input.goalId,
    input.executionRunId,
    input.evalCaseId,
  ];
  const found = candidates.map((value) => compactString(value ?? null)).find(Boolean);
  if (!found) throw new Error("Generated work requires a generated id or target id");
  return found;
}

export function recordTemplateGeneratedWork(input: {
  id?: string;
  companyId: string;
  templateVersionId: string;
  intakeAnswerId?: string | null;
  sourceDraftId?: string | null;
  generatedType: TemplateGeneratedWorkType;
  generatedId?: string;
  goalId?: string | null;
  sprintId?: string | null;
  taskId?: string | null;
  executionRunId?: string | null;
  evalCaseId?: string | null;
  provenance?: Record<string, unknown>;
  rollbackNotes?: string;
}): TemplateGeneratedWorkRecord {
  const db = getOrchestrationDb();
  if (!getTemplateVersionForCompany(input.companyId, input.templateVersionId)) {
    throw new Error("Template version is not available to this company");
  }
  if (input.intakeAnswerId && !getTemplateIntakeAnswerForCompany(input.companyId, input.intakeAnswerId)) {
    throw new Error("Template intake answer is not available to this company");
  }

  const id = input.id ?? randomUUID();
  const generatedId = generatedIdFromInput(input);
  db.prepare(
    `INSERT OR IGNORE INTO template_generated_work (
       id, company_id, template_version_id, intake_answer_id, source_draft_id,
       generated_type, generated_id, goal_id, sprint_id, task_id, execution_run_id,
       eval_case_id, provenance_json, rollback_notes
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.companyId,
    input.templateVersionId,
    compactString(input.intakeAnswerId ?? null),
    compactString(input.sourceDraftId ?? null),
    input.generatedType,
    generatedId,
    compactString(input.goalId ?? null),
    compactString(input.sprintId ?? null),
    compactString(input.taskId ?? null),
    compactString(input.executionRunId ?? null),
    compactString(input.evalCaseId ?? null),
    jsonString(input.provenance ?? {}),
    input.rollbackNotes?.trim() || "Generated work is linked to an immutable template version; rollback the generated record through its owning workflow.",
  );

  const row = db
    .prepare(
      `SELECT *
       FROM template_generated_work
       WHERE company_id = ?
         AND template_version_id = ?
         AND generated_type = ?
         AND generated_id = ?
       LIMIT 1`,
    )
    .get(input.companyId, input.templateVersionId, input.generatedType, generatedId) as TemplateGeneratedWorkRow | undefined;
  if (!row) throw new Error("Template generated-work record was inserted but could not be loaded");
  return mapTemplateGeneratedWork(row);
}

function getTemplateSourceForTask(taskId: string): TemplateSourceForTaskRow | null {
  const row = getOrchestrationDb()
    .prepare(
      `SELECT
         COALESCE(t.company_id, p.company_id) AS company_id,
         t.id AS task_id,
         CASE
           WHEN s.id IS NOT NULL AND (s.parent_id IS NOT NULL OR s.goal_kind = 'sprint') THEN s.id
           ELSE NULL
         END AS sprint_id,
         CASE
           WHEN parent_s.id IS NOT NULL THEN parent_s.id
           WHEN s.id IS NOT NULL AND (s.goal_kind IS NULL OR s.goal_kind = 'company') THEN s.id
           ELSE NULL
         END AS goal_id,
         COALESCE(t.source_template_version_id, s.source_template_version_id, parent_s.source_template_version_id) AS source_template_version_id,
         COALESCE(t.template_intake_answer_id, s.template_intake_answer_id, parent_s.template_intake_answer_id) AS template_intake_answer_id,
         CASE
           WHEN t.template_generation_provenance_json IS NOT NULL AND t.template_generation_provenance_json <> '{}' THEN t.template_generation_provenance_json
           WHEN s.template_generation_provenance_json IS NOT NULL AND s.template_generation_provenance_json <> '{}' THEN s.template_generation_provenance_json
           ELSE parent_s.template_generation_provenance_json
         END AS generation_provenance_json
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN sprints s ON s.id = t.sprint_id
       LEFT JOIN sprints parent_s ON parent_s.id = s.parent_id
       WHERE t.id = ?
       LIMIT 1`,
    )
    .get(taskId) as TemplateSourceForTaskRow | undefined;
  return row ?? null;
}

export function linkTemplateGeneratedExecutionRun(input: {
  companyId?: string | null;
  taskId?: string | null;
  executionRunId: string;
  provenance?: Record<string, unknown>;
}): TemplateGeneratedWorkRecord | null {
  const taskId = compactString(input.taskId ?? null);
  const executionRunId = compactString(input.executionRunId);
  if (!taskId || !executionRunId) return null;

  const source = getTemplateSourceForTask(taskId);
  if (!source?.source_template_version_id) return null;

  const requestedCompanyId = compactString(input.companyId ?? null);
  const companyId = requestedCompanyId ?? compactString(source.company_id);
  if (!companyId) return null;
  if (requestedCompanyId && source.company_id && source.company_id !== requestedCompanyId) {
    throw new Error("Execution run task is not available to this company");
  }

  const provenance = {
    ...parseRecord(source.generation_provenance_json ?? "{}"),
    source: "execution_run_context",
    taskId,
    executionRunId,
    ...input.provenance,
  };
  const provenanceJson = jsonString(provenance);

  const updated = getOrchestrationDb()
    .prepare(
      `UPDATE execution_runs
       SET source_template_version_id = COALESCE(source_template_version_id, ?),
           template_intake_answer_id = COALESCE(template_intake_answer_id, ?),
           template_generation_provenance_json = CASE
             WHEN template_generation_provenance_json IS NULL OR template_generation_provenance_json = '{}' THEN ?
             ELSE template_generation_provenance_json
           END
       WHERE id = ?`,
    )
    .run(
      source.source_template_version_id,
      source.template_intake_answer_id,
      provenanceJson,
      executionRunId,
    );
  if (updated.changes === 0) return null;

  return recordTemplateGeneratedWork({
    companyId,
    templateVersionId: source.source_template_version_id,
    intakeAnswerId: source.template_intake_answer_id,
    generatedType: "execution_run",
    generatedId: executionRunId,
    goalId: source.goal_id,
    sprintId: source.sprint_id,
    taskId,
    executionRunId,
    provenance,
  });
}
