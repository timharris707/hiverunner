import { createHash } from "crypto";
import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  canAutonomouslyExecuteCompany,
  isDevExecutionTestModeAvailable,
} from "@/lib/orchestration/service/dev-execution-test-mode";
import { createApproval } from "@/lib/orchestration/service/approval";
import { recordCompanyAuditEvent } from "@/lib/orchestration/service/audit";

type RuntimeGovernanceTaskRow = {
  id: string;
  task_key: string;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  status: string;
  project_name: string;
};

type RuntimeGovernanceApprovalRow = {
  id: string;
  status: string;
};

export type CompanyRuntimeGovernanceSettings = {
  requireProtectedRuntimeApprovals: boolean;
};

export type CompanyRuntimeGovernanceView = {
  company: {
    id: string;
    slug: string;
    name: string;
  };
  runtime: CompanyRuntimeGovernanceSettings;
};

export type ProtectedRuntimeRisk = {
  code: string;
  label: string;
  matched: string;
  severity: "medium" | "high";
};

export type ProtectedRuntimeGate =
  | {
      allowed: true;
      required: false;
      risks: [];
      approvalId: null;
      message: null;
    }
  | {
      allowed: true;
      required: true;
      risks: ProtectedRuntimeRisk[];
      approvalId: string;
      message: string;
    }
  | {
      allowed: false;
      required: true;
      risks: ProtectedRuntimeRisk[];
      approvalId: string;
      message: string;
    };

const DEFAULT_RUNTIME_GOVERNANCE: CompanyRuntimeGovernanceSettings = {
  requireProtectedRuntimeApprovals: true,
};

