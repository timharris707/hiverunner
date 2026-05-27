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
import { getAgentByAnyId, AGENT_MD_FILENAMES, TAG_AGENT_MAP, BUILDER_AGENT_IDS, type AgentConfig } from "@/config/agents";
import { buildVisualQAChecklist } from "@/lib/visual-qa";
import { PUBLIC_COMPANY_LABEL } from "@/lib/public-identity";
import { agentDisplayLabel } from "@/lib/orchestration/avatar-icons";
import type {
  AgentMemoryFile,
  AgentMemoryEntry,
  AgentAssignment,
  TaskBlocker,
} from "@/types/agent-pipeline";

const DATA_DIR = join(process.cwd(), "data");
const AGENT_MEMORY_DIR = join(DATA_DIR, "agent-memory");
const AGENT_MEMORY_MD_DIR = join(process.cwd(), "memory", "agents");

// Ensure agent memory directories exist
mkdirSync(AGENT_MEMORY_DIR, { recursive: true });

function getAgentMdPath(agentId: string): string {
  const filename = AGENT_MD_FILENAMES[agentId] || agentId;
  return join(AGENT_MEMORY_MD_DIR, `${filename}.md`);
}

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

  // Also append to the markdown memory file for human-readable history
  try {
    appendAgentMarkdownMemory(agentId, {
      taskTitle: entry.taskTitle,
      project: entry.project,
      summary: entry.summary,
      lessons: entry.lessons,
      knownIssues: entry.knownIssues,
    });
  } catch {
    // Non-critical — JSON memory already saved, markdown append is best-effort
  }

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

// ─── Markdown Agent Memory ───────────────────────────────────────────────────

/**
 * Read the agent's markdown memory file (memory/agents/{name}.md).
 * Returns the full markdown content, or empty string if the file doesn't exist.
 */
export function readAgentMarkdownMemory(agentId: string): string {
  const filePath = getAgentMdPath(agentId);
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Extract only the "Standing Knowledge" section from the markdown memory file.
 * Used for prompt injection — keeps context concise without including the full task log.
 */
export function getAgentMarkdownKnowledge(agentId: string): string {
  const content = readAgentMarkdownMemory(agentId);
  if (!content) return "";

  const startMarker = "## Standing Knowledge";
  const endMarker = "## Task Log";

  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) return "";

  const endIdx = content.indexOf(endMarker);
  const knowledge = endIdx !== -1
    ? content.slice(startIdx, endIdx).trim()
    : content.slice(startIdx).trim();

  return knowledge;
}

/**
 * Extract the last N task log entries from the markdown memory file.
 * Returns formatted markdown lines for recent task history.
 */
export function getAgentMarkdownRecentTasks(agentId: string, maxEntries = 3): string {
  const content = readAgentMarkdownMemory(agentId);
  if (!content) return "";

  const taskLogMarker = "## Task Log";
  const taskLogIdx = content.indexOf(taskLogMarker);
  if (taskLogIdx === -1) return "";

  const taskLogContent = content.slice(taskLogIdx + taskLogMarker.length).trim();
  if (!taskLogContent || taskLogContent.startsWith("<!--")) return "";

  // Split by "---" dividers to get individual entries
  const entries = taskLogContent
    .split(/\n---\n/)
    .map((e) => e.trim())
    .filter((e) => e && !e.startsWith("<!--") && e.startsWith("###"));

  if (entries.length === 0) return "";

  const recent = entries.slice(0, maxEntries);
  return `### Recent Task History (from memory file)\n\n${recent.join("\n\n---\n\n")}`;
}

/**
 * Append a completed task entry to the agent's markdown memory file.
 * Inserts after "## Task Log" so newest entries appear at the top of the log.
 */
