"use client";

import { useEffect, useState } from "react";
import {
  TrendingUp,
  Circle,
  AlertCircle,
  BarChart3,
  Activity,
  Zap,
  Clock,
  ExternalLink,
  CheckCircle,
  DollarSign,
  Link2,
  FolderOpen,
} from "lucide-react";
import Link from "next/link";

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

interface ConnectionStatus {
  coinbase: { configured: boolean; keyId: string | null };
}

export default function TradingPage() {
  const [connStatus, setConnStatus] = useState<ConnectionStatus | null>(null);

  useEffect(() => {
    fetch("/api/trading/connection")
      .then((r) => r.json())
      .then(setConnStatus)
      .catch(() => setConnStatus(null));
  }, []);

  const coinbaseConfigured = connStatus?.coinbase?.configured ?? false;

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

      {/* Connection Status Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
        {/* Coinbase Connection */}
        <div
          className="flex items-center gap-3 p-4 rounded-xl"
          style={{
            backgroundColor: coinbaseConfigured ? "#4ade8008" : "#f59e0b08",
            border: `1px solid ${coinbaseConfigured ? "#4ade8030" : "#f59e0b30"}`,
          }}
        >
          <Circle
            className="w-3 h-3 flex-shrink-0"
            style={{
              fill: coinbaseConfigured ? "#4ade80" : "#f59e0b",
              color: coinbaseConfigured ? "#4ade80" : "#f59e0b",
            }}
          />
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Coinbase API
            </div>
            <div className="text-xs" style={{ color: coinbaseConfigured ? "#4ade80" : "#f59e0b" }}>
              {coinbaseConfigured
                ? `Configured · ${connStatus?.coinbase?.keyId?.slice(-8) ?? "..."}`
                : "Not connected"}
            </div>
          </div>
        </div>

        {/* Binance */}
        <div
          className="flex items-center gap-3 p-4 rounded-xl"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <Circle className="w-3 h-3 flex-shrink-0" style={{ fill: "#6b7280", color: "#6b7280" }} />
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Binance API</div>
            <div className="text-xs" style={{ color: "#6b7280" }}>Not configured</div>
          </div>
        </div>

        {/* Kalshi */}
        <div
          className="flex items-center gap-3 p-4 rounded-xl"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <Circle className="w-3 h-3 flex-shrink-0" style={{ fill: "#6b7280", color: "#6b7280" }} />
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Kalshi API</div>
            <div className="text-xs" style={{ color: "#6b7280" }}>Not configured</div>
          </div>
        </div>

        {/* Polymarket */}
        <div
          className="flex items-center gap-3 p-4 rounded-xl"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <Circle className="w-3 h-3 flex-shrink-0" style={{ fill: "#6b7280", color: "#6b7280" }} />
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Polymarket</div>
            <div className="text-xs" style={{ color: "#6b7280" }}>Not configured</div>
          </div>
        </div>
      </div>

      {/* Crypto Tickers — Ready for live data */}
      <div
        className="rounded-xl overflow-hidden mb-6"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-3">
            <div className="accent-line" />
            <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}>
              ₿ Crypto Price Tickers
            </h2>
          </div>
          <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: "#f59e0b20", color: "#f59e0b" }}>
            Awaiting live feed
          </span>
        </div>
        <div className="p-4 grid grid-cols-3 gap-4">
          {[
            { symbol: "BTC", name: "Bitcoin", color: "#f59e0b", icon: "₿" },
            { symbol: "ETH", name: "Ethereum", color: "#60a5fa", icon: "Ξ" },
            { symbol: "SOL", name: "Solana", color: "#a78bfa", icon: "◎" },
          ].map((coin) => (
            <div
              key={coin.symbol}
              className="p-4 rounded-xl text-center"
              style={{ backgroundColor: "var(--card-elevated)", border: `1px solid ${coin.color}30` }}
            >
              <div className="text-3xl mb-2" style={{ color: coin.color }}>{coin.icon}</div>
              <div className="font-bold text-lg" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}>
                {coin.symbol}
              </div>
              <div className="text-sm" style={{ color: "var(--text-muted)" }}>{coin.name}</div>
              <div
                className="text-xl font-bold mt-2"
                style={{ fontFamily: "var(--font-heading)", color: "var(--text-muted)" }}
              >
                —
              </div>
              <div className="text-xs mt-1 px-2 py-0.5 rounded inline-block" style={{ backgroundColor: `${coin.color}10`, color: coin.color }}>
                Live data pending
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Trader Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
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

      {/* Bottom Panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Portfolio placeholder */}
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="w-5 h-5" style={{ color: "#4ade80" }} />
            <h3 className="font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}>
              Portfolio Value
            </h3>
          </div>
          <div
            className="text-center py-8 rounded-lg"
            style={{ backgroundColor: "var(--card-elevated)", border: "1px dashed var(--border)" }}
          >
            <BarChart3 className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--text-muted)", opacity: 0.5 }} />
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>Portfolio tracking ready</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)", opacity: 0.7 }}>
              Connect Coinbase API to see live balance
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
            <h3 className="font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}>
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

        {/* T3 Project Link */}
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: "var(--card)", border: "1px solid #f59e0b30" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <FolderOpen className="w-5 h-5" style={{ color: "#f59e0b" }} />
            <h3 className="font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}>
              T3 Crypto Bot — Project Files
            </h3>
          </div>
          <div className="space-y-2">
            {[
              { label: "Architecture", path: "/Users/timharris/.openclaw/workspace/projects/crypto-trading/ARCHITECTURE.md" },
              { label: "Changelog", path: "/Users/timharris/.openclaw/workspace/projects/crypto-trading/CHANGELOG.md" },
              { label: "Source code", path: "/Users/timharris/.openclaw/workspace/projects/crypto-trading/src" },
              { label: "Review notes", path: "/Users/timharris/.openclaw/workspace/projects/crypto-trading/REVIEW-PHASE1.md" },
            ].map((item) => (
              <Link
                key={item.label}
                href={`/files?path=${encodeURIComponent(item.path)}`}
                className="flex items-center justify-between px-3 py-2 rounded-lg transition-all hover:opacity-80"
                style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
              >
                <span className="text-sm" style={{ color: "var(--text-primary)" }}>{item.label}</span>
                <ExternalLink className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
              </Link>
            ))}
          </div>
        </div>

        {/* Open Positions */}
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-5 h-5" style={{ color: "#60a5fa" }} />
            <h3 className="font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}>
              Open Positions
            </h3>
          </div>
          <div className="space-y-2">
            {[
              { label: "No open positions", value: "Paper trading mode", color: "#6b7280" },
              { label: "Daily drawdown", value: "—", color: "#6b7280" },
              { label: "Total exposure", value: "—", color: "#6b7280" },
              { label: "Realized P&L today", value: "—", color: "#6b7280" },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between px-3 py-2 rounded-lg"
                style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
              >
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{item.label}</span>
                <span className="text-xs font-medium" style={{ color: item.color }}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
