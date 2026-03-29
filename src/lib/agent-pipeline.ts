/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * agent-pipeline.ts — Persistent agent pipeline with named routing, memory, blockers, and QA handoff.
 *
 * Replaces the fire-and-forget sub-agent model with accountable named agents that:
 * - Retain context from previous tasks (memory)
 * - Signal when they're blocked instead of falsely marking done
 * - Hand off UI work to Vigil for QA verification
 * - Get routed by identity (Pixel = frontend, Forge = backend, etc.)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { getAgentByAnyId, type AgentConfig } from "@/config/agents";
import type {
  AgentMemoryFile,
  AgentMemoryEntry,
  AgentAssignment,
  TaskBlocker,
} from "@/types/agent-pipeline";

const DATA_DIR = join(process.cwd(), "data");
const AGENT_MEMORY_DIR = join(DATA_DIR, "agent-memory");

// Ensure agent memory directory exists
mkdirSync(AGENT_MEMORY_DIR, { recursive: true });

// ─── Agent Memory ───────────────────────────────────────────────────────────

/** Read a named agent's memory file */
export function readAgentMemory(agentId: string): AgentMemoryFile {
  const filePath = join(AGENT_MEMORY_DIR, `${agentId}.json`);
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    const agent = getAgentByAnyId(agentId);
    return {
      agentId,
      agentName: agent?.name || agentId,
      role: agent?.role || "Unknown",
      entries: [],
      lastUpdated: new Date().toISOString(),
    };
  }
}

/** Write a named agent's memory file */
export function writeAgentMemory(memory: AgentMemoryFile): void {
  const filePath = join(AGENT_MEMORY_DIR, `${memory.agentId}.json`);
  memory.lastUpdated = new Date().toISOString();
  writeFileSync(filePath, JSON.stringify(memory, null, 2));
}

/** Add a memory entry for an agent after task completion */
export function recordAgentMemory(
  agentId: string,
  entry: Omit<AgentMemoryEntry, "id" | "timestamp">,
): AgentMemoryEntry {
  const memory = readAgentMemory(agentId);
  const newEntry: AgentMemoryEntry = {
    ...entry,
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
  };

  memory.entries.unshift(newEntry);

  // Keep last 50 entries to prevent unbounded growth
  if (memory.entries.length > 50) {
    memory.entries = memory.entries.slice(0, 50);
  }

  writeAgentMemory(memory);
  return newEntry;
}

