import { createHash } from "crypto";

import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  assertOverseerSessionCompany,
  listOverseerEvents,
  listOverseerMessages,
} from "@/lib/orchestration/overseer/service";

import type {
  OverseerQuotaSnapshot,
  OverseerSession,
  OverseerTurn,
  OverseerTurnStatus,
  OverseerUsageSnapshot,
} from "./types";

const EXPORT_FORMAT = "hiverunner-overseer-raw-transcript";
const EXPORT_VERSION = 1;
const SNAPSHOT_TABLE_CANDIDATES = [
  "overseer_context_snapshots",
  "overseer_session_snapshots",
  "overseer_context_snapshot_versions",
] as const;

type SqlRow = Record<string, unknown>;

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

type ApprovalRow = {
  id: string;
  company_id: string;
  type: string;
  status: string;
  requested_by_agent_id: string | null;
  approver_agent_id: string | null;
  approval_route_reason: string | null;
  payload_json: string;
  decision_note: string | null;
  decided_by_user_id: string | null;
  decided_at: string | null;
  linked_task_id: string | null;
  created_at: string;
  updated_at: string;
};

type ApprovalCommentRow = {
  id: string;
  approval_id: string;
  author_agent_id: string | null;
  author_user_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
};

type CostEventRow = {
  id: string;
  provider: string;
  biller: string;
  billing_type: string;
  model: string;
  input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  cost_cents: number;
  cost_source: string;
  confidence: string;
  metadata_json: string;
  occurred_at: string;
  created_at: string;
};

export type RawOverseerTranscriptPackage = {
  _meta: {
    format: typeof EXPORT_FORMAT;
    version: typeof EXPORT_VERSION;
    exportedAt: string;
    filename: string;
    sourceCompany: {
      id: string;
      slug?: string;
      companyCode?: string | null;
    };
    sessionId: string;
    categories: string[];
  };
  session: OverseerSession;
  turns: OverseerTurn[];
  messages: ReturnType<typeof listOverseerMessages>["messages"];
  events: ReturnType<typeof listOverseerEvents>["events"];
  compaction: {
    state: OverseerSession["compaction"];
    latestSummary: string | null;
    metadata: Record<string, unknown>;
  };
  snapshots: Array<Record<string, unknown>>;
  approvals: Array<Record<string, unknown>>;
  attachmentManifest: Array<Record<string, unknown>>;
  usage: {
    session: OverseerUsageSnapshot;
    quota: OverseerQuotaSnapshot;
    turns: {
      total: OverseerUsageSnapshot;
      byTurn: Array<{ turnId: string; usage: OverseerUsageSnapshot }>;
    };
    costEvents: {
      totalCostCents: number;
      events: Array<Record<string, unknown>>;
    };
  };
  continuityProof: OverseerContinuityProof;
  _counts: Record<string, number>;
  contentHashes: Record<string, string>;
};

export type RawOverseerTranscriptExport = {
  filename: string;
  package: RawOverseerTranscriptPackage;
};

export type OverseerContinuityProof = {
  status: "verified" | "stale" | "incomplete";
  sourceRowCounts: {
    turns: number;
    messages: number;
    events: number;
    snapshots: number;
    approvals: number;
    attachmentManifest: number;
    costEvents: number;
  };
  hashes: {
    sessionSha256: string;
    turnsSha256: string;
    messagesSha256: string;
    eventsSha256: string;
    compactionSha256: string;
    snapshotsSha256: string;
    approvalsSha256: string;
    attachmentManifestSha256: string;
    usageSha256: string;
  };
  snapshotVersions: Array<{
    id: string;
    version: number | null;
    summaryHash: string | null;
    createdAt: string | null;
  }>;
  latestSnapshotVersion: number | null;
  latestCompactionApprovalId: string | null;
  latestCompaction: {
    compactedAt: string | null;
    compactedBy: string | null;
    snapshotId: string | null;
    snapshotVersion: number | null;
    snapshotSummaryHash: string | null;
  };
  prePostCompactionLink: {
    previousCompactedAt: string | null;
    compactedAt: string | null;
    sourceSnapshotId: string | null;
  };
};

