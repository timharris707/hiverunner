"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  MapPin,
  Target,
} from "lucide-react";
import Link from "next/link";
import { AgentAvatar } from "@/components/AgentAvatar";
import { useDemoMode, maskDollar, maskKey, maskConnectionSubtext } from "@/lib/demo-mode";

const TRADERS = [
  {
    id: "t1",
    name: "Atlas — Stocks & Options",
    emoji: "\u{1F4C8}",
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
    emoji: "\u{1F324}\uFE0F",
    color: "#f59e0b",
    status: "not-deployed",
    description: "Weather data ingestion, correlation analysis, and Polymarket/Kalshi signals",
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
    emoji: "\u20BF",
    color: "#f59e0b",
    status: "building",
    description: "CCXT pipeline, momentum/mean-reversion strategies, and paper-trading to live",
    tools: ["CCXT", "Binance API", "Coinbase API", "TimescaleDB", "Redis"],
    model: "claude-sonnet",
    responsibilities: [
      "Crypto market data pipeline (CCXT)",
      "Momentum and mean-reversion strategies",
      "Paper-trading to live-execution pathway",
      "Risk management and position sizing",
    ],
  },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  "not-deployed": { label: "Not Deployed", color: "#6b7280" },
  building: { label: "In Progress", color: "#f59e0b" },
  "paper-trading": { label: "Paper Trading", color: "#f59e0b" },
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
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin", color: "#f59e0b", icon: "\u20BF" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum", color: "#f59e0b", icon: "\u039E" },
  { id: "solana", symbol: "SOL", name: "Solana", color: "#f59e0b", icon: "\u25CE" },
];

function formatPrice(price: number): string {
  if (price >= 1000) return `$${price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (price >= 1) return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${price.toFixed(4)}`;
}

interface RecentTrade {
  trade_id: string;
  ticker: string;
  side: string;
  quantity: number;
  price: number;
  cost: number;
  edge: number;
  status: string;
  pnl: number;
  payout: number;
  actual_outcome: string | null;
  actual_temp: number | null;
  city: string;
  target_date: string;
  threshold: number | null;
  forecast_mean: number | null;
  settlement_scheduled_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

interface TradeStats {
  totalTrades: number;
  openTrades: number;
  won: number;
  lost: number;
  winRate: number;
  totalPnl: number;
  openExposure: number;
  bankroll: number | null;
  recentTrades: RecentTrade[];
  resolvedTrades: RecentTrade[];
}

interface WeatherStats {
  available: boolean;
  summary?: {
    brier_score: number;
    calibration_error: number;
    total_pnl: number;
    win_rate: number;
    sharpe_ratio: number;
    max_drawdown: number;
    total_bets: number;
  } | null;
  backtestPeriod?: { start: string; end: string; days: number } | null;
  backtestStatus?: string | null;
  liveStats?: TradeStats | null;
  kalshiStats?: TradeStats | null;
}

interface Position {
  trade_id: string;
  ticker: string;
  side: string;
  quantity: number;
  price: number;
  cost: number;
  edge: number;
  composite_score: number;
  city: string;
  target_date: string;
  threshold?: number;
  forecast_mean: number;
  forecast_std: number | null;
  n_models: number | null;
  status: string;
  settlement_scheduled_at: string | null;
  created_at: string;
  trade_type: "live" | "paper";
  strategy_version: string | null;
  our_probability: number | null;
}

interface ResolvedPosition {
  trade_id: string;
  ticker: string;
  side: string;
  quantity: number;
  price: number;
  cost: number;
  edge: number;
  composite_score: number;
  city: string;
  target_date: string;
  threshold: number | null;
  forecast_mean: number;
  forecast_std: number | null;
  strategy_version: string | null;
  our_probability: number | null;
  n_models: number | null;
  status: string;
  pnl: number;
  payout: number;
  actual_outcome: string | null;
  actual_temp: number | null;
  market_result?: string | null;
  settlement_scheduled_at: string | null;
  resolved_at: string | null;
  created_at: string;
  trade_type: "live" | "paper";
}

interface CityBreakdown {
  city: string;
  trade_count: number;
  total_deployed: number;
  realized_pnl: number;
  open_count: number;
  won: number;
  lost: number;
}

interface PositionsData {
  positions: Position[];
  resolvedPositions: ResolvedPosition[];
  cityBreakdown: CityBreakdown[];
  liveCityBreakdown: CityBreakdown[];
  paperCityBreakdown: CityBreakdown[];
}

function capitalize(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function edgeColor(edge: number): string {
  const pct = edge * 100;
  if (pct > 50) return "#4ade80";
  if (pct >= 20) return "#facc15";
  return "#f97316";
}

function parseBetDescription(ticker: string, side: string, threshold?: number | null): string {
  const isHigh = /HIGH/i.test(ticker);
  const metric = isHigh ? "High" : "Low";

  // Bracket market: ticker contains -B followed by a number
  const bracketMatch = ticker.match(/-B([\d.]+)$/);
  if (bracketMatch) {
    const base = parseFloat(bracketMatch[1]);
    const lo = base;
    const hi = base + 2;
    if (side.toLowerCase() === "yes") {
      return `${metric} ${lo}\u2013${hi}`;
    }
    return `${metric} outside ${lo}\u2013${hi}`;
  }

  // Threshold market: ticker contains -T followed by a number
  const threshMatch = ticker.match(/-T([\d.]+)$/);
  const t = threshMatch ? parseFloat(threshMatch[1]) : threshold;
  if (t != null) {
    if (isHigh) {
      return side.toLowerCase() === "yes"
        ? `High ${t} or below`
        : `High above ${t}`;
    }
    return side.toLowerCase() === "yes"
      ? `Low ${t} or above`
      : `Low below ${t}`;
  }

  return metric;
}

function shortTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "Z");
  if (isNaN(d.getTime())) return "\u2014";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function friendlyDatetime(dateStr: string | null | undefined): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "Z");
  if (isNaN(d.getTime())) return "\u2014";
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function timeRemaining(dateStr: string | null | undefined): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "Z");
  if (isNaN(d.getTime())) return "\u2014";
  const now = Date.now();
  const diff = d.getTime() - now;
  if (diff <= 0) return "settling...";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs < 24) return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
  const days = Math.floor(hrs / 24);
  const remHrs = hrs % 24;
  return remHrs > 0 ? `${days}d ${remHrs}h` : `${days} day${days > 1 ? "s" : ""}`;
}