const PROTECTED_RUNTIME_RULES: Array<{
  code: string;
  label: string;
  severity: "medium" | "high";
  pattern: RegExp;
  requiresEnvironmentChangeIntent?: boolean;
}> = [
  {
    code: "production_target",
    label: "Mentions changes to production, live, or customer-facing systems",
    severity: "medium",
    pattern: /\b(prod|production|live|customer[-\s]?facing|mainnet)\b/i,
    requiresEnvironmentChangeIntent: true,
  },
  {
    code: "deployment_command",
    label: "Mentions deployment or publish commands",
    severity: "high",
    pattern: /\b(vercel\s+deploy\s+--prod|fly\s+deploy|railway\s+up|npm\s+publish|pnpm\s+publish|yarn\s+npm\s+publish|gh\s+release|git\s+push)\b/i,
  },
  {
    code: "infra_command",
    label: "Mentions infrastructure-changing commands",
    severity: "high",
    pattern: /\b(terraform\s+(apply|destroy)|pulumi\s+up|kubectl\s+(apply|delete|scale|rollout|patch)|helm\s+(install|upgrade|uninstall))\b/i,
  },
  {
    code: "database_change",
    label: "Mentions database migration or destructive database operations",
    severity: "high",
    pattern: /\b(prisma\s+migrate\s+deploy|supabase\s+db\s+push|rails\s+db:migrate|alembic\s+upgrade|drop\s+table|truncate\s+table|delete\s+from)\b/i,
  },
  {
    code: "destructive_shell",
    label: "Mentions destructive shell/system commands",
    severity: "high",
    pattern: /\b(sudo|rm\s+-rf|chmod\s+-R|chown\s+-R|pkill|killall|launchctl|docker\s+(compose\s+)?down|docker\s+rm)\b/i,
  },
  {
    code: "protected_secret_file",
    label: "Mentions protected secrets or credential files",
    severity: "high",
    pattern: /(^|[\s`"'])((\.env(\.[\w-]+)?)|secrets?(\.|\/)|credentials?|keychain|\.ssh\/|id_rsa|id_ed25519|\.pem\b|\.p12\b|service[-_ ]account)/i,
  },
];

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const ENVIRONMENT_CHANGE_INTENT_PATTERN =
  /\b(apply|alter|change|configure|delete|deploy|install|migrate|modify|patch|promote|publish|push|release|restart|rollout|scale|ship|stop|touch|update|write)\b/i;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseSettingsJson(value: string | null | undefined): Record<string, unknown> {
  if (!value?.trim()) return {};
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function normalizeRuntimeSettings(settings: Record<string, unknown>): CompanyRuntimeGovernanceSettings {
  const governance = asRecord(settings.governance);
  const runtime = asRecord(governance.runtime);
  return {
    requireProtectedRuntimeApprovals:
      typeof runtime.requireProtectedRuntimeApprovals === "boolean"
        ? runtime.requireProtectedRuntimeApprovals
        : DEFAULT_RUNTIME_GOVERNANCE.requireProtectedRuntimeApprovals,
  };
}

function resolveCompany(companyIdOrSlug: string, db: Database.Database) {
  const resolved = resolveCompanyIdBySlug(companyIdOrSlug, db);
  if (!resolved) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
  return resolved;
}

function ensureCompanySettingsJsonColumn(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(companies)").all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === "settings_json")) return;
  db.prepare("ALTER TABLE companies ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'").run();
}

export function getCompanyRuntimeGovernanceSettings(
  companyIdOrSlug: string,
  db = getOrchestrationDb(),
): CompanyRuntimeGovernanceView {
  ensureCompanySettingsJsonColumn(db);
  const company = resolveCompany(companyIdOrSlug, db);
  const row = db
    .prepare("SELECT settings_json FROM companies WHERE id = ? LIMIT 1")
    .get(company.id) as { settings_json: string | null } | undefined;

  return {
    company: {
      id: company.id,
      slug: company.slug,
      name: company.name,
    },
    runtime: normalizeRuntimeSettings(parseSettingsJson(row?.settings_json)),
  };
}

export function updateCompanyRuntimeGovernanceSettings(input: {
  companyIdOrSlug: string;
  requireProtectedRuntimeApprovals?: boolean;
  db?: Database.Database;
}): CompanyRuntimeGovernanceView {
  const db = input.db ?? getOrchestrationDb();
  ensureCompanySettingsJsonColumn(db);
  const company = resolveCompany(input.companyIdOrSlug, db);
  const row = db
    .prepare("SELECT settings_json FROM companies WHERE id = ? LIMIT 1")
    .get(company.id) as { settings_json: string | null } | undefined;
  const settings = parseSettingsJson(row?.settings_json);
  const governance = asRecord(settings.governance);
  const runtime = {
    ...asRecord(governance.runtime),
    ...(typeof input.requireProtectedRuntimeApprovals === "boolean"
      ? { requireProtectedRuntimeApprovals: input.requireProtectedRuntimeApprovals }
      : {}),
  };
  const nextSettings = {
    ...settings,
    governance: {
      ...governance,
      runtime,
    },
  };
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE companies
     SET settings_json = ?, updated_at = ?
     WHERE id = ?`,
  ).run(JSON.stringify(nextSettings), now, company.id);

  return getCompanyRuntimeGovernanceSettings(company.id, db);
}

export function shouldRequireProtectedRuntimeApprovals(
  companyIdOrSlug: string,
  db = getOrchestrationDb(),
): boolean {
  return getCompanyRuntimeGovernanceSettings(companyIdOrSlug, db).runtime.requireProtectedRuntimeApprovals;
}

function fingerprintPayload(input: {
  companyId: string;
  agentId: string;
  provider: string;
  taskId: string;
  riskCodes: string[];
  text: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      companyId: input.companyId,
      agentId: input.agentId,
      provider: input.provider,
      taskId: input.taskId,
      riskCodes: input.riskCodes,
      text: input.text,
    }))
    .digest("hex");
}

function assessRisks(text: string): ProtectedRuntimeRisk[] {
  const risks: ProtectedRuntimeRisk[] = [];
  for (const rule of PROTECTED_RUNTIME_RULES) {
    const match = text.match(rule.pattern);
    if (!match) continue;
    if (isNegatedMention(text, match.index ?? 0)) {
      continue;
    }
    if (
      rule.requiresEnvironmentChangeIntent
      && !hasEnvironmentChangeIntentNearMatch(text, match.index ?? 0)
    ) {
      continue;
    }
    risks.push({
      code: rule.code,
      label: rule.label,
      matched: normalizeText(match[0] ?? rule.code).slice(0, 160),
      severity: rule.severity,
    });
  }
  return risks;
}

export function assessProtectedRuntimeRisksForText(text: string): ProtectedRuntimeRisk[] {
  return assessRisks(normalizeText(text));
}

