import { createHash, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { parseActionsFromText, type McAction } from "@/lib/orchestration/engine/action-dispatcher";
import { createApproval } from "@/lib/orchestration/service/approval";
import {
  ensureCompanyWorkspaceScaffold,
  resolveCompanyProjectWorkspacePath,
  resolveCompanyWorkspaceRoot,
} from "@/lib/workspaces/company-paths";

import type {
  OverseerCodexSessionTelemetry,
  OverseerCompactionDecision,
  OverseerEvent,
  OverseerCompactionPolicy,
  OverseerCompactionSummary,
  OverseerCompactionState,
  OverseerContextSnapshot,
  OverseerContextSnapshotSourceBounds,
  OverseerMessage,
  OverseerMessageRole,
  OverseerQuotaSnapshot,
  OverseerReadiness,
  OverseerRuntimeProvider,
  OverseerSession,
  OverseerSessionStatus,
  OverseerSettings,
  OverseerTurn,
  OverseerTurnStatus,
  OverseerUsageSnapshot,
  OverseerWatchState,
} from "./types";

const DEFAULT_SETTINGS: OverseerSettings = {
  enabled: true,
  codexCommand: "codex",
  approvalMode: "writes",
  sandboxMode: "read-only",
  compaction: {
    enabled: true,
    triggerPercent: 80,
  },
};

const COMPACTION_LIMITATION =
  "Codex CLI slash commands such as /compact are interactive and are not exposed as a stable programmatic command in this exec/resume path. HiveRunner uses a deterministic summary turn fallback, stores it durably on the Overseer session, and injects it into the next Codex exec prompt.";

const DEFAULT_WATCH_INTERVAL_MS = 35_000;
const MIN_WATCH_INTERVAL_MS = 30_000;
const MAX_WATCH_INTERVAL_MS = 5 * 60_000;

type CompanyIdentity = {
  id: string;
  slug: string;
  company_code: string | null;
  name: string;
  workspace_slug: string | null;
  runtime_slug: string | null;
  workspace_root: string | null;
  workspace_source: "openclaw" | "provisioned" | "imported" | "manual" | null;
};

type ProjectRow = {
  id: string;
  slug: string;
  name: string;
  company_id: string;
  settings_json: string | null;
};

type SessionRow = {
  id: string;
  company_id: string;
  company_slug?: string | null;
  company_code?: string | null;
  project_id: string | null;
  project_name?: string | null;
  title: string;
  status: string;
  codex_session_id: string | null;
  workspace_root: string;
  model: string | null;
  reasoning_effort: string | null;
  approval_mode: string;
  compaction_policy: string;
  compaction_context_threshold: number;
  compacted_summary: string | null;
  compacted_at: string | null;
  compacted_by: string | null;
  compaction_metadata_json: string;
  scope_json: string;
  usage_json: string;
  quota_json: string;
  last_error: string | null;
  process_pid: number | null;
  created_by: string | null;
  last_turn_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  message_count?: number;
};

type TurnRow = {
  id: string;
  session_id: string;
  company_id: string;
  user_message_id: string | null;
  assistant_message_id: string | null;
  status: string;
  codex_session_id: string | null;
  prompt: string;
  usage_json: string;
  error_message: string | null;
  process_pid: number | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  session_id: string;
  turn_id: string | null;
  company_id: string;
  role: string;
  content: string;
  metadata_json: string;
  sequence: number;
  created_at: string;
};

type EventRow = {
  id: string;
  session_id: string;
  turn_id: string | null;
  company_id: string;
  event_type: string;
  event_json: string;
  sequence: number;
  occurred_at: string;
  created_at: string;
};

type ContextSnapshotRow = {
  id: string;
  session_id: string;
  company_id: string;
  version: number;
  summary: string;
  summary_hash: string;
  source_message_min_sequence: number | null;
  source_message_max_sequence: number | null;
  source_message_count: number;
  source_event_min_sequence: number | null;
  source_event_max_sequence: number | null;
  source_event_count: number;
  source_turn_count: number;
  source_turn_first_started_at: string | null;
  source_turn_last_started_at: string | null;
  usage_snapshot_json: string;
  attachment_manifest_json: string;
  compaction_metadata_json: string;
  created_by: string | null;
  created_at: string;
};

type WatchTimerRegistry = Map<string, ReturnType<typeof setTimeout>>;

const watchTimerRegistry = ((globalThis as typeof globalThis & {
  __hiverunnerOverseerWatchTimers?: WatchTimerRegistry;
}).__hiverunnerOverseerWatchTimers ??= new Map());

function parseRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringFromRecord(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function numberFromRecord(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeWatchIntervalMs(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_WATCH_INTERVAL_MS;
  return Math.min(MAX_WATCH_INTERVAL_MS, Math.max(MIN_WATCH_INTERVAL_MS, Math.round(numeric)));
}

function normalizeOverseerWatchState(value: unknown): OverseerWatchState | null {
  const record = recordValue(value);
  if (Object.keys(record).length === 0) return null;
  const rawStatus = stringFromRecord(record, ["status"]);
  const status = rawStatus === "watching" || rawStatus === "completed" || rawStatus === "failed"
    ? rawStatus
    : "stopped";
  const enabled = typeof record.enabled === "boolean" ? record.enabled : status === "watching";
  return {
    enabled,
    status,
    startedAt: stringFromRecord(record, ["startedAt"]),
    lastCheckAt: stringFromRecord(record, ["lastCheckAt"]),
    stoppedAt: stringFromRecord(record, ["stoppedAt"]),
    intervalMs: normalizeWatchIntervalMs(record.intervalMs),
    checkCount: Math.max(0, Math.round(numberFromRecord(record, "checkCount") ?? 0)),
    digest: stringFromRecord(record, ["digest", "lastObservedStateHash"]),
    lastSummary: stringFromRecord(record, ["lastSummary"]),
    lastMessageAt: stringFromRecord(record, ["lastMessageAt"]),
    error: stringFromRecord(record, ["error"]),
  };
}

function parseRecordArray(value: string | null | undefined): Array<Record<string, unknown>> {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => (
        typeof item === "object" && item !== null && !Array.isArray(item)
      ))
      : [];
  } catch {
    return [];
  }
}

export function normalizeOverseerRuntimeProvider(value: unknown): OverseerRuntimeProvider {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "claude" || normalized === "claude-code" || normalized === "anthropic") return "anthropic";
  if (normalized === "gemini" || normalized === "google" || normalized === "gemini-cli") return "gemini";
  return "codex";
}

export function normalizeOverseerCompactionPolicy(value: unknown): OverseerCompactionPolicy {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "manual" || normalized === "auto") return normalized;
  return "ask";
}

function normalizeOverseerContextThreshold(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 70;
  return Math.min(100, Math.max(1, Math.round(numeric)));
}

function normalizeOverseerSettingsCompaction(value: unknown): OverseerSettings["compaction"] {
  const record = recordValue(value);
  const triggerPercent = typeof record.triggerPercent === "number" && Number.isFinite(record.triggerPercent)
    ? Math.min(95, Math.max(50, Math.round(record.triggerPercent)))
    : DEFAULT_SETTINGS.compaction.triggerPercent;
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : DEFAULT_SETTINGS.compaction.enabled,
    triggerPercent,
  };
}

function usageFromJson(value: string | null | undefined): OverseerUsageSnapshot {
  return parseRecord(value) as OverseerUsageSnapshot;
}

function quotaFromJson(value: string | null | undefined): OverseerQuotaSnapshot {
  const parsed = parseRecord(value) as OverseerQuotaSnapshot;
  return parsed.status ? parsed : { status: "unavailable", reason: "Quota telemetry has not been fetched yet." };
}

function compactionFromRow(row: SessionRow): OverseerCompactionState {
  return {
    policy: normalizeOverseerCompactionPolicy(row.compaction_policy),
    contextThreshold: normalizeOverseerContextThreshold(row.compaction_context_threshold),
    latestSummary: row.compacted_summary,
    compactedAt: row.compacted_at,
    compactedBy: row.compacted_by,
    metadata: parseRecord(row.compaction_metadata_json),
  };
}

