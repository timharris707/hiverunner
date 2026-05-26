"use client";

import { MessageCircle, Twitter, Mail, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { CSSProperties } from "react";

interface Integration {
  id: string;
  name: string;
  status: "connected" | "disconnected" | "configured" | "not_configured";
  icon: string;
  lastActivity: string | null;
}

interface IntegrationStatusProps {
  integrations: Integration[] | null;
}

const iconMap: Record<string, React.ComponentType<{ className?: string; style?: CSSProperties }>> = {
  MessageCircle,
  Twitter,
  Mail,
};

const statusConfig = {
  connected: {
    icon: CheckCircle,
    color: "var(--positive)",
    bg: "var(--positive-soft)",
    border: "rgba(23, 122, 50, 0.22)",
    label: "Connected",
  },
  disconnected: {
    icon: XCircle,
    color: "var(--negative)",
    bg: "var(--negative-soft)",
    border: "rgba(200, 40, 30, 0.22)",
    label: "Disconnected",
  },
  configured: {
    icon: CheckCircle,
    color: "var(--warning)",
    bg: "var(--warning-soft)",
    border: "rgba(138, 90, 0, 0.24)",
    label: "Configured",
  },
  not_configured: {
    icon: AlertCircle,
    color: "var(--warning)",
    bg: "var(--warning-soft)",
    border: "rgba(138, 90, 0, 0.24)",
    label: "Not Configured",
  },
};

export function IntegrationStatus({ integrations }: IntegrationStatusProps) {
  if (!integrations) {
    return (
      <div className="rounded-xl p-6 animate-pulse" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="h-6 rounded w-1/3 mb-4" style={{ background: "var(--surface-hover)" }}></div>
        <div className="space-y-3">
          <div className="h-16 rounded" style={{ background: "var(--surface-hover)" }}></div>
          <div className="h-16 rounded" style={{ background: "var(--surface-hover)" }}></div>
          <div className="h-16 rounded" style={{ background: "var(--surface-hover)" }}></div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl p-6" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <h2 className="text-xl font-semibold mb-6 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
        <MessageCircle className="w-5 h-5" style={{ color: "var(--accent)" }} />
        Integrations
      </h2>

      <div className="space-y-3">
        {integrations.map((integration) => {
          const Icon = iconMap[integration.icon] || MessageCircle;
          const status = statusConfig[integration.status];
          const StatusIcon = status.icon;

          return (
            <div
              key={integration.id}
              className="flex items-center justify-between p-4 rounded-lg border"
              style={{ background: status.bg, borderColor: status.border }}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ background: "var(--surface-elevated)", border: "1px solid var(--border)" }}>
                  <Icon className="w-5 h-5" style={{ color: "var(--text-secondary)" }} />
                </div>
                <div>
                  <div className="font-medium" style={{ color: "var(--text-primary)" }}>{integration.name}</div>
                  {integration.lastActivity && (
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Last activity:{" "}
                      {formatDistanceToNow(new Date(integration.lastActivity), {
                        addSuffix: true,
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2" style={{ color: status.color }}>
                <StatusIcon className="w-4 h-4" />
                <span className="text-sm font-medium">{status.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
