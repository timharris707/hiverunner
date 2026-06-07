import type Database from "better-sqlite3";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  buildCanonicalEvalCasePath,
  buildCanonicalGoalPath,
  buildCanonicalImprovePath,
  buildCanonicalRunTracePath,
  buildCanonicalTaskRunTracePath,
  buildCanonicalTasksPath,
} from "@/lib/orchestration/route-paths";
import {
  assertNoRunTraceCredentialLeak,
  redactRunTracePayload,
} from "@/lib/orchestration/run-trace";
import type { OrchestrationExperimentReportEvidence } from "@/lib/orchestration/types";

export const EXPERIMENT_COMPARISON_REPORT_SCHEMA = "hiverunner.experiment_comparison_report.v1" as const;
export const EXPERIMENT_REPORT_READ_REDACTION_POLICY = "hiverunner.experiment_report_read.redaction.v1" as const;

type ExperimentReportRow = {
  id: string;
  experiment_id: string;
  company_id: string;
  status: OrchestrationExperimentReportEvidence["status"];
  summary: string;
  report_json: string;
  conclusion_json: string;
  winning_variant_id: string | null;
  recommendation_id: string | null;
  report_sha256: string | null;
  created_at: string;
  updated_at: string;
  experiment_objective: string;
  experiment_source_kind: "run_trace" | "eval_case" | "mixed";
  primary_source_run_id: string | null;
  primary_source_eval_case_id: string | null;
  source_task_id: string | null;
  source_trace_route: string | null;
  source_task_key: string | null;
  source_task_title: string | null;
  sprint_id: string | null;
  sprint_key: string | null;
  goal_key: string | null;
  company_code: string;
  winning_variant_key: string | null;
  winning_variant_name: string | null;
};

export type ExperimentReportListFilters = {
  limit?: number;
  status?: OrchestrationExperimentReportEvidence["status"][];
  sourceRunId?: string;
  sourceEvalCaseId?: string;
  sourceTaskId?: string;
  sourceTaskKey?: string;
  recommendationId?: string;
};

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw?.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function compact(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function appendQuery(href: string, params: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const normalized = compact(value);
    if (normalized) query.set(key, normalized);
  }
  const queryString = query.toString();
  if (!queryString) return href;
  return `${href}${href.includes("?") ? "&" : "?"}${queryString}`;
}

function reportSelectSql(): string {
  return `SELECT
      r.id,
      r.experiment_id,
      r.company_id,
      r.status,
      r.summary,
      r.report_json,
      r.conclusion_json,
      r.winning_variant_id,
      r.recommendation_id,
      r.report_sha256,
      r.created_at,
      r.updated_at,
      e.objective AS experiment_objective,
      e.source_kind AS experiment_source_kind,
      e.primary_source_run_id,
      e.primary_source_eval_case_id,
      e.source_task_id,
      e.source_trace_route,
      t.task_key AS source_task_key,
      t.title AS source_task_title,
      s.id AS sprint_id,
      s.sprint_key,
      s.goal_key,
      c.company_code AS company_code,
      v.variant_key AS winning_variant_key,
      v.name AS winning_variant_name
    FROM experiment_comparison_reports r
    INNER JOIN experiments e ON e.id = r.experiment_id
    INNER JOIN companies c ON c.id = r.company_id
    LEFT JOIN tasks t ON t.id = e.source_task_id
    LEFT JOIN sprints s ON s.id = t.sprint_id
    LEFT JOIN experiment_variants v ON v.id = r.winning_variant_id`;
}

function sourceRunPredicate(alias = "r"): string {
  return `(
    e.primary_source_run_id = ?
    OR EXISTS (
      SELECT 1 FROM experiment_sources es
      WHERE es.experiment_id = ${alias}.experiment_id
        AND es.source_run_id = ?
    )
    OR EXISTS (
      SELECT 1 FROM experiment_attempts ea
      WHERE ea.experiment_id = ${alias}.experiment_id
        AND ea.execution_run_id = ?
    )
    OR EXISTS (
      SELECT 1 FROM experiment_evidence_attachments eea
      WHERE eea.experiment_id = ${alias}.experiment_id
        AND eea.source_run_id = ?
    )
  )`;
}

