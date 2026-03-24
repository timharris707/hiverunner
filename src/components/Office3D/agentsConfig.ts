/**
 * Office 3D — Agent Configuration
 *
 * Harris Autonomous — 9 agents, 5 divisions
 */

export interface AgentConfig {
  id: string;
  name: string;
  emoji: string;
  position: [number, number, number]; // x, y, z
  color: string;
  role: string;
}

export const AGENTS: AgentConfig[] = [
  // Henry — Chief of Staff (center, prominent)
  {
    id: "henry",
    name: "Henry",
    emoji: "⚡",
    position: [0, 0, 0],
    color: "#f59e0b",
    role: "Chief of Staff",
  },
  // Trading Desk
  {
    id: "t1",
    name: "T1",
    emoji: "📈",
    position: [-5, 0, -4],
    color: "#4ade80",
    role: "Stocks & Options",
  },
  {
    id: "t2",
    name: "T2",
    emoji: "🌩️",
    position: [0, 0, -4],
    color: "#60a5fa",
    role: "Weather Trading",
  },
  {
    id: "t3",
    name: "T3",
    emoji: "₿",
    position: [5, 0, -4],
    color: "#f59e0b",
    role: "Crypto Bot",
  },
  // Engineering
  {
    id: "backend",
    name: "Backend",
    emoji: "🔧",
    position: [-5, 0, 4],
    color: "#60a5fa",
    role: "Infrastructure",
  },
  {
    id: "fullstack",
    name: "Full-Stack",
    emoji: "💻",
    position: [0, 0, 4],
    color: "#60a5fa",
    role: "Web Apps",
  },
  // Research
  {
    id: "scout",
    name: "Scout",
    emoji: "🔭",
    position: [5, 0, 4],
    color: "#a78bfa",
    role: "Research & Intel",
  },
  // Creative
  {
    id: "quill",
    name: "Quill",
    emoji: "✍️",
    position: [-5, 0, 0],
    color: "#f472b6",
    role: "Creative Writer",
  },
  // Legal
  {
    id: "counsel",
    name: "Counsel",
    emoji: "⚖️",
    position: [5, 0, 0],
    color: "#94a3b8",
    role: "Legal Expert",
  },
];

export type AgentStatus = "idle" | "working" | "thinking" | "error";

export interface AgentState {
  id: string;
  status: AgentStatus;
  currentTask?: string;
  model?: string;
  tokensPerHour?: number;
  tasksInQueue?: number;
  uptime?: number;
}
