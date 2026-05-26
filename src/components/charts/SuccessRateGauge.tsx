"use client";

interface SuccessRateGaugeProps {
  rate: number; // 0-100
}

// CSS variable values
const THEME = {
  accent: "#FF3B30",
  success: "#34d399",
  warning: "#facc15",
  error: "#f87171",
  border: "#2A2A2A",
  textPrimary: "#FFFFFF",
  textSecondary: "#8A8A8A",
};

export function SuccessRateGauge({ rate }: SuccessRateGaugeProps) {
  const getColor = (rate: number) => {
    if (rate >= 90) return THEME.success;
    if (rate >= 70) return THEME.warning;
    return THEME.error;
  };

  const getLabel = (rate: number) => {
    if (rate >= 90) return "Excellent";
    if (rate >= 70) return "Good";
    return "Needs Attention";
  };

  const color = getColor(rate);

  return (
    <div className="flex flex-col items-center justify-center h-72 gap-6">
      {/* Main percentage display */}
      <div className="text-center">
        <span
          className="text-6xl font-bold"
          style={{ color: THEME.textPrimary }}
        >
          {rate.toFixed(0)}
        </span>
        <span
          className="text-3xl font-bold"
          style={{ color: THEME.textSecondary }}
        >
          %
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-xs">
        <div
          className="h-3 rounded-full w-full overflow-hidden"
          style={{ backgroundColor: THEME.border }}
        >
          <div
            className="h-full rounded-full transition-all duration-1000 ease-out"
            style={{
              width: `${rate}%`,
              background: `linear-gradient(90deg, ${THEME.accent} 0%, ${THEME.accent}cc 100%)`,
            }}
          />
        </div>
        <div className="flex justify-between mt-2">
          <span className="text-xs" style={{ color: THEME.textSecondary }}>0%</span>
          <span className="text-xs" style={{ color: THEME.textSecondary }}>100%</span>
        </div>
      </div>

      {/* Status label */}
      <div
        className="px-4 py-1.5 rounded-full text-sm font-medium"
        style={{
          backgroundColor: `${color}20`,
          color: color,
        }}
      >
        {getLabel(rate)}
      </div>
    </div>
  );
}
