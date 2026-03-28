"use client";

import { useEffect, useState } from "react";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Zap,
  BarChart2,
  Calendar,
} from "lucide-react";
import { useDemoMode, maskDollar } from "@/lib/demo-mode";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart as RePieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface CostData {
  today: number;
  yesterday: number;
  thisMonth: number;
  lastMonth: number;
  projected: number;
  budget: number;
  avgDaily: number;
  daysElapsed: number;
  daysInMonth: number;
  byAgent: Array<{ agent: string; cost: number; tokens: number; inputTokens: number; outputTokens: number }>;
  byModel: Array<{ model: string; cost: number; tokens: number; inputTokens: number; outputTokens: number }>;
  daily: Array<{ date: string; cost: number; input: number; output: number }>;
  hourly: Array<{ hour: string; cost: number }>;
  topSessions?: Array<{ key: string; label: string; cost: number; tokens: number; model: string; date: string }>;
  burndown: Array<{ day: number; remaining: number; projected: boolean }>;
  weekly: Array<{ date: string; cost: number; projected: boolean }>;
  routingStats: Array<{ tier: string; count: number; avgSavings: number }>;
}

const MODEL_COLORS: Record<string, string> = {
  "claude-opus-4": "#7C3AED",
  "claude-sonnet-4": "#3B82F6",
  "claude-haiku-3": "#10B981",
  "gpt-4": "#F59E0B",
  "gpt-3.5": "#F97316",
  "gemini-flash": "#EC4899",
  "gemini-pro": "#8B5CF6",
  unknown: "#6B7280",
};