function shouldAutoApproveProtectedRuntime(companyId: string, db: Database.Database): boolean {
  return isDevExecutionTestModeAvailable() && canAutonomouslyExecuteCompany(companyId, db);
}

function approveProtectedRuntimeGate(input: {
  db: Database.Database;
  companyId: string;
  agentId: string;
  taskId: string;
  approvalId: string;
  runId: string;
  riskCodes: string[];
}): void {
  const now = new Date().toISOString();
  input.db.prepare(
    `UPDATE approvals
     SET status = 'approved',
         decided_by_user_id = ?,
         decision_note = ?,
         decided_at = ?,
         updated_at = ?
     WHERE id = ?
       AND status IN ('pending', 'revision_requested')`,
  ).run(
    "dev-execution-test-mode",
    "Auto-approved under active dev execution test lease.",
    now,
    now,
    input.approvalId,
  );

  recordCompanyAuditEvent({
    companyId: input.companyId,
    agentId: input.agentId,
    taskId: input.taskId,
    approvalId: input.approvalId,
    eventType: "runtime.protected_execution.auto_approved",
    actorUserId: "dev-execution-test-mode",
    metadata: {
      heartbeatRunId: input.runId,
      riskCodes: input.riskCodes,
      reason: "active_dev_execution_test_lease",
    },
  }, input.db);
}

