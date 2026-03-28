"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Quote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  source: string;
  timestamp: string;
  symbols: string[];
  sentiment: "positive" | "negative" | "neutral";
}

interface Position {
  symbol: string;
  qty: number;
  costBasis: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TAPE_SYMBOLS = ["SPY", "QQQ", "IWM", "BTC", "ETH", "GLD", "TLT", "VIX"];
const DEFAULT_WATCHLIST = [
  "SPY",
  "QQQ",
  "AAPL",
  "MSFT",
  "NVDA",
  "TSLA",
  "BTC",
  "ETH",
  "SOL",
];
const TIMEFRAMES = ["1D", "1W", "1M", "3M", "1Y"] as const;
const GREEN = "#00C805";
const RED = "#FF3B30";
const BG = "#0a0a0a";
const SURFACE = "#111111";
const BORDER = "#1e1e1e";
const TEXT_DIM = "#666666";
const TEXT_MED = "#999999";

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e4) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toFixed(decimals);
}

function priceColor(change: number): string {
  if (change > 0) return GREEN;
  if (change < 0) return RED;
  return TEXT_MED;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function TerminalPage() {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [focusedSymbol, setFocusedSymbol] = useState("SPY");
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>("1M");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [expandedNews, setExpandedNews] = useState<string | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [showAddPosition, setShowAddPosition] = useState(false);
  const [newPos, setNewPos] = useState({ symbol: "", qty: "", cost: "" });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof import("lightweight-charts").createChart> | null>(null);
  const candleSeriesRef = useRef<unknown>(null);
  const volumeSeriesRef = useRef<unknown>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load positions from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("terminal-positions");
    if (saved) {
      try {
        setPositions(JSON.parse(saved));
      } catch {
        /* ignore */
      }
    }
  }, []);

  // Save positions
  useEffect(() => {
    localStorage.setItem("terminal-positions", JSON.stringify(positions));
  }, [positions]);

  // ── Data Fetching ──────────────────────────────────────────────────────────

  const fetchQuotes = useCallback(async () => {
    const allSymbols = [
      ...new Set([...TAPE_SYMBOLS, ...DEFAULT_WATCHLIST]),
    ].join(",");
    try {
      const res = await fetch(
        `/api/trading/terminal/quotes?symbols=${allSymbols}`
      );
      const data = await res.json();
      setQuotes(data);
    } catch {
      /* silent */
    }
  }, []);

  const fetchCandles = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/trading/terminal/candles?symbol=${focusedSymbol}&timeframe=${timeframe}`
      );
      const data = await res.json();
      if (Array.isArray(data)) setCandles(data);
    } catch {
      /* silent */
    }
  }, [focusedSymbol, timeframe]);

  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/trading/terminal/news?symbol=${focusedSymbol}`
      );
      const data = await res.json();
      if (Array.isArray(data)) setNews(data);
    } catch {
      /* silent */
    }
  }, [focusedSymbol]);

  // Initial fetch + polling
  useEffect(() => {
    fetchQuotes();
    const interval = setInterval(fetchQuotes, 15000);
    return () => clearInterval(interval);
  }, [fetchQuotes]);

  useEffect(() => {
    fetchCandles();
  }, [fetchCandles]);

  useEffect(() => {
    fetchNews();
  }, [fetchNews]);

  // ── Chart Setup ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!chartContainerRef.current) return;

    let mounted = true;

    (async () => {
      const lc = await import("lightweight-charts");

      if (!mounted || !chartContainerRef.current) return;

      // Destroy previous chart
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }

      const chart = lc.createChart(chartContainerRef.current, {
        layout: {
          background: { type: lc.ColorType.Solid, color: BG },
          textColor: TEXT_MED,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: "#151515" },
          horzLines: { color: "#151515" },
        },
        crosshair: {
          mode: lc.CrosshairMode.Normal,
          vertLine: { color: "#333", width: 1, style: lc.LineStyle.Dashed },
          horzLine: { color: "#333", width: 1, style: lc.LineStyle.Dashed },
        },
        rightPriceScale: {
          borderColor: BORDER,
          scaleMargins: { top: 0.05, bottom: 0.2 },
        },
        timeScale: {
          borderColor: BORDER,
          timeVisible: timeframe === "1D" || timeframe === "1W",
          secondsVisible: false,
        },
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
      });

      const candleSeries = chart.addSeries(lc.CandlestickSeries, {
        upColor: GREEN,
        downColor: RED,
        borderUpColor: GREEN,
        borderDownColor: RED,
        wickUpColor: GREEN,
        wickDownColor: RED,
      });

      const volumeSeries = chart.addSeries(lc.HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });

      chart.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
      });

      chartRef.current = chart;
      candleSeriesRef.current = candleSeries;
      volumeSeriesRef.current = volumeSeries;

      // Resize observer
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          chart.applyOptions({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        }
      });
      ro.observe(chartContainerRef.current);

      return () => ro.disconnect();
    })();

    return () => {
      mounted = false;
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  // Re-create chart when timeframe changes (for timeVisible setting)
  }, [timeframe]);

  // Update chart data when candles change
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || candles.length === 0) return;

    const candleData = candles.map((c) => ({
      time: c.time as import("lightweight-charts").UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volumeData = candles.map((c) => ({
      time: c.time as import("lightweight-charts").UTCTimestamp,
      value: c.volume,
      color: c.close >= c.open ? GREEN + "40" : RED + "40",
    }));

    (candleSeriesRef.current as { setData: (d: unknown[]) => void }).setData(candleData);
    (volumeSeriesRef.current as { setData: (d: unknown[]) => void }).setData(volumeData);

    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [candles]);

  // ── Keyboard Shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      if (e.key === "/") {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
        return;
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setSearchQuery("");
        return;
      }

      const tfKeys: Record<string, (typeof TIMEFRAMES)[number]> = {
        "1": "1D",
        "2": "1W",
        "3": "1M",
        "4": "3M",
        "5": "1Y",
      };
      if (tfKeys[e.key]) {
        setTimeframe(tfKeys[e.key]);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── Position Management ────────────────────────────────────────────────────

  const addPosition = () => {
    const symbol = newPos.symbol.toUpperCase().trim();
    const qty = parseFloat(newPos.qty);
    const cost = parseFloat(newPos.cost);
    if (!symbol || isNaN(qty) || isNaN(cost)) return;
    setPositions((prev) => [...prev, { symbol, qty, costBasis: cost }]);
    setNewPos({ symbol: "", qty: "", cost: "" });
    setShowAddPosition(false);
  };

  const removePosition = (idx: number) => {
    setPositions((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── Computed Values ────────────────────────────────────────────────────────

  const focusedQuote = quotes[focusedSymbol];

  const portfolioTotal = positions.reduce((sum, p) => {
    const q = quotes[p.symbol];
    return sum + (q ? q.price * p.qty : p.costBasis * p.qty);
  }, 0);

  const portfolioPnl = positions.reduce((sum, p) => {
    const q = quotes[p.symbol];
    if (!q) return sum;
    return sum + (q.price - p.costBasis) * p.qty;
  }, 0);

  // Search filter for watchlist
  const filteredWatchlist = searchOpen && searchQuery
    ? DEFAULT_WATCHLIST.filter((s) =>
        s.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : DEFAULT_WATCHLIST;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        background: BG,
        color: "#ccc",
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        fontSize: "12px",
        height: "calc(100vh - 40px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        margin: "-1.5rem",
        marginTop: "-1rem",
      }}
    >
      {/* ── Ticker Tape ─────────────────────────────────────────────────── */}
      <div
        style={{
          background: "#060606",
          borderBottom: `1px solid ${BORDER}`,
          overflow: "hidden",
          height: "32px",
          position: "relative",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: "100%",
            animation: "tickerScroll 30s linear infinite",
            whiteSpace: "nowrap",
            gap: "2rem",
            paddingLeft: "100%",
          }}
        >
          {[...TAPE_SYMBOLS, ...TAPE_SYMBOLS].map((symbol, i) => {
            const q = quotes[symbol];
            return (
              <span
                key={`${symbol}-${i}`}
                onClick={() => setFocusedSymbol(symbol)}
                style={{
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "0 4px",
                }}
              >
                <span style={{ color: "#fff", fontWeight: 600 }}>
                  {symbol}
                </span>
                {q ? (
                  <>
                    <span style={{ color: priceColor(q.change) }}>
                      {fmt(q.price)}
                    </span>
                    <span
                      style={{
                        color: priceColor(q.change),
                        fontSize: "10px",
                      }}
                    >
                      {q.changePercent >= 0 ? "+" : ""}
                      {q.changePercent.toFixed(2)}%
                    </span>
                  </>
                ) : (
                  <span style={{ color: TEXT_DIM }}>--</span>
                )}
              </span>
            );
          })}
        </div>
        <style>{`
          @keyframes tickerScroll {
            0% { transform: translateX(0); }
            100% { transform: translateX(-50%); }
          }
        `}</style>
      </div>

      {/* ── Search Overlay ──────────────────────────────────────────────── */}
      {searchOpen && (
        <div
          style={{
            position: "absolute",
            top: "40px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 100,
            background: "#1a1a1a",
            border: `1px solid ${GREEN}`,
            padding: "8px",
            width: "400px",
          }}
        >
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && searchQuery.trim()) {
                setFocusedSymbol(searchQuery.toUpperCase().trim());
                setSearchOpen(false);
                setSearchQuery("");
              }
              if (e.key === "Escape") {
                setSearchOpen(false);
                setSearchQuery("");
              }
            }}
            placeholder="Search symbol... (Enter to chart, Esc to close)"
            style={{
              width: "100%",
              background: BG,
              border: `1px solid ${BORDER}`,
              color: "#fff",
              padding: "6px 10px",
              fontFamily: "inherit",
              fontSize: "13px",
              outline: "none",
            }}
          />
        </div>
      )}

      {/* ── Main Grid ───────────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "200px 1fr 320px",
          gridTemplateRows: "1fr auto",
          overflow: "hidden",
          minHeight: 0,
        }}
      >
        {/* ── Watchlist (left) ────────────────────────────────────────── */}
        <div
          style={{
            borderRight: `1px solid ${BORDER}`,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            gridRow: "1 / 3",
          }}
        >
          <div
            style={{
              padding: "8px 10px",
              borderBottom: `1px solid ${BORDER}`,
              background: SURFACE,
              fontSize: "10px",
              color: TEXT_DIM,
              textTransform: "uppercase",
              letterSpacing: "1px",
              fontWeight: 600,
            }}
          >
            Watchlist
          </div>

          {/* Header row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 70px 55px",
              padding: "4px 10px",
              borderBottom: `1px solid ${BORDER}`,
              fontSize: "9px",
              color: TEXT_DIM,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            <span>Sym</span>
            <span style={{ textAlign: "right" }}>Last</span>
            <span style={{ textAlign: "right" }}>Chg%</span>
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {filteredWatchlist.map((symbol) => {
              const q = quotes[symbol];
              const isActive = symbol === focusedSymbol;
              return (
                <div
                  key={symbol}
                  onClick={() => setFocusedSymbol(symbol)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 70px 55px",
                    padding: "6px 10px",
                    cursor: "pointer",
                    background: isActive ? "#1a2a1a" : "transparent",
                    borderLeft: isActive
                      ? `2px solid ${GREEN}`
                      : "2px solid transparent",
                    borderBottom: `1px solid ${BORDER}`,
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive)
                      e.currentTarget.style.background = "#151515";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span
                    style={{
                      color: isActive ? "#fff" : "#ccc",
                      fontWeight: isActive ? 600 : 400,
                    }}
                  >
                    {symbol}
                  </span>
                  <span
                    style={{
                      textAlign: "right",
                      color: q ? priceColor(q.change) : TEXT_DIM,
                    }}
                  >
                    {q ? fmt(q.price) : "--"}
                  </span>
                  <span
                    style={{
                      textAlign: "right",
                      color: q ? priceColor(q.change) : TEXT_DIM,
                      fontSize: "11px",
                    }}
                  >
                    {q
                      ? `${q.changePercent >= 0 ? "+" : ""}${q.changePercent.toFixed(1)}%`
                      : "--"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Chart Area (center) ────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Chart Header */}
          <div
            style={{
              padding: "6px 12px",
              borderBottom: `1px solid ${BORDER}`,
              background: SURFACE,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span
                style={{ color: "#fff", fontWeight: 700, fontSize: "16px" }}
              >
                {focusedSymbol}
              </span>
              {focusedQuote && (
                <>
                  <span
                    style={{
                      color: priceColor(focusedQuote.change),
                      fontSize: "16px",
                      fontWeight: 600,
                    }}
                  >
                    {fmt(focusedQuote.price)}
                  </span>
                  <span
                    style={{
                      color: priceColor(focusedQuote.change),
                      fontSize: "12px",
                    }}
                  >
                    {focusedQuote.change >= 0 ? "+" : ""}
                    {fmt(focusedQuote.change)} (
                    {focusedQuote.changePercent >= 0 ? "+" : ""}
                    {focusedQuote.changePercent.toFixed(2)}%)
                  </span>
                </>
              )}
            </div>

            {/* Timeframe buttons */}
            <div style={{ display: "flex", gap: "2px" }}>
              {TIMEFRAMES.map((tf, idx) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  style={{
                    background: timeframe === tf ? GREEN : "transparent",
                    color: timeframe === tf ? "#000" : TEXT_MED,
                    border: `1px solid ${timeframe === tf ? GREEN : BORDER}`,
                    padding: "2px 8px",
                    fontSize: "10px",
                    fontFamily: "inherit",
                    cursor: "pointer",
                    fontWeight: timeframe === tf ? 700 : 400,
                  }}
                  title={`Shortcut: ${idx + 1}`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          {/* Chart Container */}
          <div ref={chartContainerRef} style={{ flex: 1, minHeight: 0 }} />
        </div>

        {/* ── News Feed (right) ──────────────────────────────────────── */}
        <div
          style={{
            borderLeft: `1px solid ${BORDER}`,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            gridRow: "1 / 3",
          }}
        >
          <div
            style={{
              padding: "8px 10px",
              borderBottom: `1px solid ${BORDER}`,
              background: SURFACE,
              fontSize: "10px",
              color: TEXT_DIM,
              textTransform: "uppercase",
              letterSpacing: "1px",
              fontWeight: 600,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>News Feed</span>
            <span style={{ color: TEXT_MED, textTransform: "none", letterSpacing: 0 }}>
              {focusedSymbol}
            </span>
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {news.length === 0 && (
              <div
                style={{
                  padding: "20px",
                  color: TEXT_DIM,
                  textAlign: "center",
                }}
              >
                No news for {focusedSymbol}
              </div>
            )}
            {news.map((item) => {
              const isExpanded = expandedNews === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() =>
                    setExpandedNews(isExpanded ? null : item.id)
                  }
                  style={{
                    padding: "8px 10px",
                    borderBottom: `1px solid ${BORDER}`,
                    cursor: "pointer",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#151515";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: "4px",
                      fontSize: "9px",
                    }}
                  >
                    <span
                      style={{
                        color:
                          item.sentiment === "positive"
                            ? GREEN
                            : item.sentiment === "negative"
                              ? RED
                              : TEXT_DIM,
                        textTransform: "uppercase",
                        fontWeight: 600,
                      }}
                    >
                      {item.source}
                    </span>
                    <span style={{ color: TEXT_DIM }}>
                      {timeAgo(item.timestamp)}
                    </span>
                  </div>
                  <div
                    style={{
                      color: "#ddd",
                      fontSize: "11px",
                      lineHeight: "1.4",
                      fontFamily:
                        "'Inter', 'Helvetica Neue', Arial, sans-serif",
                    }}
                  >
                    {item.headline}
                  </div>
                  {isExpanded && (
                    <div
                      style={{
                        marginTop: "6px",
                        color: TEXT_MED,
                        fontSize: "11px",
                        lineHeight: "1.5",
                        fontFamily:
                          "'Inter', 'Helvetica Neue', Arial, sans-serif",
                        borderTop: `1px solid ${BORDER}`,
                        paddingTop: "6px",
                      }}
                    >
                      {item.summary}
                      <div
                        style={{
                          marginTop: "4px",
                          fontSize: "9px",
                          color: TEXT_DIM,
                        }}
                      >
                        {item.symbols.map((s) => (
                          <span
                            key={s}
                            onClick={(e) => {
                              e.stopPropagation();
                              setFocusedSymbol(s);
                            }}
                            style={{
                              display: "inline-block",
                              marginRight: "4px",
                              padding: "1px 4px",
                              border: `1px solid ${BORDER}`,
                              color: GREEN,
                              cursor: "pointer",
                            }}
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Portfolio P&L (bottom center) ──────────────────────────── */}
        <div
          style={{
            borderTop: `1px solid ${BORDER}`,
            display: "flex",
            flexDirection: "column",
            maxHeight: "220px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "6px 12px",
              borderBottom: `1px solid ${BORDER}`,
              background: SURFACE,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span
                style={{
                  fontSize: "10px",
                  color: TEXT_DIM,
                  textTransform: "uppercase",
                  letterSpacing: "1px",
                  fontWeight: 600,
                }}
              >
                Portfolio
              </span>
              {positions.length > 0 && (
                <>
                  <span style={{ color: "#fff", fontWeight: 600 }}>
                    ${fmt(portfolioTotal)}
                  </span>
                  <span
                    style={{
                      color: priceColor(portfolioPnl),
                      fontSize: "11px",
                    }}
                  >
                    P&L: {portfolioPnl >= 0 ? "+" : ""}$
                    {fmt(portfolioPnl)}
                  </span>
                </>
              )}
            </div>
            <button
              onClick={() => setShowAddPosition(!showAddPosition)}
              style={{
                background: showAddPosition ? RED : "transparent",
                color: showAddPosition ? "#fff" : GREEN,
                border: `1px solid ${showAddPosition ? RED : GREEN}`,
                padding: "1px 8px",
                fontSize: "10px",
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {showAddPosition ? "Cancel" : "+ Add"}
            </button>
          </div>

          {/* Add position form */}
          {showAddPosition && (
            <div
              style={{
                display: "flex",
                gap: "4px",
                padding: "6px 12px",
                borderBottom: `1px solid ${BORDER}`,
                background: "#0d0d0d",
                flexShrink: 0,
              }}
            >
              <input
                placeholder="SYM"
                value={newPos.symbol}
                onChange={(e) =>
                  setNewPos({ ...newPos, symbol: e.target.value })
                }
                style={{
                  width: "60px",
                  background: BG,
                  border: `1px solid ${BORDER}`,
                  color: "#fff",
                  padding: "3px 6px",
                  fontFamily: "inherit",
                  fontSize: "11px",
                }}
              />
              <input
                placeholder="Qty"
                value={newPos.qty}
                onChange={(e) =>
                  setNewPos({ ...newPos, qty: e.target.value })
                }
                style={{
                  width: "60px",
                  background: BG,
                  border: `1px solid ${BORDER}`,
                  color: "#fff",
                  padding: "3px 6px",
                  fontFamily: "inherit",
                  fontSize: "11px",
                }}
              />
              <input
                placeholder="Cost"
                value={newPos.cost}
                onChange={(e) =>
                  setNewPos({ ...newPos, cost: e.target.value })
                }
                style={{
                  width: "70px",
                  background: BG,
                  border: `1px solid ${BORDER}`,
                  color: "#fff",
                  padding: "3px 6px",
                  fontFamily: "inherit",
                  fontSize: "11px",
                }}
              />
              <button
                onClick={addPosition}
                style={{
                  background: GREEN,
                  color: "#000",
                  border: "none",
                  padding: "3px 12px",
                  fontFamily: "inherit",
                  fontSize: "11px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Add
              </button>
            </div>
          )}

          {/* Positions table */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {positions.length === 0 ? (
              <div
                style={{
                  padding: "16px",
                  color: TEXT_DIM,
                  textAlign: "center",
                  fontSize: "11px",
                }}
              >
                No positions. Click + Add to enter a position.
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "60px 50px 70px 70px 80px 30px",
                    padding: "4px 12px",
                    fontSize: "9px",
                    color: TEXT_DIM,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    borderBottom: `1px solid ${BORDER}`,
                  }}
                >
                  <span>Sym</span>
                  <span style={{ textAlign: "right" }}>Qty</span>
                  <span style={{ textAlign: "right" }}>Cost</span>
                  <span style={{ textAlign: "right" }}>Last</span>
                  <span style={{ textAlign: "right" }}>P&L</span>
                  <span />
                </div>
                {positions.map((pos, idx) => {
                  const q = quotes[pos.symbol];
                  const pnl = q
                    ? (q.price - pos.costBasis) * pos.qty
                    : 0;
                  const pnlPct = q
                    ? ((q.price - pos.costBasis) / pos.costBasis) * 100
                    : 0;
                  return (
                    <div
                      key={idx}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "60px 50px 70px 70px 80px 30px",
                        padding: "4px 12px",
                        borderBottom: `1px solid ${BORDER}`,
                        fontSize: "11px",
                      }}
                    >
                      <span
                        style={{ color: GREEN, cursor: "pointer" }}
                        onClick={() => setFocusedSymbol(pos.symbol)}
                      >
                        {pos.symbol}
                      </span>
                      <span style={{ textAlign: "right", color: "#ccc" }}>
                        {pos.qty}
                      </span>
                      <span style={{ textAlign: "right", color: TEXT_MED }}>
                        ${fmt(pos.costBasis)}
                      </span>
                      <span
                        style={{
                          textAlign: "right",
                          color: q ? "#fff" : TEXT_DIM,
                        }}
                      >
                        {q ? `$${fmt(q.price)}` : "--"}
                      </span>
                      <span
                        style={{
                          textAlign: "right",
                          color: priceColor(pnl),
                          fontWeight: 600,
                        }}
                      >
                        {q
                          ? `${pnl >= 0 ? "+" : ""}$${fmt(pnl)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)`
                          : "--"}
                      </span>
                      <button
                        onClick={() => removePosition(idx)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: TEXT_DIM,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          fontSize: "10px",
                          padding: 0,
                          textAlign: "center",
                        }}
                        title="Remove position"
                      >
                        x
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Status Bar ──────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "3px 12px",
          background: "#060606",
          borderTop: `1px solid ${BORDER}`,
          display: "flex",
          justifyContent: "space-between",
          fontSize: "9px",
          color: TEXT_DIM,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", gap: "16px" }}>
          <span>
            / Search &nbsp; 1-5 Timeframes
          </span>
          <span>
            Data: Polygon.io + CoinGecko
          </span>
        </div>
        <div>
          {new Date().toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}