function getModelColor(model: string): string {
  for (const [key, color] of Object.entries(MODEL_COLORS)) {
    if (model.toLowerCase().includes(key.toLowerCase())) return color;
  }
  const PALETTE = ["#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#00C7BE", "#30B0C7", "#32ADE6", "#007AFF", "#5856D6", "#AF52DE"];
  let hash = 0;
  for (let i = 0; i < model.length; i++) hash = model.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

// SVG semicircle fuel gauge
function FuelGauge({
  label,
  value,
  max,
  color,
  unit = "$",
  masked = false,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  unit?: string;
  masked?: boolean;
}) {
  const r = 54;
  const cx = 80;
  const cy = 80;
  // Semicircle from 210° to -30° (240° sweep, bottom-left to bottom-right through top)
  const startAngle = 210;
  const endAngle = -30;
  const sweep = 240;

  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const filledSweep = pct * sweep;

  function polarToXY(angleDeg: number, radius: number) {
    const rad = (angleDeg * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    };
  }

  function arcPath(startDeg: number, endDeg: number, radius: number) {
    const s = polarToXY(startDeg, radius);
    const e = polarToXY(endDeg, radius);
    const sweep = ((endDeg - startDeg + 360) % 360) > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${sweep} 1 ${e.x} ${e.y}`;
  }

  // Track from 210 → -30 (going clockwise, i.e. sweep 240°)
  // In SVG, angles go clockwise: start=210 end=210-240=-30=330 going clockwise
  const trackStart = startAngle; // 210°
  const trackEnd = startAngle - sweep; // 210 - 240 = -30° = 330°
  const fillEnd = startAngle - filledSweep;

  const trackPath = arcPath(trackStart, trackEnd, r);
  const fillPath = pct > 0 ? arcPath(trackStart, fillEnd, r) : null;

  // Needle angle
  const needleAngle = startAngle - filledSweep;
  const needleTip = polarToXY(needleAngle, r - 8);
  const needleBase1 = polarToXY(needleAngle + 90, 6);
  const needleBase2 = polarToXY(needleAngle - 90, 6);

  const budgetPct = max > 0 ? (value / max) * 100 : 0;
  const gaugeColor =
    budgetPct < 40 ? "#10B981" :
    budgetPct < 70 ? color :
    budgetPct < 90 ? "#F59E0B" :
    "#EF4444";

  return (
    <div className="flex flex-col items-center">
      <svg width={160} height={100} viewBox="0 0 160 100">
        {/* Track */}
        <path
          d={trackPath}
          fill="none"
          stroke="var(--card-elevated)"
          strokeWidth={10}
          strokeLinecap="round"
        />
        {/* Fill */}
        {fillPath && (
          <path
            d={fillPath}
            fill="none"
            stroke={gaugeColor}
            strokeWidth={10}
            strokeLinecap="round"
          />
        )}
        {/* Needle */}
        <polygon
          points={`${needleTip.x},${needleTip.y} ${needleBase1.x},${needleBase1.y} ${needleBase2.x},${needleBase2.y}`}
          fill={gaugeColor}
          opacity={0.9}
        />
        <circle cx={cx} cy={cy} r={5} fill={gaugeColor} />
        {/* Value text */}
        <text x={cx} y={cy + 24} textAnchor="middle" fontSize={13} fontWeight="bold" fill="var(--text-primary)">
          {masked ? `${unit}X.XX` : `${unit}${value < 0.01 && value > 0 ? value.toFixed(4) : value.toFixed(2)}`}
        </text>
        <text x={cx} y={cy + 38} textAnchor="middle" fontSize={9} fill="var(--text-muted)">
          {masked ? `XX% of ${unit}XXX` : `${budgetPct.toFixed(1)}% of ${unit}${max}`}
        </text>
        {/* Min/max labels */}
        <text x={20} y={92} textAnchor="middle" fontSize={8} fill="var(--text-muted)">{unit}0</text>
        <text x={140} y={92} textAnchor="middle" fontSize={8} fill="var(--text-muted)">{masked ? `${unit}XXX` : `${unit}${max}`}</text>
      </svg>
      <div className="text-xs font-medium mt-1 text-center" style={{ color: "var(--text-secondary)" }}>
        {label}
      </div>
    </div>
  );
}

// Custom tooltip for burndown chart
function BurndownTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; payload: { projected: boolean } }>; label?: string }) {
  if (!active || !payload || !payload.length) return null;
  const isProjected = payload[0]?.payload?.projected;
  return (
    <div className="px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}>
      <div style={{ color: "var(--text-muted)" }}>Day {label}</div>
      <div style={{ color: isProjected ? "var(--warning)" : "var(--success)", fontWeight: 600 }}>
        ${payload[0]?.value?.toFixed(2)} remaining {isProjected ? "(proj)" : ""}
      </div>
    </div>
  );
}

// Custom tooltip for weekly chart
function WeeklyTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; payload: { projected: boolean } }>; label?: string }) {
  if (!active || !payload || !payload.length) return null;
  const isProjected = payload[0]?.payload?.projected;
  return (
    <div className="px-3 py-2 rounded-lg text-sm" style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}>
      <div style={{ color: "var(--text-muted)" }}>{label}</div>
      <div style={{ color: isProjected ? "var(--warning)" : "var(--accent)", fontWeight: 600 }}>
        ${payload[0]?.value?.toFixed(4)} {isProjected ? "(projected)" : ""}
      </div>
    </div>
  );
}

const TIER_LABELS: Record<string, string> = {
  opus: "Opus (Frontier)",
  sonnet: "Sonnet (Fast)",
  haiku: "Haiku (Micro)",
  "gpt-5.4": "GPT-5.4 (Codex)",
  "gemini-flash": "Gemini Flash",
  "gemini-pro": "Gemini Pro",
};

export default function CostsPage() {
  const { isDemoMode } = useDemoMode();
  const d$ = (val: number | null | undefined) =>
    isDemoMode ? maskDollar(val) : val == null ? "—" : `$${val.toFixed(2)}`;
  const [costData, setCostData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<"7d" | "30d" | "90d">("30d");

  useEffect(() => {
    fetchCostData();
    const interval = setInterval(fetchCostData, 60000);
    return () => clearInterval(interval);
  }, [timeframe]);

  const fetchCostData = async () => {
    try {
      const res = await fetch(`/api/costs?timeframe=${timeframe}`);
      if (res.ok) {
        const data = await res.json();
        setCostData(data);
      }
    } catch (error) {
      console.error("Failed to fetch cost data:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto mb-4" style={{ borderColor: "var(--accent)" }} />
          <p style={{ color: "var(--text-secondary)" }}>Loading cost data...</p>
        </div>
      </div>
    );
  }

  if (!costData) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <DollarSign className="w-16 h-16 mx-auto mb-4" style={{ color: "var(--text-muted)" }} />
          <p style={{ color: "var(--text-secondary)" }}>Failed to load cost data</p>
        </div>
      </div>
    );
  }

  const budgetPercent = (costData.thisMonth / costData.budget) * 100;
  const budgetColor =
    budgetPercent < 60 ? "var(--success)" :
    budgetPercent < 85 ? "var(--warning)" :
    "var(--error)";
  const todayChange =
    costData.yesterday > 0
      ? ((costData.today - costData.yesterday) / costData.yesterday) * 100
      : 0;
  const monthChange =
    costData.lastMonth > 0
      ? ((costData.thisMonth - costData.lastMonth) / costData.lastMonth) * 100
      : 0;

  // Top 4 models for fuel gauges (show all if ≤4, otherwise top 4 + "Others")
  const topModels = costData.byModel.slice(0, 4);

  // Burndown: split actual vs projected for line rendering
  const burndownActual = costData.burndown.map((d) => ({
    ...d,
    actualRemaining: d.projected ? null : d.remaining,
    projRemaining: d.projected ? d.remaining : null,
  }));

  // Weekly: color bars differently for projected
  const weeklyActual = costData.weekly.filter((d) => !d.projected);
  const weeklyProjected = costData.weekly.filter((d) => d.projected);

  return (
    <div className="space-y-6 p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-2xl md:text-3xl font-bold mb-1"
            style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)", letterSpacing: "-1.5px" }}
          >
            Cost Intelligence
          </h1>
          <p style={{ color: "var(--text-secondary)" }}>
            LLM fuel gauges · burndown · weekly projections
          </p>
        </div>
        <div className="flex gap-2 p-1 rounded-lg" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
          {(["7d", "30d", "90d"] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className="px-4 py-2 rounded-md text-sm font-medium transition-all"
              style={{
                backgroundColor: timeframe === tf ? "var(--accent)" : "transparent",
                color: timeframe === tf ? "white" : "var(--text-secondary)",
              }}
            >
              {tf === "7d" ? "7 days" : tf === "30d" ? "30 days" : "90 days"}
            </button>
          ))}
        </div>
      </div>

      {/* Hero spend + budget bar */}
      <div
        className="p-6 rounded-xl"
        style={{
          background: "linear-gradient(135deg, rgba(74,222,128,0.10), rgba(96,165,250,0.07))",
          border: "1px solid rgba(74,222,128,0.25)",
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <div className="text-xs font-medium mb-1 uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
              Today&apos;s Spend
            </div>
            <div className="text-5xl font-bold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)", letterSpacing: "-2px" }}>
              {d$(costData.today)}
            </div>
            <div className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              vs {d$(costData.yesterday)} yesterday
              {todayChange !== 0 && (
                <span className="ml-2 font-medium" style={{ color: todayChange > 0 ? "var(--error)" : "#4ade80" }}>
                  {todayChange > 0 ? "↑" : "↓"} {Math.abs(todayChange).toFixed(1)}%
                </span>
              )}
            </div>
          </div>
          <div className="flex-1 min-w-[220px]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                Monthly Budget — {d$(costData.thisMonth)} / {isDemoMode ? "$XXX" : `$${costData.budget}`}
              </span>
              <span className="text-sm font-semibold" style={{ color: budgetColor }}>
                {budgetPercent.toFixed(0)}%
              </span>
            </div>
            <div className="h-3 rounded-full overflow-hidden" style={{ backgroundColor: "var(--card-elevated)" }}>
              <div
                className="h-full transition-all duration-700"
                style={{ width: `${Math.min(budgetPercent, 100)}%`, backgroundColor: budgetColor }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {d$(costData.projected)} projected EOM
              </span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {d$(costData.budget - costData.thisMonth)} remaining
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Today",
            value: d$(costData.today),
            sub: `vs ${d$(costData.yesterday)} yesterday`,
            change: todayChange,
          },
          {
            label: "This Month",
            value: d$(costData.thisMonth),
            sub: `vs ${d$(costData.lastMonth)} last month`,
            change: monthChange,
          },
          {
            label: "Projected EOM",
            value: d$(costData.projected),
            sub: `Avg ${d$(costData.avgDaily)}/day`,
            change: null,
          },
          {
            label: "Budget Used",
            value: isDemoMode ? "XX%" : `${budgetPercent.toFixed(0)}%`,
            sub: `${d$(costData.thisMonth)} / ${isDemoMode ? "$XXX" : `$${costData.budget}`}`,
            change: null,
          },
        ].map(({ label, value, sub, change }) => (
          <div key={label} className="p-5 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{label}</span>
              {change !== null && change !== 0 && (
                <div className="flex items-center gap-1">
                  {change > 0 ? (
                    <TrendingUp className="w-3 h-3" style={{ color: "var(--error)" }} />
                  ) : (
                    <TrendingDown className="w-3 h-3" style={{ color: "var(--success)" }} />
                  )}
                  <span className="text-xs font-medium" style={{ color: change > 0 ? "var(--error)" : "var(--success)" }}>
                    {Math.abs(change).toFixed(1)}%
                  </span>
                </div>
              )}
              {label === "Budget Used" && budgetPercent > 80 && (
                <AlertTriangle className="w-4 h-4" style={{ color: "var(--error)" }} />
              )}
            </div>
            <div className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{value}</div>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* LLM Fuel Gauges */}
      <div className="p-6 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2 mb-5">
          <Zap className="w-5 h-5" style={{ color: "var(--accent)" }} />
          <h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            LLM Fuel Gauges
          </h3>
          <span className="text-sm ml-1" style={{ color: "var(--text-muted)" }}>
            — per-model share of monthly budget
          </span>
        </div>
        {topModels.length === 0 ? (
          <p className="text-center py-8" style={{ color: "var(--text-muted)" }}>No model usage data yet</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {topModels.map((m) => (
              <FuelGauge
                key={m.model}
                label={m.model}
                value={m.cost}
                max={costData.budget}
                color={getModelColor(m.model)}
                masked={isDemoMode}
              />
            ))}
            {/* "Others" gauge if more than 4 models */}
            {costData.byModel.length > 4 && (
              <FuelGauge
                label="Others"
                value={costData.byModel.slice(4).reduce((s, m) => s + m.cost, 0)}
                max={costData.budget}
                color="#6B7280"
                masked={isDemoMode}
              />
            )}
          </div>
        )}
      </div>

      {/* Burndown + Weekly side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Budget Burndown */}
        <div className="p-6 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 mb-4">
            <TrendingDown className="w-5 h-5" style={{ color: "var(--success)" }} />
            <h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              Budget Burndown
            </h3>
          </div>
          <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
            Remaining budget over the month. Dashed = projected at current pace.
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={burndownActual}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="day" stroke="var(--text-muted)" style={{ fontSize: "11px" }} label={{ value: "Day of Month", position: "insideBottom", offset: -2, fontSize: 10, fill: "var(--text-muted)" }} />
              <YAxis stroke="var(--text-muted)" style={{ fontSize: "11px" }} tickFormatter={(v) => isDemoMode ? "$—" : `$${v}`} />
              <Tooltip content={isDemoMode ? () => null : <BurndownTooltip />} />
              <ReferenceLine y={0} stroke="var(--error)" strokeDasharray="4 2" />
              <Line
                type="monotone"
                dataKey="actualRemaining"
                stroke="#4ade80"
                strokeWidth={2.5}
                dot={false}
                name="Actual Remaining"
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="projRemaining"
                stroke="#F59E0B"
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={false}
                name="Projected Remaining"
                connectNulls={false}
              />
              <Legend wrapperStyle={{ fontSize: "11px" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Weekly Spend + Projection */}
        <div className="p-6 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-5 h-5" style={{ color: "var(--accent)" }} />
            <h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              Weekly Spend
            </h3>
          </div>
          <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
            Last 7 days actual + next 7 days projected at avg daily rate.
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={costData.weekly}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" stroke="var(--text-muted)" style={{ fontSize: "10px" }} />
              <YAxis stroke="var(--text-muted)" style={{ fontSize: "11px" }} tickFormatter={(v) => isDemoMode ? "$—" : `$${v}`} />
              <Tooltip content={isDemoMode ? () => null : <WeeklyTooltip />} />
              <Bar
                dataKey="cost"
                name="Daily Spend"
                radius={[3, 3, 0, 0]}
              >
                {costData.weekly.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.projected ? "rgba(245,158,11,0.45)" : "var(--accent)"}
                    stroke={entry.projected ? "#F59E0B" : "none"}
                    strokeWidth={entry.projected ? 1 : 0}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2">
            <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
              <div className="w-3 h-3 rounded" style={{ backgroundColor: "var(--accent)" }} />
              Actual
            </div>
            <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
              <div className="w-3 h-3 rounded" style={{ backgroundColor: "rgba(245,158,11,0.45)", border: "1px solid #F59E0B" }} />
              Projected
            </div>
          </div>
        </div>
      </div>

      {/* Per-Model Cost Breakdown */}
      <div className="p-6 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2 mb-5">
          <BarChart2 className="w-5 h-5" style={{ color: "var(--accent)" }} />
          <h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            Per-Model Cost Breakdown
          </h3>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pie chart */}
          <div>
            <ResponsiveContainer width="100%" height={280}>
              <RePieChart>
                <Pie
                  data={costData.byModel.filter((m) => m.cost > 0)}
                  dataKey="cost"
                  nameKey="model"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  innerRadius={50}
                  label={({ model, percent }) =>
                    percent > 0.05 ? `${model.split("-").slice(-2).join("-")}: ${(percent * 100).toFixed(0)}%` : ""
                  }
                  labelLine={false}
                >
                  {costData.byModel.map((entry) => (
                    <Cell key={entry.model} fill={getModelColor(entry.model)} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: number) => [isDemoMode ? "$X.XX" : `$${v.toFixed(4)}`, "Cost"]}
                  contentStyle={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", borderRadius: "8px" }}
                />
                <Legend
                  wrapperStyle={{ fontSize: "11px" }}
                  formatter={(value) => <span style={{ color: "var(--text-secondary)" }}>{value}</span>}
                />
              </RePieChart>
            </ResponsiveContainer>
          </div>

          {/* Table */}
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th className="text-left py-2 px-3 font-medium" style={{ color: "var(--text-secondary)" }}>Model</th>
                  <th className="text-right py-2 px-3 font-medium" style={{ color: "var(--text-secondary)" }}>Tokens</th>
                  <th className="text-right py-2 px-3 font-medium" style={{ color: "var(--text-secondary)" }}>Cost</th>
                  <th className="text-right py-2 px-3 font-medium" style={{ color: "var(--text-secondary)" }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {costData.byModel.map((m) => {
                  const share = costData.thisMonth > 0 ? (m.cost / costData.thisMonth) * 100 : 0;
                  return (
                    <tr key={m.model} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getModelColor(m.model) }} />
                          <span className="font-medium font-mono text-xs" style={{ color: "var(--text-primary)" }}>{m.model}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
                        {(m.tokens / 1000).toFixed(1)}K
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold" style={{ color: "var(--text-primary)" }}>
                        {isDemoMode ? "$X.XXXX" : `$${m.cost.toFixed(4)}`}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--card-elevated)" }}>
                            <div className="h-full rounded-full" style={{ width: `${Math.min(share, 100)}%`, backgroundColor: getModelColor(m.model) }} />
                          </div>
                          <span className="text-xs w-8 text-right" style={{ color: "var(--text-muted)" }}>{share.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Daily Trend + Token Usage */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-6 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
          <h3 className="text-lg font-semibold mb-4" style={{ color: "var(--text-primary)" }}>Daily Cost Trend</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={costData.daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" stroke="var(--text-muted)" style={{ fontSize: "11px" }} />
              <YAxis stroke="var(--text-muted)" style={{ fontSize: "11px" }} tickFormatter={(v) => isDemoMode ? "$—" : `$${v}`} />
              <Tooltip
                formatter={(v: number) => [isDemoMode ? "$X.XX" : `$${v.toFixed(4)}`, "Cost"]}
                contentStyle={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", borderRadius: "8px" }}
              />
              <Line type="monotone" dataKey="cost" stroke="var(--accent)" strokeWidth={2} dot={false} name="Cost ($)" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="p-6 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
          <h3 className="text-lg font-semibold mb-4" style={{ color: "var(--text-primary)" }}>Token Usage (Daily)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={costData.daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" stroke="var(--text-muted)" style={{ fontSize: "11px" }} />
              <YAxis stroke="var(--text-muted)" style={{ fontSize: "11px" }} />
              <Tooltip
                contentStyle={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)", borderRadius: "8px" }}
              />
              <Legend wrapperStyle={{ fontSize: "11px" }} />
              <Bar dataKey="input" stackId="a" fill="#60A5FA" name="Input" />
              <Bar dataKey="output" stackId="a" fill="#F59E0B" name="Output" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Routing Stats */}
      {costData.routingStats && costData.routingStats.length > 0 && (
        <div className="p-6 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
          <h3 className="text-lg font-semibold mb-4" style={{ color: "var(--text-primary)" }}>Smart Router — Task Distribution</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {costData.routingStats.map((r) => (
              <div key={r.tier} className="p-4 rounded-lg" style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}>
                <div className="text-xs font-mono mb-1" style={{ color: "var(--text-muted)" }}>{TIER_LABELS[r.tier] || r.tier}</div>
                <div className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{r.count}</div>
                <div className="text-xs mt-1" style={{ color: "#4ade80" }}>~{r.avgSavings}% savings vs Opus</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent Breakdown */}
      <div className="p-6 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
        <h3 className="text-lg font-semibold mb-4" style={{ color: "var(--text-primary)" }}>Breakdown by Agent</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th className="text-left py-3 px-4 font-medium" style={{ color: "var(--text-secondary)" }}>Agent</th>
                <th className="text-right py-3 px-4 font-medium" style={{ color: "var(--text-secondary)" }}>Input</th>
                <th className="text-right py-3 px-4 font-medium" style={{ color: "var(--text-secondary)" }}>Output</th>
                <th className="text-right py-3 px-4 font-medium" style={{ color: "var(--text-secondary)" }}>Cost</th>
                <th className="text-right py-3 px-4 font-medium" style={{ color: "var(--text-secondary)" }}>% of MTD</th>
              </tr>
            </thead>
            <tbody>
              {costData.byAgent.map((agent) => {
                const percent = costData.thisMonth > 0 ? (agent.cost / costData.thisMonth) * 100 : 0;
                return (
                  <tr key={agent.agent} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="py-3 px-4 font-medium" style={{ color: "var(--text-primary)" }}>{agent.agent}</td>
                    <td className="py-3 px-4 text-right font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
                      {(agent.inputTokens / 1000).toFixed(1)}K
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
                      {(agent.outputTokens / 1000).toFixed(1)}K
                    </td>
                    <td className="py-3 px-4 text-right font-semibold" style={{ color: "var(--text-primary)" }}>
                      {isDemoMode ? "$X.XXXX" : `$${agent.cost.toFixed(4)}`}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--card-elevated)" }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: "var(--accent)" }} />
                        </div>
                        <span className="text-xs w-8 text-right" style={{ color: "var(--text-muted)" }}>{percent.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Provider Cost Breakdown */}
      <div className="p-6 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
        <h3 className="text-lg font-semibold mb-2" style={{ color: "var(--text-primary)" }}>Cost by Provider</h3>
        <p className="text-sm mb-5" style={{ color: "var(--text-secondary)" }}>
          Subscription providers have flat monthly fees. Metered providers charge per token.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
          {[
            {
              name: "Anthropic",
              icon: "🤖",
              billing: "subscription",
              models: ["claude-opus-4-6", "claude-sonnet-4-6"],
              monthlyCost: 20,
              apiEquivalent: Math.round(costData.thisMonth * 0.65 * 100) / 100,
              note: "Claude Max subscription · Unlimited usage",
              color: "#60a5fa",
            },
            {
              name: "OpenAI Codex",
              icon: "🔮",
              billing: "subscription",
              models: ["gpt-5.4"],
              monthlyCost: 20,
              apiEquivalent: Math.round(costData.thisMonth * 0.25 * 100) / 100,
              note: "ChatGPT Plus subscription · Unlimited usage",
              color: "#4ade80",
            },
            {
              name: "Google Gemini",
              icon: "✨",
              billing: "metered",
              models: ["gemini-2.5-flash"],
              monthlyCost: Math.round(costData.thisMonth * 0.07 * 100) / 100,
              apiEquivalent: null,
              note: "Pay per token via Gemini API",
              color: "#f59e0b",
            },
            {
              name: "OpenRouter",
              icon: "🔄",
              billing: "metered",
              models: ["auto"],
              monthlyCost: Math.round(costData.thisMonth * 0.03 * 100) / 100,
              apiEquivalent: null,
              note: "Fallback router · Metered per token",
              color: "#a78bfa",
            },
          ].map((provider) => (
            <div
              key={provider.name}
              className="p-4 rounded-xl"
              style={{
                backgroundColor: "var(--card-elevated)",
                border: `1px solid ${provider.billing === "subscription" ? "rgba(74,222,128,0.2)" : "rgba(245,158,11,0.2)"}`,
              }}
            >
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">{provider.icon}</span>
                <div>
                  <div className="font-semibold" style={{ color: "var(--text-primary)" }}>{provider.name}</div>
                  <span
                    className="text-xs px-2 py-0.5 rounded"
                    style={{
                      backgroundColor: provider.billing === "subscription" ? "rgba(96,165,250,0.15)" : "rgba(245,158,11,0.15)",
                      color: provider.billing === "subscription" ? "#60a5fa" : "#f59e0b",
                    }}
                  >
                    {provider.billing === "subscription" ? "📋 Subscription" : "💳 Metered"}
                  </span>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-xl font-bold" style={{ color: provider.color }}>{isDemoMode ? "$XX" : `$${provider.monthlyCost}`}</div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>this month</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mb-2">
                {provider.models.map((m) => (
                  <span key={m} className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: "var(--card)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                    {m}
                  </span>
                ))}
              </div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>{provider.note}</p>
              {provider.apiEquivalent !== null && provider.billing === "subscription" && (
                <div className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: "#4ade80" }}>
                  <span>💰</span>
                  <span>{isDemoMode ? "API equivalent: ~$XX · saving ~$XX/mo" : `API equivalent: ~$${provider.apiEquivalent} · saving ~$${Math.max(0, provider.apiEquivalent - provider.monthlyCost).toFixed(2)}/mo`}</span>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="p-4 rounded-lg flex items-center gap-4" style={{ backgroundColor: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)" }}>
          <span className="text-2xl">💰</span>
          <div>
            <div className="font-semibold" style={{ color: "#4ade80" }}>
              Estimated Monthly Savings: {isDemoMode ? "~$XX.XX" : `~$${Math.max(0, costData.thisMonth * 0.9 - 40).toFixed(2)}`}
            </div>
            <div className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {isDemoMode
                ? "Subscriptions cost $XX/mo flat. If billed at API rates, estimated cost would be ~$XX.XX."
                : `Subscriptions cost $40/mo flat. If billed at API rates for the same usage, estimated cost would be ~$${(costData.thisMonth * 0.9 + 40).toFixed(2)}.`}
            </div>
          </div>
        </div>
      </div>

      {/* Top Sessions */}
      {costData.topSessions && costData.topSessions.length > 0 && (
        <div className="p-6 rounded-xl" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
          <h3 className="text-lg font-semibold mb-4" style={{ color: "var(--text-primary)" }}>Top Sessions by Cost</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th className="text-left py-3 px-4 font-medium" style={{ color: "var(--text-secondary)" }}>Session</th>
                  <th className="text-left py-3 px-4 font-medium" style={{ color: "var(--text-secondary)" }}>Model</th>
                  <th className="text-right py-3 px-4 font-medium" style={{ color: "var(--text-secondary)" }}>Date</th>
                  <th className="text-right py-3 px-4 font-medium" style={{ color: "var(--text-secondary)" }}>Tokens</th>
                  <th className="text-right py-3 px-4 font-medium" style={{ color: "var(--text-secondary)" }}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {costData.topSessions.map((s, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="py-3 px-4 font-medium" style={{ color: "var(--text-primary)" }}>{s.label}</td>
                    <td className="py-3 px-4 font-mono text-xs" style={{ color: "var(--text-secondary)" }}>{s.model}</td>
                    <td className="py-3 px-4 text-right" style={{ color: "var(--text-secondary)" }}>{s.date}</td>
                    <td className="py-3 px-4 text-right font-mono" style={{ color: "var(--text-secondary)" }}>{s.tokens.toLocaleString()}</td>
                    <td className="py-3 px-4 text-right font-semibold" style={{ color: "var(--accent)" }}>{isDemoMode ? "$X.XXXX" : `$${s.cost.toFixed(4)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
