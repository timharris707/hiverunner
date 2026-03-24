"use client";

import {
  TrendingUp,
  Circle,
  AlertCircle,
  BarChart3,
  Activity,
  Zap,
  Clock,
  ExternalLink,
} from "lucide-react";

const TRADERS = [
  {
    id: "t1",
    name: "T1 — Stocks & Options",
    emoji: "📈",
    color: "#4ade80",
    status: "not-deployed",
    description: "Stock screening, options strategy development, trade signal generation",
    tools: ["Market data APIs", "Options chain", "Screener", "Portfolio tracker"],
    model: "claude-sonnet",
    responsibilities: [
      "Stock screening and analysis",
      "Options strategy development and evaluation",
      "Trade signal generation",
      "Portfolio monitoring and alerts",
    ],
  },
  {
    id: "t2",
    name: "T2 — Weather Prediction Trading",
    emoji: "🌩️",
    color: "#60a5fa",
    status: "not-deployed",
    description: "Weather data ingestion → correlation → Polymarket/Kalshi signals",
    tools: ["Open-Meteo", "NOAA", "Kalshi API", "Polymarket API", "Custom models"],
    model: "claude-sonnet",
    responsibilities: [
      "Weather data ingestion and analysis",
      "Correlation of weather patterns to market movements",
      "Weather-based trading signal generation (Kalshi, Polymarket)",
      "Seasonal and event-driven strategy development",
    ],
  },
  {
    id: "t3",
    name: "T3 — Crypto Trading Bot",
    emoji: "₿",
    color: "#f59e0b",
    status: "building",
    description: "CCXT pipeline, momentum/mean-reversion strategies, paper trading → live",
    tools: ["CCXT", "Binance API", "Coinbase API", "TimescaleDB", "Redis"],
    model: "claude-sonnet",
    responsibilities: [
      "Crypto market data pipeline (CCXT)",
      "Momentum and mean-reversion strategies",
      "Paper trading → live execution pathway",
      "Risk management and position sizing",
    ],
  },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  "not-deployed": { label: "Not Deployed", color: "#6b7280" },
  building: { label: "In Progress", color: "#f59e0b" },
  "paper-trading": { label: "Paper Trading", color: "#60a5fa" },
  live: { label: "Live", color: "#4ade80" },
  error: { label: "Error", color: "#ef4444" },
};

