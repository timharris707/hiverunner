import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

type ExecutionTranscriptEventInput = {
  kind: string;
  role?: string | null;
  title?: string | null;
  body?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string | null;
};

export type ExecutionTranscriptEvent = {
  id: string;
  executionRunId: string;
  provider: string;
  kind: string;
  role: string | null;
  title: string | null;
  body: string;
  metadata: Record<string, unknown>;
  sequence: number;
  occurredAt: string;
};

type ExecutionTranscriptEventRow = {
  id: string;
  execution_run_id: string;
  provider: string;
  event_kind: string;
  role: string | null;
  title: string | null;
  body: string;
  metadata_json: string;
  sequence: number;
  occurred_at: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

function normalizeTranscriptEvent(
  value: unknown,
  fallbackOccurredAt: string,
): ExecutionTranscriptEventInput | null {
  const record = asRecord(value);
  if (!record) return null;
  const kind = typeof record.kind === "string" && record.kind.trim()
    ? record.kind.trim()
    : typeof record.eventKind === "string" && record.eventKind.trim()
      ? record.eventKind.trim()
      : "";
  if (!kind) return null;

  return {
    kind,
    role: typeof record.role === "string" ? record.role : null,
    title: typeof record.title === "string" ? record.title : null,
    body: typeof record.body === "string" ? record.body : "",
    metadata: asRecord(record.metadata) ?? {},
    occurredAt: typeof record.occurredAt === "string" && record.occurredAt.trim()
      ? record.occurredAt
      : fallbackOccurredAt,
  };
}

function countExecutionTranscriptEvents(db: Database.Database, executionRunId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM execution_run_transcript_events WHERE execution_run_id = ?")
    .get(executionRunId) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function persistExecutionTranscriptEvents(input: {
  db: Database.Database;
  executionRunId: string;
  provider: string;
  events: unknown;
  occurredAt?: string | null;
}): number {
  if (!Array.isArray(input.events) || input.events.length === 0) {
    return countExecutionTranscriptEvents(input.db, input.executionRunId);
  }

  const fallbackOccurredAt = input.occurredAt ?? new Date().toISOString();
  const events = input.events
    .map((event) => normalizeTranscriptEvent(event, fallbackOccurredAt))
    .filter((event): event is ExecutionTranscriptEventInput => event !== null);

  if (events.length === 0) {
    return countExecutionTranscriptEvents(input.db, input.executionRunId);
  }

  const now = new Date().toISOString();
  const insert = input.db.prepare(
    `INSERT INTO execution_run_transcript_events
      (id, execution_run_id, provider, event_kind, role, title, body,
       metadata_json, sequence, occurred_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let persistedCount = 0;
  input.db.transaction(() => {
    const sequenceRow = input.db
      .prepare(
        `SELECT COALESCE(MAX(sequence), -1) + 1 AS next_sequence,
                COUNT(*) AS existing_count
         FROM execution_run_transcript_events
         WHERE execution_run_id = ?`,
      )
      .get(input.executionRunId) as { next_sequence: number; existing_count: number } | undefined;
    const nextSequence = sequenceRow?.next_sequence ?? 0;
    events.forEach((event, index) => {
      insert.run(
        randomUUID(),
        input.executionRunId,
        input.provider,
        event.kind,
        event.role ?? null,
        event.title ?? null,
        event.body ?? "",
        JSON.stringify(event.metadata ?? {}),
        nextSequence + index,
        event.occurredAt ?? fallbackOccurredAt,
        now,
      );
    });
    persistedCount = (sequenceRow?.existing_count ?? 0) + events.length;
  })();

  return persistedCount;
}

export function listExecutionTranscriptEvents(
  db: Database.Database,
  executionRunId: string,
): ExecutionTranscriptEvent[] {
  const rows = db
    .prepare(
      `SELECT id, execution_run_id, provider, event_kind, role, title, body,
              metadata_json, sequence, occurred_at
       FROM execution_run_transcript_events
       WHERE execution_run_id = ?
       ORDER BY sequence ASC, occurred_at ASC`,
    )
    .all(executionRunId) as ExecutionTranscriptEventRow[];

  return rows.map((row) => ({
    id: row.id,
    executionRunId: row.execution_run_id,
    provider: row.provider,
    kind: row.event_kind,
    role: row.role,
    title: row.title,
    body: row.body,
    metadata: parseMetadata(row.metadata_json),
    sequence: row.sequence,
    occurredAt: row.occurred_at,
  }));
}
