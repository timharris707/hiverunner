"use client";

import { ReactNode } from "react";
import { InlineTooltip } from "@/components/InlineTooltip";

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  iconColor?: string;
  subtitle?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  tooltip?: ReactNode;
  testId?: string;
  valueTestId?: string;
}

export function StatsCard({
  title,
  value,
  icon,
  iconColor = "var(--info)",
  subtitle,
  trend,
  tooltip,
  testId,
  valueTestId,
}: StatsCardProps) {
  return (
    <div
      data-testid={testId}
      className="rounded-xl p-4 md:p-6"
      style={{
        backgroundColor: 'var(--card)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="flex items-center justify-between mb-1.5 md:mb-2">
        <div className="flex items-center gap-1.5">
          <span
            className="text-xs md:text-sm font-medium"
            style={{ color: 'var(--text-secondary)' }}
          >
            {title}
          </span>
          {tooltip ? <InlineTooltip label={`Explain ${title}`}>{tooltip}</InlineTooltip> : null}
        </div>
        <div className="[&>svg]:w-4 [&>svg]:h-4 md:[&>svg]:w-5 md:[&>svg]:h-5" style={{ color: iconColor }}>
          {icon}
        </div>
      </div>

      <div className="flex items-end justify-between">
        <span
          data-testid={valueTestId}
          className="text-2xl md:text-3xl font-bold tracking-tight"
          style={{ 
            fontFamily: 'var(--font-heading)',
            color: 'var(--text-primary)',
            letterSpacing: '-1.5px'
          }}
        >
          {value}
        </span>
        {trend && (
          <span
            className="text-xs md:text-sm font-medium"
            style={{ color: trend.isPositive ? 'var(--success)' : 'var(--error)' }}
          >
            {trend.isPositive ? "↑" : "↓"} {trend.value}%
          </span>
        )}
      </div>
      {subtitle && (
        <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}
