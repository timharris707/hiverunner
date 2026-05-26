"use client";

import { GlobalSearch } from "@/components/GlobalSearch";
import { FileText, Brain, FolderOpen, Activity } from "lucide-react";

export const dynamic = "force-dynamic";

const sources = [
  { icon: Brain, label: "Memory Files", desc: "memory/*.md + MEMORY.md", color: "#d97706" },
  { icon: FileText, label: "Workspace Docs", desc: "AUTONOMOUS.md, AGENTS.md, SOUL.md", color: "#f59e0b" },
  { icon: FolderOpen, label: "Project Files", desc: "projects/**/*.md", color: "#10b981" },
  { icon: Activity, label: "Activity & Tasks", desc: "activity feed + task board", color: "#a855f7" },
];

export default function SearchPage() {
  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 md:mb-8">
        <h1
          className="text-2xl md:text-3xl font-bold mb-1 md:mb-2"
          style={{
            color: "var(--text-primary)",
            fontFamily: "var(--font-heading)",
          }}
        >
          Global Search
        </h1>
        <p
          className="text-sm md:text-base"
          style={{ color: "var(--text-secondary)" }}
        >
          Search across all workspace files, memory, projects, and activity
        </p>
      </div>

      {/* Indexed sources */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {sources.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="p-3 rounded-xl flex items-start gap-2"
              style={{
                backgroundColor: "var(--card)",
                border: "1px solid var(--border)",
              }}
            >
              <div
                className="p-1.5 rounded-lg flex-shrink-0"
                style={{ backgroundColor: `${s.color}20` }}
              >
                <Icon className="w-4 h-4" style={{ color: s.color }} />
              </div>
              <div>
                <div
                  className="text-xs font-semibold"
                  style={{ color: "var(--text-primary)" }}
                >
                  {s.label}
                </div>
                <div
                  className="text-xs mt-0.5"
                  style={{ color: "var(--text-muted)" }}
                >
                  {s.desc}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <GlobalSearch fullPage />
    </div>
  );
}
