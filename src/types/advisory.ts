// ─── Advisory Board Types ────────────────────────────────────────────────────

export interface AdvisoryEvent {
  id: string;
  timestamp: string;
  type: string;
  speaker: string;
  emoji: string;
  role: "worker" | "supervisor" | "reviewer";
  text: string;
  verdict?: string;
  model?: string;
  error?: boolean;
}

export interface ActionItem {
  description: string;
  assignedAgent: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "done";
}

export interface DetailedActionItem {
  id: string;
  title: string;
  description: string;
  assignedAgent: string;
  suggestedDeadline: string;
  priority: "high" | "medium" | "low";
  source: string;
  status: "pending" | "pushed" | "skipped";
}

export interface SessionInsights {
  actionItems: ActionItem[];
  keyDecisions: string[];
  openQuestions: string[];
  risksIdentified: string[];
  extractedAt: string;
}

export interface AdvisorySession {
  id: string;
  topic: string;
  title?: string;
  mode: "review" | "roundtable";
  agents: string[];
  status: "active" | "completed" | "abandoned";
  createdAt: string;
  completedAt?: string;
  outcome?: string;
  reviewStyle?: string;
  model?: string;
  pacing?: string;
  paused?: boolean;
  eventCount?: number;
  lastEvent?: AdvisoryEvent | null;
  events?: AdvisoryEvent[];
  lastError?: string;
  insights?: SessionInsights | null;
  referenceContext?: string;
  reviewLoop?: ReviewLoopState | null;
  agentModelOverrides?: Record<string, string>;
  agentPersonalityTraits?: Record<string, string[]>;
  agentCommunicationStyles?: Record<string, string>;
  agentIntensityLevels?: Record<string, number>;
}

export interface ReviewTaskState {
  id: number;
  description: string;
  status: "pending" | "in-progress" | "in-review" | "approved" | "rejected" | "retrying" | "blocked";
  attempts: number;
  notes: string;
  overriddenBy: string | null;
  workerOutput?: string;
  reviewerFeedback?: string;
}

export interface ReviewLoopState {
  tasks: ReviewTaskState[];
  currentTaskIndex: number;
  workerAgent: string;
  reviewerAgent: string;
  supervisorAgent: string;
  supervisorInterval: number;
  totalApproved: number;
  totalRejected: number;
  autoContinue: boolean;
  paused: boolean;
  maxRetries: number;
}

export interface CustomAgent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  persona: string;
  division: string;
  createdAt: string;
}

export interface SessionTemplate {
  id: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  mode: "review" | "roundtable";
  agents: string[];
  responseLength: "concise" | "balanced" | "detailed" | "verbose";
  rounds: number;
  topic?: string;
}

export interface AgentDef {
  id: string;
  emoji: string;
  role: string;
  defaultRole: string;
}

export interface PersonaOverlay {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  relevantAgents: string[];
}

export interface ModelOption {
  id: string;
  label: string;
  desc: string;
}

export interface PacingOption {
  id: string;
  label: string;
  desc: string;
}
