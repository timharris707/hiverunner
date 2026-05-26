/**
 * agent-pipeline.ts — Types for the persistent agent pipeline.
 *
 * Named agents with memory, accountability, blocker signaling, and QA handoff.
 */

/** Blocker status — agent cannot complete the task and signals why */
export interface TaskBlocker {
  /** Why the task is blocked */
  reason: string;
  /** What category of blocker this is */
  category: "missing-tool" | "needs-info" | "cannot-verify" | "dependency" | "environment" | "other";
  /** ISO timestamp when the blocker was raised */
  raisedAt: string;
  /** Which agent raised the blocker */
  raisedBy: string;
  /** Whether the lead/coordinator has been notified */
  notifiedLead: boolean;
  /** Whether the blocker has been resolved */
  resolved: boolean;
  /** Resolution notes (if resolved) */
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNotes?: string;
}

/** A single memory entry for a named agent */
export interface AgentMemoryEntry {
  id: string;
  /** What the agent worked on */
  taskId: string;
  taskTitle: string;
  project: string;
  /** What the agent learned or built */
  summary: string;
  /** Lessons learned, gotchas, or context for future tasks */
  lessons: string[];
  /** Known issues the agent discovered but didn't fix */
  knownIssues: string[];
  /** ISO timestamp */
  timestamp: string;
}

/** Per-agent persistent memory file structure */
export interface AgentMemoryFile {
  agentId: string;
  agentName: string;
  role: string;
  /** Running list of what this agent has built and learned */
  entries: AgentMemoryEntry[];
  /** Last updated timestamp */
  lastUpdated: string;
}

/** QA handoff record — tracks builder → Vigil handoff */
export interface QAHandoff {
  /** Task being handed off */
  taskId: string;
  /** Builder agent that completed the work */
  builderAgent: string;
  /** QA agent receiving the handoff (usually vigil) */
  qaAgent: string;
  /** What the builder did (summary) */
  builderSummary: string;
  /** When the handoff occurred */
  handoffAt: string;
  /** QA verdict */
  verdict?: "approved" | "rejected" | "blocked";
  /** QA notes if rejected */
  rejectionNotes?: string;
  /** When QA completed */
  completedAt?: string;
}

/** Agent assignment resolution — which agent should handle a task */
export interface AgentAssignment {
  /** Resolved agent ID */
  agentId: string;
  /** How the agent was selected */
  reason: string;
  /** Whether this task needs QA handoff after completion */
  needsQAHandoff: boolean;
}
