import type { LucideProps } from "lucide-react";

export function FolderDrawCycleIcon({ size = 30, strokeWidth = 1.85 }: LucideProps) {
  return (
    <svg
      className="folder-draw-cycle-icon"
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
      <path
        className="folder-draw-open-back"
        pathLength={1}
        d="M2 18V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
      />
      <path
        className="folder-draw-open-front"
        pathLength={1}
        d="M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2"
      />
      <path
        className="folder-draw-closed-shell"
        pathLength={1}
        d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
      />
      <path className="folder-draw-closed-lid" pathLength={1} d="M2 10h20" />
    </svg>
  );
}