/** Get recent memory context for a named agent, formatted for prompt injection */
export function getAgentMemoryContext(agentId: string, project?: string): string {
  const memory = readAgentMemory(agentId);
  if (memory.entries.length === 0) return "";

  // Filter to relevant entries — same project first, then recent cross-project
  let relevant = memory.entries;
  if (project) {
    const projectEntries = relevant.filter((e) => e.project === project);
    const otherEntries = relevant.filter((e) => e.project !== project);
    relevant = [...projectEntries.slice(0, 5), ...otherEntries.slice(0, 3)];
  } else {
    relevant = relevant.slice(0, 8);
  }

  if (relevant.length === 0) return "";

  const lines = [
    "### Your Recent Memory (from previous tasks)",
    "You are a persistent agent. Here is context from your recent work:",
    "",
  ];

  for (const entry of relevant) {
    lines.push(`**${entry.taskTitle}** (${entry.project}, ${entry.timestamp.split("T")[0]})`);
    lines.push(`  ${entry.summary}`);
    if (entry.lessons.length > 0) {
      lines.push(`  Lessons: ${entry.lessons.join("; ")}`);
    }
    if (entry.knownIssues.length > 0) {
      lines.push(`  Known issues: ${entry.knownIssues.join("; ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** List all agents that have memory files */
export function listAgentsWithMemory(): AgentMemoryFile[] {
  if (!existsSync(AGENT_MEMORY_DIR)) return [];
  const { readdirSync } = require("fs");
  const files: string[] = readdirSync(AGENT_MEMORY_DIR);
  return files
    .filter((f: string) => f.endsWith(".json"))
    .map((f: string) => {
      try {
        return JSON.parse(readFileSync(join(AGENT_MEMORY_DIR, f), "utf-8")) as AgentMemoryFile;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as AgentMemoryFile[];
}

// ─── Named Agent Routing ────────────────────────────────────────────────────

/** Tag-to-agent mapping for task routing */
const TAG_AGENT_MAP: Record<string, string> = {
  frontend: "fullstack",
  ui: "fullstack",
  component: "fullstack",
  page: "fullstack",
  css: "fullstack",
  layout: "fullstack",
  design: "fullstack",
  visual: "fullstack",
  dashboard: "fullstack",
  backend: "backend",
  api: "backend",
  database: "backend",
  infrastructure: "backend",
  "ci/cd": "backend",
  monitoring: "backend",
  reliability: "backend",
  trading: "quant",
  crypto: "t3",
  weather: "t2",
  stocks: "t1",
  options: "t1",
  research: "scout",
  intelligence: "scout",
  marketing: "quill",
  content: "quill",
  copy: "quill",
  legal: "counsel",
  compliance: "counsel",
  qa: "vigil",
  test: "vigil",
  verification: "vigil",
};

/** Project owner mapping — loaded from projects.json */
function getProjectOwner(projectId: string): string | undefined {
  try {
    const projects = JSON.parse(readFileSync(join(DATA_DIR, "projects.json"), "utf-8"));
    const project = projects.find((p: any) => p.id === projectId);
    return project?.owner;
  } catch {
    return undefined;
  }
}

/** UI task tags that trigger QA handoff to Vigil */
const UI_TAGS = new Set(["ui", "frontend", "component", "page", "visual", "design", "css", "layout", "dashboard"]);

/**
 * Resolve which named agent should handle a task.
 * Priority: explicit assignee > tag match > project owner > Henry (fallback)
 */
export function resolveAgentForTask(task: any): AgentAssignment {
  const tags: string[] = Array.isArray(task.tags) ? task.tags.map((t: string) => String(t).toLowerCase()) : [];
  const isUITask = tags.some((t) => UI_TAGS.has(t));

  // 1. Explicit assignee on the task
  if (task.assignee) {
    const agent = getAgentByAnyId(task.assignee);
    if (agent) {
      return {
        agentId: agent.id,
        reason: `Explicitly assigned to ${agent.name}`,
        needsQAHandoff: isUITask && agent.id !== "vigil",
      };
    }
  }

  // 2. Tag-based routing
  for (const tag of tags) {
    const agentId = TAG_AGENT_MAP[tag];
    if (agentId) {
      const agent = getAgentByAnyId(agentId);
      if (agent) {
        return {
          agentId: agent.id,
          reason: `Routed by tag "${tag}" → ${agent.name}`,
          needsQAHandoff: isUITask && agent.id !== "vigil",
        };
      }
    }
  }

  // 3. Project owner
  if (task.project) {
    const owner = getProjectOwner(task.project);
    if (owner) {
      const agent = getAgentByAnyId(owner);
      if (agent) {
        return {
          agentId: agent.id,
          reason: `Project "${task.project}" owner → ${agent.name}`,
          needsQAHandoff: isUITask && agent.id !== "vigil",
        };
      }
    }
  }

  // 4. Fallback to Henry
  return {
    agentId: "henry",
    reason: "No specific agent match — routed to Henry for orchestration",
    needsQAHandoff: isUITask,
  };
}

// ─── Blocker Signaling ──────────────────────────────────────────────────────

/** Patterns in build output that indicate a blocker (not a simple failure) */
const BLOCKER_PATTERNS: Array<{ pattern: RegExp; category: TaskBlocker["category"]; label: string }> = [
  { pattern: /cannot (?:test|verify|validate|confirm|check) (?:in |on )?(?:safari|webkit|ios)/i, category: "cannot-verify", label: "Cannot verify in Safari/WebKit" },
  { pattern: /cannot (?:test|verify|validate|confirm|check) (?:in |on )?(?:mobile|phone|tablet)/i, category: "cannot-verify", label: "Cannot verify on mobile" },
  { pattern: /(?:need|require|missing|waiting for|blocked by|depends on)\s+(?:api key|credentials|token|secret|access)/i, category: "needs-info", label: "Missing credentials or API key" },
  { pattern: /(?:need|require|missing|waiting for)\s+(?:design|spec|requirements|clarification|information|input)/i, category: "needs-info", label: "Missing requirements or information" },
  { pattern: /(?:tool|binary|cli|command|package)\s+(?:not found|not installed|unavailable|missing)/i, category: "missing-tool", label: "Missing tool or dependency" },
  { pattern: /(?:blocked by|waiting for|depends on|prerequisite)\s+(?:task|ticket|PR|merge|deploy)/i, category: "dependency", label: "Blocked by another task" },
  { pattern: /(?:cannot|unable to)\s+(?:connect|reach|access)\s+(?:database|server|service|endpoint)/i, category: "environment", label: "Cannot reach required service" },
  { pattern: /(?:i (?:was |am )?unable to|i (?:could not|couldn't)|i cannot)\s+(?:verify|test|confirm|validate)\s/i, category: "cannot-verify", label: "Agent unable to verify work" },
  { pattern: /BLOCKED:/i, category: "other", label: "Agent explicitly flagged blocker" },
];

/**
 * Detect if build output contains blocker signals.
 * Returns a TaskBlocker if detected, null otherwise.
 */
export function detectBlocker(output: string, agentId: string): TaskBlocker | null {
  for (const { pattern, category, label } of BLOCKER_PATTERNS) {
    const match = output.match(pattern);
    if (match) {
      // Extract surrounding context for the reason
      const matchIndex = match.index || 0;
      const start = Math.max(0, matchIndex - 50);
      const end = Math.min(output.length, matchIndex + match[0].length + 100);
      const context = output.slice(start, end).trim();

      return {
        reason: `${label}: ${context}`,
        category,
        raisedAt: new Date().toISOString(),
        raisedBy: agentId,
        notifiedHenry: false,
        resolved: false,
      };
    }
  }
  return null;
}

/**
 * Extract agent memory from build output.
 * Parses structured sections the agent may have left in its output.
 */
export function extractMemoryFromOutput(output: string): {
  summary: string;
  lessons: string[];
  knownIssues: string[];
} {
  const summary = output.slice(-500).trim();

  const lessons: string[] = [];
  const knownIssues: string[] = [];

  // Look for structured "Lessons:" or "Known Issues:" sections
  const lessonsMatch = output.match(/(?:lessons?\s*(?:learned)?|takeaways?|notes?):\s*\n((?:[-*]\s*.+\n?)+)/i);
  if (lessonsMatch) {
    const items = lessonsMatch[1].match(/[-*]\s*(.+)/g);
    if (items) {
      lessons.push(...items.map((item) => item.replace(/^[-*]\s*/, "").trim()).slice(0, 5));
    }
  }

  const issuesMatch = output.match(/(?:known\s*issues?|caveats?|remaining|warnings?):\s*\n((?:[-*]\s*.+\n?)+)/i);
  if (issuesMatch) {
    const items = issuesMatch[1].match(/[-*]\s*(.+)/g);
    if (items) {
      knownIssues.push(...items.map((item) => item.replace(/^[-*]\s*/, "").trim()).slice(0, 5));
    }
  }

  return { summary, lessons, knownIssues };
}

// ─── Agent Identity Prompt ──────────────────────────────────────────────────

/**
 * Build the agent identity block to inject into the build prompt.
 * Gives the agent its name, role, and memory context.
 */
export function buildAgentIdentityBlock(agentId: string, project?: string): string {
  const agent = getAgentByAnyId(agentId);
  if (!agent) return "";

  const memoryContext = getAgentMemoryContext(agentId, project);

  const lines = [
    "### Agent Identity",
    `You are **${agent.name}** (${agent.emoji}), ${agent.role} at Harris Autonomous.`,
    `Division: ${agent.division}`,
    "",
    agent.persona.split("\n")[0], // First paragraph of persona
    "",
    "### Accountability Rules",
    "- You are a **named, persistent agent**. Your work is tracked and you are accountable for quality.",
    "- If you CANNOT verify your own work (e.g., cannot test in Safari, missing a tool, need info), you MUST signal this clearly.",
    "- Write `BLOCKED: <reason>` if you cannot complete or verify the task. Do NOT mark as done if you can't verify.",
    "- After completing work, note any lessons learned, known issues, or caveats at the end of your output.",
    "",
  ];

  if (memoryContext) {
    lines.push(memoryContext);
  }

  return lines.join("\n");
}

/**
 * Build the QA handoff prompt for Vigil.
 * Includes what the builder did, their output, and what to verify.
 */
export function buildQAHandoffPrompt(
  task: any,
  projectName: string,
  builderAgentId: string,
  buildOutput: string,
  captures: any[],
): string {
  const builderAgent = getAgentByAnyId(builderAgentId);
  const builderName = builderAgent?.name || builderAgentId;

  const screenshotPaths = captures
    .filter((c: any) => c.relativePath || c.filePath)
    .map((c: any) => {
      const path = c.filePath || join(process.cwd(), "public", c.relativePath || "");
      return `- [${c.phase || "after"}] ${path} (captured ${c.capturedAt || "unknown"})`;
    })
    .join("\n");

  return [
    `## QA Verification: ${task.title}`,
    "",
    `**Project:** ${projectName}`,
    `**Task Type:** ${task.type || "feature"}`,
    `**Priority:** ${task.priority}`,
    `**Builder:** ${builderName} (${builderAgentId})`,
    `**Tags:** ${Array.isArray(task.tags) ? task.tags.join(", ") : "none"}`,
    "",
    buildAgentIdentityBlock("vigil", task.project),
    "",
    "### Task Description",
    task.description || task.title,
    "",
    "### What the builder did",
    `${builderName} completed this task. Their output (last 1500 chars):`,
    "```",
    buildOutput || "(no output captured)",
    "```",
    "",
    screenshotPaths ? `### Screenshots\n${screenshotPaths}\n` : "",
    "### Your QA Steps",
    "You are Vigil, the QA agent. You OWN the Definition of Done for this task.",
    "",
    "1. **Read the screenshots** if available — verify the UI matches the task description",
    "2. **Run `git log --oneline -3`** — verify commits were made with reasonable messages",
    "3. **Run `git diff HEAD~1`** — read through every change carefully",
    "4. **Run `npm run build 2>&1 | tail -80`** — build MUST pass",
    "5. **Run `npm test 2>&1 | tail -50`** — tests must pass",
    "6. **Cross-browser check** — if this is a UI task, check for Safari/WebKit issues",
    "7. **Edge cases** — empty states, error states, mobile viewports, dark mode",
    "",
    "### Verdict",
    "You must output EXACTLY one of these blocks at the very end:",
    "",
    "If the work is correct, complete, builds, and you can verify it:",
    "VERDICT: APPROVED",
    "",
    "If there are defects, build failures, or you cannot verify correctness:",
    "VERDICT: NEEDS_FIX",
    "NOTES:",
    "- [specific issue 1]",
    "- [specific issue 2]",
    "",
    "If you cannot verify the work due to missing tools, environment issues, etc.:",
    "VERDICT: BLOCKED",
    "BLOCKED: <specific reason why you cannot verify>",
    "",
    "IMPORTANT: You are the last line of defense. Only APPROVED tasks move to Done.",
    "Do NOT approve work you cannot verify. Use BLOCKED instead.",
  ].join("\n");
}