export default function TradingPage() {
  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="mb-6">
        <h1
          className="text-3xl font-bold mb-2"
          style={{
            fontFamily: "var(--font-heading)",
            color: "var(--text-primary)",
            letterSpacing: "-1.5px",
          }}
        >
          <TrendingUp className="inline-block w-8 h-8 mr-2 mb-1" />
          Trading Desk
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
          Harris Autonomous Trading — Stocks · Weather Markets · Crypto
        </p>
      </div>

      {/* Status Banner */}
      <div
        className="flex items-center gap-3 p-4 rounded-xl mb-6"
        style={{
          backgroundColor: "#f59e0b10",
          border: "1px solid #f59e0b30",
        }}
      >
        <AlertCircle className="w-5 h-5 flex-shrink-0" style={{ color: "#f59e0b" }} />
        <div>
          <div className="text-sm font-medium" style={{ color: "#f59e0b" }}>
            Trading infrastructure under construction
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            T3 (Crypto) is being built first. T1 and T2 deploy after reliability layer is proven.
          </div>
        </div>
      </div>

      {/* Trader Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        {TRADERS.map((trader) => {
          const statusCfg = STATUS_CONFIG[trader.status] || STATUS_CONFIG["not-deployed"];
          return (
            <div
              key={trader.id}
              className="rounded-xl overflow-hidden"
              style={{
                backgroundColor: "var(--card)",
                border: `1px solid var(--border)`,
              }}
            >
              {/* Header */}
              <div
                className="px-5 py-4"
                style={{
                  borderBottom: "1px solid var(--border)",
                  background: `linear-gradient(135deg, ${trader.color}15, transparent)`,
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-3xl">{trader.emoji}</span>
                  <span
                    className="text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5"
                    style={{
                      backgroundColor: `${statusCfg.color}20`,
                      color: statusCfg.color,
                      border: `1px solid ${statusCfg.color}40`,
                    }}
                  >
                    <Circle className="w-1.5 h-1.5" style={{ fill: statusCfg.color, color: statusCfg.color }} />
                    {statusCfg.label}
                  </span>
                </div>
                <h3
                  className="font-bold text-lg"
                  style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
                >
                  {trader.name}
                </h3>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  {trader.description}
                </p>
              </div>

              {/* Responsibilities */}
              <div className="px-5 py-4">
                <div
                  className="text-xs font-bold mb-2 uppercase tracking-wider"
                  style={{ color: "var(--text-muted)" }}
                >
                  Responsibilities
                </div>
                <ul className="space-y-1">
                  {trader.responsibilities.map((r) => (
                    <li key={r} className="flex items-start gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                      <span style={{ color: trader.color, marginTop: "2px" }}>›</span>
                      {r}
                    </li>
                  ))}
                </ul>

                <div
                  className="text-xs font-bold mb-2 uppercase tracking-wider mt-4"
                  style={{ color: "var(--text-muted)" }}
                >
                  Tools
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {trader.tools.map((tool) => (
                    <span
                      key={tool}
                      className="text-xs px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: `${trader.color}15`,
                        color: trader.color,
                        border: `1px solid ${trader.color}30`,
                      }}
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Placeholder Panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* P&L */}
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-5 h-5" style={{ color: "#4ade80" }} />
            <h3
              className="font-semibold"
              style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
            >
              P&amp;L Overview
            </h3>
          </div>
          <div
            className="text-center py-8 rounded-lg"
            style={{ backgroundColor: "var(--card-elevated)", border: "1px dashed var(--border)" }}
          >
            <BarChart3 className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--text-muted)", opacity: 0.5 }} />
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              P&amp;L tracking activates when trading goes live
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)", opacity: 0.7 }}>
              Paper trading first → risk validation → live
            </p>
          </div>
        </div>

        {/* Signal Feed */}
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-5 h-5" style={{ color: "#f59e0b" }} />
            <h3
              className="font-semibold"
              style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
            >
              Signal Feed
            </h3>
          </div>
          <div
            className="text-center py-8 rounded-lg"
            style={{ backgroundColor: "var(--card-elevated)", border: "1px dashed var(--border)" }}
          >
            <Activity className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--text-muted)", opacity: 0.5 }} />
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Live signals stream here from T1/T2/T3
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)", opacity: 0.7 }}>
              Activated when agents are deployed
            </p>
          </div>
        </div>

        {/* Exchange Health */}
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-5 h-5" style={{ color: "#60a5fa" }} />
            <h3
              className="font-semibold"
              style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
            >
              Exchange &amp; Market Health
            </h3>
          </div>
          <div className="space-y-2">
            {[
              { name: "Binance", status: "pending", color: "#f59e0b" },
              { name: "Coinbase", status: "pending", color: "#f59e0b" },
              { name: "Kalshi", status: "pending", color: "#f59e0b" },
              { name: "Polymarket", status: "pending", color: "#f59e0b" },
            ].map((exchange) => (
              <div
                key={exchange.name}
                className="flex items-center justify-between px-3 py-2 rounded-lg"
                style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
              >
                <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                  {exchange.name}
                </span>
                <span className="text-xs font-medium" style={{ color: exchange.color }}>
                  Not configured
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Risk Dashboard */}
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5" style={{ color: "#a78bfa" }} />
            <h3
              className="font-semibold"
              style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
            >
              Risk Controls
            </h3>
          </div>
          <div className="space-y-2">
            {[
              { label: "Max daily drawdown", value: "TBD", color: "#94a3b8" },
              { label: "Per-trade risk limit", value: "TBD", color: "#94a3b8" },
              { label: "Total exposure cap", value: "TBD", color: "#94a3b8" },
              { label: "Paper → Live threshold", value: "TBD", color: "#94a3b8" },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between px-3 py-2 rounded-lg"
                style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
              >
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  {item.label}
                </span>
                <span className="text-xs font-medium" style={{ color: item.color }}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>
            Risk limits configured before any live trading begins
          </p>
        </div>
      </div>
    </div>
  );
}
