"use client";

import {
  Plus,
  Loader2,
  Pause,
  Play,
  ChevronRight,
} from "lucide-react";
import type { ReviewLoopState } from "@/types/advisory";

interface ReviewLoopPanelProps {
  loop: ReviewLoopState;
  onOverride: (taskId: number, newStatus: string, notes?: string) => void;
  onAddTask: () => void;
  onAdvance: () => void;
  onPause: () => void;
  onResume: () => void;
  selectedTaskId: number | null;
  onSelectTask: (id: number | null) => void;
  newTaskText: string;
  onNewTaskTextChange: (text: string) => void;
  addingTask: boolean;
  loopAdvancing: boolean;
  onSetAutoContinue?: (val: boolean) => void;
  sessionStatus: string;
}

export default function ReviewLoopPanel({
  loop,
  onOverride,
  onAddTask,
  onAdvance,
  onPause,
  onResume,
  selectedTaskId,
  onSelectTask,
  newTaskText,
  onNewTaskTextChange,
  addingTask,
  loopAdvancing,
  onSetAutoContinue,
  sessionStatus,
}: ReviewLoopPanelProps) {
  const totalTasks = loop.tasks.length;
  const completedTasks = loop.totalApproved;
  const pct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const statusConfig: Record<string, { emoji: string; color: string; label: string }> = {
    "pending": { emoji: "\u2B1C", color: "#64748b", label: "Pending" },
    "in-progress": { emoji: "\uD83D\uDD04", color: "#60a5fa", label: "In Progress" },
    "in-review": { emoji: "\uD83D\uDC40", color: "#fbbf24", label: "Under Review" },
    "approved": { emoji: "\u2705", color: "#4ade80", label: "Approved" },
    "rejected": { emoji: "\u274C", color: "#ef4444", label: "Rejected" },
    "retrying": { emoji: "\uD83D\uDD01", color: "#fb923c", label: "Retrying" },
    "blocked": { emoji: "\u23F8\uFE0F", color: "#94a3b8", label: "Blocked" },
  };

  return (
    <div style={{
      width: "280px",
      minWidth: "220px",
      flexShrink: 0,
      borderRight: "1px solid var(--border)",
      backgroundColor: "var(--surface)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Progress header */}
      <div style={{ padding: "16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            TASK PROGRESS
          </span>
          <span style={{ fontSize: "12px", fontWeight: 700, color: pct === 100 ? "#4ade80" : "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
            {completedTasks}/{totalTasks} ({pct}%)
          </span>
        </div>
        {/* Progress bar */}
        <div style={{ width: "100%", height: "6px", borderRadius: "3px", backgroundColor: "var(--border)", overflow: "hidden" }}>
          <div style={{
            width: `${pct}%`,
            height: "100%",
            borderRadius: "3px",
            backgroundColor: pct === 100 ? "#4ade80" : "#60a5fa",
            transition: "width 300ms ease",
          }} />
        </div>
        <div style={{ display: "flex", gap: "12px", marginTop: "8px", fontSize: "10px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          <span>{loop.totalApproved} approved</span>
          <span>{loop.totalRejected} rejected</span>
          <span>{loop.tasks.filter((t) => t.status === "pending").length} remaining</span>
        </div>

        {/* Loop controls */}
        {sessionStatus === "active" && (
          <div style={{ display: "flex", gap: "6px", marginTop: "10px" }}>
            {loop.paused ? (
              <button
                onClick={onResume}
                disabled={loopAdvancing}
                style={{
                  flex: 1, padding: "6px 10px", borderRadius: "6px", border: "1px solid rgba(74,222,128,0.5)",
                  backgroundColor: "rgba(74,222,128,0.12)", color: "#4ade80", cursor: "pointer",
                  fontSize: "10px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "4px",
                }}
              >
                <Play size={10} /> Resume
              </button>
            ) : (
              <button
                onClick={onPause}
                style={{
                  flex: 1, padding: "6px 10px", borderRadius: "6px", border: "1px solid rgba(251,146,60,0.5)",
                  backgroundColor: "rgba(251,146,60,0.08)", color: "#fb923c", cursor: "pointer",
                  fontSize: "10px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "4px",
                }}
              >
                <Pause size={10} /> Pause
              </button>
            )}
            <button
              onClick={onAdvance}
              disabled={loopAdvancing}
              style={{
                flex: 1, padding: "6px 10px", borderRadius: "6px", border: "none",
                backgroundColor: "var(--accent)", color: "#fff", cursor: loopAdvancing ? "not-allowed" : "pointer",
                fontSize: "10px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "4px",
                opacity: loopAdvancing ? 0.6 : 1,
              }}
            >
              {loopAdvancing ? <Loader2 size={10} className="animate-spin" /> : <ChevronRight size={10} />}
              {loop.tasks[loop.currentTaskIndex]?.status === "rejected" ? "Retry" : "Next"}
            </button>
          </div>
        )}

        {/* Auto-continue toggle + Agent roles */}
        <div style={{ display: "flex", gap: "6px", marginTop: "8px", alignItems: "center", flexWrap: "wrap" }}>
          {onSetAutoContinue && (
            <button
              onClick={() => onSetAutoContinue(!loop.autoContinue)}
              style={{
                padding: "4px 8px", borderRadius: "4px",
                border: `1px solid ${loop.autoContinue ? "rgba(74,222,128,0.4)" : "var(--border)"}`,
                backgroundColor: loop.autoContinue ? "rgba(74,222,128,0.08)" : "transparent",
                color: loop.autoContinue ? "#4ade80" : "var(--text-muted)", cursor: "pointer",
                fontSize: "9px", fontWeight: 700, fontFamily: "var(--font-mono)",
                letterSpacing: "0.04em", transition: "all 100ms ease",
              }}
            >
              AUTO {loop.autoContinue ? "ON" : "OFF"}
            </button>
          )}
          <span style={{ fontSize: "9px", color: "#60a5fa", fontFamily: "var(--font-mono)" }}>W:{loop.workerAgent}</span>
          <span style={{ fontSize: "9px", color: "#fbbf24", fontFamily: "var(--font-mono)" }}>R:{loop.reviewerAgent}</span>
          <span style={{ fontSize: "9px", color: "#fb923c", fontFamily: "var(--font-mono)" }}>S:{loop.supervisorAgent}</span>
        </div>
      </div>

      {/* Task list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
        {loop.tasks.map((task) => {
          const sc = statusConfig[task.status] || statusConfig["pending"];
          const isSelected = selectedTaskId === task.id;
          const isCurrent = loop.tasks.indexOf(task) === loop.currentTaskIndex;

          return (
            <div
              key={task.id}
              onClick={() => onSelectTask(isSelected ? null : task.id)}
              style={{
                padding: "10px 12px",
                borderRadius: "8px",
                border: `1px solid ${isSelected ? "var(--accent)" : isCurrent ? "rgba(96,165,250,0.4)" : "transparent"}`,
                backgroundColor: isSelected ? "var(--accent-soft)" : isCurrent ? "rgba(96,165,250,0.06)" : "transparent",
                cursor: "pointer",
                marginBottom: "4px",
                transition: "all 150ms ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                <span style={{ fontSize: "14px", lineHeight: 1, flexShrink: 0, marginTop: "1px" }}>{sc.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: task.status === "approved" ? "var(--text-muted)" : "var(--text-primary)",
                    lineHeight: 1.4,
                    textDecoration: task.status === "approved" ? "line-through" : "none",
                    opacity: task.status === "approved" ? 0.7 : 1,
                  }}>
                    #{task.id} {task.description}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px", flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: "9px", fontWeight: 700, letterSpacing: "0.04em",
                      color: sc.color, backgroundColor: `${sc.color}18`, border: `1px solid ${sc.color}40`,
                      padding: "1px 6px", borderRadius: "3px", fontFamily: "var(--font-mono)",
                    }}>
                      {sc.label.toUpperCase()}
                    </span>
                    {task.attempts > 0 && (
                      <span style={{ fontSize: "9px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                        {task.attempts} attempt{task.attempts !== 1 ? "s" : ""}
                      </span>
                    )}
                    {task.overriddenBy && (
                      <span style={{ fontSize: "9px", color: "#fbbf24", fontFamily: "var(--font-mono)" }}>
                        OVERRIDDEN
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded task details */}
              {isSelected && sessionStatus === "active" && (
                <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                    {task.status !== "approved" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onOverride(task.id, "approved"); }}
                        style={{
                          padding: "4px 8px", borderRadius: "4px", border: "1px solid rgba(74,222,128,0.5)",
                          backgroundColor: "rgba(74,222,128,0.1)", color: "#4ade80", cursor: "pointer",
                          fontSize: "9px", fontWeight: 700,
                        }}
                      >
                        Approve
                      </button>
                    )}
                    {task.status !== "blocked" && task.status !== "approved" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onOverride(task.id, "blocked"); }}
                        style={{
                          padding: "4px 8px", borderRadius: "4px", border: "1px solid rgba(148,163,184,0.5)",
                          backgroundColor: "rgba(148,163,184,0.1)", color: "#94a3b8", cursor: "pointer",
                          fontSize: "9px", fontWeight: 700,
                        }}
                      >
                        Block
                      </button>
                    )}
                    {task.status === "blocked" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onOverride(task.id, "pending"); }}
                        style={{
                          padding: "4px 8px", borderRadius: "4px", border: "1px solid rgba(96,165,250,0.5)",
                          backgroundColor: "rgba(96,165,250,0.1)", color: "#60a5fa", cursor: "pointer",
                          fontSize: "9px", fontWeight: 700,
                        }}
                      >
                        Unblock
                      </button>
                    )}
                  </div>
                  {task.notes && (
                    <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "6px", fontStyle: "italic" }}>
                      {task.notes}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add task */}
      {sessionStatus === "active" && (
        <div style={{ padding: "12px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              type="text"
              value={newTaskText}
              onChange={(e) => onNewTaskTextChange(e.target.value)}
              placeholder="Add a task..."
              onKeyDown={(e) => { if (e.key === "Enter" && newTaskText.trim()) onAddTask(); }}
              style={{
                flex: 1, padding: "7px 10px", borderRadius: "6px", border: "1px solid var(--border)",
                backgroundColor: "var(--surface-elevated)", color: "var(--text-primary)",
                fontSize: "11px", outline: "none", boxSizing: "border-box",
              }}
            />
            <button
              onClick={onAddTask}
              disabled={addingTask || !newTaskText.trim()}
              style={{
                padding: "7px 12px", borderRadius: "6px", border: "none",
                backgroundColor: "var(--accent)", color: "#fff",
                cursor: addingTask || !newTaskText.trim() ? "not-allowed" : "pointer",
                fontSize: "11px", fontWeight: 700, flexShrink: 0,
                opacity: addingTask || !newTaskText.trim() ? 0.5 : 1,
                display: "flex", alignItems: "center", gap: "4px",
              }}
            >
              {addingTask ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
