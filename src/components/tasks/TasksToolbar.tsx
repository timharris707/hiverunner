"use client";

import { useState, useRef, useEffect } from "react";
import { LayoutList, Columns3, Table2, Plus, Search, SlidersHorizontal, ArrowUpDown, Layers } from "lucide-react";
import { FilterPills } from "./FilterPills";
import { SURFACE, type TaskFilters, type TaskSort, type ViewMode, type GroupMode, type SortField, type SortDir } from "./types";
import { STATUS_ORDER, STATUS_LABEL, TASK_TYPES, TYPE_LABEL } from "./types";
import type { OrchestrationAgent } from "@/lib/orchestration/types";
import { STATUS_META } from "@/components/orchestration/task-display";

interface Props {
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  filters: TaskFilters;
  onFiltersChange: (f: TaskFilters) => void;
  sort: TaskSort;
  onSortChange: (s: TaskSort) => void;
  groupMode: GroupMode;
  onGroupModeChange: (g: GroupMode) => void;
  taskCount: number;
  agents: OrchestrationAgent[];
  onNewTask: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}

/* ── Popover wrapper ── */

function Popover({ label, icon: Icon, children, isActive }: {
  label: string;
  icon: React.ComponentType<{ size: number }>;
  children: React.ReactNode;
  isActive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: "inline-flex", alignItems: "center", gap: "5px",
          padding: "0 10px", height: "28px", borderRadius: "6px",
          border: "none", background: "transparent",
          fontSize: "12px", fontWeight: 500,
          color: isActive ? SURFACE.text : SURFACE.textDim,
          cursor: "pointer",
        }}
      >
        <Icon size={13} />
        {label}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", right: 0, marginTop: "4px", zIndex: 50,
          minWidth: "200px", padding: "8px", borderRadius: "8px",
          background: "#1c1917", border: `1px solid rgba(120,113,108,0.25)`,
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ── Checkbox row ── */

function CheckOption({ label, checked, onChange, color }: {
  label: string; checked: boolean; onChange: () => void; color?: string;
}) {
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: "8px", padding: "4px 6px",
      borderRadius: "4px", cursor: "pointer", fontSize: "12px", color: SURFACE.textMuted,
    }}>
      <input type="checkbox" checked={checked} onChange={onChange} style={{ accentColor: color }} />
      {color && (
        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: color, flexShrink: 0 }} />
      )}
      {label}
    </label>
  );
}

/* ── Sort option row ── */

function SortOption({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: "8px", padding: "5px 8px",
        borderRadius: "4px", background: active ? "rgba(255,255,255,0.06)" : "transparent",
        border: "none", cursor: "pointer", fontSize: "12px",
        color: active ? SURFACE.text : SURFACE.textMuted, width: "100%", textAlign: "left",
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
      {active && <span style={{ marginLeft: "auto", fontSize: "10px", color: SURFACE.textGhost }}>↓</span>}
    </button>
  );
}

/* ── Status colors (sourced from canonical STATUS_META) ── */
const STATUS_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_META).map(([k, v]) => [k, v.color])
);

/* ── Main toolbar ── */