function sourceEvalPredicate(alias = "r"): string {
  return `(
    e.primary_source_eval_case_id = ?
    OR EXISTS (
      SELECT 1 FROM experiment_sources es
      WHERE es.experiment_id = ${alias}.experiment_id
        AND es.source_eval_case_id = ?
    )
    OR EXISTS (
      SELECT 1 FROM experiment_attempts ea
      WHERE ea.experiment_id = ${alias}.experiment_id
        AND ea.eval_case_id = ?
    )
    OR EXISTS (
      SELECT 1 FROM experiment_evidence_attachments eea
      WHERE eea.experiment_id = ${alias}.experiment_id
        AND eea.source_eval_case_id = ?
    )
  )`;
}

function statusArgs(status?: OrchestrationExperimentReportEvidence["status"][]): { sql: string; args: string[] } {
  if (!status?.length) return { sql: "", args: [] };
  const values = status.map((item) => item.trim()).filter(Boolean);
  if (values.length === 0) return { sql: "", args: [] };
  return {
    sql: ` AND r.status IN (${values.map(() => "?").join(", ")})`,
    args: values,
  };
}

function buildSourceLinks(row: ExperimentReportRow): OrchestrationExperimentReportEvidence["links"] {
  const links: OrchestrationExperimentReportEvidence["links"] = [];
  const companyCode = row.company_code;

  if (row.primary_source_run_id) {
    const href = row.source_task_key
      ? buildCanonicalTaskRunTracePath(companyCode, row.source_task_key, row.primary_source_run_id)
      : buildCanonicalRunTracePath(companyCode, row.primary_source_run_id);
    links.push({
      type: "run_trace",
      id: row.primary_source_run_id,
      label: "Source Run Trace",
      href,
    });
  }

  if (row.primary_source_eval_case_id) {
    links.push({
      type: "eval_case",
      id: row.primary_source_eval_case_id,
      label: "Source Eval Case",
      href: buildCanonicalEvalCasePath(companyCode, row.primary_source_eval_case_id),
    });
  }

  if (row.source_task_key) {
    links.push({
      type: "task",
      id: row.source_task_id ?? row.source_task_key,
      label: row.source_task_key,
      href: `${buildCanonicalTasksPath(companyCode)}/${encodeURIComponent(row.source_task_key)}`,
    });
  }

  if (row.sprint_id || row.goal_key || row.sprint_key) {
    const routeKey = row.goal_key ?? row.sprint_key ?? row.sprint_id;
    if (routeKey) {
      links.push({
        type: "goal",
        id: row.sprint_id ?? routeKey,
        label: row.goal_key ? "Goal" : "Sprint",
        href: buildCanonicalGoalPath(companyCode, routeKey),
      });
    }
  }

  if (row.recommendation_id) {
    links.push({
      type: "improve",
      id: row.recommendation_id,
      label: "Improve recommendation",
      href: buildCanonicalImprovePath(companyCode, { recommendation: row.recommendation_id }),
    });
  }

  return links;
}

function mapReportRow(row: ExperimentReportRow, includePayload: boolean): OrchestrationExperimentReportEvidence {
  const rawReport = parseJson<Record<string, unknown>>(row.report_json, { schema: EXPERIMENT_COMPARISON_REPORT_SCHEMA });
  const rawConclusion = parseJson<Record<string, unknown>>(row.conclusion_json, {});
  const redacted = redactRunTracePayload({
    report: rawReport,
    conclusion: rawConclusion,
  });
  assertNoRunTraceCredentialLeak(redacted.value, "Experiment comparison report read");

  const links = buildSourceLinks(row);
  const sourceHref = links.find((link) => link.type === "improve")?.href
    ?? links.find((link) => link.type === "eval_case")?.href
    ?? links.find((link) => link.type === "run_trace")?.href
    ?? links[0]?.href
    ?? buildCanonicalImprovePath(row.company_code);
  const title = typeof rawReport.title === "string" && rawReport.title.trim()
    ? rawReport.title.trim()
    : "Comparison report";
  const href = appendQuery(sourceHref, { evidence: `experiment-report-${row.id}` });

  return {
    id: row.id,
    experimentId: row.experiment_id,
    companyId: row.company_id,
    status: row.status,
    title,
    summary: row.summary,
    objective: row.experiment_objective,
    sourceKind: row.experiment_source_kind,
    sourceRunId: row.primary_source_run_id,
    sourceEvalCaseId: row.primary_source_eval_case_id,
    sourceTaskId: row.source_task_id,
    sourceTaskKey: row.source_task_key,
    sourceTaskTitle: row.source_task_title,
    sprintId: row.sprint_id,
    sprintKey: row.sprint_key,
    goalKey: row.goal_key,
    winningVariantId: row.winning_variant_id,
    winningVariantKey: row.winning_variant_key,
    winningVariantName: row.winning_variant_name,
    recommendationId: row.recommendation_id,
    reportSha256: row.report_sha256,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    href,
    links,
    redactionPolicy: EXPERIMENT_REPORT_READ_REDACTION_POLICY,
    redactionSummary: redacted.redaction as unknown as Record<string, unknown>,
    redactedPayload: includePayload ? redacted.value : undefined,
  };
}

