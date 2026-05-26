"use client";

import { CalendarDays, Check } from "lucide-react";

import { AgentAvatarInline } from "@/components/tasks/InlineAssigneePicker";
import type { OrchestrationAgent, OrchestrationSprint } from "@/lib/orchestration/types";

const STATUS_COLORS: Record<OrchestrationSprint["status"], { color: string; bg: string }> = {
  active: { color: "var(--positive)", bg: "var(--positive-soft)" },
  planned: { color: "var(--text-muted)", bg: "var(--surface-hover)" },
  blocked: { color: "var(--negative)", bg: "var(--negative-soft)" },
  paused: { color: "var(--text-muted)", bg: "color-mix(in srgb, var(--text-muted) 14%, transparent)" },
  done: { color: "var(--text-secondary)", bg: "color-mix(in srgb, var(--text-secondary) 14%, transparent)" },
};

export function goalStatusLabel(status: OrchestrationSprint["status"]) {
  if (status === "active") return "Active";
  if (status === "blocked") return "Blocked";
  if (status === "paused") return "Paused";
  if (status === "done") return "Done";
  return "Planned";
}

export function GoalProgressBar({ value }: { value: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "block",
        width: "100%",
        height: 4,
        borderRadius: 999,
        background: "var(--surface-hover)",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          display: "block",
          width: `${Math.max(0, Math.min(100, value))}%`,
          height: "100%",
          borderRadius: 999,
          background: "var(--text-primary)",
        }}
      />
    </span>
  );
}

export function GoalStatusPill({ status }: { status: OrchestrationSprint["status"] }) {
  const sc = STATUS_COLORS[status] ?? STATUS_COLORS.planned;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: 999, color: sc.color, background: sc.bg }}>
      {status === "done" ? <Check size={11} strokeWidth={2.4} /> : null}
      {goalStatusLabel(status)}
    </span>
  );
}

function looksLikeRawIdentifier(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f-]{8,}$/i.test(value) || /^[a-z0-9_-]{20,}$/i.test(value);
}

export function findGoalOwnerAgent(owner: string | undefined, agents: OrchestrationAgent[]) {
  const normalized = owner?.trim().toLowerCase();
  if (!normalized) return undefined;
  const normalizedPrefix = normalized.replace(/[.…]+$/g, "");
  return agents.find((agent) =>
    agent.id.toLowerCase() === normalized ||
    (normalizedPrefix.length >= 8 && agent.id.toLowerCase().startsWith(normalizedPrefix)) ||
    agent.slug.toLowerCase() === normalized ||
    agent.name.toLowerCase() === normalized
  );
}

export function firstGoalOwnerName(value: string) {
  return value.trim().split(/\s+/)[0] || value;
}

export function unresolvedGoalOwnerLabel(value: string, agents: OrchestrationAgent[]) {
  if (!looksLikeRawIdentifier(value)) return firstGoalOwnerName(value);
  return agents.length === 0 ? "Loading agent" : "Unknown agent";
}

export function GoalOwnerAvatarChip({
  owner,
  agents,
  status,
}: {
  owner?: string;
  agents: OrchestrationAgent[];
  status?: OrchestrationSprint["status"];
}) {
  const ownerAgent = findGoalOwnerAgent(owner, agents);
  if (!owner && status === "done") return null;

  if (ownerAgent) {
    return (
      <span
        title={`${ownerAgent.name} - ${ownerAgent.role}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          maxWidth: 128,
          overflow: "hidden",
          border: "0.5px solid var(--border)",
          borderRadius: 999,
          background: "var(--surface-hover)",
          color: "var(--text-secondary)",
          padding: "2px 8px",
          fontSize: "11px",
          whiteSpace: "nowrap",
        }}
      >
        <AgentAvatarInline agent={ownerAgent} size={14} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{firstGoalOwnerName(ownerAgent.name)}</span>
      </span>
    );
  }

  if (owner) {
    return (
      <span title={owner} style={{ color: "var(--text-muted)", fontSize: "11px", whiteSpace: "nowrap" }}>
        {unresolvedGoalOwnerLabel(owner, agents)}
      </span>
    );
  }

  return (
    <span style={{ color: "color-mix(in srgb, var(--text-muted) 65%, transparent)", fontSize: "11px", whiteSpace: "nowrap" }}>
      Unassigned
    </span>
  );
}

export function cleanGoalDateValue(value?: string | null) {
  if (!value) return "";
  const trimmed = value.trim();
  return trimmed && trimmed.toLowerCase() !== "null" && trimmed.toLowerCase() !== "undefined" ? trimmed : "";
}

export function formatGoalShortDate(value?: string | null) {
  const dateValue = cleanGoalDateValue(value);
  if (!dateValue) return "";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export function formatGoalDateRange(startDate?: string, endDate?: string | null) {
  const start = formatGoalShortDate(startDate);
  const end = formatGoalShortDate(endDate);
  if (start && end) return `${start} - ${end}`;
  if (start) return `Starts ${start}`;
  if (end) return `Ends ${end}`;
  return "No date window";
}

export function goalDateWindowSummary(input: {
  status?: OrchestrationSprint["status"];
  startDate?: string;
  endDate?: string | null;
}): { label: string; color: string; title: string } | null {
  if (input.status === "done") return null;
  const title = formatGoalDateRange(input.startDate, input.endDate);
  const endDate = cleanGoalDateValue(input.endDate);
  if (!endDate) return { label: "Ongoing", color: "var(--text-muted)", title };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  const days = Math.round((end.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (days < 0) return { label: `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`, color: "var(--negative)", title };
  if (days === 0) return { label: "due today", color: "var(--warning)", title };
  if (days === 1) return { label: "due tomorrow", color: "var(--warning)", title };
  if (days < 14) return { label: `${days} days left`, color: "var(--text-secondary)", title };
  const weeks = Math.max(1, Math.round(days / 7));
  return { label: `${weeks} week${weeks === 1 ? "" : "s"} left`, color: "var(--text-muted)", title };
}

export function GoalDateWindowText({
  status,
  startDate,
  endDate,
}: {
  status?: OrchestrationSprint["status"];
  startDate?: string;
  endDate?: string | null;
}) {
  const summary = goalDateWindowSummary({ status, startDate, endDate });
  if (!summary) return null;
  return (
    <span title={summary.title} style={{ display: "inline-flex", alignItems: "center", gap: 4, color: summary.color, fontSize: "11px", whiteSpace: "nowrap" }}>
      <CalendarDays size={12} />
      {summary.label}
    </span>
  );
}
