"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { Search, UserPlus, Users } from "lucide-react";

import { AgentAvatarInline } from "@/components/tasks/InlineAssigneePicker";
import { listCompanyAgents } from "@/lib/orchestration/client";
import { buildCanonicalNewAgentPath, buildCanonicalTeamPath } from "@/lib/orchestration/route-paths";
import type { OrchestrationAgent } from "@/lib/orchestration/types";
import { color, radius, space, type as tokenType } from "@/lib/ui/tokens";

export type ScopedCrewAgent = OrchestrationAgent & {
  rosterState: NonNullable<OrchestrationAgent["rosterState"]>;
};

type AddState = {
  kind: "success" | "error";
  agentId: string;
  message: string;
} | null;

type Props = {
  companySlug: string;
  companyCode: string;
  scopeLabel: string;
  activeAgents?: OrchestrationAgent[];
  activeAgentReferences?: Array<string | null | undefined>;
  roster?: OrchestrationAgent[];
  maxActive?: number;
  fallbackToActiveRoster?: boolean;
  compact?: boolean;
  onAddAgent?: (agent: OrchestrationAgent) => Promise<void> | void;
  addDisabledReason?: string;
  defaultBenchOpen?: boolean;
  initialBenchQuery?: string;
};

export function agentRosterState(agent: OrchestrationAgent): ScopedCrewAgent["rosterState"] {
  if (agent.archivedAt) return "archived";
  return agent.rosterState ?? (agent.status === "paused" ? "paused" : "active");
}

