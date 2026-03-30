"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  DollarSign,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Clock,
  Filter,
  X,
} from "lucide-react";
import { useDemoMode, maskDollar } from "@/lib/demo-mode";

/* ═══════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════ */

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
  raw_status?: string;
  settlement_scheduled_at: string | null;
  created_at: string;
  trade_type: "live" | "paper";
  strategy_version: string | null;
  our_probability: number | null;
  market_probability: number | null;
  pnl?: number;
  payout?: number;
  actual_outcome?: string | null;
  actual_temp?: number | null;
  resolved_at?: string | null;
  now_price?: number | null;
  fees?: number;
  fills?: { fill_id: string; order_id: string; ticker: string; side: string; action: string; quantity: number; yes_price: number; no_price: number; fee: number; is_taker: number; filled_at: string }[];
}

interface PositionsData {
  positions: Position[];
  resolvedPositions: Position[];
  cityBreakdown: unknown[];
  liveCityBreakdown: unknown[];
  paperCityBreakdown: unknown[];
}

interface WeatherStats {
  available: boolean;
  kalshiStats?: {
    totalTrades: number;
    openTrades: number;
    won: number;
    lost: number;
    winRate: number;
    totalPnl: number;
    openExposure: number;
    bankroll: number | null;
    initialDeposit?: number;
    versionBreakdown?: { strategy_version: string; total: number; open: number; won: number; lost: number; pnl: number }[];
  } | null;
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */

function capitalize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function cityCode(city: string): string {
  const codes: Record<string, string> = {
    austin: "AUS", miami: "MIA", new_york: "NYC", chicago: "CHI",
    denver: "DEN", seattle: "SEA", los_angeles: "LAX", phoenix: "PHX",
    houston: "HOU", atlanta: "ATL", oklahoma_city: "OKC",
    washington_dc: "DC", boston: "BOS", san_antonio: "SAN",
    dallas: "DAL", minneapolis: "MIN", new_orleans: "MSY",
    san_francisco: "SFO",
  };
  return codes[city.toLowerCase()] || city.slice(0, 3).toUpperCase();
}

function parseBetDescription(ticker: string, side: string, threshold?: number | null): string {
  const isHigh = /HIGH/i.test(ticker);
  const metric = isHigh ? "High" : "Low";
  const bracketMatch = ticker.match(/-B([\d.]+)$/);
  if (bracketMatch) {
    const base = parseFloat(bracketMatch[1]);
    return side.toLowerCase() === "yes"
      ? `${base}–${base + 2}°F`
      : `Outside ${base}–${base + 2}°F`;
  }
  const threshMatch = ticker.match(/-T([\d.]+)$/);
  const t = threshMatch ? parseFloat(threshMatch[1]) : threshold;
  if (t != null) {
    return side.toLowerCase() === "yes"
      ? `${metric} ≥ ${t}°F`
      : `${metric} < ${t}°F`;
  }
  return `${metric} ${side.toUpperCase()}`;
}

function friendlyDatetime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "Z");
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function timeRemaining(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "Z");
  if (isNaN(d.getTime())) return "—";
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return "Settling...";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs < 24) return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
  const days = Math.floor(hrs / 24);
  const remHrs = hrs % 24;
  return remHrs > 0 ? `${days}d ${remHrs}h` : `${days}d`;
}

function pctDisplay(val: number | null | undefined): string {
  if (val == null) return "—";
  return `${(val * 100).toFixed(0)}%`;
}

/* ═══════════════════════════════════════════════════════════════
   GROUPED POSITION TYPE
   ═══════════════════════════════════════════════════════════════ */

interface GroupedPosition {
  city: string;
  marketLabel: string;
  ticker: string;
  side: string;
  trades: Position[];
  totalQuantity: number;
  totalCost: number;
  avgPrice: number;
  boughtProbability: number | null;
  payoutIfWin: number;
  settlementAt: string | null;
  targetDate: string;
  strategyVersion: string;
  forecast: number | null;
  edge: number;
  nowPrice: number | null;
  placedAt: string;
}

/* ═══════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════ */

