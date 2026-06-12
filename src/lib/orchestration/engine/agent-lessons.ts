import { createHash } from "crypto";
import fs from "fs";
import path from "path";

import type Database from "better-sqlite3";

import { getCompanyLeadAgent } from "@/lib/orchestration/company-lead";
import { isCompanyOrchestrationLeadRole } from "@/lib/orchestration/engine/role-matcher";
import { mergeExecutionRunMetadata, parseJson } from "@/lib/orchestration/engine/persistence";
import {
  ensureCompanyWorkspaceScaffold,
  resolveCanonicalCompanyWorkspaceRoot,
} from "@/lib/workspaces/company-paths";

/**
 * H3 — Per-agent run lessons, engine-enforced (memory bookends).
 *
 * Same file the voice lane reads and writes
 * ({companyWorkspace}/memory/agents/{agentId}/MEMORY.md), extended with a
 * "## Run lessons" section that orchestration runs consult at wake and feed
 * at run end. Enforcement follows the Bundle-2 status-bookend philosophy
 * (FIX 9/11): agents forget, the engine doesn't. If an eligible agent
 * finishes a task-linked run without a `record_lesson` action, the engine
 * appends a structured stub built from the run outcome so the next run still
 * starts smarter.
 *
 * Sync on purpose: prompt assembly and run finalization are synchronous
 * paths. The voice module (voice-agent-memory.ts) stays async; both resolve
 * the memory file through resolveCanonicalCompanyWorkspaceRoot so they always
 * agree on the path.
 */

const MEMORY_FILENAME = "MEMORY.md";
const LESSONS_HEADING = "## Run lessons";
const MAX_LESSON_CHARS = 500;
const MAX_SECTION_BULLETS = 100;
const DEFAULT_PROMPT_BULLETS = 20;

export type AgentLessonSource = "agent" | "engine_stub";

export type AppendAgentRunLessonInput = {
  companyId: string;
  agentId: string;
  lesson: string;
  source: AgentLessonSource;
  taskKey?: string | null;
  runId?: string | null;
};

export type LessonsBookendAgent = {
  id: string;
  role: string;
  company_id: string;
};

function formatDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function resolveAgentMemoryFilePath(
  db: Database.Database,
  companyId: string,
  agentId: string,
): string | null {
  if (!companyId || !agentId) return null;
  const company = db
    .prepare("SELECT id, slug, workspace_slug FROM companies WHERE id = ? LIMIT 1")
    .get(companyId) as { id: string; slug: string; workspace_slug: string | null } | undefined;
  if (!company) return null;

  const workspaceRoot = resolveCanonicalCompanyWorkspaceRoot(
    company.id,
    company.workspace_slug ?? company.slug,
  );
  const { memoryDir } = ensureCompanyWorkspaceScaffold(workspaceRoot);
  const agentDir = path.join(memoryDir, "agents", agentId);
  fs.mkdirSync(agentDir, { recursive: true });
  return path.join(agentDir, MEMORY_FILENAME);
}

function readFileOrEmpty(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function normalizeLessonText(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_LESSON_CHARS) return collapsed;
  return `${collapsed.slice(0, MAX_LESSON_CHARS - 1)}…`;
}

/** Split the lessons section out of the memory document. */
function splitLessonsSection(body: string): {
  before: string;
  bullets: string[];
  after: string;
} {
  const headingToken = `\n${LESSONS_HEADING}\n`;
  const withLeadingNewline = body.startsWith(`${LESSONS_HEADING}\n`)
    ? `\n${body}`
    : body;
  const headingIdx = withLeadingNewline.indexOf(headingToken);
  if (headingIdx < 0) {
    return { before: body, bullets: [], after: "" };
  }

  const sectionStart = headingIdx + headingToken.length;
  const rest = withLeadingNewline.slice(sectionStart);
  const nextHeadingIdx = rest.search(/\n#{1,6} /);
  const sectionBody = nextHeadingIdx >= 0 ? rest.slice(0, nextHeadingIdx) : rest;
  const after = nextHeadingIdx >= 0 ? rest.slice(nextHeadingIdx) : "";

  const bullets = sectionBody
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("- "));

  const before = withLeadingNewline.slice(0, headingIdx);
  return {
    before: before.startsWith("\n") && !body.startsWith("\n") ? before.slice(1) : before,
    bullets,
    after,
  };
}