function normalizeReference(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function matchesAgentReference(agent: OrchestrationAgent, value: string): boolean {
  const normalized = normalizeReference(value);
  if (!normalized) return false;
  return (
    agent.id.toLowerCase() === normalized ||
    agent.name.toLowerCase() === normalized ||
    agent.slug.toLowerCase() === normalized
  );
}

export function resolveScopedActiveCrew({
  roster,
  activeAgents = [],
  activeAgentReferences = [],
  maxActive = 5,
  fallbackToActiveRoster = true,
}: {
  roster: OrchestrationAgent[];
  activeAgents?: OrchestrationAgent[];
  activeAgentReferences?: Array<string | null | undefined>;
  maxActive?: number;
  fallbackToActiveRoster?: boolean;
}): ScopedCrewAgent[] {
  const resolved = new Map<string, ScopedCrewAgent>();
  const normalizedRoster = roster.map((agent) => ({ ...agent, rosterState: agentRosterState(agent) }));
  const normalizedReferences = activeAgentReferences
    .map((reference) => normalizeReference(reference))
    .filter(Boolean);
  const hasScopedReferences = normalizedReferences.length > 0;

  for (const agent of activeAgents) {
    const enriched = { ...agent, rosterState: agentRosterState(agent) };
    if (hasScopedReferences && !normalizedReferences.some((reference) => matchesAgentReference(enriched, reference))) {
      continue;
    }
    if (!hasScopedReferences && enriched.rosterState !== "active") {
      continue;
    }
    resolved.set(enriched.id, enriched);
  }

  for (const normalized of normalizedReferences) {
    const match = normalizedRoster.find((agent) => matchesAgentReference(agent, normalized));
    if (match) resolved.set(match.id, match);
  }

  if (resolved.size === 0 && fallbackToActiveRoster) {
    for (const agent of normalizedRoster.filter((agent) => agent.rosterState === "active")) {
      resolved.set(agent.id, agent);
    }
  }

  return Array.from(resolved.values())
    .filter((agent) => agent.rosterState !== "archived")
    .sort((a, b) => stateWeight(a.rosterState) - stateWeight(b.rosterState) || a.name.localeCompare(b.name))
    .slice(0, maxActive);
}

export function filterBenchAgents(roster: OrchestrationAgent[], query: string): ScopedCrewAgent[] {
  const needle = query.trim().toLowerCase();
  return roster
    .map((agent) => ({ ...agent, rosterState: agentRosterState(agent) }))
    .filter((agent) => agent.rosterState === "bench")
    .filter((agent) => {
      if (!needle) return true;
      return `${agent.name} ${agent.role} ${agent.slug}`.toLowerCase().includes(needle);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function stateWeight(state: ScopedCrewAgent["rosterState"]): number {
  if (state === "active") return 0;
  if (state === "bench") return 1;
  if (state === "paused") return 2;
  return 3;
}

function rosterStateLabel(state: ScopedCrewAgent["rosterState"]): string {
  if (state === "bench") return "Bench";
  if (state === "paused") return "Paused";
  if (state === "archived") return "Archived";
  return "Crew";
}

function rosterStateTone(state: ScopedCrewAgent["rosterState"]): { fg: string; bg: string; border: string } {
  if (state === "bench") return { fg: color.accent, bg: color.accentSoft, border: "color-mix(in srgb, var(--accent) 35%, var(--border))" };
  if (state === "paused") return { fg: color.warning, bg: color.warningSoft, border: "color-mix(in srgb, var(--warning) 35%, var(--border))" };
  if (state === "archived") return { fg: color.textMuted, bg: color.surfaceHover, border: color.border };
  return { fg: color.positive, bg: color.positiveSoft, border: "color-mix(in srgb, var(--positive) 35%, var(--border))" };
}

export function ScopedActiveCrewPanel({
  companySlug,
  companyCode,
  scopeLabel,
  activeAgents,
  activeAgentReferences = [],
  roster,
  maxActive = 5,
  fallbackToActiveRoster = false,
  compact = false,
  onAddAgent,
  addDisabledReason,
  defaultBenchOpen = false,
  initialBenchQuery = "",
}: Props) {
  const [loadedRoster, setLoadedRoster] = useState<OrchestrationAgent[]>(roster ?? []);
  const [benchOpen, setBenchOpen] = useState(defaultBenchOpen);
  const [benchQuery, setBenchQuery] = useState(initialBenchQuery);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addState, setAddState] = useState<AddState>(null);

  useEffect(() => {
    if (roster) {
      setLoadedRoster(roster);
      return;
    }
    let cancelled = false;
    void listCompanyAgents(companySlug, { rosterState: "all" })
      .then((agents) => {
        if (!cancelled) setLoadedRoster(agents);
      })
      .catch(() => {
        if (!cancelled) setLoadedRoster([]);
      });
    return () => {
      cancelled = true;
    };
  }, [companySlug, roster]);

  const normalizedRoster = useMemo(() => loadedRoster.map((agent) => ({ ...agent, rosterState: agentRosterState(agent) })), [loadedRoster]);
  const activeCrew = useMemo(
    () => resolveScopedActiveCrew({ roster: normalizedRoster, activeAgents, activeAgentReferences, maxActive, fallbackToActiveRoster }),
    [activeAgentReferences, activeAgents, fallbackToActiveRoster, maxActive, normalizedRoster]
  );
  const benchAgents = useMemo(() => filterBenchAgents(normalizedRoster, benchQuery).slice(0, 8), [benchQuery, normalizedRoster]);
  const benchCount = normalizedRoster.filter((agent) => agent.rosterState === "bench").length;
  const teamHref = buildCanonicalTeamPath(companyCode);
  const newAgentHref = buildCanonicalNewAgentPath(companyCode);

  const addAgent = async (agent: OrchestrationAgent) => {
    if (!onAddAgent || addingId) return;
    setAddingId(agent.id);
    setAddState(null);
    try {
      await onAddAgent(agent);
      setAddState({
        kind: "success",
        agentId: agent.id,
        message: `Added ${agent.name} to this work.`,
      });
    } catch (error) {
      setAddState({
        kind: "error",
        agentId: agent.id,
        message: error instanceof Error ? error.message : `Could not add ${agent.name} to this work.`,
      });
    } finally {
      setAddingId(null);
    }
  };

  return (
    <section
      aria-label={`${scopeLabel} assigned crew`}
      data-testid="scoped-active-crew"
      style={{
        border: `0.5px solid ${color.border}`,
        borderRadius: radius.md,
        background: color.surface,
        padding: compact ? space.md : space.lg,
        display: "grid",
        gap: compact ? space.sm : space.md,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: space.md, minWidth: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, color: color.textMuted, fontSize: tokenType.caption.size, fontWeight: 700, letterSpacing: 0 }}>
            <Users size={13} />
            Assigned Crew
          </div>
          <h2 style={{ margin: "3px 0 0", color: color.text, fontSize: compact ? tokenType.cardTitle.size : 15, fontWeight: 700, lineHeight: 1.25, letterSpacing: 0 }}>
            {scopeLabel}
          </h2>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Link
            href={teamHref}
            style={linkButtonStyle}
          >
            Team
          </Link>
          <button
            type="button"
            aria-expanded={benchOpen}
            onClick={() => setBenchOpen((value) => !value)}
            style={linkButtonStyle}
          >
            Bench {benchCount}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, minWidth: 0 }}>
        {activeCrew.length === 0 ? (
          <span style={{ color: color.textMuted, fontSize: tokenType.bodySmall.size }}>No assigned crew yet.</span>
        ) : activeCrew.map((agent) => (
          <AgentCrewChip key={agent.id} agent={agent} />
        ))}
      </div>

      {benchOpen ? (
        <div
          data-testid="bench-discovery"
          style={{
            display: "grid",
            gap: space.sm,
            borderTop: `0.5px solid ${color.border}`,
            paddingTop: space.md,
          }}
        >
          <div style={{ position: "relative", minWidth: 0 }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: color.textMuted, pointerEvents: "none" }} />
            <input
              value={benchQuery}
              onChange={(event) => setBenchQuery(event.target.value)}
              placeholder="Search Bench"
              aria-label="Search Bench"
              style={{
                width: "100%",
                height: 34,
                borderRadius: radius.md,
                border: `0.5px solid ${color.border}`,
                background: "transparent",
                color: color.text,
                padding: "0 10px 0 30px",
                fontSize: tokenType.bodySmall.size,
                outline: "none",
              }}
            />
          </div>

          {benchAgents.length > 0 ? (
            <div style={{ display: "grid", gap: 6 }}>
              {benchAgents.map((agent) => (
                <BenchAgentRow
                  key={agent.id}
                  agent={agent}
                  adding={addingId === agent.id}
                  added={addState?.agentId === agent.id}
                  onAdd={onAddAgent && !addDisabledReason ? () => void addAgent(agent) : undefined}
                  disabledReason={addDisabledReason}
                />
              ))}
            </div>
          ) : (
            <div style={{ border: `0.5px dashed ${color.border}`, borderRadius: radius.md, padding: space.md, color: color.textMuted, fontSize: tokenType.bodySmall.size }}>
              No Bench agents match this search.
            </div>
          )}

          {addState ? (
            <div
              role="status"
              style={{
                color: addState.kind === "success" ? color.positive : color.negative,
                fontSize: tokenType.caption.size,
              }}
            >
              {addState.message}
            </div>
          ) : null}

          <Link href={newAgentHref} style={{ ...linkButtonStyle, justifySelf: "start" }}>
            <UserPlus size={13} />
            New agent
          </Link>
        </div>
      ) : null}
    </section>
  );
}

