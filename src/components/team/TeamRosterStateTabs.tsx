import type { AgentRosterState } from "@/lib/orchestration/types";

export type TeamRosterFilterState = Exclude<AgentRosterState, "all">;

export const TEAM_ROSTER_FILTERS: Array<{
  state: TeamRosterFilterState;
  label: string;
}> = [
  { state: "active", label: "Active" },
  { state: "bench", label: "Bench" },
  { state: "paused", label: "Paused" },
  { state: "archived", label: "Archived" },
];

type TeamRosterStateTabsProps = {
  value: TeamRosterFilterState;
  counts: Record<TeamRosterFilterState, number>;
  onChange?: (state: TeamRosterFilterState) => void;
};

export function TeamRosterStateTabs({
  value,
  counts,
  onChange,
}: TeamRosterStateTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Team roster states"
      className="inline-flex flex-wrap gap-1 rounded-lg border p-1"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      {TEAM_ROSTER_FILTERS.map((filter) => {
        const selected = filter.state === value;
        return (
          <button
            key={filter.state}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange?.(filter.state)}
            className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition"
            style={{
              color: selected ? "var(--surface)" : "var(--text-secondary)",
              background: selected ? "var(--text-primary)" : "transparent",
            }}
          >
            <span>{filter.label}</span>
            <span
              className="min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px]"
              style={{
                color: selected ? "var(--text-primary)" : "var(--text-muted)",
                background: selected ? "var(--surface)" : "var(--surface-hover)",
              }}
            >
              {counts[filter.state] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}