export function appendAgentMarkdownMemory(
  agentId: string,
  entry: {
    taskTitle: string;
    project: string;
    summary: string;
    lessons: string[];
    knownIssues: string[];
  },
): void {
  const filePath = getAgentMdPath(agentId);
  if (!existsSync(filePath)) return;

  const existing = readFileSync(filePath, "utf-8");
  const date = new Date().toISOString().split("T")[0];

  const lines: string[] = [
    "",
    `### ${date} — ${entry.taskTitle}`,
    `**Project:** ${entry.project}`,
    `**Summary:** ${entry.summary.slice(0, 400).replace(/\n/g, " ")}`,
  ];

  if (entry.lessons.length > 0) {
    lines.push("**Lessons:**");
    entry.lessons.forEach((l) => lines.push(`- ${l}`));
  }

  if (entry.knownIssues.length > 0) {
    lines.push("**Known Issues:**");
    entry.knownIssues.forEach((i) => lines.push(`- ${i}`));
  }

  lines.push("");
  lines.push("---");

  // Insert new entry directly after the "## Task Log" header line
  const taskLogMarker = "## Task Log";
  const markerIdx = existing.indexOf(taskLogMarker);
  if (markerIdx !== -1) {
    const afterMarker = existing.indexOf("\n", markerIdx) + 1;
    const newContent = existing.slice(0, afterMarker) + lines.join("\n") + "\n" + existing.slice(afterMarker);
    writeFileSync(filePath, newContent);
  } else {
    // No Task Log section — append at end
    writeFileSync(filePath, existing.trimEnd() + "\n\n## Task Log\n" + lines.join("\n") + "\n");
  }
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

/** Tag-to-agent mapping — derived from central agent registry (imported above) */

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

/** Builder agents whose work always routes through Vigil QA — derived from central registry */
const BUILDER_AGENTS = BUILDER_AGENT_IDS;

/**
 * Resolve which named agent should handle a task.
 * Priority: explicit assignee > tag match > project owner > default orchestrator.
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
        needsQAHandoff: (isUITask || BUILDER_AGENTS.has(agent.id)) && agent.id !== "vigil",
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
          needsQAHandoff: (isUITask || BUILDER_AGENTS.has(agent.id)) && agent.id !== "vigil",
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
          needsQAHandoff: (isUITask || BUILDER_AGENTS.has(agent.id)) && agent.id !== "vigil",
        };
      }
    }
  }

  // 4. Default orchestrator fallback.
  return {
    agentId: "coordinator",
    reason: "No specific agent match — routed to the default orchestrator",
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
      const matchIndex = match.index || 0;

      // For explicit BLOCKED: signals, extract the text after the colon as the reason
      if (/^BLOCKED:/i.test(match[0])) {
        const afterColon = output.slice(matchIndex + match[0].length);
        const reasonLine = afterColon.match(/^\s*(.+?)(?:\n|$)/);
        const reason = reasonLine ? reasonLine[1].trim() : label;
        return {
          reason,
          category,
          raisedAt: new Date().toISOString(),
          raisedBy: agentId,
          notifiedLead: false,
          resolved: false,
        };
      }

      // For pattern-matched blockers, extract surrounding context
      const start = Math.max(0, matchIndex - 50);
      const end = Math.min(output.length, matchIndex + match[0].length + 100);
      const context = output.slice(start, end).trim();

      return {
        reason: `${label}: ${context}`,
        category,
        raisedAt: new Date().toISOString(),
        raisedBy: agentId,
        notifiedLead: false,
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
  const markdownKnowledge = getAgentMarkdownKnowledge(agentId);
  const recentTaskHistory = getAgentMarkdownRecentTasks(agentId, 3);

  const lines = [
    "### Agent Identity",
    `You are **${agentDisplayLabel(agent.emoji, agent.name)}**, ${agent.role} for the ${PUBLIC_COMPANY_LABEL}.`,
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

  if (markdownKnowledge) {
    lines.push(markdownKnowledge);
    lines.push("");
  }

  if (recentTaskHistory) {
    lines.push(recentTaskHistory);
    lines.push("");
  }

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
  const tags: string[] = Array.isArray(task.tags) ? task.tags.map((t: string) => String(t).toLowerCase()) : [];
  const isUITask = tags.some((t) => ["ui", "frontend", "component", "page", "visual", "design", "css", "layout", "dashboard"].includes(t));

  const screenshotPaths = captures
    .filter((c: any) => c.relativePath || c.filePath)
    .map((c: any) => {
      const path = c.filePath || join(process.cwd(), "public", c.relativePath || "");
      return `- [${c.phase || "after"}] ${path} (captured ${c.capturedAt || "unknown"})`;
    })
    .join("\n");

  const qaSteps = [
    "### Your QA Steps",
    "You are Vigil, the QA agent. You OWN the Definition of Done for this task.",
    "",
  ];

  let stepNum = 1;
  if (isUITask && screenshotPaths) {
    qaSteps.push(`${stepNum++}. **Read the screenshots** — verify the UI matches the task description`);
  }
  qaSteps.push(`${stepNum++}. **Run \`git log --oneline -3\`** — verify commits were made with reasonable messages`);
  qaSteps.push(`${stepNum++}. **Run \`git diff HEAD~1\`** — read through every change carefully`);
  qaSteps.push(`${stepNum++}. **Run \`npm run build 2>&1 | tail -80\`** — build MUST pass`);
  qaSteps.push(`${stepNum++}. **Run \`npm test 2>&1 | tail -50\`** — note any test failures`);
  if (isUITask) {
    qaSteps.push(`${stepNum++}. **Cross-browser check** — check for Safari/WebKit compatibility issues`);
    qaSteps.push(`${stepNum++}. **Edge cases** — empty states, error states, mobile viewports, dark mode`);
  } else {
    qaSteps.push(`${stepNum++}. **Correctness check** — does the implementation actually satisfy the task requirements?`);
    qaSteps.push(`${stepNum++}. **Reliability** — are error paths handled? Any obvious failure modes?`);
  }

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
    ...(Array.isArray(task.acceptance_criteria) && task.acceptance_criteria.length > 0
      ? [
          "### Acceptance Criteria",
          "These are the verify-that statements this task MUST satisfy to be approved:",
          ...task.acceptance_criteria.map((c: string) => `- ${c}`),
          "",
          "You MUST verify each criterion above. Do not approve if any are unmet.",
          "",
        ]
      : []),
    "### What the builder did",
    `${builderName} completed this task. Their output (last 1500 chars):`,
    "```",
    buildOutput || "(no output captured)",
    "```",
    "",
    screenshotPaths ? `### Screenshots\n${screenshotPaths}\n` : "",
    ...qaSteps,
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

/**
 * Build the Gater QA review prompt.
 * Gater is the final gate-keeper: build verification, dual-browser screenshots,
 * code diff review, and approve/reject with structured comments.
 */
export function buildGaterReviewPrompt(
  task: any,
  projectName: string,
  buildOutput: string,
  captures: any[],
): string {
  const tags: string[] = Array.isArray(task.tags) ? task.tags.map((t: string) => String(t).toLowerCase()) : [];
  const isUITask = tags.some((t) => ["ui", "frontend", "component", "page", "visual", "design", "css", "layout", "dashboard"].includes(t));

  const screenshotPaths = captures
    .filter((c: any) => c.relativePath || c.filePath)
    .map((c: any) => {
      const path = c.filePath || join(process.cwd(), "public", c.relativePath || "");
      return `- [${c.phase || "after"}] ${path} (captured ${c.capturedAt || "unknown"})`;
    })
    .join("\n");

  const qaSteps = [
    "### Your QA Steps",
    "You are Gater, the final QA gate-keeper. Nothing ships without your sign-off.",
    "",
  ];

  let stepNum = 1;
  qaSteps.push(`${stepNum++}. **Run \`npm run build 2>&1 | tail -80\`** — build MUST pass. Failure = automatic REJECT.`);
  qaSteps.push(`${stepNum++}. **Run \`npm test 2>&1 | tail -50\`** — run tests if they exist. New failures = REJECT.`);
  qaSteps.push(`${stepNum++}. **Run \`git log --oneline -5\`** — verify commits exist with reasonable messages.`);
  qaSteps.push(`${stepNum++}. **Run \`git diff HEAD~1\`** — read every change. Check for:`);
  qaSteps.push(`   - Broken imports, missing dependencies, syntax errors`);
  qaSteps.push(`   - Incomplete implementations (TODO, placeholder, hardcoded stubs)`);
  qaSteps.push(`   - Does the diff actually address the task description?`);
  if (isUITask && screenshotPaths) {
    qaSteps.push(`${stepNum++}. **Read the pre-captured screenshots** — verify the UI matches the task description.`);
  }
  if (isUITask) {
    qaSteps.push(`${stepNum++}. **MANDATORY: Complete the Visual QA Checklist below** — every UI task REQUIRES Playwright screenshot verification.`);
    qaSteps.push(`   If you cannot capture screenshots or verify the UI visually, you MUST issue VERDICT: BLOCKED.`);
    qaSteps.push(`   Do NOT approve a UI task without completing visual verification.`);
  }
  if (Array.isArray(task.acceptance_criteria) && task.acceptance_criteria.length > 0) {
    qaSteps.push(`${stepNum++}. **Acceptance criteria** — verify EACH criterion below is actually satisfied. Any unmet = REJECT.`);
  }
  qaSteps.push(`${stepNum++}. **Final judgement** — is this change safe to ship? Any regressions, security issues, or obvious failure modes?`);

  return [
    `## Gater QA Review: ${task.title}`,
    "",
    `**Project:** ${projectName}`,
    `**Task Type:** ${task.type || "feature"}`,
    `**Priority:** ${task.priority}`,
    `**Tags:** ${Array.isArray(task.tags) ? task.tags.join(", ") : "none"}`,
    "",
    buildAgentIdentityBlock("gater", task.project),
    "",
    "### Task Description",
    task.description || task.title,
    "",
    ...(Array.isArray(task.acceptance_criteria) && task.acceptance_criteria.length > 0
      ? [
          "### Acceptance Criteria",
          "These verify-that statements MUST all be satisfied for the task to pass:",
          ...task.acceptance_criteria.map((c: string) => `- ${c}`),
          "",
          "You MUST verify each criterion above. Do not approve if any are unmet.",
          "",
        ]
      : []),
    "### Build Output (last 1500 chars)",
    "```",
    buildOutput || "(no output captured)",
    "```",
    "",
    screenshotPaths ? `### Screenshots\n${screenshotPaths}\n` : "",
    ...(isUITask ? [buildVisualQAChecklist(), ""] : []),
    ...qaSteps,
    "",
    "### Verdict",
    "Output EXACTLY one of these blocks at the very end of your response — nothing after it:",
    "",
    ...(isUITask
      ? [
          "⚠️ UI TASK GATE: You MUST have completed the Visual QA Checklist above before issuing a verdict.",
          "If you could not capture and review screenshots, you MUST use VERDICT: BLOCKED.",
          "",
        ]
      : []),
    "If the work is correct, complete, builds clean, and all acceptance criteria met:",
    "VERDICT: APPROVED",
    "",
    "If there are defects, build failures, unmet acceptance criteria, or missing requirements:",
    "VERDICT: NEEDS_FIX",
    "NOTES:",
    "- [specific issue 1]",
    "- [specific issue 2]",
    "",
    "If you cannot verify the work due to missing tools, environment issues, etc.:",
    "VERDICT: BLOCKED",
    "BLOCKED: <specific reason why you cannot verify>",
    "",
    "IMPORTANT: You are the FINAL gate. Only APPROVED tasks move to Done.",
    "Only flag real defects — not style nits or theoretical improvements.",
    "But DO reject if: build fails, tests break, imports missing, acceptance criteria unmet, or task description not addressed.",
  ].join("\n");
}
