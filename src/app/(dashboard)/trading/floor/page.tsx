"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Clock,
  Filter,
  X,
} from "lucide-react";
import Link from "next/link";
import { useDemoMode, maskDollar } from "@/lib/demo-mode";
import { actualTempKey, formatLocalDate, TRADING_STATIONS } from "@/lib/trading-weather";

/* ═══════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════ */

interface Position {
  trade_id: string;
  contract_id?: string;
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
  market_result?: string | null;
  market_status?: string | null;
  market_title?: string | null;
  market_subtitle?: string | null;
  market_floor_strike?: number | null;
  market_cap_strike?: number | null;
  fills?: { fill_id: string; order_id: string; ticker: string; side: string; action: string; quantity: number; yes_price: number; no_price: number; fee: number; is_taker: number; filled_at: string }[];
}

interface PositionsData {
  positions: Position[];
  resolvedPositions: Position[];
  cityBreakdown: unknown[];
  liveCityBreakdown: unknown[];
  paperCityBreakdown: unknown[];
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
      ? `${metric} ${base}–${base + 2}`
      : `${metric} outside ${base}–${base + 2}`;
  }
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

function friendlyDatetime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "Z");
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function friendlyTargetDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(`${dateStr}T12:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

interface ActualTemp {
  city: string;
  targetDate: string;
  stationId: string;
  timeZone: string;
  high: number;
  highAt: string;
  low: number;
  lowAt: string;
  observations: number;
  complete: boolean;
}

function parseThresholdDetails(ticker: string, fallbackThreshold?: number | null) {
  const isHigh = /HIGH/i.test(ticker);
  const isLow = /LOW/i.test(ticker);
  const bracketMatch = ticker.match(/-B([\d.]+)$/);
  const thresholdMatch = ticker.match(/-T([\d.]+)$/);
  const bracketBase = bracketMatch ? parseFloat(bracketMatch[1]) : null;
  const threshold = thresholdMatch ? parseFloat(thresholdMatch[1]) : (fallbackThreshold ?? null);
  return { isHigh, isLow, bracketBase, threshold };
}

function evaluateContractFromActual(ticker: string, side: string, actual: ActualTemp, fallbackThreshold?: number | null): boolean | null {
  const { isHigh, isLow, bracketBase, threshold } = parseThresholdDetails(ticker, fallbackThreshold);
  const metric = isHigh ? actual.high : isLow ? actual.low : null;
  if (metric == null) return null;

  if (bracketBase != null) {
    const inRange = metric >= bracketBase && metric < bracketBase + 2;
    return side.toLowerCase() === "yes" ? inRange : !inRange;
  }

  if (threshold == null) return null;

  if (isHigh) {
    const eventOccurs = metric <= threshold;
    return side.toLowerCase() === "yes" ? eventOccurs : !eventOccurs;
  }

  if (isLow) {
    const eventOccurs = metric >= threshold;
    return side.toLowerCase() === "yes" ? eventOccurs : !eventOccurs;
  }

  return null;
}

function getLockedIntradayOutcome(ticker: string, side: string, actual: ActualTemp, fallbackThreshold?: number | null): boolean | null {
  const { isHigh, isLow, bracketBase, threshold } = parseThresholdDetails(ticker, fallbackThreshold);

  if (bracketBase != null) {
    const metric = isHigh ? actual.high : isLow ? actual.low : null;
    if (metric == null) return null;
    if (isHigh && metric >= bracketBase + 2) return side.toLowerCase() !== "yes";
    if (isLow && metric < bracketBase) return side.toLowerCase() !== "yes";
    return null;
  }

  if (threshold == null) return null;

  if (isHigh) {
    if (actual.high > threshold) return side.toLowerCase() !== "yes";
    return null;
  }

  if (isLow) {
    if (actual.low < threshold) return side.toLowerCase() !== "yes";
    return null;
  }

  return null;
}

function addDaysToYmd(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function parseTargetDateFromTicker(ticker: string): string | null {
  const match = ticker.match(/-(\d{2})([A-Z]{3})(\d{2})-/i);
  if (!match) return null;
  const monthMap: Record<string, string> = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
  };
  const [, yy, monRaw, dd] = match;
  const mon = monthMap[monRaw.toUpperCase()];
  if (!mon) return null;
  return `20${yy}-${mon}-${dd}`;
}

function getEffectiveTargetDate(ticker: string, fallbackTargetDate: string): string {
  return parseTargetDateFromTicker(ticker) || fallbackTargetDate;
}

function getLocalTodayForCity(city: string): string {
  const station = TRADING_STATIONS[city.toLowerCase()];
  return station ? formatLocalDate(new Date(), station.timeZone) : new Date().toISOString().slice(0, 10);
}

function getViewerToday(): string {
  return formatLocalDate(new Date(), "America/Los_Angeles");
}

function getTargetDateLabel(targetDate: string): string {
  const viewerToday = getViewerToday();
  if (targetDate === viewerToday) return "today";
  if (targetDate === addDaysToYmd(viewerToday, 1)) return "tomorrow";
  if (targetDate === addDaysToYmd(viewerToday, -1)) return "yesterday";
  const [year, month, day] = targetDate.split("-").map(Number);
  const target = new Date(Date.UTC(year, (month || 1) - 1, day || 1, 12, 0, 0));
  return target.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
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

function getDisplayedRecordedTemp(group: GroupedPosition, actual: ActualTemp | undefined): number | null {
  if (!actual) return null;
  const isHighBet = /HIGH/i.test(group.ticker);
  const isLowBet = /LOW/i.test(group.ticker);
  if (isHighBet) return actual.high;
  if (isLowBet) return actual.low;
  return null;
}

function getFriendlyTargetContext(targetDate: string): string {
  const viewerToday = getViewerToday();
  if (targetDate === viewerToday) return "for today";
  if (targetDate === addDaysToYmd(viewerToday, -1)) return "yesterday";
  if (targetDate === addDaysToYmd(viewerToday, 1)) return "tomorrow";
  return friendlyTargetDate(targetDate);
}

function getActualDetailLabel(actual: ActualTemp, targetDate: string): string {
  return actual.complete ? getFriendlyTargetContext(targetDate) : "for today";
}

function compareYmd(a: string, b: string): number {
  return a.localeCompare(b);
}

function isFutureTargetDate(targetDate: string, city: string): boolean {
  return compareYmd(targetDate, getLocalTodayForCity(city)) > 0;
}

function getActualResultText(group: GroupedPosition, actual: ActualTemp | undefined): string | null {
  const temp = getDisplayedRecordedTemp(group, actual);
  if (temp == null) return null;
  return `${temp.toFixed(1)}°F`;
}

function getSettledOutcomeFromFreshActual(group: GroupedPosition, actual: ActualTemp | undefined): boolean | null {
  if (!actual?.complete) return null;
  return evaluateContractFromActual(group.ticker, group.side, actual, group.trades[0]?.threshold);
}

function getSettledOutcomeFromKalshi(group: GroupedPosition): boolean | null {
  const result = group.trades.find((t) => t.market_result)?.market_result?.toLowerCase();
  if (!result || (result !== "yes" && result !== "no")) return null;
  return group.side.toLowerCase() === result;
}

function isGroupedPositionOpen(group: GroupedPosition): boolean {
  return group.trades.some((t) => ["open", "filled", "resting", "pending"].includes(t.status));
}

function isGroupedPositionSettled(group: GroupedPosition): boolean {
  return group.trades.every((t) => !["open", "filled", "resting", "pending"].includes(t.status));
}

function getGroupedSettledOutcome(group: GroupedPosition, actualHighs: Record<string, ActualTemp>): boolean | null {
  const freshActual = actualHighs[actualTempKey(group.city, group.targetDate)];
  return getSettledOutcomeFromKalshi(group) ?? getSettledOutcomeFromFreshActual(group, freshActual);
}

/* ═══════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════ */

export default function TradingFloorPage() {
  const { isDemoMode } = useDemoMode();
  const $ = (val: number | null | undefined, prefix = "$") =>
    isDemoMode ? maskDollar(val, prefix) : val == null ? "—" : `${prefix}${val.toFixed(2)}`;

  const [kalshiPortfolio, setKalshiPortfolio] = useState<{
    // Legacy flat fields (kept for version breakdown & filters)
    cash: number | null; positions: number; portfolio: number | null; initialDeposit: number;
    pnl: number | null; pnlPercent: number | null; won: number; lost: number;
    realizedPnl: number; unrealizedPnl: number | null; pnl24h: number; portfolio24hAgo: number | null; totalFees: number;
    costBasis: number; positionsCount: number;
    openBreakdown: { totalCount: number; totalCost: number; trueRestingCount: number; trueRestingCost: number; filledOpenCount: number; filledOpenCost: number; };
    degraded: boolean;
    cashAvailable: boolean;
    versionBreakdown: { strategy_version: string; total: number; open: number; won: number; lost: number;
      realized_pnl: number; unrealized_pnl: number; total_pnl: number; open_cost: number; total_cost: number }[];
    // Grouped truth layers (preferred)
    account: { cash: number | null; portfolioValue: number | null; totalValue: number | null; pnl: number | null; source: string; } | null;
    localExposure: { openRowCount: number; openCostBasis: number; filledAwaitingSettlementCount: number; filledAwaitingSettlementCostBasis: number; trueRestingOrderCount: number; trueRestingOrderCostBasis: number; source: string; } | null;
    realized: { pnl: number; bankroll: number; won: number; lost: number; pnl24h: number; source: string; } | null;
  } | null>(null);
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
  const [actualHighs, setActualHighs] = useState<Record<string, ActualTemp>>({});

  const fetchData = useCallback(async () => {
    try {
      const [posRes, portfolioRes, forecastRes, tempsRes] = await Promise.all([
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

      const posData = await posRes.json();
      const positions = posData.positions || [];
      const resolvedPositions = posData.resolved || [];

      setPositionsData({
        positions,
        resolvedPositions,
        cityBreakdown: [],
        liveCityBreakdown: [],
        paperCityBreakdown: [],
      });

      const actualPairs = Array.from(
        new Set(
          [...positions, ...resolvedPositions]
            .filter((trade) => {
              if (!trade.city || !trade.target_date) return false;
              const effectiveTargetDate = getEffectiveTargetDate(String(trade.ticker || ""), String(trade.target_date));
              return effectiveTargetDate <= getLocalTodayForCity(String(trade.city));
            })
            .map((trade) => {
              const effectiveTargetDate = getEffectiveTargetDate(String(trade.ticker || ""), String(trade.target_date));
              return `${String(trade.city).toLowerCase()}|${effectiveTargetDate}`;
            })
        )
      );

      if (actualPairs.length > 0) {
        try {
          const actualsRes = await fetch(`/api/trading/actual-highs?${actualPairs.map((pair) => `pair=${encodeURIComponent(pair)}`).join("&")}`);
          if (actualsRes.ok) {
            const aData = await actualsRes.json();
            if (aData.actuals) setActualHighs(aData.actuals);
          }
        } catch { /* skip */ }
      } else {
        setActualHighs({});
      }

      if (portfolioRes.ok) {
        const pData = await portfolioRes.json();
        if (!pData.error) setKalshiPortfolio(pData);
      }
      setLastRefresh(new Date());
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void fetchData();
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [fetchData]);
  useEffect(() => {
    intervalRef.current = setInterval(fetchData, 15000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchData]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const kp = kalshiPortfolio;
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
    if (dateFilter !== "all" && getEffectiveTargetDate(t.ticker, t.target_date) !== dateFilter) return false;
    if (statusFilter === "open" && !isOpenStatus(t.status)) return false;
    if (statusFilter === "settled" && isOpenStatus(t.status)) return false;
    return true;
  });

  // Unique filter values
  const versions = [...new Set(allTrades.map((t) => t.strategy_version || "unknown"))].sort();
  const dates = [...new Set(allTrades.map((t) => getEffectiveTargetDate(t.ticker, t.target_date)))].filter(Boolean).sort();

  // Group by city + market (ticker base)
  const groupMap = new Map<string, GroupedPosition>();
  for (const t of filtered) {
    // Group key: city + bet description + target date (different dates = different contracts)
    const effectiveTargetDate = getEffectiveTargetDate(t.ticker, t.target_date);
    const betDesc = parseBetDescription(t.ticker, t.side, t.threshold);
    const key = `${t.city}|${betDesc}|${t.side}|${effectiveTargetDate}`;
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
        targetDate: effectiveTargetDate,
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
    // For sorting/display: use earliest open trade's settlement
    const openSettleTimes = g.trades
      .filter((t) => isOpenStatus(t.status) && t.settlement_scheduled_at)
      .map((t) => t.settlement_scheduled_at!)
      .sort();
    if (openSettleTimes.length > 0) {
      g.settlementAt = openSettleTimes[0]; // earliest = soonest to settle
    }
    return g;
  });

  // Sort based on selected mode + direction
  const asc = sortAsc[sortMode];
  const sortedGroups = [...groups].sort((a, b) => {
    const aOpen = a.trades.some((t) => isOpenStatus(t.status));
    const bOpen = b.trades.some((t) => isOpenStatus(t.status));

    let cmp = 0;
    switch (sortMode) {
      case "placed":
        // Open before settled, then by placed time
        if (aOpen !== bOpen) return aOpen ? -1 : 1;
        cmp = (a.placedAt || "").localeCompare(b.placedAt || "");
        break;
      case "settles": {
        // Pure settlement time sort — no open/settled separation
        const aTime = a.settlementAt ? new Date(a.settlementAt).getTime() : 9999999999999;
        const bTime = b.settlementAt ? new Date(b.settlementAt).getTime() : 9999999999999;
        cmp = aTime - bTime;
        break;
      }
      case "city":
        if (aOpen !== bOpen) return aOpen ? -1 : 1;
        cmp = a.city.localeCompare(b.city);
        if (cmp === 0) cmp = (a.settlementAt || "9999").localeCompare(b.settlementAt || "9999");
        break;
    }
    return asc ? cmp : -cmp;
  });

  // Stats for filtered set — use grouped positions, not raw order rows,
  // so reporting matches what the user sees on the Trading Floor.
  const filteredOpenGroups = groups.filter((g) => isGroupedPositionOpen(g));
  const filteredSettledGroups = groups.filter((g) => isGroupedPositionSettled(g));
  const filteredWonGroups = filteredSettledGroups.filter((g) => getGroupedSettledOutcome(g, actualHighs) ?? g.trades.some((t) => t.status === "won" || (t.pnl ?? 0) > 0));
  const filteredLostGroups = filteredSettledGroups.filter((g) => {
    const outcome = getGroupedSettledOutcome(g, actualHighs);
    return outcome != null ? !outcome : g.trades.some((t) => t.status === "lost" || (t.pnl ?? 0) < 0);
  });
  const summaryCountText = `${groups.length} positions · ${filteredOpenGroups.length} open · ${filteredSettledGroups.length} settled · ${filteredWonGroups.length}W/${filteredLostGroups.length}L`;
  const openExposureTotal = filteredOpenGroups.reduce((sum, g) => sum + g.totalCost, 0);
  const marketExposureMap = new Map<string, { ticker: string; title: string; cost: number; contracts: number }>();
  for (const g of filteredOpenGroups) {
    const marketKey = String(g.trades[0]?.contract_id || g.ticker);
    const existing = marketExposureMap.get(marketKey);
    const title = g.trades.find((t) => t.market_title)?.market_title || `${capitalize(g.city)} ${g.marketLabel}`;
    if (existing) {
      existing.cost += g.totalCost;
      existing.contracts += g.totalQuantity;
    } else {
      marketExposureMap.set(marketKey, {
        ticker: marketKey,
        title,
        cost: g.totalCost,
        contracts: g.totalQuantity,
      });
    }
  }
  const marketExposureRows = Array.from(marketExposureMap.values())
    .map((row) => {
      const share = openExposureTotal > 0 ? row.cost / openExposureTotal : 0;
      const riskLevel = share >= 0.3 ? "high" : share >= 0.2 ? "elevated" : "normal";
      return { ...row, share, riskLevel };
    })
    .sort((a, b) => b.cost - a.cost);
  const recentFills = allTrades
    .flatMap((trade) => (trade.fills || []).map((fill) => ({ ...fill, trade_id: trade.trade_id, contract_id: trade.contract_id || trade.ticker })))
    .sort((a, b) => new Date(String(b.filled_at || "")).getTime() - new Date(String(a.filled_at || "")).getTime())
    .slice(0, 12);

  const hasFilters = versionFilter !== "all" || dateFilter !== "all" || statusFilter !== "all";

  return (
    <div className="p-2 md:p-4 w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-2xl font-bold"
            style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)", letterSpacing: "-1px" }}
          >
            Trading Floor
          </h1>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Weather Markets · Kalshi · Live Positions & History
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/logs"
            className="text-xs px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            Trade Logs
          </Link>
          <a
            href="#recent-fills"
            className="text-xs px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            Recent Fills
          </a>
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

      {/* ════════════════════════════════════════════════════════
           TRUTH LAYERS — 3 clearly separated sources of record
          ════════════════════════════════════════════════════════ */}

      {/* ── Section 1: Account Truth (Kalshi) ─────────────────── */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-xs font-bold px-2 py-0.5 rounded tracking-widest"
            style={{ backgroundColor: "#facc1518", color: "#facc15", border: "1px solid #facc1535" }}
          >
            KALSHI
          </span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>Account Truth — authoritative exchange values</span>
          {kp?.degraded && (
            <span
              className="text-xs font-bold px-1.5 py-0.5 rounded tracking-wider"
              style={{ backgroundColor: "#f9731618", color: "#f97316", border: "1px solid #f9731635" }}
            >
              DEGRADED
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {
              label: "Cash",
              value: kp?.account?.cash ?? null,
              sub: undefined as string | undefined,
            },
            {
              label: "Portfolio Value",
              value: kp?.account?.portfolioValue ?? null,
              sub: "Exchange-reported open-position value",
            },
            {
              label: "Account Value",
              value: kp?.account?.totalValue ?? null,
              sub: undefined,
            },
            {
              label: "Account P&L",
              value: kp?.account?.pnl ?? null,
              isPnl: true,
              sub: kp?.account?.totalValue != null && kp?.initialDeposit
                ? `vs $${kp.initialDeposit.toFixed(0)} deposited`
                : undefined,
            },
          ].map(({ label, value, isPnl, sub }) => (
            <div
              key={label}
              className="p-4 rounded-xl"
              style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
            >
              <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>{label}</div>
              <div
                className="text-lg font-bold"
                style={{
                  fontFamily: "var(--font-heading)",
                  color: value == null
                    ? "var(--text-muted)"
                    : isPnl
                    ? (value >= 0 ? "#4ade80" : "#ef4444")
                    : "var(--text-primary)",
                }}
              >
                {value == null ? (kp ? "Unknown" : "—") : $(value)}
              </div>
              {sub && <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* ── Section 2: Exposure Audit (Local) ─────────────────── */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-xs font-bold px-2 py-0.5 rounded tracking-widest"
            style={{ backgroundColor: "#f59e0b18", color: "#f59e0b", border: "1px solid #f59e0b35" }}
          >
            LOCAL AUDIT
          </span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>What the local engine believes is still live</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(() => {
            const le = kp?.localExposure;
            return [
              {
                label: "Open Cost Basis",
                value: le ? $(le.openCostBasis) : "—",
                sub: le ? `${le.openRowCount} local rows` : undefined,
                tooltip: "Local unresolved entry-cost basis",
              },
              {
                label: "Filled Awaiting Settlement",
                value: le ? `${le.filledAwaitingSettlementCount}` : "—",
                sub: le ? $(le.filledAwaitingSettlementCostBasis) : undefined,
              },
              {
                label: "True Resting Orders",
                value: le ? `${le.trueRestingOrderCount}` : "—",
                sub: le ? $(le.trueRestingOrderCostBasis) : undefined,
              },
              {
                label: "Open Local Rows",
                value: le ? `${le.openRowCount}` : "—",
                sub: undefined,
              },
            ];
          })().map(({ label, value, sub, tooltip }) => (
            <div
              key={label}
              className="p-4 rounded-xl"
              style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
            >
              <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>{label}</div>
              <div
                className="text-lg font-bold"
                style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}
              >
                {value}
              </div>
              {(sub || tooltip) && (
                <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{sub ?? tooltip}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <span
              className="text-xs font-bold px-2 py-0.5 rounded tracking-widest"
              style={{ backgroundColor: "#06b6d418", color: "#06b6d4", border: "1px solid #06b6d435" }}
            >
              MARKET RISK
            </span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>Per-market exposure across open positions</span>
          </div>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Open exposure: {$(openExposureTotal)}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {marketExposureRows.length === 0 && (
            <div className="p-4 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
              No open market exposure.
            </div>
          )}
          {marketExposureRows.map((row) => (
            <div
              key={row.ticker}
              className="p-4 rounded-xl"
              style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                  {row.title}
                </div>
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                  style={{
                    backgroundColor: row.riskLevel === "high" ? "#ef444420" : row.riskLevel === "elevated" ? "#f59e0b20" : "#4ade8020",
                    color: row.riskLevel === "high" ? "#ef4444" : row.riskLevel === "elevated" ? "#f59e0b" : "#4ade80",
                  }}
                >
                  {row.riskLevel}
                </span>
              </div>
              <div className="text-lg font-bold mt-1" style={{ color: "var(--text-primary)" }}>
                {$(row.cost)}
              </div>
              <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                {(row.share * 100).toFixed(1)}% of open exposure · {row.contracts} contracts
              </div>
              <div className="mt-2 h-1.5 rounded-full" style={{ backgroundColor: "var(--border)" }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, row.share * 100)}%`,
                    backgroundColor: row.riskLevel === "high" ? "#ef4444" : row.riskLevel === "elevated" ? "#f59e0b" : "#4ade80",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Section 3: Realized Performance (Settled) ─────────── */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-xs font-bold px-2 py-0.5 rounded tracking-widest"
            style={{ backgroundColor: "#4ade8018", color: "#4ade80", border: "1px solid #4ade8035" }}
          >
            REALIZED
          </span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>What has actually been locked in (settled trades only)</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(() => {
            const r = kp?.realized;
            return [
              {
                label: "Realized P&L",
                value: r?.pnl ?? null,
                isPnl: true,
                sub: r ? `${r.won + r.lost} settled trades` : undefined,
              },
              {
                label: "Realized Bankroll",
                value: r?.bankroll ?? null,
                isPnl: false,
                sub: "Initial deposit + settled P&L only",
              },
              {
                label: "Won / Lost",
                value: null as number | null,
                customValue: r ? `${r.won}W / ${r.lost}L` : "—",
                isPnl: false,
                sub: r && (r.won + r.lost) > 0
                  ? `${((r.won / (r.won + r.lost)) * 100).toFixed(0)}% win rate`
                  : undefined,
              },
              {
                label: "24h Realized P&L",
                value: r?.pnl24h ?? null,
                isPnl: true,
                sub: "Settled in last 24h",
              },
            ];
          })().map(({ label, value, customValue, isPnl, sub }) => (
            <div
              key={label}
              className="p-4 rounded-xl"
              style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
            >
              <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>{label}</div>
              <div
                className="text-lg font-bold"
                style={{
                  fontFamily: "var(--font-heading)",
                  color: customValue
                    ? "var(--text-primary)"
                    : value == null
                    ? "var(--text-muted)"
                    : isPnl
                    ? (value >= 0 ? "#4ade80" : "#ef4444")
                    : "var(--text-primary)",
                }}
              >
                {customValue ?? (value == null ? "—" : $(value))}
              </div>
              {sub && <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* ── Version Breakdown (collapsible, newest first) ── */}
      {kp?.versionBreakdown && kp.versionBreakdown.length > 0 && (
        <div className="mb-6 rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <button
            onClick={() => setVersionBreakdownOpen((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between text-left"
            style={{ backgroundColor: "var(--card)", borderBottom: versionBreakdownOpen ? "1px solid var(--border)" : undefined }}
          >
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4" style={{ color: "#f59e0b" }} />
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
                      {v.stale_count > 0 && (
                        <div
                          className="text-xs mt-1 px-2 py-0.5 rounded inline-flex items-center gap-1"
                          style={{ backgroundColor: "#f59e0b20", color: "#f59e0b" }}
                          title="These trades have passed their target date but settlement has not been confirmed. Realized P&L for this version may be understated."
                        >
                          ⚠ {v.stale_count} awaiting settlement
                        </div>
                      )}
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
                  backgroundColor: isActive ? "#f59e0b" : "var(--card)",
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
          {summaryCountText}
        </span>
      </div>

      {/* ── Positions (Kalshi-style grouped) ──────────────── */}
      <div className="space-y-1.5">
        {sortedGroups.length === 0 && (
          <div className="text-center py-12 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>No trades match filters</p>
          </div>
        )}

        {sortedGroups.map((g) => {
          const key = `${g.city}|${g.ticker}|${g.side}|${g.targetDate}`;
          const isExpanded = expandedGroups.has(key);
          const isOpen = g.trades.some((t) => isOpenStatus(t.status));
          const isSettled = g.trades.every((t) => !isOpenStatus(t.status));
          const freshActual = actualHighs[actualTempKey(g.city, g.targetDate)];
          const kalshiSettledOutcome = getSettledOutcomeFromKalshi(g);
          const freshSettledOutcome = getSettledOutcomeFromFreshActual(g, freshActual);
          const settledOutcome = kalshiSettledOutcome ?? freshSettledOutcome;
          const isWon = isSettled && (settledOutcome ?? g.trades.some((t) => t.status === "won" || (t.pnl ?? 0) > 0));
          const isLost = isSettled && (settledOutcome != null ? !settledOutcome : g.trades.some((t) => t.status === "lost" || (t.pnl ?? 0) < 0));
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
                className="w-full px-4 py-2.5 text-left hover:opacity-90 transition-opacity"
                style={{
                  backgroundColor: isSettled ? (isWon ? "#4ade8008" : "#ef444408") : "transparent",
                }}
              >
                <div className="space-y-1.5">
                  <div
                    className="hidden lg:grid gap-2.5 items-center"
                    style={{
                      gridTemplateColumns: "48px minmax(398px, 4.35fr) minmax(62px, 0.5fr) minmax(80px, 0.62fr) minmax(72px, 0.58fr) minmax(78px, 0.62fr) minmax(182px, 1.46fr) 18px",
                    }}
                  >
                    <div
                      className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: "#f59e0b15", border: "1px solid #f59e0b25" }}
                    >
                      <span className="text-[11px] font-black tracking-wider" style={{ color: "#f59e0b" }}>
                        {cityCode(g.city)}
                      </span>
                    </div>

                    <div className="min-w-0 pr-3 xl:pr-4">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span style={{ color: g.side === "yes" ? "#4ade80" : "#ef4444", fontWeight: 700, fontSize: 14 }}>
                          {g.side === "yes" ? "Yes" : "No"}
                        </span>
                        <span style={{ color: "var(--text-primary)", fontSize: 15, lineHeight: "14px" }}>•</span>
                        <span className="text-[13px] xl:text-sm font-semibold leading-tight" style={{ color: "var(--text-primary)" }}>
                          {g.marketLabel} in {capitalize(g.city)} {getTargetDateLabel(g.targetDate)}
                        </span>
                      </div>
                      <div className="text-[11px] mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: "var(--text-muted)" }}>
                        <span>Placed {friendlyDatetime(g.placedAt)}</span>
                        <span className="px-1.5 py-0.5 rounded" style={{
                          fontSize: 10,
                          backgroundColor: isBadVersion ? "#ef444420" : "#4ade8015",
                          color: isBadVersion ? "#ef4444" : "#4ade80",
                        }}>
                          {g.strategyVersion}
                        </span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--border)", color: "var(--text-muted)" }}>
                          {g.trades.map((t) => t.trade_id).join(", ")}
                        </span>
                      </div>
                      <div className="text-[11px] mt-0.5 tracking-[0.01em]" style={{ color: "#f59e0b" }}>
                        Target {friendlyTargetDate(g.targetDate)}
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>Current</div>
                      {isSettled ? (
                        <div className="text-sm" style={{ color: "var(--text-muted)" }}>—</div>
                      ) : (() => {
                        const obs = currentTemps[g.city.toLowerCase()];
                        if (!obs) return <div className="text-sm" style={{ color: "var(--text-muted)" }}>—</div>;
                        return (
                          <>
                            <div className="text-sm font-bold" style={{ color: "#f59e0b" }}>{obs.tempF}°F</div>
                            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                              {obs.ageMinutes < 1 ? "just now" : obs.ageMinutes < 60 ? `${obs.ageMinutes}m ago` : `${Math.floor(obs.ageMinutes / 60)}h ago`}
                            </div>
                          </>
                        );
                      })()}
                    </div>

                    <div className="min-w-0">
                      {(() => {
                        const isHighBet = /HIGH/i.test(g.ticker);
                        const shouldUseActual = !isFutureTargetDate(g.targetDate, g.city);
                        const actualText = shouldUseActual ? getActualResultText(g, freshActual) : null;
                        if (shouldUseActual && freshActual && actualText) {
                          return (
                            <>
                              <div className="text-xs" style={{ color: "var(--text-muted)" }}>{isHighBet ? "High recorded" : "Low recorded"}</div>
                              <div className="text-sm font-bold" style={{ color: "#f59e0b" }}>{actualText}</div>
                              <div className="text-xs" style={{ color: "var(--text-muted)" }}>{getActualDetailLabel(freshActual, g.targetDate)}</div>
                            </>
                          );
                        }
                        const liveFcData = liveForecasts[g.city.toLowerCase()]?.[g.targetDate];
                        const liveFc = liveFcData ? (isHighBet ? liveFcData.high : liveFcData.low) : null;
                        const temp = liveFc ?? (g.forecast != null && g.forecast > 0 ? Math.round(g.forecast) : null);
                        return (
                          <>
                            <div className="text-xs" style={{ color: "var(--text-muted)" }}>Forecast</div>
                            <div className="text-sm font-bold" style={{ color: "#06b6d4" }}>{temp != null ? `${temp}°F` : "—"}</div>
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

                    <div className="min-w-0 pr-1">
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>Cost</div>
                      <div className="text-sm font-bold whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{$(g.totalCost)}</div>
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>{g.totalQuantity}x @ {(g.avgPrice * 100).toFixed(0)}¢</div>
                    </div>

                    <div className="min-w-0 pr-1">
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>Bought</div>
                      <div className="text-sm font-bold whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{boughtPct.toFixed(0)}% chance</div>
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>{g.edge > 0.005 ? `Edge ${(g.edge * 100).toFixed(0)}%` : "—"}</div>
                    </div>

                    <div className="grid grid-cols-[74px_100px] justify-end items-center gap-x-2.5 min-w-0 pl-0.5">
                      <div className="min-w-0">
                        {isSettled ? (
                          <>
                            <div className="text-xs" style={{ color: "var(--text-muted)" }}>Now</div>
                            <div className="text-sm font-bold whitespace-nowrap" style={{ color: isWon ? "#4ade80" : "#ef4444" }}>{isWon ? "WON" : "LOST"}</div>
                            {(() => {
                              const actualText = getActualResultText(g, freshActual);
                              const kalshiResult = g.trades.find((t) => t.market_result)?.market_result?.toUpperCase();
                              const hasConflict = kalshiSettledOutcome != null && freshSettledOutcome != null && kalshiSettledOutcome !== freshSettledOutcome;
                              return (
                                <>
                                  {kalshiResult ? <div className="text-xs" style={{ color: hasConflict ? "#f59e0b" : "var(--text-muted)" }}>Kalshi settled {kalshiResult}</div> : null}
                                  {actualText ? <div className="text-xs" style={{ color: hasConflict ? "#f59e0b" : "var(--text-muted)" }}>{actualText}{hasConflict ? " · audit disagrees" : ""}</div> : null}
                                </>
                              );
                            })()}
                          </>
                        ) : (
                          <>
                            <div className="text-xs" style={{ color: "var(--text-muted)" }}>Now</div>
                            {(() => {
                              const finalOutcome = freshActual ? evaluateContractFromActual(g.ticker, g.side, freshActual, g.trades[0]?.threshold) : null;
                              const lockedOutcome = freshActual && !freshActual.complete
                                ? getLockedIntradayOutcome(g.ticker, g.side, freshActual, g.trades[0]?.threshold)
                                : null;
                              if (freshActual?.complete && finalOutcome != null) {
                                return (
                                  <>
                                    <div className="text-sm font-bold whitespace-nowrap" style={{ color: finalOutcome ? "#4ade80" : "#ef4444" }}>{finalOutcome ? "100% chance" : "0% chance"}</div>
                                    <div className="text-xs" style={{ color: finalOutcome ? "#4ade80" : "#ef4444" }}>Final result</div>
                                  </>
                                );
                              }
                              if (lockedOutcome != null) {
                                return (
                                  <>
                                    <div className="text-sm font-bold whitespace-nowrap" style={{ color: lockedOutcome ? "#4ade80" : "#ef4444" }}>{lockedOutcome ? "Locked win" : "Locked loss"}</div>
                                    <div className="text-xs" style={{ color: lockedOutcome ? "#4ade80" : "#ef4444" }}>Locked from recorded {(/HIGH/i.test(g.ticker) ? "high" : /LOW/i.test(g.ticker) ? "low" : "actual")}</div>
                                  </>
                                );
                              }
                              if (g.nowPrice != null) {
                                const nowPct = g.nowPrice * 100;
                                const diff = nowPct - boughtPct;
                                const isUp = diff > 0;
                                const ourProb = g.trades[0]?.our_probability;
                                const currentEdge = ourProb != null && g.nowPrice != null ? ourProb - g.nowPrice : null;
                                return (
                                  <>
                                    <div className="text-sm font-bold whitespace-nowrap" style={{ color: isUp ? "#4ade80" : "#ef4444" }}>{nowPct.toFixed(0)}% {isUp ? "▲" : "▼"}</div>
                                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>{currentEdge != null ? `Edge ${(currentEdge * 100).toFixed(0)}%` : "—"}</div>
                                  </>
                                );
                              }
                              return (
                                <>
                                  <div className="text-sm font-bold whitespace-nowrap" style={{ color: "var(--text-muted)" }}>Live</div>
                                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>Not locked yet</div>
                                </>
                              );
                            })()}
                          </>
                        )}
                      </div>

                      <div className="text-right min-w-0">
                        {isSettled ? (
                          <>
                            <div className="text-xs" style={{ color: "var(--text-muted)" }}>P&L</div>
                            <div className="text-sm font-bold whitespace-nowrap" style={{ color: settledPnl >= 0 ? "#4ade80" : "#ef4444" }}>{settledPnl >= 0 ? "+" : ""}{$(settledPnl, "")}</div>
                            <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Settled</div>
                          </>
                        ) : (
                          <>
                            <div className="text-xs" style={{ color: "var(--text-muted)" }}>Payout if Win</div>
                            <div className="text-sm font-bold whitespace-nowrap" style={{ color: "#4ade80" }}>${(g.totalQuantity * 1).toFixed(2)}</div>
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
                          </>
                        )}
                      </div>
                    </div>

                    <div style={{ color: "var(--text-muted)" }}>
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </div>

                  <div className="lg:hidden flex items-start gap-3">
                    <div
                      className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: "#f59e0b15", border: "1px solid #f59e0b25" }}
                    >
                      <span className="text-xs font-black tracking-wider" style={{ color: "#f59e0b" }}>
                        {cityCode(g.city)}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span style={{ color: g.side === "yes" ? "#4ade80" : "#ef4444", fontWeight: 700, fontSize: 14 }}>
                          {g.side === "yes" ? "Yes" : "No"}
                        </span>
                        <span style={{ color: "var(--text-primary)", fontSize: 15, lineHeight: "14px" }}>•</span>
                        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                          {g.marketLabel} in {capitalize(g.city)} {getTargetDateLabel(g.targetDate)}
                        </span>
                      </div>
                      <div className="text-xs mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: "var(--text-muted)" }}>
                        <span>Placed {friendlyDatetime(g.placedAt)}</span>
                        <span className="px-1.5 py-0.5 rounded" style={{
                          fontSize: 10,
                          backgroundColor: isBadVersion ? "#ef444420" : "#4ade8015",
                          color: isBadVersion ? "#ef4444" : "#4ade80",
                        }}>
                          {g.strategyVersion}
                        </span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--border)", color: "var(--text-muted)" }}>
                          {g.trades.map((t) => t.trade_id).join(", ")}
                        </span>
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: "#f59e0b" }}>
                        Target {friendlyTargetDate(g.targetDate)}
                      </div>
                    </div>
                    <div className="pt-1" style={{ color: "var(--text-muted)" }}>
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 lg:hidden">
                    <div>
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>Current</div>
                      {isSettled ? (
                        <div className="text-sm" style={{ color: "var(--text-muted)" }}>—</div>
                      ) : (() => {
                        const obs = currentTemps[g.city.toLowerCase()];
                        if (!obs) return <div className="text-sm" style={{ color: "var(--text-muted)" }}>—</div>;
                        return (
                          <>
                            <div className="text-sm font-bold" style={{ color: "#f59e0b" }}>{obs.tempF}°F</div>
                            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                              {obs.ageMinutes < 1 ? "just now" : obs.ageMinutes < 60 ? `${obs.ageMinutes}m ago` : `${Math.floor(obs.ageMinutes / 60)}h ago`}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    <div>
                      {(() => {
                        const isHighBet = /HIGH/i.test(g.ticker);
                        const shouldUseActual = !isFutureTargetDate(g.targetDate, g.city);
                        const actualText = shouldUseActual ? getActualResultText(g, freshActual) : null;
                        if (shouldUseActual && freshActual && actualText) {
                          return (
                            <>
                              <div className="text-xs" style={{ color: "var(--text-muted)" }}>{isHighBet ? "High recorded" : "Low recorded"}</div>
                              <div className="text-sm font-bold" style={{ color: "#f59e0b" }}>{actualText}</div>
                              <div className="text-xs" style={{ color: "var(--text-muted)" }}>{getActualDetailLabel(freshActual, g.targetDate)}</div>
                            </>
                          );
                        }
                        const liveFcData = liveForecasts[g.city.toLowerCase()]?.[g.targetDate];
                        const liveFc = liveFcData ? (isHighBet ? liveFcData.high : liveFcData.low) : null;
                        const temp = liveFc ?? (g.forecast != null && g.forecast > 0 ? Math.round(g.forecast) : null);
                        return (
                          <>
                            <div className="text-xs" style={{ color: "var(--text-muted)" }}>Forecast</div>
                            <div className="text-sm font-bold" style={{ color: "#06b6d4" }}>{temp != null ? `${temp}°F` : "—"}</div>
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
                    <div>
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>Cost</div>
                      <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{$(g.totalCost)}</div>
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>{g.totalQuantity}x @ {(g.avgPrice * 100).toFixed(0)}¢</div>
                    </div>
                    <div>
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>Bought</div>
                      <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{boughtPct.toFixed(0)}% chance</div>
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>{g.edge > 0.005 ? `Edge ${(g.edge * 100).toFixed(0)}%` : "—"}</div>
                    </div>
                    <div>
                      {isSettled ? (
                        <>
                          <div className="text-xs" style={{ color: "var(--text-muted)" }}>Now</div>
                          <div className="text-sm font-bold" style={{ color: isWon ? "#4ade80" : "#ef4444" }}>{isWon ? "WON" : "LOST"}</div>
                          {(() => {
                            const actualText = getActualResultText(g, freshActual);
                            const kalshiResult = g.trades.find((t) => t.market_result)?.market_result?.toUpperCase();
                            const hasConflict = kalshiSettledOutcome != null && freshSettledOutcome != null && kalshiSettledOutcome !== freshSettledOutcome;
                            return kalshiResult
                              ? <div className="text-xs" style={{ color: hasConflict ? "#f59e0b" : "var(--text-muted)" }}>Kalshi settled {kalshiResult}</div>
                              : actualText
                                ? <div className="text-xs" style={{ color: hasConflict ? "#f59e0b" : "var(--text-muted)" }}>{actualText}{hasConflict ? " · audit disagrees" : ""}</div>
                                : null;
                          })()}
                        </>
                      ) : (
                        <>
                          <div className="text-xs" style={{ color: "var(--text-muted)" }}>Now</div>
                          {(() => {
                            const finalOutcome = freshActual ? evaluateContractFromActual(g.ticker, g.side, freshActual, g.trades[0]?.threshold) : null;
                            const lockedOutcome = freshActual && !freshActual.complete
                              ? getLockedIntradayOutcome(g.ticker, g.side, freshActual, g.trades[0]?.threshold)
                              : null;
                            if (freshActual?.complete && finalOutcome != null) {
                              return (
                                <>
                                  <div className="text-sm font-bold" style={{ color: finalOutcome ? "#4ade80" : "#ef4444" }}>{finalOutcome ? "100% ✓" : "0% ✕"}</div>
                                  <div className="text-xs" style={{ color: finalOutcome ? "#4ade80" : "#ef4444" }}>Final actual</div>
                                </>
                              );
                            }
                            if (lockedOutcome != null) {
                              return (
                                <>
                                  <div className="text-sm font-bold" style={{ color: lockedOutcome ? "#4ade80" : "#ef4444" }}>{lockedOutcome ? "Locked win" : "Locked loss"}</div>
                                  <div className="text-xs" style={{ color: lockedOutcome ? "#4ade80" : "#ef4444" }}>From today&apos;s recorded {(/HIGH/i.test(g.ticker) ? "high" : /LOW/i.test(g.ticker) ? "low" : "actual")}</div>
                                </>
                              );
                            }
                            if (g.nowPrice != null) {
                              const nowPct = g.nowPrice * 100;
                              const diff = nowPct - boughtPct;
                              const isUp = diff > 0;
                              const ourProb = g.trades[0]?.our_probability;
                              const currentEdge = ourProb != null && g.nowPrice != null ? ourProb - g.nowPrice : null;
                              return (
                                <>
                                  <div className="text-sm font-bold" style={{ color: isUp ? "#4ade80" : "#ef4444" }}>{nowPct.toFixed(0)}% {isUp ? "▲" : "▼"}</div>
                                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>{currentEdge != null ? `Edge ${(currentEdge * 100).toFixed(0)}%` : "—"}</div>
                                </>
                              );
                            }
                            return <div className="text-sm" style={{ color: "var(--text-muted)" }}>—</div>;
                          })()}
                        </>
                      )}
                    </div>
                    <div>
                      {isSettled ? (
                        <>
                          <div className="text-xs" style={{ color: "var(--text-muted)" }}>P&L</div>
                          <div className="text-sm font-bold" style={{ color: settledPnl >= 0 ? "#4ade80" : "#ef4444" }}>{settledPnl >= 0 ? "+" : ""}{$(settledPnl, "")}</div>
                          <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Settled</div>
                        </>
                      ) : (
                        <>
                          <div className="text-xs" style={{ color: "var(--text-muted)" }}>Payout if Win</div>
                          <div className="text-sm font-bold" style={{ color: "#4ade80" }}>${(g.totalQuantity * 1).toFixed(2)}</div>
                          <div className="flex items-center gap-1 mt-0.5">
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
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </button>

              {/* Expanded: Order History */}
              {isExpanded && (
                <div style={{ borderTop: "1px solid var(--border)" }}>
                  {/* Summary stats */}
                  <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4" style={{ backgroundColor: "var(--card-elevated)" }}>
                    <div>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>Cost</span>
                      <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{$(g.totalCost)}</div>
                    </div>
                    <div>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>Contracts</span>
                      <div className="text-sm font-bold" style={{ color: "#f59e0b" }}>
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
                  <div className="overflow-x-auto">
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
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
                          const allFills = g.trades.flatMap((t) => t.fills || []);
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
                                  <span className="text-xs font-bold" style={{ color: side === "yes" ? "#4ade80" : "#ef4444" }}>
                                    Bought {side.charAt(0).toUpperCase() + side.slice(1)}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5">
                                  <span className="text-xs font-mono" style={{ color: "var(--text-primary)" }}>
                                    {(price * 100).toFixed(1)}¢
                                  </span>
                                </td>
                                <td className="px-4 py-2.5">
                                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{qty}</span>
                                </td>
                                <td className="px-4 py-2.5">
                                  <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>${cost.toFixed(2)}</span>
                                </td>
                                <td className="px-4 py-2.5">
                                  <span className="text-xs" style={{ color: fee > 0 ? "#f59e0b" : "var(--text-muted)" }}>${fee.toFixed(2)}</span>
                                </td>
                                <td className="px-4 py-2.5">
                                  <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>${(cost + fee).toFixed(2)}</span>
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
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div id="recent-fills" className="mt-6 rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ backgroundColor: "var(--card)" }}>
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Recent Fills</div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>Latest execution events across live positions</div>
          </div>
          <Link
            href="/logs"
            className="text-xs px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            Open Logs
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
            <thead>
              <tr style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
                {["Filled", "Ticker", "Side", "Qty", "Price", "Fee", "Trade ID"].map((h) => (
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
              {recentFills.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-4 text-sm" style={{ color: "var(--text-muted)" }}>
                    No fills available yet.
                  </td>
                </tr>
              )}
              {recentFills.map((fill, idx) => {
                const side = String(fill.side || "").toLowerCase();
                const yesPrice = Number(fill.yes_price || 0);
                const noPrice = Number(fill.no_price || 0);
                const price = side === "yes" ? yesPrice : noPrice;
                return (
                  <tr key={`${fill.fill_id}-${idx}`} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="px-4 py-2.5 text-xs" style={{ color: "var(--text-muted)" }}>
                      {friendlyDatetime(String(fill.filled_at || ""))}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono" style={{ color: "var(--text-primary)" }}>
                      {String(fill.contract_id || fill.ticker || "—")}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-semibold" style={{ color: side === "yes" ? "#4ade80" : "#ef4444" }}>
                      {side ? side.toUpperCase() : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: "var(--text-primary)" }}>
                      {Number(fill.quantity || 0)}
                    </td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: "var(--text-primary)" }}>
                      {(price * 100).toFixed(1)}¢
                    </td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: "var(--text-primary)" }}>
                      ${Number(fill.fee || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                      {fill.trade_id}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
