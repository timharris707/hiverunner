import type Database from "better-sqlite3";
import type { MCLiveEvent, MCLiveEventKind } from "./live-events";
import { redactRunTracePayload } from "./run-trace";
import { persistExecutionTranscriptEvents } from "./service/execution-transcript";

type LiveRuntimeEventSubscriber = (event: MCLiveEvent) => void;
type RuntimeTraceDbResolver = () => Database.Database | Promise<Database.Database>;

interface LiveRuntimeEventSubscriptionOptions {
  companyId?: string | null;
  runId?: string | null;
  replay?: boolean;
}

interface LiveRuntimeEventsStatus {
  subscriberCount: number;
  bufferedRunCount: number;
  bufferedEventCount: number;
  ringBufferSize: number;
}

interface LiveRuntimeEventSubscription {
  fn: LiveRuntimeEventSubscriber;
  companyId: string | null;
  runId: string | null;
}

export const LIVE_RUNTIME_RING_BUFFER_SIZE = 64;

const LIVE_RUNTIME_TRACE_METADATA_SCHEMA = "hiverunner.live_runtime_event.v1";
const DURABLE_RUNTIME_EVENT_KINDS = new Set<MCLiveEventKind>([
  "command_start",
  "command_exit",
  "stdout_chunk",
  "stderr_chunk",
  "process_spawned",
  "process_exit",
  "runtime_progress",
]);
const MAX_TRACE_STRING_CHARS = 4000;
const MAX_TRACE_ARRAY_ITEMS = 40;
const MAX_TRACE_OBJECT_KEYS = 80;
const MAX_TRACE_DEPTH = 5;
const DEFAULT_SQLITE_BUSY_WRITE_ATTEMPTS = 3;
const DEFAULT_SQLITE_BUSY_BACKOFF_MS = 25;

let nextRuntimeSeq = 1;
const subscribers = new Set<LiveRuntimeEventSubscription>();
const eventsByRunId = new Map<string, MCLiveEvent[]>();
const pendingDurableTraceWrites = new Set<Promise<void>>();
let runtimeTraceDbResolver: RuntimeTraceDbResolver = defaultRuntimeTraceDbResolver;

function matchesSubscription(
  event: MCLiveEvent,
  options: Pick<LiveRuntimeEventSubscription, "companyId" | "runId">,
): boolean {
  if (options.companyId && event.companyId !== options.companyId) return false;
  if (options.runId && event.runId !== options.runId) return false;
  return true;
}

function notify(subscription: LiveRuntimeEventSubscription, event: MCLiveEvent): void {
  if (!matchesSubscription(event, subscription)) return;
  try {
    subscription.fn(event);
  } catch {
    // Subscriber errors must not break live runtime publishing.
  }
}

function appendToRingBuffer(event: MCLiveEvent): void {
  const buffer = eventsByRunId.get(event.runId) ?? [];
  buffer.push(event);
  if (buffer.length > LIVE_RUNTIME_RING_BUFFER_SIZE) {
    buffer.splice(0, buffer.length - LIVE_RUNTIME_RING_BUFFER_SIZE);
  }
  eventsByRunId.set(event.runId, buffer);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundTraceValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") {
    if (value.length <= MAX_TRACE_STRING_CHARS) return value;
    return `${value.slice(0, MAX_TRACE_STRING_CHARS)}... [truncated ${value.length - MAX_TRACE_STRING_CHARS} chars]`;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_TRACE_DEPTH) return "[truncated: max depth]";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_TRACE_ARRAY_ITEMS).map((entry) => boundTraceValue(entry, depth + 1));
    if (value.length > MAX_TRACE_ARRAY_ITEMS) {
      items.push(`[truncated ${value.length - MAX_TRACE_ARRAY_ITEMS} items]`);
    }
    return items;
  }
  const record = asRecord(value);
  if (!record) return String(value);
  const entries = Object.entries(record);
  const output: Record<string, unknown> = {};
  for (const [key, entryValue] of entries.slice(0, MAX_TRACE_OBJECT_KEYS)) {
    output[key] = boundTraceValue(entryValue, depth + 1);
  }
  if (entries.length > MAX_TRACE_OBJECT_KEYS) {
    output._truncatedKeys = entries.length - MAX_TRACE_OBJECT_KEYS;
  }
  return output;
}

