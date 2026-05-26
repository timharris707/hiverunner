import type { LucideProps } from "lucide-react";

export function OrgChartBuildIcon({ size = 30, strokeWidth = 1.75 }: LucideProps) {
  return (
    <svg
      className="org-chart-build-icon org-chart-build-icon-wide"
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
      <rect className="org-chart-node org-chart-node-top" x="9" y="3.25" width="6" height="4.4" rx="1.2" />
      <path className="org-chart-line org-chart-line-stem" d="M12 7.65v3" />
      <path className="org-chart-line org-chart-line-branch" d="M4.25 10.65h15.5" />
      <path className="org-chart-line org-chart-line-left" d="M4.25 10.65v3.05" />
      <path className="org-chart-line org-chart-line-mid" d="M12 10.65v3.05" />
      <path className="org-chart-line org-chart-line-right" d="M19.75 10.65v3.05" />
      <rect className="org-chart-node org-chart-node-left" x="1.75" y="13.7" width="5" height="4.4" rx="1.2" />
      <rect className="org-chart-node org-chart-node-mid" x="9.5" y="13.7" width="5" height="4.4" rx="1.2" />
      <rect className="org-chart-node org-chart-node-right" x="17.25" y="13.7" width="5" height="4.4" rx="1.2" />
    </svg>
  );
}