function lessonBulletLine(input: AppendAgentRunLessonInput, lesson: string): string {
  const meta: string[] = [];
  if (input.source === "engine_stub") meta.push("engine stub");
  if (input.runId) meta.push(`run ${input.runId.slice(0, 8)}`);
  meta.push(formatDate());
  const taskRef = input.taskKey?.trim() ? ` [${input.taskKey.trim()}]` : "";
  return `- ${lesson}${taskRef} _(${meta.join(", ")})_`;
}

/** The lesson text portion of a bullet line, for dedupe comparison. */
function bulletLessonText(bullet: string): string {
  return bullet
    .replace(/^- /, "")
    .replace(/ _\([^)]*\)_\s*$/, "")
    .replace(/ \[[^\]]*\]$/, "")
    .trim()
    .toLowerCase();
}

/**
 * Append one lesson bullet under "## Run lessons" (newest first). Creates the
 * memory file on first write. Skips exact-duplicate lesson text already in
 * the section, and caps the section so per-run appends cannot grow the file
 * without bound.
 */
export function appendAgentRunLesson(
  db: Database.Database,
  input: AppendAgentRunLessonInput,
): { saved: boolean; reason?: string } {
  const lesson = normalizeLessonText(input.lesson);
  if (!lesson) return { saved: false, reason: "empty_lesson" };

  const filePath = resolveAgentMemoryFilePath(db, input.companyId, input.agentId);
  if (!filePath) return { saved: false, reason: "no_company_workspace" };

  let body = readFileOrEmpty(filePath);
  if (!body.trim()) {
    body = "# Agent memory\n";
  }

  const { before, bullets, after } = splitLessonsSection(body);

  const incoming = bulletLessonText(lessonBulletLine(input, lesson));
  if (bullets.some((bullet) => bulletLessonText(bullet) === incoming)) {
    return { saved: false, reason: "duplicate_lesson" };
  }

  const nextBullets = [lessonBulletLine(input, lesson), ...bullets].slice(0, MAX_SECTION_BULLETS);

  let beforeBlock = before;
  if (!beforeBlock.endsWith("\n")) beforeBlock += "\n";
  const next = `${beforeBlock}\n${LESSONS_HEADING}\n${nextBullets.join("\n")}\n${after}`;
  fs.writeFileSync(filePath, next, "utf-8");
  return { saved: true };
}

/** Newest-first lesson bullets for prompt injection. */
export function readAgentRunLessons(
  db: Database.Database,
  companyId: string,
  agentId: string,
  limit = DEFAULT_PROMPT_BULLETS,
): string[] {
  const filePath = resolveAgentMemoryFilePath(db, companyId, agentId);
  if (!filePath) return [];
  const { bullets } = splitLessonsSection(readFileOrEmpty(filePath));
  return bullets.slice(0, Math.max(1, limit));
}

/**
 * Lessons bookends start narrow: the designated company lead (Oracle-class
 * roles) plus builder roles. Expand after observation.
 */
export function isLessonsBookendEligible(
  db: Database.Database,
  agent: LessonsBookendAgent,
): boolean {
  try {
    const lead = getCompanyLeadAgent(agent.company_id, db);
    if (lead?.id === agent.id) return true;
  } catch {
    // Designation lookup failure falls through to role heuristics.
  }
  if (isCompanyOrchestrationLeadRole(agent.role)) return true;
  return /\b(builder|engineer|developer|programmer|implementer)\b/i.test(agent.role);
}

