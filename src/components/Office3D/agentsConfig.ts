/**
 * Office 3D — Agent Configuration
 *
 * Harris Autonomous — 11 agents, 5 divisions
 * Office size: ~28x18 units (X: -14 to +14, Z: -9 to +9)
 */

export interface AgentConfig {
  id: string;
  name: string;
  emoji: string;
  position: [number, number, number]; // x, y, z — desk anchor position
  color: string;
  role: string;
  division: string;
  divisionColor: string;
  deskRotation?: number; // Y rotation in radians for the desk
}

// Division color palette
export const DIVISION_COLORS = {
  leadership: '#f59e0b',
  trading: '#4ade80',
  engineering: '#60a5fa',
  research: '#a78bfa',
  creative: '#f472b6',
  legal: '#94a3b8',
};

export const AGENTS: AgentConfig[] = [
  // ── Henry — Chief of Staff (center-front, orchestrator) ──────────────────
  {
    id: 'henry',
    name: 'Henry',
    emoji: '⚡',
    position: [0, 0, 2],           // Center-front, prominent
    color: '#f59e0b',
    role: 'Chief of Staff',
    division: 'Leadership',
    divisionColor: DIVISION_COLORS.leadership,
    deskRotation: 0,
  },

  // ── Trading Desk (left section, back) ────────────────────────────────────
  {
    id: 't1',
    name: 'Atlas',
    emoji: '📈',
    position: [-10, 0, -6],
    color: '#4ade80',
    role: 'Stocks & Options',
    division: 'Trading',
    divisionColor: DIVISION_COLORS.trading,
  },
  {
    id: 't2',
    name: 'Nimbus',
    emoji: '🌤️',
    position: [-6, 0, -6],
    color: '#34d399',
    role: 'Weather Trading',
    division: 'Trading',
    divisionColor: DIVISION_COLORS.trading,
  },
  {
    id: 't3',
    name: 'Cipher',
    emoji: '₿',
    position: [-10, 0, -2],
    color: '#f59e0b',
    role: 'Crypto Bot',
    division: 'Trading',
    divisionColor: DIVISION_COLORS.trading,
  },
  {
    id: 'quant',
    name: 'Quant',
    emoji: '📊',
    position: [-6, 0, -2],
    color: '#86efac',
    role: 'Strategy Architect',
    division: 'Trading',
    divisionColor: DIVISION_COLORS.trading,
  },

  // ── Engineering (right section, back) ────────────────────────────────────
  {
    id: 'backend',
    name: 'Forge',
    emoji: '🔧',
    position: [7, 0, -6],
    color: '#60a5fa',
    role: 'Infrastructure',
    division: 'Engineering',
    divisionColor: DIVISION_COLORS.engineering,
  },
  {
    id: 'fullstack',
    name: 'Pixel',
    emoji: '💻',
    position: [11, 0, -6],
    color: '#93c5fd',
    role: 'Web Apps',
    division: 'Engineering',
    divisionColor: DIVISION_COLORS.engineering,
  },

  // ── Research (center-left, near whiteboard) ───────────────────────────────
  {
    id: 'scout',
    name: 'Scout',
    emoji: '🔭',
    position: [-4, 0, 2],
    color: '#a78bfa',
    role: 'Research & Intel',
    division: 'Research',
    divisionColor: DIVISION_COLORS.research,
  },

  // ── Creative (right, near plants) ────────────────────────────────────────
  {
    id: 'quill',
    name: 'Quill',
    emoji: '✍️',
    position: [10, 0, 4],
    color: '#f472b6',
    role: 'Creative Writer',
    division: 'Creative',
    divisionColor: DIVISION_COLORS.creative,
  },

  // ── Legal (far right corner) ──────────────────────────────────────────────
  {
    id: 'counsel',
    name: 'Counsel',
    emoji: '⚖️',
    position: [11, 0, -2],
    color: '#94a3b8',
    role: 'Legal Expert',
    division: 'Legal',
    divisionColor: DIVISION_COLORS.legal,
  },
];

export type AgentStatus = 'idle' | 'working' | 'thinking' | 'error';

export type IdleBehavior =
  | 'sit'           // Sitting at desk, working
  | 'watercooler'   // Standing by water cooler
  | 'whiteboard'    // Pacing near whiteboard
  | 'wander'        // Wandering between areas
  | 'coffee';       // Standing by coffee machine

export interface AgentState {
  id: string;
  status: AgentStatus;
  currentTask?: string;
  model?: string;
  tokensPerHour?: number;
  tasksInQueue?: number;
  uptime?: number;
  idleBehavior?: IdleBehavior;
}

// Well-known positions for special furniture areas
export const OFFICE_AREAS = {
  waterCooler: [-12, 0, 4] as [number, number, number],
  coffeeMachine: [13, 0, -6] as [number, number, number],
  whiteboard: [0, 0, -9] as [number, number, number],
  // wandering: random, handled in MovingAvatar
};