function textField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberField(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sqliteBusyWriteAttempts(): number {
  return Math.min(
    10,
    positiveIntegerFromEnv("HIVERUNNER_LIVE_RUNTIME_EVENT_BUSY_WRITE_ATTEMPTS", DEFAULT_SQLITE_BUSY_WRITE_ATTEMPTS),
  );
}

function sqliteBusyBackoffMs(attempt: number): number {
  const base = positiveIntegerFromEnv("HIVERUNNER_LIVE_RUNTIME_EVENT_BUSY_BACKOFF_MS", DEFAULT_SQLITE_BUSY_BACKOFF_MS);
  return Math.min(250, base * Math.max(1, attempt));
}

function sleepSync(ms: number): void {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function isSqliteBusyError(error: unknown): boolean {
  const record = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
  return code === "SQLITE_BUSY" ||
    code === "SQLITE_LOCKED" ||
    message.includes("database is locked") ||
    message.includes("database is busy");
}

function describePersistenceError(error: unknown): Record<string, string> {
  const record = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
  return {
    code: typeof record.code === "string" ? record.code : "unknown",
    message: typeof record.message === "string" ? record.message : String(error),
  };
}

function warnDurableRuntimeTraceFailure(event: MCLiveEvent, error: unknown, attempts: number): void {
  console.warn("[live-runtime-events] failed to persist runtime transparency event", {
    eventId: event.id,
    kind: event.kind,
    runId: event.runId,
    companyId: event.companyId,
    agentId: event.agentId,
    provider: event.provider,
    attempts,
    error: describePersistenceError(error),
  });
}

async function defaultRuntimeTraceDbResolver(): Promise<Database.Database> {
  const { getOrchestrationDb } = await import("./db");
  return getOrchestrationDb();
}

async function getRuntimeTraceDb(): Promise<Database.Database> {
  return runtimeTraceDbResolver();
}

function durableEventTitle(event: MCLiveEvent, payload: Record<string, unknown> | null): string {
  switch (event.kind) {
    case "command_start":
      return textField(payload, "command") ?? "command started";
    case "command_exit": {
      const exitCode = numberField(payload, "exitCode");
      return exitCode === null ? "command exited" : `command exited ${exitCode}`;
    }
    case "stdout_chunk":
      return "stdout";
    case "stderr_chunk":
      return "stderr";
    case "process_spawned": {
      const pid = numberField(payload, "pid");
      return pid === null ? "process spawned" : `process spawned ${pid}`;
    }
    case "process_exit": {
      const pid = numberField(payload, "pid");
      const exitCode = numberField(payload, "exitCode");
      if (pid !== null && exitCode !== null) return `process ${pid} exited ${exitCode}`;
      if (pid !== null) return `process ${pid} exited`;
      return "process exited";
    }
    case "runtime_progress":
      return textField(payload, "phase") ?? "runtime progress";
    default:
      return event.kind;
  }
}

function durableEventBody(event: MCLiveEvent, payload: Record<string, unknown> | null): string {
  switch (event.kind) {
    case "stdout_chunk":
    case "stderr_chunk":
      return textField(payload, "chunk") ?? event.summary;
    case "command_start":
      return textField(payload, "command") ?? event.summary;
    case "runtime_progress":
      return textField(payload, "message") ?? event.summary;
    default:
      return event.summary;
  }
}

function durableEventRole(event: MCLiveEvent): string {
  switch (event.kind) {
    case "stdout_chunk":
    case "stderr_chunk":
      return "tool";
    default:
      return "system";
  }
}

async function tableExists(tableName: string): Promise<boolean> {
  const db = await getRuntimeTraceDb();
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;
  return row?.name === tableName;
}

async function executionRunExists(runId: string): Promise<boolean> {
  const db = await getRuntimeTraceDb();
  const row = db
    .prepare("SELECT id FROM execution_runs WHERE id = ? LIMIT 1")
    .get(runId) as { id: string } | undefined;
  return row?.id === runId;
}

async function persistDurableRuntimeTraceEvent(event: MCLiveEvent): Promise<void> {
  if (!DURABLE_RUNTIME_EVENT_KINDS.has(event.kind)) return;

  const attempts = sqliteBusyWriteAttempts();
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (!(await tableExists("execution_runs")) || !(await tableExists("execution_run_transcript_events"))) return;
      if (!(await executionRunExists(event.runId))) return;

      const redacted = redactRunTracePayload({
        summary: event.summary,
        payload: boundTraceValue(event.payload),
        providerMeta: boundTraceValue(event.providerMeta ?? {}),
      });
      const payload = asRecord(redacted.value.payload);
      const providerMeta = asRecord(redacted.value.providerMeta) ?? {};

      persistExecutionTranscriptEvents({
        db: await getRuntimeTraceDb(),
        executionRunId: event.runId,
        provider: event.provider,
        events: [{
          kind: event.kind,
          role: durableEventRole(event),
          title: durableEventTitle(event, payload),
          body: durableEventBody({ ...event, summary: redacted.value.summary }, payload),
          occurredAt: new Date(event.ts).toISOString(),
          metadata: {
            schema: LIVE_RUNTIME_TRACE_METADATA_SCHEMA,
            liveRuntimeEvent: {
              id: event.id,
              kind: event.kind,
              seq: event.seq ?? null,
              provider: event.provider,
              companyId: event.companyId,
              agentId: event.agentId,
            },
            payload,
            providerMeta,
            redaction: redacted.redaction,
          },
        }],
        occurredAt: new Date(event.ts).toISOString(),
      });
      return;
    } catch (error) {
      if (isSqliteBusyError(error) && attempt < attempts) {
        sleepSync(sqliteBusyBackoffMs(attempt));
        continue;
      }
      // Durable trace capture must never break live runtime streaming, but failed writes need evidence.
      warnDurableRuntimeTraceFailure(event, error, attempt);
      return;
    }
  }
}

