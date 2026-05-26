import { promises as fs } from "fs";
import path from "path";

import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import {
  ensureCompanyWorkspaceScaffold,
  resolveCanonicalCompanyWorkspaceRoot,
} from "@/lib/workspaces/company-paths";

/**
 * Per-agent memory: a MEMORY.md file scoped to a single agent within a company
 * workspace. The agent accrues durable facts and preferences across all tasks
 * and projects for that company. Loaded into the system prompt on every
 * bound voice session so the agent carries context forward.
 *
 * Path: {companyWorkspace}/memory/agents/{agentId}/MEMORY.md
 *
 * Also tracks a session log with summaries of the last few voice sessions so
 * the agent can recall "we talked about X the other day" without explicit
 * user save.
 */

const MEMORY_FILENAME = "MEMORY.md";
const SESSION_LOG_FILENAME = "SESSIONS.md";

export interface AgentMemoryScope {
  companySlug?: string;
  agentId: string;
}

export interface AgentMemoryEntry {
  subject: string;
  detail: string;
}

export interface SessionSummaryEntry {
  timestamp: string;
  taskLabel?: string;
  projectLabel?: string;
  durationSeconds?: number;
  messages?: number;
  summary?: string;
}

async function resolveAgentMemoryDir(scope: AgentMemoryScope): Promise<string | null> {
  if (!scope.companySlug || !scope.agentId) return null;
  const company = resolveCompanyIdBySlug(scope.companySlug);
  if (!company) return null;

  const workspaceRoot = resolveCanonicalCompanyWorkspaceRoot(
    company.id,
    company.workspace_slug ?? company.slug,
  );
  const { memoryDir } = ensureCompanyWorkspaceScaffold(workspaceRoot);
  const agentDir = path.join(memoryDir, "agents", scope.agentId);
  await fs.mkdir(agentDir, { recursive: true });
  return agentDir;
}

function formatDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function normalizeSubject(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return "general";
  return trimmed.slice(0, 80);
}

function escapeSubjectForSection(subject: string): string {
  return subject.replace(/[#\n\r]/g, " ").trim();
}

async function readFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Append a fact/preference to the agent's MEMORY.md under a subject heading.
 * Creates the file + dir on first write.
 */
export async function appendAgentMemory(
  scope: AgentMemoryScope,
  entry: AgentMemoryEntry,
): Promise<{ saved: boolean; reason?: string }> {
  const dir = await resolveAgentMemoryDir(scope);
  if (!dir) {
    return { saved: false, reason: "no_company_workspace" };
  }

  const subject = normalizeSubject(entry.subject);
  const detail = entry.detail.trim();
  if (!detail) {
    return { saved: false, reason: "empty_detail" };
  }

  const filePath = path.join(dir, MEMORY_FILENAME);
  const heading = `## ${escapeSubjectForSection(subject)}`;
  const line = `- ${detail} _(remembered ${formatDate()})_`;

  let body = await readFileOrEmpty(filePath);
  if (!body.trim()) {
    body = "# Agent memory about the operator\n\n";
  }

  const headingIdx = body.indexOf(`\n${heading}\n`);
  if (headingIdx >= 0) {
    // Insert the new line at the top of the existing subject section.
    const insertAt = headingIdx + `\n${heading}\n`.length;
    body = body.slice(0, insertAt) + `${line}\n` + body.slice(insertAt);
  } else {
    if (!body.endsWith("\n")) body += "\n";
    body += `\n${heading}\n${line}\n`;
  }

  await fs.writeFile(filePath, body, "utf-8");
  return { saved: true };
}

/**
 * Read the agent's MEMORY.md. Returns an empty string when no memory exists yet.
 */
export async function readAgentMemory(scope: AgentMemoryScope): Promise<string> {
  const dir = await resolveAgentMemoryDir(scope);
  if (!dir) return "";
  return readFileOrEmpty(path.join(dir, MEMORY_FILENAME));
}

/**
 * Append a session-log entry for this agent. Called when a voice session ends.
 */
export async function appendAgentSessionSummary(
  scope: AgentMemoryScope,
  entry: SessionSummaryEntry,
): Promise<void> {
  const dir = await resolveAgentMemoryDir(scope);
  if (!dir) return;

  const filePath = path.join(dir, SESSION_LOG_FILENAME);
  let body = await readFileOrEmpty(filePath);
  if (!body.trim()) {
    body = "# Agent session log\n\nMost recent sessions first. One entry per completed voice session.\n\n";
  }

  const header = `## ${entry.timestamp}`;
  const lines = [header];
  if (entry.taskLabel) lines.push(`- Task: ${entry.taskLabel}`);
  if (entry.projectLabel) lines.push(`- Project: ${entry.projectLabel}`);
  if (typeof entry.durationSeconds === "number") lines.push(`- Duration: ${entry.durationSeconds}s`);
  if (typeof entry.messages === "number") lines.push(`- Messages: ${entry.messages}`);
  if (entry.summary?.trim()) lines.push("", entry.summary.trim());

  // Prepend newest entries at the top so "recent" reading is a head-read.
  const insertAt = body.indexOf("\n## ");
  const block = `${lines.join("\n")}\n\n`;
  if (insertAt >= 0) {
    body = body.slice(0, insertAt + 1) + block + body.slice(insertAt + 1);
  } else {
    if (!body.endsWith("\n")) body += "\n";
    body += `\n${block}`;
  }

  await fs.writeFile(filePath, body, "utf-8");
}

/**
 * Read the last N session-log entries. Returns an array of raw markdown blocks,
 * newest first.
 */
export async function listRecentSessionSummaries(
  scope: AgentMemoryScope,
  limit = 5,
): Promise<string[]> {
  const dir = await resolveAgentMemoryDir(scope);
  if (!dir) return [];
  const content = await readFileOrEmpty(path.join(dir, SESSION_LOG_FILENAME));
  if (!content.trim()) return [];

  const blocks = content.split(/\n## /).slice(1);
  return blocks.slice(0, limit).map((b) => `## ${b.trim()}`);
}