export type LessonsBookendRunEndInput = {
  agentId: string;
  taskId: string;
  runId: string;
  executionRunId?: string | null;
  status: "completed" | "failed";
  error?: string | null;
  durationMs?: number;
};

/**
 * Engine-side bookend at run end. If the agent already recorded a lesson this
 * run (record_lesson sets lessonRecordedByAgent on the execution run), do
 * nothing. Otherwise append a structured stub from the run outcome. Compact
 * prompt runs are exempt — that lane intentionally strips ritual sections,
 * and tiny deterministic tasks are not where lessons live.
 */
export function enforceLessonsBookendAtRunEnd(
  db: Database.Database,
  input: LessonsBookendRunEndInput,
): { stubAppended: boolean; reason?: string } {
  const agent = db
    .prepare("SELECT id, role, company_id FROM agents WHERE id = ? LIMIT 1")
    .get(input.agentId) as LessonsBookendAgent | undefined;
  if (!agent) return { stubAppended: false, reason: "agent_not_found" };
  if (!isLessonsBookendEligible(db, agent)) {
    return { stubAppended: false, reason: "agent_not_eligible" };
  }

  if (input.executionRunId) {
    const row = db
      .prepare("SELECT metadata_json FROM execution_runs WHERE id = ? LIMIT 1")
      .get(input.executionRunId) as { metadata_json: string | null } | undefined;
    const metadata = parseJson(row?.metadata_json);
    if (metadata.lessonRecordedByAgent === true) {
      return { stubAppended: false, reason: "agent_recorded_lesson" };
    }
    if (metadata.compactPromptPolicy) {
      return { stubAppended: false, reason: "compact_prompt_run" };
    }
  }

  const task = db
    .prepare("SELECT task_key, title, status FROM tasks WHERE id = ? LIMIT 1")
    .get(input.taskId) as { task_key: string | null; title: string | null; status: string | null } | undefined;
  const taskKey = task?.task_key ?? null;

  const outcomeBits: string[] = [`run ${input.status}`];
  if (typeof input.durationMs === "number" && Number.isFinite(input.durationMs)) {
    outcomeBits.push(`${Math.round(input.durationMs / 1000)}s`);
  }
  if (task?.status) outcomeBits.push(`task left ${task.status}`);
  const failureDetail = input.error?.trim()
    ? `; failure: ${input.error.trim()}`
    : "";
  const stub = `No lesson recorded by agent — ${outcomeBits.join(", ")} on "${task?.title ?? input.taskId}"${failureDetail}`;

  const appended = appendAgentRunLesson(db, {
    companyId: agent.company_id,
    agentId: agent.id,
    lesson: stub,
    source: "engine_stub",
    taskKey,
    runId: input.runId,
  });

  if (appended.saved && input.executionRunId) {
    try {
      mergeExecutionRunMetadata(db, input.executionRunId, {
        lessonsBookend: { stubAppended: true, appendedAt: new Date().toISOString() },
      });
    } catch {
      // Metadata is best-effort proof; the lesson file write already landed.
    }
  }

  return appended.saved
    ? { stubAppended: true }
    : { stubAppended: false, reason: appended.reason };
}

/** Prompt section for an eligible agent's wake. Null when no lessons exist yet. */
export function buildAgentLessonsPromptSection(
  db: Database.Database,
  agent: LessonsBookendAgent,
  limit = DEFAULT_PROMPT_BULLETS,
): string | null {
  const lessons = readAgentRunLessons(db, agent.company_id, agent.id, limit);
  if (lessons.length === 0) return null;
  return [
    "\n---\n## Lessons From Your Previous Runs",
    "Your durable per-agent memory. Newest first; entries marked \"engine stub\" were auto-captured because a prior run ended without recording a lesson.",
    ...lessons,
  ].join("\n");
}