function numberFromUsage(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function mergeUsageTotals(
  current: OverseerUsageSnapshot,
  delta: OverseerUsageSnapshot,
): OverseerUsageSnapshot {
  const sum = (key: keyof OverseerUsageSnapshot) => {
    if (key === "turnCount") return (current.turnCount ?? 0) + 1;
    const next = numberFromUsage(delta[key]);
    if (next === undefined) return current[key];
    return (numberFromUsage(current[key]) ?? 0) + next;
  };
  return {
    inputTokens: sum("inputTokens") as number | undefined,
    outputTokens: sum("outputTokens") as number | undefined,
    cacheReadInputTokens: sum("cacheReadInputTokens") as number | undefined,
    cacheCreationInputTokens: sum("cacheCreationInputTokens") as number | undefined,
    totalTokens: sum("totalTokens") as number | undefined,
    turnCount: sum("turnCount") as number | undefined,
  };
}

function resolveCompanyOrThrow(companyIdOrSlug: string, db = getOrchestrationDb()): CompanyIdentity {
  const company = resolveCompanyIdBySlug(companyIdOrSlug, db, { includeArchived: false });
  if (!company) throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  return company;
}

function loadProject(db: Database.Database, companyId: string, projectId?: string | null): ProjectRow | null {
  if (!projectId?.trim()) return null;
  const row = db
    .prepare(
      `SELECT id, slug, name, company_id, settings_json
       FROM projects
       WHERE (id = ? OR slug = ?)
         AND company_id = ?
         AND archived_at IS NULL
       LIMIT 1`,
    )
    .get(projectId, projectId, companyId) as ProjectRow | undefined;
  if (!row) throw new OrchestrationApiError(404, "project_not_found", "Project not found");
  return row;
}

function settingsFromCompany(db: Database.Database, companyId: string): OverseerSettings {
  const row = db
    .prepare("SELECT settings_json FROM companies WHERE id = ? LIMIT 1")
    .get(companyId) as { settings_json: string | null } | undefined;
  const settings = parseRecord(row?.settings_json);
  const overseer = typeof settings.overseer === "object" && settings.overseer !== null && !Array.isArray(settings.overseer)
    ? settings.overseer as Record<string, unknown>
    : {};
  return {
    enabled: typeof overseer.enabled === "boolean" ? overseer.enabled : DEFAULT_SETTINGS.enabled,
    codexCommand: typeof overseer.codexCommand === "string" && overseer.codexCommand.trim()
      ? overseer.codexCommand.trim()
      : DEFAULT_SETTINGS.codexCommand,
    approvalMode: overseer.approvalMode === "manual" ? "manual" : "writes",
    sandboxMode: "read-only",
    compaction: normalizeOverseerSettingsCompaction(overseer.compaction),
  };
}

export function getOverseerSettings(companyIdOrSlug: string): { settings: OverseerSettings } {
  const db = getOrchestrationDb();
  const company = resolveCompanyOrThrow(companyIdOrSlug, db);
  return { settings: settingsFromCompany(db, company.id) };
}

export function updateOverseerSettings(input: {
  companyIdOrSlug: string;
  enabled?: boolean;
  codexCommand?: string;
  approvalMode?: "writes" | "manual";
  compaction?: Partial<OverseerSettings["compaction"]>;
}): { settings: OverseerSettings } {
  const db = getOrchestrationDb();
  const company = resolveCompanyOrThrow(input.companyIdOrSlug, db);
  const row = db
    .prepare("SELECT settings_json FROM companies WHERE id = ? LIMIT 1")
    .get(company.id) as { settings_json: string | null } | undefined;
  const settings = parseRecord(row?.settings_json);
  const current = settingsFromCompany(db, company.id);
  settings.overseer = {
    ...current,
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.codexCommand !== undefined ? { codexCommand: input.codexCommand.trim() || "codex" } : {}),
    ...(input.approvalMode !== undefined ? { approvalMode: input.approvalMode } : {}),
    ...(input.compaction !== undefined
      ? { compaction: normalizeOverseerSettingsCompaction({ ...current.compaction, ...input.compaction }) }
      : {}),
    sandboxMode: "read-only",
  };
  db.prepare("UPDATE companies SET settings_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(settings), new Date().toISOString(), company.id);
  return { settings: settingsFromCompany(db, company.id) };
}

export function resolveOverseerWorkspace(input: {
  companyIdOrSlug: string;
  projectId?: string | null;
  db?: Database.Database;
}): {
  company: CompanyIdentity;
  project: ProjectRow | null;
  workspaceRoot: string;
  source: "company_workspace" | "project_workspace";
} {
  const db = input.db ?? getOrchestrationDb();
  const company = resolveCompanyOrThrow(input.companyIdOrSlug, db);
  const companyRoot = resolveCompanyWorkspaceRoot({
    companyId: company.id,
    workspaceSlug: company.workspace_slug,
    workspaceRoot: company.workspace_root,
    workspaceSource: company.workspace_source,
  });
  const scaffold = ensureCompanyWorkspaceScaffold(companyRoot);
  const project = loadProject(db, company.id, input.projectId);
  if (!project) {
    return { company, project, workspaceRoot: scaffold.root, source: "company_workspace" };
  }
  const projectWorkspace = resolveCompanyProjectWorkspacePath(scaffold.root, project);
  if (projectWorkspace.path) {
    fs.mkdirSync(projectWorkspace.path, { recursive: true });
    return { company, project, workspaceRoot: path.resolve(projectWorkspace.path), source: "project_workspace" };
  }
  return { company, project, workspaceRoot: scaffold.root, source: "company_workspace" };
}

export function getOverseerReadiness(input: {
  companyIdOrSlug: string;
  projectId?: string | null;
  codexStatus?: {
    command: string;
    installed: boolean;
    version: string | null;
    authReady: boolean;
    authMode: "chatgpt" | "api_key" | "unknown" | "missing";
    loginStatus: string;
    error?: string;
  };
}): OverseerReadiness {
  const db = getOrchestrationDb();
  const workspace = resolveOverseerWorkspace({ companyIdOrSlug: input.companyIdOrSlug, projectId: input.projectId, db });
  const settings = settingsFromCompany(db, workspace.company.id);
  const codex = input.codexStatus ?? {
    command: settings.codexCommand,
    installed: false,
    version: null,
    authReady: false,
    authMode: "unknown" as const,
    loginStatus: "Not checked",
  };
  let writable = false;
  try {
    fs.mkdirSync(workspace.workspaceRoot, { recursive: true });
    fs.accessSync(workspace.workspaceRoot, fs.constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }
  const quota: OverseerQuotaSnapshot = {
    status: "unavailable",
    reason: "Codex quota buckets are best-effort and not exposed by this local CLI session yet.",
    updatedAt: new Date().toISOString(),
  };
  return {
    settings,
    codex,
    workspace: {
      root: workspace.workspaceRoot,
      exists: fs.existsSync(workspace.workspaceRoot),
      writable,
      source: workspace.source,
      projectId: workspace.project?.id ?? null,
    },
    quota,
    ready: settings.enabled && codex.installed && codex.authReady && writable,
  };
}

function sessionFromRow(row: SessionRow): OverseerSession {
  return {
    id: row.id,
    companyId: row.company_id,
    companySlug: row.company_slug ?? undefined,
    companyCode: row.company_code ?? null,
    projectId: row.project_id,
    projectName: row.project_name ?? null,
    title: row.title,
    status: row.status as OverseerSessionStatus,
    codexSessionId: row.codex_session_id,
    workspaceRoot: row.workspace_root,
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    approvalMode: row.approval_mode === "manual" ? "manual" : "writes",
    compaction: compactionFromRow(row),
    scope: parseRecord(row.scope_json),
    usage: usageFromJson(row.usage_json),
    quota: quotaFromJson(row.quota_json),
    lastError: row.last_error,
    processPid: row.process_pid,
    createdBy: row.created_by,
    lastTurnAt: row.last_turn_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    messageCount: Number(row.message_count ?? 0),
  };
}

function turnFromRow(row: TurnRow): OverseerTurn {
  return {
    id: row.id,
    sessionId: row.session_id,
    companyId: row.company_id,
    userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id,
    status: row.status as OverseerTurnStatus,
    codexSessionId: row.codex_session_id,
    prompt: row.prompt,
    usage: usageFromJson(row.usage_json),
    errorMessage: row.error_message,
    processPid: row.process_pid,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function messageFromRow(row: MessageRow): OverseerMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    companyId: row.company_id,
    role: row.role as OverseerMessageRole,
    content: row.content,
    metadata: parseRecord(row.metadata_json),
    sequence: Number(row.sequence ?? 0),
    createdAt: row.created_at,
  };
}

function eventFromRow(row: EventRow): OverseerEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    companyId: row.company_id,
    eventType: row.event_type,
    event: parseRecord(row.event_json),
    sequence: Number(row.sequence ?? 0),
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

function contextSnapshotFromRow(row: ContextSnapshotRow): OverseerContextSnapshot {
  return {
    id: row.id,
    sessionId: row.session_id,
    companyId: row.company_id,
    version: Number(row.version),
    summary: row.summary,
    summaryHash: row.summary_hash,
    sourceBounds: {
      messages: {
        count: Number(row.source_message_count ?? 0),
        minSequence: row.source_message_min_sequence,
        maxSequence: row.source_message_max_sequence,
      },
      events: {
        count: Number(row.source_event_count ?? 0),
        minSequence: row.source_event_min_sequence,
        maxSequence: row.source_event_max_sequence,
      },
      turns: {
        count: Number(row.source_turn_count ?? 0),
        firstStartedAt: row.source_turn_first_started_at,
        lastStartedAt: row.source_turn_last_started_at,
      },
    },
    usage: usageFromJson(row.usage_snapshot_json),
    attachmentManifest: parseRecordArray(row.attachment_manifest_json),
    compactionMetadata: parseRecord(row.compaction_metadata_json),
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function contextSnapshotSummaryHash(summary: string): string {
  return createHash("sha256").update(summary).digest("hex");
}

function readOverseerContextSnapshotSourceBounds(
  db: Database.Database,
  sessionId: string,
): OverseerContextSnapshotSourceBounds {
  const messages = db
    .prepare(
      `SELECT COUNT(*) AS count,
              MIN(sequence) AS min_sequence,
              MAX(sequence) AS max_sequence
       FROM overseer_session_messages
       WHERE session_id = ?`,
    )
    .get(sessionId) as { count: number; min_sequence: number | null; max_sequence: number | null };
  const events = db
    .prepare(
      `SELECT COUNT(*) AS count,
              MIN(sequence) AS min_sequence,
              MAX(sequence) AS max_sequence
       FROM overseer_session_events
       WHERE session_id = ?`,
    )
    .get(sessionId) as { count: number; min_sequence: number | null; max_sequence: number | null };
  const turns = db
    .prepare(
      `SELECT COUNT(*) AS count,
              MIN(started_at) AS first_started_at,
              MAX(started_at) AS last_started_at
       FROM overseer_turns
       WHERE session_id = ?`,
    )
    .get(sessionId) as { count: number; first_started_at: string | null; last_started_at: string | null };
  return {
    messages: {
      count: Number(messages.count ?? 0),
      minSequence: messages.min_sequence ?? null,
      maxSequence: messages.max_sequence ?? null,
    },
    events: {
      count: Number(events.count ?? 0),
      minSequence: events.min_sequence ?? null,
      maxSequence: events.max_sequence ?? null,
    },
    turns: {
      count: Number(turns.count ?? 0),
      firstStartedAt: turns.first_started_at ?? null,
      lastStartedAt: turns.last_started_at ?? null,
    },
  };
}

function collectOverseerAttachmentManifest(db: Database.Database, sessionId: string): Array<Record<string, unknown>> {
  const rows = db
    .prepare(
      `SELECT id, sequence, metadata_json
       FROM overseer_session_messages
       WHERE session_id = ?
       ORDER BY sequence ASC, created_at ASC`,
    )
    .all(sessionId) as Array<{ id: string; sequence: number; metadata_json: string }>;
  const manifest: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const metadata = parseRecord(row.metadata_json);
    const attachments = Array.isArray(metadata.attachments) ? metadata.attachments : [];
    for (const attachment of attachments) {
      if (typeof attachment !== "object" || attachment === null || Array.isArray(attachment)) continue;
      manifest.push({
        ...(attachment as Record<string, unknown>),
        sourceMessageId: row.id,
        sourceMessageSequence: Number(row.sequence ?? 0),
      });
    }
  }
  return manifest;
}

function nextOverseerContextSnapshotVersion(db: Database.Database, sessionId: string): number {
  const row = db
    .prepare("SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM overseer_context_snapshots WHERE session_id = ?")
    .get(sessionId) as { next_version: number } | undefined;
  return Number(row?.next_version ?? 1);
}

function loadSessionRow(db: Database.Database, sessionId: string): SessionRow | undefined {
  return db
    .prepare(
      `SELECT s.*, c.slug AS company_slug, c.company_code AS company_code, p.name AS project_name,
              (SELECT COUNT(*) FROM overseer_session_messages m WHERE m.session_id = s.id) AS message_count
       FROM overseer_sessions s
       INNER JOIN companies c ON c.id = s.company_id
       LEFT JOIN projects p ON p.id = s.project_id
       WHERE s.id = ?
         AND s.archived_at IS NULL
       LIMIT 1`,
    )
    .get(sessionId) as SessionRow | undefined;
}

export function getOverseerSession(sessionId: string, db = getOrchestrationDb()): OverseerSession {
  const row = loadSessionRow(db, sessionId);
  if (!row) throw new OrchestrationApiError(404, "overseer_session_not_found", "Overseer session not found");
  return sessionFromRow(row);
}

export function assertOverseerSessionCompany(input: {
  sessionId: string;
  companyIdOrSlug: string;
  db?: Database.Database;
}): OverseerSession {
  const db = input.db ?? getOrchestrationDb();
  const company = resolveCompanyOrThrow(input.companyIdOrSlug, db);
  const session = getOverseerSession(input.sessionId, db);
  if (session.companyId !== company.id) {
    throw new OrchestrationApiError(404, "overseer_session_not_found", "Overseer session not found");
  }
  return session;
}

export function listOverseerSessions(input: {
  companyIdOrSlug: string;
  projectId?: string | null;
}): { sessions: OverseerSession[] } {
  const db = getOrchestrationDb();
  const company = resolveCompanyOrThrow(input.companyIdOrSlug, db);
  const args: unknown[] = [company.id];
  const where = ["s.company_id = ?", "s.archived_at IS NULL"];
  if (input.projectId?.trim()) {
    where.push("(s.project_id = ? OR p.slug = ?)");
    args.push(input.projectId, input.projectId);
  }
  const rows = db
    .prepare(
      `SELECT s.*, c.slug AS company_slug, c.company_code AS company_code, p.name AS project_name,
              COUNT(m.id) AS message_count
       FROM overseer_sessions s
       INNER JOIN companies c ON c.id = s.company_id
       LEFT JOIN projects p ON p.id = s.project_id
       LEFT JOIN overseer_session_messages m ON m.session_id = s.id
       WHERE ${where.join(" AND ")}
       GROUP BY s.id
       ORDER BY COALESCE(s.last_turn_at, s.updated_at) DESC`,
    )
    .all(...args) as SessionRow[];
  return { sessions: rows.map(sessionFromRow) };
}

export function createOverseerSession(input: {
  companyIdOrSlug: string;
  projectId?: string | null;
  title?: string;
  provider?: OverseerRuntimeProvider | null;
  createdBy?: string;
}): { session: OverseerSession } {
  const db = getOrchestrationDb();
  const resolved = resolveOverseerWorkspace({ companyIdOrSlug: input.companyIdOrSlug, projectId: input.projectId, db });
  const settings = settingsFromCompany(db, resolved.company.id);
  const now = new Date().toISOString();
  const id = randomUUID();
  const title = input.title?.trim() || "New Overseer Session";
  const provider = normalizeOverseerRuntimeProvider(input.provider);
  db.prepare(
    `INSERT INTO overseer_sessions
       (id, company_id, project_id, title, status, workspace_root, approval_mode, scope_json, quota_json, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'idle', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    resolved.company.id,
    resolved.project?.id ?? null,
    title,
    resolved.workspaceRoot,
    settings.approvalMode,
    JSON.stringify({ workspaceSource: resolved.source, overseerProvider: provider }),
    JSON.stringify({ status: "unavailable", reason: "Quota telemetry has not been fetched yet." }),
    input.createdBy ?? "operator",
    now,
    now,
  );
  return { session: getOverseerSession(id, db) };
}

function nextSequence(db: Database.Database, table: "overseer_session_messages" | "overseer_session_events", sessionId: string): number {
  const row = db
    .prepare(`SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM ${table} WHERE session_id = ?`)
    .get(sessionId) as { next_sequence: number } | undefined;
  return Number(row?.next_sequence ?? 1);
}

export function appendOverseerMessage(input: {
  sessionId: string;
  role: OverseerMessageRole;
  content: string;
  turnId?: string | null;
  metadata?: Record<string, unknown>;
  db?: Database.Database;
}): OverseerMessage {
  const db = input.db ?? getOrchestrationDb();
  const session = getOverseerSession(input.sessionId, db);
  const id = randomUUID();
  const now = new Date().toISOString();
  const sequence = nextSequence(db, "overseer_session_messages", session.id);
  db.prepare(
    `INSERT INTO overseer_session_messages
       (id, session_id, turn_id, company_id, role, content, metadata_json, sequence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    session.id,
    input.turnId ?? null,
    session.companyId,
    input.role,
    input.content,
    JSON.stringify(input.metadata ?? {}),
    sequence,
    now,
  );
  db.prepare("UPDATE overseer_sessions SET updated_at = ? WHERE id = ?").run(now, session.id);
  return listOverseerMessages(session.id, db).messages.find((message) => message.id === id)!;
}

export function listOverseerMessages(sessionId: string, db = getOrchestrationDb()): { messages: OverseerMessage[] } {
  const rows = db
    .prepare(
      `SELECT *
       FROM overseer_session_messages
       WHERE session_id = ?
       ORDER BY sequence ASC, created_at ASC`,
    )
    .all(sessionId) as MessageRow[];
  return { messages: rows.map(messageFromRow) };
}

export function listOverseerEvents(sessionId: string, db = getOrchestrationDb()): { events: OverseerEvent[] } {
  const rows = db
    .prepare(
      `SELECT *
       FROM overseer_session_events
       WHERE session_id = ?
       ORDER BY sequence ASC, created_at ASC`,
    )
    .all(sessionId) as EventRow[];
  return { events: rows.map(eventFromRow) };
}

export function createOverseerContextSnapshot(input: {
  sessionId: string;
  summary: string;
  version?: number;
  usageSnapshot?: OverseerUsageSnapshot;
  attachmentManifest?: Array<Record<string, unknown>>;
  compactionMetadata?: Record<string, unknown>;
  createdBy?: string | null;
  db?: Database.Database;
}): { snapshot: OverseerContextSnapshot } {
  const db = input.db ?? getOrchestrationDb();
  const proposedSummary = input.summary.trim();
  if (!proposedSummary) {
    throw new OrchestrationApiError(400, "context_snapshot_summary_required", "Context snapshot summary is required");
  }
  if (input.version !== undefined && (!Number.isInteger(input.version) || input.version < 1)) {
    throw new OrchestrationApiError(400, "invalid_context_snapshot_version", "Context snapshot version must be a positive integer");
  }

  const createSnapshot = db.transaction(() => {
    const session = getOverseerSession(input.sessionId, db);
    const id = randomUUID();
    const now = new Date().toISOString();
    const version = input.version ?? nextOverseerContextSnapshotVersion(db, session.id);
    const sourceBounds = readOverseerContextSnapshotSourceBounds(db, session.id);
    const usageSnapshot = input.usageSnapshot ?? session.usage;
    const attachmentManifest = input.attachmentManifest ?? collectOverseerAttachmentManifest(db, session.id);
    const compactionMetadata = input.compactionMetadata ?? session.compaction.metadata;
    const hash = contextSnapshotSummaryHash(proposedSummary);

    db.prepare(
      `INSERT INTO overseer_context_snapshots
         (id, session_id, company_id, version, summary, summary_hash,
          source_message_min_sequence, source_message_max_sequence, source_message_count,
          source_event_min_sequence, source_event_max_sequence, source_event_count,
          source_turn_count, source_turn_first_started_at, source_turn_last_started_at,
          usage_snapshot_json, attachment_manifest_json, compaction_metadata_json,
          created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      session.id,
      session.companyId,
      version,
      proposedSummary,
      hash,
      sourceBounds.messages.minSequence,
      sourceBounds.messages.maxSequence,
      sourceBounds.messages.count,
      sourceBounds.events.minSequence,
      sourceBounds.events.maxSequence,
      sourceBounds.events.count,
      sourceBounds.turns.count,
      sourceBounds.turns.firstStartedAt,
      sourceBounds.turns.lastStartedAt,
      JSON.stringify(usageSnapshot),
      JSON.stringify(attachmentManifest),
      JSON.stringify(compactionMetadata),
      input.createdBy ?? null,
      now,
    );

    return contextSnapshotFromRow(
      db.prepare("SELECT * FROM overseer_context_snapshots WHERE id = ? LIMIT 1").get(id) as ContextSnapshotRow,
    );
  });

  try {
    return { snapshot: createSnapshot() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed: overseer_context_snapshots\.company_id, overseer_context_snapshots\.session_id, overseer_context_snapshots\.version/i.test(message)) {
      throw new OrchestrationApiError(409, "context_snapshot_version_exists", "Context snapshot version already exists for this session");
    }
    throw error;
  }
}

export function listOverseerContextSnapshots(input: {
  sessionId: string;
  companyIdOrSlug?: string;
  limit?: number;
  db?: Database.Database;
}): { snapshots: OverseerContextSnapshot[] } {
  const db = input.db ?? getOrchestrationDb();
  const session = input.companyIdOrSlug
    ? assertOverseerSessionCompany({ sessionId: input.sessionId, companyIdOrSlug: input.companyIdOrSlug, db })
    : getOverseerSession(input.sessionId, db);
  const rawLimit = typeof input.limit === "number" && Number.isFinite(input.limit) ? input.limit : 25;
  const limit = Math.min(100, Math.max(1, Math.trunc(rawLimit)));
  const rows = db
    .prepare(
      `SELECT *
       FROM overseer_context_snapshots
       WHERE session_id = ?
         AND company_id = ?
       ORDER BY version DESC
       LIMIT ?`,
    )
    .all(session.id, session.companyId, limit) as ContextSnapshotRow[];
  return { snapshots: rows.map(contextSnapshotFromRow) };
}

function safeIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function compactionControlsForSession(session: OverseerSession, settings?: OverseerSettings): {
  mode: OverseerCompactionPolicy;
  thresholdPercent: number;
  manualRequestedAt: string | null;
  status: string;
} {
  const scoped = recordValue(session.scope.compaction);
  const mode = normalizeOverseerCompactionPolicy(scoped.mode ?? session.compaction.policy);
  const scopedThreshold = typeof scoped.thresholdPercent === "number" && Number.isFinite(scoped.thresholdPercent)
    ? scoped.thresholdPercent
    : undefined;
  const thresholdPercent = normalizeOverseerContextThreshold(
    scopedThreshold ?? session.compaction.contextThreshold ?? settings?.compaction.triggerPercent,
  );
  return {
    mode,
    thresholdPercent,
    manualRequestedAt: safeIso(typeof scoped.manualRequestedAt === "string" ? scoped.manualRequestedAt : null),
    status: typeof scoped.status === "string" ? scoped.status : "idle",
  };
}

export function decideOverseerCompaction(input: {
  session: OverseerSession;
  settings?: OverseerSettings;
  telemetry: OverseerCodexSessionTelemetry | null;
}): OverseerCompactionDecision {
  const controls = compactionControlsForSession(input.session, input.settings);
  const settingsEnabled = input.settings?.compaction.enabled ?? true;
  const context = input.telemetry?.context;
  const usedTokens = typeof context?.usedTokens === "number" && Number.isFinite(context.usedTokens)
    ? context.usedTokens
    : null;
  const limitTokens = typeof context?.limitTokens === "number" && Number.isFinite(context.limitTokens) && context.limitTokens > 0
    ? context.limitTokens
    : null;
  const percent = usedTokens !== null && limitTokens !== null
    ? Math.round((usedTokens / limitTokens) * 1000) / 10
    : null;
  const decisionBase = {
    source: input.telemetry ? "codex_session_file" as const : "unavailable" as const,
    triggerPercent: controls.thresholdPercent,
    context: {
      usedTokens,
      limitTokens,
      percent,
      updatedAt: input.telemetry?.updatedAt,
    },
  };

  if (!input.session.codexSessionId) {
    return { ...decisionBase, shouldCompact: false, reason: "No active Codex session id is available to compact." };
  }
  const manualRequested = controls.status === "requested" && Boolean(
    controls.manualRequestedAt && controls.manualRequestedAt !== input.session.compaction.compactedAt,
  );
  if (!settingsEnabled && !manualRequested) {
    return { ...decisionBase, shouldCompact: false, reason: "Overseer compaction is disabled in company settings." };
  }
  if (controls.mode === "manual" && !manualRequested) {
    return { ...decisionBase, shouldCompact: false, reason: "Session compaction mode is manual and no manual compaction was requested." };
  }
  if (manualRequested) {
    return { ...decisionBase, shouldCompact: true, reason: "Manual compaction was requested for this session." };
  }
  if (!input.telemetry) {
    return { ...decisionBase, shouldCompact: false, reason: "Codex token-count telemetry is not available for this session." };
  }
  if (usedTokens === null || limitTokens === null || percent === null) {
    return { ...decisionBase, shouldCompact: false, reason: "Codex token-count telemetry does not include both used and limit token counts." };
  }
  if (controls.mode === "ask") {
    return { ...decisionBase, shouldCompact: false, reason: "Session compaction mode is ask; runtime will not compact without a manual request." };
  }
  if (percent < controls.thresholdPercent) {
    return { ...decisionBase, shouldCompact: false, reason: `Context usage is ${percent}% below the ${controls.thresholdPercent}% compaction threshold.` };
  }
  return { ...decisionBase, shouldCompact: true, reason: `Context usage is ${percent}% at or above the ${controls.thresholdPercent}% compaction threshold.` };
}

export function latestOverseerCompactedSummary(session: OverseerSession): string | null {
  return session.compaction.latestSummary?.trim() || null;
}

export function buildDeterministicOverseerSummary(input: {
  session: OverseerSession;
  messages: OverseerMessage[];
  events: OverseerEvent[];
  decision: OverseerCompactionDecision;
}): OverseerCompactionSummary {
  const generatedAt = new Date().toISOString();
  const recentMessages = input.messages
    .filter((message) => message.role === "user" || message.role === "assistant" || message.role === "approval")
    .slice(-24);
  const recentEvents = input.events
    .filter((event) => /approval|workspace\.diff|turn\.completed|thread\.started|codex\./i.test(event.eventType))
    .slice(-16);
  const lines = [
    "# HiveRunner Overseer compacted summary",
    "",
    `Generated at: ${generatedAt}`,
    `Session: ${input.session.title} (${input.session.id})`,
    `Workspace root: ${input.session.workspaceRoot}`,
    `Previous Codex session id: ${input.session.codexSessionId ?? "none"}`,
    `Provider: ${normalizeOverseerRuntimeProvider(input.session.scope.overseerProvider)}`,
    `Model: ${input.session.model ?? "default"}`,
    `Reasoning effort: ${input.session.reasoningEffort ?? "default"}`,
    `Compaction reason: ${input.decision.reason}`,
    input.decision.context.percent !== null
      ? `Context usage: ${input.decision.context.usedTokens} / ${input.decision.context.limitTokens} tokens (${input.decision.context.percent}%).`
      : "Context usage: unavailable from Codex token-count telemetry.",
    "",
    "Runtime limitation:",
    COMPACTION_LIMITATION,
    "",
    "Standing operating rules to preserve:",
    "- The Overseer may do read-only analysis and reports.",
    "- State-changing HiveRunner actions must be emitted as fenced ```mc-action JSON blocks for approval.",
    "- The workspace root above is the bound company/project workspace.",
    "",
    "Recent transcript:",
    ...recentMessages.map((message) => {
      const role = message.role === "approval" ? "approval notice" : message.role;
      return `- ${role} at ${message.createdAt}: ${compactText(message.content, 900)}`;
    }),
    "",
    "Recent runtime events:",
    ...recentEvents.map((event) => `- ${event.eventType} at ${event.occurredAt}: ${compactText(JSON.stringify(event.event), 500)}`),
  ];
  const summary = lines.join("\n").trim();
  return {
    summary,
    generatedAt,
    strategy: "deterministic_summary_turn",
    limitation: COMPACTION_LIMITATION,
    sourceCodexSessionId: input.session.codexSessionId,
    context: input.decision.context,
    reason: input.decision.reason,
  };
}

export function compactOverseerSessionWithSummary(input: {
  sessionId: string;
  decision: OverseerCompactionDecision;
  db?: Database.Database;
}): { session: OverseerSession; summary: OverseerCompactionSummary; messageId: string } {
  const db = input.db ?? getOrchestrationDb();
  const session = getOverseerSession(input.sessionId, db);
  const messages = listOverseerMessages(session.id, db).messages;
  const events = listOverseerEvents(session.id, db).events;
  const summary = buildDeterministicOverseerSummary({
    session,
    messages,
    events,
    decision: input.decision,
  });
  const now = summary.generatedAt;
  const snapshot = createOverseerContextSnapshot({
    sessionId: session.id,
    summary: summary.summary,
    usageSnapshot: session.usage,
    attachmentManifest: collectOverseerAttachmentManifest(db, session.id),
    compactionMetadata: {
      strategy: summary.strategy,
      limitation: summary.limitation,
      reason: summary.reason,
      sourceCodexSessionId: summary.sourceCodexSessionId,
      context: summary.context,
      source: "deterministic_runtime_compaction",
      createdBeforeMutation: true,
    },
    createdBy: "runtime",
    db,
  }).snapshot;
  const scope = { ...session.scope };
  const existingCompaction = recordValue(scope.compaction);
  scope.compaction = {
    ...existingCompaction,
    status: "idle",
    hasMemorySummary: true,
    summaryUpdatedAt: now,
    summaryTokenEstimate: estimateTokenCount(summary.summary),
  };
  db.prepare(
    `UPDATE overseer_sessions
     SET codex_session_id = NULL,
         compacted_summary = ?,
         compacted_at = ?,
         compacted_by = ?,
         compaction_metadata_json = ?,
         scope_json = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    summary.summary,
    now,
    "runtime",
    JSON.stringify({
      strategy: summary.strategy,
      limitation: summary.limitation,
      reason: summary.reason,
      sourceCodexSessionId: summary.sourceCodexSessionId,
      context: summary.context,
      snapshotId: snapshot.id,
      snapshotVersion: snapshot.version,
      snapshotSummaryHash: snapshot.summaryHash,
    }),
    JSON.stringify(scope),
    now,
    session.id,
  );
  const message = appendOverseerMessage({
    sessionId: session.id,
    role: "system",
    content: summary.summary,
    metadata: {
      kind: "overseer_compacted_summary",
      strategy: summary.strategy,
      sourceCodexSessionId: summary.sourceCodexSessionId,
      context: summary.context,
      limitation: summary.limitation,
      snapshotId: snapshot.id,
      snapshotVersion: snapshot.version,
      snapshotSummaryHash: snapshot.summaryHash,
    },
    db,
  });
  recordOverseerEvent({
    sessionId: session.id,
    eventType: "codex.compaction.completed",
    event: {
      strategy: summary.strategy,
      sourceCodexSessionId: summary.sourceCodexSessionId,
      context: summary.context,
      limitation: summary.limitation,
      snapshotId: snapshot.id,
      snapshotVersion: snapshot.version,
      snapshotSummaryHash: snapshot.summaryHash,
    },
    occurredAt: now,
    db,
  });
  return {
    session: getOverseerSession(session.id, db),
    summary,
    messageId: message.id,
  };
}

export function createOverseerTurn(input: {
  sessionId: string;
  userMessageId: string;
  prompt: string;
  db?: Database.Database;
}): OverseerTurn {
  const db = input.db ?? getOrchestrationDb();
  const session = getOverseerSession(input.sessionId, db);
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO overseer_turns
       (id, session_id, company_id, user_message_id, status, codex_session_id, prompt, started_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`,
  ).run(id, session.id, session.companyId, input.userMessageId, session.codexSessionId, input.prompt, now, now, now);
  db.prepare(
    `UPDATE overseer_sessions
     SET status = 'running',
         process_pid = NULL,
         last_error = NULL,
         last_turn_at = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(now, now, session.id);
  return getOverseerTurn(id, db);
}

export function getOverseerTurn(turnId: string, db = getOrchestrationDb()): OverseerTurn {
  const row = db.prepare("SELECT * FROM overseer_turns WHERE id = ? LIMIT 1").get(turnId) as TurnRow | undefined;
  if (!row) throw new OrchestrationApiError(404, "overseer_turn_not_found", "Overseer turn not found");
  return turnFromRow(row);
}

export function setOverseerTurnProcess(input: {
  sessionId: string;
  turnId: string;
  pid: number | null;
  db?: Database.Database;
}): void {
  const db = input.db ?? getOrchestrationDb();
  const now = new Date().toISOString();
  db.prepare("UPDATE overseer_turns SET process_pid = ?, updated_at = ? WHERE id = ?")
    .run(input.pid, now, input.turnId);
  db.prepare("UPDATE overseer_sessions SET process_pid = ?, updated_at = ? WHERE id = ?")
    .run(input.pid, now, input.sessionId);
}

export function setOverseerTurnCodexSessionId(input: {
  sessionId: string;
  turnId: string;
  codexSessionId: string | null | undefined;
  db?: Database.Database;
}): void {
  const codexSessionId = input.codexSessionId?.trim();
  if (!codexSessionId) return;
  const db = input.db ?? getOrchestrationDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE overseer_turns
     SET codex_session_id = COALESCE(codex_session_id, ?),
         updated_at = ?
     WHERE id = ?`,
  ).run(codexSessionId, now, input.turnId);
  db.prepare(
    `UPDATE overseer_sessions
     SET codex_session_id = COALESCE(codex_session_id, ?),
         updated_at = ?
     WHERE id = ?`,
  ).run(codexSessionId, now, input.sessionId);
}

export function recordOverseerEvent(input: {
  sessionId: string;
  turnId?: string | null;
  companyId?: string;
  eventType: string;
  event: Record<string, unknown>;
  occurredAt?: string;
  db?: Database.Database;
}): OverseerEvent {
  const db = input.db ?? getOrchestrationDb();
  const session = getOverseerSession(input.sessionId, db);
  const id = randomUUID();
  const now = new Date().toISOString();
  const sequence = nextSequence(db, "overseer_session_events", session.id);
  db.prepare(
    `INSERT INTO overseer_session_events
       (id, session_id, turn_id, company_id, event_type, event_json, sequence, occurred_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    session.id,
    input.turnId ?? null,
    input.companyId ?? session.companyId,
    input.eventType,
    JSON.stringify(input.event),
    sequence,
    input.occurredAt ?? now,
    now,
  );
  return eventFromRow(db.prepare("SELECT * FROM overseer_session_events WHERE id = ?").get(id) as EventRow);
}

function stringValuesFromRecord(record: Record<string, unknown>, keys: string[]): string[] {
  const values: string[] = [];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) values.push(value.trim());
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) values.push(item.trim());
      }
    }
  }
  return Array.from(new Set(values));
}

function scopedWatchIdentifiers(session: OverseerSession): {
  taskRefs: string[];
  sprintIds: string[];
  goalIds: string[];
} {
  const watch = recordValue(session.scope.watch);
  const nested = recordValue(watch.scope);
  const combined = { ...session.scope, ...nested };
  return {
    taskRefs: stringValuesFromRecord(combined, ["taskId", "taskIds", "taskKey", "taskKeys"]),
    sprintIds: stringValuesFromRecord(combined, ["sprintId", "sprintIds"]),
    goalIds: stringValuesFromRecord(combined, ["goalId", "goalIds", "companyGoalId", "companyGoalIds"]),
  };
}

function placeholders(values: unknown[]): string {
  return values.map(() => "?").join(", ");
}

function buildWatchTaskFilter(session: OverseerSession): { where: string; args: unknown[]; scopeLabel: string } {
  const identifiers = scopedWatchIdentifiers(session);
  const where = ["COALESCE(t.company_id, p.company_id) = ?", "t.archived_at IS NULL"];
  const args: unknown[] = [session.companyId];
  let scopeLabel = "company";
  if (session.projectId) {
    where.push("t.project_id = ?");
    args.push(session.projectId);
    scopeLabel = "project";
  }
  if (identifiers.taskRefs.length > 0) {
    where.push(`(t.id IN (${placeholders(identifiers.taskRefs)}) OR t.task_key IN (${placeholders(identifiers.taskRefs)}))`);
    args.push(...identifiers.taskRefs, ...identifiers.taskRefs);
    scopeLabel = "task";
  } else if (identifiers.sprintIds.length > 0) {
    where.push(`t.sprint_id IN (${placeholders(identifiers.sprintIds)})`);
    args.push(...identifiers.sprintIds);
    scopeLabel = "sprint";
  } else if (identifiers.goalIds.length > 0) {
    where.push(`(t.sprint_id IN (${placeholders(identifiers.goalIds)}) OR s.parent_id IN (${placeholders(identifiers.goalIds)}))`);
    args.push(...identifiers.goalIds, ...identifiers.goalIds);
    scopeLabel = "goal";
  }
  return { where: where.join(" AND "), args, scopeLabel };
}

type WatchSample = {
  scopeLabel: string;
  taskCounts: Record<string, number>;
  runCounts: Record<string, number>;
  recentTasks: Array<{
    key: string;
    title: string;
    status: string;
    assignee: string | null;
    updatedAt: string | null;
    blockedReason: string | null;
  }>;
  recentRuns: Array<{
    id: string;
    taskKey: string | null;
    taskTitle: string | null;
    status: string;
    provider: string;
    runnerProvider: string | null;
    runnerModel: string | null;
    updatedAt: string | null;
    errorMessage: string | null;
  }>;
};

function sampleOverseerWatchState(db: Database.Database, session: OverseerSession): WatchSample {
  const filter = buildWatchTaskFilter(session);
  const taskCountRows = db.prepare(
    `SELECT t.status, COUNT(*) AS count
     FROM tasks t
     INNER JOIN projects p ON p.id = t.project_id
     LEFT JOIN sprints s ON s.id = t.sprint_id
     WHERE ${filter.where}
     GROUP BY t.status`,
  ).all(...filter.args) as Array<{ status: string; count: number }>;
  const taskCounts = Object.fromEntries(taskCountRows.map((row) => [row.status, Number(row.count ?? 0)]));

  const recentTasks = db.prepare(
    `SELECT COALESCE(t.task_key, t.id) AS task_key,
            t.title,
            t.status,
            a.name AS assignee_name,
            t.updated_at,
            t.blocked_reason
     FROM tasks t
     INNER JOIN projects p ON p.id = t.project_id
     LEFT JOIN sprints s ON s.id = t.sprint_id
     LEFT JOIN agents a ON a.id = t.assignee_agent_id
     WHERE ${filter.where}
     ORDER BY datetime(t.updated_at) DESC, t.id DESC
     LIMIT 6`,
  ).all(...filter.args) as Array<{
    task_key: string;
    title: string;
    status: string;
    assignee_name: string | null;
    updated_at: string | null;
    blocked_reason: string | null;
  }>;

  const runCountRows = db.prepare(
    `SELECT er.status, COUNT(*) AS count
     FROM execution_runs er
     INNER JOIN tasks t ON t.id = er.task_id
     INNER JOIN projects p ON p.id = t.project_id
     LEFT JOIN sprints s ON s.id = t.sprint_id
     WHERE ${filter.where}
     GROUP BY er.status`,
  ).all(...filter.args) as Array<{ status: string; count: number }>;
  const runCounts = Object.fromEntries(runCountRows.map((row) => [row.status, Number(row.count ?? 0)]));

  const recentRuns = db.prepare(
    `SELECT er.id,
            er.status,
            er.provider,
            er.runner_provider,
            er.runner_model,
            er.updated_at,
            er.error_message,
            t.task_key,
            t.title AS task_title
     FROM execution_runs er
     INNER JOIN tasks t ON t.id = er.task_id
     INNER JOIN projects p ON p.id = t.project_id
     LEFT JOIN sprints s ON s.id = t.sprint_id
     WHERE ${filter.where}
     ORDER BY datetime(er.updated_at) DESC, er.id DESC
     LIMIT 5`,
  ).all(...filter.args) as Array<{
    id: string;
    status: string;
    provider: string;
    runner_provider: string | null;
    runner_model: string | null;
    updated_at: string | null;
    error_message: string | null;
    task_key: string | null;
    task_title: string | null;
  }>;

  return {
    scopeLabel: filter.scopeLabel,
    taskCounts,
    runCounts,
    recentTasks: recentTasks.map((task) => ({
      key: task.task_key,
      title: task.title,
      status: task.status,
      assignee: task.assignee_name,
      updatedAt: task.updated_at,
      blockedReason: task.blocked_reason,
    })),
    recentRuns: recentRuns.map((run) => ({
      id: run.id,
      taskKey: run.task_key,
      taskTitle: run.task_title,
      status: run.status,
      provider: run.provider,
      runnerProvider: run.runner_provider,
      runnerModel: run.runner_model,
      updatedAt: run.updated_at,
      errorMessage: run.error_message,
    })),
  };
}

function watchDigest(sample: WatchSample): string {
  return createHash("sha256").update(JSON.stringify(sample)).digest("hex").slice(0, 32);
}

function watchSummary(sample: WatchSample, started: boolean): string {
  const active = sample.taskCounts.in_progress ?? 0;
  const review = sample.taskCounts.review ?? 0;
  const waiting = (sample.taskCounts.backlog ?? 0) + (sample.taskCounts.on_deck ?? 0) + (sample.taskCounts["to-do"] ?? 0);
  const blocked = sample.taskCounts.blocked ?? 0;
  const done = sample.taskCounts.done ?? 0;
  const runningRuns = sample.runCounts.running ?? 0;
  const pendingRuns = sample.runCounts.pending ?? 0;
  const failedRuns = sample.runCounts.failed ?? 0;
  const recentTasks = sample.recentTasks.slice(0, 3).map((task) => {
    const assignee = task.assignee ? `, ${task.assignee}` : "";
    return `${task.key} ${compactText(task.title, 54)} -> ${task.status}${assignee}`;
  });
  const recentRuns = sample.recentRuns.slice(0, 2).map((run) => {
    const task = run.taskKey ?? run.taskTitle ?? run.id.slice(0, 8);
    const runner = run.runnerProvider ?? run.provider;
    return `${task} ${runner} -> ${run.status}`;
  });
  return [
    started ? `Watching started for this ${sample.scopeLabel} scope.` : `Watch update for this ${sample.scopeLabel} scope.`,
    `Board: active ${active}, review ${review}, waiting ${waiting}, blocked ${blocked}, done ${done}.`,
    `Runs: running ${runningRuns}, pending ${pendingRuns}, failed ${failedRuns}.`,
    recentTasks.length > 0 ? `Recent tasks: ${recentTasks.join("; ")}.` : "Recent tasks: none.",
    recentRuns.length > 0 ? `Recent runs: ${recentRuns.join("; ")}.` : "Recent runs: none.",
  ].join(" ");
}

function writeOverseerWatchState(
  db: Database.Database,
  sessionId: string,
  watch: OverseerWatchState,
  now: string,
): OverseerSession {
  const session = getOverseerSession(sessionId, db);
  const scope = { ...session.scope, watch };
  db.prepare(
    `UPDATE overseer_sessions
     SET scope_json = ?,
         last_turn_at = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(JSON.stringify(scope), now, now, session.id);
  return getOverseerSession(session.id, db);
}

function clearOverseerWatchTimer(sessionId: string): void {
  const timer = watchTimerRegistry.get(sessionId);
  if (!timer) return;
  clearTimeout(timer);
  watchTimerRegistry.delete(sessionId);
}

function markOverseerWatchFailed(sessionId: string, error: unknown): void {
  const db = getOrchestrationDb();
  const session = getOverseerSession(sessionId, db);
  const current = normalizeOverseerWatchState(session.scope.watch);
  if (!current || current.status !== "watching") return;
  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  writeOverseerWatchState(db, session.id, {
    ...current,
    enabled: false,
    status: "failed",
    stoppedAt: now,
    error: message,
  }, now);
  recordOverseerEvent({
    sessionId: session.id,
    eventType: "overseer.watch.failed",
    event: { error: message },
    occurredAt: now,
    db,
  });
  appendOverseerMessage({
    sessionId: session.id,
    role: "assistant",
    content: `Watch failed: ${compactText(message, 220)}`,
    metadata: { kind: "overseer_watch_failed" },
    db,
  });
}

function scheduleOverseerWatchLoop(sessionId: string, intervalMs: number): void {
  clearOverseerWatchTimer(sessionId);
  const timer = setTimeout(() => {
    watchTimerRegistry.delete(sessionId);
    try {
      const result = runOverseerWatchCheck({ sessionId });
      const watch = normalizeOverseerWatchState(result.session.scope.watch);
      if (watch?.enabled && watch.status === "watching") {
        scheduleOverseerWatchLoop(sessionId, watch.intervalMs);
      }
    } catch (error) {
      markOverseerWatchFailed(sessionId, error);
    }
  }, intervalMs);
  const maybeNodeTimer = timer as ReturnType<typeof setTimeout> & { unref?: () => void };
  maybeNodeTimer.unref?.();
  watchTimerRegistry.set(sessionId, timer);
}

export function getOverseerWatchState(session: OverseerSession): OverseerWatchState | null {
  return normalizeOverseerWatchState(session.scope.watch);
}

export function runOverseerWatchCheck(input: {
  sessionId: string;
  forceMessage?: boolean;
  db?: Database.Database;
}): { session: OverseerSession; changed: boolean; summary: string; digest: string } {
  const db = input.db ?? getOrchestrationDb();
  const session = getOverseerSession(input.sessionId, db);
  const current = normalizeOverseerWatchState(session.scope.watch);
  if (!current?.enabled || current.status !== "watching") {
    throw new OrchestrationApiError(409, "overseer_watch_not_active", "Overseer watch is not active for this session");
  }
  const now = new Date().toISOString();
  const sample = sampleOverseerWatchState(db, session);
  const digest = watchDigest(sample);
  const changed = digest !== current.digest;
  const summary = watchSummary(sample, input.forceMessage === true);
  const shouldAppendMessage = input.forceMessage === true || changed;
  const nextWatch: OverseerWatchState = {
    ...current,
    lastCheckAt: now,
    checkCount: current.checkCount + 1,
    digest,
    lastSummary: summary,
    lastMessageAt: shouldAppendMessage ? now : current.lastMessageAt,
    error: null,
  };
  const updatedSession = writeOverseerWatchState(db, session.id, nextWatch, now);
  recordOverseerEvent({
    sessionId: session.id,
    eventType: "overseer.watch.check",
    event: {
      changed,
      digest,
      checkCount: nextWatch.checkCount,
      scopeLabel: sample.scopeLabel,
      taskCounts: sample.taskCounts,
      runCounts: sample.runCounts,
      messageAppended: shouldAppendMessage,
    },
    occurredAt: now,
    db,
  });
  if (shouldAppendMessage) {
    appendOverseerMessage({
      sessionId: session.id,
      role: "assistant",
      content: summary,
      metadata: {
        kind: "overseer_watch_update",
        digest,
        changed,
        checkCount: nextWatch.checkCount,
        scopeLabel: sample.scopeLabel,
      },
      db,
    });
  }
  return {
    session: getOverseerSession(updatedSession.id, db),
    changed,
    summary,
    digest,
  };
}

export function startOverseerWatch(input: {
  sessionId: string;
  intervalMs?: number | null;
  db?: Database.Database;
}): { session: OverseerSession; watch: OverseerWatchState } {
  const db = input.db ?? getOrchestrationDb();
  const session = getOverseerSession(input.sessionId, db);
  const previous = normalizeOverseerWatchState(session.scope.watch);
  const now = new Date().toISOString();
  const intervalMs = normalizeWatchIntervalMs(input.intervalMs ?? previous?.intervalMs);
  const watch: OverseerWatchState = {
    enabled: true,
    status: "watching",
    startedAt: previous?.status === "watching" ? previous.startedAt ?? now : now,
    lastCheckAt: previous?.lastCheckAt ?? null,
    stoppedAt: null,
    intervalMs,
    checkCount: previous?.status === "watching" ? previous.checkCount : 0,
    digest: previous?.status === "watching" ? previous.digest : null,
    lastSummary: previous?.status === "watching" ? previous.lastSummary : null,
    lastMessageAt: previous?.status === "watching" ? previous.lastMessageAt : null,
    error: null,
  };
  writeOverseerWatchState(db, session.id, watch, now);
  recordOverseerEvent({
    sessionId: session.id,
    eventType: "overseer.watch.started",
    event: { intervalMs, previousStatus: previous?.status ?? null },
    occurredAt: now,
    db,
  });
  const checked = runOverseerWatchCheck({ sessionId: session.id, forceMessage: true, db });
  scheduleOverseerWatchLoop(session.id, intervalMs);
  return {
    session: checked.session,
    watch: normalizeOverseerWatchState(checked.session.scope.watch)!,
  };
}

export function stopOverseerWatch(input: {
  sessionId: string;
  reason?: string | null;
  db?: Database.Database;
}): { session: OverseerSession; watch: OverseerWatchState } {
  const db = input.db ?? getOrchestrationDb();
  const session = getOverseerSession(input.sessionId, db);
  const previous = normalizeOverseerWatchState(session.scope.watch);
  const now = new Date().toISOString();
  clearOverseerWatchTimer(session.id);
  const watch: OverseerWatchState = {
    enabled: false,
    status: "stopped",
    startedAt: previous?.startedAt ?? null,
    lastCheckAt: previous?.lastCheckAt ?? null,
    stoppedAt: now,
    intervalMs: normalizeWatchIntervalMs(previous?.intervalMs),
    checkCount: previous?.checkCount ?? 0,
    digest: previous?.digest ?? null,
    lastSummary: previous?.lastSummary ?? null,
    lastMessageAt: now,
    error: null,
  };
  const updatedSession = writeOverseerWatchState(db, session.id, watch, now);
  recordOverseerEvent({
    sessionId: session.id,
    eventType: "overseer.watch.stopped",
    event: {
      reason: input.reason ?? "operator",
      previousStatus: previous?.status ?? null,
      checkCount: watch.checkCount,
    },
    occurredAt: now,
    db,
  });
  appendOverseerMessage({
    sessionId: session.id,
    role: "assistant",
    content: "Watching stopped.",
    metadata: { kind: "overseer_watch_stopped", reason: input.reason ?? "operator" },
    db,
  });
  return {
    session: getOverseerSession(updatedSession.id, db),
    watch,
  };
}

function isWriteAction(action: McAction): boolean {
  return !["report", "use_skill"].includes(action.action);
}

function fingerprintForAction(input: {
  sessionId: string;
  turnId: string;
  messageId: string;
  action: McAction;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 32);
}

function summaryHash(summary: string): string {
  return createHash("sha256").update(summary).digest("hex").slice(0, 32);
}

export function createApprovalsForOverseerActions(input: {
  session: OverseerSession;
  turnId: string;
  messageId: string;
  assistantText: string;
  db?: Database.Database;
}): { approvalIds: string[]; safeActions: number; parseErrors: string[] } {
  const db = input.db ?? getOrchestrationDb();
  const parsed = parseActionsFromText(input.assistantText);
  const approvalIds: string[] = [];
  let safeActions = 0;
  for (const action of parsed.actions) {
    if (!isWriteAction(action)) {
      safeActions += 1;
      recordOverseerEvent({
        sessionId: input.session.id,
        turnId: input.turnId,
        eventType: "mc_action.observed",
        event: { actionType: action.action, action, safe: true },
        db,
      });
      continue;
    }
    const approval = createApproval({
      companyIdOrSlug: input.session.companyId,
      type: "protected_runtime_command",
      payload: {
        source: "overseer",
        summary: `Overseer requested ${action.action}`,
        command: JSON.stringify(action),
        reason: "Overseer state-changing actions require approval before execution.",
        actionType: action.action,
        action,
        sessionId: input.session.id,
        turnId: input.turnId,
        messageId: input.messageId,
        workspaceRoot: input.session.workspaceRoot,
        fingerprint: fingerprintForAction({
          sessionId: input.session.id,
          turnId: input.turnId,
          messageId: input.messageId,
          action,
        }),
        risks: [{ code: "overseer_state_change" }],
      },
      db,
    }).approval;
    approvalIds.push(approval.id);
    recordOverseerEvent({
      sessionId: input.session.id,
      turnId: input.turnId,
      eventType: "approval.requested",
      event: { approvalId: approval.id, actionType: action.action },
      db,
    });
  }
  return { approvalIds, safeActions, parseErrors: parsed.parseErrors };
}

export function getOverseerCompactionState(
  sessionId: string,
  db = getOrchestrationDb(),
): { session: OverseerSession; compaction: OverseerCompactionState } {
  const session = getOverseerSession(sessionId, db);
  return { session, compaction: session.compaction };
}

export function updateOverseerCompactionSettings(input: {
  sessionId: string;
  policy?: OverseerCompactionPolicy;
  contextThreshold?: number;
  actorUserId?: string;
  db?: Database.Database;
}): { session: OverseerSession; compaction: OverseerCompactionState } {
  const db = input.db ?? getOrchestrationDb();
  const session = getOverseerSession(input.sessionId, db);
  const nextPolicy = input.policy === undefined
    ? session.compaction.policy
    : normalizeOverseerCompactionPolicy(input.policy);
  const nextThreshold = input.contextThreshold === undefined
    ? session.compaction.contextThreshold
    : normalizeOverseerContextThreshold(input.contextThreshold);
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE overseer_sessions
     SET compaction_policy = ?,
         compaction_context_threshold = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(nextPolicy, nextThreshold, now, session.id);

  recordOverseerEvent({
    sessionId: session.id,
    eventType: "compaction.settings_updated",
    event: {
      previous: {
        policy: session.compaction.policy,
        contextThreshold: session.compaction.contextThreshold,
      },
      next: {
        policy: nextPolicy,
        contextThreshold: nextThreshold,
      },
      actorUserId: input.actorUserId ?? "operator",
    },
    db,
  });

  return getOverseerCompactionState(session.id, db);
}

export function requestOverseerSessionCompaction(input: {
  sessionId: string;
  summary: string;
  source?: "manual" | "runtime" | "auto";
  reason?: string | null;
  metadata?: Record<string, unknown>;
  requestedBy?: string;
  db?: Database.Database;
}): { status: "approval_required"; session: OverseerSession; approvalId: string; compaction: OverseerCompactionState } {
  const db = input.db ?? getOrchestrationDb();
  const session = getOverseerSession(input.sessionId, db);
  const proposedSummary = input.summary.trim();
  if (!proposedSummary) {
    throw new OrchestrationApiError(400, "compaction_summary_required", "Compaction summary is required");
  }

  const hash = summaryHash(proposedSummary);
  const existingApproval = db.prepare(
    `SELECT id
     FROM approvals
     WHERE company_id = ?
       AND type = 'protected_runtime_command'
       AND status IN ('pending', 'revision_requested')
       AND json_extract(payload_json, '$.actionType') = 'compact_overseer_session'
       AND json_extract(payload_json, '$.sessionId') = ?
       AND json_extract(payload_json, '$.summaryHash') = ?
     ORDER BY created_at DESC
     LIMIT 1`,
  ).get(session.companyId, session.id, hash) as { id: string } | undefined;

  const approvalId = existingApproval?.id ?? createApproval({
    companyIdOrSlug: session.companyId,
    type: "protected_runtime_command",
    payload: {
      source: "overseer",
      actionType: "compact_overseer_session",
      summary: `Compact Overseer session memory for ${session.title}`,
      command: JSON.stringify({
        action: "compact_overseer_session",
        sessionId: session.id,
        summaryHash: hash,
      }),
      reason: input.reason ?? "Durable Overseer session memory compaction requires approval.",
      sessionId: session.id,
      projectId: session.projectId,
      proposedSummary,
      summaryHash: hash,
      requestedBy: input.requestedBy ?? "operator",
      compactionSource: input.source ?? "manual",
      previousCompactedAt: session.compaction.compactedAt,
      metadata: input.metadata ?? {},
      fingerprint: createHash("sha256")
        .update(JSON.stringify({ action: "compact_overseer_session", sessionId: session.id, summaryHash: hash }))
        .digest("hex")
        .slice(0, 32),
      risks: [{ code: "overseer_memory_mutation" }],
    },
    db,
  }).approval.id;

  recordOverseerEvent({
    sessionId: session.id,
    eventType: "compaction.approval_requested",
    event: {
      approvalId,
      summaryHash: hash,
      source: input.source ?? "manual",
      requestedBy: input.requestedBy ?? "operator",
      reused: Boolean(existingApproval),
    },
    db,
  });

  return {
    status: "approval_required",
    session: getOverseerSession(session.id, db),
    approvalId,
    compaction: getOverseerCompactionState(session.id, db).compaction,
  };
}

export function applyApprovedOverseerCompaction(input: {
  approvalId: string;
  actorUserId?: string;
  db?: Database.Database;
}): { applied: boolean; session: OverseerSession; compaction: OverseerCompactionState; reason?: string } {
  const db = input.db ?? getOrchestrationDb();
  const row = db.prepare(
    `SELECT id, company_id, status, payload_json
     FROM approvals
     WHERE id = ?
     LIMIT 1`,
  ).get(input.approvalId) as { id: string; company_id: string; status: string; payload_json: string } | undefined;
  if (!row) throw new OrchestrationApiError(404, "approval_not_found", "Approval not found");
  if (row.status !== "approved") {
    throw new OrchestrationApiError(400, "approval_not_approved", "Compaction approval must be approved before applying");
  }

  const payload = parseRecord(row.payload_json);
  if (payload.actionType !== "compact_overseer_session") {
    throw new OrchestrationApiError(400, "approval_not_overseer_compaction", "Approval is not an Overseer compaction request");
  }
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
  const proposedSummary = typeof payload.proposedSummary === "string" ? payload.proposedSummary.trim() : "";
  if (!sessionId || !proposedSummary) {
    throw new OrchestrationApiError(400, "invalid_compaction_approval", "Compaction approval payload is incomplete");
  }
  const hash = summaryHash(proposedSummary);
  if (typeof payload.summaryHash === "string" && payload.summaryHash !== hash) {
    throw new OrchestrationApiError(400, "compaction_summary_mismatch", "Compaction summary hash does not match approval payload");
  }

  const session = getOverseerSession(sessionId, db);
  if (session.companyId !== row.company_id) {
    throw new OrchestrationApiError(400, "compaction_company_mismatch", "Compaction approval company does not match the session");
  }

  const now = new Date().toISOString();
  const metadataBase = {
    ...session.compaction.metadata,
    approvalId: row.id,
    appliedAt: now,
    appliedBy: input.actorUserId ?? "operator",
    summaryHash: hash,
    source: typeof payload.compactionSource === "string" ? payload.compactionSource : "manual",
    reason: typeof payload.reason === "string" ? payload.reason : null,
    requestMetadata: typeof payload.metadata === "object" && payload.metadata !== null && !Array.isArray(payload.metadata)
      ? payload.metadata
      : {},
  };
  const snapshot = createOverseerContextSnapshot({
    sessionId: session.id,
    summary: proposedSummary,
    usageSnapshot: session.usage,
    attachmentManifest: collectOverseerAttachmentManifest(db, session.id),
    compactionMetadata: {
      ...metadataBase,
      createdBeforeMutation: true,
    },
    createdBy: input.actorUserId ?? "operator",
    db,
  }).snapshot;
  const metadata = {
    ...metadataBase,
    snapshotId: snapshot.id,
    snapshotVersion: snapshot.version,
    snapshotSummaryHash: snapshot.summaryHash,
  };

  db.prepare(
    `UPDATE overseer_sessions
     SET compacted_summary = ?,
         compacted_at = ?,
         compacted_by = ?,
         compaction_metadata_json = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(proposedSummary, now, input.actorUserId ?? "operator", JSON.stringify(metadata), now, session.id);

  recordOverseerEvent({
    sessionId: session.id,
    eventType: "compaction.applied",
    event: {
      approvalId: row.id,
      summaryHash: hash,
      snapshotId: snapshot.id,
      snapshotVersion: snapshot.version,
      snapshotSummaryHash: snapshot.summaryHash,
      actorUserId: input.actorUserId ?? "operator",
      previousCompactedAt: session.compaction.compactedAt,
    },
    db,
  });

  return {
    applied: true,
    ...getOverseerCompactionState(session.id, db),
  };
}

export function recordOverseerCompactionApprovalDecision(input: {
  approvalId: string;
  status: "rejected" | "cancelled";
  actorUserId?: string;
  decisionNote?: string | null;
  db?: Database.Database;
}): { recorded: boolean; reason?: string } {
  const db = input.db ?? getOrchestrationDb();
  const row = db.prepare("SELECT payload_json FROM approvals WHERE id = ? LIMIT 1").get(input.approvalId) as
    | { payload_json: string }
    | undefined;
  if (!row) return { recorded: false, reason: "approval_not_found" };
  const payload = parseRecord(row.payload_json);
  if (payload.actionType !== "compact_overseer_session" || typeof payload.sessionId !== "string") {
    return { recorded: false, reason: "not_overseer_compaction" };
  }
  recordOverseerEvent({
    sessionId: payload.sessionId,
    eventType: `compaction.approval_${input.status}`,
    event: {
      approvalId: input.approvalId,
      actorUserId: input.actorUserId ?? "operator",
      decisionNote: input.decisionNote ?? null,
    },
    db,
  });
  return { recorded: true };
}

export function completeOverseerTurn(input: {
  sessionId: string;
  turnId: string;
  status: OverseerTurnStatus;
  assistantMessageId?: string | null;
  codexSessionId?: string | null;
  usage?: OverseerUsageSnapshot;
  quota?: OverseerQuotaSnapshot;
  errorMessage?: string | null;
  durationMs?: number | null;
  db?: Database.Database;
}): { session: OverseerSession; turn: OverseerTurn } {
  const db = input.db ?? getOrchestrationDb();
  const session = getOverseerSession(input.sessionId, db);
  const now = new Date().toISOString();
  const nextUsage = input.usage ?? {};
  const sessionUsage = mergeUsageTotals(session.usage, nextUsage);
  const sessionQuota = input.quota ?? session.quota;
  db.prepare(
    `UPDATE overseer_turns
     SET status = ?,
         assistant_message_id = COALESCE(?, assistant_message_id),
         codex_session_id = COALESCE(?, codex_session_id),
         usage_json = ?,
         error_message = ?,
         process_pid = NULL,
         completed_at = ?,
         duration_ms = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    input.status,
    input.assistantMessageId ?? null,
    input.codexSessionId ?? null,
    JSON.stringify(nextUsage),
    input.errorMessage ?? null,
    now,
    input.durationMs ?? null,
    now,
    input.turnId,
  );
  db.prepare(
    `UPDATE overseer_sessions
     SET status = ?,
         codex_session_id = COALESCE(?, codex_session_id),
         usage_json = ?,
         quota_json = ?,
         last_error = ?,
         process_pid = NULL,
         last_turn_at = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    input.status === "approval_required" ? "approval_required" : input.status,
    input.codexSessionId ?? null,
    JSON.stringify(sessionUsage),
    JSON.stringify(sessionQuota),
    input.errorMessage ?? null,
    now,
    now,
    input.sessionId,
  );
  return { session: getOverseerSession(input.sessionId, db), turn: getOverseerTurn(input.turnId, db) };
}

export function archiveOverseerSession(input: {
  sessionId: string;
  db?: Database.Database;
}): { session: OverseerSession } {
  const db = input.db ?? getOrchestrationDb();
  const now = new Date().toISOString();
  db.prepare("UPDATE overseer_sessions SET archived_at = ?, updated_at = ? WHERE id = ?")
    .run(now, now, input.sessionId);
  const row = db.prepare("SELECT * FROM overseer_sessions WHERE id = ? LIMIT 1").get(input.sessionId) as SessionRow;
  return { session: sessionFromRow(row) };
}

export function updateOverseerSession(input: {
  sessionId: string;
  title?: string;
  model?: string | null;
  reasoningEffort?: string | null;
  fastMode?: boolean | null;
  provider?: OverseerRuntimeProvider | null;
  compaction?: Record<string, unknown> | null;
  archived?: boolean;
  db?: Database.Database;
}): { session: OverseerSession } {
  const db = input.db ?? getOrchestrationDb();
  getOverseerSession(input.sessionId, db);
  if (input.archived) return archiveOverseerSession({ sessionId: input.sessionId, db });
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new OrchestrationApiError(400, "invalid_session_title", "Session title is required");
    db.prepare("UPDATE overseer_sessions SET title = ?, updated_at = ? WHERE id = ?")
      .run(title, new Date().toISOString(), input.sessionId);
  }
  if (input.model !== undefined || input.reasoningEffort !== undefined) {
    const current = getOverseerSession(input.sessionId, db);
    const model = input.model === undefined ? current.model : input.model?.trim() || null;
    const reasoningEffort = input.reasoningEffort === undefined
      ? current.reasoningEffort
      : input.reasoningEffort?.trim() || null;
    db.prepare("UPDATE overseer_sessions SET model = ?, reasoning_effort = ?, updated_at = ? WHERE id = ?")
      .run(model, reasoningEffort, new Date().toISOString(), input.sessionId);
  }
  if (input.fastMode !== undefined) {
    const current = getOverseerSession(input.sessionId, db);
    const scope = { ...current.scope };
    if (input.fastMode === null) {
      delete scope.fastMode;
    } else {
      scope.fastMode = input.fastMode;
    }
    db.prepare("UPDATE overseer_sessions SET scope_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(scope), new Date().toISOString(), input.sessionId);
  }
  if (input.provider !== undefined) {
    const current = getOverseerSession(input.sessionId, db);
    const messageCount = db
      .prepare("SELECT COUNT(*) AS count FROM overseer_session_messages WHERE session_id = ?")
      .get(input.sessionId) as { count: number } | undefined;
    if ((messageCount?.count ?? 0) > 0 || current.codexSessionId) {
      throw new OrchestrationApiError(
        409,
        "overseer_provider_locked",
        "Overseer provider is locked after a session starts.",
      );
    }
    const scope = { ...current.scope };
    if (input.provider === null) {
      delete scope.overseerProvider;
    } else {
      scope.overseerProvider = normalizeOverseerRuntimeProvider(input.provider);
    }
    db.prepare("UPDATE overseer_sessions SET scope_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(scope), new Date().toISOString(), input.sessionId);
  }
  if (input.compaction !== undefined) {
    const current = getOverseerSession(input.sessionId, db);
    const scope = { ...current.scope };
    let policy = current.compaction.policy;
    let threshold = current.compaction.contextThreshold;
    if (input.compaction === null) {
      delete scope.compaction;
    } else {
      const existing = recordValue(scope.compaction);
      scope.compaction = { ...existing, ...input.compaction };
      policy = normalizeOverseerCompactionPolicy(input.compaction.mode ?? existing.mode ?? current.compaction.policy);
      threshold = normalizeOverseerContextThreshold(
        input.compaction.thresholdPercent ?? existing.thresholdPercent ?? current.compaction.contextThreshold,
      );
    }
    db.prepare(
      `UPDATE overseer_sessions
       SET scope_json = ?,
           compaction_policy = ?,
           compaction_context_threshold = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(JSON.stringify(scope), policy, threshold, new Date().toISOString(), input.sessionId);
  }
  return { session: getOverseerSession(input.sessionId, db) };
}
