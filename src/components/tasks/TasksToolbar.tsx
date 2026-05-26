"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { LayoutList, Columns3, Table2, Search, Filter, ArrowUpDown, Layers, Eye } from "lucide-react";
import { FilterPills } from "./FilterPills";
import { type TaskFilters, type TaskSort, type ViewMode, type GroupMode, type SortField } from "./types";
import { BOARD_COLUMNS, STATUS_ORDER, STATUS_LABEL, UNASSIGNED_PROJECT_FILTER_ID } from "./types";
import type { OrchestrationAgent, OrchestrationProject, TaskPriority, TaskStatus } from "@/lib/orchestration/types";
import { STATUS_META, PRIORITY_META } from "@/components/orchestration/task-display";
import { PriorityBars } from "@/components/orchestration/PriorityBars";
import { StatusCircle } from "@/components/orchestration/StatusCircle";
import { P, radius } from "@/lib/ui/tokens";

interface Props {
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  filters: TaskFilters;
  onFiltersChange: (f: TaskFilters) => void;
  sort: TaskSort;
  onSortChange: (s: TaskSort) => void;
  groupMode: GroupMode;
  onGroupModeChange: (g: GroupMode) => void;
  boardStatuses: TaskStatus[];
  onBoardStatusesChange: (statuses: TaskStatus[]) => void;
  boardProjectIds: string[];
  onBoardProjectIdsChange: (projectIds: string[]) => void;
  agents: OrchestrationAgent[];
  projects: OrchestrationProject[];
  searchRef: React.RefObject<HTMLInputElement | null>;
}

/* ── Popover wrapper ── */

function Popover({ label, icon: Icon, children, isActive }: {
  label: React.ReactNode;
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
          display: "inline-flex", alignItems: "center", gap: "6px",
          padding: "0 10px", height: "34px", borderRadius: radius.md,
          border: `0.5px solid ${P.cardBorder}`, background: "transparent",
          fontSize: "13px", fontWeight: 500,
          color: isActive ? P.text : P.textSecondary,
          cursor: "pointer",
        }}
      >
        <Icon size={13} />
        {label}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", right: 0, marginTop: "4px", zIndex: 50,
          minWidth: "200px", padding: "8px", borderRadius: radius.md,
          background: P.surfaceElevated, border: `1px solid ${P.cardBorder}`,
          boxShadow: "0 16px 36px rgba(0,0,0,0.35)",
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ── Checkbox row ── */

function CheckOption({ label, checked, onChange, color, leading }: {
  label: string; checked: boolean; onChange: () => void; color?: string; leading?: React.ReactNode;
}) {
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: "8px", padding: "4px 6px",
      borderRadius: radius.sm, cursor: "pointer", fontSize: "12px", color: P.textSecondary,
    }}>
      <input type="checkbox" checked={checked} onChange={onChange} style={{ accentColor: color }} />
      {leading ?? (color ? (
        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: color, flexShrink: 0 }} />
      ) : null)}
      {label}
    </label>
  );
}

/* ── Sort option row ── */

