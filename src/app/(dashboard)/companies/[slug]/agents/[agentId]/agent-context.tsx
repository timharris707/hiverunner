"use client";

import { createContext, useContext } from "react";

import type { OrchestrationAgentProfile } from "@/lib/orchestration/types";
import { P as tokens } from "@/lib/ui/tokens";

export const A = {
  accent: tokens.accent,
  accentLight: "#f59e0b",
  accentDark: "#b45309",
  surface: tokens.bg,
  card: tokens.surface,
  cardBorder: tokens.cardBorder,
  cardBorderHover: tokens.cardBorderHover,
  muted: tokens.muted,
  text: tokens.text,
  textSec: tokens.textSec,
};

interface AgentContextValue {
  profile: OrchestrationAgentProfile;
  slug: string;
  companyCode: string;
  agentId: string;
  reload: () => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProfileProvider({
  value,
  children,
}: {
  value: AgentContextValue;
  children: React.ReactNode;
}) {
  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgentProfile() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgentProfile must be used within agent layout");
  return ctx;
}
