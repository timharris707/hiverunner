/**
 * Office 3D — Agent Configuration
 *
 * Harris Autonomous — all agents from central registry
 * Office size: ~28x18 units (X: -14 to +14, Z: -9 to +9)
 *
 * Positions and desk colors are layout-specific so they live here,
 * but agent identity (name, emoji, role, division) is derived from
 * the canonical registry at src/config/agents.ts.
 */

import {
  AGENT_CONFIGS as REGISTRY,
  AGENT_MAP,
  getDisplayName,
  type AgentConfig as RegistryAgentConfig,
} from "@/config/agents";

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
  qa: '#f43f5e',
};

/** Desk positions keyed by canonical agent ID */
const DESK_POSITIONS: Record<string, { position: [number, number, number]; color: string; deskRotation?: number }> = {
  henry:    { position: [0, 0, 2],     color: '#f59e0b', deskRotation: 0 },
  t1:       { position: [-10, 0, -6],  color: '#4ade80' },
  t2:       { position: [-6, 0, -6],   color: '#34d399' },
  t3:       { position: [-10, 0, -2],  color: '#f59e0b' },
  quant:    { position: [-6, 0, -2],   color: '#86efac' },
  backend:  { position: [7, 0, -6],    color: '#60a5fa' },
  fullstack:{ position: [11, 0, -6],   color: '#93c5fd' },
  scout:    { position: [-4, 0, 2],    color: '#a78bfa' },
  quill:    { position: [10, 0, 4],    color: '#f472b6' },
  counsel:  { position: [11, 0, -2],   color: '#94a3b8' },
  gater:    { position: [4, 0, 2],     color: '#f43f5e' },
  vigil:    { position: [7, 0, 2],     color: '#fb7185' },
};

/** Default desk for any new agent not yet assigned a position */
const DEFAULT_DESK = { position: [0, 0, 6] as [number, number, number], color: '#6b7280' };

export const AGENTS: AgentConfig[] = REGISTRY.map((a) => {
  const desk = DESK_POSITIONS[a.id] ?? DEFAULT_DESK;
  return {
    id: a.id,
    name: getDisplayName(a),
    emoji: a.emoji,
    position: desk.position,
    color: desk.color,
    role: a.role,
    division: a.division,
    divisionColor: a.divisionColor,
    deskRotation: desk.deskRotation,
  };
});

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