export function TasksToolbar({
  viewMode, onViewModeChange, filters, onFiltersChange, sort, onSortChange,
  groupMode, onGroupModeChange, taskCount, agents, onNewTask, searchRef,
}: Props) {
  const setFilter = (key: keyof TaskFilters, value: string) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const clearFilter = (key: keyof TaskFilters) => {
    onFiltersChange({ ...filters, [key]: key === "query" ? "" : "all" });
  };

  const toggleStatusFilter = (status: string) => {
    setFilter("status", filters.status === status ? "all" : status);
  };

  const togglePriorityFilter = (priority: string) => {
    setFilter("priority", filters.priority === priority ? "all" : priority);
  };

  const toggleAssigneeFilter = (assignee: string) => {
    setFilter("assignee", filters.assignee === assignee ? "all" : assignee);
  };

  const handleSort = (field: SortField) => {
    onSortChange({
      field,
      dir: sort.field === field && sort.dir === "desc" ? "asc" : "desc",
    });
  };

  const viewBtnStyle = (v: ViewMode): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: "28px", height: "28px", borderRadius: "6px",
    border: viewMode === v ? `1px solid rgba(120,113,108,0.3)` : "1px solid transparent",
    background: viewMode === v ? "rgba(41,37,36,0.5)" : "transparent",
    cursor: "pointer", color: viewMode === v ? SURFACE.text : SURFACE.textFaint,
  });

  const hasActiveFilters = filters.status !== "all" || filters.priority !== "all" || filters.assignee !== "all" || filters.type !== "all" || filters.query !== "";

  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 16px", borderBottom: `1px solid ${SURFACE.line}`,
        gap: "8px", background: "rgba(12,10,9,0.8)"
      }}>
        {/* Left: New Task + Search + View toggles */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button type="button" onClick={onNewTask} style={{
            display: "inline-flex", alignItems: "center", gap: "4px",
            padding: "0 10px", height: "28px", borderRadius: "6px",
            border: `1px solid rgba(120,113,108,0.3)`, background: "rgba(41,37,36,0.5)",
            fontSize: "12px", fontWeight: 600, color: SURFACE.text, cursor: "pointer",
          }}>
            <Plus size={13} /> New Task
          </button>

          <div style={{ position: "relative", marginLeft: "4px" }}>
            <Search size={12} style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", color: SURFACE.textGhost, pointerEvents: "none" }} />
            <input
              ref={searchRef}
              value={filters.query}
              onChange={(e) => setFilter("query", e.target.value)}
              placeholder="Search tasks..."
              style={{
                height: "28px", width: "180px", borderRadius: "6px",
                border: `1px solid rgba(120,113,108,0.2)`, background: "rgba(41,37,36,0.3)",
                padding: "0 8px 0 26px", fontSize: "12px", color: SURFACE.text, outline: "none",
              }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "2px", marginLeft: "4px" }}>
            <button type="button" onClick={() => onViewModeChange("list")} style={viewBtnStyle("list")} title="List (1)">
              <LayoutList size={14} />
            </button>
            <button type="button" onClick={() => onViewModeChange("board")} style={viewBtnStyle("board")} title="Board (2)">
              <Columns3 size={14} />
            </button>
            <button type="button" onClick={() => onViewModeChange("table")} style={viewBtnStyle("table")} title="Table (3)">
              <Table2 size={14} />
            </button>
          </div>
        </div>

        {/* Right: Filter / Sort / Group buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
          <Popover label="Filter" icon={SlidersHorizontal} isActive={hasActiveFilters}>
            <div style={{ marginBottom: "8px" }}>
              <div style={{ fontSize: "10px", fontWeight: 600, color: SURFACE.textGhost, padding: "4px 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Status
              </div>
              {STATUS_ORDER.map((s) => (
                <CheckOption
                  key={s}
                  label={STATUS_LABEL[s]}
                  checked={filters.status === s}
                  onChange={() => toggleStatusFilter(s)}
                  color={STATUS_COLORS[s]}
                />
              ))}
            </div>
            <div style={{ marginBottom: "8px" }}>
              <div style={{ fontSize: "10px", fontWeight: 600, color: SURFACE.textGhost, padding: "4px 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Priority
              </div>
              {(["P0", "P1", "P2", "P3"] as const).map((p) => (
                <CheckOption
                  key={p}
                  label={{ P0: "Critical", P1: "High", P2: "Medium", P3: "Low" }[p]}
                  checked={filters.priority === p}
                  onChange={() => togglePriorityFilter(p)}
                />
              ))}
            </div>
            <div>
              <div style={{ fontSize: "10px", fontWeight: 600, color: SURFACE.textGhost, padding: "4px 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Assignee
              </div>
              <CheckOption label="Unassigned" checked={filters.assignee === ""} onChange={() => toggleAssigneeFilter("")} />
              {agents.map((a) => (
                <CheckOption key={a.id} label={a.name} checked={filters.assignee === a.name} onChange={() => toggleAssigneeFilter(a.name)} />
              ))}
            </div>
          </Popover>

          <Popover label="Sort" icon={ArrowUpDown} isActive={sort.field !== "updated"}>
            {([
              ["status", "Status"],
              ["priority", "Priority"],
              ["title", "Title"],
              ["created", "Created"],
              ["updated", "Updated"],
            ] as [SortField, string][]).map(([field, label]) => (
              <SortOption key={field} label={label} active={sort.field === field} onClick={() => handleSort(field)} />
            ))}
          </Popover>

          <Popover label="Group" icon={Layers}>
            {([
              ["status", "Status"],
              ["priority", "Priority"],
              ["assignee", "Assignee"],
              ["none", "None"],
            ] as [GroupMode, string][]).map(([mode, label]) => (
              <SortOption key={mode} label={label} active={groupMode === mode} onClick={() => onGroupModeChange(mode)} />
            ))}
          </Popover>
        </div>
      </div>

      {hasActiveFilters && <FilterPills filters={filters} onClear={clearFilter} />}
    </div>
  );
}