export default function TradingFloorPage() {
  const { isDemoMode } = useDemoMode();
  const $ = (val: number | null | undefined, prefix = "$") =>
    isDemoMode ? maskDollar(val, prefix) : val == null ? "—" : `${prefix}${val.toFixed(2)}`;

  const [kalshiPortfolio, setKalshiPortfolio] = useState<{
    cash: number; positions: number; portfolio: number; initialDeposit: number;
    pnl: number; pnlPercent: number; won: number; lost: number;
    realizedPnl: number; unrealizedPnl: number; pnl24h: number; portfolio24hAgo: number | null; totalFees: number;
    costBasis: number; positionsCount: number;
    versionBreakdown: { strategy_version: string; total: number; open: number; won: number; lost: number;
      realized_pnl: number; unrealized_pnl: number; total_pnl: number; open_cost: number; total_cost: number }[];
  } | null>(null);
  const [weatherStats, setWeatherStats] = useState<WeatherStats | null>(null);
  const [positionsData, setPositionsData] = useState<PositionsData | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [versionBreakdownOpen, setVersionBreakdownOpen] = useState(false);
  const [versionFilter, setVersionFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all"); // all | open | settled
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const [sortMode, setSortMode] = useState<"city" | "placed" | "settles">("placed");
  const [sortAsc, setSortAsc] = useState<Record<string, boolean>>({ placed: false, settles: true, city: true });
  const [liveForecasts, setLiveForecasts] = useState<Record<string, Record<string, { high: number; low: number }>>>({});
  const [currentTemps, setCurrentTemps] = useState<Record<string, { tempF: number; ageMinutes: number; stationId: string }>>({});
  const [forecastFetchedAt, setForecastFetchedAt] = useState<string | null>(null);
  const [actualHighs, setActualHighs] = useState<Record<string, { high: number; low: number; highAt: string; lowAt: string }>>({});

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, posRes, portfolioRes, forecastRes, tempsRes] = await Promise.all([
        fetch("/api/trading/weather-stats"),
        fetch("/api/trading/kalshi-positions"),
        fetch("/api/trading/kalshi-portfolio"),
        fetch("/api/trading/live-forecasts"),
        fetch("/api/trading/current-temps"),
      ]);
      if (forecastRes.ok) {
        const fData = await forecastRes.json();
        if (fData.forecasts) setLiveForecasts(fData.forecasts);
        if (fData.fetchedAt) setForecastFetchedAt(fData.fetchedAt);
      }
      if (tempsRes.ok) {
        const tData = await tempsRes.json();
        if (tData.observations) setCurrentTemps(tData.observations);
      }
      try {
        const actualsRes = await fetch("/api/trading/actual-highs");
        if (actualsRes.ok) {
          const aData = await actualsRes.json();
          if (aData.actuals) setActualHighs(aData.actuals);
        }
      } catch { /* skip */ }
      const statsData = await statsRes.json();
      const posData = await posRes.json();
      setWeatherStats(statsData);
      setPositionsData({
        positions: posData.positions || [],
        resolvedPositions: posData.resolved || [],
        cityBreakdown: [],
        liveCityBreakdown: [],
        paperCityBreakdown: [],
      });
      if (portfolioRes.ok) {
        const pData = await portfolioRes.json();
        if (!pData.error) setKalshiPortfolio(pData);
      }
      setLastRefresh(new Date());
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    intervalRef.current = setInterval(fetchData, 60000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchData]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const ks = weatherStats?.kalshiStats;
  const kp = kalshiPortfolio;
  const deposit = kp?.initialDeposit ?? 1000;
  const allPositions = positionsData?.positions ?? [];
  const allResolved = positionsData?.resolvedPositions ?? [];

  // Only live trades (kalshi-positions API returns only live, so accept missing trade_type too)
  const livePositions = allPositions.filter((p) => !p.trade_type || p.trade_type === "live");
  const liveResolved = allResolved.filter((p) => !p.trade_type || p.trade_type === "live");

  // Combine for filtering
  const allTrades = [...livePositions, ...liveResolved];

  // Normalize: "filled"/"resting"/"pending" → treat as open
  const isOpenStatus = (s: string) => ["open", "filled", "resting", "pending"].includes(s);
  
  // Apply filters
  const filtered = allTrades.filter((t) => {
    if (versionFilter !== "all" && (t.strategy_version || "unknown") !== versionFilter) return false;
    if (dateFilter !== "all" && t.target_date !== dateFilter) return false;
    if (statusFilter === "open" && !isOpenStatus(t.status)) return false;
    if (statusFilter === "settled" && isOpenStatus(t.status)) return false;
    return true;
  });

  // Unique filter values
  const versions = [...new Set(allTrades.map((t) => t.strategy_version || "unknown"))].sort();
  const dates = [...new Set(allTrades.map((t) => t.target_date))].filter(Boolean).sort();

  // Group by city + market (ticker base)
  const groupMap = new Map<string, GroupedPosition>();
  for (const t of filtered) {
    // Group key: city + bet description + target date (different dates = different contracts)
    const betDesc = parseBetDescription(t.ticker, t.side, t.threshold);
    const key = `${t.city}|${betDesc}|${t.side}|${t.target_date}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        city: t.city,
        marketLabel: betDesc,
        ticker: t.ticker,
        side: t.side,
        trades: [],
        totalQuantity: 0,
        totalCost: 0,
        avgPrice: 0,
        boughtProbability: null,
        payoutIfWin: 0,
        settlementAt: t.settlement_scheduled_at,
        targetDate: t.target_date,
        strategyVersion: t.strategy_version || "unknown",
        forecast: t.forecast_mean,
        edge: 0,
        nowPrice: null,
        placedAt: t.created_at,
      });
    }
    const g = groupMap.get(key)!;
    g.trades.push(t);
    g.totalQuantity += t.quantity;
    g.totalCost += t.cost;
    if (t.our_probability != null) g.boughtProbability = t.our_probability;
    if (t.now_price != null) g.nowPrice = t.now_price;
    g.edge = t.edge;
    // Track earliest placed time and earliest settlement
    if (t.created_at && t.created_at < g.placedAt) g.placedAt = t.created_at;
    if (t.settlement_scheduled_at && (!g.settlementAt || t.settlement_scheduled_at < g.settlementAt)) {
      g.settlementAt = t.settlement_scheduled_at;
    }
  }

  // Compute derived values
  const groups = Array.from(groupMap.values()).map((g) => {
    g.avgPrice = g.totalQuantity > 0 ? g.totalCost / g.totalQuantity : 0;
    g.payoutIfWin = g.totalQuantity - g.totalCost;
    return g;
  });

  // Sort based on selected mode + direction
  const asc = sortAsc[sortMode];
  groups.sort((a, b) => {
    const aOpen = a.trades.some((t) => isOpenStatus(t.status));
    const bOpen = b.trades.some((t) => isOpenStatus(t.status));
    // Always keep open before settled
    if (aOpen !== bOpen) return aOpen ? -1 : 1;

    let cmp = 0;
    switch (sortMode) {
      case "placed":
        cmp = (a.placedAt || "").localeCompare(b.placedAt || "");
        break;
      case "settles":
        cmp = (a.settlementAt || "9999").localeCompare(b.settlementAt || "9999");
        break;
      case "city":
        cmp = a.city.localeCompare(b.city);
        if (cmp === 0) cmp = (a.settlementAt || "9999").localeCompare(b.settlementAt || "9999");
        break;
    }
    return asc ? cmp : -cmp;
  });

  // Stats for filtered set
  const filteredOpen = filtered.filter((t) => isOpenStatus(t.status));
  const filteredSettled = filtered.filter((t) => !isOpenStatus(t.status));
  const filteredWon = filteredSettled.filter((t) => t.status === "won" || (t.pnl != null && t.pnl > 0));
  const filteredLost = filteredSettled.filter((t) => t.status === "lost" || (t.pnl != null && t.pnl < 0));
  const filteredPnl = filteredSettled.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const filteredCost = filtered.reduce((sum, t) => sum + t.cost, 0);

  const hasFilters = versionFilter !== "all" || dateFilter !== "all" || statusFilter !== "all";

  return (
    <div className="p-4 md:p-8 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-2xl font-bold"
            style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)", letterSpacing: "-1px" }}
          >
            ⚡ Trading Floor
          </h1>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Weather Markets · Kalshi · Live Positions & History
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={fetchData}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
      </div>

      {/* ── Filters (above summary so they apply to everything) ── */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select
          value={versionFilter}
          onChange={(e) => setVersionFilter(e.target.value)}
          className="text-sm px-4 py-2 rounded-full font-medium"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", color: "var(--text-primary)", minWidth: 140 }}
        >
          <option value="all">All Versions</option>
          {versions.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="text-sm px-4 py-2 rounded-full font-medium"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", color: "var(--text-primary)", minWidth: 140 }}
        >
          <option value="all">All Dates</option>
          {dates.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm px-4 py-2 rounded-full font-medium"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", color: "var(--text-primary)", minWidth: 140 }}
        >
          <option value="all">All Status</option>
          <option value="open">Open Only</option>
          <option value="settled">Settled Only</option>
        </select>
        {hasFilters && (
          <button
            onClick={() => { setVersionFilter("all"); setDateFilter("all"); setStatusFilter("all"); }}
            className="flex items-center gap-1 text-sm px-4 py-2 rounded-full font-medium"
            style={{ backgroundColor: "#ef444415", color: "#ef4444", border: "1px solid #ef444430" }}
          >
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* ── Portfolio Summary (filter-aware) ────────────────── */}
      <div
        className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3"
      >
        {(() => {
          // When filters are active, show filtered stats instead of account-level
          if (hasFilters) {
            const fCost = filtered.reduce((s, t) => s + t.cost, 0);
            const fSettledPnl = filteredSettled.reduce((s, t) => s + (t.pnl ?? 0), 0);
            const fWR = (filteredWon.length + filteredLost.length) > 0 
              ? ((filteredWon.length / (filteredWon.length + filteredLost.length)) * 100).toFixed(0) 
              : "—";
            return [
              { label: "Positions", value: `${groups.length}`, color: "var(--text-primary)", bold: true,
                sub: `${filtered.length} orders` },
              { label: "Cash Deployed", value: $(fCost), color: "#60a5fa" },
              { label: "Realized P&L", value: filteredSettled.length > 0 ? $(fSettledPnl) : "$0.00",
                color: filteredSettled.length > 0 ? (fSettledPnl >= 0 ? "#4ade80" : "#ef4444") : "var(--text-muted)",
                sub: filteredSettled.length > 0 ? `${filteredWon.length}W – ${filteredLost.length}L` : "No settlements" },
              { label: "Win Rate", value: fWR !== "—" ? `${fWR}%` : "—",
                color: fWR !== "—" && parseInt(fWR) >= 50 ? "#4ade80" : "#ef4444",
                sub: fWR !== "—" ? `${filteredWon.length}W – ${filteredLost.length}L` : "No settlements" },
            ];
          }
          // No filters — show account-level summary
          return [
            { label: "Portfolio", value: kp ? $(kp.portfolio) : "—", color: "var(--text-primary)", bold: true,
              sub: kp ? (() => {
                if (kp.portfolio24hAgo != null) {
                  const change = kp.portfolio - kp.portfolio24hAgo;
                  return `${change >= 0 ? "▲" : "▼"} ${$(Math.abs(change))} (24h)`;
                }
                return `${kp.pnl24h >= 0 ? "▲" : "▼"} ${$(Math.abs(kp.pnl24h))} settled (24h)`;
              })() : undefined,
              subColor: kp ? (() => {
                if (kp.portfolio24hAgo != null) return (kp.portfolio - kp.portfolio24hAgo) >= 0 ? "#4ade80" : "#ef4444";
                return kp.pnl24h >= 0 ? "#4ade80" : "#ef4444";
              })() : undefined,
            },
            { label: "Positions", value: kp ? $(kp.positions) : "—", color: "#60a5fa",
            sub: kp ? `${new Set(livePositions.map(p => p.ticker)).size || kp.positionsCount} positions · Cost basis ${$(kp.costBasis)}` : undefined },
            { label: "Cash", value: kp ? $(kp.cash) : "—", color: "var(--text-primary)" },
            {
              label: "Win Rate",
              value: kp && (kp.won + kp.lost) > 0 ? `${((kp.won / (kp.won + kp.lost)) * 100).toFixed(0)}%` : "—",
              color: kp && (kp.won + kp.lost) > 0 && (kp.won / (kp.won + kp.lost)) >= 0.5 ? "#4ade80" : "#ef4444",
              sub: kp ? `${kp.won}W – ${kp.lost}L` : undefined,
            },
          ];
        })().map((item) => (
          <div
            key={item.label}
            className="p-4 rounded-xl"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
          >
            <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
              {item.label}
            </div>
            <div
              className={`text-lg ${item.bold ? "text-xl" : ""} font-bold`}
              style={{ fontFamily: "var(--font-heading)", color: item.color }}
            >
              {item.value}
            </div>
            {item.sub && (
              <div className="text-xs mt-0.5" style={{ color: (item as Record<string, unknown>).subColor as string || "var(--text-muted)" }}>{item.sub}</div>
            )}
          </div>
        ))}
      </div>

      {/* ── P&L Breakdown (filter-aware) ────────────────── */}
      {(() => {
        if (hasFilters) {
          // When filtered: show P&L only for filtered trades
          const fRealizedPnl = filteredSettled.reduce((s, t) => s + (t.pnl ?? 0), 0);
          return (
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="p-4 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
                <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Realized P&L</div>
                <div className="text-lg font-bold" style={{ fontFamily: "var(--font-heading)", color: filteredSettled.length > 0 ? (fRealizedPnl >= 0 ? "#4ade80" : "#ef4444") : "var(--text-muted)" }}>
                  {filteredSettled.length > 0 ? $(fRealizedPnl) : "$0.00"}
                </div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>{filteredSettled.length > 0 ? `${filteredWon.length}W – ${filteredLost.length}L` : "No settlements in filter"}</div>
              </div>
              <div className="p-4 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
                <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Unrealized P&L</div>
                <div className="text-lg font-bold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-muted)" }}>
                  TBD
                </div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>{groups.length} positions · Settles tonight</div>
              </div>
              <div className="p-4 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
                <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Total P&L</div>
                <div className="text-lg font-bold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-muted)" }}>
                  {filteredSettled.length > 0 ? $(fRealizedPnl) : "$0.00"}
                </div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>Filtered view</div>
              </div>
            </div>
          );
        }
        // No filter: show account-level P&L
        return (
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="p-4 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Realized P&L</div>
              <div className="text-lg font-bold" style={{ fontFamily: "var(--font-heading)", color: (kp?.realizedPnl ?? 0) >= 0 ? "#4ade80" : "#ef4444" }}>
                {kp ? $(kp.realizedPnl) : "—"}
              </div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>{kp ? `${kp.won + kp.lost} settled trades (${kp.won}W – ${kp.lost}L)` : "Settled trades"}</div>
            </div>
            <div className="p-4 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Unrealized P&L</div>
              <div className="text-lg font-bold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-muted)" }}>
                TBD
              </div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>Settles tonight — illiquid market prices unreliable</div>
            </div>
            <div className="p-4 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Total P&L</div>
              <div className="text-lg font-bold" style={{ fontFamily: "var(--font-heading)", color: (kp?.pnl ?? 0) >= 0 ? "#4ade80" : "#ef4444" }}>
                {kp ? $(kp.pnl) : "—"}
              </div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                {kp?.pnlPercent != null ? `${kp.pnlPercent.toFixed(1)}%` : ""}{kp?.totalFees ? ` · Fees: ${$(kp.totalFees)}` : ""}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Version Breakdown (collapsible, newest first) ── */}
      {kp?.versionBreakdown && kp.versionBreakdown.length > 0 && (
        <div className="mb-6 rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <button
            onClick={() => setVersionBreakdownOpen((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between text-left"
            style={{ backgroundColor: "var(--card)", borderBottom: versionBreakdownOpen ? "1px solid var(--border)" : undefined }}
          >
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4" style={{ color: "#a78bfa" }} />
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Strategy Version Breakdown</span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>({kp.versionBreakdown.length} versions)</span>
            </div>
            <div style={{ color: "var(--text-muted)" }}>
              {versionBreakdownOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </button>
          {versionBreakdownOpen && (
            <div>
              {/* Column headers */}
              <div className="px-4 py-2" style={{ backgroundColor: "var(--card-elevated)", borderBottom: "1px solid var(--border)", display: "grid", gridTemplateColumns: "1fr auto auto auto auto", gap: 32 }}>
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Version</span>
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)", minWidth: 90 }}>Deployed</span>
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)", minWidth: 90 }}>Realized</span>
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)", minWidth: 90 }}>Unrealized</span>
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)", minWidth: 90 }}>Total</span>
              </div>
              {/* Rows — newest version first */}
              {[...kp.versionBreakdown].sort((a, b) => (b.strategy_version || "").localeCompare(a.strategy_version || "")).map((v) => {
                const resolved = v.won + v.lost;
                const wr = resolved > 0 ? ((v.won / resolved) * 100).toFixed(0) : "—";
                const isBad = (v.strategy_version || "").includes("0.9");
                return (
                  <div
                    key={v.strategy_version}
                    className="px-4 py-3"
                    style={{
                      backgroundColor: isBad ? "#ef444406" : "#4ade8006",
                      borderBottom: "1px solid var(--border)",
                      display: "grid",
                      gridTemplateColumns: "1fr auto auto auto auto",
                      gap: 32,
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded"
                        style={{
                          backgroundColor: isBad ? "#ef444420" : "#4ade8020",
                          color: isBad ? "#ef4444" : "#4ade80",
                        }}
                      >
                        {v.strategy_version || "unknown"}
                      </span>
                      <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                        {v.total} trades · {v.open} open · {v.won}W/{v.lost}L · {wr}% WR
                      </div>
                    </div>
                    <div className="text-sm font-bold" style={{ color: "var(--text-primary)", minWidth: 90 }}>
                      {$(v.total_cost)}
                    </div>
                    <div className="text-sm font-bold" style={{ color: v.realized_pnl >= 0 ? "#4ade80" : "#ef4444", minWidth: 90 }}>
                      {$(v.realized_pnl)}
                    </div>
                    <div className="text-sm font-bold" style={{ color: v.unrealized_pnl >= 0 ? "#4ade80" : "#ef4444", minWidth: 90 }}>
                      {$(v.unrealized_pnl)}
                    </div>
                    <div className="text-sm font-bold" style={{ color: v.total_pnl >= 0 ? "#4ade80" : "#ef4444", minWidth: 90 }}>
                      {$(v.total_pnl)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Sort + Trade Count ─────────────────────────────── */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-0 rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          {(["placed", "settles", "city"] as const).map((mode) => {
            const isActive = sortMode === mode;
            const asc = sortAsc[mode];
            return (
              <button
                key={mode}
                onClick={() => {
                  if (sortMode === mode) {
                    setSortAsc((prev) => ({ ...prev, [mode]: !prev[mode] }));
                  } else {
                    setSortMode(mode);
                  }
                }}
                className="text-xs px-4 py-2 font-semibold"
                style={{
                  backgroundColor: isActive ? "#60a5fa" : "var(--card)",
                  color: isActive ? "#fff" : "var(--text-muted)",
                  borderRight: mode !== "city" ? "1px solid var(--border)" : undefined,
                  transition: "all 0.15s",
                }}
              >
                {mode === "placed" ? "Placed" : mode === "settles" ? "Settles" : "City"}
                {isActive && <span style={{ marginLeft: 4 }}>{asc ? "▲" : "▼"}</span>}
              </button>
            );
          })}
        </div>
        <span className="text-xs ml-auto" style={{ color: "var(--text-muted)" }}>
          {groups.length} positions · {filteredOpen.length} open · {filteredSettled.length} settled · {filteredWon.length}W/{filteredLost.length}L
        </span>
      </div>

      {/* ── Positions (Kalshi-style grouped) ──────────────── */}
      <div className="space-y-2">
        {groups.length === 0 && (
          <div className="text-center py-12 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>No trades match filters</p>
          </div>
        )}

        {groups.map((g) => {
          const key = `${g.city}|${g.marketLabel}|${g.side}`;
          const isExpanded = expandedGroups.has(key);
          const isOpen = g.trades.some((t) => isOpenStatus(t.status));
          const isSettled = g.trades.every((t) => !isOpenStatus(t.status));
          const isWon = isSettled && g.trades.some((t) => t.status === "won" || (t.pnl ?? 0) > 0);
          const isLost = isSettled && g.trades.some((t) => t.status === "lost" || (t.pnl ?? 0) < 0);
          const settledPnl = g.trades.reduce((s, t) => s + (!isOpenStatus(t.status) ? (t.pnl ?? 0) : 0), 0);
          // For countdown: use latest open trade's settlement (resolved trades have past dates that mislead)
          const displaySettlement = isOpen
            ? (g.trades
                .filter((t) => isOpenStatus(t.status) && t.settlement_scheduled_at)
                .map((t) => t.settlement_scheduled_at!)
                .sort()
                .pop() || g.settlementAt)
            : g.settlementAt;
          // Compute fees from trade-level fees first, fallback to summing fills
          const tradeFees = g.trades.reduce((s, t) => s + (Number(t.fees) || 0), 0);
          const fillFees = g.trades.reduce((s, t) => 
            s + (t.fills || []).reduce((fs: number, f: Record<string, unknown>) => fs + (Number(f.fee) || 0), 0), 0);
          const totalGroupFees = tradeFees > 0 ? tradeFees : fillFees;
          const boughtPct = g.avgPrice * 100;
          const isBadVersion = g.strategyVersion.includes("0.9");

          return (
            <div
              key={key}
              className="rounded-xl overflow-hidden"
              style={{
                backgroundColor: "var(--card)",
                border: `1px solid ${isWon ? "#4ade8040" : isLost ? "#ef444440" : "var(--border)"}`,
              }}
            >
              {/* Main row — Kalshi-style clean layout */}
              <button
                onClick={() => toggleGroup(key)}
                className="w-full px-4 py-3.5 text-left hover:opacity-90 transition-opacity"
                style={{
                  backgroundColor: isSettled ? (isWon ? "#4ade8008" : "#ef444408") : "transparent",
                  display: "grid",
                  gridTemplateColumns: "48px 1fr 60px 70px 80px 100px 110px 100px 28px",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                {/* City badge */}
                <div
                  className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: "#60a5fa15", border: "1px solid #60a5fa25" }}
                >
                  <span className="text-xs font-black tracking-wider" style={{ color: "#60a5fa" }}>
                    {cityCode(g.city)}
                  </span>
                </div>

                {/* Market info — "Yes • High ≥ 93°F in Phoenix Tomorrow" */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span style={{ color: g.side === "yes" ? "#4ade80" : "#ef4444", fontWeight: 700, fontSize: 14 }}>
                      {g.side === "yes" ? "Yes" : "No"}
                    </span>
                    <span style={{ color: "var(--text-primary)", fontSize: 15, lineHeight: "14px" }}>•</span>
                    <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {g.marketLabel} in {capitalize(g.city)} {(() => {
                        const today = new Date();
                        const todayStr = today.toISOString().slice(0, 10);
                        const yesterday = new Date(today);
                        yesterday.setDate(yesterday.getDate() - 1);
                        const yesterdayStr = yesterday.toISOString().slice(0, 10);
                        const tomorrow = new Date(today);
                        tomorrow.setDate(tomorrow.getDate() + 1);
                        const tomorrowStr = tomorrow.toISOString().slice(0, 10);
                        if (g.targetDate === todayStr) return "Today";
                        if (g.targetDate === tomorrowStr) return "Tomorrow";
                        if (g.targetDate === yesterdayStr) return "Yesterday";
                        const target = new Date(g.targetDate + "T00:00:00");
                        return `on ${target.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
                      })()}
                    </span>
                  </div>
                  <div className="text-xs mt-0.5 flex items-center gap-2">
                    <span style={{ color: "var(--text-muted)" }}>
                      Placed {friendlyDatetime(g.placedAt)}
                    </span>
                    <span className="px-1.5 py-0.5 rounded" style={{
                      fontSize: 10,
                      backgroundColor: isBadVersion ? "#ef444420" : "#4ade8015",
                      color: isBadVersion ? "#ef4444" : "#4ade80",
                    }}>
                      {g.strategyVersion}
                    </span>
                  </div>
                </div>

                {/* Current — NWS station observation (same source Kalshi uses) */}
                <div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>Current</div>
                  {(() => {
                    const obs = currentTemps[g.city.toLowerCase()];
                    if (!obs) return <div className="text-sm" style={{ color: "var(--text-muted)" }}>—</div>;
                    return (
                      <>
                        <div className="text-sm font-bold" style={{ color: "#f59e0b" }}>
                          {obs.tempF}°F
                        </div>
                        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {obs.ageMinutes < 1 ? "just now" : obs.ageMinutes < 60 ? `${obs.ageMinutes}m ago` : `${Math.floor(obs.ageMinutes / 60)}h ago`}
                        </div>
                      </>
                    );
                  })()}
                </div>

                {/* Forecast or Actual — show recorded high/low for today, forecast for future */}
                <div>
                  {(() => {
                    const isHighBet = /HIGH/i.test(g.ticker);
                    const todayStr = new Date().toISOString().slice(0, 10);
                    const isToday = g.targetDate === todayStr;
                    const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
                    const isPast = g.targetDate <= yesterdayStr;
                    
                    // For today or past: show actual recorded high/low from NWS
                    const actual = actualHighs[g.city.toLowerCase()];
                    if ((isToday || isPast) && actual) {
                      const temp = isHighBet ? actual.high : actual.low;
                      return (
                        <>
                          <div className="text-xs" style={{ color: "var(--text-muted)" }}>{isHighBet ? "High" : "Low"}</div>
                          <div className="text-sm font-bold" style={{ color: "#f59e0b" }}>
                            {temp.toFixed(1)}°F
                          </div>
                          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                            recorded
                          </div>
                        </>
                      );
                    }
                    
                    // For future: show forecast
                    const liveFcData = liveForecasts[g.city.toLowerCase()]?.[g.targetDate];
                    const liveFc = liveFcData ? (isHighBet ? liveFcData.high : liveFcData.low) : null;
                    const temp = liveFc ?? (g.forecast != null && g.forecast > 0 ? Math.round(g.forecast) : null);
                    return (
                      <>
                        <div className="text-xs" style={{ color: "var(--text-muted)" }}>Forecast</div>
                        <div className="text-sm font-bold" style={{ color: "#06b6d4" }}>
                          {temp != null ? `${temp}°F` : "—"}
                        </div>
                        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {liveFc != null && forecastFetchedAt ? (() => {
                            const d = new Date(forecastFetchedAt);
                            const mins = Math.floor((Date.now() - d.getTime()) / 60000);
                            if (mins < 1) return "just now";
                            if (mins < 60) return `${mins}m ago`;
                            return `${Math.floor(mins / 60)}h ago`;
                          })() : temp != null ? "at entry" : "—"}
                        </div>
                      </>
                    );
                  })()}
                </div>

                {/* Cost */}
                <div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>Cost</div>
                  <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                    {$(g.totalCost)}
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {g.totalQuantity}x @ {(g.avgPrice * 100).toFixed(0)}¢
                  </div>
                </div>

                {/* Bought */}
                <div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>Bought</div>
                  <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                    {boughtPct.toFixed(0)}% chance
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {g.edge > 0.005 ? `Edge ${(g.edge * 100).toFixed(0)}%` : "—"}
                  </div>
                </div>

                {/* Now */}
                <div>
                  {isSettled ? (
                    <>
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>Result</div>
                      <span
                        className="text-sm font-bold"
                        style={{ color: isWon ? "#4ade80" : "#ef4444" }}
                      >
                        {isWon ? "WON" : "LOST"}
                      </span>
                      {g.trades[0]?.actual_temp != null && (
                        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {g.trades[0].actual_temp.toFixed(1)}°F
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="text-xs" style={{ color: "#06b6d4" }}>Now</div>
                      {(() => {
                        // Check if current temp already determines the outcome
                        const currentObs = currentTemps[g.city.toLowerCase()];
                        const currentTemp = currentObs?.tempF;
                        const ticker = g.ticker || "";
                        const isHighBet = /HIGH/i.test(ticker);
                        const threshMatch = ticker.match(/-T([\d.]+)$/);
                        const threshold = threshMatch ? parseFloat(threshMatch[1]) : null;
                        const isYes = g.side === "yes";

                        // Determine if we've already won based on current temp
                        let alreadyWon = false;
                        if (currentTemp != null && threshold != null) {
                          if (isHighBet && isYes && currentTemp >= threshold) alreadyWon = true;
                          if (isHighBet && !isYes && currentTemp >= threshold) alreadyWon = false; // NO bet loses if temp hit threshold
                          // For NO bets on high: if temp already exceeded, we lost
                          // But we can't determine NO wins until end of day
                        }

                        if (alreadyWon) {
                          return (
                            <>
                              <div className="text-sm font-bold" style={{ color: "#4ade80" }}>
                                99% ✓
                              </div>
                              <div className="text-xs" style={{ color: "#4ade80" }}>
                                Threshold hit
                              </div>
                            </>
                          );
                        }

                        // Fall back to market price
                        if (g.nowPrice != null) {
                          const nowPct = g.nowPrice * 100;
                          const diff = nowPct - boughtPct;
                          const isUp = diff > 0;
                          const ourProb = g.trades[0]?.our_probability;
                          const currentEdge = ourProb != null && g.nowPrice != null ? ourProb - g.nowPrice : null;
                          return (
                            <>
                              <div className="text-sm font-bold" style={{ color: isUp ? "#4ade80" : "#ef4444" }}>
                                {nowPct.toFixed(0)}% chance {isUp ? "▲" : "▼"}
                              </div>
                              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                                {currentEdge != null ? `Edge ${(currentEdge * 100).toFixed(0)}%` : "—"}
                              </div>
                            </>
                          );
                        }
                        return <div className="text-sm" style={{ color: "var(--text-muted)" }}>—</div>;
                      })()}
                    </>
                  )}
                </div>

                {/* Payout if Win + Settlement */}
                <div className="text-right">
                  {isSettled ? (
                    <>
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>P&L</div>
                      <div className="text-sm font-bold" style={{ color: settledPnl >= 0 ? "#4ade80" : "#ef4444" }}>
                        {settledPnl >= 0 ? "+" : ""}{$(settledPnl, "")}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>Payout if Win</div>
                      <div className="text-sm font-bold" style={{ color: "#4ade80" }}>
                        ${(g.totalQuantity * 1).toFixed(2)}
                      </div>
                    </>
                  )}
                  {isOpen && (
                    <div className="flex items-center gap-1 justify-end mt-0.5">
                      <Clock className="w-2.5 h-2.5" style={{ color: "var(--text-muted)" }} />
                      <span className="text-xs" style={{
                        color: (() => {
                          if (!displaySettlement) return "var(--text-muted)";
                          const diff = new Date(displaySettlement).getTime() - Date.now();
                          if (diff <= 0) return "#f59e0b";
                          if (diff < 3600000) return "#ef4444";
                          if (diff < 86400000) return "#f59e0b";
                          return "var(--text-muted)";
                        })(),
                      }}>
                        {timeRemaining(displaySettlement)}
                      </span>
                    </div>
                  )}
                  {isSettled && (
                    <div className="text-xs mt-0.5 text-right" style={{ color: "var(--text-muted)" }}>
                      Settled
                    </div>
                  )}
                </div>

                {/* Expand arrow */}
                <div style={{ color: "var(--text-muted)" }}>
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </button>

              {/* Expanded: Order History */}
              {isExpanded && (
                <div style={{ borderTop: "1px solid var(--border)" }}>
                  {/* Summary stats */}
                  <div className="px-4 py-3 flex flex-wrap gap-6" style={{ backgroundColor: "var(--card-elevated)" }}>
                    <div>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>Cost</span>
                      <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{$(g.totalCost)}</div>
                    </div>
                    <div>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>Contracts</span>
                      <div className="text-sm font-bold" style={{ color: "#60a5fa" }}>
                        {g.totalQuantity} {g.side.toUpperCase()}
                      </div>
                    </div>
                    <div>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>Avg Price</span>
                      <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                        {(g.avgPrice * 100).toFixed(1)}¢
                      </div>
                    </div>
                    {g.forecast != null && g.forecast > 0 && (
                      <div>
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>Forecast</span>
                        <div className="text-sm font-bold" style={{ color: "#06b6d4" }}>
                          {g.forecast.toFixed(1)}°F
                        </div>
                      </div>
                    )}
                    <div>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>Edge</span>
                      <div className="text-sm font-bold" style={{
                        color: Math.abs(g.edge * 100) < 0.5 ? "#ef4444" : g.edge > 0.2 ? "#4ade80" : "#f59e0b",
                      }}>
                        {(g.edge * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>Fees</span>
                      <div className="text-sm font-bold" style={{ color: totalGroupFees > 0 ? "#f59e0b" : "var(--text-muted)" }}>
                        {totalGroupFees > 0 ? `$${totalGroupFees.toFixed(2)}` : "$0.00"}
                      </div>
                    </div>
                    <div>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>Total w/ Fees</span>
                      <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                        {$((g.totalCost + totalGroupFees))}
                      </div>
                    </div>
                    <div>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>Version</span>
                      <div className="text-sm font-bold" style={{ color: isBadVersion ? "#ef4444" : "#4ade80" }}>
                        {g.strategyVersion}
                      </div>
                    </div>
                  </div>

                  {/* Fill-level line items */}
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        {["Action", "Avg Price", "Contracts", "Cost", "Fee", "Total", "Type", "Filled"].map((h) => (
                          <th
                            key={h}
                            className="text-xs font-bold uppercase tracking-wider px-4 py-2 text-left"
                            style={{ color: "var(--text-muted)", backgroundColor: "var(--card-elevated)" }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        // Collect all fills from all trades in this group
                        const allFills = g.trades.flatMap((t) => t.fills || []);
                        // If no fills data, fall back to trade-level rows
                        const rows = allFills.length > 0 ? allFills : g.trades.map((t) => ({
                          fill_id: t.trade_id,
                          side: t.side,
                          action: "buy",
                          quantity: t.quantity,
                          yes_price: t.side === "yes" ? t.price : 1 - t.price,
                          no_price: t.side === "no" ? t.price : 1 - t.price,
                          fee: t.fees ?? 0,
                          is_taker: 0,
                          filled_at: t.created_at,
                        }));
                        return rows.map((f, fi) => {
                          const side = String(f.side || g.side);
                          const price = side === "yes" ? Number(f.yes_price) : Number(f.no_price);
                          const qty = Number(f.quantity);
                          const cost = qty * price;
                          const fee = Number(f.fee || 0);
                          return (
                        <tr
                          key={String(f.fill_id) + fi}
                          style={{ borderBottom: "1px solid var(--border)" }}
                        >
                          <td className="px-4 py-2.5">
                            <span
                              className="text-xs font-bold"
                              style={{ color: side === "yes" ? "#4ade80" : "#ef4444" }}
                            >
                              Bought {side.charAt(0).toUpperCase() + side.slice(1)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-xs font-mono" style={{ color: "var(--text-primary)" }}>
                              {(price * 100).toFixed(1)}¢
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                              {qty}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                              ${cost.toFixed(2)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-xs" style={{ color: fee > 0 ? "#f59e0b" : "var(--text-muted)" }}>
                              ${fee.toFixed(2)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                              ${(cost + fee).toFixed(2)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-xs" style={{ color: f.is_taker ? "#f59e0b" : "var(--text-muted)" }}>
                              {f.is_taker ? "Taker" : "Maker"}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                              {friendlyDatetime(String(f.filled_at || ""))}
                            </span>
                          </td>
                        </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
