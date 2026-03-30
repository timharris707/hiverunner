"use client";

import { useState, useEffect, useRef } from "react";
import {
  Plus,
  Loader2,
  Pause,
  Play,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  SkipForward,
  Square,
  Zap,
} from "lucide-react";
import type { ReviewLoopState } from "@/types/advisory";

interface ReviewLoopPanelProps {
  loop: ReviewLoopState;
  onOverride: (taskId: number, newStatus: string, notes?: string) => void;
  onAddTask: () => void;
  onAdvance: () => void;
  onPause: () => void;
  onResume: () => void;
  onStartLoop?: () => void;
  onStopLoop?: () => void;
  onSkipTask?: () => void;
  selectedTaskId: number | null;
  onSelectTask: (id: number | null) => void;
  newTaskText: string;
  onNewTaskTextChange: (text: string) => void;
  addingTask: boolean;
  loopAdvancing: boolean;
  onSetAutoContinue?: (val: boolean) => void;
  sessionStatus: string;
  loopStarted?: boolean;
}

export default function ReviewLoopPanel({
  loop,
  onOverride,
  onAddTask,
  onAdvance,
  onPause,
  onResume,
  onStartLoop,
  onStopLoop,
  onSkipTask,
  selectedTaskId,
  onSelectTask,
  newTaskText,
  onNewTaskTextChange,
  addingTask,
  loopAdvancing,
  onSetAutoContinue,
  sessionStatus,
  loopStarted,
}: ReviewLoopPanelProps) {
  const [tasksCollapsed, setTasksCollapsed] = useState(false);
  const [stopConfirm, setStopConfirm] = useState(false);
  const [autoCountdown, setAutoCountdown] = useState<number | null>(null);
  const currentTaskRef = useRef<HTMLDivElement>(null);
  const taskListRef = useRef<HTMLDivElement>(null);

  const totalTasks = loop.tasks.length;
  const completedTasks = loop.totalApproved;
  const pct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const currentTask = loop.tasks[loop.currentTaskIndex] ?? null;

  // Determine current phase from task status
  const getPhaseLabel = () => {
    if (!currentTask) return "Complete";
    switch (currentTask.status) {
      case "in-progress": return "Worker";
      case "in-review": return "Reviewer";
      case "retrying": return "Worker (Retry)";
      case "rejected": return "Awaiting Retry";
      case "approved": return "Done";
      case "blocked": return "Blocked";
      default: return "Queued";
    }
  };

  const getPhaseColor = () => {
    if (!currentTask) return "#4ade80";
    switch (currentTask.status) {
      case "in-progress": return "#60a5fa";
      case "in-review": return "#fbbf24";
      case "retrying": return "#fb923c";
      case "rejected": return "#ef4444";
      case "approved": return "#4ade80";
      case "blocked": return "#94a3b8";
      default: return "#64748b";
    }
  };

  const isRunning = sessionStatus === "active" && loopStarted && !loop.paused;
  const isActive = sessionStatus === "active";

  // Auto-scroll to current task
  useEffect(() => {
    if (currentTaskRef.current && taskListRef.current) {
      currentTaskRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [loop.currentTaskIndex]);

  // Auto-continue countdown
  useEffect(() => {
    if (!loop.autoContinue || loop.paused || !loopStarted) {
      setAutoCountdown(null);
      return;
    }
    // Show countdown when current task is approved and there are more tasks
    if (currentTask && currentTask.status === "pending" && loop.currentTaskIndex > 0) {
      setAutoCountdown(3);
      const interval = setInterval(() => {
        setAutoCountdown((prev) => {
          if (prev === null || prev <= 1) {
            clearInterval(interval);
            return null;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setAutoCountdown(null);
    }
  }, [loop.autoContinue, loop.paused, loopStarted, currentTask, loop.currentTaskIndex]);

  const statusConfig: Record<string, { emoji: string; color: string; label: string }> = {
    "pending": { emoji: "\u2B1C", color: "#64748b", label: "Pending" },
    "in-progress": { emoji: "\uD83D\uDD04", color: "#60a5fa", label: "Working" },
    "in-review": { emoji: "\uD83D\uDC40", color: "#fbbf24", label: "Reviewing" },
    "approved": { emoji: "\u2705", color: "#4ade80", label: "Approved" },
    "rejected": { emoji: "\u274C", color: "#ef4444", label: "Rejected" },
    "retrying": { emoji: "\uD83D\uDD01", color: "#fb923c", label: "Retrying" },
    "blocked": { emoji: "\u23F8\uFE0F", color: "#94a3b8", label: "Blocked" },
  };

  return (
    <div style={{
      width: "300px",
      minWidth: "240px",
      flexShrink: 0,
      borderRight: "1px solid var(--border)",
      backgroundColor: "var(--surface)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>

      {/* ── Persistent Status Bar ── */}
      <div style={{
        padding: "12px 16px",
        borderBottom: "1px solid var(--border)",
        background: isRunning
          ? "linear-gradient(135deg, rgba(96,165,250,0.08), rgba(139,92,246,0.06))"
          : pct === 100
            ? "rgba(74,222,128,0.06)"
            : "var(--surface)",
        flexShrink: 0,
      }}>
        {/* Phase indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
          {isRunning && (
            <span style={{
              width: "8px", height: "8px", borderRadius: "50%",
              backgroundColor: getPhaseColor(),
              boxShadow: `0 0 6px ${getPhaseColor()}`,
              animation: "pulse 1.5s ease-in-out infinite",
              flexShrink: 0,
            }} />
          )}
          <span style={{
            fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em",
            color: getPhaseColor(),
            fontFamily: "var(--font-mono)",
            textTransform: "uppercase",
          }}>
            {loopStarted ? getPhaseLabel() : "Ready"}
          </span>
          <span style={{
            marginLeft: "auto",
            fontSize: "12px", fontWeight: 700,
            color: pct === 100 ? "#4ade80" : "var(--text-primary)",
            fontFamily: "var(--font-mono)",
          }}>
            {completedTasks}/{totalTasks}
          </span>
        </div>

        {/* Current task name */}
        {currentTask && loopStarted && (
          <div style={{
            fontSize: "11px", fontWeight: 600,
            color: "var(--text-primary)",
            marginBottom: "8px",
            lineHeight: 1.4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            #{currentTask.id}: {currentTask.description}
          </div>
        )}

        {/* Progress bar */}
        <div style={{
          width: "100%", height: "6px", borderRadius: "3px",
          backgroundColor: "var(--border)", overflow: "hidden",
        }}>
          <div style={{
            width: `${pct}%`,
            height: "100%",
            borderRadius: "3px",
            backgroundColor: pct === 100 ? "#4ade80" : "#60a5fa",
            transition: "width 500ms ease",
          }} />
        </div>

        {/* Stats row */}
        <div style={{
          display: "flex", gap: "12px", marginTop: "6px",
          fontSize: "10px", color: "var(--text-muted)", fontFamily: "var(--font-mono)",
        }}>
          <span>{loop.totalApproved} approved</span>
          <span>{loop.totalRejected} rejected</span>
          <span>{loop.tasks.filter((t) => t.status === "pending").length} remaining</span>
        </div>

        {/* Auto-continue countdown */}
        {autoCountdown !== null && (
          <div style={{
            marginTop: "8px", padding: "4px 8px",
            borderRadius: "4px",
            backgroundColor: "rgba(96,165,250,0.1)",
            border: "1px solid rgba(96,165,250,0.25)",
            fontSize: "10px", fontWeight: 600,
            color: "#60a5fa", fontFamily: "var(--font-mono)",
            textAlign: "center",
          }}>
            Auto-advancing in {autoCountdown}s...
          </div>
        )}

        {/* Agent roles */}
        <div style={{
          display: "flex", gap: "8px", marginTop: "8px",
          alignItems: "center", flexWrap: "wrap",
        }}>
          <span style={{ fontSize: "9px", color: "#60a5fa", fontFamily: "var(--font-mono)" }}>
            W:{loop.workerAgent}
          </span>
          <span style={{ fontSize: "9px", color: "#fbbf24", fontFamily: "var(--font-mono)" }}>
            R:{loop.reviewerAgent}
          </span>
          <span style={{ fontSize: "9px", color: "#fb923c", fontFamily: "var(--font-mono)" }}>
            S:{loop.supervisorAgent}
          </span>
        </div>
      </div>

      {/* ── Action Buttons ── */}
      {isActive && (
        <div style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          flexShrink: 0,
        }}>
          {/* Primary row */}
          <div style={{ display: "flex", gap: "6px" }}>
            {!loopStarted ? (
              /* Start Loop button */
              <button
                onClick={onStartLoop}
                disabled={loopAdvancing}
                style={{
                  flex: 1, padding: "8px 12px", borderRadius: "7px", border: "none",
                  backgroundColor: "#22c55e", color: "#fff", cursor: loopAdvancing ? "not-allowed" : "pointer",
                  fontSize: "12px", fontWeight: 700, display: "flex", alignItems: "center",
                  justifyContent: "center", gap: "6px",
                  fontFamily: "var(--font-heading)",
                  opacity: loopAdvancing ? 0.6 : 1,
                  transition: "all 150ms ease",
                }}
              >
                {loopAdvancing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                Start Loop
              </button>
            ) : loop.paused ? (
              /* Resume button */
              <button
                onClick={onResume}
                disabled={loopAdvancing}
                style={{
                  flex: 1, padding: "8px 12px", borderRadius: "7px", border: "none",
                  backgroundColor: "#22c55e", color: "#fff",
                  cursor: loopAdvancing ? "not-allowed" : "pointer",
                  fontSize: "12px", fontWeight: 700, display: "flex", alignItems: "center",
                  justifyContent: "center", gap: "6px",
                  fontFamily: "var(--font-heading)",
                  opacity: loopAdvancing ? 0.6 : 1,
                  transition: "all 150ms ease",
                }}
              >
                {loopAdvancing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                Resume
              </button>
            ) : (
              /* Pause button */
              <button
                onClick={onPause}
                style={{
                  flex: 1, padding: "8px 12px", borderRadius: "7px", border: "none",
                  backgroundColor: "#eab308", color: "#000",
                  cursor: "pointer",
                  fontSize: "12px", fontWeight: 700, display: "flex", alignItems: "center",
                  justifyContent: "center", gap: "6px",
                  fontFamily: "var(--font-heading)",
                  transition: "all 150ms ease",
                }}
              >
                <Pause size={14} /> Pause
              </button>
            )}

            {/* Next / Skip */}
            {loopStarted && (
              <>
                <button
                  onClick={onAdvance}
                  disabled={loopAdvancing}
                  style={{
                    padding: "8px 12px", borderRadius: "7px", border: "none",
                    backgroundColor: "var(--accent)", color: "#fff",
                    cursor: loopAdvancing ? "not-allowed" : "pointer",
                    fontSize: "12px", fontWeight: 700, display: "flex", alignItems: "center",
                    justifyContent: "center", gap: "4px",
                    opacity: loopAdvancing ? 0.6 : 1,
                    transition: "all 150ms ease",
                  }}
                >
                  {loopAdvancing ? <Loader2 size={12} className="animate-spin" /> : <ChevronRight size={14} />}
                  {currentTask?.status === "rejected" ? "Retry" : "Next"}
                </button>
                <button
                  onClick={onSkipTask}
                  disabled={loopAdvancing || !currentTask}
                  title="Skip current task"
                  style={{
                    padding: "8px 10px", borderRadius: "7px",
                    border: "1px solid var(--border)",
                    backgroundColor: "var(--surface-elevated)", color: "var(--text-muted)",
                    cursor: (loopAdvancing || !currentTask) ? "not-allowed" : "pointer",
                    fontSize: "11px", fontWeight: 600, display: "flex", alignItems: "center",
                    justifyContent: "center", gap: "4px",
                    opacity: (loopAdvancing || !currentTask) ? 0.5 : 1,
                    transition: "all 150ms ease",
                  }}
                >
                  <SkipForward size={12} /> Skip
                </button>
              </>
            )}
          </div>

          {/* Secondary row: Auto-continue toggle + Stop */}
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            {onSetAutoContinue && (
              <button
                onClick={() => onSetAutoContinue(!loop.autoContinue)}
                style={{
                  padding: "5px 10px", borderRadius: "5px",
                  border: `1px solid ${loop.autoContinue ? "rgba(74,222,128,0.4)" : "var(--border)"}`,
                  backgroundColor: loop.autoContinue ? "rgba(74,222,128,0.08)" : "transparent",
                  color: loop.autoContinue ? "#4ade80" : "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: "10px", fontWeight: 700, fontFamily: "var(--font-mono)",
                  letterSpacing: "0.04em", transition: "all 100ms ease",
                }}
              >
                AUTO {loop.autoContinue ? "ON" : "OFF"}
              </button>
            )}

            {/* Stop Loop with inline confirm */}
            {loopStarted && (
              <div style={{ marginLeft: "auto" }}>
                {!stopConfirm ? (
                  <button
                    onClick={() => setStopConfirm(true)}
                    style={{
                      padding: "5px 10px", borderRadius: "5px",
                      border: "1px solid rgba(239,68,68,0.35)",
                      backgroundColor: "rgba(239,68,68,0.06)",
                      color: "#ef4444", cursor: "pointer",
                      fontSize: "10px", fontWeight: 700,
                      display: "flex", alignItems: "center", gap: "4px",
                      transition: "all 100ms ease",
                    }}
                  >
                    <Square size={10} /> Stop
                  </button>
                ) : (
                  <div style={{
                    display: "flex", alignItems: "center", gap: "4px",
                    padding: "3px 6px", borderRadius: "6px",
                    border: "1px solid rgba(239,68,68,0.4)",
                    backgroundColor: "rgba(239,68,68,0.08)",
                  }}>
                    <span style={{ fontSize: "9px", color: "#ef4444", fontWeight: 600, whiteSpace: "nowrap" }}>
                      Sure?
                    </span>
                    <button
                      onClick={() => { onStopLoop?.(); setStopConfirm(false); }}
                      style={{
                        padding: "3px 8px", borderRadius: "4px", border: "none",
                        backgroundColor: "#ef4444", color: "#fff", cursor: "pointer",
                        fontSize: "9px", fontWeight: 700,
                      }}
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setStopConfirm(false)}
                      style={{
                        padding: "3px 8px", borderRadius: "4px",
                        border: "1px solid rgba(239,68,68,0.3)",
                        backgroundColor: "transparent", color: "#ef4444", cursor: "pointer",
                        fontSize: "9px", fontWeight: 600,
                      }}
                    >
                      No
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Task List (Collapsible) ── */}
      <button
        onClick={() => setTasksCollapsed((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: "6px",
          padding: "8px 16px",
          borderBottom: "1px solid var(--border)",
          backgroundColor: "transparent",
          border: "none",
          borderBottomStyle: "solid",
          borderBottomWidth: "1px",
          borderBottomColor: "var(--border)",
          cursor: "pointer",
          width: "100%",
          textAlign: "left",
          flexShrink: 0,
        }}
      >
        {tasksCollapsed ? <ChevronRight size={12} color="var(--text-muted)" /> : <ChevronDown size={12} color="var(--text-muted)" />}
        <span style={{
          fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em",
          color: "var(--text-muted)", fontFamily: "var(--font-mono)",
        }}>
          TASKS ({totalTasks})
        </span>
      </button>

      <div
        ref={taskListRef}
        style={{
          flex: tasksCollapsed ? 0 : 1,
          overflowY: tasksCollapsed ? "hidden" : "auto",
          padding: tasksCollapsed ? "0" : "8px",
          maxHeight: tasksCollapsed ? "0px" : "9999px",
          opacity: tasksCollapsed ? 0 : 1,
          transition: "all 300ms ease",
        }}
      >
        {loop.tasks.map((task, idx) => {
          const sc = statusConfig[task.status] || statusConfig["pending"];
          const isSelected = selectedTaskId === task.id;
          const isCurrent = idx === loop.currentTaskIndex;

          return (
            <div
              key={task.id}
              ref={isCurrent ? currentTaskRef : undefined}
              onClick={() => onSelectTask(isSelected ? null : task.id)}
              style={{
                padding: "10px 12px",
                borderRadius: "8px",
                border: `1px solid ${isSelected ? "var(--accent)" : isCurrent ? "rgba(96,165,250,0.4)" : "transparent"}`,
                backgroundColor: isSelected
                  ? "var(--accent-soft)"
                  : isCurrent
                    ? "rgba(96,165,250,0.06)"
                    : "transparent",
                cursor: "pointer",
                marginBottom: "4px",
                transition: "all 200ms ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                <span style={{ fontSize: "14px", lineHeight: 1, flexShrink: 0, marginTop: "1px" }}>
                  {sc.emoji}
                </span>
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
                  <div style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    marginTop: "4px", flexWrap: "wrap",
                  }}>
                    <span style={{
                      fontSize: "9px", fontWeight: 700, letterSpacing: "0.04em",
                      color: sc.color,
                      backgroundColor: `${sc.color}18`,
                      border: `1px solid ${sc.color}40`,
                      padding: "1px 6px", borderRadius: "3px",
                      fontFamily: "var(--font-mono)",
                    }}>
                      {sc.label.toUpperCase()}
                    </span>
                    {isCurrent && loopStarted && (task.status === "in-progress" || task.status === "in-review") && (
                      <Loader2 size={10} className="animate-spin" style={{ color: sc.color }} />
                    )}
                    {task.attempts > 0 && (
                      <span style={{
                        fontSize: "9px", color: "var(--text-muted)",
                        fontFamily: "var(--font-mono)",
                      }}>
                        {task.attempts} attempt{task.attempts !== 1 ? "s" : ""}
                      </span>
                    )}
                    {task.overriddenBy && (
                      <span style={{
                        fontSize: "9px", color: "#fbbf24",
                        fontFamily: "var(--font-mono)",
                      }}>
                        OVERRIDDEN
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded task details */}
              {isSelected && isActive && (
                <div style={{
                  marginTop: "10px", paddingTop: "10px",
                  borderTop: "1px solid var(--border)",
                }}>
                  <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                    {task.status !== "approved" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onOverride(task.id, "approved"); }}
                        style={{
                          padding: "4px 8px", borderRadius: "4px",
                          border: "1px solid rgba(74,222,128,0.5)",
                          backgroundColor: "rgba(74,222,128,0.1)", color: "#4ade80",
                          cursor: "pointer", fontSize: "9px", fontWeight: 700,
                        }}
                      >
                        Approve
                      </button>
                    )}
                    {task.status !== "blocked" && task.status !== "approved" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onOverride(task.id, "blocked"); }}
                        style={{
                          padding: "4px 8px", borderRadius: "4px",
                          border: "1px solid rgba(148,163,184,0.5)",
                          backgroundColor: "rgba(148,163,184,0.1)", color: "#94a3b8",
                          cursor: "pointer", fontSize: "9px", fontWeight: 700,
                        }}
                      >
                        Block
                      </button>
                    )}
                    {task.status === "blocked" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onOverride(task.id, "pending"); }}
                        style={{
                          padding: "4px 8px", borderRadius: "4px",
                          border: "1px solid rgba(96,165,250,0.5)",
                          backgroundColor: "rgba(96,165,250,0.1)", color: "#60a5fa",
                          cursor: "pointer", fontSize: "9px", fontWeight: 700,
                        }}
                      >
                        Unblock
                      </button>
                    )}
                  </div>
                  {task.notes && (
                    <div style={{
                      fontSize: "10px", color: "var(--text-muted)",
                      marginTop: "6px", fontStyle: "italic",
                    }}>
                      {task.notes}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Add Task ── */}
      {isActive && (
        <div style={{
          padding: "12px", borderTop: "1px solid var(--border)",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              type="text"
              value={newTaskText}
              onChange={(e) => onNewTaskTextChange(e.target.value)}
              placeholder="Add a task..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTaskText.trim()) onAddTask();
              }}
              style={{
                flex: 1, padding: "7px 10px", borderRadius: "6px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--surface-elevated)",
                color: "var(--text-primary)",
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

      {/* Pulse animation keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
