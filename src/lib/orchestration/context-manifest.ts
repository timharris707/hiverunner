import { createHash, randomUUID } from "crypto";
import type Database from "better-sqlite3";

type RuntimeContextSourceType = "heartbeat_prompt" | "overseer_prompt" | "manual";

export type RuntimeContextManifestInput = {
  sourceType: RuntimeContextSourceType;
  idempotencyKey?: string;
  companyId?: string | null;
  agentId?: string | null;
  taskId?: string | null;
  executionRunId?: string | null;
  heartbeatRunId?: string | null;
  overseerTurnId?: string | null;
  provider?: string | null;
  model?: string | null;
  prompt: string;
  sections?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
};

function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;
  return row?.name === tableName;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function defaultIdempotencyKey(input: RuntimeContextManifestInput): string {
  if (input.sourceType === "heartbeat_prompt" && input.heartbeatRunId) {
    return `heartbeat_prompt:${input.heartbeatRunId}`;
  }
  if (input.sourceType === "overseer_prompt" && input.overseerTurnId) {
    return `overseer_prompt:${input.overseerTurnId}`;
  }
  if (input.executionRunId) return `${input.sourceType}:execution_run:${input.executionRunId}`;
  return `${input.sourceType}:manual:${randomUUID()}`;
}

export function recordRuntimeContextManifest(
  db: Database.Database,
  input: RuntimeContextManifestInput,
): string | null {
  if (!hasTable(db, "runtime_context_manifests")) return null;
  const id = randomUUID();
  const idempotencyKey = input.idempotencyKey ?? defaultIdempotencyKey(input);
  const sections = input.sections ?? [];
  db.prepare(
    `INSERT OR REPLACE INTO runtime_context_manifests
       (id, idempotency_key, source_type, company_id, agent_id, task_id,
        execution_run_id, heartbeat_run_id, overseer_turn_id, provider, model,
        prompt_sha256, prompt_chars, estimated_tokens, section_count,
        sections_json, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    idempotencyKey,
    input.sourceType,
    input.companyId ?? null,
    input.agentId ?? null,
    input.taskId ?? null,
    input.executionRunId ?? null,
    input.heartbeatRunId ?? null,
    input.overseerTurnId ?? null,
    input.provider ?? null,
    input.model ?? null,
    sha256(input.prompt),
    input.prompt.length,
    estimateTokens(input.prompt),
    sections.length,
    JSON.stringify(sections),
    JSON.stringify(input.metadata ?? {}),
    new Date().toISOString(),
  );
  return id;
}
