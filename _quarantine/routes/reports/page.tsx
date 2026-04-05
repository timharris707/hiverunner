"use client";

import { useState, useEffect, useCallback } from "react";
import { FileBarChart, FileText, RefreshCw, Clock, HardDrive, BarChart2, CheckCircle, Zap, TrendingUp, Calendar } from "lucide-react";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell
} from "recharts";
import Link from "next/link";

interface Report {
  name: string;
  path: string;
  title: string;
  type: string;
  size: number;
  modified: string;
}

interface Analytics {
  byDate: { date: string; count: number; completed: number; failed: number }[];
  byAgent: { agent: string; tasks: number }[];
  projects: { name: string; status: string; completion: number; exists: boolean }[];
  summary: {
    totalTasks: number;
    completedTasks: number;
    completionRate: number;
    todayCount: number;
    last7Total: number;
    avgPerDay: number;
    activeDays: number;
  };
}

const AGENT_COLORS = ["#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#00C7BE", "#30B0C7", "#32ADE6", "#007AFF", "#5856D6", "#AF52DE"];
const STATUS_COLORS: Record<string, string> = {
  active: "#4ade80",
  building: "#f59e0b",
  design: "#f59e0b",
  complete: "#f59e0b",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Tab = "analytics" | "reports";

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>("analytics");
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  const loadReports = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch("/api/reports");
      if (!res.ok) throw new Error("Failed to load reports");
      const data = await res.json();
      setReports(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    try {
      setAnalyticsLoading(true);
      const res = await fetch("/api/reports/analytics");
      if (!res.ok) throw new Error("Failed to load analytics");
      const data = await res.json();
      setAnalytics(data);
    } catch (err) {
      console.error(err);
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  const loadContent = useCallback(async (path: string) => {
    try {
      setIsLoadingContent(true);
      const res = await fetch(`/api/reports?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error("Failed to load report");
      const data = await res.json();
      setContent(data.content);
    } catch (err) {
      console.error(err);
      setContent("# Error\n\nFailed to load report content.");
    } finally {
      setIsLoadingContent(false);
    }
  }, []);

  const handleSelect = useCallback(
    (report: Report) => {
      setSelectedPath(report.path);
      loadContent(report.path);
    },
    [loadContent]
  );

  useEffect(() => {
    loadReports();
    loadAnalytics();
  }, [loadReports, loadAnalytics]);

  useEffect(() => {
    if (reports.length > 0 && !selectedPath) {
      handleSelect(reports[0]);
    }
  }, [reports, selectedPath, handleSelect]);

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div
        className="flex items-center justify-between p-3 md:p-4"
        style={{ backgroundColor: "var(--card)", borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-2 md:gap-3">
          <FileBarChart className="w-5 h-5 md:w-6 md:h-6" style={{ color: "var(--accent)" }} />
          <div>
            <h1 className="text-lg md:text-xl font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
              Reports & Analytics
            </h1>
            <p className="text-xs md:text-sm hidden sm:block" style={{ color: "var(--text-secondary)" }}>
              Task analytics and workspace reports
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Tab switcher */}
          <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            <button
              onClick={() => setTab("analytics")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm"
              style={{
                backgroundColor: tab === "analytics" ? "var(--accent)" : "var(--card-elevated)",
                color: tab === "analytics" ? "white" : "var(--text-secondary)",
              }}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              Analytics
            </button>
            <button
              onClick={() => setTab("reports")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm"
              style={{
                backgroundColor: tab === "reports" ? "var(--accent)" : "var(--card-elevated)",
                color: tab === "reports" ? "white" : "var(--text-secondary)",
              }}
            >
              <FileText className="w-3.5 h-3.5" />
              Reports
            </button>
          </div>
          <button
            onClick={() => { loadReports(); loadAnalytics(); }}
            className="p-2 rounded-lg"
            style={{ color: "var(--text-secondary)" }}
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Analytics Tab */}
      {tab === "analytics" && (
        <div className="flex-1 overflow-auto p-4 md:p-6" style={{ backgroundColor: "var(--background)" }}>
          {analyticsLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: "var(--accent)" }} />
            </div>
          ) : analytics ? (
            <div className="space-y-6">
              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Total Tasks", value: analytics.summary.totalTasks, icon: <Zap className="w-5 h-5" />, color: "var(--accent)" },
                  { label: "Completed", value: analytics.summary.completedTasks, icon: <CheckCircle className="w-5 h-5" />, color: "#4ade80" },
                  { label: "Completion Rate", value: `${analytics.summary.completionRate}%`, icon: <TrendingUp className="w-5 h-5" />, color: "#f59e0b" },
                  { label: "Active Days", value: analytics.summary.activeDays, icon: <Calendar className="w-5 h-5" />, color: "#f59e0b" },
                ].map((stat) => (
                  <div key={stat.label} className="p-4 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{stat.label}</span>
                      <span style={{ color: stat.color }}>{stat.icon}</span>
                    </div>
                    <div className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{stat.value}</div>
                  </div>
                ))}
              </div>

              {/* Last 7 days + avg */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
                  <div className="text-sm mb-1" style={{ color: "var(--text-secondary)" }}>Last 7 Days</div>
                  <div className="text-3xl font-bold" style={{ color: "#4ade80" }}>{analytics.summary.last7Total}</div>
                  <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>tasks completed</div>
                </div>
                <div className="p-4 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
                  <div className="text-sm mb-1" style={{ color: "var(--text-secondary)" }}>Daily Average</div>
                  <div className="text-3xl font-bold" style={{ color: "#f59e0b" }}>{analytics.summary.avgPerDay}</div>
                  <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>tasks per active day</div>
                </div>
              </div>

              {/* Tasks over time chart */}
              {analytics.byDate.length > 0 && (
                <div className="p-5 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
                  <h3 className="text-base font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
                    Tasks Completed Over Time
                  </h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={analytics.byDate}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="date" stroke="var(--text-muted)" style={{ fontSize: "11px" }} tickFormatter={(d) => d.slice(5)} />
                      <YAxis stroke="var(--text-muted)" style={{ fontSize: "11px" }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", borderRadius: "8px" }}
                        labelStyle={{ color: "var(--text-primary)" }}
                      />
                      <Bar dataKey="completed" fill="#4ade80" name="Completed" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="failed" fill="#f87171" name="Failed" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Agent Activity */}
                {analytics.byAgent.length > 0 && (
                  <div className="p-5 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
                    <h3 className="text-base font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
                      Agent Activity Breakdown
                    </h3>
                    <div className="space-y-3">
                      {analytics.byAgent.map((a, i) => {
                        const max = analytics.byAgent[0]?.tasks || 1;
                        const pct = Math.round((a.tasks / max) * 100);
                        return (
                          <div key={a.agent}>
                            <div className="flex justify-between text-sm mb-1">
                              <span style={{ color: "var(--text-primary)" }}>{a.agent}</span>
                              <span style={{ color: "var(--text-muted)" }}>{a.tasks} tasks</span>
                            </div>
                            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--card-elevated)" }}>
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${pct}%`, backgroundColor: AGENT_COLORS[i % AGENT_COLORS.length] }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Project Progress */}
                <div className="p-5 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
                  <h3 className="text-base font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
                    Project Progress
                  </h3>
                  <div className="space-y-4">
                    {analytics.projects.map((p) => (
                      <div key={p.name}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{p.name}</span>
                            <span
                              className="text-xs px-1.5 py-0.5 rounded"
                              style={{
                                backgroundColor: `${STATUS_COLORS[p.status] || "#94a3b8"}20`,
                                color: STATUS_COLORS[p.status] || "#94a3b8",
                              }}
                            >
                              {p.status}
                            </span>
                          </div>
                          <span className="text-sm font-bold" style={{ color: STATUS_COLORS[p.status] || "#94a3b8" }}>
                            {p.completion}%
                          </span>
                        </div>
                        <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--card-elevated)" }}>
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{
                              width: `${p.completion}%`,
                              backgroundColor: STATUS_COLORS[p.status] || "#94a3b8",
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-48" style={{ color: "var(--text-muted)" }}>
              Failed to load analytics
            </div>
          )}
        </div>
      )}

      {/* Reports Tab */}
      {tab === "reports" && (
        <div className="flex-1 flex flex-col md:flex-row min-h-0">
          {/* Report list */}
          <div
            className="w-full md:w-80 lg:w-96 overflow-y-auto flex-shrink-0"
            style={{ backgroundColor: "var(--card)", borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}
          >
            <div className="p-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
                {isLoading ? "Loading..." : `${reports.length} Reports`}
              </h2>
            </div>

            {!isLoading && reports.length === 0 && (
              <div className="p-6 text-center" style={{ color: "var(--text-muted)" }}>
                <FileBarChart className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No reports found</p>
                <p className="text-xs mt-1">
                  Reports matching *-analysis-* or *-report-* in memory/ will appear here
                </p>
              </div>
            )}

            <div className="p-2 space-y-2">
              {reports.map((report) => (
                <button
                  key={report.path}
                  onClick={() => handleSelect(report)}
                  className="w-full text-left rounded-lg p-3 transition-all"
                  style={{
                    backgroundColor: selectedPath === report.path ? "var(--accent)" : "var(--card-elevated, var(--background))",
                    border: `1px solid ${selectedPath === report.path ? "var(--accent)" : "var(--border)"}`,
                    cursor: "pointer",
                  }}
                >
                  <div className="flex items-start gap-3">
                    <FileText
                      className="w-5 h-5 mt-0.5 flex-shrink-0"
                      style={{ color: selectedPath === report.path ? "var(--text-primary)" : "var(--accent)" }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate" style={{ color: "var(--text-primary)" }}>
                        {report.title}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDate(report.modified)}
                        </span>
                        <span className="flex items-center gap-1">
                          <HardDrive className="w-3 h-3" />
                          {formatSize(report.size)}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Preview panel */}
          <div className="flex-1 min-w-0 min-h-0" style={{ backgroundColor: "var(--background)" }}>
            {selectedPath ? (
              isLoadingContent ? (
                <div className="flex items-center justify-center h-full" style={{ color: "var(--text-secondary)" }}>
                  Loading report...
                </div>
              ) : (
                <MarkdownPreview content={content} />
              )
            ) : (
              <div className="flex items-center justify-center h-full" style={{ color: "var(--text-muted)" }}>
                <div className="text-center">
                  <FileBarChart className="w-16 h-16 mx-auto mb-4 opacity-30" />
                  <p className="text-lg">Select a report to preview</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