function queryReports(
  companyId: string,
  whereSql: string,
  args: unknown[],
  db: Database.Database,
  options: { limit?: number; includePayload?: boolean } = {},
): OrchestrationExperimentReportEvidence[] {
  const limit = typeof options.limit === "number"
    ? Math.max(1, Math.min(200, Math.trunc(options.limit)))
    : 50;
  const rows = db
    .prepare(`${reportSelectSql()} WHERE r.company_id = ? ${whereSql} ORDER BY r.created_at DESC, r.id ASC LIMIT ?`)
    .all(companyId, ...args, limit) as ExperimentReportRow[];
  return rows.map((row) => mapReportRow(row, options.includePayload === true));
}

export function listExperimentComparisonReports(
  companyId: string,
  filters: ExperimentReportListFilters = {},
  db = getOrchestrationDb(),
): OrchestrationExperimentReportEvidence[] {
  const where: string[] = [];
  const args: unknown[] = [];
  const statuses = statusArgs(filters.status);
  if (statuses.sql) {
    where.push(statuses.sql.replace(/^ AND /, ""));
    args.push(...statuses.args);
  }
  if (filters.sourceRunId) {
    where.push(sourceRunPredicate());
    args.push(filters.sourceRunId, filters.sourceRunId, filters.sourceRunId, filters.sourceRunId);
  }
  if (filters.sourceEvalCaseId) {
    where.push(sourceEvalPredicate());
    args.push(filters.sourceEvalCaseId, filters.sourceEvalCaseId, filters.sourceEvalCaseId, filters.sourceEvalCaseId);
  }
  if (filters.sourceTaskId) {
    where.push("e.source_task_id = ?");
    args.push(filters.sourceTaskId);
  }
  if (filters.sourceTaskKey) {
    where.push("t.task_key = ?");
    args.push(filters.sourceTaskKey);
  }
  if (filters.recommendationId) {
    where.push("r.recommendation_id = ?");
    args.push(filters.recommendationId);
  }
  return queryReports(companyId, where.length ? `AND ${where.join(" AND ")}` : "", args, db, {
    limit: filters.limit,
  });
}

export function listExperimentReportEvidenceForRun(
  companyId: string,
  runId: string,
  db = getOrchestrationDb(),
): OrchestrationExperimentReportEvidence[] {
  const normalizedRunId = compact(runId);
  if (!normalizedRunId) return [];
  return queryReports(
    companyId,
    `AND ${sourceRunPredicate()}`,
    [normalizedRunId, normalizedRunId, normalizedRunId, normalizedRunId],
    db,
    { limit: 20 },
  );
}

export function listExperimentReportEvidenceForEvalCase(
  companyId: string,
  evalCaseId: string,
  db = getOrchestrationDb(),
): OrchestrationExperimentReportEvidence[] {
  const normalizedEvalCaseId = compact(evalCaseId);
  if (!normalizedEvalCaseId) return [];
  return queryReports(
    companyId,
    `AND ${sourceEvalPredicate()}`,
    [normalizedEvalCaseId, normalizedEvalCaseId, normalizedEvalCaseId, normalizedEvalCaseId],
    db,
    { limit: 20 },
  );
}

export function getExperimentComparisonReport(
  companyId: string,
  reportId: string,
  db = getOrchestrationDb(),
): OrchestrationExperimentReportEvidence | null {
  const normalizedReportId = compact(reportId);
  if (!normalizedReportId) return null;
  const rows = queryReports(
    companyId,
    "AND r.id = ?",
    [normalizedReportId],
    db,
    { limit: 1, includePayload: true },
  );
  return rows[0] ?? null;
}
