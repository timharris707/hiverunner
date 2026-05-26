"use client";

import { useEffect, useState } from "react";
import {
  Settings,
  RefreshCw,
  Bot,
  Key,
  MessageSquare,
  Timer,
  Server,
  ChevronDown,
  ChevronRight,
  Lock,
  CheckCircle,
  Circle,
  type LucideIcon,
} from "lucide-react";
import { SystemInfo } from "@/components/SystemInfo";
import { IntegrationStatus } from "@/components/IntegrationStatus";
import { QuickActions } from "@/components/QuickActions";

interface SystemData {
  agent: { name: string; creature: string; emoji: string };
  system: {
    uptime: number;
    uptimeFormatted: string;
    nodeVersion: string;
    model: string;
    workspacePath: string;
    platform: string;
    hostname: string;
    memory: { total: number; free: number; used: number };
  };
  integrations: Array<{
    id: string;
    name: string;
    status: "connected" | "disconnected" | "configured" | "not_configured";
    icon: string;
    lastActivity: string | null;
  }>;
  timestamp: string;
}

interface Provider {
  id: string;
  name: string;
  icon: string;
  authType: string;
  models: string[];
  status: "active" | "inactive" | "unconfigured";
  isPrimary: boolean;
  billing: "subscription" | "metered";
  note: string;
}

type ConfigSection = {
  label: string;
  icon: LucideIcon;
  key: string;
};

const CONFIG_SECTIONS: ConfigSection[] = [
  { label: "Agent Defaults", icon: Bot, key: "agents" },
  { label: "Auth Profiles", icon: Key, key: "auth" },
  { label: "Channels", icon: MessageSquare, key: "channels" },
  { label: "Runtime Service", icon: Server, key: "gateway" },
  { label: "Tools", icon: Settings, key: "tools" },
  { label: "Plugins", icon: Timer, key: "plugins" },
];

