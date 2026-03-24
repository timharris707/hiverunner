"use client";

import { useEffect, useState, useCallback } from "react";
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
  RefreshCw,
} from "lucide-react";
import Link from "next/link";

const TRADERS = [
  {
    id: "t1",
    name: "Atlas — Stocks & Options",
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
    name: "Nimbus — Weather Prediction Trading",
    emoji: "🌤️",
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
    name: "Cipher — Crypto Trading Bot",
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
  kalshi: { configured: boolean; keyId: string | null; keyPath: string | null };
  polymarket: { configured: boolean; keyId: string | null };
}

interface CryptoPrice {
  usd: number;
  usd_24h_change: number;
}

interface CryptoPrices {
  bitcoin?: CryptoPrice;
  ethereum?: CryptoPrice;
  solana?: CryptoPrice;
  lastUpdated?: Date;
}

const CRYPTO_COINS = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin", color: "#f59e0b", icon: "₿" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum", color: "#60a5fa", icon: "Ξ" },
  { id: "solana", symbol: "SOL", name: "Solana", color: "#a78bfa", icon: "◎" },
];

function formatPrice(price: number): string {
  if (price >= 1000) return `$${price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (price >= 1) return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${price.toFixed(4)}`;
}

export default function TradingPage() {
  const [connStatus, setConnStatus] = useState<ConnectionStatus | null>(null);
  const [cryptoPrices, setCryptoPrices] = useState<CryptoPrices>({});
  const [priceLoading, setPriceLoading] = useState(true);
  const [priceError, setPriceError] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  useEffect(() => {
    fetch("/api/trading/connection")
      .then((r) => r.json())
      .then(setConnStatus)
      .catch(() => setConnStatus(null));
  }, []);

  const fetchCryptoPrices = useCallback(async () => {
    try {
      setPriceError(false);
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true",
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error("CoinGecko fetch failed");
      const data = await res.json();
      setCryptoPrices({ ...data, lastUpdated: new Date() });
      setLastRefresh(new Date());
    } catch {
      setPriceError(true);
    } finally {
      setPriceLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCryptoPrices();
    const interval = setInterval(fetchCryptoPrices, 60000);
    return () => clearInterval(interval);
  }, [fetchCryptoPrices]);

  const coinbaseConfigured = connStatus?.coinbase?.configured ?? false;
  const kalshiConfigured = connStatus?.kalshi?.configured ?? false;
  const polymarketConfigured = connStatus?.polymarket?.configured ?? false;

  const connections = [
    {
      label: "Coinbase API",
      configured: coinbaseConfigured,
      subtext: coinbaseConfigured
        ? `Connected · ...${connStatus?.coinbase?.keyId?.slice(-6) ?? "..."}`
        : "Not connected",
    },
    {
      label: "Kalshi API",
      configured: kalshiConfigured,
      subtext: kalshiConfigured
        ? `Connected · ...${connStatus?.kalshi?.keyId ?? "..."}`
        : "Not configured",
    },
    {
      label: "Polymarket",
      configured: polymarketConfigured,
      subtext: polymarketConfigured
        ? `Connected · ...${connStatus?.polymarket?.keyId ?? "..."}`
        : "Not configured",
    },
    {
      label: "Binance API",
      configured: false,
      subtext: "Not configured",
    },
  ];

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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {connections.map((conn) => (
          <div
            key={conn.label}
            className="flex items-center gap-3 p-4 rounded-xl"
            style={{
              backgroundColor: conn.configured ? "#4ade8008" : "var(--card)",
              border: `1px solid ${conn.configured ? "#4ade8030" : "var(--border)"}`,
            }}
          >
            {conn.configured ? (
              <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: "#4ade80" }} />
            ) : (
              <Circle className="w-3 h-3 flex-shrink-0" style={{ fill: "#6b7280", color: "#6b7280" }} />
            )}
            <div>
              <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {conn.label}
              </div>
              <div
                className="text-xs"
                style={{ color: conn.configured ? "#4ade80" : "var(--text-muted)" }}
              >
                {conn.subtext}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Crypto Tickers — Live */}
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
          <div className="flex items-center gap-2">
            {lastRefresh && (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                Updated {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <button
              onClick={fetchCryptoPrices}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded"
              style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
            <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: "#4ade8020", color: "#4ade80" }}>
              {priceLoading ? "Loading..." : priceError ? "Error" : "Live · CoinGecko"}
            </span>
          </div>
        </div>
        <div className="p-4 grid grid-cols-3 gap-4">
          {CRYPTO_COINS.map((coin) => {
            const priceData = cryptoPrices[coin.id as keyof CryptoPrices] as CryptoPrice | undefined;
            const price = priceData?.usd;
            const change = priceData?.usd_24h_change;
            const isPositive = change !== undefined && change >= 0;

            return (
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
                  style={{ fontFamily: "var(--font-heading)", color: price ? "var(--text-primary)" : "var(--text-muted)" }}
                >
                  {priceLoading ? "—" : priceError ? "N/A" : price ? formatPrice(price) : "—"}
                </div>
                {change !== undefined && !priceLoading && !priceError && (
                  <div
                    className="text-xs mt-1 px-2 py-0.5 rounded inline-block font-semibold"
                    style={{
                      backgroundColor: `${isPositive ? "#4ade80" : "#ef4444"}15`,
                      color: isPositive ? "#4ade80" : "#ef4444",
                    }}
                  >
                    {isPositive ? "+" : ""}{change.toFixed(2)}% 24h
                  </div>
                )}
                {(priceLoading || priceError) && (
                  <div className="text-xs mt-1 px-2 py-0.5 rounded inline-block" style={{ backgroundColor: `${coin.color}10`, color: coin.color }}>
                    {priceLoading ? "Loading..." : "Unavailable"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Weather Trading Section */}
      <div
        className="rounded-xl overflow-hidden mb-6"
        style={{ backgroundColor: "var(--card)", border: "1px solid #60a5fa30" }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-3">
            <div className="accent-line" />
            <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}>
              🌩️ Weather Trading
            </h2>
          </div>
          <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: "#60a5fa20", color: "#60a5fa" }}>
            Research Phase
          </span>
        </div>
        <div className="p-4">
          {/* T2 Agent Status */}
          <div
            className="flex items-center gap-4 p-4 rounded-xl mb-4"
            style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
              style={{ backgroundColor: "#60a5fa20", border: "1px solid #60a5fa40" }}
            >
              🌩️
            </div>
            <div className="flex-1">
              <div className="font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
                Nimbus — Weather Prediction Trader
              </div>
              <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                Weather data → Polymarket/Kalshi signal generation
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ backgroundColor: "#6b728020", color: "#9ca3af" }}>
                  Not Deployed
                </span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  · Credentials configured ✅
                </span>
              </div>
            </div>
            <Link
              href="/files?path=/Users/timharris/.openclaw/workspace/projects/weather-trading"
              className="text-sm flex items-center gap-1.5 px-3 py-2 rounded-lg"
              style={{ backgroundColor: "#60a5fa15", color: "#60a5fa", border: "1px solid #60a5fa30" }}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Project Files
            </Link>
          </div>

          {/* Weather Trading Panels */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Active Contracts */}
            <div
              className="p-4 rounded-xl"
              style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-center gap-2 mb-3">
                <Link2 className="w-4 h-4" style={{ color: "#60a5fa" }} />
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Active Contracts</span>
              </div>
              <div className="text-center py-4">
                <div className="text-3xl font-bold mb-1" style={{ color: "var(--text-muted)", fontFamily: "var(--font-heading)" }}>0</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>No open positions</div>
                <div className="text-xs mt-2 px-2 py-1 rounded" style={{ backgroundColor: "#60a5fa10", color: "#60a5fa" }}>
                  Kalshi + Polymarket
                </div>
              </div>
            </div>

            {/* Edge Scanner */}
            <div
              className="p-4 rounded-xl"
              style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4" style={{ color: "#a78bfa" }} />
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Edge Scanner</span>
              </div>
              <div className="text-center py-4">
                <div className="text-3xl mb-1" style={{ color: "var(--text-muted)" }}>🔍</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>Awaiting T2 deployment</div>
                <div className="text-xs mt-2 px-2 py-1 rounded" style={{ backgroundColor: "#a78bfa10", color: "#a78bfa" }}>
                  Weather → Market Edge
                </div>
              </div>
            </div>

            {/* Daily P&L */}
            <div
              className="p-4 rounded-xl"
              style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="w-4 h-4" style={{ color: "#4ade80" }} />
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Daily P&L</span>
              </div>
              <div className="text-center py-4">
                <div className="text-2xl font-bold mb-1" style={{ color: "var(--text-muted)", fontFamily: "var(--font-heading)" }}>$—</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>Paper trading mode</div>
                <div className="text-xs mt-2 px-2 py-1 rounded" style={{ backgroundColor: "#4ade8010", color: "#4ade80" }}>
                  Live when deployed
                </div>
              </div>
            </div>
          </div>
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
              Live signals stream here from Atlas / Nimbus / Cipher
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
              Cipher Crypto Bot — Project Files
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
