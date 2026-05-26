import type { LucideProps } from "lucide-react";

export function SlidersLeverMotionIcon({ size = 30, strokeWidth = 1.85 }: LucideProps) {
  return (
    <svg
      className="sliders-lever-motion-icon"
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
      <path className="slider-track slider-track-top-left" d="M10 5H3" />
      <path className="slider-track slider-track-bottom-left" d="M12 19H3" />
      <path className="slider-lever slider-lever-top" d="M14 3v4" />
      <path className="slider-lever slider-lever-bottom" d="M16 17v4" />
      <path className="slider-track slider-track-mid-right" d="M21 12h-9" />
      <path className="slider-track slider-track-bottom-right" d="M21 19h-5" />
      <path className="slider-track slider-track-top-right" d="M21 5h-7" />
      <path className="slider-lever slider-lever-mid" d="M8 10v4" />
      <path className="slider-track slider-track-mid-left" d="M8 12H3" />
    </svg>
  );
}
