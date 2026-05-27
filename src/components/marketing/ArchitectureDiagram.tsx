"use client";

import React from "react";
import { Target, Users, CheckSquare, Database, Cpu, ArrowDown } from "lucide-react";

export function ArchitectureDiagram() {
  return (
    <div
      className="relative w-full overflow-hidden rounded-xl border"
      style={{
        background: "var(--surface)",
        borderColor: "var(--border)",
        fontFamily: "var(--font-body)",
      }}
    >
      {/* Background Grid Pattern */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative z-10 flex flex-col items-center justify-center p-8 sm:p-12 md:p-16 gap-8">
        {/* Layer 1: Goals */}
        <div className="flex flex-col items-center group">
          <div
            className="flex items-center gap-3 px-6 py-4 rounded-xl border shadow-md transition-all duration-300 group-hover:scale-105"
            style={{
              background: "var(--surface-elevated)",
              borderColor: "var(--border-strong)",
              boxShadow: "var(--shadow-cta)",
            }}
          >
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
            >
              <Target size={20} strokeWidth={2.5} />
            </div>
            <div>
              <h3 className="font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
                Company Goals
              </h3>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                High-level objectives & direction
              </p>
            </div>
          </div>
        </div>

        {/* Connection 1 */}
        <div className="flex w-full max-w-md justify-between px-16 relative">
          <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
            <path
              d="M 50% 0 L 50% 50% L 20% 50% L 20% 100%"
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth="2"
              strokeDasharray="4 4"
              className="animate-pulse"
            />
            <path
              d="M 50% 0 L 50% 50% L 50% 100%"
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth="2"
              strokeDasharray="4 4"
              className="animate-pulse"
              style={{ animationDelay: "200ms" }}
            />
            <path
              d="M 50% 0 L 50% 50% L 80% 50% L 80% 100%"
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth="2"
              strokeDasharray="4 4"
              className="animate-pulse"
              style={{ animationDelay: "400ms" }}
            />
          </svg>
        </div>

        {/* Layer 2: Agents */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 w-full max-w-3xl z-10">
          <AgentCard name="Oracle" role="Lead / Product" icon={<Users size={16} />} delay="0ms" />
          <AgentCard name="Prism" role="Content / Writer" icon={<Cpu size={16} />} delay="150ms" />
          <AgentCard name="Vega" role="Visual / Brand" icon={<CheckSquare size={16} />} delay="300ms" />
        </div>

        {/* Connection 2 */}
        <div className="flex w-full justify-center py-4">
          <ArrowDown size={24} style={{ color: "var(--border-strong)" }} className="animate-bounce" />
        </div>

        {/* Layer 3: Tasks & Context */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl z-10">
          <div
            className="flex flex-col gap-4 p-6 rounded-xl border transition-all duration-300 hover:shadow-lg"
            style={{
              background: "var(--surface-elevated)",
              borderColor: "var(--border-strong)",
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-md"
                style={{ background: "var(--info-bg)", color: "var(--info)" }}
              >
                <CheckSquare size={16} strokeWidth={2.5} />
              </div>
              <h3 className="font-bold" style={{ color: "var(--text-primary)" }}>
                Tasks & Runs
              </h3>
            </div>
            <div className="space-y-3">
              <TaskRow id="TASK-101" title="Implement workspace setup" status="in_progress" />
              <TaskRow id="TASK-102" title="Review agent output" status="review" />
              <TaskRow id="TASK-103" title="Document runtime needs" status="to-do" />
            </div>
          </div>

          <div
            className="flex flex-col gap-4 p-6 rounded-xl border transition-all duration-300 hover:shadow-lg"
            style={{
              background: "var(--surface-elevated)",
              borderColor: "var(--border-strong)",
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-md"
                style={{ background: "var(--positive-bg)", color: "var(--positive)" }}
              >
                <Database size={16} strokeWidth={2.5} />
              </div>
              <h3 className="font-bold" style={{ color: "var(--text-primary)" }}>
                Memory Context
              </h3>
            </div>
            <div className="space-y-3">
              <ContextRow label="Goal Context" value="Launch workspace" />
              <ContextRow label="Workspace" value="/workspace" />
              <ContextRow label="Guidance" value="Review before close" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentCard({ name, role, icon, delay }: { name: string; role: string; icon: React.ReactNode; delay: string }) {
  return (
    <div
      className="flex flex-col items-center gap-2 p-5 rounded-xl border text-center transition-all duration-300 hover:scale-105"
      style={{
        background: "var(--surface-hover)",
        borderColor: "var(--border)",
        animation: "fadeIn 0.5s ease-out forwards",
        animationDelay: delay,
        opacity: 0,
      }}
    >
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full border-2"
        style={{
          background: "var(--surface-elevated)",
          borderColor: "var(--accent)",
          color: "var(--accent)",
        }}
      >
        {icon}
      </div>
      <div>
        <h4 className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>
          {name}
        </h4>
        <p className="text-xs mt-1 font-medium tracking-wide" style={{ color: "var(--text-secondary)" }}>
          {role}
        </p>
      </div>
    </div>
  );
}

function TaskRow({ id, title, status }: { id: string; title: string; status: "to-do" | "in_progress" | "review" }) {
  const statusColors = {
    "to-do": { bg: "var(--surface-hover)", color: "var(--text-secondary)" },
    in_progress: { bg: "var(--warning-bg)", color: "var(--warning)" },
    review: { bg: "var(--info-bg)", color: "var(--info)" },
  };

  return (
    <div
      className="flex items-center justify-between p-3 rounded-lg border text-sm"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
          {id}
        </span>
        <span className="font-medium" style={{ color: "var(--text-primary)" }}>
          {title}
        </span>
      </div>
      <span
        className="px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider"
        style={{ background: statusColors[status].bg, color: statusColors[status].color }}
      >
        {status.replace("_", " ")}
      </span>
    </div>
  );
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-center justify-between p-3 rounded-lg border text-sm"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <span className="font-medium" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <span
        className="font-mono text-xs px-2 py-1 rounded-md"
        style={{ background: "var(--surface-hover)", color: "var(--text-primary)" }}
      >
        {value}
      </span>
    </div>
  );
}
