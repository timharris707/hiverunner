"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { TaskRow } from "./TaskRow";
import { type TaskRow as TaskRowT, type TaskGroup, type InlineEditCallbacks, getActiveRunLabel } from "./types";
import type { OrchestrationAgent } from "@/lib/orchestration/types";
import { P } from "@/lib/ui/tokens";

interface Props {
  groups: TaskGroup[];
  agents: OrchestrationAgent[];
  agentMap: Map<string, OrchestrationAgent>;
  callbacks: InlineEditCallbacks;
  selectedIndex: number;
  onSelect: (index: number) => void;
  buildHref: (task: TaskRowT) => string;
  onContextMenu: (e: React.MouseEvent, task: TaskRowT) => void;
}

export function TaskListView({
  groups, agents, agentMap, callbacks, selectedIndex, onSelect,
  buildHref, onContextMenu,
}: Props) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const childrenMap = useMemo(() => {
    const map = new Map<string, TaskRowT[]>();
    for (const group of groups) {
      for (const task of group.items) {
        if (task.parentTaskId) {
          const arr = map.get(task.parentTaskId) ?? [];
          arr.push(task);
          map.set(task.parentTaskId, arr);
        }
      }
    }
    return map;
  }, [groups]);

  let globalIndex = 0;

  const renderTask = (task: TaskRowT, depth: number) => {
    const children = childrenMap.get(task.id);
    const childCount = children?.length ?? 0;
    const isExpanded = expandedParents[task.id] ?? false;
    const activeLabel = getActiveRunLabel(task, agentMap);
    const myIndex = globalIndex++;

    return (
      <div key={task.id}>
        <TaskRow
          task={task}
          href={buildHref(task)}
          agents={agents}
          callbacks={callbacks}
          isSelected={selectedIndex === myIndex}
          onContextMenu={onContextMenu}
          onClick={() => onSelect(myIndex)}
          depth={depth}
          childCount={childCount}
          expanded={isExpanded}
          onToggleExpand={() => setExpandedParents((prev) => ({ ...prev, [task.id]: !prev[task.id] }))}
          hasActiveRun={!!activeLabel}
          activeAgentName={activeLabel}
        />
        {isExpanded && children?.map((child) => renderTask(child, depth + 1))}
      </div>
    );
  };

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      {groups.map((group) => (
        <div key={group.key}>
          {group.label !== null && (
            <div style={{
              padding: "4px 16px", display: "flex", alignItems: "center", gap: "8px"
            }}>
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "8px",
                  background: "transparent", border: 0, padding: "2px 4px", cursor: "pointer",
                  borderRadius: "4px"
                }}
              >
                {collapsedGroups[group.key]
                  ? <ChevronRight size={12} color={P.textMuted} />
                  : <ChevronDown size={12} color={P.textMuted} />
                }
                <span style={{ fontSize: "11px", fontWeight: 600, color: P.textSecondary, textTransform: "uppercase", letterSpacing: "0.02em" }}>{group.label}</span>
                <span style={{ fontSize: "11px", color: P.textMuted }}>({group.items.filter(t => !t.parentTaskId).length})</span>
              </button>
            </div>
          )}
          {!collapsedGroups[group.key] && group.items
            .filter((t) => !t.parentTaskId)
            .map((task) => renderTask(task, 0))
          }
        </div>
      ))}
    </div>
  );
}
