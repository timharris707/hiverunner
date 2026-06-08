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

export function estimatePromptTokens(text: string): number {
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

function titleFromSection(section: Record<string, unknown>, fallback: string): string {
  for (const key of ["title", "name", "label", "source", "category"]) {
    const value = section[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 160);
  }
  return fallback;
}

function textFromSection(section: Record<string, unknown>): string {
  for (const key of ["text", "body", "content", "prompt"]) {
    const value = section[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function categoryFromTitle(title: string): string {
  const normalized = title.toLowerCase();
  if (normalized.includes("memory")) return "memory";
  if (normalized.includes("goal") || normalized.includes("sprint") || normalized.includes("task")) return "work_item";
  if (normalized.includes("agent") || normalized.includes("identity") || normalized.includes("soul")) return "agent";
  if (normalized.includes("workspace") || normalized.includes("source")) return "workspace";
  if (normalized.includes("approval") || normalized.includes("review")) return "governance";
  return "prompt";
}

function sanitizeManifestSection(
  section: Record<string, unknown>,
  index: number,
): Record<string, unknown> {
  const title = titleFromSection(section, `section ${index + 1}`);
  const text = textFromSection(section);
  const chars = text ? text.length : Number(section.promptChars ?? section.chars ?? section.byteEstimate ?? 0) || 0;
  const estimatedTokens = text
    ? estimatePromptTokens(text)
    : Number(section.estimatedTokens ?? section.tokenEstimate ?? 0) || 0;
  return {
    index,
    title,
    category: typeof section.category === "string" && section.category.trim()
      ? section.category.trim().slice(0, 80)
      : categoryFromTitle(title),
    promptChars: Math.max(0, Math.round(chars)),
    estimatedTokens: Math.max(0, Math.round(estimatedTokens)),
    promptSha256: text ? sha256(text) : null,
  };
}

function derivePromptSections(prompt: string): Array<Record<string, unknown>> {
  const matches = Array.from(prompt.matchAll(/^#\s+(.+)$/gm));
  if (matches.length === 0) {
    return [sanitizeManifestSection({ title: "prompt", text: prompt }, 0)];
  }

  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = index + 1 < matches.length ? matches[index + 1]?.index ?? prompt.length : prompt.length;
    return sanitizeManifestSection(
      {
        title: match[1] ?? `section ${index + 1}`,
        text: prompt.slice(start, end),
      },
      index,
    );
  });
}

export function recordRuntimeContextManifest(
  db: Database.Database,
  input: RuntimeContextManifestInput,
): string | null {
  if (!hasTable(db, "runtime_context_manifests")) return null;
  const id = randomUUID();
  const idempotencyKey = input.idempotencyKey ?? defaultIdempotencyKey(input);
  const sections = input.sections?.length
    ? input.sections.map((section, index) => sanitizeManifestSection(section, index))
    : derivePromptSections(input.prompt);
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
    estimatePromptTokens(input.prompt),
    sections.length,
    JSON.stringify(sections),
    JSON.stringify(input.metadata ?? {}),
    new Date().toISOString(),
  );
  return id;
}
