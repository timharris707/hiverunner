"use client";

import { useState, useEffect } from "react";
import {
  RefreshCw,
  Trash2,
  FileText,
  Key,
  Loader2,
  CheckCircle,
  AlertCircle,
  Terminal,
  X,
} from "lucide-react";
import { ChangePasswordModal } from "./ChangePasswordModal";

interface QuickActionsProps {
  onActionComplete?: () => void;
}

interface LogLine {
  id: string;
  ts: string;
  level: string;
  module: string;
  message: string;
}

function GatewayLogsModal({ onClose }: { onClose: () => void }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logFile, setLogFile] = useState<string>("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gateway/logs?lines=100");
      if (!res.ok) throw new Error("Failed to fetch logs");
      const data = await res.json();
      setLines(data.lines || []);
      setLogFile(data.logFile || "");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  function getLevelColor(level: string): string {
    switch (level.toUpperCase()) {
      case "ERROR": return "#f87171";
      case "WARN": case "WARNING": return "#fbbf24";
      case "INFO": return "#60a5fa";
      case "DEBUG": return "#94a3b8";
      default: return "#c9d1d9";
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.8)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-4xl mx-4 rounded-xl overflow-hidden flex flex-col"
        style={{
          backgroundColor: "#0d1117",
          border: "1px solid #30363d",
          maxHeight: "80vh",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid #30363d" }}
        >
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5" style={{ color: "#4ade80" }} />
            <div>
              <h3 className="font-semibold text-white">Gateway Logs</h3>
              {logFile && (
                <p className="text-xs" style={{ color: "#8b949e" }}>
                  {logFile.split("/").pop()} — last 100 lines
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm"
              style={{ backgroundColor: "#161b22", border: "1px solid #30363d", color: "#8b949e" }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg"
              style={{ backgroundColor: "#161b22", border: "1px solid #30363d", color: "#8b949e" }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Log content */}
        <div
          className="flex-1 overflow-auto p-4"
          style={{ fontFamily: "monospace", fontSize: "0.78rem", lineHeight: 1.6 }}
        >
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: "#4ade80" }} />
            </div>
          ) : error ? (
            <div className="text-center py-8" style={{ color: "#f87171" }}>
              <AlertCircle className="w-8 h-8 mx-auto mb-2" />
              <p>{error}</p>
            </div>
          ) : lines.length === 0 ? (
            <div className="text-center py-8" style={{ color: "#8b949e" }}>
              No log lines found
            </div>
          ) : (
            lines.map((l, i) => (
              <div key={i} className="flex gap-3 py-0.5 hover:bg-white/5 px-1 rounded">
                <span className="text-xs flex-shrink-0 w-12 text-right" style={{ color: "#484f58", paddingTop: "0.1rem" }}>
                  {l.level}
                </span>
                <span className="flex-shrink-0 text-xs" style={{ color: "#6e7681", minWidth: "80px" }}>
                  {l.ts ? new Date(l.ts).toLocaleTimeString() : ""}
                </span>
                <span style={{ color: getLevelColor(l.level), wordBreak: "break-all" }}>
                  {l.module && <span style={{ color: "#c084fc" }}>[{l.module}] </span>}
                  {l.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function QuickActions({ onActionComplete }: QuickActionsProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const showNotification = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  const handleRestartGateway = async () => {
    setLoadingAction("restart");
    try {
      const res = await fetch("/api/gateway/restart", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        showNotification("success", "Gateway restart initiated — reconnecting in ~5s");
      } else {
        showNotification("error", data.error || "Failed to restart gateway");
      }
    } catch {
      showNotification("error", "Failed to contact server");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleClearActivityLog = async () => {
    setLoadingAction("clear_log");
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_activity_log" }),
      });

      if (!res.ok) throw new Error("Failed to clear log");

      showNotification("success", "Activity log cleared successfully");
      onActionComplete?.();
    } catch {
      showNotification("error", "Failed to clear activity log");
    } finally {
      setLoadingAction(null);
    }
  };

  const actions = [
    {
      id: "restart",
      label: "Restart Gateway",
      icon: RefreshCw,
      color: "blue",
      action: handleRestartGateway,
    },
    {
      id: "clear_log",
      label: "Clear Activity Log",
      icon: Trash2,
      color: "yellow",
      action: handleClearActivityLog,
    },
    {
      id: "view_logs",
      label: "View Gateway Logs",
      icon: FileText,
      color: "emerald",
      action: () => setShowLogsModal(true),
    },
    {
      id: "change_password",
      label: "Change Password",
      icon: Key,
      color: "red",
      action: () => setShowPasswordModal(true),
    },
  ];

  const colorClasses: Record<string, string> = {
    emerald:
      "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20",
    blue: "bg-blue-500/10 text-blue-400 border-blue-500/30 hover:bg-blue-500/20",
    yellow:
      "bg-yellow-500/10 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/20",
    red: "bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20",
  };

  return (
    <>
      <div className="bg-gray-900 rounded-xl p-6">
        <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-emerald-400" />
          Quick Actions
        </h2>

        {/* Notification */}
        {notification && (
          <div
            className={`flex items-center gap-2 p-3 rounded-lg mb-4 ${
              notification.type === "success"
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                : "bg-red-500/10 text-red-400 border border-red-500/30"
            }`}
          >
            {notification.type === "success" ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <AlertCircle className="w-4 h-4" />
            )}
            <span className="text-sm">{notification.message}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {actions.map((action) => {
            const Icon = action.icon;
            const isLoading = loadingAction === action.id;

            return (
              <button
                key={action.id}
                onClick={() => action.action()}
                disabled={isLoading}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  colorClasses[action.color]
                }`}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Icon className="w-4 h-4" />
                )}
                <span className="font-medium">{action.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {showLogsModal && <GatewayLogsModal onClose={() => setShowLogsModal(false)} />}

      <ChangePasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        onSuccess={() => {
          showNotification("success", "Password changed successfully");
          setShowPasswordModal(false);
        }}
      />
    </>
  );
}