function SortOption({
  label,
  active,
  onClick,
  disabled = false,
  title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled}
      aria-checked={active}
      title={title}
      style={{
        display: "flex", alignItems: "center", gap: "8px", padding: "5px 8px",
        borderRadius: radius.sm, background: active ? "rgba(255,255,255,0.06)" : "transparent",
        border: "none", cursor: disabled ? "not-allowed" : "pointer", fontSize: "12px",
        color: active ? P.text : P.textSecondary, width: "100%", textAlign: "left",
        fontWeight: active ? 600 : 400,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
      {active && <span style={{ marginLeft: "auto", fontSize: "10px", color: P.textMuted }}>↓</span>}
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
  groupMode, onGroupModeChange, boardStatuses, onBoardStatusesChange, boardProjectIds,
  onBoardProjectIdsChange, agents, projects, searchRef,
}: Props) {
  const setFilter = (key: "query" | "type", value: string) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const clearFilter = (key: keyof TaskFilters) => {
    if (key === "query") onFiltersChange({ ...filters, query: "" });
    else if (key === "type") onFiltersChange({ ...filters, type: "all" });
    else onFiltersChange({ ...filters, [key]: [] });
  };

  const toggleStatusFilter = (status: TaskStatus) => {
    const selected = filters.status.includes(status);
    onFiltersChange({
      ...filters,
      status: selected ? filters.status.filter((item) => item !== status) : [...filters.status, status],
    });
  };

  const togglePriorityFilter = (priority: TaskPriority) => {
    const selected = filters.priority.includes(priority);
    onFiltersChange({
      ...filters,
      priority: selected ? filters.priority.filter((item) => item !== priority) : [...filters.priority, priority],
    });
  };

  const toggleAssigneeFilter = (assignee: string) => {
    const selected = filters.assignee.includes(assignee);
    onFiltersChange({
      ...filters,
      assignee: selected ? filters.assignee.filter((item) => item !== assignee) : [...filters.assignee, assignee],
    });
  };

  const toggleBoardStatus = (status: TaskStatus) => {
    const selected = boardStatuses.includes(status);
    const next = selected ? boardStatuses.filter((item) => item !== status) : [...boardStatuses, status];
    if (next.length === 0) return;
    onBoardStatusesChange(BOARD_COLUMNS.filter((item) => next.includes(item)));
  };

  const projectIds = projects.map((project) => project.id);
  const boardProjectFilterIds = [...projectIds, UNASSIGNED_PROJECT_FILTER_ID];
  const selectedBoardProjectIds = boardProjectIds.length > 0
    ? boardProjectFilterIds.filter((id) => boardProjectIds.includes(id))
    : boardProjectFilterIds;

  const toggleBoardProject = (projectId: string) => {
    const current = boardProjectIds.length > 0 ? selectedBoardProjectIds : boardProjectFilterIds;
    const selected = current.includes(projectId);
    const next = selected ? current.filter((id) => id !== projectId) : [...current, projectId];
    if (next.length === 0) return;
    onBoardProjectIdsChange(boardProjectFilterIds.filter((id) => next.includes(id)));
  };

  const handleSort = (field: SortField) => {
    onSortChange({
      field,
      dir: sort.field === field && sort.dir === "desc" ? "asc" : "desc",
    });
  };

  const viewBtnStyle = (v: ViewMode): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: "34px", height: "34px", borderRadius: radius.md,
    border: viewMode === v ? `0.5px solid ${P.cardBorderHover}` : "0.5px solid transparent",
    background: viewMode === v ? "rgba(255,255,255,0.08)" : "transparent",
    cursor: "pointer", color: viewMode === v ? P.text : P.textMuted,
  });

  const hasActiveFilters = filters.status.length > 0 || filters.priority.length > 0 || filters.assignee.length > 0 || filters.type !== "all" || filters.query !== "";
  const hasCustomBoardSections = boardStatuses.length !== BOARD_COLUMNS.length || BOARD_COLUMNS.some((status) => !boardStatuses.includes(status));
  const hasCustomBoardProjects = selectedBoardProjectIds.length !== boardProjectFilterIds.length;
  const hasCustomBoardView = hasCustomBoardSections || hasCustomBoardProjects;
  const groupLabels: Record<GroupMode, string> = {
    none: "None",
    status: "Status",
    priority: "Priority",
    assignee: "Assignee",
    project: "Project",
    sprint: "Sprint",
    "company-goal": "Company goal",
  };
  const groupButtonLabel = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0 }}>
      <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>Group: </span>
      <span style={{ color: "var(--text-primary)", fontWeight: 650, whiteSpace: "nowrap" }}>{groupLabels[groupMode]}</span>
    </span>
  );

  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 20px", borderBottom: `0.5px solid ${P.cardBorder}`,
        gap: "12px", background: "transparent"
      }}>
        {/* Left: Search */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0, flex: 1 }}>
          <div style={{ position: "relative", minWidth: 200, flex: "0 1 280px" }}>
            <Search size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: P.textMuted, pointerEvents: "none" }} />
            <input
              ref={searchRef}
              value={filters.query}
              onChange={(e) => setFilter("query", e.target.value)}
              placeholder="Search tasks..."
              style={{
                width: "100%", height: "34px", borderRadius: radius.md,
                border: `0.5px solid ${P.cardBorder}`, background: "transparent",
                padding: "0 12px 0 32px", fontSize: "13px", color: P.text, outline: "none",
              }}
            />
          </div>
        </div>

        {/* Right: View toggles + Filter / Sort / Group */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
          <div style={{
            display: "inline-flex", alignItems: "center",
            borderRadius: radius.md, border: `0.5px solid ${P.cardBorder}`,
          }}>
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
          <Popover label="Filters" icon={Filter} isActive={hasActiveFilters}>
            <div style={{ marginBottom: "8px" }}>
              <div style={{ fontSize: "10px", fontWeight: 600, color: P.textMuted, padding: "4px 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Status
              </div>
              {STATUS_ORDER.map((s) => (
                <CheckOption
                  key={s}
                  label={STATUS_LABEL[s]}
                  checked={filters.status.includes(s)}
                  onChange={() => toggleStatusFilter(s)}
                  color={STATUS_COLORS[s]}
                  leading={<StatusCircle status={s} size={13} />}
                />
              ))}
            </div>
            <div style={{ marginBottom: "8px" }}>
              <div style={{ fontSize: "10px", fontWeight: 600, color: P.textMuted, padding: "4px 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Priority
              </div>
              {(["P0", "P1", "P2", "P3"] as const).map((p) => {
                const meta = PRIORITY_META[p];
                return (
                  <label key={p} style={{
                    display: "flex", alignItems: "center", gap: "8px", padding: "4px 6px",
                    borderRadius: radius.sm, cursor: "pointer", fontSize: "12px", color: P.textSecondary,
                  }}>
                    <input type="checkbox" checked={filters.priority.includes(p)} onChange={() => togglePriorityFilter(p)} style={{ accentColor: meta.color }} />
                    <PriorityBars priority={p} size={15} />
                    {meta.label}
                  </label>
                );
              })}
            </div>
            <div>
              <div style={{ fontSize: "10px", fontWeight: 600, color: P.textMuted, padding: "4px 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Assignee
              </div>
              <CheckOption label="Unassigned" checked={filters.assignee.includes("")} onChange={() => toggleAssigneeFilter("")} />
              {agents.map((a) => {
                const avatarSrc = a.avatar;
                return (
                  <label key={a.id} style={{
                    display: "flex", alignItems: "center", gap: "8px", padding: "4px 6px",
                    borderRadius: radius.sm, cursor: "pointer", fontSize: "12px", color: P.textSecondary,
                  }}>
                    <input type="checkbox" checked={filters.assignee.includes(a.name)} onChange={() => toggleAssigneeFilter(a.name)} />
                    {avatarSrc ? (
                      <Image src={avatarSrc} alt={a.name} width={18} height={18} unoptimized style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                    ) : (
                      <span style={{ width: 18, height: 18, borderRadius: "50%", background: "rgba(255,255,255,0.06)", border: `1px solid rgba(120,113,108,0.25)`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: P.textSecondary, flexShrink: 0 }}>
                        {a.name?.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    {a.name}
                  </label>
                );
              })}
            </div>
          </Popover>

          <Popover label="View" icon={Eye} isActive={hasCustomBoardView}>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: "10px", fontWeight: 600, color: P.textMuted, padding: "4px 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Status
              </div>
              {BOARD_COLUMNS.map((s) => (
                <CheckOption
                  key={s}
                  label={STATUS_LABEL[s]}
                  checked={boardStatuses.includes(s)}
                  onChange={() => toggleBoardStatus(s)}
                  color={STATUS_COLORS[s]}
                  leading={<StatusCircle status={s} size={13} />}
                />
              ))}
            </div>
            {boardProjectFilterIds.length > 0 ? (
              <div style={{ marginBottom: 8, borderTop: `0.5px solid ${P.cardBorder}`, paddingTop: 8 }}>
                <div style={{ fontSize: "10px", fontWeight: 600, color: P.textMuted, padding: "4px 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Projects
                </div>
                <CheckOption
                  label="Unassigned"
                  checked={selectedBoardProjectIds.includes(UNASSIGNED_PROJECT_FILTER_ID)}
                  onChange={() => toggleBoardProject(UNASSIGNED_PROJECT_FILTER_ID)}
                  color={P.textMuted}
                />
                {projects.map((project) => (
                  <CheckOption
                    key={project.id}
                    label={project.name}
                    checked={selectedBoardProjectIds.includes(project.id)}
                    onChange={() => toggleBoardProject(project.id)}
                    color={project.color}
                  />
                ))}
              </div>
            ) : null}
            <div style={{ display: "grid", gap: 6, borderTop: `0.5px solid ${P.cardBorder}`, paddingTop: 8 }}>
              <button
                type="button"
                onClick={() => {
                  onBoardStatusesChange(BOARD_COLUMNS);
                  onBoardProjectIdsChange([]);
                }}
                style={{
                  height: 28,
                  borderRadius: radius.sm,
                  border: `0.5px solid ${P.cardBorder}`,
                  background: "transparent",
                  color: P.textSecondary,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Show all
              </button>
              <button
                type="button"
                onClick={() => onBoardStatusesChange(["to-do", "review", "done"])}
                style={{
                  height: 28,
                  borderRadius: radius.sm,
                  border: `0.5px solid ${P.cardBorder}`,
                  background: hasCustomBoardSections ? "rgba(255,255,255,0.06)" : "transparent",
                  color: P.textSecondary,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                To-Do, In Review, Done
              </button>
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

          <Popover label={groupButtonLabel} icon={Layers}>
            {([
              ["none", "None"],
              ["status", "Status"],
              ["priority", "Priority"],
              ["assignee", "Assignee"],
              ["sprint", "Sprint"],
              ["company-goal", "Company goal"],
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
