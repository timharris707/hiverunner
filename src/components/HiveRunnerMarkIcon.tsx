"use client";

import { useEffect, useRef, useState } from "react";
import type { LucideProps } from "lucide-react";

function getHiveThemeStroke() {
  if (typeof window === "undefined") return "#eae8e4";

  const theme = document.documentElement.getAttribute("data-theme");
  if (theme === "light") return "#1a1716";
  if (theme === "dark") return "#eae8e4";

  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "#1a1716" : "#eae8e4";
}

function resolveHiveStroke(color: LucideProps["color"]) {
  if (typeof color !== "string" || color === "currentColor") {
    return getHiveThemeStroke();
  }

  const cssVarMatch = color.match(/^var\((--[^,)]+)(?:,[^)]+)?\)$/);
  if (cssVarMatch && typeof window !== "undefined") {
    const resolved = getComputedStyle(document.documentElement).getPropertyValue(cssVarMatch[1]).trim();
    if (resolved) return resolved;
  }

  return color;
}

export function HiveRunnerMarkIcon({ size = 30, strokeWidth = 1.55, color = "currentColor", className, style }: LucideProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [resolvedStroke, setResolvedStroke] = useState("#eae8e4");
  const lineWidth = (Number(strokeWidth) || 1.55) / 4.6;
  const svgClassName = className ? `hive-runner-mark ${className}` : "hive-runner-mark";

  useEffect(() => {
    const updateStroke = () => {
      const svg = svgRef.current;
      if (svg?.closest(".dock-nav-row")) {
        setResolvedStroke(getComputedStyle(svg).color);
        return;
      }

      if (typeof color === "string" && color !== "currentColor") {
        setResolvedStroke(resolveHiveStroke(color));
        return;
      }

      setResolvedStroke(getHiveThemeStroke());
    };
    const themeObserver = new MutationObserver(updateStroke);
    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: light)");

    updateStroke();
    const frame = window.requestAnimationFrame(updateStroke);
    const timeout = window.setTimeout(updateStroke, 150);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    mediaQuery?.addEventListener?.("change", updateStroke);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      themeObserver.disconnect();
      mediaQuery?.removeEventListener?.("change", updateStroke);
    };
  }, [color]);

  return (
    <svg
      ref={svgRef}
      className={svgClassName}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="-3.369 -2.471 6.862 5.800"
      width={size}
      height={size}
      style={style}
      aria-hidden="true"
    >
      <g fill="none" stroke={resolvedStroke} strokeWidth={lineWidth} strokeLinejoin="round">
        <polygon className="hive-cell hive-cell-1" points="-2.10320,-0.07143 -2.96923,-0.57143 -2.96923,-1.57143 -2.10320,-2.07143 -1.23718,-1.57143 -1.23718,-0.57143" />
        <polygon className="hive-cell hive-cell-2" points="-0.37115,-0.07143 -1.23718,-0.57143 -1.23718,-1.57143 -0.37115,-2.07143 0.49487,-1.57143 0.49487,-0.57143" />
        <polygon className="hive-cell hive-cell-3" points="1.36090,-0.07143 0.49487,-0.57143 0.49487,-1.57143 1.36090,-2.07143 2.22692,-1.57143 2.22692,-0.57143" />
        <polygon className="hive-cell hive-cell-4" points="-1.23718,1.42857 -2.10320,0.92857 -2.10320,-0.07143 -1.23718,-0.57143 -0.37115,-0.07143 -0.37115,0.92857" />
        <polygon className="hive-cell hive-cell-5" points="0.49487,1.42857 -0.37115,0.92857 -0.37115,-0.07143 0.49487,-0.57143 1.36090,-0.07143 1.36090,0.92857" />
        <polygon className="hive-cell hive-cell-6" points="2.22692,1.42857 1.36090,0.92857 1.36090,-0.07143 2.22692,-0.57143 3.09295,-0.07143 3.09295,0.92857" />
        <polygon className="hive-cell hive-cell-7" points="-0.37115,2.92857 -1.23718,2.42857 -1.23718,1.42857 -0.37115,0.92857 0.49487,1.42857 0.49487,2.42857" />
      </g>
    </svg>
  );
}