function JsonTree({ data, depth = 0 }: { data: unknown; depth?: number }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (data === null) return <span style={{ color: "var(--text-muted)" }}>null</span>;
  if (typeof data === "boolean")
    return (
      <span style={{ color: "var(--warning)" }}>{data ? "true" : "false"}</span>
    );
  if (typeof data === "number")
    return <span style={{ color: "var(--warning)" }}>{data}</span>;
  if (typeof data === "string") {
    if (data === "***redacted***" || data === "***optional-runtime-path***")
      return (
        <span
          className="flex items-center gap-1"
          style={{ color: "var(--text-muted)", fontStyle: "italic" }}
        >
          <Lock className="w-3 h-3" />
          {data === "***optional-runtime-path***" ? "optional runtime path" : "redacted"}
        </span>
      );
    return (
      <span style={{ color: "var(--positive)" }}>
        &quot;{data}&quot;
      </span>
    );
  }
  if (Array.isArray(data)) {
    if (data.length === 0)
      return <span style={{ color: "var(--text-muted)" }}>[]</span>;
    return (
      <span>
        [{" "}
        {data.map((item, i) => (
          <span key={i}>
            <JsonTree data={item} depth={depth + 1} />
            {i < data.length - 1 ? ", " : ""}
          </span>
        ))}{" "}
        ]
      </span>
    );
  }
  if (typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0)
      return <span style={{ color: "var(--text-muted)" }}>{"{}"}</span>;
    return (
      <div style={{ paddingLeft: depth > 0 ? "1rem" : 0 }}>
        {entries.map(([k, v]) => {
          const isComplex = typeof v === "object" && v !== null;
          const isExpanded = expanded[k] !== false; // default expanded
          return (
            <div key={k} className="py-0.5">
              <div className="flex items-start gap-1.5">
                {isComplex ? (
                  <button
                    onClick={() =>
                      setExpanded((p) => ({ ...p, [k]: !isExpanded }))
                    }
                    className="mt-0.5 flex-shrink-0"
                    style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3 h-3" />
                    ) : (
                      <ChevronRight className="w-3 h-3" />
                    )}
                  </button>
                ) : (
                  <span className="w-3 flex-shrink-0" />
                )}
                <span
                  className="font-medium text-xs flex-shrink-0"
                  style={{ color: "var(--accent)" }}
                >
                  {k}:
                </span>
                {isComplex ? (
                  isExpanded ? (
                    <JsonTree data={v} depth={depth + 1} />
                  ) : (
                    <span
                      className="text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {Array.isArray(v)
                        ? `[${(v as unknown[]).length} items]`
                        : `{${Object.keys(v as object).length} keys}`}
                    </span>
                  )
                ) : (
                  <JsonTree data={v} depth={depth + 1} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  return <span>{String(data)}</span>;
}

export default function SettingsPage() {
  const [systemData, setSystemData] = useState<SystemData | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<Record<string, unknown> | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [configLoading, setConfigLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [activeSection, setActiveSection] = useState<string>("agents");

  const fetchSystemData = async () => {
    try {
      const res = await fetch("/api/system");
      const data = await res.json();
      setSystemData(data);
      setLastRefresh(new Date());
    } catch (error) {
      console.error("Failed to fetch system data:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        setRuntimeConfig(data.config);
        if (data.providers) setProviders(data.providers);
      }
    } catch (err) {
      console.error("Failed to load config:", err);
    } finally {
      setConfigLoading(false);
    }
  };

  useEffect(() => {
    fetchSystemData();
    fetchConfig();
    const interval = setInterval(fetchSystemData, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setLoading(true);
    setConfigLoading(true);
    fetchSystemData();
    fetchConfig();
  };

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 md:mb-8">
        <div>
          <h1
            className="text-2xl md:text-3xl font-bold mb-1 md:mb-2 flex items-center gap-2 md:gap-3"
            style={{
              color: "var(--text-primary)",
              fontFamily: "var(--font-heading)",
            }}
          >
            <Settings
              className="w-6 h-6 md:w-8 md:h-8"
              style={{ color: "var(--accent)" }}
            />
            Settings
          </h1>
          <p
            className="text-sm md:text-base"
            style={{ color: "var(--text-secondary)" }}
          >
            Runtime diagnostics, integrations, and provider configuration
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors disabled:opacity-50 w-full sm:w-auto"
          style={{
            backgroundColor: "var(--card)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border)",
          }}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {lastRefresh && (
        <div className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
          Last updated: {lastRefresh.toLocaleTimeString()}
        </div>
      )}

      {/* System info + integrations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mb-6">
        <div className="lg:col-span-2">
          <SystemInfo data={systemData} />
        </div>
        <div>
          <IntegrationStatus integrations={systemData?.integrations || null} />
        </div>
        <div>
          <QuickActions onActionComplete={handleRefresh} />
        </div>
      </div>

      {/* Provider Status */}
      {providers.length > 0 && (
        <div
          className="rounded-xl mb-6"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div
            className="px-5 py-4 flex items-center justify-between"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <div>
              <h2
                className="font-semibold text-lg flex items-center gap-2"
                style={{ color: "var(--text-primary)" }}
              >
                <Server className="w-5 h-5" style={{ color: "var(--accent)" }} />
                Provider Stack
              </h2>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                Configured AI providers and their status
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: "var(--positive-soft)", color: "var(--positive)" }}>
                {providers.filter(p => p.status === "active").length} active
              </span>
            </div>
          </div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            {providers.map((provider) => (
              <div
                key={provider.id}
                className="p-4 rounded-lg"
                style={{
                  backgroundColor: "var(--card-elevated)",
                  border: `1px solid ${provider.status === "active" ? "rgba(23, 122, 50, 0.22)" : "var(--border)"}`,
                }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{provider.icon}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
                          {provider.name}
                        </span>
                        {provider.isPrimary && (
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--accent)20", color: "var(--accent)" }}>
                            PRIMARY
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {provider.status === "active" ? (
                          <CheckCircle className="w-3 h-3" style={{ color: "var(--positive)" }} />
                        ) : (
                          <Circle className="w-3 h-3" style={{ color: "var(--text-muted)" }} />
                        )}
                        <span className="text-xs" style={{ color: provider.status === "active" ? "var(--positive)" : "var(--text-muted)" }}>
                          {provider.status === "active" ? "Active" : provider.status === "inactive" ? "Inactive" : "Not configured"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className="text-xs px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: "var(--warning-soft)",
                        color: "var(--warning)",
                      }}
                    >
                      {provider.billing === "subscription" ? "📋 Subscription" : "💳 Metered"}
                    </span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {provider.authType}
                    </span>
                  </div>
                </div>
                {provider.models.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {provider.models.map((m) => (
                      <span
                        key={m}
                        className="text-xs px-1.5 py-0.5 rounded font-mono"
                        style={{ backgroundColor: "var(--card)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {provider.note}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Runtime Config Viewer */}
      <div
        className="rounded-xl"
        style={{
          backgroundColor: "var(--card)",
          border: "0.5px solid var(--border)",
        }}
      >
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div>
            <h2
              className="font-semibold text-lg flex items-center gap-2"
              style={{ color: "var(--text-primary)" }}
            >
              <Settings className="w-5 h-5" style={{ color: "var(--accent)" }} />
              Runtime Config
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              Read-only view of local runtime configuration · Sensitive values redacted
            </p>
          </div>
          <Lock className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
        </div>

        {configLoading ? (
          <div className="p-8 text-center">
            <div
              className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto"
              style={{ borderColor: "var(--accent)" }}
            />
          </div>
        ) : runtimeConfig ? (
          <div className="flex">
            {/* Section tabs */}
            <div
              className="w-44 flex-shrink-0 border-r py-3"
              style={{ borderColor: "var(--border)" }}
            >
              {CONFIG_SECTIONS.map((section) => {
                const hasData = section.key in runtimeConfig;
                const Icon = section.icon;
                return (
                  <button
                    key={section.key}
                    onClick={() => setActiveSection(section.key)}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left transition-all"
                    style={{
                      backgroundColor:
                        activeSection === section.key
                          ? "var(--accent)15"
                          : "transparent",
                      color:
                        activeSection === section.key
                          ? "var(--accent)"
                          : hasData
                          ? "var(--text-secondary)"
                          : "var(--text-muted)",
                      borderLeft:
                        activeSection === section.key
                          ? "2px solid var(--accent)"
                          : "2px solid transparent",
                      opacity: hasData ? 1 : 0.5,
                    }}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    {section.label}
                  </button>
                );
              })}
            </div>
            {/* Config content */}
            <div className="flex-1 p-5 overflow-auto">
              <div
                className="font-mono text-xs leading-relaxed"
                style={{ color: "var(--text-primary)" }}
              >
                {runtimeConfig[activeSection] !== undefined ? (
                  <JsonTree data={runtimeConfig[activeSection]} />
                ) : (
                  <span style={{ color: "var(--text-muted)" }}>
                    No configuration for this section
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center">
            <p style={{ color: "var(--text-muted)" }}>
              Failed to load configuration
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className="mt-6 md:mt-8 p-3 md:p-4 rounded-xl"
        style={{
          backgroundColor: "var(--surface)",
          border: "1px solid var(--border)",
        }}
      >
        <div
          className="flex items-center justify-between text-sm"
          style={{ color: "var(--text-muted)" }}
        >
          <span>HiveRunner v1.0.0</span>
          <span>HiveRunner Runtime Console</span>
        </div>
      </div>
    </div>
  );
}
