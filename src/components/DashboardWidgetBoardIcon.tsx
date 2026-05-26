import type { LucideProps } from "lucide-react";

export function DashboardWidgetBoardIcon({ size = 30, strokeWidth = 1.8 }: LucideProps) {
  return (
    <svg
      className="dashboard-widget-board-icon"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect className="dashboard-widget dashboard-widget-hero" x="4.25" y="4.25" width="15.5" height="5.2" rx="1.35" />
      <rect className="dashboard-widget dashboard-widget-left" x="4.25" y="13.1" width="6.15" height="6.15" rx="1.35" />
      <rect className="dashboard-widget dashboard-widget-right" x="13.6" y="13.1" width="6.15" height="6.15" rx="1.35" />
    </svg>
  );
}
