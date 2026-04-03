"use client";

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

interface TypeData {
  type: string;
  count: number;
}

interface ActivityPieChartProps {
  data: TypeData[];
}

// CSS variable values for Recharts
const THEME = {
  card: "#1A1A1A",
  border: "#2A2A2A",
  textPrimary: "#FFFFFF",
  textSecondary: "#8A8A8A",
  textMuted: "#525252",
};

// Palette based on accent and semantic colors
const COLORS: Record<string, string> = {
  heartbeat: "#FF3B30",   // accent
  email: "#f59e0b",       // info
  telegram: "#f59e0b",    // amber variant
  cron: "#facc15",        // warning
  calendar: "#f472b6",    // pink
  search: "#34d399",      // success
  browser: "#fb923c",     // orange
  default: "#525252",     // muted
};

export function ActivityPieChart({ data }: ActivityPieChartProps) {
  const chartData = data.map((item) => ({
    name: item.type,
    value: item.count,
    color: COLORS[item.type] || COLORS.default,
  }));

  const total = chartData.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="h-72 w-full flex">
      {/* Chart */}
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={45}
              outerRadius={75}
              paddingAngle={2}
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: THEME.card,
                border: `1px solid ${THEME.border}`,
                borderRadius: "8px",
                color: THEME.textPrimary,
              }}
              formatter={(value: number, name: string) => [
                `${value} activities`,
                name,
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-col justify-center gap-2 pr-4">
        {chartData.map((item) => {
          const percent = total > 0 ? ((item.value / total) * 100).toFixed(0) : 0;
          return (
            <div key={item.name} className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <span
                className="text-sm capitalize"
                style={{ color: THEME.textSecondary }}
              >
                {item.name}
              </span>
              <span
                className="text-sm font-medium ml-auto"
                style={{ color: THEME.textPrimary }}
              >
                {percent}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