function AgentCrewChip({ agent }: { agent: ScopedCrewAgent }) {
  const tone = rosterStateTone(agent.rosterState);
  return (
    <span
      title={`${agent.name} - ${agent.role}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        minWidth: 0,
        maxWidth: 260,
        border: `0.5px solid ${tone.border}`,
        borderRadius: radius.full,
        background: tone.bg,
        color: color.text,
        padding: "4px 8px",
      }}
    >
      <AgentAvatarInline agent={agent} size={18} />
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: tokenType.bodySmall.size, fontWeight: 650 }}>
        {agent.name}
      </span>
      <span style={{ color: tone.fg, fontSize: 10, fontWeight: 760 }}>
        {rosterStateLabel(agent.rosterState)}
      </span>
    </span>
  );
}

function BenchAgentRow({
  agent,
  adding,
  added,
  onAdd,
  disabledReason,
}: {
  agent: ScopedCrewAgent;
  adding: boolean;
  added: boolean;
  onAdd?: () => void;
  disabledReason?: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "center",
        gap: space.sm,
        border: `0.5px solid ${color.border}`,
        borderRadius: radius.md,
        background: color.surfaceHover,
        padding: "8px 9px",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <AgentAvatarInline agent={agent} size={22} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: color.text, fontSize: tokenType.bodySmall.size, fontWeight: 700 }}>
            {agent.name}
          </span>
          <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: color.textMuted, fontSize: tokenType.caption.size }}>
            {agent.role}
          </span>
        </span>
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={!onAdd || adding || added}
        aria-label={disabledReason ?? `Add ${agent.name} to this work`}
        title={disabledReason ?? `Add ${agent.name} to this work`}
        style={{
          height: 28,
          borderRadius: radius.sm,
          border: `0.5px solid ${added ? color.positive : color.border}`,
          background: added ? color.positiveSoft : "transparent",
          color: added ? color.positive : onAdd ? color.text : color.textMuted,
          fontSize: tokenType.caption.size,
          fontWeight: 700,
          padding: "0 9px",
          cursor: onAdd && !adding && !added ? "pointer" : "default",
          whiteSpace: "nowrap",
        }}
      >
        {added ? "Added" : adding ? "Adding..." : "Add"}
      </button>
    </div>
  );
}

const linkButtonStyle: CSSProperties = {
  minHeight: 28,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  borderRadius: radius.sm,
  border: `0.5px solid ${color.border}`,
  background: "transparent",
  color: color.textSecondary,
  padding: "0 9px",
  fontSize: tokenType.caption.size,
  fontWeight: 700,
  textDecoration: "none",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