function parseJson(value: string | null | undefined, fallback: unknown): unknown {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseRecord(value: string | null | undefined): Record<string, unknown> {
  const parsed = parseJson(value, {});
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const next = (value as Record<string, unknown>)[key];
      if (next !== undefined) output[key] = stableNormalize(next);
    }
    return output;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableNormalize(value));
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function filenameSegment(value: string | null | undefined, fallback: string): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || fallback;
}

export function buildOverseerTranscriptFilename(session: OverseerSession): string {
  const company = filenameSegment(session.companySlug ?? session.companyCode ?? session.companyId, "company");
  const title = filenameSegment(session.title, "session");
  const createdDate = /^\d{4}-\d{2}-\d{2}/.exec(session.createdAt)?.[0] ?? "undated";
  return `overseer-transcript-${company}-${title}-${createdDate}-${session.id.slice(0, 8)}.json`;
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
    usage: parseRecord(row.usage_json) as OverseerUsageSnapshot,
    errorMessage: row.error_message,
    processPid: row.process_pid,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listTurns(db: Database.Database, session: OverseerSession): OverseerTurn[] {
  const rows = db
    .prepare(
      `SELECT *
       FROM overseer_turns
       WHERE session_id = ?
         AND company_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(session.id, session.companyId) as TurnRow[];
  return rows.map(turnFromRow);
}

function camelCaseColumn(name: string): string {
  return name.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

function rowForExport(row: SqlRow): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.endsWith("_json")) {
      output[camelCaseColumn(key.slice(0, -5))] = parseJson(typeof value === "string" ? value : null, {});
    } else {
      output[camelCaseColumn(key)] = value;
    }
  }
  return output;
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName) as { name: string } | undefined;
  return Boolean(row);
}

function tableColumns(db: Database.Database, tableName: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function snapshotOrderBy(columns: Set<string>): string {
  const terms = [
    columns.has("version") ? "version ASC" : null,
    columns.has("created_at") ? "created_at ASC" : null,
    columns.has("id") ? "id ASC" : null,
  ].filter((term): term is string => Boolean(term));
  return terms.length > 0 ? ` ORDER BY ${terms.join(", ")}` : "";
}

function listSnapshots(db: Database.Database, session: OverseerSession): Array<Record<string, unknown>> {
  const snapshots: Array<Record<string, unknown>> = [];
  for (const tableName of SNAPSHOT_TABLE_CANDIDATES) {
    if (!tableExists(db, tableName)) continue;
    const columns = tableColumns(db, tableName);
    if (!columns.has("session_id")) continue;
    const where = columns.has("company_id")
      ? "session_id = ? AND company_id = ?"
      : "session_id = ?";
    const args = columns.has("company_id")
      ? [session.id, session.companyId]
      : [session.id];
    const rows = db
      .prepare(`SELECT * FROM ${tableName} WHERE ${where}${snapshotOrderBy(columns)}`)
      .all(...args) as SqlRow[];
    for (const row of rows) {
      snapshots.push({ sourceTable: tableName, ...rowForExport(row) });
    }
  }
  return snapshots;
}

function listApprovalComments(
  db: Database.Database,
  approvalIds: string[],
): Map<string, Array<Record<string, unknown>>> {
  if (approvalIds.length === 0) return new Map();
  const placeholders = approvalIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, approval_id, author_agent_id, author_user_id, body, created_at, updated_at
       FROM approval_comments
       WHERE approval_id IN (${placeholders})
       ORDER BY created_at ASC, id ASC`,
    )
    .all(...approvalIds) as ApprovalCommentRow[];
  const byApproval = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const comments = byApproval.get(row.approval_id) ?? [];
    comments.push({
      id: row.id,
      approvalId: row.approval_id,
      authorAgentId: row.author_agent_id,
      authorUserId: row.author_user_id,
      body: row.body,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    byApproval.set(row.approval_id, comments);
  }
  return byApproval;
}

function listSessionApprovals(db: Database.Database, session: OverseerSession): Array<Record<string, unknown>> {
  const rows = db
    .prepare(
      `SELECT id, company_id, type, status, requested_by_agent_id, approver_agent_id,
              approval_route_reason, payload_json, decision_note, decided_by_user_id,
              decided_at, linked_task_id, created_at, updated_at
       FROM approvals
       WHERE company_id = ?
         AND (
           json_extract(payload_json, '$.sessionId') = ?
           OR json_extract(payload_json, '$.overseerSessionId') = ?
           OR json_extract(payload_json, '$.payload.sessionId') = ?
         )
       ORDER BY created_at ASC, id ASC`,
    )
    .all(session.companyId, session.id, session.id, session.id) as ApprovalRow[];
  const comments = listApprovalComments(db, rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    companyId: row.company_id,
    type: row.type,
    status: row.status,
    requestedByAgentId: row.requested_by_agent_id,
    approverAgentId: row.approver_agent_id,
    approvalRouteReason: row.approval_route_reason,
    payload: parseRecord(row.payload_json),
    decisionNote: row.decision_note,
    decidedByUserId: row.decided_by_user_id,
    decidedAt: row.decided_at,
    linkedTaskId: row.linked_task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    comments: comments.get(row.id) ?? [],
  }));
}

function normalizeAttachmentRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function listAttachmentManifest(
  messages: ReturnType<typeof listOverseerMessages>["messages"],
): Array<Record<string, unknown>> {
  const attachments: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    const rawAttachments = Array.isArray(message.metadata.attachments)
      ? message.metadata.attachments
      : [];
    rawAttachments.forEach((raw, index) => {
      const attachment = normalizeAttachmentRecord(raw);
      if (!attachment) return;
      const manifestRecord = {
        ...attachment,
        messageId: message.id,
        turnId: message.turnId,
        messageSequence: message.sequence,
        messageRole: message.role,
        index,
        metadataSha256: sha256(attachment),
      };
      attachments.push(manifestRecord);
    });
  }
  return attachments;
}

function addUsage(base: OverseerUsageSnapshot, next: OverseerUsageSnapshot): OverseerUsageSnapshot {
  const sum = (key: keyof OverseerUsageSnapshot) => {
    const left = typeof base[key] === "number" ? base[key] : 0;
    const right = typeof next[key] === "number" ? next[key] : 0;
    const value = left + right;
    return value === 0 ? undefined : value;
  };
  return {
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    cacheReadInputTokens: sum("cacheReadInputTokens"),
    cacheCreationInputTokens: sum("cacheCreationInputTokens"),
    totalTokens: sum("totalTokens"),
    turnCount: sum("turnCount"),
  };
}

function listSessionCostEvents(db: Database.Database, session: OverseerSession): Array<Record<string, unknown>> {
  const rows = db
    .prepare(
      `SELECT id, provider, biller, billing_type, model, input_tokens, cache_read_tokens,
              cache_write_tokens, output_tokens, cost_cents, cost_source, confidence,
              metadata_json, occurred_at, created_at
       FROM cost_events
       WHERE company_id = ?
         AND (
           json_extract(metadata_json, '$.sessionId') = ?
           OR json_extract(metadata_json, '$.overseerSessionId') = ?
           OR json_extract(metadata_json, '$.rawUsage.sessionId') = ?
         )
       ORDER BY occurred_at ASC, id ASC`,
    )
    .all(session.companyId, session.id, session.id, session.id) as CostEventRow[];
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    biller: row.biller,
    billingType: row.billing_type,
    model: row.model,
    inputTokens: row.input_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    outputTokens: row.output_tokens,
    costCents: row.cost_cents,
    costSource: row.cost_source,
    confidence: row.confidence,
    metadata: parseRecord(row.metadata_json),
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  }));
}

