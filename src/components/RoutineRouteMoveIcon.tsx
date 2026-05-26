import type { LucideProps } from "lucide-react";

export function RoutineRouteMoveIcon({ size = 30, strokeWidth = 1.85 }: LucideProps) {
  return (
    <svg
      className="routine-route-move-icon"
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
      <rect className="routine-route-node routine-route-node-start" width="8" height="8" x="3" y="3" rx="2" />
      <path className="routine-route-line" d="M7 11v4a2 2 0 0 0 2 2h4" pathLength={1} />
      <rect className="routine-route-node routine-route-node-end" width="8" height="8" x="13" y="13" rx="2" />
      <rect className="routine-route-traveler" x="5.65" y="5.65" width="2.7" height="2.7" rx="0.7" />
    </svg>
  );
}