type SortKey = "placed" | "settles" | "remaining" | "city" | "bet" | "side" | "price" | "qty" | "cost" | "edge" | "win" | "winProb" | "forecast" | "models" | "version";
type SortDir = "asc" | "desc";

export default function TradingPage() {
  const { isDemoMode } = useDemoMode();
  const $ = (val: number | null | undefined, prefix = "$") =>
    isDemoMode ? maskDollar(val, prefix) : val == null ? "—" : `${prefix}${val.toFixed(2)}`;
  const [connStatus, setConnStatus] = useState<ConnectionStatus | null>(null);
  const [cryptoPrices, setCryptoPrices] = useState<CryptoPrices>({});
  const [priceLoading, setPriceLoading] = useState(true);
  const [priceError, setPriceError] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [weatherStats, setWeatherStats] = useState<WeatherStats | null>(null);
  const [positionsData, setPositionsData] = useState<PositionsData | null>(null);
  const [weatherLastRefresh, setWeatherLastRefresh] = useState<Date | null>(null);
  const [showPaperTrades, setShowPaperTrades] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("placed");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [versionFilter, setVersionFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const weatherIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const fetchWeatherData = useCallback(async () => {
    try {
      const [statsRes, posRes] = await Promise.all([
        fetch("/api/trading/weather-stats"),
        fetch("/api/trading/positions"),
      ]);
      const statsData = await statsRes.json();
      const posData = await posRes.json();
      setWeatherStats(statsData);
      setPositionsData({
        positions: posData.positions || [],
        resolvedPositions: posData.resolvedPositions || [],
        cityBreakdown: posData.cityBreakdown || [],
        liveCityBreakdown: posData.liveCityBreakdown || [],
        paperCityBreakdown: posData.paperCityBreakdown || [],
      });
      setWeatherLastRefresh(new Date());
    } catch {
      // silent fail
    }
  }, []);

  useEffect(() => {
    fetch("/api/trading/connection")
      .then((r) => r.json())
      .then(setConnStatus)
      .catch(() => setConnStatus(null));
    fetchWeatherData();
  }, [fetchWeatherData]);

  // Auto-refresh weather data every 60 seconds
  useEffect(() => {
    weatherIntervalRef.current = setInterval(fetchWeatherData, 60000);
    return () => {
      if (weatherIntervalRef.current) clearInterval(weatherIntervalRef.current);
    };
  }, [fetchWeatherData]);

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
      subtext: isDemoMode
        ? maskConnectionSubtext("", coinbaseConfigured)
        : coinbaseConfigured
          ? `Connected (${connStatus?.coinbase?.keyId?.slice(-6) ?? "..."})`
          : "Not connected",
    },
    {
      label: "Kalshi API",
      configured: kalshiConfigured,
      subtext: isDemoMode
        ? maskConnectionSubtext("", kalshiConfigured)
        : kalshiConfigured
          ? `Connected (${connStatus?.kalshi?.keyId ?? "..."})`
          : "Not configured",
    },
    {
      label: "Polymarket",
      configured: polymarketConfigured,
      subtext: isDemoMode
        ? maskConnectionSubtext("", polymarketConfigured)
        : polymarketConfigured
          ? `Connected (${connStatus?.polymarket?.keyId ?? "..."})`
          : "Not configured",
    },
    {
      label: "Binance API",
      configured: false,
      subtext: "Not configured",
    },
  ];

  // When showing live-only: use Kalshi stats; when showing all: use paper stats (includes all history)
  const ls = showPaperTrades ? weatherStats?.liveStats : weatherStats?.kalshiStats;
  const hasLiveTrades = (weatherStats?.kalshiStats?.totalTrades ?? 0) > 0;

  const cashAvailable = ls?.bankroll != null && ls?.openExposure != null
    ? ls.bankroll - ls.openExposure
    : null;

  // Filtered positions based on toggle
  const allPositions = positionsData?.positions ?? [];
  const allResolved = positionsData?.resolvedPositions ?? [];
  const preFilterPositions = showPaperTrades ? allPositions : allPositions.filter((p) => p.trade_type === "live");
  const preFilterResolved = showPaperTrades ? allResolved : allResolved.filter((p) => p.trade_type === "live");
  
  // Version & date filters
  const positions = preFilterPositions.filter((p) => {
    if (versionFilter !== "all" && (p.strategy_version || "unknown") !== versionFilter) return false;
    if (dateFilter !== "all" && p.target_date !== dateFilter) return false;
    return true;
  });
  const resolvedPositions = preFilterResolved.filter((p) => {
    if (versionFilter !== "all" && ((p as unknown as Record<string, string>).strategy_version || "unknown") !== versionFilter) return false;
    if (dateFilter !== "all" && p.target_date !== dateFilter) return false;
    return true;
  });
  const cityBreakdown = showPaperTrades
    ? (positionsData?.cityBreakdown ?? [])
    : (positionsData?.liveCityBreakdown ?? []);
  
  // Unique versions and dates for filter dropdowns
  const allVersions = [...new Set([...allPositions, ...allResolved].map((p) => (p as unknown as Record<string, string>).strategy_version || "unknown"))].sort();
  const allDates = [...new Set([...allPositions, ...allResolved].map((p) => p.target_date))].filter(Boolean).sort();

  // Sort positions
  const sortedPositions = [...positions].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    const getValue = (pos: Position): number | string => {
      switch (sortKey) {
        case "placed": return pos.created_at || "";
        case "settles": return pos.settlement_scheduled_at || pos.target_date || "";
        case "remaining": return pos.settlement_scheduled_at || pos.target_date || "";
        case "city": return pos.city;
        case "bet": return parseBetDescription(pos.ticker, pos.side, pos.threshold);
        case "side": return pos.side;
        case "price": return pos.price;
        case "qty": return pos.quantity;
        case "cost": return pos.cost;
        case "edge": return pos.edge;
        case "win": return (pos.quantity * 1) - pos.cost;
        case "winProb": return pos.our_probability ?? 0;
        case "forecast": return pos.forecast_mean ?? 0;
        case "models": return pos.n_models ?? 0;
        case "version": return pos.strategy_version || "";
        default: return "";
      }
    };
    const va = getValue(a);
    const vb = getValue(b);
    if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * dir;
    return ((va as number) - (vb as number)) * dir;
  });

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="mb-6">
        <h1
          className="text-2xl md:text-3xl font-bold mb-1"
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
          Harris Autonomous Trading — Stocks, Weather Markets, Crypto
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
              \u20BF Crypto Price Tickers
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
              {priceLoading ? "Loading..." : priceError ? "Error" : "Live via CoinGecko"}
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
                  {priceLoading ? "\u2014" : priceError ? "N/A" : price ? (isDemoMode ? "$XX,XXX" : formatPrice(price)) : "\u2014"}
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

      {/* Weather Trading Section — Live Data */}
      <div
        className="rounded-xl overflow-hidden mb-6"
        style={{ backgroundColor: "var(--card)", border: "1px solid #f59e0b30" }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-3">
            <div className="accent-line" />
            <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}>
              {"\u{1F329}\uFE0F"} Weather Trading
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {weatherLastRefresh && (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {weatherLastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <button
              onClick={fetchWeatherData}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded"
              style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              <RefreshCw className="w-3 h-3" />
            </button>
            {hasLiveTrades && (
              <button
                onClick={() => setShowPaperTrades((v) => !v)}
                className="text-xs px-2 py-1 rounded"
                style={{
                  backgroundColor: showPaperTrades ? "#f59e0b20" : "var(--card-elevated)",
                  border: `1px solid ${showPaperTrades ? "#f59e0b40" : "var(--border)"}`,
                  color: showPaperTrades ? "#f59e0b" : "var(--text-secondary)",
                }}
              >
                {showPaperTrades ? "Hide Paper Trades" : "Show Paper Trades"}
              </button>
            )}
            <span className="text-xs px-2 py-1 rounded" style={{
              backgroundColor: hasLiveTrades ? "#4ade8020" : ls ? "#f59e0b20" : "#f59e0b20",
              color: hasLiveTrades ? "#4ade80" : ls ? "#f59e0b" : "#f59e0b",
            }}>
              {hasLiveTrades ? "Live on Kalshi" : ls ? "Paper Trading" : "Research Phase"}
            </span>
          </div>
        </div>
        <div className="p-4">
          {/* Portfolio Summary Bar */}
          {ls && (
            <div
              className="flex flex-wrap items-center gap-4 p-4 rounded-xl mb-4"
              style={{ backgroundColor: "#f59e0b08", border: "1px solid #f59e0b25" }}
            >
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4" style={{ color: "#f59e0b" }} />
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "#f59e0b" }}>Portfolio</span>
              </div>
              <div className="flex flex-wrap items-center gap-6">
                <div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>Deposited</div>
                  <div className="text-sm font-bold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-muted)" }}>
                    {$((ls as Record<string, unknown>).initialDeposit as number ?? 1000)}
                  </div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>Positions</div>
                  <div className="text-sm font-bold" style={{ fontFamily: "var(--font-heading)", color: "#f59e0b" }}>
                    {$(ls.openExposure)}
                  </div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>Cash</div>
                  <div className="text-sm font-bold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}>
                    {$(cashAvailable)}
                  </div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>Total Value</div>
                  <div className="text-sm font-bold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}>
                    {$(ls.bankroll)}
                  </div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>Realized P&L</div>
                  <div className="text-sm font-bold" style={{
                    fontFamily: "var(--font-heading)",
                    color: ls.totalPnl >= 0 ? "#4ade80" : "#ef4444",
                  }}>
                    {$(ls.totalPnl)}
                  </div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>Record</div>
                  <div className="text-sm font-bold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}>
                    <span style={{ color: "#4ade80" }}>{ls.won}W</span>
                    {" \u2014 "}
                    <span style={{ color: "#ef4444" }}>{ls.lost}L</span>
                  </div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>Open</div>
                  <div className="text-sm font-bold" style={{ fontFamily: "var(--font-heading)", color: "#f59e0b" }}>
                    {ls.openTrades}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* T2 Agent Status */}
          <div
            className="flex items-center gap-4 p-4 rounded-xl mb-4"
            style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
          >
            <AgentAvatar agentId="t2" size={48} borderWidth={2} />
            <div className="flex-1">
              <div className="font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
                Nimbus — Weather Prediction Trader
              </div>
              <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                Weather data and Polymarket/Kalshi signal generation
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-xs px-2 py-0.5 rounded font-medium" style={{
                  backgroundColor: hasLiveTrades ? "#4ade8020" : ls ? "#f59e0b20" : "#6b728020",
                  color: hasLiveTrades ? "#4ade80" : ls ? "#f59e0b" : "#9ca3af",
                }}>
                  {hasLiveTrades ? "Live on Kalshi" : ls ? "Paper Trading" : "Not Deployed"}
                </span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Credentials configured
                </span>
              </div>
            </div>
            <Link
              href="/files?path=/Users/timharris/.openclaw/workspace/projects/weather-trading"
              className="text-sm flex items-center gap-1.5 px-3 py-2 rounded-lg"
              style={{ backgroundColor: "#f59e0b15", color: "#f59e0b", border: "1px solid #f59e0b30" }}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Project Files
            </Link>
          </div>

          {/* Filter bar */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            {showPaperTrades && hasLiveTrades && (
              <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: "#f59e0b15", color: "#f59e0b", border: "1px solid #f59e0b30" }}>
                Showing all trades — including paper
              </span>
            )}
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Version:</label>
              <select
                value={versionFilter}
                onChange={(e) => setVersionFilter(e.target.value)}
                className="text-xs px-2 py-1 rounded"
                style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              >
                <option value="all">All Versions</option>
                {allVersions.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Date:</label>
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="text-xs px-2 py-1 rounded"
                style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              >
                <option value="all">All Dates</option>
                {allDates.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            {(versionFilter !== "all" || dateFilter !== "all") && (
              <button
                onClick={() => { setVersionFilter("all"); setDateFilter("all"); }}
                className="text-xs px-2 py-1 rounded"
                style={{ backgroundColor: "#ef444420", color: "#ef4444", border: "1px solid #ef444430" }}
              >
                Clear Filters
              </button>
            )}
          </div>

          {/* Stats cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="p-4 rounded-xl text-center" style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}>
              <div className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>Bankroll</div>
              <div className="text-xl font-bold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}>
                {$(ls?.bankroll)}
              </div>
            </div>
            <div className="p-4 rounded-xl text-center" style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}>
              <div className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>Win Rate</div>
              <div className="text-xl font-bold" style={{ fontFamily: "var(--font-heading)", color: ls && ls.winRate > 50 ? "#4ade80" : "var(--text-primary)" }}>
                {ls ? `${ls.winRate.toFixed(1)}%` : "\u2014"}
              </div>
            </div>
            <div className="p-4 rounded-xl text-center" style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}>
              <div className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>Open Positions</div>
              <div className="text-xl font-bold" style={{ fontFamily: "var(--font-heading)", color: ls?.openTrades ? "#f59e0b" : "var(--text-primary)" }}>
                {ls?.openTrades ?? "\u2014"}
              </div>
            </div>
            <div className="p-4 rounded-xl text-center" style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}>
              <div className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>Total Trades</div>
              <div className="text-xl font-bold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}>
                {ls?.totalTrades ?? "\u2014"}
              </div>
            </div>
          </div>

          {/* Open Positions Table */}
          {positions.length > 0 && (() => {
            const colDefs: { label: string; key: SortKey | "" }[] = [
              ...(showPaperTrades ? [{ label: "", key: "" as SortKey | "" }] : []),
              { label: "Placed", key: "placed" },
              { label: "City", key: "city" },
              { label: "Bet", key: "bet" },
              { label: "Side", key: "side" },
              { label: "Bought", key: "price" },
              { label: "Qty", key: "qty" },
              { label: "Cost", key: "cost" },
              { label: "Payout", key: "win" },
              { label: "Edge", key: "edge" },
              { label: "Settles", key: "settles" },
              { label: "Remaining", key: "remaining" },
              { label: "Version", key: "version" },
            ];
            return (
            <div className="rounded-xl mb-4 overflow-hidden" style={{ border: "1px solid #f59e0b20" }}>
              <div className="flex items-center gap-2 px-4 py-3" style={{ backgroundColor: "#f59e0b08", borderBottom: "1px solid #f59e0b20" }}>
                <Target className="w-4 h-4" style={{ color: "#f59e0b" }} />
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Open Positions ({positions.length}){showPaperTrades && hasLiveTrades && " — including paper"}
                </span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {colDefs.map((col, i) => (
                        <th
                          key={col.label || `empty-${i}`}
                          className="text-xs font-bold uppercase tracking-wider px-3 py-2.5 text-left"
                          style={{
                            color: sortKey === col.key ? "#f59e0b" : "var(--text-muted)",
                            backgroundColor: "var(--card-elevated)",
                            cursor: col.key ? "pointer" : "default",
                            userSelect: "none",
                            whiteSpace: "nowrap",
                          }}
                          onClick={() => col.key && toggleSort(col.key as SortKey)}
                        >
                          {col.label}
                          {col.key && sortKey === col.key && (
                            <span style={{ marginLeft: 4 }}>{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPositions.map((pos) => {
                      const potentialWin = (pos.quantity * 1) - pos.cost;
                      const isZeroEdge = Math.abs(pos.edge * 100) < 0.05;
                      return (
                      <tr
                        key={pos.trade_id}
                        style={{
                          borderBottom: "1px solid var(--border)",
                          opacity: pos.trade_type === "paper" ? 0.6 : 1,
                        }}
                        className="hover:opacity-80"
                      >
                        {showPaperTrades && (
                          <td className="px-3 py-2">
                            {pos.trade_type === "paper" ? (
                              <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "#f59e0b15", color: "#f59e0b", border: "1px solid #f59e0b30" }}>
                                PAPER
                              </span>
                            ) : (
                              <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "#4ade8015", color: "#4ade80", border: "1px solid #4ade8030" }}>
                                LIVE
                              </span>
                            )}
                          </td>
                        )}
                        <td className="px-3 py-2">
                          <span className="text-xs" style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                            {friendlyDatetime(pos.created_at)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                            {capitalize(pos.city)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-xs font-medium" style={{ color: "#f59e0b" }}>
                            {parseBetDescription(pos.ticker, pos.side, pos.threshold)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className="text-xs font-bold px-2 py-0.5 rounded"
                            style={{
                              backgroundColor: pos.side === "yes" ? "#4ade8018" : "#ef444418",
                              color: pos.side === "yes" ? "#4ade80" : "#ef4444",
                            }}
                          >
                            {pos.side.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-xs font-mono" style={{ color: "var(--text-primary)" }}>
                            {isDemoMode ? "XX¢" : `${(pos.price * 100).toFixed(0)}¢`}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{isDemoMode ? "XX" : pos.quantity}</span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                            {$(pos.cost)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-xs font-semibold" style={{ color: "#4ade80" }}>
                            {isDemoMode ? "$X.XX" : `$${potentialWin.toFixed(2)}`}
                          </span>
                          <span className="text-xs ml-1" style={{ color: "#ef4444" }}>
                            / {isDemoMode ? "$X.XX" : `-$${pos.cost.toFixed(2)}`}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className="text-xs font-bold px-1.5 py-0.5 rounded"
                            style={{
                              backgroundColor: isZeroEdge ? "#ef444418" : `${edgeColor(pos.edge)}15`,
                              color: isZeroEdge ? "#ef4444" : edgeColor(pos.edge),
                            }}
                          >
                            {(pos.edge * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-xs" style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                            {friendlyDatetime(pos.settlement_scheduled_at)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-xs font-medium" style={{
                            color: (() => {
                              const settleStr = pos.settlement_scheduled_at;
                              if (!settleStr) return "var(--text-muted)";
                              const d = new Date(settleStr.includes("T") ? settleStr : settleStr + "Z");
                              const diff = d.getTime() - Date.now();
                              if (diff <= 0) return "#f59e0b";
                              if (diff < 3600000) return "#ef4444";
                              if (diff < 86400000) return "#f59e0b";
                              return "var(--text-secondary)";
                            })(),
                            whiteSpace: "nowrap",
                          }}>
                            {timeRemaining(pos.settlement_scheduled_at)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded" style={{
                            backgroundColor: (pos.strategy_version || "").includes("v0.9") ? "#ef444415" : "#4ade8015",
                            color: (pos.strategy_version || "").includes("v0.9") ? "#ef4444" : "#4ade80",
                          }}>
                            {pos.strategy_version || "—"}
                          </span>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            );
          })()}

          {/* Settled Trades */}
          {resolvedPositions.length > 0 && (
            <div className="rounded-xl mb-4 overflow-hidden" style={{ border: "1px solid #f59e0b20" }}>
              <div className="flex items-center gap-2 px-4 py-3" style={{ backgroundColor: "#f59e0b08", borderBottom: "1px solid #f59e0b20" }}>
                <CheckCircle className="w-4 h-4" style={{ color: "#f59e0b" }} />
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Settled Trades ({resolvedPositions.length})
                </span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {["", ...(showPaperTrades ? [""] : []), "City", "Bet", "Side", "Outcome", "Actual Temp", "P&L", "Resolved"].map((h) => (
                        <th
                          key={h}
                          className="text-xs font-bold uppercase tracking-wider px-3 py-2.5 text-left"
                          style={{ color: "var(--text-muted)", backgroundColor: "var(--card-elevated)" }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resolvedPositions.map((rp) => {
                      const isWin = rp.status === "won";
                      const displayOutcome = rp.trade_type === "live"
                        ? (rp.market_result || rp.actual_outcome)
                        : rp.actual_outcome;
                      const displayTemp = rp.trade_type === "live" ? null : rp.actual_temp;
                      return (
                        <tr
                          key={rp.trade_id}
                          style={{
                            borderBottom: "1px solid var(--border)",
                            backgroundColor: isWin ? "#4ade8008" : "#ef444408",
                            opacity: rp.trade_type === "paper" ? 0.6 : 1,
                          }}
                          className="hover:opacity-80"
                        >
                          <td className="px-3 py-2 text-center">
                            <span className="text-sm">{isWin ? "\u2705" : "\u274C"}</span>
                          </td>
                          {showPaperTrades && (
                            <td className="px-3 py-2">
                              {rp.trade_type === "paper" ? (
                                <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "#f59e0b15", color: "#f59e0b", border: "1px solid #f59e0b30" }}>
                                  PAPER
                                </span>
                              ) : (
                                <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "#4ade8015", color: "#4ade80", border: "1px solid #4ade8030" }}>
                                  LIVE
                                </span>
                              )}
                            </td>
                          )}
                          <td className="px-3 py-2">
                            <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                              {capitalize(rp.city)}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className="text-xs font-medium" style={{ color: "#f59e0b" }}>
                              {parseBetDescription(rp.ticker, rp.side, rp.threshold)}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className="text-xs font-bold px-2 py-0.5 rounded"
                              style={{
                                backgroundColor: rp.side === "yes" ? "#4ade8018" : "#ef444418",
                                color: rp.side === "yes" ? "#4ade80" : "#ef4444",
                              }}
                            >
                              {rp.side.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className="text-xs font-bold px-2 py-0.5 rounded"
                              style={{
                                backgroundColor: displayOutcome === "YES" ? "#4ade8018" : displayOutcome === "NO" ? "#ef444418" : "#6b728018",
                                color: displayOutcome === "YES" ? "#4ade80" : displayOutcome === "NO" ? "#ef4444" : "#9ca3af",
                              }}
                            >
                              {displayOutcome ?? "\u2014"}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className="text-xs font-mono" style={{ color: "var(--text-secondary)" }}>
                              {displayTemp != null ? `${displayTemp.toFixed(1)}\u00B0F` : "\u2014"}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className="text-xs font-bold"
                              style={{ color: isWin ? "#4ade80" : "#ef4444" }}
                            >
                              {$(rp.pnl)}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                              {shortTime(rp.resolved_at)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* City Breakdown */}
          {cityBreakdown.length > 0 && (
            <div className="rounded-xl mb-4 overflow-hidden" style={{ border: "1px solid #f59e0b20" }}>
              <div className="flex items-center gap-2 px-4 py-3" style={{ backgroundColor: "#f59e0b08", borderBottom: "1px solid #f59e0b20" }}>
                <MapPin className="w-4 h-4" style={{ color: "#f59e0b" }} />
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  City Breakdown
                </span>
              </div>
              <div className="p-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {cityBreakdown.map((city) => {
                  const maxDeployed = Math.max(...cityBreakdown.map((c) => c.total_deployed), 1);
                  const barPct = (city.total_deployed / maxDeployed) * 100;
                  return (
                    <div
                      key={city.city}
                      className="relative p-3 rounded-lg overflow-hidden"
                      style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
                    >
                      {/* Background bar */}
                      <div
                        className="absolute inset-0 opacity-10"
                        style={{
                          background: `linear-gradient(90deg, #f59e0b ${barPct}%, transparent ${barPct}%)`,
                        }}
                      />
                      <div className="relative flex items-center justify-between">
                        <div>
                          <div className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                            {capitalize(city.city)}
                          </div>
                          <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                            {city.trade_count} trade{city.trade_count !== 1 ? "s" : ""}
                            {city.open_count > 0 && (
                              <span style={{ color: "#f59e0b" }}>, {city.open_count} open</span>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                            {$(city.total_deployed)}
                          </div>
                          <div className="text-xs" style={{
                            color: city.realized_pnl > 0 ? "#4ade80" : city.realized_pnl < 0 ? "#ef4444" : "var(--text-muted)",
                          }}>
                            {isDemoMode ? maskDollar(city.realized_pnl) : (city.realized_pnl !== 0 ? `${city.realized_pnl >= 0 ? "+" : ""}$${city.realized_pnl.toFixed(2)}` : "$0.00")} P&L
                          </div>
                          {(city.won > 0 || city.lost > 0) && (
                            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                              <span style={{ color: "#4ade80" }}>{city.won}W</span>{" / "}
                              <span style={{ color: "#ef4444" }}>{city.lost}L</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Backtest Results (from summary.json) */}
          {weatherStats?.summary && (
            <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: "#f59e0b08", border: "1px solid #f59e0b20" }}>
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-4 h-4" style={{ color: "#f59e0b" }} />
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Backtest Results
                </span>
                {weatherStats.backtestPeriod && (
                  <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: "#f59e0b15", color: "#f59e0b" }}>
                    {weatherStats.backtestPeriod.days}d, {weatherStats.backtestPeriod.start} to {weatherStats.backtestPeriod.end}
                  </span>
                )}
                {weatherStats.backtestStatus === "pass" && (
                  <CheckCircle className="w-3.5 h-3.5" style={{ color: "#4ade80" }} />
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>Brier Score</div>
                  <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{weatherStats.summary.brier_score.toFixed(4)}</div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>Sharpe Ratio</div>
                  <div className="text-sm font-bold" style={{ color: "#4ade80" }}>{weatherStats.summary.sharpe_ratio.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>Win Rate (BT)</div>
                  <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{(weatherStats.summary.win_rate * 100).toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>Total Bets (BT)</div>
                  <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{weatherStats.summary.total_bets.toLocaleString()}</div>
                </div>
              </div>
            </div>
          )}

          {/* Weather Trading Panels */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Open Exposure */}
            <div
              className="p-4 rounded-xl"
              style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-center gap-2 mb-3">
                <Link2 className="w-4 h-4" style={{ color: "#f59e0b" }} />
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Open Exposure</span>
              </div>
              <div className="text-center py-4">
                <div className="text-2xl font-bold mb-1" style={{ fontFamily: "var(--font-heading)", color: ls?.openExposure ? "#f59e0b" : "var(--text-muted)" }}>
                  {$(ls?.openExposure)}
                </div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {ls?.openTrades ?? 0} open position{(ls?.openTrades ?? 0) !== 1 ? "s" : ""}
                </div>
                <div className="text-xs mt-2 px-2 py-1 rounded" style={{ backgroundColor: "#f59e0b10", color: "#f59e0b" }}>
                  Kalshi + Polymarket
                </div>
              </div>
            </div>

            {/* Win/Loss Record */}
            <div
              className="p-4 rounded-xl"
              style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4" style={{ color: "#f59e0b" }} />
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Record</span>
              </div>
              <div className="text-center py-4">
                {ls ? (
                  <>
                    <div className="flex items-center justify-center gap-3 mb-1">
                      <span className="text-sm font-bold" style={{ color: "#4ade80" }}>{ls.won}W</span>
                      <span className="text-sm" style={{ color: "var(--text-muted)" }}>\u2014</span>
                      <span className="text-sm font-bold" style={{ color: "#ef4444" }}>{ls.lost}L</span>
                    </div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {ls.totalTrades} total trades
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-3xl mb-1" style={{ color: "var(--text-muted)" }}>{"\u{1F50D}"}</div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>Awaiting deployment</div>
                  </>
                )}
                <div className="text-xs mt-2 px-2 py-1 rounded" style={{ backgroundColor: "#f59e0b10", color: "#f59e0b" }}>
                  Weather-informed market edge
                </div>
              </div>
            </div>

            {/* Total P&L */}
            <div
              className="p-4 rounded-xl"
              style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="w-4 h-4" style={{ color: "#4ade80" }} />
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{showPaperTrades ? "Paper" : "Kalshi"} P&L</span>
              </div>
              <div className="text-center py-4">
                <div className="text-2xl font-bold mb-1" style={{
                  fontFamily: "var(--font-heading)",
                  color: ls?.totalPnl
                    ? ls.totalPnl >= 0 ? "#4ade80" : "#ef4444"
                    : "var(--text-muted)",
                }}>
                  {$(ls?.totalPnl)}
                </div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {showPaperTrades ? "Paper trading P&L" : "Real money on Kalshi"}
                </div>
                <div className="text-xs mt-2 px-2 py-1 rounded" style={{ backgroundColor: "#4ade8010", color: "#4ade80" }}>
                  {ls ? "Live stats from DB" : "Live when deployed"}
                </div>
              </div>
            </div>
          </div>

          {/* Recent Trades */}
          {ls?.recentTrades && ls.recentTrades.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-bold mb-2 uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Recent Trades
              </div>
              <div className="space-y-1.5">
                {ls.recentTrades.map((trade) => (
                  <div
                    key={trade.trade_id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg text-xs"
                    style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-bold" style={{ color: trade.side === "yes" ? "#4ade80" : "#ef4444" }}>
                        {trade.side.toUpperCase()}
                      </span>
                      <span style={{ color: "var(--text-primary)" }}>{trade.city}</span>
                      <span style={{ color: "var(--text-muted)" }}>{trade.target_date}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span style={{ color: "var(--text-secondary)" }}>{$(trade.cost)}</span>
                      <span className="font-medium px-1.5 py-0.5 rounded" style={{
                        backgroundColor: trade.status === "open" ? "#f59e0b15" : trade.status === "won" ? "#4ade8015" : "#ef444415",
                        color: trade.status === "open" ? "#f59e0b" : trade.status === "won" ? "#4ade80" : "#ef4444",
                      }}>
                        {trade.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Strategy Architect — Quant */}
      <div
        className="rounded-xl overflow-hidden mb-6"
        style={{ backgroundColor: "var(--card)", border: "1px solid #10b98130" }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-3">
            <div className="accent-line" />
            <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}>
              {"\u{1F4CA}"} Strategy Architect
            </h2>
          </div>
          <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: "#6b728020", color: "#9ca3af" }}>
            Not Deployed
          </span>
        </div>
        <div className="p-4">
          <div
            className="flex items-center gap-4 p-4 rounded-xl mb-4"
            style={{ backgroundColor: "var(--card-elevated)", border: "1px solid #10b98120" }}
          >
            <AgentAvatar agentId="quant" size={48} borderWidth={2} />
            <div className="flex-1">
              <div className="font-bold" style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}>
                Quant — Trading Strategy Architect
              </div>
              <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                Designs strategies, backtests, optimizes. The quant research brain behind the Trading Desk.
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ backgroundColor: "#6b728020", color: "#9ca3af" }}>
                  Not Deployed
                </span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Model TBD
                </span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-4 rounded-xl" style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}>
              <div className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>Strategy Design</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                Quant architects every trading strategy — Atlas, Nimbus, and Cipher execute what Quant designs.
              </div>
            </div>
            <div className="p-4 rounded-xl" style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}>
              <div className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>Backtesting Engine</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                Historical simulation, walk-forward validation, Monte Carlo analysis, Sharpe/drawdown optimization.
              </div>
            </div>
            <div className="p-4 rounded-xl" style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}>
              <div className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>Continuous Optimization</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                Applies Karpathy Loop to strategies — measure, iterate, improve. Never idle, always refining.
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
                  <AgentAvatar agentId={trader.id} size={48} borderWidth={2} />
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

        {/* Trading Bot Project Links */}
        <div
          className="rounded-xl p-5 md:col-span-2"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <FolderOpen className="w-5 h-5" style={{ color: "#f59e0b" }} />
            <h3 className="font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}>
              Trading Bot Projects
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              {
                name: "Cipher — Crypto Bot",
                agentId: "t3",
                emoji: "\u20BF",
                color: "#f59e0b",
                path: "/Users/timharris/.openclaw/workspace/projects/crypto-trading",
                status: "Building",
              },
              {
                name: "Nimbus — Weather Trading",
                agentId: "t2",
                emoji: "\u{1F324}\uFE0F",
                color: "#f59e0b",
                path: "/Users/timharris/.openclaw/workspace/projects/weather-trading",
                status: ls ? "Paper Trading" : "Research",
              },
              {
                name: "Karpathy Loop",
                agentId: null,
                emoji: "\u{1F52C}",
                color: "#f59e0b",
                path: "/Users/timharris/.openclaw/workspace/projects/karpathy-loop",
                status: "Design",
              },
            ].map((project) => (
              <Link
                key={project.name}
                href={`/files?path=${encodeURIComponent(project.path)}`}
                className="flex items-center gap-3 p-4 rounded-xl transition-all hover:scale-[1.01]"
                style={{ backgroundColor: "var(--card-elevated)", border: `1px solid ${project.color}30` }}
              >
                {project.agentId ? (
                  <AgentAvatar agentId={project.agentId} size={40} borderWidth={2} />
                ) : (
                  <span className="text-2xl">{project.emoji}</span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{project.name}</div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Circle className="w-1.5 h-1.5" style={{ fill: project.color, color: project.color }} />
                    <span className="text-xs font-medium" style={{ color: project.color }}>{project.status}</span>
                  </div>
                </div>
                <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