function buildUsageExport(
  db: Database.Database,
  session: OverseerSession,
  turns: OverseerTurn[],
): RawOverseerTranscriptPackage["usage"] {
  const turnTotal = turns.reduce<OverseerUsageSnapshot>(
    (total, turn) => addUsage(total, turn.usage),
    {},
  );
  const costEvents = listSessionCostEvents(db, session);
  return {
    session: session.usage,
    quota: session.quota,
    turns: {
      total: turnTotal,
      byTurn: turns.map((turn) => ({ turnId: turn.id, usage: turn.usage })),
    },
    costEvents: {
      totalCostCents: costEvents.reduce((total, event) => {
        const cents = typeof event.costCents === "number" ? event.costCents : 0;
        return total + cents;
      }, 0),
      events: costEvents,
    },
  };
}

type RawOverseerTranscriptContent = Omit<RawOverseerTranscriptPackage, "_meta" | "_counts" | "contentHashes" | "continuityProof"> & {
  continuityProof?: OverseerContinuityProof;
};

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildContentHashes(content: RawOverseerTranscriptContent): Record<string, string> {
  const hashes: Record<string, string> = {
    sessionSha256: sha256(content.session),
    turnsSha256: sha256(content.turns),
    messagesSha256: sha256(content.messages),
    eventsSha256: sha256(content.events),
    compactionSha256: sha256(content.compaction),
    snapshotsSha256: sha256(content.snapshots),
    approvalsSha256: sha256(content.approvals),
    attachmentManifestSha256: sha256(content.attachmentManifest),
    usageSha256: sha256(content.usage),
    payloadSha256: sha256(content),
  };
  if (content.continuityProof) hashes.continuityProofSha256 = sha256(content.continuityProof);
  return hashes;
}

function buildContinuityProof(input: {
  session: OverseerSession;
  turns: OverseerTurn[];
  messages: ReturnType<typeof listOverseerMessages>["messages"];
  events: ReturnType<typeof listOverseerEvents>["events"];
  compaction: RawOverseerTranscriptPackage["compaction"];
  snapshots: Array<Record<string, unknown>>;
  approvals: Array<Record<string, unknown>>;
  attachmentManifest: Array<Record<string, unknown>>;
  usage: RawOverseerTranscriptPackage["usage"];
  contentHashes: Record<string, string>;
}): OverseerContinuityProof {
  const snapshotVersions = input.snapshots.map((snapshot) => ({
    id: stringField(snapshot.id) ?? "",
    version: numberField(snapshot.version),
    summaryHash: stringField(snapshot.summaryHash),
    createdAt: stringField(snapshot.createdAt),
  }));
  const latestSnapshot = snapshotVersions
    .filter((snapshot) => snapshot.id || snapshot.version !== null)
    .at(-1) ?? null;
  const latestApprovalIdFromMetadata = stringField(input.compaction.metadata.approvalId);
  const latestCompactionApproval = [...input.approvals].reverse().find((approval) => {
    const payload = approval.payload;
    return typeof payload === "object"
      && payload !== null
      && !Array.isArray(payload)
      && (payload as Record<string, unknown>).actionType === "compact_overseer_session";
  });
  const snapshotId = stringField(input.compaction.metadata.snapshotId);
  const expectedSnapshotExists = snapshotId
    ? input.snapshots.some((snapshot) => stringField(snapshot.id) === snapshotId)
    : true;
  const hasCompaction = Boolean(input.compaction.state.latestSummary || input.compaction.state.compactedAt);
  const status: OverseerContinuityProof["status"] = input.snapshots.length === 0
    ? "incomplete"
    : hasCompaction && !expectedSnapshotExists
      ? "stale"
      : "verified";
  return {
    status,
    sourceRowCounts: {
      turns: input.turns.length,
      messages: input.messages.length,
      events: input.events.length,
      snapshots: input.snapshots.length,
      approvals: input.approvals.length,
      attachmentManifest: input.attachmentManifest.length,
      costEvents: input.usage.costEvents.events.length,
    },
    hashes: {
      sessionSha256: input.contentHashes.sessionSha256,
      turnsSha256: input.contentHashes.turnsSha256,
      messagesSha256: input.contentHashes.messagesSha256,
      eventsSha256: input.contentHashes.eventsSha256,
      compactionSha256: input.contentHashes.compactionSha256,
      snapshotsSha256: input.contentHashes.snapshotsSha256,
      approvalsSha256: input.contentHashes.approvalsSha256,
      attachmentManifestSha256: input.contentHashes.attachmentManifestSha256,
      usageSha256: input.contentHashes.usageSha256,
    },
    snapshotVersions,
    latestSnapshotVersion: latestSnapshot?.version ?? null,
    latestCompactionApprovalId: latestApprovalIdFromMetadata ?? stringField(latestCompactionApproval?.id),
    latestCompaction: {
      compactedAt: input.compaction.state.compactedAt,
      compactedBy: input.compaction.state.compactedBy,
      snapshotId,
      snapshotVersion: numberField(input.compaction.metadata.snapshotVersion),
      snapshotSummaryHash: stringField(input.compaction.metadata.snapshotSummaryHash),
    },
    prePostCompactionLink: {
      previousCompactedAt: stringField(input.compaction.metadata.previousCompactedAt),
      compactedAt: input.compaction.state.compactedAt,
      sourceSnapshotId: snapshotId,
    },
  };
}

