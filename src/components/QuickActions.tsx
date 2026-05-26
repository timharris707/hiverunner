"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import {
  RefreshCw,
  Trash2,
  Key,
  Loader2,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { ChangePasswordModal } from "./ChangePasswordModal";

interface QuickActionsProps {
  onActionComplete?: () => void;
}

export function QuickActions({ onActionComplete }: QuickActionsProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const showNotification = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
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
      id: "clear_log",
      label: "Clear Activity Log",
      icon: Trash2,
      color: "yellow",
      action: handleClearActivityLog,
    },
    {
      id: "change_password",
      label: "Change Password",
      icon: Key,
      color: "red",
      action: () => setShowPasswordModal(true),
    },
  ];

  const colorStyles: Record<string, CSSProperties> = {
    emerald: {
      background: "var(--positive-soft)",
      color: "var(--positive)",
      borderColor: "rgba(23, 122, 50, 0.22)",
    },
    yellow: {
      background: "var(--warning-soft)",
      color: "var(--warning)",
      borderColor: "rgba(138, 90, 0, 0.24)",
    },
    red: {
      background: "var(--negative-soft)",
      color: "var(--negative)",
      borderColor: "rgba(200, 40, 30, 0.22)",
    },
  };

  return (
    <>
      <div className="rounded-xl p-6" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <h2 className="text-xl font-semibold mb-6 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <RefreshCw className="w-5 h-5" style={{ color: "var(--accent)" }} />
          Quick Actions
        </h2>

        {/* Notification */}
        {notification && (
          <div
            className="flex items-center gap-2 p-3 rounded-lg mb-4 border"
            style={notification.type === "success" ? colorStyles.emerald : colorStyles.red}
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
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={colorStyles[action.color]}
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