export function publishLiveRuntimeEvent(event: MCLiveEvent): MCLiveEvent {
  const published = event.seq === undefined ? { ...event, seq: nextRuntimeSeq++ } : event;
  appendToRingBuffer(published);
  const durableWrite = persistDurableRuntimeTraceEvent(published);
  pendingDurableTraceWrites.add(durableWrite);
  void durableWrite.finally(() => {
    pendingDurableTraceWrites.delete(durableWrite);
  });

  for (const subscription of subscribers) {
    notify(subscription, published);
  }

  return published;
}

export function getBufferedLiveRuntimeEvents(
  options: Omit<LiveRuntimeEventSubscriptionOptions, "replay"> = {},
): MCLiveEvent[] {
  const filter = {
    companyId: options.companyId ?? null,
    runId: options.runId ?? null,
  };
  const events: MCLiveEvent[] = [];

  for (const buffer of eventsByRunId.values()) {
    for (const event of buffer) {
      if (matchesSubscription(event, filter)) {
        events.push(event);
      }
    }
  }

  return events.sort((a, b) => (a.ts - b.ts) || ((a.seq ?? 0) - (b.seq ?? 0)));
}

export function subscribeLiveRuntimeEvents(
  fn: LiveRuntimeEventSubscriber,
  options: LiveRuntimeEventSubscriptionOptions = {},
): () => void {
  const subscription: LiveRuntimeEventSubscription = {
    fn,
    companyId: options.companyId ?? null,
    runId: options.runId ?? null,
  };
  subscribers.add(subscription);

  if (options.replay) {
    for (const event of getBufferedLiveRuntimeEvents(options)) {
      notify(subscription, event);
    }
  }

  return () => {
    subscribers.delete(subscription);
  };
}

export function getLiveRuntimeEventsStatus(): LiveRuntimeEventsStatus {
  let bufferedEventCount = 0;
  for (const buffer of eventsByRunId.values()) {
    bufferedEventCount += buffer.length;
  }

  return {
    subscriberCount: subscribers.size,
    bufferedRunCount: eventsByRunId.size,
    bufferedEventCount,
    ringBufferSize: LIVE_RUNTIME_RING_BUFFER_SIZE,
  };
}

export function __resetLiveRuntimeEventsForTests(): void {
  subscribers.clear();
  eventsByRunId.clear();
  nextRuntimeSeq = 1;
  runtimeTraceDbResolver = defaultRuntimeTraceDbResolver;
}

export const __liveRuntimeEventsTestHooks = {
  persistDurableRuntimeTraceEvent,
  async flushDurableRuntimeTraceEventsForTests(): Promise<void> {
    while (pendingDurableTraceWrites.size > 0) {
      await Promise.allSettled([...pendingDurableTraceWrites]);
    }
  },
  setRuntimeTraceDbResolverForTests(resolver: RuntimeTraceDbResolver): void {
    runtimeTraceDbResolver = resolver;
  },
};