export function buildRawOverseerTranscriptExport(input: {
  companyIdOrSlug: string;
  sessionId: string;
  db?: Database.Database;
  exportedAt?: string;
}): RawOverseerTranscriptExport {
  const db = input.db ?? getOrchestrationDb();
  const session = assertOverseerSessionCompany({
    sessionId: input.sessionId,
    companyIdOrSlug: input.companyIdOrSlug,
    db,
  });
  if (session.archivedAt) {
    throw new OrchestrationApiError(404, "overseer_session_not_found", "Overseer session not found");
  }

  const turns = listTurns(db, session);
  const messages = listOverseerMessages(session.id, db).messages;
  const events = listOverseerEvents(session.id, db).events;
  const compaction = {
    state: session.compaction,
    latestSummary: session.compaction.latestSummary,
    metadata: session.compaction.metadata,
  };
  const snapshots = listSnapshots(db, session);
  const approvals = listSessionApprovals(db, session);
  const attachmentManifest = listAttachmentManifest(messages);
  const usage = buildUsageExport(db, session, turns);
  const content = {
    session,
    turns,
    messages,
    events,
    compaction,
    snapshots,
    approvals,
    attachmentManifest,
    usage,
  };
  const contentHashesWithoutProof = buildContentHashes(content);
  const continuityProof = buildContinuityProof({
    ...content,
    contentHashes: contentHashesWithoutProof,
  });
  const contentWithProof = {
    ...content,
    continuityProof,
  };
  const filename = buildOverseerTranscriptFilename(session);
  const categories = [
    "session",
    "turns",
    "messages",
    "events",
    "compaction",
    "snapshots",
    "approvals",
    "attachmentManifest",
    "usage",
    "continuityProof",
  ];

  return {
    filename,
    package: {
      _meta: {
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        exportedAt: input.exportedAt ?? new Date().toISOString(),
        filename,
        sourceCompany: {
          id: session.companyId,
          slug: session.companySlug,
          companyCode: session.companyCode,
        },
        sessionId: session.id,
        categories,
      },
      ...contentWithProof,
      _counts: {
        turns: turns.length,
        messages: messages.length,
        events: events.length,
        snapshots: snapshots.length,
        approvals: approvals.length,
        attachmentManifest: attachmentManifest.length,
        costEvents: usage.costEvents.events.length,
      },
      contentHashes: buildContentHashes(contentWithProof),
    },
  };
}