function isNegatedMention(text: string, matchIndex: number): boolean {
  const sentenceStart = Math.max(
    text.lastIndexOf(".", matchIndex),
    text.lastIndexOf("\n", matchIndex),
    text.lastIndexOf(";", matchIndex),
  ) + 1;
  const directPrefix = text.slice(Math.max(0, matchIndex - 12), matchIndex).toLowerCase();
  if (/(^|[^a-z])non[-\s]*$/.test(directPrefix)) {
    return true;
  }
  const prefix = text.slice(sentenceStart, matchIndex).toLowerCase();
  return /\b(do not|don't|dont|never|avoid|without|not|no)\b[\s\S]{0,100}$/.test(prefix);
}

function hasEnvironmentChangeIntentNearMatch(text: string, matchIndex: number): boolean {
  const sentenceStart = Math.max(
    text.lastIndexOf(".", matchIndex),
    text.lastIndexOf("\n", matchIndex),
    text.lastIndexOf(";", matchIndex),
  ) + 1;
  const nextPeriod = text.indexOf(".", matchIndex);
  const nextNewline = text.indexOf("\n", matchIndex);
  const nextSemicolon = text.indexOf(";", matchIndex);
  const sentenceEndCandidates = [nextPeriod, nextNewline, nextSemicolon]
    .filter((index) => index >= 0);
  const sentenceEnd = sentenceEndCandidates.length > 0
    ? Math.min(...sentenceEndCandidates)
    : text.length;
  const sentence = text.slice(sentenceStart, sentenceEnd);
  if (ENVIRONMENT_CHANGE_INTENT_PATTERN.test(sentence)) {
    return true;
  }
  return false;
}

function loadTaskContext(
  db: Database.Database,
  companyId: string,
  taskId: string,
): { task: RuntimeGovernanceTaskRow; text: string } | null {
  const task = db
    .prepare(
      `SELECT
         t.id,
         t.task_key,
         t.title,
         t.description,
         t.type,
         t.priority,
         t.status,
         p.name AS project_name
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       WHERE t.id = ?
         AND p.company_id = ?
         AND t.archived_at IS NULL
       LIMIT 1`,
    )
    .get(taskId, companyId) as RuntimeGovernanceTaskRow | undefined;

  if (!task) return null;

  const text = normalizeText([
    task.task_key,
    task.title,
    task.description ?? "",
    task.type,
    task.priority,
    task.project_name,
  ].join("\n"));

  return { task, text };
}

export function checkProtectedRuntimeExecution(input: {
  db: Database.Database;
  companyId: string;
  agentId: string;
  agentName: string;
  provider: string;
  taskId: string;
  runId: string;
}): ProtectedRuntimeGate {
  if (!shouldRequireProtectedRuntimeApprovals(input.companyId, input.db)) {
    return {
      allowed: true,
      required: false,
      risks: [],
      approvalId: null,
      message: null,
    };
  }

  if (!input.taskId || input.taskId === "__heartbeat__") {
    return {
      allowed: true,
      required: false,
      risks: [],
      approvalId: null,
      message: null,
    };
  }

  const context = loadTaskContext(input.db, input.companyId, input.taskId);
  if (!context) {
    return {
      allowed: true,
      required: false,
      risks: [],
      approvalId: null,
      message: null,
    };
  }

  const risks = assessRisks(context.text);
  if (risks.length === 0) {
    return {
      allowed: true,
      required: false,
      risks: [],
      approvalId: null,
      message: null,
    };
  }

  const fingerprint = fingerprintPayload({
    companyId: input.companyId,
    agentId: input.agentId,
    provider: input.provider,
    taskId: context.task.id,
    riskCodes: risks.map((risk) => risk.code).sort(),
    text: context.text,
  });

  const existing = input.db
    .prepare(
      `SELECT id, status
       FROM approvals
       WHERE company_id = ?
         AND type = 'protected_runtime_command'
         AND linked_task_id = ?
         AND json_extract(payload_json, '$.fingerprint') = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(input.companyId, context.task.id, fingerprint) as RuntimeGovernanceApprovalRow | undefined;

  if (existing?.status === "approved") {
    return {
      allowed: true,
      required: true,
      risks,
      approvalId: existing.id,
      message: `Protected runtime execution approved for ${context.task.task_key}.`,
    };
  }

  if (existing && (existing.status === "pending" || existing.status === "revision_requested")) {
    if (shouldAutoApproveProtectedRuntime(input.companyId, input.db)) {
      approveProtectedRuntimeGate({
        db: input.db,
        companyId: input.companyId,
        agentId: input.agentId,
        taskId: context.task.id,
        approvalId: existing.id,
        runId: input.runId,
        riskCodes: risks.map((risk) => risk.code),
      });
      return {
        allowed: true,
        required: true,
        risks,
        approvalId: existing.id,
        message: `Protected runtime execution auto-approved for ${context.task.task_key} under dev execution test mode.`,
      };
    }
    return {
      allowed: false,
      required: true,
      risks,
      approvalId: existing.id,
      message: `Protected runtime execution for ${context.task.task_key} requires approval ${existing.id}.`,
    };
  }

  const summary = `${input.provider} execution for ${context.task.task_key}`;
  const { approval } = createApproval({
    companyIdOrSlug: input.companyId,
    type: "protected_runtime_command",
    requestedByAgentId: input.agentId,
    linkedTaskId: context.task.id,
    payload: {
      fingerprint,
      summary,
      command: summary,
      provider: input.provider,
      agentId: input.agentId,
      agentName: input.agentName,
      taskId: context.task.id,
      taskKey: context.task.task_key,
      taskTitle: context.task.title,
      reason: "Task context indicates protected file changes or production/runtime-impacting commands.",
      risks,
      requestedDuringRunId: input.runId,
    },
  });

  recordCompanyAuditEvent({
    companyId: input.companyId,
    agentId: input.agentId,
    taskId: context.task.id,
    approvalId: approval.id,
    eventType: "runtime.protected_execution.approval_requested",
    actorUserId: "engine",
    metadata: {
      provider: input.provider,
      taskKey: context.task.task_key,
      riskCodes: risks.map((risk) => risk.code),
      fingerprint,
      heartbeatRunId: input.runId,
    },
  }, input.db);

  if (shouldAutoApproveProtectedRuntime(input.companyId, input.db)) {
    approveProtectedRuntimeGate({
      db: input.db,
      companyId: input.companyId,
      agentId: input.agentId,
      taskId: context.task.id,
      approvalId: approval.id,
      runId: input.runId,
      riskCodes: risks.map((risk) => risk.code),
    });
    return {
      allowed: true,
      required: true,
      risks,
      approvalId: approval.id,
      message: `Protected runtime execution auto-approved for ${context.task.task_key} under dev execution test mode.`,
    };
  }

  return {
    allowed: false,
    required: true,
    risks,
    approvalId: approval.id,
    message: `Protected runtime execution for ${context.task.task_key} requires approval ${approval.id}.`,
  };
}
