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
    washington_dc: "DC", boston: "BOS",
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
}

/* ═══════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════ */

export default function TradingFloorPage() {
  const { isDemoMode } = useDemoMode();
  const $ = (val: number | null | undefined, prefix = "$") =>
    isDemoMode ? maskDollar(val, prefix) : val == null ? "—" : `${prefix}${val.toFixed(2)}`;

  const [weatherStats, setWeatherStats] = useState<WeatherStats | null>(null);
  const [positionsData, setPositionsData] = useState<PositionsData | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [versionFilter, setVersionFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all"); // all | open | settled
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchData = useCallback(async () => {
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
  const deposit = ks?.initialDeposit ?? 1000;
  const allPositions = positionsData?.positions ?? [];
  const allResolved = positionsData?.resolvedPositions ?? [];

  // Only live trades
  const livePositions = allPositions.filter((p) => p.trade_type === "live");
  const liveResolved = allResolved.filter((p) => p.trade_type === "live");

  // Combine for filtering
  const allTrades = [...livePositions, ...liveResolved];

  // Apply filters
  const filtered = allTrades.filter((t) => {
    if (versionFilter !== "all" && (t.strategy_version || "unknown") !== versionFilter) return false;
    if (dateFilter !== "all" && t.target_date !== dateFilter) return false;
    if (statusFilter === "open" && t.status !== "open") return false;
    if (statusFilter === "settled" && t.status === "open") return false;
    return true;
  });

  // Unique filter values
  const versions = [...new Set(allTrades.map((t) => t.strategy_version || "unknown"))].sort();
  const dates = [...new Set(allTrades.map((t) => t.target_date))].filter(Boolean).sort();

  // Group by city + market (ticker base)
  const groupMap = new Map<string, GroupedPosition>();
  for (const t of filtered) {
    // Group key: city + bet description
    const betDesc = parseBetDescription(t.ticker, t.side, t.threshold);
    const key = `${t.city}|${betDesc}|${t.side}`;
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
      });
    }
    const g = groupMap.get(key)!;
    g.trades.push(t);
    g.totalQuantity += t.quantity;
    g.totalCost += t.cost;
    if (t.our_probability != null) g.boughtProbability = t.our_probability;
    g.edge = t.edge;
  }

  // Compute derived values
  const groups = Array.from(groupMap.values()).map((g) => {
    g.avgPrice = g.totalQuantity > 0 ? g.totalCost / g.totalQuantity : 0;
    g.payoutIfWin = g.totalQuantity - g.totalCost;
    return g;
  });

  // Sort: open first, then by city
  groups.sort((a, b) => {
    const aOpen = a.trades.some((t) => t.status === "open");
    const bOpen = b.trades.some((t) => t.status === "open");
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    return a.city.localeCompare(b.city);
  });

  // Stats for filtered set
  const filteredOpen = filtered.filter((t) => t.status === "open");
  const filteredSettled = filtered.filter((t) => t.status !== "open");
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

      {/* ── Portfolio Summary ─────────────────────────────── */}
      <div
        className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6"
      >
        {[
          { label: "Cash", value: ks ? $(ks.bankroll != null ? ks.bankroll - ks.openExposure : null) : "—", color: "var(--text-primary)" },
          { label: "Positions", value: ks ? $(ks.openExposure) : "—", color: "#60a5fa" },
          { label: "Portfolio", value: ks?.bankroll != null ? $(ks.bankroll) : "—", color: "var(--text-primary)", bold: true },
          { label: "Deposited", value: $(-deposit, "-$").replace("-", ""), color: "var(--text-muted)" },
          {
            label: "P&L (Realized)",
            value: ks ? $(ks.totalPnl) : "—",
            color: (ks?.totalPnl ?? 0) >= 0 ? "#4ade80" : "#ef4444",
          },
          {
            label: "Record",
            value: ks ? `${ks.won}W – ${ks.lost}L` : "—",
            color: "var(--text-primary)",
            sub: ks && (ks.won + ks.lost) > 0 ? `${ks.winRate.toFixed(0)}% win rate` : undefined,
          },
        ].map((item) => (
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
              <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{item.sub}</div>
            )}
          </div>
        ))}
      </div>

      {/* ── Version Breakdown ─────────────────────────────── */}
      {ks?.versionBreakdown && ks.versionBreakdown.length > 0 && (
        <div className="mb-6 rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <div className="px-4 py-3 flex items-center gap-2" style={{ backgroundColor: "var(--card)", borderBottom: "1px solid var(--border)" }}>
            <Filter className="w-4 h-4" style={{ color: "#a78bfa" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Strategy Version Breakdown</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
            {ks.versionBreakdown.map((v) => {
              const resolved = v.won + v.lost;
              const wr = resolved > 0 ? ((v.won / resolved) * 100).toFixed(0) : "—";
              const isBad = (v.strategy_version || "").includes("0.9");
              return (
                <div
                  key={v.strategy_version}
                  className="p-4 flex items-center justify-between"
                  style={{
                    backgroundColor: isBad ? "#ef444408" : "#4ade8008",
                    borderRight: "1px solid var(--border)",
                    borderBottom: "1px solid var(--border)",
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
                    <div className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>
                      {v.total} trades · {v.open} open · {v.won}W/{v.lost}L · {wr}% WR
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className="text-sm font-bold"
                      style={{ color: v.pnl >= 0 ? "#4ade80" : "#ef4444" }}
                    >
                      {$(v.pnl)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Filters ───────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
        </div>
        <select
          value={versionFilter}
          onChange={(e) => setVersionFilter(e.target.value)}
          className="text-xs px-3 py-1.5 rounded-lg"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        >
          <option value="all">All Versions</option>
          {versions.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="text-xs px-3 py-1.5 rounded-lg"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        >
          <option value="all">All Dates</option>
          {dates.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-xs px-3 py-1.5 rounded-lg"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        >
          <option value="all">All Status</option>
          <option value="open">Open Only</option>
          <option value="settled">Settled Only</option>
        </select>
        {hasFilters && (
          <button
            onClick={() => { setVersionFilter("all"); setDateFilter("all"); setStatusFilter("all"); }}
            className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg"
            style={{ backgroundColor: "#ef444415", color: "#ef4444", border: "1px solid #ef444430" }}
          >
            <X className="w-3 h-3" /> Clear
          </button>
        )}
        <span className="text-xs ml-auto" style={{ color: "var(--text-muted)" }}>
          {filtered.length} trades · {filteredOpen.length} open · {filteredWon.length}W/{filteredLost.length}L
          {filteredSettled.length > 0 && (
            <span style={{ color: filteredPnl >= 0 ? "#4ade80" : "#ef4444", fontWeight: 600, marginLeft: 8 }}>
              {$(filteredPnl)} P&L on {$(filteredCost)} wagered
            </span>
          )}
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
          const isOpen = g.trades.some((t) => t.status === "open");
          const isSettled = g.trades.every((t) => t.status !== "open");
          const isWon = isSettled && g.trades.some((t) => t.status === "won" || (t.pnl ?? 0) > 0);
          const isLost = isSettled && g.trades.some((t) => t.status === "lost" || (t.pnl ?? 0) < 0);
          const settledPnl = g.trades.reduce((s, t) => s + (t.status !== "open" ? (t.pnl ?? 0) : 0), 0);
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
              {/* Main row */}
              <button
                onClick={() => toggleGroup(key)}
                className="w-full flex items-center gap-4 px-4 py-3.5 text-left hover:opacity-90 transition-opacity"
                style={{ backgroundColor: isSettled ? (isWon ? "#4ade8008" : "#ef444408") : "transparent" }}
              >
                {/* City badge */}
                <div
                  className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{
                    backgroundColor: "#60a5fa18",
                    border: "1px solid #60a5fa30",
                  }}
                >
                  <span className="text-xs font-black tracking-wider" style={{ color: "#60a5fa" }}>
                    {cityCode(g.city)}
                  </span>
                </div>

                {/* Market info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {capitalize(g.city)} · {g.targetDate}
                    </span>
                    {isBadVersion && (
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: "#ef444420", color: "#ef4444" }}>
                        {g.strategyVersion}
                      </span>
                    )}
                    {!isBadVersion && g.strategyVersion !== "unknown" && (
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: "#4ade8015", color: "#4ade80" }}>
                        {g.strategyVersion}
                      </span>
                    )}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    <span style={{ color: g.side === "yes" ? "#4ade80" : "#ef4444" }}>
                      {g.side.toUpperCase()}
                    </span>
                    {" · "}
                    {g.marketLabel}
                  </div>
                </div>

                {/* Bought probability */}
                <div className="text-center" style={{ minWidth: 80 }}>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>Bought</div>
                  <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                    {boughtPct.toFixed(0)}¢
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {g.totalQuantity} contract{g.totalQuantity !== 1 ? "s" : ""}
                  </div>
                </div>

                {/* Payout */}
                <div className="text-center" style={{ minWidth: 90 }}>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {isSettled ? "Result" : "Payout if Win"}
                  </div>
                  {isSettled ? (
                    <div className="text-sm font-bold" style={{ color: settledPnl >= 0 ? "#4ade80" : "#ef4444" }}>
                      {settledPnl >= 0 ? "+" : ""}{$(settledPnl, "")}
                    </div>
                  ) : (
                    <div className="text-sm font-bold" style={{ color: "#4ade80" }}>
                      ${g.payoutIfWin.toFixed(2)}
                    </div>
                  )}
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Cost: {$(g.totalCost)}
                  </div>
                </div>

                {/* Settlement / Status */}
                <div className="text-center" style={{ minWidth: 80 }}>
                  {isSettled ? (
                    <>
                      <span
                        className="text-xs font-bold px-2 py-1 rounded"
                        style={{
                          backgroundColor: isWon ? "#4ade8020" : "#ef444420",
                          color: isWon ? "#4ade80" : "#ef4444",
                        }}
                      >
                        {isWon ? "WON ✓" : "LOST ✗"}
                      </span>
                      {g.trades[0]?.actual_temp != null && (
                        <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                          Actual: {g.trades[0].actual_temp.toFixed(1)}°F
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-1 justify-center">
                        <Clock className="w-3 h-3" style={{ color: "var(--text-muted)" }} />
                        <span className="text-xs font-medium" style={{
                          color: (() => {
                            if (!g.settlementAt) return "var(--text-muted)";
                            const diff = new Date(g.settlementAt).getTime() - Date.now();
                            if (diff <= 0) return "#f59e0b";
                            if (diff < 3600000) return "#ef4444";
                            if (diff < 86400000) return "#f59e0b";
                            return "var(--text-secondary)";
                          })(),
                        }}>
                          {timeRemaining(g.settlementAt)}
                        </span>
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                        {friendlyDatetime(g.settlementAt)}
                      </div>
                    </>
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
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>Version</span>
                      <div className="text-sm font-bold" style={{ color: isBadVersion ? "#ef4444" : "#4ade80" }}>
                        {g.strategyVersion}
                      </div>
                    </div>
                  </div>

                  {/* Order line items */}
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        {["Action", "Avg Price", "Contracts", "Cost", "Edge", "Placed"].map((h) => (
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
                      {g.trades.map((t) => (
                        <tr
                          key={t.trade_id}
                          style={{ borderBottom: "1px solid var(--border)" }}
                        >
                          <td className="px-4 py-2.5">
                            <span
                              className="text-xs font-bold"
                              style={{ color: t.side === "yes" ? "#4ade80" : "#ef4444" }}
                            >
                              Bought {t.side.charAt(0).toUpperCase() + t.side.slice(1)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-xs font-mono" style={{ color: "var(--text-primary)" }}>
                              {(t.price * 100).toFixed(1)}¢
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                              {t.quantity}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                              {$(t.cost)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-xs" style={{
                              color: Math.abs(t.edge * 100) < 0.5 ? "#ef4444" : t.edge > 0.2 ? "#4ade80" : "#f59e0b",
                            }}>
                              {(t.edge * 100).toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                              {friendlyDatetime(t.created_at)}
                            </span>
                          </td>
                        </tr>
                      ))}
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
